# Tasks

## 1. Workspace and Toolchain

- [x] 1.1 Create the private Yarn 4.12.0 workspace root, `.yarnrc.yml` with the `node-modules` linker, and `packages/*` plus `apps/*` workspace boundaries; verify `yarn install --immutable` succeeds and `yarn workspaces list --json` reports only the reader package and Demo workspaces.
- [x] 1.2 Add shared strict TypeScript 6, ESLint, Prettier, and Jest configuration modeled on `native-painting`; verify focused configuration smoke commands load each tool without configuration errors.
- [x] 1.3 Pin the Expo SDK 57-compatible React 19.2.3, React Native 0.86.3, React DOM 19.2.3, React Native Web 0.21, and TypeScript 6 dependency matrix; verify `yarn workspace @hamster-note/native-reader-demo expo install --check` and `yarn workspace @hamster-note/native-reader-demo expo-doctor` pass.

## 2. Public Reader Package

- [x] 2.1 Scaffold `packages/native-reader` as version `0.1.0` of `@hamster-note/native-reader` with React and React Native framework peer dependencies; verify the workspace manifest is publishable and does not depend on Expo or any document parser, WebView, persistence, networking, DRM, or content-service package.
- [x] 2.2 Define `ReaderContent`, `ReaderPosition`, `ReaderTheme`, and `NativeReaderProps` with required content and optional initial position, theme, style, and test identifier; verify TypeScript contract tests accept every documented combination and reject missing or unsupported public values.
- [x] 2.3 Implement the shared primitive-based `NativeReader` placeholder with light, dark, and sepia tokens, optional metadata, normalized progress display, root style composition, and test identifier forwarding; verify component tests cover defaults, custom props, all themes, non-finite and out-of-range progress, and missing optional metadata.
- [x] 2.4 Add `index.ts`, `index.native.ts`, and `index.web.ts` package-root surfaces that expose only the documented component and types; verify an API contract test proves identical named exports across entrypoints and no Demo or internal module is exported.
- [x] 2.5 Exercise the shared component under iOS, Android, and Web platform selection; verify component tests assert equivalent placeholder label, content metadata, section, progress, and theme semantics on all three targets.

## 3. Build and Consumer Boundary

- [x] 3.1 Configure React Native Builder Bob for ESM, CommonJS, and TypeScript declarations under `lib`, plus `main`, `module`, `types`, `react-native`, `browser`, and conditional package exports; verify a clean package build produces every referenced artifact.
- [x] 3.2 Add ESM and CommonJS consumer fixtures that import only `@hamster-note/native-reader` and exercise all public types; verify both fixtures type check against built package artifacts without source-relative imports.
- [x] 3.3 Add a packed-package verification script that installs or inspects the generated tarball from temporary storage; verify the tarball contains required builds, declarations, and source entrypoints while excluding tests, Demo files, and internal fixtures.

## 4. Cross-Platform Expo Demo

- [x] 4.1 Scaffold `apps/demo` as a private Expo SDK 57 application depending on `@hamster-note/native-reader` through `workspace:*`; verify source search and a Demo contract test find only the package-root import and no copied or relative reader implementation.
- [x] 4.2 Build one shared Demo screen with deterministic sample content, stable root/reader/state identifiers, selectors for light, dark, and sepia, and beginning/in-progress position fixtures; verify Demo component tests cover the default screen and every selector transition.
- [x] 4.3 Configure `start`, `ios`, `android`, `web`, and `build:web` scripts using Expo workspace resolution; verify the Web development bundle resolves the workspace package and the static Web export completes without a fatal bundling error.
- [x] 4.4 Document the iOS, Android, and Web acceptance commands and checklist in the repository README; verify the checklist requires the same sample title and placeholder status, every theme, and the in-progress section/progress update on each target.

## 5. Quality Gates and Scope Audit

- [x] 5.1 Wire root `typecheck`, `lint`, `format:check`, `test`, `build`, and aggregate `verify` scripts across the package and Demo; verify each command independently and then `yarn verify` from a clean immutable installation.
- [x] 5.2 Run the available iOS and Android Expo launch or bundle smoke checks and record the exact results separately from automated tests; verify any unavailable simulator/device path is reported as an environment limitation rather than represented as passing.
- [x] 5.3 Audit manifests, exports, source, and user-facing Demo text against the version-one boundary; verify no real format parser, pagination engine, persistence, network content service, DRM, annotations, search, or production-reader behavior was introduced.
- [x] 5.4 Perform the final package-content and public API audit; verify the built and packed package can be consumed externally, the Demo remains outside the public surface, and all OpenSpec acceptance scenarios are covered by automated evidence or the explicit native manual checklist.
