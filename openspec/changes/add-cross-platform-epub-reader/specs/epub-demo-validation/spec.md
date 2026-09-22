# Spec Delta

## ADDED Requirements

### Requirement: Demo owns document selection
The Expo Demo SHALL expose an EPUB-only user-initiated picker, request native cache copying, convert Web `File` to a host-owned blob URI, and pass only the controlled source to the package root.

#### Scenario: Selection is cancelled
- **WHEN** the picker is cancelled
- **THEN** the existing source and reader state remain unchanged

### Requirement: Deterministic EPUB fixture corpus
The repository SHALL include offline deterministic, redistributable fixtures for valid EPUB 2/3, malformed, unsupported, adversarial, and representative larger publications with recipes, terms, checksums, sizes, and expected behavior.

#### Scenario: Fixture provenance is audited
- **WHEN** fixture documentation and files are inspected
- **THEN** every fixture has a recipe, redistribution terms, checksum, size, and behavior tags

### Requirement: Web end-to-end acceptance
Browser E2E SHALL drive the exported Demo through public UI and cover selection, ready/error, ordered traversal, TOC, replacement, malformed/unsupported input, script suppression, and external-request blocking.

#### Scenario: Web happy path completes
- **WHEN** the valid fixture is selected in the exported Web Demo
- **THEN** ready, first-to-last traversal, and TOC navigation are observed through public UI

### Requirement: Native build and real-device evidence
Separate iOS and Android bundle/build checks SHALL exist. Acceptance SHALL additionally record one physical device per platform covering picker access, loading, spine/TOC, replacement, malformed input, lifecycle recovery, and script blocking.

#### Scenario: Builds pass without device evidence
- **WHEN** both native bundles pass but either physical-device record is absent
- **THEN** native runtime acceptance remains incomplete
