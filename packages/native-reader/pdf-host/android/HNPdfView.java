package com.hamsternote.nativereader.securewebview;

import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.CancellationSignal;
import android.util.Base64;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebMessagePortCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.UIManagerHelper;
import com.facebook.react.uimanager.events.Event;
import com.facebook.react.uimanager.events.EventDispatcher;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** Independent main-frame PDF host. No public page bridge or generic URL/source API. */
final class HNPdfView extends WebView implements LifecycleEventListener {
    private final ThemedReactContext context;
    private final ExecutorService reader = Executors.newSingleThreadExecutor();
    private final CancellationSignal cancellation = new CancellationSignal();
    private final Map<Long, JSONObject> pending = new HashMap<>();
    private volatile HNPdfAssets assets;
    private volatile HNPdfDocument document;
    private volatile boolean retired;
    private volatile boolean bound;
    private WebMessagePortCompat port;
    private boolean staticLoaded;
    private String configurationWire;
    private String session;
    private long generation;
    private long lastCommand;
    private int pageCount;
    private boolean opening;
    private final Runnable deadline = () -> fail("render", "PDF_HOST_TIMEOUT", "The PDF renderer stopped making progress.");

    HNPdfView(ThemedReactContext context) {
        super(context);
        this.context = context;
        context.addLifecycleEventListener(this);
        final WebSettings settings = getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setTextZoom(100);
        settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setAllowContentAccess(false);
        settings.setBlockNetworkLoads(true);
        settings.setBlockNetworkImage(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setDomStorageEnabled(false);
        settings.setDatabaseEnabled(false);
        settings.setGeolocationEnabled(false);
        settings.setSaveFormData(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        setDownloadListener((url, userAgent, disposition, mime, length) -> {});
        setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(android.webkit.PermissionRequest request) { request.deny(); }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, android.os.Message message) { return false; }
            @Override public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
                callback.onReceiveValue(null); return true;
            }
        });
        setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { retire(); return true; }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { retire(); return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                final HNPdfAssets current = assets;
                if (retired || !"GET".equals(request.getMethod()) || current == null
                        || (request.isForMainFrame() && !HNPdfAssets.HOST.equals(request.getUrl().toString())))
                    return HNPdfAssets.deny();
                final HNPdfDocument snapshot = document;
                if (!request.isForMainFrame() && bound && snapshot != null
                        && request.getUrl().toString().equals(snapshot.url()))
                    return snapshot.intercept(request.getUrl());
                return current.intercept(request.getUrl());
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
                if (!HNPdfAssets.HOST.equals(url) || staticLoaded) retire();
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (retired || !HNPdfAssets.HOST.equals(url) || !HNPdfAssets.HOST.equals(getUrl())) return;
                staticLoaded = true;
                installPort();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) fail("render", "PDF_HOST_UNAVAILABLE", "The packaged PDF host could not load.");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); retire(); }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                fail("render", "PDF_RENDERER_GONE", "The PDF renderer stopped."); return true;
            }
        });
        try {
            assets = new HNPdfAssets(name -> context.getAssets().open(name));
            loadUrl(HNPdfAssets.HOST);
        } catch (Exception invalidRuntime) { retire(); }
    }

    void configure(String wire) {
        if (retired || (wire != null && wire.equals(configurationWire))) return;
        if (wire == null) { if (configurationWire != null) retire(); return; }
        if (configurationWire != null) { retire(); return; }
        try {
            JSONObject value = HNPdfProtocol.configuration(wire);
            configurationWire = wire;
            session = value.getString("sessionId");
            generation = value.getLong("generation");
            postDelayed(deadline, 15000);
            installPort();
        } catch (Exception invalid) { retire(); }
    }

    private void installPort() {
        if (retired || !staticLoaded || configurationWire == null || port != null) return;
        for (String feature : new String[]{WebViewFeature.CREATE_WEB_MESSAGE_CHANNEL,
                WebViewFeature.POST_WEB_MESSAGE, WebViewFeature.WEB_MESSAGE_PORT_POST_MESSAGE,
                WebViewFeature.WEB_MESSAGE_PORT_SET_MESSAGE_CALLBACK}) {
            if (!WebViewFeature.isFeatureSupported(feature)) {
                fail("unsupported", "PDF_CAPABILITY_UNAVAILABLE", "This WebView has no private PDF transport."); return;
            }
        }
        try {
            final WebMessagePortCompat[] pair = WebViewCompat.createWebMessageChannel(this);
            if (pair.length != 2 || pair[0] == null || pair[1] == null) throw new IllegalStateException("No PDF port");
            port = pair[1];
            port.setWebMessageCallback(new WebMessagePortCompat.WebMessageCallbackCompat() {
                @Override public void onMessage(WebMessagePortCompat from, WebMessageCompat message) {
                    if (retired || from != port || !HNPdfAssets.HOST.equals(getUrl()) || message == null) return;
                    try { receive(message.getData()); } catch (Exception invalid) { retire(); }
                }
            });
            byte[] nonce = new byte[32];
            new SecureRandom().nextBytes(nonce);
            final String token = Base64.encodeToString(nonce, Base64.NO_WRAP);
            final JSONObject identity = new JSONObject().put("sessionId", session).put("generation", generation);
            evaluateJavascript(installScript(token, identity.toString()), result -> {
                if (retired) { pair[0].close(); return; }
                if (!"true".equals(result) || !HNPdfAssets.HOST.equals(getUrl())) { retire(); return; }
                try {
                    WebViewCompat.postWebMessage(this, new WebMessageCompat(token, new WebMessagePortCompat[]{pair[0]}),
                            Uri.parse(HNPdfAssets.ORIGIN));
                } catch (Exception unavailable) { retire(); }
            });
        } catch (Exception unavailable) {
            fail("unsupported", "PDF_CAPABILITY_UNAVAILABLE", "The private PDF transport could not start.");
        }
    }

    static String installScript(String token, String identity) {
        return "(function(){if(window!==top){return false;}const token=" + JSONObject.quote(token)
                + ";const receive=function(event){if(event.data!==token||!event.ports||event.ports.length!==1){return;}"
                + "window.removeEventListener('message',receive);const port=event.ports[0];"
                + "import('./android-shell.mjs').then(module=>{if(!module.installPdfAndroidPort(port," + identity
                + ")){port.close();}}).catch(()=>port.close());};window.addEventListener('message',receive);return true;})()";
    }

    private void receive(String wire) throws Exception {
        final JSONObject value = HNPdfProtocol.parse(wire);
        if (!HNPdfProtocol.event(value, session, generation)) return;
        final String type = value.getString("type");
        if ("boot".equals(type)) {
            if (bound) return;
            bound = true;
            emit(value);
            openDocument();
            return;
        }
        if (!bound || document == null || !opening) return;
        if ("state".equals(type)) {
            JSONObject state = value.getJSONObject("state");
            if ("ready".equals(state.getString("status"))) {
                int count = state.getInt("pageCount");
                if (pageCount != 0 && pageCount != count) return;
                pageCount = count;
                removeCallbacks(deadline);
            }
            emit(value);
            if ("error".equals(state.getString("status"))) retire();
        } else if ("page".equals(type)) {
            if (pageCount == 0 || pageCount != value.getJSONObject("page").getInt("pageCount")) return;
            emit(value);
        } else if ("selection".equals(type)) {
            if (pageCount != 0) {
                JSONObject selection = value.optJSONObject("selection");
                if (selection != null) {
                    double scale = getScale() / context.getResources().getDisplayMetrics().density;
                    if (!Double.isFinite(scale) || scale <= 0 || scale > 10) return;
                    org.json.JSONArray rects = selection.getJSONArray("rects");
                    for (int index = 0; index < rects.length(); index++) {
                        JSONObject rect = rects.getJSONObject(index);
                        for (String key : new String[]{"x", "y", "width", "height"}) rect.put(key, rect.getDouble(key) * scale);
                    }
                }
                emit(value);
            }
        } else if ("result".equals(type)) {
            long id = value.getLong("commandId");
            JSONObject command = pending.get(id);
            if (command == null) return;
            Object result = value.get("result");
            if ("navigate".equals(command.getString("type")) ? !(result instanceof Boolean)
                    : result != JSONObject.NULL && (!(result instanceof JSONObject)
                        || ((JSONObject) result).getInt("pageNumber") != command.getInt("pageNumber"))) return;
            pending.remove(id);
            emit(value);
        }
    }

    private void openDocument() {
        reader.execute(() -> {
            HNPdfDocument snapshot = null;
            try {
                String uri = HNPdfProtocol.configuration(configurationWire).getString("uri");
                snapshot = HNPdfSource.open(context, uri, cancellation, () -> !retired && bound);
                final HNPdfDocument ready = snapshot;
                if (!post(() -> {
                    if (retired || !bound) { ready.revoke(); return; }
                    document = ready;
                    opening = true;
                    try { send(envelope("open", 0).put("url", ready.url())); }
                    catch (Exception invalid) { retire(); }
                })) ready.revoke();
            } catch (Exception failed) {
                if (snapshot != null) snapshot.revoke();
                post(() -> fail("read", "PDF_SOURCE_READ_FAILED", "The local PDF could not be read."));
            }
        });
    }

    void command(String wire) {
        if (retired) return;
        try {
            JSONObject value = HNPdfProtocol.parse(wire);
            if (!HNPdfProtocol.command(value, session, generation)) return;
            long id = value.getLong("commandId");
            if (id <= lastCommand) return;
            lastCommand = id;
            String type = value.getString("type");
            if ("dispose".equals(type)) { retire(); return; }
            if (!bound || !opening || pageCount == 0) return;
            if ("navigate".equals(type) || "thumbnail".equals(type)) {
                if (value.getInt("pageNumber") > pageCount || pending.size() >= 64) return;
                if ("thumbnail".equals(type)) {
                    int count = 0;
                    for (JSONObject request : pending.values()) if ("thumbnail".equals(request.optString("type"))) count++;
                    if (count >= 4) return;
                }
                pending.put(id, value);
                postDelayed(() -> pending.remove(id), 10000);
            }
            send(value);
        } catch (Exception invalid) { retire(); }
    }

    private JSONObject envelope(String type, long command) throws Exception {
        return new JSONObject().put("protocol", "hamster-pdf").put("version", 1)
                .put("sessionId", session).put("generation", generation).put("commandId", command).put("type", type);
    }

    private void send(JSONObject value) {
        if (retired || port == null || !HNPdfAssets.HOST.equals(getUrl())) return;
        port.postMessage(new WebMessageCompat(value.toString()));
    }

    private void emit(JSONObject value) {
        if (retired || getId() == NO_ID) return;
        EventDispatcher dispatcher = UIManagerHelper.getEventDispatcherForReactTag(context, getId());
        if (dispatcher != null) {
            WritableMap data = Arguments.createMap();
            data.putString("data", value.toString());
            dispatcher.dispatchEvent(new PdfMessageEvent(UIManagerHelper.getSurfaceId(this), getId(), data));
        }
    }

    private void fail(String category, String code, String message) {
        if (retired) return;
        try {
            if (session != null) emit(envelope("state", 0).put("state", new JSONObject().put("sessionId", session)
                    .put("generation", generation).put("status", "error").put("error", new JSONObject()
                        .put("category", category).put("code", code).put("message", message))));
        } catch (Exception ignored) { }
        retire();
    }

    // Keep the native action mode and handles while removing public menu items.
    // This policy still requires real WebView device validation.
    private ActionMode.Callback menuCallback(ActionMode.Callback callback) {
        return new ActionMode.Callback2() {
            @Override public boolean onCreateActionMode(ActionMode mode, Menu menu) { callback.onCreateActionMode(mode, menu); menu.clear(); return true; }
            @Override public boolean onPrepareActionMode(ActionMode mode, Menu menu) { callback.onPrepareActionMode(mode, menu); menu.clear(); return true; }
            @Override public boolean onActionItemClicked(ActionMode mode, MenuItem item) { return true; }
            @Override public void onDestroyActionMode(ActionMode mode) { callback.onDestroyActionMode(mode); }
            @Override public void onGetContentRect(ActionMode mode, android.view.View view, android.graphics.Rect rect) {
                if (callback instanceof ActionMode.Callback2) ((ActionMode.Callback2) callback).onGetContentRect(mode, view, rect);
                else super.onGetContentRect(mode, view, rect);
            }
        };
    }
    @Override public ActionMode startActionMode(ActionMode.Callback callback) { return super.startActionMode(menuCallback(callback)); }
    @Override public ActionMode startActionMode(ActionMode.Callback callback, int type) { return super.startActionMode(menuCallback(callback), type); }
    @Override public void onHostResume() { }
    @Override public void onHostPause() { fail("render", "PDF_HOST_BACKGROUND", "Reopen the PDF after returning to the application."); }
    @Override public void onHostDestroy() { retire(); }
    @Override protected void onDetachedFromWindow() { retire(); super.onDetachedFromWindow(); }

    void retire() {
        if (retired) return;
        retired = true;
        bound = false;
        cancellation.cancel();
        reader.shutdownNow();
        removeCallbacks(deadline);
        pending.clear();
        configurationWire = null;
        context.removeLifecycleEventListener(this);
        HNPdfDocument snapshot = document;
        document = null;
        if (snapshot != null) snapshot.revoke();
        WebMessagePortCompat current = port;
        port = null;
        if (current != null) { try { current.close(); } catch (RuntimeException ignored) { } }
        assets = null;
        stopLoading();
        setWebChromeClient(null);
        removeAllViews();
        destroy();
    }

    private static final class PdfMessageEvent extends Event<PdfMessageEvent> {
        private final WritableMap data;
        PdfMessageEvent(int surface, int tag, WritableMap data) { super(surface, tag); this.data = data; }
        @Override public String getEventName() { return "topPdfMessage"; }
        @Override public boolean canCoalesce() { return false; }
        @Override protected WritableMap getEventData() { return data; }
    }
}
