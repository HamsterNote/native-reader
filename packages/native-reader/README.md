# @hamster-note/native-reader

Controlled local publication reader for Expo. Import the component and types
only from `@hamster-note/native-reader`; internal adapters are not public API.

```tsx
import { NativeReader, type ReaderSource } from '@hamster-note/native-reader';

export function ReadingSurface({ source }: { source?: ReaderSource }) {
  return <NativeReader source={source} style={{ flex: 1 }} />;
}
```

The host owns document selection, permissions, and the
`{ kind: 'uri', uri, name?, mimeType? }` source. Web sources use host-owned blob
URLs, never DOM `File` props. Names/MIME are hints; content determines the format.
The host retains and releases its own blob/cache resources. Reader cleanup
disposes only reader-owned resources and ignores retired-session callbacks.

The current Web implementation opens DRM-free EPUB, MOBI, KF8/AZW3, FB2/FBZ,
and fixed-layout CBZ on Chromium implementations with required embedded-CSP
capabilities and policy configuration. PDF uses a separate offline PDF.js iframe on Chromium, Firefox
and Linux Playwright WebKit. HTTP(S), unreadable, corrupt, and encrypted input
are rejected with categorized errors. Foliate rendering remains unsupported on
Firefox and Safari/WebKit. Real branded Linux Edge is exercised separately. Safari/device
evidence is owner-waived for HAM-35 (修勾, 2026-10-16), never recorded as passed.

Reflowable Web books default to `paginated`, with an accessible `scrolled`
recovery option. `Previous page` / `Next page` turn a page or fixed-layout spread;
in Scrolled mode they directly step readable linear chapters, with first/last
chapters disabled. Engine-confirmed boundaries prevent wrapping. Scrolled keys
and wheel retain native scrolling; Paginated ignores wheel input without content
displacement and retains keyboard pagination. TOC navigation locates a chapter independently.
Fixed-layout books do not expose a reflow selector. The native target is iOS 14+
and Android with default `scrolled`, a 32 MiB bound, private transport, and
behavior-proven publication CSP. The adapter now probes before reading, detects
bounded bytes, transfers 48 KiB chunks with exact size/SHA-256 verification, and
waits for the renderer before reporting ready. Expo Crypto supplies native
entropy and hashing. Unknown-size sources are rejected; no host URI is sent to
the WebView. The shared native runtime is browser-tested. Actual WK/Android
transport behavior remains unverified and owner-waived; iOS rendering stays
unsupported wherever its initial publication boundary cannot be established.
Android pagination/text selection have upstream WebView limitations; there is
no promise of a CSS fix. Bundle/export success does not prove device behavior.

## Native PDF draft (HAM-46)

The native public entry now separates PDF candidate detection from Foliate's
security gate. It validates a local file/content URI, known positive integer
size and the 32 MiB bound before reading at most five bytes at offset zero for
`%PDF-`. Missing/invalid/oversized metadata fails before the read. Filename and
MIME hints do not override this candidate result. Remote inputs make no requests.

This probe returns only a boolean and grants no later full read, copy, transfer
or session permission. A non-PDF still requires the complete existing Foliate
CSP/private bridge/source authorization. Those implementations are unchanged.
A PDF candidate reports `PDF_CAPABILITY_UNAVAILABLE` without further source
access unless the selected platform's independent native host is registered.
The optional iOS PDFKit host is implemented in `@hamster-note/pdfkit@0.1.0`;
Android provides `HNPdfView` in a rebuilt application/development client.
There is no fallback to Foliate. Native source replacement
invalidates pending probes. Web uses a separate same-origin Blob five-byte Range
probe with validated 206/size headers before choosing PDF or the Foliate gate.

Web PDF supplies physical Pages, bounded lazy thumbnails, zoom, rotation and a
temporary React Popover with only a no-op “高亮” button. `onPdfPageChange` reports
1-based PDF pages independently of EPUB location. Source replacement cancels
requests, retires the iframe/worker and clears temporary selections; host URLs
and files remain host-owned. No PDF annotation, persistence, OCR or password UI
is added. Native PDF rendering, menus and selection handles remain unverified.

