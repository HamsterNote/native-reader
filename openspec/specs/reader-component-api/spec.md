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
The ready reader SHALL expose accessible current position, non-wrapping previous and next controls, table-of-contents controls when available, and the documented reflow flow selector. The component SHALL forward host `style` and `testID` to its root surface. Reflow switching SHALL use a visually unified segmented control with distinct selected, disabled and focus states. Selection SHALL reflect the applied engine flow rather than an unacknowledged request. When switching is unavailable, the reader SHALL show a non-interactive truthful current-flow status; fixed-layout publications SHALL show their fixed-layout notice without a reflow selector. Existing accessibility labels and chapter-based navigation semantics SHALL be preserved.

#### Scenario: Host operates visible controls
- **WHEN** a ready publication exposes multiple readable sections and the host activates its accessible reader controls
- **THEN** the component updates the visible position and control boundary state without requiring access to implementation internals

#### Scenario: Flow request has not completed
- **WHEN** the user selects a different supported reading flow and the engine has not confirmed application
- **THEN** the selected state continues to represent the applied flow, and becomes the new flow only after confirmation

#### Scenario: Switching is unavailable
- **WHEN** the ready engine cannot switch a reflowable publication's flow
- **THEN** `Reading flow status` truthfully identifies the actual flow without interactive flow choices

#### Scenario: Fixed-layout publication is opened
- **WHEN** the ready publication has fixed layout
- **THEN** `Fixed-layout publication` is shown and reflow choices and reflow status are absent

#### Scenario: Existing accessible automation operates the reader
- **WHEN** a host discovers chapter and flow controls through accessibility
- **THEN** `Previous chapter`, `Next chapter`, `Chapter position`, `Reading flow`, `Scrolled reading flow`, and `Paginated reading flow` retain their applicable roles, labels and disabled/selected semantics, and previous/next still move by chapter without wrapping

### Requirement: Collapsible bounded table of contents
The reader SHALL initially hide TOC entries for each newly opened publication and expose an explicit `Toggle table of contents` button when entries exist, announcing its expanded state. An expanded TOC SHALL scroll within its own bounded region without covering the reading viewport. Collapsing or expanding SHALL preserve the publication session, current location and applied flow. Valid TOC activation SHALL retain existing navigation behavior and leave the panel open; unresolved activation SHALL preserve location, keep the panel open and expose recoverable feedback. Empty TOCs SHALL expose neither a toggle nor an empty panel.

#### Scenario: Reader first becomes ready
- **WHEN** a new publication with TOC entries becomes ready
- **THEN** the toggle is available and collapsed, and hidden entries are absent from keyboard and screen-reader navigation

#### Scenario: Long contents is expanded and closed
- **WHEN** the user expands a long TOC, scrolls to its final entry and collapses it
- **THEN** all entries are reachable within the TOC region while open, the body remains unobscured, and closing leaves the reading location and flow unchanged

#### Scenario: Navigation and feedback remain available
- **WHEN** the user activates a valid or unresolved entry in the expanded `Table of contents` region
- **THEN** existing entry labels, order, hierarchy, nonlinear semantics and `Table of contents feedback` behavior are retained and the panel remains open

#### Scenario: Source is replaced or contents is empty
- **WHEN** a different publication becomes ready or the current publication has no TOC entries
- **THEN** the new publication starts collapsed, and no toggle or empty contents region is exposed when entries are absent

### Requirement: Responsive reading chrome preserves usable content
The reader SHALL group title, navigation and reading options with clear hierarchy in a compact toolbar layout, truncate long visible titles while exposing the full title accessibly, and adapt to its own available width on Web and native. At reader widths from 320 pixels upward controls SHALL remain reachable without overlap or chrome-induced horizontal page scrolling. The body viewport SHALL retain at least 240 pixels of height during loading and ready states, including with an expanded TOC. The body SHALL retain its platform scrolling/pagination behavior without remounting the renderer when the TOC changes. Idle/loading/error and recoverable-error presentation SHALL remain observable.

#### Scenario: Long title in narrow reader
- **WHEN** a ready reader has 320 pixels of available width and a long unbroken title
- **THEN** the visible title truncates, the full title remains accessible, controls fit or wrap into organized rows, and the body viewport is at least 240 pixels high

#### Scenario: Resize and scroll with contents open
- **WHEN** the host changes reader width between compact and wide layouts while a long TOC is open
- **THEN** controls and TOC remain usable, TOC scrolling does not paint over the body, and the renderer retains location and flow with independently usable body scrolling or pagination

#### Scenario: Publication cannot become ready
- **WHEN** the reader is idle, loading or in error
- **THEN** the applicable existing state or alert remains visible, ready-only controls are absent, and loading retains its usable viewport
