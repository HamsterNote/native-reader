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
capabilities and policy configuration. PDF, HTTP(S), unreadable, corrupt, and encrypted input are
rejected with categorized errors. Firefox and Safari/WebKit rendering are not
supported. Real branded Linux Edge is exercised separately. Safari/device
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
A PDF candidate currently reports `PDF_CAPABILITY_UNAVAILABLE` without further
source access: PDFKit and the Android PDF host are not implemented in this
checkpoint, and there is no fallback to Foliate. Native source replacement
invalidates pending probes. The Web entry still uses its existing gate and does
not yet consume the separate reader PDF.js runtime.

Routing tests and typechecks do not establish native rendering or menu/selection
behavior. HAM-35 waivers do not apply to HAM-46. PDFKit needs an independently
verified Expo development-client module, Android needs its own restricted HTTPS
asset host, and both still need actual platform evidence before PDF is enabled.

## Reader controls and Demo

The shared chrome adapts to the reader container's width, truncates long titles
to one line with the complete accessible name, and keeps the body at least 240
pixels tall. Short hosts must allow outer scrolling to reach the body. Contents
starts collapsed for each source, opens inline above the body, and scrolls
independently within 160 pixels. Navigation keeps it open; unavailable entries
give recoverable feedback without moving. Empty TOCs have no Contents button.
The two flow segments remain controlled by the applied engine flow. Unavailable
switching shows the actual flow; fixed layout takes precedence over either UI.

Existing accessibility labels are preserved: `Previous chapter`, `Next chapter`,
`Chapter position`, `Reading flow`, `Scrolled reading flow`, `Paginated reading
flow`, `Reading flow status`, `Fixed-layout publication`, `Table of contents`,
and `Table of contents feedback`. Chapter/flow controls remain buttons with
their disabled/selected semantics. The new `Toggle table of contents` button
announces `expanded`; collapsed entries are absent from keyboard/accessibility
navigation. TOC item names, non-linear and unavailable suffixes are unchanged.
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
```

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
