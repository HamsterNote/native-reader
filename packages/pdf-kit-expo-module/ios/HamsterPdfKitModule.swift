import ExpoModulesCore

public final class HamsterPdfKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HamsterPdfKit")
    Constant("capability") {
      ["protocol": "hamster-pdf", "version": 1,
       "maxBytes": PdfPolicy.maxBytes, "readyAfterDraw": true] as [String: Any]
    }
    View(HamsterPdfKitView.self) {
      Events("onPdfEvent")
      AsyncFunction("command") { (view: HamsterPdfKitView, value: [String: Any]) -> Any? in
        return view.command(value)
      }.runOnQueue(.main)
    }
  }
}
