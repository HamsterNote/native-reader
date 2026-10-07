#import <UIKit/UIKit.h>

// 仅提供 hosted XCTest 所需的进程与可见 window，不增加产品 UI。
@interface HNHostSpikeAppDelegate : UIResponder <UIApplicationDelegate>
@property (nonatomic, strong) UIWindow *window;
@end
