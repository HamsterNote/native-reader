# Design

## Context

动机见 proposal.md。本次以 OpenSpec CLI 1.13.1、项目 `spec-driven` schema 生成规划；未发现目标仓库自带 propose 命令或技能，使用工作区安装的 openspec-propose。

已核对的源码基线：

| 来源 | 快照 | 用途 |
| --- | --- | --- |
| native-reader main | `45562da04e0af2eb80694537bc5d962ecd320f23` | 提案存放位置；尚无 PDF 实现 |
| native-reader PR #7 / `agent/ham-46-pdf-web` | `4e031e2057907ff9e8603e60ee188f0d787ab9c9` | Web shell、协议、生成契约、装包与离线 consumer |
| native-reader PR #9 / `agent/ham-46-pdf-android` | `5be2d826301a7364c978c166ea33e39c822b1acd` | Android PDF host、额外 shell、Robolectric 测试 |
| native-reader PR #8 / `agent/ham-46-pdf-ios` | `732eff600fb7165a4077062ff8b3072ca1705d54` | 保持兼容的 iOS 工作，非本次新增验收 |
| reader PR #26 | `5311f5da2c437a7e6a4ca6cfc1690676393b046c` | 当前源码及 HAM-46 四份主规格和完整归档 |
| reader 固定发布包 | revision `73f2c2f593c35bcad696478c56f843d624f8a6be` | native-reader 现用运行时对照，SHA-256 `eb78938069eec509ed2861ae1beb29e85dd301598f86e9894870cec33158607d` |

PR #7 的 base 为 `agent/agent/22aeef6aa968`，#8/#9 的 base 均为 `agent/ham-46-pdf-web`。这些是并行未合入成果，不假设 Android 与 iOS 已相互集成。实施沿用 HAM-46 工作线，或等待这些成果进入目标集成线后再落地；本提案不合并、重定向或发布 PR。

与任务描述的细节差异：`stage-pdf-runtime.mjs` 当前读取仓内 `vendor/reader-pdf.tgz`，`--import --revision` 用于更新该固定产物，并无在线下载步骤。shell 与 protocol 已属于 native-reader；跨仓输入主要为 `adapter.js`、`pdf.css`、PDF.js 资产及契约源码。资产目录还包含 `iccs` 和许可证，不能仅照任务中的简略列表复制。

main 的 `local-multi-format-reading` 仍写着拒绝 PDF，与 HAM-46 主规格的独立 PDF 路由存在历史冲突。迁移采用 HAM-46 Web 已验收行为，保留该冲突的来源说明；Foliate 的拒绝 PDF/移除 PDF adapter 规则只适用于 Foliate 运行时，不改成让 Foliate 加载 PDF。若集成线仍存在顶层规格冲突，须承接 HAM-46 原有规格例外/分流说明，不静默改写为本次新增产品需求。

## Goals / Non-Goals

**Goals:**

- 在不访问 reader 仓库、不安装 reader npm 包、不导入其 tarball 的情况下，以 native-reader 源码完成构建、隔离装包、静态同步和禁网运行。
- 保持运行时路径、协议版本、状态/页码/选区/session 语义、安全校验与包消费者可用性。
- 使源码、构建输入、第三方资产版本和主规格都能在 native-reader 内追溯。

**Non-Goals:**

- 不迁移 reader React 组件库、IntermediateDocument、EPUB 实现或 demo 产品；不新增原生特性或设备验收承诺。
- 不重设计 CSP、桥接、原生 PDFKit/Android host、协议或 PDF.js 版本；不启用网络回退。
- 不在 propose 阶段复制实现、主规格或历史归档。它们是后续实施任务。

## Decisions

### 1. 本仓维护最小运行时源码，复用现有构建工具

把 reader 的 `src/pdf/pdfDom.ts`、`src/pdf/pdf.css` 和必要测试收进 `packages/native-reader/src/pdf/`；把 PDF.js 资产 stage 逻辑收进现有 `packages/native-reader/scripts/stage-pdf-runtime.mjs`。现有 `pdf-shell/reader.html`、`shell.css`、`shell.mjs`、`src/pdf/protocol.ts` 保留，Android shell 在对应分支保留。

