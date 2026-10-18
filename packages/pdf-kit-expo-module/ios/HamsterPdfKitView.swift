import CoreFoundation
import ExpoModulesCore
import PDFKit
import UIKit

// Local to this PDF surface. No swizzling, private selectors or gesture removal.
private final class ReaderPDFView: PDFView {
  var didDrawPage: ((PDFPage) -> Void)?
  override func draw(_ page: PDFPage, to context: CGContext) {
    super.draw(page, to: context)
    didDrawPage?(page)
  }
  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool { false }
  override func buildMenu(with builder: UIMenuBuilder) {
    super.buildMenu(with: builder)
    builder.remove(menu: .standardEdit)
  }
  // PDF actions never escape into UIApplication, another document or a script.
  override func perform(_ action: PDFAction) {}
}

final class HamsterPdfKitView: ExpoView, PDFViewDelegate {
  let onPdfEvent = EventDispatcher()
  private let pdfView = ReaderPDFView()
  private var identity: PdfIdentity?
  private var lastCommand = 0
  private var operation: PdfReadOperation?
  private var timeout: DispatchWorkItem?
  private var notifications: [NSObjectProtocol] = []
  private var scrollObservers: [ObjectIdentifier: NSKeyValueObservation] = [:]
  private var thumbnails: [Int: [String: Any]] = [:]
  private var thumbnailOrder: [Int] = []
  private var ready = false
  private var suspended = false
  private var previousBounds = CGRect.zero

