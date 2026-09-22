#import <XCTest/XCTest.h>

#import <HNSecureWebView/HNSecureWebViewDecisionManager.h>

@interface HNSecureFaultOwner : NSObject <HNSecureWebViewNavigationDecisionOwner>
@property (nonatomic, assign) BOOL active;
@property (nonatomic, assign) NSUInteger generation;
@end

@implementation HNSecureFaultOwner
- (BOOL)isNavigationDecisionOwnerActive { return self.active; }
- (NSUInteger)navigationDecisionOwnerGeneration { return self.generation; }
@end

@interface HNSecureWebViewDecisionManagerTests : XCTestCase
@end

@implementation HNSecureWebViewDecisionManagerTests

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

@end
