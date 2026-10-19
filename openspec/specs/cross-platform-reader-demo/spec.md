# cross-platform-reader-demo Specification

## Purpose

Defines a runnable Expo demonstration and repeatable acceptance path proving that external consumers can use the placeholder reader on iOS, Android, and Web.

## Requirements

### Requirement: Demo consumes the public package
The Demo SHALL consume `@hamster-note/native-reader` only through its package root workspace dependency and SHALL not import reader implementation modules, Foliate submodule paths, or secure-WebView internals. It SHALL own document selection and pass the resulting controlled local source to `NativeReader`.

#### Scenario: Demo resolves the workspace package
- **WHEN** the Demo is type checked, bundled, or exported
- **THEN** its reader import resolves through the same public package entrypoint available to external consumers

#### Scenario: Demo opens a selected document
- **WHEN** a user selects a supported local publication from the Demo
- **THEN** the Demo passes only its controlled source to the package-root reader and does not parse or render the publication itself

### Requirement: Supported-format document selection
The Demo SHALL present a user-initiated single-document picker that accepts PDF, EPUB, MOBI, KF8/AZW3, FB2/FBZ, and CBZ as candidates while treating extension and MIME values as picker hints rather than parser trust. It SHALL retain the existing source on cancellation and retain ownership of cache and Web blob resources it creates. Native PDF support SHALL require an installed development client containing the platform PDF host; absent capabilities SHALL produce a stable unsupported error without claiming successful rendering or falling back to another engine. Other formats SHALL retain their existing capability gates and behavior.

#### Scenario: Picker is cancelled
- **WHEN** the user cancels document selection after a publication is already open
- **THEN** the selected source and reader state remain unchanged

#### Scenario: Native PDF is selected
- **WHEN** a user selects a readable local PDF in the native Demo
- **THEN** the Demo passes its controlled local source to the public reader and reflects loading followed by ready after a displayed PDF page, or a stable categorized error if the capability or input is invalid

#### Scenario: Old client lacks the PDF host
- **WHEN** a user opens a local PDF in Expo Go or a client built before the required native host was included
- **THEN** the Demo reports unsupported without crashing, reporting ready, or rendering through the EPUB path

### Requirement: Deterministic multi-format fixture corpus
The repository SHALL provide offline deterministic fixtures for each supported format, malformed input, misleading extension or MIME input, PDF rejection, DRM/encryption rejection where legally redistributable, security adversaries, and representative large inputs. Fixture metadata SHALL record provenance or generation recipe, redistribution terms, checksum, size, format, and expected behavior.

#### Scenario: Fixture corpus is audited
- **WHEN** fixture generation and integrity validation run
- **THEN** every declared fixture has the recorded provenance, checksum, size, format, and behavior tags and no EPUB-only generator assumption is required for another supported format

### Requirement: Qualified automated acceptance evidence
The repository SHALL provide root commands for type, lint, formatting, multi-format fixture integrity, unit/component, package/consumer, browser E2E, and separate iOS/Android bundle or export checks. The automated Web baseline SHALL exercise supported format opening, unsupported/error paths, reader flow switching, security blocking, navigation, replacement, and cleanup through CFT Chromium and Firefox fail-closed evidence. Native-focused tests SHALL independently cover the initial-CSP/behavior gate, exact main-frame/origin/current-URL bridge checks, manifest-exact Android asset host, 32 MiB transfer boundary, transfer integrity failures, and `scrolled`/fixed-layout flow behavior; bundle/export remains packaging evidence only. Under HAM-35 owner 修勾’s 2026-10-16 Web-only acceptance authorization, real-device/WK integration and isolated Robolectric/Apple XCTest evidence plus unavailable real macOS/iOS Safari evidence are waived, never passed; local native source/transfer/lifecycle and browser/JVM checks remain required. Separate non-waived acceptance SHALL remain open for real branded Edge, `runtime-asset-missing` browser E2E, `expo start --web` smoke, and complete package raw-gate evidence in a controlled temporary environment or a formal infrastructure exception. Native bundle/export success SHALL be recorded only as resolution and packaging evidence, not proof of physical iOS or Android runtime behavior.

#### Scenario: Automated Web baseline completes
- **GIVEN** the exported Demo and packed consumer each contain their synchronized `public/reader/` runtime
- **WHEN** CFT Chromium runs the deterministic corpus and Firefox runs the fail-closed path
- **THEN** the baseline verifies ready/error behavior, navigation, flow switching, CSP/network blocking, source replacement, and cleanup through public UI or observable network effects, without claiming real branded Edge or Safari acceptance

