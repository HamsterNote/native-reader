#import "HNSecureFoliateHostRelay.h"
#import <math.h>

NSString *const HNSecureFoliateHostHandlerName = @"hnFoliateHostRelayV1";
static NSString *const HNSecureFoliateHostProtocol = @"hn-foliate-host";
static const NSUInteger HNSecureFoliateHostNormalMessageBytes = 8 * 1024;
static const NSUInteger HNSecureFoliateHostModelMessageBytes = 2 * 1024 * 1024;
static const double HNSecureFoliateHostMaximumInteger = 9007199254740991.0;
static const NSTimeInterval HNSecureFoliateHostPreflightTimeout = 1.5;
static const NSTimeInterval HNSecureFoliateHostRelayHandshakeTimeout = 0.35;

static BOOL HNSecureFoliateHostIsDictionary(id value)
{
  return [value isKindOfClass:[NSDictionary class]];
}

static BOOL HNSecureFoliateHostHasOnlyKeys(id value, NSArray<NSString *> *keys)
{
  if (!HNSecureFoliateHostIsDictionary(value)) return NO;
  NSDictionary *dictionary = value;
  return dictionary.count == keys.count &&
    [[NSSet setWithArray:dictionary.allKeys] isEqualToSet:[NSSet setWithArray:keys]];
}

static BOOL HNSecureFoliateHostIsInteger(id value)
{
  if (![value isKindOfClass:[NSNumber class]] ||
      CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) return NO;
  double number = [value doubleValue];
  return isfinite(number) && floor(number) == number && number >= 0 &&
    number <= HNSecureFoliateHostMaximumInteger;
}

static BOOL HNSecureFoliateHostIsString(id value, NSUInteger maximum)
{
  if (![value isKindOfClass:[NSString class]] || [(NSString *)value length] > maximum) return NO;
  NSString *string = value;
  for (NSUInteger index = 0; index < string.length; index += 1) {
    unichar character = [string characterAtIndex:index];
    if (CFStringIsSurrogateHighCharacter(character)) {
      if (index + 1 >= string.length ||
          !CFStringIsSurrogateLowCharacter([string characterAtIndex:index + 1])) return NO;
      index += 1;
    } else if (CFStringIsSurrogateLowCharacter(character)) {
      return NO;
    }
  }
  return YES;
}

static BOOL HNSecureFoliateHostMatchesDestination(id value)
{
  return [value isKindOfClass:[NSString class]] &&
    [(NSString *)value rangeOfString:@"^d:[0-9]+$" options:NSRegularExpressionSearch].location != NSNotFound;
}

