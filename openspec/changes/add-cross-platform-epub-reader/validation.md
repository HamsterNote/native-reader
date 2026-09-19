# Validation Record

Date: 2026-09-19

## Passed

- `corepack yarn workspaces list --json`
- `corepack yarn install --immutable` (completed with the upstream Expo FileSystem adapter's obsolete exact-peer warning)
- `corepack yarn verify`
- `corepack yarn workspace @hamster-note/native-reader-demo build:web`
- `corepack yarn workspace @hamster-note/native-reader-demo exec expo install --check`
- `corepack yarn workspace @hamster-note/native-reader-demo exec expo-doctor` (21/21 checks)
- `corepack yarn e2e:web` (7/7 Chromium tests)
- `corepack yarn bundle:ios`
- `corepack yarn bundle:android`
- `corepack yarn smoke:large`
- `git diff --check`

Resolved runtime matrix:

- Expo `57.0.24`
- React Native `0.86.3`
- `epubjs` `0.3.93`
- `@epubjs-react-native/core` `1.4.5`
- `@epubjs-react-native/expo-file-system` `1.1.1`
- `expo-file-system` `57.0.7`
- `react-native-webview` `13.16.1`
- `react-native-gesture-handler` `2.32.0`
- `expo-document-picker` `57.0.2`

## Not Executed

- Physical iOS and Android checklists: no physical devices are attached to this execution environment; both records remain `INCOMPLETE - NOT EXECUTED`.

The successful native exports prove module and dependency bundling only. They do not substitute for Web browser execution or physical-device behavior evidence.
