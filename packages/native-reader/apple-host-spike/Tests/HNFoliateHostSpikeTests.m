#import <XCTest/XCTest.h>
#import <WebKit/WebKit.h>
#import <UIKit/UIKit.h>
#import <CommonCrypto/CommonDigest.h>
#include <stdio.h>
#import "HNSecureFoliateHostRelay.h"

static id HNValue(id value) { return value ?: NSNull.null; }
static NSString *HNJSON(id value)
{
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"null";
}

// 此子类只旁观 WebKit 创建的消息；真正接受路径始终由生产 super 执行。
// 绝不直接调用 acceptMessageData:frameIsMain:securityProtocol:...。
@interface HNObservedRelay : HNSecureFoliateHostRelay
@property (nonatomic, copy) void (^observe)(WKScriptMessage *message);
@end
@implementation HNObservedRelay
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message
{
  if (self.observe) self.observe(message);
  [super userContentController:controller didReceiveScriptMessage:message];
}
@end

// test-owned RN 名称探针：不是 React Native 依赖，也不转发到生产 relay。
@interface HNPageProbe : NSObject <WKScriptMessageHandler>
@property (nonatomic, copy) void (^observe)(WKScriptMessage *message);
@end
@implementation HNPageProbe
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message
{
  if (self.observe) self.observe(message);
}
@end

@interface HNFoliateHostSpikeTests : XCTestCase <WKNavigationDelegate>
@property (nonatomic, strong) NSMutableArray *events;
@property (nonatomic, strong) NSMutableArray *failures;
@property (nonatomic, strong) NSMutableArray<NSString *> *accepted;
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *rawMessages;
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *pageProbeMessages;
@property (nonatomic, strong) HNObservedRelay *relay;
@property (nonatomic, strong) HNPageProbe *pageProbe;
@property (nonatomic, strong) WKWebView *webView;
@property (nonatomic, strong) NSURL *hostURL;
@property (nonatomic, strong) NSURL *runtimeRoot;
@property (nonatomic, strong) XCTestExpectation *loadExpectation;
@property (nonatomic, copy) void (^nextRawMessage)(void);
@property (nonatomic, copy) void (^nextAcceptedMessage)(void);
@property (nonatomic, copy) void (^nextDeniedNavigation)(void);
@property (nonatomic, copy) void (^nextPageProbeMessage)(void);
@property (nonatomic) BOOL initialNavigationPending;
@property (nonatomic, copy) NSString *phase;
@end

@implementation HNFoliateHostSpikeTests

- (void)setUp
{
  [super setUp];
  self.continueAfterFailure = YES;
  self.events = [NSMutableArray new];
  self.failures = [NSMutableArray new];
  self.accepted = [NSMutableArray new];
  self.rawMessages = [NSMutableArray new];
  self.pageProbeMessages = [NSMutableArray new];
  self.phase = @"setup";
  XCTAssertTrue(NSThread.isMainThread, @"真实 WKWebView 测试必须在主线程执行");
  [self event:@"environment" details:@{ @"os": NSProcessInfo.processInfo.operatingSystemVersionString,
    @"mainBundle": NSBundle.mainBundle.bundlePath, @"sourceFree": @YES }];
}

- (void)event:(NSString *)event details:(NSDictionary *)details
{
  [self.events addObject:@{ @"phase": HNValue(self.phase), @"event": event,
    @"time": @(NSDate.date.timeIntervalSince1970), @"details": details ?: @{} }];
}

- (void)recordIssue:(XCTIssue *)issue
{
  // iOS 14+ 的统一 issue 入口覆盖断言、超时、异常；进程崩溃不保证 teardown。
  [self.failures addObject:@{ @"phase": HNValue(self.phase), @"description": HNValue(issue.compactDescription),
    @"details": HNValue(issue.detailedDescription), @"type": @(issue.type) }];
  [super recordIssue:issue];
}

