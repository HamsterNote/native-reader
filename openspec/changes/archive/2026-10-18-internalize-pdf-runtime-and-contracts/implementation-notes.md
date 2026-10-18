# Implementation Notes

## Baseline and Branches

HAM-54 branches from native-reader `4e031e2057907ff9e8603e60ee188f0d787ab9c9`
on `agent/ham-54-internalize-pdf`. The baseline below predates the later
feature-branch push authorization; PR/base selection remain pending. No main
push, tag or release is authorized.
The initial local checkpoint was rebased onto #7 after reading the explicit
HAM-54 branch decision; it carries no Android #9 host code. Existing PR bases
and platform branches remain intact:

| PR | Head | Base | State at migration baseline |
| --- | --- | --- | --- |
| #6 routing | `0bf324d` | `main` | open |
| #7 Web | `4e031e2057907ff9e8603e60ee188f0d787ab9c9` | `agent/agent/22aeef6aa968` | open, ready |
| #8 iOS | `732eff600fb7165a4077062ff8b3072ca1705d54` | `agent/ham-46-pdf-web` | open, draft |
| #9 Android | `5be2d826301a7364c978c166ea33e39c822b1acd` | `agent/ham-46-pdf-web` | open, draft |

This line already contains Web PDF UI, iframe shell/protocol and the generic
isolated Android fault matrix. PDF-specific Android validation uses a separate
local temporary #9 integration, as directed in comment
`01a14e95-bf8f-752b-bd84-2df560b2281d`. It does not integrate the iOS sibling.
HAM-46 accepted Web only. Device selection handles and menu suppression remain
unverified; migration does not change that acceptance boundary.

## Source and Artifact Comparison

The historical artifact revision is `73f2c2f593c35bcad696478c56f843d624f8a6be`;
the archived source snapshot is `5311f5da2c437a7e6a4ca6cfc1690676393b046c`.
Git comparison confirms identical bytes for all five runtime build inputs:

| Source | SHA-256 at both revisions |
| --- | --- |
| `src/pdf/pdfDom.ts` | `9ce01af059f9187547f32651b7d45bf6324f0c6e89dfd5fe9ed339dc50be8ba2` |
| `src/pdf/pdf.css` | `6dcb2ba2b712133a452a5e1c0809613bb5d15a1dbaaf1a24c25291e70d5065fd` |
| `src/pdf-contracts.ts` | `f4a0acff58ca77f4bdb16bff0108fd51c33553cfe418c66f49aab21e63d5a87c` |
| `vite.pdf.config.ts` | `013e86a470f340698766539b3300512bebd12675762ddea8a29f0acd718033bc` |
| `scripts/stage-pdf-runtime.mjs` | `5e8507799a57e4fddcc50dbe589996e31a246fcb312138c116a4235b195f7e17` |

Baseline stage/check validates all 205 deployed assets in the initial local
#9 snapshot against the fixed artifact and native shell overlay. #7 has 203
assets; the extra two are Android shell files. Native owns `reader.html`, `shell.css`,
`shell.mjs`, Android shell and `protocol.ts`; these are not replaced with the
old React UI. The generated contracts body exactly matches the source above.
The migrated DOM adapter changes only its contracts import path; CSS is exact.

Baseline verification rerun for HAM-54 before replacing the runtime build:

| Entry | Result |
| --- | --- |
| `node packages/native-reader/scripts/stage-pdf-runtime.mjs --check` | 205 assets pass |
| `pnpm run test:pdf-runtime` | 3/3 pass |
| library Jest | 396/396 pass |
| `pnpm e2e:pdf --project=chromium-desktop --project=chromium-mobile --project=firefox` | 21/21 pass |
| migrated `pnpm run test:pdf:webkit` | 7/7 pass |
| actual prior tarball offline consumer | 205 assets, pixels/text/thumbnail/bounds/host bytes/worker teardown pass |

The baseline tarball SHA-256 is
`22c5fad5e9d3fa433961cfcdd18272f45d388ade9a9864ef56fc46c9886b749d`.
Previous HAM-46 fresh-cache Android evidence at source `3a7b1640fbb4f9f2ca8052edf03c92253a50287c`
has 89 Robolectric methods (28 PDF) passing; `5be2d82` only adds documentation.
This is historical baseline evidence, not a HAM-54 post-migration Android run.

## Specification Authority

