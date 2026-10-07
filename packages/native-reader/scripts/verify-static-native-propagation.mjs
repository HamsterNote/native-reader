import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const PACKAGE_NAME = '@hamster-note/native-reader';
const CORE_PACKAGE_NAME = '@epubjs-react-native/core';
const OFFICIAL_WEBVIEW_PACKAGE_NAME = 'react-native-webview';
const INTEGRITY_MANIFEST = 'SECURE_WEBVIEW_SHA256.json';
// This copy is intentionally local: the packed package excludes the staging
// script, so tarball verification must carry an independent fixed expectation.
const SECURE_WEBVIEW_INTEGRITY_FILES = [
  'HNSecureWebView.podspec',
  'android/fault-matrix/HNSecureWebViewClientFaultMatrixTest.java',
  'android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebChromeClient.java',
  'android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebView.java',
  'android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebViewClient.java',
  'android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebViewManagerImpl.kt',
  'android/src/newarch/com/hamsternote/nativereader/securewebview/HNSecureWebViewManager.java',
  'android/src/oldarch/com/hamsternote/nativereader/securewebview/HNSecureWebViewManager.java',
  'apple-fault-matrix/HNSecureWebViewDecisionManagerTests.m',
  'apple/HNSecureFoliateHostRelay.h',
  'apple/HNSecureFoliateHostRelay.m',
  'apple/HNSecureWebViewImpl.m',
  'apple/HNSecureWebViewManager.mm',
  'apple/HNSecureWebViewReadAccessPolicy.h',
  'apple/HNSecureWebViewReadAccessPolicy.m',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/manifest.json',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/bootstrap.js',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/reader.html',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/probes/csp-1x1.png',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/probes/csp-external-canary.js',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/notices/fflate-MIT.txt',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/notices/zip.js-BSD-3-Clause.txt',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/foliate/LICENSE',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/foliate/comic-book.js',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/foliate/epub.js',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/foliate/epubcfi.js',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/foliate/fb2.js',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/foliate/fixed-layout.js',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/foliate/mobi.js',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/foliate/overlayer.js',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/foliate/paginator.js',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/foliate/progress.js',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/foliate/vendor/fflate.js',
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/foliate/vendor/zip.js',
  'secure-webview/foliate-host-wire-corpus.v1.json',
].sort();
const CORE_ADAPTERS = [
  'lib/vendor/core/View.android.js',
  'lib/vendor/core/View.ios.js',
];
// This expected set is intentionally independent from the integrity manifest:
// a modified manifest must not be able to conceal a missing upstream module.
const VENDORED_CORE_COMMONJS_FILES = [
  'types.js',
  'index.js',
  'hooks/useInjectWebviewVariables.js',
  'hooks/useReader.js',
  'utils/getPathname.js',
  'utils/getSourceType.js',
  'utils/internalEvents.util.js',
  'utils/isURL.js',
  'utils/OpeningBook/index.js',
  'utils/OpeningBook/styles.js',
  'utils/isFsUri.js',
  'utils/GestureHandler.js',
  'utils/themes/dark.js',
  'utils/themes/index.js',
  'utils/themes/light.js',
  'utils/themes/sepia.js',
  'utils/webViewInjectFunctions.js',
  'template.js',
  'Reader.js',
  'epubjs.js',
  'context.js',
  'View.js',
  'jszip.js',
  'utils/LoadingFile/index.js',
  'utils/LoadingFile/styles.js',
  'utils/enums/source-type.enum.js',
].map((file) => `lib/vendor/core/${file}`);
const JAVA_PACKAGE = 'com.hamsternote.nativereader.securewebview';
const JAVA_ROOT = `android/src/main/java/${JAVA_PACKAGE.replaceAll('.', '/')}`;
const APPLE_ROOT = 'apple';
const FOLIATE_RUNTIME_ROOT = 'foliate-runtime';
const FOLIATE_RUNTIME_MANIFEST = `${FOLIATE_RUNTIME_ROOT}/manifest.json`;
const FOLIATE_WEB_RUNTIME_ROOT = `${FOLIATE_RUNTIME_ROOT}/web`;
const FOLIATE_WEB_RUNTIME_MANIFEST = `${FOLIATE_WEB_RUNTIME_ROOT}/manifest.json`;
const FOLIATE_NATIVE_RUNTIME_ROOT = `${FOLIATE_RUNTIME_ROOT}/native`;
const FOLIATE_NATIVE_RUNTIME_MANIFEST = `${FOLIATE_NATIVE_RUNTIME_ROOT}/manifest.json`;
const FOLIATE_WEB_SYNC_SCRIPT = 'scripts/sync-foliate-web-runtime.mjs';
const FOLIATE_WEB_RUNTIME_VERSION = 'foliate-web-1';
const FOLIATE_NATIVE_HOST_VERSION = 'foliate-native-host-1';
const FOLIATE_SOURCE = {
  commit: '78914aef4466eb960965702401634c2cb348e9b1',
  repository: 'https://github.com/johnfactotum/foliate-js.git',
};
const NATIVE_CSP_PROBE_ASSETS = new Map([
  [
    'probes/csp-1x1.png',
    {
      sha256:
        '74ea8cc007d1134250692981ea7b50b7979ac712c7e95309dcf606d6f97e4e8b',
      size: 70,
      source: 'generated:foliate-native-csp-probe-png-v1',
      category: 'csp-probe-image',
      license: 'CC0-1.0',
      mimeType: 'image/png',
    },
  ],
  [
    'probes/csp-external-canary.js',
    {
      sha256:
        '77311ffaf0cb6748785d6259257acb11c745a63d478132866413ad32ca6fd09a',
      size: 286,
      source: 'generated:foliate-native-csp-probe-external-canary-v1',
      category: 'csp-probe-script',
      license: 'MIT',
      mimeType: 'text/javascript; charset=utf-8',
    },
  ],
]);
const REQUIRED_FOLIATE_RUNTIME_FILES = [
  'LICENSE',
  'LICENSES/fflate-MIT.txt',
  'LICENSES/zip.js-BSD-3-Clause.txt',
  'comic-book.js',
  'epub.js',
  'epubcfi.js',
  'fb2.js',
  'fixed-layout.js',
  'mobi.js',
  'overlayer.js',
  'paginator.js',
  'progress.js',
  'package.json',
  'vendor/fflate.js',
  'vendor/zip.js',
  'view.js',
].map((file) => `${FOLIATE_RUNTIME_ROOT}/${file}`);
const REQUIRED_FOLIATE_WEB_RUNTIME_FILES = [
  'bootstrap.js',
  'reader.html',
  'probes/csp-1x1.png',
  'probes/csp-external-canary.js',
  'notices/fflate-MIT.txt',
  'notices/zip.js-BSD-3-Clause.txt',
  'foliate/LICENSE',
  'foliate/comic-book.js',
  'foliate/epub.js',
  'foliate/epubcfi.js',
  'foliate/fb2.js',
  'foliate/fixed-layout.js',
  'foliate/mobi.js',
  'foliate/overlayer.js',
  'foliate/paginator.js',
  'foliate/progress.js',
  'foliate/vendor/fflate.js',
  'foliate/vendor/zip.js',
  'foliate/view.js',
].map((file) => `${FOLIATE_WEB_RUNTIME_ROOT}/${file}`);
const REQUIRED_FOLIATE_NATIVE_RUNTIME_FILES = [
  'bootstrap.js',
  'reader.html',
  'probes/csp-1x1.png',
  'probes/csp-external-canary.js',
  'notices/fflate-MIT.txt',
  'notices/zip.js-BSD-3-Clause.txt',
  'foliate/LICENSE',
  'foliate/comic-book.js',
  'foliate/epub.js',
  'foliate/epubcfi.js',
  'foliate/fb2.js',
  'foliate/fixed-layout.js',
  'foliate/mobi.js',
  'foliate/overlayer.js',
  'foliate/paginator.js',
  'foliate/progress.js',
  'foliate/vendor/fflate.js',
  'foliate/vendor/zip.js',
  'foliate/view.js',
].map((file) => `${FOLIATE_NATIVE_RUNTIME_ROOT}/${file}`);
const codepointCompare = (left, right) => {
  const leftPoints = [...left];
  const rightPoints = [...right];
  for (
    let index = 0;
    index < Math.min(leftPoints.length, rightPoints.length);
    index += 1
  ) {
    const difference =
      leftPoints[index].codePointAt(0) - rightPoints[index].codePointAt(0);
    if (difference) return difference;
  }
  return leftPoints.length - rightPoints.length;
};

const EXPECTED_ABI = {
  moduleName: 'HNSecureWebViewModule',
  componentName: 'HNSecureWebView',
  callableModuleName: 'HNSecureWebViewMessagingModule',
  codegenLibraryName: 'HNSecureWebViewSpec',
  reactPackageName: 'HNSecureWebViewPackage',
  fileProviderName: 'HNSecureWebViewFileProvider',
  implementationId: JAVA_PACKAGE,
  implementationVersion: '13.16.1-hamsternote.1',
  protocolMajor: 1,
  platform: 'android',
  capabilities: [
    'navigation-decision-fail-closed-v1',
    'main-frame-native-gate-v1',
    'subframe-local-root-deny-v1',
    'late-callback-safe-v1',
    'native-foliate-host-v1',
  ],
};