- (void)tearDown
{
  self.phase = @"cleanup";
  [self.relay deactivate];
  [self.relay removeFromUserContentController:self.webView.configuration.userContentController];
  [self.webView.configuration.userContentController removeScriptMessageHandlerForName:@"ReactNativeWebView" contentWorld:WKContentWorld.pageWorld];
  [self.webView stopLoading];
  self.webView.navigationDelegate = nil;
  [self.webView removeFromSuperview];
  [self event:@"cleanup" details:@{ @"active": @(self.relay.isActive), @"terminal": @(self.relay.isTerminal) }];
  NSDictionary *evidence = @{ @"schemaVersion": @1, @"test": self.name,
    @"execution": @"hosted-xctest-real-wkwebview", @"scope": @"source/publication-free",
    @"events": self.events, @"failures": self.failures,
    @"assertionsFailed": @(self.failures.count), @"acceptedMessages": self.accepted,
    @"rawMessages": self.rawMessages, @"pageProbeMessages": self.pageProbeMessages };
  NSString *json = HNJSON(evidence);
  XCTAttachment *attachment = [[XCTAttachment alloc] initWithData:[json dataUsingEncoding:NSUTF8StringEncoding] uniformTypeIdentifier:@"public.json"];
  attachment.name = [NSString stringWithFormat:@"%@.evidence.json", self.name];
  attachment.lifetime = XCTAttachmentLifetimeKeepAlways;
  [self addAttachment:attachment];
  // 单行备份供 runner 从 xcodebuild 日志恢复，失败不得被改写成成功。
  fprintf(stdout, "HN_HOST_SPIKE_EVIDENCE %s\n", json.UTF8String);
  fflush(stdout);
  self.relay.observe = nil;
  self.relay.onAcceptedMessage = nil;
  self.pageProbe.observe = nil;
  self.nextRawMessage = nil;
  self.nextAcceptedMessage = nil;
  self.nextDeniedNavigation = nil;
  self.nextPageProbeMessage = nil;
  self.webView = nil;
  [super tearDown];
}

- (NSDictionary *)snapshot:(WKScriptMessage *)message
{
  WKFrameInfo *frame = message.frameInfo;
  WKSecurityOrigin *origin = frame.securityOrigin;
  return @{ @"name": HNValue(message.name), @"worldName": HNValue(message.world.name),
    @"isNamedWorld": @([message.world isEqual:[WKContentWorld worldWithName:@"hn-foliate-host"]]),
    @"isPageWorld": @([message.world isEqual:WKContentWorld.pageWorld]),
    @"frameIsMain": @(frame.isMainFrame), @"frameURL": HNValue(frame.request.URL.absoluteString),
    @"webViewURL": HNValue(message.webView.URL.absoluteString),
    @"securityOrigin": @{ @"protocol": HNValue(origin.protocol), @"host": HNValue(origin.host), @"port": @(origin.port) },
    @"rawBody": HNValue(message.body), @"sameWebView": @(message.webView == self.webView) };
}

- (BOOL)locateRuntime
{
  NSURL *bundle = [NSBundle.mainBundle URLForResource:@"HNSecureWebViewFoliateRuntime" withExtension:@"bundle"];
  XCTAssertNotNil(bundle, @"蓝色 folder reference 必须保留整个 .bundle 目录");
  if (!bundle) return NO;
  self.runtimeRoot = [bundle URLByAppendingPathComponent:@"foliate-runtime/native" isDirectory:YES];
  self.hostURL = [self.runtimeRoot URLByAppendingPathComponent:@"reader.html"];
  BOOL exists = [NSFileManager.defaultManager fileExistsAtPath:self.hostURL.path];
  [self event:@"canonical-bundle" details:@{ @"bundleURL": bundle.absoluteString, @"runtimeURL": self.runtimeRoot.absoluteString,
    @"hostURL": self.hostURL.absoluteString, @"hostExists": @(exists) }];
  XCTAssertTrue(exists);
  return exists;
}

