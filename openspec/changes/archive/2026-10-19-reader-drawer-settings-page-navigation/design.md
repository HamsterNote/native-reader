# Design

## Context

动机见 proposal.md。基线是 `HamsterNote/native-reader` `main` `d1433e9`；以归档后 `openspec/specs/reader-component-api` 和 `cross-platform-reader-demo` 为准。旧 `polish-reader-chrome` 已在 `archive/2026-10-18-polish-reader-chrome/`，不修改其历史记录。

已核对：`ReaderChrome.tsx` 的 TOC 是正文前 maxHeight 160 的 ScrollView；根以 `max(320, 240 + chromeHeight)` 保证正文高度，680 以下紧凑。Web 的顶部回调将 spine 索引 ±1，native 的 `step(±1)` 同样逐章。生成脚本中的 `turnPage()` 调 renderer.next/prev，但返回的是是否接收请求，不是移动结果；键盘与滚轮在 scrolled 时直接让位。生成的 paginator 在 scrolled 使用 start/end/viewSize，在 paginated 暴露 atStart/atEnd；fixed-layout 是 spread/side 导航，不能直接套 paginator 页数。

iframe 协议 v1 白名单没有翻页，Web DTO 严格封闭；native 另有 `hn-foliate-host` v1 封闭协议、命令账本和 private relay。`scripts/native-host-bootstrap.mjs` 将内部 location 转成 native section/destination，并将命令 ack 映射为 applied。必须贯穿这些层改动，不能只改按钮。

仓库没有 Modal/Drawer 先例。apply 已确认 RN 0.86.3 默认关闭 `enableImperativeFocus` / `enableKeyEvents`，因此 native 不能依靠普通 View.focus 或 JS 键盘事件兑现焦点包含。按协调评论 `01a14ef5-2c82-7edf-84c9-cc4b23358930`，Web 保留自建层，native 改用平台 Modal；先验证与 HNSecureWebView 的本地容器兼容性，设备行为继续标未验证，不新增 native 焦点组件。

## Goals / Non-Goals

**Goals:** 保留同一个 renderer 子树，明确覆盖层状态、焦点所有权和页级状态来源；让协议工作先于适配器、UI 和验收实施。

**Non-Goals:** 不增加书架、搜索、批注、主题、持久化、公共 drawer 控制 props；不更换 Foliate 或扩大格式支持；不放宽 CSP、来源认证、native gate、32 MiB 限制或已有平台验收边界。本轮不提交、推送、开 PR 或归档。

## Decisions

### 1. 显式替代旧 design 决策 2：覆盖式左侧抽屉

旧决策选择「限高内嵌目录、不采用覆盖式抽屉」，用来避免焦点陷阱和遮住 iframe。用户本次明确指定左侧 drawer，因此本设计替代该结论，并同时替换主规格的“不遮挡正文”和“成功跳转后保持展开”条款；归档历史仍保留原结论的时间背景。

Web 采用 reader 根内绝对定位的自建覆盖层，不依赖 RNW Modal portal。常驻布局为背景组（toolbar、反馈、viewport）及其同级 overlay；只切换 overlay，不能换 key、重新挂载 iframe 或将 overlay 放入会被 inert 的背景组。drawer 从 reader 左边缘展开，覆盖 reader 全高度，宽 `min(320, readerWidth - 32)`；背板铺满 reader，遮挡有意且暂时存在。打开期间正文保持渲染和位置但不可交互，用户不能边阅读边让 drawer 长期钉在正文上；有显式关闭按钮，成功 TOC 导航后自动关闭，无定时自动关闭。

