#import <XCTest/XCTest.h>
#import <CommonCrypto/CommonDigest.h>

#import <HNSecureWebView/HNSecureWebViewDecisionManager.h>
#import <HNSecureWebView/HNSecureFoliateHostRelay.h>
#import <HNSecureWebView/HNSecureWebViewReadAccessPolicy.h>

@interface HNSecureFaultOwner : NSObject <HNSecureWebViewNavigationDecisionOwner>
@property (nonatomic, assign) BOOL active;
@property (nonatomic, assign) NSUInteger generation;
@end

@implementation HNSecureFaultOwner
- (BOOL)isNavigationDecisionOwnerActive { return self.active; }
- (NSUInteger)navigationDecisionOwnerGeneration { return self.generation; }
@end

// A source-free WKWebView stand-in exercises relay identity checks without
// loading any file, publication, or Foliate renderer in the fault matrix.
@interface HNSecureFaultRelayWebView : NSObject
@property (nonatomic, copy) NSURL *URL;
@property (nonatomic, copy) NSString *lastScript;
@property (nonatomic, assign) BOOL deferCompletion;
@property (nonatomic, copy) void (^pendingCompletion)(id result, NSError *error);
@end

@implementation HNSecureFaultRelayWebView
- (void)evaluateJavaScript:(NSString *)script
                   inFrame:(WKFrameInfo *)frame
            inContentWorld:(WKContentWorld *)contentWorld
          completionHandler:(void (^)(id result, NSError *error))completionHandler
{
  self.lastScript = script;
  // The source-free preflight script asks for the same isolated relay readiness
  // marker that production requires before accepting adapter commandId 0.
  if (self.deferCompletion) {
    self.pendingCompletion = completionHandler;
  } else if (completionHandler) {
    completionHandler([script containsString:@"__hnFoliateHostRelayV1Ready"] ? @YES : @NO, nil);
  }
}
@end

@interface HNSecureWebViewDecisionManagerTests : XCTestCase
@end

@implementation HNSecureWebViewDecisionManagerTests

- (NSURL *)createDirectory:(NSString *)path
{
  NSURL *url = [NSURL fileURLWithPath:path isDirectory:YES];
  NSError *error = nil;
  XCTAssertTrue([[NSFileManager defaultManager] createDirectoryAtURL:url
                                          withIntermediateDirectories:YES
                                                           attributes:nil
                                                                error:&error]);
  XCTAssertNil(error);
  return url;
}

- (NSURL *)createFile:(NSString *)path
{
  NSURL *url = [NSURL fileURLWithPath:path];
  NSError *error = nil;
  XCTAssertTrue([[NSFileManager defaultManager] createDirectoryAtURL:url.URLByDeletingLastPathComponent
                                          withIntermediateDirectories:YES
                                                           attributes:nil
                                                                error:&error]);
  XCTAssertNil(error);
  error = nil;
  XCTAssertTrue([@"reader test" writeToURL:url atomically:YES encoding:NSUTF8StringEncoding error:&error]);
  XCTAssertNil(error);
  return url;
}

- (NSDictionary *)runtimeAsset:(NSString *)path contents:(NSData *)contents
{
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(contents.bytes, (CC_LONG)contents.length, digest);
  NSMutableString *sha256 = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (NSUInteger index = 0; index < CC_SHA256_DIGEST_LENGTH; index += 1) {
    [sha256 appendFormat:@"%02x", digest[index]];
  }
  return @{ @"path": path, @"size": @(contents.length), @"sha256": sha256 };
}

- (void)createRuntimeClosureAtRoot:(NSURL *)runtimeRoot omitManifest:(BOOL)omitManifest
{
  NSArray<NSString *> *paths = @[
    @"bootstrap.js", @"reader.html", @"probes/csp-1x1.png", @"probes/csp-external-canary.js",
    @"notices/fflate-MIT.txt", @"notices/zip.js-BSD-3-Clause.txt",
    @"foliate/LICENSE", @"foliate/comic-book.js", @"foliate/epub.js", @"foliate/epubcfi.js",
    @"foliate/fb2.js", @"foliate/fixed-layout.js", @"foliate/mobi.js", @"foliate/overlayer.js",
    @"foliate/paginator.js", @"foliate/progress.js", @"foliate/vendor/fflate.js",
    @"foliate/vendor/zip.js", @"foliate/view.js"
  ];
  NSMutableArray<NSDictionary *> *assets = [NSMutableArray arrayWithCapacity:paths.count];
  for (NSString *path in paths) {
    NSData *contents = [[NSString stringWithFormat:@"fixture:%@", path] dataUsingEncoding:NSUTF8StringEncoding];
    NSURL *assetURL = [runtimeRoot URLByAppendingPathComponent:path];
    NSError *error = nil;
    XCTAssertTrue([[NSFileManager defaultManager] createDirectoryAtURL:assetURL.URLByDeletingLastPathComponent
                                            withIntermediateDirectories:YES
                                                             attributes:nil
                                                                  error:&error]);
    XCTAssertNil(error);
    XCTAssertTrue([contents writeToURL:assetURL options:0 error:&error]);
    XCTAssertNil(error);
    [assets addObject:[self runtimeAsset:path contents:contents]];
  }
  if (!omitManifest) {
    NSError *error = nil;
    NSData *manifest = [NSJSONSerialization dataWithJSONObject:@{ @"assets": assets } options:0 error:&error];
    XCTAssertNil(error);
    XCTAssertTrue([manifest writeToURL:[runtimeRoot URLByAppendingPathComponent:@"manifest.json"] options:0 error:&error]);
    XCTAssertNil(error);
  }
}