#### Scenario: Release/platform acceptance is pending
- **GIVEN** the automated Web baseline has completed
- **WHEN** any non-waived real branded Edge, `runtime-asset-missing` browser E2E, `expo start --web` smoke, or complete package raw-gate evidence is absent
- **THEN** release/platform acceptance remains explicitly open rather than accepted, Playwright WebKit is not substituted for Safari, and independent Stage 4 work may start

#### Scenario: Native bundle succeeds without device record
- **WHEN** iOS and Android bundle or export checks succeed and no device-session evidence exists
- **THEN** the results are recorded as build and dependency-packaging evidence only and no requirement claims real-device runtime validation

#### Scenario: Native security gate is exercised
- **GIVEN** the deterministic corpus includes supported formats and native security adversaries
- **WHEN** native-focused acceptance tests run
- **THEN** they distinguish behavior-proven initial publication CSP and exact bridge/asset/transfer rejection from bundle/export evidence, and do not claim device runtime validation without separately recorded evidence

### Requirement: Reproducible reader chrome acceptance
The repository SHALL document a runnable Web acceptance path using its committed Demo, with setup prerequisites, startup command, local URL and deterministic redistributable samples for a long title, scrollable nested TOC, single-chapter multiple pages, multiple long chapters and fixed-layout navigation. The path SHALL use the public reader package and SHALL not depend on an uncommitted temporary shell or a privately supplied book. Documentation SHALL provide expected outcomes for drawer and settings visibility, focus containment/restoration, Escape/backdrop dismissal, background iframe isolation, final TOC entry reachability, successful versus unresolved TOC navigation, page and book boundaries, both reading flows, confirmed flow/status and fixed-layout fallback, 679/680 container breakpoint, 44-pixel targets, responsive widths, title truncation, minimum body height, source replacement and error states. Browser evidence SHALL cover 1440/390/320 viewport widths and a separate embedded 320-pixel reader. Automated tests SHALL exercise page protocol success, boundary no-op, serialization, stale confirmation and terminal timeout/failure. Native shared-chrome checks SHALL distinguish component/layout and local protocol evidence from actual device rendering evidence and preserve existing platform support and acceptance limits.

#### Scenario: Reviewer follows documented entry
- **WHEN** a reviewer follows clean-checkout setup and starts the committed Web Demo
- **THEN** the documented local URL permits selecting repository samples and inspecting the shared reader chrome, drawer and settings without reconstructing a temporary screenshot shell

#### Scenario: Reviewer completes chrome checks
- **WHEN** the reviewer follows the checklist at wide and narrow viewport and reader-container widths using documented samples
- **THEN** the reviewer can assess initial closure, drawer/settings focus and dismissal, iframe input blocking, TOC outcomes, Paginated page movement and zero wheel displacement, Scrolled direct readable-chapter stepping and native scrolling, confirmed flow-specific boundaries, title truncation, 240-pixel underlying viewport, unchanged renderer identity, replacement and error recovery with explicit expected outcomes

#### Scenario: Toolbar gap is measured in Chromium
- **WHEN** the reviewer compares the committed Demo before and after the layout revision at wide and narrow widths
- **THEN** recorded chrome height, visible body height and toolbar-to-first-reading-text distance identify the removed empty status row and renderer margin, while the final toolbar/body join has zero added gap and retains publication-authored spacing

#### Scenario: Browser focus behavior is verified
- **WHEN** modal focus, Tab/Shift+Tab cycling, Escape/backdrop dismissal and background iframe isolation are accepted
- **THEN** evidence includes actual browser interaction and geometry/screenshots, and jest mocks or native bundle success alone are not represented as behavioral proof

#### Scenario: Protocol or generated assets are changed
- **WHEN** page navigation is implemented across Web and native adapters
- **THEN** runtime staging and consumer sync checks, closed-schema and shared-wire-corpus tests, current-command confirmation, stale events, boundary no-op and terminal timeout tests pass against matching generated assets before the change is accepted

#### Scenario: Native modal evidence is reported
- **WHEN** native drawer/settings implementation is reviewed
- **THEN** local platform-container compatibility checks use the secure host, component tests check Modal close/accessibility wiring, and the report explicitly marks Android/iOS device behavior unverified and makes no hardware-keyboard containment claim under RN 0.86.3 default feature flags

