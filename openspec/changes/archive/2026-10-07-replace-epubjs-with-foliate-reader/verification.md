# OpenSpec implementation verification — 2026-10-16

> 以下为第一轮历史报告。最新第三轮为 29/45、剩余 16 项，见 `verification-round3.md`；第二轮随机 ID 与 package gate 修复记录见 `verification-round2.md`。下文的 numeric-ID / core-import 失败不再是当前状态。

Change: `2026-10-07-replace-epubjs-with-foliate-reader`。从 `archive/` 恢复至 active，原归档说明保留。使用安装的 OpenSpec 官方 `openspec-verify-change` 工作流模板核对 tasks、五份 delta specs、design 与实现；`openspec validate` 仅作为结构检查，未冒充实现验证。

**结论：不能归档或发布。** 23/45 项完成，22 项未完成；本轮完成 7.1–7.5，并撤销与当前代码不符的 3.4 勾选（初始为 19/45）。没有关闭 4A–4E 或 6.x，没有接入原生源 I/O/传输/渲染，也没有增加历史 iOS 豁免范围。

| 维度 | 判断 |
| --- | --- |
| 完整性 | 23/45；22 个未完成项逐项列于下表 |
| 正确性 | Web、本地构建与测试有新证据；native transfer/render 和真实平台证据缺失 |
| 一致性 | 原生 43 字符标识要求与 numeric generation/commandId 不符；3.4 导航契约与后续逐页实现不符 |

## 本轮实现

- 修复模型错误分类：只接受 own properties，`constructor`、`toString`、`__proto__` 不再进入合法错误类别（`packages/native-reader/src/bookModel.ts:117`），补回归测试。
- 修正 fixture 测试对进程 cwd 的依赖；删除旧引擎源码字符串断言，使用已有 Foliate 导航行为测试，并新增读取中/渲染等待时的超时、清理和迟到消息测试（`NativeReader.web.test.tsx:902`）。
- 将 Web E2E 更名为 Foliate，安装 Chromium+Firefox，使用完整 Chrome for Testing；新增六格式实际渲染/导航的大文件报告。新增 FB2/FBZ/MOBI/KF8 大样本，原 32 个 fixture 定义/字节 hash 全部不变。
- 修复 Demo Metro 目录别名在 iOS/Android 上意外解析 `index.web.ts` 的缺陷。现在按平台解析公开 source entry；两个 bundle 命令导出 source maps，并验证 native entry、capability/protocol、平台安全 WebView 与 ABI 模块存在，且 Web adapter 不存在。增加负向回归与 `test:native-export`。
- 修复隔离 pack 的两个实际阻塞：artifact 的创建误以共同父目录对 staging 做重叠判断；隔离 package 缺一层目录，导致 `../../tsconfig.base.json` 不可达。保留实际输出根隔离检查，增加继承 compiler settings 的回归断言。
- 更新 README、package README、fixtures、验证命令与设备证据模板。修正 lint 对 native export 生成物的扫描，移除两个 unused 声明；格式整理不重写生成 runtime/历史机器证据的 hash。

## 执行结果

环境：Linux、Node 24.15.0、pnpm 10.0.0；从新 checkout 执行固定依赖安装。Foliate pin 为 `78914aef4466eb960965702401634c2cb348e9b1`。

| 检查 | 结果与边界 |
| --- | --- |
| `foliate:submodule:bootstrap` + `pnpm install --frozen-lockfile` | 通过；原始 `git submodule update` 的 detached HEAD 被项目 gate 拒绝，按现有 bootstrap 正常修复 |
| `foliate:runtime:check`、Web sync/check/export manifest | 通过 |
| Library focused Jest | 23 suites、324 tests 通过 |
| Demo Jest | 2 suites、17 tests 通过 |
| `test:release-safety`（package gate 前置） | 7 个入口检查 + 88 个安全夹具通过；2 个平台条件 skip，不算 Windows 证明 |
| `fixtures:check` | 36 fixtures 的结构/字节/manifest 通过；包含固定 pin 的真实 Foliate parser 检查 |
| `node --test scripts/fixture-corpus.test.mjs` | 3 tests 通过；缺失/修改/多余/链接 fixture 负控通过 |
| `test:native-export` | 2 tests 通过：拒绝 Web fallback、缺 private host/module 与混入 Web reader |
| typecheck / lint / format:check | 通过 |
| `e2e:web --workers=2` | 35 passed、35 按浏览器适用范围 skipped；CFT Chromium + Firefox，含 runtime-asset abort/404 与六格式大文件；不代表 Edge/Safari |
| `bundle:ios` / `bundle:android` | 修复后的两个 export 和内容检查通过。早期仅退出码通过、实际是 Web graph 的产物不计为 native 证据 |
| `expo start --web` smoke | 端口 8182 的真实开发服务器从公开 picker 打开 FB2 到 ready；已关闭本轮启动的服务器 |
| `test:package` | **失败**：两个隔离目录缺陷修复后，ESM/CJS/declarations 已构建，随后 `stage-bundled-core.mjs:63` 报 `Core import was not found`。源树不变性检查通过，不能算 tarball/consumer 成功 |
| `openspec validate --all --strict --json` | 7 passed / 0 failed；只证明 artifact 结构 |
| 真实 iOS/Android/Edge/macOS Safari | 未执行；无 Xcode，ADB 无设备/AVD，当前无真实 Edge/Safari 环境 |

