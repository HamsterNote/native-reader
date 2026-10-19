# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
