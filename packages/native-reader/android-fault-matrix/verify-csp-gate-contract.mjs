import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourcePath = new URL(
  '../android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebView.java',
  import.meta.url,
);
const manifestPath = new URL('../foliate-runtime/native/manifest.json', import.meta.url);
const readerHtmlPath = new URL('../foliate-runtime/native/reader.html', import.meta.url);
const corpusPath = new URL('../secure-webview/foliate-host-wire-corpus.v1.json', import.meta.url);

const [source, manifestText, readerHtml, corpusText] = await Promise.all([
  readFile(sourcePath, 'utf8'),
  readFile(manifestPath, 'utf8'),
  readFile(readerHtmlPath, 'utf8'),
  readFile(corpusPath, 'utf8'),
]);
const manifest = JSON.parse(manifestText);
const corpus = JSON.parse(corpusText);
const assets = new Map(manifest.assets.map((asset) => [asset.path, asset]));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(assets.get('probes/csp-1x1.png')?.mimeType === 'image/png', 'missing exact PNG probe');
assert(
  assets.get('probes/csp-external-canary.js')?.mimeType === 'text/javascript; charset=utf-8',
  'missing exact external JS probe',
);
const readerAsset = assets.get('reader.html');
assert(readerAsset?.category === 'native-host-document', 'reader.html must be the manifest host document');
assert(readerAsset?.source?.endsWith('foliate-host-csp-1'),
  'reader.html manifest source must pin the host CSP version');
const initialCsp = readerHtml.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
assert(initialCsp, 'reader.html must declare an initial CSP meta policy');
assert(initialCsp.includes("default-src 'none'"), 'reader.html host CSP must fail closed by default');
assert(initialCsp.includes("script-src 'self'"), 'reader.html host CSP must constrain scripts to self');
assert(source.includes('CSP_PROBE_IMAGE_URL'), 'gate does not reference the PNG probe constant');
assert(source.includes('CSP_PROBE_SCRIPT_URL'), 'gate does not reference the JS probe constant');
assert(!source.includes('Set.of("*")'), 'wildcard WebMessage listener origin is forbidden');
assert(!source.includes('addJavascriptInterface'), 'legacy JavaScript interface fallback is forbidden');
assert(!source.includes('@JavascriptInterface'), 'legacy JavaScript interface annotation is forbidden');
assert(!source.includes('srcdoc'), 'the CSP probe may not use srcdoc');
assert(!source.includes('PerformanceResourceTiming'), 'the CSP probe may not infer loading from timing');

const probeUrl = source.indexOf('const probeUrl=URL.createObjectURL');
const createFrame = source.indexOf('function createFrame(isStrict)');
const strictCsp = source.indexOf("if(isStrict){frame.setAttribute('csp',strictCsp);}");
const sandbox = source.indexOf("frame.setAttribute('sandbox','allow-same-origin allow-scripts')");
const frameSource = source.indexOf('frame.src=probeUrl');
const append = source.indexOf('appendChild(frame)');
assert(probeUrl >= 0 && createFrame > probeUrl, 'one blob URL must be pre-created before both frames');
assert(source.split('URL.createObjectURL').length === 2,
  'control and strict must reuse exactly one pre-created blob URL');
assert(strictCsp >= createFrame && strictCsp < sandbox && sandbox < frameSource && frameSource < append,
  'strict CSP and shared sandbox must be applied before iframe src and append');
assert(!source.includes('frame.src=URL.createObjectURL'),
  'frames may not create independent blob URLs while assigning src');
assert(source.includes('const control=createFrame(false);const strict=createFrame(true);'),
  'control and strict must derive from the same frame factory and shared document URL');
assert(source.includes('strictObserver.disconnect') && source.includes('URL.revokeObjectURL(probeUrl)'),
  'probe must disconnect the observer and revoke the blob URL before drain');
assert(source.includes("send('probe-drained'"), 'probe must acknowledge callback/source-I/O drain');
assert(source.includes('completedWithoutFailure:!terminalFailure'),
  'drain must preserve a queued failure verdict even if messages are observed out of order');