Web drawer 是有名称的 `role=dialog`、`aria-modal=true`，名称 `Reader contents`，内部 TOC 仍为 `Table of contents`。保存触发按钮 ref，先把焦点移到 `Close table of contents`，再隔离背景组；Tab/Shift+Tab 在当前 dialog 可聚焦元素内循环，focusin 守卫将意外逸出焦点拉回。背景组使用 DOM `inert` 和 `aria-hidden=true`，同时关闭 pointer events；iframe 位于该组，不能被点击、Tab、屏幕阅读器或 iframe 原有键盘处理继续操作。仅 aria-hidden 或仅背板不足以隔离 iframe。Escape、点击背板、关闭按钮均关闭并解除隔离，焦点回 `Toggle table of contents`；不把祖先或当前焦点所在节点先设 aria-hidden。卸载时清理监听、恢复原属性。

Native 使用同一 closed/drawer/settings 状态机，但采用 RN `Modal` 的平台容器（iOS 模态 VC / Android Dialog）而非 JS 焦点边界。Modal 是独立平台窗口，背板覆盖宿主窗口，不承诺嵌入 reader 根内裁切；面板宽度受 reader 和 Modal 可用宽度约束，高度受 Modal 窗口约束。背景 renderer 始终留在原有父节点，不移动到 Modal、不改 key。`onRequestClose` 关闭最上层，保留背板、显式关闭及 accessibility escape；内容设 `accessibilityViewIsModal`，背景设 `accessibilityElementsHidden` / `importantForAccessibility=no-hide-descendants` 并禁用触摸。`onShow` 后通过 AccessibilityInfo 将读屏焦点移到标题；设置返回抽屉时回到设置入口，关闭后在平台 dismissal 后还到 toolbar 入口。读屏焦点不等同键盘焦点；native 不声称硬件键盘焦点包含，不开启 RN 私有开关。

先用真实 ReactModalHostView / HNSecureWebView 的 Android 本地容器测试验证挂载、平台返回键回调与背景实例保留，再接入共享 chrome。Robolectric 的 WebView 不执行真实引擎，组件 mock 仅证明 props/回调接线。无连接设备、无 AVD 且 KVM 不可用；Android/iOS 屏幕阅读器、设备上的 Modal 展示及真实 WebView 会话仍为「设备未验证」。若本地容器测试失败，记录实际现象并采用已授权的「已记录局限」版本，不转写 native 焦点组件。

正常关闭恢复 opener；source/session 改变、ready 退出到 loading/error/idle 时立即关闭所有层、清除 TOC 反馈并解除隔离。若 opener 已卸载，聚焦新状态标题或 reader 根，不能把焦点交给旧 iframe。ready→ready 替换也按 session identity 重置，不能只依赖 state.status。

备选：保留内嵌 TOC 不满足本次需求；常驻推挤侧栏挤占 320 宽正文；native 自建键盘焦点组件超出本次裁决范围。Web 自建层必须在真实浏览器验证，不把 jest mock 或 native 构建当作验证结果。

### 2. 抽屉和设置使用单一活动 dialog

状态为 closed / drawer / settings，settings 保留 drawer 返回上下文。点击 drawer 的 `Reader settings` icon 按钮后，drawer 内容退出可访问树，设置 dialog 成为唯一活动层；Web 焦点到 `Close reader settings`，native 读屏焦点到设置标题。Web Escape、native onRequestClose、背板/按钮关闭设置后回 drawer，并将对应平台的焦点返回设置按钮；再关闭 drawer 回 toolbar 开关。native 同一 Modal 内切换内容，不叠两个平台窗口。成功 TOC 导航以当前命令成功回执为准关闭；请求中禁用重复条目操作，unresolved 不发送命令，失败保持 drawer 与 `Table of contents feedback`，不宣称成功。

空目录时仍保留左上入口（同一 `Toggle table of contents` label），drawer 包含设置入口，但不输出空的 `Table of contents` 区域；这是从旧“无 TOC 则无 toggle”的显式变更，避免没有目录的书无法调整 flow。中立 toc 优先于旧 model.toc，显式空中立目录不得回退旧目录。顺序、层级、nonlinear/unresolved 标签不变。

