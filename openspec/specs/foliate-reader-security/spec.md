# foliate-reader-security Specification

## Purpose

Establishes a fail-closed browser and native-WebView isolation boundary for untrusted local publication content rendered through the Foliate engine.

## Requirements

### Requirement: Initial host and behavior-proven publication content security policies
Every browser reader host and native WebView reader host SHALL apply an explicit restrictive CSP in its initial document before bootstrap code or untrusted publication content loads. One tested policy builder SHALL produce both the host policy and publication-rendering policy for Web and native hosts. On Web, the outer reader iframe SHALL load the static `reader.html` shell without a required-CSP `csp` attribute, because that outer required-CSP prevents a stricter inner publication `iframe[csp]` from navigating to its blob document. The outer shell SHALL retain its versioned host meta CSP, while runtime manifest/hash/package-public synchronization SHALL continue to establish static-host integrity. The host policy SHALL permit only the external same-origin reader bootstrap/module closure and Foliate-required local `blob:`/`data:` render resources. Host CSP and static-host integrity SHALL NOT be represented as a replacement for publication CSP. The publication policy SHALL set `script-src 'none'` and `connect-src 'none'`, SHALL not include `blob:`, `data:`, or `unsafe-inline` in `script-src`, and SHALL allow only local `blob:`/`data:` image, style, font, and media rendering resources required by Foliate. The host policy's `'self'` permission, where required for the reader bootstrap/modules, SHALL not grant a publication document permission to fetch arbitrary same-origin HTTP(S) resources. On Web, only each inner untrusted publication iframe SHALL enforce the unrelaxed publication policy through `iframe[csp]` embedded enforcement. The outer shell SHALL run a default-deny behavioral probe before publication I/O and permit opening only when it proves inner-frame scripts and same-origin/cross-origin request canaries are blocked. Feature presence alone is insufficient. Neither policy SHALL rely on publication markup, link interception, or manifest script denial as its primary enforcement.

#### Scenario: Scripted publication is opened
- **GIVEN** the reader host has applied its initial host CSP and the selected source will be opened only in an inner publication iframe carrying the strict publication-rendering policy
- **WHEN** a supported publication contains inline script, script references, event-handler attributes, a script-like URL, or a manifest script
- **THEN** the publication script does not execute in the host origin or native WebView context and does not gain a reader command capability

#### Scenario: Browser cannot prove embedded enforcement
- **GIVEN** a Web browser has loaded the outer reader shell without a required-CSP attribute
- **WHEN** the default-deny `iframe[csp]` behavioral probe is unavailable or does not prove that script execution and both same-origin and cross-origin request canaries are blocked
- **THEN** the reader presents a stable secure-browser-unsupported error and does not create a publication blob iframe, open Foliate, or access the publication URI

#### Scenario: Chromium browser proves embedded enforcement
- **GIVEN** a Chromium-family browser session runs the outer Web reader shell without a required-CSP attribute
- **WHEN** the default-deny inner `iframe[csp]` behavioral probe executes in a real browser
- **THEN** the script plus same-origin and cross-origin request canaries are all blocked before the reader may create a publication blob iframe, open Foliate, or access the publication URI, while each created publication blob iframe retains the strict required-CSP policy

### Requirement: Layered Web acceptance evidence
The change SHALL record automated Web baseline evidence separately from release/platform acceptance evidence. A completed CFT Chromium baseline SHALL not be represented as proof of real branded Edge, real macOS Safari, real iOS Safari, development-server behavior, `runtime-asset-missing` browser handling, or the complete package raw gate. Playwright WebKit SHALL NOT be represented as Safari evidence. An open release/platform gate SHALL remain visible as not accepted, while not preventing independent Stage 4 native work from starting.

#### Scenario: Automated Web baseline is recorded
- **GIVEN** the exported Demo and packed consumer have synchronized the manifest-declared runtime and CFT Chromium is available
- **WHEN** the automated baseline renders EPUB, FB2, FBZ, fixed-layout CBZ, MOBI6, and the verified single-section KF8 fixture, and exercises the differential probe, authenticated bridge, replacement, linear navigation, TOC, and flow behavior
- **THEN** it records CFT Chromium rendering and blocked-canary evidence, Firefox fail-closed evidence, runtime sync/check, static export, and packed-consumer sync/export as the automated Web baseline only, without closing real-platform or release acceptance

