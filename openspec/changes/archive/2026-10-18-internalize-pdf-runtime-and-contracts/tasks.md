# Tasks

## 1. 确立迁移基线

- [x] 1.1 在承接 HAM-46 的工作线上记录实际基线 SHA、PR #7/#8/#9 状态及所需分支依赖；交付基线表，确认已存在 Web PDF 源码、Android 验证入口及原有 Foliate 安全例外说明，禁止直接从 main 重造 PDF 功能。
- [x] 1.2 将固定 tarball 的资产、生成契约与 reader `5311f5d` 对应源码/构建输入逐项对照；交付差异清单和既有 Web/离线 consumer 基线结果，Android PDF Robolectric 在 #9 `5be2d82` 的本地临时集成 checkout 验证，不纳入 #7 交付分支；注明环境阻碍及历史仅 Web 已验收的范围。

## 2. 内迁源码与契约

- [x] 2.1 迁入 `pdfDom.ts`、`pdf.css` 及必要生命周期测试，保留 native-reader 已有 shell/protocol/UI；验证源码 diff 仅含路径/构建适配，原生命周期测试覆盖 source 替换、页面/缩略图回收与宿主资源所有权。
- [x] 2.2 将 `packages/native-reader/src/pdf/contracts.ts` 改为唯一权威源码，删除产物反向覆盖写入；验证 RN/Web、protocol、DOM adapter 全部引用此源，页码、选区、session 及纯函数的兼容断言通过。
- [x] 2.3 增加 `@hamster-note/native-reader/pdf-contracts` 的 ESM/CJS/types exports 与包文件；在不含 DOM lib 的外部 TypeScript consumer 及实际装包的 import/require 测试中验证入口可解析且不加载 React、DOM 或 PDF.js。
- [x] 2.4 在 workspace 精确声明并锁定已有 `pdfjs-dist@5.4.530`，用现有 TypeScript 构建 adapter，AST 重写为同源 `./pdf.min.mjs` 与 `./contracts.js`；验证不新增 bundler、无其他依赖升级，生成 `adapter.js` 可离线加载且无裸包名导入。

## 3. 改造装包与完整性校验

- [x] 3.1 改写 `stage-pdf-runtime.mjs` 为本仓源码构建和 PDF.js 资产 stage，覆盖 worker、cmaps、standard_fonts、wasm、iccs、CSS、shell、protocol 和许可证；验证清单有全部必要条目、精确版本、大小、MIME 和逐文件 SHA-256，重复构建清单稳定。
- [x] 3.2 更新 `sync-pdf-web-runtime.mjs`、consumer、host/tests 和日志以去除 `manifest.reader` 依赖；验证正常 stage/sync/check 通过，`--check` 不修改文件且可发现漂移，旧 `--import/--revision` 参数明确失败。
- [x] 3.3 保持 stage/sync 的路径、安全类型及目标所有权检查；用负例验证篡改/缺失资产、重复条目、穿越、源/目标及祖先符号链接、特殊文件和 stale 输出均失败，外部目标文件未被写入。
- [x] 3.4 接入 `isolated-release.mjs` 及现有包校验链，在 staging 内从本仓输入构建 PDF 并纳入实际 tarball；验证不污染源目录、包的 runtime 与 manifest 一致、consumer 无需 workspace 或构建依赖。
- [x] 3.5 移除 `vendor/reader-pdf.json`、`vendor/reader-pdf.tgz` 及所有执行中的旧 pin/import/revision 引用，刷新 demo 和相关平台资产；用 `rg` 检查活跃代码/配置无 reader 包、仓库或 tarball 输入，只允许历史来源与许可证说明保留引用。

## 4. 迁移规格与维护文档

- [x] 4.1 从 reader `5311f5d` 原样迁入 `pdf-renderer-routing`、`pdf-pages-navigation`、`pdf-selection-popover`、`android-pdf-asset-origin` 四份主规格；记录来源文件 SHA-256，验证正文一致并执行 `openspec validate --specs --strict`，出现已有目标差异时先比对整合。
- [x] 4.2 原样迁入 `2026-10-18-add-platform-pdf-renderers` 完整归档及元数据、报告和证据文档，附来源清单及权威位置说明；验证来源与目标逐文件 SHA-256 一致、未完成任务仍未勾选、报告仍为仅 Web 验收。
- [x] 4.3 更新 README、包文档和 THIRD_PARTY_NOTICES，说明本仓构建、contracts 入口、PDF.js 精确版本和许可证、独立 PDF/Foliate 边界、历史规格例外和回退方法；验证命令均对应实际 scripts，无 reader 检出/装包步骤，版权归属仍完整。

## 5. 保留独立回归入口

- [x] 5.1 将 reader WebKit runner、配置、最小 fixture 和 PDF 行为断言适配到 native-reader，提供 `pnpm run test:pdf:webkit`；验证原 7 项断言可在 rootless 禁网环境运行且不读取 reader 目录，保留原 runner 的隔离保证。
- [x] 5.2 保留 `pnpm run e2e:pdf`，补齐已验收 Chromium/Firefox 行为覆盖；验证本地打开、Pages/缩略图/跳页、临时选区 Popover、占位高亮无写入、菜单抑制与仍可选文，记录与 HAM-46 原 21/21 场景的覆盖映射和实际结果。
- [x] 5.3 更新 `scripts/verify-pdf-consumer.mjs`，以隔离发布实际 tarball 及 SHA-256 为唯一包输入；禁外网且仅允许 loopback 后验证 canvas 非空、文本/缩略图、越界页码、宿主 bytes 不变、worker 回收和 contracts 导出，外部请求为零。
- [x] 5.4 保留 Android 隔离 fault-matrix 入口 `pnpm --filter @hamster-note/native-reader run test:android-fault-matrix`；以本地不推送的临时 checkout 将 #9 `5be2d82` 与迁移提交集成，用新资产验证 HNPdfAssets/Document/Protocol/Source/View 及 securewebview Robolectric、精确资产 origin、过期 session 拒绝及无网络回退；交付分支不含 #9。89/89 证据来自历史 disposable bootstrap（临时 URL/proxy 配置），脚本来源、6 份 JUnit、日志及附件位置见 verification-report.md 的 Android Integration；该报告提供交付树正式入口与临时集成复现命令，另标明后续仅准校验 ZIP 后预置隔离缓存、官方分发下载超时复跑未验证，勿将历史方法冒充新方法或设备验收。

## 6. 综合验收与交接

- [x] 6.1 在无 reader 检出和 reader 包的隔离目录，使用预置/已缓存精确依赖执行 `pnpm run typecheck`、`pnpm run test`、`pnpm run build`、`pnpm run test:pdf-runtime`、PDF stage/check 和实际发布 consumer；验证各入口成功，运行时不需网络，正常依赖安装不被误作运行时网络回退。
- [x] 6.2 执行既有 Foliate supply-chain/security、发布隔离、EPUB 路由回归及第 5 节浏览器/Android 矩阵；交付逐项结果、命令、fixture、资产 manifest/实际 tarball 摘要，与迁移前基线对照，阻碍或未运行项明确标记未通过。
- [x] 6.3 检查最终 diff 无 EPUB/Foliate 安全放宽、协议重设计、新库或 reader 仓库修改；执行本 change 严格校验并交付迁移证据和剩余历史原生未验收项，不把 HAM-46 未完成设备任务纳入本次完成声明。
