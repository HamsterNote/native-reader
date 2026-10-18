import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  ANDROID_CAPABILITIES,
  DEFAULT_STAGING_WRITERS,
  CALLABLE_MODULE_NAME,
  CODEGEN_LIBRARY_NAME,
  collectIntegrityEntries,
  COMPONENT_NAME,
  generateStagedIntegrityManifest,
  IMPLEMENTATION_ID,
  IMPLEMENTATION_VERSION,
  IOS_CAPABILITIES,
  MODULE_NAME,
  PROTOCOL_MAJOR,
  REACT_PACKAGE_NAME,
  REVIEWED_INPUT_FILES,
  resolveInstalledInputs,
  stageSecureWebView,
  verifyIntegrityManifest,
} from './stage-secure-webview.mjs';
import { createOwnedStagingRoot } from './staging-ownership.mjs';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = path.resolve(packageRoot, '../..');
const execFileAsync = promisify(execFile);
const fixtureCacheRoot = path.join(
  os.homedir(),
  '.cache/opencode-tmp/opencode',
);
await mkdir(fixtureCacheRoot, { recursive: true });
const outputOwnership = new Map();
const ownedFixture = async (prefix) => {
  const owned = await createOwnedStagingRoot({
    parentRoot: fixtureCacheRoot,
    prefix,
    authorityRoots: [workspaceRoot],
  });
  outputOwnership.set(owned.outputRoot, owned.ownership);
  return owned.outputRoot;
};
const firstOutput = await ownedFixture('hn-secure-webview-first-');
const secondOutput = await ownedFixture('hn-secure-webview-second-');
const codegenOutput = await mkdtemp(
  path.join(fixtureCacheRoot, 'hn-secure-webview-codegen-'),
);
const baselineFixture = await mkdtemp(
  path.join(fixtureCacheRoot, 'hn-secure-webview-baseline-input-'),
);
const baselineFailureOutput = await ownedFixture(
  'hn-secure-webview-baseline-output-',
);
const fastFailureOutput = await ownedFixture(
  'hn-secure-webview-fast-failure-output-',
);
const writerRaceOutput = await ownedFixture('hn-secure-webview-writer-race-');
const referenceFailureOutput = await ownedFixture(
  'hn-secure-webview-reference-',
);
const integrityMutationRoot = await ownedFixture(
  'hn-secure-webview-integrity-root-',
);
const integrityMutationOutput = await ownedFixture(
  'hn-secure-webview-integrity-output-',
);
const packageEntrypointWorkspace = await mkdtemp(
  path.join(fixtureCacheRoot, 'hn-secure-webview-package-entrypoint-'),
);

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const read = (root, relativePath) =>
  readFile(path.join(root, relativePath), 'utf8');