- (BOOL)loadCanonicalHost
{
  self.phase = @"host-load";
  if (![self locateRuntime]) return NO;
  WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
  configuration.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
  self.relay = [HNObservedRelay new];
  __weak HNFoliateHostSpikeTests *weakSelf = self;
  self.relay.observe = ^(WKScriptMessage *message) {
    HNFoliateHostSpikeTests *test = weakSelf;
    NSDictionary *snapshot = [test snapshot:message];
    [test.rawMessages addObject:snapshot];
    [test event:@"actual-script-message-before-super" details:snapshot];
    void (^callback)(void) = test.nextRawMessage;
    test.nextRawMessage = nil;
    if (callback) callback();
  };
  self.relay.onAcceptedMessage = ^(NSString *data) {
    HNFoliateHostSpikeTests *test = weakSelf;
    [test.accepted addObject:data];
    [test event:@"production-accepted-message" details:@{ @"rawAck": data }];
    void (^callback)(void) = test.nextAcceptedMessage;
    test.nextAcceptedMessage = nil;
    if (callback) callback();
  };
  [self.relay installInUserContentController:configuration.userContentController];
  self.pageProbe = [HNPageProbe new];
  self.pageProbe.observe = ^(WKScriptMessage *message) {
    HNFoliateHostSpikeTests *test = weakSelf;
    NSDictionary *snapshot = [test snapshot:message];
    [test.pageProbeMessages addObject:snapshot];
    [test event:@"actual-page-rn-probe-message" details:snapshot];
    void (^callback)(void) = test.nextPageProbeMessage;
    test.nextPageProbeMessage = nil;
    if (callback) callback();
  };
  [configuration.userContentController addScriptMessageHandler:self.pageProbe contentWorld:WKContentWorld.pageWorld name:@"ReactNativeWebView"];
  self.webView = [[WKWebView alloc] initWithFrame:CGRectMake(0, 0, 320, 480) configuration:configuration];
  self.webView.navigationDelegate = self;
  UIWindow *window = ((id<UIApplicationDelegate>)UIApplication.sharedApplication.delegate).window;
  [window.rootViewController.view addSubview:self.webView];
  [self.relay activateForWebView:self.webView hostURL:self.hostURL];
  self.initialNavigationPending = YES;
  self.loadExpectation = [self expectationWithDescription:@"canonical reader.html didFinish"];
  [self.webView loadFileURL:self.hostURL allowingReadAccessToURL:self.runtimeRoot];
  [self waitForExpectationsWithTimeout:10 handler:nil];
  self.loadExpectation = nil;
  BOOL exact = [self.relay isExpectedHostURL:self.webView.URL];
  XCTAssertTrue(exact);
  return exact;
}

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler
{
  NSURL *URL = action.request.URL;
  BOOL main = action.targetFrame.isMainFrame;
  if (self.initialNavigationPending && main && [self.relay isExpectedHostURL:URL]) {
    self.initialNavigationPending = NO;
    [self event:@"navigation-allow-exact-initial-host" details:@{ @"url": HNValue(URL.absoluteString), @"mainFrame": @(main) }];
    decisionHandler(WKNavigationActionPolicyAllow);
    return;
  }
  if ([self.relay shouldPermitInitialCSPPreflightNavigationURL:URL isMainFrame:main]) {
    [self event:@"navigation-allow-strict-preflight-permit" details:@{ @"url": HNValue(URL.absoluteString), @"mainFrame": @(main) }];
    decisionHandler(WKNavigationActionPolicyAllow);
    return; // 严格 permit 不得继续落入默认失败关闭。
  }
  [self event:@"navigation-deny-and-deactivate" details:@{ @"url": HNValue(URL.absoluteString), @"mainFrame": @(main) }];
  [self.relay abortInitialCSPPreflight];
  [self.relay deactivate];
  decisionHandler(WKNavigationActionPolicyCancel);
  void (^callback)(void) = self.nextDeniedNavigation;
  self.nextDeniedNavigation = nil;
  if (callback) callback();
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation
{
  [self event:@"didFinish" details:@{ @"url": HNValue(webView.URL.absoluteString) }];
  [self.loadExpectation fulfill];
}
- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error
{
  [self event:@"navigation-failure" details:@{ @"error": error.description }];
  // policy cancel 的系统通知属于已测试的预期拒绝，不伪装成成功导航。
  if ([self.phase isEqual:@"denied-navigation"] && [error.domain isEqual:NSURLErrorDomain] && error.code == NSURLErrorCancelled) return;
  XCTFail(@"WK navigation failed: %@", error);
  [self.loadExpectation fulfill];
}
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error
{
  [self webView:webView didFailNavigation:navigation withError:error];
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView
{
  [self event:@"web-content-process-terminated" details:@{}];
  [self.relay deactivate];
  XCTFail(@"WebContent process terminated");
}

- (id)evaluate:(NSString *)script world:(WKContentWorld *)world
{
  XCTestExpectation *done = [self expectationWithDescription:@"real evaluateJavaScript completion"];
  __block id output = nil;
  [self.webView evaluateJavaScript:script inFrame:nil inContentWorld:world completionHandler:^(id result, NSError *error) {
    output = result;
    [self event:@"javascript-evaluation" details:@{ @"worldName": HNValue(world.name),
      @"pageWorld": @([world isEqual:WKContentWorld.pageWorld]), @"script": script,
      @"result": HNValue(result), @"error": HNValue(error.description) }];
    XCTAssertNil(error);
    [done fulfill];
  }];
  // 只等待此次 JS completion；不得提前消费调用方独立的消息 expectation。
  [self waitForExpectations:@[done] timeout:5];
  return output;
}

- (NSString *)bindCommand
{
  // Source-free test fixture simulating adapter-owned wire IDs; not production allocation.
  NSString *session = [@"A" stringByPaddingToLength:43 withString:@"A" startingAtIndex:0];
  return HNJSON(@{ @"protocol": @"hn-foliate-host", @"version": @1, @"direction": @"native-to-host",
    @"type": @"bind", @"session": session, @"generation": [@"G" stringByPaddingToLength:43 withString:@"G" startingAtIndex:0], @"commandId": [@"z" stringByPaddingToLength:43 withString:@"z" startingAtIndex:0], @"payload": @{} });
}

- (BOOL)preflightCanonicalHost
{
  if (![self loadCanonicalHost]) return NO;
  self.phase = @"source-free-csp-preflight";
  XCTestExpectation *preflight = [self expectationWithDescription:@"production CSP differential preflight completion"];
  __block BOOL passed = NO;
  @try {
    [self.relay runInitialCSPPreflightWithCompletion:^(BOOL actualPassed) {
      passed = actualPassed;
      [self event:@"actual-preflight-outcome" details:@{ @"passed": @(actualPassed),
        @"relayPassed": @(self.relay.didPassInitialCSPPreflight), @"active": @(self.relay.isActive),
        @"terminal": @(self.relay.isTerminal), @"probeFramesArePublicationFrames": @NO }];
      [preflight fulfill];
    }];
  } @catch (NSException *exception) {
    // 生产同步异常与 completion(NO) 分开记录，不伪造预检回调成功/失败。
    [self event:@"preflight-invocation-exception" details:@{ @"name": exception.name, @"reason": HNValue(exception.reason) }];
    XCTFail(@"production preflight threw: %@", exception);
    [preflight fulfill];
  }
  [self waitForExpectationsWithTimeout:5 handler:nil];
  XCTAssertTrue(passed, @"真实 CSP 失败必须保留，不准调整生产条件令测试通过");
  return passed;
}

- (BOOL)preflightAndBind
{
  if (![self preflightCanonicalHost]) return NO;
  self.phase = @"bind";
  NSString *bind = [self bindCommand];
  NSDictionary *command = [NSJSONSerialization JSONObjectWithData:[bind dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  XCTestExpectation *ack = [self expectationWithDescription:@"production accepted bridge-bound ack"];
  self.nextAcceptedMessage = ^{ [ack fulfill]; };
  BOOL sent = NO;
  @try {
    sent = [self.relay sendNativeMessageData:bind];
  } @catch (NSException *exception) {
    [self event:@"bind-dispatch-exception" details:@{ @"name": exception.name, @"reason": HNValue(exception.reason) }];
    XCTFail(@"production bind dispatch threw: %@", exception);
  }
  [self event:@"native-bind-dispatch" details:@{ @"command": command, @"sent": @(sent) }];
  XCTAssertTrue(sent);
  if (!sent) [ack fulfill]; // 仅关闭测试等待，不记作真实 ack。
  [self waitForExpectationsWithTimeout:5 handler:nil];
  self.nextAcceptedMessage = nil;
  XCTestExpectation *settled = [self expectationWithDescription:@"bounded duplicate-ack observation window"];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ [settled fulfill]; });
  [self waitForExpectationsWithTimeout:2 handler:nil];
  [self event:@"bind-ack-observation-window" details:@{ @"seconds": @0.25, @"rawCount": @(self.rawMessages.count), @"acceptedCount": @(self.accepted.count) }];
  // 独立检查 actual tuple；file tuple 未获文档保证，不能写入伪造结果。
  XCTAssertEqual(self.rawMessages.count, 1u);
  XCTAssertEqual(self.accepted.count, 1u);
  if (self.rawMessages.count) {
    NSDictionary *raw = self.rawMessages.firstObject;
    XCTAssertEqualObjects(raw[@"worldName"], @"hn-foliate-host");
    XCTAssertEqualObjects(raw[@"isNamedWorld"], @YES);
    XCTAssertEqualObjects(raw[@"frameIsMain"], @YES);
    XCTAssertEqualObjects(raw[@"frameURL"], self.hostURL.absoluteString);
    XCTAssertEqualObjects(raw[@"webViewURL"], self.hostURL.absoluteString);
    XCTAssertEqualObjects(raw[@"securityOrigin"], (@{ @"protocol": @"file", @"host": @"", @"port": @0 }));
  }
  if (self.accepted.count != 1) return NO;
  NSDictionary *actual = [NSJSONSerialization JSONObjectWithData:[self.accepted.firstObject dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  NSMutableDictionary *expected = [command mutableCopy];
  expected[@"direction"] = @"host-to-native";
  expected[@"type"] = @"ack";
  expected[@"payload"] = @{ @"command": @"bind", @"status": @"bridge-bound" };
  XCTAssertEqualObjects(actual, expected, @"必须是唯一 matching bind commandId bridge-bound ack");
  return [actual isEqual:expected];
}

- (void)replayActualAckAndAssertRejected
{
  // 重放已经实测的字节，经真实 handler 产生新的 WKScriptMessage；不伪造 tuple。
  NSUInteger before = self.accepted.count;
  NSUInteger rawBefore = self.rawMessages.count;
  NSString *rawAck = self.accepted.firstObject;
  XCTAssertNotNil(rawAck);
  if (!rawAck) return;
  XCTestExpectation *message = [self expectationWithDescription:@"real stale ack transport observed"];
  self.nextRawMessage = ^{ [message fulfill]; };
  [self.webView evaluateJavaScript:[NSString stringWithFormat:@"window.webkit.messageHandlers.hnFoliateHostRelayV1.postMessage(%@);true", HNJSON(rawAck)]
    inFrame:nil inContentWorld:[WKContentWorld worldWithName:@"hn-foliate-host"] completionHandler:^(id result, NSError *error) {
      [self event:@"stale-ack-transport-evaluation" details:@{ @"error": HNValue(error.description), @"result": HNValue(result) }];
      XCTAssertNil(error);
    }];
  [self waitForExpectationsWithTimeout:5 handler:nil];
  self.nextRawMessage = nil;
  // observer 先调用，super 在同一主线程回调中完成；等待队列屏障后检查接受数。
  XCTestExpectation *barrier = [self expectationWithDescription:@"message delivery main-queue barrier"];
  dispatch_async(dispatch_get_main_queue(), ^{ [barrier fulfill]; });
  [self waitForExpectationsWithTimeout:2 handler:nil];
  [self event:@"stale-ack-rejection-observed" details:@{ @"rawBefore": @(rawBefore), @"rawAfter": @(self.rawMessages.count),
    @"acceptedBefore": @(before), @"acceptedAfter": @(self.accepted.count) }];
  XCTAssertEqual(self.rawMessages.count, rawBefore + 1);
  XCTAssertEqual(self.accepted.count, before);
  BOOL sent = [self.relay sendNativeMessageData:[self bindCommand]];
  [self event:@"old-relay-send-rejected" details:@{ @"sent": @(sent) }];
  XCTAssertFalse(sent);
}

- (void)testCanonicalBundleManifestClosure
{
  self.phase = @"bundle-manifest-closure";
  if (![self locateRuntime]) return;
  NSError *error = nil;
  NSData *manifestData = [NSData dataWithContentsOfURL:[self.runtimeRoot URLByAppendingPathComponent:@"manifest.json"] options:0 error:&error];
  XCTAssertNil(error);
  NSDictionary *manifest = manifestData ? [NSJSONSerialization JSONObjectWithData:manifestData options:0 error:&error] : nil;
  XCTAssertNil(error);
  XCTAssertEqualObjects(manifest[@"schemaVersion"], @1);
  XCTAssertEqualObjects(manifest[@"runtime"], @"foliate-native-host");
  NSArray *assets = manifest[@"assets"];
  XCTAssertTrue([assets isKindOfClass:NSArray.class]);
  if (![assets isKindOfClass:NSArray.class]) return;
  NSMutableSet *expected = [NSMutableSet setWithObject:@"manifest.json"];
  for (NSDictionary *asset in assets) {
    NSString *path = asset[@"path"];
    BOOL safe = [path isKindOfClass:NSString.class] && path.length > 0 && !path.isAbsolutePath &&
      ![path.pathComponents containsObject:@".."] && ![expected containsObject:path];
    XCTAssertTrue(safe, @"manifest 路径必须唯一且位于闭包内: %@", path);
    if (!safe) continue;
    [expected addObject:path];
    NSData *bytes = [NSData dataWithContentsOfURL:[self.runtimeRoot URLByAppendingPathComponent:path] options:0 error:&error];
    XCTAssertNil(error);
    XCTAssertNotNil(bytes);
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(bytes.bytes, (CC_LONG)bytes.length, digest);
    NSMutableString *hash = [NSMutableString new];
    for (NSUInteger index = 0; index < CC_SHA256_DIGEST_LENGTH; index++) [hash appendFormat:@"%02x", digest[index]];
    [self event:@"asset-hash-measured" details:@{ @"path": path, @"sha256": hash, @"size": @(bytes.length),
      @"expectedSha256": HNValue(asset[@"sha256"]), @"expectedSize": HNValue(asset[@"size"]) }];
    XCTAssertEqualObjects(hash, asset[@"sha256"]);
    XCTAssertEqualObjects(@(bytes.length), asset[@"size"]);
  }
  NSMutableSet *actual = [NSMutableSet new];
  NSDirectoryEnumerator *enumerator = [NSFileManager.defaultManager enumeratorAtURL:self.runtimeRoot
    includingPropertiesForKeys:@[NSURLIsRegularFileKey, NSURLIsSymbolicLinkKey] options:0
    errorHandler:^BOOL(NSURL *URL, NSError *enumerationError) {
      [self event:@"enumeration-failure" details:@{ @"url": URL.absoluteString, @"error": enumerationError.description }];
      XCTFail(@"资源枚举失败: %@", enumerationError);
      return NO;
    }];
  for (NSURL *URL in enumerator) {
    NSNumber *regular = nil, *symlink = nil;
    [URL getResourceValue:&regular forKey:NSURLIsRegularFileKey error:&error];
    XCTAssertNil(error);
    [URL getResourceValue:&symlink forKey:NSURLIsSymbolicLinkKey error:&error];
    XCTAssertNil(error);
    XCTAssertFalse(symlink.boolValue, @"runtime 不允许符号链接");
    if (regular.boolValue || symlink.boolValue) [actual addObject:[URL.path substringFromIndex:self.runtimeRoot.path.length + 1]];
  }
  [self event:@"runtime-file-closure-measured" details:@{ @"expected": [expected.allObjects sortedArrayUsingSelector:@selector(compare:)],
    @"actual": [actual.allObjects sortedArrayUsingSelector:@selector(compare:)] }];
  XCTAssertEqualObjects(actual, expected, @"目录不能被扁平化或包含 manifest 外文件");
}

- (void)testSourceFreeBindAndContentWorldIsolation
{
  if (![self preflightAndBind]) return;
  self.phase = @"actual-content-world-isolation";
  WKContentWorld *named = [WKContentWorld worldWithName:@"hn-foliate-host"];
  NSDictionary *namedState = [self evaluate:@"({ready:globalThis.__hnFoliateHostRelayV1Ready===true,receive:typeof globalThis.__hnFoliateHostRelayV1Receive,relayHandler:typeof window.webkit?.messageHandlers?.hnFoliateHostRelayV1?.postMessage,rnHandler:typeof window.webkit?.messageHandlers?.ReactNativeWebView?.postMessage})" world:named];
  NSDictionary *pageState = [self evaluate:@"({ready:typeof globalThis.__hnFoliateHostRelayV1Ready,receive:typeof globalThis.__hnFoliateHostRelayV1Receive,relayHandler:typeof window.webkit?.messageHandlers?.hnFoliateHostRelayV1?.postMessage,rnHandler:typeof window.webkit?.messageHandlers?.ReactNativeWebView?.postMessage})" world:WKContentWorld.pageWorld];
  XCTAssertEqualObjects(namedState, (@{ @"ready": @YES, @"receive": @"function", @"relayHandler": @"function", @"rnHandler": @"undefined" }));
  XCTAssertEqualObjects(pageState, (@{ @"ready": @"undefined", @"receive": @"undefined", @"relayHandler": @"undefined", @"rnHandler": @"function" }));
  [self evaluate:@"globalThis.__hnSpikeNamedMarker='named';document.documentElement.setAttribute('data-hn-spike-dom','shared');true" world:named];
  XCTestExpectation *pageProbe = [self expectationWithDescription:@"actual page-world RN-named probe delivery"];
  self.nextPageProbeMessage = ^{ [pageProbe fulfill]; };
  NSDictionary *pageMarker = [self evaluate:@"globalThis.__hnSpikePageMarker='page';globalThis.ReactNativeWebView={postMessage:data=>window.webkit.messageHandlers.ReactNativeWebView.postMessage(String(data))};ReactNativeWebView.postMessage('page-only-probe');({namedMarker:typeof globalThis.__hnSpikeNamedMarker,dom:document.documentElement.getAttribute('data-hn-spike-dom')})" world:WKContentWorld.pageWorld];
  // JS completion 不保证 WKScriptMessage 已交付；消息超时仍由 XCTest 正常记为 Failed。
  [self waitForExpectations:@[pageProbe] timeout:5];
  self.nextPageProbeMessage = nil;
  NSDictionary *namedMarker = [self evaluate:@"({pageMarker:typeof globalThis.__hnSpikePageMarker,rnGlobal:typeof globalThis.ReactNativeWebView,namedMarker:globalThis.__hnSpikeNamedMarker})" world:named];
  XCTAssertEqualObjects(pageMarker, (@{ @"namedMarker": @"undefined", @"dom": @"shared" }));
  XCTAssertEqualObjects(namedMarker, (@{ @"pageMarker": @"undefined", @"rnGlobal": @"undefined", @"namedMarker": @"named" }));
  XCTAssertEqual(self.pageProbeMessages.count, 1u);
  if (self.pageProbeMessages.count) {
    NSDictionary *actualPageProbe = self.pageProbeMessages.firstObject;
    XCTAssertEqualObjects(actualPageProbe[@"isPageWorld"], @YES);
    XCTAssertEqualObjects(actualPageProbe[@"frameIsMain"], @YES);
    XCTAssertEqualObjects(actualPageProbe[@"frameURL"], self.hostURL.absoluteString);
    XCTAssertEqualObjects(actualPageProbe[@"rawBody"], @"page-only-probe");
  }
  [self event:@"isolation-observed" details:@{ @"named": HNValue(namedState), @"page": HNValue(pageState),
    @"namedMarker": HNValue(namedMarker), @"pageMarker": HNValue(pageMarker),
    @"domIsSharedNotIsolationEvidence": @YES, @"rnProbeIsTestOwned": @YES }];
  XCTAssertEqual(self.accepted.count, 1u);
}

- (void)testDeactivatedRelayRejectsActualStaleMessageAndNativeSend
{
  if (![self preflightAndBind]) return;
  self.phase = @"deactivated-old-relay";
  // bind commandId 已实测唯一接受；dispose 不涉及 publication/source/flow。
  // 当前 dispose commandId 的首次 ACK 不是旧 bind commandId 的重复消息，避免去重假阳性。
  NSMutableDictionary *command = [[NSJSONSerialization JSONObjectWithData:[self.accepted.firstObject dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] mutableCopy];
  command[@"direction"] = @"native-to-host";
  command[@"type"] = @"dispose";
  command[@"commandId"] = [@"a" stringByPaddingToLength:43 withString:@"a" startingAtIndex:0];
  command[@"payload"] = @{};
  NSString *dispose = HNJSON(command);
  NSUInteger acceptedBefore = self.accepted.count;
  NSUInteger rawBefore = self.rawMessages.count;
  XCTestExpectation *raw = [self expectationWithDescription:@"authentic current dispose ack delivered after deactivate"];
  self.nextRawMessage = ^{ [raw fulfill]; };
  BOOL sentBefore = NO;
  @try {
    sentBefore = [self.relay sendNativeMessageData:dispose];
  } @catch (NSException *exception) {
    [self event:@"dispose-before-deactivate-exception" details:@{ @"name": exception.name, @"reason": HNValue(exception.reason) }];
    XCTFail(@"production dispose dispatch threw: %@", exception);
  }
  XCTAssertTrue(sentBefore);
  // main-thread dispatch 返回后立即失活，WebKit 异步消息尚未交付；不是重放重复 ACK。
  [self.relay deactivate];
  [self event:@"deactivate-before-current-dispose-ack-delivery" details:@{ @"command": command, @"sentBefore": @(sentBefore), @"acceptedAtDeactivation": @(self.accepted.count) }];
  if (!sentBefore) [raw fulfill]; // 不宣称消息真的到达。
  [self waitForExpectationsWithTimeout:5 handler:nil];
  self.nextRawMessage = nil;
  XCTestExpectation *barrier = [self expectationWithDescription:@"first ack production super completed"];
  dispatch_async(dispatch_get_main_queue(), ^{ [barrier fulfill]; });
  [self waitForExpectationsWithTimeout:2 handler:nil];
  XCTAssertFalse(self.relay.isActive);
  XCTAssertEqual(self.rawMessages.count, rawBefore + 1);
  XCTAssertEqual(self.accepted.count, acceptedBefore);
  if (self.rawMessages.count > rawBefore) {
    NSDictionary *message = self.rawMessages.lastObject;
    XCTAssertEqualObjects(message[@"isNamedWorld"], @YES);
    XCTAssertEqualObjects(message[@"frameIsMain"], @YES);
    XCTAssertEqualObjects(message[@"frameURL"], self.hostURL.absoluteString);
    NSMutableDictionary *expected = [command mutableCopy];
    expected[@"direction"] = @"host-to-native";
    expected[@"type"] = @"ack";
    expected[@"payload"] = @{ @"command": @"dispose", @"status": @"unsupported" };
    id body = message[@"rawBody"];
    XCTAssertTrue([body isKindOfClass:NSString.class]);
    NSDictionary *actual = [body isKindOfClass:NSString.class] ? [NSJSONSerialization JSONObjectWithData:[body dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil;
    XCTAssertEqualObjects(actual, expected);
  }
  BOOL sentAfter = [self.relay sendNativeMessageData:[self bindCommand]];
  [self event:@"deactivated-authentic-ack-and-send-rejected" details:@{ @"rawCount": @(self.rawMessages.count),
    @"acceptedCount": @(self.accepted.count), @"sentAfter": @(sentAfter) }];
  XCTAssertFalse(sentAfter);
}

- (void)testDeniedNavigationFailsClosedAndRejectsOldRelay
{
  if (![self preflightAndBind]) return;
  self.phase = @"denied-navigation";
  XCTestExpectation *denied = [self expectationWithDescription:@"noncanonical navigation denied"];
  self.nextDeniedNavigation = ^{ [denied fulfill]; };
  // about:blank 是无 source 的导航尝试；policy 不得放行它。
  [self.webView loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"about:blank"]]];
  [self waitForExpectationsWithTimeout:5 handler:nil];
  XCTAssertFalse(self.relay.isActive);
  XCTAssertEqualObjects(self.webView.URL, self.hostURL, @"失败关闭不能提交替代 document");
  [self replayActualAckAndAssertRejected];
}

- (void)testExactHostURLDepartureRejectsActualStaleMessageAndNativeSend
{
  if (![self preflightAndBind]) return;
  self.phase = @"exact-host-url-departure";
  // History API 改变已提交 URL，不增加 policy 例外；是否支持 file URL 必须实测。
  // 若 WK 拒绝或 URL 不更新，测试失败，不偷偷放开导航 delegate。
  [self evaluate:@"history.replaceState(null,'','#hn-spike-departed');location.href" world:WKContentWorld.pageWorld];
  NSURL *actualURL = self.webView.URL;
  [self event:@"actual-exact-url-departure" details:@{ @"url": HNValue(actualURL.absoluteString),
    @"canonical": self.hostURL.absoluteString, @"isExpected": @([self.relay isExpectedHostURL:actualURL]) }];
  XCTAssertNotEqualObjects(actualURL, self.hostURL);
  XCTAssertFalse([self.relay isExpectedHostURL:actualURL]);
  if ([actualURL isEqual:self.hostURL]) return;
  [self replayActualAckAndAssertRejected];
  XCTAssertTrue(self.relay.isTerminal, @"native send 在实际离开 exact host 后须终止旧 relay");
}
@end
