# Native Reader

`@hamster-note/native-reader` is a controlled, cross-platform reader component
library for Expo applications on Android, iOS, and web. It is intended to be
consumed by other HamsterNote projects as a reusable reading surface.

This repository is initialized with [OpenSpec](https://github.com/Fission-AI/OpenSpec)
using the `spec-driven` schema. Product behavior is specified first as OpenSpec
changes, then implemented.

## Workspace

- `packages/native-reader` is the publishable `@hamster-note/native-reader` package.
- `apps/demo` is a private Expo application that consumes only the package root.
- `openspec/` contains the behavior and scope contracts.

The current reader is intentionally a non-production placeholder. It displays
content metadata, a display-only initial position, and light, dark, or sepia
theme tokens. It does not parse formats, paginate, persist, fetch content, or
provide DRM, annotations, search, or navigation.

## Setup and verification

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm run verify
```

The aggregate gate runs strict type checking, ESLint, Prettier, component and
contract tests, clean ESM/CommonJS/declaration builds, packed-package checks,
and an Expo static Web export.

## Demo acceptance

```sh
corepack pnpm --filter @hamster-note/native-reader-demo ios
corepack pnpm --filter @hamster-note/native-reader-demo android
corepack pnpm --filter @hamster-note/native-reader-demo web
corepack pnpm --filter @hamster-note/native-reader-demo build:web
```

On iOS, Android, and Web, verify the same acceptance scenario:

1. The title `Field Notes from Hamster Valley` and `Reader placeholder` status appear.
2. Select light, dark, and sepia; the visible theme state and reader both update.
3. Select `in-progress`; `Chapter 3` and `Progress: 42%` appear.
4. The screen remains a placeholder with no production reading controls.

## OpenSpec workflow

- Propose a change: `/opsx-propose "your idea"`.
- Apply an approved change: `/opsx-apply`.
- Validate: `openspec validate --all`.
- List changes and specs: `openspec list` / `openspec list --specs`.

## Reference

Structure and toolchain conventions follow the sibling
`HamsterNote/native-painting` repository. The exact Expo/React Native version
matrix is selected as part of the OpenSpec change that initializes the
component package.
