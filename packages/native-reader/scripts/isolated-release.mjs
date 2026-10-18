import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertReleasePlan, runReleasePrepack } from './release-lifecycle.mjs';
import { resolveInstalledInputs } from './stage-secure-webview.mjs';
import { assertSafeStagingPaths } from './staging-path-safety.mjs';
import {
  assertOwnedStagingRoot,
  createOwnedStagingRoot,
  disposeOwnedStagingRoot,
} from './staging-ownership.mjs';
import { stageFoliateRuntime } from '../../../scripts/stage-foliate-runtime.mjs';

const defaultPackageRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const defaultWorkspaceRoot = path.resolve(defaultPackageRoot, '../..');

const normalizePathForComparison = (candidate) => {
  const normalized = path.normalize(path.resolve(candidate));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const packageManagerCommand = (command) =>
  process.platform === 'win32' ? `${command}.cmd` : command;

export const stagingNodeModulesLinkType = () =>
  process.platform === 'win32' ? 'junction' : 'dir';

// P1-5：源 manifest 是 source-only 且刻意不带 version。这样 exact no-script
// 命令（npm pack --ignore-scripts --dry-run --json）在源码根会因 npm 自身的
// "must have name and version" 校验而失败，无法靠 --ignore-scripts 绕过
// prepack 从源码根产出 tarball。发布 version 只由本模块在隔离 staging 副本
// 中注入，并集中维护在这里。
export const RELEASE_VERSION = '0.1.0';

const removeSourceOnlyLifecycleScripts = async (stagedPackageRoot) => {
  const manifestPath = path.join(stagedPackageRoot, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    manifest.scripts?.prepack !==
      'node scripts/release-lifecycle.mjs refuse-source-pack' ||
    manifest.scripts?.['pack:release'] !== 'node scripts/isolated-release.mjs'
  ) {
    throw new Error('Release lifecycle scripts have an unexpected contract');
  }
  // 发布态移除/注入只允许作用于隔离 staging：源 manifest 必须仍然带有 private
  // 标记且没有 version。若这些前置条件不成立，说明 staging 不是源清单的副本，
  // 必须 fail closed。
  if (manifest.private !== true) {
    throw new Error(
      'Isolated staging manifest must retain the source private marker before release-only removal',
    );
  }
  if (manifest.version !== undefined) {
    throw new Error(
      'Isolated staging manifest must not inherit a version from the source manifest',
    );
  }
  delete manifest.scripts.prepack;
  delete manifest.scripts.postpack;
  delete manifest.scripts['pack:release'];
  // This package is published from a deliberately isolated release tree. A
  // source-only private marker must not make the generated tarball unpublishable.
  delete manifest.private;
  // P1-5：发布 version 只在这里注入。staging 副本此前已被证明是源清单的逐字节
  // 副本（无 version），因此该写入不会影响源码根的 no-version 负向门禁。
  manifest.version = RELEASE_VERSION;
  // 根 pnpm patchedDependencies 仅用于工作区安装。发布包携带其命名空间实现，
  // 因此消费者必须从注册表解析官方依赖，不能泄露任何私有补丁路径。
  manifest.dependencies['react-native-webview'] = '13.16.1';
  if (manifest.devDependencies?.['@hamster-note/pdfkit'] === 'workspace:*') {
    const version = manifest.peerDependencies?.['@hamster-note/pdfkit'];
    if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
      throw new Error(
        'PDFKit workspace dependency needs an exact public peer version',
      );
    }
    manifest.devDependencies['@hamster-note/pdfkit'] = version;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  // staging 断言：写盘后的发布清单必须携带明确 release version，且不得重新
  // 引入 source-only 的 private 标记。读取的始终是 staging 副本。
  const stagedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    stagedManifest.version !== RELEASE_VERSION ||
    stagedManifest.private !== undefined
  ) {
    throw new Error(
      `Isolated staging manifest must publish version ${RELEASE_VERSION} without private`,
    );
  }
};

const sha256File = async (filePath) =>
  createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');

