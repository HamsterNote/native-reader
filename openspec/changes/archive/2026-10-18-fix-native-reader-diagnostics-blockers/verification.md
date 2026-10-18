# Local implementation evidence

Base: native-reader `45562da04e0af2eb80694537bc5d962ecd320f23`;
Foliate remains `78914aef4466eb960965702401634c2cb348e9b1`.

## Approved correction to the third assertion

The pinned `vendor/foliate-js/paginator.js:979` creates two style elements.
Rules are supplied only through `setStyles()` at line 1100; the reader never
calls that method with CSS. Thus there is no actual injected stylesheet rule
to inspect for task 4.2. Actual Foliate layout styles are assigned to element
style attributes by `setStylesImportant()` (for example, `html` receives
`overflow-wrap: break-word !important` in paginated flow at line 325).

HAM-53 comment `01a14e79-7ca3-7697-8b9d-98cb33738641` approved option A:
assert real pagination effects and a flow update. Option B, adding a production
reading stylesheet merely for acceptance, was rejected as unrelated behavior.
Spec delta, design and task 4.2 reflect that decision. Author attribute and
style-element assertions remain unchanged; no test CSS was injected.
The style-only inline allowance remains the design section 2 decision.

## Initial implementation checks (WIP 2a549c0)

- `multica attachment download 01a14e71-3ca7-7f28-b0e7-d7fcada95aef -o ./attachments`: downloaded; original planning files restored with tar.
- `pnpm install --frozen-lockfile`: passed (existing dependency build-script notices).
- `pnpm run foliate:submodule:bootstrap`: passed; unchanged pin above.
- `pnpm run foliate:runtime:stage`: passed; transient generated runtime, not complete platform synchronization.
- `pnpm run test:foliate-runtime`: 5/5 passed, including quiet startup, explicit diagnostic success/failure and missing-capability cases. An earlier run failed on the old auto-probe expectation; the updated regression then passed.
- `pnpm --filter @hamster-note/native-reader exec jest --config ../../jest.config.cjs --rootDir . --runInBand NativeReader.web.test NativeReader.native.gate.test nativeFoliateProtocol.test webSecurity.test`: 4 suites, 85 tests passed.
- `pnpm run fixtures:generate`: 37 deterministic fixtures generated.
- `pnpm run fixtures:check`: 37 fixtures and Foliate format parser checks passed.
- `pnpm run typecheck`: passed for package and consumer.
- `pnpm run lint`: passed for workspace, package and consumer.
- `openspec validate fix-native-reader-diagnostics-blockers --strict`: passed.

## Independent strict consumer acceptance

`/diagnostics-consumer.html` imports the package public API and does not mount
Demo UI. Listeners precede navigation and count all console errors, failed
requests and page errors, including nested frames. No routes, mocks, console
overrides or allowlists are used. An unchanged performance time origin proves
no reload; two identical source reads prove the same host-owned blob was used.
Each close waits for iframe removal plus event-loop/animation-frame settlement.

Chromium `153.0.8010.12`, on both opens:

| Viewport | Author attribute / rule | Actual Foliate pagination | After flow update | Console Errors / Failed Requests / Page Errors / Probes |
| --- | --- | --- | --- | --- |
| 1280 x 900 | rgb(17, 34, 51) / italic | html overflow-wrap break-word !important; declared/computed column-width 505px; height 534px | column-width auto; height 147.875px | 0 / 0 / 0 / 0 |
| 390 x 844 | rgb(17, 34, 51) / italic | html overflow-wrap break-word !important; declared/computed column-width 335px; height 478px | column-width auto; height 147.875px | 0 / 0 / 0 / 0 |

Desktop/mobile screenshots were inspected: real content renders, author italics
are visible, and controls/text fit. JSON reports contain computed author values,
renderer properties, geometry and diagnostics separately.

```sh
pnpm run e2e:web -- tests/e2e/reader-diagnostics-consumer.spec.ts --project=chromium --workers=1
```

