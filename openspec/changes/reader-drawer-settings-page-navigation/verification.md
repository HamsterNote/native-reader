# Apply Verification

Baseline: `main` / `d1433e9`. Change: `reader-drawer-settings-page-navigation`.
Local uncommitted implementation, 2026-10-18. No commit, push, PR or archive.
Native scope follows coordinator decision `01a14ef5-2c82-7edf-84c9-cc4b23358930`.

## Requirement Evidence

| Requirement / scenarios | Evidence and scope |
| --- | --- |
| Settings flow selection, applied confirmation, missing callback disabled, unavailable and fixed-layout states | `ReaderChrome.test.tsx`, Web adapter and native session tests; Chromium settings E2E |
| Drawer initial closure, empty neutral TOC priority, nested/nonlinear/unresolved items, successful confirmation closes, failure retains feedback, replacement resets | Shared chrome/adapter tests and committed Demo E2E |
| Web Tab/Shift+Tab, Escape/backdrop/close, opener restoration, inert/ARIA and iframe input isolation | Real Chromium focus/geometry tests at 1440x900, 390x844, 320x640, 390x360 and embedded 320; activeElement/ARIA records and screenshots |
| Native platform Modal, close requests, title accessibility focus and opener restoration | Actual Android `ReactModalHostView` + `HNSecureWebView` Robolectric container tests; `ReaderOverlay.native.test.tsx` checks Modal callbacks, Android close, iOS dismissal timing, stale callbacks, background accessibility hiding, sizing and renderer identity. Device behavior unverified; no hardware-keyboard containment claim |
| 679/680 container breakpoint, 44x44 targets, title truncation, 240 body height, independent TOC scrolling, narrow settings and stable renderer identity | Chromium geometry records and toolbar/drawer/settings screenshots; native component sizing test only |
| Single-section multi-page, first/last boundaries, RTL, Scrolled chapter steps and native scrolling, Paginated zero wheel displacement | Deterministic `single-section-rtl.epub`; public-control Chromium tests, native-host long-chapter tests and runtime boundary tests |
| Cross-section page navigation, nonlinear skip, no wrap, fixed page/spread navigation | Long EPUB/no-TOC spine tests; fixed CBZ native-runtime browser page/no-op test |
| Flow/resize/TOC boundary refresh, unknown versus pending | Runtime, adapter/chrome tests and browser checks |
| Matching requestId/state/ack; stale revision/generation/origin/window; no-location boundary no-op | Runtime, Web adapter, native protocol/session tests and native-host browser E2E |
| Serialized page/flow/TOC/key input, one queued competitor, terminal overflow | Runtime queue tests, deferred-flow session tests and public-control E2E |
| Engine exception, 3000ms runtime and independent 5000ms adapter deadlines, late completion cleanup | Runtime and Web/native session tests; native-host browser exception/deadline E2E |
| Native host v1 / internal iframe v2 closed schema, strict validators, source/security gates | TS/JVM shared wire corpus, Android fault matrix, private-port browser runtime tests; Apple source/integrity checks, no Objective-C execution on Linux |
| Matched generated runtimes, Demo/consumer assets, secure release closure | Runtime stage/check, sync/check, manifest integrity, isolated package/consumer gates |

The fixture manifest records deterministic recipe provenance, size and SHA-256
for all 38 samples. No private book or temporary application shell is required.

## Previous Delivery Gates

Final gates are refreshed after the native Modal change. Results below are
updated only after the owning foreground command completes.

| Gate | Current result |
| --- | --- |
| Reader unit tests after Modal migration | PASS: 362 tests across 25 suites |
| Workspace typecheck and changed-file lint | PASS |
| OpenSpec strict validation | PASS after platform scope update |
| `pnpm run verify` | PASS (exit 0); `verify-delivery.log`: 362 reader +18 Demo tests, 38 fixtures, security/source guards, Android fault matrix including both Modal probes, package/consumer checks, two actual Android new-architecture builds, Web export, runtime/sync generator tests and Foliate 3A |
| Full `pnpm run e2e:web` | PASS (exit 0): 68 passed, 54 platform skips, 2.5 minutes; Chromium rendering/focus/geometry/page/protocol and Firefox fail-closed checks, port 19451; `e2e-delivery.log` |
| iOS / Android bundle and export graph | PASS (exit 0 each); native entry/secure host present, Web fallback excluded; `bundle-ios-delivery.log`, `bundle-android-delivery.log`; build evidence only |
| Final runtime and Demo sync checks | PASS: 16 package /19 Web /23 native host assets and Demo manifest-declared bytes |
| Persistent LAN Web dev server and screenshots | PASS: Expo dev/watch server in tmux; real HTTPS smoke at 1440/390/320, all focus/isolation/geometry checks pass, zero page errors; `live-acceptance.json` and nine toolbar/drawer/settings screenshots |

