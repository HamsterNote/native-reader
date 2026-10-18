#import "HNSecureWebViewDecisionManager.h"

@interface HNSecureWebViewDecisionEntry : NSObject
@property (nonatomic, weak) id<HNSecureWebViewNavigationDecisionOwner> owner;
@property (nonatomic, assign) NSUInteger generation;
@property (nonatomic, copy) HNSecureWebViewDecisionBlock handler;
@end

@implementation HNSecureWebViewDecisionEntry
@end


@implementation HNSecureWebViewDecisionManager

@synthesize nextLockIdentifier;
@synthesize decisionHandlers;

+ (id)getInstance {
    static HNSecureWebViewDecisionManager *lockManager = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        lockManager = [[self alloc] init];
    });
    return lockManager;
}

- (int)setDecisionHandler:(HNSecureWebViewDecisionBlock)decisionHandler {
    return [self setDecisionHandler:decisionHandler owner:nil generation:0];
}

- (int)setDecisionHandler:(HNSecureWebViewDecisionBlock)decisionHandler owner:(id<HNSecureWebViewNavigationDecisionOwner>)owner generation:(NSUInteger)generation {
    NSAssert([NSThread isMainThread], @"Navigation decisions must be created on the main queue");
    int lockIdentifier = self.nextLockIdentifier++;
    HNSecureWebViewDecisionEntry *entry = [HNSecureWebViewDecisionEntry new];
    entry.owner = owner;
    entry.generation = generation;
    entry.handler = decisionHandler;
    [self.decisionHandlers setObject:entry forKey:@(lockIdentifier)];
    return lockIdentifier;
}

- (void)performOnMainQueue:(dispatch_block_t)block {
    if ([NSThread isMainThread]) {
        block();
    } else {
        dispatch_async(dispatch_get_main_queue(), block);
    }
}

- (void)takeAndRunDecisionForLockIdentifier:(int)lockIdentifier shouldStart:(BOOL)shouldStart {
    NSAssert([NSThread isMainThread], @"Navigation decisions must be resolved on the main queue");
    NSNumber *key = @(lockIdentifier);
    HNSecureWebViewDecisionEntry *entry = [self.decisionHandlers objectForKey:key];
    [self.decisionHandlers removeObjectForKey:key];
    if (entry == nil) return;
    // A recycled view receives a new generation. A stale entry can never allow
    // navigation after that owner has been torn down and mounted again.
    BOOL ownerIsCurrent = entry.owner != nil &&
        [entry.owner isNavigationDecisionOwnerActive] &&
        [entry.owner navigationDecisionOwnerGeneration] == entry.generation;
    entry.handler(shouldStart && ownerIsCurrent);
}

- (void)resolveShouldStart:(BOOL)shouldStart forLockIdentifier:(int)lockIdentifier {
    [self performOnMainQueue:^{
        [self takeAndRunDecisionForLockIdentifier:lockIdentifier shouldStart:shouldStart];
    }];
}

- (void)cancelDecisionHandlerForLockIdentifier:(int)lockIdentifier {
    [self resolveShouldStart:NO forLockIdentifier:lockIdentifier];
}

- (void)cancelDecisionHandlersForLockIdentifiers:(NSArray<NSNumber *> *)lockIdentifiers {
    [self performOnMainQueue:^{
        for (NSNumber *lockIdentifier in lockIdentifiers) {
            [self takeAndRunDecisionForLockIdentifier:lockIdentifier.intValue shouldStart:NO];
        }
    }];
}

- (BOOL)dispatchDecisionEvent:(dispatch_block_t)event
             forLockIdentifier:(int)lockIdentifier
{
    @try {
        event();
        return YES;
    } @catch (NSException *exception) {
        [self cancelDecisionHandlerForLockIdentifier:lockIdentifier];
        return NO;
    }
}

- (void) setResult:(BOOL)shouldStart
 forLockIdentifier:(int)lockIdentifier {
    [self resolveShouldStart:shouldStart forLockIdentifier:lockIdentifier];
}

- (id)init {
  if (self = [super init]) {
      self.nextLockIdentifier = 1;
      self.decisionHandlers = [[NSMutableDictionary alloc] init];
  }
  return self;
}

- (void)dealloc {}

@end