Result: **2 passed**. Repeating with `--output=test-results/strict-consumer`
after the differential also passed 2/2 with all counters zero.

## Required CSP differential

```sh
HN_DIAGNOSTICS_WITHOUT_INLINE=1 pnpm run e2e:web -- tests/e2e/reader-diagnostics-consumer.spec.ts --project=chromium --workers=1 --grep desktop --output=test-results/csp-differential
```

Result: **expected exit 1, 1 failed**. On both opens, author color assertions
failed with actual `rgb(0, 0, 0)` and author italic assertions failed with actual
`normal`. There were **8 console errors / 0 failed requests / 0 page errors / 0
probes**. DOM-written Foliate pagination styles still applied; they alone are
not evidence that author inline styles are permitted.

The helper copies the normal export to ignored `apps/demo/dist-without-publication-inline`
and changes exactly the exported publication CSP constant using parsed policy
JSON. Repository policy, package/public runtime and normal export remain unchanged.
The temporary copy's manifest is intentionally not re-signed: this is a local
negative experiment, not a distributable runtime. The normal command without
the environment flag restores the normal server and **passes 2/2**. Failure
trace, context and screenshots remain under `test-results/csp-differential`.
Both commands were repeated after the final EOF normalization with identical
outcomes. The final differential JSON includes actual author color/font style;
command logs are `csp-differential-command.log` and `strict-consumer-command.log`.

## Separate security and native browser checks

```sh
pnpm run e2e:web -- tests/e2e/foliate-reader.spec.ts --project=chromium --workers=1 --output=test-results/foliate-chromium
pnpm run e2e:web -- tests/e2e/foliate-reader.spec.ts --project=firefox --workers=1 --grep 'Firefox fails closed' --output=test-results/foliate-firefox
pnpm run e2e:web -- tests/e2e/reader-diagnostics-consumer.spec.ts tests/e2e/native-foliate-runtime.spec.ts tests/e2e/foliate-reader.spec.ts --project=chromium --project=firefox --workers=1 --grep 'strict consumer|native |CSS HTTP' --output=test-results/final-browser-evidence
```

Results: **38 passed / 1 platform skip**, **1 passed**, and **20 passed / 6
platform skips**, respectively. Firefox rejects before source-backed blob I/O
and attempts no probes. Explicit Web opt-in still runs the full real-browser
control/strict canaries. Native browser tests retain bounded transfer, digest,
source authorization, private bridge and network-denial coverage. Native Firefox
cases verify unsupported outcomes, not rendering support.
The 20-pass/6-skip combination was repeated against final generated bytes after
EOF normalization, and its final log/JSON/screenshots replace earlier evidence.

The adversarial EPUB covers HTTP same-origin, HTTP cross-origin and HTTPS CSS
imports/images/fonts plus scripts and an event handler. CDP independently
reported all **9 CSS requests blocked by CSP**; the real local canary server
received **0** requests. Script/handler execution flags remained unset in the
publication, host and consumer. The negative test recorded **25 console errors /
10 failed requests**, separately from strict zero-error acceptance. Existing
sandbox, bridge, source ownership and navigation assertions passed.

## Runtime consistency

```sh
pnpm run foliate:submodule:bootstrap
pnpm run foliate:submodule:check
pnpm run foliate:runtime:stage
pnpm run foliate:web-runtime:sync
pnpm run foliate:runtime:check
pnpm run foliate:web-runtime:check
cp -R packages/native-reader/foliate-runtime/native/. packages/native-reader/apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/
node packages/native-reader/scripts/stage-secure-webview.mjs --generate-integrity-manifest
node packages/native-reader/scripts/stage-secure-webview.mjs --verify
pnpm run test:foliate-runtime
pnpm run test:foliate-web-runtime
```

