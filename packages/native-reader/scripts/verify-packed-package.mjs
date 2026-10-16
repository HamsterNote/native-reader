import {
  verifyReaderSupplyChain,
  verifyPackedEngineTree,
} from '../../../scripts/verify-reader-supply-chain.mjs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  appendFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { packIsolatedRelease, RELEASE_VERSION } from './isolated-release.mjs';
import {
  createOwnedStagingRoot,
  disposeOwnedStagingRoot,
} from './staging-ownership.mjs';
import {
  findForbiddenTarballFiles,
  REQUIRED_TARBALL_FILES,
  verifyStaticNativePropagation,
} from './verify-static-native-propagation.mjs';
import { verifyAndroidConsumer } from './verify-android-consumer.mjs';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = path.resolve(packageRoot, '../..');

const packageManagerCommand = (command) =>
  process.platform === 'win32' ? `${command}.cmd` : command;

const run = (command, args, cwd) => {
  console.log(`> ${command} ${args.join(' ')}`);
  // 安装器与编译器可能产生大量正常输出。直接流向父进程可避免
  // execFileSync 默认缓冲区导致 ENOBUFS，同时仍由异常保留退出码检查。
  execFileSync(command, args, { cwd, stdio: 'inherit' });
};

const selectIosSimulatorDestination = (simctlDevices) => {
  const devicesByRuntime = simctlDevices?.devices;
  const simulator = Object.values(devicesByRuntime ?? {})
    .flat()
    .find(
      (device) =>
        device?.isAvailable === true &&
        device.name?.startsWith('iPhone') &&
        typeof device.udid === 'string' &&
        device.udid.length > 0,
    );
  if (!simulator) {
    throw new Error(
      'Unable to find an available iPhone Simulator from xcrun simctl list devices available --json',
    );
  }
  return `platform=iOS Simulator,id=${simulator.udid}`;
};