### Requirement: Root native Expo development entry
After documented checkout/dependency preparation and initial development-client installation, the repository SHALL start the existing Demo for native development with one root command, `pnpm run dev:native`. The command SHALL prepare and verify required runtime assets before starting Expo in development-client LAN mode, defaulting to TCP port 8081 and accepting an explicit port override. Preparation failure or an occupied requested port SHALL be reported without silently starting a different app or port. The app SHALL retain `web.output=single` and the existing Web entry.

#### Scenario: Native client connects over LAN
- **WHEN** the user runs `pnpm run dev:native` from the repository root with prerequisites complete and connects an installed client on the same LAN
- **THEN** Expo listens on port 8081, advertises a reachable LAN development URL, and the client loads the existing Demo through Metro

#### Scenario: User chooses another port
- **WHEN** the user runs `pnpm run dev:native --port 18738`
- **THEN** Expo uses and advertises port 18738 for that session and the documented device connection uses the same port

#### Scenario: Preparation or port binding fails
- **WHEN** required runtime preparation fails or the requested Metro port is occupied
- **THEN** startup reports an actionable failure and does not announce readiness on an unrequested port

### Requirement: Reproducible development-client setup
The repository SHALL document executable steps from checkout to first native client installation and subsequent root-command startup, including supported tooling, local native builds, device connection via the Expo-advertised development URL, LAN host and port, firewall prerequisites, and client rebuild triggers. Documentation SHALL state that iOS custom modules cannot run in Expo Go, that Android also needs its custom host in the installed binary, and that local development-client compilation is required even though EAS builds, distribution and releases are out of scope. iOS compilation SHALL be identified as requiring macOS/Xcode/CocoaPods and device signing; Android compilation SHALL be identified as requiring a compatible JDK/Android SDK and connected device or emulator. Hosts without these environments SHALL report only the checks they actually performed.

#### Scenario: User has only a JavaScript development host
- **WHEN** a user reads the setup instructions without macOS or an Android toolchain
- **THEN** the user can distinguish Metro and JS/export checks from native compilation, can connect an already installed compatible client where available, and is not instructed to use Expo Go as proof of native PDF support

#### Scenario: Native dependency changes
- **WHEN** the user changes native modules or packaged native PDF resources after installing a client
- **THEN** the instructions require a native rebuild and reinstall rather than claiming Metro reload updates the installed native host or APK assets

### Requirement: Human native PDF validation path
The repository SHALL provide a redistributable valid multi-page PDF with selectable text and known expected page count, provenance, checksum and reproducible generation steps, plus a human checklist using the committed Demo on physical iOS and Android devices. On a compatible rebuilt client, opening that local PDF SHALL use the platform PDF path (iOS PDFKit, Android isolated PDF.js), display a page before ready, expose Pages navigation and temporary text selection Popover as defined by `pdf-pages-navigation` and `pdf-selection-popover`. The checklist SHALL include an observable way to confirm platform renderer identity, local-file acquisition, narrow-screen Pages open/jump/return, selection-handle adjustment, native menu suppression, and a no-op “高亮” button. Device behavior acceptance SHALL be performed by humans and recorded separately from automated integration evidence; unavailable device checks SHALL remain pending unless an explicit human decision for this change records the date and unverified scope as waived. Waived checks SHALL NOT be reported as passed or checked off as executed, and HAM-35 historical waivers SHALL NOT be applied to this change.

#### Scenario: Physical iOS PDF session
- **WHEN** a human opens the documented sample on a physical iOS device with a compatible PDFKit development client
- **THEN** the PDFKit host displays the document with its expected page count, Pages jumps and current-page feedback work, long-press selection remains adjustable, the React Popover stays usable within the visible surface, and the system action menu does not appear

#### Scenario: Physical Android PDF session
- **WHEN** a human opens the same local sample on a physical Android device with its isolated PDF development client
- **THEN** the isolated PDF.js host displays the document with its expected page count, Pages jumps and current-page feedback work, long-press selection remains adjustable, the React Popover is usable, and the system action menu does not appear

#### Scenario: Temporary selection and source replacement
- **WHEN** a human presses “高亮” repeatedly, then navigates through Pages or replaces the PDF
- **THEN** no annotation, storage, undo or highlight mutation occurs, selection remains usable, and stale selection Popovers do not survive navigation or replacement

#### Scenario: Integration checks pass without a device
- **WHEN** type checks, tests or native exports pass without actual device sessions
- **THEN** the result is reported as integration or bundle evidence only, with both physical-device acceptance results explicitly pending or waived by a dated human decision for this change, never passed
