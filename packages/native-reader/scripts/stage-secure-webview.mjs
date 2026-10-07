import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
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
import { assertSafeStagingPaths } from './staging-path-safety.mjs';
import { assertOwnedStagingRoot } from './staging-ownership.mjs';

export const IMPLEMENTATION_ID = 'com.hamsternote.nativereader.securewebview';
export const IMPLEMENTATION_VERSION = '13.16.1-hamsternote.1';
export const PROTOCOL_MAJOR = 1;
export const MODULE_NAME = 'HNSecureWebViewModule';
export const COMPONENT_NAME = 'HNSecureWebView';
export const CALLABLE_MODULE_NAME = 'HNSecureWebViewMessagingModule';
export const CODEGEN_LIBRARY_NAME = 'HNSecureWebViewSpec';
export const REACT_PACKAGE_NAME = 'HNSecureWebViewPackage';
export const ANDROID_CAPABILITIES = [
  'navigation-decision-fail-closed-v1',
  'main-frame-native-gate-v1',
  'subframe-local-root-deny-v1',
  'late-callback-safe-v1',
  'native-foliate-host-v1',
];
export const IOS_CAPABILITIES = [...ANDROID_CAPABILITIES];

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = path.resolve(packageRoot, '../..');
const generatorName = 'stage-secure-webview.mjs';
const generatedMarker = 'HN_SECURE_WEBVIEW_GENERATED';
const manifestName = 'SECURE_WEBVIEW_SHA256.json';
const samePath = (left, right) => {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
};
const compareIntegrityPath = (left, right) =>
  left.manifestPath < right.manifestPath
    ? -1
    : left.manifestPath > right.manifestPath
      ? 1
      : 0;
const nativeBundleManifestPrefix =
  'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native';
// This literal is the source-to-staging integrity closure. It is deliberately
// independent from SECURE_WEBVIEW_SHA256.json: changing that JSON cannot omit
// a host, relay, policy, fault test, or native runtime resource from staging.
const STAGED_SECURE_WEBVIEW_INTEGRITY_FILES = [
  { manifestPath: 'HNSecureWebView.podspec' },
  { manifestPath: 'secure-webview/src/HNSecureWebView.android.tsx' },
  { manifestPath: 'secure-webview/src/HNSecureWebView.ios.tsx' },
  { manifestPath: 'secure-webview/src/HNSecureWebViewNativeComponent.ts' },
  { manifestPath: 'secure-webview/src/HNSecureWebViewTypes.ts' },
  {
    manifestPath:
      'android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebChromeClient.java',
  },
  {
    manifestPath:
      'android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebView.java',
  },
  {
    manifestPath:
      'android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebViewClient.java',
  },
  {
    manifestPath:
      'android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebViewManagerImpl.kt',
  },
  {
    manifestPath:
      'android/src/newarch/com/hamsternote/nativereader/securewebview/HNSecureWebViewManager.java',
  },
  {
    manifestPath:
      'android/src/oldarch/com/hamsternote/nativereader/securewebview/HNSecureWebViewManager.java',
  },
  {
    manifestPath:
      'android/fault-matrix/HNSecureWebViewClientFaultMatrixTest.java',
    sourcePath:
      'android-fault-matrix/harness/src/test/java/com/hamsternote/nativereader/securewebview/HNSecureWebViewClientFaultMatrixTest.java',
  },
  {
    manifestPath: 'apple-fault-matrix/HNSecureWebViewDecisionManagerTests.m',
  },
  { manifestPath: 'apple/HNSecureFoliateHostRelay.h' },
  { manifestPath: 'apple/HNSecureFoliateHostRelay.m' },
  { manifestPath: 'apple/HNSecureWebViewImpl.m' },
  { manifestPath: 'apple/HNSecureWebViewManager.mm' },
  { manifestPath: 'apple/HNSecureWebViewReadAccessPolicy.h' },
  { manifestPath: 'apple/HNSecureWebViewReadAccessPolicy.m' },
  { manifestPath: 'secure-webview/foliate-host-wire-corpus.v1.json' },
  {
    manifestPath: `${nativeBundleManifestPrefix}/manifest.json`,
    sourcePath: 'foliate-runtime/native/manifest.json',
  },
  ...[
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
  ].map((relativePath) => ({
    manifestPath: `${nativeBundleManifestPrefix}/${relativePath}`,
    sourcePath: `foliate-runtime/native/${relativePath}`,
  })),
].sort(compareIntegrityPath);
const ROOT_MANIFEST_WRITE_CAPABILITY = Symbol('root-integrity-generator');
const coreAdapterRelativePaths = [
  'lib/vendor/core/View.android.js',
  'lib/vendor/core/View.ios.js',
];
const applePodspecName = 'HNSecureWebView.podspec';
const autolinkConfigName = 'react-native.config.js';
const appleFaultMatrixDirectory = 'apple-fault-matrix';
const foliateHostWireCorpus = 'secure-webview/foliate-host-wire-corpus.v1.json';
const appleFoliateRelayFiles = [
  'HNSecureFoliateHostRelay.h',
  'HNSecureFoliateHostRelay.m',
];
const iosFoliateRuntimeBundleName = 'HNSecureWebViewFoliateRuntime';
const iosFoliateRuntimeBundleDirectory = `apple/${iosFoliateRuntimeBundleName}.bundle`;
const foliateNativeRuntimeDirectory = 'foliate-runtime/native';
// 所有删除或写入目标在 cleanup 之前检查；扫描完整可变子树，不能靠
// generated marker 或固定 integrity closure 忽略闭包外的用户文件/链接。
const stagingMutablePaths = [
  'android',
  'apple',
  'secure-webview',
  appleFaultMatrixDirectory,
  'lib/vendor/core',
  applePodspecName,
  autolinkConfigName,
  manifestName,
];
const stagingAuthorityKeys = [
  'sourceRoot',
  'coreRoot',
  'productSourceRoot',
  'referenceIntegrityRoot',
  'runtimeRoot',
  'capabilityRoot',
];
const ownedAppleFaultFiles = new WeakMap();
const appleFaultRelativePath =
  'apple-fault-matrix/HNSecureWebViewDecisionManagerTests.m';