export const digestTree = async (root) => {
  const digest = createHash('sha256');
  const visit = async (relativePath) => {
    const absolutePath = path.join(root, relativePath);
    let entry;
    try {
      entry = await lstat(absolutePath);
    } catch (error) {
      if (error?.code === 'ENOENT' && !relativePath) {
        digest.update('missing\0');
        return;
      }
      throw error;
    }
    if (entry.isSymbolicLink()) {
      digest.update(`link\0${relativePath}\0${await readlink(absolutePath)}\0`);
      return;
    }
    if (entry.isDirectory()) {
      digest.update(`directory\0${relativePath}\0`);
      const children = (await readdir(absolutePath)).sort();
      for (const child of children) {
        await visit(relativePath ? path.join(relativePath, child) : child);
      }
      return;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported source tree entry type: ${absolutePath}`);
    }
    digest.update(`file\0${relativePath}\0${entry.size}\0`);
    digest.update(await readFile(absolutePath));
    digest.update('\0');
  };
  await visit('');
  return digest.digest('hex');
};

export const snapshotWorkspaceReleaseInputs = async (root = packageRoot) => ({
  // 全 package 树：包括闭包外文件、空目录、entry types 与 symlink target。
  // 不跟随 node_modules 等链接，也不扩充 40 项安全完整性闭包。
  packageTree: await digestTree(root),
});

export const assertWorkspaceReleaseInputsUnchanged = async (
  before,
  root = packageRoot,
) => {
  const after = await snapshotWorkspaceReleaseInputs(root);
  if (before.packageTree !== after.packageTree) {
    throw new Error(
      'Packed verification mutated the complete workspace package source tree',
    );
  }
  console.log(
    '[pack] complete workspace package source tree digest is unchanged after isolated staging',
  );
};

/** 成功/失败都执行只读不变性断言；失败与不变性错误不能互相掩盖。 */
export async function withWorkspaceSourceInvariant(root, runVerification) {
  const before = await snapshotWorkspaceReleaseInputs(root);
  let verificationError;
  let invarianceError;
  let result;
  try {
    result = await runVerification();
  } catch (error) {
    verificationError = error;
  } finally {
    try {
      await assertWorkspaceReleaseInputsUnchanged(before, root);
    } catch (invariantError) {
      invarianceError = invariantError;
    }
  }
  if (verificationError && invarianceError) {
    throw new AggregateError(
      [verificationError, invarianceError],
      'Packed verification failed and source invariance was violated',
      { cause: verificationError },
    );
  }
  if (invarianceError) throw invarianceError;
  if (verificationError) throw verificationError;
  return result;
}

const listSourceTarballs = async () => {
  try {
    const entries = await readdir(packageRoot);
    return entries.filter((entry) => entry.endsWith('.tgz')).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
};

const verifySourcePackRefusal = async () => {
  const tarballsBefore = await listSourceTarballs();
  const sourceManifest = JSON.parse(
    await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
  );
  // P1-5：源码根 manifest 必须是 source-only 的无 version 清单。发布 version
  // 只能由 isolated-release.mjs 注入隔离 staging，因此 exact no-script 命令
  // （npm pack --ignore-scripts --dry-run --json）必须在源码根被 npm 自身的
  // version 校验拒绝，而不能靠 --ignore-scripts 绕过 prepack 成功产出 tarball。
  if (sourceManifest.version !== undefined) {
    throw new Error(
      'Source manifest must not declare a version; release versions are injected only into isolated staging',
    );
  }
  // 即使未来有人把 version 加回源清单，prepack 仍必须是源码根的第二道门禁。
  if (
    sourceManifest.scripts?.prepack !==
    'node scripts/release-lifecycle.mjs refuse-source-pack'
  ) {
    throw new Error(
      'Source manifest must retain the source-root prepack refusal gate',
    );
  }
  let packError;
  try {
    // exact 验收命令：不带任何额外参数（也不使用 --pack-destination），确保
    // 失败只能由源码根 manifest 本身造成。
    execFileSync(
      packageManagerCommand('npm'),
      ['pack', '--ignore-scripts', '--dry-run', '--json'],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    packError = error;
  }
  if (!packError) {
    throw new Error(
      'Source-root npm pack --ignore-scripts --dry-run --json unexpectedly succeeded',
    );
  }
  const output = `${packError?.stdout ?? ''}\n${packError?.stderr ?? ''}`;
  if (!output.includes('must have name and version')) {
    throw new Error(
      `Source-root npm pack --ignore-scripts --dry-run --json failed for an unexpected reason: ${output.trim()}`,
      { cause: packError },
    );
  }
  const tarballsAfter = await listSourceTarballs();
  if (tarballsAfter.join('\0') !== tarballsBefore.join('\0')) {
    throw new Error(
      'Source-root npm pack --ignore-scripts --dry-run left a tarball in the source tree',
    );
  }
  console.log(
    '[pack] source-root npm pack --ignore-scripts --dry-run --json refused (missing version) without creating a tarball',
  );
};

const sha256File = async (filePath) =>
  createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');

const assertArtifactDigest = async (artifact, release, label) => {
  const actual = await sha256File(artifact);
  if (actual !== release.tarballSha256) {
    throw new Error(
      `Consumer artifact digest changed ${label}: expected ${release.tarballSha256}, received ${actual}`,
    );
  }
  console.log(
    `[pack] consumer artifact SHA-256 verified ${label}: ${path.basename(artifact)}`,
  );
};

// final tarball 的 SHA-256 由 packIsolatedRelease 计算并返回。consumer 流程在
// 任何使用之前以及每次 consumer 安装前后都必须复核它；一旦不一致就 fail
// closed，避免重新 pack、从 staging 安装或使用被替换的 tarball。
const assertReleaseTarballDigest = async (release, label) => {
  const expected = release?.tarballSha256;
  if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error(
      'Isolated release did not return a valid final tarball SHA-256',
    );
  }
  const actual = await sha256File(release.tarball);
  if (actual !== expected) {
    throw new Error(
      `Release tarball digest changed ${label}: expected ${expected}, received ${actual}`,
    );
  }
  console.log(
    `[pack] final release tarball SHA-256 verified ${label}: ${expected}`,
  );
};

const artifactFilename = (release) =>
  `native-reader-${release.tarballSha256}.tgz`;

// 固定 fixture 只保存第三方依赖。验证时把最终 tarball 复制为 SHA 命名文件，并在
// 临时 manifest/lockfile 中以相对 file: 定位符声明，避免任何 staging 路径泄露。
const copyVerifiedTarballArtifact = async (consumerRoot, release, label) => {
  const artifact = path.join(consumerRoot, artifactFilename(release));
  await cp(release.tarball, artifact);
  await assertArtifactDigest(artifact, release, label);
  return artifact;
};

const tarHeaderString = (header, start, end) =>
  header.subarray(start, end).toString('utf8').replace(/\0.*$/, '');

const tarEntrySize = (header) => {
  const encoded = tarHeaderString(header, 124, 136).trim();
  if (!/^[0-7]*$/.test(encoded)) {
    throw new Error('Verified tarball has an invalid tar entry size');
  }
  return Number.parseInt(encoded || '0', 8);
};

const assertSafeTarEntryPath = (entryName) => {
  if (
    !entryName.startsWith('package/') ||
    entryName.includes('\\') ||
    path.posix.isAbsolute(entryName) ||
    entryName.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error(
      `Verified tarball contains an unsafe or non-package entry: ${entryName}`,
    );
  }
};

// 仅接受 npm pack 的普通文件与目录条目。这里先解析原始 tar header，再解包，避免
// 外部 tar 在不同平台对链接、PAX 或路径穿越有不同默认行为。
const extractVerifiedTarball = async (artifact, extractionRoot, release) => {
  await assertArtifactDigest(
    artifact,
    release,
    'before verified tarball unpack',
  );
  const archive = gunzipSync(await readFile(artifact));
  let offset = 0;
  let entries = 0;
  while (offset < archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.length !== 512) {
      throw new Error('Verified tarball ends in a partial tar header');
    }
    if (header.every((byte) => byte === 0)) break;
    const name = tarHeaderString(header, 0, 100);
    const prefix = tarHeaderString(header, 345, 500);
    const entryName = prefix ? `${prefix}/${name}` : name;
    const type = String.fromCharCode(header[156] || 0);
    const size = tarEntrySize(header);
    const payloadStart = offset + 512;
    const paddedSize = Math.ceil(size / 512) * 512;
    if (!entryName || payloadStart + paddedSize > archive.length) {
      throw new Error('Verified tarball has a truncated or unnamed tar entry');
    }
    assertSafeTarEntryPath(entryName);
    if (type !== '\0' && type !== '0' && type !== '5') {
      throw new Error(
        `Verified tarball contains unsupported tar entry type ${JSON.stringify(type)}: ${entryName}`,
      );
    }
    if (type === '5' && size !== 0) {
      throw new Error(
        `Verified tarball directory has payload data: ${entryName}`,
      );
    }
    const destination = path.resolve(extractionRoot, entryName);
    const relativeDestination = path.relative(extractionRoot, destination);
    if (
      relativeDestination === '' ||
      relativeDestination === '..' ||
      relativeDestination.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeDestination)
    ) {
      throw new Error(
        `Verified tarball entry escapes extraction root: ${entryName}`,
      );
    }
    if (type === '5') {
      await mkdir(destination, { recursive: true });
    } else {
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(
        destination,
        archive.subarray(payloadStart, payloadStart + size),
      );
    }
    entries += 1;
    offset = payloadStart + paddedSize;
  }
  if (entries === 0) throw new Error('Verified tarball contains no entries');
  await assertArtifactDigest(
    artifact,
    release,
    'after verified tarball unpack',
  );
};

const assertPublishedManifestMatchesFixtureContract = async (
  consumerRoot,
  installedPackageRoot,
) => {
  const fixtureManifest = JSON.parse(
    await readFile(path.join(consumerRoot, 'package.json'), 'utf8'),
  );
  const contract = fixtureManifest.nativeReaderConsumerContract;
  if (!contract?.dependencies || !contract?.peerDependencies) {
    throw new Error(
      'Consumer fixture must contain a nativeReaderConsumerContract',
    );
  }
  const installedManifest = JSON.parse(
    await readFile(path.join(installedPackageRoot, 'package.json'), 'utf8'),
  );
  assert.deepEqual(
    installedManifest.dependencies,
    contract.dependencies,
    'Published dependency contract does not match the versioned consumer fixture',
  );
  assert.deepEqual(
    installedManifest.peerDependencies,
    contract.peerDependencies,
    'Published peer dependency contract does not match the versioned consumer fixture',
  );
};

const assertInstalledPackageMatchesArtifact = async (
  consumerRoot,
  installedPackageRoot,
  artifact,
  release,
) => {
  const extractionRoot = path.join(consumerRoot, 'verified-tarball');
  await mkdir(extractionRoot, { recursive: true });
  await extractVerifiedTarball(artifact, extractionRoot, release);
  const expected = await digestTree(path.join(extractionRoot, 'package'));
  // pnpm 将直接依赖链接到虚拟 store；比较实际包目录而不是链接文本，才能保持
  // 与 npm consumer 相同的“安装树等于 tarball”验证意图。
  const installed = await digestTree(await realpath(installedPackageRoot));
  if (expected !== installed) {
    throw new Error(
      'Installed @hamster-note/native-reader tree does not exactly match the verified final tarball',
    );
  }
};

// P1-5：final tarball 必须携带明确 release version，不能因为源清单无 version
// 而丢失。安装树与 tarball 解包结果逐字节一致（上面已断言），因此安装清单的
// version 即 tarball 内 package.json 的 version。
const assertPublishedManifestVersion = async (installedPackageRoot) => {
  const installedManifest = JSON.parse(
    await readFile(path.join(installedPackageRoot, 'package.json'), 'utf8'),
  );
  if (installedManifest.version !== RELEASE_VERSION) {
    throw new Error(
      `Published tarball version must be ${RELEASE_VERSION}, received ${installedManifest.version}`,
    );
  }
  console.log(`[pack] published tarball version verified: ${RELEASE_VERSION}`);
};

const probeCommand = (command, args) => {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: output.trim() };
  } catch (error) {
    return {
      ok: false,
      output: `${error?.stdout ?? ''}${error?.stderr ?? ''}`.trim(),
      code: error?.status ?? error?.code ?? 'unknown',
    };
  }
};

// Linux 的常规 package gate 只能覆盖发布物的静态结构，不能声称 iOS 原生
// consumer 已通过验证。发布前的 macOS gate 通过 REQUIRE_IOS_CONSUMER=1
// 启用：工具链不可用时必须失败，而不是把跳过误报为通过。
const requireIosTarballConsumer = process.env.REQUIRE_IOS_CONSUMER === '1';

const iosToolchainUnavailableReason = (pod, xcodebuild) =>
  [
    !pod.ok && `pod --version (exit=${pod.code}): ${pod.output || 'no output'}`,
    !xcodebuild.ok &&
      `xcodebuild -version (exit=${xcodebuild.code}): ${xcodebuild.output || 'no output'}`,
  ]
    .filter(Boolean)
    .join('\n') || `platform=${process.platform} (requires darwin)`;

// 尽早拒绝错误的发布执行环境，避免 Linux release job 在完成所有耗时的
// tarball/Android consumer 检查后才发现 iOS 证据从未产生。
const checkIosToolchain = () => {
  if (requireIosTarballConsumer) {
    const pod = probeCommand('pod', ['--version']);
    const xcodebuild = probeCommand('xcodebuild', ['-version']);
    if (process.platform !== 'darwin' || !pod.ok || !xcodebuild.ok) {
      throw new Error(
        `[ios] REQUIRE_IOS_CONSUMER=1 requires a macOS host with CocoaPods and Xcode to verify the final tarball consumer; native validation is unavailable:\n${iosToolchainUnavailableReason(pod, xcodebuild)}`,
      );
    }
  }
};

// 仅执行 verifier 时在 cache 中创建唯一临时根；import 纯摘要测试不触发
// pack、工具链探测或 mkdir。使用 canonical 前缀避免 macOS alias 路径失配。
let temporaryRoot;

const verifyIosTarballConsumer = async (consumerRoot, installedPackageRoot) => {
  const podspec = path.join(installedPackageRoot, 'HNSecureWebView.podspec');
  const autolink = path.join(installedPackageRoot, 'react-native.config.js');
  // Do not allow a packaging-only check to hide an unavailable Apple toolchain.
  // The raw probe output identifies exactly what a macOS validation host must run.
  const pod = probeCommand('pod', ['--version']);
  const xcodebuild = probeCommand('xcodebuild', ['-version']);
  if (process.platform !== 'darwin' || !pod.ok || !xcodebuild.ok) {
    const unavailableReason = iosToolchainUnavailableReason(pod, xcodebuild);
    if (requireIosTarballConsumer) {
      throw new Error(
        `[ios] REQUIRE_IOS_CONSUMER=1 requires a macOS host with CocoaPods and Xcode to verify the final tarball consumer; native validation is unavailable:\n${unavailableReason}`,
      );
    }
    console.log(
      `[ios] tarball consumer source verified (${podspec}, ${autolink}); native build NOT verified and this result is not release evidence. Before release, run pnpm run test:package:ios on macOS with CocoaPods and Xcode:\n${unavailableReason}`,
    );
    return;
  }
  const iosRoot = path.join(consumerRoot, 'ios');
  const schema = path.join(iosRoot, 'HNSecureWebViewSpec-schema.json');
  const codegenOutput = path.join(iosRoot, 'generated');
  const config = JSON.parse(
    execFileSync('node_modules/.bin/react-native', ['config'], {
      cwd: consumerRoot,
      encoding: 'utf8',
    }),
  );
  const dependency = config.dependencies?.['@hamster-note/native-reader'];
  if (dependency?.platforms?.ios?.podspecPath !== podspec) {
    throw new Error('iOS autolink did not expose the HNSecureWebView podspec');
  }
  run(
    'node',
    [
      'node_modules/@react-native/codegen/lib/cli/combine/combine-js-to-schema-cli.js',
      '--platform',
      'ios',
      schema,
      path.join(installedPackageRoot, 'secure-webview/src'),
    ],
    consumerRoot,
  );
  run(
    'node',
    [
      'node_modules/react-native/scripts/generate-specs-cli.js',
      '--platform',
      'ios',
      '--schemaPath',
      schema,
      '--outputDir',
      codegenOutput,
      '--libraryName',
      'HNSecureWebViewSpec',
      '--libraryType',
      'all',
    ],
    consumerRoot,
  );
  const generatedSpec = await readFile(
    path.join(codegenOutput, 'HNSecureWebViewSpec/HNSecureWebViewSpec.h'),
    'utf8',
  );
  if (
    !generatedSpec.includes('HNSecureWebView') ||
    generatedSpec.includes('RNCWebView')
  ) {
    throw new Error(
      'iOS Codegen did not exclusively generate the HNSecureWebView spec',
    );
  }
  await cp(
    path.join(
      installedPackageRoot,
      'apple-fault-matrix/HNSecureWebViewDecisionManagerTests.m',
    ),
    path.join(
      iosRoot,
      'HNSecureConsumerTests/HNSecureWebViewDecisionManagerTests.m',
    ),
  );
  run('ruby', ['create-project.rb'], iosRoot);
  run('pod', ['install', '--project-directory=ios'], consumerRoot);
  const podsProject = path.join(iosRoot, 'Pods/Pods.xcodeproj');
  // Xcode 26 不再接受只有 platform 的 iOS Simulator destination。运行时和设备
  // 映像随 macos-latest 变化，因此从 simctl 的实际可用设备中选择 iPhone 的 UDID，
  // 避免硬编码机型或 iOS 版本。
  const simctlDevices = JSON.parse(
    execFileSync(
      'xcrun',
      ['simctl', 'list', 'devices', 'available', '--json'],
      { cwd: consumerRoot, encoding: 'utf8' },
    ),
  );
  const iosSimulatorDestination = selectIosSimulatorDestination(simctlDevices);
  run(
    'xcodebuild',
    [
      '-workspace',
      path.join(iosRoot, 'HNSecureConsumer.xcworkspace'),
      '-scheme',
      'HNSecureConsumer',
      '-configuration',
      'Debug',
      '-sdk',
      'iphonesimulator',
      'CODE_SIGNING_ALLOWED=NO',
      'build',
    ],
    consumerRoot,
  );
  const podsProjectText = await readFile(
    path.join(podsProject, 'project.pbxproj'),
    'utf8',
  );
  if (!podsProjectText.includes('HNSecureWebView')) {
    throw new Error(
      'iOS consumer build metadata did not reference HNSecureWebView',
    );
  }
  const podfileLock = await readFile(
    path.join(iosRoot, 'Podfile.lock'),
    'utf8',
  );
  if (
    !podfileLock.includes('HNSecureWebView') ||
    !podfileLock.includes('react-native-webview')
  ) {
    throw new Error(
      'iOS consumer did not install both HNSecureWebView and official react-native-webview pods',
    );
  }
  run(
    'xcodebuild',
    [
      '-workspace',
      path.join(iosRoot, 'HNSecureConsumer.xcworkspace'),
      '-scheme',
      'HNSecureConsumer',
      '-destination',
      iosSimulatorDestination,
      'CODE_SIGNING_ALLOWED=NO',
      'test',
    ],
    consumerRoot,
  );
  console.log(
    `[ios] tarball consumer Codegen, CocoaPods, and HNSecureConsumer app build passed.`,
  );
};

const writeConsumerSupport = async (consumer) => {
  await mkdir(consumer, { recursive: true });
  await mkdir(path.join(consumer, 'ios'), { recursive: true });
  // expo@57 的 Expo.podspec 要求 iOS 16.4+，而合成 consumer 的 Podfile 固定为
  // iOS 15.1；本 consumer 只验证 native-reader，Expo 不应作为 native pod 被
  // iOS autolinking 引入。在 consumer 根目录写入项目级 react-native.config.cjs，
  // 用 CLI 官方的 platforms.ios = null 覆盖机制仅禁用 expo 的 iOS autolinking。
  // 必须使用 .cjs：consumer 清单带 "type": "module"，.js 配置会被当成 ESM 解析
  // 并在 module.exports 处抛 ReferenceError，而 .cjs 始终按 CommonJS 加载，
  // 且 CLI 的 cosmiconfig 会搜索该文件名。此方式既不需要提高 deployment target，
  // 也不改动 package 自身的 react-native.config.js。
  await writeFile(
    path.join(consumer, 'react-native.config.cjs'),
    `// 合成 consumer 不使用 Expo 原生模块，且 Podfile 固定 iOS 15.1，
// 仅对 expo 禁用 iOS autolinking（Android 配置保持不变）。
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        ios: null,
      },
    },
  },
};
`,
  );
  // CocoaPods needs an app target to integrate autolinked native modules. The
  // xcodeproj Ruby gem is installed with CocoaPods, so this only runs in the
  // same Darwin/toolchain branch that will perform the native build.
  await writeFile(
    path.join(consumer, 'ios', 'create-project.rb'),
    "require 'xcodeproj'\nproject = Xcodeproj::Project.new(File.join(__dir__, 'HNSecureConsumer.xcodeproj'))\napp = project.new_target(:application, 'HNSecureConsumer', :ios, '15.1')\ntests = project.new_target(:unit_test_bundle, 'HNSecureConsumerTests', :ios, '15.1')\napp_group = project.main_group.new_group('HNSecureConsumer')\napp_source = app_group.new_file('HNSecureConsumer/main.m')\napp.source_build_phase.add_file_reference(app_source)\ntest_group = project.main_group.new_group('HNSecureConsumerTests')\ntest_source = test_group.new_file('HNSecureConsumerTests/HNSecureWebViewDecisionManagerTests.m')\ntests.source_build_phase.add_file_reference(test_source)\ntests.add_dependency(app)\ntests.build_configurations.each do |config|\n  config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'\n  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.hamsternote.secureconsumer.tests'\n  config.build_settings['TEST_HOST'] = '$(BUILT_PRODUCTS_DIR)/HNSecureConsumer.app/HNSecureConsumer'\n  config.build_settings['BUNDLE_LOADER'] = '$(TEST_HOST)'\n  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'\nend\napp.build_configurations.each do |config|\n  config.build_settings['INFOPLIST_FILE'] = 'HNSecureConsumer/Info.plist'\n  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.hamsternote.secureconsumer'\n  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'\n  # 合成 app 只有 Objective-C 的 main.m；不同于官方 RN 模板的 AppDelegate.mm，\n  # 它不会自然将 C++ 运行时带入链接。RN 0.86 的原生静态库依赖 libc++，\n  # 显式保留 inherited flags 并链接 libc++，避免 x86_64 下 ___cxa_* 等符号缺失。\n  config.build_settings['CLANG_CXX_LIBRARY'] = 'libc++'\n  config.build_settings['OTHER_LDFLAGS'] = '$(inherited) -lc++'\nend\nproject.save\nscheme = Xcodeproj::XCScheme.new\nscheme.add_build_target(app)\n# 测试 target 必须同时进入 BuildAction（buildForTesting=YES，供 xcodebuild test 构建）\n# 和 TestAction 的 TestableReference；test_action.add_testable 只接受 testable 对象，\n# 直接传 PBXNativeTarget 会因缺少 xml_element 在保存时抛 NoMethodError。\nscheme.add_build_target(tests, false)\nscheme.add_test_target(tests)\nscheme.save_as(project.path, 'HNSecureConsumer', true)\n",
  );
  // 测试 bundle 会直接链接含 C++ 代码的 HNSecureWebView/ReactCodegen 静态库。
  // 合成工程没有官方 RN 模板的 Objective-C++ 源文件，因此同步为测试 target
  // 显式链接 libc++，覆盖 arm64 和 x86_64 的 xcodebuild test 链接阶段。
  const createProjectPath = path.join(consumer, 'ios', 'create-project.rb');
  const createProjectSource = await readFile(createProjectPath, 'utf8');
  const testTargetAnchor =
    "  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'\nend\napp.build_configurations.each do |config|";
  const testTargetReplacement =
    "  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'\n  # 测试 bundle 直接链接含 C++ 代码的 HNSecureWebView 和 ReactCodegen；\n  # 在 arm64/x86_64 上都必须显式链接 libc++。\n  config.build_settings['CLANG_CXX_LIBRARY'] = 'libc++'\n  config.build_settings['OTHER_LDFLAGS'] = '$(inherited) -lc++'\nend\napp.build_configurations.each do |config|";
  assert.match(
    createProjectSource,
    new RegExp(testTargetAnchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'Unable to add libc++ linker settings to the iOS test target',
  );
  await writeFile(
    createProjectPath,
    createProjectSource.replace(testTargetAnchor, testTargetReplacement),
  );
  await mkdir(path.join(consumer, 'ios', 'HNSecureConsumer'), {
    recursive: true,
  });
  await mkdir(path.join(consumer, 'ios', 'HNSecureConsumerTests'), {
    recursive: true,
  });
  await writeFile(
    path.join(consumer, 'ios', 'HNSecureConsumer', 'main.m'),
    '#import <UIKit/UIKit.h>\nint main(int argc, char * argv[]) { @autoreleasepool { return UIApplicationMain(argc, argv, nil, nil); } }\n',
  );
  await writeFile(
    path.join(consumer, 'ios', 'HNSecureConsumer', 'Info.plist'),
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string><key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string><key>CFBundleName</key><string>HNSecureConsumer</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>1.0</string><key>CFBundleVersion</key><string>1</string></dict></plist>\n',
  );
  // 官方 RN 模板写法：用 Podfile 所在目录（Pod::Config.instance.installation_root）
  // 拼出与 pod cwd 无关的 app 绝对路径。pod install 的 cwd 是 consumer 根目录，
  // 若沿用 RN 默认的相对路径 '..'，Codegen 会去 consumer 的父目录找 package.json，
  // 并报 "../package.json does not exist"。
  await writeFile(
    path.join(consumer, 'ios', 'Podfile'),
    `platform :ios, '15.1'