#### Scenario: Release/platform gate remains open
- **GIVEN** the automated Web baseline is complete but the real platform/release evidence has not all been collected
- **WHEN** Stage 4 native work is started
- **THEN** the open gate continues to require real branded Edge, real macOS Safari, real iOS Safari, `runtime-asset-missing` browser E2E, `expo start --web` smoke, and controlled temporary-environment complete package raw-gate evidence or a formal infrastructure exception; it is not represented as acceptance success

#### Scenario: Host runtime asset is absent or invalid
- **GIVEN** the Web reader requires a manifest-declared same-origin host asset before opening a source
- **WHEN** `reader.html`, `bootstrap.js`, an ESM dependency, or its manifest check is missing, unreadable, stale, or invalid
- **THEN** the reader fails closed before publication opening and exposes an actionable runtime-asset error without falling back to application-document rendering

### Requirement: Publication navigation and network isolation
The reader SHALL prevent publication-initiated top-level navigation, popup creation, external-link opening, form submission, and same-origin or cross-origin HTTP(S) subresource and connection requests. Local resources required by the selected publication SHALL remain renderable only through the isolated reader renderer. On Web, this guarantee SHALL be enforced by the strict required-CSP of the inner publication iframe, not by the outer shell's host CSP. Runtime link interception and native request decisions SHALL provide defense in depth, but SHALL not replace the initial CSP and publication policy.

#### Scenario: Publication attempts remote access
- **GIVEN** a selected publication is rendering inside the isolated reader host
- **WHEN** its markup or script-like content references a same-origin or cross-origin HTTP(S) image, stylesheet, frame, navigation target, form target, popup, or network API
- **THEN** no HTTP(S) request or external navigation is performed by the reader host and local `blob:`/`data:` publication rendering remains available

### Requirement: Native pre-source gate and actual publication CSP
Secure Foliate hosting on iOS SHALL support iOS 14 and later only. Before any publication source URI/read/copy/prepare/transfer I/O, iOS SHALL run a strict behavioral synthetic initial-CSP capability preflight against the restricted-file host and return stable unsupported with terminal relay teardown when that preflight fails. This preflight SHALL be verified through actual `WKWebView` behavior and SHALL NOT be inferred from configuration, feature presence, rule-list installation, or host CSP. Only after that preflight succeeds may 4C read or transfer the selected source. After 4C has prepared/transferred the source, but before Foliate generates any untrusted publication document blob, iOS SHALL inject the strict publication CSP as that document's initial policy for EPUB HTML/XHTML/SVG, MOBI/KF8, FB2/FBZ, and CBZ paths. Actual behavior probes SHALL prove script execution and same-origin/cross-origin request canaries are blocked under this actual publication policy before renderer open. `WKContentRuleList`, network blocking, load-after-meta insertion, and scrubbing SHALL be defense in depth only and SHALL NOT substitute for either preflight or initial policy. Android SHALL prove its equivalent embedded-CSP behavior probe and final private bridge before renderer open; a failed pre-source Android gate likewise reports stable unsupported without source I/O. `addJavascriptInterface`, wildcard origins, and broad asset paths SHALL NOT be used as fallbacks.

#### Scenario: iOS preflight fails before source access
- **GIVEN** an iOS 14+ secure Foliate host receives a selected local source
- **WHEN** its synthetic initial-CSP capability preflight cannot prove the restricted-file host behavior
- **THEN** it reports stable unsupported without normalizing or accessing the publication URI, reading, copying, preparing, transferring, creating, or updating a reader session

#### Scenario: iOS publication policy is proved after transfer
- **GIVEN** an iOS 14+ host has completed the synthetic preflight and 4C source preparation/transfer
- **WHEN** Foliate would create an untrusted publication document blob
- **THEN** the strict initial CSP is already injected and script plus same-origin/cross-origin request canaries are blocked before the renderer opens

#### Scenario: Native platform proof is unavailable
- **GIVEN** an iOS synthetic initial-CSP preflight or Android final bridge/pre-source gate cannot prove the required behavior
- **WHEN** the host receives a local source
- **THEN** it reports stable unsupported and does not copy, read, transfer, create, or update a reader session for that source