All passed: **16 package / 19 Web / 23 native assets**, runtime tests **5/5**,
sync tests **8/8**. Direct `verifyIosFoliateRuntimeBundle()` verified checked-in
bundle closure and hashes. Parsed manifests were compared: Web equals public,
native equals checked-in Apple bundle, and all preserve the pin. The checked-in
Apple bundle had drifted from the existing baseline generator; regeneration also
synchronizes its closed module graph, including the four separate renderer,
protocol, transfer and format modules. Parsed JSON comparison against `45562da`
confirmed the entire host policy and every non-style publication directive are
unchanged, including script-src/connect-src 'none'.

- Publication policy: `foliate-publication-csp-2`.
- Web bootstrap SHA-256: `76873f49f5d699a368624d07d5b236d5a9dcdeb7681502fda4cba8181cdc0088`.
- Native renderer SHA-256: `ea79f16d78c75a01cf20b635fedf6bfd6bb90e6129471239a74b06e5a715b79b`.

## Final workspace checks and limits

- `pnpm run fixtures:generate` and `pnpm run fixtures:check`: **38 deterministic fixtures passed**, including format parser checks.
- `pnpm run typecheck`: passed for package and consumer.
- `pnpm run lint`: passed; an earlier concurrent attempt raced a transient runtime staging directory and passed when rerun serially.
- `pnpm run test`: passed: **344 package + 18 consumer Jest tests**, plus **7 entrypoint and 90 safety tests** (2 Windows-only safety tests skipped on Linux).
- `pnpm exec prettier --check` on changed code and `git diff --check`: passed.
- `openspec validate fix-native-reader-diagnostics-blockers --strict`: passed final revalidation.
- `pnpm run build`: first attempt passed library module/CommonJS/types compilation and secure-WebView staging, then failed because Java was not on PATH and JAVA_HOME was unset.
- `JAVA_HOME=/home/zhangxiao/tools/jdk-17 ANDROID_HOME=/home/zhangxiao/Android/Sdk ANDROID_SDK_ROOT=/home/zhangxiao/Android/Sdk pnpm run build`: Android fault-matrix **BUILD SUCCESSFUL**, but aggregate command exited 1 at subsequent release-lifecycle recovery. During this run, final diff review caught an extra EOF blank line in the newly tracked renderer. Removing it in the generator changed recovered runtime manifest bytes before the authority integrity manifest had been regenerated; recovery correctly rejected the mismatch. This was a transient generation inconsistency, not an Android failure or an environmental exception.
- After regenerating all runtime copies/manifests together: runtime stage/check, public sync/check, secure-WebView verification and direct Apple closure/hash verification all passed again. Runtime tests **5/5**, Web sync tests **8/8**, `pnpm --filter @hamster-note/native-reader run test:release-lifecycle:raw` and `pnpm --filter @hamster-note/native-reader run test:consumer:raw` passed. Logs: `final-runtime-command.log`, `final-web-runtime-command.log`, `final-release-lifecycle-command.log` under test-results.
- `JAVA_HOME=/home/zhangxiao/tools/jdk-17 ANDROID_HOME=/home/zhangxiao/Android/Sdk ANDROID_SDK_ROOT=/home/zhangxiao/Android/Sdk pnpm --filter @hamster-note/native-reader run test:package:raw`: passed. Verified a 381-file local tarball, real npm/pnpm conditional exports, ESM/CJS consumers, integrity failure cases and the Android new-architecture consumer (`assembleDebug`, **BUILD SUCCESSFUL**, 124 tasks). The complete workspace package source digest remained unchanged. Log: `test-results/final-package-command.log`. This produced no npm publication.
- The entire aggregate `pnpm run build` has not been repeated after EOF normalization. Its failed recovery stage and downstream consumer/package stages passed directly after correction; Demo `build:web` also passed in final browser runs. Android fault-matrix succeeded before this whitespace-only normalization. No aggregate exit-0 claim is made.

Initial strict discovery caught a missing favicon (404); the isolated document
now declares a data favicon, with no diagnostic exemption. It also exposed an
extra pnpm `--` reaching Playwright and selecting the whole suite instead of
the requested test/project. The new runner strips only the leading separator
and retains the Foliate gate; the direct command now selects exactly 2 tests
and 1 worker.