require_relative '../node_modules/react-native/scripts/react_native_pods'
prepare_react_native_project!
target 'HNSecureConsumer' do
  config = use_native_modules!
  use_react_native!(
    :path => config[:reactNativePath],
    # 应用根目录的绝对路径：Podfile 位于 consumer/ios，上跳一级即 consumer 根目录，
    # 不受执行 pod 命令时 cwd 的影响。
    :app_path => "#{Pod::Config.instance.installation_root}/.."
  )
  # 官方 RN 模板要求的 post_install：向 Pods 工程和 app 工程注入
  # REACT_NATIVE_PATH、PODFILE_DIR 等 build settings。缺少它时
  # ReactNativeDependencies/hermes 的脚本会将空 REACT_NATIVE_PATH 展开为
  # /scripts/xcode/with-environment.sh，导致 Xcode 构建失败。
  post_install do |installer|
    react_native_post_install(installer, config[:reactNativePath])
  end
end
target 'HNSecureConsumerTests' do
  inherit! :search_paths
  pod 'HNSecureWebView', :path => '../node_modules/@hamster-note/native-reader'
end
`,
  );
  await writeFile(
    path.join(consumer, 'index.mts'),
    "import { NativeReader, type ReaderSource } from '@hamster-note/native-reader';\nconst source: ReaderSource = { kind: 'uri', uri: 'file:///book.epub' };\nvoid NativeReader; void source;\n",
  );
  await writeFile(
    path.join(consumer, 'index.cts'),
    "import { NativeReader, type ReaderSource } from '@hamster-note/native-reader';\nconst source: ReaderSource = { kind: 'uri', uri: 'file:///book.epub' };\nvoid NativeReader; void source;\n",
  );
  await writeFile(
    path.join(consumer, 'verify-esm.mjs'),
    "const { NativeReader } = await import('@hamster-note/native-reader');\nif (typeof NativeReader !== 'function') throw new TypeError('ESM NativeReader export is not a function');\n",
  );
  await writeFile(
    path.join(consumer, 'verify-cjs.cjs'),
    "const { NativeReader } = require('@hamster-note/native-reader');\nif (typeof NativeReader !== 'function') throw new TypeError('CJS NativeReader export is not a function');\n",
  );
  await writeFile(
    path.join(consumer, 'verify-condition.mjs'),
    `const expected = process.argv[2];