- (NSURL *)createBundle:(NSURL *)bundleURL identifier:(NSString *)identifier
{
  [self createDirectory:bundleURL.path];
  XCTAssertTrue([@{ @"CFBundleIdentifier": identifier }
    writeToURL:[bundleURL URLByAppendingPathComponent:@"Info.plist"]
    atomically:YES]);
  return bundleURL;
}

- (void)onMain:(dispatch_block_t)block
{
  if ([NSThread isMainThread]) {
    block();
  } else {
    dispatch_sync(dispatch_get_main_queue(), block);
  }
}

- (int)registerDecision:(HNSecureWebViewDecisionManager *)manager
                  owner:(id<HNSecureWebViewNavigationDecisionOwner>)owner
             generation:(NSUInteger)generation
                  result:(BOOL *)result
                   calls:(NSUInteger *)calls
{
  __block int lockIdentifier = 0;
  [self onMain:^{
    lockIdentifier = [manager setDecisionHandler:^(BOOL shouldStart) {
      *calls += 1;
      *result = shouldStart;
    } owner:owner generation:generation];
  }];
  return lockIdentifier;
}

- (void)testNoHandlerCancelsExactlyOnce
{
  HNSecureWebViewDecisionManager *manager = [HNSecureWebViewDecisionManager getInstance];
  BOOL result = YES;
  NSUInteger calls = 0;
  int lockIdentifier = [self registerDecision:manager owner:nil generation:0 result:&result calls:&calls];

  [manager resolveShouldStart:YES forLockIdentifier:lockIdentifier];
  XCTAssertEqual(calls, 1u);
  XCTAssertFalse(result);
}

- (void)testTimeoutAndTeardownCancelExactlyOnce
{
  HNSecureWebViewDecisionManager *manager = [HNSecureWebViewDecisionManager getInstance];
  HNSecureFaultOwner *owner = [HNSecureFaultOwner new];
  owner.active = YES;
  owner.generation = 1;

  BOOL timeoutResult = YES;
  NSUInteger timeoutCalls = 0;
  int timeoutLock = [self registerDecision:manager owner:owner generation:1 result:&timeoutResult calls:&timeoutCalls];
  [manager cancelDecisionHandlerForLockIdentifier:timeoutLock];
  [manager resolveShouldStart:YES forLockIdentifier:timeoutLock];
  XCTAssertEqual(timeoutCalls, 1u);
  XCTAssertFalse(timeoutResult);

  BOOL teardownResult = YES;
  NSUInteger teardownCalls = 0;
  int teardownLock = [self registerDecision:manager owner:owner generation:1 result:&teardownResult calls:&teardownCalls];
  owner.active = NO;
  [manager cancelDecisionHandlersForLockIdentifiers:@[ @(teardownLock) ]];
  [manager resolveShouldStart:YES forLockIdentifier:teardownLock];
  XCTAssertEqual(teardownCalls, 1u);
  XCTAssertFalse(teardownResult);
}

- (void)testDispatchExceptionCancelsExactlyOnce
{
  HNSecureWebViewDecisionManager *manager = [HNSecureWebViewDecisionManager getInstance];
  HNSecureFaultOwner *owner = [HNSecureFaultOwner new];
  owner.active = YES;
  owner.generation = 1;
  BOOL result = YES;
  NSUInteger calls = 0;
  int lockIdentifier = [self registerDecision:manager owner:owner generation:1 result:&result calls:&calls];

  XCTAssertFalse([manager dispatchDecisionEvent:^{
    @throw [NSException exceptionWithName:@"HNSecureDispatchFailure" reason:nil userInfo:nil];
  } forLockIdentifier:lockIdentifier]);
  [manager resolveShouldStart:YES forLockIdentifier:lockIdentifier];
  XCTAssertEqual(calls, 1u);
  XCTAssertFalse(result);
}

- (void)testLateCallbackAndRecycleGenerationCannotAffectCurrentDecision
{
  HNSecureWebViewDecisionManager *manager = [HNSecureWebViewDecisionManager getInstance];
  HNSecureFaultOwner *owner = [HNSecureFaultOwner new];
  owner.active = YES;
  owner.generation = 1;
  BOOL oldResult = YES;
  NSUInteger oldCalls = 0;
  int oldLock = [self registerDecision:manager owner:owner generation:1 result:&oldResult calls:&oldCalls];

  owner.generation = 2;
  BOOL currentResult = NO;
  NSUInteger currentCalls = 0;
  int currentLock = [self registerDecision:manager owner:owner generation:2 result:&currentResult calls:&currentCalls];
  [manager resolveShouldStart:YES forLockIdentifier:oldLock];
  [manager resolveShouldStart:YES forLockIdentifier:currentLock];
  [manager resolveShouldStart:NO forLockIdentifier:oldLock];

  XCTAssertEqual(oldCalls, 1u);
  XCTAssertFalse(oldResult);
  XCTAssertEqual(currentCalls, 1u);
  XCTAssertTrue(currentResult);
}