const verifyAppleFaultOwnership = async (plan) => {
  const directory = path.join(plan.outputRoot, appleFaultMatrixDirectory);
  if (await pathExists(directory)) {
    const files = await listTreeEntries(directory);
    if (
      files.some((file) => file !== 'F:HNSecureWebViewDecisionManagerTests.m')
    ) {
      throw new Error(
        'Refusing to replace/remove unowned Apple fault matrix entries',
      );
    }
  }
  const file = path.join(plan.outputRoot, appleFaultRelativePath);
  if (!(await pathExists(file))) return;
  const contents = await readFile(file);
  const generatedHash = ownedAppleFaultFiles.get(plan.ownership);
  if (generatedHash === sha256(contents)) return;
  let authorityContents;
  try {
    authorityContents = await readFile(
      path.join(plan.productSourceRoot, appleFaultRelativePath),
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (!authorityContents?.equals(contents)) {
    throw new Error(
      'Refusing to replace/remove unowned Apple fault matrix file',
    );
  }
};

const assertStagingPlan = async (plan, { checkAppleFault = true } = {}) => {
  for (const key of stagingAuthorityKeys) {
    if (typeof plan[key] !== 'string' || !plan[key].trim()) {
      throw new Error(
        `${key} is required for a complete staging authority plan`,
      );
    }
  }
  const safe = await assertSafeStagingPaths({
    outputRoot: plan.outputRoot,
    // 实际 module packageRoot 无条件保护，调用方不能换 capability/product
    // 根来允许对工作区源码执行 clean/stage。
    authorityRoots: [
      packageRoot,
      ...stagingAuthorityKeys.map((key) => plan[key]),
    ],
  });
  await assertOwnedStagingRoot({
    outputRoot: safe.outputRoot,
    ownership: plan.ownership,
  });
  // capability 通过后才遍历输出 payload；foreign 根不能靠 marker 取得授权。
  await assertSafeStagingPaths({
    outputRoot: safe.outputRoot,
    authorityRoots: safe.authorityRoots,
    mutablePaths: stagingMutablePaths,
  });
  const canonicalPlan = {
    outputRoot: safe.outputRoot,
    ownership: plan.ownership,
  };
  stagingAuthorityKeys.forEach((key, index) => {
    canonicalPlan[key] = safe.authorityRoots[index + 1];
  });
  if (
    !samePath(
      canonicalPlan.productSourceRoot,
      canonicalPlan.referenceIntegrityRoot,
    )
  ) {
    throw new Error(
      'productSourceRoot and referenceIntegrityRoot must identify the same reviewed source tree',
    );
  }
  if (checkAppleFault) await verifyAppleFaultOwnership(canonicalPlan);
  return canonicalPlan;
};
// This explicit closure prevents a manifest from omitting a Foliate dependency
// while keeping the folder-reference bundle internally self-consistent.
export const IOS_FOLIATE_RUNTIME_CLOSURE_PATHS = [
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
].sort();
// 保留已有 Foliate 生成模板常量；本轮路径安全改动不重写其原有逻辑。
// eslint-disable-next-line no-unused-vars -- 现有生成模板预留常量，非本轮实现范围。
const IOS_RUNTIME_CLOSURE_OBJECTIVE_C_PATHS =
  IOS_FOLIATE_RUNTIME_CLOSURE_PATHS.map(
    (relativePath) => `    @"${relativePath}",`,
  ).join('\n');
const REQUIRED_FOLIATE_NATIVE_PROBE_METADATA = new Map([
  [
    'probes/csp-1x1.png',
    {
      source: 'generated:foliate-native-csp-probe-png-v1',
      category: 'csp-probe-image',
      license: 'CC0-1.0',
      mimeType: 'image/png',
    },
  ],
  [
    'probes/csp-external-canary.js',
    {
      source: 'generated:foliate-native-csp-probe-external-canary-v1',
      category: 'csp-probe-script',
      license: 'MIT',
      mimeType: 'text/javascript; charset=utf-8',
    },
  ],
]);
const reviewedInputBaselinePath = new URL(
  './secure-webview-input-sha256.json',
  import.meta.url,
);

// This allowlist intentionally describes the complete Android input tree for
// 13.16.1. Upstream additions cannot silently enter the published artifact.
export const ANDROID_INPUT_FILES = [
  'android/build.gradle',
  'android/gradle.properties',
  'android/src/main/AndroidManifest.xml',
  'android/src/main/AndroidManifestNew.xml',
  'android/src/main/java/com/reactnativecommunity/webview/RNCBasicAuthCredential.java',
  'android/src/main/java/com/reactnativecommunity/webview/RNCWebChromeClient.java',
  'android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java',
  'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java',
  'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewConfig.java',
  'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewFileProvider.java',
  'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewManagerImpl.kt',
  'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewMessagingModule.kt',
  'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewModuleImpl.java',
  'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewPackage.java',
  'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewWrapper.kt',
  'android/src/main/java/com/reactnativecommunity/webview/URLUtil.java',
  'android/src/main/java/com/reactnativecommunity/webview/events/SubResourceErrorEvent.kt',
  'android/src/main/java/com/reactnativecommunity/webview/events/TopCustomMenuSelectionEvent.kt',
  'android/src/main/java/com/reactnativecommunity/webview/events/TopHttpErrorEvent.kt',
  'android/src/main/java/com/reactnativecommunity/webview/events/TopLoadingErrorEvent.kt',
  'android/src/main/java/com/reactnativecommunity/webview/events/TopLoadingFinishEvent.kt',
  'android/src/main/java/com/reactnativecommunity/webview/events/TopLoadingProgressEvent.kt',
  'android/src/main/java/com/reactnativecommunity/webview/events/TopLoadingStartEvent.kt',
  'android/src/main/java/com/reactnativecommunity/webview/events/TopMessageEvent.kt',
  'android/src/main/java/com/reactnativecommunity/webview/events/TopNewWindowEvent.kt',
  'android/src/main/java/com/reactnativecommunity/webview/events/TopRenderProcessGoneEvent.kt',
  'android/src/main/java/com/reactnativecommunity/webview/events/TopShouldStartLoadWithRequestEvent.kt',
  'android/src/main/res/xml/file_provider_paths.xml',
  'android/src/newarch/com/reactnativecommunity/webview/RNCWebViewManager.java',
  'android/src/newarch/com/reactnativecommunity/webview/RNCWebViewModule.java',
  'android/src/oldarch/com/reactnativecommunity/webview/RNCWebViewManager.java',
  'android/src/oldarch/com/reactnativecommunity/webview/RNCWebViewModule.java',
].sort();

// Apple source is staged from the patched upstream package instead of the
// workspace. A release consumer therefore compiles only this namespaced tree.
export const APPLE_INPUT_FILES = [
  'apple/RCTConvert+WKDataDetectorTypes.h',
  'apple/RCTConvert+WKDataDetectorTypes.m',
  'apple/RNCWebView.h',
  'apple/RNCWebView.mm',
  'apple/RNCWebViewDecisionManager.h',
  'apple/RNCWebViewDecisionManager.m',
  'apple/RNCWebViewImpl.h',
  'apple/RNCWebViewImpl.m',
  'apple/RNCWebViewManager.h',
  'apple/RNCWebViewManager.mm',
  'apple/RNCWebViewModule.h',
  'apple/RNCWebViewModule.mm',
  'apple/RNCWKProcessPoolManager.h',
  'apple/RNCWKProcessPoolManager.m',
].sort();

export const RUNTIME_INPUTS = new Map([
  ['src/WebView.android.tsx', 'secure-webview/src/HNSecureWebView.android.tsx'],
  ['src/WebView.ios.tsx', 'secure-webview/src/HNSecureWebView.ios.tsx'],
  ['src/WebViewShared.tsx', 'secure-webview/src/HNSecureWebViewShared.tsx'],
  ['src/WebView.styles.ts', 'secure-webview/src/HNSecureWebView.styles.ts'],
  ['src/WebViewTypes.ts', 'secure-webview/src/HNSecureWebViewTypes.ts'],
]);

export const REVIEWED_INPUT_FILES = [
  ...ANDROID_INPUT_FILES,
  ...APPLE_INPUT_FILES,
  ...RUNTIME_INPUTS.keys(),
  'src/RNCWebViewNativeComponent.ts',
  'src/NativeRNCWebViewModule.ts',
  'LICENSE',
  'package.json',
  'react-native-webview.podspec',
].sort();

export const RELEASE_INTEGRITY_COMPILED_FILES = [
  'lib/commonjs/index.native.js',
  'lib/commonjs/NativeReader.native.js',
  'lib/commonjs/nativeCapability.js',
  'lib/commonjs/NativeReaderImplementation.native.js',
  'lib/module/index.native.js',
  'lib/module/NativeReader.native.js',
  'lib/module/nativeCapability.js',
  'lib/module/NativeReaderImplementation.native.js',
].sort();

const normalizeText = (value) => value.replace(/\r\n?/g, '\n');

const pathExists = async (file) => {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

const readReviewedInputBaseline = async () =>
  JSON.parse(await readFile(reviewedInputBaselinePath, 'utf8'));

const requireMarkers = (source, file, markers) => {
  const missing = markers.filter((marker) => !source.includes(marker));
  if (missing.length > 0) {
    throw new Error(
      `Refusing to stage insecure react-native-webview input: ${file} is missing ${missing.join(', ')}`,
    );
  }
};

const listFiles = async (root, prefix = '') => {
  const directory = path.join(root, prefix);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, relative)));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Unsupported source entry: ${relative}`);
  }
  return files;
};

const listTreeEntries = async (root, prefix = '') => {
  const directory = path.join(root, prefix);
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      paths.push(`D:${relative}`, ...(await listTreeEntries(root, relative)));
    } else if (entry.isFile()) {
      paths.push(`F:${relative}`);
    } else {
      throw new Error(`Unsupported source entry: ${relative}`);
    }
  }
  return paths;
};

const foliateRuntimeTreeEntries = (assetPaths) => {
  const entries = new Set(['F:manifest.json']);
  for (const assetPath of assetPaths) {
    entries.add(`F:${assetPath}`);
    const components = assetPath.split('/');
    for (let index = 1; index < components.length; index += 1) {
      entries.add(`D:${components.slice(0, index).join('/')}`);
    }
  }
  return [...entries].sort();
};

const validateFoliateNativeRuntimePath = (relativePath) => {
  if (
    typeof relativePath !== 'string' ||
    !relativePath ||
    relativePath.includes('\\') ||
    relativePath.normalize('NFC') !== relativePath ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(
      `Foliate native runtime has an unsafe asset path: ${relativePath}`,
    );
  }
};

export async function verifyIosFoliateRuntimeBundle(bundleRoot) {
  const runtimeRoot = path.join(bundleRoot, foliateNativeRuntimeDirectory);
  const manifest = await readJson(path.join(runtimeRoot, 'manifest.json'));
  if (!Array.isArray(manifest.assets)) {
    throw new Error(
      'iOS Foliate runtime manifest must declare a closure asset array',
    );
  }
  const declaredPaths = manifest.assets.map((asset) => asset.path);
  if (new Set(declaredPaths).size !== declaredPaths.length) {
    throw new Error(
      'iOS Foliate runtime manifest has duplicate closure assets',
    );
  }
  if (
    JSON.stringify([...declaredPaths].sort()) !==
    JSON.stringify(IOS_FOLIATE_RUNTIME_CLOSURE_PATHS)
  ) {
    throw new Error(
      'iOS Foliate runtime manifest has missing or extra closure assets',
    );
  }
  for (const asset of manifest.assets) {
    validateFoliateNativeRuntimePath(asset.path);
    if (
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 0
    ) {
      throw new Error(
        `iOS Foliate runtime manifest has invalid integrity metadata: ${asset.path}`,
      );
    }
    const expectedProbe = REQUIRED_FOLIATE_NATIVE_PROBE_METADATA.get(
      asset.path,
    );
    if (
      expectedProbe &&
      Object.entries(expectedProbe).some(([key, value]) => asset[key] !== value)
    ) {
      throw new Error(
        `iOS Foliate runtime manifest has invalid CSP probe metadata: ${asset.path}`,
      );
    }
    const assetPath = path.join(runtimeRoot, asset.path);
    const entry = await lstat(assetPath);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(
        `iOS Foliate runtime closure asset is not a regular file: ${asset.path}`,
      );
    }
    const contents = await readFile(assetPath);
    if (contents.length !== asset.size || sha256(contents) !== asset.sha256) {
      throw new Error(
        `iOS Foliate runtime closure asset does not match manifest: ${asset.path}`,
      );
    }
  }
  const packagedEntries = (await listTreeEntries(runtimeRoot)).sort();
  const expectedEntries = foliateRuntimeTreeEntries(declaredPaths);
  if (JSON.stringify(packagedEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error(
      'iOS Foliate runtime bundle contains missing or extra closure assets',
    );
  }
  return manifest;
}

export async function stageIosFoliateRuntimeBundle({
  runtimeRoot,
  outputRoot,
  ownership,
} = {}) {
  const safe = await assertSafeStagingPaths({
    outputRoot,
    authorityRoots: [packageRoot, runtimeRoot],
  });
  await assertOwnedStagingRoot({ outputRoot: safe.outputRoot, ownership });
  await assertSafeStagingPaths({
    outputRoot: safe.outputRoot,
    authorityRoots: safe.authorityRoots,
    mutablePaths: ['apple'],
  });
  outputRoot = safe.outputRoot;
  runtimeRoot = safe.authorityRoots[1];
  const sourceRuntimeRoot = path.join(
    runtimeRoot,
    foliateNativeRuntimeDirectory,
  );
  if (!(await pathExists(path.join(sourceRuntimeRoot, 'manifest.json')))) {
    throw new Error(
      'Foliate native runtime is required before staging the iOS resource bundle',
    );
  }
  const bundleRoot = path.join(outputRoot, iosFoliateRuntimeBundleDirectory);
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(path.dirname(bundleRoot), { recursive: true });
  await cp(
    sourceRuntimeRoot,
    path.join(bundleRoot, foliateNativeRuntimeDirectory),
    {
      recursive: true,
      dereference: false,
    },
  );
  await writeFile(
    path.join(bundleRoot, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.hamsternote.nativereader.foliate-runtime</string>
<key>CFBundleName</key><string>${iosFoliateRuntimeBundleName}</string>
<key>CFBundlePackageType</key><string>BNDL</string>
</dict></plist>
`,
  );
  await verifyIosFoliateRuntimeBundle(bundleRoot);
  return true;
}

