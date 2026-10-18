# Proposal

## Why

reader 仓库将废弃，但 native-reader 的 PDF 构建仍依赖 reader 的固定发布包及生成契约，无法独立维护。将 HAM-46 已有 PDF 资产链路和权威文档收进 native-reader，使后续开发不再需要 reader 仓库或其发布产物。

## What Changes

- 将 PDF DOM 适配器及其最小依赖、CSS、PDF.js 资产构建逻辑迁入 native-reader；复用已在 native-reader 的 shell、iframe 协议与 RN/Web UI。
- 将 `src/pdf/contracts.ts` 从 reader 产物生成副本改为本仓权威源码，通过 `@hamster-note/native-reader/pdf-contracts` 提供无 DOM 的类型与现有纯函数入口。
- 用本仓源码构建和精确版本的 PDF.js 5.4.530 生成 PDF runtime；移除 `reader-pdf.tgz`、`reader-pdf.json`、`--import/--revision` 及运行中的 reader 元数据依赖。保留资产清单、SHA-256、路径与符号链接拒绝、禁网 consumer 校验。
- 在后续实施中原样迁入 reader 的四份主规格及 `2026-10-18-add-platform-pdf-renderers` 完整归档，记录来源与权威归属。保留未完成任务及仅 Web 验收的结论。
- 将必要的 WebKit/浏览器回归入口收进 native-reader，保留 `e2e:pdf`、隔离 consumer 和 Android Robolectric 验证路径。

## Capabilities

### New Capabilities

无新增产品能力。本变更是行为保持的归属重构，声明 `skip_specs: true`，不创建 delta specs。

### Modified Capabilities

无行为需求修改。`pdf-renderer-routing`、`pdf-pages-navigation`、`pdf-selection-popover`、`android-pdf-asset-origin` 仅迁移权威副本，需求正文与验收范围保持原样；不修改 Foliate 规格。

## Impact

- 目标仓库：native-reader；reader 仅作只读迁移来源，不在本变更中归档仓库或改写其代码。
- 实施触及 `packages/native-reader/src/pdf/`、`pdf-shell/`、`scripts/`、包 exports/files、锁文件、demo 静态资产接入、README、第三方声明和 `openspec/` 历史文档。
- 将已有引擎 `pdfjs-dist@5.4.530` 的精确依赖声明迁入本仓构建依赖；不引入新引擎、新第三方库或升级现有依赖。最终包离线自足。
- 不改变 EPUB/Foliate、CSP/private bridge、PDF 协议版本、外部 Reader 行为、原生设备验收范围或高亮占位语义。
- main 尚无 HAM-46 PDF 实现。实施需承接现有 PDF 分支成果；不能把 main 的拒绝 PDF 测试当作本变更的行为基线。分支依赖与已有规格冲突详见 design。
