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
and fixed-layout CBZ on Chromium implementations that pass the embedded-CSP
behavior probe. PDF uses a separate offline PDF.js iframe on Chromium, Firefox
and Linux Playwright WebKit. HTTP(S), unreadable, corrupt, and encrypted input
are rejected with categorized errors. Foliate rendering remains unsupported on
Firefox and Safari/WebKit. Real branded Linux Edge is exercised separately. Safari/device
evidence is owner-waived for HAM-35 (修勾, 2026-10-16), never recorded as passed.

Reflowable Web books default to `paginated`, with an accessible `scrolled`
recovery option. Previous/Next move by readable linear chapter in either flow;
TOC and linear navigation do not wrap.
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

## Native PDF dispatch checkpoint (HAM-46)

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
Android's PDF host is still pending. There is no fallback to Foliate. Native source replacement
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
implementation awaiting Xcode build and device acceptance. Android needs its
own restricted HTTPS asset host. Neither platform has passed HAM-46 acceptance.

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
bound is 128 MiB. The paired runtime is reader `1.12.0-beta.2` revision
`73f2c2f593c35bcad696478c56f843d624f8a6be`, PDF.js/worker `5.4.530`; packaged
`pdf-runtime/manifest.json` records exact hashes and artifact provenance.
This pinned artifact is not an npm release. Restore the prior package and its
matching assets to roll back; no host data migration is needed.

These package scripts are build tooling, not a public runtime import path.
Serve the resulting `public/reader/` tree unchanged. Missing, stale, extra, or
hash-mismatched assets must fail verification; missing host assets fail closed
with `runtime-asset-missing`. No Metro asset registration or global loader is
needed. The outer host's initial CSP and authenticated messaging protect the
shell; only the inner publication iframe has strict required CSP. Its behavior
probe must pass before a source is read. Publications receive no script or
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
