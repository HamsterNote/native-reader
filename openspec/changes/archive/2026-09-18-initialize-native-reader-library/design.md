# Design

## Context

See `proposal.md` for motivation. `native-reader` is a greenfield repository containing only OpenSpec and OpenCode workflow files. The implementation must establish a reusable package and a consumer Demo while remaining deliberately smaller than a real reading engine.

The sibling `native-painting` repository provides the required structural baseline: Yarn 4.12.0 with the `node-modules` linker; `packages/*` and `apps/*` workspaces; Expo SDK 57 with React 19.2.3, React Native 0.86.3, React DOM 19.2.3, and React Native Web 0.21; TypeScript 6; React Native Builder Bob; platform-aware package exports; and root-level typecheck, lint, format, test, and build scripts. This change reuses those conventions but does not copy painting-specific Skia, CanvasKit, E2E, or dependency-audit infrastructure.

## Goals / Non-Goals

**Goals:**

- Produce one independently consumable `@hamster-note/native-reader` package and one Expo Demo that exercises only its public entrypoint.
- Keep the public API small enough to remain useful when a real reader engine is introduced later.
- Use shared React Native primitives so the first placeholder behavior is equivalent on all three targets without platform-only dependencies.
- Make package integrity and observable placeholder behavior verifiable without requiring simulators for the minimum automated gate.

**Non-Goals:**

- Selecting or integrating an EPUB, PDF, HTML, Markdown, WebView, or native document-rendering engine.
- Defining a production book/document schema, pagination model, navigation model, or reading-location compatibility contract.
- Persisting progress or settings; fetching content; implementing authentication, DRM, annotations, search, accessibility certification, analytics, or host migration.
- Publishing to a registry, adding CI-provider configuration, or adding automated native E2E in this change.

## Decisions

### D1. Mirror the reference workspace boundary

Use a private Yarn 4.12.0 root with `nodeLinker: node-modules`, a single lockfile, and these workspaces:

```text
package.json                  # private workspace root and aggregate scripts
packages/native-reader       # publishable @hamster-note/native-reader
apps/demo                    # private Expo SDK 57 consumer application
```

The root owns shared TypeScript, ESLint, Prettier, and Jest configuration. Unlike `native-painting`, no `e2e` workspace is created because the requested first version needs only a placeholder and minimum verification; Web export plus component tests provide proportionate automated evidence. This preserves the reference project's package/app relationship without introducing unused infrastructure.

Alternative: a single Expo application exporting a component. Rejected because it does not prove an external project can consume the package or enforce a public boundary.

### D2. Pin the sibling-compatible cross-platform stack

Use the versions established by `native-painting`: Expo `~57.0.23`, React and React DOM `19.2.3`, React Native `0.86.3`, React Native Web `~0.21.0`, `@types/react` `~19.2.2`, TypeScript `~6.0.3`, and Yarn `4.12.0`. Use strict TypeScript with bundler module resolution. Verify the Demo matrix with `expo install --check` and `expo-doctor` when dependencies are installed.

The package lists React, React Native, React DOM, and React Native Web as peer dependencies and development dependencies, rather than bundling host framework copies. Expo remains a Demo dependency, not a package runtime dependency.

Alternative: choose latest versions independently. Rejected because diverging from the validated sibling matrix adds compatibility work unrelated to the placeholder goal.

### D3. Use React Native Builder Bob and platform-aware root exports

Configure `packages/native-reader` like the reference package: source under `src`, generated artifacts under `lib`, module/CommonJS/TypeScript targets, `main`/`module`/`types` fields for built consumers, and `react-native`, `browser`, and conditional `exports` entries for Metro and Web resolution. Keep `src/index.ts`, `src/index.native.ts`, and `src/index.web.ts` as explicit public surfaces that export the same names.

All three entries delegate to a shared primitive-based component implementation in version one. Platform entrypoints remain explicit so a future reading engine can vary internally without changing package-root imports. A packed-consumer check builds a tarball in temporary storage and compiles small ESM and CommonJS fixtures against installed package artifacts.

Alternative: source-only package exports. Rejected because external non-Metro consumers need built JavaScript and declarations. Alternative: distinct placeholder implementations per platform. Rejected because it creates divergence without a platform requirement.

### D4. Define a deliberately skeletal public API

The package root exports the following conceptual contract:

```ts
type ReaderContent = {
  id: string;
  title: string;
  placeholderText?: string;
};

type ReaderPosition = {
  sectionId?: string;
  progress?: number;
};

type ReaderTheme = 'light' | 'dark' | 'sepia';

type NativeReaderProps = {
  content: ReaderContent;
  initialPosition?: ReaderPosition;
  theme?: ReaderTheme;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};
```

