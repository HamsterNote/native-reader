#import <React/RCTUIManager.h>

#import "RCTConvert+WKDataDetectorTypes.h"
#import "HNSecureWebViewManager.h"
#import "HNSecureWebViewImpl.h"

#if TARGET_OS_OSX
#define RNCView NSView
@class NSView;
#else
#define RNCView UIView
@class UIView;
#endif  // TARGET_OS_OSX

@implementation RCTConvert (HNSecureWKWebView)
#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 130000 /* iOS 13 */
+ (WKContentMode)HNSecureWKContentMode:(id)json
{
  static NSDictionary *mapping;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    mapping = @{
      @"recommended": @(WKContentModeRecommended),
      @"mobile": @(WKContentModeMobile),
      @"desktop": @(WKContentModeDesktop),
    };
  });
  return (WKContentMode)[RCTConvertEnumValue(
      "WKContentMode", mapping, @(WKContentModeRecommended), json) integerValue];
}
#endif

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 150000 /* iOS 15 */
+ (HNSecureWebViewPermissionGrantType)HNSecureWebViewPrivatePermissionGrantType:(id)json
{
  static NSDictionary *mapping;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    mapping = @{
      @"grantIfSameHostElsePrompt": @(HNSecureWebViewPermissionGrantType_GrantIfSameHost_ElsePrompt),
      @"grantIfSameHostElseDeny": @(HNSecureWebViewPermissionGrantType_GrantIfSameHost_ElseDeny),
      @"deny": @(HNSecureWebViewPermissionGrantType_Deny),
      @"grant": @(HNSecureWebViewPermissionGrantType_Grant),
      @"prompt": @(HNSecureWebViewPermissionGrantType_Prompt),
    };
  });
  return (HNSecureWebViewPermissionGrantType)[RCTConvertEnumValue(
      "HNSecureWebViewPermissionGrantType", mapping,
      @(HNSecureWebViewPermissionGrantType_Prompt), json) integerValue];
}
#endif
@end

@implementation HNSecureWebViewManager

RCT_EXPORT_MODULE(HNSecureWebView)

- (RNCView *)view
{
  return [[HNSecureWebViewImpl alloc] init];
}

