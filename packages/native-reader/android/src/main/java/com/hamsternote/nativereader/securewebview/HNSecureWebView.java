package com.hamsternote.nativereader.securewebview;

import android.graphics.Rect;
import android.net.Uri;
import android.text.TextUtils;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebMessagePortCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.facebook.common.logging.FLog;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.CatalystInstance;
import com.facebook.react.bridge.JavaScriptModule;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableNativeArray;
import com.facebook.react.bridge.WritableNativeMap;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.UIManagerHelper;
import com.facebook.react.uimanager.events.ContentSizeChangeEvent;
import com.facebook.react.uimanager.events.Event;
import com.facebook.react.views.scroll.OnScrollDispatchHelper;
import com.facebook.react.views.scroll.ScrollEvent;
import com.facebook.react.views.scroll.ScrollEventType;
import com.hamsternote.nativereader.securewebview.events.TopCustomMenuSelectionEvent;
import com.hamsternote.nativereader.securewebview.events.TopMessageEvent;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.security.SecureRandom;
import android.util.Base64;

public class HNSecureWebView extends WebView implements LifecycleEventListener {
    protected @Nullable
    String injectedJS;
    protected @Nullable
    String injectedJSBeforeContentLoaded;
    protected static final String JAVASCRIPT_INTERFACE = "ReactNativeWebView";
    static final String NATIVE_ASSET_ORIGIN = "https://appassets.androidplatform.net";
    static final String NATIVE_READER_HOST_URL = NATIVE_ASSET_ORIGIN + "/foliate/reader.html";
    /**
     * This is a native selector, deliberately not a URL.  A page URL is untrusted input and must
     * never be able to opt a normal WebView into the listener-free Foliate host.
     */
    static final String NATIVE_FOLIATE_HOST_SELECTOR = "foliate";
    static final String CSP_PROBE_IMAGE_URL = NATIVE_ASSET_ORIGIN + "/foliate/probes/csp-1x1.png";
    static final String CSP_PROBE_SCRIPT_URL = NATIVE_ASSET_ORIGIN + "/foliate/probes/csp-external-canary.js";
    private static final String CSP_PROBE_MESSAGE_PREFIX = "hn-csp-probe-v1:";
    // This is deliberately a publication policy. The host CSP belongs only to reader.html.
    private static final String STRICT_PUBLICATION_CSP =
            "default-src 'none'; script-src 'none'; img-src 'none'; style-src 'none'; "
                    + "font-src 'none'; media-src 'none'; connect-src 'none'; object-src 'none'; "
                    + "base-uri 'none'; form-action 'none'";
    // The strict-frame marker is negative evidence and must never become a short optimistic pass.
    private static final long STRICT_CANARY_SETTLE_TIMEOUT_MS = 1500L;
    private static final long PRIVATE_PORT_BIND_TIMEOUT_MS = 3000L;
    protected @Nullable
    WebViewCompat.WebMessageListener bridgeListener = null;
    private final NativePlatformCapabilityGate nativePlatformCapabilityGate =
            new NativePlatformCapabilityGate();
    private final NativeFoliateHostBridge nativeFoliateHostBridge =
            new NativeFoliateHostBridge();
    private @Nullable WebMessagePortCompat nativeFoliatePort = null;
    // These are per-WebView. A ViewManager can service more than one React view concurrently.
    private boolean nativeFoliateMainFramePermit = false;
    private boolean nativeFoliateMainFrameInFlight = false;
    private boolean nativeFoliateHostReadyEventEmitted = false;
    private static final SecureRandom PRIVATE_BRIDGE_RANDOM = new SecureRandom();

    /**
     * android.webkit.WebChromeClient fundamentally does not support JS injection into frames other
     * than the main frame, so these two properties are mostly here just for parity with iOS & macOS.
     */
    protected boolean injectedJavaScriptForMainFrameOnly = true;
    protected boolean injectedJavaScriptBeforeContentLoadedForMainFrameOnly = true;

    protected boolean messagingEnabled = false;
    protected boolean failClosedOnShouldStartLoadWithRequest = false;
    // Existing cross-platform read-access prop; secure navigation treats it as
    // the sole local root available to subframes and subresources.
    protected @Nullable String allowingReadAccessToURL;
    protected @Nullable
    String messagingModuleName;
    protected @Nullable
    HNSecureWebViewMessagingModule mMessagingJSModule;
    protected @Nullable
    HNSecureWebViewClient mHNSecureWebViewClient;
    protected boolean sendContentSizeChangeEvents = false;
    private OnScrollDispatchHelper mOnScrollDispatchHelper;
    protected boolean hasScrollEvent = false;
    protected boolean nestedScrollEnabled = false;
    protected ProgressChangedFilter progressChangedFilter;

    /**
     * WebView must be created with an context of the current activity
     * <p>
     * Activity Context is required for creation of dialogs internally by WebView
     * Reactive Native needed for access to ReactNative internal system functionality
     */
    public HNSecureWebView(ThemedReactContext reactContext) {
        super(reactContext);
        mMessagingJSModule = ((ThemedReactContext) this.getContext()).getReactApplicationContext().getJSModule(HNSecureWebViewMessagingModule.class);
        progressChangedFilter = new ProgressChangedFilter();
    }

    public void setBasicAuthCredential(HNSecureBasicAuthCredential credential) {
        if (mHNSecureWebViewClient != null) {
            mHNSecureWebViewClient.setBasicAuthCredential(credential);
        }
    }

    public void setSendContentSizeChangeEvents(boolean sendContentSizeChangeEvents) {
        this.sendContentSizeChangeEvents = sendContentSizeChangeEvents;
    }

    public void setHasScrollEvent(boolean hasScrollEvent) {
        this.hasScrollEvent = hasScrollEvent;
    }

    public void setNestedScrollEnabled(boolean nestedScrollEnabled) {
        this.nestedScrollEnabled = nestedScrollEnabled;
    }

    @Override
    public void onHostResume() {
        // do nothing
    }

    @Override
    public void onHostPause() {
        // do nothing
    }

