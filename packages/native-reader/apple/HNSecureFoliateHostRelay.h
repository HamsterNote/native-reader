#import <Foundation/Foundation.h>
#import <WebKit/WebKit.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString *const HNSecureFoliateHostHandlerName;

/**
 * Private iOS 14+ bridge for the generated Foliate host document. It is never
 * installed in the page content world, so publication frames cannot obtain a
 * React Native command or callback capability.
 */
@interface HNSecureFoliateHostRelay : NSObject <WKScriptMessageHandler>

@property (nonatomic, readonly, getter=isActive) BOOL active;
@property (nonatomic, readonly, getter=didPassInitialCSPPreflight) BOOL initialCSPPreflightPassed;
@property (nonatomic, readonly, getter=isTerminal) BOOL terminal;
@property (nonatomic, copy, nullable) void (^onAcceptedMessage)(NSString *data);

- (void)installInUserContentController:(WKUserContentController *)controller;
- (void)activateForWebView:(WKWebView *)webView hostURL:(NSURL *)hostURL;
- (void)deactivate;
- (void)removeFromUserContentController:(WKUserContentController *)controller;

// The existing HNSecureWebView ABI still supplies a string. In secure-host
// mode it is sent only through the named isolated world, never page script.
- (BOOL)sendNativeMessageData:(NSString *)data;

// A source-free capability check. It inspects only the trusted host document
// and isolated relay; publication URI/read/copy/transfer work belongs to 4C.
- (void)runInitialCSPPreflightWithCompletion:(void (^)(BOOL passed))completion;

// The secure navigation delegate asks this only while the source-free CSP
// differential probe is alive. It never permits a main-frame navigation.
- (BOOL)shouldPermitInitialCSPPreflightNavigationURL:(nullable NSURL *)URL
                                         isMainFrame:(BOOL)isMainFrame;
- (void)abortInitialCSPPreflight;

// Kept public for the fault matrix; production calls it only from the named
// content-world handler above.
- (BOOL)acceptMessageData:(NSString *)data
              frameIsMain:(BOOL)frameIsMain
           securityProtocol:(NSString *)securityProtocol
               securityHost:(NSString *)securityHost
               securityPort:(NSInteger)securityPort
                 currentURL:(nullable NSURL *)currentURL;

- (BOOL)isExpectedHostURL:(nullable NSURL *)URL;

// Contract-test affordance: validates only the closed wire schema and has no
// WebView, source, navigation, or publication side effects.
+ (BOOL)validateHostMessageData:(NSString *)data;

@end

NS_ASSUME_NONNULL_END
