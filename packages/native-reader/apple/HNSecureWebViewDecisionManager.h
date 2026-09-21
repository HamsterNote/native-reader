#import <Foundation/Foundation.h>
#import <React/RCTLog.h>
#import <WebKit/WebKit.h>

typedef void (^HNSecureWebViewDecisionBlock)(BOOL);

@protocol HNSecureWebViewNavigationDecisionOwner <NSObject>
- (BOOL)isNavigationDecisionOwnerActive;
- (NSUInteger)navigationDecisionOwnerGeneration;
@end

@interface HNSecureWebViewDecisionManager : NSObject {
    int nextLockIdentifier;
    NSMutableDictionary *decisionHandlers;
}

@property (nonatomic) int nextLockIdentifier;
@property (nonatomic, retain) NSMutableDictionary *decisionHandlers;

+ (id)      getInstance;

- (int)setDecisionHandler:(HNSecureWebViewDecisionBlock)handler;
- (int)setDecisionHandler:(HNSecureWebViewDecisionBlock)handler owner:(id<HNSecureWebViewNavigationDecisionOwner>)owner generation:(NSUInteger)generation;
- (void)resolveShouldStart:(BOOL)shouldStart forLockIdentifier:(int)lockIdentifier;
- (void)cancelDecisionHandlerForLockIdentifier:(int)lockIdentifier;
- (void)cancelDecisionHandlersForLockIdentifiers:(NSArray<NSNumber *> *)lockIdentifiers;
- (BOOL)dispatchDecisionEvent:(dispatch_block_t)event
             forLockIdentifier:(int)lockIdentifier;
- (void)    setResult:(BOOL)shouldStart
    forLockIdentifier:(int)lockIdentifier;
@end