Earlier complete verification remains in `ham45-evidence/logs/verify-resumed.log`
(358 reader +18 Demo unit tests; package/consumer, Android new-architecture
consumer builds, security/source checks), with 68 E2E passes and 54 platform skips.
These predate the Modal change and are not substitutes for the current final run.

The first refreshed aggregate (`verify-modal.log`) passed Android container and
package/consumer build checks, then exposed a missing Modal export in the old
AppState test mock (20 mount failures). The native mocks were extended without
removing business assertions; all 361 reader tests now pass. The full aggregate
is rerun rather than counted as passed from this partial attempt.
`verify-modal-final.log` was deliberately interrupted (exit 130) to fix the
initial onShow/layout race: native title focus now waits for measurable content.
A regression test exercises onShow before layout; all 362 unit tests pass.

## Native Compatibility and Limits

The actual pinned RN 0.86.3 defaults `enableImperativeFocus` and `enableKeyEvents`
to false. The previous View.focus / JS key-capture implementation was therefore
replaced under the coordinator's explicit decision. Web keeps its tested DOM
overlay. Native uses platform Modal, `onRequestClose`, accessibility modal and
background-hiding props, title accessibility focus on show, settings-opener focus
on return, and toolbar-opener restoration after dismissal. The renderer stays in
its original parent. No native focus component or private flag override was added.

Before production wiring, Android container probes exercised the real
ReactModalHostView and HNSecureWebView using Robolectric Android 35. Only bridge
modules/queues and JNI feature-flag access are mocked, with all flags false.
They check a secure host nested in a showing Dialog, platform Back callback and
detach, plus a background secure host's parent/attachment/session marker across
Modal open/close. Tests passed after completing the mock bridge queue required
by RN's real layout callback. The first attempts failed on unsettled attachment
and then uninitialized bridge queue; those diagnostic logs are retained.
The passing Gradle run's enclosing source invariant rejected an intervening
package README edit; that enclosing command is **not** counted as a gate pass.
The final aggregate reran it successfully against frozen source, including the
whole-authority digest assertion. The feedback revision tarball is deterministic
across both consumer passes: SHA-256 `58dd5c4542927960ca761dbf35d1af588fedf2aba7703201de6e90daf3124efa`.

`adb devices` reports no devices, there are no AVDs, and emulator acceleration
reports unavailable CPU virtualization. Android/iOS Modal display, platform
screen-reader isolation and speech, actual WebView rendering/session survival,
and device focus timing remain **device unverified**. Component callbacks and
Robolectric are not device evidence. Native hardware-keyboard containment is
outside the authorized scope. iOS native compilation/Objective-C validator,
installed WKWebView, real Safari and Edge were not executed on this Linux host.
Historical HAM-35 waivers are not extended to this change's native Modal behavior.

The optional requirement rename was not applied: the modified requirement still
uses `Collapsible bounded table of contents`, with its new drawer semantics.
Main specifications and archive history remain untouched.

## Previous Human Acceptance Handoff

- URL: `https://192.168.0.145:19452` (local self-signed certificate; accept it in Chromium).
- tmux session: `ham45-reader-19452`, ID `$24`; pane PID `1947088`, listening Metro PID `1947252`.
- Durable log: `test-results/ham45-live/dev-server.log`; stop with `tmux kill-session -t ham45-reader-19452`.
- The inherited `CI=true` was removed for the final dev/watch server. The service is detached in tmux; survival without a system service manager is best-effort and does not cover host restarts.
- The real committed Demo opens `reader-chrome-stress.epub`. All three HTTPS contexts are secure, dialog bounds fit, horizontal overflow is absent, and drawer/settings/toolbar focus restoration and inert/ARIA/iframe isolation pass.
- Measured reader widths: 776 /352 /282 for 1440 /390 /320 browser viewports; underlying iframe heights: 520 /243 /243, unchanged across overlays.
- An optional React Native DevTools desktop helper could not launch because this host's SUID sandbox helper is not configured. Web dev server, reading, CSP probe and browser smoke pass. No sandbox permission or safety gate was relaxed.

The evidence archive contains current gate logs, failed/interrupted diagnostic
attempts, browser geometry/ARIA records, live server logs and screenshots. The
implementation remains uncommitted on the original baseline and awaits human
acceptance. No PR, push, commit or archive was performed.

## Acceptance Feedback Revision

Latest authority: coordinator comment `01a14f7c-e52a-7620-97b7-e5cc0de5c18d`.
Scrolled toolbar buttons now directly step adjacent readable chapters; native
scrolling keys/wheel remain untouched. Paginated wheel never enters the page
queue; keyboard input and the existing one-queued-competitor/terminal-overflow
assertions remain covered. The iframe/host schemas remain v2/v1, with both
generated runtime manifests and Demo copies refreshed together.

