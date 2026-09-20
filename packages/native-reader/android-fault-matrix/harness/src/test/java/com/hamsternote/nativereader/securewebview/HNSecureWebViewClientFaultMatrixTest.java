package com.hamsternote.nativereader.securewebview;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
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
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import android.net.Uri;
import android.os.SystemClock;
import android.webkit.WebResourceRequest;

import com.facebook.react.bridge.JavaOnlyMap;
import com.facebook.react.bridge.JavaScriptContextHolder;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableMap;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.mockito.MockedStatic;

import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

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
    // 9. subframe 策略（API 24+ 重载）：非 main-frame 请求直接放行，
    //    JS gate 完全不被触达
    // ------------------------------------------------------------------
    @Test
    public void subframeNavigation_bypassesJsGate() {
        WebResourceRequest request = mock(WebResourceRequest.class);
        when(request.isForMainFrame()).thenReturn(false);

        assertFalse(client.shouldOverrideUrlLoading(webView, request));

        verify(webView, never()).getFailClosedOnShouldStartLoadWithRequest();
        verify(reactContext, never()).hasActiveCatalystInstance();
        verify(webView, never()).dispatchDirectShouldStartLoadWithRequest(any());
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