设置 dialog 名称 `Reader settings`，Web 宽 `min(360, readerWidth - 32)`、maxHeight 为 reader 可用高减 32，16 内边距，内容独立纵向滚动；Web 背板属于 reader 而非浏览器 window。native 内容宽度另受 Modal 窗口宽度约束，高度以平台窗口测量值为准。文本可换行，flow 分段控件 flex 收缩、标签完整可读，320 容器内仍保持每项至少 44 高，不得产生水平滚动。390/320 浏览器视窗会形成更窄 reader（基线 Demo 曾为 352/282），必须连同真正嵌入 320 一并验收 Web dialog 不出 reader 边界。

把现有 flow 呈现原样移入设置：`Reading flow`、`Scrolled reading flow`、`Paginated reading flow` 和 selected/disabled/focus 语义保留；只有收到引擎 applied-flow 及 ack 后才改变 selection。`flowControlAvailable=false` 输出非交互 `Reading flow status`，fixed-layout 仅 `Fixed-layout publication` 提示且不输出 reflow selector/status，无 callback 则选项 disabled。关闭/重开设置不重置 appliedFlow；控制型 flow 仍经过宿主既有回调和命令确认。

备选：设置叠在可交互 drawer 上会产生双模态与焦点返回歧义；工具栏保留 flow 不符合需求。

### 3. 常驻布局和最小高度

目录 icon 位于最左，之后是单行省略标题（完整可访问名称），再为导航组：上一页箭头、`Chapter N of M`、下一页箭头。>=680 同一行，<680 第一行目录 icon+标题、第二行导航；flow 不占常驻第三行，设置只在 drawer。icon 按钮使用跨平台图标（优先仓库既有图标依赖），点击区固定 44x44，Web 有 tooltip/title 与可见焦点；位置文本可换行以适配大章节数，不伪造全书页码。

`chromeHeight` 仅量常驻 toolbar 与正常布局反馈，移除内嵌 TOC 后不含 overlay。ready 根最小高继续为 `max(320, chromeHeight + 240)`，loading 根至少 320 且正文 minHeight 240；正文 flex:1、flexShrink:0。首次测量前保留保守高度，测量后更新但不通过换 key 重建正文。Web overlay 以最终 reader 尺寸定位；native 使用前述平台窗口尺寸。打开/关闭不改变 chromeHeight 或正文占用高度。240 指底层 viewport 的布局高度；模态期间有意遮挡且隔离，关闭后恢复原视口，不能继续沿用旧“打开目录时正文无遮挡”的承诺。

### 4. 顶部按钮单位和真实边界

布局验收修订：真实 Chromium 测得正常状态空行来自 chrome 固定 40px 状态区和 Foliate 默认 48px margin，而非已移走的目录。移除空行，将 live status 放进顶栏下侧既有 12px padding，保持忙碌/未知提示可见且不改变布局高度。通过公开 renderer margin 属性设 0，保留书籍自身标题/段落样式；记录宽/窄屏 chrome、正文和首行文字坐标对比。

两个箭头的 accessible label / Web tooltip 改为 `Previous page`、`Next page`。Paginated 一次推进一个 renderer 页/当前 spread 步，章内未结束不跳章节，章末才进入相邻 linear section。根据本轮人工验收反馈，Scrolled 顶部按钮直接调用 renderer.nextSection/prevSection，跨到相邻可读 linear section，不论当前滚动位置；首章/末章禁用，单章两方向均禁用。此裁决替代原先按视口滚动的决策。Scrolled 的键盘与滚轮仍保留原生滚动。Paginated 滚轮不发翻页请求，沿用分页渲染器在文档与容器的 overflow:hidden 阻止滚轮位移；键盘分页保持。fixed-layout 使用 renderer 的页/spread 原生推进，flow 设置仍不可用；RTL 方向由 renderer 处理。`navigate` 继续负责 TOC 定位。

共享 chrome 新增内部 `canGoPrevious: boolean | null`、`canGoNext: boolean | null`、`navigationPending` props；null 表示边界尚未确认，禁用并通过 `Page navigation status` 显示暂不可用，不等同首末页。chrome/adapter 不从 currentIndex 推导 disabled，只消费 runtime 确认的状态；初始、换书、flow/resize 重排期间边界清空，获取最新引擎状态后才恢复。忙碌期间两个按钮暂时 disabled，与真正到边界分开表达。