assert(source.includes('state = State.CANDIDATE'), 'candidate state is required');
assert(source.includes('state = State.READY'), 'ready transition is required');
assert(source.includes('void onProbeEvaluateCompleted'), 'evaluate completion must be a verdict input');
assert(source.includes('void onProbeEvaluateFailed'), 'evaluate failure must be fail-closed');
assert(source.includes('void onProbeDrained'), 'drain acknowledgement must be a verdict input');
assert(source.includes('void onStrictJavaScriptError') && source.includes('void onStrictPngError'),
  'strict JS and PNG failures must be verdict inputs');
assert(source.includes('clearProbeLocked();') && source.includes('state = State.READY;'),
  'READY must discard the completed generation after drain');
assert(!source.includes('The token is retained in READY'),
  'READY must not retain a generation for post-READY canary revocation');
assert(source.includes('synchronized (lock)'), 'single-lock gate is required');

// 4B's final host transport must replace (not extend) the one-shot 4A listener.
// This is intentionally a static supplement to the direct Java fault matrix, not its replacement.
assert(source.includes('WebViewCompat.removeWebMessageListener'), '4A listener must be removed before final reload');
assert(source.includes('WebViewCompat.createWebMessageChannel'), 'final host requires a native WebMessageChannel');
assert(source.includes('WebViewCompat.postWebMessage'), 'native must transfer the port to the exact host');
assert(!source.includes('Set.of("*")'), 'private bridge must not use wildcard origins');
assert(source.includes('NATIVE_ASSET_ORIGIN'), 'private-port transfer must use the exact asset origin');
assert(source.includes('installFoliateNativeHostBridge'), 'port must remain in bootstrap lexical closure');
assert(source.includes('nativeFoliateHostBridge.receive'), 'private port must be validated before dispatch');
assert(source.includes('nativeFoliateHostBridge.send'), 'adapter wires must be validated before private-port forwarding');
assert(source.includes('onMessage(data, NATIVE_READER_HOST_URL)'), 'authenticated host wires must reach retained onMessage ABI');
assert(source.includes('new StrictJson(data).parse()'), 'native must reject duplicate-key JSON before validation');
assert(source.includes('parse(data, "native-to-host")'), 'native-to-host adapter wire must use the strict parser');
assert(source.includes('parse(data, "host-to-native")'), 'host-to-native wire must use the strict parser');
assert(source.includes('"hn-foliate-host"'), 'native protocol name must remain closed');
assert(!source.includes('hn-foliate-transfer"'), '4B must not add transfer transport handling');
assert(!source.includes('prepareNativeSource'), '4B final bridge must not start source I/O');
assert(!source.includes('view.open'), '4B final bridge must not open Foliate');
assert(source.includes('public void postMessage(String data)'), 'retained postMessage ABI must be owned by HNSecureWebView');
assert(source.includes('postFoliateHostWire(data)'), 'secure postMessage must route to the native private port');
assert(source.includes('mayRunGenericPageCommand'), 'secure host must have an explicit generic-command gate');
assert(source.includes('state == State.UNSUPPORTED'), 'unsupported capability state must be observable');
assert(source.includes('|| state == State.UNSUPPORTED;'), 'unsupported bridge state must remain final secure mode');
assert(source.includes('void terminate()'), 'private bridge must own terminal teardown');
const capabilityGate = source.slice(
  source.indexOf('static final class NativePlatformCapabilityGate'),
  source.indexOf('static final class NativeFoliateHostBridge'),
);
assert(!capabilityGate.includes('State.TERMINATED'), 'capability gate may not reference private-bridge terminal state');
assert(!capabilityGate.includes('inflightType') && !capabilityGate.includes('inflightCommandId'),
  'capability gate may not reference private-bridge inflight fields');
assert(corpus.protocol === 'hn-foliate-host' && corpus.schemaVersion === 1, 'Android must consume fixed shared corpus v1');
for (const id of [
  'invalid-fraction', 'invalid-exponent', 'invalid-leading-zero', 'invalid-duplicate-key',
  'invalid-mixed-destination', 'invalid-mixed-toc', 'invalid-transfer', 'invalid-ready',
  'invalid-source-uri', 'invalid-base64-bytes-chunk',
]) {
  assert(corpus.cases.some((entry) => entry.id === id), `shared corpus missing ${id}`);
}

