import ExpoModulesCore
import PDFKit
import UIKit
import XCTest
@testable import HamsterPdfKit

final class PdfPolicyTests: XCTestCase {
  func testLocalSchemesAndEncodedControls() {
    XCTAssertNotNil(PdfPolicy.localURL("file:///tmp/host%20document.pdf"))
    for value in ["https://example.com/document.pdf", "file://remote/tmp/a.pdf", "content://provider/a.pdf", "file:///a%00.pdf", "file:///a%0A.pdf", "file:///a.pdf?token=secret", "file:///a.pdf#fragment", "file:///a\\b.pdf"] {
      XCTAssertNil(PdfPolicy.localURL(value), value)
    }
  }

  func testStrictIntegerAndEnvelope() {
    for value in [true, false, 0, -1, 1.5, Double.nan, Double.infinity, "1"] as [Any] {
      XCTAssertNil(PdfPolicy.integer(value))
    }
    XCTAssertEqual(PdfPolicy.integer(32), 32)
    XCTAssertNil(PdfPolicy.integer(33, max: 32))
    let envelope: [String: Any] = ["protocol": "hamster-pdf", "version": 1, "sessionId": "test", "generation": 2, "commandId": 1]
    XCTAssertNotNil(PdfPolicy.identity(envelope))
    XCTAssertNil(PdfPolicy.identity(envelope.merging(["version": true]) { _, new in new }))
  }

  func testCancellationAndIndependentReadGrant() throws {
    let cancelled = PdfReadOperation()
    cancelled.cancel()
    cancelled.cancel()
    XCTAssertTrue(cancelled.isCancelled)
    XCTAssertThrowsError(try PdfLocalSnapshot.load("file:///not-opened.pdf", fileSystem: nil, operation: cancelled))
    XCTAssertThrowsError(try PdfLocalSnapshot.load("file:///not-authorized.pdf", fileSystem: nil, operation: PdfReadOperation())) { error in
      XCTAssertEqual((error as? PdfHostFailure)?.code, "PDF_READ_DENIED")
    }
  }

  func testSnapshotNeverWritesOrDeletesHostFile() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let source = directory.appendingPathComponent("misleading.epub")
    let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 200, height: 300)).pdfData { context in
      for index in 1...3 {
        context.beginPage()
        ("PDF page \(index)" as NSString).draw(at: CGPoint(x: 20, y: 20), withAttributes: nil)
      }
    }
    try data.write(to: source)
    let permissions = FileSystemManager(documentDirectory: directory.path, cachesDirectory: directory.path, applicationSupportDirectory: directory.path)
    var snapshot: PDFDocument? = try PdfLocalSnapshot.load(source.absoluteString, fileSystem: permissions, operation: PdfReadOperation())
    XCTAssertEqual(snapshot?.pageCount, 3)
    XCTAssertTrue(snapshot?.page(at: 0)?.string?.contains("PDF page 1") == true)
    snapshot?.page(at: 0)?.rotation = 90
    snapshot = nil
    XCTAssertEqual(try Data(contentsOf: source), data)
  }

  func testInvalidAndOversizeSourcesFailBeforePdfViewBinding() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let permissions = FileSystemManager(documentDirectory: directory.path, cachesDirectory: directory.path, applicationSupportDirectory: directory.path)
    let source = directory.appendingPathComponent("invalid.pdf")
    try Data("%PDF-not-a-document".utf8).write(to: source)
    XCTAssertThrowsError(try PdfLocalSnapshot.load(source.absoluteString, fileSystem: permissions, operation: PdfReadOperation())) { error in
      XCTAssertEqual((error as? PdfHostFailure)?.category, "invalid")
    }
    let handle = try FileHandle(forWritingTo: source)
    try handle.truncate(atOffset: UInt64(PdfPolicy.maxBytes + 1))
    try handle.close()
    XCTAssertThrowsError(try PdfLocalSnapshot.load(source.absoluteString, fileSystem: permissions, operation: PdfReadOperation())) { error in
      XCTAssertEqual((error as? PdfHostFailure)?.code, "PDF_SIZE_LIMIT")
    }
  }
}
