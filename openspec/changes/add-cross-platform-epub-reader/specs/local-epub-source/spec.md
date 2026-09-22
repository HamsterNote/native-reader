# Spec Delta

## ADDED Requirements

### Requirement: Controlled local URI source
The reader SHALL accept an optional controlled `{ kind: 'uri', uri, name?, mimeType? }` source, support native `file:`/`content:` and Web `blob:` URIs, reject remote URLs, and never expose or invoke a picker.

#### Scenario: Source is absent
- **WHEN** no source is supplied
- **THEN** the reader presents an empty state and performs no read

#### Scenario: Remote source is rejected
- **WHEN** an HTTP(S) URI is supplied
- **THEN** the reader reports `UNSUPPORTED_SOURCE` without requesting it

### Requirement: Observable asynchronous load states
The reader SHALL render and notify mutually exclusive loading, ready, and stable categorized error states for the current source.

#### Scenario: Source changes during loading
- **WHEN** source B replaces source A before A completes
- **THEN** only B may update visible state or notify the host

### Requirement: Source and derived-resource ownership
The host SHALL retain ownership of the supplied URI. The reader SHALL release only resources it derives and SHALL clean them on replacement and unmount.

#### Scenario: Reader unmounts while loading
- **WHEN** the reader unmounts before opening completes
- **THEN** pending work is ignored or cancelled and no later notification is emitted
