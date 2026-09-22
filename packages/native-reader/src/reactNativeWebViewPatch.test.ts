import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const webViewRoot =
  process.env.REACT_NATIVE_WEBVIEW_TEST_ROOT ??
  dirname(require.resolve('react-native-webview/package.json'));

function webViewSource(path: string): string {
  return readFileSync(join(webViewRoot, path), 'utf8');
}

function sourceBlock(source: string, anchor: string): string {
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex === -1) {
    throw new Error(`Source anchor not found: ${anchor}`);
  }

  const openingBrace = source.indexOf('{', anchorIndex);
  if (openingBrace === -1) {
    throw new Error(`Opening brace not found after: ${anchor}`);
  }

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(anchorIndex, index + 1);
      }
    }
  }

  throw new Error(`Closing brace not found after: ${anchor}`);
}

function expectFragmentsInOrder(source: string, fragments: string[]): void {
  let previousIndex = -1;

  for (const fragment of fragments) {
    const index = source.indexOf(fragment, previousIndex + 1);
    expect(index).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

function compactSource(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

// 此仓库没有接入依赖包的原生测试 target；这些断言直接检查 Yarn 实际安装、
// 将参与 Codegen/原生编译的源码，是当前工作区最接近原生运行时的可复现证据。
test('installed package exposes and forwards the opt-in prop with a false default', () => {
  const packageJson = JSON.parse(webViewSource('package.json')) as {
    version: string;
  };
  const publicTypes = webViewSource('src/WebViewTypes.ts');
  const nativeProps = webViewSource('src/RNCWebViewNativeComponent.ts');
  const publishedPublicTypes = webViewSource('lib/WebViewTypes.d.ts');
  const publishedNativeProps = webViewSource(
    'lib/RNCWebViewNativeComponent.d.ts',
  );

  expect(packageJson.version).toBe('13.16.1');
  expect(
    publicTypes.match(/failClosedOnShouldStartLoadWithRequest\?: boolean;/g),
  ).toHaveLength(2);
  expect(nativeProps).toContain(
    'failClosedOnShouldStartLoadWithRequest?: WithDefault<boolean, false>;',
  );
  expect(
    publishedPublicTypes.match(
      /failClosedOnShouldStartLoadWithRequest\?: boolean;/g,
    ),
  ).toHaveLength(2);
  expect(publishedNativeProps).toContain(
    'failClosedOnShouldStartLoadWithRequest?: WithDefault<boolean, false>;',
  );

  for (const platform of ['ios', 'android']) {
    const component = webViewSource(`src/WebView.${platform}.tsx`);
    expect(component).toContain(
      'failClosedOnShouldStartLoadWithRequest = false,',
    );
    expect(component).toMatch(
      /failClosedOnShouldStartLoadWithRequest=\{\s*failClosedOnShouldStartLoadWithRequest\s*\}/,
    );
  }
});

test('iOS Codegen schema and both event paths preserve target-frame state', () => {
  const manager = webViewSource('apple/RNCWebViewManager.mm');
  const implementationHeader = webViewSource('apple/RNCWebViewImpl.h');
  const implementation = webViewSource('apple/RNCWebViewImpl.m');
  const fabricView = webViewSource('apple/RNCWebView.mm');
  const nativeComponent = webViewSource('src/RNCWebViewNativeComponent.ts');
  const publishedNativeComponent = webViewSource(
    'lib/RNCWebViewNativeComponent.d.ts',
  );
  const codegenEvent = sourceBlock(
    nativeComponent,
    'export type ShouldStartLoadRequestEvent = Readonly<{',
  );
  const publishedCodegenEvent = sourceBlock(
    publishedNativeComponent,
    'export type ShouldStartLoadRequestEvent = Readonly<{',
  );
  const decisionMethod = sourceBlock(
    implementation,
    '- (void)                  webView:(WKWebView *)webView',
  );
  const oldArchitectureEvent = sourceBlock(
    decisionMethod,
    'if (_onShouldStartLoadWithRequest) {',
  );
  const fabricEventMapping = sourceBlock(
    fabricView,
    '_view.onShouldStartLoadWithRequest = [self](NSDictionary* dictionary) {',
  );

  expect(manager).toContain(
    'RCT_EXPORT_VIEW_PROPERTY(failClosedOnShouldStartLoadWithRequest, BOOL)',
  );
  expect(implementationHeader).toContain(
    '@property (nonatomic, assign) BOOL failClosedOnShouldStartLoadWithRequest;',
  );
  expect(implementation).toContain(
    '_failClosedOnShouldStartLoadWithRequest = NO;',
  );
  expect(codegenEvent).toMatch(
    /isTopFrame: boolean;\s+hasTargetFrame: boolean;/,
  );
  expect(publishedCodegenEvent).toMatch(
    /isTopFrame: boolean;\s+hasTargetFrame: boolean;/,
  );
  expect(decisionMethod).toMatch(
    /BOOL isTopFrame = navigationAction\.targetFrame != nil && navigationAction\.targetFrame\.isMainFrame;\s+BOOL hasTargetFrame = navigationAction\.targetFrame != nil;/,
  );
  expect(decisionMethod).not.toContain(
    'BOOL isTopFrame = [request.URL isEqual:request.mainDocumentURL];',
  );
  expectFragmentsInOrder(oldArchitectureEvent, [
    '@"isTopFrame": @(isTopFrame)',
    '@"hasTargetFrame": @(hasTargetFrame)',
    '_onShouldStartLoadWithRequest(event);',
  ]);
  expect(fabricEventMapping).toMatch(
    /\.isTopFrame = static_cast<bool>\(\[\[dictionary valueForKey:@"isTopFrame"\] boolValue\]\),\s+\.hasTargetFrame = static_cast<bool>\(\[\[dictionary valueForKey:@"hasTargetFrame"\] boolValue\]\),/,
  );
  expectFragmentsInOrder(fabricEventMapping, [
    '.hasTargetFrame =',
    'webViewEventEmitter->onShouldStartLoadWithRequest(data);',
  ]);
  expect(fabricView).toContain(
    'REMAP_WEBVIEW_PROP(failClosedOnShouldStartLoadWithRequest)',
  );
});

test('Android wires old and new architecture managers through the view', () => {
  const oldManager = webViewSource(
    'android/src/oldarch/com/reactnativecommunity/webview/RNCWebViewManager.java',
  );
  const newManager = webViewSource(
    'android/src/newarch/com/reactnativecommunity/webview/RNCWebViewManager.java',
  );
  const managerImplementation = webViewSource(
    'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewManagerImpl.kt',
  );
  const view = webViewSource(
    'android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java',
  );

  for (const manager of [oldManager, newManager]) {
    expect(manager).toContain(
      '@ReactProp(name = "failClosedOnShouldStartLoadWithRequest", defaultBoolean = false)',
    );
    expect(manager).toContain(
      'mRNCWebViewManagerImpl.setFailClosedOnShouldStartLoadWithRequest(view, value);',
    );
  }
  expect(newManager).toMatch(
    /@Override\s+@ReactProp\(name = "failClosedOnShouldStartLoadWithRequest", defaultBoolean = false\)/,
  );
  expect(managerImplementation).toMatch(
    /fun setFailClosedOnShouldStartLoadWithRequest\(viewWrapper: RNCWebViewWrapper, value: Boolean\)[\s\S]*?viewWrapper\.webView\.setFailClosedOnShouldStartLoadWithRequest\(value\)/,
  );
  expect(view).toContain(
    'protected boolean failClosedOnShouldStartLoadWithRequest = false;',
  );
  expect(view).toContain(
    'public void setFailClosedOnShouldStartLoadWithRequest(boolean enabled)',
  );
  expect(view).toContain(
    'public boolean getFailClosedOnShouldStartLoadWithRequest()',
  );
});

test('Android fail-closed gate blocks every undecidable top-level outcome', () => {
  const client = webViewSource(
    'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java',
  );
  const mainFrameGate = sourceBlock(
    client,
    'private boolean shouldOverrideUrlLoadingForMainFrame(WebView view, String url) {',
  );
  const synchronousGate = sourceBlock(
    mainFrameGate,
    'if (canUseSynchronousJsGate) {',
  );
  const timeoutBranch = sourceBlock(synchronousGate, 'if (now >= deadline) {');

  expect(mainFrameGate).toContain(
    'final boolean failClosed = rncWebView.getFailClosedOnShouldStartLoadWithRequest();',
  );
  expect(mainFrameGate).not.toContain('isForMainFrame');
  expect(mainFrameGate).toContain('reactContext.hasActiveCatalystInstance()');
  expect(mainFrameGate).toContain('rncWebView.mMessagingJSModule != null');
  expect(mainFrameGate).toContain(
    'rncWebView.getReactApplicationContext().getJavaScriptContextHolder().get() != 0',
  );
  expect(mainFrameGate).toMatch(
    /catch \(RuntimeException e\) \{\s*FLog\.e\(TAG, "Couldn't inspect the React instance for onShouldStartLoadWithRequest\.", e\);\s*if \(failClosed\) \{\s*return true;\s*\}\s*throw e;\s*\}/,
  );
  expect(timeoutBranch).toMatch(
    /^if \(now >= deadline\) \{\s*FLog\.w\(TAG, "Did not receive response to shouldOverrideUrlLoading in time\."\);\s*return failClosed;\s*\}$/,
  );
  expect(synchronousGate).toMatch(
    /catch \(InterruptedException e\)[\s\S]*?Thread\.currentThread\(\)\.interrupt\(\);[\s\S]*?return failClosed;/,
  );
  expect(synchronousGate).toMatch(
    /rncWebView\.dispatchDirectShouldStartLoadWithRequest\(event\);[\s\S]*?catch \(RuntimeException e\) \{\s*FLog\.e\(TAG, "Failed to dispatch onShouldStartLoadWithRequest\.", e\);\s*if \(failClosed\) \{\s*return true;\s*\}\s*throw e;\s*\} finally \{\s*\/\/ Removing the lock makes callbacks that arrive after a failure harmless\.\s*RNCWebViewModuleImpl\.shouldOverrideUrlLoadingLock\.removeLock\(lockIdentifier\);/,
  );
  expect(mainFrameGate).toMatch(
    /if \(failClosed\) \{\s*FLog\.w\(TAG, "Blocking top-level navigation because the JavaScript gate is unavailable\."\);\s*return true;/,
  );
  expect(mainFrameGate).toMatch(
    /callbackState == RNCWebViewModuleImpl\.ShouldOverrideUrlLoadingLock\.ShouldOverrideCallbackState\.UNDECIDED[\s\S]*?return failClosed;/,
  );
  expect(mainFrameGate).toContain(
    'return callbackState == RNCWebViewModuleImpl.ShouldOverrideUrlLoadingLock.ShouldOverrideCallbackState.SHOULD_OVERRIDE;',
  );
});

test('Android API 24+ denies untrusted subframes and intercepts their resources', () => {
  const client = webViewSource(
    'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java',
  );
  const requestOverload = sourceBlock(
    client,
    'public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {',
  );
  const stringOverload = sourceBlock(
    client,
    'public boolean shouldOverrideUrlLoading(WebView view, String url) {',
  );
  const subframeAllowlist = sourceBlock(
    client,
    'private boolean isAllowedSecureSubframeUrl(RNCWebView webView, Uri uri) {',
  );
  const subresourceIntercept = sourceBlock(
    client,
    'public @Nullable WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {',
  );
  expectFragmentsInOrder(requestOverload, [
    'final String url = request.getUrl().toString();',
    'if (!request.isForMainFrame()) {',
    'getFailClosedOnShouldStartLoadWithRequest()',
    'isAllowedSecureSubframeUrl(rncWebView, request.getUrl())',
    'return true;',
    'return false;',
    'return this.shouldOverrideUrlLoadingForMainFrame(view, url);',
  ]);
  expect(client).toContain(
    '"about:blank".equals(url) || "about:srcdoc".equals(url)',
  );
  expect(client).toContain('getAllowingReadAccessToURL()');
  expect(client).toContain(
    'private boolean isUnambiguousLocalFileUri(Uri uri)',
  );
  expect(client).toContain(
    'final String authority = uri == null ? null : uri.getAuthority();',
  );
  expect(client).toContain('(authority != null && !authority.isEmpty())');
  expect(client).not.toContain('|| uri.getAuthority() != null');
  expect(subframeAllowlist).toContain(
    'final File canonicalRoot = new File(rootUri.getPath()).getCanonicalFile();',
  );
  expect(subframeAllowlist).toContain(
    'final File canonicalCandidate = new File(uri.getPath()).getCanonicalFile();',
  );
  expect(subframeAllowlist).toMatch(
    /for \(File parent = canonicalCandidate\.getParentFile\(\); parent != null; parent = parent\.getParentFile\(\)\)/,
  );
  expect(subframeAllowlist).not.toContain(
    'candidatePath.startsWith(canonicalRoot)',
  );
  expect(client).toContain(
    'shouldInterceptRequest(WebView view, WebResourceRequest request)',
  );
  expect(client).toContain('blockSecureSubresource()');
  expect(subresourceIntercept).toContain(
    'isAllowedSecureSubframeUrl(rncWebView, request.getUrl())',
  );
  expect(requestOverload).not.toContain(
    'dispatchDirectShouldStartLoadWithRequest',
  );
  expect(compactSource(stringOverload)).toBe(
    'public boolean shouldOverrideUrlLoading(WebView view, String url) { return shouldOverrideUrlLoadingForMainFrame(view, url); }',
  );
});

test('iOS fail-closed gate serializes JS, timeout, teardown, and exception decisions once', () => {
  const implementation = webViewSource('apple/RNCWebViewImpl.m');
  const decisions = webViewSource('apple/RNCWebViewDecisionManager.m');
  const module = webViewSource('apple/RNCWebViewModule.mm');

  expect(implementation).toContain(
    '_failClosedOnShouldStartLoadWithRequest && !_onShouldStartLoadWithRequest',
  );
  expect(implementation).toContain('HNSecureWebViewNavigationDecisionTimeout');
  expect(implementation).toContain('@catch (NSException *exception)');
  expect(implementation).toContain('cancelPendingNavigationDecisions');
  expect(implementation).toContain('setDecisionHandler: ^(BOOL shouldStart)');
  expect(implementation).toContain('owner:self');
  expect(implementation).toContain(
    'cancelDecisionHandlerForLockIdentifier:lockIdentifier',
  );
  expect(implementation).toContain('HNSecureWebViewNavigationDecisionTimeout');
  expect(implementation).toContain('isNavigationDecisionOwnerActive');
  expect(implementation).toContain('activateNavigationDecisionOwner');
  expect(implementation).toContain(
    '} owner:self generation:[self navigationDecisionOwnerGeneration]]',
  );
  expect(implementation).toContain(
    'decisionHandler(cancelNavigation ? WKNavigationActionPolicyCancel : WKNavigationActionPolicyAllow)',
  );
  expect(decisions).toContain('RNCWebViewDecisionEntry');
  expect(decisions).toContain('dispatch_get_main_queue()');
  expect(decisions).toContain('performOnMainQueue:');
  expect(decisions).toContain('if ([NSThread isMainThread])');
  expect(decisions).toContain(
    'resolveShouldStart:shouldStart forLockIdentifier:lockIdentifier',
  );
  expect(decisions).toContain('cancelDecisionHandlerForLockIdentifier');
  expect(decisions).toContain('dispatchDecisionEvent:');
  expect(decisions).toContain('@catch (NSException *exception)');
  expect(decisions).toContain('[self.decisionHandlers removeObjectForKey:key]');
  expect(decisions).toContain(
    '@property (nonatomic, assign) NSUInteger generation;',
  );
  expect(decisions).toContain(
    '[entry.owner navigationDecisionOwnerGeneration] == entry.generation',
  );
  const manager = webViewSource('apple/RNCWebViewManager.mm');
  const detectorTypes = webViewSource('apple/RCTConvert+WKDataDetectorTypes.m');
  const detectorTypesHeader = webViewSource(
    'apple/RCTConvert+WKDataDetectorTypes.h',
  );
  expect(manager).toContain('#import "RCTConvert+WKDataDetectorTypes.h"');
  expect(detectorTypes).toContain('#import "RCTConvert+WKDataDetectorTypes.h"');
  expect(detectorTypesHeader).toContain(
    '+ (WKDataDetectorTypes)RNCWKDataDetectorTypes:(id)json;',
  );
  expect(manager).toContain('+ (WKContentMode)RNCWKContentMode:(id)json');
  expect(manager).toContain(
    '+ (RNCWebViewPermissionGrantType)RNCWebViewPrivatePermissionGrantType:(id)json',
  );
  expect(manager).toContain(
    'RCT_CUSTOM_VIEW_PROPERTY(contentMode, WKContentMode, RNCWebViewImpl)',
  );
  expect(manager).toContain(
    'RCT_CUSTOM_VIEW_PROPERTY(mediaCapturePermissionGrantType, RNCWebViewPermissionGrantType, RNCWebViewImpl)',
  );
  expect(detectorTypes).toContain(
    '+ (WKDataDetectorTypes)RNCWKDataDetectorTypes:(id)json',
  );
  expect(detectorTypes).toContain('RCTConvertMultiEnumValue(');
  expect(detectorTypes).not.toContain('RCT_MULTI_ENUM_CONVERTER(');
  expect(implementation).toContain(
    'NSString* name = [NSString stringWithFormat:@"RNC_%@_SwizzleHelperWK", subview.class.superclass];',
  );
  expect(implementation).toContain('hasPrefix:@"RNC_"');
  expect(implementation).not.toContain('HNSecure_%@_SwizzleHelperWK');
  expectFragmentsInOrder(decisions, [
    '[self.decisionHandlers removeObjectForKey:key]',
    'if (entry == nil) return;',
    'entry.handler(shouldStart && ownerIsCurrent);',
  ]);
  expectFragmentsInOrder(implementation, [
    'dispatchDecisionEvent:^{',
    '_onShouldStartLoadWithRequest(event);',
    '} forLockIdentifier:lockIdentifier];',
  ]);
  expect(module).toContain('constantsToExport');
  expect(module).toContain(
    'facebook::react::ModuleConstants<JS::NativeRNCWebViewModule::Constants>',
  );
  expect(module).toContain(
    'facebook::react::typedConstants<JS::NativeRNCWebViewModule::Constants>',
  );
  for (const capability of [
    'navigation-decision-fail-closed-v1',
    'main-frame-native-gate-v1',
    'subframe-local-root-deny-v1',
    'late-callback-safe-v1',
  ]) {
    expect(module).toContain(capability);
  }
});

test('Android uses one deadline, clears locks, and ignores late callbacks', () => {
  const client = webViewSource(
    'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java',
  );
  const moduleImplementation = webViewSource(
    'android/src/main/java/com/reactnativecommunity/webview/RNCWebViewModuleImpl.java',
  );
  const mainFrameGate = sourceBlock(
    client,
    'private boolean shouldOverrideUrlLoadingForMainFrame(WebView view, String url) {',
  );
  const synchronousGate = sourceBlock(
    mainFrameGate,
    'if (canUseSynchronousJsGate) {',
  );

  expectFragmentsInOrder(synchronousGate, [
    'final long deadline = SystemClock.elapsedRealtime() + SHOULD_OVERRIDE_URL_LOADING_TIMEOUT;',
    'while (lockObject.get() == RNCWebViewModuleImpl.ShouldOverrideUrlLoadingLock.ShouldOverrideCallbackState.UNDECIDED) {',
    'final long now = SystemClock.elapsedRealtime();',
    'if (now >= deadline) {',
    'lockObject.wait(deadline - now);',
  ]);
  expect(synchronousGate).not.toContain(
    'lockObject.wait(SHOULD_OVERRIDE_URL_LOADING_TIMEOUT)',
  );
  expect(synchronousGate).not.toMatch(
    /SystemClock\.elapsedRealtime\(\) - \w+ [><]=? SHOULD_OVERRIDE_URL_LOADING_TIMEOUT/,
  );
  expect(synchronousGate).toMatch(
    /finally \{\s*\/\/ Removing the lock makes callbacks that arrive after a failure harmless\.\s*RNCWebViewModuleImpl\.shouldOverrideUrlLoadingLock\.removeLock\(lockIdentifier\);\s*\}/,
  );
  expect(moduleImplementation).toMatch(
    /getLock\(lockIdentifier\);\s*if \(lockObject != null\) \{[\s\S]*?lockObject\.notify\(\);/,
  );
  expect(moduleImplementation).toContain(
    'shouldStart ? ShouldOverrideUrlLoadingLock.ShouldOverrideCallbackState.DO_NOT_OVERRIDE : ShouldOverrideUrlLoadingLock.ShouldOverrideCallbackState.SHOULD_OVERRIDE',
  );
});