const resolved = import.meta.resolve('@hamster-note/native-reader');
if (!resolved.endsWith(expected)) {
  throw new Error(\`Expected conditional export \${expected}, resolved \${resolved}\`);
}
const { NativeReader } = await import('@hamster-note/native-reader');
if (typeof NativeReader !== 'function') {
  throw new TypeError(\`Conditional \${expected} NativeReader export is not a function\`);
}
console.log(\`Resolved and loaded conditional export: \${expected}\`);
`,
  );
  // 裸 Node 无法解析 React Native 的 Flow 源码，也没有 WebView/Gesture/Expo
  // 原生运行时。这里只替换这些平台边界；native-reader 与 Foliate 协议
  // 的 ESM/CJS 代码仍由 Node 真实执行。
  await writeFile(
    path.join(consumer, 'runtime-stub.mjs'),
    `export const ActivityIndicator = () => null;
export const View = () => null;
export const Text = () => null;
export const Pressable = () => null;
export const ScrollView = () => null;
export const StyleSheet = { create: (styles) => styles };
export const Platform = { OS: 'android' };
export const AppState = {
  currentState: 'active',
  addEventListener: () => ({ remove: () => undefined }),
};
export const I18nManager = { isRTL: false };
export const Dimensions = { get: () => ({ width: 320, height: 640 }) };
export const WebView = () => null;
export const GestureHandlerRootView = ({ children }) => children;
export const GestureDetector = ({ children }) => children;
export const TouchableWithoutFeedback = ({ children }) => children;
export const Directions = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8 };
const chain = { maxDuration: () => chain, numberOfTaps: () => chain, direction: () => chain, onStart: () => chain };
export const Gesture = { Tap: () => chain, LongPress: () => chain, Fling: () => chain, Exclusive: () => chain };
export const cacheDirectory = null;
export const bundleDirectory = null;
export const readAsStringAsync = async () => '';
export const writeAsStringAsync = async () => undefined;
export const deleteAsync = async () => undefined;
export const getInfoAsync = async (uri) => ({ uri, exists: false });
export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' };
export const getRandomValues = () => { throw new Error('No native entropy in resolution smoke'); };
export const digest = async () => { throw new Error('No native digest in resolution smoke'); };
export default View;
`,
  );
  await writeFile(
    path.join(consumer, 'runtime-loader.mjs'),
    `const platformModules = new Set([
  'expo-file-system/legacy',
  'expo-crypto',
  'react-native',
  'react-native-gesture-handler',
  'react-native-webview',
]);
const stubUrl = new URL('./runtime-stub.mjs', import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  return platformModules.has(specifier)
    ? { shortCircuit: true, url: stubUrl }
    : nextResolve(specifier, context);
}
`,
  );
  await writeFile(
    path.join(consumer, 'register-runtime-stubs.cjs'),
    `const Module = require('node:module');
const originalLoad = Module._load;
const chain = {};
Object.assign(chain, {
  maxDuration: () => chain,
  numberOfTaps: () => chain,
  direction: () => chain,
  onStart: () => chain,
});
const component = ({ children }) => children ?? null;
const stub = {
  ActivityIndicator: component,
  View: component,
  Text: component,
  Pressable: component,
  ScrollView: component,
  StyleSheet: { create: (styles) => styles },
  Platform: { OS: 'android' },
  AppState: {
    currentState: 'active',
    addEventListener: () => ({ remove: () => undefined }),
  },
  I18nManager: { isRTL: false },
  Dimensions: { get: () => ({ width: 320, height: 640 }) },
  WebView: component,
  GestureHandlerRootView: component,
  GestureDetector: component,
  TouchableWithoutFeedback: component,
  Directions: { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8 },
  Gesture: { Tap: () => chain, LongPress: () => chain, Fling: () => chain, Exclusive: () => chain },
  cacheDirectory: null,
  bundleDirectory: null,
  readAsStringAsync: async () => '',
  writeAsStringAsync: async () => undefined,
  deleteAsync: async () => undefined,
  getInfoAsync: async (uri) => ({ uri, exists: false }),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  getRandomValues: () => { throw new Error('No native entropy in resolution smoke'); },
  digest: async () => { throw new Error('No native digest in resolution smoke'); },
};
const platformModules = new Set([
  'expo-file-system/legacy',
  'expo-crypto',
  'react-native',
  'react-native-gesture-handler',
  'react-native-webview',
]);
Module._load = function load(request, parent, isMain) {
  return platformModules.has(request)
    ? stub
    : originalLoad.call(this, request, parent, isMain);
};
`,
  );
  await writeFile(
    path.join(consumer, 'tsconfig.base.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          jsx: 'react-jsx',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2022',
        },
        include: ['index.mts', 'index.cts'],
      },
      null,
      2,
    )}\n`,
  );
  for (const condition of ['browser', 'react-native']) {
    await writeFile(
      path.join(consumer, `tsconfig.${condition}.json`),
      `${JSON.stringify(
        {
          extends: './tsconfig.base.json',
          compilerOptions: { customConditions: [condition] },
        },
        null,
        2,
      )}\n`,
    );
  }
  await writeFile(
    path.join(consumer, 'verify-typescript-resolution.mjs'),
    `import path from 'node:path';
