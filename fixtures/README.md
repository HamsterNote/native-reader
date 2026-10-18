# Deterministic Multi-Format Corpus

`manifest.json` is schema version 2 and is the source of truth for every binary
fixture under this directory. All entries are generated CC0 material and record
their format, deterministic recipe, SHA-256, byte count, expected behavior,
and explicit limitations.

Run `pnpm run fixtures:generate` to regenerate the corpus and
`pnpm run fixtures:check` to verify its manifest, file set, bytes, format
structure, and the real Foliate parser paths. The historical EPUB files listed
in the v2 manifest retain their prior relative paths and bytes.

The KF8/AZW3 samples open through the pinned Foliate parser and contain one
readable section; TOC anchors and pagination do not prove cross-chapter behavior.
Representative large EPUB, MOBI, KF8/AZW3, FB2, FBZ, and CBZ inputs are tagged
`measured-large-smoke`. `pnpm run smoke:large` records real exported-Demo opens
and one forward page/section per fixture in `test-results/large-fixture-smoke.json`,
including failures and elapsed times. `pnpm run smoke:large:io` separately records
file-read/hash timings without claiming render performance.

EPUB/FBZ/CBZ use deterministic stored ZIP recipes. Large MOBI/KF8 split text
into 4096-byte records; KF8's FRAG length uses its variable-length encoding.
Existing small fixture bytes remain independent of the large-input recipes.
CBZ is fixed layout and has no reflow flow control. This historical Foliate
detector corpus treats PDF as rejection-only; it is not the HAM-46 PDF renderer
acceptance corpus. PDF browser tests generate selectable/rotated, corrupt and
misleading-name inputs separately. Full native permission/encryption/oversize
fixture coverage remains an open HAM-46 task.
DRM/encryption samples expose
only synthetic metadata flags and never provide a bypassable encrypted payload.
