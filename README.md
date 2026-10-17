# Native Reader

`@hamster-note/native-reader` is a controlled local publication reader for Expo.
The Foliate migration supports DRM-free EPUB, MOBI, KF8/AZW3, FB2/FBZ, and
fixed-layout CBZ on Chromium browsers that pass its security probe. PDF and
remote publications are not supported. Native source preparation, bounded private
transfer, and the shared renderer are implemented behind runtime security gates.
Device behavior is not claimed: HAM-35 owner 修勾 waived device and unavailable
Safari acceptance on 2026-10-16; this change is accepted on Web evidence.

## Workspace and public API

- `packages/native-reader`: library, private runtime assets, secure native host.
- `apps/demo`: document picker and package-root consumer.
- `fixtures/manifest.json`: deterministic multi-format corpus and provenance.
- `tests/e2e`: exported-Demo browser acceptance.
- `docs/validation.md`: verification commands and evidence boundaries.
- `docs/physical-device`: incomplete device evidence records.
- `openspec/`: normative requirements and implementation tracking.

Import `NativeReader`, `NativeReaderProps`, `ReaderSource`, `ReaderLoadState`,
and `ReaderReadingFlow` from `@hamster-note/native-reader`. Adapter and engine
subpaths are private. The host acquires permission and passes an optional
`{ kind: 'uri', uri, name?, mimeType? }` source; the component never opens a picker.
Web accepts a host-owned `blob:` URI. Native `file:`/`content:` input and the
32 MiB limit are enforced after the private-host behavior probe. Sources with
unknown sizes or providers that cannot supply exact bounded reads fail closed. HTTP(S) input is rejected without fetching it.

Names and MIME types are hints. The reader detects actual content before
choosing a parser and exposes idle, loading, ready, or categorized error state.
The host owns its URI, picker cache copy, and blob URL. The reader disposes only
its own iframe, listeners, derived URLs, and cache resources on replacement or
unmount; retired sessions cannot update the replacement.

## Reading behavior

Web reflowable publications default to `paginated`. Previous/Next move by readable
linear chapter in both flows, without wrapping. Pagination changes the layout,
not the navigation unit. In paginated and fixed-layout flows the Web reader also
turns pages inside a chapter with the arrow keys, PageUp/PageDown, Space, and the
mouse wheel over the publication; reaching the last page continues into the
adjacent chapter, and the last page of the book stops without an error. Keys and
wheel are not intercepted in `scrolled`, which keeps native scrolling. The
accessible TOC handles optional
and invalid destinations, and flow switching stays in the current session.
Fixed-layout books, including CBZ, have no reflow selector.

The native target defaults reflowable books to `scrolled`, with `paginated` as
an explicit option. Android WebView/Foliate pagination and text selection have
upstream limitations; returning to `scrolled` is the recovery path, not a claim
that CSS fixes selection. Native flow is implemented and exercised in a browser
using the generated native runtime; this is not installed-WebView evidence.

## Security boundary

The Web reader loads a synchronized same-origin `/reader/reader.html` shell
with its initial host CSP and external Foliate modules. Only the inner
publication iframe receives strict required CSP. A differential behavior probe
must block scripts and same-origin/cross-origin request canaries before any
publication read. Host CSP, markup cleanup, and feature detection alone do not
establish that boundary. Unsupported browsers fail closed. Firefox automation
is rejection evidence. Real branded Linux Edge is tested separately; real
macOS/iOS Safari evidence is owner-waived. Playwright WebKit is not Safari evidence.

Bridge messages must match the current origin, window, protocol, session, and
generation. Missing or invalid host assets report `runtime-asset-missing` rather
than falling back to rendering in the application document. Publication scripts,
network requests, popups, and top-level navigation are denied; local blob/data
media remain available under the strict publication policy. Publication
`meta refresh` is stripped before its markup becomes a document, because a
post-load cleanup would be too late to stop the navigation; if a publication
frame is replaced or fails to load anyway, the reader leaves `ready` instead of
reporting a book whose content is gone.

Native source access is locked behind the ordered asset-host, private-bridge,
and initial-CSP preflight gates. The iOS target is 14+ with a named isolated
`WKContentWorld` relay; Android uses a manifest-exact asset host and private
`WebMessagePort`. A bind acknowledgement is not publication ready and does not
authorize source I/O. A separate `probe`/`source-authorized` acknowledgement
unlocks finite file reads; 48 KiB chunks carry a 32 MiB maximum and a verified
SHA-256 digest. Expo Crypto supplies native entropy and SHA-256. Unknown file
sizes fail before reading, and host URIs never cross the bridge. Retirement
cancels the original channel and clears owned bytes. iOS publication rendering
is not enabled by the waiver: where the initial publication boundary cannot be
proved, the runtime remains unsupported before source access.

