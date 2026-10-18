import CoreFoundation
import Foundation

enum PdfPolicy {
  static let maxBytes = 32 * 1024 * 1024
  static let maxPages = 100_000
  static let maxText = 8192
  static let maxRects = 64

  static func localURL(_ value: String) -> URL? {
    guard value.utf8.count <= 8192, value.hasPrefix("file:///"),
      !value.contains("\\"), !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
      let components = URLComponents(string: value), components.scheme == "file",
      components.host == nil || components.host == "", components.query == nil,
      components.fragment == nil, components.user == nil, components.password == nil,
      let decoded = components.percentEncodedPath.removingPercentEncoding,
      !decoded.contains("\\"), !decoded.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
      let url = components.url, url.isFileURL else { return nil }
    return url
  }

  static func integer(_ value: Any?, max: Int = 9_007_199_254_740_991) -> Int? {
    guard let number = value as? NSNumber,
      CFGetTypeID(number) != CFBooleanGetTypeID(),
      number.doubleValue.isFinite, number.doubleValue >= 1,
      number.doubleValue <= Double(max), number.doubleValue.rounded() == number.doubleValue
    else { return nil }
    return number.intValue
  }

  static func identity(_ value: [String: Any]) -> PdfIdentity? {
    guard value["protocol"] as? String == "hamster-pdf",
      integer(value["version"], max: 1) == 1,
      let session = value["sessionId"] as? String, !session.isEmpty, session.utf8.count <= 128,
      let generation = integer(value["generation"]),
      let command = integer(value["commandId"]) else { return nil }
    return PdfIdentity(sessionId: session, generation: generation, commandId: command)
  }
}

struct PdfIdentity: Equatable {
  let sessionId: String
  let generation: Int
  let commandId: Int
  var fields: [String: Any] { ["sessionId": sessionId, "generation": generation] }
  func matches(_ other: PdfIdentity) -> Bool {
    sessionId == other.sessionId && generation == other.generation
  }
}

final class PdfReadOperation {
  private let lock = NSLock()
  private var cancelled = false
  func cancel() { lock.lock(); cancelled = true; lock.unlock() }
  var isCancelled: Bool {
    lock.lock(); defer { lock.unlock() }; return cancelled
  }
}

struct PdfHostFailure: Error {
  let category: String
  let code: String
  let message: String
  var fields: [String: Any] { ["category": category, "code": code, "message": message] }
}
