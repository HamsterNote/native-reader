# Validation Record

## Scope

Physical iOS and Android device validation is explicitly waived under this change's approved scope. Acceptance is gated by automated verification instead:

- Web E2E via `pnpm run e2e:web`
- Native bundle export via `pnpm run bundle:ios` and `pnpm run bundle:android`
- The remaining root-level `verify` sub-checks run through `pnpm run verify`

Native bundle export proves module and dependency resolution and bundling only; it is not claimed to be equivalent to real-device execution, and this change does not require physical devices.

## Automated Gate

Date: 2026-09-22

`pnpm run verify` passed with exit status 0. This run started from a cleaned `packages/native-reader/lib` state (the gitignored Bob build output was removed first). To make that reproducible, the root `verify` script was reordered so `build` runs before `test`, because the native `test` scripts consume the built `lib/`; no checks were removed and no additional or circular runs were introduced. It covers the following automated gates:

- `pnpm run fixtures:check` — 11 deterministic EPUB fixtures verified (integrity, ZIP structure, checksums)
- `pnpm run typecheck` — package and Demo TypeScript compilation
- `pnpm run lint` — workspace, package, and Demo ESLint
- `pnpm run format:check` — Prettier (all matched files use Prettier code style)
- `pnpm run test` — secure WebView staging verification, release lifecycle verification, 209 package tests across 18 suites, and 8 Demo tests across 2 suites
- `pnpm run build` — native package `build:verify` (clean build, secure WebView staging, Android fault-matrix Gradle JVM unit tests, release lifecycle, consumer/package checks) and the Demo Web export (`expo export --platform web`)

No physical iOS or Android device was used. The Android fault-matrix step is a Gradle JVM unit-test run and the Android consumer check assembles an APK without a device, so this run is not physical-device evidence. Web E2E and native bundle export remain separate acceptance artifacts under the scope above.

Physical iOS and Android device validation is explicitly waived under this change's approved scope. Bundle and export success proves build and dependency packaging only and is not claimed to be real-device runtime evidence.

## Resolved Runtime Matrix

- Expo `57.0.24`
- React Native `0.86.3`
- `epubjs` `0.3.93`
- `@epubjs-react-native/core` `1.4.5`
- `@epubjs-react-native/expo-file-system` `1.1.1`
- `expo-file-system` `57.0.7`
- `react-native-webview` `13.16.1`
- `react-native-gesture-handler` `2.32.0`
- `expo-document-picker` `57.0.2`