### Requirement: Native asset host and private authenticated bridge
Android SHALL expose generated runtime assets only through a manifest-exact `WebViewAssetLoader` at `https://appassets.androidplatform.net`. It SHALL reject path traversal, URL encoding/separator ambiguity, Unicode-confused paths, unknown assets, and undeclared MIME types; it SHALL serve declared assets with explicit MIME, host CSP, and `X-Content-Type-Options: nosniff`, and deny all other paths with 404. iOS SHALL read only reader-owned runtime/cache roots. Asset-host CSP SHALL NOT be represented as publication CSP. The existing `HNSecureWebViewModule` ABI SHALL remain unchanged, including `data: string` and its existing `postMessage`/`onMessage` surface.

Android may use its current exact-origin listener only for 4A capability proof; it SHALL then clean-reload and use a native-owned private main-frame `WebMessagePort` transport. In secure Foliate mode, the preserved ABI `postMessage(data: string)` SHALL route only to the active private port and `onMessage` SHALL route only from that port after validation. Generic mode may retain old page-message routing, but secure Foliate hosting SHALL NOT use it. The final Android host SHALL expose neither `ReactNativeWebView` nor a parent-accessible equivalent, public global, or fallback channel. iOS SHALL use a named isolated `WKContentWorld` main-frame-only private relay for a normalized canonical restricted `file:` host-frame URL; it SHALL inject its private port into the generated native host bootstrap and lexically call `installFoliateNativeHostBridge(port)`. This bootstrap SHALL be the same host-protocol endpoint used by Android, not an iOS-specific endpoint. The preserved iOS ABI `postMessage`/`onMessage` SHALL route only through the active relay port after validation. It SHALL validate `frameInfo.isMainFrame`, the restricted security identity, current `WKWebView` URL, and expected handler/world on every receive/send path. No raw page-world `ReactNativeWebView` handler, page-world fallback, independent iOS endpoint, or `<14` fallback is permitted. Actual `WKWebView` behavior SHALL prove the selected restricted-file security-origin tuple and relay behavior.

In secure-host mode, native code SHALL directly deny page-initiated navigation, popup or target-blank creation, downloads, file-chooser requests, geolocation, media permission, and every unauthorized URL scheme. It SHALL NOT use a React Native callback, secondary WebView, or `Linking` as the decision mechanism. This requirement is distinct from 4D proof that the publication CSP blocks subresource networking.

#### Scenario: Native asset or bridge request is confused
- **GIVEN** a native reader host has an active or opening generation
- **WHEN** an Android asset request is non-manifest, path/Unicode/URL-confused, or MIME-ambiguous, or a private bridge message has a wrong frame, restricted identity/origin, current main URL, handler/world/channel, schema, session, generation, or command ID
- **THEN** the request is denied without fallback and cannot load an asset, invoke a bridge capability, navigate, or update reader state

#### Scenario: Firefox or Safari receives a selected publication
- **GIVEN** Firefox or Safari/WebKit on macOS or iOS has a selected publication source
- **WHEN** the browser fails the embedded-enforcement behavioral probe
- **THEN** it exposes the secure-browser-unsupported error and produces zero publication I/O: no publication-canary request, publication blob iframe, Foliate open, publication-URI access, or rendered publication

### Requirement: Authenticated iframe and native bridge messages
The browser iframe host and native reader host SHALL use a closed, versioned message schema containing message type, protocol version, reader session token, generation token, and command ID. Browser parent-to-iframe messages SHALL use `targetOrigin = location.origin`. The iframe SHALL accept only messages whose `event.origin` equals `location.origin` and whose `event.source` is its parent; the parent SHALL accept only messages whose `event.origin` equals `location.origin` and whose `event.source` is the active iframe window. Native host protocol JSON SHALL be named `hn-foliate-host`, version `1`. The React Native adapter SHALL be the sole authority that generates each exactly 43-character base64url-random session, generation, and command ID and initiates `bind`; iOS and Android native code SHALL only validate, route, and maintain private port/relay lifecycle and SHALL neither generate nor implicitly bind replacement tokens. A strict parser and shared wire corpus SHALL close every message type, direction, field, token length, command ID, duplicate, and inflight rule with finite per-field and total-message limits. The `hn-foliate-transfer` namespace is unknown and rejected during the 4B bridge skeleton. On iOS and Android, publication content SHALL not gain arbitrary React Native bridge access; the reader SHALL use only the existing secure-WebView module ABI for the equivalent authenticated, schema-validated lifecycle and navigation messages.