const replaceAll = (source, search, replacement) =>
  source.split(search).join(replacement);

const namespaceSource = (source) => {
  let namespaced = normalizeText(source);
  namespaced = replaceAll(
    namespaced,
    'com.reactnativecommunity.webview',
    IMPLEMENTATION_ID,
  );
  namespaced = replaceAll(namespaced, 'RNCWKWebView', 'HNSecureWKWebView');
  namespaced = replaceAll(
    namespaced,
    'RNCWKDataDetectorTypes',
    'HNSecureWKDataDetectorTypes',
  );
  namespaced = replaceAll(
    namespaced,
    'RNCWKContentMode',
    'HNSecureWKContentMode',
  );
  namespaced = replaceAll(
    namespaced,
    'RNCWeakScriptMessageDelegate',
    'HNSecureWeakScriptMessageDelegate',
  );
  namespaced = replaceAll(
    namespaced,
    'RCTConvert (WKWebView)',
    'RCTConvert (HNSecureWKWebView)',
  );
  namespaced = replaceAll(
    namespaced,
    'DecisionBlock',
    'HNSecureWebViewDecisionBlock',
  );
  namespaced = replaceAll(namespaced, 'RNCWebView', 'HNSecureWebView');
  namespaced = replaceAll(
    namespaced,
    'RNCWebChromeClient',
    'HNSecureWebChromeClient',
  );
  namespaced = replaceAll(
    namespaced,
    'RNCWKProcessPoolManager',
    'HNSecureWKProcessPoolManager',
  );
  namespaced = replaceAll(
    namespaced,
    'RNCBasicAuthCredential',
    'HNSecureBasicAuthCredential',
  );
  namespaced = replaceAll(
    namespaced,
    'ReactNativeWebView_',
    'HNSecureWebView_',
  );
  namespaced = replaceAll(
    namespaced,
    'RNC_%@_SwizzleHelperWK',
    'HNSecure_%@_SwizzleHelperWK',
  );
  namespaced = replaceAll(
    namespaced,
    'hasPrefix:@"RNC_"',
    'hasPrefix:@"HNSecure_"',
  );
  namespaced = replaceAll(
    namespaced,
    'react-native-webview',
    'hn-secure-webview',
  );
  namespaced = replaceAll(
    namespaced,
    '${applicationId}.fileprovider',
    '${applicationId}.hn_secure_webview_fileprovider',
  );
  namespaced = replaceAll(
    namespaced,
    'packageName + ".fileprovider"',
    'packageName + ".hn_secure_webview_fileprovider"',
  );
  namespaced = replaceAll(
    namespaced,
    '@xml/file_provider_paths',
    '@xml/hn_secure_webview_file_provider_paths',
  );
  return namespaced;
};

const androidOutputPath = (sourcePath) =>
  namespaceSource(sourcePath)
    .replace(
      'com/reactnativecommunity/webview',
      'com/hamsternote/nativereader/securewebview',
    )
    .replace(
      'file_provider_paths.xml',
      'hn_secure_webview_file_provider_paths.xml',
    );

const capabilityConstantsBlock = `
    private static final Map<String, Object> CAPABILITY_CONSTANTS;

    static {
        final Map<String, Object> constants = new HashMap<>();
        constants.put("implementationId", "${IMPLEMENTATION_ID}");
        constants.put("protocolMajor", ${PROTOCOL_MAJOR});
        constants.put("implementationVersion", "${IMPLEMENTATION_VERSION}");
        constants.put("platform", "android");
        constants.put("capabilities", Collections.unmodifiableList(Arrays.asList(
                "${ANDROID_CAPABILITIES.join('",\n                "')}"
        )));
        CAPABILITY_CONSTANTS = Collections.unmodifiableMap(constants);
    }

    public static Map<String, Object> getCapabilityConstants() {
        return CAPABILITY_CONSTANTS;
    }
`;

const addCapabilityImplementation = (source, outputPath) => {
  if (outputPath.endsWith('/HNSecureWebViewModuleImpl.java')) {
    let next = source.replace(
      'import java.util.Arrays;\nimport java.util.HashMap;',
      'import java.util.Arrays;\nimport java.util.Collections;\nimport java.util.HashMap;\nimport java.util.Map;',
    );
    const anchor = `public class HNSecureWebViewModuleImpl implements ActivityEventListener {\n    public static final String NAME = "${MODULE_NAME}";`;
    if (!next.includes(anchor)) {
      throw new Error('Native module implementation anchor was not found');
    }
    next = next.replace(anchor, `${anchor}\n${capabilityConstantsBlock}`);
    return next;
  }

  if (
    outputPath.includes('/src/newarch/') &&
    outputPath.endsWith('/HNSecureWebViewModule.java')
  ) {
    let next = source.replace(
      'import com.facebook.react.module.annotations.ReactModule;\n',
      'import com.facebook.react.module.annotations.ReactModule;\n\nimport java.util.Map;\n',
    );
    const constructorSource = `    public HNSecureWebViewModule(ReactApplicationContext reactContext) {\n        super(reactContext);\n        mHNSecureWebViewModuleImpl = new HNSecureWebViewModuleImpl(reactContext);\n    }`;
    if (!next.includes(constructorSource)) {
      throw new Error('New architecture native module anchor was not found');
    }
    next = next.replace(
      constructorSource,
      `${constructorSource}\n\n    @Override\n    protected Map<String, Object> getTypedExportedConstants() {\n        return HNSecureWebViewModuleImpl.getCapabilityConstants();\n    }`,
    );
    return next;
  }

  if (
    outputPath.includes('/src/oldarch/') &&
    outputPath.endsWith('/HNSecureWebViewModule.java')
  ) {
    let next = source.replace(
      'import com.facebook.react.module.annotations.ReactModule;\n',
      'import com.facebook.react.module.annotations.ReactModule;\n\nimport java.util.Map;\n',
    );
    const constructorSource = `    public HNSecureWebViewModule(ReactApplicationContext reactContext) {\n        super(reactContext);\n        mHNSecureWebViewModuleImpl = new HNSecureWebViewModuleImpl(reactContext);\n    }`;
    if (!next.includes(constructorSource)) {
      throw new Error('Old architecture native module anchor was not found');
    }
    next = next.replace(
      constructorSource,
      `${constructorSource}\n\n    @Override\n    public Map<String, Object> getConstants() {\n        return HNSecureWebViewModuleImpl.getCapabilityConstants();\n    }`,
    );
    return next;
  }

  return source;
};

const transformAndroidSource = (source, outputPath) =>
  addCapabilityImplementation(namespaceSource(source), outputPath);

