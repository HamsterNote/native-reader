#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Chooses the only WKWebView file read roots owned by the native reader.
 * The resource-bundle manifest must validate before its root becomes readable.
 */
@interface HNSecureWebViewReadAccessPolicy : NSObject

- (instancetype)init;
- (instancetype)initWithRuntimeRootURL:(nullable NSURL *)runtimeRootURL
                           cacheRootURL:(nullable NSURL *)cacheRootURL NS_DESIGNATED_INITIALIZER;

+ (nullable NSURL *)runtimeRootURL;
+ (nullable NSURL *)runtimeRootURLInOwnerBundle:(NSBundle *)ownerBundle;

// Legacy/general file-root query. It is intentionally cache-session-only;
// bundled runtime assets have no generic read-root API.
- (nullable NSURL *)readAccessRootForFileURL:(NSURL *)fileURL;

// Returns a cache-session file URL only after the same generic-root check.
- (nullable NSURL *)canonicalFileURLIfAllowed:(NSURL *)fileURL;

// Ordinary React props may read a reader cache session, but never the bundled
// runtime. The runtime root is a native-only capability of nativeHost: foliate.
- (nullable NSURL *)ordinaryReadAccessRootForFileURL:(NSURL *)fileURL;
- (nullable NSURL *)canonicalOrdinaryFileURLIfAllowed:(NSURL *)fileURL;

// Resolves the single native-owned host without accepting any caller URL.
// This deliberately prevents a normal `source.uri` from selecting secure mode.
- (nullable NSURL *)canonicalRuntimeHostURL;

@end

NS_ASSUME_NONNULL_END
