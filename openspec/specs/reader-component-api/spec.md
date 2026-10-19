# reader-component-api Specification

## Purpose

Defines the stable public contract and observable placeholder behavior of the cross-platform reader component consumed by external Expo projects.

## Requirements

### Requirement: Public reader package surface
The package SHALL export `NativeReader`, `NativeReaderProps`, `ReaderSource`, reader load-state and categorized-error types, and documented reading-flow types from its root entrypoint. The same named API SHALL resolve for iOS, Android, Web, ESM, CommonJS, and TypeScript declaration consumers without exposing Demo, Foliate source, secure-WebView internals, or platform adapter modules.

#### Scenario: External project imports the public API
- **WHEN** a consumer imports the package root using a supported module or React Native resolution path
- **THEN** the consumer resolves the reader component and all documented public reader types without importing a package subpath

#### Scenario: Packed package excludes application internals
- **WHEN** the library is packed for consumption
- **THEN** the package contains its built entrypoints, declarations, required runtime assets, and notices but does not expose the Demo, Foliate source tree, or adapter internals as public library API

### Requirement: Controlled multi-format local source and load state
`NativeReader` SHALL accept an optional controlled local `{ kind: 'uri', uri, name?, mimeType? }` source, never open a picker, and expose mutually exclusive idle, loading, ready, or stable categorized-error state for the current source. It SHALL accept supported native local URIs up to 32 MiB and Web blob-backed local sources, reject HTTP(S) sources without requesting them, and prevent a replaced source from emitting stale state. Native transfer metadata and bridge details remain internal and are not public API.

#### Scenario: Remote source is rejected
- **WHEN** a host supplies an HTTP(S) URI
- **THEN** the reader reports a stable unsupported-source error without requesting the URI

#### Scenario: Source changes while opening
- **WHEN** source B replaces source A before A becomes ready
- **THEN** only B can update rendered state or invoke the host state callback

#### Scenario: Native source exceeds the supported bound
- **WHEN** a host supplies a native local source larger than 32 MiB
- **THEN** the reader exposes a stable unsupported or read error without creating a reader session or retaining partial publication state

### Requirement: PDF dispatch preserves the source API
The same controlled source API SHALL select a separate fixed-layout PDF engine without requiring the host to name an engine or convert to an IntermediateDocument. PDF candidate selection SHALL obey the platform's bounded probe contract in local-multi-format-reading. Candidate selection SHALL NOT be a ready state or full-source authorization. A missing PDF native host SHALL report categorized unsupported with `PDF_CAPABILITY_UNAVAILABLE`, preserve host source ownership, and SHALL NOT fall back to the Foliate renderer. Source replacement, clearing and unmount SHALL retire in-flight candidate probes and suppress their late state. Web SHALL use the independent same-origin static PDF iframe and exact packaged runtime, transferring private bytes rather than a source URI only after that shell's authenticated handshake. The optional PDF page callback SHALL use the neutral 1-based physical page contract, separate from EPUB navigation and annotation data.

#### Scenario: PDF host is missing
- **WHEN** a valid local PDF candidate is selected but the build has no available PDF renderer
- **THEN** the public state is a stable unsupported error with no further source access and no ready notification

### Requirement: Reader flow controls are observable and accessible
The ready reader SHALL expose accessible current chapter position, non-wrapping previous and next page controls, a left drawer entry, and reading settings reachable through the drawer. The component SHALL forward host `style` and `testID` to its root surface. Reading settings SHALL appear in a named modal dialog and contain the documented reflow selector as a visually unified segmented control with distinct selected, disabled and focus states. Selection SHALL reflect the applied engine flow rather than an unacknowledged request. When switching is unavailable, settings SHALL show a non-interactive truthful current-flow status; fixed-layout publications SHALL show their fixed-layout notice without a reflow selector or reflow status. A missing flow-change callback SHALL disable the selector. Page controls SHALL use `Previous page` and `Next page`, with page/spread steps in Paginated/fixed layout and readable chapter steps in Scrolled; `Chapter position`, `Reading flow`, `Scrolled reading flow`, and `Paginated reading flow` SHALL retain their applicable roles, labels and disabled/selected semantics.

#### Scenario: Host operates visible controls
- **WHEN** a ready publication exposes multiple readable sections and the user activates an accessible page control
- **THEN** the reader updates actual reading position and engine-confirmed boundary state, stepping pages in Paginated and adjacent readable chapters in Scrolled

#### Scenario: Flow request has not completed
- **WHEN** the user opens drawer settings and selects a different supported flow before the engine confirms application
- **THEN** selected state continues to represent the applied flow and changes only after confirmation, including after closing and reopening settings

#### Scenario: Switching is unavailable
- **WHEN** settings are opened for a ready reflowable publication whose engine cannot switch flow
- **THEN** `Reading flow status` truthfully identifies the actual flow without interactive flow choices

#### Scenario: Fixed-layout publication is opened
- **WHEN** settings are opened for a fixed-layout publication
- **THEN** `Fixed-layout publication` is shown and reflow choices and reflow status are absent

