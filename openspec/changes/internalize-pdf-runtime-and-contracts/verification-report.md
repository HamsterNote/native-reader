# HAM-54 Migration Verification

## Delivered Scope

Local branch `agent/ham-54-internalize-pdf`, based on Web PR #7
`4e031e2057907ff9e8603e60ee188f0d787ab9c9`. Existing PR bases remain intact.
No push, PR, tag, npm publication or persistent server was performed.
Reader remains read-only and clean. Android #9 is used only in a separate
temporary integration; iOS #8 is not integrated.

| Change | Location |
| --- | --- |
| Maintain DOM adapter and CSS locally; existing RN/Web UI and source dispatch retained | `packages/native-reader/src/pdf/pdfDom.ts:1`, `pdf.css:1` |
| Single authoritative contracts source and platform-free ESM/CJS/types export | `packages/native-reader/src/pdf/contracts.ts:1`, `packages/native-reader/package.json:45` |
| TypeScript AST compilation and exact PDF.js asset collection | `packages/native-reader/scripts/stage-pdf-runtime.mjs:29` |
| Strict file/link/type/ownership checks and atomic writes | `packages/native-reader/scripts/pdf-runtime-files.mjs:22` |
| Installed-package sync with manifest SHA/MIME/size validation | `packages/native-reader/scripts/sync-pdf-web-runtime.mjs:1` |
| Real tarball, no peers/DOM contracts, offline drawing and teardown | `scripts/verify-pdf-consumer.mjs:1` |
| Standalone rootless offline WebKit | `scripts/run-pdf-webkit.sh:1` |
| Preserve private package boundary, allowing only shipped consumer tools | `packages/native-reader/scripts/verify-static-native-propagation.mjs:71` |
| Authoritative four specs and immutable HAM-46 archive | `openspec/specs/`, `openspec/changes/archive/2026-10-18-add-platform-pdf-renderers/` |

The old source artifact archive, pin, revision/import arguments and manifest
`reader` field are removed. Historical source/copyright references remain only
in provenance, notices and archived records. The only added dependency is exact
`pdfjs-dist@5.4.530`; its unused optional Node canvas dependency is excluded.
No Vite/bundler or previous component/EPUB parser library is introduced.

## Results

| Command / entry | Actual result |
| --- | --- |
| `pnpm run typecheck` | workspace pass, including no added DOM requirement on contracts consumers |
| `pnpm run test` | independent library31 suites/386 tests + demo2 suites/18 tests pass |
| `pnpm run build` | independent pass: safety, Bob, real isolated securewebview Gradle matrix, release lifecycle, npm/pnpm installed consumers, Android new-architecture APK, Metro Web export |
| `pnpm run test:pdf-runtime` | 23/23 pass; stage/sync and public/private script boundary |
| `node packages/native-reader/scripts/stage-pdf-runtime.mjs` and `--check` | 205 assets pass; deterministic rebuild, check-only and no source-contract writes |
| `pnpm e2e:pdf --project=chromium-desktop --project=chromium-mobile --project=firefox` | delivery tree21/21; temporary Android integration27/27 |
| `pnpm run test:pdf:webkit` | delivery tree7/7; temporary Android integration9/9; rootless Noble, network disabled |
| `node scripts/verify-pdf-equivalence.mjs --baseline <previous-native-runtime>` | exact metadata/events/pixels/text/thumbnail/selection/bounds/host bytes; external requests0 |
| `node scripts/verify-pdf-consumer.mjs --tarball <actual> --sha256 <actual>` | independent directory: ESM/CJS/no-DOM types,205 assets, pixels/text/thumbnail/bounds/host bytes/worker close; external requests0 |
| `pnpm run supply-chain:check` | Foliate431-file closure pass |
| `pnpm run test:supply-chain` | 14/14 pass |
| `pnpm run test:foliate-runtime` | 5/5 pass |
| `pnpm run test:foliate-web-runtime` | 8/8 pass |
| `pnpm run test:native-export` | 2/2 guard cases pass |
| existing Foliate browser/transport regression (`foliate-reader.spec.ts`, `native-foliate-runtime.spec.ts`, Chromium/Firefox) | 54 pass,40 existing browser-specific skips,0 failures |
| release safety / secure staging / release lifecycle | 7 static +90 Node pass,2 Windows-only skips; staging/lifecycle pass |
| `openspec validate --specs --strict` | 9/9 pass |
| `openspec validate internalize-pdf-runtime-and-contracts --strict` | pass |
| changed-code ESLint / `git diff --check` | pass |
| local provenance verification | all14 migrated spec/archive file hashes match; no source repository needed |

Package identity: 663 files,205 runtime manifest entries.
Tarball SHA-256:
`b26d6565d4b9966c897dbcc6e2fa2a39f2f4dceda224c56bd42b17cecdd88fb3`.
Runtime manifest SHA-256:
`d055a7721ce1de1395f932a90726b48dd666989c9f2d38f028e02b66e52f0cdd`.