const clientSourcePath = new URL(
  '../android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebViewClient.java',
  import.meta.url,
);
const chromeSourcePath = new URL(
  '../android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebChromeClient.java',
  import.meta.url,
);
const managerSourcePath = new URL(
  '../android/src/main/java/com/hamsternote/nativereader/securewebview/HNSecureWebViewManagerImpl.kt',
  import.meta.url,
);
const oldArchitectureManagerPath = new URL(
  '../android/src/oldarch/com/hamsternote/nativereader/securewebview/HNSecureWebViewManager.java',
  import.meta.url,
);
const newArchitectureManagerPath = new URL(
  '../android/src/newarch/com/hamsternote/nativereader/securewebview/HNSecureWebViewManager.java',
  import.meta.url,
);
const typesPath = new URL('../secure-webview/src/HNSecureWebViewTypes.ts', import.meta.url);
const androidComponentPath = new URL('../secure-webview/src/HNSecureWebView.android.tsx', import.meta.url);
const [
  clientSource,
  chromeSource,
  managerSource,
  oldArchitectureManagerSource,
  newArchitectureManagerSource,
  typesSource,
  androidComponentSource,
] = await Promise.all([
  readFile(clientSourcePath, 'utf8'),
  readFile(chromeSourcePath, 'utf8'),
  readFile(managerSourcePath, 'utf8'),
  readFile(oldArchitectureManagerPath, 'utf8'),
  readFile(newArchitectureManagerPath, 'utf8'),
  readFile(typesPath, 'utf8'),
  readFile(androidComponentPath, 'utf8'),
]);
assert(clientSource.includes('isSecureNativeReaderHostModeActive()') && clientSource.includes('return true;'),
   'secure host main-frame navigation must be native-denied');
assert(clientSource.includes('optional local-read prop is never an authority for final-host child documents'),
  'secure host subframes must be denied regardless of optional read-access props');
const interceptRequest = clientSource.slice(clientSource.indexOf('shouldInterceptRequest(WebView view'));
const assetLoaderBeforeSecureBlock = interceptRequest.indexOf('final WebResourceResponse foliateAssetResponse')
  < interceptRequest.indexOf('isSecureNativeReaderHostModeActive() && !request.isForMainFrame()');
assert(assetLoaderBeforeSecureBlock,
  'secure non-main requests must consult manifest-exact AssetLoader before the final deny');
assert(clientSource.includes('return response == null ? FoliateAssetHost.notFound() : response;'),
  'unknown appasset requests must receive an explicit 404 rather than network fallback');
assert(chromeSource.includes('request.deny()'), 'secure host media permission must be denied');
assert(chromeSource.includes('return false;'), 'secure host popup/target=_blank must return false');
assert(chromeSource.includes('callback.invoke(origin, false, false)'), 'secure host geolocation must be denied');
assert(chromeSource.includes('filePathCallback.onReceiveValue(null)'), 'secure host file chooser must be denied');
assert(managerSource.includes('isSecureNativeReaderHostModeActive()') && managerSource.includes('return@DownloadListener'),
   'secure host downloads must be denied before RN/DownloadManager');
assert(managerSource.includes('IdentityHashMap<HNSecureWebViewWrapper, ReadableMap?>'),
  'pending source must be per view instance, not a manager-global scalar');
assert(managerSource.includes('isExactFoliateNativeHostSelector(source)'),
  'source-shaped selectors must be exact and must reject mixed/unknown source maps');
assert(managerSource.includes('source.getType("nativeHost") != ReadableType.String')
  && managerSource.indexOf('source.getType("nativeHost") != ReadableType.String')
    < managerSource.indexOf('source.getString("nativeHost")'),
  'the exact selector parser must type-check nativeHost before reading it');
assert(!managerSource.includes('fun setNativeHost('),
  'ManagerImpl must not expose a public nativeHost selection path');
