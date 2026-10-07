# Deterministic Multi-Format Corpus

`manifest.json` is schema version 2 and is the source of truth for every binary
fixture under this directory. All entries are generated CC0 material and record
their format, deterministic recipe, SHA-256, byte count, expected behavior,
and explicit limitations.

Run `pnpm run fixtures:generate:raw` to regenerate the corpus and
`pnpm run fixtures:check:raw` to verify its manifest, file set, bytes, format
structure, and the real Foliate parser paths. The historical EPUB files listed
in the v2 manifest retain their prior relative paths and bytes.

The KF8/AZW3 sample is intentionally detector-only until a minimal valid KF8
fixture opens through the pinned Foliate parser. DRM/encryption samples expose
only synthetic metadata flags and never provide a bypassable encrypted payload.
