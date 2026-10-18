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
The Demo SHALL present a user-initiated single-document picker that accepts EPUB, MOBI, KF8/AZW3, FB2/FBZ, and CBZ as candidates while treating extension and MIME values as picker hints rather than parser trust. It SHALL retain the existing source on cancellation, retain ownership of cache and Web blob resources it creates, and SHALL not present PDF as a supported selection.

#### Scenario: Picker is cancelled
- **WHEN** the user cancels document selection after a publication is already open
- **THEN** the selected source and reader state remain unchanged

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
The repository SHALL document a runnable Web acceptance path using its committed Demo, with setup prerequisites, startup command, local URL and deterministic redistributable samples for a long title and scrollable nested TOC. The path SHALL use the public reader package and SHALL not depend on an uncommitted temporary shell or a privately supplied book. Documentation SHALL provide a manual interaction checklist for contents visibility/scrolling, chapter boundaries, reading-flow selection/status, responsive widths, title truncation, minimum body height, source replacement and error states. Native shared-chrome checks SHALL distinguish component/layout evidence from actual device rendering evidence and preserve existing platform support limits.

#### Scenario: Reviewer follows documented entry
- **WHEN** a reviewer follows clean-checkout setup and starts the committed Web Demo
- **THEN** the documented local URL permits selecting repository samples and inspecting the actual shared reader chrome without reconstructing the screenshot shell

#### Scenario: Reviewer completes chrome checks
- **WHEN** the reviewer follows the checklist at wide and narrow reader widths using the documented samples
- **THEN** the reviewer can assess long-title truncation, initially hidden TOC, toggle and final TOC entry reachability, chapter boundaries, confirmed flow, fixed-layout fallback, viewport height, replacement and error recovery with explicit expected outcomes
