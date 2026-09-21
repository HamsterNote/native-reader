import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  ANDROID_CAPABILITIES,
  CALLABLE_MODULE_NAME,
  CODEGEN_LIBRARY_NAME,
  collectIntegrityEntries,
  COMPONENT_NAME,
  IMPLEMENTATION_ID,
  IMPLEMENTATION_VERSION,
  IOS_CAPABILITIES,
  MODULE_NAME,
  PROTOCOL_MAJOR,
  REACT_PACKAGE_NAME,
  REVIEWED_INPUT_FILES,
  resolveInstalledInputs,
  stageSecureWebView,
} from './stage-secure-webview.mjs';
import { stageBundledCore } from './stage-bundled-core.mjs';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = path.resolve(packageRoot, '../..');
const execFileAsync = promisify(execFile);
const firstOutput = await mkdtemp(
  path.join(os.tmpdir(), 'hn-secure-webview-first-'),
);
const secondOutput = await mkdtemp(
  path.join(os.tmpdir(), 'hn-secure-webview-second-'),
);
const codegenOutput = await mkdtemp(
  path.join(os.tmpdir(), 'hn-secure-webview-codegen-'),
);
const baselineFixture = await mkdtemp(
  path.join(os.tmpdir(), 'hn-secure-webview-baseline-input-'),
);
const baselineFailureOutput = await mkdtemp(
  path.join(os.tmpdir(), 'hn-secure-webview-baseline-output-'),
);
const fastFailureCoreRoot = await mkdtemp(
  path.join(os.tmpdir(), 'hn-secure-webview-fast-failure-core-'),
);
const fastFailureOutput = await mkdtemp(
  path.join(os.tmpdir(), 'hn-secure-webview-fast-failure-output-'),
);
const writerRaceOutput = await mkdtemp(
  path.join(os.tmpdir(), 'hn-secure-webview-writer-race-'),
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

const prepareReleaseOutput = async (root, coreRoot) => {
  await cp(path.join(packageRoot, 'lib'), path.join(root, 'lib'), {
    recursive: true,
    // 模拟 cleanBuildRelease 后的 Bob 编译输出，不复制真实工作区中可能
    // 残留的 release staging；否则夹具会把 owned vendor 当作输入污染。
    filter: (source) => {
      const relative = path.relative(path.join(packageRoot, 'lib'), source);
      return relative !== 'vendor' && !relative.startsWith(`vendor${path.sep}`);
    },
  });
  await cp(
    path.join(packageRoot, 'package.json'),
    path.join(root, 'package.json'),
  );
  await cp(
    path.join(packageRoot, 'apple-fault-matrix'),
    path.join(root, 'apple-fault-matrix'),
    { recursive: true },
  );
  await stageBundledCore({
    packageRoot: root,
    workspaceRoot,
    sourceRoot: coreRoot,
  });
};

try {
  const inputs = resolveInstalledInputs(workspaceRoot);
  await Promise.all([
    prepareReleaseOutput(firstOutput, inputs.coreRoot),
    prepareReleaseOutput(secondOutput, inputs.coreRoot),
  ]);
  const firstManifest = await stageSecureWebView({
    ...inputs,
    outputRoot: firstOutput,
  });
  const secondManifest = await stageSecureWebView({
    ...inputs,
    outputRoot: secondOutput,
  });

  assert.deepEqual(firstManifest, secondManifest);
  assert.deepEqual(
    firstManifest.files,
    await collectIntegrityEntries(firstOutput),
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
  const coreAdapter = await read(
    firstOutput,
    'lib/vendor/core/View.android.js',
  );
  const iosRuntime = await read(
    firstOutput,
    'secure-webview/src/HNSecureWebView.ios.tsx',
  );
  const iosAdapter = await read(firstOutput, 'lib/vendor/core/View.ios.js');
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
  assert.equal(moduleSpec.includes(`'${MODULE_NAME}'`), true);
  assert.equal(
    moduleSpec.includes('getConstants(): NativeCapabilityConstants;'),
    true,
  );
  assert.equal(
    androidRuntime.includes(`registerCallableModule('${CALLABLE_MODULE_NAME}'`),
    true,
  );
  assert.equal(
    coreAdapter.includes('require("../../../secure-webview")'),
    true,
  );
  assert.equal(coreAdapter.includes('require("react-native-webview")'), false);
  assert.equal(iosRuntime.includes('HNSecureWebViewNativeComponent'), true);
  assert.equal(iosRuntime.includes('NativeHNSecureWebViewModule'), true);
  assert.equal(iosRuntime.includes('react-native-webview'), false);
  assert.equal(iosAdapter.includes('require("../../../secure-webview")'), true);
  assert.equal(iosAdapter.includes('react-native-webview'), false);
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
  assert.equal(
    await exists(firstOutput, 'apple/HNSecureWebViewImpl.m'),
    true,
  );
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
  const appleManager = await read(firstOutput, 'apple/HNSecureWebViewManager.mm');
  const appleFabric = await read(firstOutput, 'apple/HNSecureWebView.mm');
  const appleDetectorTypes = await read(
    firstOutput,
    'apple/RCTConvert+WKDataDetectorTypes.m',
  );
  const appleDetectorTypesHeader = await read(
    firstOutput,
    'apple/RCTConvert+WKDataDetectorTypes.h',
  );
  for (const source of [appleImplementation, appleManager, appleDetectorTypes]) {
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
    appleDetectorTypes.includes('+ (WKDataDetectorTypes)HNSecureWKDataDetectorTypes:(id)json'),
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
  assert.equal(applePodspec.includes(':osx'), false);
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
  assert.equal(
    packageManifest.dependencies['react-native-webview'],
    'patch:react-native-webview@npm%3A13.16.1#~/.yarn/patches/react-native-webview-npm-13.16.1-1ec793e21f.patch',
  );
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
  assert.equal(
    Object.keys(firstManifest.files).length > REVIEWED_INPUT_FILES.length,
    true,
  );
  assert.equal(JSON.stringify(firstManifest).includes('patch:'), false);
  assert.equal(JSON.stringify(firstManifest).includes('.yarn/patches'), false);
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
      coreRoot: inputs.coreRoot,
      outputRoot: baselineFailureOutput,
    }),
    /Reviewed input SHA-256 mismatch for android\/src\/main\/java\/com\/reactnativecommunity\/webview\/RNCWebViewClient\.java/,
  );
  assert.equal(await exists(baselineFailureOutput, 'android'), false);
  assert.equal(await exists(baselineFailureOutput, 'secure-webview'), false);
  assert.equal(
    await exists(baselineFailureOutput, 'SECURE_WEBVIEW_SHA256.json'),
    false,
  );

  // 真实快速失败回归：core adapter writer 读一个文件后立即失败，android/runtime
  // writer 已经真实写盘。失败必须等所有 writer settle 并清理，不留任何残留。
  await mkdir(path.join(fastFailureCoreRoot, 'lib/commonjs'), {
    recursive: true,
  });
  await writeFile(
    path.join(fastFailureCoreRoot, 'lib/commonjs/View.js'),
    '// fixture without the patched Android WebView import anchor\n',
  );
  await assert.rejects(
    stageSecureWebView({
      sourceRoot: inputs.sourceRoot,
      coreRoot: fastFailureCoreRoot,
      outputRoot: fastFailureOutput,
    }),
    /Patched core Android WebView import anchor was not found/,
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
      coreRoot: inputs.coreRoot,
      outputRoot: writerRaceOutput,
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
    rm(fastFailureCoreRoot, { recursive: true, force: true }),
    rm(fastFailureOutput, { recursive: true, force: true }),
    rm(writerRaceOutput, { recursive: true, force: true }),
  ]);
}