export async function prepareIsolatedRelease({
  stagingRoot,
  stagingOwnership,
  packageRoot = defaultPackageRoot,
  workspaceRoot = defaultWorkspaceRoot,
  resolveSecureInputs = () => resolveInstalledInputs(workspaceRoot),
  runReleasePrepackFn = runReleasePrepack,
  stageFoliateRuntimeFn = stageFoliateRuntime,
} = {}) {
  if (!stagingRoot) {
    throw new Error('stagingRoot is required for isolated release staging');
  }

  const initial = await assertSafeStagingPaths({
    outputRoot: stagingRoot,
    authorityRoots: [defaultPackageRoot, packageRoot, workspaceRoot],
  });
  await assertOwnedStagingRoot({
    outputRoot: initial.outputRoot,
    ownership: stagingOwnership,
  });
  const inputs = await resolveSecureInputs();
  const safe = await assertSafeStagingPaths({
    outputRoot: initial.outputRoot,
    authorityRoots: [...initial.authorityRoots, inputs?.sourceRoot],
  });
  packageRoot = safe.authorityRoots[1];
  workspaceRoot = safe.authorityRoots[2];
  const excludedTopLevel = new Set([
    'android',
    'lib',
    'node_modules',
    'secure-webview',
    'SECURE_WEBVIEW_SHA256.json',
  ]);

  // 源 manifest 必须保持 private、无 version，且整个隔离流程不得改写它。这里
  // 在复制前记录原文，prepack 成功后再逐字节比对，确保发布态移除只发生在
  // staging 上。
  const sourceManifestPath = path.join(packageRoot, 'package.json');
  const sourceManifestBefore = await readFile(sourceManifestPath, 'utf8');
  const sourceManifest = JSON.parse(sourceManifestBefore);
  if (sourceManifest.private !== true) {
    throw new Error(
      'Source package manifest must stay private for isolated release staging',
    );
  }
  // P1-5：源清单必须保持无 version，staging 才会经过受控注入获得发布 version；
  // 若源清单带了 version，源码根 exact no-script pack 命令就不再 fail closed。
  if (sourceManifest.version !== undefined) {
    throw new Error(
      'Source package manifest must stay versionless for isolated release staging',
    );
  }
  // mkdtemp 创建唯一且归本次调用所有的 workspace，绝不复用/清理 foreign 目录。
  const stagingWorkspace = await createOwnedStagingRoot({
    parentRoot: safe.outputRoot,
    prefix: 'staging-workspace-',
    authorityRoots: safe.authorityRoots,
  });
  const stagingWorkspaceRoot = stagingWorkspace.outputRoot;
  // Preserve the workspace depth: package tsconfig.json extends ../../tsconfig.base.json.
  const packagesRoot = path.join(stagingWorkspaceRoot, 'packages');
  await mkdir(packagesRoot);
  const stagedPackage = await createOwnedStagingRoot({
    parentRoot: packagesRoot,
    prefix: 'native-reader-',
    authorityRoots: safe.authorityRoots,
  });
  const stagedPackageRoot = stagedPackage.outputRoot;
  const resolveCanonicalInputs = () => ({
    sourceRoot: safe.authorityRoots[3],
  });
  const releaseOptions = {
    packageRoot: stagedPackageRoot,
    ownership: stagedPackage.ownership,
    authorityPackageRoot: packageRoot,
    workspaceRoot,
    resolveSecureInputs: resolveCanonicalInputs,
  };
  // cp 前验证真实 destination，不能靠 lexical 等值检查判断隔离。
  await assertReleasePlan(releaseOptions);
  await cp(packageRoot, stagedPackageRoot, {
    recursive: true,
    filter: (source) => {
      const relativePath = path.relative(packageRoot, source);
      if (!relativePath) return true;
      return !excludedTopLevel.has(relativePath.split(path.sep)[0]);
    },
  });
  await cp(
    path.join(workspaceRoot, 'tsconfig.base.json'),
    path.join(stagingWorkspaceRoot, 'tsconfig.base.json'),
  );
  await assertSafeStagingPaths({
    outputRoot: stagingWorkspaceRoot,
    authorityRoots: safe.authorityRoots,
    mutablePaths: ['tsconfig.base.json'],
  });
  // 复制的源链接也不能成为输出写入跳板。node_modules resolver 链接在此后创建，
  // 且永远不属于 release 可变子树。
  await assertSafeStagingPaths({
    outputRoot: stagedPackageRoot,
    authorityRoots: safe.authorityRoots,
    mutablePaths: ['.'],
  });
  // This link is only for dependency resolution. Every release-owned write is
  // explicitly rooted under stagedPackageRoot and the real package is never a
  // lifecycle target.
  // Windows 的目录 symlink 要求开发者模式或管理员权限；junction 不需要这些权限。
  await symlink(
    path.join(workspaceRoot, 'node_modules'),
    path.join(stagingWorkspaceRoot, 'node_modules'),
    stagingNodeModulesLinkType(),
  );
  // Foliate 再生成只写隔离副本，不能为了打包而改写 authority runtime。
  await assertReleasePlan(releaseOptions);
  await stageFoliateRuntimeFn({
    workspace: workspaceRoot,
    packageRoot: stagedPackageRoot,
    sourceRoot: path.join(workspaceRoot, 'vendor/foliate-js'),
  });
  await assertReleasePlan(releaseOptions);
  if (sourceManifest.files?.includes('pdf-runtime')) {
    execFileSync(
      process.execPath,
      [path.join(stagedPackageRoot, 'scripts/stage-pdf-runtime.mjs')],
      {
        cwd: stagedPackageRoot,
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    await assertReleasePlan(releaseOptions);
  }
  await runReleasePrepackFn(releaseOptions);
  // 只有 prepack 成功之后才允许改写 staging manifest。此时再次确认源
  // manifest 未被触碰，且 staging manifest 仍是源清单的 private 副本。
  const sourceManifestAfter = await readFile(sourceManifestPath, 'utf8');
  if (sourceManifestAfter !== sourceManifestBefore) {
    throw new Error(
      'Isolated release staging mutated the source package manifest',
    );
  }
  // The tarball must not retain source-only lifecycle commands because the
  // scripts directory is intentionally excluded from published files.
  await assertReleasePlan(releaseOptions);
  await removeSourceOnlyLifecycleScripts(stagedPackageRoot);
  if ((await readFile(sourceManifestPath, 'utf8')) !== sourceManifestBefore) {
    throw new Error(
      'Isolated release packing mutated the source package manifest',
    );
  }
  return { stagedPackageRoot, ownership: stagedPackage.ownership };
}

export async function packIsolatedRelease({
  stagingRoot,
  stagingOwnership,
  packDestination,
  packOwnership,
  packageRoot = defaultPackageRoot,
  workspaceRoot = defaultWorkspaceRoot,
  stageFoliateRuntimeFn = stageFoliateRuntime,
  resolveSecureInputs = () => resolveInstalledInputs(workspaceRoot),
  runReleasePrepackFn = runReleasePrepack,
  runPack = (root, destination) =>
    execFileSync(
      packageManagerCommand('npm'),
      ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
      { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    ),
} = {}) {
  if (!packDestination) {
    throw new Error('packDestination is required for isolated release packing');
  }
  // 两个输出都必须显式存在且隔离；在 resolver/Foliate/build/npm 回调前拒绝。
  const authorities = [defaultPackageRoot, packageRoot, workspaceRoot];
  const staging = await assertSafeStagingPaths({
    outputRoot: stagingRoot,
    authorityRoots: authorities,
  });
  const destination = await assertSafeStagingPaths({
    outputRoot: packDestination,
    authorityRoots: authorities,
    mutablePaths: ['.'],
  });
  // root 不能相等/父子（包括 alias）；否则 CLI finally 会清走 artifact。
  await assertSafeStagingPaths({
    outputRoot: stagingRoot,
    authorityRoots: [packDestination],
  });
  await assertSafeStagingPaths({
    outputRoot: packDestination,
    authorityRoots: [stagingRoot],
  });
  await assertOwnedStagingRoot({
    outputRoot: staging.outputRoot,
    ownership: stagingOwnership,
  });
  await assertOwnedStagingRoot({
    outputRoot: destination.outputRoot,
    ownership: packOwnership,
  });
  const inputs = await resolveSecureInputs();
  const fullAuthorities = [...staging.authorityRoots, inputs?.sourceRoot];
  await assertSafeStagingPaths({
    outputRoot: staging.outputRoot,
    authorityRoots: fullAuthorities,
  });
  await assertSafeStagingPaths({
    outputRoot: destination.outputRoot,
    authorityRoots: fullAuthorities,
    mutablePaths: ['.'],
  });
  stagingRoot = staging.outputRoot;
  packDestination = destination.outputRoot;
  const { stagedPackageRoot, ownership } = await prepareIsolatedRelease({
    stagingRoot,
    stagingOwnership,
    packageRoot,
    workspaceRoot,
    resolveSecureInputs: () => inputs,
    runReleasePrepackFn,
    stageFoliateRuntimeFn,
  });
  // npm 扫描的所有发布条目在写 artifact 前检查；resolver 链接位于 package 外。
  await assertSafeStagingPaths({
    outputRoot: stagedPackageRoot,
    authorityRoots: fullAuthorities,
    mutablePaths: ['.'],
  });
  await assertSafeStagingPaths({
    outputRoot: packDestination,
    authorityRoots: fullAuthorities,
    mutablePaths: ['.'],
  });
  await assertOwnedStagingRoot({ outputRoot: stagedPackageRoot, ownership });
  await assertOwnedStagingRoot({
    outputRoot: packDestination,
    ownership: packOwnership,
  });
  const result = JSON.parse(await runPack(stagedPackageRoot, packDestination));
  await assertOwnedStagingRoot({
    outputRoot: packDestination,
    ownership: packOwnership,
  });
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('npm pack did not return exactly one release artifact');
  }
  const [packed] = result;
  if (typeof packed?.filename !== 'string' || packed.filename.length === 0) {
    throw new Error('npm pack did not report a release tarball filename');
  }
  if (
    packed.filename.includes('/') ||
    packed.filename.includes('\\') ||
    packed.filename === '.' ||
    packed.filename === '..'
  ) {
    throw new Error(
      'npm pack reported a tarball outside the requested destination',
    );
  }
  // P1-5：final tarball 必须携带明确的 release version。npm pack --json 的
  // version 来自 staging 发布清单，也就是 tarball 内 package.json 的 version。
  if (packed.version !== RELEASE_VERSION) {
    throw new Error(
      `Isolated release tarball version must be ${RELEASE_VERSION}, received ${packed.version}`,
    );
  }
  await assertSafeStagingPaths({
    outputRoot: packDestination,
    authorityRoots: fullAuthorities,
    mutablePaths: [packed.filename],
  });
  const tarball = await realpath(path.join(packDestination, packed.filename));
  // npm 可能返回带有路径分隔符的文件名；拒绝任何越出 packDestination 的结果，
  // 确保后续 consumer 校验消费的正是这个 tarball。
  if (
    normalizePathForComparison(path.dirname(tarball)) !==
    normalizePathForComparison(packDestination)
  ) {
    throw new Error(
      'npm pack reported a tarball outside the requested destination',
    );
  }
  // final tarball 的 SHA-256 是 consumer 验证阶段唯一的真实性锚点：只从
  // 字节计算，不再重新 pack，也不从 staging 目录安装。
  const tarballSha256 = await sha256File(tarball);
  return {
    packed,
    stagedPackageRoot,
    tarball,
    tarballSha256,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--pack-destination' || !args[1]) {
    throw new Error(
      'Usage: isolated-release.mjs --pack-destination <existing-external-directory>',
    );
  }
  const destinationParent = args[1];
  const cacheRoot = path.join(os.homedir(), '.cache/opencode-tmp/opencode');
  await mkdir(cacheRoot, { recursive: true });
  const staging = await createOwnedStagingRoot({
    parentRoot: await realpath(cacheRoot),
    prefix: 'native-reader-release-',
    authorityRoots: [defaultWorkspaceRoot],
  });
  try {
    const artifacts = await createOwnedStagingRoot({
      parentRoot: destinationParent,
      prefix: 'native-reader-artifacts-',
      authorityRoots: [defaultWorkspaceRoot, staging.outputRoot],
    });
    const { packed, tarball, tarballSha256 } = await packIsolatedRelease({
      stagingRoot: staging.outputRoot,
      stagingOwnership: staging.ownership,
      packDestination: artifacts.outputRoot,
      packOwnership: artifacts.ownership,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          filename: packed.filename,
          files: packed.files.length,
          tarball,
          tarballSha256,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await disposeOwnedStagingRoot(staging);
  }
}
