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

## Native Expo development client (HAM-56)

### First installation and daily startup

Use the root README's bootstrap and frozen install steps, then:

```sh
pnpm run native:prepare
pnpm run native:ios       # choose the connected iPhone
# OR
pnpm run native:android   # choose an authorized Android device
pnpm run dev:native
# Occupied 8081 fails; choose a free port explicitly:
pnpm run dev:native --port 18738
```

`native:prepare` runs the existing guarded Foliate stage/check, local PDF
stage/check and PDFKit JS/type build. A failure prevents Expo startup.
`dev:native` runs the existing Demo in `--dev-client --lan` mode. It passes
exactly one port (default 8081), checks binding first and prevents Expo's
alternate-port prompt. Output is streamed without forcing CI mode, so Metro
retains file watching/Fast Refresh. The client can use a manual server address;
an interactive QR code is not required. Ctrl+C stops this foreground service.
Generated `apps/demo/ios/` and `android/` are ignored; do not delete existing
user projects or use `prebuild --clean` as a setup step.

The install commands prepare first and invoke Expo locally with
`run:ios --device --no-bundler` / `run:android --device --no-bundler`.
Build/install once before connecting Metro; rebuild whenever native dependencies,
Expo config or packaged Foliate/PDF runtime bytes change. JS-only changes use
Metro reload. There is no EAS, release or second packaging workflow.

- iOS: macOS with an SDK-57-compatible Xcode and command-line tools, CocoaPods,
  an available development signing team, a trusted iPhone with Developer Mode
  enabled and iOS 16.4+. Configure signing locally; never commit credentials.
  Linux cannot compile or install the iOS client. A Mac simulator is useful
  for development but cannot satisfy the physical-device checklist.
