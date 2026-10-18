# Spec Delta

## MODIFIED Requirements

### Requirement: Initial host and behavior-proven publication content security policies
Every browser reader host and native WebView reader host SHALL apply an explicit restrictive CSP in its initial document before bootstrap code or untrusted publication content loads. One tested policy builder SHALL produce both the host policy and publication-rendering policy for Web and native hosts. On Web, the outer reader iframe SHALL load the static `reader.html` shell without a required-CSP `csp` attribute, because that outer required-CSP prevents a stricter inner publication `iframe[csp]` from navigating to its blob document. The outer shell SHALL retain its versioned host meta CSP, while runtime manifest/hash/package-public synchronization SHALL continue to establish static-host integrity. The host policy SHALL permit only the external same-origin reader bootstrap/module closure and Foliate-required local `blob:`/`data:` render resources. Host CSP and static-host integrity SHALL NOT be represented as a replacement for publication CSP. The publication policy SHALL set `script-src 'none'` and `connect-src 'none'`, SHALL not include `blob:`, `data:`, or `unsafe-inline` in `script-src`, and SHALL allow only local `blob:`/`data:` image, font, media and stylesheet resources required by Foliate, plus the explicit inline-style-only exception defined by `publication-style-rendering`. The host policy's `'self'` permission, where required for the reader bootstrap/modules, SHALL not grant a publication document permission to fetch arbitrary same-origin HTTP(S) resources. On Web, only each inner untrusted publication iframe SHALL enforce the publication policy through `iframe[csp]` embedded enforcement. Default Web startup SHALL check required runtime and embedded-CSP capabilities and installed policy/sandbox configuration without deliberately triggering CSP violations. Missing required capabilities SHALL produce stable secure-browser-unsupported before publication I/O. Intrusive script/network behavioral canaries SHALL run only when explicitly enabled by the trusted host; in that mode the outer shell SHALL permit opening only when the probe proves inner-frame scripts and same-origin/cross-origin request canaries are blocked. A skipped diagnostic SHALL NOT be represented as behavioral proof, and feature presence alone SHALL NOT be described as such proof. Actual enforcement SHALL remain covered by separate real-browser adversarial acceptance. Neither policy SHALL rely on publication markup, link interception, or manifest script denial as its primary enforcement. Native private-transport, pre-source and initial-publication-policy gates SHALL remain mandatory and SHALL NOT be bypassed by disabling optional bootstrap diagnostics.

#### Scenario: Scripted publication is opened
- **GIVEN** the reader host has applied its initial host CSP and the selected source will be opened only in an inner publication iframe carrying the publication-rendering policy
- **WHEN** a supported publication contains inline script, script references, event-handler attributes, a script-like URL, or a manifest script
- **THEN** the publication script does not execute in the host origin or native WebView context and does not gain a reader command capability

#### Scenario: Browser cannot prove embedded enforcement
- **GIVEN** a Web browser has loaded the outer reader shell without a required-CSP attribute
- **WHEN** required embedded-CSP or runtime capabilities are absent, policy configuration is invalid, or explicitly enabled behavioral diagnostics do not prove blocked script and same-origin/cross-origin canaries
- **THEN** the reader presents a stable secure-browser-unsupported error and does not create a publication blob iframe, open Foliate, or access the publication URI

#### Scenario: Chromium browser proves embedded enforcement
- **GIVEN** a Chromium-family browser session runs the outer Web reader shell without a required-CSP attribute and the trusted host explicitly enables diagnostics
- **WHEN** the default-deny inner `iframe[csp]` behavioral probe executes in a real browser
- **THEN** the script plus same-origin and cross-origin request canaries are all blocked before the reader may create a publication blob iframe, open Foliate, or access the publication URI, while each created publication blob iframe retains the required-CSP policy

## ADDED Requirements

### Requirement: Default consumer diagnostics are quiet across reopening
An independent supported Web consumer using default settings SHALL open, close and reopen a valid local EPUB without page reload with zero reader-generated `console.error`, zero `requestfailed`, and zero `pageerror` events across initialization, rendering and teardown. It SHALL NOT request CSP probe canaries in that default path. Error interception, event suppression and failed-request allowlists SHALL NOT be used to satisfy this contract. Publication content SHALL NOT enable intrusive diagnostics. This change SHALL NOT modify WebBase, relax publication script/network/sandbox/bridge restrictions, publish npm packages, create tags/releases, or open unnecessary PRs.

#### Scenario: Independent consumer loads the same book twice
- **GIVEN** an independent consumer page with no unrelated network activity, listeners attached before navigation, default reader settings, and a valid local EPUB without external resource references
- **WHEN** it opens the book to real rendered ready, closes and awaits reader teardown, reopens the same source without page reload, then closes and awaits teardown again
- **THEN** both opens render successfully, total console errors, failed requests and page errors are each zero including nested frames, and no CSP canary request is attempted, with no filtered diagnostic events

#### Scenario: Publication attempts to enable diagnostics
- **WHEN** publication-controlled markup or traffic requests intrusive diagnostics during a default session
- **THEN** no diagnostic canary runs and the existing authenticated command and source isolation boundaries remain enforced