const EXPECTED_CODEGEN_CONFIG = {
  name: EXPECTED_ABI.codegenLibraryName,
  type: 'all',
  jsSrcsDir: './secure-webview/src',
  android: { javaPackageName: JAVA_PACKAGE },
  ios: {
    componentProvider: { HNSecureWebView: 'HNSecureWebView' },
    modulesProvider: { HNSecureWebViewModule: 'HNSecureWebViewModule' },
  },
};

const RELEASE_INTEGRITY_COMPILED_FILES = [
  'lib/commonjs/index.native.js',
  'lib/commonjs/NativeReader.native.js',
  'lib/commonjs/nativeCapability.js',
  'lib/commonjs/NativeReaderImplementation.native.js',
  'lib/module/index.native.js',
  'lib/module/NativeReader.native.js',
  'lib/module/nativeCapability.js',
  'lib/module/NativeReaderImplementation.native.js',
].sort();

export const REQUIRED_TARBALL_FILES = [
  'package.json',
  'THIRD_PARTY_NOTICES.md',
  INTEGRITY_MANIFEST,
  'android/build.gradle',
  'android/gradle.properties',
  'android/src/main/AndroidManifest.xml',
  'android/src/main/AndroidManifestNew.xml',
  `${APPLE_ROOT}/HN_SECURE_WEBVIEW_GENERATED`,
  `${APPLE_ROOT}/HNSecureWebView.h`,
  `${APPLE_ROOT}/HNSecureWebView.mm`,
  `${APPLE_ROOT}/HNSecureWebViewDecisionManager.h`,
  `${APPLE_ROOT}/HNSecureWebViewDecisionManager.m`,
  `${APPLE_ROOT}/HNSecureWebViewImpl.h`,
  `${APPLE_ROOT}/HNSecureWebViewImpl.m`,
  `${APPLE_ROOT}/HNSecureWebViewManager.h`,
  `${APPLE_ROOT}/HNSecureWebViewManager.mm`,
  `${APPLE_ROOT}/HNSecureWebViewModule.h`,
  `${APPLE_ROOT}/HNSecureWebViewModule.mm`,
  `${APPLE_ROOT}/HNSecureWKProcessPoolManager.h`,
  `${APPLE_ROOT}/HNSecureWKProcessPoolManager.m`,
  `${APPLE_ROOT}/RCTConvert+WKDataDetectorTypes.h`,
  `${APPLE_ROOT}/RCTConvert+WKDataDetectorTypes.m`,
  `${APPLE_ROOT}/HNSecureFoliateHostRelay.h`,
  `${APPLE_ROOT}/HNSecureFoliateHostRelay.m`,
  `${APPLE_ROOT}/HNSecureWebViewReadAccessPolicy.h`,
  `${APPLE_ROOT}/HNSecureWebViewReadAccessPolicy.m`,
  `${APPLE_ROOT}/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/bootstrap.js`,
  'secure-webview/foliate-host-wire-corpus.v1.json',
  'apple-fault-matrix/HNSecureWebViewDecisionManagerTests.m',
  'HNSecureWebView.podspec',
  'react-native.config.js',
  `${JAVA_ROOT}/HNSecureWebView.java`,
  `${JAVA_ROOT}/HNSecureWebViewFileProvider.java`,
  `${JAVA_ROOT}/HNSecureWebViewManagerImpl.kt`,
  `${JAVA_ROOT}/HNSecureWebViewMessagingModule.kt`,
  `${JAVA_ROOT}/HNSecureWebViewModuleImpl.java`,
  `${JAVA_ROOT}/HNSecureWebViewPackage.java`,
  'android/src/main/res/xml/hn_secure_webview_file_provider_paths.xml',
  'android/src/newarch/com/hamsternote/nativereader/securewebview/HNSecureWebViewManager.java',
  'android/src/newarch/com/hamsternote/nativereader/securewebview/HNSecureWebViewModule.java',
  'android/src/oldarch/com/hamsternote/nativereader/securewebview/HNSecureWebViewManager.java',
  'android/src/oldarch/com/hamsternote/nativereader/securewebview/HNSecureWebViewModule.java',
  'android/fault-matrix/HNSecureWebViewClientFaultMatrixTest.java',
  'secure-webview/LICENSE',
  'secure-webview/package.json',
  'secure-webview/src/HNSecureWebView.android.tsx',
  'secure-webview/src/HNSecureWebView.ios.tsx',
  'secure-webview/src/HNSecureWebViewNativeComponent.ts',
  'secure-webview/src/HNSecureWebViewTypes.ts',
  'secure-webview/src/NativeHNSecureWebViewModule.ts',
  'lib/commonjs/index.js',
  'lib/commonjs/index.native.js',
  'lib/commonjs/NativeReader.native.js',
  'lib/commonjs/NativeReaderImplementation.native.js',
  'lib/commonjs/nativeCapability.js',
  'lib/module/index.js',
  'lib/module/index.web.js',
  'lib/module/index.native.js',
  'lib/module/NativeReader.native.js',
  'lib/module/NativeReaderImplementation.native.js',
  'lib/module/nativeCapability.js',
  'lib/typescript/commonjs/src/index.d.ts',
  'lib/typescript/module/src/index.d.ts',
  'lib/vendor/core/LICENSE',
  ...VENDORED_CORE_COMMONJS_FILES,
  ...CORE_ADAPTERS,
  'lib/vendor/core/package.json',
  FOLIATE_RUNTIME_MANIFEST,
  FOLIATE_WEB_RUNTIME_MANIFEST,
  FOLIATE_NATIVE_RUNTIME_MANIFEST,
  FOLIATE_WEB_SYNC_SCRIPT,
  ...REQUIRED_FOLIATE_RUNTIME_FILES,
  ...REQUIRED_FOLIATE_WEB_RUNTIME_FILES,
  ...REQUIRED_FOLIATE_NATIVE_RUNTIME_FILES,
].sort(codepointCompare);

const read = (root, relativePath) =>
  readFile(path.join(root, relativePath), 'utf8');

const requireMarkers = (source, file, markers) => {
  const missing = markers.filter((marker) => !source.includes(marker));
  if (missing.length > 0) {
    throw new Error(
      `${file} is missing required markers: ${missing.join(', ')}`,
    );
  }
};

