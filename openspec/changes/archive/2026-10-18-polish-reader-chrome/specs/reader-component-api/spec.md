# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