import ts from 'typescript';

const condition = process.argv[2];
const expected = process.argv[3];
const containingFile = path.join(process.cwd(), 'index.mts');
const result = ts.resolveModuleName(
  '@hamster-note/native-reader',
  containingFile,
  {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    customConditions: [condition],
  },
  ts.sys,
).resolvedModule;
if (!result?.resolvedFileName.endsWith(expected)) {
  throw new Error(
    \`TypeScript condition \${condition} expected \${expected}, resolved \${result?.resolvedFileName}\`,
  );
}
console.log(\`TypeScript resolved \${condition} to \${expected}\`);
`,
  );
};

const prepareLockedConsumer = async (release, packageManager) => {
  const consumer = path.join(temporaryRoot, `${packageManager}-consumer`);
  const fixture = path.join(packageRoot, 'consumer-fixtures', packageManager);
  const lockedSource = path.join(
    temporaryRoot,
    `${packageManager}-locked-source`,
  );
  await cp(fixture, lockedSource, { recursive: true });
  const artifact = await copyVerifiedTarballArtifact(
    lockedSource,
    release,
    `before ${packageManager} locked consumer preparation`,
  );
  const manifestPath = path.join(lockedSource, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const artifactSpecifier = `file:./${path.basename(artifact)}`;
  manifest.dependencies['@hamster-note/native-reader'] = artifactSpecifier;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const lockfileName =
    packageManager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml';
  const lockfile = path.join(lockedSource, lockfileName);

  if (packageManager === 'pnpm') {
    // 锁定工作目录绝不作为 consumer 使用。先将相对 SHA artifact 定位符写进
    // pnpm lockfile，随后把它复制给全新的 consumer，由 frozen install 首次安装。
    run(
      packageManagerCommand('pnpm'),
      ['install', '--ignore-workspace', '--lockfile-only', '--ignore-scripts'],
      lockedSource,
    );
    const lockText = await readFile(lockfile, 'utf8');
    if (
      !lockText.includes(`specifier: ${artifactSpecifier}`) ||
      !lockText.includes(`file:${path.basename(artifact)}`)
    ) {
      throw new Error(
        'pnpm consumer lockfile must retain the SHA-named relative file: tarball dependency',
      );
    }
  }

  await assertArtifactDigest(
    artifact,
    release,
    `before ${packageManager} locked consumer copy`,
  );
  await cp(lockedSource, consumer, { recursive: true });
  const consumerArtifact = path.join(consumer, path.basename(artifact));
  await assertArtifactDigest(
    consumerArtifact,
    release,
    `before ${packageManager} first consumer install`,
  );
  await writeConsumerSupport(consumer);
  const consumerLockfile = path.join(consumer, lockfileName);
  const lockedSourceDigest = await sha256File(lockfile);
  const lockDigestBefore = await sha256File(consumerLockfile);
  if (lockDigestBefore !== lockedSourceDigest) {
    throw new Error(
      `${packageManager} consumer copy did not preserve the prepared lockfile digest`,
    );
  }
  // 在安装器首次解包前，先对该 consumer 即将使用的 artifact 做 fail-closed tar
  // 结构验证。之后的树比较会再次实际解包并复核摘要。
  await extractVerifiedTarball(
    consumerArtifact,
    path.join(consumer, 'preinstall-verified-tarball'),
    release,
  );
  if (packageManager === 'npm') {
    // npm 的 fixture lockfile 不含本次唯一的 tarball；保留 manifest 声明供 RN
    // autolink 使用，同时禁止写回版本化 lockfile。
    console.log('[npm] consumer install with manifest-declared SHA artifact');
    run(
      packageManagerCommand('npm'),
      ['install', '--ignore-scripts', '--package-lock=false'],
      consumer,
    );
  } else {
    console.log(
      '[pnpm] first consumer install: pnpm install --ignore-workspace --frozen-lockfile --ignore-scripts',
    );
    run(
      packageManagerCommand('pnpm'),
      [
        'install',
        '--ignore-workspace',
        '--frozen-lockfile',
        '--ignore-scripts',
      ],
      consumer,
    );
  }
  const lockDigestAfterInstall = await sha256File(consumerLockfile);
  if (lockDigestAfterInstall !== lockDigestBefore) {
    throw new Error(
      `${packageManager} fixed fixture install modified its lockfile`,
    );
  }
  await assertArtifactDigest(
    consumerArtifact,
    release,
    `after ${packageManager} consumer install`,
  );
  await assertReleaseTarballDigest(
    release,
    `after ${packageManager} consumer install`,
  );
  const installedPackageRoot = path.join(
    consumer,
    'node_modules/@hamster-note/native-reader',
  );
  await assertInstalledPackageMatchesArtifact(
    consumer,
    installedPackageRoot,
    consumerArtifact,
    release,
  );
  await assertPublishedManifestVersion(installedPackageRoot);
  await assertPublishedManifestMatchesFixtureContract(
    consumer,
    installedPackageRoot,
  );
  return consumer;
};

const expectVerificationFailure = async (
  description,
  expectedMessage,
  runTest,
) => {
  try {
    await runTest();
  } catch (error) {
    if (!String(error?.message).includes(expectedMessage)) {
      throw new Error(
        `${description} failed for the wrong reason: ${error?.message}`,
        { cause: error },
      );
    }
    return;
  }
  throw new Error(`${description} did not fail closed`);
};

const verifyFailClosedMutations = async (consumer, installedPackageRoot) => {
  const mutationRoot = path.join(temporaryRoot, 'native-propagation-mutation');
  await cp(installedPackageRoot, mutationRoot, { recursive: true });
  const manifestPath = path.join(mutationRoot, 'SECURE_WEBVIEW_SHA256.json');
  const originalManifestText = await readFile(manifestPath, 'utf8');
  const tamperedManifest = JSON.parse(originalManifestText);
  const [firstHashedFile] = Object.keys(tamperedManifest.files);
  tamperedManifest.files[firstHashedFile] = '0'.repeat(64);
  await writeFile(
    manifestPath,
    `${JSON.stringify(tamperedManifest, null, 2)}\n`,
  );
  await expectVerificationFailure(
    'Tampered hash test',
    'SHA-256 mismatch',
    () =>
      verifyStaticNativePropagation({
        consumerRoot: consumer,
        packageRoot: mutationRoot,
        dependencyResolutionRoot: installedPackageRoot,
      }),
  );
  await writeFile(manifestPath, originalManifestText);
  // Every packed security-boundary file must independently fail closed. The
  // installed tree is a copy of the final tarball, so this proves tarball-side
  // verification without mutating the artifact or reinstalling dependencies.
  for (const integrityPath of Object.keys(
    JSON.parse(originalManifestText).files,
  )) {
    const target = path.join(mutationRoot, integrityPath);
    const originalContents = await readFile(target);
    await appendFile(target, Buffer.from('\n// integrity regression test\n'));
    await expectVerificationFailure(
      `Packed integrity regression test: ${integrityPath}`,
      'SHA-256 mismatch',
      () =>
        verifyStaticNativePropagation({
          consumerRoot: consumer,
          packageRoot: mutationRoot,
          dependencyResolutionRoot: installedPackageRoot,
        }),
    );
    await writeFile(target, originalContents);
  }
  const webRuntimeManifestPath = path.join(
    mutationRoot,
    'foliate-runtime/web/manifest.json',
  );
  const originalWebRuntimeManifest = JSON.parse(
    await readFile(webRuntimeManifestPath, 'utf8'),
  );
  const expectWebRuntimeFailure = async (
    description,
    expectedMessage,
    mutate,
  ) => {
    await writeFile(
      webRuntimeManifestPath,
      `${JSON.stringify(originalWebRuntimeManifest, null, 2)}\n`,
    );
    await mutate();
    await expectVerificationFailure(description, expectedMessage, () =>
      verifyStaticNativePropagation({
        consumerRoot: consumer,
        packageRoot: mutationRoot,
        dependencyResolutionRoot: installedPackageRoot,
      }),
    );
  };
  await expectWebRuntimeFailure(
    'Unknown Web runtime version regression test',
    'Foliate Web runtime manifest identity',
    async () => {
      const manifest = structuredClone(originalWebRuntimeManifest);
      manifest.runtimeVersion = 'unknown';
      await writeFile(
        webRuntimeManifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    },
  );
  await expectWebRuntimeFailure(
    'Wrong Web runtime repository regression test',
    'Foliate Web runtime manifest identity',
    async () => {
      const manifest = structuredClone(originalWebRuntimeManifest);
      manifest.source.repository = 'https://example.invalid/foliate-js.git';
      await writeFile(
        webRuntimeManifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    },
  );
  await expectWebRuntimeFailure(
    'Wrong Web runtime hash regression test',
    'Foliate Web runtime asset does not match manifest',
    async () => {
      const manifest = structuredClone(originalWebRuntimeManifest);
      manifest.assets[0].sha256 = '0'.repeat(64);
      await writeFile(
        webRuntimeManifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    },
  );
  await writeFile(
    webRuntimeManifestPath,
    `${JSON.stringify(originalWebRuntimeManifest, null, 2)}\n`,
  );

  const verifyMutation = () =>
    verifyStaticNativePropagation({
      consumerRoot: consumer,
      packageRoot: mutationRoot,
      dependencyResolutionRoot: installedPackageRoot,
    });
  const packageManifestPath = path.join(mutationRoot, 'package.json');
  const originalPackageManifest = await readFile(packageManifestPath, 'utf8');
  for (const engine of ['epubjs', '@epubjs-react-native/core']) {
    const manifest = JSON.parse(originalPackageManifest);
    manifest.dependencies[engine] = '1.0.0';
    await writeFile(packageManifestPath, JSON.stringify(manifest));
    await expectVerificationFailure(
      `Retired dependency ${engine} regression test`,
      'Published manifest must not resolve',
      verifyMutation,
    );
  }
  await writeFile(packageManifestPath, originalPackageManifest);
  const retiredPayload = path.join(mutationRoot, 'lib/vendor/core');
  await mkdir(retiredPayload, { recursive: true });
  await writeFile(path.join(retiredPayload, 'index.js'), 'retired engine');
  await expectVerificationFailure(
    'Retired engine payload regression test',
    'Packed package contains retired engine payload',
    verifyMutation,
  );
  await rm(retiredPayload, { recursive: true });

  const protocolEntry = 'lib/commonjs/nativeFoliateProtocol.js';
  const missingProtocolManifest = JSON.parse(originalManifestText);
  delete missingProtocolManifest.files[protocolEntry];
  await rm(path.join(mutationRoot, protocolEntry));
  await writeFile(
    manifestPath,
    `${JSON.stringify(missingProtocolManifest, null, 2)}\n`,
  );
  await expectVerificationFailure(
    'Missing Foliate protocol entry regression test',
    `Required tarball expected-set file is missing: ${protocolEntry}`,
    () =>
      verifyStaticNativePropagation({
        consumerRoot: consumer,
        packageRoot: mutationRoot,
        dependencyResolutionRoot: installedPackageRoot,
      }),
  );
  console.log(
    '[npm] fail-closed verifier tests (no reinstall): every fixed integrity member, runtime metadata, and missing Foliate protocol entry regressions rejected',
  );
};

const verifyConsumer = async (consumer, packageManager, testFailClosed) => {
  const installedPackageRoot = path.join(
    consumer,
    'node_modules/@hamster-note/native-reader',
  );
  await verifyPackedEngineTree(installedPackageRoot);
  console.log(
    `[${packageManager}] un-stubbed static native propagation (installed tree, no runtime loader)`,
  );
  await verifyStaticNativePropagation({
    consumerRoot: consumer,
    packageRoot: installedPackageRoot,
  });
  await verifyIosTarballConsumer(consumer, installedPackageRoot);
  if (testFailClosed) {
    await verifyFailClosedMutations(consumer, installedPackageRoot);
  }

  console.log(`[${packageManager}] TypeScript browser conditional surface`);
  run(
    'node',
    ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.browser.json'],
    consumer,
  );
  run(
    'node',
    [
      'verify-typescript-resolution.mjs',
      'browser',
      '/lib/typescript/module/src/index.web.d.ts',
    ],
    consumer,
  );
  console.log(
    `[${packageManager}] TypeScript react-native conditional surface`,
  );
  run(
    'node',
    [
      'node_modules/typescript/bin/tsc',
      '--project',
      'tsconfig.react-native.json',
    ],
    consumer,
  );
  run(
    'node',
    [
      'verify-typescript-resolution.mjs',
      'react-native',
      '/lib/typescript/commonjs/src/index.native.d.ts',
    ],
    consumer,
  );
  console.log(`[${packageManager}] real browser conditional export load`);
  run(
    'node',
    [
      '--conditions=browser',
      '--loader',
      './runtime-loader.mjs',
      'verify-condition.mjs',
      '/lib/module/index.web.js',
    ],
    consumer,
  );
  console.log(`[${packageManager}] real react-native conditional export load`);
  run(
    'node',
    [
      '--conditions=react-native',
      '--require',
      './register-runtime-stubs.cjs',
      '--loader',
      './runtime-loader.mjs',
      'verify-condition.mjs',
      '/lib/commonjs/index.native.js',
    ],
    consumer,
  );
  console.log(
    `[${packageManager}] stubbed ESM/CJS smoke (not native evidence)`,
  );
  run(
    'node',
    [
      '--require',
      './register-runtime-stubs.cjs',
      '--loader',
      './runtime-loader.mjs',
      'verify-esm.mjs',
    ],
    consumer,
  );
  run(
    'node',
    ['--require', './register-runtime-stubs.cjs', 'verify-cjs.cjs'],
    consumer,
  );
};

export async function runPackedPackageVerification() {
  checkIosToolchain();
  const cacheRoot = path.join(os.homedir(), '.cache/opencode-tmp/opencode');
  await mkdir(cacheRoot, { recursive: true });
  const temporary = await createOwnedStagingRoot({
    parentRoot: await realpath(cacheRoot),
    prefix: 'native-reader-package-',
    authorityRoots: [workspaceRoot],
  });
  temporaryRoot = temporary.outputRoot;
  let verificationError;
  const finalizationErrors = [];
  try {
    await verifyReaderSupplyChain({ root: workspaceRoot });
    await withWorkspaceSourceInvariant(packageRoot, async () => {
      await verifySourcePackRefusal();
      const staging = await createOwnedStagingRoot({
        parentRoot: temporaryRoot,
        prefix: 'staging-',
        authorityRoots: [workspaceRoot],
      });
      const artifacts = await createOwnedStagingRoot({
        parentRoot: temporaryRoot,
        prefix: 'artifacts-',
        // Creation checks the parent, which necessarily contains the staging
        // sibling. packIsolatedRelease checks the two actual owned roots for
        // overlap before copying or packing; do not mistake their common
        // temporary parent for the artifact output itself.
        authorityRoots: [workspaceRoot],
      });
      const { packed, tarball, tarballSha256 } = await packIsolatedRelease({
        stagingRoot: staging.outputRoot,
        stagingOwnership: staging.ownership,
        packDestination: artifacts.outputRoot,
        packOwnership: artifacts.ownership,
        packageRoot,
        workspaceRoot,
      });
      // consumer 流程唯一允许消费的发布产物。所有安装都只引用这个 tarball 的
      // 本地副本，任何一次摘要不一致都会直接失败。
      const release = { packed, tarball, tarballSha256 };
      await assertReleaseTarballDigest(
        release,
        'before any consumer is created',
      );
      const files = packed.files.map(({ path: file }) => file);
      for (const file of REQUIRED_TARBALL_FILES) {
        if (!files.includes(file))
          throw new Error(`Packed package is missing ${file}`);
      }
      const forbidden = findForbiddenTarballFiles(files);
      if (forbidden.length)
        throw new Error(
          `Packed package contains private files: ${forbidden.join(', ')}`,
        );

      const npmConsumer = await prepareLockedConsumer(release, 'npm');
      await verifyConsumer(npmConsumer, 'npm', true);
      // 两套 React Native 依赖树无需同时驻留；及时释放 npm consumer，避免
      // 受限 CI 临时卷在 pnpm 链接阶段触发 EDQUOT/ENOSPC。
      await rm(npmConsumer, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });

      await assertReleaseTarballDigest(
        release,
        'before the pnpm consumer is created',
      );
      const pnpmConsumer = await prepareLockedConsumer(release, 'pnpm');
      await verifyConsumer(pnpmConsumer, 'pnpm', false);
      // REQUIRE_IOS_CONSUMER=1 的 macOS-only gate 只负责证明 tarball 能在真实
      // Apple 工具链上完成 Codegen/CocoaPods/xcodebuild/test；macOS runner 不提供
      // Android NDK 27.1.12297006，继续调用 verifyAndroidConsumer 会把 runner 缺少
      // NDK 误报为发布物回归。Android consumer 由默认 Linux test:package gate 始终
      // 覆盖（该 gate 不设置 REQUIRE_IOS_CONSUMER），因此这里只在 iOS gate 下跳过。
      if (requireIosTarballConsumer) {
        console.log(
          '[android] skipped: the macOS-only REQUIRE_IOS_CONSUMER=1 gate already verified the iOS tarball consumer; the Android consumer is covered by the default Linux test:package gate',
        );
      } else {
        await verifyAndroidConsumer(release, temporaryRoot);
      }

      console.log(
        `Packed package plus npm/pnpm ESM and CJS consumers verified: ${packed.filename} (${files.length} files).`,
      );
    });
  } catch (error) {
    verificationError = error;
  } finally {
    // 始终只清理本模块创建的唯一临时根。
    if (verificationError) finalizationErrors.push(verificationError);
    try {
      await disposeOwnedStagingRoot(temporary);
    } catch (error) {
      finalizationErrors.push(error);
    }
  }
  if (finalizationErrors.length === 1) throw finalizationErrors[0];
  if (finalizationErrors.length > 1) {
    throw new AggregateError(
      finalizationErrors,
      'Packed package verification and finalization failed',
    );
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));
if (isMain) await runPackedPackageVerification();
