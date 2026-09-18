# Proposal

## Why

HamsterNote needs a reusable reader surface that external Expo projects can integrate consistently on iOS, Android, and Web. The repository currently contains only its OpenSpec baseline, so the package boundary, public API, runnable Demo, and verification contract must be established before real reading capabilities are designed.

## What Changes

- Initialize a standalone Yarn 4 workspace aligned with `native-painting`, with the publishable `@hamster-note/native-reader` package under `packages/native-reader` and a private Expo Demo under `apps/demo`.
- Establish an Expo SDK 57, React 19, React Native 0.86, React Native Web, and TypeScript 6 baseline, with React Native Builder Bob producing module, CommonJS, and declaration artifacts.
- Add a minimal controlled `NativeReader` component API accepting placeholder content, an initial position, theme and style customization, and stable test identifiers.
- Render the same deterministic placeholder reading experience on iOS, Android, and Web, including visible content metadata, position, and theme state. No real document parsing or pagination is performed.
- Add an Expo Demo that imports the library only through its public package entrypoint and provides one acceptance path that can be launched on Android, iOS, and Web.
- Add package contract and component tests plus root scripts for type checking, linting, tests, package build, and Demo Web export.
- Explicitly defer EPUB, PDF, and other book-format parsing; pagination and production rendering; persistent reading progress; network content services; DRM; annotations; search; and host-application migration.

## Capabilities

### New Capabilities

- `reader-component-api`: Public package exports and the minimal controlled reader component contract, including placeholder content, initial position, theme/style inputs, and deterministic cross-platform behavior.
- `cross-platform-reader-demo`: Expo Demo behavior and the iOS, Android, and Web acceptance and verification paths for the placeholder reader experience.

### Modified Capabilities

None. This is the first project change and no existing capability specifications are present.

## Impact

- Creates the Yarn workspace root, shared TypeScript/lint/test/build configuration, library package, and Expo Demo application.
- Introduces the public `NativeReader`, `NativeReaderProps`, `ReaderContent`, `ReaderPosition`, and `ReaderTheme` API surface from `@hamster-note/native-reader`.
- Adds Expo SDK 57-compatible React, React Native, React DOM, React Native Web, TypeScript 6, React Native Builder Bob, Jest, ESLint, and Prettier dependencies consistent with `native-painting`.
- Establishes iOS, Android, and Web as supported targets while intentionally limiting version one to a non-production placeholder surface.
