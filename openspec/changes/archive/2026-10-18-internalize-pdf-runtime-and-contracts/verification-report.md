# HAM-54 Migration Verification

## Delivered Scope

Delivery branch `agent/ham-54-internalize-pdf`, based on Web PR #7
`4e031e2057907ff9e8603e60ee188f0d787ab9c9`. Existing PR bases remain intact.
The implementation verification below predates the authorized feature-branch
push. PR creation/base selection remain pending; no archive, merge, tag or npm
publication is authorized in this handoff.
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

### Historical Execution and Evidence

Build success:5m55s,33 Gradle tasks. The isolation parent was empty after
cleanup; authority invariants passed. This was a historical disposable
bootstrap, not an executable file in the delivery tree. Its two source files
can be inspected from the #9 Git object (do not run this retired recipe):

```sh
git show 5be2d826301a7364c978c166ea33e39c822b1acd:packages/native-reader/scripts/android-fault-matrix/bootstrap.py
git show 5be2d826301a7364c978c166ea33e39c822b1acd:packages/native-reader/scripts/android-fault-matrix/run-isolated.mjs
```

The historical run used JDK17/SDK36 and a checked official Gradle ZIP, changed
the disposable wrapper URL to that ZIP, and relayed proxy settings into the
disposable Gradle/test JVM configuration. These operations explain the saved
log; they are not the later approved cache-preprovisioning recipe. No shared
Gradle home, init script, daemon state or dependency cache was injected.

The authenticated HAM-54 result comment `01a14eba-4eb5-7822-b522-3a06b58f09dd`
contains attachment `01a14eba-477b-78fb-bcd5-055a3b732223`, filename
`ham54-final-validation-evidence.tgz`, SHA-256
`81ce879f41265db3550e2bb12433303ffd4b2992f106b359c318931f72b8ac0e`.
Download with the Multica CLI, then inspect these archive members:

```sh
multica attachment download 01a14eba-477b-78fb-bcd5-055a3b732223 -o ./attachments
tar -tzf ./attachments/ham54-final-validation-evidence.tgz
```

- `gradle-ham54-android/run.log`: actual command/output and cleanup result.
- `gradle-ham54-android/provenance.json`: exact integration revision, official
  distribution URL, ZIP size and SHA-256.
- `attachments/ham54-android-junit/TEST-*.xml`: all six actual JUnit reports,
  89 tests,0 failures/errors/skips.

### Reproduction From the Delivery Branch

The delivered generic entry is the existing production isolation gate; it
does not require a missing bootstrap script. With JDK17/SDK36 installed:

```sh
export JAVA_HOME=/home/zhangxiao/tools/jdk-17
export ANDROID_HOME=/home/zhangxiao/Android/Sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"
pnpm install --frozen-lockfile --ignore-scripts
node scripts/bootstrap-foliate-submodule.mjs
node scripts/stage-foliate-runtime.mjs
mkdir -p "$HOME/.cache/opencode-tmp/opencode"
pnpm --filter @hamster-note/native-reader run test:android-fault-matrix
```

The gate creates and removes its own unique private Gradle home and checks all
authority digests. The normal wrapper keeps its official URL and checksum.
It may download tooling/dependencies; this is separate from the PDF runtime
and offline consumer, which allow no external requests.

To reproduce the five PDF suites, use a fresh sibling clone. The exact
historically tested source merge can be reconstructed without an unpushed
integration commit or bootstrap file:

```sh
git clone --no-hardlinks . ../ham54-android-repro
cd ../ham54-android-repro
git checkout --detach 5be2d826301a7364c978c166ea33e39c822b1acd
if ! git merge --no-commit --no-ff c33822d95ac700bfd140bcd9b5593774dedd4328; then
  test "$(git diff --name-only --diff-filter=U)" = packages/native-reader/scripts/stage-pdf-runtime.mjs || exit 1
  git restore --source=c33822d95ac700bfd140bcd9b5593774dedd4328 -- packages/native-reader/scripts/stage-pdf-runtime.mjs
  git add packages/native-reader/scripts/stage-pdf-runtime.mjs
fi
git commit --no-edit
pnpm install --frozen-lockfile --ignore-scripts
node scripts/bootstrap-foliate-submodule.mjs
node scripts/stage-foliate-runtime.mjs
mkdir -p "$HOME/.cache/opencode-tmp/opencode"
pnpm --filter @hamster-note/native-reader run test:android-fault-matrix
```

