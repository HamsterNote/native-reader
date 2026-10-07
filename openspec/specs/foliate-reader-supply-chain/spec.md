# foliate-reader-supply-chain Specification

## Purpose

Makes the official Foliate source and its revision independently auditable while removing the retired EPUB engine supply-chain surface from production artifacts.

## Requirements

### Requirement: Official Foliate source is reproducibly pinned
The repository SHALL include `johnfactotum/foliate-js` as a Git submodule at `vendor/foliate-js`, pinned to commit `78914aef4466eb960965702401634c2cb348e9b1`. Dependency and packaging validation SHALL fail if the submodule is absent, dirty, detached from that commit, or resolves to a different repository URL or revision.

#### Scenario: Clean checkout prepares the reader engine
- **WHEN** a contributor initializes submodules in a clean checkout
- **THEN** `vendor/foliate-js` resolves to `johnfactotum/foliate-js` commit `78914aef4466eb960965702401634c2cb348e9b1` before reader build or test commands proceed

### Requirement: Retired EPUB engine artifacts are absent
Production dependencies, package overrides, patches, staged WebView payloads, consumer fixtures, notices, and validation scripts SHALL not reference `epubjs` or `@epubjs-react-native/core`. The package SHALL contain only the Foliate assets required by its documented runtime integration and their applicable license notices.

#### Scenario: Packed reader is inspected
- **WHEN** the package is built and its packed artifact plus consumer fixtures are checked
- **THEN** no retired EPUB engine package, patch, staged payload, or direct runtime import is present

### Requirement: Engine revision changes require explicit review
An update to the Foliate submodule commit SHALL include the new immutable commit identifier, upstream source reference, license-notice review, and rerun of the multi-format security and packaging verification paths.

#### Scenario: Submodule revision is changed
- **WHEN** a change modifies the submodule gitlink
- **THEN** supply-chain validation requires the updated revision metadata and rejects the change when the required verification record is absent

### Requirement: Staged native runtime integrity represents the shipped package
`SECURE_WEBVIEW_SHA256.json`, or an equivalent staging-integrity record, SHALL be generated from and verified against the actual secure-WebView/Foliate runtime files that the packed package includes. Validation SHALL compare the staged record to package contents after the runtime synchronization path has completed. A source-tree-only, stale, missing, or package-divergent record SHALL fail validation and SHALL NOT be represented as native runtime integrity evidence.

#### Scenario: Packed secure runtime differs from its integrity record
- **GIVEN** a secure runtime has been staged and the package is packed
- **WHEN** a declared runtime file is missing, extra, stale, or hash-mismatched between the staging record and packed package contents
- **THEN** integrity validation fails before the package can claim a complete secure-WebView runtime