Real Chromium measurements use the committed Demo, stress fixture, fresh book
at its start, and DOM Range text rectangles through the publication frame chain.
Coordinates are CSS pixels; first reading text means the first text in reading
order, the `Stress 01` heading (not the topmost line of the second column).
Before/after measurements use the same browser
viewport per width (1440x900, 390x844, 320x844).

| Browser width | Chrome before → after | Body before → after | Toolbar to first text before → after | Toolbar to body before → after |
| --- | --- | --- | --- | --- |
| 1440 | 109 → 69 | 520 → 560 | 109.4375 → 21.4375 | 40 → 0 |
| 390 | 161 → 121 | 243 → 283 | 109.4375 → 21.4375 | 40 → 0 |
| 320 | 161 → 121 | 243 → 283 | 109.4375 → 21.4375 | 40 → 0 |

The removed space is a permanent 40px empty status row plus Foliate's 48px
default margin. The remaining 21.4375px belongs to publication-authored heading
layout and is preserved. Status occupies the toolbar's existing bottom padding,
so pending/unknown feedback and overlay changes do not resize the body. Engine
margin is set through its supported public attribute, with no vendor edit or
CSP/security change. Browser regression checks assert the toolbar/body join,
680 breakpoint, target sizes, no horizontal overflow and stable overlay geometry.

Preliminary checks: runtime 6/6; focused Chromium input/ack checks 2/2.
The initial focused batch found two test setup assumptions: its second body
click moved text selection before the wheel, and it assumed the next page could
not be the final page in a large native test viewport. Both assertions now
measure the intended operation; native next availability is still checked at
the book start and Scrolled remains disabled for a single chapter. An initial
lint command overlapped E2E runtime staging and encountered a removed temporary
file; final gates run sequentially against stable source.

The first full feedback `verify` stopped on the old native manifest hash in
`SECURE_WEBVIEW_SHA256.json`. The supported integrity-manifest generator refreshed
the paired reference, and its strict verification passes. This failed aggregate
is retained as `logs/verify-initial.log`; it is not counted as a passing gate.

## Feedback Revision Gate Results

| Gate | Result |
| --- | --- |
| `pnpm run verify` | PASS, exit 0: 362 reader +18 Demo tests, all 38 fixture checks, typecheck/lint/format, Web build, release safety/source/security checks, Android fault matrix including Modal probes, npm/pnpm ESM/CJS consumers, two real Android new-architecture consumer builds and Foliate 3A |
| `pnpm run e2e:web` | PASS, exit 0: 69 passed, 55 expected platform skips, 1.8m, port 19451; includes all responsive/focus/isolation checks, page/flow protocols and new native-host Scrolled chapter stepping |
| `pnpm run bundle:ios` / `bundle:android` | PASS, exit 0 each; native entry and secure host, no Web fallback; build evidence only |
| Runtime and Demo checks | PASS, 16 package /19 Web /23 native host assets; matching manifests and synchronized Demo bytes; secure integrity reference verification exit 0 |
| Generator tests | PASS: runtime 6/6, Web sync 8/8, also rerun inside full aggregate |
| OpenSpec `--strict` | PASS after feedback delta/design/tasks revision; 24/24 tasks complete |
| Restarted HTTPS dev service | PASS at the same LAN address and same tmux session ID; three live browser contexts, zero page errors, stable overlay heights and working focus/isolation |

Logs are `logs/verify.log`, `e2e.log`, `bundle-ios.log`, `bundle-android.log`,
`runtime-check.log`, `web-runtime-check.log`, `live-smoke.log`, `gap-after.log`
inside the feedback evidence archive. E2E screenshots/geometry/ARIA are in
`e2e-artifacts`; actual dev server screenshots/records are in `live`; original
and revised gap measurements/screenshots are in `before` and `after`.

## Current Human Acceptance Handoff

- URL: `https://192.168.0.145:19452` (same local HTTPS certificate).
- tmux: `ham45-reader-19452`, ID `$24`, pane `%24`, pane PID `2042661`, Metro PID `2042807`.
- Log: `test-results/ham45-live/dev-server.log`; stop: `tmux kill-session -t ham45-reader-19452`.
- Refreshed actual dev-server screenshots cover 1440/390/320 toolbar, drawer and settings. Reader widths 776/352/282, iframe heights 560/283/283, unchanged across overlays and all at least 240; no horizontal overflow.
- The process runs detached in tmux with `CI` unset for watch mode. Survival without a system supervisor remains best-effort and does not cover host restarts.
- Native remains **device unverified**; hardware-keyboard focus containment is out of scope. No commit, push, PR or archive. Awaiting human acceptance.
