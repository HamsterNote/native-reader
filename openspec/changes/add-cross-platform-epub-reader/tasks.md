# Tasks

## 1. Baseline and Dependency Integration

- [x] 1.1 Confirm the initialization change has produced the Yarn 4.12 root, `packages/native-reader`, and `apps/demo` with their existing quality scripts; verify `yarn workspaces list --json` reports both workspaces, and stop this apply rather than creating a second baseline if they are absent.
- [x] 1.2 Add Expo SDK 57-compatible locked versions of `@epubjs-react-native/core`, `@epubjs-react-native/expo-file-system`, `react-native-webview`, required native peers, `epubjs`, and `expo-document-picker` to their owning workspaces; verify immutable install, `expo install --check`, and `expo-doctor` pass and record the resolved version matrix.
- [x] 1.3 Configure root-only package exports and platform resolution for shared, `.native`, and `.web` reader modules without exposing adapter internals; verify iOS, Android, Web, built-package, and external TypeScript consumer resolution tests all import only `@hamster-note/native-reader`.

## 2. Public Source and Lifecycle Contract

- [x] 2.1 Replace the unshipped placeholder contract with exported `ReaderSource`, load-state/error, and `NativeReaderProps` types centered on optional controlled `{ kind: 'uri', uri, name?, mimeType? }`; verify type tests accept supported local shapes and reject DOM `File`, remote-only variants, and legacy placeholder/status ownership.
- [x] 2.2 Implement shared URI policy and stable error categorization for absent, local native file/content, Web blob, HTTP(S), unreadable, invalid, and unsupported sources; verify unit tests prove no read occurs for absent or rejected remote sources and each failure maps to the expected code.
- [x] 2.3 Implement loading/ready/error rendering and `onStateChange` notifications keyed by source generation; verify deferred-open component tests show loading before completion, mutual exclusivity, and that source A cannot emit or render after replacement by source B.
- [x] 2.4 Implement idempotent generation cleanup for adapter instances, renditions, listeners, WebView sessions, reader-created object URLs, and temporary files while preserving host-owned URIs; verify replacement and unmount tests assert each owned resource is disposed once and no post-unmount notification fires.

## 3. Fixture Corpus and Shared Reading Model

- [x] 3.1 Add or deterministically generate redistributable EPUB fixtures for a multi-chapter EPUB 2/3 reflowable book with TOC and packaged media, malformed archive, unsupported fixed-layout metadata, script attempt, external subresource/link, and representative larger archives; verify a fixture manifest records provenance or recipe, redistribution terms, checksum, size, and tested behavior for each file.
- [x] 3.2 Define the internal adapter model for ordered linear spine entries, nested/flat TOC presentation, current index, previous/next boundaries, internal href/fragment navigation, and recoverable navigation errors; verify shared contract tests traverse every linear entry in order, disable both boundaries, resolve a fragment target, and preserve location after an invalid target.
- [x] 3.3 Add shared accessibility and test observability for load state, current/total chapter position, previous/next controls, TOC controls, and recoverable feedback; verify component tests can identify and operate the complete flow without relying on color or private adapter state.

## 4. Web EPUB Adapter

- [x] 4.1 Implement the Web adapter with locked `epubjs`, local blob-URI ingestion, bounded section rendering, metadata/spine/TOC normalization, previous/next, and TOC display.
- [x] 4.2 Configure Web rendition hooks to disable scripted content, reject `javascript:` and top-level navigation, suppress popups/external links, and block HTTP(S) publication subresources.
- [x] 4.3 Destroy Web book/rendition objects, hooks, listeners, DOM containers, and reader-created URLs on replacement/unmount.
- [x] 4.4 Map malformed, unreadable, and unsupported Web publications to stable errors without stale partial content.

## 5. Native EPUB Adapter

- [x] 5.1 Implement the iOS/Android adapter with `@epubjs-react-native/core`, the Expo FileSystem adapter, and `react-native-webview`, normalizing load events, metadata, linear spine position, TOC, previous/next, and target navigation to the shared model.
- [x] 5.2 Configure native WebView and reader options with scripted content disabled, local/archive resource access constrained, and `javascript:`, popup, top-level, external-link, and HTTP(S) subresource navigation denied.
- [x] 5.3 Handle native `file:` and picker `content:` URIs through the FileSystem adapter, including reader-owned temporary copies only when required.
- [x] 5.4 Tear down native reader/WebView state and ignore late events on source replacement, unmount, and foreground/background transitions.

## 6. Expo Demo Ownership Flow

- [x] 6.1 Add a user-initiated EPUB-only `expo-document-picker` flow to `apps/demo`, using `copyToCacheDirectory: true` on native and converting the Web asset to the shared local URI shape without passing DOM `File`.
- [x] 6.2 Keep the selected source and any application-created blob URL or cache asset under Demo ownership, preserve the prior source on cancellation, and safely release superseded/unmounted Web URLs.
- [x] 6.3 Present reader-owned empty/loading/ready/error behavior plus accessible chapter and TOC controls in the responsive Demo without duplicating parsing or rendition logic.

## 7. Automated Cross-Platform Acceptance

- [x] 7.1 Add Playwright coverage against an exported Web Demo for local fixture selection, loading-to-ready, ordered first-to-last traversal, TOC fragment jump, source replacement, malformed and unsupported errors, script suppression, external-request blocking, and cleanup.
- [x] 7.2 Add separate reproducible iOS and Android build or bundle commands that include the native EPUB dependencies and package root; verify both commands run from an immutable clean install and record their results independently from Web E2E.
- [x] 7.3 Add measured large-fixture smoke scripts or documented runs that capture archive size, open time, navigation outcome, failure, and available memory observations without enforcing an undocumented threshold.
- [x] 7.4 Wire deterministic type, lint, format, unit/component, package build/consumer, fixture integrity, Web E2E, and native build checks into documented root commands; verify the aggregate automated command passes from a clean checkout and does not claim to include physical-device validation.

## 8. Automated Acceptance and Documentation

- [x] 8.1 Update repository/package documentation with the controlled source API, host-owned picker example, supported EPUB profile, platform dependency model, lifecycle ownership, security defaults, commands, fixture provenance, validation status, and explicit non-goals.
- [x] 8.2 Run the final automated gate `pnpm run verify` and review the native bundle/export results and documentation together. Physical iOS and Android device validation is explicitly waived in this change's approved scope, so this gate is automated only and does not include physical-device checks. (Executed 2026-09-22: `pnpm run verify` passed; see validation.md.)
