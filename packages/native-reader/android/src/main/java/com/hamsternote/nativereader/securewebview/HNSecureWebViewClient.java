package com.hamsternote.nativereader.securewebview;

import android.annotation.TargetApi;
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
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import androidx.core.util.Pair;

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
import java.io.File;

public class HNSecureWebViewClient extends WebViewClient {
    private static String TAG = "HNSecureWebViewClient";
    protected static final int SHOULD_OVERRIDE_URL_LOADING_TIMEOUT = 250;

    protected boolean mLastLoadFailed = false;
    protected HNSecureWebView.ProgressChangedFilter progressChangedFilter = null;
    protected @Nullable HNSecureBasicAuthCredential basicAuthCredential = null;

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

            reactWebView.callInjectedJavaScript();

            emitFinishEvent(webView, url);
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
      reactWebView.callInjectedJavaScriptBeforeContentLoaded();
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return shouldOverrideUrlLoadingForMainFrame(view, url);
    }

    private boolean shouldOverrideUrlLoadingForMainFrame(WebView view, String url) {
        final HNSecureWebView rncWebView = (HNSecureWebView) view;
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

    @TargetApi(Build.VERSION_CODES.N)
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        final HNSecureWebView rncWebView = (HNSecureWebView) view;
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
        if (rncWebView.getFailClosedOnShouldStartLoadWithRequest()
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

        // In case of an error JS side expect to get a finish event first, and then get an error event
        // Android WebView does it in the opposite way, so we need to simulate that behavior
        emitFinishEvent(webView, failingUrl);

        WritableMap eventData = createWebViewEvent(webView, failingUrl);
        eventData.putDouble("code", errorCode);
        eventData.putString("description", description);

        int reactTag = HNSecureWebViewWrapper.getReactTagFromWebView(webView);
        UIManagerHelper.getEventDispatcherForReactTag((ReactContext) webView.getContext(), reactTag).dispatchEvent(new TopLoadingErrorEvent(reactTag, eventData));
    }

    @RequiresApi(api = Build.VERSION_CODES.M)
    @Override
    public void onReceivedHttpError(
            WebView webView,
            WebResourceRequest request,
            WebResourceResponse errorResponse) {
        super.onReceivedHttpError(webView, request, errorResponse);

        if (request.isForMainFrame()) {
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
}