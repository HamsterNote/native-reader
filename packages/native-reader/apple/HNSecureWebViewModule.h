#ifndef HNSecureWebViewModule_h
#define HNSecureWebViewModule_h

#ifdef RCT_NEW_ARCH_ENABLED
#import "HNSecureWebViewSpec/HNSecureWebViewSpec.h"
#endif /* RCT_NEW_ARCH_ENABLED */

#import <React/RCTBridgeModule.h>

NS_ASSUME_NONNULL_BEGIN

@interface HNSecureWebViewModule : NSObject <
#ifdef RCT_NEW_ARCH_ENABLED
NativeHNSecureWebViewModuleSpec
#else
RCTBridgeModule
#endif /* RCT_NEW_ARCH_ENABLED */
>
@end

NS_ASSUME_NONNULL_END

#endif /* HNSecureWebViewModule_h */