Wrong context, token, or generation messages and stale acknowledgements SHALL be silently ignored without a visible state, navigation, source-ownership, timer, or host-callback effect. A valid matching `bind` acknowledgement means only bridge-bound; duplicate matching acknowledgements and acknowledgements with no current inflight bind are no-ops. An authenticated message from the current private host that violates its closed schema SHALL produce a fixed terminal protocol-violation outcome and tear down that active port or relay. Acknowledgement SHALL NOT be named or treated as `ready`, SHALL NOT authorize source I/O, and SHALL NOT begin transfer; publication `ready` belongs only to the later renderer-opening phase. Both platform validators SHALL fail closed on invalid input and validator exceptions and SHALL be tested against the same strict parser/wire corpus.

#### Scenario: Invalid browser message is received
- **GIVEN** a browser reader iframe has an active session and generation
- **WHEN** the parent or iframe receives a malformed, unknown, wrong-origin, wrong-window-source, wrong-version, wrong-session, or stale-generation `postMessage`
- **THEN** it is ignored or converted to a stable reader error as appropriate and it cannot navigate, update the active publication state, replace a source, alter timeout state, or invoke a host callback

#### Scenario: Unrecognized native message is received
- **GIVEN** a native reader host has an active session and generation
- **WHEN** it receives a message that is malformed, has an unknown type, or belongs to a replaced reader generation
- **THEN** wrong context/token/generation traffic is silently ignored without timer or state effects, while an authenticated current-host schema violation produces the fixed terminal protocol-violation outcome and tears down the private channel; neither may navigate or update the active publication state

### Requirement: Secure source schema, lifecycle, and source ownership
The browser opening protocol SHALL accept only a detector-normalized private `File` or `Blob` payload with a finite canonical `format` value and canonical filename/MIME tuple; it SHALL reject a URI string and every other type or malformed source representation. It SHALL retain host URI/blob ownership and SHALL revoke or dispose only reader-created blob URLs, iframe/Web Component resources, listeners, and native WebView sessions when their source is replaced or the component unmounts. Each Web session SHALL own exactly one iframe and advance only through `opening`, `live`, `disposing`, and terminal `disposed`; a source replacement or new source SHALL destroy the old iframe/session before creating a fresh one, and a terminal session SHALL reject a late or renewed `open`. Browser teardown SHALL invalidate the generation, cancel or rearm relevant timeouts, attempt host close in `try/catch`, destroy the Foliate book, and remove the complete iframe. Late asynchronous callbacks or resource events SHALL be ignored by session/generation guards and their cleanup SHALL run exactly once.

#### Scenario: Source is replaced during loading
- **GIVEN** source A is opening in an active reader session
- **WHEN** source B replaces source A before A completes or after A schedules an asynchronous resource callback
- **THEN** A's renderer resources are disposed, its late callbacks cannot affect UI or host callbacks, only B may update the active session, and neither A nor B's host-owned source is deleted, revoked, or otherwise taken over by the reader

#### Scenario: Invalid opening payload is received
- **GIVEN** a live browser reader host has an authenticated iframe session
- **WHEN** it receives an `open` payload that is a URI, string, unsupported type, malformed object, non-finite format, or mismatched canonical filename/MIME tuple
- **THEN** it rejects the payload without accessing a publication URI or opening Foliate and leaves the active reader session unchanged

### Requirement: Bounded native source transfer
Native sources SHALL be limited to 32 MiB and SHALL use an authenticated `begin`/chunk/`commit`/`abort` transfer only after the iOS synthetic preflight or Android final pre-source gate succeeds. Each transfer SHALL bind a session token, generation, command ID, and transfer ID. `begin` SHALL contain finite byte length, SHA-256, finite chunk and total limits, and the detector's canonical format/name/MIME; chunks SHALL have strictly contiguous finite sequence numbers; `commit` SHALL verify the exact byte count and SHA-256. A stale, duplicate, skipped, out-of-order, oversized, malformed, checksum-invalid, or aborted transfer SHALL NOT create or update a reader session. Reader-owned cache data may be created only after the gate and only as required by the secure-WebView path; host-owned sources remain untouched.

#### Scenario: Native transfer is invalid or too large
- **GIVEN** a native host is offered a source or transfer for a current generation
- **WHEN** the source exceeds 32 MiB or the transfer is stale, out of sequence, beyond a finite limit, checksum-invalid, or aborted
- **THEN** the reader reports the stable unsupported/read outcome as applicable and does not create or update a session, render a publication, or retain partial transfer data
