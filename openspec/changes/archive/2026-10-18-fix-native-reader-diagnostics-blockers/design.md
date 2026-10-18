# Design

## Context

See proposal.md for motivation and exact pins. OpenSpec 1.13.1 uses local `spec-driven`; no repository-local propose override was found. The existing security specification requires automatic differential canaries. `scripts/stage-foliate-runtime.mjs` constructs control/strict frames and calls the probe automatically in Web and native bootstrap branches. Its result also controls source authorization: removing the call alone leaves startup pending.

`publication.style-src` currently permits only blob/data; host styles already allow inline. Checked-in generated Foliate `epub.js` rewrites URLs in both style elements and `[style]`, leaving them inline. Generated `paginator.js` creates style elements and repeatedly changes styles during layout. The submodule is pinned but uninitialized in this planning checkout; these observations come from checked-in generated runtime and staging transforms, not a newly checked-out upstream tree.

## Goals / Non-Goals

**Goals:** independent strict consumer acceptance and real style semantics, with deterministic runtime generation and unchanged script/network isolation.

**Non-Goals:** no WebBase changes, Foliate revision change, format expansion, script/connect CSP relaxation, bridge redesign, release/tag/npm publication, or unnecessary PR. No implementation in propose. Existing native private-transport and initial-policy pre-source gates remain mandatory.

## Decisions

### 1. Intrusive diagnostics require host opt-in

Default startup does not construct the deliberate violation frames or request their canaries. Introduce a host-owned, default-off diagnostic setting passed through the authenticated startup path; publication markup, URLs, and messages cannot enable it. Keep the existing full differential probe for explicit diagnostic sessions and security regression tests. Do not intercept `console.error`, suppress browser events, or whitelist `requestfailed`.

Separate source authorization from diagnostic result: default startup checks required APIs, embedded-CSP support and installed policy/sandbox configuration, and produces a deterministic supported/unsupported outcome; it never labels a skipped probe as behaviorally passed. Explicit diagnostic mode additionally requires successful behavioral proof before source I/O. A missing embedded-CSP capability remains unsupported before source I/O. Native bridge, transfer and initial-policy preflights are separate from optional bootstrap diagnostics and must not be bypassed or marked passed.

This deliberately replaces the Web per-session behavioral-proof mandate, as authorized by the default-off option in HAM-53. Feature detection is compatibility gating, not proof of enforcement; preserve actual initial CSP, per-publication iframe CSP and sandbox, and retain real-browser adversarial tests. Unsupported Firefox/Safari paths must stay unsupported. If the implementation cannot preserve these boundaries, it must report a blocker rather than returning unconditional success. The strict zero-error acceptance here targets the independent Web consumer; it does not claim new native device support or waive native safety gates.

Alternatives: keeping the probe and filtering diagnostics violates acceptance; caching a noisy first probe fails the first-open requirement; changing only `example.invalid` leaves strict-frame violations. No reliable browser API to silently run the existing negative network/script canaries has been established, so this plan does not promise such an API.

### 2. Choose a publication style-only inline allowance after evaluating blob conversion

Preferred in principle: emit Foliate style elements as `link rel=stylesheet` backed by reader-owned blob URLs, preserving `style-src blob: data:`. This fixes style elements but not author `style` attributes. Converting every attribute into selector rules requires preserving inline specificity, `!important`, ordering, SVG styles and relative URLs; Foliate's dynamic layout writes also require a complete update/lifetime adapter. A partial conversion fails the author's inline-style acceptance, while a full rewrite substantially expands this blocker fix and risks pagination regressions.

Chosen bounded fix: add `'unsafe-inline'` only to `publication` **style-src**, retaining `blob:` and `data:`, increment the policy version, and regenerate all declared runtime copies/manifests. Do not add it to `script-src`, `default-src`, or any other directive. Preserve `script-src 'none'`, `connect-src 'none'`, and all other directive values. This supports author attributes and style elements plus Foliate's injected styles without changing their CSS cascade. HAM-53 records owner 修勾's acceptance of this trade-off; this document records the decision, not a new security waiver.

Impact: arbitrary author CSS becomes effective inside publication frames on every platform using the shared publication policy. It can alter layout/appearance and may contain URL references. Existing image/font/media/style resource restrictions and `connect-src 'none'` must still block HTTP(S) loads; negative CSS URL tests are mandatory. No author script/event handler gains execution, no host style permission changes, and no private bridge access is granted.

