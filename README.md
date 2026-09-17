# Native Reader

`@hamster-note/native-reader` is a controlled, cross-platform reader component
library for Expo applications on Android, iOS, and web. It is intended to be
consumed by other HamsterNote projects as a reusable reading surface.

This repository is initialized with [OpenSpec](https://github.com/Fission-AI/OpenSpec)
using the `spec-driven` schema. Product behavior is specified first as OpenSpec
changes, then implemented.

## Repository status

Environment baseline only. No reader component implementation is present yet.

- `openspec/` — OpenSpec root (`config.yaml`, `specs/`, `changes/`).
- `.opencode/` — OpenSpec propose/apply/archive/sync commands and skills.

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