RCT_EXPORT_VIEW_PROPERTY(source, NSDictionary)
// New arch only
RCT_CUSTOM_VIEW_PROPERTY(newSource, NSDictionary, HNSecureWebViewImpl) {}
RCT_EXPORT_VIEW_PROPERTY(onFileDownload, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onLoadingStart, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onLoadingFinish, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onLoadingError, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onLoadingProgress, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onHttpError, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onShouldStartLoadWithRequest, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(failClosedOnShouldStartLoadWithRequest, BOOL)
RCT_EXPORT_VIEW_PROPERTY(onContentProcessDidTerminate, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onOpenWindow, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(injectedJavaScript, NSString)
RCT_EXPORT_VIEW_PROPERTY(injectedJavaScriptBeforeContentLoaded, NSString)
RCT_EXPORT_VIEW_PROPERTY(injectedJavaScriptForMainFrameOnly, BOOL)
RCT_EXPORT_VIEW_PROPERTY(injectedJavaScriptBeforeContentLoadedForMainFrameOnly, BOOL)
RCT_EXPORT_VIEW_PROPERTY(injectedJavaScriptObject, NSString)
RCT_EXPORT_VIEW_PROPERTY(javaScriptEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(javaScriptCanOpenWindowsAutomatically, BOOL)
RCT_EXPORT_VIEW_PROPERTY(allowFileAccessFromFileURLs, BOOL)
RCT_EXPORT_VIEW_PROPERTY(allowUniversalAccessFromFileURLs, BOOL)
RCT_EXPORT_VIEW_PROPERTY(allowsInlineMediaPlayback, BOOL)
RCT_EXPORT_VIEW_PROPERTY(allowsPictureInPictureMediaPlayback, BOOL)
RCT_EXPORT_VIEW_PROPERTY(webviewDebuggingEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(allowsAirPlayForMediaPlayback, BOOL)
RCT_EXPORT_VIEW_PROPERTY(mediaPlaybackRequiresUserAction, BOOL)
RCT_CUSTOM_VIEW_PROPERTY(dataDetectorTypes, WKDataDetectorTypes, HNSecureWebViewImpl) { view.dataDetectorTypes = json ? [RCTConvert HNSecureWKDataDetectorTypes:json] : defaultView.dataDetectorTypes; }
RCT_EXPORT_VIEW_PROPERTY(contentInset, UIEdgeInsets)
RCT_EXPORT_VIEW_PROPERTY(automaticallyAdjustContentInsets, BOOL)
RCT_EXPORT_VIEW_PROPERTY(autoManageStatusBarEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(hideKeyboardAccessoryView, BOOL)
RCT_EXPORT_VIEW_PROPERTY(allowsBackForwardNavigationGestures, BOOL)
RCT_EXPORT_VIEW_PROPERTY(incognito, BOOL)
RCT_EXPORT_VIEW_PROPERTY(pagingEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(applicationNameForUserAgent, NSString)
RCT_EXPORT_VIEW_PROPERTY(cacheEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(allowsLinkPreview, BOOL)
RCT_EXPORT_VIEW_PROPERTY(allowingReadAccessToURL, NSString)
RCT_EXPORT_VIEW_PROPERTY(basicAuthCredential, NSDictionary)

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 110000 /* __IPHONE_11_0 */
RCT_EXPORT_VIEW_PROPERTY(contentInsetAdjustmentBehavior, UIScrollViewContentInsetAdjustmentBehavior)
#endif
#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 130000 /* __IPHONE_13_0 */
RCT_EXPORT_VIEW_PROPERTY(automaticallyAdjustsScrollIndicatorInsets, BOOL)
#endif

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 130000 /* iOS 13 */
RCT_CUSTOM_VIEW_PROPERTY(contentMode, WKContentMode, HNSecureWebViewImpl) { view.contentMode = json ? [RCTConvert HNSecureWKContentMode:json] : defaultView.contentMode; }
#endif

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 140000 /* iOS 14 */
RCT_EXPORT_VIEW_PROPERTY(limitsNavigationsToAppBoundDomains, BOOL)
#endif

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 140500 /* iOS 14.5 */
RCT_EXPORT_VIEW_PROPERTY(textInteractionEnabled, BOOL)
#endif

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 150000 /* iOS 15 */
RCT_CUSTOM_VIEW_PROPERTY(mediaCapturePermissionGrantType, HNSecureWebViewPermissionGrantType, HNSecureWebViewImpl) { view.mediaCapturePermissionGrantType = json ? [RCTConvert HNSecureWebViewPrivatePermissionGrantType:json] : defaultView.mediaCapturePermissionGrantType; }
#endif

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 130000 /* iOS 13 */
RCT_EXPORT_VIEW_PROPERTY(fraudulentWebsiteWarningEnabled, BOOL)
#endif

/**
 * Expose methods to enable messaging the webview.
 */
RCT_EXPORT_VIEW_PROPERTY(messagingEnabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(onMessage, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onScroll, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(enableApplePay, BOOL)
RCT_EXPORT_VIEW_PROPERTY(menuItems, NSArray);
RCT_EXPORT_VIEW_PROPERTY(suppressMenuItems, NSArray);

// New arch only
RCT_CUSTOM_VIEW_PROPERTY(hasOnFileDownload, BOOL, HNSecureWebViewImpl) {}
RCT_CUSTOM_VIEW_PROPERTY(hasOnOpenWindowEvent, BOOL, HNSecureWebViewImpl) {}

RCT_EXPORT_VIEW_PROPERTY(onCustomMenuSelection, RCTDirectEventBlock)
RCT_CUSTOM_VIEW_PROPERTY(pullToRefreshEnabled, BOOL, HNSecureWebViewImpl) {
  view.pullToRefreshEnabled = json == nil ? false : [RCTConvert BOOL: json];
}
RCT_CUSTOM_VIEW_PROPERTY(refreshControlLightMode, BOOL, HNSecureWebViewImpl) {
    view.refreshControlLightMode = json == nil ? false : [RCTConvert BOOL: json];
}

RCT_CUSTOM_VIEW_PROPERTY(bounces, BOOL, HNSecureWebViewImpl) {
  view.bounces = json == nil ? true : [RCTConvert BOOL: json];
}

RCT_CUSTOM_VIEW_PROPERTY(useSharedProcessPool, BOOL, HNSecureWebViewImpl) {
  view.useSharedProcessPool = json == nil ? true : [RCTConvert BOOL: json];
}

RCT_CUSTOM_VIEW_PROPERTY(userAgent, NSString, HNSecureWebViewImpl) {
  view.userAgent = [RCTConvert NSString: json];
}

RCT_CUSTOM_VIEW_PROPERTY(scrollEnabled, BOOL, HNSecureWebViewImpl) {
  view.scrollEnabled = json == nil ? true : [RCTConvert BOOL: json];
}

RCT_CUSTOM_VIEW_PROPERTY(sharedCookiesEnabled, BOOL, HNSecureWebViewImpl) {
  view.sharedCookiesEnabled = json == nil ? false : [RCTConvert BOOL: json];
}

#if !TARGET_OS_OSX
RCT_CUSTOM_VIEW_PROPERTY(decelerationRate, CGFloat, HNSecureWebViewImpl) {
  view.decelerationRate = json == nil ? UIScrollViewDecelerationRateNormal : [RCTConvert CGFloat: json];
}
#endif // !TARGET_OS_OSX

RCT_CUSTOM_VIEW_PROPERTY(directionalLockEnabled, BOOL, HNSecureWebViewImpl) {
  view.directionalLockEnabled = json == nil ? true : [RCTConvert BOOL: json];
}

RCT_CUSTOM_VIEW_PROPERTY(showsHorizontalScrollIndicator, BOOL, HNSecureWebViewImpl) {
  view.showsHorizontalScrollIndicator = json == nil ? true : [RCTConvert BOOL: json];
}

RCT_CUSTOM_VIEW_PROPERTY(showsVerticalScrollIndicator, BOOL, HNSecureWebViewImpl) {
  view.showsVerticalScrollIndicator = json == nil ? true : [RCTConvert BOOL: json];
}

RCT_CUSTOM_VIEW_PROPERTY(indicatorStyle, NSString, HNSecureWebViewImpl) {
  view.indicatorStyle = [RCTConvert NSString: json];
}

RCT_CUSTOM_VIEW_PROPERTY(keyboardDisplayRequiresUserAction, BOOL, HNSecureWebViewImpl) {
  view.keyboardDisplayRequiresUserAction = json == nil ? true : [RCTConvert BOOL: json];
}

#if !TARGET_OS_OSX
    #define BASE_VIEW_PER_OS() UIView
#else
    #define BASE_VIEW_PER_OS() NSView
#endif

#define QUICK_RCT_EXPORT_COMMAND_METHOD(name)                                                                                           \
RCT_EXPORT_METHOD(name:(nonnull NSNumber *)reactTag)                                                                                    \
{                                                                                                                                       \
[self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *uiManager, NSDictionary<NSNumber *, BASE_VIEW_PER_OS() *> *viewRegistry) {   \
    HNSecureWebViewImpl *view = (HNSecureWebViewImpl *)viewRegistry[reactTag];                                                                    \
    if (![view isKindOfClass:[HNSecureWebViewImpl class]]) {                                                                                 \
      RCTLogError(@"Invalid view returned from registry, expecting HNSecureWebView, got: %@", view);                                         \
    } else {                                                                                                                            \
      [view name];                                                                                                                      \
    }                                                                                                                                   \
  }];                                                                                                                                   \
}
#define QUICK_RCT_EXPORT_COMMAND_METHOD_PARAMS(name, in_param, out_param)                                                               \
RCT_EXPORT_METHOD(name:(nonnull NSNumber *)reactTag in_param)                                                                           \
{                                                                                                                                       \
[self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *uiManager, NSDictionary<NSNumber *, BASE_VIEW_PER_OS() *> *viewRegistry) {   \
    HNSecureWebViewImpl *view = (HNSecureWebViewImpl *)viewRegistry[reactTag];                                                                    \
    if (![view isKindOfClass:[HNSecureWebViewImpl class]]) {                                                                                 \
      RCTLogError(@"Invalid view returned from registry, expecting HNSecureWebView, got: %@", view);                                         \
    } else {                                                                                                                            \
      [view name:out_param];                                                                                                            \
    }                                                                                                                                   \
  }];                                                                                                                                   \
}

QUICK_RCT_EXPORT_COMMAND_METHOD(reload)
QUICK_RCT_EXPORT_COMMAND_METHOD(goBack)
QUICK_RCT_EXPORT_COMMAND_METHOD(goForward)
QUICK_RCT_EXPORT_COMMAND_METHOD(stopLoading)
QUICK_RCT_EXPORT_COMMAND_METHOD(requestFocus)

QUICK_RCT_EXPORT_COMMAND_METHOD_PARAMS(postMessage, message:(NSString *)message, message)
QUICK_RCT_EXPORT_COMMAND_METHOD_PARAMS(injectJavaScript, script:(NSString *)script, script)
QUICK_RCT_EXPORT_COMMAND_METHOD_PARAMS(clearCache, includeDiskFiles:(BOOL)includeDiskFiles, includeDiskFiles)

@end
