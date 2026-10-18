// This guard prevent the code from being compiled in the old architecture
#ifdef RCT_NEW_ARCH_ENABLED
#import "HNSecureWebView.h"
#import "HNSecureWebViewImpl.h"

#import <react/renderer/components/HNSecureWebViewSpec/ComponentDescriptors.h>
#import <react/renderer/components/HNSecureWebViewSpec/EventEmitters.h>
#import <react/renderer/components/HNSecureWebViewSpec/Props.h>
#import <react/renderer/components/HNSecureWebViewSpec/RCTComponentViewHelpers.h>

#import <React/RCTFabricComponentsPlugins.h>

using namespace facebook::react;

namespace {
auto stringToOnShouldStartLoadWithRequestNavigationTypeEnum(std::string value) {
    if (value == "click") return HNSecureWebViewEventEmitter::OnShouldStartLoadWithRequestNavigationType::Click;
    if (value == "formsubmit") return HNSecureWebViewEventEmitter::OnShouldStartLoadWithRequestNavigationType::Formsubmit;
    if (value == "backforward") return HNSecureWebViewEventEmitter::OnShouldStartLoadWithRequestNavigationType::Backforward;
    if (value == "reload") return HNSecureWebViewEventEmitter::OnShouldStartLoadWithRequestNavigationType::Reload;
    if (value == "formresubmit") return HNSecureWebViewEventEmitter::OnShouldStartLoadWithRequestNavigationType::Formresubmit;
    return HNSecureWebViewEventEmitter::OnShouldStartLoadWithRequestNavigationType::Other;
}

auto stringToOnLoadingStartNavigationTypeEnum(std::string value) {
    if (value == "click") return HNSecureWebViewEventEmitter::OnLoadingStartNavigationType::Click;
    if (value == "formsubmit") return HNSecureWebViewEventEmitter::OnLoadingStartNavigationType::Formsubmit;
    if (value == "backforward") return HNSecureWebViewEventEmitter::OnLoadingStartNavigationType::Backforward;
    if (value == "reload") return HNSecureWebViewEventEmitter::OnLoadingStartNavigationType::Reload;
    if (value == "formresubmit") return HNSecureWebViewEventEmitter::OnLoadingStartNavigationType::Formresubmit;
    return HNSecureWebViewEventEmitter::OnLoadingStartNavigationType::Other;
}

auto stringToOnLoadingFinishNavigationTypeEnum(std::string value) {
    if (value == "click") return HNSecureWebViewEventEmitter::OnLoadingFinishNavigationType::Click;
    if (value == "formsubmit") return HNSecureWebViewEventEmitter::OnLoadingFinishNavigationType::Formsubmit;
    if (value == "backforward") return HNSecureWebViewEventEmitter::OnLoadingFinishNavigationType::Backforward;
    if (value == "reload") return HNSecureWebViewEventEmitter::OnLoadingFinishNavigationType::Reload;
    if (value == "formresubmit") return HNSecureWebViewEventEmitter::OnLoadingFinishNavigationType::Formresubmit;
    return HNSecureWebViewEventEmitter::OnLoadingFinishNavigationType::Other;
}

static inline std::string nullSafeString(id value) {
    if (![value isKindOfClass:[NSString class]]) {
        return std::string();
    }

    const char *utf8String = [static_cast<NSString *>(value) UTF8String];
    return utf8String ? std::string(utf8String) : std::string();
}

static inline std::string nullSafeStringWithLength(id value) {
    if (![value isKindOfClass:[NSString class]]) {
        return std::string();
    }

    NSString *stringValue = static_cast<NSString *>(value);
    const char *utf8String = [stringValue UTF8String];
    size_t length = [stringValue lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
    return utf8String ? std::string(utf8String, length) : std::string();
}
} // namespace

@interface HNSecureWebView () <RCTHNSecureWebViewViewProtocol>

@end

@implementation HNSecureWebView {
    HNSecureWebViewImpl * _view;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
    return concreteComponentDescriptorProvider<HNSecureWebViewComponentDescriptor>();
}

#if !TARGET_OS_OSX
// Reproduce the idea from here: https://github.com/facebook/react-native/blob/8bd3edec88148d0ab1f225d2119435681fbbba33/React/Fabric/Mounting/ComponentViews/InputAccessory/RCTInputAccessoryComponentView.mm#L142
- (void)prepareForRecycle {
    [super prepareForRecycle];
    [_view destroyWebView];
}
#endif // !TARGET_OS_OSX

// Needed because of this: https://github.com/facebook/react-native/pull/37274
+ (void)load
{
  [super load];
}

- (instancetype)initWithFrame:(CGRect)frame
{
    if (self = [super initWithFrame:frame]) {
        static const auto defaultProps = std::make_shared<const HNSecureWebViewProps>();
        _props = defaultProps;

        _view = [[HNSecureWebViewImpl alloc] init];

        _view.onShouldStartLoadWithRequest = [self](NSDictionary* dictionary) {
            if (_eventEmitter) {
                auto webViewEventEmitter = std::static_pointer_cast<HNSecureWebViewEventEmitter const>(_eventEmitter);
                facebook::react::HNSecureWebViewEventEmitter::OnShouldStartLoadWithRequest data = {
                    .url = nullSafeString([dictionary valueForKey:@"url"]),
                    .lockIdentifier = [[dictionary valueForKey:@"lockIdentifier"] doubleValue],
                    .title = nullSafeString([dictionary valueForKey:@"title"]),
                    .navigationType = stringToOnShouldStartLoadWithRequestNavigationTypeEnum(nullSafeString([dictionary valueForKey:@"navigationType"])),
                    .canGoBack = static_cast<bool>([[dictionary valueForKey:@"canGoBack"] boolValue]),
                    .canGoForward = static_cast<bool>([[dictionary valueForKey:@"canGoForward"] boolValue]),
                    .isTopFrame = static_cast<bool>([[dictionary valueForKey:@"isTopFrame"] boolValue]),
                    .hasTargetFrame = static_cast<bool>([[dictionary valueForKey:@"hasTargetFrame"] boolValue]),
                    .loading = static_cast<bool>([[dictionary valueForKey:@"loading"] boolValue]),
                    .mainDocumentURL = nullSafeString([dictionary valueForKey:@"mainDocumentURL"])
                };
                webViewEventEmitter->onShouldStartLoadWithRequest(data);
            };
        };
        _view.onLoadingStart = [self](NSDictionary* dictionary) {
            if (_eventEmitter) {
                auto webViewEventEmitter = std::static_pointer_cast<HNSecureWebViewEventEmitter const>(_eventEmitter);
                facebook::react::HNSecureWebViewEventEmitter::OnLoadingStart data = {
                    .url = nullSafeString([dictionary valueForKey:@"url"]),
                    .lockIdentifier = [[dictionary valueForKey:@"lockIdentifier"] doubleValue],
                    .title = nullSafeString([dictionary valueForKey:@"title"]),
                    .navigationType = stringToOnLoadingStartNavigationTypeEnum(nullSafeString([dictionary valueForKey:@"navigationType"])),
                    .canGoBack = static_cast<bool>([[dictionary valueForKey:@"canGoBack"] boolValue]),
                    .canGoForward = static_cast<bool>([[dictionary valueForKey:@"canGoForward"] boolValue]),
                    .loading = static_cast<bool>([[dictionary valueForKey:@"loading"] boolValue]),
                    .mainDocumentURL = nullSafeStringWithLength([dictionary valueForKey:@"mainDocumentURL"])
                };
                webViewEventEmitter->onLoadingStart(data);
            }
        };
        _view.onLoadingError = [self](NSDictionary* dictionary) {
            if (_eventEmitter) {
                auto webViewEventEmitter = std::static_pointer_cast<HNSecureWebViewEventEmitter const>(_eventEmitter);
                facebook::react::HNSecureWebViewEventEmitter::OnLoadingError data = {
                    .url = nullSafeString([dictionary valueForKey:@"url"]),
                    .lockIdentifier = [[dictionary valueForKey:@"lockIdentifier"] doubleValue],
                    .title = nullSafeString([dictionary valueForKey:@"title"]),
                    .code = [[dictionary valueForKey:@"code"] intValue],
                    .description = nullSafeString([dictionary valueForKey:@"description"]),
                    .canGoBack = static_cast<bool>([[dictionary valueForKey:@"canGoBack"] boolValue]),
                    .canGoForward = static_cast<bool>([[dictionary valueForKey:@"canGoForward"] boolValue]),
                    .loading = static_cast<bool>([[dictionary valueForKey:@"loading"] boolValue]),
                    .domain = nullSafeString([dictionary valueForKey:@"domain"])
                };
                webViewEventEmitter->onLoadingError(data);
            }
        };
        _view.onMessage = [self](NSDictionary* dictionary) {
            if (_eventEmitter) {
                auto webViewEventEmitter = std::static_pointer_cast<HNSecureWebViewEventEmitter const>(_eventEmitter);
                facebook::react::HNSecureWebViewEventEmitter::OnMessage data = {
                    .url = nullSafeString([dictionary valueForKey:@"url"]),
                    .lockIdentifier = [[dictionary valueForKey:@"lockIdentifier"] doubleValue],
                    .title = nullSafeString([dictionary valueForKey:@"title"]),
                    .canGoBack = static_cast<bool>([[dictionary valueForKey:@"canGoBack"] boolValue]),
                    .canGoForward = static_cast<bool>([[dictionary valueForKey:@"canGoForward"] boolValue]),
                    .loading = static_cast<bool>([[dictionary valueForKey:@"loading"] boolValue]),
                    .data = nullSafeString([dictionary valueForKey:@"data"])
                };
                webViewEventEmitter->onMessage(data);
            }
        };
        _view.onLoadingFinish = [self](NSDictionary* dictionary) {
            if (_eventEmitter) {
                auto webViewEventEmitter = std::static_pointer_cast<HNSecureWebViewEventEmitter const>(_eventEmitter);
                facebook::react::HNSecureWebViewEventEmitter::OnLoadingFinish data = {
                    .url = nullSafeString([dictionary valueForKey:@"url"]),
                    .lockIdentifier = [[dictionary valueForKey:@"lockIdentifier"] doubleValue],
                    .title = nullSafeString([dictionary valueForKey:@"title"]),
                    .navigationType = stringToOnLoadingFinishNavigationTypeEnum(nullSafeStringWithLength([dictionary valueForKey:@"navigationType"])),
                    .canGoBack = static_cast<bool>([[dictionary valueForKey:@"canGoBack"] boolValue]),
                    .canGoForward = static_cast<bool>([[dictionary valueForKey:@"canGoForward"] boolValue]),
                    .loading = static_cast<bool>([[dictionary valueForKey:@"loading"] boolValue]),
                    .mainDocumentURL = nullSafeStringWithLength([dictionary valueForKey:@"mainDocumentURL"])
                };
                webViewEventEmitter->onLoadingFinish(data);
            }
        };
        _view.onLoadingProgress = [self](NSDictionary* dictionary) {
            if (_eventEmitter) {
                auto webViewEventEmitter = std::static_pointer_cast<HNSecureWebViewEventEmitter const>(_eventEmitter);
                facebook::react::HNSecureWebViewEventEmitter::OnLoadingProgress data = {
                    .url = nullSafeString([dictionary valueForKey:@"url"]),
                    .lockIdentifier = [[dictionary valueForKey:@"lockIdentifier"] doubleValue],
                    .title = nullSafeString([dictionary valueForKey:@"title"]),
                    .canGoBack = static_cast<bool>([[dictionary valueForKey:@"canGoBack"] boolValue]),
                    .canGoForward = static_cast<bool>([[dictionary valueForKey:@"canGoForward"] boolValue]),
                    .loading = static_cast<bool>([[dictionary valueForKey:@"loading"] boolValue]),
                    .progress = [[dictionary valueForKey:@"progress"] doubleValue]
                };
                webViewEventEmitter->onLoadingProgress(data);
            }
        };
        _view.onContentProcessDidTerminate = [self](NSDictionary* dictionary) {
            if (_eventEmitter) {
                auto webViewEventEmitter = std::static_pointer_cast<HNSecureWebViewEventEmitter const>(_eventEmitter);
                facebook::react::HNSecureWebViewEventEmitter::OnContentProcessDidTerminate data = {
                    .url = nullSafeString([dictionary valueForKey:@"url"]),
                    .lockIdentifier = [[dictionary valueForKey:@"lockIdentifier"] doubleValue],
                    .title = nullSafeString([dictionary valueForKey:@"title"]),
                    .canGoBack = static_cast<bool>([[dictionary valueForKey:@"canGoBack"] boolValue]),
                    .canGoForward = static_cast<bool>([[dictionary valueForKey:@"canGoForward"] boolValue]),
                    .loading = static_cast<bool>([[dictionary valueForKey:@"loading"] boolValue])
                };
                webViewEventEmitter->onContentProcessDidTerminate(data);
            }
        };
        _view.onCustomMenuSelection = [self](NSDictionary* dictionary) {
            if (_eventEmitter) {
                auto webViewEventEmitter = std::static_pointer_cast<HNSecureWebViewEventEmitter const>(_eventEmitter);
                facebook::react::HNSecureWebViewEventEmitter::OnCustomMenuSelection data = {
                    .selectedText = nullSafeString([dictionary valueForKey:@"selectedText"]),
                    .key = nullSafeString([dictionary valueForKey:@"key"]),
                    .label = nullSafeString([dictionary valueForKey:@"label"])

                };
                webViewEventEmitter->onCustomMenuSelection(data);
            }
        };
        _view.onScroll = [self](NSDictionary* dictionary) {
            if (_eventEmitter) {
                NSDictionary* contentOffset = [dictionary valueForKey:@"contentOffset"];
                NSDictionary* contentInset = [dictionary valueForKey:@"contentInset"];
                NSDictionary* contentSize = [dictionary valueForKey:@"contentSize"];
                NSDictionary* layoutMeasurement = [dictionary valueForKey:@"layoutMeasurement"];
                double zoomScale = [[dictionary valueForKey:@"zoomScale"] doubleValue];

                auto webViewEventEmitter = std::static_pointer_cast<HNSecureWebViewEventEmitter const>(_eventEmitter);
                facebook::react::HNSecureWebViewEventEmitter::OnScroll data = {
                    .contentOffset = {
                        .x = [[contentOffset valueForKey:@"x"] doubleValue],
                        .y = [[contentOffset valueForKey:@"y"] doubleValue]
                    },
                    .contentInset = {
                        .left = [[contentInset valueForKey:@"left"] doubleValue],
                        .right = [[contentInset valueForKey:@"right"] doubleValue],
                        .top = [[contentInset valueForKey:@"top"] doubleValue],
                        .bottom = [[contentInset valueForKey:@"bottom"] doubleValue]
                    },
                    .contentSize = {
                        .width = [[contentSize valueForKey:@"width"] doubleValue],
                        .height = [[contentSize valueForKey:@"height"] doubleValue]
                    },
                    .layoutMeasurement = {
                        .width = [[layoutMeasurement valueForKey:@"width"] doubleValue],
                        .height = [[layoutMeasurement valueForKey:@"height"] doubleValue]                    },
                    .zoomScale = zoomScale
                };
                webViewEventEmitter->onScroll(data);
            }
        };
        _view.onHttpError = [self](NSDictionary* dictionary) {
            if (_eventEmitter) {
                auto webViewEventEmitter = std::static_pointer_cast<HNSecureWebViewEventEmitter const>(_eventEmitter);
                facebook::react::HNSecureWebViewEventEmitter::OnHttpError data = {
                    .url = nullSafeString([dictionary valueForKey:@"url"]),
                    .lockIdentifier = [[dictionary valueForKey:@"lockIdentifier"] doubleValue],
                    .title = nullSafeString([dictionary valueForKey:@"title"]),
                    .statusCode = [[dictionary valueForKey:@"statusCode"] intValue],
                    .description = nullSafeString([dictionary valueForKey:@"description"]),
                    .canGoBack = static_cast<bool>([[dictionary valueForKey:@"canGoBack"] boolValue]),
                    .canGoForward = static_cast<bool>([[dictionary valueForKey:@"canGoForward"] boolValue]),
                    .loading = static_cast<bool>([[dictionary valueForKey:@"loading"] boolValue])
                };
                webViewEventEmitter->onHttpError(data);
            }
        };
        self.contentView = _view;
    }
    return self;
}

- (void)updateEventEmitter:(EventEmitter::Shared const &)eventEmitter
{
    [super updateEventEmitter:eventEmitter];
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
    const auto &oldViewProps = *std::static_pointer_cast<HNSecureWebViewProps const>(_props);
    const auto &newViewProps = *std::static_pointer_cast<HNSecureWebViewProps const>(props);

#define REMAP_WEBVIEW_PROP(name)                    \
    if (oldViewProps.name != newViewProps.name) {   \
        _view.name = newViewProps.name;             \
    }

#define REMAP_WEBVIEW_STRING_PROP(name)                             \
    if (oldViewProps.name != newViewProps.name) {                   \
        _view.name = RCTNSStringFromString(newViewProps.name);      \
    }

    REMAP_WEBVIEW_PROP(scrollEnabled)
    REMAP_WEBVIEW_STRING_PROP(injectedJavaScript)
    REMAP_WEBVIEW_STRING_PROP(injectedJavaScriptBeforeContentLoaded)
    REMAP_WEBVIEW_PROP(injectedJavaScriptForMainFrameOnly)
    REMAP_WEBVIEW_PROP(injectedJavaScriptBeforeContentLoadedForMainFrameOnly)
    REMAP_WEBVIEW_STRING_PROP(injectedJavaScriptObject)
    REMAP_WEBVIEW_PROP(javaScriptEnabled)
    REMAP_WEBVIEW_PROP(javaScriptCanOpenWindowsAutomatically)
    REMAP_WEBVIEW_PROP(allowFileAccessFromFileURLs)
    REMAP_WEBVIEW_PROP(allowUniversalAccessFromFileURLs)
    REMAP_WEBVIEW_PROP(allowsInlineMediaPlayback)
    REMAP_WEBVIEW_PROP(allowsPictureInPictureMediaPlayback)
    REMAP_WEBVIEW_PROP(webviewDebuggingEnabled)
    REMAP_WEBVIEW_PROP(allowsAirPlayForMediaPlayback)
    REMAP_WEBVIEW_PROP(mediaPlaybackRequiresUserAction)
    REMAP_WEBVIEW_PROP(automaticallyAdjustContentInsets)
    REMAP_WEBVIEW_PROP(autoManageStatusBarEnabled)
    REMAP_WEBVIEW_PROP(hideKeyboardAccessoryView)
    REMAP_WEBVIEW_PROP(allowsBackForwardNavigationGestures)
    REMAP_WEBVIEW_PROP(incognito)
    REMAP_WEBVIEW_PROP(pagingEnabled)
    REMAP_WEBVIEW_STRING_PROP(applicationNameForUserAgent)
    REMAP_WEBVIEW_PROP(cacheEnabled)
    REMAP_WEBVIEW_PROP(allowsLinkPreview)
    REMAP_WEBVIEW_STRING_PROP(allowingReadAccessToURL)
    REMAP_WEBVIEW_PROP(messagingEnabled)
    REMAP_WEBVIEW_PROP(failClosedOnShouldStartLoadWithRequest)
    #if !TARGET_OS_OSX
    REMAP_WEBVIEW_PROP(fraudulentWebsiteWarningEnabled)
    #endif // !TARGET_OS_OSX
    REMAP_WEBVIEW_PROP(enableApplePay)
    REMAP_WEBVIEW_PROP(pullToRefreshEnabled)
    REMAP_WEBVIEW_PROP(refreshControlLightMode)
    REMAP_WEBVIEW_PROP(bounces)
    REMAP_WEBVIEW_PROP(useSharedProcessPool)
    REMAP_WEBVIEW_STRING_PROP(userAgent)
    REMAP_WEBVIEW_PROP(sharedCookiesEnabled)
    #if !TARGET_OS_OSX
    REMAP_WEBVIEW_PROP(decelerationRate)
    #endif // !TARGET_OS_OSX
    REMAP_WEBVIEW_PROP(directionalLockEnabled)
    REMAP_WEBVIEW_PROP(showsHorizontalScrollIndicator)
    REMAP_WEBVIEW_PROP(showsVerticalScrollIndicator)
    REMAP_WEBVIEW_PROP(keyboardDisplayRequiresUserAction)

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 130000 /* __IPHONE_13_0 */
    REMAP_WEBVIEW_PROP(automaticallyAdjustContentInsets)
#endif
#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 140000 /* iOS 14 */
    REMAP_WEBVIEW_PROP(limitsNavigationsToAppBoundDomains)
#endif
#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 140500 /* iOS 14.5 */
    REMAP_WEBVIEW_PROP(textInteractionEnabled)
#endif

#if !TARGET_OS_OSX
    if (oldViewProps.dataDetectorTypes != newViewProps.dataDetectorTypes) {
        WKDataDetectorTypes dataDetectorTypes = WKDataDetectorTypeNone;
            if (dataDetectorTypes & HNSecureWebViewDataDetectorTypes::Address) {
                dataDetectorTypes |= WKDataDetectorTypeAddress;
            } else if (dataDetectorTypes & HNSecureWebViewDataDetectorTypes::Link) {
                dataDetectorTypes |= WKDataDetectorTypeLink;
            } else if (dataDetectorTypes & HNSecureWebViewDataDetectorTypes::CalendarEvent) {
                dataDetectorTypes |= WKDataDetectorTypeCalendarEvent;
            } else if (dataDetectorTypes & HNSecureWebViewDataDetectorTypes::TrackingNumber) {
                dataDetectorTypes |= WKDataDetectorTypeTrackingNumber;
            } else if (dataDetectorTypes & HNSecureWebViewDataDetectorTypes::FlightNumber) {
                dataDetectorTypes |= WKDataDetectorTypeFlightNumber;
            } else if (dataDetectorTypes & HNSecureWebViewDataDetectorTypes::LookupSuggestion) {
                dataDetectorTypes |= WKDataDetectorTypeLookupSuggestion;
            } else if (dataDetectorTypes & HNSecureWebViewDataDetectorTypes::PhoneNumber) {
                dataDetectorTypes |= WKDataDetectorTypePhoneNumber;
            } else if (dataDetectorTypes & HNSecureWebViewDataDetectorTypes::All) {
                dataDetectorTypes |= WKDataDetectorTypeAll;
            } else if (dataDetectorTypes & HNSecureWebViewDataDetectorTypes::None) {
                dataDetectorTypes = WKDataDetectorTypeNone;
        }
        [_view setDataDetectorTypes:dataDetectorTypes];
    }
#endif // !TARGET_OS_OSX

    if (oldViewProps.contentInset.top != newViewProps.contentInset.top || oldViewProps.contentInset.left != newViewProps.contentInset.left || oldViewProps.contentInset.right != newViewProps.contentInset.right || oldViewProps.contentInset.bottom != newViewProps.contentInset.bottom) {
        UIEdgeInsets edgesInsets = {
            .top = newViewProps.contentInset.top,
            .left = newViewProps.contentInset.left,
            .right = newViewProps.contentInset.right,
            .bottom = newViewProps.contentInset.bottom
        };
        [_view setContentInset: edgesInsets];
    }

    if (oldViewProps.basicAuthCredential.username != newViewProps.basicAuthCredential.username || oldViewProps.basicAuthCredential.password != newViewProps.basicAuthCredential.password) {
        [_view setBasicAuthCredential: @{
            @"username": RCTNSStringFromString(newViewProps.basicAuthCredential.username),
            @"password": RCTNSStringFromString(newViewProps.basicAuthCredential.password)
        }];
    }

#if !TARGET_OS_OSX
    if (oldViewProps.contentInsetAdjustmentBehavior != newViewProps.contentInsetAdjustmentBehavior) {
        if (newViewProps.contentInsetAdjustmentBehavior == HNSecureWebViewContentInsetAdjustmentBehavior::Never) {
            [_view setContentInsetAdjustmentBehavior: UIScrollViewContentInsetAdjustmentNever];
        } else if (newViewProps.contentInsetAdjustmentBehavior == HNSecureWebViewContentInsetAdjustmentBehavior::Automatic) {
            [_view setContentInsetAdjustmentBehavior: UIScrollViewContentInsetAdjustmentAutomatic];
        } else if (newViewProps.contentInsetAdjustmentBehavior == HNSecureWebViewContentInsetAdjustmentBehavior::ScrollableAxes) {
            [_view setContentInsetAdjustmentBehavior: UIScrollViewContentInsetAdjustmentScrollableAxes];
        } else if (newViewProps.contentInsetAdjustmentBehavior == HNSecureWebViewContentInsetAdjustmentBehavior::Always) {
            [_view setContentInsetAdjustmentBehavior: UIScrollViewContentInsetAdjustmentAlways];
        }
    }
#endif // !TARGET_OS_OSX

    if (oldViewProps.menuItems != newViewProps.menuItems) {
        NSMutableArray *newMenuItems = [NSMutableArray array];

        for (const auto &menuItem: newViewProps.menuItems) {
            [newMenuItems addObject:@{
                @"key": RCTNSStringFromString(menuItem.key),
                @"label": RCTNSStringFromString(menuItem.label),
            }];

        }
        [_view setMenuItems:newMenuItems];
    }
    if(oldViewProps.suppressMenuItems != newViewProps.suppressMenuItems) {
        NSMutableArray *suppressMenuItems = [NSMutableArray array];

        for (const auto &menuItem: newViewProps.suppressMenuItems) {
            [suppressMenuItems addObject: RCTNSStringFromString(menuItem)];
        }

        [_view setSuppressMenuItems:suppressMenuItems];
    }
    if (oldViewProps.hasOnFileDownload != newViewProps.hasOnFileDownload) {
        if (newViewProps.hasOnFileDownload) {
            _view.onFileDownload = [self](NSDictionary* dictionary) {
                if (_eventEmitter) {
                    auto webViewEventEmitter = std::static_pointer_cast<HNSecureWebViewEventEmitter const>(_eventEmitter);
                    facebook::react::HNSecureWebViewEventEmitter::OnFileDownload data = {
                        .downloadUrl = nullSafeString([dictionary valueForKey:@"downloadUrl"])
                    };
                    webViewEventEmitter->onFileDownload(data);
                }
            };
        } else {
            _view.onFileDownload = nil;
        }
    }
    if (oldViewProps.hasOnOpenWindowEvent != newViewProps.hasOnOpenWindowEvent) {
        if (newViewProps.hasOnOpenWindowEvent) {
            _view.onOpenWindow = [self](NSDictionary* dictionary) {
                if (_eventEmitter) {
                    auto webViewEventEmitter = std::static_pointer_cast<HNSecureWebViewEventEmitter const>(_eventEmitter);
                    facebook::react::HNSecureWebViewEventEmitter::OnOpenWindow data = {
                        .targetUrl = nullSafeString([dictionary valueForKey:@"targetUrl"])
                    };
                    webViewEventEmitter->onOpenWindow(data);
                }
            };
        } else {
            _view.onOpenWindow = nil;
        }
    }
//
#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 130000 /* iOS 13 */
    if (oldViewProps.contentMode != newViewProps.contentMode) {
        if (newViewProps.contentMode == HNSecureWebViewContentMode::Recommended) {
            [_view setContentMode: WKContentModeRecommended];
        } else if (newViewProps.contentMode == HNSecureWebViewContentMode::Mobile) {
            [_view setContentMode:WKContentModeMobile];
        } else if (newViewProps.contentMode == HNSecureWebViewContentMode::Desktop) {
            [_view setContentMode:WKContentModeDesktop];
        }
    }
#endif

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 150000 /* iOS 15 */
    if (oldViewProps.mediaCapturePermissionGrantType != newViewProps.mediaCapturePermissionGrantType) {
        if (newViewProps.mediaCapturePermissionGrantType == HNSecureWebViewMediaCapturePermissionGrantType::Prompt) {
            [_view setMediaCapturePermissionGrantType:HNSecureWebViewPermissionGrantType_Prompt];
        } else if (newViewProps.mediaCapturePermissionGrantType == HNSecureWebViewMediaCapturePermissionGrantType::Grant) {
            [_view setMediaCapturePermissionGrantType:HNSecureWebViewPermissionGrantType_Grant];
        } else if (newViewProps.mediaCapturePermissionGrantType == HNSecureWebViewMediaCapturePermissionGrantType::Deny) {
            [_view setMediaCapturePermissionGrantType:HNSecureWebViewPermissionGrantType_Deny];
        }else if (newViewProps.mediaCapturePermissionGrantType == HNSecureWebViewMediaCapturePermissionGrantType::GrantIfSameHostElsePrompt) {
            [_view setMediaCapturePermissionGrantType:HNSecureWebViewPermissionGrantType_GrantIfSameHost_ElsePrompt];
        }else if (newViewProps.mediaCapturePermissionGrantType == HNSecureWebViewMediaCapturePermissionGrantType::GrantIfSameHostElseDeny) {
            [_view setMediaCapturePermissionGrantType:HNSecureWebViewPermissionGrantType_GrantIfSameHost_ElseDeny];
        }
    }
#endif
    if (oldViewProps.indicatorStyle != newViewProps.indicatorStyle) {
        if (newViewProps.indicatorStyle == HNSecureWebViewIndicatorStyle::Black) {
            [_view setIndicatorStyle:@"black"];
        } else if (newViewProps.indicatorStyle == HNSecureWebViewIndicatorStyle::White) {
            [_view setIndicatorStyle:@"white"];
        } else {
            [_view setIndicatorStyle:@"default"];
        }
    }

    NSMutableDictionary* source = [[NSMutableDictionary alloc] init];
    if (!newViewProps.newSource.uri.empty()) {
        [source setValue:RCTNSStringFromString(newViewProps.newSource.uri) forKey:@"uri"];
    }
    NSMutableDictionary* headers = [[NSMutableDictionary alloc] init];
    for (auto & element : newViewProps.newSource.headers) {
        [headers setValue:RCTNSStringFromString(element.value) forKey:RCTNSStringFromString(element.name)];
    }
    if (headers.count > 0) {
        [source setObject:headers forKey:@"headers"];
    }
    if (!newViewProps.newSource.baseUrl.empty()) {
        [source setValue:RCTNSStringFromString(newViewProps.newSource.baseUrl) forKey:@"baseUrl"];
    }
    if (!newViewProps.newSource.body.empty()) {
        [source setValue:RCTNSStringFromString(newViewProps.newSource.body) forKey:@"body"];
    }
    if (!newViewProps.newSource.html.empty()) {
        [source setValue:RCTNSStringFromString(newViewProps.newSource.html) forKey:@"html"];
    }
    if (!newViewProps.newSource.method.empty()) {
        [source setValue:RCTNSStringFromString(newViewProps.newSource.method) forKey:@"method"];
    }
    if (newViewProps.newSource.nativeHost == HNSecureWebViewNativeHost::Foliate) {
        // The generated prop has no URL payload in this branch. Preserve that
        // closed shape at the native boundary for HNSecureWebViewImpl.
        [source setValue:@"foliate" forKey:@"nativeHost"];
    }
    [_view setSource:source];

    [super updateProps:props oldProps:oldProps];
}

- (void)handleCommand:(nonnull const NSString *)commandName args:(nonnull const NSArray *)args {
    RCTHNSecureWebViewHandleCommand(self, commandName, args);
}


Class<RCTComponentViewProtocol> HNSecureWebViewCls(void)
{
    return HNSecureWebView.class;
}

- (void)goBack {
    [_view goBack];
}

- (void)goForward {
    [_view goForward];
}

- (void)injectJavaScript:(nonnull NSString *)javascript {
    [_view injectJavaScript:javascript];
}

- (void)loadUrl:(nonnull NSString *)url {
    // android only
}

- (void)postMessage:(nonnull NSString *)data {
    [_view postMessage:data];
}

- (void)reload {
    [_view reload];
}

- (void)requestFocus {
    [_view requestFocus];
}

- (void)stopLoading {
    [_view stopLoading];
}

- (void)clearFormData {
    // android only
}

- (void)clearCache:(BOOL)includeDiskFiles {
    // android only
}

- (void)clearHistory {
    // android only
}

@end
#endif