Routing tests and typechecks do not establish native rendering or menu/selection
behavior. HAM-35 waivers do not apply to HAM-46. The iOS module is an opt-in
implementation awaiting Xcode build and device acceptance. Neither native
platform has passed HAM-46 acceptance.

For an iOS development client, install the matching PDFKit package and rebuild
the app (`npx expo run:ios`). Expo Go cannot load it. Expo 57's PDFKit pod targets
iOS 16.4+. In this workspace run `pnpm --filter @hamster-note/pdfkit build`, then
`pnpm --filter @hamster-note/native-reader-demo build:ios`. The native host
independently checks local file grants and the 32 MiB bound before snapshot
reads; `ready` waits for PDFView drawing. It only changes its in-memory copy,
blocks PDF actions, and does not persist PDF selections or annotations.
`pnpm test:pdfkit-package` verifies the actual tarball in an offline external
consumer and its Expo autolinking metadata; it does not compile Swift or prove
long-press/handles/menu behavior. See the PDFKit package README for those limits.
Android's separate HTTPS APK
asset host and private WebMessageChannel require validated boot before bounded
source snapshot I/O. It uses random exact document URLs, closed manifest/MIME
handling and revocation/byte zeroing. Rebuild the native application after
installing the tarball; Expo Go or older binaries remain unsupported. The
checked-in `scripts/android-fault-matrix/README.md` documents isolated compilation
and JVM tests. Native WebView delivery, file/content rendering, menus and
selection handles still need actual platform evidence for acceptance.

## Reader controls and Demo

The shared chrome adapts to the reader container's width, truncates long titles
to one line with the complete accessible name, and keeps the body at least 240
pixels tall. At 680 pixels the toolbar uses one row; narrower readers use two.
Controls have 44x44 targets. Short hosts must allow outer scrolling to reach the
body. On Web the menu opens a reader-contained modal drawer with independently scrolling
contents and settings. Successful TOC navigation closes the drawer; unavailable
entries retain it with feedback. Empty TOCs still offer settings. Settings contain
the applied flow selector, disabled controls without a callback, unavailable-flow
status, or fixed-layout notice. Opening overlays preserves renderer identity and
viewport height. Escape, backdrop and close restore focus; the background and
publication iframe remain isolated until dismissal.
Native uses RN `Modal` (platform window), `onRequestClose`, modal accessibility
semantics and `AccessibilityInfo` title/opener focus. The renderer remains in its
original parent; panel width is bounded by the reader and platform window, while
height follows the platform window. Native does not claim hardware-keyboard focus
containment with RN 0.86.3's default flags. Android/iOS device behavior remains
unverified; component and local container tests are not screen-reader evidence.

Page controls are named `Previous page`, `Next page`, with `Page navigation status`.
Other accessibility labels include
`Chapter position`, `Reading flow`, `Scrolled reading flow`, `Paginated reading
flow`, `Reading flow status`, `Fixed-layout publication`, `Table of contents`,
and `Table of contents feedback`. Page/flow controls remain buttons with
their disabled/selected semantics. The new `Toggle table of contents` button
announces `expanded`; `Reader contents` and `Reader settings` are modal dialogs.
Closed entries are absent from keyboard/accessibility navigation. TOC item names,
non-linear and unavailable suffixes are unchanged.
There are no new public props or exports; `style` and `testID` still reach the root.

