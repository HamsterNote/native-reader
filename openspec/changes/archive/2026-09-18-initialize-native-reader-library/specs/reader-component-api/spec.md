# Spec Delta

## Purpose

Defines the stable public contract and observable placeholder behavior of the cross-platform reader component consumed by external Expo projects.

## ADDED Requirements

### Requirement: Public reader package surface
The package SHALL export `NativeReader` and the public TypeScript types `NativeReaderProps`, `ReaderContent`, `ReaderPosition`, and `ReaderTheme` from its root entrypoint. The same named API SHALL resolve for iOS, Android, Web, ESM, CommonJS, and TypeScript declaration consumers without exposing Demo or internal implementation modules.

#### Scenario: External project imports the public API
- **WHEN** a consumer imports the package root using a supported module or React Native resolution path
- **THEN** the consumer can resolve the reader component and all documented public types without importing a package subpath

#### Scenario: Packed package excludes application internals
- **WHEN** the library is packed for consumption
- **THEN** the package contains the built entrypoints, declarations, and required source entrypoints but does not expose the Demo as public library API

### Requirement: Minimal reader props
`NativeReader` SHALL require a `content` value with a stable identifier and title plus optional placeholder text. It SHALL accept an optional `initialPosition` with a section identifier and normalized progress, an optional `theme` of `light`, `dark`, or `sepia`, an optional React Native view `style`, and an optional `testID`. The component SHALL default to the beginning position and light theme when optional values are omitted.

#### Scenario: Minimum props render
- **WHEN** a host renders `NativeReader` with only valid `content`
- **THEN** the component displays the content title using the light theme and a beginning position of zero percent

#### Scenario: Optional props are reflected
- **WHEN** a host supplies placeholder text, section position, normalized progress, theme, style, and test identifier
- **THEN** the rendered placeholder reflects the content metadata, section, progress, and theme while applying the host style and test identifier to its root surface

### Requirement: Deterministic placeholder experience
The component SHALL display a clearly labeled non-production reader placeholder with content title, optional placeholder text, current section label when supplied, normalized progress, and active theme. Equivalent input props SHALL produce semantically equivalent information and state on iOS, Android, and Web.

#### Scenario: Same props across platforms
- **WHEN** equivalent props are rendered on iOS, Android, and Web
- **THEN** each platform presents the same placeholder label, content metadata, position, and active theme even if native text rendering differs visually

#### Scenario: Position is display-only
- **WHEN** the placeholder renders an initial position
- **THEN** it displays that position without parsing content, paginating, persisting progress, or requesting additional content

### Requirement: Safe placeholder input handling
The placeholder SHALL treat `initialPosition.progress` as a normalized value and clamp finite values to the inclusive range from zero to one for display. It SHALL fall back to zero for absent or non-finite progress and SHALL render without throwing when optional text or section values are absent.

#### Scenario: Out-of-range progress
- **WHEN** progress is below zero or above one
- **THEN** the displayed progress is clamped to zero or one respectively

#### Scenario: Missing optional metadata
- **WHEN** placeholder text and section identifier are omitted
- **THEN** the component renders its required placeholder state without empty metadata labels or a runtime error

### Requirement: Scope boundary is observable
The first version SHALL NOT present controls or behavior that imply working document parsing, pagination, navigation, progress persistence, network retrieval, DRM, annotations, search, or production reading.

#### Scenario: Consumer supplies placeholder content
- **WHEN** the component receives content through its public API
- **THEN** it renders only the documented placeholder information and performs no file parsing, network request, persistent storage access, or content-service interaction