  // Implementing this delegate replaces PDFKit's default URL-opening behavior.
  func pdfViewWillClick(onLink sender: PDFView, with url: URL) {}
  func pdfViewPerformFind(_ sender: PDFView) {}
  func pdfViewPerformGo(toPage sender: PDFView) {}

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    pdfView.autoScales = true
    pdfView.displayMode = .singlePageContinuous
    pdfView.displayDirection = .vertical
    pdfView.displaysPageBreaks = true
    pdfView.enableDataDetectors = false
    pdfView.delegate = self
    addSubview(pdfView)
    pdfView.didDrawPage = { [weak self] page in
      // A document binding, layout or page notification is not rendering proof.
      DispatchQueue.main.async { [weak self, weak page] in
        guard let self, let page, !self.suspended, self.window != nil,
          page.document === self.pdfView.document, self.identity != nil, !self.ready else { return }
        self.ready = true
        self.timeout?.cancel()
        self.timeout = nil
        self.emitPage()
        if var state = self.pageFields() {
          state["status"] = "ready"
          self.emit("state", ["state": state])
        }
      }
    }
    observe(.PDFViewPageChanged, object: pdfView) { [weak self] in
      self?.clearSelection()
      if self?.ready == true { self?.emitPage() }
    }
    observe(.PDFViewSelectionChanged, object: pdfView) { [weak self] in self?.selectionChanged() }
    observe(.PDFViewScaleChanged, object: pdfView) { [weak self] in self?.clearSelection() }
    observe(UIMenuController.willShowMenuNotification) { [weak self] in
      guard let self, self.pdfView.currentSelection != nil,
        self.hasFirstResponder(self.pdfView) else { return }
      UIMenuController.shared.hideMenu()
    }
    observe(UIApplication.willResignActiveNotification) { [weak self] in
      guard let self else { return }
      self.clearSelection()
      self.suspended = true
      if self.operation != nil {
        self.fail(PdfHostFailure(category: "read", code: "PDF_OPEN_INTERRUPTED", message: "PDF opening was interrupted by the application leaving the foreground."))
      }
    }
    observe(UIApplication.didBecomeActiveNotification) { [weak self] in
      self?.suspended = false
      if self?.ready == true { self?.emitPage() }
    }
  }

  private func observe(_ name: Notification.Name, object: Any? = nil, action: @escaping () -> Void) {
    notifications.append(NotificationCenter.default.addObserver(forName: name, object: object, queue: .main) { _ in action() })
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if previousBounds != bounds {
      clearSelection()
      previousBounds = bounds
    }
    pdfView.frame = bounds
    attachScrollObservers(pdfView)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { close() }
  }

  deinit {
    operation?.cancel()
    timeout?.cancel()
    notifications.forEach { NotificationCenter.default.removeObserver($0) }
    scrollObservers.removeAll()
  }

  private func attachScrollObservers(_ view: UIView) {
    if let scroll = view as? UIScrollView {
      let key = ObjectIdentifier(scroll)
      if scrollObservers[key] == nil {
        scrollObservers[key] = scroll.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
          self?.clearSelection()
        }
      }
    }
    view.subviews.forEach { attachScrollObservers($0) }
  }

  func command(_ value: [String: Any]) -> Any? {
    guard let incoming = PdfPolicy.identity(value), let type = value["type"] as? String else { return nil }
    let common: Set<String> = ["protocol", "version", "sessionId", "generation", "commandId", "type"]
    let extra: Set<String>
    switch type {
    case "open": extra = ["uri", "timeoutMs"]
    case "navigate", "thumbnail": extra = ["pageNumber"]
    case "scale": extra = ["scale"]
    case "clear", "rotate", "dispose": extra = []
    default: return nil
    }
    guard Set(value.keys).isSubset(of: common.union(extra)) else { return nil }
    if type == "open" {
      guard identity == nil, incoming.commandId == 1,
        let uri = value["uri"] as? String,
        let timeoutNumber = value["timeoutMs"] as? NSNumber,
        CFGetTypeID(timeoutNumber) != CFBooleanGetTypeID(),
        timeoutNumber.doubleValue.isFinite, timeoutNumber.doubleValue >= 0,
        timeoutNumber.doubleValue <= 300_000,
        timeoutNumber.doubleValue.rounded() == timeoutNumber.doubleValue else { return nil }
      identity = incoming
      lastCommand = incoming.commandId
      open(uri, timeoutMs: timeoutNumber.intValue)
      return result(incoming, true)
    }
    guard let current = identity, current.matches(incoming), incoming.commandId > lastCommand else { return nil }
    lastCommand = incoming.commandId
    var output: Any = NSNull()
    switch type {
    case "dispose": close(); output = true
    case "clear": clearSelection(); output = true
    case "navigate":
      if !suspended, let document = pdfView.document,
        let number = PdfPolicy.integer(value["pageNumber"], max: document.pageCount),
        let page = document.page(at: number - 1) {
        clearSelection()
        pdfView.go(to: page)
        if ready { emitPage() }
        output = true
      } else { output = false }
    case "thumbnail":
      if !suspended, let document = pdfView.document,
        let number = PdfPolicy.integer(value["pageNumber"], max: document.pageCount) {
        output = thumbnail(number) ?? NSNull()
      }
    case "scale":
      if !suspended, let scale = value["scale"] as? NSNumber,
        CFGetTypeID(scale) != CFBooleanGetTypeID(), scale.doubleValue.isFinite,
        scale.doubleValue >= 0.5, scale.doubleValue <= 3 {
        clearSelection()
        let base = pdfView.scaleFactorForSizeToFit
        pdfView.autoScales = false
        pdfView.minScaleFactor = base * 0.5
        pdfView.maxScaleFactor = base * 3
        pdfView.scaleFactor = base * CGFloat(scale.doubleValue)
        output = true
      }
    case "rotate":
      if !suspended, let document = pdfView.document {
        clearSelection()
        for index in 0..<document.pageCount {
          if let page = document.page(at: index) { page.rotation = (page.rotation + 90) % 360 }
        }
        thumbnails.removeAll()
        thumbnailOrder.removeAll()
        pdfView.layoutDocumentView()
        pdfView.setNeedsDisplay()
        output = true
      }
    default: break
    }
    return result(incoming, output)
  }

  private func open(_ uri: String, timeoutMs: Int) {
    guard let opening = identity else { return }
    emit("state", ["state": opening.fields.merging(["status": "loading"]) { _, new in new }])
    if timeoutMs > 0 {
      let work = DispatchWorkItem { [weak self] in
        guard let self, self.identity?.matches(opening) == true, !self.ready else { return }
        self.fail(PdfHostFailure(category: "render", code: "PDF_LOAD_TIMEOUT", message: "PDF did not render before the load deadline."))
      }
      timeout = work
      DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs), execute: work)
    }
    let read = PdfReadOperation()
    operation = read
    let fileSystem = appContext?.fileSystem
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let loaded: Result<PDFDocument, Error> = Result { try PdfLocalSnapshot.load(uri, fileSystem: fileSystem, operation: read) }
      DispatchQueue.main.async { [weak self] in
        guard let self, !read.isCancelled, self.operation === read,
          self.identity?.matches(opening) == true, !self.suspended else { return }
        self.operation = nil
        switch loaded {
        case .success(let document):
          self.pdfView.document = document
          self.pdfView.autoScales = true
          self.pdfView.layoutDocumentView()
          self.setNeedsLayout()
        case .failure(let error):
          self.fail(error as? PdfHostFailure ?? PdfHostFailure(category: "read", code: "PDF_READ_FAILED", message: "The local PDF could not be opened."))
        }
      }
    }
  }

  private func fail(_ failure: PdfHostFailure) {
    guard let current = identity else { return }
    emit("state", ["state": current.fields.merging(["status": "error", "error": failure.fields]) { _, new in new }])
    close()
  }

  private func close() {
    // Revoke event authority before detaching PDFKit (which emits notifications).
    identity = nil
    operation?.cancel()
    operation = nil
    timeout?.cancel()
    timeout = nil
    ready = false
    pdfView.clearSelection()
    pdfView.document = nil
    thumbnails.removeAll()
    thumbnailOrder.removeAll()
    scrollObservers.removeAll()
  }

  private func pageFields() -> [String: Any]? {
    guard let current = identity, let document = pdfView.document,
      let page = pdfView.currentPage else { return nil }
    let index = document.index(for: page)
    guard index != NSNotFound, index >= 0, index < document.pageCount else { return nil }
    return current.fields.merging(["pageNumber": index + 1, "pageCount": document.pageCount]) { _, new in new }
  }
  private func emitPage() {
    guard !suspended, let fields = pageFields() else { return }
    emit("page", ["page": fields])
  }

  private func thumbnail(_ number: Int) -> [String: Any]? {
    guard let current = identity, let page = pdfView.document?.page(at: number - 1) else { return nil }
    if let cached = thumbnails[number] { return cached }
    let image = page.thumbnail(of: CGSize(width: 112, height: 150), for: .cropBox)
    guard image.size.width > 0, image.size.height > 0 else { return nil }
    let ratio = min(112 / image.size.width, 150 / image.size.height)
    let width = max(1, min(112, Int((image.size.width * ratio).rounded(.down))))
    let height = max(1, min(150, Int((image.size.height * ratio).rounded(.down))))
    let size = CGSize(width: CGFloat(width), height: CGFloat(height))
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    guard let png = rendered.pngData(), png.count <= 140_000 else { return nil }
    let value = current.fields.merging([
      "pageNumber": number, "width": width, "height": height,
      "uri": "data:image/png;base64," + png.base64EncodedString()
    ]) { _, new in new }
    thumbnails[number] = value
    thumbnailOrder.append(number)
    if thumbnailOrder.count > 24 { thumbnails.removeValue(forKey: thumbnailOrder.removeFirst()) }
    return value
  }

  private func clearSelection() {
    if pdfView.currentSelection != nil { pdfView.clearSelection() }
    emit("selection", ["selection": NSNull()])
  }

  private func selectionChanged() {
    guard let current = identity else { return }
    dismissEditMenus(pdfView)
    DispatchQueue.main.async { [weak self] in
      guard let self, self.identity?.matches(current) == true else { return }
      self.dismissEditMenus(self.pdfView)
      self.emitSelection()
    }
  }

  private func emitSelection() {
    guard !suspended, ready, let current = identity,
      let selected = pdfView.currentSelection, let text = selected.string,
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      text.utf16.count <= PdfPolicy.maxText else {
      emit("selection", ["selection": NSNull()]); return
    }
    var rects: [[String: Any]] = []
    for line in selected.selectionsByLine() {
      for page in line.pages {
        guard page.document === pdfView.document else { continue }
        let inPDFView = pdfView.convert(line.bounds(for: page), from: page)
        let rect = pdfView.convert(inPDFView, to: self).intersection(bounds)
        if !rect.isNull, !rect.isEmpty,
          [rect.minX, rect.minY, rect.width, rect.height].allSatisfy({ $0.isFinite && abs($0) <= 100_000 }) {
          rects.append(["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height])
        }
        if rects.count > PdfPolicy.maxRects { clearSelection(); return }
      }
    }
    guard !rects.isEmpty else { emit("selection", ["selection": NSNull()]); return }
    let value = current.fields.merging([
      "selectionId": UUID().uuidString, "text": text, "rects": rects, "coordinateSpace": "reader"
    ]) { _, new in new }
    emit("selection", ["selection": value])
  }

  private func hasFirstResponder(_ view: UIView) -> Bool {
    view.isFirstResponder || view.subviews.contains(where: { hasFirstResponder($0) })
  }
  private func dismissEditMenus(_ view: UIView) {
    if #available(iOS 16.0, *) {
      for interaction in view.interactions {
        (interaction as? UIEditMenuInteraction)?.dismissMenu()
      }
    }
    view.subviews.forEach { dismissEditMenus($0) }
  }

  private func emit(_ type: String, _ fields: [String: Any]) {
    guard let current = identity else { return }
    onPdfEvent(envelope(current, commandId: 0).merging(fields.merging(["type": type]) { _, new in new }) { _, new in new })
  }
  private func envelope(_ current: PdfIdentity, commandId: Int) -> [String: Any] {
    current.fields.merging(["protocol": "hamster-pdf", "version": 1, "commandId": commandId]) { _, new in new }
  }
  private func result(_ incoming: PdfIdentity, _ value: Any) -> [String: Any] {
    envelope(incoming, commandId: incoming.commandId).merging(["type": "result", "result": value]) { _, new in new }
  }
}