From the workspace root, use Node 24 and `pnpm@10.0.0`, then run
`pnpm run foliate:submodule:bootstrap`, `pnpm install --frozen-lockfile`,
`pnpm run foliate:submodule:check`, `pnpm run foliate:runtime:stage`,
`pnpm run foliate:web-runtime:sync`, `pnpm run foliate:web-runtime:check`,
and `pnpm run dev:web`. The committed public-package Demo is normally at
`http://localhost:8081`; `pnpm run dev:web --port 18738` selects a different
free port. Choose `fixtures/epub/reader-chrome-stress.epub` in Chromium.
LAN access needs HTTPS with a trusted local certificate; plain LAN HTTP fails
the existing secure-context safety probe. See the validation guide's optional
`READER_DEV_TLS_CERT` / `READER_DEV_TLS_KEY` Metro configuration. These environment
variables configure only the workspace Demo, not the public reader API.
The full seven-step acceptance checklist and other fixture paths are in
`docs/validation.md` at the workspace root. Native rendering still requires its
existing safety gates; no device success follows from this UI change.

## Web runtime integration

The package includes private generated `foliate-runtime/web/` assets. From an
installed package, sync into the application's project root before Web start
or export (replace the target with your app's absolute project path):

```sh
pnpm --dir node_modules/@hamster-note/native-reader run foliate:web-runtime:sync --target /path/to/app
pnpm --dir node_modules/@hamster-note/native-reader run foliate:web-runtime:check --target /path/to/app
node node_modules/@hamster-note/native-reader/scripts/sync-pdf-web-runtime.mjs --target /path/to/app/public
node node_modules/@hamster-note/native-reader/scripts/sync-pdf-web-runtime.mjs --target /path/to/app/public --check
```

Retain `/pdf-runtime/` unchanged at the app origin, or use a same-origin
trailing-slash `pdfAssetBaseUrl`. The PDF shell verifies its initial CSP and
window/origin/session before transferring private bytes; it never receives an
arbitrary source URI. Ready requires canvas and text rendering. The Web size
bound is 128 MiB. The runtime is built from this package's `src/pdf/` and
`pdf-shell/`, using TypeScript and exactly PDF.js/worker `5.4.530`; packaged
`pdf-runtime/manifest.json` records each asset's MIME type, size and SHA-256.
It needs no other source repository or build dependencies at runtime. Sync
rejects links, special files and stale outputs; give it exclusive control of
its target tree. Restore the prior native-reader package and its matching
assets to roll back; no host data migration is needed.

Import platform-neutral contracts from
`@hamster-note/native-reader/pdf-contracts`. The ESM/CommonJS/types subpath
does not load React, DOM or PDF.js. The independent PDF route never grants
permission to bypass the Foliate gate or EPUB CSP/private bridge. The current
PDF specifications and historical Web-only acceptance live in this repository's
`openspec/`; native device checks in that archive remain unverified.

These package scripts are build tooling, not a public runtime import path.
Serve the resulting `public/reader/` tree unchanged. Missing, stale, extra, or
hash-mismatched assets must fail verification; missing host assets fail closed
with `runtime-asset-missing`. No Metro asset registration or global loader is
needed. The outer host's initial CSP and authenticated messaging protect the
shell; only the inner publication iframe has strict required CSP. Startup capability
checks must pass before a source is read. The Web prop `intrusiveCspDiagnostics`
defaults to false; explicitly enabling it requires the full differential probe
before source I/O and intentionally produces browser CSP/network diagnostics.
Skipped diagnostics are not behavioral proof. Publications receive no script or
HTTP(S) network permission.

## Source and licenses

Contributors initialize the official `vendor/foliate-js` pin using
`pnpm run foliate:submodule:bootstrap` at the workspace root, then
`pnpm install --frozen-lockfile`. The pin is
`78914aef4466eb960965702401634c2cb348e9b1`; revision changes require review.
Packed consumers use generated assets and do not need the source submodule.
See `THIRD_PARTY_NOTICES.md` and generated manifests for Foliate's MIT license,
zip.js's BSD-3-Clause license, and fflate's MIT license.
PDF runtime additionally retains reader's MIT license and PDF.js's Apache-2.0
license under `pdf-runtime/READER_LICENSE` and `pdf-runtime/LICENSE`.
