# Native Reader

`@hamster-note/native-reader` is a controlled, cross-platform EPUB reader
component library for Expo applications on Android, iOS, and Web. It is
intended to be consumed by other HamsterNote projects as a reusable reading
surface.

This repository is initialized with [OpenSpec](https://github.com/Fission-AI/OpenSpec)
using the `spec-driven` schema. Product behavior is specified first as OpenSpec
changes, then implemented.

## Workspace

- `packages/native-reader` is the publishable `@hamster-note/native-reader` package.
- `apps/demo` is a private Expo application that consumes only the package root.
- `fixtures/epub` contains generated, synthetic EPUB acceptance fixtures.
- `tests/e2e` contains the offline Playwright Web acceptance scaffold.
- `docs/physical-device` contains explicitly incomplete iOS and Android evidence
  records until real hardware runs are performed.
- `openspec/` contains the behavior and scope contracts.

## Reader API and ownership

Consume the package only through `@hamster-note/native-reader`; package
subpaths are not public API. The package exports `NativeReader` and its public
TypeScript types from that root. The exact prop contract is defined by the
root-exported `NativeReaderProps` declaration and is checked by the package's
contract tests.

For EPUB use, the host owns file acquisition and permission handling. It passes
a local, user-selected `{ kind: 'uri', uri, name?, mimeType? }` source to the
reader and may observe `loading`, `ready`, and stable categorized `error`
states. Native accepts `file:` and `content:` URIs; Web accepts host-owned
`blob:` URIs. Remote URLs are rejected before opening.

The reader owns publication validation, reflowable rendering, chapter and TOC
navigation, local publication media, normalized progress reporting, and
cleanup of the current publication. Replacing the source starts a new load;
stale events from the previous source must not become current state. Unmounting
releases parser/render resources. Backgrounding may pause work, but persistence
and app lifecycle policy remain the host's responsibility.

## Security model

- Only host-supplied local EPUB files are in scope. Selecting a file does not
  authorize network access.
- Publication JavaScript and other active content must not execute.
- HTTP(S) resources referenced by publication content must not be requested.
- Malformed, encrypted/DRM, fixed-layout, and otherwise unsupported
  publications must fail with a readable error without crashing the host.
- Scripted publications are displayed as static content after active markup and
  external resources are removed; publication scripts never execute.
- Publication markup, paths, metadata, and media are untrusted input. ZIP path
  traversal, resource escape, and unsafe URI schemes must be rejected.
- The deterministic security fixture intentionally contains a script and an
  `example.invalid` image reference. The E2E harness blocks and records all
  non-loopback requests as a second line of defense.

## Lifecycle

1. The host obtains a local URI through a user gesture. On Web it converts the
   selected `File` to a blob URI; the DOM `File` is never passed to the reader.
2. Loading validates the container and publication before rendering. Ready or
   error is reported through the public API.
3. Reader-owned previous, next, and table-of-contents controls update the
   visible linear section.
4. A source replacement or unmount cancels stale work and releases object URLs,
   temporary extraction data, listeners, and rendering resources.
5. Reopening a supported location resumes best-effort. An invalid location
   falls back safely rather than preventing the publication from opening.

## Non-goals

This change does not provide PDF or other formats, DRM/encrypted publication
support, fixed-layout EPUB, executing scripted EPUB content, remote book retrieval, a catalog or
account service, cloud synchronization, annotations, highlights, search,
text-to-speech, host file-picker UI, or a compatibility promise for package
internals. Device evidence templates are documentation, not proof of runs.

## Setup and verification

```sh
pnpm install --frozen-lockfile
pnpm run verify
```

The aggregate gate runs strict type checking, ESLint, Prettier, component and
contract tests, fixture integrity, clean ESM/CommonJS/declaration builds,
packed-package checks, and an Expo static Web export. Browser and native bundle
smokes are separate because they require platform tooling:

```sh
# Regenerate only after intentionally changing a fixture recipe.
pnpm run fixtures:generate
pnpm run fixtures:check

# Report reproducible host I/O/hash measurements to an ignored artifact.
pnpm run smoke:large

# Install Chromium once, then run file-selection acceptance with networking off.
pnpm run e2e:web:install
pnpm run e2e:web

# Independent native JavaScript bundle/export smoke checks.
pnpm run bundle:ios
pnpm run bundle:android
```

`smoke:large` writes `test-results/large-epub-smoke.json`; it is not a claim
about device render performance. Playwright writes its HTML report to
`playwright-report` and traces/results to `test-results`. Complete
`docs/physical-device/ios.md` and `docs/physical-device/android.md` only from
real hardware, preserving logs and measured open-time/memory evidence.

## Fixture corpus

The committed fixture corpus includes valid multi-chapter EPUB 2 and EPUB 3
books with their respective TOCs and local media, malformed input, unsupported
fixed-layout input, scripted/external-resource input, and a representative
large reflowable book. `fixtures/epub/manifest.json` records byte counts,
SHA-256 checksums, CC0 licensing, generation recipes, and expected behavior
tags. Generation uses a dependency-free stored ZIP writer with fixed metadata,
so identical source produces identical bytes across runs.

The Web tests select these files through `input[type=file]` rather than fetching
them. They expect accessible buttons/links and `role="alert"` errors, which are
also part of the acceptance surface. The harness sets the browser context
offline after the local Demo loads and fails if publication behavior attempts
any non-loopback request.

## Platform acceptance

```sh
pnpm --filter @hamster-note/native-reader-demo run ios
pnpm --filter @hamster-note/native-reader-demo run android
pnpm --filter @hamster-note/native-reader-demo run web
pnpm --filter @hamster-note/native-reader-demo run build:web
```

On iOS, Android, and Web, select the same fixture files and verify chapter/TOC
navigation, local media, readable malformed/unsupported errors, blocked active
and external content, source replacement, and cleanup on unmount. Disable
networking for the offline cases. Native acceptance is incomplete until the
corresponding physical-device evidence record is completed.

## OpenSpec workflow

- Propose a change: `/opsx-propose "your idea"`.
- Apply an approved change: `/opsx-apply`.
- Validate: `openspec validate --all`.
- List changes and specs: `openspec list` / `openspec list --specs`.

## Scope reference

OpenSpec remains the normative behavior contract. This README documents the
repository's public integration and verification paths; it does not expand the
approved change or make generated fixtures part of the npm package.