The four PDF master specifications and full
`archive/2026-10-18-add-platform-pdf-renderers` directory are copied verbatim.
`migration-provenance.json` records the source revision and every file hash;
all 14 copied files match the source snapshot. Native-reader `openspec/` is
the authoritative maintenance location. Historical reader paths in this
immutable archive describe provenance, not a build prerequisite.

The archive retains 15/33 checked tasks and 18 unchecked tasks, with Web-only
acceptance. Existing `local-multi-format-reading` rejects PDF in the Foliate
path; migrated `pdf-renderer-routing` defines the independent PDF dispatch.
That historical exception does not allow PDF into Foliate, relax the EPUB
gate, or change EPUB CSP/private bridge requirements.

`openspec validate --specs --strict`: 9/9 pass after copying.

## WebKit Entry

Run `pnpm run test:pdf:webkit` from native-reader. The runner resolves its own
repository, builds the Expo Web export, then runs the existing seven PDF tests
inside rootless Podman with `--network=none` and no proxy variables. It reads
no reader checkout, package or test-tools directory.

Prerequisites: rootless Podman, local image `localhost/ham40-webkit:noble`
(Ubuntu Noble with Playwright system libraries), Node mounted read-only, and
the matching Playwright WebKit build (currently 2359) cached outside the image.
Set `PDF_WEBKIT_BROWSERS_PATH` for an existing cache. Explicit `--install`
uses host networking only to provision the browser cache; test execution stays
offline. Linux WebKit is not Safari or native device acceptance. Do not run
two Expo export builds concurrently because they share `apps/demo/dist`.

## Applied Design Decisions

Code inspection found no Vite, Rollup or esbuild dependency in native-reader;
its existing build chain is Expo Metro, Bob and TypeScript. HAM-54 comment
`01a14e95-bf8f-752b-bd84-2df560b2281d` resolves the false Vite assumption:
TypeScript compiles adapter/contracts/protocol, rewrites module specifiers via
its AST, and stages exact upstream `build/pdf.min.mjs` next to the worker.
The existing shell uses relative ESM imports, and its unchanged `script-src
'self'` / `worker-src 'self'` permits this format. New assets are `pdf.min.mjs`
and `contracts.js`; #7's runtime grows from 203 to 205 manifest entries. No
bundler is added. A narrowly scoped pnpm override omits PDF.js's optional
Node-only `@napi-rs/canvas` dependency: the adapter runs in a browser and uses
its real DOM canvas; stage only reads upstream files. This keeps the lockfile
addition to exact PDF.js alone, with no extra libraries or existing upgrades.

The trigger lists old `PdfReader.tsx`/`localSource.ts`, while the approved design
excludes the old React/IntermediateDocument/EPUB library. Those files import
old components and EPUB parsers; the existing native-reader UI/source route
already owns that behavior. No old component/parser
dependency has been introduced. The issue itself explicitly excludes migrating
the old component library; existing native-reader UI/source routes remain the
integration point.

## Migration Verification

`scripts/verify-pdf-equivalence.mjs --baseline <previous-native-runtime>`
compares one generated three-page PDF in two isolated browser pages. The
previous native deployment and the local-source runtime match exactly for
metadata, loading/ready/page events, full canvas pixel SHA-256, text,
thumbnail, selection payload, invalid navigation and host bytes. No external
requests occur. This baseline is an optional migration comparison input, not
a build or runtime prerequisite.

Asset comparison: all 202 unchanged common assets retain their previous
bytes, size and MIME. Only `adapter.js` changes, splitting the inlined engine
and contracts into two new assets (`pdf.min.mjs`, `contracts.js`). Android's
two shell files belong only to the local #9 validation tree. The native-owned
shell, protocol and all worker/font/CMap/WASM/ICC/license bytes stay exact.
The OpenJPEG JavaScript fallback keeps `text/javascript`, with a regression
assertion; no asset or network fallback is added.

The migrated lifecycle tests now use Playwright's real DOM and a controlled
engine module, rather than adding Vitest/jsdom dependencies. They cover
thumbnail failure/invalid pages, bounded surfaces/page cleanup, queued and
late thumbnail settlement, idempotent disposal and retired callbacks.
Existing real-engine tests retain replacement during worker startup and
host-owned bytes checks. These controlled-engine tests are not native UI
acceptance.