`test-results/large-fixture-smoke.json` 是此次实际测量附件的来源。每种格式约 1.08–1.26 MB，记录 source hash、字节数、open/navigation outcome 与耗时，所有六种均 ready/advanced。导航仅一次前进；KF8 仍是单 readable section，不能作为跨章证明。无性能阈值，无虚构内存数据。失败 input 保留 failureStage 并导致测试失败；原 host I/O-only 脚本保留为 `smoke:large:io`。

## CRITICAL：未完成项与解阻动作

以下每项都保持 unchecked，不把部分实现或环境不可用记成完成。

| Task | 当前阻塞 / 下一步 |
| --- | --- |
| 3.4 | NEEDS DECISION：当前 paginated Previous/Next 是逐页导航，和任务/设计的线性章节要求冲突；保留现有行为，撤销旧勾选。先对齐被批准的导航契约，再验收。 |
| 3.6 | BLOCKED：本地缺真实 branded Edge/macOS Safari；完整 package raw gate 失败。runtime-asset abort/404 E2E 与开发服务器 smoke 已通过，不代表整项完成。 |
| 4A.1 | BLOCKED：native host 已用 Foliate 骨架，但发布生命周期仍 staging 旧 core；需在原生门禁允许后完成替换并检验打包。 |
| 4A.2 | BLOCKED：有 asset host/受限根实现，当前无安装后的 Android/iOS 行为证明；补设备上的路径、MIME、未知资源拒绝矩阵。 |
| 4A.3 | BLOCKED：需安装后的 WebView 证明 exact-origin listener、干净 reload 和失败前零源 I/O。 |
| 4B.1 | BLOCKED / 实现偏差：generation 与 commandId 当前为 number，任务要求三种标识均为 43 字符随机 base64url；先统一 JS/Android/iOS parser 与 wire corpus。 |
| 4B.2 | BLOCKED：未收集安装后 Android final private-port 及无公开 fallback 行为证明。 |
| 4B.3 | BLOCKED：Linux 无 Xcode/WKWebView；缺 restricted-file identity、named world relay、synthetic initial-CSP 的实际证明。旧 iOS 豁免不记为通过。 |
| 4B.4 | BLOCKED：当前只有绑定骨架；保持 bind != ready、无 source I/O，完成前置协议一致性及平台验证后再关闭。 |
| 4B.5 | BLOCKED：JS 测试不等于双方平台 validator 行为；协议一致性与原生 reject/no-op/terminal 证明仍缺。 |
| 4B.6 | BLOCKED：需原生平台证明 navigation/popup/download/permission 拒绝不会经 RN callback 或备用 WebView 放行。 |
| 4C.1 | BLOCKED：4B pre-source 安全门未闭合，未接入 32 MiB 有界源准备；不得以 bind ack 授权源 I/O。 |
| 4C.2 | BLOCKED：依赖 4C.1；begin/chunk/commit/abort、连续序列与 SHA-256 传输尚未实现。 |
| 4D.1 | BLOCKED：依赖 4C；actual publication initial CSP 注入与真实 canary 证明尚未完成。 |
| 4D.2 | BLOCKED：原生未打开 Foliate publication，没有 ready/flow/render 链路；需 4A–4D.1 后实现。 |
| 4E.1 | BLOCKED：依赖未来 source/transfer/render；需补 AppState、abort、迟到回调和资源所有权的集成验收。 |
| 4E.2 | BLOCKED：无可用 iOS/Android device/AVD；ADB 列表为空，未声称平台行为通过。 |
| 6.1 | BLOCKED：按本次派工保留 4A/4D 顺序门禁；旧依赖、patch/lock 项仍在，不能记录为已移除。 |
| 6.2 | BLOCKED：旧 core staging 要求现已不存在的 core import，导致 package gate 失败；需与获准的旧引擎迁移一并替换 consumer/staging 断言。 |
| 6.3 | BLOCKED：隔离构建已能产出 ESM/CJS/declarations，但 pack 在旧 core stage 失败，未得到完整 tarball/consumer 证明。 |
| 6.4 | BLOCKED：6.1 未完成，无法通过“旧引擎完全缺席”的 regression gate；不能用 Foliate revision 检查替代。 |
| 7.6 | BLOCKED：本地 checks 的通过不能代替完整 clean-checkout release、package/consumer 及真实 Edge/Safari/原生平台门禁。 |

## 正确性与设计一致性

