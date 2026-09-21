import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultPackageRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const defaultWorkspaceRoot = path.resolve(defaultPackageRoot, '../..');
const corePackageName = '@epubjs-react-native/core';
const generatedMarker = 'HN_BUNDLED_CORE_GENERATED';

const compiledEntries = (packageRoot) => [
  {
    file: path.join(
      packageRoot,
      'lib/module/NativeReaderImplementation.native.js',
    ),
    external: "from '@epubjs-react-native/core'",
    vendored: "from '../vendor/core/index.js'",
  },
  {
    file: path.join(
      packageRoot,
      'lib/commonjs/NativeReaderImplementation.native.js',
    ),
    external: 'require("@epubjs-react-native/core")',
    vendored: 'require("../vendor/core/index.js")',
  },
];

const pathExists = async (file) => {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

const rewriteEntries = async (packageRoot, useVendoredCore, allowMissing) => {
  for (const entry of compiledEntries(packageRoot)) {
    let source;
    try {
      source = await readFile(entry.file, 'utf8');
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') continue;
      throw error;
    }
    // 异常中断后可能残留任一形式；先归一化，保证 stage/clean 都可重入。
    source = source.replace(entry.vendored, entry.external);
    if (useVendoredCore) {
      if (!source.includes(entry.external)) {
        throw new Error(`Core import was not found in ${entry.file}`);
      }
      source = source.replace(entry.external, entry.vendored);
    }
    await writeFile(entry.file, source);
  }
};

const verifyOwnedStaging = async (destination) => {
  if (!(await pathExists(destination))) return;
  if (await pathExists(path.join(destination, generatedMarker))) return;

  // cleanBuild/postpack can leave the parent directory structure behind after
  // removing every generated file. An empty directory has no unowned payload
  // to protect and is safe to remove during the next idempotent prepack.
  if ((await readdir(destination)).length === 0) return;

  // 兼容本 lane 引入 marker 前可能由已成功 prepack 遗留的 owned tree。
  try {
    const manifest = JSON.parse(
      await readFile(path.join(destination, 'package.json'), 'utf8'),
    );
    if (
      manifest.name === corePackageName &&
      manifest.version === '1.4.5' &&
      manifest.private === true &&
      manifest.type === 'commonjs'
    ) {
      return;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  throw new Error(`Refusing to remove unowned bundled core: ${destination}`);
};

const removeStaging = async (packageRoot) => {
  const destination = path.join(packageRoot, 'lib/vendor/core');
  await verifyOwnedStaging(destination);
  await rm(destination, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
};

const workspaceCoreDescriptor = async (workspaceRoot) => {
  const workspaceManifest = JSON.parse(
    await readFile(path.join(workspaceRoot, 'package.json'), 'utf8'),
  );
  const descriptor = workspaceManifest.resolutions?.[corePackageName];
  if (typeof descriptor !== 'string' || !descriptor.startsWith('patch:')) {
    throw new Error(
      'Workspace core resolution is missing its patch descriptor',
    );
  }
  return descriptor;
};

const rewritePackageManifest = async (
  packageRoot,
  workspaceRoot,
  restoreBuildDependency,
) => {
  const packageManifestPath = path.join(packageRoot, 'package.json');
  const manifest = JSON.parse(await readFile(packageManifestPath, 'utf8'));
  const descriptor = await workspaceCoreDescriptor(workspaceRoot);

  if (restoreBuildDependency) {
    const otherDevDependencies = Object.fromEntries(
      Object.entries(manifest.devDependencies ?? {}).filter(
        ([name]) => name !== corePackageName,
      ),
    );
    manifest.devDependencies = {
      [corePackageName]: descriptor,
      ...otherDevDependencies,
    };
  } else {
    if (manifest.dependencies?.[corePackageName]) {
      throw new Error('Bundled core must not remain a runtime dependency');
    }
    const current = manifest.devDependencies?.[corePackageName];
    if (current !== undefined && current !== descriptor) {
      throw new Error(
        'Build-only core dependency has an unexpected descriptor',
      );
    }
    // npm 会把 devDependencies 保留在发布 manifest 中；删除 build-only locator，
    // 避免 tarball 泄露仓库私有的 .yarn/patches 路径。
    delete manifest.devDependencies?.[corePackageName];
  }

  await writeFile(
    packageManifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
};

const requireMarkers = (source, file, markers) => {
  const missing = markers.filter((marker) => !source.includes(marker));
  if (missing.length > 0) {
    throw new Error(
      `Refusing to vendor an unpatched core: ${file} is missing ${missing.join(', ')}`,
    );
  }
};

const bridgeProtocolMarkers = [
  "type: 'publicationPrepared'",
  'packagePath: packagePath',
  'navigationPath: navigationPath',
  'archiveKey: archiveKey',
  'targetEngineIndex: target.engineIndex',
  'engineIndex: engineIndex',
  'iBooksDisplayOptions: await readIBooksDisplayOptions()',
  'mediaOverlayItemIds: manifestEntries',
  'encryption: await readEncryptionProfile()',
  "type: 'publicationError'",
  "type: 'publicationLocation'",
  'return displayed;',
];

const throwCleanupFailures = (results, message) => {
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0) throw new AggregateError(failures, message);
};

export async function cleanBundledCore({
  packageRoot = defaultPackageRoot,
  workspaceRoot = defaultWorkspaceRoot,
} = {}) {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => rewriteEntries(packageRoot, false, true)),
    Promise.resolve().then(() =>
      rewritePackageManifest(packageRoot, workspaceRoot, true),
    ),
    Promise.resolve().then(() => removeStaging(packageRoot)),
  ]);
  throwCleanupFailures(results, 'Bundled core cleanup was incomplete');
}

export function resolveBundledCoreInput(workspaceRoot = defaultWorkspaceRoot) {
  const workspaceRequire = createRequire(
    path.join(workspaceRoot, 'package.json'),
  );
  return path.dirname(
    workspaceRequire.resolve(`${corePackageName}/package.json`),
  );
}

export async function stageBundledCore({
  packageRoot = defaultPackageRoot,
  workspaceRoot = defaultWorkspaceRoot,
  sourceRoot = resolveBundledCoreInput(workspaceRoot),
} = {}) {
  // stage 本身也可重入，供 CLI 和上次 postpack 未执行后的恢复使用。
  await cleanBundledCore({ packageRoot, workspaceRoot });

  const source = path.join(sourceRoot, 'lib/commonjs');
  const sourceManifest = JSON.parse(
    await readFile(path.join(sourceRoot, 'package.json'), 'utf8'),
  );
  const sourceReader = await readFile(path.join(source, 'Reader.js'), 'utf8');
  const sourceView = await readFile(path.join(source, 'View.js'), 'utf8');
  const sourceTemplate = await readFile(
    path.join(source, 'template.js'),
    'utf8',
  );

  if (
    sourceManifest.name !== corePackageName ||
    sourceManifest.version !== '1.4.5' ||
    sourceManifest.license !== 'MIT'
  ) {
    throw new Error(
      `Refusing to vendor an unexpected ${corePackageName} package`,
    );
  }
  requireMarkers(sourceReader, 'Reader.js', [
    'setAllowedUris(documentDirectory)',
  ]);
  requireMarkers(sourceView, 'View.js', [
    'allowedUris.replace',
    "originWhitelist: ['*']",
    'allowUniversalAccessFromFileURLs: false',
  ]);
  requireMarkers(sourceTemplate, 'template.js', bridgeProtocolMarkers);

  const destination = path.join(packageRoot, 'lib/vendor/core');
  await mkdir(destination, { recursive: true });
  // Claim the staging directory before the first copy so interrupted staging
  // remains safely recoverable by the next prepack.
  await writeFile(
    path.join(destination, generatedMarker),
    'stage-bundled-core.mjs\n',
  );
  await cp(source, destination, { recursive: true });
  await cp(path.join(sourceRoot, 'LICENSE'), path.join(destination, 'LICENSE'));
  await writeFile(
    path.join(destination, 'package.json'),
    `${JSON.stringify({
      name: sourceManifest.name,
      version: sourceManifest.version,
      license: sourceManifest.license,
      private: true,
      type: 'commonjs',
    })}\n`,
  );
  await rewriteEntries(packageRoot, true, false);
  await rewritePackageManifest(packageRoot, workspaceRoot, false);
  // Marker only protects interrupted staging; successful release artifacts use
  // the exact vendored core tree and package metadata as their ownership proof.
  await rm(path.join(destination, generatedMarker), { force: true });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  if (process.argv.includes('--clean')) await cleanBundledCore();
  else await stageBundledCore();
}
