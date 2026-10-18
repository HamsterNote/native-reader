# Implementation Notes

## Baseline and Branches

HAM-54 branches from native-reader `5be2d826301a7364c978c166ea33e39c822b1acd`
on `agent/ham-54-internalize-pdf`. Its PR base is `agent/ham-46-pdf-android`.
Existing PR bases and platform branches remain intact:

| PR | Head | Base | State at migration baseline |
| --- | --- | --- | --- |
| #7 Web | `4e031e2057907ff9e8603e60ee188f0d787ab9c9` | `agent/agent/22aeef6aa968` | open, ready |
| #8 iOS | `732eff600fb7165a4077062ff8b3072ca1705d54` | `agent/ham-46-pdf-web` | open, draft |
| #9 Android | `5be2d826301a7364c978c166ea33e39c822b1acd` | `agent/ham-46-pdf-web` | open, draft |

This line already contains Web PDF UI, iframe shell/protocol, Android host and
the isolated Android fault matrix. It does not integrate the iOS sibling.
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

Baseline stage/check validates all 205 deployed assets against the fixed
artifact and native shell overlay. Native owns `reader.html`, `shell.css`,
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
all 15 copied files match the source snapshot. Native-reader `openspec/` is
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

## Pending Design Decisions

Code inspection found no Vite, Rollup or esbuild dependency in native-reader;
its existing build chain is Expo Metro, Bob and TypeScript. The approved design
incorrectly assumes an existing Vite and prohibits adding a bundler. Reusing
the original Vite build therefore needs an explicit design correction before
the cross-repository artifact chain can be replaced.

The trigger lists old `PdfReader.tsx`/`localSource.ts`, while the approved design
excludes the old React/IntermediateDocument/EPUB library. Those files import
old components and EPUB parsers; the existing native-reader UI/source route
already owns that behavior. Clarification is pending; no old component/parser
dependency has been introduced.
