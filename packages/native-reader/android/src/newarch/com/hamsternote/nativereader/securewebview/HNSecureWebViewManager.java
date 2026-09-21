package com.hamsternote.nativereader.securewebview;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.common.MapBuilder;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.ViewGroupManager;
import com.facebook.react.uimanager.ViewManagerDelegate;
import com.facebook.react.uimanager.annotations.ReactProp;
import com.facebook.react.viewmanagers.HNSecureWebViewManagerDelegate;
import com.facebook.react.viewmanagers.HNSecureWebViewManagerInterface;
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

import android.webkit.WebChromeClient;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Map;

@ReactModule(name = HNSecureWebViewManagerImpl.NAME)
public class HNSecureWebViewManager extends ViewGroupManager<HNSecureWebViewWrapper>
        implements HNSecureWebViewManagerInterface<HNSecureWebViewWrapper> {

    private final ViewManagerDelegate<HNSecureWebViewWrapper> mDelegate;
    private final HNSecureWebViewManagerImpl mHNSecureWebViewManagerImpl;

    public HNSecureWebViewManager() {
        mDelegate = new HNSecureWebViewManagerDelegate<>(this);
        mHNSecureWebViewManagerImpl = new HNSecureWebViewManagerImpl(true);
    }

    @Nullable
    @Override
    protected ViewManagerDelegate<HNSecureWebViewWrapper> getDelegate() {
        return mDelegate;
    }

    @NonNull
    @Override
    public String getName() {
        return HNSecureWebViewManagerImpl.NAME;
    }

    @NonNull
    @Override
    protected HNSecureWebViewWrapper createViewInstance(@NonNull ThemedReactContext context) {
        return mHNSecureWebViewManagerImpl.createViewInstance(context);
    }

    @Override
    @ReactProp(name = "allowFileAccess")
    public void setAllowFileAccess(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setAllowFileAccess(view, value);
    }

    @Override
    @ReactProp(name = "allowFileAccessFromFileURLs")
    public void setAllowFileAccessFromFileURLs(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setAllowFileAccessFromFileURLs(view, value);

    }

    @Override
    @ReactProp(name = "allowUniversalAccessFromFileURLs")
    public void setAllowUniversalAccessFromFileURLs(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setAllowUniversalAccessFromFileURLs(view, value);
    }

    @Override
    @ReactProp(name = "allowsFullscreenVideo")
    public void setAllowsFullscreenVideo(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setAllowsFullscreenVideo(view, value);
    }

    @Override
    @ReactProp(name = "allowsProtectedMedia")
    public void setAllowsProtectedMedia(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setAllowsProtectedMedia(view, value);
    }

    @Override
    @ReactProp(name = "androidLayerType")
    public void setAndroidLayerType(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setAndroidLayerType(view, value);
    }

    @Override
    @ReactProp(name = "applicationNameForUserAgent")
    public void setApplicationNameForUserAgent(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setApplicationNameForUserAgent(view, value);
    }

    @Override
    @ReactProp(name = "basicAuthCredential")
    public void setBasicAuthCredential(HNSecureWebViewWrapper view, @Nullable ReadableMap value) {
        mHNSecureWebViewManagerImpl.setBasicAuthCredential(view, value);
    }

    @Override
    @ReactProp(name = "cacheEnabled")
    public void setCacheEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setCacheEnabled(view, value);
    }

    @Override
    @ReactProp(name = "cacheMode")
    public void setCacheMode(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setCacheMode(view, value);
    }

    @Override
    @ReactProp(name = "domStorageEnabled")
    public void setDomStorageEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setDomStorageEnabled(view, value);
    }

    @Override
    @ReactProp(name = "downloadingMessage")
    public void setDownloadingMessage(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setDownloadingMessage(value);
    }

    @Override
    @ReactProp(name = "forceDarkOn")
    public void setForceDarkOn(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setForceDarkOn(view, value);
    }

    @Override
    @ReactProp(name = "geolocationEnabled")
    public void setGeolocationEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setGeolocationEnabled(view, value);
    }

    @Override
    @ReactProp(name = "hasOnScroll")
    public void setHasOnScroll(HNSecureWebViewWrapper view, boolean hasScrollEvent) {
        mHNSecureWebViewManagerImpl.setHasOnScroll(view, hasScrollEvent);
    }

    @Override
    @ReactProp(name = "incognito")
    public void setIncognito(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setIncognito(view, value);
    }

    @Override
    @ReactProp(name = "injectedJavaScript")
    public void setInjectedJavaScript(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setInjectedJavaScript(view, value);
    }

    @Override
    @ReactProp(name = "injectedJavaScriptBeforeContentLoaded")
    public void setInjectedJavaScriptBeforeContentLoaded(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setInjectedJavaScriptBeforeContentLoaded(view, value);
    }

    @Override
    @ReactProp(name = "injectedJavaScriptForMainFrameOnly")
    public void setInjectedJavaScriptForMainFrameOnly(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setInjectedJavaScriptForMainFrameOnly(view, value);

    }

    @Override
    @ReactProp(name = "injectedJavaScriptBeforeContentLoadedForMainFrameOnly")
    public void setInjectedJavaScriptBeforeContentLoadedForMainFrameOnly(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setInjectedJavaScriptBeforeContentLoadedForMainFrameOnly(view, value);

    }

    @ReactProp(name = "injectedJavaScriptObject")
    public void setInjectedJavaScriptObject(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setInjectedJavaScriptObject(view, value);
    }

    @Override
    @ReactProp(name = "javaScriptCanOpenWindowsAutomatically")
    public void setJavaScriptCanOpenWindowsAutomatically(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setJavaScriptCanOpenWindowsAutomatically(view, value);
    }

    @ReactProp(name = "javaScriptEnabled")
    public void setJavaScriptEnabled(HNSecureWebViewWrapper view, boolean enabled) {
        mHNSecureWebViewManagerImpl.setJavaScriptEnabled(view, enabled);
    }

    @Override
    @ReactProp(name = "lackPermissionToDownloadMessage")
    public void setLackPermissionToDownloadMessage(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setLackPermissionToDownloadMessage(value);
    }

    @Override
    @ReactProp(name = "hasOnOpenWindowEvent")
    public void setHasOnOpenWindowEvent(HNSecureWebViewWrapper view, boolean hasEvent) {
        mHNSecureWebViewManagerImpl.setHasOnOpenWindowEvent(view, hasEvent);
    }

    @Override
    @ReactProp(name = "mediaPlaybackRequiresUserAction")
    public void setMediaPlaybackRequiresUserAction(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setMediaPlaybackRequiresUserAction(view, value);
    }

    @Override
    @ReactProp(name = "menuItems")
    public void setMenuItems(HNSecureWebViewWrapper view, @Nullable ReadableArray items) {
        mHNSecureWebViewManagerImpl.setMenuCustomItems(view, items);
    }

    @Override
    @ReactProp(name = "suppressMenuItems")
    public void setSuppressMenuItems(HNSecureWebViewWrapper view, @Nullable ReadableArray items) {}

    @Override
    @ReactProp(name = "messagingEnabled")
    public void setMessagingEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setMessagingEnabled(view, value);
    }

    @Override
    @ReactProp(name = "failClosedOnShouldStartLoadWithRequest", defaultBoolean = false)
    public void setFailClosedOnShouldStartLoadWithRequest(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setFailClosedOnShouldStartLoadWithRequest(view, value);
    }

    @Override
    @ReactProp(name = "messagingModuleName")
    public void setMessagingModuleName(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setMessagingModuleName(view, value);
    }

    @Override
    @ReactProp(name = "minimumFontSize")
    public void setMinimumFontSize(HNSecureWebViewWrapper view, int value) {
        mHNSecureWebViewManagerImpl.setMinimumFontSize(view, value);
    }

    @Override
    @ReactProp(name = "mixedContentMode")
    public void setMixedContentMode(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setMixedContentMode(view, value);
    }

    @Override
    @ReactProp(name = "nestedScrollEnabled")
    public void setNestedScrollEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setNestedScrollEnabled(view, value);
    }

    @Override
    @ReactProp(name = "overScrollMode")
    public void setOverScrollMode(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setOverScrollMode(view, value);
    }

    @Override
    @ReactProp(name = "saveFormDataDisabled")
    public void setSaveFormDataDisabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setSaveFormDataDisabled(view, value);
    }

    @Override
    @ReactProp(name = "scalesPageToFit")
    public void setScalesPageToFit(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setScalesPageToFit(view, value);
    }

    @Override
    @ReactProp(name = "setBuiltInZoomControls")
    public void setSetBuiltInZoomControls(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setSetBuiltInZoomControls(view, value);
    }

    @Override
    @ReactProp(name = "setDisplayZoomControls")
    public void setSetDisplayZoomControls(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setSetDisplayZoomControls(view, value);
    }

    @Override
    @ReactProp(name = "setSupportMultipleWindows")
    public void setSetSupportMultipleWindows(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setSetSupportMultipleWindows(view, value);
    }

    @Override
    @ReactProp(name = "showsHorizontalScrollIndicator")
    public void setShowsHorizontalScrollIndicator(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setShowsHorizontalScrollIndicator(view, value);
    }

    @Override
    @ReactProp(name = "showsVerticalScrollIndicator")
    public void setShowsVerticalScrollIndicator(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setShowsVerticalScrollIndicator(view, value);
    }

    @Override
    @ReactProp(name = "newSource")
    public void setNewSource(HNSecureWebViewWrapper view, @Nullable ReadableMap value) {
        mHNSecureWebViewManagerImpl.setSource(view, value);
    }

    @Override
    @ReactProp(name = "textZoom")
    public void setTextZoom(HNSecureWebViewWrapper view, int value) {
        mHNSecureWebViewManagerImpl.setTextZoom(view, value);
    }

    @Override
    @ReactProp(name = "thirdPartyCookiesEnabled")
    public void setThirdPartyCookiesEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setThirdPartyCookiesEnabled(view, value);
    }

    @Override
    @ReactProp(name = "webviewDebuggingEnabled")
    public void setWebviewDebuggingEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setWebviewDebuggingEnabled(view, value);
    }

    @Override
    @ReactProp(name = "paymentRequestEnabled")
    public void setPaymentRequestEnabled(HNSecureWebViewWrapper view, boolean value) {
        mHNSecureWebViewManagerImpl.setPaymentRequestEnabled(view, value);
    }

    /* iOS PROPS - no implemented here */
    @Override
    public void setAllowingReadAccessToURL(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setAllowingReadAccessToURL(view, value);
    }

    @Override
    public void setAllowsBackForwardNavigationGestures(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setAllowsInlineMediaPlayback(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setAllowsPictureInPictureMediaPlayback(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setAllowsAirPlayForMediaPlayback(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setAllowsLinkPreview(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setAutomaticallyAdjustContentInsets(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setAutoManageStatusBarEnabled(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setBounces(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setContentInset(HNSecureWebViewWrapper view, @Nullable ReadableMap value) {}

    @Override
    public void setContentInsetAdjustmentBehavior(HNSecureWebViewWrapper view, @Nullable String value) {}

    @Override
    public void setContentMode(HNSecureWebViewWrapper view, @Nullable String value) {}

    @Override
    public void setDataDetectorTypes(HNSecureWebViewWrapper view, @Nullable ReadableArray value) {}

    @Override
    public void setDecelerationRate(HNSecureWebViewWrapper view, double value) {}

    @Override
    public void setDirectionalLockEnabled(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setEnableApplePay(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setHideKeyboardAccessoryView(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setKeyboardDisplayRequiresUserAction(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setPagingEnabled(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setPullToRefreshEnabled(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setRefreshControlLightMode(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setIndicatorStyle(HNSecureWebViewWrapper view, @Nullable String value) {}

    @Override
    public void setScrollEnabled(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setSharedCookiesEnabled(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setUseSharedProcessPool(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setLimitsNavigationsToAppBoundDomains(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setTextInteractionEnabled(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setHasOnFileDownload(HNSecureWebViewWrapper view, boolean value) {}

    @Override
    public void setMediaCapturePermissionGrantType(HNSecureWebViewWrapper view, @Nullable String value) {}

    @Override
    public void setFraudulentWebsiteWarningEnabled(HNSecureWebViewWrapper view, boolean value) {}
    /* !iOS PROPS - no implemented here */

    @Override
    @ReactProp(name = "userAgent")
    public void setUserAgent(HNSecureWebViewWrapper view, @Nullable String value) {
        mHNSecureWebViewManagerImpl.setUserAgent(view, value);
    }

  @Override
  public void goBack(HNSecureWebViewWrapper view) {
    view.getWebView().goBack();
  }

  @Override
  public void goForward(HNSecureWebViewWrapper view) {
    view.getWebView().goForward();
  }

  @Override
  public void reload(HNSecureWebViewWrapper view) {
    view.getWebView().reload();
  }

  @Override
  public void stopLoading(HNSecureWebViewWrapper view) {
    view.getWebView().stopLoading();
  }

  @Override
  public void injectJavaScript(HNSecureWebViewWrapper view, String javascript) {
      view.getWebView().evaluateJavascriptWithFallback(javascript);
  }

  @Override
  public void requestFocus(HNSecureWebViewWrapper view) {
      view.requestFocus();
  }

  @Override
  public void postMessage(HNSecureWebViewWrapper view, String data) {
      try {
        JSONObject eventInitDict = new JSONObject();
        eventInitDict.put("data", data);
        view.getWebView().evaluateJavascriptWithFallback(
          "(function () {" +
            "var event;" +
            "var data = " + eventInitDict.toString() + ";" +
            "try {" +
            "event = new MessageEvent('message', data);" +
            "} catch (e) {" +
            "event = document.createEvent('MessageEvent');" +
            "event.initMessageEvent('message', true, true, data.data, data.origin, data.lastEventId, data.source);" +
            "}" +
            "document.dispatchEvent(event);" +
            "})();"
        );
      } catch (JSONException e) {
        throw  new RuntimeException(e);
      }
  }

  @Override
  public void loadUrl(HNSecureWebViewWrapper view, String url) {
      view.getWebView().loadUrl(url);
  }

  @Override
  public void clearFormData(HNSecureWebViewWrapper view) {
      view.getWebView().clearFormData();
  }

  @Override
  public void clearCache(HNSecureWebViewWrapper view, boolean includeDiskFiles) {
      view.getWebView().clearCache(includeDiskFiles);
  }

  @Override
  public void clearHistory(HNSecureWebViewWrapper view) {
      view.getWebView().clearHistory();
  }

  @Override
    protected void addEventEmitters(@NonNull ThemedReactContext reactContext, HNSecureWebViewWrapper view) {
        // Do not register default touch emitter and let WebView implementation handle touches
        view.getWebView().setWebViewClient(new HNSecureWebViewClient());
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