`content` is a placeholder descriptor, not a parsed book. The optional initial position is intentionally coarse and display-only; progress is normalized to `[0, 1]`, with absent/non-finite values shown as zero. The naming reserves a migration path toward a future engine but does not promise that this shape is a durable book-format model. There is no callback or imperative handle because version one has no navigation or mutable reading state.

Alternative: accept EPUB/PDF URIs or arbitrary HTML now. Rejected because those inputs prematurely select parsing, security, network, and rendering semantics. Alternative: expose an opaque `source: unknown`. Rejected because it provides no useful type contract to integrators.

### D5. One shared semantic placeholder

Implement the surface with React Native `View`, `Text`, and `StyleSheet` only. It displays a visible "Reader placeholder" status, title, optional placeholder text, optional section, percentage progress, and active theme. Theme tokens live in the library and cover background, foreground, muted text, border, and accent colors for light/dark/sepia. The caller `style` is composed last on the root container, and `testID` is forwarded to that root.

No platform file may add behavior beyond minor export selection. Tests set or mock the platform to iOS, Android, and Web and assert the same semantic labels and values. Exact font metrics and pixel identity are not required.

Alternative: use a WebView to resemble a reader. Rejected because it adds platform and security complexity and falsely implies production content rendering.

### D6. Demo is an external-consumer acceptance harness

The private Expo Demo uses `@hamster-note/native-reader: workspace:*`, never a relative source import. Its single screen contains deterministic sample content, theme selectors, and beginning/in-progress fixture selectors. State belongs to the Demo; selecting a fixture passes new props to `NativeReader` and does not imply persistence.

Scripts mirror the reference Demo where applicable: `start`, `ios`, `android`, `web`, `build:web`, `typecheck`, `lint`, and `test`. Acceptance is documented as:

1. `yarn workspace @hamster-note/native-reader-demo ios`
2. `yarn workspace @hamster-note/native-reader-demo android`
3. `yarn workspace @hamster-note/native-reader-demo web`
4. On each target, confirm the sample title and placeholder status, switch all themes, switch to the in-progress fixture, and confirm section/progress changes.
5. `yarn workspace @hamster-note/native-reader-demo build:web` proves the Web production bundle/export path.

Native launch commands are explicit manual acceptance paths because simulator/device availability is environmental. They are not part of the minimum headless aggregate gate.

### D7. Minimum verification is layered and package-focused

Root scripts delegate to both workspaces:

- `typecheck`: strict package and Demo compilation.
- `lint`: root and workspace ESLint.
- `format:check`: Prettier verification.
- `test`: package component/contract tests and Demo tests.
- `build`: Builder Bob package build followed by Demo Web export.
- `verify`: typecheck, lint, format check, test, and build.

Package tests cover default/custom props, all themes, progress normalization, optional fields, style/testID forwarding, and iOS/Android/Web semantic parity. A public API contract test prevents internal exports. Built ESM/CommonJS consumer fixtures and a packed-package check verify declarations and export resolution. Demo tests prove it imports the package root and passes fixture selections into the public component.

## Risks / Trade-offs

- [The placeholder API could be mistaken for a production document contract] -> Name placeholder-only fields explicitly, document all deferred capabilities, and avoid parser/source types until a separate OpenSpec change defines them.
- [Expo and React Native versions can drift] -> Pin the sibling-tested matrix in manifests and lockfile, then run Expo's compatibility checks during implementation.
- [Source conditions can hide broken built exports] -> Verify both workspace/Metro resolution and packed ESM/CommonJS consumer resolution.
- [Platform parity tests do not replace device execution] -> Keep manual iOS/Android launch acceptance explicit and use the Web export as the minimum automated bundle proof.
- [No E2E test means Demo controls are not browser-driven] -> Accept this for the placeholder scope; component integration tests cover the state flow, and browser E2E can be added when real interaction exists.

## Migration Plan

1. Create the root workspace and shared tool configuration without modifying the OpenSpec setup.
2. Add and test the publishable package with public entries, shared placeholder component, and build output.
3. Add the Expo Demo as a workspace consumer and implement deterministic fixture controls.
4. Add aggregate verification and packed-consumer checks, then document the three platform launch paths.
5. Run the automated gates and available platform smoke checks. Because this is a greenfield repository with no consumers or persisted data, rollback is removal of the new workspace files; no data migration is required.

Future real-reader work must arrive as separate changes that extend or revise this contract explicitly. It must not be smuggled into this initialization implementation.
