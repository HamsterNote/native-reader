#import "HNSecureWebViewReadAccessPolicy.h"
#import <CommonCrypto/CommonDigest.h>

static NSString *const HNSecureNativeReaderRuntimeBundleName = @"HNSecureWebViewFoliateRuntime";
static NSString *const HNSecureNativeReaderRuntimeDirectory = @"foliate-runtime/native";
static NSString *const HNSecureNativeReaderCacheDirectory = @"hamster-note-native-reader";

static NSURL *HNSecureCanonicalFileURL(NSURL *url)
{
  if (!url.isFileURL || url.host.length > 0 || !url.path.isAbsolutePath) {
    return nil;
  }

  NSString *lowercaseURL = url.absoluteString.lowercaseString;
  for (NSString *unsafeEscape in @[ @"%2e", @"%2f", @"%5c", @"%25" ]) {
    if ([lowercaseURL containsString:unsafeEscape]) {
      return nil;
    }
  }

  // Do not normalize an attacker-controlled traversal component into acceptance.
  for (NSString *component in url.pathComponents) {
    if ([component isEqualToString:@"."] || [component isEqualToString:@".."]) {
      return nil;
    }
  }

  NSURL *standardizedURL = [url URLByStandardizingPath];
  NSURL *resolvedURL = [standardizedURL URLByResolvingSymlinksInPath];
  if (!resolvedURL.isFileURL || !resolvedURL.path.isAbsolutePath) {
    return nil;
  }

  return [NSURL fileURLWithPath:resolvedURL.path.stringByStandardizingPath];
}

static BOOL HNSecurePathIsStrictDescendantOfPath(NSString *path, NSString *rootPath)
{
  if ([path isEqualToString:rootPath]) {
    return NO;
  }

  NSString *rootPrefix = [rootPath hasSuffix:@"/"]
    ? rootPath
    : [rootPath stringByAppendingString:@"/"];
  return [path hasPrefix:rootPrefix];
}

static NSURL *HNSecureCacheSessionRootForFileURL(NSURL *standardizedFileURL,
                                                  NSURL *canonicalFileURL,
                                                  NSURL *cacheRootURL)
{
  NSURL *canonicalCacheRootURL = HNSecureCanonicalFileURL(cacheRootURL);
  if (!canonicalCacheRootURL ||
      !HNSecurePathIsStrictDescendantOfPath(standardizedFileURL.path, cacheRootURL.path) ||
      !HNSecurePathIsStrictDescendantOfPath(canonicalFileURL.path, canonicalCacheRootURL.path)) {
    return nil;
  }

  NSString *relativePath = [standardizedFileURL.path substringFromIndex:cacheRootURL.path.length + 1];
  NSArray<NSString *> *components = relativePath.pathComponents;
  if (components.count < 2 || ![components.firstObject hasPrefix:@"session-"]) {
    return nil;
  }

  NSURL *sessionRootURL = [cacheRootURL URLByAppendingPathComponent:components.firstObject isDirectory:YES];
  NSURL *canonicalSessionRootURL = HNSecureCanonicalFileURL(sessionRootURL);
  if (!canonicalSessionRootURL ||
      !HNSecurePathIsStrictDescendantOfPath(canonicalFileURL.path, canonicalSessionRootURL.path)) {
    return nil;
  }
  return canonicalSessionRootURL;
}

static BOOL HNSecureRuntimeAssetPathIsSafe(NSString *relativePath)
{
  if (![relativePath isKindOfClass:[NSString class]] ||
       relativePath.length == 0 ||
       [relativePath containsString:@"\\"] ||
       ![relativePath isEqualToString:[relativePath precomposedStringWithCanonicalMapping]] ||
       ![relativePath isEqualToString:relativePath.stringByStandardizingPath]) {
    return NO;
  }
  for (NSString *component in relativePath.pathComponents) {
    if ([component isEqualToString:@"/"] ||
        [component isEqualToString:@"."] ||
        [component isEqualToString:@".."]) {
      return NO;
    }
  }
  return !relativePath.isAbsolutePath;
}

static NSString *HNSecureSHA256(NSData *data)
{
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
  NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (NSUInteger index = 0; index < CC_SHA256_DIGEST_LENGTH; index += 1) {
    [hex appendFormat:@"%02x", digest[index]];
  }
  return hex;
}

