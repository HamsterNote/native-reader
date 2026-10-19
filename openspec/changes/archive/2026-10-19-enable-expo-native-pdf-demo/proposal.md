# Proposal

## Why

现有 `apps/demo` 已是 Expo 应用，但 main 的 native PDF host 尚待 #9/#8 合入，根目录也缺少明确的 native dev-client 启动入口。HAM-56 要让人类用同一个 Demo 在真机验证 PDF 分流、Pages 和选区 Popover，而非创建或发布新应用。

## What Changes

- 基于 #9（Android）和 #8（iOS）合入后的 main，补齐现有 Demo 的本地 development client 接入、autolinking、资源准备和根目录 `pnpm run dev:native` 单命令启动路径。
- 固定默认 Metro LAN 端口 8081，支持显式覆盖端口；给出首次构建安装、再次启动、手机局域网连接及平台环境限制的可执行步骤。
- Demo 保持 package-root `NativeReader` 消费方式，通过现有系统选择器传入本地 PDF；iOS 使用 PDFKit Expo Module，Android 使用隔离 pdfjs renderer。
- 修正 Demo 规格中“不得支持 PDF 选择”的过时要求；沿用现有 PDF Pages 和选区 Popover 规格，补充真机操作验收与证据边界。
- 非目标：不新建应用，不做 EAS、独立发布包或第二套打包体系；不实现高亮、批注、存储或撤销；不修改 EPUB 路径或安全门禁；设备行为验收由人类执行。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cross-platform-reader-demo`：支持本地 PDF 候选选择；增加根目录单命令启动 native dev client、局域网连接和人类真机 PDF 验证要求。

## Impact

- 预计影响根目录与 `apps/demo/package.json`、必要的 Demo Expo/Metro 配置及测试、`apps/demo/src/DemoApp.tsx` 的 native PDF 支持文案、`README.md` 与 `docs/validation.md`。
- 复用 `@hamster-note/native-reader`、#8 的 `@hamster-note/pdfkit` / `expo-dev-client`，以及 #9 的 `HNPdfView` 与 APK 私有 PDF 资源。不新增 reader 公共 API。
- 2026-10-18 核对：#9 OPEN（`8a5fd3a5880c9646a323e88502fcf3a173a33eed`），#8 OPEN/DRAFT（`732eff600fb7165a4077062ff8b3072ca1705d54`）；接口按对应分支实物规划，合入后保持这些接口是待确认假设。#8 当前 base 仍为 `agent/ham-46-pdf-web`，本提案不承担其重定向或合并工作。
- 当前 main 实际为 Expo `~57.0.24`、RN `0.86.3`，`web.output=single`；以仓库锁定版本为准，不按交接中的旧补丁号降级。iOS PDFKit pod 要求 iOS 16.4+。Expo Go 无法装载本期自定义 native hosts。