const requireExact = (actual, expected, description) => {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      `${description} does not match the release contract: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    );
  }
};

const requirePath = async (root, relativePath, type) => {
  let entry;
  try {
    entry = await stat(path.join(root, relativePath));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `Required tarball expected-set file is missing: ${relativePath}`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
  if (type === 'file' ? !entry.isFile() : !entry.isDirectory()) {
    throw new Error(`Installed package ${relativePath} is not a ${type}`);
  }
};

const listFiles = async (root, prefix = '') => {
  const entries = await readdir(path.join(root, prefix), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    codepointCompare(left.name, right.name),
  )) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(
        `Installed private native tree contains a non-file entry: ${relativePath}`,
      );
    }
  }
  return files;
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const verifyPublishedManifest = async (packageRoot) => {
  const manifestText = await read(packageRoot, 'package.json');
  const manifest = JSON.parse(manifestText);

  if (manifest.name !== PACKAGE_NAME) {
    throw new Error(
      `Installed package has an unexpected name: ${manifest.name}`,
    );
  }
  if (manifest.private !== undefined && manifest.private !== false) {
    throw new Error('Published manifest must not be private');
  }
  if (manifest.dependencies?.[CORE_PACKAGE_NAME]) {
    throw new Error(`Published manifest must not resolve ${CORE_PACKAGE_NAME}`);
  }
  if (manifest.bundledDependencies || manifest.bundleDependencies) {
    throw new Error(
      'Published manifest must not rely on package-manager-specific bundled dependencies',
    );
  }
  if (/patch:|patches[\\/]|(?:^|["':])file:|workspace:/i.test(manifestText)) {
    throw new Error('Published manifest contains a repository-private locator');
  }
  if (
    manifest.scripts?.prepack ||
    manifest.scripts?.postpack ||
    manifest.scripts?.['pack:release']
  ) {
    throw new Error('Published manifest contains source-only release scripts');
  }
  const absoluteValue = Object.values(manifest)
    .flatMap(function collect(value) {
      if (typeof value === 'string') return [value];
      if (Array.isArray(value)) return value.flatMap(collect);
      if (value && typeof value === 'object') {
        return Object.values(value).flatMap(collect);
      }
      return [];
    })
    .find(
      (value) => path.posix.isAbsolute(value) || path.win32.isAbsolute(value),
    );
  if (absoluteValue) {
    throw new Error(
      `Published manifest contains an absolute workspace path: ${absoluteValue}`,
    );
  }
  if (
    manifest['react-native'] !== './lib/commonjs/index.native.js' ||
    manifest.browser !== './lib/module/index.web.js'
  ) {
    throw new Error('Published platform entries must use built artifacts');
  }
  requireExact(
    manifest.codegenConfig,
    EXPECTED_CODEGEN_CONFIG,
    'Published codegenConfig',
  );
  if (manifest.dependencies?.[OFFICIAL_WEBVIEW_PACKAGE_NAME] !== '13.16.1') {
    throw new Error(
      'Published manifest must depend on react-native-webview@13.16.1',
    );
  }
  return manifest;
};

const verifyFoliateRuntime = async (packageRoot) => {
  const manifest = JSON.parse(
    await read(packageRoot, FOLIATE_RUNTIME_MANIFEST),
  );
  requireExact(
    manifest.source,
    {
      commit: '78914aef4466eb960965702401634c2cb348e9b1',
      repository: 'https://github.com/johnfactotum/foliate-js.git',
    },
    'Foliate runtime source metadata',
  );
  if (!Array.isArray(manifest.assets)) {
    throw new Error('Foliate runtime manifest has no assets array');
  }
  const stagedFiles = manifest.assets
    .map((asset) => asset.path)
    .sort(codepointCompare);
  const expectedFiles = REQUIRED_FOLIATE_RUNTIME_FILES.map((file) =>
    file.replace(`${FOLIATE_RUNTIME_ROOT}/`, ''),
  ).sort(codepointCompare);
  requireExact(stagedFiles, expectedFiles, 'Foliate runtime asset set');
  for (const asset of manifest.assets) {
    if (
      !/^[a-f0-9]{64}$/.test(asset.sourceSha256) ||
      !/^[a-f0-9]{64}$/.test(asset.stagedSha256) ||
      !Number.isInteger(asset.sourceSize) ||
      !Number.isInteger(asset.stagedSize) ||
      typeof asset.category !== 'string' ||
      typeof asset.license !== 'string'
    ) {
      throw new Error(
        `Foliate runtime manifest has invalid metadata: ${asset.path}`,
      );
    }
    const contents = await readFile(
      path.join(packageRoot, FOLIATE_RUNTIME_ROOT, asset.path),
    );
    if (
      sha256(contents) !== asset.stagedSha256 ||
      contents.length !== asset.stagedSize
    ) {
      throw new Error(
        `Foliate runtime asset does not match manifest: ${asset.path}`,
      );
    }
  }
  const runtimeFiles = (
    await listFiles(path.join(packageRoot, FOLIATE_RUNTIME_ROOT))
  ).filter((file) => !file.startsWith('web/') && !file.startsWith('native/'));
  requireExact(
    runtimeFiles,
    [
      FOLIATE_RUNTIME_MANIFEST.replace(`${FOLIATE_RUNTIME_ROOT}/`, ''),
      ...expectedFiles,
    ].sort(codepointCompare),
    'Foliate runtime packaged file set',
  );
  const view = await read(packageRoot, `${FOLIATE_RUNTIME_ROOT}/view.js`);
  if (view.includes("import('./pdf.js')") || view.includes('isPDF')) {
    throw new Error('Foliate runtime view retains the excluded PDF adapter');
  }
  for (const forbidden of [
    "import('./search.js')",
    "import('./tts.js')",
    'textWalker',
    '#searchResults',
    'initTTS',
  ]) {
    if (view.includes(forbidden)) {
      throw new Error(
        `Foliate runtime view retains out-of-scope feature ${forbidden}`,
      );
    }
  }
  requireMarkers(
    await read(
      packageRoot,
      `${FOLIATE_RUNTIME_ROOT}/LICENSES/zip.js-BSD-3-Clause.txt`,
    ),
    'Foliate zip.js license',
    ['BSD 3-Clause License', 'Copyright (c) 2023, Gildas Lormeau'],
  );
  requireMarkers(
    await read(packageRoot, `${FOLIATE_RUNTIME_ROOT}/LICENSES/fflate-MIT.txt`),
    'Foliate fflate license',
    ['MIT License', 'Copyright (c) 2023 Arjun Barrett'],
  );
};

const validateWebAssetPath = (relativePath) => {
  if (
    typeof relativePath !== 'string' ||
    !relativePath ||
    relativePath === 'manifest.json' ||
    relativePath.includes('\\') ||
    relativePath.normalize('NFC') !== relativePath ||
    /^[A-Za-z]:/.test(relativePath) ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(
      `Foliate Web runtime manifest has an unsafe asset path: ${relativePath}`,
    );
  }
};

const requireRegularRuntimeFile = async (packageRoot, relativePath) => {
  const absolutePath = path.join(packageRoot, relativePath);
  let entry;
  try {
    entry = await lstat(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `Foliate runtime manifest asset is missing: ${relativePath}`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(
      `Foliate Web runtime asset must be a regular file: ${relativePath}`,
    );
  }
  return absolutePath;
};

const verifyFoliateWebRuntime = async (packageRoot) => {
  const manifest = JSON.parse(
    await read(packageRoot, FOLIATE_WEB_RUNTIME_MANIFEST),
  );
  requireExact(
    {
      schemaVersion: manifest.schemaVersion,
      runtime: manifest.runtime,
      runtimeVersion: manifest.runtimeVersion,
      source: manifest.source,
    },
    {
      schemaVersion: 1,
      runtime: 'foliate-web',
      runtimeVersion: FOLIATE_WEB_RUNTIME_VERSION,
      source: FOLIATE_SOURCE,
    },
    'Foliate Web runtime manifest identity',
  );
  if (!Array.isArray(manifest.assets)) {
    throw new Error('Foliate Web runtime manifest has no assets array');
  }
  const assetPaths = manifest.assets.map((asset) => asset.path);
  requireExact(
    assetPaths,
    [...assetPaths].sort(codepointCompare),
    'Foliate Web runtime manifest asset order',
  );
  const expectedPaths = REQUIRED_FOLIATE_WEB_RUNTIME_FILES.map((file) =>
    file.replace(`${FOLIATE_WEB_RUNTIME_ROOT}/`, ''),
  ).sort(codepointCompare);
  requireExact(assetPaths, expectedPaths, 'Foliate Web runtime asset set');
  for (const asset of manifest.assets) {
    validateWebAssetPath(asset.path);
    if (
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 0 ||
      typeof asset.source !== 'string' ||
      !asset.source
    ) {
      throw new Error(
        `Foliate Web runtime manifest has invalid metadata: ${asset.path}`,
      );
    }
    const contents = await readFile(
      await requireRegularRuntimeFile(
        packageRoot,
        `${FOLIATE_WEB_RUNTIME_ROOT}/${asset.path}`,
      ),
    );
    if (sha256(contents) !== asset.sha256 || contents.length !== asset.size) {
      throw new Error(
        `Foliate Web runtime asset does not match manifest: ${asset.path}`,
      );
    }
  }
  const packagedFiles = await listFiles(
    path.join(packageRoot, FOLIATE_WEB_RUNTIME_ROOT),
  );
  requireExact(
    packagedFiles,
    ['manifest.json', ...expectedPaths].sort(codepointCompare),
    'Foliate Web runtime packaged file set',
  );
};

export const verifyFoliateNativeRuntime = async (packageRoot) => {
  const manifest = JSON.parse(
    await read(packageRoot, FOLIATE_NATIVE_RUNTIME_MANIFEST),
  );
  requireExact(
    {
      schemaVersion: manifest.schemaVersion,
      runtime: manifest.runtime,
      hostVersion: manifest.hostVersion,
      targetPlatforms: manifest.targetPlatforms,
      source: manifest.source,
    },
    {
      schemaVersion: 1,
      runtime: 'foliate-native-host',
      hostVersion: FOLIATE_NATIVE_HOST_VERSION,
      targetPlatforms: ['android', 'ios'],
      source: FOLIATE_SOURCE,
    },
    'Foliate native runtime manifest identity',
  );
  if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.notices)) {
    throw new Error('Foliate native runtime manifest has no assets or notices');
  }
  requireExact(
    manifest.notices,
    [
      { path: 'foliate/LICENSE', license: 'MIT', appliesTo: 'foliate/**' },
      {
        path: 'notices/fflate-MIT.txt',
        license: 'MIT',
        appliesTo: 'foliate/vendor/fflate.js',
      },
      {
        path: 'notices/zip.js-BSD-3-Clause.txt',
        license: 'BSD-3-Clause',
        appliesTo: 'foliate/vendor/zip.js',
      },
    ],
    'Foliate native runtime license notice associations',
  );
  const assetPaths = manifest.assets.map((asset) => asset.path);
  requireExact(
    assetPaths,
    [...assetPaths].sort(codepointCompare),
    'Foliate native runtime manifest asset order',
  );
  const expectedPaths = REQUIRED_FOLIATE_NATIVE_RUNTIME_FILES.map((file) =>
    file.replace(`${FOLIATE_NATIVE_RUNTIME_ROOT}/`, ''),
  ).sort(codepointCompare);
  requireExact(assetPaths, expectedPaths, 'Foliate native runtime asset set');
  for (const asset of manifest.assets) {
    validateWebAssetPath(asset.path);
    if (
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 0 ||
      typeof asset.source !== 'string' ||
      !asset.source ||
      typeof asset.category !== 'string' ||
      typeof asset.license !== 'string' ||
      !/^(?:[\w.+/-]+; charset=utf-8|image\/png)$/.test(asset.mimeType)
    ) {
      throw new Error(
        `Foliate native runtime manifest has invalid metadata: ${asset.path}`,
      );
    }
    const expectedProbe = NATIVE_CSP_PROBE_ASSETS.get(asset.path);
    if (
      expectedProbe &&
      Object.entries(expectedProbe).some(([key, value]) => asset[key] !== value)
    ) {
      throw new Error(
        `Foliate native runtime has invalid CSP probe metadata: ${asset.path}`,
      );
    }
    const contents = await readFile(
      await requireRegularRuntimeFile(
        packageRoot,
        `${FOLIATE_NATIVE_RUNTIME_ROOT}/${asset.path}`,
      ),
    );
    if (sha256(contents) !== asset.sha256 || contents.length !== asset.size) {
      throw new Error(
        `Foliate native runtime asset does not match manifest: ${asset.path}`,
      );
    }
  }
  const packagedFiles = await listFiles(
    path.join(packageRoot, FOLIATE_NATIVE_RUNTIME_ROOT),
  );
  requireExact(
    packagedFiles,
    ['manifest.json', ...expectedPaths].sort(codepointCompare),
    'Foliate native runtime packaged file set',
  );
  const reader = await read(
    packageRoot,
    `${FOLIATE_NATIVE_RUNTIME_ROOT}/reader.html`,
  );
  const cspOffset = reader.indexOf('http-equiv="Content-Security-Policy"');
  const bootstrapOffset = reader.indexOf(
    '<script type="module" src="./bootstrap.js"></script>',
  );
  if (cspOffset < 0 || bootstrapOffset < 0 || cspOffset > bootstrapOffset) {
    throw new Error(
      'Foliate native reader.html must declare host CSP before bootstrap',
    );
  }
  requireMarkers(reader, 'Foliate native reader.html', [
    `hn-foliate-native-host-version" content="${FOLIATE_NATIVE_HOST_VERSION}`,
    '4B host document exposes no page-world publication capability',
  ]);
  const bootstrap = await read(
    packageRoot,
    `${FOLIATE_NATIVE_RUNTIME_ROOT}/bootstrap.js`,
  );
  if (
    !new RegExp(
      `^const FOLIATE_NATIVE_HOST_VERSION = ${JSON.stringify(FOLIATE_NATIVE_HOST_VERSION)};$`,
      'm',
    ).test(bootstrap) ||
    !/^const FOLIATE_HOST_PROTOCOL = 'hn-foliate-host';$/m.test(bootstrap) ||
    !/^const FOLIATE_HOST_PROTOCOL_VERSION = 1;$/m.test(bootstrap) ||
    !/^export function installFoliateNativeHostBridge\(port\) \{$/m.test(
      bootstrap,
    ) ||
    [...bootstrap.matchAll(/^export\s+/gm)].length !== 1
  ) {
    throw new Error(
      'Foliate native bootstrap does not expose exactly one host-only private bridge entry with the required protocol identity',
    );
  }
  for (const [description, pattern] of [
    [
      'Foliate module import',
      /(?:import\s*(?:[^'"()]+?\s+from\s*)?|import\()['"][^'"]*foliate\//,
    ],
    [
      'publication or source capability',
      /\b(?:publication|source|transfer|uri|base64|bytes|chunk)\b/i,
    ],
    ['publication open capability', /\bopen\s*\(/i],
    [
      'page-world global bridge',
      /\b(?:ReactNativeWebView|window|webkit|messageHandlers|parent|globalThis|self)\s*(?:\.|\[)/,
    ],
    [
      'public message listener',
      /\b(?:window|globalThis)\.addEventListener\s*\(\s*['"]message['"]/,
    ],
    ['Android JavaScript interface', /\baddJavascriptInterface\b/],
  ]) {
    if (pattern.test(bootstrap)) {
      throw new Error(
        `Foliate native bootstrap contains out-of-scope behavior: ${description}`,
      );
    }
  }
  for (const asset of manifest.assets) {
    if (
      /(^|\/)(pdf\.js|pdfjs|cmaps|standard_fonts|search\.js|tts\.js|text-walker\.js)(\/|$)/i.test(
        asset.path,
      )
    ) {
      throw new Error(
        `Foliate native runtime includes an excluded asset: ${asset.path}`,
      );
    }
  }
  const assetSet = new Set(assetPaths);
  const visited = new Set();
  const visit = async (relativePath) => {
    if (visited.has(relativePath)) return;
    visited.add(relativePath);
    if (!assetSet.has(relativePath)) {
      throw new Error(
        `Foliate native module closure is missing manifest asset: ${relativePath}`,
      );
    }
    const source = await read(
      packageRoot,
      `${FOLIATE_NATIVE_RUNTIME_ROOT}/${relativePath}`,
    );
    for (const match of source.matchAll(
      /(?:import\s*(?:[^'"()]+?\s+from\s*)?|import\()['"](\.[^'"]+)['"]/g,
    )) {
      const imported = path.posix.normalize(
        path.posix.join(path.posix.dirname(relativePath), match[1]),
      );
      if (imported.startsWith('../') || !imported.startsWith('foliate/')) {
        throw new Error(
          `Foliate native module import escapes closure: ${imported}`,
        );
      }
      await visit(imported);
    }
  };
  await visit('bootstrap.js');
  if (visited.size !== 1) {
    throw new Error('Foliate native bootstrap must remain host-only during 4B');
  }
};

const verifyPackedFoliateWebRuntimeSync = async (consumerRoot, packageRoot) => {
  const { checkFoliateWebRuntime, syncFoliateWebRuntime } = await import(
    pathToFileURL(path.join(packageRoot, FOLIATE_WEB_SYNC_SCRIPT)).href
  );
  const runtimeRoot = path.join(packageRoot, FOLIATE_WEB_RUNTIME_ROOT);
  await syncFoliateWebRuntime({ runtimeRoot, targetRoot: consumerRoot });
  await checkFoliateWebRuntime({ runtimeRoot, targetRoot: consumerRoot });
};

const verifyVendoredCore = async (packageRoot) => {
  const coreRoot = path.join(packageRoot, 'lib/vendor/core');
  const coreManifest = JSON.parse(await read(coreRoot, 'package.json'));
  requireExact(
    {
      name: coreManifest.name,
      version: coreManifest.version,
      license: coreManifest.license,
    },
    { name: CORE_PACKAGE_NAME, version: '1.4.5', license: 'MIT' },
    'Vendored core metadata',
  );

  const [reader, sharedView, template, license, ...adapters] =
    await Promise.all([
      read(coreRoot, 'Reader.js'),
      read(coreRoot, 'View.js'),
      read(coreRoot, 'template.js'),
      read(coreRoot, 'LICENSE'),
      ...CORE_ADAPTERS.map((adapter) => read(packageRoot, adapter)),
    ]);
  requireMarkers(license, 'lib/vendor/core/LICENSE', [
    'Copyright (c) 2021 Victor Soares',
    'Permission is hereby granted',
  ]);
  requireMarkers(reader, 'lib/vendor/core/Reader.js', [
    'setAllowedUris(documentDirectory)',
  ]);
  requireMarkers(sharedView, 'lib/vendor/core/View.js', [
    'require("react-native-webview")',
    'allowedUris.replace',
    "originWhitelist: ['*']",
    'allowUniversalAccessFromFileURLs: false',
  ]);
  requireMarkers(template, 'lib/vendor/core/template.js', [
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
  ]);
  for (const [index, adapter] of adapters.entries()) {
    requireMarkers(adapter, CORE_ADAPTERS[index], [
      'require("../../../secure-webview")',
      '_hnSecureWebView.WebView',
      'failClosedOnShouldStartLoadWithRequest: true',
    ]);
    if (adapter.includes(OFFICIAL_WEBVIEW_PACKAGE_NAME)) {
      throw new Error(
        `${CORE_ADAPTERS[index]} must not reference the official react-native-webview dependency`,
      );
    }
  }

  for (const entry of [
    'lib/commonjs/NativeReaderImplementation.native.js',
    'lib/module/NativeReaderImplementation.native.js',
  ]) {
    const source = await read(packageRoot, entry);
    if (
      !source.includes('../vendor/core/index.js') ||
      source.includes(CORE_PACKAGE_NAME)
    ) {
      throw new Error(`${entry} does not exclusively use the vendored core`);
    }
  }
  for (const declaration of [
    'lib/typescript/commonjs/src/expoFileSystem.d.ts',
    'lib/typescript/module/src/expoFileSystem.d.ts',
  ]) {
    if ((await read(packageRoot, declaration)).includes(CORE_PACKAGE_NAME)) {
      throw new Error(`${declaration} leaks the build-only core dependency`);
    }
  }
};

const verifyVendoredCoreRuntime = (packageRoot) => {
  const coreRoot = path.join(packageRoot, 'lib/vendor/core');
  const coreRootPrefix = `${coreRoot}${path.sep}`;
  const coreRequire = createRequire(path.join(coreRoot, 'package.json'));
  const originalLoad = Module._load;
  const component = ({ children } = {}) => children ?? null;
  const gestureChain = {
    maxDuration: () => gestureChain,
    numberOfTaps: () => gestureChain,
    direction: () => gestureChain,
    onStart: () => gestureChain,
  };
  const react = {
    createContext: () => ({ Provider: component, Consumer: component }),
    createElement: component,
    forwardRef: (render) => render,
    memo: (render) => render,
    useCallback: (callback) => callback,
    useContext: () => ({}),
    useEffect: () => undefined,
    useMemo: (factory) => factory(),
    useRef: (current) => ({ current }),
    useState: (initial) => [initial, () => undefined],
    Fragment: Symbol.for('react.fragment'),
  };
  react.default = react;
  const platformStub = {
    ActivityIndicator: component,
    Dimensions: { get: () => ({ width: 320, height: 640 }) },
    I18nManager: { isRTL: false },
    Platform: { OS: 'android' },
    Pressable: component,
    StyleSheet: { create: (styles) => styles },
    Text: component,
    View: component,
    WebView: component,
    GestureHandlerRootView: component,
    GestureDetector: component,
    TouchableWithoutFeedback: component,
    Directions: { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8 },
    Gesture: {
      Tap: () => gestureChain,
      LongPress: () => gestureChain,
      Fling: () => gestureChain,
      Exclusive: () => gestureChain,
    },
    cacheDirectory: null,
    bundleDirectory: null,
    readAsStringAsync: async () => '',
    writeAsStringAsync: async () => undefined,
    deleteAsync: async () => undefined,
    getInfoAsync: async (uri) => ({ uri, exists: false }),
  };
  const platformModules = new Map([
    ['react', react],
    ['react-native', platformStub],
    ['react-native-webview', platformStub],
    ['react-native-gesture-handler', platformStub],
    ['expo-file-system/legacy', platformStub],
    ['epubjs', Object.assign(() => ({}), { default: () => ({}) })],
  ]);

  try {
    Module._load = function load(request, parent, isMain) {
      return platformModules.has(request)
        ? platformModules.get(request)
        : originalLoad.call(this, request, parent, isMain);
    };
    const core = coreRequire('./index.js');
    for (const name of ['Themes', 'ReaderProvider', 'useReader', 'Reader']) {
      if (
        core[name] === null ||
        !['function', 'object'].includes(typeof core[name])
      ) {
        throw new Error(
          `Vendored core runtime export ${name} is not a usable function or object`,
        );
      }
    }
  } finally {
    Module._load = originalLoad;
    for (const cachePath of Object.keys(coreRequire.cache)) {
      if (cachePath === coreRoot || cachePath.startsWith(coreRootPrefix)) {
        delete coreRequire.cache[cachePath];
      }
    }
  }
};

const verifyIntegrityManifest = async (packageRoot) => {
  const integrity = JSON.parse(await read(packageRoot, INTEGRITY_MANIFEST));
  requireExact(
    {
      schemaVersion: integrity.schemaVersion,
      generator: integrity.generator,
      source: integrity.source,
      implementationId: integrity.implementationId,
      implementationVersion: integrity.implementationVersion,
      protocolMajor: integrity.protocolMajor,
    },
    {
      schemaVersion: 1,
      generator: 'stage-secure-webview.mjs',
      source: { name: OFFICIAL_WEBVIEW_PACKAGE_NAME, version: '13.16.1' },
      implementationId: EXPECTED_ABI.implementationId,
      implementationVersion: EXPECTED_ABI.implementationVersion,
      protocolMajor: EXPECTED_ABI.protocolMajor,
    },
    'Secure WebView integrity metadata',
  );
  if (
    !integrity.files ||
    typeof integrity.files !== 'object' ||
    Array.isArray(integrity.files)
  ) {
    throw new Error('Secure WebView integrity manifest has no files map');
  }

  const keys = Object.keys(integrity.files);
  requireExact(keys, [...keys].sort(), 'Secure WebView integrity key order');
  if (keys.includes(INTEGRITY_MANIFEST)) {
    throw new Error('Secure WebView integrity manifest must not hash itself');
  }
  for (const relativePath of keys) {
    if (
      path.posix.isAbsolute(relativePath) ||
      relativePath.includes('\\') ||
      relativePath.split('/').includes('..')
    ) {
      throw new Error(`Unsafe integrity manifest path: ${relativePath}`);
    }
  }

  // Keep this expected set outside the JSON artifact so a modified manifest
  // cannot omit a security boundary file. It matches the source/staging list.
  const actualFiles = SECURE_WEBVIEW_INTEGRITY_FILES;
  requireExact(keys, actualFiles, 'Secure WebView integrity file coverage');

  for (const relativePath of keys) {
    const expectedHash = integrity.files[relativePath];
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
      throw new Error(`Invalid SHA-256 for ${relativePath}`);
    }
    const actualHash = sha256(
      await readFile(path.join(packageRoot, relativePath)),
    );
    if (actualHash !== expectedHash) {
      throw new Error(
        `SHA-256 mismatch for ${relativePath}: expected=${expectedHash} actual=${actualHash}`,
      );
    }
  }
  return actualFiles;
};

const verifyPrivateIdentities = async (packageRoot, privateFiles) => {
  const forbiddenIdentities = [
    'RNCWebView',
    'RNCBasicAuthCredential',
    'RNCWebChromeClient',
    'com.reactnativecommunity.webview',
    OFFICIAL_WEBVIEW_PACKAGE_NAME,
  ];
  const bridgeAllowlist = new Map([
    [
      `${JAVA_ROOT}/HNSecureWebView.java`,
      ['"ReactNativeWebView"', 'ReactNativeWebView.postMessage'],
    ],
    [
      'secure-webview/src/HNSecureWebViewTypes.ts',
      [
        'window.ReactNativeWebView',
        'window.webkit.messageHandlers.ReactNativeWebView',
      ],
    ],
    [`${APPLE_ROOT}/HNSecureWebViewImpl.m`, ['ReactNativeWebView']],
  ]);

  const identityScopedFiles = privateFiles.filter(
    (relativePath) =>
      relativePath.startsWith('android/') ||
      relativePath.startsWith(`${APPLE_ROOT}/`) ||
      relativePath === 'HNSecureWebView.podspec' ||
      relativePath === 'react-native.config.js' ||
      relativePath.startsWith('secure-webview/') ||
      CORE_ADAPTERS.includes(relativePath),
  );
  for (const relativePath of identityScopedFiles) {
    const source = await read(packageRoot, relativePath);
    const leaked = forbiddenIdentities.filter(
      (identity) =>
        relativePath.includes(identity) || source.includes(identity),
    );
    if (leaked.length > 0) {
      throw new Error(
        `Old WebView identity leaked into ${relativePath}: ${leaked.join(', ')}`,
      );
    }

    let withoutAllowedBridgeIdentity = source;
    for (const allowed of bridgeAllowlist.get(relativePath) ?? []) {
      withoutAllowedBridgeIdentity = withoutAllowedBridgeIdentity.replaceAll(
        allowed,
        '',
      );
    }
    if (withoutAllowedBridgeIdentity.includes('ReactNativeWebView')) {
      throw new Error(
        `ReactNativeWebView escaped the in-document bridge allowlist in ${relativePath}`,
      );
    }
  }

  requireMarkers(
    await read(packageRoot, `${JAVA_ROOT}/HNSecureWebView.java`),
    `${JAVA_ROOT}/HNSecureWebView.java`,
    ['JAVASCRIPT_INTERFACE = "ReactNativeWebView"'],
  );
  requireMarkers(
    await read(packageRoot, 'secure-webview/src/HNSecureWebViewTypes.ts'),
    'secure-webview/src/HNSecureWebViewTypes.ts',
    ['window.ReactNativeWebView.postMessage'],
  );
};

const verifyAndroidIdentities = async (packageRoot) => {
  const filesWithMarkers = new Map([
    [
      'android/build.gradle',
      [
        `namespace "${JAVA_PACKAGE}"`,
        "project.properties['HNSecureWebView_' + prop]",
      ],
    ],
    [
      'android/src/main/AndroidManifest.xml',
      [
        `package="${JAVA_PACKAGE}"`,
        `android:name=".${EXPECTED_ABI.fileProviderName}"`,
        '${applicationId}.hn_secure_webview_fileprovider',
        '@xml/hn_secure_webview_file_provider_paths',
      ],
    ],
    [
      'android/src/main/AndroidManifestNew.xml',
      [
        `android:name=".${EXPECTED_ABI.fileProviderName}"`,
        '${applicationId}.hn_secure_webview_fileprovider',
        '@xml/hn_secure_webview_file_provider_paths',
      ],
    ],
    [
      `${JAVA_ROOT}/${EXPECTED_ABI.fileProviderName}.java`,
      [
        `package ${JAVA_PACKAGE};`,
        `public class ${EXPECTED_ABI.fileProviderName} extends FileProvider`,
      ],
    ],
    [
      `${JAVA_ROOT}/HNSecureWebView.java`,
      [
        `package ${JAVA_PACKAGE};`,
        'public class HNSecureWebView extends WebView',
      ],
    ],
    [
      `${JAVA_ROOT}/HNSecureWebViewManagerImpl.kt`,
      [
        `package ${JAVA_PACKAGE}`,
        `const val NAME = "${EXPECTED_ABI.componentName}"`,
        'setFailClosedOnShouldStartLoadWithRequest',
      ],
    ],
    [
      `${JAVA_ROOT}/HNSecureWebViewModuleImpl.java`,
      [
        `package ${JAVA_PACKAGE};`,
        `public class HNSecureWebViewModuleImpl implements ActivityEventListener`,
      ],
    ],
    [
      `${JAVA_ROOT}/${EXPECTED_ABI.callableModuleName}.kt`,
      [
        `package ${JAVA_PACKAGE}`,
        `interface ${EXPECTED_ABI.callableModuleName}`,
      ],
    ],
    [
      `${JAVA_ROOT}/${EXPECTED_ABI.reactPackageName}.java`,
      [
        `package ${JAVA_PACKAGE};`,
        `public class ${EXPECTED_ABI.reactPackageName}`,
        'new HNSecureWebViewManager()',
        'new HNSecureWebViewModule(reactContext)',
      ],
    ],
    [
      'android/src/newarch/com/hamsternote/nativereader/securewebview/HNSecureWebViewManager.java',
      [
        `package ${JAVA_PACKAGE};`,
        'HNSecureWebViewManagerDelegate',
        'HNSecureWebViewManagerInterface',
      ],
    ],
    [
      'android/src/newarch/com/hamsternote/nativereader/securewebview/HNSecureWebViewModule.java',
      [
        `package ${JAVA_PACKAGE};`,
        'extends NativeHNSecureWebViewModuleSpec',
        'getTypedExportedConstants()',
        'HNSecureWebViewModuleImpl.getCapabilityConstants()',
      ],
    ],
    [
      'android/src/oldarch/com/hamsternote/nativereader/securewebview/HNSecureWebViewModule.java',
      [
        `package ${JAVA_PACKAGE};`,
        'Map<String, Object> getConstants()',
        'HNSecureWebViewModuleImpl.getCapabilityConstants()',
      ],
    ],
    [
      'secure-webview/src/HNSecureWebViewNativeComponent.ts',
      [
        `codegenNativeComponent<NativeProps>(\n  '${EXPECTED_ABI.componentName}'`,
        'failClosedOnShouldStartLoadWithRequest?: WithDefault<boolean, false>',
      ],
    ],
    [
      'secure-webview/src/NativeHNSecureWebViewModule.ts',
      [
        'getConstants(): NativeCapabilityConstants;',
        `TurboModuleRegistry.getEnforcing<Spec>('${EXPECTED_ABI.moduleName}')`,
        'implementationId: string;',
        'protocolMajor: Int32;',
        'implementationVersion: string;',
        'platform: string;',
        'capabilities: ReadonlyArray<string>;',
      ],
    ],
    [
      'secure-webview/src/HNSecureWebView.android.tsx',
      [
        `registerCallableModule('${EXPECTED_ABI.callableModuleName}'`,
        'failClosedOnShouldStartLoadWithRequest',
      ],
    ],
  ]);

  for (const [relativePath, markers] of filesWithMarkers) {
    requireMarkers(
      await read(packageRoot, relativePath),
      relativePath,
      markers,
    );
  }
};

const verifyAppleRuntime = async (packageRoot) => {
  const [
    podspec,
    autolink,
    implementation,
    decisions,
    module,
    iosRuntime,
    iosAdapter,
    manager,
    detectorTypes,
    detectorTypesHeader,
    faultMatrix,
  ] = await Promise.all([
    read(packageRoot, 'HNSecureWebView.podspec'),
    read(packageRoot, 'react-native.config.js'),
    read(packageRoot, `${APPLE_ROOT}/HNSecureWebViewImpl.m`),
    read(packageRoot, `${APPLE_ROOT}/HNSecureWebViewDecisionManager.m`),
    read(packageRoot, `${APPLE_ROOT}/HNSecureWebViewModule.mm`),
    read(packageRoot, 'secure-webview/src/HNSecureWebView.ios.tsx'),
    read(packageRoot, 'lib/vendor/core/View.ios.js'),
    read(packageRoot, `${APPLE_ROOT}/HNSecureWebViewManager.mm`),
    read(packageRoot, `${APPLE_ROOT}/RCTConvert+WKDataDetectorTypes.m`),
    read(packageRoot, `${APPLE_ROOT}/RCTConvert+WKDataDetectorTypes.h`),
    read(
      packageRoot,
      'apple-fault-matrix/HNSecureWebViewDecisionManagerTests.m',
    ),
  ]);
  requireMarkers(podspec, 'HNSecureWebView.podspec', [
    "s.name = 'HNSecureWebView'",
    "s.source_files = 'apple/**/*.{h,m,mm,swift}'",
  ]);
  if (podspec.includes(':osx')) {
    throw new Error(
      'HNSecureWebView podspec must not declare unsupported macOS',
    );
  }
  requireMarkers(autolink, 'react-native.config.js', [
    "podspecPath: 'HNSecureWebView.podspec'",
  ]);
  requireMarkers(implementation, `${APPLE_ROOT}/HNSecureWebViewImpl.m`, [
    '_failClosedOnShouldStartLoadWithRequest && !_onShouldStartLoadWithRequest',
    'WKNavigationActionPolicyCancel',
    'HNSecureWebViewNavigationDecisionTimeout',
    'setDecisionHandler: ^(BOOL shouldStart)',
    '} owner:self generation:[self navigationDecisionOwnerGeneration]]',
    'cancelDecisionHandlerForLockIdentifier:',
    'dispatchDecisionEvent:',
    '@catch (NSException *exception)',
    'cancelPendingNavigationDecisions',
    '@catch (NSException *exception)',
    'isNavigationDecisionOwnerActive',
    'BOOL cancelNavigation = strongSelf == nil || !shouldStart || ![strongSelf isNavigationDecisionOwnerActive]',
    '[strongSelf->_pendingNavigationLockIdentifiers removeObject:@(lockIdentifier)]',
    'decisionHandler(cancelNavigation ? WKNavigationActionPolicyCancel : WKNavigationActionPolicyAllow)',
    'activateNavigationDecisionOwner',
    '_navigationDecisionOwnerGeneration += 1',
  ]);
  requireMarkers(decisions, `${APPLE_ROOT}/HNSecureWebViewDecisionManager.m`, [
    'dispatch_get_main_queue()',
    'performOnMainQueue:',
    'if ([NSThread isMainThread])',
    'HNSecureWebViewDecisionEntry',
    '@property (nonatomic, assign) NSUInteger generation;',
    '[entry.owner navigationDecisionOwnerGeneration] == entry.generation',
    'resolveShouldStart:shouldStart forLockIdentifier:',
    'cancelDecisionHandlerForLockIdentifier:',
    '[self.decisionHandlers removeObjectForKey:key]',
  ]);
  if (
    decisions.indexOf('[self.decisionHandlers removeObjectForKey:key]') >
    decisions.indexOf('entry.handler(shouldStart && ownerIsCurrent)')
  ) {
    throw new Error(
      'HNSecure decision handler must consume its entry before completion',
    );
  }
  requireMarkers(iosRuntime, 'secure-webview/src/HNSecureWebView.ios.tsx', [
    'HNSecureWebViewNativeComponent',
    'NativeHNSecureWebViewModule',
  ]);
  requireMarkers(iosAdapter, 'lib/vendor/core/View.ios.js', [
    'require("../../../secure-webview")',
    '_hnSecureWebView.WebView',
  ]);
  for (const [file, source] of [
    ['secure-webview/src/HNSecureWebView.ios.tsx', iosRuntime],
    ['lib/vendor/core/View.ios.js', iosAdapter],
  ]) {
    if (source.includes('react-native-webview')) {
      throw new Error(
        `${file} must not require the official react-native-webview runtime`,
      );
    }
  }
  for (const [file, source] of [
    [`${APPLE_ROOT}/HNSecureWebViewImpl.m`, implementation],
    [`${APPLE_ROOT}/HNSecureWebViewManager.mm`, manager],
    [`${APPLE_ROOT}/RCTConvert+WKDataDetectorTypes.m`, detectorTypes],
  ]) {
    for (const legacyDefinition of [
      '@interface RNCWKWebView',
      '@implementation RNCWKWebView',
      '@interface RNCWeakScriptMessageDelegate',
      '@implementation RNCWeakScriptMessageDelegate',
      '@implementation RCTConvert (WKWebView)',
      '@implementation RCTConvert (WKDataDetectorTypes)',
      'NSString *const CUSTOM_SELECTOR',
      '@interface _SwizzleHelperWK',
      '@implementation _SwizzleHelperWK',
      'auto stringToOnShouldStartLoadWithRequestNavigationTypeEnum',
      'auto stringToOnLoadingStartNavigationTypeEnum',
      'auto stringToOnLoadingFinishNavigationTypeEnum',
    ]) {
      if (source.includes(legacyDefinition)) {
        throw new Error(
          `${file} retains conflicting Apple definition ${legacyDefinition}`,
        );
      }
    }
  }
  requireMarkers(implementation, `${APPLE_ROOT}/HNSecureWebViewImpl.m`, [
    'static NSString *const HNSecureWebViewCustomSelectorPrefix',
    '@interface HNSecureWebViewSwizzleHelperWK',
    '@implementation HNSecureWebViewSwizzleHelperWK',
    'NSString* name = [NSString stringWithFormat:@"HNSecure_%@_SwizzleHelperWK", subview.class.superclass];',
    'hasPrefix:@"HNSecure_"',
  ]);
  requireMarkers(manager, `${APPLE_ROOT}/HNSecureWebViewManager.mm`, [
    '#import "RCTConvert+WKDataDetectorTypes.h"',
    '+ (WKContentMode)HNSecureWKContentMode:(id)json',
    '+ (HNSecureWebViewPermissionGrantType)HNSecureWebViewPrivatePermissionGrantType:(id)json',
    'RCT_CUSTOM_VIEW_PROPERTY(contentMode, WKContentMode, HNSecureWebViewImpl)',
    'RCT_CUSTOM_VIEW_PROPERTY(mediaCapturePermissionGrantType, HNSecureWebViewPermissionGrantType, HNSecureWebViewImpl)',
    '[RCTConvert HNSecureWKContentMode:json]',
    '[RCTConvert HNSecureWebViewPrivatePermissionGrantType:json]',
  ]);
  requireMarkers(
    detectorTypes,
    `${APPLE_ROOT}/RCTConvert+WKDataDetectorTypes.m`,
    [
      '#import "RCTConvert+WKDataDetectorTypes.h"',
      '+ (WKDataDetectorTypes)HNSecureWKDataDetectorTypes:(id)json',
      'RCTConvertMultiEnumValue(',
    ],
  );
  if (detectorTypes.includes('RCT_MULTI_ENUM_CONVERTER(')) {
    throw new Error(
      'HNSecure data-detector converter must not generate the official selector',
    );
  }
  requireMarkers(
    detectorTypesHeader,
    `${APPLE_ROOT}/RCTConvert+WKDataDetectorTypes.h`,
    [
      '@interface RCTConvert (HNSecureWKDataDetectorTypes)',
      '+ (WKDataDetectorTypes)HNSecureWKDataDetectorTypes:(id)json;',
    ],
  );
  requireMarkers(
    await read(packageRoot, `${APPLE_ROOT}/HNSecureWebView.mm`),
    `${APPLE_ROOT}/HNSecureWebView.mm`,
    ['namespace {', '} // namespace'],
  );
  requireMarkers(module, `${APPLE_ROOT}/HNSecureWebViewModule.mm`, [
    'constantsToExport',
    'facebook::react::ModuleConstants<JS::NativeHNSecureWebViewModule::Constants>',
    'facebook::react::typedConstants<JS::NativeHNSecureWebViewModule::Constants>',
    'std::vector<NSString *>({',
    '#ifndef RCT_NEW_ARCH_ENABLED',
    '#else',
    '@"platform": @"ios"',
    ...EXPECTED_ABI.capabilities,
  ]);
  requireMarkers(
    faultMatrix,
    'apple-fault-matrix/HNSecureWebViewDecisionManagerTests.m',
    [
      '#import <XCTest/XCTest.h>',
      '#import <HNSecureWebView/HNSecureWebViewDecisionManager.h>',
      'testNoHandlerCancelsExactlyOnce',
      'testTimeoutAndTeardownCancelExactlyOnce',
      'testDispatchExceptionCancelsExactlyOnce',
      'testLateCallbackAndRecycleGenerationCannotAffectCurrentDecision',
      'testCurrentGenerationAllowAndDenyAreExact',
      'dispatchDecisionEvent:',
      'XCTAssertEqual(calls, 1u)',
    ],
  );
};

const readGateAbi = (source, file) => {
  const declarationLine = (name) => {
    const line = source
      .split('\n')
      .find((candidate) => candidate.includes(`const ${name} `));
    if (!line) throw new Error(`${file} has no ${name} declaration`);
    return line;
  };
  const readString = (name) => {
    const values = [...declarationLine(name).matchAll(/'([^']+)'/g)].map(
      (match) => match[1],
    );
    if (values.length !== 1) {
      throw new Error(`${file} has an ambiguous ${name} declaration`);
    }
    return values[0];
  };
  const protocolMatch = declarationLine(
    'NATIVE_CAPABILITY_PROTOCOL_MAJOR',
  ).match(/=\s*(\d+);?\s*$/);
  if (!protocolMatch) {
    throw new Error(`${file} has an invalid protocol declaration`);
  }
  const capabilitiesLine = declarationLine(
    'ANDROID_REQUIRED_NATIVE_CAPABILITIES',
  );
  const capabilitiesMatch = capabilitiesLine.match(/\[([^\]]*)\]/);
  if (!capabilitiesMatch) {
    throw new Error(`${file} has an invalid Android capabilities declaration`);
  }
  return {
    moduleName: readString('NATIVE_CAPABILITY_MODULE_NAME'),
    implementationId: readString('NATIVE_CAPABILITY_IMPLEMENTATION_ID'),
    protocolMajor: Number(protocolMatch[1]),
    implementationVersion: readString(
      'NATIVE_CAPABILITY_IMPLEMENTATION_VERSION',
    ),
    capabilities: [...capabilitiesMatch[1].matchAll(/'([^']+)'/g)].map(
      (match) => match[1],
    ),
  };
};

const readNativeAbi = (source, file) => {
  const requireMatch = (expression, description) => {
    const match = source.match(expression);
    if (!match) throw new Error(`${file} has no ${description}`);
    return match[1];
  };
  const capabilitiesBlock = requireMatch(
    /constants\.put\("capabilities", Collections\.unmodifiableList\(Arrays\.asList\(([\s\S]*?)\)\)\);/,
    'capability constants block',
  );
  return {
    moduleName: requireMatch(/NAME = "([^"]+)"/, 'module name'),
    implementationId: requireMatch(
      /constants\.put\("implementationId", "([^"]+)"\)/,
      'implementation ID',
    ),
    protocolMajor: Number(
      requireMatch(
        /constants\.put\("protocolMajor", (\d+)\)/,
        'protocol major',
      ),
    ),
    implementationVersion: requireMatch(
      /constants\.put\("implementationVersion", "([^"]+)"\)/,
      'implementation version',
    ),
    platform: requireMatch(
      /constants\.put\("platform", "([^"]+)"\)/,
      'platform',
    ),
    capabilities: [...capabilitiesBlock.matchAll(/"([^"]+)"/g)].map(
      (match) => match[1],
    ),
  };
};

const verifyCapabilityAbi = async (packageRoot) => {
  const expected = {
    moduleName: EXPECTED_ABI.moduleName,
    implementationId: EXPECTED_ABI.implementationId,
    protocolMajor: EXPECTED_ABI.protocolMajor,
    implementationVersion: EXPECTED_ABI.implementationVersion,
    capabilities: EXPECTED_ABI.capabilities,
  };
  for (const gate of [
    'lib/commonjs/nativeCapability.js',
    'lib/module/nativeCapability.js',
  ]) {
    requireExact(
      readGateAbi(await read(packageRoot, gate), gate),
      expected,
      gate,
    );
  }

  const nativeModule = `${JAVA_ROOT}/HNSecureWebViewModuleImpl.java`;
  requireExact(
    readNativeAbi(await read(packageRoot, nativeModule), nativeModule),
    { ...expected, platform: EXPECTED_ABI.platform },
    nativeModule,
  );
};

const countOccurrences = (source, value) => source.split(value).length - 1;

const verifyCompiledNativeIndex = async (packageRoot, relativePath) => {
  const source = await read(packageRoot, relativePath);
  requireMarkers(source, relativePath, ['NativeReader.native.js']);
  for (const forbidden of [
    '@epubjs-react-native/core',
    'react-native-webview',
    'secure-webview',
    'NativeReaderImplementation.native',
  ]) {
    if (source.includes(forbidden)) {
      throw new Error(`${relativePath} has a static ${forbidden} import`);
    }
  }
};

const verifyCompiledGate = async (packageRoot, relativePath) => {
  const source = await read(packageRoot, relativePath);
  const implementationLiteral =
    "require('./NativeReaderImplementation.native')";
  const loadStart = source.indexOf('function loadImplementation()');
  const loadEnd = source.indexOf('function CapabilityError', loadStart);
  if (loadStart < 0 || loadEnd < 0) {
    throw new Error(`${relativePath} has no bounded loadImplementation gate`);
  }
  const gate = source.slice(loadStart, loadEnd);

  for (const forbidden of [
    '@epubjs-react-native/core',
    'react-native-webview',
    'secure-webview',
  ]) {
    if (source.includes(forbidden)) {
      throw new Error(`${relativePath} has a static ${forbidden} import`);
    }
  }
  if (
    countOccurrences(source, implementationLiteral) !== 1 ||
    countOccurrences(source, 'NativeReaderImplementation.native') !== 1
  ) {
    throw new Error(
      `${relativePath} must contain exactly one literal implementation require`,
    );
  }
  const outsideGate = `${source.slice(0, loadStart)}${source.slice(loadEnd)}`;
  if (outsideGate.includes('NativeReaderImplementation')) {
    throw new Error(
      `${relativePath} references the implementation outside the gated success path`,
    );
  }

  const readIndex = gate.indexOf('readNativeCapability');
  const failureGuardIndex = gate.indexOf(
    'if (!capability.ok) return capability;',
  );
  const tryIndex = gate.indexOf('try {');
  const implementationIndex = gate.indexOf(implementationLiteral);
  const catchIndex = gate.indexOf('} catch {');
  if (
    readIndex < 0 ||
    failureGuardIndex <= readIndex ||
    tryIndex <= failureGuardIndex ||
    implementationIndex <= tryIndex ||
    catchIndex <= implementationIndex
  ) {
    throw new Error(
      `${relativePath} does not gate the try/catch-wrapped implementation require behind readNativeCapability`,
    );
  }
  if (!source.includes("code: 'NATIVE_CAPABILITY_UNAVAILABLE'")) {
    throw new Error(`${relativePath} has no stable capability failure code`);
  }
};

const verifyCompiledValidator = async (packageRoot, relativePath) => {
  const source = await read(packageRoot, relativePath);
  const lookupLiteral = "require('react-native')";
  const lookupStart = source.indexOf('function readDefaultRegistry()');
  const lookupEnd = source.indexOf(
    'function readNativeCapability',
    lookupStart,
  );
  if (lookupStart < 0 || lookupEnd < 0) {
    throw new Error(`${relativePath} has no lazy registry lookup function`);
  }
  if (
    /(?:from\s*|require\()\s*["']react-native["']/.test(
      source.slice(0, lookupStart),
    ) ||
    source.slice(0, lookupStart).includes(lookupLiteral) ||
    countOccurrences(source, lookupLiteral) !== 1 ||
    !source.slice(lookupStart, lookupEnd).includes(lookupLiteral)
  ) {
    throw new Error(`${relativePath} does not keep React Native lookup lazy`);
  }
  if (!source.slice(lookupStart, lookupEnd).includes('TurboModuleRegistry')) {
    throw new Error(`${relativePath} does not lazily read TurboModuleRegistry`);
  }
  if (source.includes('getEnforcing')) {
    throw new Error(
      `${relativePath} must not use TurboModuleRegistry.getEnforcing`,
    );
  }
  const reader = source.slice(lookupEnd);
  requireMarkers(reader, relativePath, [
    'registryGet = activeRegistry.get;',
    'registryGet.call(activeRegistry, NATIVE_CAPABILITY_MODULE_NAME)',
  ]);
};

const verifyCompiledNativeGate = async (packageRoot) => {
  for (const format of ['commonjs', 'module']) {
    await verifyCompiledNativeIndex(
      packageRoot,
      `lib/${format}/index.native.js`,
    );
    await verifyCompiledGate(
      packageRoot,
      `lib/${format}/NativeReader.native.js`,
    );
    await verifyCompiledValidator(
      packageRoot,
      `lib/${format}/nativeCapability.js`,
    );
  }
};

const verifyOfficialWebViewInstall = async (
  consumerRoot,
  dependencyResolutionRoot,
) => {
  const packageRequire = createRequire(
    path.join(dependencyResolutionRoot, 'package.json'),
  );
  const officialManifestPath = packageRequire.resolve(
    `${OFFICIAL_WEBVIEW_PACKAGE_NAME}/package.json`,
  );
  // 两侧先做同等的 realpath 规范化再比较：Node 的 CJS 解析默认关闭
  // preserveSymlinks，会把结果解析成 realpath（macOS 上是 /private/var/...），
  // 而调用方传入的 consumerRoot 可能仍带着符号链接前缀（macOS 上是
  // /var/...），直接 path.relative 会把同一棵安装树误判为越界。真实位于
  // consumer 树之外的解析结果仍会被下面的 '..'/绝对路径检查拒绝。
  const [normalizedConsumerRoot, normalizedManifestPath] = await Promise.all([
    realpath(consumerRoot).catch(() => path.resolve(consumerRoot)),
    realpath(officialManifestPath).catch(() =>
      path.resolve(officialManifestPath),
    ),
  ]);
  const relativeToConsumer = path.relative(
    normalizedConsumerRoot,
    normalizedManifestPath,
  );
  if (
    relativeToConsumer.startsWith('..') ||
    path.isAbsolute(relativeToConsumer)
  ) {
    throw new Error(
      `Official react-native-webview resolved outside the consumer install tree: ${officialManifestPath}`,
    );
  }
  const officialManifest = JSON.parse(
    await readFile(officialManifestPath, 'utf8'),
  );
  requireExact(
    {
      name: officialManifest.name,
      version: officialManifest.version,
    },
    { name: OFFICIAL_WEBVIEW_PACKAGE_NAME, version: '13.16.1' },
    'Official installed WebView package',
  );
};

/**
 * Verifies the package-manager-produced install tree and loads vendored core
 * once with controlled platform-boundary stubs. Core modules remain real CJS.
 */
export async function verifyStaticNativePropagation({
  consumerRoot,
  packageRoot = path.join(consumerRoot, 'node_modules', PACKAGE_NAME),
  dependencyResolutionRoot = packageRoot,
}) {
  await Promise.all([
    requirePath(packageRoot, 'android', 'directory'),
    requirePath(packageRoot, APPLE_ROOT, 'directory'),
    requirePath(packageRoot, 'secure-webview', 'directory'),
    requirePath(packageRoot, INTEGRITY_MANIFEST, 'file'),
    requirePath(packageRoot, 'THIRD_PARTY_NOTICES.md', 'file'),
    requirePath(packageRoot, FOLIATE_RUNTIME_ROOT, 'directory'),
    requirePath(packageRoot, FOLIATE_WEB_RUNTIME_ROOT, 'directory'),
    requirePath(packageRoot, FOLIATE_NATIVE_RUNTIME_ROOT, 'directory'),
  ]);
  for (const relativePath of REQUIRED_TARBALL_FILES) {
    await requirePath(packageRoot, relativePath, 'file');
  }

  await verifyPublishedManifest(packageRoot);
  const privateFiles = await verifyIntegrityManifest(packageRoot);
  await Promise.all([
    verifyPrivateIdentities(packageRoot, privateFiles),
    verifyAndroidIdentities(packageRoot),
    verifyAppleRuntime(packageRoot),
    verifyCapabilityAbi(packageRoot),
    verifyCompiledNativeGate(packageRoot),
    verifyVendoredCore(packageRoot),
    verifyFoliateRuntime(packageRoot),
    verifyFoliateWebRuntime(packageRoot),
    verifyFoliateNativeRuntime(packageRoot),
    verifyPackedFoliateWebRuntimeSync(consumerRoot, packageRoot),
    verifyOfficialWebViewInstall(consumerRoot, dependencyResolutionRoot),
  ]);
  verifyVendoredCoreRuntime(packageRoot);

  const notices = await read(packageRoot, 'THIRD_PARTY_NOTICES.md');
  requireMarkers(notices, 'THIRD_PARTY_NOTICES.md', [
    '`react-native-webview` 13.16.1',
    '`@epubjs-react-native/core` 1.4.5',
    '`johnfactotum/foliate-js` commit `78914aef4466eb960965702401634c2cb348e9b1`',
    'BSD-3-Clause',
    'fflate',
  ]);
}

export const findForbiddenTarballFiles = (files) =>
  files.filter(
    (file) =>
      file.includes('.test.') ||
      file.includes('/__tests__/') ||
      file.startsWith('src/') ||
      (file.startsWith('scripts/') && file !== FOLIATE_WEB_SYNC_SCRIPT) ||
      file.startsWith('node_modules/') ||
      file.startsWith('consumer-test/') ||
      file.startsWith('apps/') ||
      file.startsWith('patches/') ||
      file.startsWith('.opencode/') ||
      file.startsWith('openspec/') ||
      file.startsWith('vendor/foliate-js/') ||
      file.startsWith('.git/') ||
      file.includes('/.git/') ||
      file.startsWith('foliate-runtime/.git') ||
      file.startsWith('foliate-runtime/pdf.js') ||
      file.startsWith('foliate-runtime/vendor/pdfjs/') ||
      /^tsconfig(?:\.|$)/.test(file),
  );