runtime 边界 helper：paginated 用 renderer atStart/atEnd，fixed-layout 用实际可见页/side、renderer.index/getSpreadOf 与 sections 阅读顺序；禁止用章节位置假造分页首末边界。Scrolled 的单位明确为章节，使用引擎 relocate 确认的 currentIndex 与 book.sections 的 linear 标志计算双向可读邻章；不能套分页 getter 或滚动位置。观测不足回 null 并如实禁用，恢复后启用。非线性 TOC 仍可定位，随后按钮按引擎 linear 规则跳过不可读邻章。

在 ready、relocate（包括原生滚动/键盘/滚轮）、TOC 完成、flow 完成、resize 稳定后发布边界；重排开始立即使旧边界失效。首/末边界收到命令也安全 no-op，不 wrap，不超范围加载。Paginated 单章多页书必须能前后翻页；Scrolled 单章保持双向章节按钮禁用而允许原生滚动。

分页仍拒绝章节级禁用；Scrolled 则按本轮验收采用章节边界。直接用 turnPage 的布尔返回值、location fraction 或 renderer.next 返回值判断分页边界均不可靠。

### 5. 翻页 wire contract、回执和失败

iframe 内部协议 `FOLIATE_IFRAME_PROTOCOL_VERSION` 从 1 升为 2，生成脚本、`foliateWeb.ts`、Web adapter、native host 内部 renderer envelope 一起更新。新命令 `page` 的封闭 payload 是 `{ direction: 'previous' | 'next', requestId: <43-character base64url token> }`，外层继续带 type/protocolVersion/session/generation 并校验 origin/window。新增 `page-state` 事件带 `{ revision: <safe non-negative integer>, canGoPrevious: boolean|null, canGoNext: boolean|null, requestId: token|null }`；revision 在每个 session 单调增加，非命令更新 requestId=null。新增 page ack 形态为 `{ command:'page', requestId }`，其余命令 ack 形态不变，校验器以 command 判别字段，不接受额外字段。

host 页请求生成 requestId，保存 pending 并立即禁用重复请求。runtime 统一序列化 page/navigate/flow 与键盘分页；将 turnPage 改为可等待的核心操作，去掉对 host 页命令的静默节流丢弃，键盘保留 150ms 输入节流。滚轮不进入操作队列。正常完成发布 location（移动时），然后发布同 requestId 的最新 page-state，最后 ack；边界 no-op 无需 location，但必须回 page-state+ack。host 只有收到匹配 requestId 的状态和 ack 才清 pending；不得等 location 索引变化，因为章内页可能索引不变。普通 page-state 按 revision 更新显示但不完成 pending；旧 revision 不覆盖新边界，旧 session/generation/requestId 不能清 timer 或更新宿主。

runtime 页命令最多 3000ms，包括 renderer promise 和稳定位置/布局采样；host 页命令独立固定 5000ms（不沿用可设为 0 的 load timeout），无轮询重试。忙碌时 host 不发送新请求；runtime 对通过认证但与现有 renderer 操作竞争的 page 请求排队一个，超出上限按现有稳定 render 错误终止，不能无回执丢弃。renderer 抛错、超时、状态与 ack 无法对应时走 `terminalFailure(...,'render-failure')` 并 dispose；Web adapter 转现有 render 类错误，native 发 terminal render-failure，清 pending/timer/边界并拆掉当前 channel/session，不自动重开同一 source。旧上下文、generation、origin 消息仍无副作用忽略；当前受认证 malformed DTO 按既有 fail-closed 规则处置。