const transformAppleSource = (source, outputPath) => {
  let next = namespaceSource(source);
  if (outputPath === 'apple/HNSecureWebViewModule.mm') {
    // This one transformed source backs both module architectures. Advertise
    // the host capability only in the staged implementation which owns the
    // closed selector; an older installed binary will therefore fail the TS
    // capability gate before it can receive the selector.
    const oldArchitectureAnchor = `            @"late-callback-safe-v1"
        ]`;
    const newArchitectureAnchor = `          @"late-callback-safe-v1",
      }),`;
    if (
      !next.includes(oldArchitectureAnchor) ||
      !next.includes(newArchitectureAnchor)
    ) {
      throw new Error('Apple native capability export anchors were not found');
    }
    next = next.replace(
      oldArchitectureAnchor,
      `            @"late-callback-safe-v1",
            @"native-foliate-host-v1"
        ]`,
    );
    next = next.replace(
      newArchitectureAnchor,
      `          @"late-callback-safe-v1",
          @"native-foliate-host-v1",
      }),`,
    );
  }
  // Categories share their receiver class at link time. Renaming just a file
  // or category is insufficient: every selector supplied by the copied
  // category must also be private so an official RNWV pod cannot override it.
  next = replaceAll(
    next,
    'RCTConvert (WKDataDetectorTypes)',
    'RCTConvert (HNSecureWKDataDetectorTypes)',
  );
  next = replaceAll(
    next,
    '+ (WKDataDetectorTypes)WKDataDetectorTypes:',
    '+ (WKDataDetectorTypes)HNSecureWKDataDetectorTypes:',
  );
  next = replaceAll(
    next,
    'RCTConvert (WKWebView)',
    'RCTConvert (HNSecureWKWebView)',
  );
  if (outputPath === 'apple/HNSecureWebViewImpl.m') {
    next = next.replace(
      '#import "HNSecureWebViewDecisionManager.h"',
      '#import "HNSecureWebViewDecisionManager.h"\n#import "HNSecureWebViewReadAccessPolicy.h"',
    );
    next = next.replace(
      '@property (nonatomic, strong) WKUserScript *atEndScript;',
      '@property (nonatomic, strong) WKUserScript *atEndScript;\n#if TARGET_OS_IOS\n@property (nonatomic, strong) HNSecureWebViewReadAccessPolicy *readAccessPolicy;\n#endif // TARGET_OS_IOS',
    );
    next = next.replace(
      '    _enableApplePay = NO;',
      '    _enableApplePay = NO;\n#if TARGET_OS_IOS\n    _readAccessPolicy = [HNSecureWebViewReadAccessPolicy new];\n#endif // TARGET_OS_IOS',
    );
    next = next.replace(
      '    NSURL *baseURL = [RCTConvert NSURL:_source[@"baseUrl"]];',
      '    NSURL *baseURL = [RCTConvert NSURL:_source[@"baseUrl"]];\n#if TARGET_OS_IOS\n    NSURL *requestedBaseURL = baseURL;\n    if (baseURL.isFileURL) {\n      baseURL = [self.readAccessPolicy canonicalFileURLIfAllowed:baseURL];\n    }\n    if (!baseURL && requestedBaseURL.isFileURL) {\n      RCTLogWarn(@"HNSecureWebView refused an HTML file base URL outside reader-owned runtime/cache roots: %@", requestedBaseURL);\n    }\n#endif // TARGET_OS_IOS',
    );
    next = next.replace(
      '  NSString *allowingReadAccessToURL = _allowingReadAccessToURL;',
      '#if !TARGET_OS_IOS\n  NSString *allowingReadAccessToURL = _allowingReadAccessToURL;\n#endif // !TARGET_OS_IOS',
    );
    next = next.replace(
      '    if (request.URL.host) {\n      [webView loadRequest:request];\n    }\n    else {\n      NSURL* readAccessUrl = allowingReadAccessToURL ? [RCTConvert NSURL:allowingReadAccessToURL] : request.URL;\n      [webView loadFileURL:request.URL allowingReadAccessToURL:readAccessUrl];\n    }',
      '    if (!request.URL.isFileURL && request.URL.host) {\n      [webView loadRequest:request];\n    }\n    else {\n      NSURL *fileURL = request.URL;\n#if TARGET_OS_IOS\n      // The JS prop cannot grant filesystem access. Only reader-owned roots may.\n      fileURL = [self.readAccessPolicy canonicalFileURLIfAllowed:fileURL];\n      NSURL *readAccessUrl = [self.readAccessPolicy readAccessRootForFileURL:fileURL];\n      if (!readAccessUrl) {\n        RCTLogWarn(@"HNSecureWebView refused a file load outside reader-owned runtime/cache roots: %@", request.URL);\n        [webView loadHTMLString:@"" baseURL:nil];\n        return;\n      }\n#else\n      NSURL *readAccessUrl = allowingReadAccessToURL ? [RCTConvert NSURL:allowingReadAccessToURL] : request.URL;\n#endif // TARGET_OS_IOS\n      [webView loadFileURL:fileURL allowingReadAccessToURL:readAccessUrl];\n    }',
    );
    next = next.replace(
      '    BOOL hasTargetFrame = navigationAction.targetFrame != nil;\n',
      '    BOOL hasTargetFrame = navigationAction.targetFrame != nil;\n\n#if TARGET_OS_IOS\n    if (request.URL.isFileURL && ![self.readAccessPolicy readAccessRootForFileURL:request.URL]) {\n      RCTLogWarn(@"HNSecureWebView cancelled file navigation outside reader-owned runtime/cache roots: %@", request.URL);\n      decisionHandler(WKNavigationActionPolicyCancel);\n      return;\n    }\n#endif // TARGET_OS_IOS\n',
    );
    next = next.replace(
      '#import "HNSecureWebViewReadAccessPolicy.h"',
      '#import "HNSecureWebViewReadAccessPolicy.h"\n#import "HNSecureFoliateHostRelay.h"',
    );
    next = next.replace(
      '@property (nonatomic, strong) HNSecureWebViewReadAccessPolicy *readAccessPolicy;',
      '@property (nonatomic, strong) HNSecureWebViewReadAccessPolicy *readAccessPolicy;\n@property (nonatomic, strong) HNSecureFoliateHostRelay *foliateHostRelay;\n@property (nonatomic, copy, nullable) NSURL *secureFoliateHostURL;\n@property (nonatomic, assign) BOOL secureFoliateHostRequested;',
    );
    next = next.replace(
      '_readAccessPolicy = [HNSecureWebViewReadAccessPolicy new];',
      '_readAccessPolicy = [HNSecureWebViewReadAccessPolicy new];\n    _foliateHostRelay = [HNSecureFoliateHostRelay new];',
    );
    next = next.replace(
      '    _source = [source copy];\n\n    if (_webView != nil) {',
      '    _source = [source copy];\n#if TARGET_OS_IOS\n    NSURL *requestedURL = [RCTConvert NSURL:_source[@"uri"]];\n    _secureFoliateHostURL = [self.readAccessPolicy canonicalRuntimeHostURLIfAllowed:requestedURL];\n    _secureFoliateHostRequested = _secureFoliateHostURL != nil;\n    if (_webView != nil) [self resetupScripts:_webView.configuration];\n#endif // TARGET_OS_IOS\n\n    if (_webView != nil) {',
    );
    next = next.replace(
      '      [webView loadFileURL:fileURL allowingReadAccessToURL:readAccessUrl];',
      '      if (_secureFoliateHostRequested) {\n        if (![fileURL isEqual:_secureFoliateHostURL]) { [webView loadHTMLString:@"" baseURL:nil]; return; }\n        [_foliateHostRelay activateForWebView:webView hostURL:fileURL];\n      }\n      [webView loadFileURL:fileURL allowingReadAccessToURL:readAccessUrl];',
    );
    next = next.replace(
      '{\n  if (!navigationAction.targetFrame.isMainFrame) {',
      '{\n#if TARGET_OS_IOS\n  if (_secureFoliateHostRequested) return nil;\n#endif // TARGET_OS_IOS\n  if (!navigationAction.targetFrame.isMainFrame) {',
    );
    next = next.replace(
      '- (void)postMessage:(NSString *)message\n{\n  NSDictionary *eventInitDict = @{@"data": message};',
      '- (void)postMessage:(NSString *)message\n{\n#if TARGET_OS_IOS\n  if (_secureFoliateHostRequested) { [_foliateHostRelay sendNativeMessageData:message ?: @""]; return; }\n#endif // TARGET_OS_IOS\n  NSDictionary *eventInitDict = @{@"data": message};',
    );
    next = next.replace(
      '    BOOL hasTargetFrame = navigationAction.targetFrame != nil;\n\n#if TARGET_OS_IOS',
      '    BOOL hasTargetFrame = navigationAction.targetFrame != nil;\n\n#if TARGET_OS_IOS\n    if (_secureFoliateHostRequested && (!isTopFrame || !hasTargetFrame || ![_foliateHostRelay isExpectedHostURL:request.URL])) {\n      decisionHandler(WKNavigationActionPolicyCancel);\n      return;\n    }',
    );
    next = next.replace(
      '  WKNavigationResponsePolicy policy = WKNavigationResponsePolicyAllow;\n',
      '  WKNavigationResponsePolicy policy = WKNavigationResponsePolicyAllow;\n#if TARGET_OS_IOS\n  if (_secureFoliateHostRequested) { decisionHandler(WKNavigationResponsePolicyCancel); return; }\n#endif // TARGET_OS_IOS\n',
    );
    next = next.replace(
      '- (void)injectJavaScript:(NSString *)script\n{\n  [self evaluateJS: script thenCall: nil];',
      '- (void)injectJavaScript:(NSString *)script\n{\n#if TARGET_OS_IOS\n  if (_secureFoliateHostRequested) return;\n#endif // TARGET_OS_IOS\n  [self evaluateJS: script thenCall: nil];',
    );
    next = next.replace(
      '  [wkWebViewConfig.userContentController removeScriptMessageHandlerForName:MessageHandlerName];\n  if(self.enableApplePay){',
      '  [wkWebViewConfig.userContentController removeScriptMessageHandlerForName:MessageHandlerName];\n#if TARGET_OS_IOS\n  [_foliateHostRelay removeFromUserContentController:wkWebViewConfig.userContentController];\n  if (_secureFoliateHostRequested) { [_foliateHostRelay installInUserContentController:wkWebViewConfig.userContentController]; return; }\n#endif // TARGET_OS_IOS\n  if(self.enableApplePay){',
    );
  }
  return next;
};

const nativeHostSourceContract = `export interface WebViewNativeHostSource {
  nativeHost: 'foliate';
  uri?: never;
  html?: never;
  headers?: never;
  body?: never;
  method?: never;
  baseUrl?: never;
  path?: never;
  platform?: never;
}

export function getWebViewNativeHostSource(source: unknown): WebViewNativeHostSource | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(source, 'nativeHost');
  if (!descriptor) return undefined;
  if (!('value' in descriptor) || descriptor.value !== 'foliate') {
    throw new Error('HNSecureWebView received an unknown native host selector');
  }
  if (
    (Object.getPrototypeOf(source) !== Object.prototype && Object.getPrototypeOf(source) !== null) ||
    !Reflect.ownKeys(source).every((key) => key === 'nativeHost')
  ) {
    throw new Error('HNSecureWebView native host selector cannot be combined with a publication source');
  }
  return { nativeHost: 'foliate' };
}

export function resolveWebViewSource(source: unknown, resolveAssetSource: (source: unknown) => unknown) {
  const nativeHostSource = getWebViewNativeHostSource(source);
  if (nativeHostSource) {
    return {
      nativeHostSource,
      sourceResolved: nativeHostSource,
      newSource: { nativeHost: nativeHostSource.nativeHost },
    };
  }
  const sourceResolved = resolveAssetSource(source);
  const newSource =
    typeof sourceResolved === 'object' && sourceResolved !== null
      ? Object.entries(sourceResolved as WebViewSourceUri).reduce(
          (previous, [key, value]) => ({
            ...previous,
            [key]: key === 'headers' && value && typeof value === 'object'
              ? Object.entries(value).map(([name, headerValue]) => ({ name, value: headerValue }))
              : value,
          }),
          {},
        )
      : sourceResolved;
  return { nativeHostSource: undefined, sourceResolved, newSource };
}

export function secureNativeHostProps(nativeConfigProps: object | undefined) {
  const safeNativeConfigProps = { ...(nativeConfigProps as Record<string, unknown>) };
  delete safeNativeConfigProps.source;
  delete safeNativeConfigProps.newSource;
  delete safeNativeConfigProps.nativeHost;
  return safeNativeConfigProps;
}

export function selectNativeWebViewComponent<T>(nativeConfigComponent: T | undefined, nativeHostSource: WebViewNativeHostSource | undefined): T | undefined {
  return nativeHostSource ? undefined : nativeConfigComponent;
}

export type WebViewSource = WebViewSourceUri | WebViewSourceHtml | WebViewNativeHostSource;`;

const upstreamSourceResolutionBlock = `const sourceResolved = resolveAssetSource(source as ImageSourcePropType);
    const newSource =
      typeof sourceResolved === 'object'
        ? Object.entries(sourceResolved as WebViewSourceUri).reduce(
            (prev, [currKey, currValue]) => {
              return {
                ...prev,
                [currKey]:
                  currKey === 'headers' &&
                  currValue &&
                  typeof currValue === 'object'
                    ? Object.entries(currValue).map(([key, value]) => {
                        return {
                          name: key,
                          value,
                        };
                      })
                    : currValue,
              };
            },
            {}
          )
        : sourceResolved;`;

const secureSourceResolutionBlock = `const { nativeHostSource, sourceResolved, newSource } = resolveWebViewSource(
      source,
      (value) => resolveAssetSource(value as ImageSourcePropType),
    );`;