Browser coverage mapping:

| Historical behavior | Maintained coverage |
| --- | --- |
| physical pages, thumbnails, rotation, bounded surfaces | `pdf-reader.spec.ts` first case; lifecycle first case |
| selectable text, suppressed context menu, temporary Popover, no writes | `pdf-reader.spec.ts` Popover case |
| renamed local file dispatch, replaced source and private host bytes | existing Expo open/replacement cases |
| boot before complete I/O, retirement during worker loading | existing missing-shell/loading replacement cases |
| Android private-port document and wrong-MIME cases | only #9 temporary integration browser suite |

The #7 delivery tree has five existing product cases plus two migrated lifecycle
cases: Chromium desktop/mobile + Firefox 21/21, rootless offline WebKit 7/7.
The historical #9 count of 21/7 included two Android shell cases instead of
the lifecycle cases; equal counts do not imply identical suites. Temporary
Android integration keeps those two cases as well.

Local verification so far: workspace typecheck and Bob pass; library386 +
demo18 Jest pass; release safety7 static +90 Node pass with2 Windows skips;
secure staging and release lifecycle pass; PDF stage/sync/package safety23/23 pass.
Foliate supply-chain431-file check, supply-chain/submodule14/14, runtime5/5,
Web sync8/8 and native-export guards2/2 pass. The EPUB route/protocol/CSP and
Foliate generation have no implementation diff from #7.

An actual 663-file isolated tarball passes ESM/CJS/no-DOM external contracts
without installed peers, all205 runtime assets, offline canvas/text/thumbnail,
bounds, private source bytes and worker closure. Final tarball SHA-256 is
`b26d6565d4b9966c897dbcc6e2fa2a39f2f4dceda224c56bd42b17cecdd88fb3`;
the205-entry manifest SHA-256 is
`d055a7721ce1de1395f932a90726b48dd666989c9f2d38f028e02b66e52f0cdd`.

Final independent checkout `9b7c938` has the same product tree as delivery
`8d9c677` and its own dependencies, with no reader source/package. Typecheck,
complete root build, library386/demo18 tests, PDF23 tests and stage check all
pass sequentially. Root build includes the actual generic Android isolation
matrix (3m13s/32 tasks), npm/pnpm packed consumers and new-architecture x86_64
APK assembly (1m15s/124 tasks), plus Metro Web export. Installed package source
authority digests remain unchanged. JDK17/SDK36 and the verified official
Gradle ZIP are available; only disposable network/wrapper configuration is
adapted. Existing public/private package-tool allowlists and RN resolution
smoke exports needed narrow fixture fixes discovered during the full build;
failed attempts and exact commands are recorded in `verification-report.md`.

The unchanged Foliate browser/transport matrix passes54 cases, with40 existing
browser-specific skips and no failures. Its occupied default port is replaced
only in a disposable imported config, removed after test completion. All
test-owned servers are stopped; no persistent service or existing service is
modified. iOS compilation, Safari and all native device acceptance remain
unverified. See `verification-report.md` for complete results and limits.

Android PDF validation: local temporary merge `22b28cc226375a4667fc156f12651d64e7a934e4`
combines #9 `5be2d826301a7364c978c166ea33e39c822b1acd` and migration source
`c33822d`. The only merge conflict was the old stage script; the new local-source
script is retained and automatically includes #9's two shell sources. This
integration is not part of the delivery branch and is not pushed.

The historical #9 isolated bootstrap ran that exact merge revision with JDK17,
SDK36 and the official Gradle9.3.1 ZIP verified against
`b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06`.
Its fresh private Gradle state builds the real production host and all PDF/
securewebview Robolectric suites successfully (5m55s,33 Gradle tasks). The
production isolation API confirms authority invariants and removes all owned
cache roots. Only disposable wrapper URL/proxy properties differ; checksum
verification stays enabled, and no shared Gradle state is injected. The exact
bootstrap is available for historical audit from the #9 Git object, not as a
file in this delivery tree. `verification-report.md` now gives executable
production-entry and temporary-integration steps, exact historical script
sources, and authenticated evidence attachment/member locations. Historical
URL/proxy configuration is explicitly distinguished from later approval for
checked ZIP preprovisioning in the gate-owned cache; the latter was not rerun.
Official distribution download timeouts remain an environment reproduction
limit. This is JVM host evidence, not device evidence.