Other alternatives: nonces/hashes cannot generally authorize arbitrary `style` attributes or changing renderer text; `style-src-attr 'unsafe-inline'` plus blob-only style elements is narrower but still adds an inline exception, requires renderer blob updates and compatibility handling across WebViews, and is not selected for this bounded repair. Removing author styles is incompatible with acceptance. Removing CSP is forbidden. Blob conversion remains a possible separate hardening project, not hidden work in this change.

### 3. Independent executable acceptance

Add `tests/e2e/reader-diagnostics-consumer.spec.ts` and an isolated consumer page served from the existing test server (not WebBase or Demo UI). The page uses the public package API and synchronized runtime. Give it a static document with no unrelated requests/errors. Listener registration precedes navigation and covers nested frames. No route aborts, fake successful responses, console monkey-patches, probe query filters, or failed-request allowlists are permitted.

Add a deterministic EPUB fixture via `scripts/epub-fixture-recipes.mjs` / fixture generator: a paragraph with `style="color: rgb(17, 34, 51)"` and a second paragraph styled by an author style element (`font-style: italic`). Avoid external URLs in this positive fixture. Inspect real publication frames with Playwright, not shadow DOM snapshots or a stub renderer. On each open assert the author paragraph color, author style-element effect, and actual Foliate pagination effects by comparing renderer-owned element styles with computed styles. Exercise a flow update and verify changed layout, without injecting test CSS.

Implementation evidence corrected the original third assertion: pinned `vendor/foliate-js/paginator.js:979` creates empty style elements, while `:1100` only supplies rules when a caller passes CSS; this reader supplies none. Real pagination uses `setStylesImportant()`, including `html` overflow-wrap at `:325`. HAM-53 comment `01a14e79-7ca3-7697-8b9d-98cb33738641` approved option A: assert these actual layout effects and their change on flow update. Option B (adding a production reading stylesheet merely to satisfy the test) was rejected because it adds unrelated behavior. Author attribute/style-element assertions remain mandatory. Record a differential run against an isolated exported-runtime copy with only publication style-src's `'unsafe-inline'` removed: author style assertions must fail there and pass with the unchanged repository policy. Keep commands and both outcomes in verification.md.

Open the fixture, await real publication ready and computed styles, close and await teardown, then reopen the exact same source without page reload and repeat. Capture errors across startup, both opens and teardown; use an event-loop/animation-frame settlement after reader teardown, not a blind sleep. Assert total `console.error === 0`, `requestfailed === 0`, and `pageerror === 0`; also assert no probe canary URLs were attempted. The isolated host makes all events actionable and avoids subjective reader/host exclusions.

Planned direct acceptance command after adding the test: `pnpm run e2e:web -- tests/e2e/reader-diagnostics-consumer.spec.ts --project=chromium --workers=1`. Diagnostic-mode and adversarial CSP tests run separately, since deliberate rejection necessarily emits browser diagnostics. Verify Firefox still rejects before source I/O. Existing tests that auto-enable/filter probes must not be reused as strict acceptance evidence.

## Risks / Trade-offs

- Default startup no longer proves enforcement through fresh behavioral violations: retain actual CSP/sandbox and unsupported rejection, add adversarial browser regressions, and clearly distinguish capability checks from proof.
- Inline CSS broadens style influence: restrict the exception to publication style-src and verify remote CSS resources and scripts remain blocked in separate negative tests.
- Shared generator affects native assets: update both bootstrap branches without bypassing native gates, regenerate with the pinned submodule, and run generation/synchronization/native runtime tests. Browser simulation is not device evidence.
- Stale generated copies can mask fixes: runtime stage/check and public sync/check plus hash/manifest verification are required.

## Migration Plan

Implement locally in native-reader only; keep fixture and test commands reproducible. Obtain owner acceptance before eventual main delivery; report the resulting SHA for downstream repinning without editing WebBase. Rollback is a reviewed revert of source and regenerated assets together, restoring the previous policy version; no data migration. Do not publish packages, tag, release, or open an unnecessary PR.

## Open Questions

No product decision is pending. The exact injected-style selector and diagnostic setting name are implementation details to record with test evidence; they do not change the contracts above. Native device checks unavailable to the implementer must be reported as unverified, not passed.
