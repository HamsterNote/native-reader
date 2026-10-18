package com.hamsternote.nativereader.securewebview;

import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import android.net.Uri;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebMessagePortCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ThemedReactContext;
import java.io.ByteArrayInputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.AbstractExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

/** Real production view policy with platform transport controlled at its public API seam.
 * This does not execute a WebView engine or establish device selection behavior. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class HNPdfViewTest {
    private static final String SESSION = "00000000-0000-0000-0000-000000000001";
    private final byte[] pdf = "%PDF-1.7\nprivate snapshot".getBytes(StandardCharsets.UTF_8);
    private HNPdfView view;
    private ThemedReactContext context;
    private WebViewClient client;
    private MockedStatic<WebViewFeature> features;
    private MockedStatic<WebViewCompat> transport;
    private MockedStatic<HNPdfSource> sources;
    private WebMessagePortCompat local;
    private WebMessagePortCompat transferred;
    private final AtomicReference<ValueCallback<String>> evaluated = new AtomicReference<>();
    private final AtomicReference<String> installer = new AtomicReference<>();
    private final AtomicReference<BooleanSupplier> authorization = new AtomicReference<>();
    private HNPdfDocument snapshot;
    private WebMessagePortCompat.WebMessageCallbackCompat callback;

    private static Object field(Object target, String name) throws Exception {
        Field field = HNPdfView.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
    }

    @Before public void setUp() throws Exception {
        features = mockStatic(WebViewFeature.class);
        features.when(() -> WebViewFeature.isFeatureSupported(anyString())).thenReturn(true);
        transport = mockStatic(WebViewCompat.class);
        sources = mockStatic(HNPdfSource.class);
        context = new ThemedReactContext(mock(ReactApplicationContext.class),
                RuntimeEnvironment.getApplication(), "pdf-test", 1);
        view = spy(new HNPdfView(context));
        assertFalse("Real packaged assets must initialize the view", (Boolean) field(view, "retired"));
        client = view.getWebViewClient();
        doAnswer(invocation -> {
            installer.set(invocation.getArgument(0));
            evaluated.set(invocation.getArgument(1));
            return null;
        }).when(view).evaluateJavascript(anyString(), any());
        // Run only the I/O scheduling seam synchronously so Mockito's thread-local
        // source boundary can observe every authorization decision deterministically.
        Field executor = HNPdfView.class.getDeclaredField("reader");
        executor.setAccessible(true);
        ((java.util.concurrent.ExecutorService) executor.get(view)).shutdownNow();
        executor.set(view, new AbstractExecutorService() {
            boolean stopped;
            public void shutdown() { stopped = true; }
            public List<Runnable> shutdownNow() { stopped = true; return Collections.emptyList(); }
            public boolean isShutdown() { return stopped; }
            public boolean isTerminated() { return stopped; }
            public boolean awaitTermination(long timeout, TimeUnit unit) { return stopped; }
            public void execute(Runnable task) { if (stopped) throw new java.util.concurrent.RejectedExecutionException(); task.run(); }
        });
        snapshot = HNPdfDocument.snapshot(new ByteArrayInputStream(pdf), pdf.length, () -> true);
        sources.when(() -> HNPdfSource.open(eq(context), anyString(), any(), any())).thenAnswer(invocation -> {
            BooleanSupplier grant = invocation.getArgument(3);
            assertTrue("Full I/O requires a bound current host", grant.getAsBoolean());
            authorization.set(grant);
            return snapshot;
        });
        local = mock(WebMessagePortCompat.class);
        transferred = mock(WebMessagePortCompat.class);
        transport.when(() -> WebViewCompat.createWebMessageChannel(view))
                .thenReturn(new WebMessagePortCompat[]{transferred, local});
    }

    @After public void tearDown() {
        if (view != null) view.retire();
        if (snapshot != null) snapshot.revoke();
        sources.close();
        transport.close();
        features.close();
    }

    private String config() throws Exception {
        return new JSONObject().put("sessionId", SESSION).put("generation", 1)
                .put("uri", "file:///private/source.pdf").toString();
    }
    private String wire(String type, long command) throws Exception {
        return new JSONObject().put("protocol", "hamster-pdf").put("version", 1)
                .put("sessionId", SESSION).put("generation", 1).put("commandId", command).put("type", type).toString();
    }
    private void install(boolean completeEvaluation) throws Exception {
        view.configure(config());
        client.onPageFinished(view, HNPdfAssets.HOST);
        ArgumentCaptor<WebMessagePortCompat.WebMessageCallbackCompat> capture =
                ArgumentCaptor.forClass(WebMessagePortCompat.WebMessageCallbackCompat.class);
        verify(local).setWebMessageCallback(capture.capture());
        callback = capture.getValue();
        if (completeEvaluation) evaluated.get().onReceiveValue("true");
    }
    private WebResourceRequest request(String url, boolean mainFrame) {
        WebResourceRequest request = mock(WebResourceRequest.class);
        when(request.getMethod()).thenReturn("GET");
        when(request.getUrl()).thenReturn(Uri.parse(url));
        when(request.isForMainFrame()).thenReturn(mainFrame);
        return request;
    }

    @Test public void realViewDisablesAllFileAccessAndExplicitlyDeniesNetworkUnknownAndDocumentMainFrames() throws Exception {
        WebSettings settings = view.getSettings();
        assertFalse(settings.getAllowFileAccess());
        assertFalse(settings.getAllowFileAccessFromFileURLs());
        assertFalse(settings.getAllowUniversalAccessFromFileURLs());
        assertFalse(settings.getAllowContentAccess());
        assertTrue(settings.getBlockNetworkLoads());
        assertTrue(settings.getBlockNetworkImage());
        assertFalse(settings.getJavaScriptCanOpenWindowsAutomatically());
        assertFalse(settings.supportMultipleWindows());
        for (String name : new String[]{"ReactNativeWebView", "HNSecureWebView", "HNPdf"})
            assertNull(Shadows.shadowOf(view).getJavascriptInterface(name));
        assertEquals(200, client.shouldInterceptRequest(view, request(HNPdfAssets.HOST, true)).getStatusCode());
        for (String url : new String[]{"https://example.com/a.js", "file:///private.pdf",
                HNPdfAssets.ORIGIN + "/pdf-runtime/unknown.js", snapshot.url()})
            assertEquals(url, 404, client.shouldInterceptRequest(view, request(url, false)).getStatusCode());
        assertEquals(404, client.shouldInterceptRequest(view, request(snapshot.url(), true)).getStatusCode());
        sources.verifyNoInteractions();
    }

    @Test public void nativeChannelTargetsOnlyExactOriginAndOnlyCurrentPortBootAuthorizesSourceIo() throws Exception {
        install(true);
        transport.verify(() -> WebViewCompat.postWebMessage(eq(view), any(WebMessageCompat.class),
                eq(Uri.parse(HNPdfAssets.ORIGIN))), times(1));
        assertFalse(installer.get().contains("source.pdf"));
        assertFalse(installer.get().contains("ReactNativeWebView"));
        sources.verifyNoInteractions();
        callback.onMessage(transferred, new WebMessageCompat(wire("boot", 0)));
        callback.onMessage(local, new WebMessageCompat(wire("boot", 0).replace(SESSION, "00000000-0000-0000-0000-000000000002")));
        callback.onMessage(local, new WebMessageCompat(wire("boot", 0).replace("\"generation\":1", "\"generation\":2")));
        sources.verifyNoInteractions();
        callback.onMessage(local, new WebMessageCompat(wire("boot", 0)));
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        sources.verify(() -> HNPdfSource.open(eq(context), anyString(), any(), any()), times(1));
        callback.onMessage(local, new WebMessageCompat(wire("boot", 0)));
        sources.verifyNoMoreInteractions();
        assertEquals(200, client.shouldInterceptRequest(view, request(snapshot.url(), false)).getStatusCode());
        assertEquals(404, client.shouldInterceptRequest(view, request(snapshot.url(), true)).getStatusCode());
    }

    @Test public void failedOrAbandonedInstallerClosesBothUntransferredEndpointsWithoutSourceIo() throws Exception {
        install(false);
        evaluated.get().onReceiveValue("false");
        verify(local).close();
        verify(transferred).close();
        assertTrue((Boolean) field(view, "retired"));
        sources.verifyNoInteractions();
        evaluated.get().onReceiveValue("true");
        verify(local, times(1)).close();
        verify(transferred, times(1)).close();
        transport.verify(() -> WebViewCompat.postWebMessage(any(), any(), any()), never());
    }

    @Test public void disposeBeforeBootClosesChannelAndLateBootCannotReadSource() throws Exception {
        install(false);
        view.command(wire("dispose", 1));
        view.retire();
        verify(local, times(1)).close();
        verify(transferred, times(1)).close();
        evaluated.get().onReceiveValue("true");
        callback.onMessage(local, new WebMessageCompat(wire("boot", 0)));
        sources.verifyNoInteractions();
        assertNull(field(view, "configurationWire"));
    }

    @Test public void navigationRevokesSnapshotAndAuthorizationBeforeAnyLatePortEvent() throws Exception {
        install(true);
        callback.onMessage(local, new WebMessageCompat(wire("boot", 0)));
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        String oldUrl = snapshot.url();
        java.io.InputStream inflight = snapshot.intercept(Uri.parse(oldUrl)).getData();
        client.onPageStarted(view, "https://example.com/", null);
        assertFalse(authorization.get().getAsBoolean());
        assertNull(snapshot.url());
        assertArrayEquals(new byte[pdf.length], inflight.readAllBytes());
        assertEquals(404, client.shouldInterceptRequest(view, request(oldUrl, false)).getStatusCode());
        callback.onMessage(local, new WebMessageCompat(wire("boot", 0)));
        sources.verify(() -> HNPdfSource.open(eq(context), anyString(), any(), any()), times(1));
        verify(local, times(1)).close();
        verify(transferred, never()).close();
    }

    @Test public void clearedConfigurationAndBackgroundBothPermanentlyRetireTheHost() throws Exception {
        install(true);
        view.configure(null);
        view.onHostPause();
        view.onHostDestroy();
        view.configure(config());
        assertTrue((Boolean) field(view, "retired"));
        verify(local, times(1)).close();
        sources.verifyNoInteractions();
    }
}