static BOOL HNSecureFoliateHostIsSession(id value)
{
  return [value isKindOfClass:[NSString class]] && [(NSString *)value length] == 43 &&
    [(NSString *)value rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"] invertedSet]].location == NSNotFound;
}

// NSJSONSerialization normalizes numeric spellings and duplicate object keys.
// Reject non-canonical numbers, blocked names, and duplicates before parsing.
static BOOL HNSecureFoliateHostHasUnsafeJSONSyntax(NSString *data)
{
  NSMutableArray<NSMutableSet<NSString *> *> *objectKeys = [NSMutableArray new];
  BOOL inString = NO;
  BOOL escaped = NO;
  NSUInteger length = data.length;
  NSUInteger depth = 0;
  for (NSUInteger index = 0; index < length; index += 1) {
    unichar character = [data characterAtIndex:index];
    if (inString) {
      if (!escaped && character == '"') inString = NO;
      escaped = !escaped && character == '\\';
      if (character != '\\') escaped = NO;
      continue;
    }
    if (character == '"') {
      NSUInteger start = index;
      BOOL stringEscaped = NO;
      index += 1;
      for (; index < length; index += 1) {
        unichar next = [data characterAtIndex:index];
        if (!stringEscaped && next == '"') break;
        stringEscaped = !stringEscaped && next == '\\';
        if (next != '\\') stringEscaped = NO;
      }
      if (index >= length) return YES;
      NSUInteger cursor = index + 1;
      while (cursor < length && [[NSCharacterSet whitespaceAndNewlineCharacterSet] characterIsMember:[data characterAtIndex:cursor]]) cursor += 1;
      if (cursor < length && [data characterAtIndex:cursor] == ':' && objectKeys.count) {
        NSString *raw = [data substringWithRange:NSMakeRange(start, index - start + 1)];
        NSData *stringJSON = [[NSString stringWithFormat:@"[%@]", raw] dataUsingEncoding:NSUTF8StringEncoding];
        NSArray *decoded = [NSJSONSerialization JSONObjectWithData:stringJSON options:0 error:nil];
        NSString *key = decoded.firstObject;
        if (![key isKindOfClass:[NSString class]] ||
            [@[ @"__proto__", @"constructor", @"prototype" ] containsObject:key] ||
            [objectKeys.lastObject containsObject:key]) return YES;
        [objectKeys.lastObject addObject:key];
      }
      continue;
    }
    if (character == '{' || character == '[') {
      if (++depth > 40) return YES;
    } else if (character == '}' || character == ']') {
      if (depth == 0) return YES;
      depth -= 1;
    }
    if (character == '{') {
      [objectKeys addObject:[NSMutableSet new]];
      continue;
    }
    if (character == '}') {
      if (objectKeys.count) [objectKeys removeLastObject];
      continue;
    }
    if (character == '-') return YES;
    if (character >= '0' && character <= '9') {
      NSUInteger start = index;
      while (index + 1 < length) {
        unichar next = [data characterAtIndex:index + 1];
        if (next < '0' || next > '9') break;
        index += 1;
      }
      NSString *number = [data substringWithRange:NSMakeRange(start, index - start + 1)];
      if (number.length > 16 || (number.length == 16 && [number compare:@"9007199254740991"] == NSOrderedDescending)) return YES;
      if (([data characterAtIndex:start] == '0' && index != start) ||
          (index + 1 < length &&
           ([data characterAtIndex:index + 1] == '.' || [data characterAtIndex:index + 1] == 'e' || [data characterAtIndex:index + 1] == 'E'))) return YES;
    }
  }
  return inString || objectKeys.count != 0;
}

static BOOL HNSecureFoliateTransferIsValid(NSDictionary *message)
{
  if (!HNSecureFoliateHostHasOnlyKeys(message, @[@"protocol", @"version", @"session", @"generation", @"transferId", @"commandId", @"type", @"payload"]) ||
      ![message[@"protocol"] isEqual:@"hn-foliate-transfer"] || !HNSecureFoliateHostIsInteger(message[@"version"]) || ![message[@"version"] isEqual:@1] ||
      !HNSecureFoliateHostIsSession(message[@"session"]) || !HNSecureFoliateHostIsSession(message[@"generation"]) ||
      !HNSecureFoliateHostIsSession(message[@"transferId"]) || !HNSecureFoliateHostIsSession(message[@"commandId"]) ||
      !HNSecureFoliateHostIsDictionary(message[@"payload"])) return NO;
  NSDictionary *p = message[@"payload"];
  NSString *type = message[@"type"];
  if ([type isEqual:@"abort"]) return HNSecureFoliateHostHasOnlyKeys(p, @[]);
  if ([type isEqual:@"commit"]) return HNSecureFoliateHostHasOnlyKeys(p, @[@"chunks"]) &&
      HNSecureFoliateHostIsInteger(p[@"chunks"]) && [p[@"chunks"] unsignedLongLongValue] > 0 && [p[@"chunks"] unsignedLongLongValue] <= 683;
  if ([type isEqual:@"chunk"]) return HNSecureFoliateHostHasOnlyKeys(p, @[@"sequence", @"data"]) &&
      HNSecureFoliateHostIsInteger(p[@"sequence"]) && [p[@"sequence"] unsignedLongLongValue] < 683 &&
      HNSecureFoliateHostIsString(p[@"data"], 65536) && [p[@"data"] length] > 0 && [p[@"data"] length] % 4 == 0 &&
      [p[@"data"] rangeOfString:@"^[A-Za-z0-9+/]*={0,2}$" options:NSRegularExpressionSearch].location != NSNotFound;
  if (![type isEqual:@"begin"] || !HNSecureFoliateHostHasOnlyKeys(p, @[@"byteLength", @"sha256", @"chunkBytes", @"format", @"name", @"mimeType"]) ||
      !HNSecureFoliateHostIsInteger(p[@"byteLength"]) || [p[@"byteLength"] unsignedLongLongValue] < 1 || [p[@"byteLength"] unsignedLongLongValue] > 33554432 ||
      !HNSecureFoliateHostIsInteger(p[@"chunkBytes"]) || ![p[@"chunkBytes"] isEqual:@49152] || !HNSecureFoliateHostIsString(p[@"sha256"], 64) ||
      [p[@"sha256"] length] != 64 || [p[@"sha256"] rangeOfString:@"^[a-f0-9]{64}$" options:NSRegularExpressionSearch].location == NSNotFound) return NO;
  NSDictionary *tuples = @{
    @"epub": @[@"book.epub", @"application/epub+zip"], @"mobi": @[@"book.mobi", @"application/x-mobipocket-ebook"],
    @"kf8-azw3": @[@"book.azw3", @"application/vnd.amazon.ebook"], @"fb2": @[@"book.fb2", @"application/x-fictionbook+xml"],
    @"fbz": @[@"book.fbz", @"application/x-zip-compressed-fb2"], @"cbz": @[@"book.cbz", @"application/vnd.comicbook+zip"]
  };
  if (![p[@"format"] isKindOfClass:NSString.class]) return NO;
  NSArray *tuple = tuples[p[@"format"]];
  return tuple && [p[@"name"] isEqual:tuple[0]] && [p[@"mimeType"] isEqual:tuple[1]];
}

static BOOL HNSecureFoliateHostPayloadIsValid(NSString *direction, NSString *type, id payload)
{
  if (!HNSecureFoliateHostIsDictionary(payload)) return NO;
  NSDictionary *dictionary = payload;
  if ([direction isEqualToString:@"native-to-host"]) {
    if ([type isEqualToString:@"bind"] || [type isEqualToString:@"dispose"] || [type isEqualToString:@"probe"])
      return HNSecureFoliateHostHasOnlyKeys(dictionary, @[]);
    if ([type isEqualToString:@"transfer"]) return HNSecureFoliateTransferIsValid(dictionary);
    if ([type isEqualToString:@"navigate"])
      return HNSecureFoliateHostHasOnlyKeys(dictionary, @[ @"target" ]) &&
        (HNSecureFoliateHostIsInteger(dictionary[@"target"]) || HNSecureFoliateHostMatchesDestination(dictionary[@"target"]));
    return [type isEqualToString:@"flow"] &&
      HNSecureFoliateHostHasOnlyKeys(dictionary, @[ @"flow" ]) &&
      ([dictionary[@"flow"] isEqual:@"scrolled"] || [dictionary[@"flow"] isEqual:@"paginated"]);
  }
  if ([type isEqualToString:@"ack"])
    return HNSecureFoliateHostHasOnlyKeys(dictionary, @[ @"command", @"status" ]) &&
      [@[ @"bind", @"probe", @"transfer", @"navigate", @"flow", @"dispose" ] containsObject:dictionary[@"command"]] &&
      (([dictionary[@"command"] isEqual:@"bind"] && [dictionary[@"status"] isEqual:@"bridge-bound"]) ||
       ([dictionary[@"command"] isEqual:@"probe"] && [dictionary[@"status"] isEqual:@"source-authorized"]) ||
       ([dictionary[@"command"] isEqual:@"transfer"] && [@[@"accepted", @"ready", @"aborted"] containsObject:dictionary[@"status"]]) ||
       ([@[@"navigate", @"flow"] containsObject:dictionary[@"command"]] && [dictionary[@"status"] isEqual:@"applied"]) ||
       (![dictionary[@"command"] isEqual:@"bind"] &&
        ([dictionary[@"status"] isEqual:@"not-ready"] || [dictionary[@"status"] isEqual:@"unsupported"])));
  if ([type isEqualToString:@"error"])
    return HNSecureFoliateHostHasOnlyKeys(dictionary, @[ @"code", @"terminal" ]) &&
      [@[ @"protocol-violation", @"not-ready", @"unsupported", @"render-failure", @"navigation-failure" ] containsObject:dictionary[@"code"]] &&
      [dictionary[@"terminal"] isKindOfClass:[NSNumber class]] &&
      CFGetTypeID((__bridge CFTypeRef)dictionary[@"terminal"]) == CFBooleanGetTypeID();
  if ([type isEqualToString:@"location"])
    return HNSecureFoliateHostHasOnlyKeys(dictionary, @[ @"section", @"destination" ]) &&
      HNSecureFoliateHostIsInteger(dictionary[@"section"]) &&
      (dictionary[@"destination"] == NSNull.null || HNSecureFoliateHostMatchesDestination(dictionary[@"destination"]));

  id modelValue = dictionary[@"model"];
  if (![type isEqualToString:@"model"] || !HNSecureFoliateHostHasOnlyKeys(dictionary, @[ @"model" ]) ||
      !HNSecureFoliateHostIsDictionary(modelValue)) return NO;
  NSDictionary *model = modelValue;
  if (!HNSecureFoliateHostHasOnlyKeys(model, @[ @"modelVersion", @"format", @"fixedLayout", @"flow", @"direction", @"metadata", @"sections", @"toc", @"destinations" ]) ||
      !HNSecureFoliateHostIsInteger(model[@"modelVersion"]) || [model[@"modelVersion"] unsignedLongLongValue] != 1 ||
      ![@[ @"epub", @"mobi", @"kf8-azw3", @"fb2", @"fbz", @"cbz" ] containsObject:model[@"format"]] ||
      ![model[@"fixedLayout"] isKindOfClass:[NSNumber class]] ||
      CFGetTypeID((__bridge CFTypeRef)model[@"fixedLayout"]) != CFBooleanGetTypeID() ||
      !([model[@"flow"] isEqual:NSNull.null] || [@[ @"scrolled", @"paginated" ] containsObject:model[@"flow"]]) ||
      !([model[@"direction"] isEqual:NSNull.null] || [@[ @"ltr", @"rtl" ] containsObject:model[@"direction"]]) ||
      !HNSecureFoliateHostHasOnlyKeys(model[@"metadata"], @[ @"title" ]) ||
      !([model[@"metadata"][@"title"] isEqual:NSNull.null] || HNSecureFoliateHostIsString(model[@"metadata"][@"title"], 1024)) ||
      ![model[@"sections"] isKindOfClass:[NSArray class]] || ![model[@"toc"] isKindOfClass:[NSArray class]] ||
      ![model[@"destinations"] isKindOfClass:[NSArray class]] || [model[@"sections"] count] > 10000 ||
      [model[@"toc"] count] > 10000 || [model[@"destinations"] count] > 10000 ||
      ([model[@"fixedLayout"] boolValue] && ![model[@"flow"] isEqual:NSNull.null]) ||
      (![model[@"fixedLayout"] boolValue] && ![@[ @"scrolled", @"paginated" ] containsObject:model[@"flow"]])) return NO;

  NSMutableSet<NSString *> *sectionIDs = [NSMutableSet new];
  NSMutableDictionary<NSString *, NSNumber *> *sectionIndexes = [NSMutableDictionary new];
  for (NSUInteger index = 0; index < [model[@"sections"] count]; index += 1) {
    id value = model[@"sections"][index];
    if (!HNSecureFoliateHostHasOnlyKeys(value, @[ @"id", @"index", @"linear" ])) return NO;
    NSDictionary *section = value;
    if (!HNSecureFoliateHostIsString(section[@"id"], 64) || !HNSecureFoliateHostIsInteger(section[@"index"]) ||
        [section[@"index"] unsignedLongLongValue] != index || [sectionIDs containsObject:section[@"id"]] ||
        ![section[@"linear"] isKindOfClass:[NSNumber class]] ||
        CFGetTypeID((__bridge CFTypeRef)section[@"linear"]) != CFBooleanGetTypeID()) return NO;
    [sectionIDs addObject:section[@"id"]];
    sectionIndexes[section[@"id"]] = section[@"index"];
  }
  NSMutableSet<NSString *> *destinationIDs = [NSMutableSet new];
  for (id value in model[@"destinations"]) {
    if (!HNSecureFoliateHostHasOnlyKeys(value, @[ @"id", @"sectionId", @"sectionIndex" ])) return NO;
    NSDictionary *destination = value;
    NSString *sectionID = destination[@"sectionId"];
    if (!HNSecureFoliateHostIsString(destination[@"id"], 64) || !HNSecureFoliateHostMatchesDestination(destination[@"id"]) || !HNSecureFoliateHostIsString(sectionID, 64) ||
        ![sectionIDs containsObject:sectionID] || !HNSecureFoliateHostIsInteger(destination[@"sectionIndex"]) ||
        ![sectionIndexes[sectionID] isEqual:destination[@"sectionIndex"]] || [destinationIDs containsObject:destination[@"id"]]) return NO;
    [destinationIDs addObject:destination[@"id"]];
  }
  NSMutableArray<NSDictionary *> *pendingNodes = [NSMutableArray new];
  for (id node in model[@"toc"]) [pendingNodes addObject:@{ @"node": node, @"depth": @1 }];
  NSMutableSet<NSString *> *tocIDs = [NSMutableSet new];
  while (pendingNodes.count) {
    NSDictionary *entry = pendingNodes.lastObject;
    [pendingNodes removeLastObject];
    id value = entry[@"node"];
    if (!HNSecureFoliateHostHasOnlyKeys(value, @[ @"id", @"label", @"destinationId", @"subitems" ])) return NO;
    NSDictionary *node = value;
    if (!HNSecureFoliateHostIsString(node[@"id"], 64) || !HNSecureFoliateHostIsString(node[@"label"], 2048) ||
        !([node[@"destinationId"] isEqual:NSNull.null] || [destinationIDs containsObject:node[@"destinationId"]]) ||
        ![node[@"subitems"] isKindOfClass:[NSArray class]] || [tocIDs containsObject:node[@"id"]] ||
        [entry[@"depth"] unsignedIntegerValue] > 32 || tocIDs.count >= 10000) return NO;
    [tocIDs addObject:node[@"id"]];
    for (id child in node[@"subitems"]) [pendingNodes addObject:@{ @"node": child, @"depth": @([entry[@"depth"] unsignedIntegerValue] + 1) }];
  }
  return YES;
}

static NSDictionary *HNSecureFoliateHostScan(NSString *data)
{
  @try {
    NSData *encoded = [data isKindOfClass:[NSString class]] ? [data dataUsingEncoding:NSUTF8StringEncoding] : nil;
    if (!encoded || encoded.length > HNSecureFoliateHostModelMessageBytes || HNSecureFoliateHostHasUnsafeJSONSyntax(data)) return nil;
    NSError *error = nil;
    id value = [NSJSONSerialization JSONObjectWithData:encoded options:0 error:&error];
    return !error && HNSecureFoliateHostIsDictionary(value) ? value : nil;
  } @catch (__unused NSException *exception) { return nil; }
}

static BOOL HNSecureFoliateHostHasStaleIdentity(NSDictionary *message, NSString *direction, NSString *session, NSString *generation)
{
  if (!message) return NO;
  id actualDirection = message[@"direction"];
  return (actualDirection && [@[ @"native-to-host", @"host-to-native" ] containsObject:actualDirection] && ![direction isEqual:actualDirection]) ||
    (session && HNSecureFoliateHostIsSession(message[@"session"]) && ![session isEqual:message[@"session"]]) ||
    (generation && HNSecureFoliateHostIsSession(message[@"generation"]) && ![generation isEqual:message[@"generation"]]);
}

static NSDictionary *HNSecureFoliateHostValidate(NSDictionary *value, NSString *data)
{
  @try {
    if (!value) return nil;
    NSData *encoded = [data dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *message = value;
    if (!HNSecureFoliateHostHasOnlyKeys(message, @[ @"protocol", @"version", @"direction", @"type", @"session", @"generation", @"commandId", @"payload" ]) ||
        ![message[@"protocol"] isEqual:HNSecureFoliateHostProtocol] || !HNSecureFoliateHostIsInteger(message[@"version"]) || [message[@"version"] unsignedLongLongValue] != 1 ||
        ![message[@"direction"] isKindOfClass:[NSString class]] || ![message[@"type"] isKindOfClass:[NSString class]] ||
        !HNSecureFoliateHostIsSession(message[@"session"]) || !HNSecureFoliateHostIsSession(message[@"generation"]) || !HNSecureFoliateHostIsSession(message[@"commandId"])) return nil;
    NSString *direction = message[@"direction"];
    NSString *type = message[@"type"];
    BOOL nativeCommand = [@[ @"bind", @"probe", @"transfer", @"navigate", @"flow", @"dispose" ] containsObject:type];
    BOOL hostEvent = [@[ @"ack", @"error", @"model", @"location" ] containsObject:type];
    if ((!([direction isEqual:@"native-to-host"] && nativeCommand) && !([direction isEqual:@"host-to-native"] && hostEvent)) ||
        !HNSecureFoliateHostPayloadIsValid(direction, type, message[@"payload"])) return nil;
    if ([type isEqual:@"transfer"] && (![message[@"session"] isEqual:message[@"payload"][@"session"]] ||
        ![message[@"generation"] isEqual:message[@"payload"][@"generation"]] || ![message[@"commandId"] isEqual:message[@"payload"][@"commandId"]])) return nil;
    NSUInteger limit = [type isEqual:@"model"] ? HNSecureFoliateHostModelMessageBytes : ([type isEqual:@"transfer"] ? 70 * 1024 : HNSecureFoliateHostNormalMessageBytes);
    return encoded.length <= limit ? message : nil;
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

static NSDictionary *HNSecureFoliateHostParse(NSString *data)
{
  return HNSecureFoliateHostValidate(HNSecureFoliateHostScan(data), data);
}

@interface HNSecureFoliateHostRelay ()
@property (nonatomic, weak) WKWebView *webView;
@property (nonatomic, copy) NSURL *hostURL;
@property (nonatomic, copy) NSString *session;
@property (nonatomic, copy) NSString *generation;
@property (nonatomic, copy) NSString *lastCommandID;
@property (nonatomic, strong) NSMutableSet<NSString *> *usedCommandIDs;
@property (nonatomic, copy) NSString *lastCommandType;
@property (nonatomic, copy, nullable) NSString *inflightCommandID;
@property (nonatomic, strong) WKContentWorld *contentWorld API_AVAILABLE(ios(14.0));
@property (nonatomic, assign, getter=isActive) BOOL active;
@property (nonatomic, assign, getter=didPassInitialCSPPreflight) BOOL initialCSPPreflightPassed;
@property (nonatomic, assign, getter=isTerminal) BOOL terminal;
@property (nonatomic, assign) BOOL sourceAuthorized;
@property (nonatomic, assign) BOOL preflightActive;
@property (nonatomic, copy) NSString *preflightToken;
@property (nonatomic, assign) NSUInteger preflightPermitsRemaining;
@property (nonatomic, copy) void (^preflightCompletion)(BOOL passed);
@property (nonatomic, strong) NSTimer *preflightTimer;
@end

@implementation HNSecureFoliateHostRelay

+ (BOOL)validateHostMessageData:(NSString *)data
{
  return HNSecureFoliateHostParse(data) != nil;
}

- (void)terminate
{
  [self abortInitialCSPPreflight];
  _active = NO;
  _initialCSPPreflightPassed = NO;
  _terminal = YES;
  _webView = nil;
  _hostURL = nil;
  _session = nil;
  _generation = nil;
  _lastCommandID = nil;
  _usedCommandIDs = nil;
  _lastCommandType = nil;
  _inflightCommandID = nil;
}

- (void)installInUserContentController:(WKUserContentController *)controller
{
  if (@available(iOS 14.0, *)) {
    if (!_contentWorld) _contentWorld = [WKContentWorld worldWithName:@"hn-foliate-host"];
    // This is a transport adapter only. bootstrap.js retains the sole lexical
    // endpoint and command ledger; neither the page world nor native forges ACKs.
    NSString *relayScript = @"(async()=>{'use strict';const h=window.webkit.messageHandlers.hnFoliateHostRelayV1;let listener=null;const port={postMessage(data){h.postMessage(String(data));},addEventListener(type,fn){if(type==='message'&&!listener)listener=fn;},removeEventListener(type,fn){if(type==='message'&&listener===fn)listener=null;},start(){},close(){listener=null;}};try{const bridge=await import('./bootstrap.js');if(typeof bridge.installFoliateNativeHostBridge!=='function'||bridge.installFoliateNativeHostBridge(port)!==true)throw new Error('bridge');globalThis.__hnFoliateHostRelayV1Receive=data=>{if(typeof data!=='string'||!listener)return false;listener({data});return true;};globalThis.__hnFoliateHostRelayV1Ready=true;}catch(_){globalThis.__hnFoliateHostRelayV1Ready=false;}})();";
    WKUserScript *script = [[WKUserScript alloc] initWithSource:relayScript injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES inContentWorld:_contentWorld];
    [controller addUserScript:script];
    [controller addScriptMessageHandler:self contentWorld:_contentWorld name:HNSecureFoliateHostHandlerName];
  }
}

- (void)removeFromUserContentController:(WKUserContentController *)controller
{
  if (@available(iOS 14.0, *)) {
    if (_contentWorld) [controller removeScriptMessageHandlerForName:HNSecureFoliateHostHandlerName contentWorld:_contentWorld];
  }
}

- (void)activateForWebView:(WKWebView *)webView hostURL:(NSURL *)hostURL
{
  [self deactivate];
  if (!webView || !hostURL.isFileURL || hostURL.host.length || !hostURL.path.isAbsolutePath) return;
  if (@available(iOS 14.0, *)) {
    _webView = webView;
    _hostURL = [hostURL copy];
    _active = YES;
  }
}

- (void)deactivate
{
  [self abortInitialCSPPreflight];
  _active = NO;
  _initialCSPPreflightPassed = NO;
  _terminal = NO;
  _webView = nil;
  _hostURL = nil;
  _session = nil;
  _lastCommandID = nil;
  _usedCommandIDs = [NSMutableSet new];
  _lastCommandType = nil;
  _inflightCommandID = nil;
}

- (void)cleanupInitialCSPPreflightArtifacts
{
  if (!self.webView || !self.contentWorld) return;
  NSString *script = @"(()=>{const p=globalThis.__hnFoliateHostRelayV1Preflight;if(!p)return;for(const frame of p.frames||[])frame.remove();for(const url of p.urls||[])URL.revokeObjectURL(url);delete globalThis.__hnFoliateHostRelayV1Preflight;})()";
  if (@available(iOS 14.0, *)) {
    [self.webView evaluateJavaScript:script inFrame:nil inContentWorld:self.contentWorld completionHandler:nil];
  }
}

- (void)finishInitialCSPPreflight:(BOOL)passed
{
  if (!self.preflightActive) return;
  _preflightActive = NO;
  [_preflightTimer invalidate];
  _preflightTimer = nil;
  [self cleanupInitialCSPPreflightArtifacts];
  void (^completion)(BOOL) = _preflightCompletion;
  _preflightCompletion = nil;
  _preflightToken = nil;
  _preflightPermitsRemaining = 0;
  BOOL accepted = passed && self.active && !self.terminal && [self isExpectedHostURL:self.webView.URL];
  if (accepted) {
    _initialCSPPreflightPassed = YES;
  } else {
    // The outer secure host lock remains selected in HNSecureWebViewImpl; only
    // this private relay becomes terminal and unusable after a failed probe.
    _active = NO;
    _initialCSPPreflightPassed = NO;
    _terminal = YES;
    _session = nil;
    _lastCommandType = nil;
    _inflightCommandID = nil;
  }
  if (completion) completion(accepted);
}

- (BOOL)shouldPermitInitialCSPPreflightNavigationURL:(NSURL *)URL
                                         isMainFrame:(BOOL)isMainFrame
{
  // Foundation 对 `blob:` 这类不透明 URL 不再填充 fragment（iOS 26 实测为 nil），
  // 因此这里从 absoluteString 取最后一个 '#' 之后的内容做精确比较。语义不变：
  // 只有携带当前私有 token 的 blob 导航可能被放行，且仍然只放行两次。
  NSRange separator = [URL.absoluteString rangeOfString:@"#" options:NSBackwardsSearch];
  NSString *fragment = separator.location == NSNotFound
    ? nil
    : [URL.absoluteString substringFromIndex:NSMaxRange(separator)];
  if (!self.preflightActive || isMainFrame || self.preflightPermitsRemaining == 0 ||
      ![URL.scheme isEqualToString:@"blob"] || self.preflightToken.length == 0 ||
      ![fragment isEqualToString:self.preflightToken]) return NO;
  // Exactly the control and strict probe documents may navigate. A third blob
  // request, even with the private token, is rejected and ends the preflight.
  _preflightPermitsRemaining -= 1;
  return YES;
}

- (void)abortInitialCSPPreflight
{
  [self finishInitialCSPPreflight:NO];
}

- (BOOL)isExpectedHostURL:(NSURL *)URL
{
  return self.active && URL.isFileURL && URL.host.length == 0 && [URL isEqual:self.hostURL];
}

- (BOOL)applyNativeCommand:(NSDictionary *)message
{
  NSString *type = message[@"type"];
  NSString *commandID = message[@"commandId"];
  if (!self.session) {
    if (![type isEqual:@"bind"]) {
      [self terminate];
      return NO;
    }
    _session = [message[@"session"] copy];
    _generation = [message[@"generation"] copy];
    _lastCommandID = commandID;
    _usedCommandIDs = [NSMutableSet setWithObject:commandID];
    _lastCommandType = type;
    _inflightCommandID = commandID;
    return YES;
  }
  if (![self.session isEqual:message[@"session"]] || ![self.generation isEqual:message[@"generation"]]) return NO;
  if ([self.usedCommandIDs containsObject:commandID]) return NO;
  BOOL abort = [type isEqual:@"transfer"] && [message[@"payload"][@"type"] isEqual:@"abort"];
  if ([type isEqual:@"bind"] || ([type isEqual:@"transfer"] && !self.sourceAuthorized) ||
      (self.inflightCommandID && ![type isEqual:@"dispose"] && !abort)) {
    [self terminate];
    return NO;
  }
  if (self.usedCommandIDs.count >= 4096) {
    [self terminate];
    return NO;
  }
  _lastCommandID = commandID;
  [self.usedCommandIDs addObject:commandID];
  _lastCommandType = type;
  _inflightCommandID = commandID;
  return YES;
}

- (BOOL)sendNativeMessageData:(NSString *)data
{
  if (!self.active || self.terminal || !self.initialCSPPreflightPassed) return NO;
  if (![self isExpectedHostURL:self.webView.URL]) {
    // A committed replacement document must never inherit this relay.
    [self terminate];
    return NO;
  }
  NSDictionary *scanned = HNSecureFoliateHostScan(data);
  if (HNSecureFoliateHostHasStaleIdentity(scanned, @"native-to-host", self.session, self.generation)) return NO;
  NSDictionary *message = HNSecureFoliateHostValidate(scanned, data);
  if (!message || ![message[@"direction"] isEqual:@"native-to-host"]) {
    [self terminate];
    return NO;
  }
  if (![self applyNativeCommand:message]) return NO;
  // 顶层 JSON 片段（这里是 wire 字符串本身）必须显式声明 fragments，否则
  // NSJSONSerialization 会以 “Invalid top-level type” 抛异常而不是返回引号字符串。
  NSData *quoted = [NSJSONSerialization dataWithJSONObject:data options:NSJSONWritingFragmentsAllowed error:nil];
  NSString *argument = [[NSString alloc] initWithData:quoted encoding:NSUTF8StringEncoding];
  NSString *script = [NSString stringWithFormat:@"Boolean(globalThis.__hnFoliateHostRelayV1Ready&&globalThis.__hnFoliateHostRelayV1Receive&&globalThis.__hnFoliateHostRelayV1Receive(%@))", argument];
  if (@available(iOS 14.0, *)) {
    __weak HNSecureFoliateHostRelay *weakSelf = self;
    [self.webView evaluateJavaScript:script inFrame:nil inContentWorld:self.contentWorld completionHandler:^(id result, NSError *error) {
      HNSecureFoliateHostRelay *strongSelf = weakSelf;
      if (!strongSelf || error || ![result isKindOfClass:[NSNumber class]] || ![result boolValue]) [strongSelf terminate];
    }];
    return YES;
  }
  [self terminate];
  return NO;
}

- (BOOL)acceptMessageData:(NSString *)data frameIsMain:(BOOL)frameIsMain securityProtocol:(NSString *)securityProtocol securityHost:(NSString *)securityHost securityPort:(NSInteger)securityPort currentURL:(NSURL *)currentURL
{
  if (!self.active || self.terminal || !frameIsMain || ![securityProtocol isEqual:@"file"] || securityHost.length != 0 || securityPort != 0 || ![self isExpectedHostURL:currentURL] || ![self isExpectedHostURL:self.webView.URL]) return NO;
  NSDictionary *scanned = HNSecureFoliateHostScan(data);
  if (HNSecureFoliateHostHasStaleIdentity(scanned, @"host-to-native", self.session, self.generation)) return NO;
  NSDictionary *message = HNSecureFoliateHostValidate(scanned, data);
  if (!message || ![message[@"direction"] isEqual:@"host-to-native"]) {
    [self terminate];
    return NO;
  }
  if (![self.session isEqual:message[@"session"]] || ![self.generation isEqual:message[@"generation"]]) return NO;
  NSString *type = message[@"type"];
  NSString *commandID = message[@"commandId"];
  BOOL terminalAfterDelivery = NO;
  if ([type isEqual:@"model"] || [type isEqual:@"location"]) {
    if (![commandID isEqual:self.lastCommandID]) return NO;
  } else {
    // Old/duplicate IDs are inert. A current-ID event that violates the closed
    // command semantics is terminal, matching the shared command ledger.
    if (![commandID isEqual:self.inflightCommandID]) return NO;
    if ([type isEqual:@"ack"]) {
      if (![message[@"payload"][@"command"] isEqual:self.lastCommandType]) {
        [self terminate];
        return NO;
      }
      if ([self.lastCommandType isEqual:@"probe"]) _sourceAuthorized = [message[@"payload"][@"status"] isEqual:@"source-authorized"];
      _inflightCommandID = nil;
      terminalAfterDelivery = [self.lastCommandType isEqual:@"dispose"];
    } else {
      _inflightCommandID = nil;
      terminalAfterDelivery = [message[@"payload"][@"terminal"] boolValue];
    }
  }
  if (self.onAcceptedMessage) self.onAcceptedMessage(data);
  if (terminalAfterDelivery) [self terminate];
  return YES;
}

- (void)userContentController:(WKUserContentController *)userContentController didReceiveScriptMessage:(WKScriptMessage *)message
{
  if (![message.name isEqual:HNSecureFoliateHostHandlerName] || ![message.body isKindOfClass:[NSString class]] || message.webView != self.webView) return;
  if (@available(iOS 14.0, *)) {
    if (![message.world isEqual:self.contentWorld]) return;
  } else {
    return;
  }
  WKFrameInfo *frame = message.frameInfo;
  NSURL *frameURL = frame.request.URL;
  WKSecurityOrigin *origin = frame.securityOrigin;
  if (!frame.isMainFrame || ![self isExpectedHostURL:frameURL] || ![self isExpectedHostURL:self.webView.URL]) return;
  [self acceptMessageData:message.body frameIsMain:YES securityProtocol:origin.protocol securityHost:origin.host securityPort:origin.port currentURL:frameURL];
}

- (void)runInitialCSPPreflightWithCompletion:(void (^)(BOOL))completion
{
  if (!self.active || self.terminal || ![self isExpectedHostURL:self.webView.URL]) { completion(NO); return; }
  if (@available(iOS 14.0, *)) {
    // Continue below on platforms that have named content worlds.
  } else {
    completion(NO);
    return;
  }
  if (self.preflightActive) { completion(NO); return; }
  _preflightActive = YES;
  _preflightToken = [NSString stringWithFormat:@"hn-foliate-csp-%@", NSUUID.UUID.UUIDString];
  _preflightPermitsRemaining = 2;
  _preflightCompletion = [completion copy];
  __weak HNSecureFoliateHostRelay *weakSelf = self;
  _preflightTimer = [NSTimer scheduledTimerWithTimeInterval:HNSecureFoliateHostPreflightTimeout repeats:NO block:^(__unused NSTimer *timer) {
    [weakSelf finishInitialCSPPreflight:NO];
  }];
  NSString *tokenJSON = [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:self.preflightToken options:NSJSONWritingFragmentsAllowed error:nil] encoding:NSUTF8StringEncoding];
  // Both frames navigate to native-created blob: URLs, which host CSP permits.
  // Only control permits its external blob script; strict shares the exact
  // source but has script-src 'none', producing an observable DOM difference.
  NSString *script = [NSString stringWithFormat:@"(async()=>{const token=%@,root=document.body||document.documentElement,wait=Date.now()+%llu;if(!root)return false;while(!globalThis.__hnFoliateHostRelayV1Ready&&Date.now()<wait)await new Promise(r=>setTimeout(r,10));if(!globalThis.__hnFoliateHostRelayV1Ready)return false;const urls=[];const makeURL=(text,type)=>{const url=URL.createObjectURL(new Blob([text],{type}));urls.push(url);return url;};const probe=makeURL('document.documentElement.setAttribute(\\\"data-hn-csp-probe\\\",'+JSON.stringify(token)+');','text/javascript');const html=strict=>makeURL('<!doctype html><meta http-equiv=\\\"Content-Security-Policy\\\" content=\\\"default-src \\\'none\\\'; script-src '+(strict?\\\"\\\'none\\\'\\\":\\\"blob:\\\")+'\\\"><script src=\\\"'+probe+'\\\"><\\/script>','text/html');const control=document.createElement('iframe'),strict=document.createElement('iframe');for(const frame of [control,strict]){frame.setAttribute('aria-hidden','true');frame.style.display='none';}globalThis.__hnFoliateHostRelayV1Preflight={token,frames:[control,strict],urls};control.src=html(false)+'#'+token;strict.src=html(true)+'#'+token;const load=frame=>new Promise(resolve=>{frame.onload=resolve;frame.onerror=resolve;});root.append(control,strict);await Promise.race([Promise.all([load(control),load(strict)]),new Promise(resolve=>setTimeout(resolve,500))]);await new Promise(resolve=>setTimeout(resolve,0));return control.contentDocument?.documentElement?.getAttribute('data-hn-csp-probe')===token&&strict.contentDocument?.documentElement?.getAttribute('data-hn-csp-probe')!==token;})()", tokenJSON, (unsigned long long)(HNSecureFoliateHostRelayHandshakeTimeout * 1000)];
  [self.webView evaluateJavaScript:script inFrame:nil inContentWorld:self.contentWorld completionHandler:^(id result, NSError *error) {
    HNSecureFoliateHostRelay *strongSelf = weakSelf;
    [strongSelf finishInitialCSPPreflight:!error && [result isKindOfClass:[NSNumber class]] && [result boolValue]];
  }];
}

@end
