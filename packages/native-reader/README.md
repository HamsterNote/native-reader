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
behavior probe. PDF, HTTP(S), unreadable, corrupt, and encrypted input are
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
