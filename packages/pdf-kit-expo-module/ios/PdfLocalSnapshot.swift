import Darwin
import ExpoModulesCore
import Foundation
import PDFKit

enum PdfLocalSnapshot {
  // Authorization is independent of the five-byte JS dispatch probe. Never use
  // a URL-backed PDFDocument: it could reopen a changed host file after this gate.
  static func load(_ uri: String, fileSystem: FileSystemManager?, operation: PdfReadOperation) throws -> PDFDocument {
    guard let source = PdfPolicy.localURL(uri) else {
      throw PdfHostFailure(category: "unsupported", code: "PDF_LOCAL_SOURCE_REQUIRED", message: "PDFKit requires a local file URI.")
    }
    guard !operation.isCancelled else { throw CancellationError() }
    let scoped = source.startAccessingSecurityScopedResource()
    defer { if scoped { source.stopAccessingSecurityScopedResource() } }
    let url = source.resolvingSymlinksInPath().standardizedFileURL
    // A successful scope acquisition does not authorize an arbitrary URI string.
    guard fileSystem != nil else {
      throw PdfHostFailure(category: "read", code: "PDF_READ_DENIED", message: "The local PDF read grant is unavailable.")
    }
    guard !operation.isCancelled else { throw CancellationError() }
    let descriptor = Darwin.open(url.path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK)
    guard descriptor >= 0 else {
      throw PdfHostFailure(category: "read", code: "PDF_READ_FAILED", message: "The local PDF cannot be opened.")
    }
    defer { Darwin.close(descriptor) }
    var info = stat()
    guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
      info.st_size > 0, info.st_size <= PdfPolicy.maxBytes else {
      throw PdfHostFailure(category: "unsupported", code: "PDF_SIZE_LIMIT", message: "PDF requires a known positive size of at most 32 MiB.")
    }
    let expected = Int(info.st_size)
    var data = Data()
    data.reserveCapacity(expected)
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    while data.count <= expected {
      guard !operation.isCancelled else { throw CancellationError() }
      let count = min(buffer.count, expected + 1 - data.count)
      let readCount = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, count) }
      if readCount < 0 {
        if errno == EINTR { continue }
        throw PdfHostFailure(category: "read", code: "PDF_READ_FAILED", message: "The local PDF could not be read.")
      }
      if readCount == 0 { break }
      data.append(contentsOf: buffer.prefix(readCount))
    }
    guard data.count == expected else {
      throw PdfHostFailure(category: "read", code: "PDF_SOURCE_CHANGED", message: "The local PDF changed while opening.")
    }
    guard !operation.isCancelled else { throw CancellationError() }
    guard let document = PDFDocument(data: data) else {
      throw PdfHostFailure(category: "invalid", code: "PDF_INVALID", message: "The document is not a valid PDF.")
    }
    guard !document.isEncrypted, !document.isLocked else {
      throw PdfHostFailure(category: "drm", code: "PDF_ENCRYPTED", message: "Encrypted PDFs are unsupported.")
    }
    guard document.pageCount > 0, document.pageCount <= PdfPolicy.maxPages,
      document.page(at: 0) != nil else {
      throw PdfHostFailure(category: "invalid", code: "PDF_INVALID_PAGES", message: "The PDF has no supported pages.")
    }
    // Only mutate the reader's in-memory snapshot. Link/action annotations are
    // removed before PDFView receives it; the host document is never saved.
    for index in 0..<document.pageCount {
      guard !operation.isCancelled else { throw CancellationError() }
      guard let page = document.page(at: index) else {
        throw PdfHostFailure(category: "invalid", code: "PDF_INVALID_PAGES", message: "The PDF contains an unreadable page.")
      }
      for annotation in page.annotations where annotation.action != nil || annotation.url != nil {
        page.removeAnnotation(annotation)
      }
    }
    return document
  }
}