- Android: SDK-57/RN-0.86-compatible JDK 17 and Android SDK (platform/build-tools
  requested by Expo's generated project), configured `JAVA_HOME` and
  `ANDROID_HOME`, SDK `platform-tools` on PATH. `adb devices` must show an
  authorized `device`; enable USB debugging and accept its trust prompt.
  macOS/Linux/Windows can build. An emulator is not physical-device acceptance.
- Expo Go and old clients without these hosts report stable unsupported
  (`PDF_CAPABILITY_UNAVAILABLE`). They cannot validate this integration.

### Phone connection and local files

Phone and Metro host must share a reachable LAN. Find the host's LAN IPv4 and
allow inbound TCP 8081 (or the explicit override). Disable AP/client isolation
in the network configuration where appropriate; do not disable reader security.
Use the CLI's development URL/QR when available, with the installed development
client. If it asks for a deep link, use the complete CLI link with its encoded
bundle URL. For manual connection enter `http://<host-LAN-IPv4>:8081` in the
client's server field, replacing the port consistently for `--port 18738`.
The development scheme is `native-reader-demo`; application identifiers on
both platforms are `com.hamsternote.nativereaderdemo`.

Phone `localhost` refers to the phone, not the development host. For multiple
NICs or containers, ensure the advertised IP is routable, and if needed use:

```sh
REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.20 pnpm run dev:native --port 18738
```

Replace that example IPv4 with the host's reachable address; it only changes
advertising and creates no tunnel. A remote host needs a reachable network.
Android emulators may use the host bridge address; iOS simulators need a Mac.
Native Metro defaults to HTTP, independently of Web secure-context/LAN HTTPS.
A browser Web URL is not the development-client link or native proof. Do not
weaken CSP, probes, capability checks or private asset-origin gates to connect.

Browser EPUB and Web PDF validation must start with `pnpm run dev:web --port
8183` (or another explicit free port). That entry synchronizes Foliate and PDF
Web assets into `apps/demo/public`; native prepare does not do that sync.
Using an unprepared native Metro port in a browser can report
`runtime-asset-missing`. Browser localhost through an SSH tunnel is distinct
from the physical phone's server address. This does not change the Web runtime
or bypass its existing security requirements.

Use `fixtures/pdf/native-demo.pdf` (eight selectable pages, checksum/provenance
in `fixtures/pdf/README.md`). Reproduce with `pnpm run fixtures:pdf:check`.
AirDrop to iOS Files, copy via USB/system file tools, or use:

```sh
adb push fixtures/pdf/native-demo.pdf /sdcard/Download/native-demo.pdf
adb push fixtures/pdf/rejected.pdf /sdcard/Download/rejected.pdf
```

Save downloaded samples locally before selecting them. Use the Demo system
picker, which makes its native cache copy and passes the authorized local URI
through the public reader. Do not pass development-machine paths to the phone.

### Human physical-device checklist (waived 2026-10-19)

**HAM-56 closeout: waived: 人类决定不做设备验证（2026-10-19）.**
The owner elected to close this change without physical-device acceptance.
Tasks 5.1–5.3 and the default-8081 readiness portion of 2.2 remain unchecked,
not passed. The default port was occupied by another project's Expo; actual
native services and readiness used explicit 18738/18739. Earlier pending
statements below describe the evidence available before this decision.

Unverified: iOS PDFKit host mounting and behavior, suppression of the system
long-press menu, selection handles, Pages/Popover touch interactions; Android
HNPdfView isolated PDF.js behavior and the corresponding interaction/error
checklist; compatible client installation/LAN device acceptance; default-8081
readiness. No successful native compilation/install is claimed on this Linux
host without Xcode/CocoaPods or Android SDK/adb.

Delivery boundary: Web EPUB/Web PDF acceptance was previously completed;
automated integration and server checks passed (typecheck, Demo/reader and PDF
security tests, iOS/Android exports with native graph checks, native-export
tests, actual dev-mode bundle smoke and OpenSpec strict validation). The
service owner independently rechecked synchronous root registration and the
platform dev graphs on 2026-10-19. These are not device behavior evidence.
This is a new HAM-56 waiver, not reuse of HAM-35. The checklist remains below
for a future device session; it was not executed for this closeout.

Record iOS and Android separately. For each session record date, device/model,
OS version, client build/source revision, Metro port/LAN IP and sample SHA-256.
Do not reuse HAM-35 waivers or fill this section from export/mock/browser tests.

1. Run root `pnpm run dev:native` and connect the compatible installed client
   over LAN. Record successful Demo loading and the actual port (task 5.1).
2. Select the local eight-page PDF. Using Xcode's view debugger or Android
   Studio Layout Inspector/React Native inspector, record the native view
   identity: iOS `HamsterPdfKit` / `HamsterPdfKitView`, Android `HNPdfView`
   (isolated PDF.js). A visible PDF alone does not identify the renderer.
3. Record first visible page, ready only after display and page count = 8.
   At narrow width open Pages, jump to a later page, return to reading and
   scroll; verify current-page feedback and rotated page 3.
4. Long-press text and adjust both selection handles. Check Popover at edges
   and during scrolling, reachable controls and suppressed system action menu.
5. Press “高亮” repeatedly: no annotation, storage, undo or highlight mutation.
   Continue adjusting selection; Pages navigation and source replacement must
   clear stale Popovers. Cancel the picker and verify reading is preserved.
6. Open `rejected.pdf`, record a stable categorized error, then select the
   valid sample and verify recovery. Record symptoms and host identity for any
   failure; hand renderer failures back to the upstream host maintainer.

| Human acceptance                                              | Status            | Missing evidence                                              |
| ------------------------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| 5.1 Root command and LAN phone connection                     | Waived 2026-10-19 | No compatible-client device acceptance                        |
| 5.2 iOS PDFKit / Pages / selection / menu                     | Waived 2026-10-19 | No Mac or signed iPhone session                               |
| 5.3 Android isolated PDF / Pages / selection / error recovery | Waived 2026-10-19 | No Android toolchain or physical device session               |
| 2.2 Default 8081 readiness only                               | Waived 2026-10-19 | Another project's Expo occupied 8081; explicit ports verified |

### Integration evidence (2026-10-18)

Baseline: `origin/main` at `646b71d0` after #9 (`4289a50`) and #8 merged.
No upstream merge was performed in HAM-56. The planned host interfaces remain:

- iOS: `HamsterPdfKit` capability `hamster-pdf` v1 / 32 MiB / ready-after-draw,
  `command` and `onPdfEvent`. Expo module config discovers
  `HamsterPdfKitModule`; its pod requires iOS 16.4+.
- Android: `HNPdfView` v1 / 32 MiB / private port / ready-after-draw,
  `configuration`, `command` and `onPdfMessage`. RN autolinking discovers
  `HNSecureWebViewPackage`, whose view managers include `HNPdfViewManager`.
  `android/build.gradle` includes `../pdf-host/android` and synchronizes checked
  `../pdf-runtime` into `generated/hn-pdf-assets/pdf-runtime` before `preBuild`;
  it does not fetch the shell from Metro.

Executed on Linux with Node 24.15.0 and pnpm 10.28.2 (lockfile unchanged):

| Command                                                                                                                                                   | Actual result                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm run foliate:submodule:bootstrap`                                                                                                                    | Pass, reviewed pin on named branch                                                              |
| `pnpm install --frozen-lockfile`                                                                                                                          | Pass, 928 packages, no lockfile edits                                                           |
| `pnpm --filter @hamster-note/native-reader-demo exec expo config --type public --json`                                                                    | Pass, SDK 57, scheme/identifiers, `web.output=single`                                           |
| `pnpm --filter @hamster-note/native-reader-demo exec expo-modules-autolinking resolve --platform apple --json`                                            | Pass, PDFKit pod and module discovered                                                          |
| `pnpm --filter @hamster-note/native-reader-demo exec expo-modules-autolinking react-native-config --platform android --json`                              | Pass, reader RN package discovered                                                              |
| `pnpm run native:prepare`                                                                                                                                 | Pass, Foliate 16/19/23 assets, PDF 207 assets, PDFKit JS/types                                  |
| `pnpm run fixtures:pdf`                                                                                                                                   | Pass, 3317 bytes; subsequent regeneration byte-identical                                        |
| `pnpm run fixtures:pdf:check`                                                                                                                             | Pass, eight pages and page-3 rotation reparsed                                                  |
| `pnpm run test:native-demo`                                                                                                                               | Pass, 5/5 including prepare failure, occupied port and build arguments                          |
| `pnpm run typecheck`                                                                                                                                      | Pass, reader and Demo                                                                           |
| `pnpm --filter @hamster-note/native-reader-demo test --runInBand`                                                                                         | Pass, 2 suites / 20 tests                                                                       |
| `pnpm --filter @hamster-note/native-reader exec jest --config ../../jest.config.cjs --rootDir . --runInBand --testPathPatterns='(pdf\|Pdf\|web-routing)'` | Pass, 14 suites / 71 tests; missing-host unsupported and both platform routes                   |
| `pnpm run bundle:ios`                                                                                                                                     | Pass, 631 modules; native entry, secure host, iOS PDFReader/PDFKit host; no Web PDF.js          |
| `pnpm run bundle:android`                                                                                                                                 | Pass, 629 modules; native entry, secure host, Android PDFReader/host; no Web PDF.js             |
| `pnpm run test:native-export`                                                                                                                             | Pass, 2/2 platform graph rejection tests                                                        |
| `PDF_TEST_PORT=18882 pnpm run e2e:pdf --project=chromium-desktop --project=chromium-mobile`                                                               | Pass, 20/20; Web export/runtime checks, sample text on all eight pages, Pages/Popover/lifecycle |
| `openspec validate enable-expo-native-pdf-demo --strict`                                                                                                  | Pass                                                                                            |

Affected-source ESLint and Prettier checks pass. Exact source-check command:

```sh
pnpm exec eslint scripts/run-native-demo.mjs scripts/run-native-demo.test.mjs scripts/smoke-native-demo.mjs scripts/generate-native-demo-pdf.mjs scripts/verify-native-export.mjs scripts/verify-native-export.test.mjs apps/demo/src/DemoApp.tsx apps/demo/src/DemoApp.test.tsx playwright.pdf.config.ts tests/e2e/pdf-reader.spec.ts
pnpm exec prettier --check package.json apps/demo/app.json apps/demo/src/DemoApp.tsx apps/demo/src/DemoApp.test.tsx scripts/run-native-demo.mjs scripts/run-native-demo.test.mjs scripts/smoke-native-demo.mjs scripts/generate-native-demo-pdf.mjs scripts/verify-native-export.mjs scripts/verify-native-export.test.mjs playwright.pdf.config.ts tests/e2e/pdf-reader.spec.ts README.md docs/validation.md fixtures/pdf/README.md openspec/changes/enable-expo-native-pdf-demo
```

Metro results are deliberately separate from successful automated checks:

- `pnpm run dev:native`: **exit 1**, existing unrelated service owns 8081;
  prepare passed, startup reported the occupied port, no silent alternate port.
  That existing service was left running.
- `pnpm run smoke:native-demo`: **exit 1 overall** because default-8081
  readiness was skipped as occupied; the script continued to start the actual
  root `pnpm run dev:native --port 18738` successfully. `/status` returned
  `packager-status:running` and the LAN-requested Expo manifest advertised
  `192.168.0.145:18738` with a matching native bundle URL. The wrapper printed
  its development-client deep link. Metro watch mode was enabled. The smoke
  stopped its own process group and verified that 18738 was released.
- Task **2.2 remains unchecked** solely for a free-default-8081 readiness run;
  implementation, explicit-port readiness and failure paths are verified.
  Rerun `pnpm run smoke:native-demo` when both ports are free.
- React Native DevTools' optional Linux GUI installation logged a local Chromium
  sandbox-permission error; Metro and its manifest remained ready. This is not
  device-debugger evidence and no sandbox permissions were weakened.
- The first Web regression attempt on default 8182 stopped because an existing
  service owned it. `PDF_TEST_PORT` overrides only the test server port and
  preserves the default 8182 and existing Web product entries.

### Dev bundle regression follow-up (2026-10-19)

The initial smoke above checked readiness and manifest URLs only. Those results
did **not** prove the complete development graph compiled: Metro rejected a
conditional `require(...)` in `NativeReaderImplementation.native.tsx` with
HTTP 500 in `dev=true`, even though production exports succeeded. The loader
now uses two literal requires with explicit `.ios` / `.android` suffixes;
platform selection and the private-host security gate remain unchanged.

`smoke:native-demo` now fetches all four actual dev bundles and requires HTTP
200, a JavaScript content type and `NativeReaderImplementation` in each body:

```text
/apps/demo/index.ts.bundle?platform=ios&dev=true&lazy=false
/apps/demo/src/DemoApp.tsx.bundle?platform=ios&dev=true
/apps/demo/index.ts.bundle?platform=android&dev=true&lazy=false
/apps/demo/src/DemoApp.tsx.bundle?platform=android&dev=true
```

The default smoke still checks 8081 and 18738. To validate on a separate free
port while preserving existing services, use `pnpm run smoke:native-demo --port
18739`. This launches the root native entry on that exact port and cleans up
only its own process group. Logs and JSON bundle evidence are written under
`test-results/`. A selected-port smoke does not complete default-8081 or
physical-device acceptance. No `dev=false` result substitutes for these checks.

Before the loader fix, the strengthened smoke on 18739 failed as expected on
the iOS eager entry with HTTP 500 / `TransformError` / non-literal require;
its temporary service was cleaned up. Post-fix results are recorded below.

Post-fix `pnpm run smoke:native-demo --port 18739`: **exit 0**. All four
responses had JavaScript content types and included `NativeReaderImplementation`:

| Dev bundle request                                                | HTTP | Bytes   |
| ----------------------------------------------------------------- | ---- | ------- |
| `/apps/demo/index.ts.bundle?platform=ios&dev=true&lazy=false`     | 200  | 4560896 |
| `/apps/demo/src/DemoApp.tsx.bundle?platform=ios&dev=true`         | 200  | 4556483 |
| `/apps/demo/index.ts.bundle?platform=android&dev=true&lazy=false` | 200  | 4569599 |
| `/apps/demo/src/DemoApp.tsx.bundle?platform=android&dev=true`     | 200  | 4565186 |

Supplementary checks on this fix:

```sh
pnpm run test:native-demo
pnpm run typecheck
pnpm --filter @hamster-note/native-reader exec jest --config ../../jest.config.cjs --rootDir . --runInBand --runTestsByPath src/NativeReader.appState.test.tsx src/NativeReader.native.gate.test.tsx src/NativeReader.pdf-routing.test.tsx
pnpm exec eslint packages/native-reader/src/NativeReaderImplementation.native.tsx scripts/smoke-native-demo.mjs scripts/smoke-native-demo.test.mjs
pnpm exec prettier --check packages/native-reader/src/NativeReaderImplementation.native.tsx scripts/smoke-native-demo.mjs scripts/smoke-native-demo.test.mjs package.json README.md docs/validation.md
openspec validate enable-expo-native-pdf-demo --strict
```

Results: native-demo checks **9/9** (including rejection of TransformError,
missing implementation and non-JavaScript responses); typecheck passed; reader
regressions **3 suites / 31 tests** passed; affected-file ESLint/Prettier and
OpenSpec strict validation passed. The temporary 18739 service was stopped and
its port released. Existing 18738 native and 8183 Web services were left running;
their restart is owned by the person managing those sessions.

Tasks 2.2 (free default-8081 readiness) and 5.1–5.3 (physical-device acceptance)
remain pending. These HTTP compilation results do not prove device execution,
PDFKit/HNPdfView rendering, gestures or menus.

No EPUB fixture, EPUB recipe or `rejected.pdf` was changed. No highlight
implementation, native renderer changes, EAS or publication work is included.

### Synchronous root registration follow-up (2026-10-19)

The previous `apps/demo/index.ts` registered the root from a dynamic-import
promise. Native `runApplication('main')` could run first and display Expo's
fallback entry component even when all dev bundles compiled. The entry now
statically imports both components and synchronously registers exactly one,
retaining the diagnostic pathname selection.

`apps/demo/index.test.ts` executes the real entry with mocked components and
asserts registration immediately when module execution returns, without
flushing promises or timers. Native without `location`, Web root, diagnostic
pathname and another Web pathname are covered. Before the fix, all four cases
failed with **0** registrations; after the fix, all four pass with **1**.
These assertions are included in `test:native-demo`.

| Command                                                                                                 | Result                                                                             |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm run test:native-demo`                                                                             | Exit 0; 9 Node checks and 4 synchronous registration tests passed                  |
| `pnpm run smoke:native-demo --port 18739`                                                               | Exit 0; actual native prepare, readiness, LAN manifest and four dev bundles passed |
| `pnpm run typecheck`                                                                                    | Exit 0; reader and Demo passed                                                     |
| `pnpm --filter @hamster-note/native-reader-demo run test --runInBand`                                   | Exit 0; 3 suites / 24 tests passed                                                 |
| `pnpm exec eslint apps/demo/index.ts apps/demo/index.test.ts`                                           | Exit 0                                                                             |
| `pnpm exec prettier --check apps/demo/index.ts apps/demo/index.test.ts package.json docs/validation.md` | Exit 0                                                                             |
| `openspec validate enable-expo-native-pdf-demo --strict`                                                | Exit 0; valid                                                                      |

The smoke fetched these `dev=true` responses, all with JavaScript content types
and `NativeReaderImplementation` present:

| Dev bundle request                                                | HTTP | Bytes   |
| ----------------------------------------------------------------- | ---- | ------- |
| `/apps/demo/index.ts.bundle?platform=ios&dev=true&lazy=false`     | 200  | 4560587 |
| `/apps/demo/src/DemoApp.tsx.bundle?platform=ios&dev=true`         | 200  | 4556483 |
| `/apps/demo/index.ts.bundle?platform=android&dev=true&lazy=false` | 200  | 4569290 |
| `/apps/demo/src/DemoApp.tsx.bundle?platform=android&dev=true`     | 200  | 4565186 |

The temporary 18739 process group was stopped and the port verified free;
existing 18738 native and 8183 Web services were preserved. The optional Linux
DevTools GUI still logged its sandbox configuration error; no permissions
were changed, and Metro compilation succeeded. No production export was used
as evidence for this fix. Tasks 2.2 and 5.1–5.3 remain unchecked; synchronous
registration tests do not substitute for human device acceptance. The service
owner can restart with `pnpm run dev:native --port 18738` for that acceptance
(`pnpm run dev:native` defaults to 8081).

Native compilation/install: **not run** on this Linux host, which has no
Xcode/CocoaPods, Java/Android SDK or adb. Autolinking/source-set inspection
does not prove compiler compatibility. Both physical-device sessions remain
pending even when the following automated checks pass.

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