const transformRuntimeSource = (source, outputPath) => {
  let next = namespaceSource(source);
  next = replaceAll(next, './WebViewShared', './HNSecureWebViewShared');
  next = replaceAll(next, './WebView.styles', './HNSecureWebView.styles');
  next = replaceAll(next, './WebViewTypes', './HNSecureWebViewTypes');
  if (outputPath.endsWith('/HNSecureWebViewTypes.ts')) {
    next = next.replace(
      'export type WebViewSource = WebViewSourceUri | WebViewSourceHtml;',
      nativeHostSourceContract,
    );
  }
  if (
    outputPath.endsWith('/HNSecureWebView.android.tsx') ||
    outputPath.endsWith('/HNSecureWebView.ios.tsx')
  ) {
    next = next.replace(
      '  WebViewSourceUri,',
      '  resolveWebViewSource,\n  secureNativeHostProps,\n  selectNativeWebViewComponent,',
    );
    next = next.replace(
      upstreamSourceResolutionBlock,
      secureSourceResolutionBlock,
    );
    next = next.replace(
      `(nativeConfig?.component as typeof HNSecureWebView | undefined) || HNSecureWebView`,
      `selectNativeWebViewComponent(\n        nativeConfig?.component as typeof HNSecureWebView | undefined,\n        nativeHostSource,\n      ) || HNSecureWebView`,
    );
    next = next.replace(
      'newSource={newSource}',
      "newSource={newSource as NativeProps['newSource']}",
    );
    next = next.replace(
      '{...nativeConfig?.props}',
      '{...secureNativeHostProps(nativeConfig?.props)}',
    );
  }
  // Babel embeds the upstream CI checkout path in development JSX metadata.
  // Replace it rather than publishing an absolute, source-specific path.
  next = next.replace(/_jsxFileName="[^"]+"/g, `_jsxFileName="${outputPath}"`);
  return next;
};

const transformModuleSpec = (source) => {
  let next = namespaceSource(source);
  next = next.replace(
    "import { Double } from 'react-native/Libraries/Types/CodegenTypes';",
    "import { Double, Int32 } from 'react-native/Libraries/Types/CodegenTypes';",
  );
  if (!next.includes('getConstants(): NativeCapabilityConstants;')) {
    next = next.replace(
      'export interface Spec extends TurboModule {',
      `export type NativeCapabilityConstants = Readonly<{\n  implementationId: string;\n  protocolMajor: Int32;\n  implementationVersion: string;\n  platform: string;\n  capabilities: ReadonlyArray<string>;\n}>;\n\nexport interface Spec extends TurboModule {\n  getConstants(): NativeCapabilityConstants;`,
    );
  }
  requireMarkers(next, 'NativeHNSecureWebViewModule.ts', [
    'getConstants(): NativeCapabilityConstants;',
    `TurboModuleRegistry.getEnforcing<Spec>('${MODULE_NAME}')`,
  ]);
  return next;
};

export async function verifyReviewedInputBaseline(sourceRoot) {
  const baseline = await readReviewedInputBaseline();
  const baselineFiles = Object.keys(baseline);
  if (JSON.stringify(baselineFiles) !== JSON.stringify(REVIEWED_INPUT_FILES)) {
    throw new Error(
      'Reviewed input SHA-256 baseline does not exactly cover the release input set',
    );
  }

  for (const relativePath of REVIEWED_INPUT_FILES) {
    const source = normalizeText(
      await readFile(path.join(sourceRoot, relativePath), 'utf8'),
    );
    const actual = sha256(source);
    if (actual !== baseline[relativePath]) {
      throw new Error(
        `Reviewed input SHA-256 mismatch for ${relativePath}: expected=${baseline[relativePath]} actual=${actual}`,
      );
    }
  }
}

const verifyInput = async (sourceRoot) => {
  await verifyReviewedInputBaseline(sourceRoot);
  const manifest = await readJson(path.join(sourceRoot, 'package.json'));
  if (
    manifest.name !== 'react-native-webview' ||
    manifest.version !== '13.16.1' ||
    manifest.license !== 'MIT'
  ) {
    throw new Error(
      'Refusing to stage an unexpected react-native-webview package',
    );
  }

  const actualAndroidFiles = (await listFiles(path.join(sourceRoot, 'android')))
    .map((file) => `android/${file}`)
    .sort();
  if (
    JSON.stringify(actualAndroidFiles) !== JSON.stringify(ANDROID_INPUT_FILES)
  ) {
    const allowed = new Set(ANDROID_INPUT_FILES);
    const actual = new Set(actualAndroidFiles);
    const added = actualAndroidFiles.filter((file) => !allowed.has(file));
    const missing = ANDROID_INPUT_FILES.filter((file) => !actual.has(file));
    throw new Error(
      `Unexpected Android input tree; added=${added.join(',') || 'none'} missing=${missing.join(',') || 'none'}`,
    );
  }

  const client = await readFile(
    path.join(
      sourceRoot,
      'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java',
    ),
    'utf8',
  );
  requireMarkers(client, 'RNCWebViewClient.java', [
    'return shouldOverrideUrlLoadingForMainFrame(view, url);',
    'if (!request.isForMainFrame())',
    'return failClosed;',
    'Thread.currentThread().interrupt();',
    'removeLock(lockIdentifier)',
  ]);

  const view = await readFile(
    path.join(
      sourceRoot,
      'android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java',
    ),
    'utf8',
  );
  requireMarkers(view, 'RNCWebView.java', [
    'failClosedOnShouldStartLoadWithRequest = false',
    'getFailClosedOnShouldStartLoadWithRequest()',
  ]);

  const manager = await readFile(
    path.join(
      sourceRoot,
      'android/src/newarch/com/reactnativecommunity/webview/RNCWebViewManager.java',
    ),
    'utf8',
  );
  requireMarkers(manager, 'newarch/RNCWebViewManager.java', [
    '@ReactProp(name = "failClosedOnShouldStartLoadWithRequest", defaultBoolean = false)',
  ]);

  const androidJs = await readFile(
    path.join(sourceRoot, 'src/WebView.android.tsx'),
    'utf8',
  );
  requireMarkers(androidJs, 'src/WebView.android.tsx', [
    'failClosedOnShouldStartLoadWithRequest',
    'RNCWebViewMessagingModule',
  ]);

  const componentSpec = await readFile(
    path.join(sourceRoot, 'src/RNCWebViewNativeComponent.ts'),
    'utf8',
  );
  requireMarkers(componentSpec, 'src/RNCWebViewNativeComponent.ts', [
    'failClosedOnShouldStartLoadWithRequest?: WithDefault<boolean, false>',
    "codegenNativeComponent<NativeProps>(\n  'RNCWebView'",
  ]);

  const appleModule = await readFile(
    path.join(sourceRoot, 'apple/RNCWebViewModule.mm'),
    'utf8',
  );
  requireMarkers(appleModule, 'apple/RNCWebViewModule.mm', [
    'constantsToExport',
    '@"platform": @"ios"',
    // native-foliate-host-v1 is product-owned and injected during staging;
    // the reviewed upstream input necessarily predates that capability.
    ...IOS_CAPABILITIES.filter(
      (capability) => capability !== 'native-foliate-host-v1',
    ),
  ]);
};

const verifyCapabilityAbi = async (capabilityRoot = packageRoot) => {
  const source = await readFile(
    path.join(capabilityRoot, 'src/nativeCapability.ts'),
    'utf8',
  );
  requireMarkers(source, 'src/nativeCapability.ts', [
    `'${MODULE_NAME}'`,
    `'${IMPLEMENTATION_ID}'`,
    `NATIVE_CAPABILITY_PROTOCOL_MAJOR = ${PROTOCOL_MAJOR}`,
    `'${IMPLEMENTATION_VERSION}'`,
    // The JS gate deliberately requires this capability before selecting the
    // closed source. Do not add it to staged native constants until native
    // host implementation owns and advertises it; otherwise staging would lie
    // about an unsupported binary.
    "'native-foliate-host-v1'",
    ...ANDROID_CAPABILITIES.map((capability) => `'${capability}'`),
    ...IOS_CAPABILITIES.map((capability) => `'${capability}'`),
  ]);
};

const verifyOwnedDirectory = async (root, directory) => {
  if (!(await pathExists(directory))) return;
  if (!(await pathExists(path.join(directory, generatedMarker)))) {
    throw new Error(
      `Refusing to replace unowned staging directory: ${directory}`,
    );
  }
  const relative = path.relative(root, directory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Staging directory escaped output root: ${directory}`);
  }
};

const verifyOwnedCoreAdapters = async (outputRoot) =>
  Promise.all(
    coreAdapterRelativePaths.map(async (relativePath) => {
      const adapter = path.join(outputRoot, relativePath);
      if (!(await pathExists(adapter))) return undefined;
      if (
        !(await readFile(adapter, 'utf8')).startsWith(
          `// Generated by ${generatorName}.`,
        )
      ) {
        throw new Error(`Refusing to remove unowned core adapter: ${adapter}`);
      }
      return adapter;
    }),
  );

const verifyOwnedIntegrityManifest = async (outputRoot) => {
  const manifestPath = path.join(outputRoot, manifestName);
  if (!(await pathExists(manifestPath))) return undefined;
  const manifest = await readJson(manifestPath);
  if (manifest.generator !== generatorName) {
    throw new Error(`Refusing to remove unowned integrity manifest`);
  }
  return manifestPath;
};

const verifyOwnedAppleFile = async (outputRoot, relativePath) => {
  const file = path.join(outputRoot, relativePath);
  if (!(await pathExists(file))) return undefined;
  if (
    !(await readFile(file, 'utf8')).includes(`Generated by ${generatorName}`)
  ) {
    throw new Error(
      `Refusing to remove unowned Apple staging file: ${relativePath}`,
    );
  }
  return file;
};

