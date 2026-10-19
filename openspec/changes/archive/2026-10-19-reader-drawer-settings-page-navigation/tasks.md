# Tasks

本文件跟踪 apply 实施与验证。执行顺序为 1 → 2 → 3 → 4 → 5；每组附带本层验证，第 4 组负责跨层集成与真实浏览器证据。实际结果与平台证据边界见 verification.md。

## 1. Runtime 协议

- [x] 1.1 在 `scripts/stage-foliate-runtime.mjs` 与 `src/foliateWeb.ts` 将 iframe 协议升为 v2，新增封闭 page payload、page-state 与匹配 requestId 的 ack；验证 `stage-foliate-runtime.test.mjs` 覆盖合法 DTO、额外字段、错误方向/token/version 和陈旧 generation。
- [x] 1.2 将 runtime 翻页核心改为可等待操作，明确 Paginated 按页、Scrolled 顶部按钮直接跨相邻可读 linear 章节、fixed-layout 按页/spread，保留 scrolled 键盘/滚轮让位，Paginated 滚轮不发页命令且正文不位移；验证分页章内不跳章、Scrolled 双向跨章/首末禁用、RTL 与 no-op。
- [x] 1.3 增加引擎边界 helper 与递增 revision，分别从 paginator 分页几何、Scrolled 引擎已确认章节与可读邻章、fixed-layout 实际可见页/spread 投影，初始/relocate/TOC/flow/resize 时更新与失效；验证单章多页、首末中间页、单页、spread、RTL、nonlinear 和 resize，不以章节索引或 Promise 返回值假造分页边界。
- [x] 1.4 统一 page/navigate/flow/键盘分页的互斥，保留输入节流但禁止 host page 静默丢弃，竞争请求最多排队一个，增加 3000ms runtime 页操作 deadline、page-state+ack 完成和 terminal render-failure 清理；验证竞争、无 location 的边界 no-op、抛错、超时和 late completion 无副作用。
- [x] 1.5 扩展 `nativeFoliateProtocol.ts`、`scripts/native-host-bootstrap.mjs`、Android 严格协议验证器与 Apple `HNSecureFoliateHostRelay.m`：保持外层 host v1，新增 page/page-state、commandId→requestId 映射及 applied ack；扩展 `secure-webview/foliate-host-wire-corpus.v1.json`，验证 TS/JVM corpus 一致、额外字段拒绝、重复/在飞账本规则与 source gate 无退化，Apple 未执行的行为证据单列。
- [x] 1.6 重新生成 Web/native runtime、manifest/hash 并同步 Demo/consumer 资产，覆盖内部 renderer envelope 的所有硬编码 v1；运行 `pnpm run foliate:runtime:stage`、`foliate:web-runtime:sync`、`foliate:runtime:check`、`foliate:web-runtime:check`、`test:foliate-runtime`、`test:foliate-web-runtime`，确认生成差异仅为配套产物。

## 2. 适配器（Web/native）

- [x] 2.1 在 `NativeReader.web.tsx` 扩展严格 event parser、page 请求、pending/requestId/revision 状态与固定 5000ms 页命令 timer；只有匹配状态+ack 才完成；验证 Web 适配器测试覆盖章内 index 不变、旧 ack/state、错误 origin/window、边界 no-op、load timeout 为 0 时页命令仍超时终止。
- [x] 2.2 在 `nativeReaderSession.ts` 扩展 snapshot 的真实边界和 page 方法，匹配外层 commandId、page-state 与 applied ack，接入独立 5000ms deadline；验证 native session 测试覆盖 source replacement、未知边界、no-op、并发 flow/page、terminal cleanup 与 late message。
- [x] 2.3 将 Web 与 `NativeReaderImplementation.native.tsx` 顶部回调由 spine ±1/step 改为 page 命令，向 chrome 传 canGoPrevious/canGoNext/navigationPending 与 session identity；验证单章多页不被禁用、currentIndex 仅显示章节位置、ready→ready 换书重置，公共导出和类型检查无变化。
- [x] 2.4 为 TOC 导航提供内部可等待成功/可恢复失败结果，保持 navigate 只做目录定位，协调 applied flow 更新与 UI pending；验证成功回执后才收 drawer，失败保位置并反馈、unresolved 不发命令，以及 controlled/uncontrolled flow 均不产生未生效的 selected 状态。

## 3. Chrome UI

