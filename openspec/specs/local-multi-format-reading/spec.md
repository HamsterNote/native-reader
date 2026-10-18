# local-multi-format-reading Specification

## Purpose

Defines the local multi-format reading behavior and mobile flow controls shared by the browser, iOS, and Android reader surfaces.

## Requirements

### Requirement: Supported local publication formats
The reader SHALL open local, DRM-free EPUB, MOBI, KF8/AZW3, FB2/FBZ, and CBZ publications when its platform security gate succeeds. Native inputs above 32 MiB, PDF, encrypted/DRM-protected, corrupt, unreadable, remote, and otherwise unsupported inputs SHALL produce a stable categorized error without retaining stale publication content.

#### Scenario: Supported publication is opened
- **WHEN** the host supplies a readable local source whose detected format is EPUB, MOBI, KF8/AZW3, FB2/FBZ, or CBZ
- **THEN** the reader asynchronously reaches the ready state and renders the publication through the same public component contract

#### Scenario: PDF source is supplied
- **WHEN** the host supplies a PDF source regardless of its filename extension or MIME type
- **THEN** the reader reports an unsupported-format error and does not invoke the experimental PDF renderer

#### Scenario: Native platform gate rejects a source
- **WHEN** the iOS initial-publication-CSP probe or Android exact bridge/embedded-CSP probe fails for a supported local source
- **THEN** the reader reports stable unsupported without copying or reading that source and does not report ready

### Requirement: Format detection is content-aware
The reader SHALL select its parser from validated file signatures and format structure, using filename extension and MIME type only as non-authoritative hints. A misleading extension or absent MIME type SHALL not cause the reader to parse a different detected format as a supported one.

#### Scenario: Extension does not match content
- **WHEN** a local file named with a supported extension contains invalid or another unsupported format's bytes
- **THEN** the reader reports the detected input as invalid or unsupported and does not report ready

### Requirement: Normalized publication navigation
For every supported format, the reader SHALL expose ordered linear reading navigation, a table of contents when the publication provides one, and observable current position. Previous and next controls SHALL not wrap; an invalid internal destination SHALL retain the displayed location and provide recoverable feedback.

#### Scenario: End of linear reading order is reached
- **WHEN** the user repeatedly selects next from the first readable section
- **THEN** each linear section is reached in publication order and next is disabled at the final section

#### Scenario: Invalid table-of-contents target is selected
- **WHEN** a table-of-contents entry cannot resolve to a publication destination
- **THEN** the current reading location remains displayed and recoverable navigation feedback is exposed

### Requirement: Mobile reflow flow preference and recovery
On iOS and Android, a reflowable publication SHALL initially use `scrolled` flow. The reader SHALL expose a user control to switch between `scrolled` and `paginated` flow without reopening a different source, shall retain `scrolled` as an available recovery choice, and SHALL clearly identify image-based fixed-layout CBZ as not governed by this reflow flow preference.

#### Scenario: Mobile reader opens a reflowable book
- **WHEN** a supported reflowable publication becomes ready on iOS or Android
- **THEN** its initial flow is `scrolled` and the user can select `paginated` or return to `scrolled`

#### Scenario: Android pagination is unusable
- **WHEN** an Android user encounters the documented upstream WebView pagination or text-selection limitation while using `paginated`
- **THEN** the user can switch to `scrolled` without selecting another source or losing the current publication session