export async function cleanSecureWebView(plan = {}) {
  // API 不接受只有 output 的不完整计划；验证发生在任何 ownership 读取或 rm 前。
  const { outputRoot } = await assertStagingPlan(plan);
  const android = path.join(outputRoot, 'android');
  const apple = path.join(outputRoot, 'apple');
  const runtime = path.join(outputRoot, 'secure-webview');
  // Complete every ownership check before deleting anything. This makes a
  // foreign adapter/manifest failure non-destructive and lets the parent
  // lifecycle safely stop before removing lib/vendor/core.
  await verifyOwnedDirectory(outputRoot, android);
  await verifyOwnedDirectory(outputRoot, apple);
  await verifyOwnedDirectory(outputRoot, runtime);
  const adapters = await verifyOwnedCoreAdapters(outputRoot);
  const manifestPath = await verifyOwnedIntegrityManifest(outputRoot);
  const applePodspec = await verifyOwnedAppleFile(outputRoot, applePodspecName);
  const autolinkConfig = await verifyOwnedAppleFile(
    outputRoot,
    autolinkConfigName,
  );

  const removals = [
    { target: android, options: { recursive: true, force: true } },
    { target: apple, options: { recursive: true, force: true } },
    { target: runtime, options: { recursive: true, force: true } },
    {
      target: path.join(outputRoot, appleFaultMatrixDirectory),
      options: { recursive: true, force: true },
    },
  ];
  for (const adapter of adapters) {
    if (adapter) removals.push({ target: adapter, options: { force: true } });
  }
  if (manifestPath) removals.push({ target: manifestPath, options: undefined });
  if (applePodspec) removals.push({ target: applePodspec, options: undefined });
  if (autolinkConfig)
    removals.push({ target: autolinkConfig, options: undefined });

  // 等全部删除 settle 后再决定成败：不能用 Promise.all 在第一个删除失败时
  // 立即抛错，否则其余删除仍在进行，调用方（release 生命周期、下一个 staging）
  // 会带着“清理尚未结束”的状态继续，与仍在进行的删除/写入互相踩踏。
  const results = await Promise.allSettled(
    removals.map(({ target, options }) => rm(target, options)),
  );
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Secure WebView cleanup was incomplete');
  }
}

const writeGenerated = async (outputRoot, relativePath, source) => {
  const destination = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, normalizeText(source));
};

const finalAndroidIntegrityFiles = new Set(
  STAGED_SECURE_WEBVIEW_INTEGRITY_FILES.map(
    ({ manifestPath }) => manifestPath,
  ).filter((manifestPath) => manifestPath.startsWith('android/src/')),
);

const stageAndroid = async (sourceRoot, outputRoot, productSourceRoot) => {
  await writeGenerated(
    outputRoot,
    `android/${generatedMarker}`,
    `${generatorName}\n`,
  );
  for (const inputPath of ANDROID_INPUT_FILES) {
    const outputPath = androidOutputPath(inputPath);
    // Final Android hosts carry product security hardening that cannot be
    // reconstructed safely from upstream. Stage the reviewed final bytes.
    const source = finalAndroidIntegrityFiles.has(outputPath)
      ? await readFile(path.join(productSourceRoot, outputPath), 'utf8')
      : await readFile(path.join(sourceRoot, inputPath), 'utf8');
    await writeGenerated(
      outputRoot,
      outputPath,
      finalAndroidIntegrityFiles.has(outputPath)
        ? source
        : transformAndroidSource(source, outputPath),
    );
  }
  await writeGenerated(
    outputRoot,
    'android/fault-matrix/HNSecureWebViewClientFaultMatrixTest.java',
    await readFile(
      path.join(
        productSourceRoot,
        'android-fault-matrix/harness/src/test/java/com/hamsternote/nativereader/securewebview/HNSecureWebViewClientFaultMatrixTest.java',
      ),
      'utf8',
    ),
  );
};

const stageApple = async (
  sourceRoot,
  outputRoot,
  runtimeRoot,
  productSourceRoot,
  ownership,
) => {
  // The isolated relay is product-owned security code, not an upstream patch.
  // Preserve the reviewed implementation verbatim in every staged Pod.
  const secureFoliateImplementation = await readFile(
    path.join(productSourceRoot, 'apple/HNSecureWebViewImpl.m'),
    'utf8',
  );
  await writeGenerated(
    outputRoot,
    `apple/${generatedMarker}`,
    `${generatorName}\n`,
  );
  for (const inputPath of APPLE_INPUT_FILES) {
    const outputPath = namespaceSource(inputPath);
    const source =
      outputPath === 'apple/HNSecureWebViewManager.mm'
        ? await readFile(path.join(productSourceRoot, outputPath), 'utf8')
        : transformAppleSource(
            await readFile(path.join(sourceRoot, inputPath), 'utf8'),
            outputPath,
          );
    await writeGenerated(outputRoot, outputPath, source);
  }
  await writeGenerated(
    outputRoot,
    'apple/HNSecureWebViewImpl.m',
    secureFoliateImplementation,
  );
  // The private relay is product-owned code rather than a transformed upstream
  // source. Copy it into every staging root so CocoaPods compiles the same
  // named-world implementation that the workspace contract tests inspect.
  for (const relayFile of appleFoliateRelayFiles) {
    await writeGenerated(
      outputRoot,
      `apple/${relayFile}`,
      await readFile(path.join(productSourceRoot, 'apple', relayFile), 'utf8'),
    );
  }
  // The relay's canonical-host policy is compiled by HNSecureWebViewImpl.
  // Copy these Apple-owned inputs so staging verifies the exact Pod sources.
  for (const policyFile of [
    'HNSecureWebViewReadAccessPolicy.h',
    'HNSecureWebViewReadAccessPolicy.m',
  ]) {
    await writeGenerated(
      outputRoot,
      `apple/${policyFile}`,
      await readFile(path.join(productSourceRoot, 'apple', policyFile), 'utf8'),
    );
  }
  const appleFaultContents = await readFile(
    path.join(productSourceRoot, appleFaultRelativePath),
    'utf8',
  );
  await writeGenerated(outputRoot, appleFaultRelativePath, appleFaultContents);
  ownedAppleFaultFiles.set(
    ownership,
    sha256(normalizeText(appleFaultContents)),
  );
  await stageIosFoliateRuntimeBundle({ runtimeRoot, outputRoot, ownership });
  await writeGenerated(
    outputRoot,
    'HNSecureWebView.podspec',
    await readFile(
      path.join(productSourceRoot, 'HNSecureWebView.podspec'),
      'utf8',
    ),
  );
  await writeGenerated(
    outputRoot,
    'react-native.config.js',
    `// Generated by ${generatorName}. Do not edit.\n'use strict';\n\nmodule.exports = {\n  dependency: {\n    platforms: {\n      ios: { podspecPath: 'HNSecureWebView.podspec' },\n      android: { sourceDir: 'android' },\n    },\n  },\n};\n`,
  );
};

const stagedNativeHostSourcePaths = new Set([
  'secure-webview/src/HNSecureWebView.android.tsx',
  'secure-webview/src/HNSecureWebView.ios.tsx',
  'secure-webview/src/HNSecureWebViewTypes.ts',
  'secure-webview/src/HNSecureWebViewNativeComponent.ts',
]);

const stageRuntime = async (sourceRoot, outputRoot, productSourceRoot) => {
  await writeGenerated(
    outputRoot,
    `secure-webview/${generatedMarker}`,
    `${generatorName}\n`,
  );
  for (const [inputPath, outputPath] of RUNTIME_INPUTS) {
    // Native-host source is product-owned codegen input. Copy its reviewed
    // bytes verbatim so the root integrity closure and an isolated package
    // stage share one source of truth rather than merely similar transforms.
    const source = stagedNativeHostSourcePaths.has(outputPath)
      ? await readFile(path.join(productSourceRoot, outputPath), 'utf8')
      : await readFile(path.join(sourceRoot, inputPath), 'utf8');
    await writeGenerated(
      outputRoot,
      outputPath,
      stagedNativeHostSourcePaths.has(outputPath)
        ? source
        : transformRuntimeSource(source, outputPath),
    );
  }

  await writeGenerated(
    outputRoot,
    'secure-webview/src/HNSecureWebViewNativeComponent.ts',
    await readFile(
      path.join(
        productSourceRoot,
        'secure-webview/src/HNSecureWebViewNativeComponent.ts',
      ),
      'utf8',
    ),
  );
  await writeGenerated(
    outputRoot,
    'secure-webview/src/NativeHNSecureWebViewModule.ts',
    transformModuleSpec(
      await readFile(
        path.join(sourceRoot, 'src/NativeRNCWebViewModule.ts'),
        'utf8',
      ),
    ),
  );

  await writeGenerated(
    outputRoot,
    'secure-webview/index.js',
    `'use strict';\n\nconst moduleValue = require('./src/HNSecureWebView');\nconst HNSecureWebView = moduleValue.default ?? moduleValue;\n\nexports.HNSecureWebView = HNSecureWebView;\nexports.WebView = HNSecureWebView;\nexports.default = HNSecureWebView;\n`,
  );
  await writeGenerated(
    outputRoot,
    'secure-webview/package.json',
    `${JSON.stringify(
      {
        name: '@hamster-note/native-reader-secure-webview',
        version: IMPLEMENTATION_VERSION,
        main: './index.js',
        'react-native': './index.js',
        license: 'MIT',
      },
      null,
      2,
    )}\n`,
  );
  await writeGenerated(
    outputRoot,
    'secure-webview/LICENSE',
    await readFile(path.join(sourceRoot, 'LICENSE'), 'utf8'),
  );
  // XCTest consumes the raw corpus from the packaged secure-webview directory;
  // it must be staged and integrity-hashed rather than reconstructed by tests.
  await writeGenerated(
    outputRoot,
    foliateHostWireCorpus,
    await readFile(path.join(productSourceRoot, foliateHostWireCorpus), 'utf8'),
  );
};

const stageCoreAdapter = async (coreRoot, outputRoot) => {
  const source = normalizeText(
    await readFile(path.join(coreRoot, 'lib/commonjs/View.js'), 'utf8'),
  );
  const external = 'var _reactNativeWebview = require("react-native-webview");';
  if (!source.includes(external)) {
    throw new Error('Patched core Android WebView import anchor was not found');
  }
  for (const relativePath of coreAdapterRelativePaths) {
    let adapter = source.replace(
      external,
      'var _hnSecureWebView = require("../../../secure-webview");',
    );
    adapter = replaceAll(adapter, '_reactNativeWebview', '_hnSecureWebView');
    adapter = replaceAll(adapter, 'react-native-webview', 'the native WebView');
    adapter = `// Generated by ${generatorName}. Do not edit.\n${adapter}`;
    requireMarkers(adapter, relativePath, [
      'require("../../../secure-webview")',
      '_hnSecureWebView.WebView',
      'failClosedOnShouldStartLoadWithRequest: true',
    ]);
    if (adapter.includes('require("react-native-webview")')) {
      throw new Error(`${relativePath} must not require react-native-webview`);
    }
    await writeGenerated(outputRoot, relativePath, adapter);
  }
};