native 外层保持规范指定 `hn-foliate-host` v1，扩展封闭集合而非改开放字段：新增 `page` payload `{direction}`，adapter 生成的外层 commandId 映射到内部 page requestId，host bootstrap 转发 renderer 时显式加入 requestId；新增 host `page-state` payload `{revision,canGoPrevious,canGoNext}`，事件 envelope 的 commandId 在命令完成时为对应命令 ID，非命令状态沿用 `binding.lastCommandId`，host 不另造 token。page 的 ack 为 `{command:'page',status:'applied'}`。native host 先转发状态再 ack，session 只有匹配 pending 命令的状态+ack 才完成；与 pending 对应的 page-state 必须来自内部匹配 requestId 的事件，普通重排状态不能充当完成回执。同步 TS、Android/Apple 验证器、账本和共享 wire corpus，v1 不意味着旧资产可混用；runtime manifest/hash 校验和一次完整打包保证配套更新，旧未知 type 继续拒绝。传输、source authorization、ABI 和 publication-model DTO 均不改变。

备选：复用 navigate 或模拟键盘事件无法明确 Scrolled 语义、命令成功与边界；仅 location 回执会让边界 no-op 超时；不升级 iframe 版本会让旧封闭事件 schema 与新页面状态混用。

### 6. 验收证据与契约迁移

更新 `ReaderChrome.test.tsx`、`NativeReader.web.test.tsx`、native session/protocol 测试、`scripts/stage-foliate-runtime.test.mjs`、`sync-foliate-web-runtime.test.mjs`、`tests/e2e/foliate-reader.spec.ts` 和 `native-foliate-runtime.spec.ts` 中旧标签与 flow 直接可见假设。章节进度测试保留：Paginated 经过足够页数跨章，Scrolled 直接步进章节；键盘测试保留，滚轮测试改为证明 Paginated 零位移、Scrolled 原生滚动。runtime 修改必须重新 stage Web/native、sync Demo/consumer、更新 manifest/hash，并运行 check。

自建 overlay 的 DOM 焦点、Tab 循环、Escape、还焦、iframe 无法点击或键入，在真实 Chromium Demo 中验证；jest 用来验证状态/事件，不用它证明 portal 或 inert 的浏览器行为。捕获 activeElement、点击/键盘位置不变、ARIA 树与截图/geometry，检查 1440/390/320 viewport、嵌入 320、679/680 分界。最小 240 高在打开/关闭时均测底层 viewport；设置内 flow 成功/无 callback/不可用/固定版式都覆盖。native 仅按现有安全 gate 能力验证，明确组件/本地协议证据与真实设备证据区别，不扩展旧 waiver 的适用范围。

## Risks / Trade-offs

- 自建焦点管理遗漏 iframe 或宿主焦点 → inert/aria-hidden/指针隔离、焦点循环与真实浏览器负向操作联合验证，失败不得交付为可用模态。
- 固定版式 spread 和 scrolled 边界与章节索引不同 → 单独 helper 与确定性多页/单章/RTL/resize fixture；观测不足时显示暂不可用，不假造边界。
- v1 native 封闭 schema 扩展有资产配套要求 → 全部验证器与 corpus 同批更新，stage/check/hash gate 防止混用，保持 unknown-field 拒绝。
- 抽屉打开有意遮住正文 → 只允许模态阻断交互，成功导航自动收起；不会提供固定展开阅读模式。
- 浏览器环境与 jest 行为差异 → 使用真实浏览器验证；native 组件/容器测试不代表设备读屏和真实 WebView 已验证。

## Migration Plan

按 tasks 的五组顺序实施；先完成协议与生成资产，再让两侧适配器传真实边界，最后接 UI。同步迁移 accessible labels、打开 settings 后操作 flow 的自动化路径和文档；不保留旧 chapter label 别名来掩盖行为变更。完成所有要求的本地验证后再提交实施结果。回滚必须将协议、host 验证器、runtime manifest、适配器和 UI 作为同一版本回滚到基线，不能只回滚生成资产。

## Open Questions

无阻塞性产品问题。实际命令结果、浏览器截图及设备未验证项目记录于 `verification.md`；本轮等待人工验收，不归档。
