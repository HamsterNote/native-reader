# Add Cross-Platform EPUB Reader

## Why

The initialized reader package exposes only placeholder content. HamsterNote needs a secure, controlled reader for user-selected local EPUB files on iOS, Android, and Web, with one package-root API and executable acceptance evidence.

## What Changes

- Replace the unshipped placeholder API with a controlled local URI `source` and observable asynchronous load states.
- Implement platform-specific adapters: `epubjs` on Web and `@epubjs-react-native/core` with Expo FileSystem and WebView on native.
- Add complete linear-spine and TOC navigation, default-deny publication scripting/network behavior, and deterministic resource cleanup.
- Add an Expo Demo-owned document picker, deterministic fixture corpus, automated checks, and native bundle evidence; acceptance is gated by automated verification and native bundle export rather than physical-device runs.

## Non-Goals

Remote URL sources, DRM, fixed-layout publications, media overlays, guaranteed ZIP random streaming, and hard large-file memory or latency limits are excluded.