// Staging writers 并发写入 android/、secure-webview/ 与 lib/vendor/core。
// 通过 stageSecureWebView 的 writers 选项可注入替身，用于回归覆盖
// “一个 writer 快速失败、另一个延迟写入”的失败清理竞态。
export const DEFAULT_STAGING_WRITERS = [
  {
    name: 'android',
    run: async (context) => {
      const { sourceRoot, outputRoot, productSourceRoot } =
        await assertStagingPlan(context, { checkAppleFault: false });
      await stageAndroid(sourceRoot, outputRoot, productSourceRoot);
    },
  },
  {
    name: 'runtime',
    run: async (context) => {
      const { sourceRoot, outputRoot, productSourceRoot } =
        await assertStagingPlan(context, { checkAppleFault: false });
      await stageRuntime(sourceRoot, outputRoot, productSourceRoot);
    },
  },
  {
    name: 'apple',
    run: async (context) => {
      const {
        sourceRoot,
        outputRoot,
        runtimeRoot,
        productSourceRoot,
        ownership,
      } = await assertStagingPlan(context);
      await stageApple(
        sourceRoot,
        outputRoot,
        runtimeRoot,
        productSourceRoot,
        ownership,
      );
    },
  },
  {
    name: 'core-adapter',
    run: async (context) => {
      const { coreRoot, outputRoot } = await assertStagingPlan(context, {
        checkAppleFault: false,
      });
      await stageCoreAdapter(coreRoot, outputRoot);
    },
  },
];

const runStagingWriters = async (writers, context) => {
  // allSettled（而不是 all）：任一 writer 快速失败时，必须等其余 writer
  // 全部 settle 才能把错误交给调用方。否则失败清理会与仍在进行的延迟写入
  // 竞争，导致清理后 staging 内容被重新写回/残留。
  const results = await Promise.allSettled(
    writers.map((writer) => Promise.resolve().then(() => writer.run(context))),
  );
  const failures = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      failures.push({
        label: writers[index]?.name ?? `writer#${index}`,
        error: result.reason,
      });
    }
  });
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0].error;
  throw new AggregateError(
    failures.map(({ error }) => error),
    `Secure WebView staging writers failed: ${failures
      .map(({ label }) => label)
      .join(', ')}`,
    { cause: failures[0].error },
  );
};

// 失败清理：调用前必须保证所有 writer 已经 settle（runStagingWriters 已保证）。
// 清理失败与 staging 失败一起聚合成 AggregateError，避免掩盖原始错误。
const cleanupFailedStaging = async (plan, stagingError) => {
  const cleanupFailures = [];
  try {
    await cleanSecureWebView(plan);
  } catch (cleanupError) {
    cleanupFailures.push(cleanupError);
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      [stagingError, ...cleanupFailures],
      'Secure WebView staging failed and cleanup was incomplete',
      { cause: stagingError },
    );
  }
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export async function collectIntegrityEntries(
  outputRoot,
  { sourceLayout = false } = {},
) {
  const files = {};
  for (const {
    manifestPath,
    sourcePath = manifestPath,
  } of STAGED_SECURE_WEBVIEW_INTEGRITY_FILES) {
    const relativePath = sourceLayout ? sourcePath : manifestPath;
    files[manifestPath] = sha256(
      await readFile(path.join(outputRoot, relativePath)),
    );
  }
  return files;
}

const createIntegrityManifest = async (outputRoot, options) => ({
  schemaVersion: 1,
  generator: generatorName,
  source: { name: 'react-native-webview', version: '13.16.1' },
  implementationId: IMPLEMENTATION_ID,
  implementationVersion: IMPLEMENTATION_VERSION,
  protocolMajor: PROTOCOL_MAJOR,
  files: await collectIntegrityEntries(outputRoot, options),
});

const requireIntegrityManifestMetadata = (manifest) => {
  const expected = {
    schemaVersion: 1,
    generator: generatorName,
    source: { name: 'react-native-webview', version: '13.16.1' },
    implementationId: IMPLEMENTATION_ID,
    implementationVersion: IMPLEMENTATION_VERSION,
    protocolMajor: PROTOCOL_MAJOR,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(manifest?.[key]) !== JSON.stringify(value)) {
      throw new Error(`Secure WebView integrity manifest has invalid ${key}`);
    }
  }
};

