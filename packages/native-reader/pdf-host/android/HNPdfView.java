package com.hamsternote.nativereader.securewebview;

import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.facebook.react.uimanager.ThemedReactContext;

/** Static-host checkpoint: no source property, bridge or publication read API. */
final class HNPdfView extends WebView {
    private volatile HNPdfAssets assets;
    private volatile boolean retired;

    HNPdfView(ThemedReactContext context) {
        super(context);
        final WebSettings settings = getSettings();
        settings.setJavaScriptEnabled(true);
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
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                final HNPdfAssets current = assets;
                if (retired || !"GET".equals(request.getMethod()) || current == null
                        || (request.isForMainFrame() && !HNPdfAssets.HOST.equals(request.getUrl().toString())))
                    return HNPdfAssets.deny();
                return current.intercept(request.getUrl());
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
                if (!HNPdfAssets.HOST.equals(url)) retire();
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); retire();
            }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                retire(); return true;
            }
        });
        try {
            assets = new HNPdfAssets(name -> context.getAssets().open(name));
            loadUrl(HNPdfAssets.HOST);
        } catch (Exception invalidRuntime) { retire(); }
    }

    void retire() {
        if (retired) return;
        retired = true;
        assets = null;
        stopLoading();
        setWebChromeClient(null);
        removeAllViews();
        destroy();
    }
}
