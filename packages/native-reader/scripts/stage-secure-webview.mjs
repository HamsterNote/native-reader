import { createHash } from 'node:crypto';
import {
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
];
export const IOS_CAPABILITIES = [...ANDROID_CAPABILITIES];

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = path.resolve(packageRoot, '../..');
const generatorName = 'stage-secure-webview.mjs';
const generatedMarker = 'HN_SECURE_WEBVIEW_GENERATED';
const manifestName = 'SECURE_WEBVIEW_SHA256.json';
const coreAdapterRelativePaths = [
  'lib/vendor/core/View.android.js',
  'lib/vendor/core/View.ios.js',
];
const applePodspecName = 'HNSecureWebView.podspec';
const autolinkConfigName = 'react-native.config.js';
const appleFaultMatrixDirectory = 'apple-fault-matrix';
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

const transformAppleSource = (source) => {
  let next = namespaceSource(source);
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
  return next;
};

const transformRuntimeSource = (source, outputPath) => {
  let next = namespaceSource(source);
  next = replaceAll(next, './WebViewShared', './HNSecureWebViewShared');
  next = replaceAll(next, './WebView.styles', './HNSecureWebView.styles');
  next = replaceAll(next, './WebViewTypes', './HNSecureWebViewTypes');
  // Babel embeds the upstream CI checkout path in development JSX metadata.
  // Replace it rather than publishing an absolute, source-specific path.
  next = next.replace(/_jsxFileName="[^"]+"/g, `_jsxFileName="${outputPath}"`);
  return next;
};

const transformComponentSpec = (source) => namespaceSource(source);

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
    ...IOS_CAPABILITIES,
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

