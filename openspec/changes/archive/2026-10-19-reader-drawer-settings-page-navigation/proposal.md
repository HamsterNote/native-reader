# Proposal

## Why

HAM-38 已在 `main` 的 `d1433e9` 合并并归档，但目录仍占正文前布局，flow 常驻工具栏，顶部箭头仍逐章跳转。HAM-45 要求用左侧目录抽屉与设置模态框释放工具栏，并让顶部按钮先翻当前章节的页，再跨章节。

## What Changes

- **BREAKING**：用覆盖式左侧抽屉替代限高内嵌目录；成功目录跳转后关闭，未解析或失败时留在抽屉反馈。显式替代已归档 `polish-reader-chrome` design 决策 2。
- 左上角目录 icon 打开抽屉；抽屉内设置按钮打开设置模态框。保留已应用 flow、不可切换状态、固定版式与 disabled 语义，空目录仍可访问设置。
- Web 使用 reader 内自建层并验证 DOM 焦点循环；native 按协调裁决使用平台 Modal、返回键与读屏焦点接线，先做 HNSecureWebView 本地容器检查，不声称硬件键盘包含，设备行为标未验证。
- **BREAKING**：`Previous chapter` / `Next chapter` 改为 `Previous page` / `Next page`；Paginated 逐页，Scrolled 顶部按钮直接跨相邻可读章节，不循环。Scrolled 键盘/滚轮原生滚动；Paginated 滚轮不翻页、不位移。章节位置仍显示 `Chapter N of M`。
- 新增受认证的翻页命令和引擎真实边界回执，统一导航/flow/翻页互斥、超时与失败处理；同步 Web/native runtime 与严格验证器。
- 保留容器 680 紧凑分界、44x44 点击区、240 正文最小高度、换书重置及现有安全限制，补齐真实浏览器的焦点、iframe 隔离和窄容器验收。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `reader-component-api`：抽屉、设置模态框、可访问性、页级导航及真实边界、响应式布局契约。
- `cross-platform-reader-demo`：将可复现 chrome 验收改为覆盖层焦点与隔离、两种 flow 的翻页和跨章、真实页边界及协议失败路径。

## Impact

涉及共享 `ReaderChrome.tsx`、Web/native 适配器、`foliateWeb.ts`、`nativeReaderSession.ts`、`nativeFoliateProtocol.ts`、`scripts/native-host-bootstrap.mjs`、runtime 生成脚本及生成产物/manifest、Android/Apple 严格验证器与共享 wire corpus；不增加公共 props 或第三方 UI 依赖。内部 iframe 协议升级为 v2，native `hn-foliate-host` 保持 v1 并协调扩展所有封闭 schema。组件、协议、runtime、E2E 与文档中章节按钮标签断言需迁移；公共包根、格式支持、安全 gate 与平台证据边界保持适用。本轮 apply 仅保留本地未提交实现，启动验收服务后交人工验收，不提交、推送、开 PR 或归档。