    @Override
    public void onHostDestroy() {
        nativePlatformCapabilityGate.reset();
        teardownNativeFoliatePort();
        nativeFoliateHostBridge.markUnsupported();
        cleanupCallbacksAndDestroy();
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (this.nestedScrollEnabled) {
            requestDisallowInterceptTouchEvent(true);
        }
        return super.onTouchEvent(event);
    }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);

        if (sendContentSizeChangeEvents) {
            dispatchEvent(
                    this,
                    new ContentSizeChangeEvent(
                            HNSecureWebViewWrapper.getReactTagFromWebView(this),
                            w,
                            h
                    )
            );
        }
    }

    protected @Nullable
    List<Map<String, String>> menuCustomItems;

    public void setMenuCustomItems(List<Map<String, String>> menuCustomItems) {
      this.menuCustomItems = menuCustomItems;
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
      if(menuCustomItems == null ){
        return super.startActionMode(callback, type);
      }

      return super.startActionMode(new ActionMode.Callback2() {
        @Override
        public boolean onCreateActionMode(ActionMode mode, Menu menu) {
          for (int i = 0; i < menuCustomItems.size(); i++) {
            menu.add(Menu.NONE, i, i, (menuCustomItems.get(i)).get("label"));
          }
          return true;
        }

        @Override
        public boolean onPrepareActionMode(ActionMode actionMode, Menu menu) {
          return false;
        }

        @Override
        public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
          WritableMap wMap = Arguments.createMap();
          HNSecureWebView.this.evaluateJavascript(
            "(function(){return {selection: window.getSelection().toString()} })()",
            new ValueCallback<String>() {
              @Override
              public void onReceiveValue(String selectionJson) {
                Map<String, String> menuItemMap = menuCustomItems.get(item.getItemId());
                wMap.putString("label", menuItemMap.get("label"));
                wMap.putString("key", menuItemMap.get("key"));
                String selectionText = "";
                try {
                  selectionText = new JSONObject(selectionJson).getString("selection");
                } catch (JSONException ignored) {}
                wMap.putString("selectedText", selectionText);
                dispatchEvent(HNSecureWebView.this, new TopCustomMenuSelectionEvent(HNSecureWebViewWrapper.getReactTagFromWebView(HNSecureWebView.this), wMap));
                mode.finish();
              }
            }
          );
          return true;
        }

        @Override
        public void onDestroyActionMode(ActionMode mode) {
          mode = null;
        }

        @Override
        public void onGetContentRect (ActionMode mode,
                View view,
                Rect outRect){
            if (callback instanceof ActionMode.Callback2) {
                ((ActionMode.Callback2) callback).onGetContentRect(mode, view, outRect);
            } else {
                super.onGetContentRect(mode, view, outRect);
            }
          }
      }, type);
    }

    @Override
    public void setWebViewClient(WebViewClient client) {
        super.setWebViewClient(client);
        if (client instanceof HNSecureWebViewClient) {
            mHNSecureWebViewClient = (HNSecureWebViewClient) client;
            mHNSecureWebViewClient.setProgressChangedFilter(progressChangedFilter);
        }
    }

    WebChromeClient mWebChromeClient;
    @Override
    public void setWebChromeClient(WebChromeClient client) {
        this.mWebChromeClient = client;
        super.setWebChromeClient(client);
        if (client instanceof HNSecureWebChromeClient) {
            ((HNSecureWebChromeClient) client).setProgressChangedFilter(progressChangedFilter);
        }
    }

    public WebChromeClient getWebChromeClient() {
        return this.mWebChromeClient;
    }

    public @Nullable
    HNSecureWebViewClient getHNSecureWebViewClient() {
        return mHNSecureWebViewClient;
    }

    public boolean getMessagingEnabled() {
        return this.messagingEnabled;
    }

    protected void createHNSecureWebViewBridge(HNSecureWebView webView) {
        // The 4A listener is deliberately one-shot capability evidence. Once the private bridge
        // reload begins it must never recreate a page-world ReactNativeWebView object.
        if (nativeFoliateHostBridge.isFinalHostMode()) {
            return;
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            // A listener absent from the installed WebView is stable unsupported. Never restore
            // the legacy Java bridge: it cannot attest the frame or exact origin/current URL.
            nativePlatformCapabilityGate.markUnsupported();
            return;
        }

        if (this.bridgeListener != null) {
            nativePlatformCapabilityGate.markListenerReady();
            return;
        }

        this.bridgeListener = new WebViewCompat.WebMessageListener() {
            @Override
            public void onPostMessage(
                    @NonNull WebView view,
                    @NonNull WebMessageCompat message,
                    @NonNull Uri sourceOrigin,
                    boolean isMainFrame,
                    @NonNull JavaScriptReplyProxy replyProxy) {
                HNSecureWebView.this.onNativeHostMessage(
                        message.getData(), sourceOrigin, isMainFrame, view.getUrl());
            }
        };
        try {
            WebViewCompat.addWebMessageListener(
                    webView,
                    JAVASCRIPT_INTERFACE,
                    Set.of(NATIVE_ASSET_ORIGIN),
                    this.bridgeListener);
            nativePlatformCapabilityGate.markListenerReady();
        } catch (RuntimeException exception) {
            // Feature reporting is not proof that registration works on this WebView build.
            bridgeListener = null;
            nativePlatformCapabilityGate.markUnsupported();
        }
        injectJavascriptObject();
    }

    private void injectJavascriptObject() {
      if (isGenericPageCommandLocked()) {
        return;
      }
      if (getSettings().getJavaScriptEnabled()) {
        String js = "(function(){\n" +
          "    window." + JAVASCRIPT_INTERFACE + " = window." + JAVASCRIPT_INTERFACE + " || {};\n" +
          "    window." + JAVASCRIPT_INTERFACE + ".injectedObjectJson = function () { return " + (injectedJavaScriptObject == null ? null : ("`" + injectedJavaScriptObject + "`")) + "; };\n" +
          "})();";
        evaluateJavascriptWithFallback(js);
      }
    }

    public void setMessagingEnabled(boolean enabled) {
        if (messagingEnabled == enabled) {
            return;
        }

        messagingEnabled = enabled;

        if (enabled) {
            createHNSecureWebViewBridge(this);
        } else {
            nativePlatformCapabilityGate.reset();
        }
    }

    public void setFailClosedOnShouldStartLoadWithRequest(boolean enabled) {
        failClosedOnShouldStartLoadWithRequest = enabled;
    }

    public boolean getFailClosedOnShouldStartLoadWithRequest() {
        return failClosedOnShouldStartLoadWithRequest;
    }

    public void setAllowingReadAccessToURL(@Nullable String value) {
        allowingReadAccessToURL = value;
    }

    /**
     * Accepts the one supported native host selector. Selecting it is one-way for this WebView:
     * callers that need to move from a generic document to Foliate must remount a fresh view.
     */
    // Package-private by design: React managers may reach this selector only
    // through HNSecureWebViewManagerImpl's exact source/newSource parser.
    void setNativeHost(@Nullable String selector) {
        if (selector == null) {
            // Clearing a selector cannot downgrade a selected secure view.
            return;
        }
        if (NATIVE_FOLIATE_HOST_SELECTOR.equals(selector)
                && nativeFoliateHostBridge.isFoliateHostSelected()) {
            // React prop reconciliation is allowed to repeat the same committed selector.
            return;
        }
        if (!NATIVE_FOLIATE_HOST_SELECTOR.equals(selector)
                || !nativeFoliateHostBridge.selectFoliateHost()) {
            nativeFoliateHostBridge.markUnsupported();
            teardownNativeFoliatePort();
            return;
        }
        beginNativeFoliateCapabilityPreflight();
    }

    /** True once the exact selector has committed this individual WebView to Foliate. */
    boolean isNativeFoliateHostSelected() {
        return nativeFoliateHostBridge.isFoliateHostSelected();
    }

    /**
     * The selector locks generic page APIs before the capability probe starts, rather than after a
     * URL happens to equal reader.html. This is the no-downgrade boundary.
     */
    boolean isGenericPageCommandLocked() {
        return nativeFoliateHostBridge.isGenericPageCommandLocked();
    }

    /** A normal source reconciliation after selection is a stable secure failure, never a reload. */
    void rejectGenericSourceUpdate() {
        if (isGenericPageCommandLocked()) {
            nativeFoliateHostBridge.markUnsupported();
            teardownNativeFoliatePort();
        }
    }

    public @Nullable String getAllowingReadAccessToURL() {
        return allowingReadAccessToURL;
    }

    protected void evaluateJavascriptWithFallback(String script) {
        if (isGenericPageCommandLocked()) {
            return;
        }
        evaluateJavascript(script, null);
    }

    /**
     * The legacy ABI is intentionally preserved for ordinary WebView consumers.  Once the
     * listener-free Foliate host is active it is not a page-world MessageEvent API: its string is
     * a complete adapter-owned wire which is validated and sent only over the private port.
     */
    public void postMessage(String data) {
        if (isGenericPageCommandLocked()) {
            // Before the port is installed this is deliberately a no-op. In particular, do not
            // fall back to dispatching a page-world MessageEvent during the bind race.
            postFoliateHostWire(data);
            return;
        }
        try {
            final JSONObject eventInitDict = new JSONObject();
            eventInitDict.put("data", data);
            evaluateJavascriptWithFallback(
                    "(function () {"
                            + "var event;var data=" + eventInitDict + ";"
                            + "try{event=new MessageEvent('message',data);}catch(e){"
                            + "event=document.createEvent('MessageEvent');"
                            + "event.initMessageEvent('message',true,true,data.data,data.origin,data.lastEventId,data.source);}"
                            + "document.dispatchEvent(event);})();");
        } catch (JSONException exception) {
            // Generic ABI behavior remains compatible, but command input must never crash native.
            FLog.w("HNSecureWebView", "Ignoring malformed generic postMessage input.", exception);
        }
    }

    /** Secure-mode generic page commands are intentionally inert; postMessage is the sole ABI. */
    public boolean mayRunGenericPageCommand() {
        return !isGenericPageCommandLocked();
    }

    public void callInjectedJavaScript() {
        if (isGenericPageCommandLocked()) {
            return;
        }
        if (getSettings().getJavaScriptEnabled() &&
                injectedJS != null &&
                !TextUtils.isEmpty(injectedJS)) {
            evaluateJavascriptWithFallback("(function() {\n" + injectedJS + ";\n})();");
            injectJavascriptObject(); // Re-inject only helper data, never a Java interface fallback.
        }
    }

    public void callInjectedJavaScriptBeforeContentLoaded() {
        if (isGenericPageCommandLocked()) {
            return;
        }
        if (getSettings().getJavaScriptEnabled() &&
                injectedJSBeforeContentLoaded != null &&
                !TextUtils.isEmpty(injectedJSBeforeContentLoaded)) {
            evaluateJavascriptWithFallback("(function() {\n" + injectedJSBeforeContentLoaded + ";\n})();");
            injectJavascriptObject();
        }
    }

    protected String injectedJavaScriptObject = null;

    public void setInjectedJavaScriptObject(String obj) {
      if (isGenericPageCommandLocked()) {
        return;
      }
      this.injectedJavaScriptObject = obj;
      injectJavascriptObject();
    }

    /** The client invalidates capability readiness as soon as navigation leaves the native host. */
    void onNativeReaderHostPageStarted(String url) {
        if (!nativeFoliateHostBridge.isFoliateHostSelected()) {
            nativeFoliateHostBridge.noteGenericPageLoad(url);
        }
        if (nativeFoliateHostBridge.isFoliateHostSelected()) {
            // Only the selector-owned, one-shot main-frame request may begin reader.html. A URL
            // that merely looks like the host has no authority to consume this permit.
            if (!NATIVE_READER_HOST_URL.equals(url) || !nativeFoliateMainFramePermit) {
                nativeFoliateHostBridge.markUnsupported();
                teardownNativeFoliatePort();
                return;
            }
            nativeFoliateMainFramePermit = false;
            nativeFoliateMainFrameInFlight = true;
        }
        nativeFoliateHostBridge.onNavigation(url);
        teardownNativeFoliatePort();
        if (nativeFoliateHostBridge.isFinalHostMode()) {
            // The successful 4A proof precedes this clean reload. Do not feed the old listener
            // gate again or expose a second page-world capability during final-port setup.
            return;
        }
        // A new exact host document may retry the behavior probe only when the listener was
        // already registered safely. Legacy or registration-failed WebViews remain unsupported.
        nativePlatformCapabilityGate.onNavigation(url, bridgeListener != null);
        lockSecureSessionAfterCapabilityFailure();
    }

    /**
     * Begins a behavior probe only after the static native host has finished. No publication URI
     * is accepted by this layer; callers must require {@link #isPreSourceCapabilityReady()} first.
     */
    void onNativeReaderHostPageFinished(String url) {
        if (nativeFoliateHostBridge.isAwaitingFinalHostReload()) {
            establishNativeFoliatePrivatePort(url);
            return;
        }
        if (nativeFoliateHostBridge.isFinalHostMode()) {
            return;
        }
        final NativePlatformCapabilityGate.ProbeStart probe =
                nativePlatformCapabilityGate.beginProbe(url, System.currentTimeMillis());
        if (probe == null) {
            return;
        }

        try {
            // The host owns all observation. The child documents contain only external canaries,
            // so this does not need an inline child observer.
            evaluateJavascript(buildCspProbeScript(probe), value -> {
                if ("\"started\"".equals(value)) {
                    nativePlatformCapabilityGate.onProbeEvaluateCompleted(
                            probe.generation, probe.token, getUrl(), System.currentTimeMillis());
                } else {
                    nativePlatformCapabilityGate.onProbeEvaluateFailed(
                            probe.generation, probe.token, getUrl(), System.currentTimeMillis());
                }
                lockSecureSessionAfterCapabilityFailure();
            });
        } catch (RuntimeException exception) {
            // An unavailable evaluateJavascript path cannot establish a source precondition.
            nativePlatformCapabilityGate.onProbeEvaluateFailed(
                    probe.generation, probe.token, getUrl(), System.currentTimeMillis());
            lockSecureSessionAfterCapabilityFailure();
        }
    }

    /**
     * A 4C source preparer must use this gate before opening, copying, reading, or transferring a
     * host-owned publication. 4A.3 intentionally defines no source transport.
     */
    boolean isPreSourceCapabilityReady() {
        return nativePlatformCapabilityGate.isReady(getUrl(), System.currentTimeMillis());
    }

    /** A top-level load failure is a verdict input while a pre-source probe is draining. */
    void onNativeReaderHostLoadFailed(@Nullable String url) {
        nativePlatformCapabilityGate.onNavigation(url, false);
        lockSecureSessionAfterCapabilityFailure();
    }

    String getNativePlatformCapabilityStateForTesting() {
        return nativePlatformCapabilityGate.getStateName(System.currentTimeMillis());
    }

    String getNativeFoliateBridgeStateForTesting() {
        return nativeFoliateHostBridge.getStateName();
    }

    boolean isSecureNativeReaderHost() {
        return NATIVE_READER_HOST_URL.equals(getUrl()) && nativeFoliateHostBridge.isFinalHostMode();
    }

    boolean isSecureNativeReaderHostModeActive() {
        return nativeFoliateHostBridge.isFinalHostMode();
    }

    boolean isNativeFoliateMainFrameRequestPermitted(@Nullable Uri uri) {
        return nativeFoliateHostBridge.isFoliateHostSelected()
                && (nativeFoliateMainFramePermit || nativeFoliateMainFrameInFlight)
                && uri != null
                && NATIVE_READER_HOST_URL.equals(uri.toString());
    }

    /** Invoked only by the client after final private-port transfer has become bindable. */
    void emitNativeFoliateHostReadyOnce() {
        if (nativeFoliateHostReadyEventEmitted || !nativeFoliateHostBridge.isAwaitingAdapterBind(getUrl())) {
            return;
        }
        final HNSecureWebViewClient client = mHNSecureWebViewClient;
        if (client == null) {
            nativeFoliateHostBridge.markUnsupported();
            teardownNativeFoliatePort();
            return;
        }
        nativeFoliateHostReadyEventEmitted = true;
        // This retained finish/onLoad ABI means only "host ready to bind". It does not mean a
        // publication has been transferred, opened, or rendered (4B intentionally has no source I/O).
        client.emitFoliateHostReadyEvent(this, NATIVE_READER_HOST_URL);
    }

    private void onNativeHostMessage(
            String message, Uri sourceOrigin, boolean isMainFrame, @Nullable String currentUrl) {
        if (!nativePlatformCapabilityGate.isTrustedBridgeContext(
                isMainFrame, sourceOrigin, currentUrl, System.currentTimeMillis())) {
            return;
        }

        if (message != null && message.startsWith(CSP_PROBE_MESSAGE_PREFIX)) {
            handleCspProbeMessage(
                    message.substring(CSP_PROBE_MESSAGE_PREFIX.length()), currentUrl);
            if (nativePlatformCapabilityGate.isReady(currentUrl, System.currentTimeMillis())) {
                beginNativeFoliatePrivateReload();
            }
            return;
        }

        // The WebMessageListener is only 4A capability proof. It is never a reader protocol
        // transport and must not dispatch ordinary host traffic to React Native.
    }

    /**
     * Removes the temporary page-world listener before a clean host reload. The reload is a hard
     * boundary: a document which observed the 4A object cannot retain the final private port.
     */
    private void beginNativeFoliatePrivateReload() {
        if (!nativeFoliateHostBridge.beginReload()) {
            return;
        }
        try {
            if (bridgeListener == null) {
                nativeFoliateHostBridge.markUnsupported();
                return;
            }
            WebViewCompat.removeWebMessageListener(this, JAVASCRIPT_INTERFACE);
            bridgeListener = null;
            // Do not use reload(): a cache/history restoration can retain the page-world object.
            loadNativeFoliateHostMainFrame();
        } catch (RuntimeException exception) {
            nativeFoliateHostBridge.markUnsupported();
        }
    }

    /** Establishes the final transport only after the listener-free exact host has loaded. */
    private void establishNativeFoliatePrivatePort(@Nullable String url) {
        if (!NATIVE_READER_HOST_URL.equals(url) || !NATIVE_READER_HOST_URL.equals(getUrl())) {
            nativeFoliateHostBridge.markUnsupported();
            return;
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.CREATE_WEB_MESSAGE_CHANNEL)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.POST_WEB_MESSAGE)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_PORT_POST_MESSAGE)
                || !WebViewFeature.isFeatureSupported(
                        WebViewFeature.WEB_MESSAGE_PORT_SET_MESSAGE_CALLBACK)) {
            nativeFoliateHostBridge.markUnsupported();
            return;
        }

        final String installToken = nativeFoliateHostBridge.createInstallToken();
        if (installToken == null) {
            return;
        }
        try {
            final WebMessagePortCompat[] ports = WebViewCompat.createWebMessageChannel(this);
            if (ports.length != 2 || ports[0] == null || ports[1] == null) {
                nativeFoliateHostBridge.markUnsupported();
                return;
            }
            nativeFoliatePort = ports[1];
            nativeFoliatePort.setWebMessageCallback(
                    new WebMessagePortCompat.WebMessageCallbackCompat() {
                        @Override
                        public void onMessage(
                                @NonNull WebMessagePortCompat port,
                                @Nullable WebMessageCompat message) {
                            onNativeFoliatePortMessage(port, message);
                        }
                    });

            // The token exists only in this native method and in the evaluated host closure. A
            // same-origin child can post messages, but cannot guess the one-shot 256-bit token or
            // obtain the transferred port. No window global or parent bridge is created.
            final String installScript = buildPrivatePortInstallScript(installToken);
            evaluateJavascript(installScript, value -> {
                if (!"true".equals(value)
                        || !nativeFoliateHostBridge.isAwaitingPrivatePort(getUrl())) {
                    teardownNativeFoliatePort();
                    nativeFoliateHostBridge.markUnsupported();
                    return;
                }
                try {
                    WebViewCompat.postWebMessage(
                            HNSecureWebView.this,
                            new WebMessageCompat(
                                    installToken, new WebMessagePortCompat[]{ports[0]}),
                            Uri.parse(NATIVE_ASSET_ORIGIN));
                    nativeFoliateHostBridge.onPrivatePortInstalled();
                    emitNativeFoliateHostReadyOnce();
                    postDelayed(() -> {
                        if (nativeFoliateHostBridge.isAwaitingAdapterBind(getUrl())) {
                            teardownNativeFoliatePort();
                            nativeFoliateHostBridge.markUnsupported();
                        }
                    }, PRIVATE_PORT_BIND_TIMEOUT_MS);
                } catch (RuntimeException exception) {
                    teardownNativeFoliatePort();
                    nativeFoliateHostBridge.markUnsupported();
                }
            });
        } catch (RuntimeException exception) {
            teardownNativeFoliatePort();
            nativeFoliateHostBridge.markUnsupported();
        }
    }

    private static String buildPrivatePortInstallScript(String installToken) {
        return "(function(){const token=" + JSONObject.quote(installToken)
                + ";const receive=function(event){try{if(event.data!==token||!event.ports||event.ports.length!==1){return;}"
                + "window.removeEventListener('message',receive);import('./bootstrap.js').then(function(module){"
                + "if(!module||typeof module.installFoliateNativeHostBridge!=='function'||!module.installFoliateNativeHostBridge(event.ports[0])){try{event.ports[0].close();}catch(_){}}"
                + "}).catch(function(){try{event.ports[0].close();}catch(_){}});}catch(_){}};"
                + "window.addEventListener('message',receive);return true;})()";
    }

    /** Package-private seam: validates the generated final-host installer without a WebView stub. */
    static String buildPrivatePortInstallScriptForTesting(String installToken) {
        return buildPrivatePortInstallScript(installToken);
    }

    private void onNativeFoliatePortMessage(
            @NonNull WebMessagePortCompat port, @Nullable WebMessageCompat message) {
        final String data = message == null || message.getType() != WebMessageCompat.TYPE_STRING
                ? null : message.getData();
        final NativeFoliateHostBridge.ReceiveResult result;
        try {
            result = nativeFoliateHostBridge.receive(port == nativeFoliatePort, getUrl(), data);
        } catch (RuntimeException exception) {
            // A WebView implementation or malformed DTO must not escape the transport boundary.
            nativeFoliateHostBridge.terminate();
            teardownNativeFoliatePort();
            return;
        }
        if ((result == NativeFoliateHostBridge.ReceiveResult.ACCEPTED
                || result == NativeFoliateHostBridge.ReceiveResult.ACCEPTED_TERMINAL) && data != null) {
            // This is the retained onMessage(data: string) ABI.  The adapter remains responsible
            // for all session/generation/commandId allocation and receives only authenticated wire.
            onMessage(data, NATIVE_READER_HOST_URL);
        }
        if (result == NativeFoliateHostBridge.ReceiveResult.TERMINAL
                || result == NativeFoliateHostBridge.ReceiveResult.ACCEPTED_TERMINAL) {
            teardownNativeFoliatePort();
        }
    }

    private void teardownNativeFoliatePort() {
        final WebMessagePortCompat port = nativeFoliatePort;
        nativeFoliatePort = null;
        if (port != null) {
            try {
                port.close();
            } catch (RuntimeException ignored) {
                // A retired WebView may already have closed its renderer-side port.
            }
        }
    }

    private void postFoliateHostWire(@Nullable String data) {
        final WebMessagePortCompat port = nativeFoliatePort;
        final NativeFoliateHostBridge.SendResult result;
        try {
            result = nativeFoliateHostBridge.send(port != null, getUrl(), data);
        } catch (RuntimeException exception) {
            nativeFoliateHostBridge.terminate();
            teardownNativeFoliatePort();
            return;
        }
        if (result == NativeFoliateHostBridge.SendResult.TERMINAL) {
            teardownNativeFoliatePort();
            return;
        }
        if (result != NativeFoliateHostBridge.SendResult.ACCEPTED || port == null) {
            return;
        }
        try {
            port.postMessage(new WebMessageCompat(data));
        } catch (RuntimeException exception) {
            nativeFoliateHostBridge.markUnsupported();
            teardownNativeFoliatePort();
        }
    }

    /** Starts the selector-owned preflight; a direct reader.html URL cannot reach this method. */
    private void beginNativeFoliateCapabilityPreflight() {
        createHNSecureWebViewBridge(this);
        if (bridgeListener == null || nativePlatformCapabilityGate.hasFailedCapabilityAttempt()) {
            nativeFoliateHostBridge.markUnsupported();
            return;
        }
        loadNativeFoliateHostMainFrame();
    }

    /** Arms exactly one native main-frame reader.html navigation and bypasses generic loadUrl. */
    private void loadNativeFoliateHostMainFrame() {
        if (!nativeFoliateHostBridge.isFoliateHostSelected()) {
            nativeFoliateHostBridge.markUnsupported();
            return;
        }
        nativeFoliateMainFramePermit = true;
        nativeFoliateMainFrameInFlight = false;
        super.loadUrl(NATIVE_READER_HOST_URL);
    }

    @Override
    public void loadUrl(String url) {
        if (!isGenericPageCommandLocked()) {
            nativeFoliateHostBridge.noteGenericPageLoad(url);
            super.loadUrl(url);
        }
    }

    @Override
    public void loadUrl(String url, Map<String, String> additionalHttpHeaders) {
        if (!isGenericPageCommandLocked()) {
            nativeFoliateHostBridge.noteGenericPageLoad(url);
            super.loadUrl(url, additionalHttpHeaders);
        }
    }

    @Override
    public void postUrl(String url, byte[] postData) {
        if (!isGenericPageCommandLocked()) {
            nativeFoliateHostBridge.noteGenericPageLoad(url);
            super.postUrl(url, postData);
        }
    }

    @Override
    public void loadDataWithBaseURL(
            String baseUrl, String data, String mimeType, String encoding, String historyUrl) {
        if (!isGenericPageCommandLocked()) {
            nativeFoliateHostBridge.noteGenericPageLoad(baseUrl);
            super.loadDataWithBaseURL(baseUrl, data, mimeType, encoding, historyUrl);
        }
    }

    @Override
    public void reload() {
        if (!isGenericPageCommandLocked()) {
            super.reload();
        }
    }

    @Override
    public void goBack() {
        if (!isGenericPageCommandLocked()) {
            super.goBack();
        }
    }

    @Override
    public void goForward() {
        if (!isGenericPageCommandLocked()) {
            super.goForward();
        }
    }

    @Override
    public void clearHistory() {
        if (!isGenericPageCommandLocked()) {
            super.clearHistory();
        }
    }

    @Override
    public void stopLoading() {
        if (!isGenericPageCommandLocked()) {
            super.stopLoading();
        }
    }

    private void handleCspProbeMessage(String payload, @Nullable String currentUrl) {
        final long nowMs = System.currentTimeMillis();
        try {
            final JSONObject event = new JSONObject(payload);
            final long generation = event.optLong("generation", -1L);
            final String token = event.optString("token", "");
            final String type = event.optString("type", "");
            switch (type) {
                case "control":
                    nativePlatformCapabilityGate.onControlObservation(
                            generation,
                            token,
                            event.optBoolean("canary", false),
                            event.optBoolean("imageDecoded", false),
                            currentUrl,
                            nowMs);
                    break;
                case "strict":
                    nativePlatformCapabilityGate.onStrictDocumentObservation(
                            generation,
                            token,
                            event.optBoolean("documentReadable", false),
                            currentUrl,
                            nowMs);
                    break;
                case "strict-canary":
                    nativePlatformCapabilityGate.onStrictCanary(
                            generation, token, currentUrl, nowMs);
                    break;
                case "strict-js-error":
                    nativePlatformCapabilityGate.onStrictJavaScriptError(
                            generation,
                            token,
                            event.optBoolean("documentReadable", false),
                            currentUrl,
                            nowMs);
                    break;
                case "strict-png-error":
                    nativePlatformCapabilityGate.onStrictPngError(
                            generation,
                            token,
                            event.optBoolean("documentReadable", false),
                            currentUrl,
                            nowMs);
                    break;
                case "strict-png-loaded":
                    nativePlatformCapabilityGate.onStrictPngLoaded(
                            generation, token, currentUrl, nowMs);
                    break;
                case "strict-quiet":
                    nativePlatformCapabilityGate.onStrictQuietTimeout(
                            generation,
                            token,
                            event.optBoolean("documentReadable", false),
                            event.optBoolean("canary", false),
                            currentUrl,
                            nowMs);
                    break;
                case "probe-drained":
                    nativePlatformCapabilityGate.onProbeDrained(
                            generation,
                            token,
                            event.optBoolean("controlCanary", false),
                            event.optBoolean("controlImageDecoded", false),
                            event.optBoolean("strictDocumentReadable", false),
                            event.optBoolean("strictJsBlocked", false),
                            event.optBoolean("strictPngBlocked", false),
                            event.optBoolean("strictQuiet", false),
                            event.optBoolean("strictCanary", true),
                            event.optBoolean("completedWithoutFailure", false),
                            currentUrl,
                            nowMs);
                    break;
                case "probe-timeout":
                    nativePlatformCapabilityGate.onProbeTimeout(
                            generation, token, currentUrl, nowMs);
                    break;
                default:
                    // A trusted host message with an unknown probe shape is inert.
                    break;
            }
        } catch (JSONException exception) {
            // A trusted but malformed observation is a capability failure, never an alternate path.
            nativePlatformCapabilityGate.markUnsupported();
        } finally {
            lockSecureSessionAfterCapabilityFailure();
        }
    }

    /** Once a native-host capability attempt fails, this WebView can never reopen a generic page. */
    private void lockSecureSessionAfterCapabilityFailure() {
        if (nativePlatformCapabilityGate.hasFailedCapabilityAttempt()) {
            teardownNativeFoliatePort();
            nativeFoliateHostBridge.markUnsupported();
        }
    }

    /**
     * Builds two frames from one pre-created blob URL. Their document bytes, sandbox, and external
     * manifest-exact JS/PNG inputs are identical; strict CSP is the only intentional difference.
     */
    static String buildCspProbeScriptForTesting(long generation, String token) {
        return buildCspProbeScript(new NativePlatformCapabilityGate.ProbeStart(generation, token));
    }

    private static String buildCspProbeScript(NativePlatformCapabilityGate.ProbeStart probe) {
        final String probeHtml = buildProbeDocumentHtml(probe.token);
        return "(function(){"
                + "const generation=" + probe.generation + ";"
                + "const token=" + JSONObject.quote(probe.token) + ";"
                + "const strictCsp=" + JSONObject.quote(STRICT_PUBLICATION_CSP) + ";"
                + "const probeHtml=" + JSONObject.quote(probeHtml) + ";"
                + "const settleMs=" + STRICT_CANARY_SETTLE_TIMEOUT_MS + ";"
                + "const bridge=window." + JAVASCRIPT_INTERFACE + ";"
                + "if(!bridge||typeof bridge.postMessage!=='function'){return 'unavailable';}"
                + "function send(type,fields){"
                + "try{bridge.postMessage('" + CSP_PROBE_MESSAGE_PREFIX + "'+JSON.stringify(Object.assign({type:type,generation:generation,token:token},fields||{})));}catch(_){}}"
                + "function readable(doc){return !!(doc&&doc.getElementById('hn-csp-probe-document')&&doc.getElementById('hn-csp-probe-image'));}"
                + "function marker(doc){const node=doc&&doc.querySelector('meta[name=\"hn-csp-external-probe\"]');return !!(node&&node.content===token);}"
                + "const probeUrl=URL.createObjectURL(new Blob([probeHtml],{type:'text/html'}));"
                + "function createFrame(isStrict){"
                + "const frame=document.createElement('iframe');"
                // The strict iframe's enforcement attribute is set before sandbox/src/append.
                + "if(isStrict){frame.setAttribute('csp',strictCsp);}"
                + "frame.setAttribute('sandbox','allow-same-origin allow-scripts');"
                + "frame.setAttribute('aria-hidden','true');frame.style.display='none';"
                + "frame.src=probeUrl;"
                + "(document.body||document.documentElement).appendChild(frame);return frame;}"
                + "let controlDone=false,strictDocumentDone=false,strictJsDone=false,strictPngDone=false,strictQuietDone=false,terminalFailure=false,cleaned=false,strictObserver=null,probeTimeout=0;"
                + "const control=createFrame(false);const strict=createFrame(true);"
                // Drain is intentionally emitted only after every source-owning callback is terminal.
                + "function cleanup(){if(cleaned){return;}cleaned=true;if(strictObserver){strictObserver.disconnect();strictObserver=null;}if(probeTimeout){window.clearTimeout(probeTimeout);}control.remove();strict.remove();URL.revokeObjectURL(probeUrl);send('probe-drained',{controlCanary:controlDone,controlImageDecoded:controlDone,strictDocumentReadable:strictDocumentDone,strictJsBlocked:strictJsDone,strictPngBlocked:strictPngDone,strictQuiet:strictQuietDone,strictCanary:terminalFailure,completedWithoutFailure:!terminalFailure});}"
                + "function maybeDrain(){if(controlDone&&strictDocumentDone&&strictJsDone&&strictPngDone&&strictQuietDone){cleanup();}}"
                + "function fail(type,fields){if(cleaned){return;}terminalFailure=true;send(type,fields);cleanup();}"
                + "control.addEventListener('error',function(){fail('control',{canary:false,imageDecoded:false});});"
                + "control.addEventListener('load',function(){try{const doc=control.contentDocument;const image=doc&&doc.getElementById('hn-csp-probe-image');if(!readable(doc)||!image||typeof image.decode!=='function'){fail('control',{canary:false,imageDecoded:false});return;}Promise.resolve(image.decode()).then(function(){if(!marker(doc)){fail('control',{canary:false,imageDecoded:true});return;}controlDone=true;send('control',{canary:true,imageDecoded:true});maybeDrain();},function(){fail('control',{canary:marker(doc),imageDecoded:false});});}catch(_){fail('control',{canary:false,imageDecoded:false});}});"
                + "strict.addEventListener('error',function(){fail('strict',{documentReadable:false});});"
                + "strict.addEventListener('load',function(){try{const doc=strict.contentDocument;const image=doc&&doc.getElementById('hn-csp-probe-image');const script=doc&&doc.querySelector('script[data-hn-csp-probe-token]');if(!readable(doc)||!image||!script||typeof image.decode!=='function'){fail('strict',{documentReadable:false});return;}strictDocumentDone=true;send('strict',{documentReadable:true});strictObserver=new MutationObserver(function(){if(marker(doc)){fail('strict-canary',{documentReadable:true});}});strictObserver.observe(doc.documentElement,{childList:true,subtree:true});script.addEventListener('error',function(){fail('strict-js-error',{documentReadable:readable(doc)});});if(marker(doc)){fail('strict-canary',{documentReadable:true});return;}Promise.resolve(image.decode()).then(function(){fail('strict-png-loaded',{documentReadable:true});},function(){strictPngDone=true;send('strict-png-error',{documentReadable:true});maybeDrain();});window.setTimeout(function(){if(cleaned){return;}if(!readable(doc)||marker(doc)){fail('strict-canary',{documentReadable:readable(doc)});return;}strictJsDone=true;strictQuietDone=true;send('strict-quiet',{documentReadable:true,canary:false});maybeDrain();},settleMs);}catch(_){fail('strict',{documentReadable:false});}});"
                + "probeTimeout=window.setTimeout(function(){if(!cleaned){fail('probe-timeout');}},settleMs*3);"
                + "return 'started';})()";
    }

    private static String buildProbeDocumentHtml(String token) {
        return "<!doctype html><html><head><meta charset=\"utf-8\">"
                + "</head><body><main id=\"hn-csp-probe-document\"></main>"
                + "<script src=\"" + CSP_PROBE_SCRIPT_URL + "\" data-hn-csp-probe-token=\""
                + token + "\"></script><img id=\"hn-csp-probe-image\" src=\""
                + CSP_PROBE_IMAGE_URL + "\"></body></html>";
    }

    public void onMessage(String message, String sourceUrl) {
        ThemedReactContext reactContext = getThemedReactContext();
        HNSecureWebView mWebView = this;

        if (mHNSecureWebViewClient != null) {
            WebView webView = this;
            webView.post(new Runnable() {
                @Override
                public void run() {
                    if (mHNSecureWebViewClient == null) {
                        return;
                    }
                    WritableMap data = mHNSecureWebViewClient.createWebViewEvent(webView, sourceUrl);
                    data.putString("data", message);

                    if (mMessagingJSModule != null) {
                        dispatchDirectMessage(data);
                    } else {
                        dispatchEvent(webView, new TopMessageEvent(HNSecureWebViewWrapper.getReactTagFromWebView(webView), data));
                    }
                }
            });
        } else {
            WritableMap eventData = Arguments.createMap();
            eventData.putString("data", message);

            if (mMessagingJSModule != null) {
                dispatchDirectMessage(eventData);
            } else {
                dispatchEvent(this, new TopMessageEvent(HNSecureWebViewWrapper.getReactTagFromWebView(this), eventData));
            }
        }
    }

    protected void dispatchDirectMessage(WritableMap data) {
        WritableNativeMap event = new WritableNativeMap();
        event.putMap("nativeEvent", data);
        event.putString("messagingModuleName", messagingModuleName);

        mMessagingJSModule.onMessage(event);
    }

    protected boolean dispatchDirectShouldStartLoadWithRequest(WritableMap data) {
        WritableNativeMap event = new WritableNativeMap();
        event.putMap("nativeEvent", data);
        event.putString("messagingModuleName", messagingModuleName);

        mMessagingJSModule.onShouldStartLoadWithRequest(event);
        return true;
    }

    protected void onScrollChanged(int x, int y, int oldX, int oldY) {
        super.onScrollChanged(x, y, oldX, oldY);

        if (!hasScrollEvent) {
            return;
        }

        if (mOnScrollDispatchHelper == null) {
            mOnScrollDispatchHelper = new OnScrollDispatchHelper();
        }

        if (mOnScrollDispatchHelper.onScrollChanged(x, y)) {
            ScrollEvent event = ScrollEvent.obtain(
                    HNSecureWebViewWrapper.getReactTagFromWebView(this),
                    ScrollEventType.SCROLL,
                    x,
                    y,
                    mOnScrollDispatchHelper.getXFlingVelocity(),
                    mOnScrollDispatchHelper.getYFlingVelocity(),
                    this.computeHorizontalScrollRange(),
                    this.computeVerticalScrollRange(),
                    this.getWidth(),
                    this.getHeight());

            dispatchEvent(this, event);
        }
    }

    protected void dispatchEvent(WebView webView, Event event) {
        ThemedReactContext reactContext = getThemedReactContext();
        int reactTag = HNSecureWebViewWrapper.getReactTagFromWebView(webView);
        UIManagerHelper.getEventDispatcherForReactTag(reactContext, reactTag).dispatchEvent(event);
    }

    protected void cleanupCallbacksAndDestroy() {
        setWebViewClient(null);
        destroy();
    }

    @Override
    public void destroy() {
        if (mWebChromeClient != null) {
            mWebChromeClient.onHideCustomView();
        }
        super.destroy();
    }

  public ThemedReactContext getThemedReactContext() {
    return (ThemedReactContext) this.getContext();
  }

  public ReactApplicationContext getReactApplicationContext() {
      return this.getThemedReactContext().getReactApplicationContext();
  }

    /** Package-private policy/state seam for deterministic JVM fault-matrix coverage. */
    static final class NativePlatformCapabilityGate {
        private static final long PROBE_DEADLINE_MS = STRICT_CANARY_SETTLE_TIMEOUT_MS * 4;
        private final Object lock = new Object();
        private State state = State.DISABLED;
        private long generation = 0L;
        private long deadlineMs = 0L;
        private @Nullable String token = null;
        // This is intentionally session-scoped. A failed native-host probe cannot be retried into
        // a generic page-world bridge by toggling props or navigating inside the same WebView.
        private boolean secureHostAttempted = false;
        private boolean evaluateCompleted = false;
        private boolean controlObserved = false;
        private boolean strictDocumentObserved = false;
        private boolean strictJavaScriptBlocked = false;
        private boolean strictPngBlocked = false;
        private boolean strictQuietObserved = false;
        private boolean probeDrained = false;

        void markListenerReady() {
            synchronized (lock) {
                if (state == State.DISABLED || state == State.LISTENER_READY) {
                    state = State.LISTENER_READY;
                }
            }
        }

        void markUnsupported() {
            synchronized (lock) {
                invalidateLocked();
            }
        }

        void reset() {
            synchronized (lock) {
                if (secureHostAttempted && state == State.UNSUPPORTED) {
                    return;
                }
                state = State.DISABLED;
                generation++;
                clearProbeLocked();
            }
        }

        void onNavigation(@Nullable String url, boolean listenerRegistered) {
            synchronized (lock) {
                if (secureHostAttempted && state == State.UNSUPPORTED) {
                    // A failed secure-host attempt is final for this WebView session. In
                    // particular, navigation must not recreate a page-world listener later.
                    return;
                }
                generation++;
                clearProbeLocked();
                if (NATIVE_READER_HOST_URL.equals(url)) {
                    secureHostAttempted = true;
                }
                state = listenerRegistered && NATIVE_READER_HOST_URL.equals(url)
                        ? State.LISTENER_READY : State.UNSUPPORTED;
            }
        }

        @Nullable ProbeStart beginProbe(@Nullable String url, long nowMs) {
            synchronized (lock) {
                expireCandidateLocked(nowMs);
                if (state != State.LISTENER_READY || !NATIVE_READER_HOST_URL.equals(url)) {
                    invalidateLocked();
                    return null;
                }
                generation++;
                token = UUID.randomUUID().toString();
                deadlineMs = nowMs + PROBE_DEADLINE_MS;
                clearProbeVerdictsLocked();
                state = State.CANDIDATE;
                return new ProbeStart(generation, token);
            }
        }

        void onProbeEvaluateCompleted(
                long eventGeneration, String eventToken, @Nullable String currentUrl, long nowMs) {
            synchronized (lock) {
                if (isCurrentCandidateLocked(eventGeneration, eventToken, currentUrl, nowMs)) {
                    evaluateCompleted = true;
                    promoteIfDrainedAndProvenLocked();
                }
            }
        }

        void onProbeEvaluateFailed(
                long eventGeneration, String eventToken, @Nullable String currentUrl, long nowMs) {
            synchronized (lock) {
                if (isCurrentCandidateLocked(eventGeneration, eventToken, currentUrl, nowMs)) {
                    invalidateLocked();
                }
            }
        }

        void onControlObservation(
                long eventGeneration, String eventToken, boolean marker, boolean imageDecoded,
                @Nullable String currentUrl, long nowMs) {
            synchronized (lock) {
                if (!isCurrentCandidateLocked(eventGeneration, eventToken, currentUrl, nowMs)) {
                    return;
                }
                if (!marker || !imageDecoded) {
                    invalidateLocked();
                    return;
                }
                controlObserved = true;
                promoteIfDrainedAndProvenLocked();
            }
        }

        void onStrictDocumentObservation(
                long eventGeneration, String eventToken, boolean documentReadable,
                @Nullable String currentUrl, long nowMs) {
            synchronized (lock) {
                if (!isCurrentCandidateLocked(eventGeneration, eventToken, currentUrl, nowMs)) {
                    return;
                }
                if (!documentReadable) {
                    invalidateLocked();
                    return;
                }
                strictDocumentObserved = true;
                promoteIfDrainedAndProvenLocked();
            }
        }

        void onStrictJavaScriptError(
                long eventGeneration, String eventToken, boolean documentReadable,
                @Nullable String currentUrl, long nowMs) {
            synchronized (lock) {
                if (isCurrentCandidateLocked(eventGeneration, eventToken, currentUrl, nowMs)) {
                    // A real script error is never an affirmative signal. The quiet callback only
                    // supplies the blocked verdict after the observer has watched the full window.
                    invalidateLocked();
                }
            }
        }

        void onStrictPngError(
                long eventGeneration, String eventToken, boolean documentReadable,
                @Nullable String currentUrl, long nowMs) {
            synchronized (lock) {
                if (!isCurrentCandidateLocked(eventGeneration, eventToken, currentUrl, nowMs)) {
                    return;
                }
                if (!documentReadable) {
                    invalidateLocked();
                    return;
                }
                strictPngBlocked = true;
                promoteIfDrainedAndProvenLocked();
            }
        }

        void onStrictPngLoaded(
                long eventGeneration, String eventToken, @Nullable String currentUrl, long nowMs) {
            synchronized (lock) {
                if (isCurrentCandidateLocked(eventGeneration, eventToken, currentUrl, nowMs)) {
                    invalidateLocked();
                }
            }
        }

        void onStrictQuietTimeout(
                long eventGeneration, String eventToken, boolean documentReadable, boolean marker,
                @Nullable String currentUrl, long nowMs) {
            synchronized (lock) {
                if (!isCurrentCandidateLocked(eventGeneration, eventToken, currentUrl, nowMs)) {
                    return;
                }
                if (!documentReadable || marker) {
                    invalidateLocked();
                    return;
                }
                strictQuietObserved = true;
                strictJavaScriptBlocked = true;
                promoteIfDrainedAndProvenLocked();
            }
        }

        /** The observer is disconnected before the drain acknowledgement; late messages are inert. */
        void onStrictCanary(
                long eventGeneration, String eventToken, @Nullable String currentUrl, long nowMs) {
            synchronized (lock) {
                if (isCurrentCandidateLocked(eventGeneration, eventToken, currentUrl, nowMs)) {
                    invalidateLocked();
                }
            }
        }

        void onProbeTimeout(
                long eventGeneration, String eventToken, @Nullable String currentUrl, long nowMs) {
            synchronized (lock) {
                if (isCurrentCandidateLocked(eventGeneration, eventToken, currentUrl, nowMs)) {
                    invalidateLocked();
                }
            }
        }

        void onProbeDrained(
                long eventGeneration, String eventToken,
                boolean drainedControlCanary, boolean drainedControlImageDecoded,
                boolean drainedStrictDocumentReadable, boolean drainedStrictJsBlocked,
                boolean drainedStrictPngBlocked, boolean drainedStrictQuiet,
                boolean drainedStrictCanary, boolean completedWithoutFailure,
                @Nullable String currentUrl, long nowMs) {
            synchronized (lock) {
                if (!isCurrentCandidateLocked(eventGeneration, eventToken, currentUrl, nowMs)) {
                    return;
                }
                if (!drainedControlCanary || !drainedControlImageDecoded
                        || !drainedStrictDocumentReadable || !drainedStrictJsBlocked
                        || !drainedStrictPngBlocked || !drainedStrictQuiet || drainedStrictCanary
                        || !completedWithoutFailure) {
                    invalidateLocked();
                    return;
                }
                probeDrained = true;
                promoteIfDrainedAndProvenLocked();
            }
        }

        boolean isTrustedBridgeContext(
                boolean isMainFrame, @Nullable Uri sourceOrigin, @Nullable String currentUrl, long nowMs) {
            synchronized (lock) {
                expireCandidateLocked(nowMs);
                return isMainFrame && isExactNativeAssetOrigin(sourceOrigin)
                        && NATIVE_READER_HOST_URL.equals(currentUrl)
                        && state != State.DISABLED && state != State.UNSUPPORTED;
            }
        }

        boolean isReady(@Nullable String currentUrl, long nowMs) {
            synchronized (lock) {
                expireCandidateLocked(nowMs);
                return state == State.READY && NATIVE_READER_HOST_URL.equals(currentUrl);
            }
        }

        boolean shouldDispatchTrustedMessage(@Nullable String currentUrl, long nowMs) {
            return isReady(currentUrl, nowMs);
        }

        boolean hasFailedCapabilityAttempt() {
            synchronized (lock) {
                return secureHostAttempted && state == State.UNSUPPORTED;
            }
        }

        String getStateName(long nowMs) {
            synchronized (lock) {
                expireCandidateLocked(nowMs);
                return state.name();
            }
        }

        private boolean isCurrentCandidateLocked(
                long eventGeneration, String eventToken, @Nullable String currentUrl, long nowMs) {
            expireCandidateLocked(nowMs);
            return state == State.CANDIDATE && eventGeneration == generation && token != null
                    && token.equals(eventToken) && NATIVE_READER_HOST_URL.equals(currentUrl);
        }

        private void promoteIfDrainedAndProvenLocked() {
            if (state == State.CANDIDATE && evaluateCompleted && controlObserved
                    && strictDocumentObserved && strictJavaScriptBlocked && strictPngBlocked
                    && strictQuietObserved && probeDrained) {
                state = State.READY;
                // Drain removed both frames, revoked the shared blob URL, and disconnected the
                // observer. Forget this generation so no post-READY callback can revoke readiness.
                clearProbeLocked();
            }
        }

        private void expireCandidateLocked(long nowMs) {
            if (state == State.CANDIDATE && nowMs > deadlineMs) {
                invalidateLocked();
            }
        }

        private void invalidateLocked() {
            state = State.UNSUPPORTED;
            clearProbeLocked();
        }

        private void clearProbeLocked() {
            deadlineMs = 0L;
            token = null;
            clearProbeVerdictsLocked();
        }

        private void clearProbeVerdictsLocked() {
            evaluateCompleted = false;
            controlObserved = false;
            strictDocumentObserved = false;
            strictJavaScriptBlocked = false;
            strictPngBlocked = false;
            strictQuietObserved = false;
            probeDrained = false;
        }

        static final class ProbeStart {
            final long generation;
            final String token;

            ProbeStart(long generation, String token) {
                this.generation = generation;
                this.token = token;
            }
        }

        static boolean isExactNativeAssetOrigin(@Nullable Uri uri) {
            return uri != null && NATIVE_ASSET_ORIGIN.equals(uri.toString())
                    && "https".equals(uri.getScheme())
                    && "appassets.androidplatform.net".equals(uri.getHost())
                    && uri.getPort() == -1 && uri.getUserInfo() == null
                    && uri.getQuery() == null && uri.getFragment() == null;
        }

        private enum State {
            DISABLED,
            LISTENER_READY,
            CANDIDATE,
            READY,
            UNSUPPORTED
        }
    }

    /**
     * Private-port protocol state kept wholly on the native side. The React Native adapter owns
     * identity allocation and starts bind; this ledger only authenticates and forwards its exact
     * string wires. The parser is purpose-built instead of JSONObject so duplicate envelope keys
     * cannot shadow an authenticated value.
     */
    static final class NativeFoliateHostBridge {
        private static final int NORMAL_MESSAGE_BYTES = 8 * 1024;
        private static final int MODEL_MESSAGE_BYTES = 2 * 1024 * 1024;
        private static final long MAX_SAFE_INTEGER = 9007199254740991L;
        private static final String PROTOCOL = "hn-foliate-host";
        private State state = State.CAPABILITY_PROOF;
        // The selector state is separate from private-port state: it locks generic APIs as soon as
        // native accepts `{nativeHost: 'foliate'}`, including while CSP/port preflight is pending.
        private boolean foliateHostSelected = false;
        private boolean genericPageWasLoaded = false;
        private @Nullable String session = null;
        private @Nullable String installToken = null;
        private @Nullable String generation = null;
        private @Nullable String lastCommandId = null;
        private final java.util.Set<String> usedCommandIds = new java.util.HashSet<>();
        private static final int MAX_COMMANDS = 4096;
        private @Nullable String inflightType = null;
        private @Nullable String inflightCommandId = null;

        boolean selectFoliateHost() {
            if (foliateHostSelected || genericPageWasLoaded || state != State.CAPABILITY_PROOF) {
                return false;
            }
            foliateHostSelected = true;
            return true;
        }

        void noteGenericPageLoad(@Nullable String url) {
            if (!foliateHostSelected && url != null && !"about:blank".equals(url)) {
                genericPageWasLoaded = true;
            }
        }

        boolean isFoliateHostSelected() {
            return foliateHostSelected;
        }

        boolean isGenericPageCommandLocked() {
            return foliateHostSelected || isFinalHostMode();
        }

        boolean beginReload() {
            if (state != State.CAPABILITY_PROOF) return false;
            state = State.RELOADING;
            return true;
        }

        void onNavigation(@Nullable String url) {
            if (state == State.RELOADING) {
                if (!NATIVE_READER_HOST_URL.equals(url)) state = State.UNSUPPORTED;
                return;
            }
            if (state == State.PORT_INSTALLING || state == State.AWAITING_BIND || state == State.BOUND) {
                state = State.UNSUPPORTED;
            }
        }

        boolean isAwaitingFinalHostReload() {
            return state == State.RELOADING;
        }

        boolean isFinalHostMode() {
            return state == State.RELOADING || state == State.PORT_INSTALLING
                    || state == State.AWAITING_BIND || state == State.BOUND
                    || state == State.TERMINATED || state == State.UNSUPPORTED;
        }

        @Nullable String createInstallToken() {
            if (state != State.RELOADING) return null;
            final byte[] tokenBytes = new byte[32];
            PRIVATE_BRIDGE_RANDOM.nextBytes(tokenBytes);
            installToken = Base64.encodeToString(
                    tokenBytes, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            state = State.PORT_INSTALLING;
            return installToken;
        }

        boolean isAwaitingPrivatePort(@Nullable String currentUrl) {
            return state == State.PORT_INSTALLING && NATIVE_READER_HOST_URL.equals(currentUrl);
        }

        void onPrivatePortInstalled() {
            if (state == State.PORT_INSTALLING) state = State.AWAITING_BIND;
        }

        boolean isAwaitingAdapterBind(@Nullable String currentUrl) {
            return state == State.AWAITING_BIND && NATIVE_READER_HOST_URL.equals(currentUrl);
        }

        SendResult send(boolean channelOwned, @Nullable String currentUrl, @Nullable String data) {
            if (!channelOwned || !NATIVE_READER_HOST_URL.equals(currentUrl)
                    || state != State.AWAITING_BIND && state != State.BOUND) {
                return SendResult.NO_OP;
            }
            final Object scanned = scan(data);
            if (hasStaleIdentity(scanned, "native-to-host")) return SendResult.NO_OP;
            final Envelope envelope = validate(scanned, data, "native-to-host");
            if (envelope == null) {
                state = State.TERMINATED;
                return SendResult.TERMINAL;
            }
            if (state == State.AWAITING_BIND) {
                if (!"bind".equals(envelope.type)) {
                    state = State.TERMINATED;
                    return SendResult.TERMINAL;
                }
                session = envelope.session;
                generation = envelope.generation;
                lastCommandId = envelope.commandId;
                usedCommandIds.add(envelope.commandId);
                inflightType = "bind";
                inflightCommandId = envelope.commandId;
                state = State.BOUND;
                return SendResult.ACCEPTED;
            }
            if (!envelope.session.equals(session) || !envelope.generation.equals(generation)
                    || usedCommandIds.contains(envelope.commandId)) {
                return SendResult.NO_OP;
            }
            // dispose is the one explicit replacement: it retires an unanswered normal command so
            // teardown cannot be held hostage by a host that will never acknowledge it.
            if ("bind".equals(envelope.type)
                    || (inflightType != null && !"dispose".equals(envelope.type))) {
                state = State.TERMINATED;
                return SendResult.TERMINAL;
            }
            if (usedCommandIds.size() >= MAX_COMMANDS) {
                terminate();
                return SendResult.TERMINAL;
            }
            usedCommandIds.add(envelope.commandId);
            lastCommandId = envelope.commandId;
            inflightType = envelope.type;
            inflightCommandId = envelope.commandId;
            return SendResult.ACCEPTED;
        }

        ReceiveResult receive(boolean channelOwned, @Nullable String currentUrl, @Nullable String data) {
            if (!channelOwned || !NATIVE_READER_HOST_URL.equals(currentUrl)
                    || state != State.BOUND) {
                return ReceiveResult.NO_OP;
            }
            final Object scanned = scan(data);
            if (hasStaleIdentity(scanned, "host-to-native")) return ReceiveResult.NO_OP;
            final Envelope envelope = validate(scanned, data, "host-to-native");
            if (envelope == null) {
                state = State.TERMINATED;
                return ReceiveResult.TERMINAL;
            }
            // Wrong identity is stale/cross-context traffic. It must not terminate the current port.
            if (!envelope.session.equals(session) || !envelope.generation.equals(generation)) {
                return ReceiveResult.NO_OP;
            }
            if ("model".equals(envelope.type) || "location".equals(envelope.type)) {
                return envelope.commandId.equals(lastCommandId)
                        ? ReceiveResult.ACCEPTED : ReceiveResult.NO_OP;
            }
            if (inflightType == null || !envelope.commandId.equals(inflightCommandId)) {
                return ReceiveResult.NO_OP;
            }
            if ("ack".equals(envelope.type)) {
                if (!inflightType.equals(envelope.payload.get("command"))) {
                    state = State.TERMINATED;
                    return ReceiveResult.TERMINAL;
                }
                final boolean dispose = "dispose".equals(inflightType);
                inflightType = null;
                inflightCommandId = null;
                if (dispose) {
                    state = State.TERMINATED;
                    return ReceiveResult.ACCEPTED_TERMINAL;
                }
                return ReceiveResult.ACCEPTED;
            }
            if ("error".equals(envelope.type)) {
                final boolean terminal = Boolean.TRUE.equals(envelope.payload.get("terminal"))
                        || "dispose".equals(inflightType);
                inflightType = null;
                inflightCommandId = null;
                if (terminal) {
                    state = State.TERMINATED;
                    return ReceiveResult.ACCEPTED_TERMINAL;
                }
                return ReceiveResult.ACCEPTED;
            }
            if ("model".equals(envelope.type) || "location".equals(envelope.type)) {
                return ReceiveResult.ACCEPTED;
            }
            state = State.TERMINATED;
            return ReceiveResult.TERMINAL;
        }

        void markUnsupported() {
            state = State.UNSUPPORTED;
            session = null;
            installToken = null;
            generation = null;
            lastCommandId = null;
            usedCommandIds.clear();
            inflightType = null;
            inflightCommandId = null;
        }

        void terminate() {
            state = State.TERMINATED;
            inflightType = null;
            inflightCommandId = null;
        }

        String getStateName() {
            return state.name();
        }

        private static @Nullable Object scan(@Nullable String data) {
            if (data == null || utf8Length(data) > MODEL_MESSAGE_BYTES) return null;
            try {
                return new StrictJson(data).parse();
            } catch (RuntimeException exception) {
                return null;
            }
        }

        // Strict JSON scanning precedes identity. An invalid field cannot prove
        // staleness, but a valid old token or opposite direction is inert even
        // when the remainder of its envelope has an invalid schema.
        private boolean hasStaleIdentity(@Nullable Object value, String direction) {
            if (!(value instanceof Map)) return false;
            final Map<String, Object> map = castMap(value);
            final Object actualDirection = map.get("direction");
            return (("native-to-host".equals(actualDirection) || "host-to-native".equals(actualDirection))
                    && !direction.equals(actualDirection))
                    || session != null && isSession(map.get("session")) && !session.equals(map.get("session"))
                    || generation != null && isSession(map.get("generation")) && !generation.equals(map.get("generation"));
        }

        private static @Nullable Envelope parse(@Nullable String data, String direction) {
            return validate(scan(data), data, direction);
        }

        private static @Nullable Envelope validate(@Nullable Object value, @Nullable String data, String direction) {
            try {
                return validateEnvelope(value, data, direction);
            } catch (RuntimeException exception) {
                return null;
            }
        }

        private static @Nullable Envelope validateEnvelope(@Nullable Object value, @Nullable String data, String direction) {
            if (!(value instanceof Map)) return null;
            final Map<String, Object> map = castMap(value);
            if (!hasOnlyKeys(map, "protocol", "version", "direction", "type", "session",
                    "generation", "commandId", "payload")
                    || !PROTOCOL.equals(map.get("protocol"))
                    || !Long.valueOf(1L).equals(map.get("version"))
                    || !direction.equals(map.get("direction"))
                    || !(map.get("type") instanceof String)
                    || !isSession(map.get("session"))
                    || !isSession(map.get("generation"))
                    || !isSession(map.get("commandId"))
                    || !(map.get("payload") instanceof Map)) {
                return null;
            }
            final String type = (String) map.get("type");
            if (!"model".equals(type) && utf8Length(data) > NORMAL_MESSAGE_BYTES) return null;
            final Map<String, Object> payload = castMap(map.get("payload"));
            if (!("native-to-host".equals(direction)
                    ? validateNativePayload(type, payload) : validateHostPayload(type, payload))) return null;
            return new Envelope(
                    type,
                    (String) map.get("session"),
                    (String) map.get("generation"),
                    (String) map.get("commandId"),
                    payload);
        }

        private static boolean validateNativePayload(String type, Map<String, Object> payload) {
            if ("bind".equals(type) || "dispose".equals(type)) return hasOnlyKeys(payload);
            if ("navigate".equals(type)) {
                final Object target = payload.get("target");
                return hasOnlyKeys(payload, "target") && (isSafeInteger(target)
                        || target instanceof String && ((String) target).matches("d:[0-9]+"));
            }
            return "flow".equals(type) && hasOnlyKeys(payload, "flow")
                    && ("scrolled".equals(payload.get("flow")) || "paginated".equals(payload.get("flow")));
        }

        private static boolean validateHostPayload(String type, Map<String, Object> payload) {
            if ("ack".equals(type)) {
                return hasOnlyKeys(payload, "command", "status")
                        && payload.get("command") instanceof String
                        && payload.get("status") instanceof String
                        && ("bind".equals(payload.get("command"))
                        || "navigate".equals(payload.get("command"))
                        || "flow".equals(payload.get("command"))
                        || "dispose".equals(payload.get("command")))
                        && (("bind".equals(payload.get("command"))
                        && "bridge-bound".equals(payload.get("status")))
                        || (!"bind".equals(payload.get("command"))
                        && ("not-ready".equals(payload.get("status"))
                        || "unsupported".equals(payload.get("status")))));
            }
            if ("error".equals(type)) {
                return hasOnlyKeys(payload, "code", "terminal")
                        && ("protocol-violation".equals(payload.get("code"))
                        || "not-ready".equals(payload.get("code"))
                        || "unsupported".equals(payload.get("code")))
                        && payload.get("terminal") instanceof Boolean;
            }
            if ("location".equals(type)) {
                return hasOnlyKeys(payload, "section", "destination")
                        && isSafeInteger(payload.get("section"))
                        && (payload.get("destination") == null
                        || payload.get("destination") instanceof String
                        && ((String) payload.get("destination")).matches("d:[0-9]+"));
            }
            return "model".equals(type) && hasOnlyKeys(payload, "model")
                    && validateModel(payload.get("model"));
        }

        private static boolean validateModel(Object candidate) {
            if (!(candidate instanceof Map)) return false;
            final Map<String, Object> model = castMap(candidate);
            if (!hasOnlyKeys(model, "modelVersion", "format", "fixedLayout", "flow", "direction",
                    "metadata", "sections", "toc", "destinations")
                    || !Long.valueOf(1L).equals(model.get("modelVersion"))
                    || !(model.get("format") instanceof String)
                    || !(model.get("fixedLayout") instanceof Boolean)
                    || !(model.get("metadata") instanceof Map)
                    || !(model.get("sections") instanceof List)
                    || !(model.get("toc") instanceof List)
                    || !(model.get("destinations") instanceof List)) return false;
            final String format = (String) model.get("format");
            if (!("epub".equals(format) || "mobi".equals(format) || "kf8-azw3".equals(format)
                    || "fb2".equals(format) || "fbz".equals(format) || "cbz".equals(format))) return false;
            final boolean fixed = (Boolean) model.get("fixedLayout");
            if (fixed ? model.get("flow") != null : !("scrolled".equals(model.get("flow"))
                    || "paginated".equals(model.get("flow")))) return false;
            if (!(model.get("direction") == null || "ltr".equals(model.get("direction"))
                    || "rtl".equals(model.get("direction")))) return false;
            final Map<String, Object> metadata = castMap(model.get("metadata"));
            if (!hasOnlyKeys(metadata, "title") || !(metadata.get("title") == null
                    || isBoundedString(metadata.get("title"), 1024))) return false;
            final List<Object> sections = castList(model.get("sections"));
            final List<Object> destinations = castList(model.get("destinations"));
            if (sections.size() > 10000 || destinations.size() > 10000) return false;
            final java.util.HashMap<String, Long> sectionIndexes = new java.util.HashMap<>();
            for (int index = 0; index < sections.size(); index++) {
                if (!(sections.get(index) instanceof Map)) return false;
                final Map<String, Object> section = castMap(sections.get(index));
                if (!hasOnlyKeys(section, "id", "index", "linear")
                        || !isBoundedString(section.get("id"), 64)
                        || !Long.valueOf(index).equals(section.get("index"))
                        || !(section.get("linear") instanceof Boolean)
                        || sectionIndexes.put((String) section.get("id"), (long) index) != null) return false;
            }
            final java.util.HashSet<String> destinationIds = new java.util.HashSet<>();
            for (Object item : destinations) {
                if (!(item instanceof Map)) return false;
                final Map<String, Object> destination = castMap(item);
                if (!hasOnlyKeys(destination, "id", "sectionId", "sectionIndex")
                        || !isBoundedString(destination.get("id"), 64)
                        || !((String) destination.get("id")).matches("d:[0-9]+")
                        || !isBoundedString(destination.get("sectionId"), 64)
                        || !isSafeInteger(destination.get("sectionIndex"))
                        || !destination.get("sectionIndex").equals(
                                sectionIndexes.get(destination.get("sectionId")))
                        || !destinationIds.add((String) destination.get("id"))) return false;
            }
            return validateToc(castList(model.get("toc")), destinationIds);
        }

        private static boolean validateToc(List<Object> toc, java.util.Set<String> destinationIds) {
            final java.util.ArrayDeque<TocNode> nodes = new java.util.ArrayDeque<>();
            for (Object item : toc) nodes.add(new TocNode(item, 1));
            final java.util.HashSet<String> ids = new java.util.HashSet<>();
            int count = 0;
            while (!nodes.isEmpty()) {
                final TocNode current = nodes.removeLast();
                if (++count > 10000 || current.depth > 32 || !(current.value instanceof Map)) return false;
                final Map<String, Object> node = castMap(current.value);
                if (!hasOnlyKeys(node, "id", "label", "destinationId", "subitems")
                        || !isBoundedString(node.get("id"), 64)
                        || !isBoundedString(node.get("label"), 2048)
                        || !(node.get("destinationId") == null || isBoundedString(node.get("destinationId"), 64)
                        && destinationIds.contains(node.get("destinationId")))
                        || !(node.get("subitems") instanceof List)
                        || !ids.add((String) node.get("id"))) return false;
                for (Object child : castList(node.get("subitems"))) nodes.add(new TocNode(child, current.depth + 1));
            }
            return true;
        }

        private static boolean hasOnlyKeys(Map<String, Object> map, String... keys) {
            if (map.size() != keys.length) return false;
            for (String key : keys) if (!map.containsKey(key)) return false;
            return true;
        }

        private static boolean isSession(Object value) {
            return value instanceof String && ((String) value).matches("[A-Za-z0-9_-]{43}");
        }

        private static boolean isSafeInteger(Object value) {
            return value instanceof Long && (Long) value >= 0L && (Long) value <= MAX_SAFE_INTEGER;
        }

        private static boolean isBoundedString(Object value, int maximum) {
            return value instanceof String && ((String) value).length() <= maximum
                    && !hasUnpairedSurrogate((String) value);
        }

        private static boolean hasUnpairedSurrogate(String value) {
            for (int index = 0; index < value.length(); index++) {
                final char current = value.charAt(index);
                if (Character.isHighSurrogate(current)) {
                    if (++index == value.length() || !Character.isLowSurrogate(value.charAt(index))) return true;
                } else if (Character.isLowSurrogate(current)) return true;
            }
            return false;
        }

        private static int utf8Length(String value) {
            return value.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        }

        @SuppressWarnings("unchecked")
        private static Map<String, Object> castMap(Object value) {
            return (Map<String, Object>) value;
        }

        @SuppressWarnings("unchecked")
        private static List<Object> castList(Object value) {
            return (List<Object>) value;
        }

        enum SendResult { NO_OP, ACCEPTED, TERMINAL }

        enum ReceiveResult { NO_OP, ACCEPTED, ACCEPTED_TERMINAL, TERMINAL }

        private enum State {
            CAPABILITY_PROOF, RELOADING, PORT_INSTALLING, AWAITING_BIND, BOUND, TERMINATED, UNSUPPORTED
        }

        private static final class Envelope {
            final String type;
            final String session;
            final String generation;
            final String commandId;
            final Map<String, Object> payload;

            Envelope(String type, String session, String generation, String commandId,
                    Map<String, Object> payload) {
                this.type = type;
                this.session = session;
                this.generation = generation;
                this.commandId = commandId;
                this.payload = payload;
            }
        }

        private static final class TocNode {
            final Object value;
            final int depth;

            TocNode(Object value, int depth) {
                this.value = value;
                this.depth = depth;
            }
        }

        /** Strict duplicate-key and depth-bounded JSON reader for the transport's string wire. */
        private static final class StrictJson {
            private final String input;
            private int index = 0;
            private int depth = 0;

            StrictJson(String input) { this.input = input; }

            Object parse() {
                skipWhitespace();
                final Object value = value();
                skipWhitespace();
                if (index != input.length()) fail();
                return value;
            }

            private Object value() {
                skipWhitespace();
                if (index >= input.length()) fail();
                final char marker = input.charAt(index);
                if (marker == '{') return object();
                if (marker == '[') return array();
                if (marker == '"') return string();
                if (marker == '-' || marker >= '0' && marker <= '9') return number();
                if (input.startsWith("true", index)) { index += 4; return Boolean.TRUE; }
                if (input.startsWith("false", index)) { index += 5; return Boolean.FALSE; }
                if (input.startsWith("null", index)) { index += 4; return null; }
                fail(); return null;
            }

            private Map<String, Object> object() {
                enter(); index++; skipWhitespace();
                final Map<String, Object> result = new java.util.LinkedHashMap<>();
                if (consume('}')) { depth--; return result; }
                while (true) {
                    skipWhitespace();
                    if (index >= input.length() || input.charAt(index) != '"') fail();
                    final String key = string();
                    if (result.containsKey(key) || "__proto__".equals(key)
                            || "constructor".equals(key) || "prototype".equals(key)) fail();
                    skipWhitespace(); require(':'); result.put(key, value()); skipWhitespace();
                    if (consume('}')) { depth--; return result; }
                    require(',');
                }
            }

            private List<Object> array() {
                enter(); index++; skipWhitespace();
                final List<Object> result = new java.util.ArrayList<>();
                if (consume(']')) { depth--; return result; }
                while (true) {
                    result.add(value()); skipWhitespace();
                    if (consume(']')) { depth--; return result; }
                    require(',');
                }
            }

            private String string() {
                require('"'); final StringBuilder result = new StringBuilder();
                while (index < input.length()) {
                    final char character = input.charAt(index++);
                    if (character == '"') return result.toString();
                    if (character < 0x20) fail();
                    if (character != '\\') { appendScalar(result, character); continue; }
                    if (index >= input.length()) fail();
                    final char escaped = input.charAt(index++);
                    if (escaped == '"' || escaped == '\\' || escaped == '/') result.append(escaped);
                    else if (escaped == 'b') result.append('\b'); else if (escaped == 'f') result.append('\f');
                    else if (escaped == 'n') result.append('\n'); else if (escaped == 'r') result.append('\r');
                    else if (escaped == 't') result.append('\t'); else if (escaped == 'u') appendEscape(result);
                    else fail();
                }
                fail(); return null;
            }

            private void appendScalar(StringBuilder output, char character) {
                if (Character.isHighSurrogate(character)) {
                    if (index >= input.length() || !Character.isLowSurrogate(input.charAt(index))) fail();
                    output.append(character).append(input.charAt(index++));
                } else if (Character.isLowSurrogate(character)) fail(); else output.append(character);
            }

            private void appendEscape(StringBuilder output) {
                final char high = hex();
                if (Character.isLowSurrogate(high)) fail();
                if (Character.isHighSurrogate(high)) {
                    if (index + 1 >= input.length() || input.charAt(index++) != '\\' || input.charAt(index++) != 'u') fail();
                    final char low = hex(); if (!Character.isLowSurrogate(low)) fail(); output.append(high).append(low);
                } else output.append(high);
            }

            private char hex() {
                if (index + 4 > input.length()) { fail(); return 0; }
                final String token = input.substring(index, index + 4);
                if (!token.matches("[0-9a-fA-F]{4}")) { fail(); return 0; }
                index += 4; return (char) Integer.parseInt(token, 16);
            }

            private Long number() {
                final int start = index;
                if (consume('-')) fail();
                if (consume('0')) { if (index < input.length() && Character.isDigit(input.charAt(index))) fail(); }
                else { if (index >= input.length() || !Character.isDigit(input.charAt(index))) fail(); while (index < input.length() && Character.isDigit(input.charAt(index))) index++; }
                if (index < input.length() && (input.charAt(index) == '.' || input.charAt(index) == 'e' || input.charAt(index) == 'E')) fail();
                try { final long parsed = Long.parseLong(input.substring(start, index)); if (parsed < 0L || parsed > MAX_SAFE_INTEGER) fail(); return parsed; }
                catch (NumberFormatException exception) { fail(); return 0L; }
            }

            private void skipWhitespace() { while (index < input.length() && Character.isWhitespace(input.charAt(index))) index++; }
            private void enter() { if (++depth > 40) fail(); }
            private boolean consume(char expected) { if (index < input.length() && input.charAt(index) == expected) { index++; return true; } return false; }
            private void require(char expected) { if (!consume(expected)) fail(); }
            private void fail() { throw new IllegalArgumentException("invalid-json"); }
        }
    }


    protected static class ProgressChangedFilter {
        private boolean waitingForCommandLoadUrl = false;

        public void setWaitingForCommandLoadUrl(boolean isWaiting) {
            waitingForCommandLoadUrl = isWaiting;
        }

        public boolean isWaitingForCommandLoadUrl() {
            return waitingForCommandLoadUrl;
        }
    }
}
