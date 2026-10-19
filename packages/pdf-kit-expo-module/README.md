# PDFKit Expo host

This independent package registers `HamsterPdfKit`. Install
`@hamster-note/pdfkit@0.1.0` alongside `@hamster-note/native-reader` in an
Expo 57 development build, then rebuild the iOS app (`npx expo run:ios`).
Expo Go cannot load this module. The reader reports `PDF_CAPABILITY_UNAVAILABLE`
when the native registration or its protocol does not match. It discovers the
native registration through Expo; an absent optional JS package does not break
Metro on Web or Android.

The pod targets iOS 16.4+, matching Expo 57, and uses public PDFKit/UIKit APIs.
Only `file:///` sources with independently checked Expo FileSystem read permission
are accepted. Entering an OS security scope alone does not authorize a URI string.
After the separate five-byte format probe, the selected host checks
the grant and size again and reads a bounded private snapshot (32 MiB maximum).
The descriptor and security scope are released after the snapshot read. The
original file is never written, copied on disk or deleted. Encrypted documents
are unsupported. Link/action annotations are removed from the private in-memory
document and PDFView action dispatch is disabled.

Build with `pnpm --filter @hamster-note/pdfkit build`. For a packed external app,
install the resulting tarball and run Expo autolinking and a native build. The
pod's `PolicyTests` test spec is intended for Xcode/CocoaPods host validation.

The independent `PDFKit Swift and Policy XCTest` macOS workflow installs real
CocoaPods dependencies, verifies all four module Swift sources are compiled,
and runs the original `Tests/PdfPolicyTests.swift` in an iOS Simulator. From the
workspace, `pnpm --filter @hamster-note/pdfkit run test:ios` requires macOS,
Xcode with an available iPhone Simulator, CocoaPods and locked workspace
dependencies. Build the module JS first. The gate rejects missing, skipped or
failed policy tests and preserves xcresult/logs on failure. It does not change
the existing HNSecureWebView tarball-consumer workflow.

First-page rendering, menu suppression, long-press selection and handle
adjustment still require device/UI acceptance. Linux JS tests and Expo
autolinking metadata inspection do not provide this evidence. The scoped menu
implementation uses responder menu filtering and public edit-menu dismissal;
its behavior across OS versions must be checked before platform acceptance.
