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
The same controlled source API SHALL select a separate fixed-layout PDF engine without requiring the host to name an engine or convert to an IntermediateDocument. PDF candidate selection SHALL obey the native five-byte probe contract in local-multi-format-reading. Candidate selection SHALL NOT be a ready state or full-source authorization. A missing PDF native host SHALL report categorized unsupported with `PDF_CAPABILITY_UNAVAILABLE`, preserve host source ownership, and SHALL NOT fall back to the Foliate renderer. Source replacement, clearing and unmount SHALL retire in-flight candidate probes and suppress their late state.

#### Scenario: PDF host is missing
- **WHEN** a valid local PDF candidate is selected but the build has no available PDF renderer
- **THEN** the public state is a stable unsupported error with no further source access and no ready notification

### Requirement: Reader flow controls are observable and accessible
The ready reader SHALL expose accessible current position, non-wrapping previous and next controls, table-of-contents controls when available, and the documented reflow flow selector. The component SHALL forward host `style` and `testID` to its root surface.

#### Scenario: Host operates visible controls
- **WHEN** a ready publication exposes multiple readable sections and the host activates its accessible reader controls
- **THEN** the component updates the visible position and control boundary state without requiring access to implementation internals
