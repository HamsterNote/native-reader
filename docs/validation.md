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
pnpm --filter @hamster-note/native-reader run build
pnpm run test
pnpm --filter @hamster-note/native-reader exec jest --config ../../jest.config.cjs --rootDir . --runInBand
pnpm --filter @hamster-note/native-reader-demo test --runInBand
```

Focused Jest covers format detection, error categories, models, accessible flow
controls, bridge schemas, timeout/replacement cleanup, and native source helpers.
The bounded transfer state machine, native source/controller lifecycle and
JVM production protocol have separate local tests. Mocked native gates are not
installed-WebView proof.
The full root `test` also runs release lifecycle verification, which consumes
the package's generated `lib`; build the package first on a clean checkout.
The removed source-string runtime assertions are replaced by the public-control
and authenticated-message tests in `NativeReader.web.test.tsx`, including
confirmed page navigation in both flows and read/render timeouts.

## Browser baseline and measurements

```sh
pnpm run e2e:web:install
pnpm run e2e:web --workers=2
# Choose a unique test server port when 8181 is already in use.
READER_E2E_PORT=19451 pnpm run e2e:web
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

## Reader chrome checklist (HAM-38)

Use the root README setup sequence, including submodule check and Web runtime
sync/check, then `pnpm run dev:web`. Expo normally serves `http://localhost:8081`;
when occupied, use `pnpm run dev:web --port 18738` with a free port and the
printed LAN URL. This is the committed `apps/demo` public-package consumer,
not the temporary shell from the issue screenshot. Use the real file chooser.
All fixtures below are redistributable synthetic CC0 files.

1. Open `fixtures/epub/reader-chrome-stress.epub` in Chromium at 1440x900,
   390x844 and 320x640. Also constrain the reader itself to 320 pixels in a
   wide host. Record its actual width: Demo padding means it differs from the
   window. The 120+ character title includes an unbroken word; it must truncate
   visibly, retain the full accessible name and leave controls reachable without
   overlap or horizontal chrome overflow.
2. Tab to `Toggle table of contents` and open the `Reader contents` modal.
   Focus begins at close; Tab and Shift+Tab cycle inside it. Open settings and
   Escape back to its opener, then Escape to the toolbar. Check close/backdrop
   dismissal too. Background inert/aria-hidden must include the publication
   iframe; keyboard, wheel, click and focus attempts cannot reach it. Actual
   screen-reader speech still needs separate device evidence.
3. Scroll the 63-item TOC to `Stress 63`. Successful navigation closes the
   drawer and shows Chapter 63 of 63; Scrolled Next is disabled, while Paginated
   Next remains available until the final page. Unavailable entries retain feedback.
4. Measure the iframe open/closed: unchanged and at least 240 pixels high.
   Check 679/680-pixel reader widths (two/one toolbar rows), 44x44 controls,
   the embedded 320-pixel reader, and a 390x360 short host. Dialogs must fit
   inside the reader without horizontal overflow. Resize retains renderer identity.
5. Open settings to switch Scrolled/Paginated; selected reflects confirmation.
   `Previous page` / `Next page` turn a page; Scrolled directly steps readable
   chapters and disables at first/last chapters. Paginated wheel must neither
   turn pages nor displace content; keyboard pagination stays available. Check
   both directions, no wrap and boundaries after TOC/flow/resize. Native scrolled
   keyboard/wheel scrolling remains available. `fixtures/cbz/valid-fixed.cbz`
   shows its fixed notice in settings. Component tests cover unavailable flow
   and absent callback disabled states.
6. Replace the source while a modal is open: it closes and isolation clears.
   `fixtures/epub/no-toc-spine.epub` still offers settings through its empty
   contents drawer. Choose malformed input, then valid input to verify recovery.
7. Run shared chrome component tests at 320/390/wide widths and both native
   bundle commands. Record actual Android/iOS touch/scroll/screen-reader runs
   separately; unavailable devices are **unverified**, not implied by export or
   the browser-generated native runtime. Existing pre-source safety gates stay.
   Native uses platform `Modal`, not the Web DOM focus trap. Check platform Back,
   title readout on show, settings-opener readout on return and toolbar-opener
   readout after dismissal on devices. The backdrop covers the platform window;
   renderer identity must remain unchanged. Local Android container probes use
   actual `ReactModalHostView` and `HNSecureWebView`, with mocked bridge queues and
   default-off feature flags. They do not prove real WebView or reader speech.
   Native hardware-keyboard containment is outside this authorized scope;
   Android/iOS Modal and accessibility behavior is **device unverified**.

Accessibility labels and roles are listed in the package README. The public
chapter/flow APIs remain stable. Automated geometry,
renderer identity, keyboard and screenshot coverage lives in
`tests/e2e/foliate-reader.spec.ts`; Chromium rendering evidence and Firefox
fail-closed evidence are reported separately. Actual command results and remaining
platform gaps are recorded in the change's `verification.md`.

### LAN HTTPS

The internal iframe protocol is v2 (`page`, `page-state`, matching requestId);
the private native `hn-foliate-host` envelope remains v1 with commandId mapping.
Always stage both runtimes and check their manifests, then sync/check consumer
assets. The secure WebView package stage verifies and copies the native closure
into its Apple bundle; the tracked source bundle is an intentionally unstaged
fail-closed skeleton, not the release runtime.

Localhost HTTP is a secure browser context, but ordinary LAN HTTP is not. The
existing probe uses `crypto.randomUUID`; a LAN HTTP session correctly fails
closed. Use HTTPS without changing CSP, probe code or browser security flags.
The Demo's Metro config accepts optional TLS files; set both or neither:

```sh
mkdir -p .expo/reader-tls
READER_LAN_IP=192.168.0.145 # Replace with this machine's LAN IPv4 address.
openssl req -x509 -newkey rsa:2048 -nodes -days 7 \
  -keyout .expo/reader-tls/key.pem -out .expo/reader-tls/cert.pem \
  -subj '/CN=Local reader acceptance' \
  -addext "subjectAltName=IP:$READER_LAN_IP,IP:127.0.0.1,DNS:localhost"
chmod 600 .expo/reader-tls/key.pem
READER_DEV_TLS_CERT="$PWD/.expo/reader-tls/cert.pem" \
READER_DEV_TLS_KEY="$PWD/.expo/reader-tls/key.pem" \
pnpm run dev:web --port 18738 --https
```

Open `https://<LAN-IP>:18738` in Chromium and trust/accept this local certificate
before selecting a book. Keep the private key local and out of Git. Expo marks
`--https` deprecated in favor of tunnels; this setup deliberately stays on LAN.
The TLS option leaves default HTTP exports and the reader's security gates intact.
Automated HTTPS smoke may accept this self-signed certificate for its test
context only; it must still pass the real, unchanged publication CSP probe.

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