1. `packages/native-reader/src/nativeFoliateProtocol.ts:29` / `:30` 使用 numeric generation/commandId；spec 要求 session、generation、command ID 全部是 adapter 生成的 43 字符随机 base64url。该缺口属于 4B.1 实现，不能归因于“仅缺真机”。三端及 wire corpus 必须一起对齐后才能推进 transfer。
2. `packages/native-reader/src/NativeReader.web.tsx:1084` / `:1094` 在 paginated 模式发送 page-turn；design 决策 6 与任务 3.4 写的是按 readable linear section 导航。此行为来自本轮之前的提交。本轮保留用户现有交互，撤销不准确的 3.4 勾选，待明确契约后更新规范或实现。
3. `packages/native-reader/src/NativeReaderImplementation.native.tsx:183` 明确为 source-free 4B skeleton，`:369` 的 bind ack 只更新 bridgeBound。无 native transfer/open，不能将 JS 测试或 export 成功外推为原生 reader ready。
4. `packages/native-reader/scripts/stage-bundled-core.mjs:63` 的失败来自仍要求已退休 import 的发布链，与 OS/临时目录无关。未申请或虚构基础设施例外。完成 6.x 的顺序条件后应移除旧 core stage 并重跑完整 consumer gate。

## Requirement / scenario 对照

表中“部分”表示有明确实现/测试证据，但包含 native 或 release 条件，不能当整条 requirement 通过。被 REMOVED 的 7 条旧占位 requirement 不计入实现覆盖。

| Delta requirement | 实现与场景证据 / 缺口 |
| --- | --- |
| Demo consumes the public package | DemoApp.tsx 的 root import、package-boundary.test.ts、修复后的 Web/iOS/Android export；通过 workspace 入口，完整 packed consumer 仍阻塞。 |
| Supported-format document selection | DemoApp.test.tsx：多格式 hints、取消保留、源所有权、PDF 不宣传；通过。 |
| Deterministic multi-format fixture corpus | generate/verify-fixtures、fixture-corpus.test：36 项 checksum/recipe/licensing、篡改/缺失/链接负控；通过。 |
| Qualified automated acceptance evidence | 部分：Jest、CFT/Firefox、dev smoke、两平台 export 通过；真实平台与完整 package gate 未通过。 |
| Initial host and behavior-proven publication content security policies | Web differential probe、严格 inner CSP、script/network canary 有浏览器证据；native actual publication CSP 未实现。 |
| Layered Web acceptance evidence | 本报告区分 CFT/Firefox、dev、asset failures、package 与真实浏览器；release 未关闭。 |
| Publication navigation and network isolation | Web adversarial E2E 通过；native actual publication 场景未验证。 |
| Native pre-source gate and actual publication CSP | 部分 skeleton/preflight 实现与 JS gate 测试；缺真实 WK/installed Android 行为，actual publication policy 缺失。 |
| Native asset host and private authenticated bridge | 有 Android asset host、private port、iOS relay 实现；没有本轮实际原生行为证明，不能关闭相应场景。 |
| Authenticated iframe and native bridge messages | Web 错 origin/window/token/schema 与旧消息测试通过；native numeric IDs 偏差及平台 corpus 执行缺口仍在。 |
| Secure source schema, lifecycle, and source ownership | Web schema/替换/超时/迟到消息及 exact-once cleanup 通过；未来 native transfer/render 生命周期未完成。 |
| Bounded native source transfer | 未实现；保持 4B 拒绝 transfer namespace，不创建假 session。 |
| Official Foliate source is reproducibly pinned | verify-foliate-submodule 与 bootstrap；固定 SHA 校验通过。 |
| Retired EPUB engine artifacts are absent | 未满足：package.json、patches、consumer locks 和 stage-bundled-core 仍存在。 |
| Engine revision changes require explicit review | verify-foliate-submodule.mjs 与 supply-chain revision metadata；本轮未改 gitlink。 |
| Staged native runtime integrity represents the shipped package | 部分：runtime manifest check 通过；package 在旧 core stage 失败，未验证最终 shipped tarball。 |
| Supported local publication formats | 部分：Web 六格式实际 ready；native source/transfer/render 未实现。 |
| Format detection is content-aware | formatDetection.test.ts、NativeReader.web.test.tsx：误标签、PDF、结构损坏/DRM、真实 corpus；通过。 |
| Normalized publication navigation | Web 非绕回、TOC 与非法目标行为有测试；native 未实现，页/章契约另见 3.4。 |
| Mobile reflow flow preference and recovery | 未满足：Chrome 流控测试只证明组件行为，native scrolled/open/恢复未接通。 |
| Public reader package surface | types.contract/public-api、两平台 export 通过；完整 tarball/消费者缺证据。 |
| Controlled multi-format local source and load state | 部分：Web remote/PDF 拒绝、替换清理测试通过；native 32 MiB/transfer 路径未实现。 |
| Reader flow controls are observable and accessible | ReaderChrome.test、Web 公共按钮/TOC/flow E2E；native 无 ready publication。 |

覆盖核对范围：23 条有效 requirement、43 个 scenario。未执行真实设备、真实 Edge/Safari、成功 tarball/consumer；这些缺口已保留为阻塞，不能进入 archive/release。