#### Scenario: Flow callback is absent
- **WHEN** flow choices are available but no flow-change callback is supplied
- **THEN** both choices expose disabled semantics and cannot change selected state

#### Scenario: Existing accessible automation operates the reader
- **WHEN** a host discovers controls through accessibility
- **THEN** `Previous page`, `Next page`, and `Chapter position` are available in the toolbar, flow controls are reachable by opening drawer settings, and previous/next advance by page in Paginated or readable chapter in Scrolled without wrapping

#### Scenario: Settings returns to drawer
- **WHEN** the user activates `Reader settings` in the drawer and then dismisses settings by close button, Web Escape, native platform close request or backdrop
- **THEN** settings is the sole active named dialog while open, the underlying reader and drawer are isolated, and dismissal returns to the drawer with Web keyboard focus or native accessibility focus on its settings button

### Requirement: Collapsible bounded table of contents
The reader SHALL initially close its left overlay drawer for each newly opened publication and expose a leftmost icon button named `Toggle table of contents` announcing expanded state. The drawer SHALL contain a settings entry even when no TOC exists; empty TOCs SHALL expose no empty `Table of contents` region. A present TOC SHALL scroll independently inside the drawer, retain existing labels, order, hierarchy, nonlinear semantics and recoverable feedback, and prefer the neutral TOC over the legacy TOC including when the neutral TOC is empty. Opening or closing SHALL preserve publication session, location and applied flow. Successful TOC navigation SHALL close the drawer after confirmation; unresolved or failed activation SHALL preserve location and keep the drawer open with `Table of contents feedback`. On Web the modal drawer SHALL make its background, including the publication iframe, unavailable to pointer, keyboard and assistive navigation. Native SHALL use the platform Modal container for window isolation and platform close requests, with accessibility-modal semantics, hidden background accessibility descendants and accessibility focus/restoration. RN 0.86.3 disables `enableImperativeFocus` and `enableKeyEvents` by default; native SHALL NOT claim hardware-keyboard focus containment. Native device behavior SHALL remain explicitly unverified until device evidence exists. The drawer SHALL NOT support a pinned-open reading mode.

#### Scenario: Reader first becomes ready
- **WHEN** a new publication becomes ready
- **THEN** its drawer toggle is available and collapsed, and hidden drawer entries are absent from keyboard and screen-reader navigation

#### Scenario: Long contents is expanded and closed
- **WHEN** the user opens a long TOC, scrolls to its final entry and closes the drawer
- **THEN** all entries are reachable within the bounded drawer, the background is isolated while open, and closing restores the unobscured body at its unchanged location and flow

#### Scenario: Navigation and feedback remain available
- **WHEN** a user activates a valid TOC entry and navigation is confirmed
- **THEN** the existing destination behavior is retained, the drawer closes and Web keyboard focus or native accessibility focus returns to the toolbar toggle

#### Scenario: Unresolved or failed TOC navigation
- **WHEN** a user activates an unresolved entry or a valid entry fails to resolve during navigation
- **THEN** reading location is preserved, the drawer remains open and recoverable feedback is exposed without treating the navigation as successful

#### Scenario: Web drawer focus is contained and restored
- **WHEN** a Web user opens the drawer and navigates with Tab and Shift+Tab
- **THEN** focus starts on its close button and stays within the active dialog; Escape, explicit close or backdrop dismisses it and restores focus to the toolbar toggle

#### Scenario: Native platform modal and accessibility are wired
- **WHEN** a native user opens the drawer or settings
- **THEN** a platform Modal container is used without reparenting the underlying secure reader, `onRequestClose` dismisses the current layer, accessibility-modal and hidden-background semantics are set, accessibility focus targets the shown title and returns to the appropriate opener after closing, and component/local container evidence is distinguished from unverified device behavior and hardware-keyboard containment

#### Scenario: Web background iframe input is attempted
- **WHEN** the Web drawer or settings is open and the user attempts to click, focus, scroll or type into the background reading frame
- **THEN** the background cannot receive user input or advance reading position and remains excluded from assistive navigation until dismissal

#### Scenario: Source is replaced or contents is empty
- **WHEN** the source/session changes, loading begins, or ready state ends
- **THEN** drawer and settings close, feedback clears, isolation is removed and focus does not return to the obsolete publication; an empty TOC in a ready publication still permits opening settings without an empty TOC region

### Requirement: Responsive reading chrome preserves usable content
The reader SHALL group a leftmost drawer icon and title with a page-navigation and chapter-position group in a compact toolbar, with flow controls in drawer settings. It SHALL truncate long visible titles while exposing the full title accessibly and adapt to its own available width on Web and native, using compact rows below 680 pixels and one toolbar row at or above 680 pixels. Interactive targets SHALL be at least 44 by 44 pixels. At reader widths from 320 pixels upward controls and overlays SHALL remain reachable without overlap or chrome-induced horizontal page scrolling; narrower readers produced by the committed Demo at 390/320 viewport widths SHALL also fit their available width. Web overlays SHALL fit within the reader root; native platform Modal backdrops occupy the host window, with content width constrained by the reader and platform window and height by the platform window. The body viewport SHALL retain at least 240 pixels of layout height during loading and ready states, including under an open overlay. Overlays SHALL not contribute to measured chrome height or change the body viewport height when opened. The body SHALL retain platform scrolling/pagination behavior and renderer identity when overlays open, close or resize. Idle/loading/error and recoverable-error presentation SHALL remain observable.