static NSSet<NSString *> *HNSecureExpectedRuntimeAssetPaths(void)
{
  return [NSSet setWithArray:@[
    @"bootstrap.js",
    @"foliate/LICENSE",
    @"foliate/comic-book.js",
    @"foliate/epub.js",
    @"foliate/epubcfi.js",
    @"foliate/fb2.js",
    @"foliate/fixed-layout.js",
    @"foliate/mobi.js",
    @"foliate/overlayer.js",
    @"foliate/paginator.js",
    @"foliate/progress.js",
    @"foliate/vendor/fflate.js",
    @"foliate/vendor/zip.js",
    @"foliate/view.js",
    @"notices/fflate-MIT.txt",
    @"notices/zip.js-BSD-3-Clause.txt",
    @"probes/csp-1x1.png",
    @"probes/csp-external-canary.js",
    @"reader.html",
  ]];
}

static BOOL HNSecureSHA256IsValid(NSString *sha256)
{
  NSCharacterSet *hexCharacters = [NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"];
  return [sha256 isKindOfClass:[NSString class]] &&
    sha256.length == 64 &&
    [sha256 rangeOfCharacterFromSet:hexCharacters.invertedSet].location == NSNotFound;
}

static BOOL HNSecureSizeIsValid(NSNumber *size)
{
  return [size isKindOfClass:[NSNumber class]] &&
    CFGetTypeID((__bridge CFTypeRef)size) != CFBooleanGetTypeID() &&
    size.longLongValue >= 0 &&
    size.doubleValue == (double)size.longLongValue &&
    size.unsignedLongLongValue <= NSUIntegerMax;
}

static BOOL HNSecureURLIsRegularNonSymlinkFile(NSURL *url)
{
  NSNumber *isRegularFile = nil;
  NSNumber *isSymbolicLink = nil;
  NSError *error = nil;
  return [url getResourceValue:&isRegularFile forKey:NSURLIsRegularFileKey error:&error] &&
    [url getResourceValue:&isSymbolicLink forKey:NSURLIsSymbolicLinkKey error:&error] &&
    !error && isRegularFile.boolValue && !isSymbolicLink.boolValue;
}

static BOOL HNSecureURLIsDirectoryNonSymlink(NSURL *url)
{
  NSNumber *isDirectory = nil;
  NSNumber *isSymbolicLink = nil;
  NSError *error = nil;
  return [url getResourceValue:&isDirectory forKey:NSURLIsDirectoryKey error:&error] &&
    [url getResourceValue:&isSymbolicLink forKey:NSURLIsSymbolicLinkKey error:&error] &&
    !error && isDirectory.boolValue && !isSymbolicLink.boolValue;
}

// `NSURLIsSymbolicLinkKey` describes only the leaf. Native bundle roots must
// also reject an ancestor symlink, otherwise a later path comparison could be
// made against a root outside the bundle that bundleForClass selected.
static BOOL HNSecureURLIsStrictCanonicalDirectory(NSURL *url)
{
  NSURL *standardizedURL = [url URLByStandardizingPath];
  NSURL *canonicalURL = HNSecureCanonicalFileURL(url);
  return HNSecureURLIsDirectoryNonSymlink(url) && canonicalURL &&
    [standardizedURL.path isEqualToString:canonicalURL.path];
}

static void HNSecureAddExpectedParentDirectories(NSMutableSet<NSString *> *entries,
                                                  NSString *relativePath)
{
  NSArray<NSString *> *components = relativePath.pathComponents;
  NSMutableArray<NSString *> *parents = [NSMutableArray new];
  for (NSUInteger index = 0; index + 1 < components.count; index += 1) {
    [parents addObject:components[index]];
    [entries addObject:[NSString stringWithFormat:@"D:%@",
                       [parents componentsJoinedByString:@"/"]]];
  }
}

static BOOL HNSecureRuntimeClosureHasNoExtraFiles(NSURL *runtimeRootURL, NSSet<NSString *> *paths)
{
  __block NSError *enumerationError = nil;
  NSDirectoryEnumerator<NSURL *> *enumerator = [[NSFileManager defaultManager]
    enumeratorAtURL:runtimeRootURL
    includingPropertiesForKeys:@[ NSURLIsDirectoryKey, NSURLIsRegularFileKey, NSURLIsSymbolicLinkKey ]
    options:0
    errorHandler:^BOOL(__unused NSURL *url, __unused NSError *error) {
      enumerationError = error;
      return NO;
    }];
  if (!enumerator) {
    return NO;
  }

  NSMutableSet<NSString *> *actualEntries = [NSMutableSet new];
  NSMutableSet<NSString *> *expectedEntries = [NSMutableSet setWithObject:@"F:manifest.json"];
  for (NSString *path in paths) {
    [expectedEntries addObject:[NSString stringWithFormat:@"F:%@", path]];
    HNSecureAddExpectedParentDirectories(expectedEntries, path);
  }
  for (NSURL *url in enumerator) {
    NSNumber *isDirectory = nil;
    NSNumber *isRegularFile = nil;
    NSNumber *isSymbolicLink = nil;
    NSError *entryError = nil;
    if (![url getResourceValue:&isDirectory forKey:NSURLIsDirectoryKey error:&entryError] ||
        ![url getResourceValue:&isRegularFile forKey:NSURLIsRegularFileKey error:&entryError] ||
        ![url getResourceValue:&isSymbolicLink forKey:NSURLIsSymbolicLinkKey error:&entryError] ||
        entryError || isSymbolicLink.boolValue ||
        ![url.path hasPrefix:[runtimeRootURL.path stringByAppendingString:@"/"]]) {
      return NO;
    }
    NSString *relativePath = [url.path substringFromIndex:runtimeRootURL.path.length + 1];
    if (!HNSecureRuntimeAssetPathIsSafe(relativePath)) {
      return NO;
    }
    if (isDirectory.boolValue) {
      [actualEntries addObject:[NSString stringWithFormat:@"D:%@", relativePath]];
    } else if (isRegularFile.boolValue) {
      [actualEntries addObject:[NSString stringWithFormat:@"F:%@", relativePath]];
    } else {
      return NO;
    }
  }
  return !enumerationError && [actualEntries isEqualToSet:expectedEntries];
}

static BOOL HNSecureRuntimeManifestClosureIsValid(NSURL *runtimeRootURL, NSURL *manifestURL)
{
  NSError *error = nil;
  NSData *manifestData = [NSData dataWithContentsOfURL:manifestURL options:0 error:&error];
  if (!manifestData || error) {
    return NO;
  }
  NSDictionary *manifest = [NSJSONSerialization JSONObjectWithData:manifestData options:0 error:&error];
  NSArray *assets = [manifest isKindOfClass:[NSDictionary class]] ? manifest[@"assets"] : nil;
  NSSet<NSString *> *expectedPaths = HNSecureExpectedRuntimeAssetPaths();
  if (error || ![assets isKindOfClass:[NSArray class]] ||
      assets.count != expectedPaths.count ||
      !HNSecureURLIsRegularNonSymlinkFile(manifestURL)) {
    return NO;
  }

  NSMutableSet<NSString *> *paths = [NSMutableSet new];
  for (NSDictionary *asset in assets) {
    NSString *path = [asset isKindOfClass:[NSDictionary class]] ? asset[@"path"] : nil;
    NSString *sha256 = [asset isKindOfClass:[NSDictionary class]] ? asset[@"sha256"] : nil;
    NSNumber *size = [asset isKindOfClass:[NSDictionary class]] ? asset[@"size"] : nil;
    if (!HNSecureRuntimeAssetPathIsSafe(path) ||
         !HNSecureSHA256IsValid(sha256) ||
         !HNSecureSizeIsValid(size) ||
         [paths containsObject:path]) {
      return NO;
    }

    [paths addObject:path];
    NSURL *assetURL = [runtimeRootURL URLByAppendingPathComponent:path];
    if (!HNSecureURLIsRegularNonSymlinkFile(assetURL)) {
      return NO;
    }
    NSURL *canonicalAssetURL = HNSecureCanonicalFileURL(assetURL);
    if (!canonicalAssetURL || !HNSecurePathIsStrictDescendantOfPath(canonicalAssetURL.path, runtimeRootURL.path)) {
      return NO;
    }
    NSData *contents = [NSData dataWithContentsOfURL:canonicalAssetURL options:0 error:&error];
    if (!contents || error || contents.length != size.unsignedLongLongValue || ![HNSecureSHA256(contents) isEqualToString:sha256]) {
      return NO;
    }
  }
  return [paths isEqualToSet:expectedPaths] &&
    HNSecureRuntimeClosureHasNoExtraFiles(runtimeRootURL, paths);
}

@interface HNSecureWebViewReadAccessPolicy ()
@property (nonatomic, copy, nullable) NSURL *runtimeRootURL;
@property (nonatomic, copy, nullable) NSURL *cacheRootURL;
@end

@implementation HNSecureWebViewReadAccessPolicy

+ (NSURL *)runtimeRootURL
{
  return [self runtimeRootURLInOwnerBundle:[NSBundle bundleForClass:self]];
}

+ (NSURL *)runtimeRootURLInOwnerBundle:(NSBundle *)ownerBundle
{
  NSURL *resourceBundleURL = [ownerBundle URLForResource:HNSecureNativeReaderRuntimeBundleName withExtension:@"bundle"];
  NSBundle *resourceBundle = resourceBundleURL ? [NSBundle bundleWithURL:resourceBundleURL] : nil;
  NSURL *readerURL = [resourceBundle URLForResource:@"reader" withExtension:@"html" subdirectory:HNSecureNativeReaderRuntimeDirectory];
  NSURL *manifestURL = [resourceBundle URLForResource:@"manifest" withExtension:@"json" subdirectory:HNSecureNativeReaderRuntimeDirectory];
  NSURL *runtimeRootURL = HNSecureCanonicalFileURL(readerURL.URLByDeletingLastPathComponent);
  if (!resourceBundleURL || !HNSecureURLIsStrictCanonicalDirectory(resourceBundleURL) ||
      !readerURL || !manifestURL || !runtimeRootURL ||
      !HNSecureURLIsDirectoryNonSymlink(readerURL.URLByDeletingLastPathComponent) ||
      !HNSecureURLIsRegularNonSymlinkFile(readerURL) ||
      ![readerURL.URLByDeletingLastPathComponent isEqual:manifestURL.URLByDeletingLastPathComponent] ||
      !HNSecureRuntimeManifestClosureIsValid(runtimeRootURL, manifestURL)) {
    return nil;
  }
  return runtimeRootURL;
}

- (instancetype)init
{
  NSURL *cachesURL = [[NSFileManager defaultManager]
    URLsForDirectory:NSCachesDirectory
    inDomains:NSUserDomainMask].firstObject;
  NSURL *cacheRootURL = [cachesURL
    URLByAppendingPathComponent:HNSecureNativeReaderCacheDirectory isDirectory:YES];
  return [self initWithRuntimeRootURL:HNSecureWebViewReadAccessPolicy.runtimeRootURL cacheRootURL:cacheRootURL];
}

- (instancetype)initWithRuntimeRootURL:(NSURL *)runtimeRootURL
                          cacheRootURL:(NSURL *)cacheRootURL
{
  if ((self = [super init])) {
    // Keep the pre-resolution check: a runtime-root symlink is invalid even
    // when its target happens to be a safe directory.
    _runtimeRootURL = HNSecureURLIsStrictCanonicalDirectory(runtimeRootURL)
      ? HNSecureCanonicalFileURL(runtimeRootURL)
      : nil;
    _cacheRootURL = HNSecureCanonicalFileURL(cacheRootURL);
  }
  return self;
}

- (NSURL *)readAccessRootForFileURL:(NSURL *)fileURL
{
  if (!fileURL.isFileURL || fileURL.host.length > 0 || !fileURL.path.isAbsolutePath) {
    return nil;
  }

  // Preserve the pre-resolution path so a symlink cannot jump between roots.
  NSURL *standardizedFileURL = [fileURL URLByStandardizingPath];
  NSURL *canonicalFileURL = HNSecureCanonicalFileURL(fileURL);
  if (!canonicalFileURL) {
    return nil;
  }

  NSURL *cacheSessionRootURL = self.cacheRootURL
    ? HNSecureCacheSessionRootForFileURL(standardizedFileURL, canonicalFileURL, self.cacheRootURL)
    : nil;
  if (cacheSessionRootURL) {
    return cacheSessionRootURL;
  }
  // The runtime closure is never a generic file capability. Only
  // canonicalRuntimeHostURL may return its reader.html, after a fresh bundle
  // manifest closure verification and only for the native selector path.
  return nil;
}

- (NSURL *)canonicalFileURLIfAllowed:(NSURL *)fileURL
{
  if (![self readAccessRootForFileURL:fileURL]) {
    return nil;
  }
  return HNSecureCanonicalFileURL(fileURL);
}

- (NSURL *)ordinaryReadAccessRootForFileURL:(NSURL *)fileURL
{
  return [self readAccessRootForFileURL:fileURL];
}

- (NSURL *)canonicalOrdinaryFileURLIfAllowed:(NSURL *)fileURL
{
  return [self ordinaryReadAccessRootForFileURL:fileURL]
    ? HNSecureCanonicalFileURL(fileURL)
    : nil;
}

- (NSURL *)canonicalRuntimeHostURL
{
  NSURL *canonicalRuntimeRootURL = HNSecureCanonicalFileURL(self.runtimeRootURL);
  NSURL *hostURL = [canonicalRuntimeRootURL URLByAppendingPathComponent:@"reader.html"];
  NSURL *manifestURL = [canonicalRuntimeRootURL URLByAppendingPathComponent:@"manifest.json"];
  // The root originated in bundleForClass validation. Recheck its concrete
  // filesystem identity here because this method is the final native-only
  // capability grant immediately before WKWebView receives the URL.
  if (!canonicalRuntimeRootURL ||
      !HNSecureURLIsStrictCanonicalDirectory(canonicalRuntimeRootURL) ||
      !HNSecureURLIsRegularNonSymlinkFile(hostURL) ||
      !HNSecureRuntimeManifestClosureIsValid(canonicalRuntimeRootURL, manifestURL) ||
      ![hostURL.URLByDeletingLastPathComponent isEqual:canonicalRuntimeRootURL]) {
    return nil;
  }
  return hostURL;
}

@end
