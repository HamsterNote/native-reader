#import <WebKit/WebKit.h>

#import "RCTConvert+WKDataDetectorTypes.h"
#import <React/RCTConvert.h>

#if TARGET_OS_IPHONE

@implementation RCTConvert (HNSecureWKDataDetectorTypes)

+ (WKDataDetectorTypes)HNSecureWKDataDetectorTypes:(id)json
{
  static NSDictionary *mapping;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    mapping = @{
       @"none" : @(WKDataDetectorTypeNone),
       @"phoneNumber" : @(WKDataDetectorTypePhoneNumber),
       @"link" : @(WKDataDetectorTypeLink),
       @"address" : @(WKDataDetectorTypeAddress),
       @"calendarEvent" : @(WKDataDetectorTypeCalendarEvent),
       @"trackingNumber" : @(WKDataDetectorTypeTrackingNumber),
       @"flightNumber" : @(WKDataDetectorTypeFlightNumber),
       @"lookupSuggestion" : @(WKDataDetectorTypeLookupSuggestion),
       @"all" : @(WKDataDetectorTypeAll),
    };
  });
  return (WKDataDetectorTypes)[RCTConvertMultiEnumValue(
      "HNSecureWKDataDetectorTypes", mapping, @(WKDataDetectorTypeNone), json)
      unsignedLongLongValue];
}

@end

#endif // TARGET_OS_IPHONE