# cross-platform-reader-demo Specification

## Purpose

Defines a runnable Expo demonstration and repeatable acceptance path proving that external consumers can use the placeholder reader on iOS, Android, and Web.

## Requirements

### Requirement: Demo consumes the public package
The Demo SHALL consume `@hamster-note/native-reader` through its package root as a workspace dependency and SHALL NOT import library internals or maintain a copied reader implementation.

#### Scenario: Demo resolves the workspace package
- **WHEN** the Demo is type checked, bundled, or exported
- **THEN** its reader import resolves through the same public package entrypoint available to external consumers

### Requirement: Shared three-platform Demo scenario
The Demo SHALL provide one shared screen for iOS, Android, and Web that renders sample content through `NativeReader`, exposes controls to select each supported theme, and exposes controls to select at least a beginning and an in-progress initial-position fixture. The screen SHALL include stable identifiers for its root, reader, theme state, and position state.

#### Scenario: Default Demo launch
- **WHEN** the Demo launches on iOS, Android, or Web
- **THEN** it shows the same sample title, explicit placeholder status, light theme, and beginning position through the public reader component

#### Scenario: Theme fixture selection
- **WHEN** a user selects light, dark, or sepia in the Demo
- **THEN** the public reader component is re-rendered with that theme and the visible theme state matches the selection

#### Scenario: Position fixture selection
- **WHEN** a user selects the in-progress fixture
- **THEN** the public reader component visibly reports the fixture section and normalized progress without persisting the selection

### Requirement: Platform acceptance paths
The repository SHALL provide documented commands to launch the Demo on iOS, Android, and Web and to produce a static Web export. Acceptance for each interactive target SHALL require that the Demo starts, the shared screen renders without a fatal error, and the theme and position fixtures visibly update the placeholder.

#### Scenario: iOS acceptance
- **WHEN** an evaluator runs the documented iOS Demo command in a supported simulator or device environment
- **THEN** the shared reader scenario can be inspected and its theme and position fixtures complete without a fatal error

#### Scenario: Android acceptance
- **WHEN** an evaluator runs the documented Android Demo command in a supported emulator or device environment
- **THEN** the shared reader scenario can be inspected and its theme and position fixtures complete without a fatal error

#### Scenario: Web acceptance
- **WHEN** an evaluator runs the documented Web command or serves the static Web export
- **THEN** the shared reader scenario can be inspected in a browser and its theme and position fixtures complete without a fatal error

### Requirement: Minimum automated verification
The repository SHALL provide root-level commands that verify strict TypeScript checking, linting, formatting, unit and component tests, the consumable library build, package-root consumer resolution, and Demo Web export. Component tests SHALL cover default rendering, custom content and position, all themes, progress normalization, style/test identifier forwarding, and semantic parity under iOS, Android, and Web platform selection.

#### Scenario: Aggregate verification succeeds
- **WHEN** an implementer runs the documented aggregate verification command from a clean dependency installation
- **THEN** type checking, linting, formatting checks, tests, library build, package consumer verification, and Demo Web export all complete successfully

#### Scenario: Platform behavior regresses
- **WHEN** a platform variant omits required placeholder information or changes the public export contract
- **THEN** a component, contract, consumer, or build verification fails before the change is accepted