## Setup

Use Node 24 and the pinned `pnpm@10.0.0`. The official engine is the Git
submodule `johnfactotum/foliate-js` at
`78914aef4466eb960965702401634c2cb348e9b1`.

```sh
pnpm run foliate:submodule:bootstrap
pnpm install --frozen-lockfile
pnpm run foliate:submodule:check
pnpm run foliate:runtime:stage
pnpm run foliate:web-runtime:sync
pnpm run foliate:web-runtime:check
pnpm run dev:web
```

Use the bootstrap command even after `git submodule update --init --recursive`:
the validator requires the reviewed local pin branch, not detached HEAD. Runtime
sync materializes the manifest into the consuming app's `public/reader/`;
Metro asset loaders, public-folder symlinks, and webpack are not required.
For an installed package, run its `foliate:web-runtime:sync` and
`foliate:web-runtime:check` scripts with `--target <consumer-project>` before
Web start or export. The package's README describes that integration.

## Verification and release status

See [validation commands](docs/validation.md) for focused checks and the final
gate. `pnpm run verify` is the aggregate local gate, not device or release proof.
The `2026-10-07-replace-epubjs-with-foliate-reader` change records the effective
owner waiver in `OWNER_WAIVERS.md` and current results in `verification-round4.md`.
Its earlier reports and `ARCHIVE_NOTES.md` are historical records. No physical
iOS/Android validation or Safari test success is claimed.

### Package 发布安全入口与 CI

```sh
# 只运行静态入口合同与独立 Node 安全夹具，不运行生产 stage/pack/Gradle。
pnpm --filter @hamster-note/native-reader run test:release-safety

# 真实集成：安全夹具通过后，直接进入现存隔离 wrapper。
pnpm --filter @hamster-note/native-reader run test:android-fault-matrix
pnpm --filter @hamster-note/native-reader run test:package
pnpm --filter @hamster-note/native-reader run release:verify
```

Package 的 `test`、`test:secure-webview`、`test:release-lifecycle`、
`test:package`、`test:package:ios`、`release:verify` 和
`test:foliate-runtime-package` 不再在隔离前经过会改写源码 runtime 的 Foliate gate。
`test:raw` 与 `build:verify:raw` 首先执行 `test:release-safety`，随后以现存
`verify-foliate-submodule.mjs` 只读检查供应链；发布 wrapper 在隔离输出中
重新生成并验证 Foliate runtime。Android wrapper 消费现有 runtime，只写隔离
staging，不负责重新生成；它的正式入口也保留只读源 revision 校验，但该校验
不能证明 source runtime 与最新生成结果逐字节一致。不要用 source 下生成临时目录的
`stage-foliate-runtime.mjs --check` 冒充只读校验。

`build` / `build:clean` 保留合法的源 runtime 构建语义；`build:verify` 仍会
clean/build 源 `lib`，并不是只读命令。根工作区 `verify` / `test` / fixture
gate 未在此整改中改动，也不能据 package 隔离入口推断整条根链只读。

`.github/workflows/native-reader-release-safety.yml` 只使用 Node，分别在 Ubuntu
和真实 Windows filesystem 上运行五组安全夹具与入口静态合同，不安装依赖、
不运行生产命令。Windows 的 mixed-separator / junction 结果必须来自 Windows job，
不能以 Linux 上的 skip 替代。iOS tarball CI 先执行相同安全检查，再调用
`release:verify` 进入真实 iOS consumer 验证；安全夹具通过不等于真实 tarball、
CocoaPods/Xcode 或 Gradle 集成通过。

## Licensing and scope

Foliate is MIT licensed; its zip.js and fflate dependencies retain their own
notices in the generated runtime. See
[third-party notices](packages/native-reader/THIRD_PARTY_NOTICES.md) and the
runtime manifests for exact source revisions and shipped licenses. The fixture
corpus is synthetic CC0 material; no commercial books or DRM bypass are supplied.

Remote retrieval, PDF, DRM support, annotations, search, persistence, and a
promise to render every malformed publication are outside this change.

## OpenSpec workflow

Use `openspec list --json`, `openspec status --change <name> --json`, and
`openspec instructions apply --change <name> --json` to resume tracked work.
`openspec validate --all --strict` validates artifact structure; it does not
prove that implementation or platform behavior matches the specification.
