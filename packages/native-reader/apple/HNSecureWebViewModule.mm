#import "HNSecureWebViewModule.h"

#import "HNSecureWebViewDecisionManager.h"

#ifdef RCT_NEW_ARCH_ENABLED
#import <React/RCTFabricComponentsPlugins.h>
#endif /* RCT_NEW_ARCH_ENABLED */

@implementation HNSecureWebViewModule

RCT_EXPORT_MODULE(HNSecureWebViewModule)

RCT_EXPORT_METHOD(isFileUploadSupported:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
    if (resolve) {
        resolve(@(YES));
    }
}

RCT_EXPORT_METHOD(shouldStartLoadWithLockIdentifier:(BOOL)shouldStart lockIdentifier:(double)lockIdentifier)
{
    [[HNSecureWebViewDecisionManager getInstance] setResult:shouldStart forLockIdentifier:(int)lockIdentifier];
}

#ifndef RCT_NEW_ARCH_ENABLED
- (NSDictionary *)constantsToExport {
    return @{
        @"implementationId": @"com.hamsternote.nativereader.securewebview",
        @"protocolMajor": @1,
        @"implementationVersion": @"13.16.1-hamsternote.1",
        @"platform": @"ios",
        @"capabilities": @[
            @"navigation-decision-fail-closed-v1",
            @"main-frame-native-gate-v1",
            @"subframe-local-root-deny-v1",
            @"late-callback-safe-v1"
        ]
    };
}
#else
- (facebook::react::ModuleConstants<JS::NativeHNSecureWebViewModule::Constants>)constantsToExport
{
  return [self getConstants];
}

- (facebook::react::ModuleConstants<JS::NativeHNSecureWebViewModule::Constants>)getConstants
{
  return facebook::react::typedConstants<JS::NativeHNSecureWebViewModule::Constants>({
      .implementationId = @"com.hamsternote.nativereader.securewebview",
      .protocolMajor = 1.0,
      .implementationVersion = @"13.16.1-hamsternote.1",
      .platform = @"ios",
      .capabilities = std::vector<NSString *>({
          @"navigation-decision-fail-closed-v1",
          @"main-frame-native-gate-v1",
          @"subframe-local-root-deny-v1",
          @"late-callback-safe-v1",
      }),
  });
}
#endif /* RCT_NEW_ARCH_ENABLED */

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeHNSecureWebViewModuleSpecJSI>(params);
}
#endif /* RCT_NEW_ARCH_ENABLED */

Class HNSecureWebViewModuleCls(void) {
  return HNSecureWebViewModule.class;
}

@end