The PDF isolation gate stages the newly built207 assets and selects all five
PDF suites plus securewebview. Confirm six JUnit suites and89 methods; compiling
or a successful asset stage alone is insufficient. The clone stays local and
is not part of the delivery branch. The later migration commits only change the
dependency closure, package verification fixture and documentation, not these
runtime assets or Android code.

During P3 closure, the clone/checkout/merge/conflict-resolution commands above
were executed in a new local clone. The resulting commit `8942919` has an
identical Git tree to historical integration `22b28cc` (`git diff --exit-code`
passes). Gradle was not rerun for this documentation correction.

Later approval permits only checked-cache preprovisioning: verify the official
ZIP against the selected wrapper's `distributionSha256Sum` before any copy,
then seed only the gate-owned private distribution cache. Keep its URL/SHA,
ownership checks and authority digests unchanged. Setting a shared
`GRADLE_USER_HOME` is not preprovisioning (the gate replaces it). This delivery
does not add a cache-seeding CLI or claim this later recipe was rerun. The
unmodified official-download route has encountered distribution timeouts in
the parallel verification workspace; that fresh-download reproduction remains
unverified. On timeout, retain the error and do not substitute the historical
URL/proxy rewrite, a shared cache or an isolation bypass.

The checksum prerequisite can be run from either selected checkout before
preprovisioning (a checksum mismatch stops this command):

```sh
HAM54_GRADLE_ZIP=/home/zhangxiao/.cache/gradle-distributions/gradle-9.3.1-bin.zip node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
const wrapper = readFileSync('packages/native-reader/android-fault-matrix/gradle/wrapper/gradle-wrapper.properties', 'utf8');
const pin = /^distributionSha256Sum=([a-f0-9]{64})$/m.exec(wrapper)?.[1];
assert.ok(pin, 'Missing wrapper distribution SHA-256');
const zip = process.env.HAM54_GRADLE_ZIP;
assert.ok(lstatSync(zip).isFile(), 'Distribution must be a regular file');
assert.equal(createHash('sha256').update(readFileSync(zip)).digest('hex'), pin);
console.log(`Verified Gradle ZIP: ${pin}`);
JS
```

This is verification only. Any future preprovisioner must run it before writing
the gate-owned distribution cache, preserve the pinned official URL, reject
links/special files and unsafe destinations, and retain normal owned cleanup.
The existing production CLI still downloads into its fresh private home;
there is no checked-in preprovisioning entry to invoke or claim as tested.

The parallel implementation `agent/agent/5be086b2a42d` (`ede047e`) was explicitly
discarded. Its package, test counts and download failures must not be merged
with this delivery's recorded successful historical evidence.

### CI Network Boundary

CI may use network access to install locked dependencies and provision the
pinned JDK/SDK/Gradle and browser tooling. Gradle/Robolectric dependency
resolution is build provisioning, not PDF runtime access. Runtime verification
starts only after provisioning: the packaged consumer permits loopback only
and requires zero external requests; rootless WebKit runs with `--network=none`.
No runtime download, network fallback, proxy injection, shared Gradle home or
weakened isolation is permitted to make these checks pass.

## Independent Environment and Corrections

The independent checkout contains native-reader only, with its own dependency
installation and no reader package. Initial offline provisioning found a missing
cached eslint tarball; normal locked dependency provisioning filled the cache,
then `pnpm install --offline --frozen-lockfile --ignore-scripts` passed.
Network for dependency/tool installation is distinct from runtime network use.

The historical independent Gradle environment used the same verified official
local ZIP, private Gradle caches and disposable URL/proxy configuration described
above. It predates the later cache-only approval; no production security seam
or test assertion was changed. This evidence is retained with its actual method,
not relabeled as a subsequent approved cache-only run.

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
acceptance. The owner confirmed Web acceptance on2026-10-18 in HAM-54 comment
`01a14f03-b9fc-7e18-87be-ff5664bcfd86`, including the integrated demo height fix
`e99e9df`. HAM-54 changes ownership/build tooling; it does not reopen or complete
the historical native product tasks. The migrated HAM-46 archive remains
unchanged.
