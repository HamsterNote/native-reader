# Design

## Context

动机见 proposal.md。当前 `ReaderChrome.tsx` 为 Web/native 共用 RN 组件，ready 区依次输出标题、章节工具栏、flow、TOC，然后是 children 视口。目录已有 `ScrollView`、`maxHeight:160` 与防撑开属性，但一直显示；根最小高度 320、正文最小高度 240。中立 `toc` 优先于旧 `model.toc`，空中立目录不回退旧目录。必须保留两种路径。

`NativeReader.web.tsx` 通过稳定 viewport ref 挂载 iframe，传入 `activeFlow`，确认 model 与 command ack 后才改变 flow；不得在 UI 内另存乐观 flow。native 安全 gate 与平台限制独立存在，尤其 iOS 可能在 source 读取前 fail closed，不能将此 UI 工作说成解除平台限制。

截图临时外壳不在仓库；现有 `apps/demo/src/DemoApp.tsx` 自身已有选择文件与 `Now reading` 状态条，可用公开包根验证 chrome。其页面 ScrollView 与 readerPanel 最小高度会影响嵌套滚动，需在真实浏览器检查。

## Goals / Non-Goals

**Goals:** 将视觉和目录状态限制在 chrome 层，稳定保留渲染实例；使用容器宽度而非屏幕宽度决定布局；给出工程师可以直接执行的验收路径。

**Non-Goals:** 不重做宿主书架/营销页面，不修改正文排版引擎、bridge、安全策略、格式支持、章节导航单位；不新增搜索、批注、进度持久化、主题系统、受控 TOC 公共 props；不执行旧 change 归档。

## Decisions

### 1. 紧凑工具栏与尺寸基线

以 reader 根 `onLayout` 测量可用宽度，最终采用 **680** 为紧凑布局分界（取代提案的 600 假设）。Chromium 实测 600/679 为三行，680/776 为单行；680 时标题仍有 159.20 像素，776 时为 255.20，按钮均无重叠。Demo 在 1440/390/320 视窗下的 reader 实宽分别为 776/352/282，另测真正的 320 容器；详见 `verification.md` 和 E2E `breakpoint.json`。宽布局：标题与目录入口在左，章节导航与位置为一组，flow 在右；窄布局：第一行标题及目录入口，第二行章节导航，第三行安排 flow，禁止标题把按钮推出边界。使用 8/12/16 间距、14/16/18 固定字号、至少 44x44 点击区域、轻分隔线与中性底色，半径不超过 8。减少常驻纵向占用，正文始终为主。

标题 `numberOfLines={1}`、尾部省略、父级 `minWidth:0`/可收缩，完整标题作为可访问名称；无标题不留占位大块。宽窄切换保持同一 viewport 子树身份。章节按钮可继续保留 Previous/Next 文案，保留原 accessible label；不引入手绘 SVG 或仅 Web 可用的按钮。

备选：仅用 window 宽度会误判侧栏中的窄 reader；绝对定位工具栏增加正文遮挡风险，均不采用。

### 2. 默认收起的内嵌目录

chrome 本地维护展开状态，新增 `Toggle table of contents` 按钮、`accessibilityState.expanded`，明确可见目录文案和展开/收起指示。目录区域仍使用 `Table of contents` label，仅展开时可访问。保持 `maxHeight:160`、`flexGrow:0`、`flexShrink:0` 与独立裁剪/滚动；在正文前参与正常布局，不采用覆盖式抽屉，避免焦点陷阱与遮住 iframe。

按钮在无有效目录、非 ready 时不显示；中立空数组仍不回退旧目录。成功点击条目保持打开，便于连续查找；unresolved 保持打开并显示原反馈，绝不调用导航。收起将 Web 焦点留在开关，隐藏条目不再接受焦点；不自动抢正文焦点。换书经过非 ready 时清除目录展开和旧反馈，重新 ready 默认收起；组件测试同时覆盖卸载/重挂及 source loading 到 ready。不得用重挂整个 ReaderChrome 或 renderer 的方式重置 UI。

备选：桌面侧栏/移动模态需要两套空间和焦点策略；本次选择跨端一致的限高内嵌区域，牺牲目录常驻能力换取明确的小范围交付。

### 3. flow 为统一分段控件

沿用两个 Pressable，统一外层底板与相邻分段、选中填充，保留 Scrolled/Paginated 可见文案、button role 与 selected/disabled 状态；保留 `Reading flow`、`Scrolled reading flow`、`Paginated reading flow` labels。提供 Web 可见键盘焦点和 native 按压反馈，缺 callback 保持 disabled，不用颜色作为唯一选中提示。

由 props 控制选中态，不更改 Web/native 引擎确认时序。`flowControlAvailable=false` 仍使用 `Reading flow status` 显示真实 scrolled/paginated，fixed 优先显示 `Fixed-layout publication`。不支持时不渲染可点但无效的选项。备选的菜单额外增加一次点击，当前仅两个模式，分段控件更直接。

### 4. 保持正文高度和滚动所有权

正文 minHeight 240 保留，ready chrome 的 `onLayout` 实测整体高度，加 240 作为根最小高度，使工具栏、展开目录和反馈换行都参与布局；短宿主由现有 Demo 外层 ScrollView 滚动到达正文，无需修改宿主或引擎。正常尺寸由正文 flex 占剩余空间，TOC 仅内部滚动。不得让隐藏 TOC 的条件分支改变 Web viewport ref 身份或重建 iframe/native WebView。

### 5. 可复现验收使用现有 Expo Demo

不提交截图临时外壳。apply 更新根 README、包 README 和 `docs/validation.md`，记录 Node 24、pnpm 10.0.0、浏览器要求和以下仓库根命令（来自当前脚本；本轮未执行运行验证）：