export async function cleanSecureWebView({ outputRoot = packageRoot } = {}) {
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

const stageAndroid = async (sourceRoot, outputRoot) => {
  await writeGenerated(
    outputRoot,
    `android/${generatedMarker}`,
    `${generatorName}\n`,
  );
  for (const inputPath of ANDROID_INPUT_FILES) {
    const outputPath = androidOutputPath(inputPath);
    const source = await readFile(path.join(sourceRoot, inputPath), 'utf8');
    await writeGenerated(
      outputRoot,
      outputPath,
      transformAndroidSource(source, outputPath),
    );
  }
};

const stageApple = async (sourceRoot, outputRoot) => {
  await writeGenerated(
    outputRoot,
    `apple/${generatedMarker}`,
    `${generatorName}\n`,
  );
  for (const inputPath of APPLE_INPUT_FILES) {
    const outputPath = namespaceSource(inputPath);
    await writeGenerated(
      outputRoot,
      outputPath,
      transformAppleSource(
        await readFile(path.join(sourceRoot, inputPath), 'utf8'),
      ),
    );
  }
  await writeGenerated(
    outputRoot,
    'HNSecureWebView.podspec',
    `# Generated by ${generatorName}. Do not edit.\nrequire 'json'\n\nnew_arch_enabled = ENV['RCT_NEW_ARCH_ENABLED'] == '1'\npackage = JSON.parse(File.read(File.join(__dir__, 'package.json')))\n\nPod::Spec.new do |s|\n  s.name = 'HNSecureWebView'\n  s.version = package['version']\n  s.summary = 'Namespaced secure WebView runtime for Hamster Note'\n  s.license = 'MIT'\n  s.platforms = { :ios => (new_arch_enabled ? '11.0' : '9.0'), :visionos => '1.0' }\n  s.source = { :http => 'https://invalid.example/hn-secure-webview' }\n  s.source_files = 'apple/**/*.{h,m,mm,swift}'\n  if defined?(install_modules_dependencies()) != nil\n    install_modules_dependencies(s)\n  elsif new_arch_enabled\n    s.compiler_flags = '-DRCT_NEW_ARCH_ENABLED=1'\n    s.dependency 'React-RCTFabric'\n    s.dependency 'React-Codegen'\n    s.dependency 'ReactCommon/turbomodule/core'\n  else\n    s.dependency 'React-Core'\n  end\nend\n`,
  );
  await writeGenerated(
    outputRoot,
    'react-native.config.js',
    `// Generated by ${generatorName}. Do not edit.\n'use strict';\n\nmodule.exports = {\n  dependency: {\n    platforms: {\n      ios: { podspecPath: 'HNSecureWebView.podspec' },\n      android: { sourceDir: 'android' },\n    },\n  },\n};\n`,
  );
};

const stageRuntime = async (sourceRoot, outputRoot) => {
  await writeGenerated(
    outputRoot,
    `secure-webview/${generatedMarker}`,
    `${generatorName}\n`,
  );
  for (const [inputPath, outputPath] of RUNTIME_INPUTS) {
    const source = await readFile(path.join(sourceRoot, inputPath), 'utf8');
    await writeGenerated(
      outputRoot,
      outputPath,
      transformRuntimeSource(source, outputPath),
    );
  }

  await writeGenerated(
    outputRoot,
    'secure-webview/src/HNSecureWebViewNativeComponent.ts',
    transformComponentSpec(
      await readFile(
        path.join(sourceRoot, 'src/RNCWebViewNativeComponent.ts'),
        'utf8',
      ),
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
    run: ({ sourceRoot, outputRoot }) => stageAndroid(sourceRoot, outputRoot),
  },
  {
    name: 'runtime',
    run: ({ sourceRoot, outputRoot }) => stageRuntime(sourceRoot, outputRoot),
  },
  {
    name: 'apple',
    run: ({ sourceRoot, outputRoot }) => stageApple(sourceRoot, outputRoot),
  },
  {
    name: 'core-adapter',
    run: ({ coreRoot, outputRoot }) => stageCoreAdapter(coreRoot, outputRoot),
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
const cleanupFailedStaging = async (outputRoot, stagingError) => {
  const cleanupFailures = [];
  try {
    await cleanSecureWebView({ outputRoot });
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

export async function collectIntegrityEntries(outputRoot) {
  const relativeFiles = [
    ...(await listFiles(path.join(outputRoot, 'android'))).map(
      (file) => `android/${file}`,
    ),
    ...(await listFiles(path.join(outputRoot, 'apple'))).map(
      (file) => `apple/${file}`,
    ),
    'HNSecureWebView.podspec',
    'react-native.config.js',
    ...(await listFiles(path.join(outputRoot, 'secure-webview'))).map(
      (file) => `secure-webview/${file}`,
    ),
    ...(await listFiles(path.join(outputRoot, appleFaultMatrixDirectory))).map(
      (file) => `${appleFaultMatrixDirectory}/${file}`,
    ),
    ...RELEASE_INTEGRITY_COMPILED_FILES,
    ...(await listFiles(path.join(outputRoot, 'lib/vendor/core'))).map(
      (file) => `lib/vendor/core/${file}`,
    ),
  ].sort();
  const files = {};
  for (const relativePath of relativeFiles) {
    files[relativePath] = sha256(
      await readFile(path.join(outputRoot, relativePath)),
    );
  }
  return files;
}

const verifyGeneratedIdentities = async (outputRoot) => {
  const scopedFiles = [
    ...(await listFiles(path.join(outputRoot, 'android'))).map(
      (file) => `android/${file}`,
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
};

export async function stageSecureWebView({
  sourceRoot,
  coreRoot,
  outputRoot = packageRoot,
  capabilityRoot = packageRoot,
  writers = DEFAULT_STAGING_WRITERS,
} = {}) {
  if (!sourceRoot || !coreRoot) {
    throw new Error(
      'sourceRoot and coreRoot are required for deterministic staging',
    );
  }
  await Promise.all([
    verifyInput(sourceRoot),
    verifyCapabilityAbi(capabilityRoot),
  ]);
  await cleanSecureWebView({ outputRoot });

  let stagingError;
  try {
    // 成功路径同样依赖 runStagingWriters 的 settle 语义：这里返回时
    // android/secure-webview/adapter 的所有写入都已结束。
    await runStagingWriters(writers, { sourceRoot, coreRoot, outputRoot });
    await verifyGeneratedIdentities(outputRoot);
  } catch (error) {
    stagingError = error;
  }
  if (stagingError) {
    // 先让所有 writer settle（runStagingWriters 已完成），再清理部分 staging。
    // 这样父级 release 生命周期随后的清理不会与延迟写入竞争，也不会在清理后
    // 残留/重建任何 staging 内容。
    await cleanupFailedStaging(outputRoot, stagingError);
    throw stagingError;
  }

  const manifest = {
    schemaVersion: 1,
    generator: generatorName,
    source: { name: 'react-native-webview', version: '13.16.1' },
    implementationId: IMPLEMENTATION_ID,
    implementationVersion: IMPLEMENTATION_VERSION,
    protocolMajor: PROTOCOL_MAJOR,
    files: await collectIntegrityEntries(outputRoot),
  };
  await writeGenerated(
    outputRoot,
    manifestName,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
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
  if (process.argv.includes('--clean')) {
    await cleanSecureWebView();
  } else {
    await stageSecureWebView({
      ...resolveInstalledInputs(),
      outputRoot: packageRoot,
    });
  }
}
