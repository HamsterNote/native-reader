# Proposal

## Why

HAM-38 的截图反映了共用 `ReaderChrome` 将标题、导航、flow、常驻目录纵向堆叠的问题，目录会夺走正文空间，控件缺乏正式阅读器的信息层级。HAM-35 已合入 native-reader main，需要在现有 Foliate 与公共 API 基础上改善阅读界面，并提供仓库内可复现的验收路径。

## What Changes

- 重排 Web/native 共用 chrome：紧凑标题工具栏、章节导航、统一分段式 Scrolled/Paginated 控件；长标题截断、窄容器换行和可访问状态清晰可辨。
- 目录默认收起，有独立展开/收起入口；展开为正文前的限高独立滚动区域，不覆盖正文，保留中立 TOC 和旧 TOC 路径的导航语义。
- 保持真实 flow、固定版式提示、章节边界、可恢复错误以及宿主 style/testID 契约；不改导出 API、不更换引擎、不新增格式支持。
- 复用 `apps/demo` Web 入口，补齐运行说明、长标题/长目录确定性验收样本、人工点检和组件/浏览器回归覆盖，不依赖截图的临时外壳。
- 独立命名本 change；旧 `add-cross-platform-epub-reader` 的历史归档不作为前置条件，避免其陈旧 EPUB-only/epubjs delta 覆盖现行主规格。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `reader-component-api`: 明确目录折叠、flow 控件、响应式 chrome、视口和可访问性兼容行为。
- `cross-platform-reader-demo`: 增加可复现的 chrome 验收入口和人工点检要求。

## Impact

实现涉及 `packages/native-reader/src/ReaderChrome.tsx`，必要的 Web/native 宿主布局接线，`ReaderChrome.test.tsx`、`NativeReader.web.test.tsx` 和既有 E2E 中的目录打开步骤。文档涉及根/包 README 和验收文档；样本沿用仓库 fixtures 生成与清单机制。复用 React Native 原语，不预设新增依赖；不修改另一仓库 `HamsterNote/reader`。本轮仅生成规划文档，所有实现与验收执行留给 apply。