// Local staging manifests are disposable outputs. This exported helper refuses
// the workspace root; root generation is intentionally CLI-private below.
export async function generateStagedIntegrityManifest(
  outputRoot,
  { sourceLayout = false, ownership } = {},
) {
  if (!outputRoot || samePath(outputRoot, packageRoot)) {
    throw new Error(
      'Root integrity manifest generation requires --generate-integrity-manifest',
    );
  }
  const safe = await assertSafeStagingPaths({
    outputRoot,
    authorityRoots: [packageRoot],
  });
  outputRoot = safe.outputRoot;
  await assertOwnedStagingRoot({ outputRoot, ownership });
  await assertSafeStagingPaths({
    outputRoot,
    authorityRoots: safe.authorityRoots,
    mutablePaths: [manifestName],
  });
  const manifest = await createIntegrityManifest(outputRoot, { sourceLayout });
  await writeGenerated(
    outputRoot,
    manifestName,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export async function verifyIntegrityManifest(
  outputRoot = packageRoot,
  { sourceLayout = false } = {},
) {
  const manifestPath = path.join(outputRoot, manifestName);
  let manifest;
  try {
    manifest = await readJson(manifestPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `Secure WebView integrity manifest is missing: ${manifestName}`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
  requireIntegrityManifestMetadata(manifest);
  if (
    !manifest.files ||
    typeof manifest.files !== 'object' ||
    Array.isArray(manifest.files)
  ) {
    throw new Error('Secure WebView integrity manifest has no files map');
  }

  const expectedFiles = await collectIntegrityEntries(outputRoot, {
    sourceLayout,
  });
  const declaredPaths = Object.keys(manifest.files);
  const actualPaths = Object.keys(expectedFiles);
  if (JSON.stringify(declaredPaths) !== JSON.stringify(actualPaths)) {
    throw new Error(
      `Secure WebView integrity manifest coverage mismatch: declared=${JSON.stringify(declaredPaths)} actual=${JSON.stringify(actualPaths)}`,
    );
  }
  for (const relativePath of declaredPaths) {
    const declaredHash = manifest.files[relativePath];
    if (!/^[a-f0-9]{64}$/.test(declaredHash)) {
      throw new Error(
        `Secure WebView integrity manifest has invalid SHA-256: ${relativePath}`,
      );
    }
    if (declaredHash !== expectedFiles[relativePath]) {
      throw new Error(
        `Secure WebView SHA-256 mismatch for ${relativePath}: expected=${declaredHash} actual=${expectedFiles[relativePath]}`,
      );
    }
  }
  return manifest;
}

// A fresh isolated staging tree must reproduce the security-sensitive sources
// already approved in the root manifest. Compare bytes as well as hashes: the
// manifest proves the root, while byte equality proves the generator output.
export async function verifyStagedIntegrityReference({
  outputRoot,
  referenceRoot = packageRoot,
} = {}) {
  const reference = await verifyIntegrityManifest(referenceRoot, {
    sourceLayout: true,
  });
  const stagedEntries = await collectIntegrityEntries(outputRoot);
  const paths = Object.keys(stagedEntries);
  for (const manifestPath of paths) {
    const { sourcePath = manifestPath } =
      STAGED_SECURE_WEBVIEW_INTEGRITY_FILES.find(
        (entry) => entry.manifestPath === manifestPath,
      );
    if (
      !(manifestPath in reference.files) ||
      !(manifestPath in stagedEntries)
    ) {
      throw new Error(
        `Secure WebView staged integrity reference is missing ${manifestPath}`,
      );
    }
    if (reference.files[manifestPath] !== stagedEntries[manifestPath]) {
      throw new Error(
        `Secure WebView staged integrity hash mismatch for ${manifestPath}: expected=${reference.files[manifestPath]} actual=${stagedEntries[manifestPath]}`,
      );
    }
    const [referenceContents, stagedContents] = await Promise.all([
      readFile(path.join(referenceRoot, sourcePath)),
      readFile(path.join(outputRoot, manifestPath)),
    ]);
    if (!referenceContents.equals(stagedContents)) {
      throw new Error(
        `Secure WebView staged integrity bytes mismatch for ${manifestPath}`,
      );
    }
  }
  return paths;
}

// Only isolated staging calls this writer. It is deliberately not exported and
// refuses the workspace root so ordinary programmatic calls cannot bless it.
const writeStagedIntegrityManifest = async (plan) => {
  // writer 完成后再次检查可变子树；生成 manifest 不能跟随后来出现的链接。
  const { outputRoot } = await assertStagingPlan(plan);
  const manifest = await createIntegrityManifest(outputRoot);
  await writeGenerated(
    outputRoot,
    manifestName,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
};

const generateRootIntegrityManifest = async (capability) => {
  if (capability !== ROOT_MANIFEST_WRITE_CAPABILITY) {
    throw new Error(
      'Root integrity manifest generation requires --generate-integrity-manifest',
    );
  }
  const manifest = await createIntegrityManifest(packageRoot, {
    sourceLayout: true,
  });
  await writeGenerated(
    packageRoot,
    manifestName,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
};

const verifyGeneratedIdentities = async (outputRoot) => {
  const scopedFiles = [
    ...(await listFiles(path.join(outputRoot, 'android')))
      .map((file) => `android/${file}`)
      .filter(
        (relativePath) => !relativePath.startsWith('android/fault-matrix/'),
      ),
    ...(await listFiles(path.join(outputRoot, 'apple'))).map(
      (file) => `apple/${file}`,
    ),
    'HNSecureWebView.podspec',
    'react-native.config.js',
    ...(await listFiles(path.join(outputRoot, 'secure-webview')))
      .filter((file) => file !== 'LICENSE')
      .map((file) => `secure-webview/${file}`),
    ...coreAdapterRelativePaths,
  ];
  const forbidden = [
    'com.reactnativecommunity.webview',
    'RNCWebView',
    'RNCBasicAuthCredential',
    'react-native-webview',
    'RNCWebViewSpec',
    'RNCWebViewMessagingModule',
  ];
  for (const relativePath of scopedFiles) {
    const source = await readFile(path.join(outputRoot, relativePath), 'utf8');
    const leaked = forbidden.filter((identity) => source.includes(identity));
    if (leaked.length > 0) {
      throw new Error(
        `Old WebView identity leaked into ${relativePath}: ${leaked.join(', ')}`,
      );
    }
    for (const locator of ['patch:', 'patches/', 'patches\\', workspaceRoot]) {
      if (source.includes(locator)) {
        throw new Error(`Private path locator leaked into ${relativePath}`);
      }
    }
    const bridgeAllowlist = new Set([
      'android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebView.java',
      'apple/HNSecureWebViewImpl.m',
      'secure-webview/src/HNSecureWebViewTypes.ts',
    ]);
    if (
      source.includes('ReactNativeWebView') &&
      !bridgeAllowlist.has(relativePath)
    ) {
      throw new Error(
        `ReactNativeWebView is only allowed for the in-document bridge implementation and its API documentation`,
      );
    }
  }

  const packageClass = await readFile(
    path.join(
      outputRoot,
      'android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebViewPackage.java',
    ),
    'utf8',
  );
  requireMarkers(packageClass, 'HNSecureWebViewPackage.java', [
    `public class ${REACT_PACKAGE_NAME}`,
    'new HNSecureWebViewManager()',
    'new HNSecureWebViewModule(reactContext)',
  ]);

  const nativeModule = await readFile(
    path.join(
      outputRoot,
      'android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebViewModuleImpl.java',
    ),
    'utf8',
  );
  requireMarkers(nativeModule, 'HNSecureWebViewModuleImpl.java', [
    `public static final String NAME = "${MODULE_NAME}"`,
    `constants.put("implementationId", "${IMPLEMENTATION_ID}")`,
    `constants.put("protocolMajor", ${PROTOCOL_MAJOR})`,
    `constants.put("implementationVersion", "${IMPLEMENTATION_VERSION}")`,
    'constants.put("platform", "android")',
    ...ANDROID_CAPABILITIES,
  ]);

  const appleModule = await readFile(
    path.join(outputRoot, 'apple/HNSecureWebViewModule.mm'),
    'utf8',
  );
  requireMarkers(appleModule, 'apple/HNSecureWebViewModule.mm', [
    '@"implementationId": @"com.hamsternote.nativereader.securewebview"',
    '@"platform": @"ios"',
    ...IOS_CAPABILITIES,
  ]);
  const appleReadAccessPolicy = await readFile(
    path.join(outputRoot, 'apple/HNSecureWebViewReadAccessPolicy.m'),
    'utf8',
  );
  requireMarkers(
    appleReadAccessPolicy,
    'apple/HNSecureWebViewReadAccessPolicy.m',
    [
      'NSBundle bundleForClass:self',
      'HNSecureWebViewFoliateRuntime',
      'foliate-runtime/native',
      'URLForResource:@"reader" withExtension:@"html"',
      'URLForResource:@"manifest" withExtension:@"json"',
      'URLByStandardizingPath',
      'URLByResolvingSymlinksInPath',
      'HNSecurePathIsStrictDescendantOfPath',
      'HNSecureRuntimeManifestClosureIsValid',
      'assets.count != expectedPaths.count',
      'probes/csp-1x1.png',
      'probes/csp-external-canary.js',
      'HNSecureSHA256',
      'HNSecureExpectedRuntimeAssetPaths',
      '__block NSError *enumerationError',
      'HNSecureURLIsRegularNonSymlinkFile',
    ],
  );
  for (const relativePath of IOS_FOLIATE_RUNTIME_CLOSURE_PATHS) {
    if (!appleReadAccessPolicy.includes(`@"${relativePath}"`)) {
      throw new Error(
        `iOS read access policy omits required Foliate closure path: ${relativePath}`,
      );
    }
  }
  for (const forbiddenPattern of [
    'NSDirectory' + 'EnumerationSkipsHiddenFiles',
    '![' + 'paths addObject:path]',
    'error = ' + 'enumerationError',
  ]) {
    if (appleReadAccessPolicy.includes(forbiddenPattern)) {
      throw new Error(
        `iOS read access policy has unsafe Objective-C closure validation: ${forbiddenPattern}`,
      );
    }
  }
  if (appleReadAccessPolicy.includes('[NSBundle mainBundle]')) {
    throw new Error(
      'iOS read access policy must resolve Foliate runtime from its resource bundle',
    );
  }
  const applePodspec = await readFile(
    path.join(outputRoot, 'HNSecureWebView.podspec'),
    'utf8',
  );
  requireMarkers(applePodspec, 'HNSecureWebView.podspec', [
    "s.resources = ['apple/HNSecureWebViewFoliateRuntime.bundle']",
  ]);
  if (
    (applePodspec.match(/^\s*s\.resources\s*=/gm) ?? []).length !== 1 ||
    ['resource_bundles', 'mainBundle', 'fallback'].some((forbidden) =>
      applePodspec.includes(forbidden),
    )
  ) {
    throw new Error(
      'iOS Podspec must declare exactly one explicit folder-reference resource input',
    );
  }
  await verifyIosFoliateRuntimeBundle(
    path.join(outputRoot, iosFoliateRuntimeBundleDirectory),
  );
};

export async function stageSecureWebView({
  sourceRoot,
  coreRoot,
  outputRoot,
  ownership,
  capabilityRoot = packageRoot,
  runtimeRoot,
  referenceIntegrityRoot = packageRoot,
  productSourceRoot = packageRoot,
  verifyIntegrityReference = true,
  writeIntegrityManifest = true,
  writers = DEFAULT_STAGING_WRITERS,
} = {}) {
  if (verifyIntegrityReference !== true || writeIntegrityManifest !== true) {
    throw new Error(
      'Isolated staging requires reference integrity verification and an output integrity manifest',
    );
  }
  const plan = await assertStagingPlan({
    sourceRoot,
    coreRoot,
    outputRoot,
    ownership,
    capabilityRoot,
    runtimeRoot,
    referenceIntegrityRoot,
    productSourceRoot,
  });
  // canonical 计划同时交给 writer 与失败 cleanup；不存在重叠 snapshot 分支。
  outputRoot = plan.outputRoot;
  await Promise.all([
    verifyInput(plan.sourceRoot),
    verifyCapabilityAbi(plan.capabilityRoot),
    verifyIntegrityManifest(plan.referenceIntegrityRoot, {
      sourceLayout: true,
    }),
  ]);
  await cleanSecureWebView(plan);

  let stagingError;
  try {
    // 成功/失败均等待全部 writer settle，避免清理与迟到写入竞争。
    await runStagingWriters(writers, plan);
    await verifyGeneratedIdentities(outputRoot);
    await verifyStagedIntegrityReference({
      outputRoot,
      referenceRoot: plan.referenceIntegrityRoot,
    });
    return await writeStagedIntegrityManifest(plan);
  } catch (error) {
    stagingError = error;
  }
  await cleanupFailedStaging(plan, stagingError);
  throw stagingError;
}

export function resolveInstalledInputs(root = workspaceRoot) {
  const workspaceRequire = createRequire(path.join(root, 'package.json'));
  return {
    sourceRoot: path.dirname(
      workspaceRequire.resolve('react-native-webview/package.json'),
    ),
    coreRoot: path.dirname(
      workspaceRequire.resolve('@epubjs-react-native/core/package.json'),
    ),
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const usage =
    'Usage: stage-secure-webview.mjs --verify | --generate-integrity-manifest | (--stage | --clean) --output-root <existing-isolated-directory> --runtime-root <input-directory> [--source-root <path>] [--core-root <path>] [--product-source-root <path>] [--reference-integrity-root <path>] [--capability-root <path>]';
  const args = process.argv.slice(2);
  const modes = [
    '--verify',
    '--generate-integrity-manifest',
    '--stage',
    '--clean',
  ];
  if (!modes.includes(args[0])) throw new Error(usage);
  const mode = args.shift();
  const optionKeys = new Map([
    ['--output-root', 'outputRoot'],
    ['--runtime-root', 'runtimeRoot'],
    ['--source-root', 'sourceRoot'],
    ['--core-root', 'coreRoot'],
    ['--product-source-root', 'productSourceRoot'],
    ['--reference-integrity-root', 'referenceIntegrityRoot'],
    ['--capability-root', 'capabilityRoot'],
  ]);
  const options = {};
  while (args.length > 0) {
    const key = optionKeys.get(args.shift());
    const value = args.shift();
    if (!key || !value || value.startsWith('--') || key in options) {
      throw new Error(usage);
    }
    options[key] = value;
  }
  if (mode === '--verify' || mode === '--generate-integrity-manifest') {
    if (Object.keys(options).length > 0) throw new Error(usage);
  } else if (!options.outputRoot || !options.runtimeRoot) {
    // 在解析依赖或读取 integrity reference 前拒绝缺参，绝不推断源码输出。
    throw new Error(
      `Explicit outputRoot and runtimeRoot are required. ${usage}`,
    );
  }
  if (mode === '--verify') {
    await verifyIntegrityManifest(packageRoot, { sourceLayout: true });
  } else if (mode === '--generate-integrity-manifest') {
    await generateRootIntegrityManifest(ROOT_MANIFEST_WRITE_CAPABILITY);
  } else {
    // raw CLI 无法携带本进程 root capability。已有路径绝不从磁盘 marker
    // 推断可写；调用 wrapper 创建 owned 根并通过 JS API 传递能力。
    await assertSafeStagingPaths({
      outputRoot: options.outputRoot,
      authorityRoots: [
        packageRoot,
        options.runtimeRoot,
        options.productSourceRoot ?? packageRoot,
        options.referenceIntegrityRoot ?? packageRoot,
        options.capabilityRoot ?? packageRoot,
      ],
      mutablePaths: stagingMutablePaths,
    });
    await assertOwnedStagingRoot({ outputRoot: options.outputRoot });
  }
}