实际 demo 使用 Expo Metro，根目录、demo、library 清单及锁文件均无 Vite；按 HAM-54 评论 `01a14e95-bf8f-752b-bd84-2df560b2281d` 的裁决，不新增 bundler。使用现有 TypeScript 编译 ES module `adapter.js`，通过 TypeScript AST 将 `pdfjs-dist` 裸导入改为 `./pdf.min.mjs`，契约导入改为 `./contracts.js`；PDF.js 主模块与 worker 一样由精确版本包复制。现有 shell 相对导入 `./adapter.js`，PDF CSP 的 `script-src 'self'`/`worker-src 'self'` 已支持同源多文件 ESM，无需改动 CSP。新文件是构建格式差异，同 fixture 的页数、像素、缩略图、选区和协议消息须对照验证。

`pdfjs-dist` 以精确 `5.4.530` 声明为 workspace 构建依赖并锁定；这是迁移现有引擎依赖的所有权，不是引入新库。复用已有 TypeScript，不增加 bundler。最终 npm 包包含完整 `pdf-runtime`，consumer 不需要 PDF.js 构建依赖。与复用 reader tarball 相比，此方案消除长期跨仓构建关系；直接提交 adapter 构建产物作为源码会失去可维护性，因此不采用。

### 2. 契约只有一个权威源，独立于 DOM

将现有 `src/pdf/contracts.ts` 提升为权威文件，去除 generated 标记和 stage 覆盖写入；保持与 reader `src/pdf-contracts.ts` 的类型、纯函数与行为兼容。包增加 `./pdf-contracts` exports，覆盖现有 module/commonjs/types 输出布局。RN/Web、协议和 DOM adapter 都引用这一文件，不分别维护副本；iframe runtime 可由同源源码编译/内联得到所需代码。

增加不带 DOM lib 的外部 TypeScript consumer，并验证 import/require 与类型入口；从实际 tarball 安装验证，禁止借助 workspace 源码解析。保留既有主入口，不导出 DOM adapter 到 contracts。继续从发布包复制契约会形成双重权威，因此不采用。

### 3. 以资产清单和固定引擎输入替代 reader revision 校验

stage 校验实际 PDF.js 版本、锁文件固定输入与许可证，生成按路径排序的 `version: 1` 清单，保留每项 path、mimeType、size、sha256 与 `pdfjsVersion`。资源集合包括 adapter、worker、CSS、shell、protocol、cmaps、standard_fonts、wasm、iccs 和适用许可证。manifest 不把自身纳入摘要；实际包的摘要由隔离发布流程校验。

移除清单中 `reader` 对象，协同更新 sync 脚本、consumer、日志和可能读取该字段的 host/tests，使其验证本仓生成资产而非旧 revision。清单完整性变化不更改 iframe 消息协议。第三方声明保留 PDF.js 及迁入源码所需版权/许可证；reader 来源标识可以保留在历史溯源说明中，但不得成为运行、构建、测试前置条件。

复用现有 stage/sync 路径校验与隔离发布边界：对所有输入、输出及其祖先拒绝符号链接，对路径穿越、重复条目、特殊文件、未知/过期输出、缺文件或 size/hash 不匹配报错。`--check` 只核对、不修复。删除旧 `--import/--revision` 功能并拒绝这些参数，避免调用者误以为仍在校验 reader 版本。仅靠包管理器 integrity 不能覆盖最终部署资产，所以保留逐文件 SHA-256。

### 4. 迁移权威规格，保留验收事实

实施时从 reader `5311f5d` 将四份 `openspec/specs/<capability>/spec.md` 原样迁入 native-reader；完整复制 `openspec/changes/archive/2026-10-18-add-platform-pdf-renderers/`，包括元数据、proposal、design、delta specs、tasks、implementation-notes、report。逐文件记录来源相对路径和 SHA-256，明确 native-reader 为后续权威维护位置。来源 SHA 仅作历史溯源，禁止脚本要求检出 reader 才能校验迁移后的文档。