```sh
pnpm run foliate:submodule:bootstrap
pnpm install --frozen-lockfile
pnpm run foliate:submodule:check
pnpm run foliate:runtime:stage
pnpm run foliate:web-runtime:sync
pnpm run foliate:web-runtime:check
pnpm run dev:web
```

默认 Expo Web URL 为 `http://localhost:8081`，端口占用以 CLI 输出为准；使用 Chromium 验收渲染，Firefox 现有 fail-closed 路径不冒充成功阅读。既有 Playwright 使用导出站点 `http://127.0.0.1:8181`，继续由现有 webServer 启动。

Apply 实测补充：普通 LAN HTTP 缺少现有 probe 使用的安全上下文 `crypto.randomUUID`，会正确 fail closed。局域网交付使用 HTTPS，Demo Metro 可选读取 `READER_DEV_TLS_CERT` / `READER_DEV_TLS_KEY`，配合 `pnpm run dev:web --port 18738 --https`；访问端先信任本地证书。命令及证书生成见 `docs/validation.md`。不改 probe/CSP/引擎，也不使用不安全 origin 的浏览器例外；无 TLS 环境变量时原本地 HTTP/导出行为不变。

使用 `fixtures/epub/valid-epub3.epub`、`no-toc-spine.epub`、`fixtures/cbz/valid-fixed.cbz`、`fixtures/epub/malformed.epub`。新增 `fixtures/epub/reader-chrome-stress.epub` 确定性样本：超过 120 字符含连续长词的标题、至少 60 个目录项、至少三级层级、末项可跳转；接入现有 generator、manifest 和校验，不依赖截图中的商业书籍。不可切换 flow、unresolved/nonlinear 场景用既有组件样本验证，不向 Demo 暴露伪造引擎开关。

人工点检清单（apply 必须记录预期/实际及截图）：

1. Web 1440x900 和 390x844、320x640 打开 stress 样本；记录实际 reader 宽度，另外验证嵌入宽 320 的场景。标题省略且全名可访问，按钮不重叠，无 chrome 横向溢出。
2. 首次 ready 目录关闭；开关反复操作、键盘 Tab/Enter/Space 与屏幕阅读器 expanded 状态一致，关闭后不可聚焦隐藏项。
3. 展开长目录滚到末项，目录内滚动不叠压正文；激活末项后位置更新且目录仍开着，收起后位置不变。
4. 量测正文可见布局高度不低于 240；展开/收起与调整宽度不重建阅读会话，正文滚动或分页仍可操作。
5. 两种 flow 逐一切换，选中态等待实际确认；Previous/Next 仍按章节且首尾禁用。CBZ 显示 fixed 提示，不出现 reflow 控件。
6. 换书恢复默认收起；无目录样本无入口；malformed 报错后可再选有效书。通过组件测试核对不支持切换的真实 flow 状态与 unresolved 反馈。
7. 共用 chrome 的 native 组件测试覆盖两种布局与状态；可用 Android 环境补充触控滚动点检。iOS/Android bundle、组件测试和真实设备记录分别标注，不宣称已验证不可用平台。

### 6. 既有测试与公共契约

`ReaderChrome.test.tsx`、`NativeReader.web.test.tsx`、既有 `tests/e2e/foliate-reader.spec.ts` 所有目录导航用例先展开，再沿用原标签发现条目，保留既有成功/失败/边界断言。新增折叠状态、空目录、换书、legacy 与 neutral TOC、flow 和 viewport 稳定性覆盖；浏览器验证真实尺寸与滚动，mock 样式断言不能证明无叠压。包 README 记录默认折叠、新开关 label、完整旧 label 清单与导航/flow 语义，无公开类型变更。新增布局测量若影响现有 RN mock，只补足 mock 能力。

### 7. 旧 change 独立处理

`add-cross-platform-epub-reader` 显示 27/27 complete，但其 delta 仍声明 epubjs、EPUB-only、拒绝 fixed，与已归档 Foliate change 和当前主规格不一致。不必先归档才能 propose/apply 本 change；工程师必须显式选择 `polish-reader-chrome`。建议有权限的维护者另行审查历史记录后采用避免回写陈旧 delta 的归档方式；本轮不执行 archive/sync，也不把旧任务纳入本次任务列表。

## Risks / Trade-offs

- 嵌套 ScrollView 与短宿主可能导致正文被裁剪：以真实 Demo 宽窄尺寸、长目录末项滚动和 240 高度测量验证。
- 默认隐藏会影响旧测试：更新展开前置步骤，保留原业务断言和 label，不删除覆盖以迁就 UI。
- 布局分支可能导致 renderer 重挂：使用稳定子树/ref，浏览器检查会话、位置与 flow 连续性。
- 固定 160 目录限高会减少一次可见条目：保留独立滚动以保障正文空间。
- 既有 native 安全限制可能阻止真实阅读：如实记录 unsupported，组件布局和 bundle 不替代设备验证。

## Migration Plan

本 change 在 native-reader main（HAM-35 `45562da` 基线及其后继）实施，全部任务仅属于 UI/验收文档。保持导出类型与旧可访问标签；默认目录可见性是本次明确的行为变化。合入前运行相关组件回归、浏览器布局点检、类型/lint/格式和两端 bundle，记录环境局限；回退时整体回退本 change 的 UI、配套测试和文档，无数据迁移。历史 change 归档独立执行，不阻塞本变更。

## Open Questions

无阻塞性未决问题。680 分界已由 Chromium 实测确认；真实设备触控与屏幕阅读器语音结果须分别记录，不能由组件或浏览器属性推断。