for (const [architecture, manager] of [
  ['old architecture', oldArchitectureManagerSource],
  ['new architecture', newArchitectureManagerSource],
]) {
  assert(!manager.includes('@ReactProp(name = "nativeHost")'),
    `${architecture} manager must not expose nativeHost as a top-level React prop`);
  assert(!manager.includes('setNativeHost(HNSecureWebViewWrapper'),
    `${architecture} manager must not expose a nativeHost prop setter`);
}
assert(oldArchitectureManagerSource.includes('@ReactProp(name = "source")')
  && oldArchitectureManagerSource.includes('mHNSecureWebViewManagerImpl.setSource(view, value);'),
  'old architecture must select documents only through its source map');
assert(newArchitectureManagerSource.includes('@ReactProp(name = "newSource")')
  && newArchitectureManagerSource.includes('mHNSecureWebViewManagerImpl.setSource(view, value);'),
  'new architecture must select documents only through its newSource map');
const managerLoadSource = managerSource.slice(
  managerSource.indexOf('private fun loadSource('),
  managerSource.indexOf('private fun isExactFoliateNativeHostSelector('),
);
assert((managerLoadSource.match(/view\.setNativeHost\(/g) ?? []).length === 2,
  'only the internal exact-selector loadSource branch may call HNSecureWebView.setNativeHost');
assert(!source.includes('public void setNativeHost('),
  'HNSecureWebView.setNativeHost must not be a public selection API');
// The TypeScript boundary is intentionally inspected but not generated or changed here. This
// reverse proof prevents nativeConfig.props.nativeHost from becoming a second selection authority
// after the Android managers stop accepting a top-level prop.
assert(typesSource.includes('delete safeNativeConfigProps.nativeHost;'),
  'nativeConfig.props.nativeHost must be stripped before native prop forwarding');
assert(androidComponentSource.includes('{...secureNativeHostProps(nativeConfig?.props)}'),
  'Android component must forward nativeConfig props only through the selector-stripping helper');
assert(source.includes('NATIVE_FOLIATE_HOST_SELECTOR = "foliate"'),
  'Android must use an exact Foliate native-host selector');
assert(source.includes('boolean isGenericPageCommandLocked()'),
  'selector must lock generic page commands immediately');
for (const command of ['public void reload()', 'public void goBack()', 'public void goForward()', 'public void clearHistory()']) {
  assert(source.includes(command), `secure WebView must override and lock ${command}`);
}
assert(source.includes('boolean selectFoliateHost()'),
  'selector state must remain owned by each WebView bridge');
assert(source.includes('genericPageWasLoaded'),
  'generic-to-selector transition must require a fresh WebView instance');
assert(source.includes('super.loadUrl(NATIVE_READER_HOST_URL)'),
  'only the native selector-owned path may load reader.html');
assert(source.includes('postFoliateHostWire(data)'),
  'pre-bind postMessage must remain private-port-only, never MessageEvent fallback');
const portInstalled = source.indexOf('nativeFoliateHostBridge.onPrivatePortInstalled();');
const hostReadyEvent = source.indexOf('emitNativeFoliateHostReadyOnce();');
assert(portInstalled >= 0 && hostReadyEvent > portInstalled,
  'host-ready onLoad must follow final private-port installation');
assert(source.includes('private boolean nativeFoliateHostReadyEventEmitted = false;')
  && source.includes('if (nativeFoliateHostReadyEventEmitted || !nativeFoliateHostBridge.isAwaitingAdapterBind(getUrl()))'),
  'host-ready onLoad must be per-WebView and emitted at most once');
assert(source.includes('void rejectGenericSourceUpdate()') && source.includes('nativeFoliateHostBridge.markUnsupported();'),
  'source update after selector must fail stably rather than replay a generic page');
assert(managerSource.includes('"goBack" -> if (webView.mayRunGenericPageCommand())')
  && managerSource.includes('"injectJavaScript" -> args?.getString(0)?.let { script ->')
  && managerSource.includes('"clearHistory" -> if (webView.mayRunGenericPageCommand())'),
  'manager generic history and injected-JS commands must honor the secure lock');
assert(clientSource.includes('isReservedFoliateRequest(uri) && !view.isNativeFoliateHostSelected()'),
  'reserved /foliate/ requests must be 404 before selector activation');
assert(clientSource.includes('emitFoliateHostReadyEvent'),
  'onLoad must be emitted from the host-ready private-port boundary');

console.log('Android 4A CSP gate and 4B selector/private-host static contract passed.');
