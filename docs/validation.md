# Validation and evidence boundaries

Start from a clean checkout with Node 24 and `pnpm@10.0.0`:

```sh
pnpm run foliate:submodule:bootstrap
pnpm install --frozen-lockfile
pnpm run foliate:runtime:stage
pnpm run foliate:runtime:check
```

The bootstrap pins Foliate at `78914aef4466eb960965702401634c2cb348e9b1` on the
reviewed local branch. A default detached submodule checkout fails the gate.
Never bypass an unavailable runtime/security gate by weakening the CSP or bridge.

## Local checks

```sh
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run fixtures:check
node --test scripts/fixture-corpus.test.mjs
pnpm --filter @hamster-note/native-reader exec jest --config ../../jest.config.cjs --rootDir . --runInBand
pnpm --filter @hamster-note/native-reader-demo test --runInBand
```

Focused Jest covers format detection, error categories, models, accessible flow
controls, bridge schemas, timeout/replacement cleanup, and native source helpers.
The bounded transfer state machine, native source/controller lifecycle and
JVM production protocol have separate local tests. Mocked native gates are not
installed-WebView proof.
The removed source-string runtime assertions are replaced by the public-control
and authenticated-message tests in `NativeReader.web.test.tsx`, including
linear chapter navigation in both flows and read/render timeouts.

## Browser baseline and measurements

```sh
pnpm run e2e:web:install
pnpm run e2e:web --workers=2
pnpm run smoke:large
pnpm run smoke:large:io
pnpm run dev:web
# Optional official Linux Edge binary; this adds the branded Edge project.
HN_EDGE_EXECUTABLE=/path/to/msedge pnpm exec playwright test --workers=1
# Actual generated native renderer, exercised in a browser via MessageChannel.
pnpm exec playwright test native-foliate-runtime --project=chromium
JAVA_HOME=/path/to/jdk-17 node scripts/test-native-foliate-jvm.mjs
```

Playwright first syncs/checks the runtime, exports the Demo, verifies exported
assets, and serves that export locally. Chromium uses the full Chrome for
Testing executable (`channel: chromium`); Firefox is a fail-closed check only.
Browser-specific skips are expected and are not acceptance passes. Reports live
in `playwright-report/` and `test-results/`. Runtime-asset abort/404 cases record
source-I/O and renderer counters, distinct from unsupported-browser errors.

`smoke:large` writes `test-results/large-fixture-smoke.json` with actual browser
open/navigation outcomes for EPUB, MOBI, KF8/AZW3, FB2, FBZ, and CBZ. Each entry
records fixture identity, hash, byte size, elapsed measurements, and failure
stage. Every input is recorded even after a failed open; failures fail the run.
Navigation means one forward page/section, not a complete book traversal.
There is no performance threshold or fabricated memory measurement. The separate
`smoke:large:io` report measures only host file reads and SHA-256.

`dev:web` runs `expo start --web`; static export does not establish development
server behavior. Record that smoke separately. The probe's trusted control
canaries must be allowed to run so a negative result is meaningful. Do not
disable all networking and claim the publication policy blocked requests.

## Native build evidence

```sh
pnpm run bundle:ios
pnpm run bundle:android
pnpm run test:native-export
```

Both commands validate/stage the pinned Foliate assets before Expo export and
include the platform secure-host JavaScript integration. They run on Linux.
The export source map must contain the native entry, capability/bridge, and
platform secure-WebView module and must exclude the Web adapter. A successful
Expo exit alone is insufficient: the former directory alias silently selected
`index.web.ts` in native exports. The Demo now resolves its public source entry
with Metro's platform resolution, and each export command verifies its graph.
They do not compile/install the native module or execute WKWebView/Android
WebView. Native 4A/4B platform proof, 4C transfer, 4D rendering, and 4E lifecycle
have separate browser/JVM evidence. Device proof, unavailable Safari, isolated
Robolectric and Apple XCTest acceptance were waived by HAM-35 owner 修勾 on
2026-10-16. Complete physical-device records only from actual runs.

## Package and release gates

```sh
pnpm --filter @hamster-note/native-reader run test:release-safety
pnpm --filter @hamster-note/native-reader run test:foliate-runtime-package
pnpm --filter @hamster-note/native-reader run test:package
pnpm --filter @hamster-note/native-reader run release:verify
pnpm run verify
openspec validate --all --strict
```

The package wrappers isolate staging/packing and preserve the source tree.
Packed-consumer sync/check/export, platform compiler/consumer verification, and
the complete package raw gate must be recorded individually. A partial gate or
a failed environment is not a formal infrastructure exception. Do not manually
pack the source tree or omit its safety checks to get a passing result.

HAM-35 now requires Web/local acceptance under the owner's 2026-10-16 waiver.
Real branded Linux Edge is exercised; unavailable macOS/iOS Safari and device
behavior are recorded as waived, never passed. Runtime pre-source checks remain
mandatory and no unproved iOS publication boundary is enabled. The complete
package gate still runs; macOS Xcode and isolated Robolectric acceptance are
waived. `release:verify` retains its strict Xcode requirement for a future actual
iOS release; this waiver neither changes that command nor publishes a package.
Use `OWNER_WAIVERS.md` and `verification-round4.md` for the effective disposition.

`pnpm run supply-chain:check` scans project manifests, locks, patches and source,
checks the pinned submodule, and verifies both generated runtime manifests.
Only historical OpenSpec records, exact change-name documentation pointers, and
the named rejection checks may mention retired engines. Those checks cannot
import a retired engine. `pnpm run test:supply-chain` injects forbidden
dependencies, imports, payloads and revision/hash faults. The complete package
gate also scans each consumer's actual installed tarball tree.

The removed core template tests do not provide Foliate security evidence. Their
bridge and lifecycle responsibilities now belong to the shared wire corpus,
`NativeReader.appState.test.tsx`, generated bootstrap tests, and native fault
matrices. `native-foliate-runtime.spec.ts` executes the generated private host
and real Foliate renderer for six formats, navigation/flow, CSP, bad digests
and the pre-source gate. That browser test is not a device test.
