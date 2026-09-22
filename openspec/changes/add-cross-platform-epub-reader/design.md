# Design

## Platform Boundary

The package root exports `NativeReader` and platform-neutral source/state types. Platform entrypoints select `NativeReader.web.tsx` or `NativeReader.native.tsx`; adapter internals are not public subpaths. Web uses `epubjs`. iOS and Android use `@epubjs-react-native/core`, `@epubjs-react-native/expo-file-system`, and `react-native-webview`.

## Ownership and Lifecycle

The host owns the selected `file:`, `content:`, or `blob:` URI. The reader never opens a picker and never deletes or revokes that URI. Each source generation owns its parser, rendition, listeners, WebView session, and internally derived resources. Replacement or unmount disposes the generation once and ignores late events.

## Navigation

Adapters normalize ordered linear spine entries and a flattened, depth-preserving TOC. Only the current bounded rendition is displayed. Previous/next controls do not wrap, and an invalid TOC target reports recoverable feedback without discarding the current location.

## Security

Publication content is untrusted. Scripts, popups, `javascript:` navigation, external links, top-level navigation, and HTTP(S) publication subresources are denied by default. Packaged text, style, image, and font resources remain available through engine-managed archive URLs.

## Validation

Shared tests prove URI policy, stable errors, navigation normalization, and idempotent cleanup. Expo exports prove Web/iOS/Android module resolution. Playwright covers browser behavior when Chromium is available. Checked-in records reserve physical iOS and Android evidence; successful bundling never substitutes for real-device acceptance.