#### Scenario: Long title in narrow reader
- **WHEN** a ready reader has 320 pixels of available width and a long unbroken title
- **THEN** the icon precedes the truncated title, the full title remains accessible, page navigation occupies a separate compact row, and the underlying body is at least 240 pixels high

#### Scenario: Resize and scroll with contents open
- **WHEN** the host changes reader width across 679 and 680 pixels while a long TOC is open
- **THEN** the layout changes at the container breakpoint, drawer contents remain reachable, and the renderer retains identity, location and flow without overlay-induced viewport shrinkage

#### Scenario: Settings fits constrained containers
- **WHEN** settings is opened in 390/320 browser viewports and an embedded reader of exactly 320 pixels width
- **THEN** the dialog, full flow labels, notice/status and close controls fit within the reader width, long content scrolls vertically and no overlay induces horizontal overflow

#### Scenario: Publication cannot become ready
- **WHEN** the reader is idle, loading or in error
- **THEN** the applicable state or alert remains visible, ready-only controls and overlays are absent, no stale background isolation remains and loading retains a usable viewport

#### Scenario: Toolbar meets the publication viewport
- **WHEN** a ready reader displays its toolbar in wide or compact layout
- **THEN** no empty status row or default renderer margin separates the toolbar from the body viewport, navigation status remains observable inside the toolbar without changing body height, and publication-authored text spacing is retained

### Requirement: Confirmed page navigation and truthful boundaries
Page controls SHALL advance or retreat one renderer page/spread in Paginated or fixed layout, preserving chapter position until its page boundary then moving to the adjacent readable linear section without wrapping. In Scrolled, toolbar controls SHALL directly step to the adjacent readable linear chapter regardless of scroll position and disable at the first/last readable chapter. Scrolled keyboard and wheel input SHALL retain native scrolling behavior. Paginated wheel input SHALL neither request page turns nor displace the publication; existing keyboard navigation SHALL remain. Controls SHALL consume engine-confirmed directional availability: actual page/spread boundaries for pagination and confirmed section plus readable adjacency for Scrolled. Unknown availability and pending operations SHALL disable controls with distinguishable truthful status rather than claiming a book boundary. Navigation, flow changes and page requests SHALL be serialized, complete only on authenticated current-session confirmation, and have finite timeouts. A failed or timed-out page request SHALL produce the existing stable render error and terminal cleanup without retrying the same source automatically.

#### Scenario: Single chapter contains several pages
- **WHEN** a multi-page single-chapter book opens in Paginated and the user advances and retreats through its pages
- **THEN** next remains enabled until the actual final page, previous becomes enabled after leaving the first page, and chapter position remains `Chapter 1 of 1`

#### Scenario: Paginated crosses a section boundary
- **WHEN** the user advances through a long section and then requests a page after reaching its last reading page
- **THEN** earlier requests move within that section and the boundary request enters the next readable section; previous behaves symmetrically

#### Scenario: Scrolled toolbar steps readable chapters
- **WHEN** a user presses next or previous in a long scrolled section at any scroll position
- **THEN** it directly enters the adjacent readable linear chapter, skips nonlinear chapters, disables at first/last readable chapters without wrapping, and ordinary wheel/keyboard scrolling remains native; a single readable chapter disables both toolbar directions

#### Scenario: Paginated ignores wheel scrolling
- **WHEN** the user wheels vertically or horizontally over paginated publication content
- **THEN** no page request or publication displacement occurs, while keyboard pagination and serialized host commands remain available

#### Scenario: True book boundary is reached
- **WHEN** the renderer confirms the first or last reading position, including after TOC navigation or fixed-layout spread changes
- **THEN** only the impossible direction is disabled, a repeated boundary request safely completes without movement, and navigation does not wrap or load an out-of-range section

#### Scenario: Flow or layout changes invalidate boundaries
- **WHEN** flow changes or reader resizing starts a re-layout
- **THEN** stale availability is cleared, controls are temporarily disabled as unavailable, and only a fresh engine-confirmed state restores their directional availability

#### Scenario: Page confirmation is delayed or stale
- **WHEN** a page request is pending and an old generation, request or state revision arrives
- **THEN** stale traffic cannot update the reader or complete the current request, and a current matching state plus completion acknowledgement is required even when the chapter index does not change

#### Scenario: Page request fails or times out
- **WHEN** the renderer throws or a page operation does not confirm within its finite deadline
- **THEN** the reader exposes a stable render error, clears pending state and timers, disposes the active session and ignores later completion events
