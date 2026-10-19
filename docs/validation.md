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

## Evidence hygiene

Verification logs and reports are committed artifacts and the repository is
public. Do not record machine-specific identifiers in `verification.md` /
`verification-report.md`, `docs/physical-device/*.md`, or attached
JSON/smoke/log evidence: real LAN or private IP addresses, developer usernames,
absolute home paths (`/home/<user>`, `/Users/<user>`), tmux/pod session names,
or real hostnames. Write documentation-only addresses (`192.0.2.0/24`),
`$HOME/...` or repository-relative paths, and placeholders such as
`<tmux-session>`. Record only what is needed to reproduce the check, and keep
private keys and secrets out of Git as before.

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
2. Contents initially is closed. Tab to `Toggle table of contents`, press Enter
   and Space repeatedly, and check visible focus and the accessibility tree's
   expanded state. On closing, focus stays on the toggle and hidden entries
   cannot receive Tab focus. Use an actual screen reader separately to verify
   spoken feedback; browser accessibility attributes alone are not speech proof.
3. Expand the 63-item, three-level TOC and scroll its own region to `Stress 63`.
   The region stays at most 160 pixels tall and does not cover the body. Activate
   the last entry: position becomes Chapter 63 of 63, Next disables, and the
   TOC remains open. Closing must not change position or applied flow.
4. Measure the actual publication iframe height with Contents open and closed:
   at least 240 pixels. Resize wide/narrow and scroll the short outer host to the
   body. The iframe and Foliate renderer must retain identity; body scrolling
   and pagination must still work.
5. Switch Scrolled/Paginated and confirm the selected state only after engine
   confirmation. Previous/Next move by chapter, never wrap, and disable at the
   ends. `fixtures/cbz/valid-fixed.cbz` shows `Fixed-layout publication` without
   either a flow selector or flow status. Component tests cover truthful status
   when switching is unavailable, including fixed/status priority.
6. With TOC open, choose `fixtures/epub/valid-epub3.epub`: new source is collapsed.
   `fixtures/epub/no-toc-spine.epub` has neither toggle nor empty panel. Choose
   `fixtures/epub/malformed.epub`, observe its error, then choose a valid book
   and confirm recovery. Component tests cover unresolved/non-linear entries
   and `Table of contents feedback`, without artificial engine switches in Demo.
7. Run shared chrome component tests at 320/390/wide widths and both native
   bundle commands. Record actual Android/iOS touch/scroll/screen-reader runs
   separately; unavailable devices are **unverified**, not implied by export or
   the browser-generated native runtime. Existing pre-source safety gates stay.

Accessibility labels and roles are listed in the package README. The new toggle
does not rename existing controls or change chapter/flow APIs. Automated geometry,
renderer identity, keyboard and screenshot coverage lives in
`tests/e2e/foliate-reader.spec.ts`; Chromium rendering evidence and Firefox
fail-closed evidence are reported separately. Actual command results and remaining
platform gaps are recorded in the change's `verification.md`.

### LAN HTTPS

Localhost HTTP is a secure browser context, but ordinary LAN HTTP is not. The
existing probe uses `crypto.randomUUID`; a LAN HTTP session correctly fails
closed. Use HTTPS without changing CSP, probe code or browser security flags.
The Demo's Metro config accepts optional TLS files; set both or neither:

```sh
mkdir -p .expo/reader-tls
READER_LAN_IP=192.0.2.10 # Replace with this machine's LAN IPv4 address.
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