The build format adds `contracts.js` and the unmodified upstream `pdf.min.mjs`
to #7's203 assets. All202 common assets remain identical; only adapter output
changes. Source DOM adapter differs only in the contracts import path. Worker,
fonts, CMaps, WASM, ICCs, licenses, existing shell and protocol retain their bytes
and MIME. See implementation-notes for coverage mapping and baseline evidence.

## Android Integration

Temporary merge `22b28cc226375a4667fc156f12651d64e7a934e4` combines migration
runtime source `c33822d` with #9 `5be2d826301a7364c978c166ea33e39c822b1acd`.
Its207 assets add Android's two existing shell files. Five PDF suites plus the
existing securewebview matrix passed through the production isolation API:

| JUnit suite | Tests | Failures / Errors / Skips |
| --- | --- | --- |
| HNPdfAssets | 5 | 0 / 0 / 0 |
| HNPdfDocument | 8 | 0 / 0 / 0 |
| HNPdfProtocol | 4 | 0 / 0 / 0 |
| HNPdfSource | 5 | 0 / 0 / 0 |
| HNPdfView | 6 | 0 / 0 / 0 |
| HNSecureWebViewClientFaultMatrix | 61 | 0 / 0 / 0 |
| Total | 89 | 0 / 0 / 0 |

Evidence includes all six real JUnit XML reports, bootstrap run.log and official
distribution provenance. Build success:5m55s,33 Gradle tasks. The isolation
parent is empty after cleanup; authority invariants passed. Command:

```sh
python3 packages/native-reader/scripts/android-fault-matrix/bootstrap.py \
  --repo . --revision 22b28cc226375a4667fc156f12651d64e7a934e4 \
  --workdir <fresh-disjoint-directory> \
  --distribution <official-gradle-9.3.1-bin.zip>
```

JDK17/SDK36; Gradle ZIP SHA-256 remains
`b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06`.
No shared Gradle state is injected. Disposable wrapper URL and proxy properties
are the only bootstrap configuration changes; checksum verification stays on.

## Independent Environment and Corrections

The independent checkout contains native-reader only, with its own dependency
installation and no reader package. Initial offline provisioning found a missing
cached eslint tarball; normal locked dependency provisioning filled the cache,
then `pnpm install --offline --frozen-lockfile --ignore-scripts` passed.
Network for dependency/tool installation is distinct from runtime network use.

The independent Gradle environment uses the same verified official local ZIP,
private Gradle caches and proxy relay into the Robolectric JVM. Only disposable
wrapper/Gradle network configuration changes; no production security seam or
test assertion is changed.

The final independent source is `9b7c938` (the same product tree as delivery
`8d9c677`; cherry-picked fixture-fix commit identity differs). With JDK17 and
SDK36 configured, the existing generic matrix compiled and ran successfully
in3m13s/32 tasks. The actual663-file package then passed npm/pnpm installed
ESM/CJS and conditional types/exports, and real `assembleDebug` with
`newArchEnabled=true`, x86_64, Codegen/autolink and C++ (1m15s/124 tasks).
The resulting APK was not executed. The iOS package check explicitly reports
source-only evidence because CocoaPods/Xcode are unavailable; it is not an
iOS build or release acceptance. Sequential independent command:

```sh
pnpm run typecheck && pnpm run build && pnpm run test &&
pnpm run test:pdf-runtime &&
node packages/native-reader/scripts/stage-pdf-runtime.mjs --check
```

Initial clean-directory `test` ran before Bob's `lib` existed; the existing
lifecycle fixture copies `lib`, so it failed. Final verification runs build
before test, sequentially. The first full build also exposed a pre-existing
package whitelist omission for PDF sync plus the new helper; an exact two-file
allowlist and regression test fix it. A second full build reached actual packed
conditional-export loading and exposed missing `FlatList`, `Image` and
`TextInput` in the existing Node resolution smoke's RN boundary stub. Both
ESM/CJS stubs now declare the already-used platform exports; the real package
remains unstubbed. These failures are not counted as acceptance.
An attempted artifact destination that was an ancestor of the isolated checkout
was correctly refused; the final artifact destination is disjoint.

The existing Foliate browser matrix initially refused its occupied default
port8181. A disposable config imported the unchanged checked-in config and
only changed its base URL/server port to18341 and selected the two existing
Foliate files. It passed54 cases with40 existing browser-specific skips, then
the test-owned server stopped and the disposable config was removed. No
existing service was reused or stopped. Reproduction with a free default port:

```sh
node scripts/run-foliate-gated.mjs -- pnpm exec playwright test \
  tests/e2e/foliate-reader.spec.ts tests/e2e/native-foliate-runtime.spec.ts \
  --project=chromium --project=firefox
```

## Remaining Acceptance

No Android/iOS device, native selection handles, long-press menu or Safari
acceptance is claimed. iOS builds and device checks are not run in this migration.
Windows filesystem-specific cases remain skipped on Linux. The immutable HAM-46
archive retains15/33 completed tasks and18 unchecked tasks, with Web-only human
acceptance. HAM-54 changes ownership/build tooling and awaits Web human recheck;
it does not reopen or complete those native product tasks.
