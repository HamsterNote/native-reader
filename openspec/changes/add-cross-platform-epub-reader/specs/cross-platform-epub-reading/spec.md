# Spec Delta

## ADDED Requirements

### Requirement: Supported EPUB publication profile
The reader SHALL support local DRM-free reflowable EPUB 2/3 and SHALL report invalid, DRM, fixed-layout, media-overlay, and remote publications as errors rather than supported content.

#### Scenario: Unsupported publication is supplied
- **WHEN** publication metadata declares fixed layout or DRM
- **THEN** the reader reports an unsupported-publication error

### Requirement: Complete linear spine traversal
Every `linear="yes"` spine item SHALL be reachable in order with non-wrapping previous/next controls and observable current/total position.

#### Scenario: Last chapter is reached
- **WHEN** next is repeatedly activated from the first chapter
- **THEN** every linear item is visited in order and next is disabled at the last

### Requirement: Table-of-contents navigation
TOC entries SHALL remain in publication order and valid internal href/fragment targets SHALL be navigable. Invalid targets SHALL preserve the current location and report recoverable feedback.

#### Scenario: TOC fragment is selected
- **WHEN** a valid TOC entry targets a fragment in another linear item
- **THEN** the target item and fragment are displayed and current position updates

### Requirement: Untrusted publication content is constrained
Scripts SHALL be disabled, `javascript:`/top-level/popup/external navigation SHALL be denied, and HTTP(S) publication subresources SHALL not be requested.

#### Scenario: Adversarial publication is opened
- **WHEN** publication markup attempts script execution and an external request
- **THEN** neither the host mutation nor external request occurs

### Requirement: Bounded first-release performance claims
Opening and navigation SHALL be asynchronous, but this release SHALL NOT claim ZIP streaming/random access, maximum memory, or a supported file-size ceiling.

#### Scenario: Large fixture is measured
- **WHEN** the representative large fixture is evaluated
- **THEN** observed timing and memory are recorded without becoming product limits