Physical iOS/Android devices, real Safari and a fresh branded Edge run remain
unverified. Browser-native simulation is not installed-WebView evidence. No
Dev Server is left running; the owner will start the acceptance server.
No push, PR, tag, release, npm publication or WebBase modification occurred.

## Resumed eight-task delivery map

Locations refer to source files in the final local implementation. Generated
runtime entrypoints and manifests start at line 1; their hashes are above.

| Task | Changed locations | Evidence |
| --- | --- | --- |
| 2.3 | `scripts/epub-fixture-recipes.mjs:311`, `fixtures/epub/css-network-denied.epub`, `fixtures/manifest.json:1`, `tests/e2e/foliate-reader.spec.ts:1415`, `tests/e2e/foliate-reader.spec.ts:1540`, `scripts/serve-e2e.mjs:1` | 9 CSS URLs blocked by CSP, server count 0; script/handler flags unset; Chromium 38 passed, Firefox pre-source rejection passed |
| 3.1 | `scripts/stage-foliate-runtime.mjs:1146`; `packages/native-reader/apple/HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/`: `bootstrap.js:1`, `renderer.js:1`, `nativeFoliateProtocol.js:1`, `nativePublicationTransfer.js:1`, `publicationFormats.js:1`, `reader.html:1`, `manifest.json:1`; `foliate/{comic-book,epub,fixed-layout,mobi,paginator,view}.js:1`; `packages/native-reader/SECURE_WEBVIEW_SHA256.json:1` | Pinned generation, EOF normalization, Web/public sync and checks passed; checked-in Apple module closure synchronized |
| 3.2 | Same generated runtime/manifest locations | Runtime 5/5, Web sync 8/8; Chromium native simulation passed, Firefox unsupported cases passed; physical devices unverified |
| 4.1 | `apps/demo/index.ts:1`, `apps/demo/src/DiagnosticsConsumer.tsx:1`, `scripts/stage-diagnostics-consumer.mjs:1`, `playwright.config.ts:3`, `tests/e2e/reader-diagnostics-consumer.spec.ts:37` | Independent public API consumer, listeners before navigation, no mocks or allowlists |
| 4.2 | `tests/e2e/reader-diagnostics-consumer.spec.ts:77`, `apps/demo/src/DiagnosticsConsumer.tsx:29`, `scripts/stage-diagnostics-consumer.mjs:15`; change `design.md:37`, `specs/publication-style-rendering/spec.md:9`, `tasks.md:22` | Same blob twice, stable document, real author/Foliate properties and changed flow geometry; expected-fail differential then restored pass |
| 4.3 | `tests/e2e/reader-diagnostics-consumer.spec.ts:178`, `scripts/run-web-e2e.mjs:1`, `package.json:31`; `apps/demo/src/DemoApp.tsx:264` retains explicit diagnostic opt-in | Exact direct command passes 2/2; all four strict counters 0; separate explicit-probe browser regression passed |
| 5.1 | This document, final workspace checks | Typecheck, lint, tests, formatting and OpenSpec strict validation passed; build outcome recorded above; policy/pin constraints checked |
| 5.2 | This document and `tasks.md:28`; final Multica reply and attached source/evidence archives | Local review handoff; integration and pin-ready SHA remain owner acceptance work |

## Owner acceptance entry

The owner can start the following sequence under their tmux session; no persistent
server was started by this run. This is a manual handoff recipe, not another test
result. Ensure port 8181 is available.

```sh
pnpm run foliate:web-runtime:sync
pnpm --filter @hamster-note/native-reader-demo run build:web
node scripts/stage-diagnostics-consumer.mjs
node scripts/serve-e2e.mjs apps/demo/dist
```

Open `http://127.0.0.1:8181/diagnostics-consumer.html` and select
`fixtures/epub/inline-styles.epub`. Use the same source for close/reopen and switch
to scrolled flow on each open. The explicit `?diagnostics=true` variant deliberately
runs the retained negative canaries and is separate from quiet acceptance.
