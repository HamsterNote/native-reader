# HAM-56 archive report (2026-10-19)

## Delivered and verified

Root Expo development-client setup/prepare/start/local-build entries, scheme
and identifiers, autolinking inspection, reproducible eight-page PDF, and
LAN/client documentation are implemented. Dev graph compilation and synchronous
root registration defects are fixed with regression coverage.

Web EPUB/Web PDF acceptance was previously completed. Automated and server-side
evidence includes typecheck, Demo/reader tests, PDF security tests, iOS/Android
exports and native graph verification, native-export tests, strict OpenSpec
validation, and actual dev-mode smoke of four iOS/Android entry/subgraph bundles
(HTTP 200 and NativeReaderImplementation present). The service owner also
independently checked the served entry's synchronous registration and platform
graph contents. Exact commands and results are in `docs/validation.md`.

## Explicit human waiver

**waived：人类决定不做设备验证（2026-10-19）**. The HAM-56 owner chose
closeout without device acceptance, recorded in the issue discussion. This is
an independent decision for this change, not an inherited HAM-35 waiver.

Tasks 5.1–5.3 and the default-8081 readiness portion of 2.2 remain unchecked.
They are not pass results. Unverified scope:

- Compatible rebuilt development-client installation and physical-device LAN acceptance.
- iOS PDFKit host mounting and actual behavior, native long-press menu suppression,
  selection handles, and Pages/Popover touch interactions.
- Android HNPdfView isolated PDF.js behavior, touch interactions and error recovery.
- Default-8081 readiness: another project's Expo occupied it; explicit 18738/18739
  startup/readiness was verified instead.

No native compilation/install success is claimed on this Linux host without
Xcode/CocoaPods, Android SDK/adb or connected devices. The temporary smoke server
was cleaned up; the service owner stopped both acceptance services. No renderer,
EPUB, highlight, security-gate or EAS/release behavior was added by this closeout.

Delivery boundary: **Web accepted + automation/server integration verified +
device behavior unverified (waived)**. Archiving records the decision; it does
not convert unexecuted tasks into completed tests.