归档报告明确仅 Web 已验收，原生/设备等 18/33 未完成项保持未勾选，不把迁移、Robolectric 或规格校验等同于设备验收。相同路径若已存在且不同，先展示差异再整合，不覆盖。该操作只改变文档归属，当前 change 用 `skip_specs: true`，不制造新 delta。

### 5. 回归入口在目标仓独立可运行

保留 native-reader `pnpm run e2e:pdf` 和 `pnpm run test:pdf-runtime`；移入 reader 的 WebKit 配置、rootless 禁网 runner 及其 PDF fixture/最小测试依赖，将应用接入改为 native-reader。目标入口命名 `pnpm run test:pdf:webkit`，复用原 7 项行为断言，迁移原 reader Chromium/Firefox 覆盖中尚未由 native 测试覆盖的 PDF 行为。历史 `yarn test:pdf:webkit` 只作来源说明，不要求 native-reader 改用 yarn。

隔离 consumer 接收实际发布 tarball 及 SHA-256，核验导出和 runtime，禁用外网，仅允许测试 loopback 源，断言 canvas/text/缩略图、越界跳页、宿主 bytes 所有权和 worker 回收。另校验本地 PDF 打开、Pages、Popover、无副作用高亮占位与菜单抑制。交付基于 PR #7，不含 #9 原生代码；Android 另用本地不推送的临时 checkout，将 #9 `5be2d826301a7364c978c166ea33e39c822b1acd` 与迁移提交集成，以新资产运行 PDF 五套及既有 securewebview 隔离 fault-matrix/Robolectric，记录两侧 revision。保留资产 origin、session、来源授权等断言，不以浏览器通过替代原生通过。

## Risks / Trade-offs

- [PDF 分支未合入 main] → 实施先记录所承接 commit 和集成线；不得从 main 重造已验收功能，不擅自合并全部原生 PR。
- [源码与固定 tarball 不同或重新打包导致字节变化] → 对照输入、语义、完整资产列表及同一 fixture 的测试结果；允许构建格式差异，禁止未解释的行为变化。
- [新增 export 或清单去除 reader 字段遗漏消费者] → 搜索所有脚本、host、打包模板及测试引用，使用实际 tarball 的 import/require/类型/离线测试验证。
- [安全校验在构建入口迁移后被绕过] → 正负例覆盖污染资产、目标链接、路径穿越和 stale 文件；保持原发布隔离和 Foliate gate，不新增跳过选项。
- [历史文档被误读为原生验收完成] → 原样保留报告和未勾选项，在目标 README 说明 Web 基线、Robolectric 证据和设备证据的区别。
- [“不新增依赖”理解差异] → 本方案只迁移已使用的 PDF.js 精确声明并复用现有工具；若仍需其他库，实施应停止扩展并报告，不顺手引入。

## Migration Plan

1. 在承接 HAM-46 的工作线上记录既有测试基线和资产清单，核对 pin 中的旧包与 reader 源码差异。
2. 迁入最小源码与单一契约，配置构建及 exports；更新 stage/sync/发布 consumer，确保隔离 release 先构建再验证并装包。
3. 移除旧 tarball/pin/参数与运行中的 reader 字段依赖；同步所有平台和 demo 所需资产，保留 Foliate 路径不变。
4. 迁入历史主规格与完整归档，更新来源、许可证、README 和验证入口说明。
5. 在无 reader 工作区和无 reader 包的隔离目录验证构建、装包与 consumer；运行下列任务清单中的回归矩阵并记录实际结果。

回退以撤销本次 native-reader 迁移提交恢复原固定 tarball 链路为单位，不修改宿主文件或持久化数据，无需数据迁移。回退不宣告 reader 恢复长期维护；如出现行为/安全回归，应阻止交付并定位，不能启用网络 fallback。

## Open Questions

无阻碍提案的产品问题。实施时需依据 HAM-46 当时最新集成状态记录实际承接分支；本文列出的快照是已核对的规划依据，不是合并授权。
