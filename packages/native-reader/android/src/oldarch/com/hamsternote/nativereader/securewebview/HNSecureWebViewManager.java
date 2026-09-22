package com.hamsternote.nativereader.securewebview;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.common.MapBuilder;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.ViewGroupManager;
import com.facebook.react.uimanager.annotations.ReactProp;
import com.facebook.react.views.scroll.ScrollEventType;
import com.hamsternote.nativereader.securewebview.events.TopCustomMenuSelectionEvent;
import com.hamsternote.nativereader.securewebview.events.SubResourceErrorEvent;
import com.hamsternote.nativereader.securewebview.events.TopHttpErrorEvent;
import com.hamsternote.nativereader.securewebview.events.TopLoadingErrorEvent;
import com.hamsternote.nativereader.securewebview.events.TopLoadingFinishEvent;
import com.hamsternote.nativereader.securewebview.events.TopLoadingProgressEvent;
import com.hamsternote.nativereader.securewebview.events.TopLoadingStartEvent;
import com.hamsternote.nativereader.securewebview.events.TopMessageEvent;
import com.hamsternote.nativereader.securewebview.events.TopOpenWindowEvent;
import com.hamsternote.nativereader.securewebview.events.TopRenderProcessGoneEvent;
import com.hamsternote.nativereader.securewebview.events.TopShouldStartLoadWithRequestEvent;

import java.util.Map;

public class HNSecureWebViewManager extends ViewGroupManager<HNSecureWebViewWrapper> {

    private final HNSecureWebViewManagerImpl mHNSecureWebViewManagerImpl;

    public HNSecureWebViewManager() {
        mHNSecureWebViewManagerImpl = new HNSecureWebViewManagerImpl();
    }

    @Override
    public String getName() {
        return HNSecureWebViewManagerImpl.NAME;
    }

    @Override
    public HNSecureWebViewWrapper createViewInstance(ThemedReactContext context) {
        return mHNSecureWebViewManagerImpl.createViewInstance(context);
    }

    public HNSecureWebViewWrapper createViewInstance(ThemedReactContext context, HNSecureWebView view) {
      return mHNSecureWebViewManagerImpl.createViewInstance(context, view);
    }

    @ReactProp(name = "allowFileAccess")
    public void setAllowFileAccess(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setAllowFileAccess(view, value);
    }

    @ReactProp(name = "allowFileAccessFromFileURLs")
    public void setAllowFileAccessFromFileURLs(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setAllowFileAccessFromFileURLs(view, value);

    }

    @ReactProp(name = "allowUniversalAccessFromFileURLs")
    public void setAllowUniversalAccessFromFileURLs(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setAllowUniversalAccessFromFileURLs(view, value);
    }

    @ReactProp(name = "allowsFullscreenVideo")
    public void setAllowsFullscreenVideo(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setAllowsFullscreenVideo(view, value);
    }

    @ReactProp(name = "allowsProtectedMedia")
    public void setAllowsProtectedMedia(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setAllowsProtectedMedia(view, value);
    }

    @ReactProp(name = "androidLayerType")
    public void setAndroidLayerType(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setAndroidLayerType(view, value);
    }

    @ReactProp(name = "applicationNameForUserAgent")
    public void setApplicationNameForUserAgent(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setApplicationNameForUserAgent(view, value);
    }

    @ReactProp(name = "basicAuthCredential")
    public void setBasicAuthCredential(HNSecureWebViewWrapper view, @Nullable ReadableMap value) {
        mHNSecureWebViewManagerImpl.setBasicAuthCredential(view, value);
    }