- (void)testCurrentGenerationAllowAndDenyAreExact
{
  HNSecureWebViewDecisionManager *manager = [HNSecureWebViewDecisionManager getInstance];
  HNSecureFaultOwner *owner = [HNSecureFaultOwner new];
  owner.active = YES;
  owner.generation = 7;
  BOOL allowResult = NO;
  NSUInteger allowCalls = 0;
  int allowLock = [self registerDecision:manager owner:owner generation:7 result:&allowResult calls:&allowCalls];
  [manager resolveShouldStart:YES forLockIdentifier:allowLock];
  XCTAssertEqual(allowCalls, 1u);
  XCTAssertTrue(allowResult);

  BOOL denyResult = YES;
  NSUInteger denyCalls = 0;
  int denyLock = [self registerDecision:manager owner:owner generation:7 result:&denyResult calls:&denyCalls];
  [manager resolveShouldStart:NO forLockIdentifier:denyLock];
  XCTAssertEqual(denyCalls, 1u);
  XCTAssertFalse(denyResult);
}

- (void)testReaderReadAccessPolicyAllowsOnlyCanonicalRuntimeAndCacheFiles
{
  NSString *temporaryPath = [NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
  NSURL *temporaryRoot = [self createDirectory:temporaryPath];
  NSURL *runtimeRoot = [self createDirectory:[temporaryRoot.path stringByAppendingPathComponent:@"foliate-runtime/native"]];
  NSURL *cacheRoot = [self createDirectory:[temporaryRoot.path stringByAppendingPathComponent:@"cache/hamster-note-native-reader"]];
  NSURL *runtimeFile = [self createFile:[runtimeRoot.path stringByAppendingPathComponent:@"host/reader.html"]];
  NSURL *cacheFile = [self createFile:[cacheRoot.path stringByAppendingPathComponent:@"session-reader/source.bin"]];
  NSURL *nonSessionCacheFile = [self createFile:[cacheRoot.path stringByAppendingPathComponent:@"other/source.bin"]];
  HNSecureWebViewReadAccessPolicy *policy = [[HNSecureWebViewReadAccessPolicy alloc]
    initWithRuntimeRootURL:runtimeRoot cacheRootURL:cacheRoot];

  XCTAssertNil([policy readAccessRootForFileURL:runtimeFile]);
  XCTAssertEqualObjects([policy readAccessRootForFileURL:cacheFile].path, [cacheRoot.path stringByAppendingPathComponent:@"session-reader"]);
  XCTAssertNil([policy canonicalFileURLIfAllowed:runtimeFile]);
  XCTAssertEqualObjects([policy canonicalFileURLIfAllowed:cacheFile].path, cacheFile.path);
  XCTAssertNil([policy readAccessRootForFileURL:runtimeRoot]);
  XCTAssertNil([policy readAccessRootForFileURL:cacheRoot]);
  XCTAssertNil([policy readAccessRootForFileURL:nonSessionCacheFile]);
  XCTAssertNil([policy ordinaryReadAccessRootForFileURL:runtimeFile]);
  XCTAssertNil([policy canonicalOrdinaryFileURLIfAllowed:runtimeFile]);
  XCTAssertEqualObjects([policy ordinaryReadAccessRootForFileURL:cacheFile].path,
                        [cacheRoot.path stringByAppendingPathComponent:@"session-reader"]);
  XCTAssertEqualObjects([policy canonicalOrdinaryFileURLIfAllowed:cacheFile].path, cacheFile.path);

  NSError *error = nil;
  XCTAssertTrue([[NSFileManager defaultManager] removeItemAtURL:temporaryRoot error:&error]);
  XCTAssertNil(error);
}

- (void)testRuntimeHostResolverHasNoCallerURLAndRequiresAValidatedClosure
{
  NSString *temporaryPath = [NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
  NSURL *temporaryRoot = [self createDirectory:temporaryPath];
  NSURL *runtimeRoot = [self createDirectory:[temporaryRoot.path stringByAppendingPathComponent:@"foliate-runtime/native"]];
  NSURL *cacheRoot = [self createDirectory:[temporaryRoot.path stringByAppendingPathComponent:@"cache/hamster-note-native-reader"]];
  [self createRuntimeClosureAtRoot:runtimeRoot omitManifest:NO];
  HNSecureWebViewReadAccessPolicy *policy = [[HNSecureWebViewReadAccessPolicy alloc]
    initWithRuntimeRootURL:runtimeRoot cacheRootURL:cacheRoot];

  // This API has no URL argument: ordinary caller input cannot select it.
  NSURL *hostURL = [policy canonicalRuntimeHostURL];
  XCTAssertEqualObjects(hostURL.path, [runtimeRoot.path stringByAppendingPathComponent:@"reader.html"]);
  XCTAssertNil([policy canonicalOrdinaryFileURLIfAllowed:hostURL]);

  // A manually supplied runtime root gets no host capability without the same
  // manifest closure verification used by the bundleForClass resolver.
  NSError *error = nil;
  XCTAssertTrue([[NSFileManager defaultManager] removeItemAtURL:[runtimeRoot URLByAppendingPathComponent:@"manifest.json"] error:&error]);
  XCTAssertNil(error);
  XCTAssertNil([policy canonicalRuntimeHostURL]);

  error = nil;
  XCTAssertTrue([[NSFileManager defaultManager] removeItemAtURL:temporaryRoot error:&error]);
  XCTAssertNil(error);
}

- (void)testFoliateSelectorSecurityContractIsClosedAndMonotonic
{
  // The fault matrix cannot mount React Native, so inspect the checked-in
  // native boundary for the security-critical ordering and forbidden URL hint.
  NSString *testRoot = [NSString stringWithUTF8String:__FILE__].stringByDeletingLastPathComponent;
  NSURL *implementationURL = [[NSURL fileURLWithPath:testRoot]
    URLByAppendingPathComponent:@"../apple/HNSecureWebViewImpl.m"];
  NSString *source = [NSString stringWithContentsOfURL:implementationURL encoding:NSUTF8StringEncoding error:nil];
  XCTAssertNotNil(source);
  XCTAssertTrue([source containsString:@"source.count != 1"]);
  XCTAssertTrue([source containsString:@"source[@\"nativeHost\"]"]);
  XCTAssertTrue([source containsString:@"[value isEqualToString:@\"foliate\"]"]);
  XCTAssertTrue([source containsString:@"canonicalRuntimeHostURL]"]);
  XCTAssertFalse([source containsString:@"canonicalRuntimeHostURLIfAllowed:requestedURL"]);
  XCTAssertTrue([source containsString:@"Native reader host requires a remounted view"]);
  XCTAssertTrue([source containsString:@"Native reader host does not accept source updates"]);
  XCTAssertTrue([source containsString:@"canonicalOrdinaryFileURLIfAllowed"]);
  XCTAssertTrue([source containsString:@"secureFoliateHostEvent"]);
  XCTAssertTrue([source containsString:@"HNSecureFoliateHostErrorTransportUnavailable"]);
  XCTAssertTrue([source containsString:@"didPassInitialCSPPreflight"]);
  XCTAssertTrue([source containsString:@"_foliateHostRelay.isTerminal"]);
  XCTAssertTrue([source containsString:@"removeScriptMessageHandlerForName:HistoryShimName"]);
  XCTAssertTrue([source containsString:@"removeScriptMessageHandlerForName:MessageHandlerName"]);
}

- (void)testSecureFoliateHostHasExactlyOneRelayPreflightLoadingFinishPath
{
  // Enumerate every native onLoadingFinish call. This makes an accidental new
  // secure callback path (especially a future legacy script-message handler)
  // fail the Apple fault matrix rather than silently weakening host readiness.
  NSString *testRoot = [NSString stringWithUTF8String:__FILE__].stringByDeletingLastPathComponent;
  NSURL *implementationURL = [[NSURL fileURLWithPath:testRoot]
    URLByAppendingPathComponent:@"../apple/HNSecureWebViewImpl.m"];
  NSString *source = [NSString stringWithContentsOfURL:implementationURL encoding:NSUTF8StringEncoding error:nil];
  XCTAssertNotNil(source);

  NSString *call = @"_onLoadingFinish(";
  NSMutableArray<NSNumber *> *callOffsets = [NSMutableArray new];
  NSRange searchRange = NSMakeRange(0, source.length);
  while (searchRange.length > 0) {
    NSRange match = [source rangeOfString:call options:0 range:searchRange];
    if (match.location == NSNotFound) break;
    [callOffsets addObject:@(match.location)];
    NSUInteger nextLocation = NSMaxRange(match);
    searchRange = NSMakeRange(nextLocation, source.length - nextLocation);
  }

  // 1. legacy HistoryShim (blocked before handler-name dispatch);
  // 2. the only secure readiness event (relay/preflight proved bindable);
  // 3. ordinary didFinishNavigation.
  XCTAssertEqual(callOffsets.count, 3u);
  NSUInteger legacyCall = callOffsets[0].unsignedIntegerValue;
  NSUInteger secureCall = callOffsets[1].unsignedIntegerValue;
  NSUInteger ordinaryCall = callOffsets[2].unsignedIntegerValue;

  NSRange dispatchStart = [source rangeOfString:@"- (void)userContentController:(WKUserContentController *)userContentController"];
  NSRange sourceSetter = [source rangeOfString:@"- (void)setSource:(NSDictionary *)source"];
  XCTAssertNotEqual(dispatchStart.location, NSNotFound);
  XCTAssertNotEqual(sourceSetter.location, NSNotFound);
  NSString *legacyDispatch = [source substringWithRange:NSMakeRange(dispatchStart.location, sourceSetter.location - dispatchStart.location)];
  NSRange secureGuard = [legacyDispatch rangeOfString:@"if (_secureFoliateHostRequested) {\n    return;\n  }"];
  NSRange historyDispatch = [legacyDispatch rangeOfString:@"if ([message.name isEqualToString:HistoryShimName]) {"];
  XCTAssertNotEqual(secureGuard.location, NSNotFound);
  XCTAssertNotEqual(historyDispatch.location, NSNotFound);
  XCTAssertLessThan(secureGuard.location, historyDispatch.location);
  XCTAssertTrue(legacyCall >= dispatchStart.location && legacyCall < sourceSetter.location);

  NSRange secureMode = [source rangeOfString:@"if (_secureFoliateHostRequested) {\n    [_foliateHostRelay runInitialCSPPreflightWithCompletion:"];
  NSRange ordinaryMode = [source rangeOfString:@"if (_onLoadingFinish) {\n    _onLoadingFinish([self baseEvent]);\n  }"];
  XCTAssertNotEqual(secureMode.location, NSNotFound);
  XCTAssertNotEqual(ordinaryMode.location, NSNotFound);
  XCTAssertTrue(secureCall >= secureMode.location && secureCall < ordinaryMode.location);
  XCTAssertTrue(ordinaryCall >= ordinaryMode.location);
  NSString *secureBlock = [source substringWithRange:NSMakeRange(secureMode.location, ordinaryMode.location - secureMode.location)];
  XCTAssertTrue([secureBlock containsString:@"runInitialCSPPreflightWithCompletion"]);
  XCTAssertTrue([secureBlock containsString:@"didPassInitialCSPPreflight"]);
  XCTAssertTrue([secureBlock containsString:@"self->_onLoadingFinish([self secureFoliateHostEvent])"]);
  XCTAssertTrue([secureBlock containsString:@"return;"]);
}

- (void)testReaderRuntimeBundleResolverRequiresNativeReaderAndManifest
{
  NSString *temporaryPath = [NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
  NSURL *temporaryRoot = [self createDirectory:temporaryPath];
  NSURL *ownerBundleURL = [self createBundle:[temporaryRoot URLByAppendingPathComponent:@"Owner.bundle"] identifier:@"test.owner"];
  NSURL *runtimeBundleURL = [self createBundle:[ownerBundleURL URLByAppendingPathComponent:@"HNSecureWebViewFoliateRuntime.bundle"] identifier:@"test.runtime"];
  NSURL *runtimeRoot = [self createDirectory:[runtimeBundleURL.path stringByAppendingPathComponent:@"foliate-runtime/native"]];
  [self createRuntimeClosureAtRoot:runtimeRoot omitManifest:NO];
  NSBundle *ownerBundle = [NSBundle bundleWithURL:ownerBundleURL];

  XCTAssertNotNil(ownerBundle);
  XCTAssertEqualObjects(
    [HNSecureWebViewReadAccessPolicy runtimeRootURLInOwnerBundle:ownerBundle].path,
    runtimeRoot.path
  );

  [self createFile:[runtimeRoot.path stringByAppendingPathComponent:@"unexpected.js"]];
  XCTAssertNil([HNSecureWebViewReadAccessPolicy runtimeRootURLInOwnerBundle:ownerBundle]);

  NSURL *missingOwnerBundleURL = [self createBundle:[temporaryRoot URLByAppendingPathComponent:@"MissingOwner.bundle"] identifier:@"test.missing-owner"];
  NSURL *missingRuntimeBundleURL = [self createBundle:[missingOwnerBundleURL URLByAppendingPathComponent:@"HNSecureWebViewFoliateRuntime.bundle"] identifier:@"test.missing-runtime"];
  NSURL *missingRuntimeRoot = [self createDirectory:[missingRuntimeBundleURL.path stringByAppendingPathComponent:@"foliate-runtime/native"]];
  [self createRuntimeClosureAtRoot:missingRuntimeRoot omitManifest:YES];
  XCTAssertNil([HNSecureWebViewReadAccessPolicy runtimeRootURLInOwnerBundle:[NSBundle bundleWithURL:missingOwnerBundleURL]]);

  NSError *error = nil;
  XCTAssertTrue([[NSFileManager defaultManager] removeItemAtURL:temporaryRoot error:&error]);
  XCTAssertNil(error);
}

- (void)testReaderRuntimeBundleResolverRejectsHiddenExtraAndSymlink
{
  NSString *temporaryPath = [NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
  NSURL *temporaryRoot = [self createDirectory:temporaryPath];
  NSURL *ownerBundleURL = [self createBundle:[temporaryRoot URLByAppendingPathComponent:@"Owner.bundle"] identifier:@"test.owner"];
  NSURL *runtimeBundleURL = [self createBundle:[ownerBundleURL URLByAppendingPathComponent:@"HNSecureWebViewFoliateRuntime.bundle"] identifier:@"test.runtime"];
  NSURL *runtimeRoot = [self createDirectory:[runtimeBundleURL.path stringByAppendingPathComponent:@"foliate-runtime/native"]];
  [self createRuntimeClosureAtRoot:runtimeRoot omitManifest:NO];
  NSBundle *ownerBundle = [NSBundle bundleWithURL:ownerBundleURL];

  NSURL *hiddenExtra = [self createFile:[runtimeRoot.path stringByAppendingPathComponent:@".hidden-extra.js"]];
  XCTAssertNil([HNSecureWebViewReadAccessPolicy runtimeRootURLInOwnerBundle:ownerBundle]);
  NSError *error = nil;
  XCTAssertTrue([[NSFileManager defaultManager] removeItemAtURL:hiddenExtra error:&error]);
  XCTAssertNil(error);

  NSURL *hiddenDirectory = [self createDirectory:[runtimeRoot.path stringByAppendingPathComponent:@".hidden-directory"]];
  XCTAssertNil([HNSecureWebViewReadAccessPolicy runtimeRootURLInOwnerBundle:ownerBundle]);
  error = nil;
  XCTAssertTrue([[NSFileManager defaultManager] removeItemAtURL:hiddenDirectory error:&error]);
  XCTAssertNil(error);

  NSURL *symlinkURL = [runtimeRoot URLByAppendingPathComponent:@"linked-reader.html"];
  error = nil;
  XCTAssertTrue([[NSFileManager defaultManager] createSymbolicLinkAtURL:symlinkURL
                                                withDestinationURL:[runtimeRoot URLByAppendingPathComponent:@"reader.html"]
                                                              error:&error]);
  XCTAssertNil(error);
  XCTAssertNil([HNSecureWebViewReadAccessPolicy runtimeRootURLInOwnerBundle:ownerBundle]);

  error = nil;
  XCTAssertTrue([[NSFileManager defaultManager] removeItemAtURL:temporaryRoot error:&error]);
  XCTAssertNil(error);
}

- (void)testReaderReadAccessPolicyRejectsHostTraversalSymlinkAndNonFileURLs
{
  NSString *temporaryPath = [NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
  NSURL *temporaryRoot = [self createDirectory:temporaryPath];
  NSURL *runtimeRoot = [self createDirectory:[temporaryRoot.path stringByAppendingPathComponent:@"foliate-runtime/native"]];
  NSURL *cacheRoot = [self createDirectory:[temporaryRoot.path stringByAppendingPathComponent:@"cache/hamster-note-native-reader"]];
  NSURL *hostFile = [self createFile:[temporaryRoot.path stringByAppendingPathComponent:@"host/private.html"]];
  NSURL *runtimeFile = [self createFile:[runtimeRoot.path stringByAppendingPathComponent:@"host/reader.html"]];
  NSURL *symlinkURL = [runtimeRoot URLByAppendingPathComponent:@"host/escaped.html"];
  HNSecureWebViewReadAccessPolicy *policy = [[HNSecureWebViewReadAccessPolicy alloc]
    initWithRuntimeRootURL:runtimeRoot cacheRootURL:cacheRoot];

  NSError *error = nil;
  XCTAssertTrue([[NSFileManager defaultManager] createSymbolicLinkAtURL:symlinkURL
                                                    withDestinationURL:hostFile
                                                                  error:&error]);
  XCTAssertNil(error);

  NSURL *parentRootFile = [NSURL fileURLWithPath:[temporaryRoot.path stringByAppendingPathComponent:@"foliate-runtime/host.html"]];
  NSURL *broaderRuntimeRoot = runtimeRoot.URLByDeletingLastPathComponent;
  NSURL *traversalURL = [NSURL URLWithString:[NSString stringWithFormat:@"file://%@/../host/private.html", runtimeFile.URLByDeletingLastPathComponent.path]];
  NSURL *encodedTraversalURL = [NSURL URLWithString:[NSString stringWithFormat:@"file://%@%%2F..%%2Fhost%%2Fprivate.html", runtimeFile.URLByDeletingLastPathComponent.path]];
  XCTAssertNil([policy readAccessRootForFileURL:hostFile]);
  XCTAssertNil([policy readAccessRootForFileURL:parentRootFile]);
  XCTAssertNil([policy readAccessRootForFileURL:broaderRuntimeRoot]);
  XCTAssertNil([policy readAccessRootForFileURL:temporaryRoot]);
  XCTAssertNil([policy readAccessRootForFileURL:traversalURL]);
  XCTAssertNil([policy readAccessRootForFileURL:encodedTraversalURL]);
  XCTAssertNil([policy readAccessRootForFileURL:symlinkURL]);
  XCTAssertNil([policy canonicalFileURLIfAllowed:symlinkURL]);
  XCTAssertNil([policy readAccessRootForFileURL:[NSURL URLWithString:@"file://example.test/private.html"]]);
  XCTAssertNil([policy readAccessRootForFileURL:[NSURL URLWithString:@"https://example.test/reader.html"]]);

  error = nil;
  XCTAssertTrue([[NSFileManager defaultManager] removeItemAtURL:temporaryRoot error:&error]);
  XCTAssertNil(error);
}

- (NSString *)foliateHostMessageWithType:(NSString *)type
                               direction:(NSString *)direction
                                 payload:(NSDictionary *)payload
{
  NSDictionary *message = @{
    @"protocol": @"hn-foliate-host",
    @"version": @1,
    @"direction": direction,
    @"type": type,
    @"session": [@"A" stringByPaddingToLength:43 withString:@"A" startingAtIndex:0],
    @"generation": [@"G" stringByPaddingToLength:43 withString:@"G" startingAtIndex:0],
    @"commandId": (([type isEqualToString:@"bind"] ||
                   ([type isEqualToString:@"ack"] && [payload[@"command"] isEqualToString:@"bind"])) ? [@"z" stringByPaddingToLength:43 withString:@"z" startingAtIndex:0] : [@"a" stringByPaddingToLength:43 withString:@"a" startingAtIndex:0]),
    @"payload": payload,
  };
  NSData *data = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

- (void)testFoliateHostProtocolRejectsWrongVersionUnknownAndTransfer
{
  NSString *validBind = [self foliateHostMessageWithType:@"bind"
                                               direction:@"native-to-host"
                                                 payload:@{}];
  XCTAssertTrue([HNSecureFoliateHostRelay validateHostMessageData:validBind]);
  XCTAssertFalse([HNSecureFoliateHostRelay validateHostMessageData:
    [validBind stringByReplacingOccurrencesOfString:@"\"version\":1" withString:@"\"version\":2"]]);
  XCTAssertFalse([HNSecureFoliateHostRelay validateHostMessageData:
    [validBind stringByReplacingOccurrencesOfString:@"\"type\":\"bind\"" withString:@"\"type\":\"ready\""]]);
  XCTAssertFalse([HNSecureFoliateHostRelay validateHostMessageData:
    [validBind stringByReplacingOccurrencesOfString:@"hn-foliate-host" withString:@"hn-foliate-transfer"]]);
  XCTAssertFalse([HNSecureFoliateHostRelay validateHostMessageData:
    [validBind stringByReplacingOccurrencesOfString:@"\"payload\":{}" withString:@"\"payload\":{\"uri\":\"file:///book.epub\"}"]]);
}

- (void)testFoliateHostProtocolRejectsDuplicateUnknownAndSourceFields
{
  NSString *session = [@"A" stringByPaddingToLength:43 withString:@"A" startingAtIndex:0];
  NSString *duplicate = [NSString stringWithFormat:@"{\"protocol\":\"hn-foliate-host\",\"protocol\":\"hn-foliate-host\",\"version\":1,\"direction\":\"native-to-host\",\"type\":\"bind\",\"session\":\"%@\",\"generation\":0,\"commandId\":1,\"payload\":{}}", session];
  XCTAssertFalse([HNSecureFoliateHostRelay validateHostMessageData:duplicate]);
  for (NSString *field in @[ @"source", @"base64", @"bytes", @"transfer", @"unknown" ]) {
    NSString *message = [self foliateHostMessageWithType:@"bind"
                                                direction:@"native-to-host"
                                                  payload:@{ field: @"forbidden" }];
    XCTAssertFalse([HNSecureFoliateHostRelay validateHostMessageData:message]);
  }
}

- (void)testFoliateHostWireCorpusMatchesEveryRawCase
{
  // The shared corpus is raw UTF-8 wire data, not reconstructed DTOs. Reading
  // it here catches Objective-C parser drift from the fixed TS protocol.
  NSString *testRoot = [NSString stringWithUTF8String:__FILE__].stringByDeletingLastPathComponent;
  NSURL *corpusURL = [[NSURL fileURLWithPath:testRoot]
    URLByAppendingPathComponent:@"../secure-webview/foliate-host-wire-corpus.v1.json"];
  NSData *data = [NSData dataWithContentsOfURL:corpusURL];
  XCTAssertNotNil(data, @"shared wire corpus must be present beside Apple fault matrix");
  NSError *error = nil;
  NSDictionary *corpus = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
  XCTAssertNil(error);
  XCTAssertEqualObjects(corpus[@"protocol"], @"hn-foliate-host");
  XCTAssertEqualObjects(corpus[@"schemaVersion"], @1);
  for (NSDictionary *entry in corpus[@"cases"]) {
    XCTAssertEqual(
      [HNSecureFoliateHostRelay validateHostMessageData:entry[@"wire"]],
      [entry[@"parse"] boolValue],
      @"wire corpus case %@", entry[@"id"]
    );
  }
  for (NSDictionary *entry in corpus[@"semanticCases"]) {
    XCTAssertTrue([HNSecureFoliateHostRelay validateHostMessageData:entry[@"wire"]], @"semantic corpus case %@", entry[@"id"]);
  }
}

- (void)testFoliateRelayRejectsWrongFrameOriginURLSessionAndGeneration
{
  HNSecureFoliateHostRelay *relay = [HNSecureFoliateHostRelay new];
  NSURL *hostURL = [NSURL fileURLWithPath:@"/trusted/foliate-runtime/native/reader.html"];
  HNSecureFaultRelayWebView *webView = [HNSecureFaultRelayWebView new];
  webView.URL = hostURL;
  [relay activateForWebView:(WKWebView *)webView hostURL:hostURL];
  XCTestExpectation *preflight = [self expectationWithDescription:@"synthetic CSP preflight"];
  [relay runInitialCSPPreflightWithCompletion:^(BOOL passed) {
    XCTAssertTrue(passed);
    [preflight fulfill];
  }];
  [self waitForExpectations:@[ preflight ] timeout:1.0];
  NSString *bind = [self foliateHostMessageWithType:@"bind" direction:@"native-to-host" payload:@{}];
  XCTAssertTrue([relay sendNativeMessageData:bind]);
  NSString *bindAck = [self foliateHostMessageWithType:@"ack"
                                             direction:@"host-to-native"
                                               payload:@{ @"command": @"bind", @"status": @"bridge-bound" }];
  XCTAssertFalse([relay acceptMessageData:bindAck frameIsMain:NO securityProtocol:@"file" securityHost:@"" securityPort:0 currentURL:hostURL]);
  XCTAssertFalse([relay acceptMessageData:bindAck frameIsMain:YES securityProtocol:@"https" securityHost:@"example.test" securityPort:443 currentURL:hostURL]);
  XCTAssertFalse([relay acceptMessageData:bindAck frameIsMain:YES securityProtocol:@"file" securityHost:@"" securityPort:0 currentURL:[NSURL fileURLWithPath:@"/trusted/other.html"]]);
  XCTAssertTrue([relay acceptMessageData:bindAck frameIsMain:YES securityProtocol:@"file" securityHost:@"" securityPort:0 currentURL:hostURL]);
  XCTAssertFalse([relay acceptMessageData:bindAck frameIsMain:YES securityProtocol:@"file" securityHost:@"" securityPort:0 currentURL:hostURL]);
  NSString *wrongSession = [bindAck stringByReplacingOccurrencesOfString:[@"A" stringByPaddingToLength:43 withString:@"A" startingAtIndex:0] withString:[@"B" stringByPaddingToLength:43 withString:@"B" startingAtIndex:0]];
  XCTAssertFalse([relay acceptMessageData:wrongSession frameIsMain:YES securityProtocol:@"file" securityHost:@"" securityPort:0 currentURL:hostURL]);
  NSString *wrongGeneration = [bindAck stringByReplacingOccurrencesOfString:[@"G" stringByPaddingToLength:43 withString:@"G" startingAtIndex:0] withString:[@"H" stringByPaddingToLength:43 withString:@"H" startingAtIndex:0]];
  XCTAssertNotEqualObjects(wrongGeneration, bindAck);
  XCTAssertFalse([relay acceptMessageData:wrongGeneration frameIsMain:YES securityProtocol:@"file" securityHost:@"" securityPort:0 currentURL:hostURL]);
  webView.URL = [NSURL fileURLWithPath:@"/trusted/navigation-replaced.html"];
  XCTAssertFalse([relay sendNativeMessageData:bind]);
  XCTAssertFalse(relay.isActive);
  XCTAssertFalse(relay.didPassInitialCSPPreflight);
}

- (void)testInitialCSPPreflightUsesTwoOneShotBlobSubframes
{
  HNSecureFoliateHostRelay *relay = [HNSecureFoliateHostRelay new];
  NSURL *hostURL = [NSURL fileURLWithPath:@"/trusted/foliate-runtime/native/reader.html"];
  HNSecureFaultRelayWebView *webView = [HNSecureFaultRelayWebView new];
  webView.URL = hostURL;
  webView.deferCompletion = YES;
  [relay activateForWebView:(WKWebView *)webView hostURL:hostURL];
  XCTestExpectation *completion = [self expectationWithDescription:@"blob CSP preflight"];
  [relay runInitialCSPPreflightWithCompletion:^(BOOL passed) {
    XCTAssertFalse(passed);
    [completion fulfill];
  }];
  XCTAssertTrue([webView.lastScript containsString:@"URL.createObjectURL"]);
  XCTAssertTrue([webView.lastScript containsString:@"script-src "]);
  XCTAssertTrue([webView.lastScript containsString:@"blob:"]);
  XCTAssertTrue([webView.lastScript containsString:@"'none'"]);
  XCTAssertFalse([webView.lastScript containsString:@"srcdoc"]);
  XCTAssertFalse([webView.lastScript containsString:@"unsafe-inline"]);

  NSError *error = nil;
  NSRegularExpression *tokenPattern = [NSRegularExpression regularExpressionWithPattern:@"hn-foliate-csp-[A-Fa-f0-9-]+" options:0 error:&error];
  XCTAssertNil(error);
  NSTextCheckingResult *tokenMatch = [tokenPattern firstMatchInString:webView.lastScript options:0 range:NSMakeRange(0, webView.lastScript.length)];
  XCTAssertNotNil(tokenMatch);
  NSString *token = [webView.lastScript substringWithRange:tokenMatch.range];
  NSURL *controlURL = [NSURL URLWithString:[NSString stringWithFormat:@"blob:null/controlled#%@", token]];
  XCTAssertFalse([relay shouldPermitInitialCSPPreflightNavigationURL:controlURL isMainFrame:YES]);
  XCTAssertFalse([relay shouldPermitInitialCSPPreflightNavigationURL:[NSURL URLWithString:[NSString stringWithFormat:@"https://example.test/#%@", token]] isMainFrame:NO]);
  XCTAssertTrue([relay shouldPermitInitialCSPPreflightNavigationURL:controlURL isMainFrame:NO]);
  XCTAssertTrue([relay shouldPermitInitialCSPPreflightNavigationURL:controlURL isMainFrame:NO]);
  XCTAssertFalse([relay shouldPermitInitialCSPPreflightNavigationURL:controlURL isMainFrame:NO]);
  [relay abortInitialCSPPreflight];
  [self waitForExpectations:@[ completion ] timeout:1.0];
  XCTAssertFalse(relay.isActive);
  XCTAssertTrue(relay.isTerminal);
}

- (void)testInitialCSPPreflightFailsClosedWithoutTrustedHost
{
  HNSecureFoliateHostRelay *relay = [HNSecureFoliateHostRelay new];
  XCTestExpectation *completion = [self expectationWithDescription:@"source-free preflight"];
  [relay runInitialCSPPreflightWithCompletion:^(BOOL passed) {
    XCTAssertFalse(passed);
    [completion fulfill];
  }];
  [self waitForExpectations:@[ completion ] timeout:1.0];
}

- (void)testCSPPreflightPermitBypassesReactNativeNavigationRouting
{
  // This test deliberately inspects the native delegate's control-flow shape.
  // The narrow preflight permit must complete before the generic RN callback,
  // decision-manager lock, origin whitelist, or timeout code can run.
  NSString *testRoot = [NSString stringWithUTF8String:__FILE__].stringByDeletingLastPathComponent;
  NSURL *implementationURL = [[NSURL fileURLWithPath:testRoot]
    URLByAppendingPathComponent:@"../apple/HNSecureWebViewImpl.m"];
  NSString *source = [NSString stringWithContentsOfURL:implementationURL encoding:NSUTF8StringEncoding error:nil];
  XCTAssertNotNil(source, @"fault matrix must inspect the checked-in iOS delegate");
  NSRange permit = [source rangeOfString:@"if (sourceFreePreflightFrame) {"];
  NSRange genericRouting = [source rangeOfString:@"if (_onShouldStartLoadWithRequest) {"];
  XCTAssertNotEqual(permit.location, NSNotFound);
  XCTAssertNotEqual(genericRouting.location, NSNotFound);
  XCTAssertLessThan(permit.location, genericRouting.location);
  NSString *permitBlock = [source substringWithRange:NSMakeRange(permit.location, genericRouting.location - permit.location)];
  XCTAssertTrue([permitBlock containsString:@"decisionHandler(WKNavigationActionPolicyAllow);"]);
  XCTAssertTrue([permitBlock containsString:@"return;"]);
  XCTAssertFalse([permitBlock containsString:@"setDecisionHandler:"]);
  XCTAssertFalse([permitBlock containsString:@"_onShouldStartLoadWithRequest(event)"]);
}

@end
