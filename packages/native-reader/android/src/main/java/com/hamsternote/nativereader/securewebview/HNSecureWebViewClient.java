package com.hamsternote.nativereader.securewebview;

import android.annotation.TargetApi;
import android.content.Context;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.HttpAuthHandler;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import androidx.core.util.Pair;
import androidx.webkit.WebViewAssetLoader;

import com.facebook.common.logging.FLog;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.UIManagerHelper;
import com.hamsternote.nativereader.securewebview.events.SubResourceErrorEvent;
import com.hamsternote.nativereader.securewebview.events.TopHttpErrorEvent;
import com.hamsternote.nativereader.securewebview.events.TopLoadingErrorEvent;
import com.hamsternote.nativereader.securewebview.events.TopLoadingFinishEvent;
import com.hamsternote.nativereader.securewebview.events.TopLoadingStartEvent;
import com.hamsternote.nativereader.securewebview.events.TopRenderProcessGoneEvent;
import com.hamsternote.nativereader.securewebview.events.TopShouldStartLoadWithRequestEvent;
import android.webkit.CookieManager;
import android.webkit.CookieSyncManager;

import java.util.concurrent.atomic.AtomicReference;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class HNSecureWebViewClient extends WebViewClient {
    private static String TAG = "HNSecureWebViewClient";
    protected static final int SHOULD_OVERRIDE_URL_LOADING_TIMEOUT = 250;

    protected boolean mLastLoadFailed = false;
    protected HNSecureWebView.ProgressChangedFilter progressChangedFilter = null;
    protected @Nullable HNSecureBasicAuthCredential basicAuthCredential = null;
    private @Nullable WebViewAssetLoader foliateAssetLoader = null;

    public void setBasicAuthCredential(@Nullable HNSecureBasicAuthCredential credential) {
        basicAuthCredential = credential;
    }

    @Override
    public void onPageFinished(WebView webView, String url) {
        super.onPageFinished(webView, url);
        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                CookieManager.getInstance().flush();
            }else {
                CookieSyncManager.getInstance().sync();
            }
        }

        if (!mLastLoadFailed) {
            HNSecureWebView reactWebView = (HNSecureWebView) webView;

            reactWebView.onNativeReaderHostPageFinished(url);
            if (!reactWebView.isNativeFoliateHostSelected()) {
                reactWebView.callInjectedJavaScript();
                emitFinishEvent(webView, url);
            }
        }
    }

    @Override
    public void doUpdateVisitedHistory (WebView webView, String url, boolean isReload) {
      super.doUpdateVisitedHistory(webView, url, isReload);

      ((HNSecureWebView) webView).dispatchEvent(
        webView,
        new TopLoadingStartEvent(
          HNSecureWebViewWrapper.getReactTagFromWebView(webView),
          createWebViewEvent(webView, url)));
    }

    @Override
    public void onPageStarted(WebView webView, String url, Bitmap favicon) {
      super.onPageStarted(webView, url, favicon);
      mLastLoadFailed = false;

      HNSecureWebView reactWebView = (HNSecureWebView) webView;
      reactWebView.onNativeReaderHostPageStarted(url);
      reactWebView.callInjectedJavaScriptBeforeContentLoaded();
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return shouldOverrideUrlLoadingForMainFrame(view, url);
    }

    private boolean shouldOverrideUrlLoadingForMainFrame(WebView view, String url) {
        final HNSecureWebView rncWebView = (HNSecureWebView) view;
        if (rncWebView.isNativeFoliateHostSelected()) {
            // Native selector loads are issued directly by HNSecureWebView and do not use this
            // renderer-navigation callback. Any callback here is page/user initiated and denied.
            return true;
        }
        if (rncWebView.isSecureNativeReaderHostModeActive()) {
            // The final Foliate host never delegates page navigation to the RN callback. Its only
            // allowed top-level document is loaded by native code during the listener-free reload.
            return true;
        }
        final boolean failClosed = rncWebView.getFailClosedOnShouldStartLoadWithRequest();
        final ReactContext reactContext = rncWebView.getReactApplicationContext();
        final boolean canUseSynchronousJsGate;

        try {
            canUseSynchronousJsGate = rncWebView.mMessagingJSModule != null
                    && reactContext.hasActiveCatalystInstance()
                    && rncWebView.getReactApplicationContext().getJavaScriptContextHolder().get() != 0;
        } catch (RuntimeException e) {
            FLog.e(TAG, "Couldn't inspect the React instance for onShouldStartLoadWithRequest.", e);
            if (failClosed) {
                return true;
            }
            throw e;
        }

        if (canUseSynchronousJsGate) {
            final Pair<Double, AtomicReference<HNSecureWebViewModuleImpl.ShouldOverrideUrlLoadingLock.ShouldOverrideCallbackState>> lock = HNSecureWebViewModuleImpl.shouldOverrideUrlLoadingLock.getNewLock();
            final double lockIdentifier = lock.first;
            final AtomicReference<HNSecureWebViewModuleImpl.ShouldOverrideUrlLoadingLock.ShouldOverrideCallbackState> lockObject = lock.second;

            try {
                final WritableMap event = createWebViewEvent(view, url);
                event.putDouble("lockIdentifier", lockIdentifier);
                rncWebView.dispatchDirectShouldStartLoadWithRequest(event);

                synchronized (lockObject) {
                    final long deadline = SystemClock.elapsedRealtime() + SHOULD_OVERRIDE_URL_LOADING_TIMEOUT;
                    while (lockObject.get() == HNSecureWebViewModuleImpl.ShouldOverrideUrlLoadingLock.ShouldOverrideCallbackState.UNDECIDED) {
                        final long now = SystemClock.elapsedRealtime();
                        if (now >= deadline) {
                            FLog.w(TAG, "Did not receive response to shouldOverrideUrlLoading in time.");
                            return failClosed;
                        }
                        lockObject.wait(deadline - now);
                    }
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                FLog.e(TAG, "shouldOverrideUrlLoading was interrupted while waiting for result.", e);
                return failClosed;
            } catch (RuntimeException e) {
                FLog.e(TAG, "Failed to dispatch onShouldStartLoadWithRequest.", e);
                if (failClosed) {
                    return true;
                }
                throw e;
            } finally {
                // Removing the lock makes callbacks that arrive after a failure harmless.
                HNSecureWebViewModuleImpl.shouldOverrideUrlLoadingLock.removeLock(lockIdentifier);
            }

            final HNSecureWebViewModuleImpl.ShouldOverrideUrlLoadingLock.ShouldOverrideCallbackState callbackState = lockObject.get();
            if (callbackState == HNSecureWebViewModuleImpl.ShouldOverrideUrlLoadingLock.ShouldOverrideCallbackState.UNDECIDED) {
                FLog.w(TAG, "onShouldStartLoadWithRequest completed without a decision.");
                return failClosed;
            }
            return callbackState == HNSecureWebViewModuleImpl.ShouldOverrideUrlLoadingLock.ShouldOverrideCallbackState.SHOULD_OVERRIDE;
        } else {
            if (failClosed) {
                FLog.w(TAG, "Blocking top-level navigation because the JavaScript gate is unavailable.");
                return true;
            }
            FLog.w(TAG, "Couldn't use blocking synchronous call for onShouldStartLoadWithRequest due to debugging or missing Catalyst instance, falling back to old event-and-load.");
            progressChangedFilter.setWaitingForCommandLoadUrl(true);

            int reactTag = HNSecureWebViewWrapper.getReactTagFromWebView(view);
            UIManagerHelper.getEventDispatcherForReactTag((ReactContext) view.getContext(), reactTag).dispatchEvent(new TopShouldStartLoadWithRequestEvent(
                    reactTag,
                    createWebViewEvent(view, url)));
            return true;
        }
    }

    private boolean isAllowedSecureSubframeUrl(HNSecureWebView webView, Uri uri) {
        try {
            // The manifest-exact asset handler below decides the individual resource. This only
            // permits its fixed virtual HTTPS origin to reach that handler; it does not permit an
            // arbitrary appassets path, a network fallback, or a local file root.
            if (FoliateAssetHost.isExactAssetRequest(uri)) {
                return true;
            }
            final String url = uri.toString();
            if ("about:blank".equals(url) || "about:srcdoc".equals(url)) {
                return true;
            }

            final String root = webView.getAllowingReadAccessToURL();
            if (root == null || root.isEmpty()) {
                return false;
            }

            final Uri rootUri = Uri.parse(root);
            if (!isUnambiguousLocalFileUri(uri) || !isUnambiguousLocalFileUri(rootUri)) {
                return false;
            }

            final File canonicalRoot = new File(rootUri.getPath()).getCanonicalFile();
            final File canonicalCandidate = new File(uri.getPath()).getCanonicalFile();

            // Compare File components through the canonical parent chain, never textual prefixes.
            for (File parent = canonicalCandidate.getParentFile(); parent != null; parent = parent.getParentFile()) {
                if (canonicalRoot.equals(parent)) {
                    return true;
                }
            }
            return false;
        } catch (Exception e) {
            // A malformed URI, inaccessible path, or canonicalization failure is never trusted.
            return false;
        }
    }

    private boolean isUnambiguousLocalFileUri(Uri uri) {
        final String authority = uri == null ? null : uri.getAuthority();
        if (uri == null
                || !uri.isHierarchical()
                || !"file".equalsIgnoreCase(uri.getScheme())
                || uri.getUserInfo() != null
                // Android represents file:///... with an empty, not null, authority.
                || (authority != null && !authority.isEmpty())
                || uri.getQuery() != null
                || uri.getFragment() != null) {
            return false;
        }

        final String rawUri = uri.toString();
        final String path = uri.getPath();
        if (path == null || !new File(path).isAbsolute()) {
            return false;
        }

        for (int index = 0; index < rawUri.length(); index++) {
            final char character = rawUri.charAt(index);
            // Reject all escaping and controls instead of trying to normalize ambiguous encodings.
            if (character == '%' || character == '\\' || Character.isISOControl(character)) {
                return false;
            }
        }

        for (String segment : uri.getPathSegments()) {
            if (".".equals(segment) || "..".equals(segment) || segment.indexOf('\\') >= 0) {
                return false;
            }
        }
        return true;
    }

    private WebResourceResponse blockSecureSubresource() {
        return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
    }

    private WebResourceResponse interceptFoliateAssetRequest(
            HNSecureWebView view, Uri uri) {
        if (!FoliateAssetHost.isExactHostOrigin(uri)) {
            return null;
        }
        // `/foliate/` is reserved. Before the native selector has committed this particular
        // WebView, every request in the namespace is a deterministic 404 and can never use the
        // virtual HTTPS origin as a network fallback.
        if (FoliateAssetHost.isReservedFoliateRequest(uri) && !view.isNativeFoliateHostSelected()) {
            return FoliateAssetHost.notFound();
        }
        if (!FoliateAssetHost.isExactAssetRequest(uri)) {
            return FoliateAssetHost.isReservedFoliateRequest(uri)
                    ? FoliateAssetHost.notFound() : null;
        }
        if (foliateAssetLoader == null) {
            foliateAssetLoader = FoliateAssetHost.createLoader(view.getContext().getApplicationContext());
        }
        final WebResourceResponse response = foliateAssetLoader.shouldInterceptRequest(uri);
        // WebViewAssetLoader returns null when no PathHandler matches. Returning a real 404 here
        // is what prevents its virtual origin from falling through to HTTPS networking.
        return response == null ? FoliateAssetHost.notFound() : response;
    }

    @TargetApi(Build.VERSION_CODES.N)
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        final HNSecureWebView rncWebView = (HNSecureWebView) view;
        if (rncWebView.isNativeFoliateHostSelected() && request.isForMainFrame()) {
            // The exact reader.html request is initiated by native `super.loadUrl`, so this
            // callback only represents a renderer/user navigation and is never a permit path.
            return true;
        }
        if (rncWebView.isSecureNativeReaderHostModeActive()) {
            // The optional local-read prop is never an authority for final-host child documents.
            // Asset subresources are served below, but every subframe navigation is denied.
            if (request.isForMainFrame()) {
                return true;
            }
            return true;
        }
        final String url = request.getUrl().toString();
        if (!request.isForMainFrame()) {
            if (rncWebView.getFailClosedOnShouldStartLoadWithRequest()
                    && !isAllowedSecureSubframeUrl(rncWebView, request.getUrl())) {
                FLog.w(TAG, "Blocking subframe navigation outside the controlled local root.");
                return true;
            }
            return false;
        }
        return this.shouldOverrideUrlLoadingForMainFrame(view, url);
    }

    @Override
    public @Nullable WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        final HNSecureWebView rncWebView = (HNSecureWebView) view;
        if (rncWebView.isNativeFoliateHostSelected() && request.isForMainFrame()
                && !rncWebView.isNativeFoliateMainFrameRequestPermitted(request.getUrl())) {
            return FoliateAssetHost.notFound();
        }
        // Let only manifest-exact static host assets reach the AssetLoader first. Its explicit 404
        // prevents appassets URLs outside the manifest from falling through to HTTPS networking.
        final WebResourceResponse foliateAssetResponse = interceptFoliateAssetRequest(
                rncWebView, request.getUrl());
        if (foliateAssetResponse != null) {
            return foliateAssetResponse;
        }
        if (rncWebView.isSecureNativeReaderHostModeActive() && !request.isForMainFrame()) {
            // Every non-asset child document/resource is denied in final host mode. The optional
            // local read-access prop never weakens this publication boundary.
            return blockSecureSubresource();
        }
        if ((rncWebView.isSecureNativeReaderHostModeActive()
                || rncWebView.getFailClosedOnShouldStartLoadWithRequest())
                && !request.isForMainFrame()
                && !isAllowedSecureSubframeUrl(rncWebView, request.getUrl())) {
            FLog.w(TAG, "Blocking subframe resource outside the controlled local root.");
            return blockSecureSubresource();
        }
        return super.shouldInterceptRequest(view, request);
    }

    @Override
    public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
        if (basicAuthCredential != null) {
            handler.proceed(basicAuthCredential.username, basicAuthCredential.password);
            return;
        }
        super.onReceivedHttpAuthRequest(view, handler, host, realm);
    }

    @Override
    public void onReceivedSslError(final WebView webView, final SslErrorHandler handler, final SslError error) {
        // onReceivedSslError is called for most requests, per Android docs: https://developer.android.com/reference/android/webkit/WebViewClient#onReceivedSslError(android.webkit.WebView,%2520android.webkit.SslErrorHandler,%2520android.net.http.SslError)
        // WebView.getUrl() will return the top-level window URL.
        // If a top-level navigation triggers this error handler, the top-level URL will be the failing URL (not the URL of the currently-rendered page).
        // This is desired behavior. We later use these values to determine whether the request is a top-level navigation or a subresource request.
        String topWindowUrl = webView.getUrl();
        String failingUrl = error.getUrl();

        // Cancel request after obtaining top-level URL.
        // If request is cancelled before obtaining top-level URL, undesired behavior may occur.
        // Undesired behavior: Return value of WebView.getUrl() may be the current URL instead of the failing URL.
        handler.cancel();

        int code = error.getPrimaryError();
        String description = "";
        String descriptionPrefix = "SSL error: ";

        // https://developer.android.com/reference/android/net/http/SslError.html
        switch (code) {
            case SslError.SSL_DATE_INVALID:
                description = "The date of the certificate is invalid";
                break;
            case SslError.SSL_EXPIRED:
                description = "The certificate has expired";
                break;
            case SslError.SSL_IDMISMATCH:
                description = "Hostname mismatch";
                break;
            case SslError.SSL_INVALID:
                description = "A generic error occurred";
                break;
            case SslError.SSL_NOTYETVALID:
                description = "The certificate is not yet valid";
                break;
            case SslError.SSL_UNTRUSTED:
                description = "The certificate authority is not trusted";
                break;
            default:
                description = "Unknown SSL Error";
                break;
        }

        description = descriptionPrefix + description;

      if (!topWindowUrl.equalsIgnoreCase(failingUrl)) {
        // If error is not due to top-level navigation, then do not call onReceivedError()
        Log.w(TAG, "Resource blocked from loading due to SSL error. Blocked URL: "+failingUrl);
        this.onReceivedSubResourceSslError(
          webView,
          code,
          description,
          failingUrl
        );
        return;
      }

        this.onReceivedError(
                webView,
                code,
                description,
                failingUrl
        );
    }

    public void onReceivedSubResourceSslError(
      WebView webView,
      int errorCode,
      String description,
      String failingUrl) {

      WritableMap eventData = createWebViewEvent(webView, failingUrl);
      eventData.putDouble("code", errorCode);
      eventData.putString("description", description);

      int reactTag = HNSecureWebViewWrapper.getReactTagFromWebView(webView);
      UIManagerHelper.getEventDispatcherForReactTag((ReactContext) webView.getContext(), reactTag).dispatchEvent(new SubResourceErrorEvent(reactTag, eventData));
    }

    @Override
    public void onReceivedError(
            WebView webView,
            int errorCode,
            String description,
            String failingUrl) {

        super.onReceivedError(webView, errorCode, description, failingUrl);
        mLastLoadFailed = true;

        // A selector-owned Foliate host has no public onLoad until final private-port transfer is
        // bindable. Do not turn a pre-bind load failure into an optimistic finish/onLoad event.
        if (!((HNSecureWebView) webView).isNativeFoliateHostSelected()) {
            // In case of an error JS side expects a finish event before the error event.
            emitFinishEvent(webView, failingUrl);
        }

        WritableMap eventData = createWebViewEvent(webView, failingUrl);
        eventData.putDouble("code", errorCode);
        eventData.putString("description", description);

        int reactTag = HNSecureWebViewWrapper.getReactTagFromWebView(webView);
        UIManagerHelper.getEventDispatcherForReactTag((ReactContext) webView.getContext(), reactTag).dispatchEvent(new TopLoadingErrorEvent(reactTag, eventData));
    }

    @RequiresApi(api = Build.VERSION_CODES.M)
    @Override
    public void onReceivedError(
            WebView webView, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(webView, request, error);
        // The legacy overload above cannot distinguish a strict probe subresource denial from a
        // host navigation error. Only a confirmed main-frame error can invalidate this generation.
        if (request.isForMainFrame()) {
            ((HNSecureWebView) webView).onNativeReaderHostLoadFailed(request.getUrl().toString());
        }
    }

    @RequiresApi(api = Build.VERSION_CODES.M)
    @Override
    public void onReceivedHttpError(
            WebView webView,
            WebResourceRequest request,
            WebResourceResponse errorResponse) {
        super.onReceivedHttpError(webView, request, errorResponse);

        if (request.isForMainFrame()) {
            ((HNSecureWebView) webView).onNativeReaderHostLoadFailed(request.getUrl().toString());
            WritableMap eventData = createWebViewEvent(webView, request.getUrl().toString());
            eventData.putInt("statusCode", errorResponse.getStatusCode());
            eventData.putString("description", errorResponse.getReasonPhrase());

            int reactTag = HNSecureWebViewWrapper.getReactTagFromWebView(webView);
            UIManagerHelper.getEventDispatcherForReactTag((ReactContext) webView.getContext(), reactTag).dispatchEvent(new TopHttpErrorEvent(reactTag, eventData));
        }
    }

    @TargetApi(Build.VERSION_CODES.O)
    @Override
    public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
        // WebViewClient.onRenderProcessGone was added in O.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return false;
        }
        super.onRenderProcessGone(webView, detail);

        if (webView instanceof HNSecureWebView) {
            // A renderer death has no trustworthy pending callback completion path.
            ((HNSecureWebView) webView).onNativeReaderHostLoadFailed(null);
        }

        if(detail.didCrash()){
            Log.e(TAG, "The WebView rendering process crashed.");
        }
        else{
            Log.w(TAG, "The WebView rendering process was killed by the system.");
        }

        // if webView is null, we cannot return any event
        // since the view is already dead/disposed
        // still prevent the app crash by returning true.
        if(webView == null){
            return true;
        }

        WritableMap event = createWebViewEvent(webView, webView.getUrl());
        event.putBoolean("didCrash", detail.didCrash());
        int reactTag = HNSecureWebViewWrapper.getReactTagFromWebView(webView);
        UIManagerHelper.getEventDispatcherForReactTag((ReactContext) webView.getContext(), reactTag).dispatchEvent(new TopRenderProcessGoneEvent(reactTag, event));

        // returning false would crash the app.
        return true;
    }

    protected void emitFinishEvent(WebView webView, String url) {
        int reactTag = HNSecureWebViewWrapper.getReactTagFromWebView(webView);
        UIManagerHelper.getEventDispatcherForReactTag((ReactContext) webView.getContext(), reactTag).dispatchEvent(new TopLoadingFinishEvent(reactTag, createWebViewEvent(webView, url)));
    }

    /** The selector-owned host emits exactly once, after the private transport is bindable. */
    void emitFoliateHostReadyEvent(HNSecureWebView webView, String url) {
        emitFinishEvent(webView, url);
    }

    protected WritableMap createWebViewEvent(WebView webView, String url) {
        WritableMap event = Arguments.createMap();
        event.putDouble("target", HNSecureWebViewWrapper.getReactTagFromWebView(webView));
        // Don't use webView.getUrl() here, the URL isn't updated to the new value yet in callbacks
        // like onPageFinished
        event.putString("url", url);
        event.putBoolean("loading", !mLastLoadFailed && webView.getProgress() != 100);
        event.putString("title", webView.getTitle());
        event.putBoolean("canGoBack", webView.canGoBack());
        event.putBoolean("canGoForward", webView.canGoForward());
        return event;
    }

    public void setProgressChangedFilter(HNSecureWebView.ProgressChangedFilter filter) {
        progressChangedFilter = filter;
    }

    /**
     * Serves only the generated Foliate runtime whose complete file set is recorded in its
     * manifest. This is intentionally an asset host, not a publication-policy mechanism: its
     * host CSP protects the static runtime document and never proves publication CSP enforcement.
     *
     * <p>The implementation is nested in this staged production seam so the existing fault matrix
     * compiles exactly the Android source shipped by the secure-WebView staging pipeline.
     */
    static final class FoliateAssetHost implements WebViewAssetLoader.PathHandler {
        static final String ORIGIN = "https://appassets.androidplatform.net";
        static final String PATH_PREFIX = "/foliate/";
        private static final String MANIFEST_PATH = "manifest.json";
        private static final String HOST_DOCUMENT_PATH = "reader.html";
        private static final String HOST_CSP_VERSION = "foliate-host-csp-1";
        private static final byte[] EMPTY_BODY = new byte[0];

        private final AssetManager assetManager;
        private final Map<String, AssetEntry> assets;
        private final @Nullable String hostCsp;

        FoliateAssetHost(Context context) {
            assetManager = context.getAssets();
            assets = loadManifest(assetManager);
            hostCsp = loadHostCsp(assetManager, assets);
        }

        static WebViewAssetLoader createLoader(Context context) {
            return new WebViewAssetLoader.Builder()
                    .addPathHandler(PATH_PREFIX, new FoliateAssetHost(context))
                    .build();
        }

        static boolean isExactHostOrigin(Uri uri) {
            return uri != null
                    && "https".equals(uri.getScheme())
                    && "appassets.androidplatform.net".equals(uri.getHost())
                    && uri.getPort() == -1
                    && uri.getUserInfo() == null
                    && "appassets.androidplatform.net".equals(uri.getEncodedAuthority());
        }

        /** Reject raw URL ambiguity before WebViewAssetLoader can normalize a request path. */
        static boolean isExactAssetRequest(Uri uri) {
            return isExactHostOrigin(uri)
                    && uri.getQuery() == null
                    && uri.getFragment() == null
                    && isExactEncodedAssetPath(uri);
        }

        /** A raw `/foliate/` namespace check used solely to return an explicit pre-selection 404. */
        static boolean isReservedFoliateRequest(Uri uri) {
            final String encodedPath = uri == null ? null : uri.getEncodedPath();
            return isExactHostOrigin(uri) && encodedPath != null && encodedPath.startsWith(PATH_PREFIX);
        }

        static WebResourceResponse notFound() {
            return response("text/plain", "UTF-8", 404, "Not Found", EMPTY_BODY, "default-src 'none'");
        }

        WebResourceResponse intercept(Uri uri) {
            if (!isExactAssetRequest(uri)) {
                return notFound();
            }
            return handle(uri.getEncodedPath().substring(PATH_PREFIX.length()));
        }

        @Override
        public @Nullable WebResourceResponse handle(String path) {
            // PathHandler receives the suffix after PATH_PREFIX. Do not decode or canonicalize it:
            // only a byte-for-byte manifest key is safe to serve.
            if (!isCanonicalManifestPath(path)) {
                return notFound();
            }

            final AssetEntry entry = assets.get(path);
            if (entry == null || hostCsp == null) {
                return notFound();
            }

            try {
                final byte[] bytes = readAndVerifyAsset(entry);
                return response(entry.mimeType, entry.charset, 200, "OK", bytes, hostCsp);
            } catch (IOException | NoSuchAlgorithmException e) {
                // Missing, modified, or unreadable generated assets are indistinguishable to WebView.
                return notFound();
            }
        }

        static Map<String, AssetEntry> parseManifestForTesting(String manifest) throws JSONException {
            return parseManifest(new JSONObject(manifest));
        }

        @Nullable String getHostCspForTesting() {
            return hostCsp;
        }

        static @Nullable String extractInitialHostCspForTesting(String html) {
            return extractInitialHostCsp(html);
        }

        private static Map<String, AssetEntry> loadManifest(AssetManager assetManager) {
            try (InputStream stream = assetManager.open(MANIFEST_PATH)) {
                return parseManifest(new JSONObject(readUtf8(stream)));
            } catch (IOException | JSONException e) {
                // A broken/missing manifest must leave the host empty, never broaden the asset root.
                return Collections.emptyMap();
            }
        }

        private static Map<String, AssetEntry> parseManifest(JSONObject manifest) throws JSONException {
            if (manifest.optInt("schemaVersion", -1) != 1) {
                throw new JSONException("Unsupported Foliate asset manifest schema");
            }

            final JSONArray declaredAssets = manifest.optJSONArray("assets");
            if (declaredAssets == null) {
                throw new JSONException("Foliate asset manifest has no assets");
            }

            final Map<String, AssetEntry> parsed = new LinkedHashMap<>();
            for (int index = 0; index < declaredAssets.length(); index++) {
                final JSONObject asset = declaredAssets.optJSONObject(index);
                if (asset == null) {
                    throw new JSONException("Foliate asset manifest entry is not an object");
                }

                final String path = asset.optString("path", "");
                final String hash = asset.optString("sha256", "").toLowerCase(Locale.ROOT);
                final long size = asset.optLong("size", -1);
                final String source = asset.optString("source", "");
                final String category = asset.optString("category", "");
                final Mime mime = parseExplicitMime(asset.optString("mimeType", ""));
                if (!isCanonicalManifestPath(path)
                        || !hash.matches("[0-9a-f]{64}")
                        || size < 0
                        || mime == null
                        || parsed.put(path, new AssetEntry(
                                path, hash, size, source, category, mime.type, mime.charset)) != null) {
                    throw new JSONException("Foliate asset manifest entry is ambiguous");
                }
            }
            return Collections.unmodifiableMap(parsed);
        }

        private static @Nullable String loadHostCsp(
                AssetManager assetManager, Map<String, AssetEntry> assets) {
            final AssetEntry hostDocument = assets.get(HOST_DOCUMENT_PATH);
            if (hostDocument == null
                    || !"native-host-document".equals(hostDocument.category)
                    || !hostDocument.source.endsWith(HOST_CSP_VERSION)) {
                return null;
            }
            try (InputStream stream = assetManager.open(hostDocument.path)) {
                final byte[] bytes = readBytes(stream);
                if (bytes.length != hostDocument.size
                        || !hostDocument.sha256.equals(sha256(bytes))) {
                    return null;
                }
                return extractInitialHostCsp(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
            } catch (IOException | NoSuchAlgorithmException exception) {
                return null;
            }
        }

        private static @Nullable String extractInitialHostCsp(String html) {
            int cursor = 0;
            while (true) {
                final int meta = html.indexOf("<meta", cursor);
                if (meta < 0) {
                    return null;
                }
                final int end = html.indexOf('>', meta);
                if (end < 0) {
                    return null;
                }
                final String tag = html.substring(meta, end + 1);
                if (tag.contains("http-equiv=\"Content-Security-Policy\"")) {
                    final String prefix = "content=\"";
                    final int contentStart = tag.indexOf(prefix);
                    if (contentStart < 0) {
                        return null;
                    }
                    final int valueStart = contentStart + prefix.length();
                    final int valueEnd = tag.indexOf('"', valueStart);
                    if (valueEnd < 0 || valueEnd == valueStart) {
                        return null;
                    }
                    return tag.substring(valueStart, valueEnd);
                }
                cursor = end + 1;
            }
        }

        private byte[] readAndVerifyAsset(AssetEntry entry)
                throws IOException, NoSuchAlgorithmException {
            try (InputStream stream = assetManager.open(entry.path)) {
                final byte[] bytes = readBytes(stream);
                if (bytes.length != entry.size || !entry.sha256.equals(sha256(bytes))) {
                    throw new IOException("Foliate asset does not match manifest");
                }
                return bytes;
            }
        }

        private static boolean isExactEncodedAssetPath(Uri uri) {
            final String encodedPath = uri.getEncodedPath();
            final String decodedPath = uri.getPath();
            if (encodedPath == null
                    || decodedPath == null
                    || !encodedPath.startsWith(PATH_PREFIX)
                    || !decodedPath.startsWith(PATH_PREFIX)) {
                return false;
            }
            final String suffix = encodedPath.substring(PATH_PREFIX.length());
            // Encoded path input is never decoded: %2f, %2e, or percent-encoded Unicode must not
            // become a valid manifest path after URI parsing.
            return isCanonicalManifestPath(suffix)
                    && suffix.equals(decodedPath.substring(PATH_PREFIX.length()));
        }

        private static boolean isCanonicalManifestPath(String path) {
            if (path == null || path.isEmpty() || path.startsWith("/") || path.endsWith("/")) {
                return false;
            }
            for (int index = 0; index < path.length(); index++) {
                final char character = path.charAt(index);
                if (character > 0x7f
                        || !(Character.isLetterOrDigit(character)
                        || character == '/'
                        || character == '.'
                        || character == '_'
                        || character == '-')) {
                    return false;
                }
            }
            for (String segment : path.split("/", -1)) {
                if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) {
                    return false;
                }
            }
            return true;
        }

        private static @Nullable Mime parseExplicitMime(String manifestValue) {
            final int separator = manifestValue.indexOf(';');
            final String type = separator < 0 ? manifestValue : manifestValue.substring(0, separator);
            final String parameters = separator < 0 ? "" : manifestValue.substring(separator);
            if (!type.matches("[a-z]+/[a-z0-9.+-]+")
                    || (!parameters.isEmpty() && !"; charset=utf-8".equals(parameters))) {
                return null;
            }
            return new Mime(type, parameters.isEmpty() ? null : "UTF-8");
        }

        private static WebResourceResponse response(
                String mimeType,
                @Nullable String charset,
                int statusCode,
                String reasonPhrase,
                byte[] body,
                String csp) {
            final Map<String, String> headers = new HashMap<>();
            headers.put("Content-Security-Policy", csp);
            headers.put("X-Content-Type-Options", "nosniff");
            return new WebResourceResponse(
                    mimeType,
                    charset,
                    statusCode,
                    reasonPhrase,
                    headers,
                    new ByteArrayInputStream(body));
        }

        private static String readUtf8(InputStream stream) throws IOException {
            return new String(readBytes(stream), java.nio.charset.StandardCharsets.UTF_8);
        }

        private static byte[] readBytes(InputStream stream) throws IOException {
            final ByteArrayOutputStream output = new ByteArrayOutputStream();
            final byte[] buffer = new byte[8192];
            int read;
            while ((read = stream.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }

        private static String sha256(byte[] bytes) throws NoSuchAlgorithmException {
            final byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            final StringBuilder hash = new StringBuilder(digest.length * 2);
            for (byte value : digest) {
                hash.append(String.format(Locale.ROOT, "%02x", value));
            }
            return hash.toString();
        }

        static final class AssetEntry {
            final String path;
            final String sha256;
            final long size;
            final String source;
            final String category;
            final String mimeType;
            final @Nullable String charset;

            AssetEntry(
                    String path,
                    String sha256,
                    long size,
                    String source,
                    String category,
                    String mimeType,
                    @Nullable String charset) {
                this.path = path;
                this.sha256 = sha256;
                this.size = size;
                this.source = source;
                this.category = category;
                this.mimeType = mimeType;
                this.charset = charset;
            }
        }

        private static final class Mime {
            final String type;
            final @Nullable String charset;

            Mime(String type, @Nullable String charset) {
                this.type = type;
                this.charset = charset;
            }
        }
    }
}