    @ReactProp(name = "cacheEnabled")
    public void setCacheEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setCacheEnabled(view, value);
    }

    @ReactProp(name = "cacheMode")
    public void setCacheMode(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setCacheMode(view, value);
    }

    @ReactProp(name = "domStorageEnabled")
    public void setDomStorageEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setDomStorageEnabled(view, value);
    }

    @ReactProp(name = "downloadingMessage")
    public void setDownloadingMessage(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setDownloadingMessage(value);
    }

    @ReactProp(name = "forceDarkOn")
    public void setForceDarkOn(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setForceDarkOn(view, value);
    }

    @ReactProp(name = "geolocationEnabled")
    public void setGeolocationEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setGeolocationEnabled(view, value);
    }

    @ReactProp(name = "hasOnScroll")
    public void setHasOnScroll(HNSecureWebViewWrapper view, boolean hasScrollEvent) {
        mHNSecureWebViewManagerImpl.setHasOnScroll(view, hasScrollEvent);
    }

    @ReactProp(name = "incognito")
    public void setIncognito(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setIncognito(view, value);
    }

    @ReactProp(name = "injectedJavaScript")
    public void setInjectedJavaScript(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setInjectedJavaScript(view, value);
    }

    @ReactProp(name = "injectedJavaScriptBeforeContentLoaded")
    public void setInjectedJavaScriptBeforeContentLoaded(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setInjectedJavaScriptBeforeContentLoaded(view, value);
    }

    @ReactProp(name = "injectedJavaScriptForMainFrameOnly")
    public void setInjectedJavaScriptForMainFrameOnly(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setInjectedJavaScriptForMainFrameOnly(view, value);

    }

    @ReactProp(name = "injectedJavaScriptBeforeContentLoadedForMainFrameOnly")
    public void setInjectedJavaScriptBeforeContentLoadedForMainFrameOnly(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setInjectedJavaScriptBeforeContentLoadedForMainFrameOnly(view, value);

    }

    @ReactProp(name = "injectedJavaScriptObject")
    public void setInjectedJavaScriptObject(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setInjectedJavaScriptObject(view, value);
    }

    @ReactProp(name = "javaScriptCanOpenWindowsAutomatically")
    public void setJavaScriptCanOpenWindowsAutomatically(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setJavaScriptCanOpenWindowsAutomatically(view, value);
    }

    @ReactProp(name = "javaScriptEnabled")
    public void setJavaScriptEnabled(HNSecureWebViewWrapper view, boolean enabled) {
        mHNSecureWebViewManagerImpl.setJavaScriptEnabled(view, enabled);
    }

    @ReactProp(name = "lackPermissionToDownloadMessage")
    public void setLackPermissionToDownloadMessage(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setLackPermissionToDownloadMessage(value);
    }

    @ReactProp(name = "hasOnOpenWindowEvent")
    public void setHasOnOpenWindowEvent(HNSecureWebViewWrapper view, boolean hasEvent) {
        mHNSecureWebViewManagerImpl.setHasOnOpenWindowEvent(view, hasEvent);
    }

    @ReactProp(name = "mediaPlaybackRequiresUserAction")
    public void setMediaPlaybackRequiresUserAction(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setMediaPlaybackRequiresUserAction(view, value);
    }

    @ReactProp(name = "messagingEnabled")
    public void setMessagingEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setMessagingEnabled(view, value);
    }

    @ReactProp(name = "failClosedOnShouldStartLoadWithRequest", defaultBoolean = false)
    public void setFailClosedOnShouldStartLoadWithRequest(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setFailClosedOnShouldStartLoadWithRequest(view, value);
    }

    @ReactProp(name = "allowingReadAccessToURL")
    public void setAllowingReadAccessToURL(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setAllowingReadAccessToURL(view, value);
    }

    @ReactProp(name = "menuItems")
    public void setMenuCustomItems(HNSecureWebViewWrapper view, @Nullable ReadableArray items) {
        mHNSecureWebViewManagerImpl.setMenuCustomItems(view, items);
    }

    @ReactProp(name = "messagingModuleName")
    public void setMessagingModuleName(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setMessagingModuleName(view, value);
    }

    @ReactProp(name = "minimumFontSize")
    public void setMinimumFontSize(HNSecureWebViewWrapper view, int value) {
        mHNSecureWebViewManagerImpl.setMinimumFontSize(view, value);
    }

    @ReactProp(name = "mixedContentMode")
    public void setMixedContentMode(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setMixedContentMode(view, value);
    }

    @ReactProp(name = "nestedScrollEnabled")
    public void setNestedScrollEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setNestedScrollEnabled(view, value);
    }

    @ReactProp(name = "overScrollMode")
    public void setOverScrollMode(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setOverScrollMode(view, value);
    }

    @ReactProp(name = "saveFormDataDisabled")
    public void setSaveFormDataDisabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setSaveFormDataDisabled(view, value);
    }

    @ReactProp(name = "scalesPageToFit")
    public void setScalesPageToFit(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setScalesPageToFit(view, value);
    }

    @ReactProp(name = "setBuiltInZoomControls")
    public void setSetBuiltInZoomControls(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setSetBuiltInZoomControls(view, value);
    }

    @ReactProp(name = "setDisplayZoomControls")
    public void setSetDisplayZoomControls(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setSetDisplayZoomControls(view, value);
    }

    @ReactProp(name = "setSupportMultipleWindows")
    public void setSetSupportMultipleWindows(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setSetSupportMultipleWindows(view, value);
    }

    @ReactProp(name = "showsHorizontalScrollIndicator")
    public void setShowsHorizontalScrollIndicator(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setShowsHorizontalScrollIndicator(view, value);
    }

    @ReactProp(name = "showsVerticalScrollIndicator")
    public void setShowsVerticalScrollIndicator(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setShowsVerticalScrollIndicator(view, value);
    }

    @ReactProp(name = "source")
    public void setSource(HNSecureWebViewWrapper view, @Nullable ReadableMap value) {
        mHNSecureWebViewManagerImpl.setSource(view, value);
    }

    @ReactProp(name = "textZoom")
    public void setTextZoom(HNSecureWebViewWrapper view, int value) {
        mHNSecureWebViewManagerImpl.setTextZoom(view, value);
    }

    @ReactProp(name = "thirdPartyCookiesEnabled")
    public void setThirdPartyCookiesEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setThirdPartyCookiesEnabled(view, value);
    }

    @ReactProp(name = "webviewDebuggingEnabled")
    public void setWebviewDebuggingEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setWebviewDebuggingEnabled(view, value);
    }

    @ReactProp(name = "userAgent")
    public void setUserAgent(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setUserAgent(view, value);
    }

    @ReactProp(name = "paymentRequestEnabled")
    public void setPaymentRequestEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setPaymentRequestEnabled(view, value);
    }

    @Override
    protected void addEventEmitters(@NonNull ThemedReactContext reactContext, HNSecureWebViewWrapper viewWrapper) {
        // Do not register default touch emitter and let WebView implementation handle touches
        viewWrapper.getWebView().setWebViewClient(new HNSecureWebViewClient());
    }

    @Override
    public Map<String, Object> getExportedCustomDirectEventTypeConstants() {
        Map<String, Object> export = super.getExportedCustomDirectEventTypeConstants();
        if (export == null) {
            export = MapBuilder.newHashMap();
        }
        // Default events but adding them here explicitly for clarity
        export.put(TopLoadingStartEvent.EVENT_NAME, MapBuilder.of("registrationName", "onLoadingStart"));
        export.put(TopLoadingFinishEvent.EVENT_NAME, MapBuilder.of("registrationName", "onLoadingFinish"));
        export.put(TopLoadingErrorEvent.EVENT_NAME, MapBuilder.of("registrationName", "onLoadingError"));
        export.put(SubResourceErrorEvent.EVENT_NAME, MapBuilder.of("registrationName", "onLoadingSubResourceError"));
        export.put(TopMessageEvent.EVENT_NAME, MapBuilder.of("registrationName", "onMessage"));
        // !Default events but adding them here explicitly for clarity

        export.put(TopLoadingProgressEvent.EVENT_NAME, MapBuilder.of("registrationName", "onLoadingProgress"));
        export.put(TopShouldStartLoadWithRequestEvent.EVENT_NAME, MapBuilder.of("registrationName", "onShouldStartLoadWithRequest"));
        export.put(ScrollEventType.getJSEventName(ScrollEventType.SCROLL), MapBuilder.of("registrationName", "onScroll"));
        export.put(TopHttpErrorEvent.EVENT_NAME, MapBuilder.of("registrationName", "onHttpError"));
        export.put(TopRenderProcessGoneEvent.EVENT_NAME, MapBuilder.of("registrationName", "onRenderProcessGone"));
        export.put(TopCustomMenuSelectionEvent.EVENT_NAME, MapBuilder.of("registrationName", "onCustomMenuSelection"));
        export.put(TopOpenWindowEvent.EVENT_NAME, MapBuilder.of("registrationName", "onOpenWindow"));
        return export;
    }

    @Override
    public @Nullable
    Map<String, Integer> getCommandsMap() {
        return mHNSecureWebViewManagerImpl.getCommandsMap();
    }

    @Override
    public void receiveCommand(@NonNull HNSecureWebViewWrapper reactWebView, String commandId, @Nullable ReadableArray args) {
        mHNSecureWebViewManagerImpl.receiveCommand(reactWebView, commandId, args);
        super.receiveCommand(reactWebView, commandId, args);
    }

    @Override
    protected void onAfterUpdateTransaction(@NonNull HNSecureWebViewWrapper view) {
        super.onAfterUpdateTransaction(view);
        mHNSecureWebViewManagerImpl.onAfterUpdateTransaction(view);
    }

    @Override
    public void onDropViewInstance(@NonNull HNSecureWebViewWrapper view) {
        mHNSecureWebViewManagerImpl.onDropViewInstance(view);
        super.onDropViewInstance(view);
    }
}