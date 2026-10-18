# Proposal

## Why

At native-reader `45562da04e0af2eb80694537bc5d962ecd320f23` (Foliate submodule `78914aef4466eb960965702401634c2cb348e9b1`), automatic CSP canaries produce browser errors and publication CSP blocks legitimate inline styles. These block HAM-48's strict consumer acceptance despite working reading flows.

## What Changes

- Delta 1, independently accepted: remove deliberate CSP-violation canaries from default consumer startup; retain explicit host-enabled diagnostics, stable unsupported outcomes, and publication isolation. Revise the existing mandatory automatic behavioral-probe contract explicitly.
- Delta 2, independently accepted: make author `style` attributes, author style elements, and Foliate-injected styles effective under `publication` policy. Evaluate blob stylesheets first; document a narrowly scoped style-only allowance in design.
- Add an independent consumer regression that opens, closes, and reopens the same EPUB without reload, counts all console errors and failed requests, and checks computed styles in real publication frames.

## Capabilities

### New Capabilities

- `publication-style-rendering`: author and renderer styles work under publication CSP, with executable computed-style acceptance and unchanged script/network restrictions (delta 2).

### Modified Capabilities

- `foliate-reader-security`: default startup is free from deliberate diagnostic violations; intrusive behavioral diagnostics require host opt-in, while initial CSP and unsupported fail-closed behavior remain required (delta 1). Update the existing policy requirement to reference the explicit style-only exception.

## Impact

Runtime generation in `scripts/stage-foliate-runtime.mjs`, shared `packages/native-reader/src/foliate-csp-policy.json`, probe authorization/state handling, generated Web/native manifests/assets, tests and fixture generation. No Foliate pin change or new dependency is planned. Existing security specs mandate an automatic probe; this change deliberately supersedes that mandate, not the script or network policy. No public reading API break is intended; any diagnostic option defaults off and is host-owned.

## Non-goals

No WebBase edits or submodule repinning there; no reader redesign or new format support; no relaxation of publication `script-src 'none'`, `connect-src 'none'`, navigation, sandbox, private bridge, or source ownership. No npm publication, tags, releases, unnecessary PRs, deployment, or archive. This stage creates planning documents only; a later implementation handoff supplies a reviewed commit for eventual main integration after owner acceptance.
