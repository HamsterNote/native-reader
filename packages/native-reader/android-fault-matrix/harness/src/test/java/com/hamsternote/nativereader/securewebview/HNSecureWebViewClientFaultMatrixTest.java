package com.hamsternote.nativereader.securewebview;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import android.net.Uri;
import android.os.SystemClock;
import android.os.Message;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import androidx.webkit.WebViewAssetLoader;

import com.facebook.react.bridge.JavaOnlyMap;
import com.facebook.react.bridge.JavaScriptContextHolder;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableMap;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * CMPAA-106 / CMPAA-75 阶段 3：真实生产 Java seam 的 Android 原生故障矩阵。
 *
 * <p>被测对象是 staging 产物中的真实类 {@link HNSecureWebViewClient} 的
 * fail-closed 导航 gate（shouldOverrideUrlLoadingForMainFrame，见
 * HNSecureWebViewClient.java:98-174）。JS 侧响应通过
 * {@link HNSecureWebViewModuleImpl#shouldStartLoadWithLockIdentifier} 的真实
 * 回调路径回灌（与线上 JS 模块收到响应后执行的代码相同）。
 *
 * <p>矩阵覆盖：bridge timeout / dispatch exception / Interrupted /
 * JS/Catalyst unavailable（三种子情形）/ React 实例检查异常 /
 * late callback 无害化 / main-frame deny / main-frame allow / subframe 策略。
 */
@RunWith(RobolectricTestRunner.class)
// API 35 是 Robolectric 在 Java 17 上支持的最高 Android SDK；compileSdk 仍为 36。
@Config(sdk = 35)
public class HNSecureWebViewClientFaultMatrixTest {

    private static final String DENIED_URL = "https://attacker.example/navigate";

    private HNSecureWebViewClient client;
    private HNSecureWebView webView;
    private ReactApplicationContext reactContext;
    private JavaScriptContextHolder jsContextHolder;
    private HNSecureWebViewModuleImpl moduleImpl;
    private MockedStatic<SystemClock> systemClock;

    @Before
    public void setUp() {
        client = spy(new HNSecureWebViewClient());
        webView = mock(HNSecureWebView.class);
        reactContext = mock(ReactApplicationContext.class);
        jsContextHolder = mock(JavaScriptContextHolder.class);

        when(webView.getReactApplicationContext()).thenReturn(reactContext);
        when(webView.getContext()).thenReturn(RuntimeEnvironment.getApplication());
        when(reactContext.hasActiveCatalystInstance()).thenReturn(true);
        when(reactContext.getJavaScriptContextHolder()).thenReturn(jsContextHolder);
        when(jsContextHolder.get()).thenReturn(1L);
        // gate 可用性的三个条件之一：messaging module 存在（package-private 字段，同包可写）
        webView.mMessagingJSModule = mock(HNSecureWebViewMessagingModule.class);
        setFailClosed(true);

        // 真实回调入口实例（构造仅持有 context，见 HNSecureWebViewModuleImpl.java:87）
        moduleImpl = new HNSecureWebViewModuleImpl(reactContext);

        // seam 的超时判定使用 SystemClock.elapsedRealtime()（HNSecureWebViewClient.java:127-135）。
        // mockable android.jar 中该方法是 stub，这里替换为真实推进的时钟，保证
        // 250ms deadline（SHOULD_OVERRIDE_URL_LOADING_TIMEOUT）语义与线上一致。
        systemClock = mockStatic(SystemClock.class);
        systemClock
                .when(SystemClock::elapsedRealtime)
                .thenAnswer(invocation -> System.nanoTime() / 1_000_000L);

        // createWebViewEvent 只组装事件载荷，不属于决策分支；用 RN 真实 JVM WritableMap
        // 实现（JavaOnlyMap）替代，避免单测依赖 android.view / Arguments 原生绑定。
        doAnswer(invocation -> new JavaOnlyMap())
                .when(client)
                .createWebViewEvent(any(), anyString());
    }

    @After
    public void tearDown() {
        systemClock.close();
    }

    private void setFailClosed(boolean failClosed) {
        when(webView.getFailClosedOnShouldStartLoadWithRequest()).thenReturn(failClosed);
    }

    /** stub dispatch：捕获 seam 发出的事件（可读取 lockIdentifier），交给 handler。 */
    private void onDispatch(Consumer<WritableMap> handler) {
        doAnswer(
                        invocation -> {
                            handler.accept(invocation.getArgument(0));
                            return true;
                        })
                .when(webView)
                .dispatchDirectShouldStartLoadWithRequest(any(WritableMap.class));
    }

    /** 经 HNSecureWebViewModuleImpl 真实回调路径回灌 JS 决策（同 HNSecureWebViewModuleImpl.java:228-237）。 */
    private void respondViaRealCallback(double lockIdentifier, boolean shouldStart) {
        moduleImpl.shouldStartLoadWithLockIdentifier(shouldStart, lockIdentifier);
    }

    /** 模拟 JS 在 delayMs 后异步响应。 */
    private void respondAsync(long delayMs, boolean shouldStart) {
        onDispatch(
                event -> {
                    final double lockIdentifier = event.getDouble("lockIdentifier");
                    Thread responder =
                            new Thread(
                                    () -> {
                                        try {
                                            Thread.sleep(delayMs);
                                        } catch (InterruptedException ignored) {
                                            Thread.currentThread().interrupt();
                                        }
                                        respondViaRealCallback(lockIdentifier, shouldStart);
                                    },
                                    "js-callback");
                    responder.setDaemon(true);
                    responder.start();
                });
    }

    /** 所有 subframe 检查均经过公开 override/intercept 入口，并使用框架实际解析的 Uri。 */
    private WebResourceRequest subframeRequest(String url) {
        WebResourceRequest request = mock(WebResourceRequest.class);
        when(request.isForMainFrame()).thenReturn(false);
        when(request.getUrl()).thenReturn(Uri.parse(url));
        return request;
    }

    private WebResourceRequest mainFrameRequest(String url) {
        WebResourceRequest request = mock(WebResourceRequest.class);
        when(request.isForMainFrame()).thenReturn(true);
        when(request.getUrl()).thenReturn(Uri.parse(url));
        return request;
    }

    private void assertSubframeAllowed(String url) {
        WebResourceRequest request = subframeRequest(url);
        assertFalse(client.shouldOverrideUrlLoading(webView, request));
        assertNull(client.shouldInterceptRequest(webView, request));
    }

    private void assertSubframeBlocked(String url) {
        WebResourceRequest request = subframeRequest(url);
        assertTrue(client.shouldOverrideUrlLoading(webView, request));
        assertNotNull(client.shouldInterceptRequest(webView, request));
    }

    /** Asset-host assertions are direct so every invalid URI is observable as a deterministic 404. */
    private HNSecureWebViewClient.FoliateAssetHost assetHost() {
        return new HNSecureWebViewClient.FoliateAssetHost(RuntimeEnvironment.getApplication());
    }

    private void assertAssetStatus(String url, int expectedStatus) {
        WebResourceResponse response = assetHost().intercept(Uri.parse(url));
        assertNotNull("asset host must always return an explicit response", response);
        assertEquals(expectedStatus, response.getStatusCode());
    }

    /**
     * 生产探针脚本用 JSONObject.quote 将探针 HTML 内嵌为 JS 字符串，真实 Android API35
     * 的 quote 会把 "/" 转义为 "\/"，因此断言必须匹配编码后的精确 URL 才能命中脚本内容。
     * 这里复用同一 quote 语义并仅剥掉外层引号，得到脚本中实际出现的 URL 文本。
     */
    private static String quotedProbeUrl(String url) {
        String quoted = JSONObject.quote(url);
        return quoted.substring(1, quoted.length() - 1);
    }

    private String readAssetText(String path) throws IOException {
        try (InputStream stream = RuntimeEnvironment.getApplication().getAssets().open(path)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            int read;
            while ((read = stream.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toString("UTF-8");
        }
    }

    // ------------------------------------------------------------------
    // 1. main-frame deny：JS shouldStart=false → SHOULD_OVERRIDE → 阻止加载
    // ------------------------------------------------------------------
    @Test
    public void mainFrameDeny_returnsTrue() {
        respondAsync(30, false);
        assertTrue(client.shouldOverrideUrlLoading(webView, DENIED_URL));
    }

    // ------------------------------------------------------------------
    // 2. main-frame allow：JS shouldStart=true → DO_NOT_OVERRIDE → 放行
    // ------------------------------------------------------------------
    @Test
    public void mainFrameAllow_returnsFalse() {
        respondAsync(30, true);
        assertFalse(client.shouldOverrideUrlLoading(webView, "https://book.example/page.xhtml"));
    }

    // ------------------------------------------------------------------
    // 3. bridge timeout：JS 永不响应，超过 250ms deadline
    //    failClosed=true → 拒绝；failClosed=false → 放行（上游兼容对照）
    // ------------------------------------------------------------------
    @Test
    public void bridgeTimeout_failClosed_denies() {
        onDispatch(event -> {
            /* JS 永不响应 */
        });
        long start = System.nanoTime();
        assertTrue(client.shouldOverrideUrlLoading(webView, DENIED_URL));
        long elapsedMs = (System.nanoTime() - start) / 1_000_000;
        assertTrue(
                "timeout 应在 ~250ms deadline 判定, actual=" + elapsedMs + "ms",
                elapsedMs >= 200 && elapsedMs < 10_000);
    }

    @Test
    public void bridgeTimeout_failOpen_allows() {
        setFailClosed(false);
        onDispatch(event -> {
            /* JS 永不响应 */
        });
        assertFalse(client.shouldOverrideUrlLoading(webView, DENIED_URL));
    }

    // ------------------------------------------------------------------
    // 4. dispatch exception：dispatchDirectShouldStartLoadWithRequest 抛 RuntimeException
    //    failClosed=true → 拒绝；failClosed=false → 异常重抛
    // ------------------------------------------------------------------
    @Test
    public void dispatchException_failClosed_denies() {
        doThrow(new RuntimeException("dispatch boom"))
                .when(webView)
                .dispatchDirectShouldStartLoadWithRequest(any(WritableMap.class));
        assertTrue(client.shouldOverrideUrlLoading(webView, DENIED_URL));
    }

    @Test
    public void dispatchException_failOpen_rethrows() {
        setFailClosed(false);
        doThrow(new RuntimeException("dispatch boom"))
                .when(webView)
                .dispatchDirectShouldStartLoadWithRequest(any(WritableMap.class));
        RuntimeException thrown =
                assertThrows(
                        RuntimeException.class,
                        () -> client.shouldOverrideUrlLoading(webView, DENIED_URL));
        assertEquals("dispatch boom", thrown.getMessage());
    }

    // ------------------------------------------------------------------
    // 5. Interrupted：等待 JS 响应期间调用线程被中断
    //    → 返回 failClosed（true=拒绝），且 interrupt 标志被恢复
    // ------------------------------------------------------------------
    @Test
    public void interruptedWhileWaiting_returnsFailClosedAndRestoresFlag() throws Exception {
        final Thread[] callerRef = new Thread[1];
        final AtomicReference<Boolean> result = new AtomicReference<>();
        final AtomicReference<Boolean> interruptFlag = new AtomicReference<>();
        final AtomicReference<Throwable> failure = new AtomicReference<>();

        onDispatch(
                event -> {
                    Thread interrupter =
                            new Thread(
                                    () -> {
                                        try {
                                            Thread.sleep(50);
                                        } catch (InterruptedException ignored) {
                                            Thread.currentThread().interrupt();
                                        }
                                        callerRef[0].interrupt();
                                    },
                                    "gate-interrupter");
                    interrupter.setDaemon(true);
                    interrupter.start();
                });

        Thread caller =
                new Thread(
                        () -> {
                            callerRef[0] = Thread.currentThread();
                            try {
                                result.set(client.shouldOverrideUrlLoading(webView, DENIED_URL));
                                interruptFlag.set(Thread.currentThread().isInterrupted());
                            } catch (Throwable t) {
                                failure.set(t);
                            }
                        },
                        "gate-caller");
        caller.start();
        caller.join(10_000);

        assertNull("seam 调用线程抛出了未预期异常: " + failure.get(), failure.get());
        assertTrue("failClosed 时等待被中断应拒绝导航", result.get());
        assertTrue("interrupt 标志应被 seam 恢复", interruptFlag.get());
    }

    // ------------------------------------------------------------------
    // 6. JS/Catalyst unavailable（三种子情形，均 failClosed=true → 拒绝，
    //    且不得触达 dispatch）
    // ------------------------------------------------------------------
    @Test
    public void catalystInstanceInactive_failClosed_denies() {
        when(reactContext.hasActiveCatalystInstance()).thenReturn(false);
        assertTrue(client.shouldOverrideUrlLoading(webView, DENIED_URL));
        verify(webView, never()).dispatchDirectShouldStartLoadWithRequest(any());
    }

    @Test
    public void jsContextHolderGone_failClosed_denies() {
        when(jsContextHolder.get()).thenReturn(0L);
        assertTrue(client.shouldOverrideUrlLoading(webView, DENIED_URL));
        verify(webView, never()).dispatchDirectShouldStartLoadWithRequest(any());
    }

    @Test
    public void messagingModuleMissing_failClosed_denies() {
        webView.mMessagingJSModule = null;
        assertTrue(client.shouldOverrideUrlLoading(webView, DENIED_URL));
        verify(webView, never()).dispatchDirectShouldStartLoadWithRequest(any());
    }

    // ------------------------------------------------------------------
    // 7. React 实例检查本身抛 RuntimeException
    //    failClosed=true → 拒绝；failClosed=false → 异常重抛
    // ------------------------------------------------------------------
    @Test
    public void reactInstanceInspectionThrows_failClosed_denies() {
        when(reactContext.hasActiveCatalystInstance())
                .thenThrow(new RuntimeException("inspect boom"));
        assertTrue(client.shouldOverrideUrlLoading(webView, DENIED_URL));
        verify(webView, never()).dispatchDirectShouldStartLoadWithRequest(any());
    }

    @Test
    public void reactInstanceInspectionThrows_failOpen_rethrows() {
        setFailClosed(false);
        when(reactContext.hasActiveCatalystInstance())
                .thenThrow(new RuntimeException("inspect boom"));
        RuntimeException thrown =
                assertThrows(
                        RuntimeException.class,
                        () -> client.shouldOverrideUrlLoading(webView, DENIED_URL));
        assertEquals("inspect boom", thrown.getMessage());
    }

    // ------------------------------------------------------------------
    // 8. late callback 无害化：超时判定完成后迟到的回调
    //    → 不抛异常、不改变已返回结果、不串扰后续导航判定
    // ------------------------------------------------------------------
    @Test
    public void lateCallbackAfterCompletion_isHarmless() {
        final AtomicReference<Double> lockIdentifier = new AtomicReference<>();
        onDispatch(event -> lockIdentifier.set(event.getDouble("lockIdentifier")));

        assertTrue(
                "首次判定应因超时 fail-closed",
                client.shouldOverrideUrlLoading(webView, DENIED_URL));
        assertNull(
                "锁必须在 finally 中移除（HNSecureWebViewClient.java:150）",
                HNSecureWebViewModuleImpl.shouldOverrideUrlLoadingLock.getLock(
                        lockIdentifier.get()));

        // 迟到回调走真实入口：lock 已移除，getLock 返回 null，回调被静默忽略
        respondViaRealCallback(lockIdentifier.get(), false);

        // 后续导航判定不受串扰：正常 deny 仍正确返回
        respondAsync(30, false);
        assertTrue(client.shouldOverrideUrlLoading(webView, "https://attacker.example/again"));
    }

    // ------------------------------------------------------------------
    // 9. subframe 策略：只放行精确 about URL，或 canonical root 的严格子文件。
    // ------------------------------------------------------------------
    @Test
    public void subframeNavigation_networkDeniedWithoutJsGate() {
        WebResourceRequest request = subframeRequest(DENIED_URL);

        // 入口 1：shouldOverrideUrlLoading 的 subframe 分支（HNSecureWebViewClient.java:255）
        // 必须对未授权网络子帧 fail-closed（返回 true = 阻止导航）。
        assertTrue(
                "shouldOverrideUrlLoading 必须对未授权网络子帧 fail-closed",
                client.shouldOverrideUrlLoading(webView, request));
        // 该入口独立读取一次 fail-closed 标志。
        verify(webView, times(1)).getFailClosedOnShouldStartLoadWithRequest();

        // 入口 2：shouldInterceptRequest（HNSecureWebViewClient.java:268）必须同样
        // fail-closed，返回非 null 的阻断响应而非放行资源。
        assertNotNull(
                "shouldInterceptRequest 必须对未授权网络子帧 fail-closed",
                client.shouldInterceptRequest(webView, request));
        // 两个公开入口各自独立读取一次标志，合计恰好 2 次：这是“每个入口读一次”的直接
        // 结果，不是安全契约（跨入口缓存该标志反而会引入陈旧值风险）。真正的安全契约是
        // 上方两个入口的 deny 结果，以及下方“绝不触达 JS gate”的断言。
        verify(webView, times(2)).getFailClosedOnShouldStartLoadWithRequest();

        // 无 JS gate 条件下拒绝：既不检查 Catalyst 实例，也不派发 shouldStartLoad 事件，
        // 因此不存在绕过 fail-closed 的旁路。
        verify(reactContext, never()).hasActiveCatalystInstance();
        verify(webView, never()).dispatchDirectShouldStartLoadWithRequest(any());
    }

    @Test
    public void subframeExactAboutUrlsAllowedWithoutJsGate() {
        assertSubframeAllowed("about:blank");
        assertSubframeAllowed("about:srcdoc");
        verify(webView, never()).dispatchDirectShouldStartLoadWithRequest(any());
    }

    @Test
    public void subframeCanonicalChildFileAllowed() {
        when(webView.getAllowingReadAccessToURL()).thenReturn("file:///tmp/hn-secure-root");
        assertEquals("", Uri.parse("file:///tmp/hn-secure-root/chapter/content.xhtml").getAuthority());
        assertSubframeAllowed("file:///tmp/hn-secure-root/chapter/content.xhtml");
        assertSubframeBlocked("file:///tmp/hn-secure-root");
    }

    @Test
    public void subframeSiblingPrefixBlocked() {
        when(webView.getAllowingReadAccessToURL()).thenReturn("file:///tmp/hn-secure-root");
        assertSubframeBlocked("file:///tmp/hn-secure-root-evil/chapter.xhtml");
    }

    @Test
    public void subframeTraversalAndEncodingVariantsBlocked() {
        when(webView.getAllowingReadAccessToURL()).thenReturn("file:///tmp/hn-secure-root");
        assertSubframeBlocked("file:///tmp/hn-secure-root/../outside.xhtml");
        assertSubframeBlocked("file:///tmp/hn-secure-root/%2e%2e/outside.xhtml");
        assertSubframeBlocked("file:///tmp/hn-secure-root/chapter%2foutside.xhtml");
    }

    @Test
    public void subframeAuthorityNetworkAndNearAboutUrlsBlocked() {
        when(webView.getAllowingReadAccessToURL()).thenReturn("file:///tmp/hn-secure-root");
        assertSubframeBlocked("file://localhost/tmp/hn-secure-root/chapter.xhtml");
        assertSubframeBlocked("https://attacker.example/script.js");
        assertSubframeBlocked("about:blank#fragment");
        assertSubframeBlocked("about:srcdoc?query");
    }

    // ------------------------------------------------------------------
    // 10. Foliate Android asset host: manifest-exact virtual HTTPS origin.
    // ------------------------------------------------------------------
    @Test
    public void foliateAssetManifestAllowlistServesExplicitMimeAndHeaders() throws Exception {
        WebResourceResponse response = assetHost().intercept(
                Uri.parse("https://appassets.androidplatform.net/foliate/reader.html"));
        String readerHtmlCsp = HNSecureWebViewClient.FoliateAssetHost
                .extractInitialHostCspForTesting(readAssetText("reader.html"));

        assertEquals(200, response.getStatusCode());
        assertEquals("text/html", response.getMimeType());
        assertEquals("UTF-8", response.getEncoding());
        assertEquals("nosniff", response.getResponseHeaders().get("X-Content-Type-Options"));
        assertNotNull(readerHtmlCsp);
        assertEquals(readerHtmlCsp, assetHost().getHostCspForTesting());
        assertEquals(readerHtmlCsp, response.getResponseHeaders().get("Content-Security-Policy"));
    }

    @Test
    public void foliateAssetLoaderHasNoBroadAssetsPrefix() {
        WebViewAssetLoader loader = HNSecureWebViewClient.FoliateAssetHost.createLoader(
                RuntimeEnvironment.getApplication());

        assertNotNull(loader.shouldInterceptRequest(
                Uri.parse("https://appassets.androidplatform.net/foliate/reader.html")));
        assertNull(loader.shouldInterceptRequest(
                Uri.parse("https://appassets.androidplatform.net/assets/reader.html")));
        assertNull(loader.shouldInterceptRequest(
                Uri.parse("https://appassets.androidplatform.net/reader.html")));
    }

    @Test
    public void secureHostServesOnlyManifestExactAssetsBeforeBlockingNonMainRequests() {
        when(webView.isSecureNativeReaderHostModeActive()).thenReturn(true);
        when(webView.isNativeFoliateHostSelected()).thenReturn(true);
        WebResourceRequest exactAsset = subframeRequest(
                "https://appassets.androidplatform.net/foliate/bootstrap.js");
        WebResourceRequest unknownAsset = subframeRequest(
                "https://appassets.androidplatform.net/foliate/not-in-manifest.js");

        // A child navigation is always denied, even when it targets a real static host asset.
        assertTrue(client.shouldOverrideUrlLoading(webView, exactAsset));
        // Its resource request still reaches only the manifest-exact AssetLoader, never network.
        WebResourceResponse exactResponse = client.shouldInterceptRequest(webView, exactAsset);
        assertNotNull(exactResponse);
        assertEquals(200, exactResponse.getStatusCode());

        WebResourceResponse unknownResponse = client.shouldInterceptRequest(webView, unknownAsset);
        assertNotNull(unknownResponse);
        assertEquals(404, unknownResponse.getStatusCode());
    }

    @Test
    public void foliateAssetHostRejectsTraversalEncodingUnicodeQueryAndFragment() {
        assertAssetStatus("https://appassets.androidplatform.net/foliate/../reader.html", 404);
        assertAssetStatus("https://appassets.androidplatform.net/foliate/%2e%2e/reader.html", 404);
        assertAssetStatus("https://appassets.androidplatform.net/foliate/foliate%2fview.js", 404);
        assertAssetStatus("https://appassets.androidplatform.net/foliate/%72eader.html", 404);
        assertAssetStatus("https://appassets.androidplatform.net/foliate/r%65ader.html", 404);
        assertAssetStatus(
                "https://appassets.androidplatform.net/foliate/r" + '\u0435' + "ader.html",
                404);
        assertAssetStatus("https://appassets.androidplatform.net/foliate/reader.html?cache=1", 404);
        assertAssetStatus("https://appassets.androidplatform.net/foliate/reader.html#fragment", 404);
    }

    @Test
    public void foliateAssetHostRejectsUnknownAndNonFoliateAssetNamespaces() {
        assertAssetStatus("https://appassets.androidplatform.net/foliate/manifest.json", 404);
        assertAssetStatus("https://appassets.androidplatform.net/foliate/unknown.js", 404);
        assertAssetStatus("https://appassets.androidplatform.net/assets/reader.html", 404);
        assertAssetStatus("https://appassets.androidplatform.net/reader.html", 404);
    }

    @Test
    public void foliateAssetClientReturns404InsteadOfFallingThroughToHttps() {
        WebResourceResponse unknown = client.shouldInterceptRequest(
                webView,
                subframeRequest("https://appassets.androidplatform.net/foliate/unknown.js"));
        WebResourceResponse malformed = client.shouldInterceptRequest(
                webView,
                subframeRequest("https://appassets.androidplatform.net/foliate/reader.html?cache=1"));

        assertNotNull(unknown);
        assertNotNull(malformed);
        assertEquals(404, unknown.getStatusCode());
        assertEquals(404, malformed.getStatusCode());
    }

    @Test
    public void foliateAssetNamespaceIsReservedAndUnavailableBeforeSelector() {
        WebResourceResponse exact = client.shouldInterceptRequest(
                webView,
                subframeRequest("https://appassets.androidplatform.net/foliate/reader.html"));
        WebResourceResponse unknown = client.shouldInterceptRequest(
                webView,
                subframeRequest("https://appassets.androidplatform.net/foliate/not-in-manifest.js"));

        assertNotNull(exact);
        assertNotNull(unknown);
        assertEquals(404, exact.getStatusCode());
        assertEquals(404, unknown.getStatusCode());
    }

    @Test
    public void selectedFoliateHostAllowsOnlyOneNativeOwnedMainFrameRequest() {
        when(webView.isNativeFoliateHostSelected()).thenReturn(true);
        when(webView.isNativeFoliateMainFrameRequestPermitted(
                Uri.parse(HNSecureWebView.NATIVE_READER_HOST_URL))).thenReturn(true);

        WebResourceResponse permitted = client.shouldInterceptRequest(
                webView, mainFrameRequest(HNSecureWebView.NATIVE_READER_HOST_URL));
        WebResourceResponse bypass = client.shouldInterceptRequest(
                webView, mainFrameRequest("https://attacker.example/reader.html"));

        assertNotNull("reader asset must be served only for selector-owned request", permitted);
        assertEquals(200, permitted.getStatusCode());
        assertNotNull("generic main-frame bypass must be an explicit failure", bypass);
        assertEquals(404, bypass.getStatusCode());
    }

    @Test
    public void foliateAssetHostRejectsFileContentAndNetworkOrigins() {
        assertAssetStatus("file:///android_asset/reader.html", 404);
        assertAssetStatus("content://com.example.reader/reader.html", 404);
        assertAssetStatus("https://reader.example/foliate/reader.html", 404);
        assertAssetStatus("https://appassets.androidplatform.net:443/foliate/reader.html", 404);
        assertAssetStatus("https://appassets.androidplatform.net@attacker.example/foliate/reader.html", 404);
    }

    @Test
    public void foliateAssetManifestRejectsMissingOrAmbiguousMimeDeclarations() {
        String validHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        String invalidMimeManifest = "{\"schemaVersion\":1,\"assets\":[{\"path\":\"reader.html\","
                + "\"sha256\":\"" + validHash + "\",\"size\":1,\"mimeType\":\"text/html; charset=UTF-8\"}]}";
        String missingMimeManifest = "{\"schemaVersion\":1,\"assets\":[{\"path\":\"reader.html\","
                + "\"sha256\":\"" + validHash + "\",\"size\":1}]}";

        assertThrows(
                JSONException.class,
                () -> HNSecureWebViewClient.FoliateAssetHost.parseManifestForTesting(invalidMimeManifest));
        assertThrows(
                JSONException.class,
                () -> HNSecureWebViewClient.FoliateAssetHost.parseManifestForTesting(missingMimeManifest));
    }

    @Test
    public void foliateAssetHostCspExtractionRequiresInitialPolicyMeta() {
        String expected = "default-src 'none'; script-src 'self'";
        assertEquals(
                expected,
                HNSecureWebViewClient.FoliateAssetHost.extractInitialHostCspForTesting(
                        "<!doctype html><head><meta http-equiv=\"Content-Security-Policy\" content=\""
                                + expected + "\"></head>"));
        assertNull(HNSecureWebViewClient.FoliateAssetHost.extractInitialHostCspForTesting(
                "<!doctype html><head><meta content=\"default-src 'none'\"></head>"));
        assertNull(HNSecureWebViewClient.FoliateAssetHost.extractInitialHostCspForTesting(
                "<!doctype html><head><meta http-equiv=\"Content-Security-Policy\"></head>"));
    }

    // ------------------------------------------------------------------
    // 11. 4A.3 pre-source CSP capability gate. These tests execute the
    // production lock/state seam directly; device WebView CSP enforcement is
    // intentionally a separate runtime concern.
    // ------------------------------------------------------------------
    private HNSecureWebView.NativePlatformCapabilityGate.ProbeStart beginCspProbe(
            HNSecureWebView.NativePlatformCapabilityGate gate) {
        gate.markListenerReady();
        gate.onNavigation(HNSecureWebView.NATIVE_READER_HOST_URL, true);
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart probe =
                gate.beginProbe(HNSecureWebView.NATIVE_READER_HOST_URL, 100L);
        assertNotNull(probe);
        assertEquals("CANDIDATE", gate.getStateName(100L));
        assertFalse(gate.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 100L));
        return probe;
    }

    private void completeCspProbe(
            HNSecureWebView.NativePlatformCapabilityGate gate,
            HNSecureWebView.NativePlatformCapabilityGate.ProbeStart probe) {
        gate.onProbeEvaluateCompleted(
                probe.generation, probe.token, HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        // Control proves that both manifest-exact external assets execute/decode.
        gate.onControlObservation(
                probe.generation, probe.token, true, true, HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        // Strict proves its document survives while both same-origin external assets are blocked.
        gate.onStrictDocumentObservation(
                probe.generation, probe.token, true,
                HNSecureWebView.NATIVE_READER_HOST_URL, 102L);
        gate.onStrictPngError(
                probe.generation, probe.token, true, HNSecureWebView.NATIVE_READER_HOST_URL, 102L);
        assertFalse("No READY window before the observer quiet callback and drain", gate.isReady(
                HNSecureWebView.NATIVE_READER_HOST_URL, 102L));
        gate.onStrictQuietTimeout(
                probe.generation, probe.token, true, false,
                HNSecureWebView.NATIVE_READER_HOST_URL, 103L);
        assertFalse("No READY window before the page confirms observer/frame/blob drain", gate.isReady(
                HNSecureWebView.NATIVE_READER_HOST_URL, 103L));
        gate.onProbeDrained(
                probe.generation,
                probe.token,
                true,
                true,
                true,
                true,
                true,
                true,
                false,
                true,
                HNSecureWebView.NATIVE_READER_HOST_URL,
                104L);
    }

    @Test
    public void nativeManifestDeclaresExactCspProbeAssetsAndIframeOrder() throws Exception {
        String manifest = readAssetText("manifest.json");
        String probeScript = HNSecureWebView.buildCspProbeScriptForTesting(9L, "test-token");

        assertTrue(manifest.contains("\"path\": \"probes/csp-1x1.png\""));
        assertTrue(manifest.contains("\"mimeType\": \"image/png\""));
        assertTrue(manifest.contains("\"path\": \"probes/csp-external-canary.js\""));
        assertTrue(manifest.contains("\"mimeType\": \"text/javascript; charset=utf-8\""));
        assertTrue(probeScript.contains(quotedProbeUrl(HNSecureWebView.CSP_PROBE_IMAGE_URL)));
        assertTrue(probeScript.contains(quotedProbeUrl(HNSecureWebView.CSP_PROBE_SCRIPT_URL)));
        assertFalse(probeScript.contains("srcdoc"));
        assertFalse(probeScript.contains("PerformanceResourceTiming"));
        assertFalse(probeScript.contains("onload="));
        assertFalse(probeScript.contains("onerror="));
        assertTrue(probeScript.contains("const probeUrl=URL.createObjectURL"));
        assertEquals("the blob URL is pre-created exactly once", 1,
                probeScript.split("URL.createObjectURL", -1).length - 1);
        assertTrue(probeScript.contains("frame.src=probeUrl"));
        assertTrue(probeScript.contains("strictObserver.disconnect"));
        assertTrue(probeScript.contains("URL.revokeObjectURL(probeUrl)"));
        assertTrue(probeScript.contains("send('probe-drained'"));

        int strictCsp = probeScript.indexOf("frame.setAttribute('csp',strictCsp)");
        int sandbox = probeScript.indexOf("frame.setAttribute('sandbox','allow-same-origin allow-scripts')");
        int source = probeScript.indexOf("frame.src=probeUrl");
        int append = probeScript.indexOf("appendChild(frame)");
        assertTrue(strictCsp >= 0 && strictCsp < sandbox && sandbox < source && source < append);
    }

    @Test
    public void nativeCapabilityGateControlSuccessAndStrictBlockBecomeReadyOnlyAfterDrain() {
        HNSecureWebView.NativePlatformCapabilityGate gate =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart probe = beginCspProbe(gate);

        completeCspProbe(gate, probe);

        assertEquals("READY", gate.getStateName(104L));
        assertTrue(gate.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 104L));
        assertTrue(gate.shouldDispatchTrustedMessage(HNSecureWebView.NATIVE_READER_HOST_URL, 104L));
    }

    @Test
    public void nativeCapabilityGateStrictUnintendedExternalAssetExecutionInvalidates() {
        HNSecureWebView.NativePlatformCapabilityGate gate =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart probe = beginCspProbe(gate);

        gate.onStrictPngLoaded(
                probe.generation, probe.token, HNSecureWebView.NATIVE_READER_HOST_URL, 101L);

        assertEquals("UNSUPPORTED", gate.getStateName(101L));
        assertFalse(gate.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 101L));
    }

    @Test
    public void nativeCapabilityGateLateStrictCanaryBeforeDrainNeverExposesReady() {
        HNSecureWebView.NativePlatformCapabilityGate gate =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart probe = beginCspProbe(gate);

        gate.onProbeEvaluateCompleted(
                probe.generation, probe.token, HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        gate.onControlObservation(
                probe.generation, probe.token, true, true, HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        gate.onStrictDocumentObservation(
                probe.generation, probe.token, true, HNSecureWebView.NATIVE_READER_HOST_URL, 102L);
        gate.onStrictPngError(
                probe.generation, probe.token, true, HNSecureWebView.NATIVE_READER_HOST_URL, 102L);
        gate.onStrictQuietTimeout(
                probe.generation, probe.token, true, false, HNSecureWebView.NATIVE_READER_HOST_URL, 103L);
        assertFalse(gate.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 103L));

        gate.onStrictCanary(probe.generation, probe.token, HNSecureWebView.NATIVE_READER_HOST_URL, 104L);

        assertEquals("UNSUPPORTED", gate.getStateName(104L));
        assertFalse(gate.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 104L));
        assertFalse(gate.shouldDispatchTrustedMessage(HNSecureWebView.NATIVE_READER_HOST_URL, 104L));
    }

    @Test
    public void nativeCapabilityGatePostDrainOldGenerationEventsCannotRevokeReady() {
        HNSecureWebView.NativePlatformCapabilityGate gate =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart probe = beginCspProbe(gate);
        completeCspProbe(gate, probe);
        assertTrue(gate.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 104L));

        // probe-drained disconnected the observer, removed both frames, and revoked the blob URL.
        // Any queued old-generation event is deliberately inert, not a post-READY revocation path.
        gate.onStrictCanary(probe.generation, probe.token, HNSecureWebView.NATIVE_READER_HOST_URL, 105L);
        gate.onProbeTimeout(probe.generation, probe.token, HNSecureWebView.NATIVE_READER_HOST_URL, 105L);
        gate.onStrictPngLoaded(probe.generation, probe.token, HNSecureWebView.NATIVE_READER_HOST_URL, 105L);
        gate.onStrictJavaScriptError(probe.generation, probe.token, true,
                HNSecureWebView.NATIVE_READER_HOST_URL, 105L);

        assertEquals("READY", gate.getStateName(105L));
        assertTrue(gate.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 105L));
    }

    @Test
    public void nativeCapabilityGateRepeatedListenerRegistrationCannotDowngradeCandidateOrReady() {
        HNSecureWebView.NativePlatformCapabilityGate gate =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart probe = beginCspProbe(gate);

        gate.markListenerReady();
        assertEquals("CANDIDATE", gate.getStateName(101L));
        completeCspProbe(gate, probe);
        gate.markListenerReady();

        assertEquals("READY", gate.getStateName(104L));
        assertTrue(gate.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 104L));
    }

    @Test
    public void nativeCapabilityGateControlJsFailureImageFailureBootstrapFailureAndTimeoutAreFailClosed() {
        HNSecureWebView.NativePlatformCapabilityGate controlJsFailure =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart jsFailedProbe = beginCspProbe(controlJsFailure);
        controlJsFailure.onControlObservation(
                jsFailedProbe.generation, jsFailedProbe.token, false, true,
                HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        assertEquals("UNSUPPORTED", controlJsFailure.getStateName(101L));

        HNSecureWebView.NativePlatformCapabilityGate controlImageFailure =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart imageFailedProbe = beginCspProbe(controlImageFailure);
        controlImageFailure.onControlObservation(
                imageFailedProbe.generation, imageFailedProbe.token, true, false,
                HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        assertEquals("UNSUPPORTED", controlImageFailure.getStateName(101L));

        HNSecureWebView.NativePlatformCapabilityGate bootstrapFailure =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart bootstrapFailedProbe = beginCspProbe(bootstrapFailure);
        bootstrapFailure.onProbeEvaluateFailed(
                bootstrapFailedProbe.generation, bootstrapFailedProbe.token,
                HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        assertEquals("UNSUPPORTED", bootstrapFailure.getStateName(101L));

        HNSecureWebView.NativePlatformCapabilityGate timeout =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart timeoutProbe = beginCspProbe(timeout);
        timeout.onProbeTimeout(
                timeoutProbe.generation, timeoutProbe.token, HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        assertEquals("UNSUPPORTED", timeout.getStateName(101L));
    }

    @Test
    public void nativeCapabilityGateDrainAndVerdictPermutationsNeverReadyUntilEveryInputIsTerminal() {
        HNSecureWebView.NativePlatformCapabilityGate gate =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart probe = beginCspProbe(gate);

        // The drain acknowledgement may overtake earlier bridge messages; it is still not READY
        // until evaluate completion, observer quiet, control, strict document, and PNG error land.
        gate.onProbeDrained(probe.generation, probe.token, true, true, true, true, true, true, false, true,
                HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        gate.onStrictPngError(probe.generation, probe.token, true,
                HNSecureWebView.NATIVE_READER_HOST_URL, 102L);
        gate.onControlObservation(probe.generation, probe.token, true, true,
                HNSecureWebView.NATIVE_READER_HOST_URL, 103L);
        gate.onStrictDocumentObservation(probe.generation, probe.token, true,
                HNSecureWebView.NATIVE_READER_HOST_URL, 104L);
        assertFalse(gate.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 104L));
        gate.onStrictQuietTimeout(probe.generation, probe.token, true, false,
                HNSecureWebView.NATIVE_READER_HOST_URL, 105L);
        assertFalse(gate.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 105L));
        gate.onProbeEvaluateCompleted(probe.generation, probe.token,
                HNSecureWebView.NATIVE_READER_HOST_URL, 106L);
        assertTrue(gate.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 106L));
    }

    @Test
    public void nativeCapabilityGateStrictJsErrorPngLoadAndBadDrainNeverExposeReady() {
        HNSecureWebView.NativePlatformCapabilityGate jsError =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart jsErrorProbe = beginCspProbe(jsError);
        jsError.onStrictJavaScriptError(jsErrorProbe.generation, jsErrorProbe.token, true,
                HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        assertEquals("UNSUPPORTED", jsError.getStateName(101L));

        HNSecureWebView.NativePlatformCapabilityGate pngLoaded =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart pngLoadedProbe = beginCspProbe(pngLoaded);
        pngLoaded.onStrictPngLoaded(pngLoadedProbe.generation, pngLoadedProbe.token,
                HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        assertEquals("UNSUPPORTED", pngLoaded.getStateName(101L));

        HNSecureWebView.NativePlatformCapabilityGate badDrain =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart badDrainProbe = beginCspProbe(badDrain);
        badDrain.onProbeDrained(badDrainProbe.generation, badDrainProbe.token,
                true, true, true, true, false, true, false, true,
                HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        assertEquals("UNSUPPORTED", badDrain.getStateName(101L));
    }

    @Test
    public void nativeCapabilityGateQueuedTimeoutOrStrictFailuresAfterDrainNeverExposeReady() {
        HNSecureWebView.NativePlatformCapabilityGate timeout =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart timeoutProbe = beginCspProbe(timeout);
        timeout.onProbeDrained(timeoutProbe.generation, timeoutProbe.token,
                true, true, true, true, true, true, false, true,
                HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        timeout.onProbeTimeout(timeoutProbe.generation, timeoutProbe.token,
                HNSecureWebView.NATIVE_READER_HOST_URL, 102L);
        assertEquals("UNSUPPORTED", timeout.getStateName(102L));

        HNSecureWebView.NativePlatformCapabilityGate strictFailure =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart strictProbe = beginCspProbe(strictFailure);
        strictFailure.onProbeDrained(strictProbe.generation, strictProbe.token,
                true, true, true, true, true, true, false, true,
                HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        strictFailure.onStrictPngLoaded(strictProbe.generation, strictProbe.token,
                HNSecureWebView.NATIVE_READER_HOST_URL, 102L);
        assertEquals("UNSUPPORTED", strictFailure.getStateName(102L));
    }

    @Test
    public void nativeCapabilityGateLateEvaluateFailureAndNavigationDuringDrainNeverExposeReady() {
        HNSecureWebView.NativePlatformCapabilityGate evaluateFailure =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart failureProbe = beginCspProbe(evaluateFailure);
        evaluateFailure.onProbeDrained(failureProbe.generation, failureProbe.token,
                true, true, true, true, true, true, false, true,
                HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        evaluateFailure.onProbeEvaluateFailed(failureProbe.generation, failureProbe.token,
                HNSecureWebView.NATIVE_READER_HOST_URL, 102L);
        assertEquals("UNSUPPORTED", evaluateFailure.getStateName(102L));

        HNSecureWebView.NativePlatformCapabilityGate navigation =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart navigationProbe = beginCspProbe(navigation);
        navigation.onNavigation("about:blank", true);
        navigation.onProbeDrained(navigationProbe.generation, navigationProbe.token,
                true, true, true, true, true, true, false, true,
                HNSecureWebView.NATIVE_READER_HOST_URL, 102L);
        assertEquals("UNSUPPORTED", navigation.getStateName(102L));
        assertFalse(navigation.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 102L));
    }

    @Test
    public void nativeCapabilityGateWrongOriginMainFrameAndCurrentUrlCannotFeedCandidate() {
        HNSecureWebView.NativePlatformCapabilityGate gate =
                new HNSecureWebView.NativePlatformCapabilityGate();
        beginCspProbe(gate);

        assertTrue(gate.isTrustedBridgeContext(
                true,
                Uri.parse(HNSecureWebView.NATIVE_ASSET_ORIGIN),
                HNSecureWebView.NATIVE_READER_HOST_URL,
                101L));
        assertFalse(gate.isTrustedBridgeContext(
                false,
                Uri.parse(HNSecureWebView.NATIVE_ASSET_ORIGIN),
                HNSecureWebView.NATIVE_READER_HOST_URL,
                101L));
        assertFalse(gate.isTrustedBridgeContext(
                true,
                Uri.parse("https://appassets.androidplatform.net:443"),
                HNSecureWebView.NATIVE_READER_HOST_URL,
                101L));
        assertFalse(gate.isTrustedBridgeContext(
                true,
                Uri.parse(HNSecureWebView.NATIVE_ASSET_ORIGIN),
                "blob:https://appassets.androidplatform.net/example",
                101L));
        assertFalse(gate.isReady("https://attacker.example/reader.html", 101L));
        assertFalse(gate.shouldDispatchTrustedMessage("about:blank", 101L));
    }

    @Test
    public void nativeCapabilityGateNavigationTeardownAndLegacyUnsupportedNeverExposeReady() {
        HNSecureWebView.NativePlatformCapabilityGate gate =
                new HNSecureWebView.NativePlatformCapabilityGate();
        HNSecureWebView.NativePlatformCapabilityGate.ProbeStart probe = beginCspProbe(gate);

        gate.onNavigation("about:blank", true);
        // Old iframe callbacks cannot match the navigation generation after teardown.
        gate.onControlObservation(
                probe.generation, probe.token, true, true, HNSecureWebView.NATIVE_READER_HOST_URL, 101L);
        assertEquals("UNSUPPORTED", gate.getStateName(101L));
        assertFalse(gate.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 101L));

        HNSecureWebView.NativePlatformCapabilityGate legacy =
                new HNSecureWebView.NativePlatformCapabilityGate();
        legacy.markUnsupported();
        legacy.markListenerReady();
        assertEquals("UNSUPPORTED", legacy.getStateName(101L));
        assertFalse(legacy.isReady(HNSecureWebView.NATIVE_READER_HOST_URL, 101L));
    }

    @Test
    public void nativeCapabilityFailureAndPrivateBridgeUnsupportedAreStickyForTheWebViewSession() {
        HNSecureWebView.NativePlatformCapabilityGate capabilityGate =
                new HNSecureWebView.NativePlatformCapabilityGate();
        capabilityGate.onNavigation(HNSecureWebView.NATIVE_READER_HOST_URL, false);
        assertTrue(capabilityGate.hasFailedCapabilityAttempt());
        capabilityGate.onNavigation(HNSecureWebView.NATIVE_READER_HOST_URL, true);
        capabilityGate.markListenerReady();
        assertEquals("UNSUPPORTED", capabilityGate.getStateName(101L));

        HNSecureWebView.NativeFoliateHostBridge bridge =
                new HNSecureWebView.NativeFoliateHostBridge();
        bridge.markUnsupported();
        bridge.onNavigation(HNSecureWebView.NATIVE_READER_HOST_URL);
        assertTrue(bridge.isFinalHostMode());
        assertFalse(bridge.beginReload());
        assertEquals("UNSUPPORTED", bridge.getStateName());
    }

    // ------------------------------------------------------------------
    // 12. 4B final private port: these call the production protocol state
    // seam directly. They do not claim an installed WebView port proof.
    // ------------------------------------------------------------------
    private HNSecureWebView.NativeFoliateHostBridge beginPrivateBridge() {
        HNSecureWebView.NativeFoliateHostBridge bridge =
                new HNSecureWebView.NativeFoliateHostBridge();
        assertTrue(bridge.beginReload());
        bridge.onNavigation(HNSecureWebView.NATIVE_READER_HOST_URL);
        assertNotNull(bridge.createInstallToken());
        assertEquals("PORT_INSTALLING", bridge.getStateName());
        bridge.onPrivatePortInstalled();
        assertEquals("AWAITING_BIND", bridge.getStateName());
        return bridge;
    }

    @Test
    public void foliateSelectorIsPerViewAndCannotBeEnteredByOrdinaryReaderUrl() {
        HNSecureWebView.NativeFoliateHostBridge firstView =
                new HNSecureWebView.NativeFoliateHostBridge();
        HNSecureWebView.NativeFoliateHostBridge secondView =
                new HNSecureWebView.NativeFoliateHostBridge();

        // The first view observes the exact reader URL through an ordinary source/loadUrl path.
        // It is permanently ineligible for later selector escalation and does not affect view two.
        firstView.noteGenericPageLoad(HNSecureWebView.NATIVE_READER_HOST_URL);
        assertFalse(firstView.selectFoliateHost());
        assertFalse(firstView.isFoliateHostSelected());
        assertFalse(firstView.isGenericPageCommandLocked());

        assertTrue(secondView.selectFoliateHost());
        assertTrue(secondView.isFoliateHostSelected());
        assertTrue(secondView.isGenericPageCommandLocked());
        assertFalse(firstView.isGenericPageCommandLocked());
    }

    @Test
    public void unknownSelectorVerdictIsFinalAndCannotReopenGenericCommands() {
        HNSecureWebView.NativeFoliateHostBridge bridge =
                new HNSecureWebView.NativeFoliateHostBridge();

        // HNSecureWebView owns the exact string comparison; this seam verifies the final state
        // expected after an unknown/mixed selection is rejected.
        bridge.markUnsupported();
        assertEquals("UNSUPPORTED", bridge.getStateName());
        assertTrue(bridge.isGenericPageCommandLocked());
        assertFalse(bridge.selectFoliateHost());
    }

    private static final class SharedCorpus {
        final Map<String, String> wires;
        final JSONArray scenarios;
        final JSONArray identityCases;

        SharedCorpus(Map<String, String> wires, JSONArray scenarios, JSONArray identityCases) {
            this.wires = wires;
            this.scenarios = scenarios;
            this.identityCases = identityCases;
        }
    }

    private SharedCorpus sharedCorpus() throws Exception {
        try (InputStream stream = getClass().getClassLoader()
                .getResourceAsStream("foliate-host-wire-corpus.v1.json")) {
            assertNotNull("shared wire corpus must be packaged for Android fault matrix", stream);
            JSONObject corpus = new JSONObject(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
            Map<String, String> wires = new HashMap<>();
            JSONArray cases = corpus.getJSONArray("cases");
            for (int index = 0; index < cases.length(); index++) {
                JSONObject item = cases.getJSONObject(index);
                wires.put(item.getString("id"), item.getString("wire"));
            }
            JSONArray semanticCases = corpus.getJSONArray("semanticCases");
            for (int index = 0; index < semanticCases.length(); index++) {
                JSONObject item = semanticCases.getJSONObject(index);
                wires.put(item.getString("id"), item.getString("wire"));
            }
            return new SharedCorpus(wires, corpus.getJSONArray("scenarios"), corpus.getJSONArray("identityCases"));
        }
    }

    private Object runCorpusStep(
            HNSecureWebView.NativeFoliateHostBridge bridge, String wire) throws Exception {
        String direction = new JSONObject(wire).getString("direction");
        return "native-to-host".equals(direction)
                ? bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, wire)
                : bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, wire);
    }

    private String corpusDisposition(Object result) {
        if (result == HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED
                || result == HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED
                || result == HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED_TERMINAL) {
            return "accepted";
        }
        if (result == HNSecureWebView.NativeFoliateHostBridge.SendResult.NO_OP
                || result == HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.NO_OP) {
            return "no-op";
        }
        return "terminal";
    }

    @Test
    public void privatePortConsumesSharedCorpusOriginalWiresAndAdapterStartsBind() throws Exception {
        Map<String, String> wires = sharedCorpus().wires;
        HNSecureWebView.NativeFoliateHostBridge bridge = beginPrivateBridge();
        String bind = wires.get("valid-bind");
        String bindAck = wires.get("valid-ack-bind");

        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.NO_OP,
                bridge.send(false, HNSecureWebView.NATIVE_READER_HOST_URL, bind));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.NO_OP,
                bridge.send(true, "blob:https://appassets.androidplatform.net/child", bind));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, bind));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED,
                bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, bindAck));
        assertEquals("BOUND", bridge.getStateName());
    }

    @Test
    public void privatePortCorpusCoversUnorderedInflightDisposeAndStaleRules() throws Exception {
        Map<String, String> wires = sharedCorpus().wires;
        HNSecureWebView.NativeFoliateHostBridge bridge = beginPrivateBridge();
        java.util.function.Function<String, String> wire = wires::get;
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, wire.apply("valid-bind")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED,
                bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, wire.apply("valid-model")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED,
                bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, wire.apply("valid-ack-bind")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, wire.apply("valid-navigate")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED,
                bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, wire.apply("valid-location")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED,
                bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, wire.apply("valid-ack-navigate")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, wire.apply("valid-flow")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED,
                bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, wire.apply("valid-ack-flow")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.NO_OP,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, wire.apply("valid-navigate")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, wire.apply("valid-dispose")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED_TERMINAL,
                bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, wire.apply("valid-ack-dispose")));
        assertEquals("TERMINATED", bridge.getStateName());
    }

    @Test
    public void privatePortBoundsReplayMemoryWithoutEvictingIds() throws Exception {
        Map<String, String> wires = sharedCorpus().wires;
        HNSecureWebView.NativeFoliateHostBridge bridge = beginPrivateBridge();
        String url = HNSecureWebView.NATIVE_READER_HOST_URL;
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED,
                bridge.send(true, url, wires.get("valid-bind")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED,
                bridge.receive(true, url, wires.get("valid-ack-bind")));
        for (int index = 1; index < 4096; index++) {
            String id = "a".repeat(43 - String.valueOf(index).length()) + index;
            String command = new JSONObject(wires.get("valid-flow")).put("commandId", id).toString();
            String ack = new JSONObject(wires.get("valid-ack-flow")).put("commandId", id).toString();
            assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED, bridge.send(true, url, command));
            assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED, bridge.receive(true, url, ack));
        }
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.NO_OP,
                bridge.send(true, url, wires.get("valid-bind")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.TERMINAL,
                bridge.send(true, url, wires.get("valid-flow")));
    }

    @Test
    public void privatePortAcceptsCorpusNonterminalErrorForItsCurrentCommand() throws Exception {
        Map<String, String> wires = sharedCorpus().wires;
        HNSecureWebView.NativeFoliateHostBridge bridge = beginPrivateBridge();
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, wires.get("valid-bind")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED,
                bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, wires.get("valid-ack-bind")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, wires.get("valid-navigate")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED,
                bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, wires.get("valid-error")));
        assertEquals("BOUND", bridge.getStateName());
    }

    @Test
    public void privatePortDisposeReplacesOneOrdinaryInflightAndRetiresItsLateAck() throws Exception {
        Map<String, String> wires = sharedCorpus().wires;
        HNSecureWebView.NativeFoliateHostBridge bridge = beginPrivateBridge();
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, wires.get("valid-bind")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED,
                bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, wires.get("valid-ack-bind")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, wires.get("valid-flow")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, wires.get("valid-dispose")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.NO_OP,
                bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, wires.get("valid-ack-flow")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED_TERMINAL,
                bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, wires.get("valid-ack-dispose")));
    }

    @Test
    public void privatePortCurrentMalformedCorpusWiresTerminateButWrongIdentityIsInert() throws Exception {
        Map<String, String> wires = sharedCorpus().wires;
        for (Map.Entry<String, String> entry : wires.entrySet()) {
            if (!entry.getKey().startsWith("invalid-")) continue;
            HNSecureWebView.NativeFoliateHostBridge bridge = beginPrivateBridge();
            // Route the original corpus bytes to their declared side. Sending a host event
            // through send() is opposite-direction traffic and must be inert, even with a
            // malformed payload. Do not parse/rewrite malformed JSON to select the test route.
            boolean hostEvent = entry.getValue().contains("\"direction\":\"host-to-native\"");
            if (hostEvent) {
                assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED,
                        bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL,
                                wires.get("valid-bind")));
            }
            Object result = hostEvent
                    ? bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, entry.getValue())
                    : bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, entry.getValue());
            assertEquals("current malformed wire must terminate: " + entry.getKey(),
                    "terminal", corpusDisposition(result));
        }
        HNSecureWebView.NativeFoliateHostBridge bridge = beginPrivateBridge();
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.ACCEPTED,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL,
                        wires.get("valid-bind")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.NO_OP,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL,
                        wires.get("wrong-session")));
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.SendResult.NO_OP,
                bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL,
                        wires.get("old-generation")));
    }

    @Test
    public void privatePortInstallerHasNoPublicRnOrParentCapability() {
        String install = HNSecureWebView.buildPrivatePortInstallScriptForTesting("A".repeat(43));

        assertTrue(install.contains("event.data!==token"));
        assertTrue(install.contains("event.ports.length!==1"));
        assertTrue(install.contains("window.removeEventListener('message',receive)"));
        assertTrue(install.contains("installFoliateNativeHostBridge(event.ports[0])"));
        assertFalse(install.contains("ReactNativeWebView"));
        assertFalse(install.contains("window.parent"));
        assertFalse(install.contains("window.HNSecure"));
        assertFalse(install.contains("addJavascriptInterface"));
    }

    @Test
    public void privatePortNavigationInvalidatesOldPortBeforeSourceIoExists() {
        HNSecureWebView.NativeFoliateHostBridge bridge = beginPrivateBridge();
        bridge.onNavigation("https://attacker.example/");

        assertEquals("UNSUPPORTED", bridge.getStateName());
        assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.NO_OP,
                bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL,
                        "{\"protocol\":\"hn-foliate-host\",\"version\":1,\"direction\":\"host-to-native\",\"type\":\"ack\",\"session\":\"A\",\"generation\":0,\"commandId\":0,\"payload\":{\"command\":\"bind\",\"status\":\"bridge-bound\"}}"));
    }

    @Test
    public void privatePortDirectlyConsumesEverySharedCorpusScenario() throws Exception {
        SharedCorpus corpus = sharedCorpus();
        for (int scenarioIndex = 0; scenarioIndex < corpus.scenarios.length(); scenarioIndex++) {
            JSONObject scenario = corpus.scenarios.getJSONObject(scenarioIndex);
            HNSecureWebView.NativeFoliateHostBridge bridge = beginPrivateBridge();
            JSONArray steps = scenario.getJSONArray("steps");
            for (int stepIndex = 0; stepIndex < steps.length(); stepIndex++) {
                JSONObject step = steps.getJSONObject(stepIndex);
                String caseId = step.getString("case");
                String wire = corpus.wires.get(caseId);
                assertNotNull("shared scenario case must exist: " + caseId, wire);
                assertEquals(
                        scenario.getString("id") + " / " + caseId,
                        step.getString("expect"),
                        corpusDisposition(runCorpusStep(bridge, wire)));
            }
        }
    }

    @Test
    public void sharedIdentityCasesPreserveInflightOrTerminateWithoutFallback() throws Exception {
        SharedCorpus corpus = sharedCorpus();
        for (int index = 0; index < corpus.identityCases.length(); index++) {
            JSONObject entry = corpus.identityCases.getJSONObject(index);
            HNSecureWebView.NativeFoliateHostBridge bridge = beginPrivateBridge();
            bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, corpus.wires.get("valid-bind"));
            Object result = "native-to-host".equals(entry.getString("direction"))
                    ? bridge.send(true, HNSecureWebView.NATIVE_READER_HOST_URL, entry.getString("wire"))
                    : bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, entry.getString("wire"));
            assertEquals(entry.getString("id"), entry.getString("expect"), corpusDisposition(result));
            if ("no-op".equals(entry.getString("expect"))) {
                assertEquals(HNSecureWebView.NativeFoliateHostBridge.ReceiveResult.ACCEPTED,
                        bridge.receive(true, HNSecureWebView.NATIVE_READER_HOST_URL, corpus.wires.get("valid-ack-bind")));
            }
        }
    }

    // ------------------------------------------------------------------
    // 13. 4B.6 direct secure-host page capability denials. These exercise the
    // production client/chrome methods and verify no RN decision callback runs.
    // ------------------------------------------------------------------
    @Test
    public void secureHostMainFrameNavigationDoesNotReachReactNativeGate() {
        when(webView.isSecureNativeReaderHostModeActive()).thenReturn(true);
        assertTrue(client.shouldOverrideUrlLoading(webView, DENIED_URL));
        verify(webView, never()).dispatchDirectShouldStartLoadWithRequest(any());
        verify(reactContext, never()).hasActiveCatalystInstance();
    }

    @Test
    public void selectedHostMainFrameNavigationNeverReachesReactNativeGate() {
        when(webView.isNativeFoliateHostSelected()).thenReturn(true);
        assertTrue(client.shouldOverrideUrlLoading(webView, DENIED_URL));
        verify(webView, never()).dispatchDirectShouldStartLoadWithRequest(any());
        verify(reactContext, never()).hasActiveCatalystInstance();
    }

    @Test
    public void secureHostSubframeIsDeniedRegardlessOfOptionalReadAccessProp() {
        when(webView.isSecureNativeReaderHostModeActive()).thenReturn(true);
        when(webView.getAllowingReadAccessToURL()).thenReturn("file:///tmp/hn-secure-root");
        WebResourceRequest request = subframeRequest("file:///tmp/hn-secure-root/chapter.xhtml");

        assertTrue(client.shouldOverrideUrlLoading(webView, request));
        assertNotNull(client.shouldInterceptRequest(webView, request));
        verify(webView, never()).dispatchDirectShouldStartLoadWithRequest(any());
    }

    @Test
    public void secureHostBlocksPopupFileChooserGeolocationAndMediaPermission() {
        HNSecureWebView secureWebView = mock(HNSecureWebView.class);
        when(secureWebView.isSecureNativeReaderHostModeActive()).thenReturn(true);
        HNSecureWebChromeClient chrome = new HNSecureWebChromeClient(secureWebView);
        PermissionRequest permission = mock(PermissionRequest.class);
        GeolocationPermissions.Callback geolocation = mock(GeolocationPermissions.Callback.class);
        @SuppressWarnings("unchecked")
        ValueCallback<Uri[]> chooser = mock(ValueCallback.class);
        WebChromeClient.FileChooserParams chooserParams = mock(WebChromeClient.FileChooserParams.class);

        assertFalse(chrome.onCreateWindow(secureWebView, false, true, Message.obtain()));
        chrome.onPermissionRequest(permission);
        chrome.onGeolocationPermissionsShowPrompt("https://attacker.example", geolocation);
        assertTrue(chrome.onShowFileChooser(secureWebView, chooser, chooserParams));

        verify(permission).deny();
        verify(geolocation).invoke("https://attacker.example", false, false);
        verify(chooser).onReceiveValue(null);
        verify(secureWebView, never()).getReactApplicationContext();
    }

    // ------------------------------------------------------------------
    // 9b. main-frame 经 WebResourceRequest 重载仍走完整 gate（deny 路径）
    // ------------------------------------------------------------------
    @Test
    public void mainFrameDeny_viaWebResourceRequest_returnsTrue() {
        respondAsync(30, false);
        WebResourceRequest request = mock(WebResourceRequest.class);
        Uri uri = mock(Uri.class);
        when(uri.toString()).thenReturn(DENIED_URL);
        when(request.isForMainFrame()).thenReturn(true);
        when(request.getUrl()).thenReturn(uri);

        assertTrue(client.shouldOverrideUrlLoading(webView, request));
    }
}
