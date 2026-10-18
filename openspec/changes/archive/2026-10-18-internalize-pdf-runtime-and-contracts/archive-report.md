# HAM-54 Archive Report

Date:2026-10-18. Delivery branch:`agent/ham-54-internalize-pdf`.
PR base:`agent/ham-46-pdf-web` (#7), not main. This archive does not merge,
tag or publish the package, and does not modify the read-only reader repository.

## Acceptance Scope

The owner confirmed Web acceptance in HAM-46 comment
`01a14f00-473d-75f3-80ed-b3cc2b3f2452`; the coordinator authorized archive,
push and a stacked PR in `01a14f01-ccde-7107-8a47-3711a95fbe55`.
This includes the integrated demo height constraint `e99e9df`, following
runtime/contracts migration `fa96203`. Local PDF opening, Pages navigation,
selection Popover and browser context-menu suppression are accepted for Web.

All21 migration tasks are checked. The four master specs remain authoritative
in `openspec/specs/{pdf-renderer-routing,pdf-pages-navigation,
pdf-selection-popover,android-pdf-asset-origin}/spec.md`; all14 migrated
master/archive source hashes remain unchanged. Existing HAM-46 archive tasks
remain15/33 checked,18 unchecked. Migration completion does not complete them.

## P3 and Verification

The Android section of `verification-report.md` now separates historical
bootstrap execution from current permitted reproduction. It identifies the
exact #9 script Git objects, authenticated evidence attachment and six JUnit
members; no command assumes that missing script exists in this delivery tree.
The delivered production gate and temporary integration are directly described.
The documented merge reconstruction was executed and its tree exactly matches
the historical integration. Task5.4 records the bootstrap method and limits.
The discarded parallel implementation is explicitly identified.

Historical independent checks remain: full typecheck/build,386 library and18
demo tests, actual663-file package and205 assets, offline consumer, browser
matrix, supply-chain/security checks, and89 Android JVM methods. The earlier
full build also assembled an Android new-architecture consumer APK. These are
the actual recorded historical results, not a fresh Gradle-download result.

Closure reruns on the integrated demo revision: PDF safety23/23 and rootless
Podman WebKit7/7 (`--network=none`), including Web export and205-asset checks.
The coordinator also recorded Chromium desktop/mobile + Firefox21/21 after
the demo height fix. No persistent test service is left running by this work.

## Remaining Limits

- Android/iOS devices, native long-press menu suppression and selection handles
  remain unverified; no native device waiver is implied.
- Real Safari and iOS build acceptance remain unverified. Linux WebKit is not
  Safari. Windows-specific filesystem cases were skipped on Linux.
- Fresh official Gradle distribution downloading has timed out in the parallel
  environment. Later approval permits ZIP verification against the wrapper pin
  followed by preprovisioning only the gate-owned private cache. This later
  method was not rerun; historical disposable URL/proxy changes are accurately
  retained as history and are not presented as the approved future method.

## Archive Check

`openspec archive internalize-pdf-runtime-and-contracts --yes` moved this
21/21 change to the dated archive without changing spec behavior (`skip_specs`).
`openspec validate --specs --strict` passed for all9 master specs. The14 source
document hash checks and `git diff --check` also passed.

The repository also contains the pre-existing, completed27/27
`add-cross-platform-epub-reader` change, already present on main and the #7
baseline. It is outside HAM-54 and is deliberately retained. Therefore
`openspec list --json` no longer contains HAM-54 but is not globally empty;
it still lists that completed EPUB change. This is not reported as an empty
list or silently resolved by archiving unrelated EPUB work.