- [x] 3.1 在共享 `ReaderChrome.tsx` 实现 closed/drawer/settings 单活动层，Web reader 根内自建 overlay、native 平台 Modal，左上 icon、drawer 内设置 icon、关闭按钮与独立 TOC 滚动区；验证组件测试覆盖中立/旧目录优先级、空目录仍可到设置、有效/无效跳转、session/非 ready 重置且 renderer 不重挂载。
- [x] 3.2 Web 保留自建 dialog、Tab/Shift+Tab/focusin、Escape/背板关闭和还焦及 inert/ARIA/iframe 隔离；先实测 ReactModalHostView/平台 Dialog 与 HNSecureWebView 的本地容器兼容性，再将 native 接入 Modal、onRequestClose、读屏隔离和标题/返回入口的 AccessibilityInfo 焦点。不写 native 焦点组件，不声称硬件键盘包含；组件测试验证接线，native 标设备未验证，本地容器不兼容则记录实际局限。
- [x] 3.3 将 flow 区域完整移入 settings，保留 Reading flow 三组标签、已应用 selected、无 callback disabled、不可切换 status 和 fixed-layout notice；验证所有分支及等待 ack/设置重开状态的组件测试，不能在 toolbar 暴露重复 flow 控件。
- [x] 3.4 将箭头名称/tooltip 改为 Previous page/Next page，以真实边界、未知和 pending 驱动 disabled 与 Page navigation status；保留 Chapter N of M，验证首末真实状态、章内页和 unknown/pending 的区别，替换所有 chrome 章节按钮契约断言。
- [x] 3.5 实现 >=680 单行、<680 两行、44x44 点击区、标题省略和位置换行；chromeHeight 只量常驻内容，ready 根 minHeight=max(320,240+chromeHeight)，overlay 不改变底层 240 最小视口及 renderer identity。用 Chromium 测量并消除顶栏与正文间空状态行/引擎默认 margin，保留书籍样式；记录改前后 chrome 高、正文高和顶栏到首行距离。

## 4. 测试与 E2E

- [x] 4.1 迁移 `ReaderChrome.test.tsx`、`NativeReader.web.test.tsx`、native session/protocol、`tests/e2e/foliate-reader.spec.ts`、`native-foliate-runtime.spec.ts` 的旧标签和直接操作 flow 路径，更新为先打开 drawer/settings；保留独立 TOC 章节定位断言，运行相关测试验证 Previous/Next chapter 无残留行为依赖。
- [x] 4.2 在真实 Chromium committed Demo 验证 drawer→settings→drawer→toolbar 的完整焦点路径、Tab 循环、Escape/背板/关闭、ARIA 隔离、iframe 点击/键盘/滚轮无响应与 source replacement 清理；保存 activeElement/ARIA 及交互记录与截图，jest mock 测试仅作为组件证据。
- [x] 4.3 用确定性 stress fixture 测 1440/390/320 viewport、嵌入 320 reader、679/680 分界和短高度，分别截图 toolbar/drawer/settings；断言 dialog 在 reader 内、无横向溢出/重叠、44x44、长 flow/状态文本可读、TOC 最后条目可达、overlay 开关前后底层 viewport 高度相同且至少 240。
- [x] 4.4 使用可再生单章多页、多章长文、固定版式/RTL fixtures 并记录 provenance/checksum，E2E 覆盖 Paginated 章内前后翻与滚轮零位移、Scrolled 按钮直接跨章/单章双向禁用、首末 no-wrap、TOC/flow/resize 后边界及原生 scrolled 键盘/滚轮；保留输入串行化、一个竞争者与溢出终止断言。
- [x] 4.5 集成验证 page 与 TOC/flow/键盘并发、无移动 ack、stale revision/requestId/generation、renderer exception、3000/5000ms 超时与不自动重试；运行 runtime、Web/native session 和 native-host E2E，确认错误收敛和资源仅清理一次。
- [x] 4.6 运行完整 `pnpm run verify`、`e2e:web` 及 iOS/Android bundle/export 检查，记录实际执行结果与未执行项；Firefox fail-closed、source/bridge 安全 gate 不退化，构建证据不声称真实设备或 Safari/Edge 行为成功。

## 5. 文档与验收脚本

- [x] 5.1 更新根 `README.md` 与 `packages/native-reader/README.md` 的 committed Demo 启动、样本和操作清单，明确 page labels、Scrolled 章节步进、Paginated 滚轮无位移、抽屉关闭规则、空目录设置入口、680/44/240 基线；列清 setup 命令、URL、fixture 与预期结果。
- [x] 5.2 更新相关 runtime/E2E 验收脚本的命令白名单、v2 期望和截图/geometry 收集，保留 manifest 校验与 native host v1 配套说明；执行两个 runtime check 与文档指向的验收入口，确认不依赖私有书籍或临时 UI 外壳。
- [x] 5.3 汇总 spec 场景到证据清单，区分通过、失败、未执行和已有授权 waiver，标记 native 设备未验证；复核 proposal/design/specs/tasks 一致并运行 `openspec validate reader-drawer-settings-page-navigation --strict`，沿用 tmux/19452 服务交人工验收，不提交、不推送、不开 PR、不归档。