const exists = async (root, relativePath) => {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

const prepareReleaseOutput = async (root) => {
  await cp(
    path.join(packageRoot, 'package.json'),
    path.join(root, 'package.json'),
  );
  await cp(
    path.join(packageRoot, 'apple-fault-matrix'),
    path.join(root, 'apple-fault-matrix'),
    { recursive: true },
  );
  // Use the current native host rather than synthetic fixture bytes. Staging
  // must prove it packages exactly what the root integrity manifest approves.
  await cp(
    path.join(packageRoot, 'foliate-runtime/native'),
    path.join(root, 'foliate-runtime/native'),
    { recursive: true },
  );
};

try {
  const inputs = resolveInstalledInputs(workspaceRoot);
  const rootManifestPath = path.join(packageRoot, 'SECURE_WEBVIEW_SHA256.json');
  const rootManifestBefore = await readFile(rootManifestPath, 'utf8');
  await verifyIntegrityManifest(packageRoot, { sourceLayout: true });

  // 旧 package-directory 成功用例必须反转：无参数不得默认原地 staging。
  // 闭包之外也可能是未提交用户源码，不允许用 integrity snapshot 推断可删。
  const packageEntrypointRoot = path.join(
    packageEntrypointWorkspace,
    'packages/native-reader',
  );
  await mkdir(path.dirname(packageEntrypointRoot), { recursive: true });
  await cp(packageRoot, packageEntrypointRoot, {
    recursive: true,
    filter: (source) => path.basename(source) !== 'node_modules',
  });
  await cp(
    path.join(workspaceRoot, 'package.json'),
    path.join(packageEntrypointWorkspace, 'package.json'),
  );
  // package entry resolution walks to this workspace-level link. A symlink
  // keeps the regression cheap and, unlike a copied node_modules tree, cannot
  // accidentally exercise stale generated package contents.
  await symlink(
    path.join(workspaceRoot, 'node_modules'),
    path.join(packageEntrypointWorkspace, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const sentinelPath = path.join(
    packageEntrypointRoot,
    'android/USER_SOURCE_SENTINEL',
  );
  await writeFile(
    sentinelPath,
    'uncommitted source outside integrity closure\n',
  );
  await assert.rejects(
    execFileAsync(process.execPath, ['scripts/stage-secure-webview.mjs'], {
      cwd: packageEntrypointRoot,
    }),
    /Usage:/,
  );
  await assert.rejects(
    stageSecureWebView({
      ...inputs,
      outputRoot: packageEntrypointRoot,
      runtimeRoot: packageEntrypointRoot,
      productSourceRoot: packageEntrypointRoot,
      referenceIntegrityRoot: packageEntrypointRoot,
    }),
    /overlaps authority/,
  );
  assert.equal(
    await readFile(sentinelPath, 'utf8'),
    'uncommitted source outside integrity closure\n',
  );
  assert.equal(
    await readFile(
      path.join(packageEntrypointRoot, 'SECURE_WEBVIEW_SHA256.json'),
      'utf8',
    ),
    rootManifestBefore,
    'rejected package-directory staging must not rewrite the root integrity reference',
  );
  await Promise.all([
    prepareReleaseOutput(firstOutput),
    prepareReleaseOutput(secondOutput),
  ]);
  const firstManifest = await stageSecureWebView({
    ...inputs,
    outputRoot: firstOutput,
    ownership: outputOwnership.get(firstOutput),
    runtimeRoot: packageRoot,
  });
  const secondManifest = await stageSecureWebView({
    ...inputs,
    outputRoot: secondOutput,
    ownership: outputOwnership.get(secondOutput),
    runtimeRoot: packageRoot,
  });

  assert.deepEqual(firstManifest, secondManifest);
  assert.deepEqual(
    firstManifest.files,
    await collectIntegrityEntries(firstOutput),
  );
  const stagedManifestPath = path.join(
    firstOutput,
    'SECURE_WEBVIEW_SHA256.json',
  );
  const stagedManifestText = await readFile(stagedManifestPath, 'utf8');
  const stagedManifest = JSON.parse(stagedManifestText);
  await verifyIntegrityManifest(firstOutput);
  const expectStagedManifestFailure = async (description, mutate) => {
    const mutated = structuredClone(stagedManifest);
    await mutate(mutated);
    await writeFile(
      stagedManifestPath,
      `${JSON.stringify(mutated, null, 2)}\n`,
    );
    await assert.rejects(
      verifyIntegrityManifest(firstOutput),
      /Secure WebView integrity manifest (?:coverage mismatch|has invalid SHA-256)|Secure WebView SHA-256 mismatch/,
      description,
    );
    await writeFile(stagedManifestPath, stagedManifestText);
  };
  const [firstIntegrityPath] = Object.keys(stagedManifest.files);
  await expectStagedManifestFailure(
    'missing integrity entry',
    async (manifest) => {
      delete manifest.files[firstIntegrityPath];
    },
  );
  await expectStagedManifestFailure(
    'extra integrity entry',
    async (manifest) => {
      manifest.files['android/unexpected.java'] = '0'.repeat(64);
    },
  );
  await expectStagedManifestFailure(
    'incorrect integrity hash',
    async (manifest) => {
      manifest.files[firstIntegrityPath] = '0'.repeat(64);
    },
  );
  const wireCorpus = JSON.parse(
    await read(firstOutput, 'secure-webview/foliate-host-wire-corpus.v1.json'),
  );
  assert.equal(wireCorpus.schemaVersion, 1);
  assert.equal(wireCorpus.protocol, 'hn-foliate-host');
  assert.equal(wireCorpus.scenarios.length > 0, true);
  assert.equal(
    Object.hasOwn(
      firstManifest.files,
      'secure-webview/foliate-host-wire-corpus.v1.json',
    ),
    true,
  );
  const runtimeBundleRoot = path.join(
    firstOutput,
    'apple/HNSecureWebViewFoliateRuntime.bundle',
  );
  const runtimeBundleInfo = await readFile(
    path.join(runtimeBundleRoot, 'Info.plist'),
    'utf8',
  );
  assert.equal(
    runtimeBundleInfo.includes(
      '<string>com.hamsternote.nativereader.foliate-runtime</string>',
    ),
    true,
  );
  assert.deepEqual(
    await readFile(
      path.join(runtimeBundleRoot, 'foliate-runtime/native/bootstrap.js'),
    ),
    await readFile(
      path.join(packageRoot, 'foliate-runtime/native/bootstrap.js'),
    ),
  );
  assert.deepEqual(
    Object.keys(firstManifest.files),
    [...Object.keys(firstManifest.files)].sort(),
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      firstManifest.files,
      'SECURE_WEBVIEW_SHA256.json',
    ),
    false,
  );
  // Normal staging is read-only: it must never bless or rewrite the root
  // reference manifest that it uses to validate the generated output.
  assert.equal(await readFile(rootManifestPath, 'utf8'), rootManifestBefore);
  const packageRootIntegrity = JSON.parse(rootManifestBefore);
  for (const relativePath of [
    'android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebView.java',
    'apple/HNSecureFoliateHostRelay.h',
    'apple/HNSecureFoliateHostRelay.m',
    'apple/HNSecureWebViewReadAccessPolicy.h',
    'apple/HNSecureWebViewReadAccessPolicy.m',
    'secure-webview/src/HNSecureWebView.android.tsx',
    'secure-webview/src/HNSecureWebView.ios.tsx',
    'secure-webview/src/HNSecureWebViewNativeComponent.ts',
    'secure-webview/src/HNSecureWebViewTypes.ts',
    'secure-webview/foliate-host-wire-corpus.v1.json',
  ]) {
    assert.equal(
      packageRootIntegrity.files?.[relativePath],
      createHash('sha256')
        .update(await readFile(path.join(packageRoot, relativePath)))
        .digest('hex'),
    );
    if (!relativePath.startsWith('android/')) {
      assert.equal(
        packageRootIntegrity.files?.[relativePath],
        firstManifest.files[relativePath],
      );
    }
  }
  // Production staging compares the fresh result against the root manifest.
  // It must pass without rewriting that root reference.
  await stageSecureWebView({
    ...inputs,
    outputRoot: referenceFailureOutput,
    ownership: outputOwnership.get(referenceFailureOutput),
    runtimeRoot: firstOutput,
  });
  assert.equal(await readFile(rootManifestPath, 'utf8'), rootManifestBefore);

  // Materialize every source-side member of the fixed closure. The native
  // bundle and Android fault matrix have distinct source locations.
  const sourcePathForIntegrityPath = (manifestPath) => {
    const pdfHost = /\/(HNPdfAssets|HNPdfView|HNPdfViewManager)\.java$/.exec(manifestPath);
    if (pdfHost) return `pdf-host/android/${pdfHost[1]}.java`;
    if (manifestPath.startsWith('android/fault-matrix/')) {
      return manifestPath.replace(
        'android/fault-matrix/',
        'android-fault-matrix/harness/src/test/java/com/hamsternote/nativereader/securewebview/',
      );
    }
    const nativeBundlePrefix =
      'apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/';
    return manifestPath.startsWith(nativeBundlePrefix)
      ? `foliate-runtime/native/${manifestPath.slice(nativeBundlePrefix.length)}`
      : manifestPath;
  };
  for (const manifestPath of Object.keys(packageRootIntegrity.files)) {
    const relativePath = sourcePathForIntegrityPath(manifestPath);
    const destination = path.join(integrityMutationRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(packageRoot, relativePath), destination);
  }
  await cp(
    rootManifestPath,
    path.join(integrityMutationRoot, 'SECURE_WEBVIEW_SHA256.json'),
  );
  for (const manifestPath of Object.keys(packageRootIntegrity.files)) {
    const sourcePath = sourcePathForIntegrityPath(manifestPath);
    const mutationPath = path.join(integrityMutationRoot, sourcePath);
    const originalContents = await readFile(mutationPath);
    await appendFile(mutationPath, Buffer.from('\n// integrity mutation\n'));
    await assert.rejects(
      verifyIntegrityManifest(integrityMutationRoot, { sourceLayout: true }),
      new RegExp(
        `Secure WebView SHA-256 mismatch.*${manifestPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ),
      `${manifestPath} must fail root integrity verification`,
    );
    await assert.rejects(
      stageSecureWebView({
        ...inputs,
        outputRoot: integrityMutationOutput,
        ownership: outputOwnership.get(integrityMutationOutput),
        runtimeRoot: firstOutput,
        productSourceRoot: integrityMutationRoot,
        referenceIntegrityRoot: integrityMutationRoot,
      }),
      /Secure WebView SHA-256 mismatch/,
      `${manifestPath} must fail fresh staged integrity verification`,
    );
    await writeFile(mutationPath, originalContents);
  }
  await assert.rejects(
    generateStagedIntegrityManifest(packageRoot),
    /Root integrity manifest generation requires --generate-integrity-manifest/,
    'programmatic default generator must not write the root manifest',
  );
  const mutatedAndroidHost = path.join(
    integrityMutationRoot,
    'android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebView.java',
  );
  await appendFile(mutatedAndroidHost, '\n// explicit generator mutation\n');
  await generateStagedIntegrityManifest(integrityMutationRoot, {
    sourceLayout: true,
    ownership: outputOwnership.get(integrityMutationRoot),
  });
  await verifyIntegrityManifest(integrityMutationRoot, { sourceLayout: true });
  await stageSecureWebView({
    ...inputs,
    outputRoot: integrityMutationOutput,
    ownership: outputOwnership.get(integrityMutationOutput),
    runtimeRoot: firstOutput,
    productSourceRoot: integrityMutationRoot,
    referenceIntegrityRoot: integrityMutationRoot,
  });

  const androidRoot =
    'android/src/main/java/com/hamsternote/nativereader/securewebview';
  const moduleImplementation = await read(
    firstOutput,
    `${androidRoot}/HNSecureWebViewModuleImpl.java`,
  );
  const packageSource = await read(
    firstOutput,
    `${androidRoot}/${REACT_PACKAGE_NAME}.java`,
  );
  const messagingSource = await read(
    firstOutput,
    `${androidRoot}/${CALLABLE_MODULE_NAME}.kt`,
  );
  const componentSpec = await read(
    firstOutput,
    'secure-webview/src/HNSecureWebViewNativeComponent.ts',
  );
  const moduleSpec = await read(
    firstOutput,
    'secure-webview/src/NativeHNSecureWebViewModule.ts',
  );
  const androidRuntime = await read(
    firstOutput,
    'secure-webview/src/HNSecureWebView.android.tsx',
  );
  const iosRuntime = await read(
    firstOutput,
    'secure-webview/src/HNSecureWebView.ios.tsx',
  );
  const androidManifest = await read(
    firstOutput,
    'android/src/main/AndroidManifestNew.xml',
  );
  const viewImplementation = await read(
    firstOutput,
    `${androidRoot}/HNSecureWebView.java`,
  );
  const webViewTypes = await read(
    firstOutput,
    'secure-webview/src/HNSecureWebViewTypes.ts',
  );

  assert.match(moduleImplementation, new RegExp(`NAME = "${MODULE_NAME}"`));
  assert.match(
    moduleImplementation,
    new RegExp(`implementationId", "${IMPLEMENTATION_ID}`),
  );
  assert.match(
    moduleImplementation,
    new RegExp(`protocolMajor", ${PROTOCOL_MAJOR}`),
  );
  assert.match(
    moduleImplementation,
    new RegExp(`implementationVersion", "${IMPLEMENTATION_VERSION}`),
  );
  for (const capability of ANDROID_CAPABILITIES) {
    assert.equal(moduleImplementation.includes(capability), true);
  }
  assert.match(packageSource, new RegExp(`class ${REACT_PACKAGE_NAME}`));
  assert.match(
    messagingSource,
    new RegExp(`interface ${CALLABLE_MODULE_NAME}`),
  );
  assert.equal(componentSpec.includes(`'${COMPONENT_NAME}'`), true);
  assert.equal(
    componentSpec.includes(
      "nativeHost?: WithDefault<'none' | 'foliate', 'none'>",
    ),
    true,
  );
  assert.equal(moduleSpec.includes(`'${MODULE_NAME}'`), true);
  assert.equal(
    moduleSpec.includes('getConstants(): NativeCapabilityConstants;'),
    true,
  );
  assert.equal(
    androidRuntime.includes(`registerCallableModule('${CALLABLE_MODULE_NAME}'`),
    true,
  );
  for (const runtimeSource of [androidRuntime, iosRuntime, webViewTypes]) {
    assert.equal(runtimeSource.includes('nativeHost'), true);
  }
  for (const runtimeSource of [androidRuntime, iosRuntime]) {
    assert.equal(runtimeSource.includes('resolveWebViewSource'), true);
    assert.equal(runtimeSource.includes('secureNativeHostProps'), true);
    assert.equal(runtimeSource.includes('selectNativeWebViewComponent'), true);
    assert.equal(
      runtimeSource.includes('secureNativeHostProps(nativeConfig?.props)'),
      true,
    );
    assert.equal(runtimeSource.includes('resolveAssetSource(source as'), false);
  }
  assert.equal(await exists(firstOutput, 'lib/vendor/core'), false);
  assert.equal(iosRuntime.includes('HNSecureWebViewNativeComponent'), true);
  assert.equal(iosRuntime.includes('NativeHNSecureWebViewModule'), true);
  assert.equal(iosRuntime.includes('react-native-webview'), false);
  assert.equal(
    androidManifest.includes('${applicationId}.hn_secure_webview_fileprovider'),
    true,
  );
  assert.equal(
    androidManifest.includes('@xml/hn_secure_webview_file_provider_paths'),
    true,
  );
  assert.equal(
    viewImplementation.includes('JAVASCRIPT_INTERFACE = "ReactNativeWebView"'),
    true,
  );
  assert.equal(
    webViewTypes.includes('window.ReactNativeWebView.postMessage'),
    true,
  );

  for (const oldIdentity of [
    'com.reactnativecommunity.webview',
    'RNCWebView',
    'RNCWebViewMessagingModule',
    'react-native-webview',
  ]) {
    assert.equal(moduleSpec.includes(oldIdentity), false);
    assert.equal(componentSpec.includes(oldIdentity), false);
    assert.equal(androidRuntime.includes(oldIdentity), false);
  }

  assert.equal(await exists(firstOutput, 'HNSecureWebView.podspec'), true);
  assert.equal(await exists(firstOutput, 'react-native.config.js'), true);
  assert.equal(await exists(firstOutput, 'apple/HNSecureWebViewImpl.m'), true);
  const appleImplementation = await read(
    firstOutput,
    'apple/HNSecureWebViewImpl.m',
  );
  const appleModule = await read(firstOutput, 'apple/HNSecureWebViewModule.mm');
  const appleFaultMatrix = await read(
    firstOutput,
    'apple-fault-matrix/HNSecureWebViewDecisionManagerTests.m',
  );
  const applePodspec = await read(firstOutput, 'HNSecureWebView.podspec');
  const appleFoliateRelay = await read(
    firstOutput,
    'apple/HNSecureFoliateHostRelay.m',
  );
  const autolinkConfig = await read(firstOutput, 'react-native.config.js');
  for (const capability of IOS_CAPABILITIES) {
    assert.equal(appleModule.includes(capability), true);
  }
  for (const marker of [
    '#import <XCTest/XCTest.h>',
    'testNoHandlerCancelsExactlyOnce',
    'testTimeoutAndTeardownCancelExactlyOnce',
    'testDispatchExceptionCancelsExactlyOnce',
    'testLateCallbackAndRecycleGenerationCannotAffectCurrentDecision',
    'testCurrentGenerationAllowAndDenyAreExact',
    'dispatchDecisionEvent:',
    'testFoliateHostProtocolRejectsWrongVersionUnknownAndTransfer',
    'testFoliateRelayRejectsWrongFrameOriginURLSessionAndGeneration',
    'testInitialCSPPreflightFailsClosedWithoutTrustedHost',
  ]) {
    assert.equal(appleFaultMatrix.includes(marker), true);
  }
  for (const marker of [
    '_failClosedOnShouldStartLoadWithRequest && !_onShouldStartLoadWithRequest',
    'HNSecureWebViewNavigationDecisionTimeout',
    'setDecisionHandler: ^(BOOL shouldStart)',
    'cancelDecisionHandlerForLockIdentifier:',
    'cancelPendingNavigationDecisions',
    '@catch (NSException *exception)',
    'isNavigationDecisionOwnerActive',
    'activateNavigationDecisionOwner',
    '} owner:self generation:[self navigationDecisionOwnerGeneration]]',
    'decisionHandler(cancelNavigation ? WKNavigationActionPolicyCancel : WKNavigationActionPolicyAllow)',
  ]) {
    assert.equal(appleImplementation.includes(marker), true);
  }
  const appleManager = await read(
    firstOutput,
    'apple/HNSecureWebViewManager.mm',
  );
  const appleFabric = await read(firstOutput, 'apple/HNSecureWebView.mm');
  const appleDetectorTypes = await read(
    firstOutput,
    'apple/RCTConvert+WKDataDetectorTypes.m',
  );
  const appleDetectorTypesHeader = await read(
    firstOutput,
    'apple/RCTConvert+WKDataDetectorTypes.h',
  );
  for (const source of [
    appleImplementation,
    appleManager,
    appleDetectorTypes,
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
    ]) {
      assert.equal(source.includes(legacyDefinition), false);
    }
  }
  for (const marker of [
    'static NSString *const HNSecureWebViewCustomSelectorPrefix',
    '@interface HNSecureWebViewSwizzleHelperWK',
    'NSString* name = [NSString stringWithFormat:@"HNSecure_%@_SwizzleHelperWK", subview.class.superclass];',
    'hasPrefix:@"HNSecure_"',
    'performOnMainQueue:',
  ]) {
    assert.equal(
      (marker === 'performOnMainQueue:'
        ? await read(firstOutput, 'apple/HNSecureWebViewDecisionManager.m')
        : appleImplementation
      ).includes(marker),
      true,
    );
  }
  assert.equal(appleFabric.includes('namespace {'), true);
  assert.equal(appleFabric.includes('} // namespace'), true);
  for (const marker of [
    '#import "RCTConvert+WKDataDetectorTypes.h"',
    '+ (WKContentMode)HNSecureWKContentMode:(id)json',
    '+ (HNSecureWebViewPermissionGrantType)HNSecureWebViewPrivatePermissionGrantType:(id)json',
    'RCT_CUSTOM_VIEW_PROPERTY(contentMode, WKContentMode, HNSecureWebViewImpl)',
    'RCT_CUSTOM_VIEW_PROPERTY(mediaCapturePermissionGrantType, HNSecureWebViewPermissionGrantType, HNSecureWebViewImpl)',
    '[RCTConvert HNSecureWKContentMode:json]',
    '[RCTConvert HNSecureWebViewPrivatePermissionGrantType:json]',
  ]) {
    assert.equal(appleManager.includes(marker), true);
  }
  assert.equal(
    appleDetectorTypes.includes(
      '+ (WKDataDetectorTypes)HNSecureWKDataDetectorTypes:(id)json',
    ),
    true,
  );
  assert.equal(
    appleDetectorTypes.includes('#import "RCTConvert+WKDataDetectorTypes.h"'),
    true,
  );
  assert.equal(
    appleDetectorTypesHeader.includes(
      '+ (WKDataDetectorTypes)HNSecureWKDataDetectorTypes:(id)json;',
    ),
    true,
  );
  assert.equal(appleDetectorTypes.includes('RCT_MULTI_ENUM_CONVERTER('), false);
  assert.equal(applePodspec.includes("s.name = 'HNSecureWebView'"), true);
  assert.equal(applePodspec.includes(":ios => '14.0'"), true);
  assert.equal(applePodspec.includes(':osx'), false);
  for (const marker of [
    'WKContentWorld worldWithName:@"hn-foliate-host"',
    'forMainFrameOnly:YES inContentWorld:_contentWorld',
    'addScriptMessageHandler:self contentWorld:_contentWorld',
    'hn-foliate-host',
    'runInitialCSPPreflightWithCompletion',
    'URL.createObjectURL',
    'script-src \'+(strict?\\"\\\'none\\\'\\":\\"blob:\\")',
    'preflightPermitsRemaining = 2',
    'shouldPermitInitialCSPPreflightNavigationURL',
    'cleanupInitialCSPPreflightArtifacts',
    'HNSecureFoliateHostPreflightTimeout',
    "import('./bootstrap.js')",
    'installFoliateNativeHostBridge',
    'HNSecureFoliateHostHasUnsafeJSONSyntax',
    'HNSecureFoliateHostMaximumInteger',
    'message.webView != self.webView',
    'WKFrameInfo *frame = message.frameInfo;',
  ]) {
    if (marker.includes('script-src ')) continue;
    assert.equal(appleFoliateRelay.includes(marker), true);
  }
  for (const cspMarker of ['script-src ', "'none'", 'blob:']) {
    assert.equal(appleFoliateRelay.includes(cspMarker), true);
  }
  for (const forbiddenPreflightPattern of [
    'srcdoc=',
    "'unsafe-inline'",
    "document.createElement('script')",
  ]) {
    assert.equal(appleFoliateRelay.includes(forbiddenPreflightPattern), false);
  }
  assert.equal(
    autolinkConfig.includes("podspecPath: 'HNSecureWebView.podspec'"),
    true,
  );
  assert.equal(await exists(firstOutput, 'android/build.gradle'), true);
  assert.equal(
    await exists(firstOutput, `${androidRoot}/${REACT_PACKAGE_NAME}.java`),
    true,
  );

  const packageManifest = JSON.parse(
    await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
  );
  assert.deepEqual(packageManifest.codegenConfig, {
    name: CODEGEN_LIBRARY_NAME,
    type: 'all',
    jsSrcsDir: './secure-webview/src',
    android: { javaPackageName: IMPLEMENTATION_ID },
    ios: {
      componentProvider: { HNSecureWebView: 'HNSecureWebView' },
      modulesProvider: { HNSecureWebViewModule: 'HNSecureWebViewModule' },
    },
  });
  assert.equal(packageManifest.files.includes('android'), true);
  assert.equal(packageManifest.files.includes('apple'), true);
  assert.equal(packageManifest.files.includes('apple-fault-matrix'), true);
  assert.equal(packageManifest.files.includes('HNSecureWebView.podspec'), true);
  assert.equal(packageManifest.files.includes('react-native.config.js'), true);
  assert.equal(packageManifest.files.includes('secure-webview'), true);
  assert.equal(
    packageManifest.files.includes('SECURE_WEBVIEW_SHA256.json'),
    true,
  );
  assert.equal(packageManifest.files.includes('THIRD_PARTY_NOTICES.md'), true);
  // P1-5：源码根 manifest 必须保持 private:true（禁止源码根 npm pack/publish）。
  // 只有隔离发布 staging 才允许删除该标记：isolated-release.mjs 在删除前
  // fail-closed 地要求 staging manifest 仍持有源 private，且源清单不得被改写；
  // 最终 tarball 的发布清单由 verify-static-native-propagation.mjs 校验必须不再
  // 带 private。此处读取的是源清单，必须断言 private 仍然存在，不能反向断言。
  assert.equal(packageManifest.private, true);
  assert.equal(packageManifest.peerDependencies.expo, '57.0.24');
  assert.equal(packageManifest.peerDependencies.react, '19.2.3');
  assert.equal(packageManifest.peerDependencies['react-native'], '0.86.3');
  assert.equal(packageManifest.dependencies['react-native-webview'], '13.16.1');
  for (const dependency of [
    '@babel/runtime',
    'escape-string-regexp',
    'invariant',
  ]) {
    assert.equal(typeof packageManifest.dependencies[dependency], 'string');
  }
  assert.equal(
    packageManifest.scripts.prepack,
    'node scripts/release-lifecycle.mjs refuse-source-pack',
  );
  assert.equal(
    packageManifest.scripts['pack:release'],
    'node scripts/isolated-release.mjs',
  );
  assert.equal(packageManifest.scripts.prepack.includes('&&'), false);
  assert.equal(packageManifest.scripts.postpack, undefined);
  assert.equal(Object.keys(firstManifest.files).length, 48);
  assert.equal(JSON.stringify(firstManifest).includes('patch:'), false);
  assert.equal(JSON.stringify(firstManifest).includes('patches/'), false);
  assert.equal(JSON.stringify(firstManifest).includes('patches\\'), false);
  assert.equal(JSON.stringify(firstManifest).includes(workspaceRoot), false);

  // Baseline validation must reject modified reviewed input before creating any
  // generated Android/runtime/integrity output.
  for (const relativePath of REVIEWED_INPUT_FILES) {
    const destination = path.join(baselineFixture, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(inputs.sourceRoot, relativePath), destination);
  }
  await appendFile(
    path.join(
      baselineFixture,
      'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java',
    ),
    '\n// baseline mismatch test\n',
  );
  await assert.rejects(
    stageSecureWebView({
      sourceRoot: baselineFixture,
      outputRoot: baselineFailureOutput,
      ownership: outputOwnership.get(baselineFailureOutput),
      runtimeRoot: packageRoot,
    }),
    /Reviewed input SHA-256 mismatch for android\/src\/main\/java\/com\/reactnativecommunity\/webview\/RNCWebViewClient\.java/,
  );
  assert.equal(await exists(baselineFailureOutput, 'android'), false);
  assert.equal(await exists(baselineFailureOutput, 'secure-webview'), false);
  assert.equal(
    await exists(baselineFailureOutput, 'SECURE_WEBVIEW_SHA256.json'),
    false,
  );

  // A failing writer must settle alongside real platform writers before cleanup.
  await assert.rejects(
    stageSecureWebView({
      sourceRoot: inputs.sourceRoot,
      writers: [
        ...DEFAULT_STAGING_WRITERS,
        {
          name: 'injected-failure',
          run: async () => {
            throw new Error('injected staging failure');
          },
        },
      ],
      outputRoot: fastFailureOutput,
      ownership: outputOwnership.get(fastFailureOutput),
      runtimeRoot: firstOutput,
    }),
    /injected staging failure/,
  );
  // 等待一段时间，确认失败的 staging 没有“清理后才落盘”的迟到写入。
  await delay(200);
  assert.equal(await exists(fastFailureOutput, 'android'), false);
  assert.equal(await exists(fastFailureOutput, 'secure-webview'), false);
  assert.equal(
    await exists(fastFailureOutput, 'SECURE_WEBVIEW_SHA256.json'),
    false,
  );
  assert.equal(
    await exists(fastFailureOutput, 'lib/vendor/core/View.android.js'),
    false,
  );

  // 失败清理竞态回归：fast-failure writer 立即 reject，delayed writer 之后才
  // 落盘 owned staging 内容。stageSecureWebView 必须等两个 writer 都 settle 再
  // 清理；清理后既不能残留，也不能被延迟写入重建。
  const raceEvents = [];
  await assert.rejects(
    stageSecureWebView({
      sourceRoot: inputs.sourceRoot,
      outputRoot: writerRaceOutput,
      ownership: outputOwnership.get(writerRaceOutput),
      runtimeRoot: packageRoot,
      writers: [
        {
          name: 'fast-failure',
          run: async () => {
            raceEvents.push('fast-failure:reject');
            throw new Error('injected fast staging writer failure');
          },
        },
        {
          name: 'delayed-writer',
          run: async ({ outputRoot }) => {
            const android = path.join(outputRoot, 'android');
            await mkdir(android, { recursive: true });
            await writeFile(
              path.join(android, 'HN_SECURE_WEBVIEW_GENERATED'),
              'stage-secure-webview.mjs\n',
            );
            raceEvents.push('delayed:marker');
            await delay(120);
            await writeFile(
              path.join(android, 'LATE_STAGING_WRITE.js'),
              'must not survive cleanup\n',
            );
            raceEvents.push('delayed:settled');
          },
        },
      ],
    }),
    /injected fast staging writer failure/,
  );
  // rejection 之前 delayed writer 必须已经 settle，证明清理不是与写入并行发生。
  assert.deepEqual(raceEvents, [
    'fast-failure:reject',
    'delayed:marker',
    'delayed:settled',
  ]);
  assert.equal(await exists(writerRaceOutput, 'android'), false);
  assert.equal(
    await exists(writerRaceOutput, 'android/LATE_STAGING_WRITE.js'),
    false,
  );
  assert.equal(await exists(writerRaceOutput, 'secure-webview'), false);
  assert.equal(
    await exists(writerRaceOutput, 'SECURE_WEBVIEW_SHA256.json'),
    false,
  );
  // 再等待一段时间，确认没有“清理之后才落盘”的写入把 staging 重建出来。
  await delay(200);
  assert.equal(await exists(writerRaceOutput, 'android'), false);
  assert.equal(
    await exists(writerRaceOutput, 'android/LATE_STAGING_WRITE.js'),
    false,
  );

  // Reproduce the two RN 0.86 Gradle Codegen tasks with the package's actual
  // javaPackageName. The generic library CLI hard-codes a Facebook package.
  const schemaPath = path.join(codegenOutput, 'schema.json');
  const artifactsPath = path.join(codegenOutput, 'artifacts');
  await execFileAsync(process.execPath, [
    path.join(
      workspaceRoot,
      'node_modules/@react-native/codegen/lib/cli/combine/combine-js-to-schema-cli.js',
    ),
    '--platform',
    'android',
    '--exclude',
    'NativeSampleTurboModule',
    schemaPath,
    path.join(firstOutput, 'secure-webview/src'),
  ]);
  await execFileAsync(process.execPath, [
    path.join(
      workspaceRoot,
      'node_modules/react-native/scripts/generate-specs-cli.js',
    ),
    '--platform',
    'android',
    '--schemaPath',
    schemaPath,
    '--outputDir',
    artifactsPath,
    '--libraryName',
    CODEGEN_LIBRARY_NAME,
    '--javaPackageName',
    IMPLEMENTATION_ID,
    '--libraryType',
    'all',
  ]);
  const generatedModuleSpec = await read(
    artifactsPath,
    'java/com/hamsternote/nativereader/securewebview/NativeHNSecureWebViewModuleSpec.java',
  );
  assert.equal(
    generatedModuleSpec.includes(`package ${IMPLEMENTATION_ID};`),
    true,
  );
  assert.equal(
    generatedModuleSpec.includes(
      'protected abstract Map<String, Object> getTypedExportedConstants();',
    ),
    true,
  );
  assert.equal(
    await exists(
      artifactsPath,
      'java/com/facebook/react/viewmanagers/HNSecureWebViewManagerDelegate.java',
    ),
    true,
  );
  assert.equal(
    await exists(
      artifactsPath,
      'jni/react/renderer/components/HNSecureWebViewSpec/ComponentDescriptors.h',
    ),
    true,
  );

  process.stdout.write('Secure WebView staging verification passed.\n');
} finally {
  await Promise.all([
    rm(firstOutput, { recursive: true, force: true }),
    rm(secondOutput, { recursive: true, force: true }),
    rm(codegenOutput, { recursive: true, force: true }),
    rm(baselineFixture, { recursive: true, force: true }),
    rm(baselineFailureOutput, { recursive: true, force: true }),
    rm(fastFailureOutput, { recursive: true, force: true }),
    rm(writerRaceOutput, { recursive: true, force: true }),
    rm(referenceFailureOutput, { recursive: true, force: true }),
    rm(integrityMutationRoot, { recursive: true, force: true }),
    rm(integrityMutationOutput, { recursive: true, force: true }),
    rm(packageEntrypointWorkspace, { recursive: true, force: true }),
  ]);
}
