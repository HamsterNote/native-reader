# OpenSpec implementation verification — 2026-10-16 第三轮

按官方 `openspec-verify-change` 工作流复核 proposal、design、tasks、五份 delta specs、23 条有效 requirements 和 43 个 scenarios。`openspec validate` 只证明文档结构，不代替实现或平台验收。

**本轮限定的本地工作已交付；整个 change 仍不可归档或发布。** 勾选净增 **4**：3.4、6.1、6.2、6.4；**25/45 → 29/45，剩余 16 项**，没有撤销原勾选。4C/4D 未启动，没有原生 publication I/O、transfer 或 renderer 接入，也没有扩大历史 iOS 豁免。

| 维度 | 结论 |
| --- | --- |
| 完整性 | 本轮 9 个指定 task 中 4 个完成；4A.1/4B.4/4B.5 代码补齐但等平台证据；4E.1 只完成宿主生命周期；7.6 完成本地检查但等真实平台验收 |
| 正确性 | Web 章节契约、旧引擎移除、供应链负控、native 身份判定、本地 AppState 有自动化证据；Apple relay 修改没有 Xcode 执行证据 |
| 一致性 | 清除页/章导航偏差；JS、Java、Objective-C、native bootstrap 统一 strict scan → stale identity → current schema 顺序；仍保留 native 前置安全门 |

## 实现与验证边界

`NativeReader.web.tsx` 和 `ReaderChrome.tsx` 在 paginated/scrolled/fixed layout 下均以可读线性章节控制 Previous/Next。删除页级命令、页边界覆盖和独立计时器；章节跳转仍须匹配 relocation 与 acknowledgement。长章节、非线性条目、首尾禁用、TOC、flow 串行及当前位置保持都有测试。1280px 和 360px Chromium 用例验证实际章节文本；窄视口先滚动到 Demo 的阅读区域后检查可见性，不放宽渲染断言。

native 各端先认证 transport，再扫描有界严格 JSON，随后判定可证明的旧 session/generation/opposite direction，最后验证当前 schema。旧身份加坏 payload 是无副作用 no-op；重复键、blocked key、非法 JSON、超深数组和不安全整数不能借旧 token 绕过扫描。新增共享 `identityCases` 20 条，TS、逐字提取的生产 Java 协议类、native bootstrap 和 Apple/Android fault-matrix 均消费对应语料。Objective-C 的执行仍等 Xcode，不能凭代码或 JVM 通过声称跨平台已验收。

`NativeReaderImplementation.native.tsx` 在 AppState 进入后台时同步废弃旧 ledger/transport；回前台分配新身份。单个 React batch 内快速 background/active 也会重建，迟到 load/message/error 不会绑定新宿主。测试覆盖初始后台、订阅清理、source replacement 和 unmount。当前骨架没有 transfer/TOC/renderer；这些阶段的生命周期不能提前验证，4E.1 仍未勾选。

移除两种退休引擎的 workspace dependencies、override、patch、锁文件条目、独立 `stage-bundled-core.mjs` 和执行旧模板的 `nativeSecurity.test.ts`。原安全覆盖的承接位置是 Foliate wire corpus、adapter/gate tests、生成 bootstrap 行为测试、native fault matrices 和 staging/release safety；没有用旧 core 测试冒充 Foliate publication 安全证据。对旧隔离产物的所有权校验和安全清理仍保留，它们不解析、安装或生成旧引擎。

`verify-reader-supply-chain.mjs` 检查固定 gitlink/上游、project manifests/locks/patches/source、runtime exact-set/hash/revision，以及 npm/pnpm 消费者实际安装的同一 tarball 全树。历史 OpenSpec、精确 change-name 文档指针、明确列出的负向检查允许出现退休名称；允许列表中的检查文件仍禁止真正 import/require 退休引擎。负控注入旧依赖、patch、lock、import、payload、错误 revision、额外文件和错误 digest。

## 检查记录

环境：Linux、Node 24.15.0、pnpm 10.0.0、JDK 17，CFT Chromium 153.0.8010.12；Foliate pin 仍为 `78914aef4466eb960965702401634c2cb348e9b1`。

独立 detached worktree 从提交初始化，官方 submodule bootstrap 与 `pnpm install --frozen-lockfile` 成功。完整 package gate 的实现提交为 `6b04a0e`，最终完整浏览器回归在 `371810b` 执行。之后仅补正 Android 测试的双向语料投递、JVM 对应回归及其 integrity manifest，并整理报告；生产 package/runtime 实现字节未变。最终测试与 manifest 另跑 JVM、integrity 和 staging 检查，不声称重新执行了隔离 Robolectric。

| 检查 | 结果 |
| --- | --- |
| Clean install / submodule / fixtures | 冻结安装、固定 revision、36 个多格式 fixtures 和解析器结构校验通过 |
| Clean library + Demo Jest | 22 suites / 306 tests，加 Demo 2 suites / 17 tests，共 323 项通过；删除的旧 core 套件不计作 Foliate 覆盖 |
| Strict native protocol | 最终 JVM：48 raw cases、34 current malformed dispatches、20 identity cases、7 scenarios、4096-command 边界通过；bootstrap/runtime 5 项通过。均不冒充 WebView/WK 行为 |
| Supply-chain regression | 14 tests 通过，包括 submodule 错误 revision 和新扫描负控 |
| Release safety / secure staging / lifecycle | 7 个入口检查、88 个安全测试通过，2 个平台条件 skip；真实 staging、Codegen、失败恢复和清理通过 |
| Clean build / type / lint / format | 通过；consumer declarations 与原有 package entrypoints 保持 |
| Clean complete package gate | `pnpm --filter @hamster-note/native-reader run test:package` exit 0；npm/pnpm immutable consumers、条件入口、类型/运行时 smoke、runtime sync/check、tarball 负控通过；最终 package 源树摘要未变 |
| Android tarball consumer | 新架构 `:app:assembleDebug` 成功，124 tasks executed，APK 包含 secure host；仅构建证据 |
| Browser baseline / large smoke | 最终完整回归 **35 passed / 35 skipped**（平台条件），含 CFT 实际渲染、strict CSP canaries、无旧会话副作用、章节/TOC/flow、两个 runtime-asset-missing 用例与 Firefox zero-publication-I/O。大文件旧用例曾把单章节 KF8 当成有下一章并超时，已改为真实单章节边界断言，六格式报告通过 |
| Development server | 独立 checkout 运行 `expo start --web`，CFT 实际选择 EPUB 并观测 Chapter 1 of 3；宿主是 `/reader/reader.html`。服务与浏览器已关闭；额外 DevTools 的 SUID 启动错误不影响该成功的 Web 会话 |
| Clean iOS / Android exports | 两者成功，native graph 检查通过；不是 Xcode、installed WebView 或真机证据 |
| Android isolated Robolectric retry | **blocked**：只重试一次。新隔离缓存下载 Gradle 9.3.1，620 秒约到 40%；按 600 秒下载墙钟预算终止该次 Gradle 子进程。不是新的 socket ReadTimeout；没有进入 Robolectric task。隔离 wrapper 完成 finally 清理/不变性检查，自建目录已删除 |
| OpenSpec strict validation | 7/7，通过；apply 重新读取确认 29 complete / 16 remaining |
| Real Apple / Edge / Safari / devices | 未执行；没有启用 CI、没有发布或合并，没有新增平台豁免 |

上述完整 gate 验证的 tarball 为 333 文件，SHA-256 `6a4cec2fb838d0043cbb3041d73ae99c00b927b5d7926506613271d40fd789e5`。消费者实际消费同一摘要；它对应测试末次修正前的快照，不代表最终补丁重新打包后的摘要。临时 tarball/APK 已按原流程清理，交付补丁、报告和日志，不声称产物已发布。

## 16 个未完成项及下一步

每一行都是归档前的 CRITICAL 未完成项，不因本轮本地工作完成而改变其 checkbox。

| Task | 状态 | 关闭所需证据或实现 |
| --- | --- | --- |
| 3.6 | 等真实浏览器证据 | 本地 package、dev、asset-missing 已通过；仍需 branded Edge、macOS/iOS Safari |
| 4A.1 | 本地代码完成，等证据 | gate/component 测试不再 resolve/mock 旧 core；两平台 manifest-only host 的验收仍受 4A.2/4A.3 证据约束 |
| 4A.2 | 环境证据阻塞 | 实际资产请求的 exact manifest/path/Unicode/MIME 拒绝与 iOS 受限根 |
| 4A.3 | 环境证据阻塞 | installed Android WebView 的 listener proof → clean reload，以及失败前零 source I/O |
| 4B.2 | 环境证据阻塞 | 实际 Android final private port、main-frame/current-URL、无公开 fallback |
| 4B.3 | 环境证据阻塞 | 真 WK restricted-file tuple、named world、synthetic initial-CSP preflight |
| 4B.4 | 本地代码完成，等证据 | source-free bootstrap 行为通过；跨端完整 parity 仍等 Apple/Android 执行证据 |
| 4B.5 | 本地代码完成，等证据 | stale/schema 差异已修；Apple fault matrix 和完整隔离 Robolectric 未通过验收 |
| 4B.6 | 环境证据阻塞 | 实际 native navigation/popup/download/chooser/permission/scheme 拒绝 |
| 4C.1 | 顺序门禁锁定，未启动 | 4A/4B 关闭后才可接 32 MiB bounded source preparation |
| 4C.2 | 顺序门禁锁定，未启动 | 4C.1 后实现 contiguous chunks、length/digest、commit/abort |
| 4D.1 | 顺序门禁锁定，未启动 | transfer 后实现真实 publication 初始 CSP，并跑 canaries |
| 4D.2 | 顺序门禁锁定，未启动 | 前门通过后接 Foliate open/ready/model/location/flow |
| 4E.1 | 宿主部分完成，仍锁定 | 本轮 AppState/source/unmount 已测；transfer abort、late TOC/render 必须等 4C/4D 实现再集成验证 |
| 4E.2 | 环境与前置门禁阻塞 | 实际 iOS/Android 多格式 WebView 行为；bundle/APK 不替代 |
| 7.6 | 本地清单完成，等证据 | 真实 branded Edge/Safari、Apple/native 平台验收仍欠缺；没有全 release PASS 或基础设施豁免 |

剩余可分为 **11 项等待平台/验收证据**（包括本地实现已补齐的条目）和 **5 项被 native 顺序门禁锁定的实现/集成**（4C.1、4C.2、4D.1、4D.2、4E.1）。本轮指定范围内、不受门禁锁定的工作已完成；这不是对全仓库缺陷的穷尽审计。

## Requirements 与 scenarios 核对

| Requirement | 结论与证据定位 |
| --- | --- |
| Official Foliate source is reproducibly pinned | 通过；`verify-foliate-submodule.mjs`、clean bootstrap、负控 |
| Retired EPUB engine artifacts are absent | 通过生产依赖/patch/lock/runtime 与 tarball 检查；只保留明确拒绝签名及历史说明 |
| Engine revision changes require explicit review | 通过既有 revision-review metadata 和 submodule tests |
| Staged native runtime integrity represents the shipped package | 通过完整 package gate；`SECURE_WEBVIEW_SHA256.json` 与实际安装树一致 |
| Supported local publication formats | Web fixtures/CFT 通过；native renderer 未实现 |
| Format detection is content-aware | formatDetection/Jest 与 36 fixtures 通过；无 PDF renderer |
| Normalized publication navigation | 本轮修正为 readable linear sections；Web unit/CFT 长章节和单章节边界通过 |
| Mobile reflow flow preference and recovery | UI/type 有覆盖；native flow 尚未接入，未验收 |
| Initial host and behavior-proven publication content security policies | Web CSP/CFT 通过；native actual publication CSP 缺失 |
| Layered Web acceptance evidence | 自动化、dev/package 与真实平台明确分开；Edge/Safari 未验收 |
| Publication navigation and network isolation | Web canaries 通过；native publication 安全行为待实现和平台证据 |
| Native pre-source gate and actual publication CSP | source-free 骨架通过本地测试；真实 preflight 和 publication CSP 未验收 |
| Native asset host and private authenticated bridge | 现有 host/relay 代码、staging/JVM 有证据；实际平台未验收 |
| Authenticated iframe and native bridge messages | stale identity 顺序已统一；`nativeFoliateProtocol.test.ts`、共享 20 条身份语料；Apple 尚无执行结果 |
| Secure source schema, lifecycle, and source ownership | Web replacement/unmount 与 native AppState/source-free 生命周期通过；native transfer/render 尚缺 |
| Bounded native source transfer | 未实现，4C 不可提前启动 |
| Demo consumes the public package | package-root imports、clean export、消费者验证通过 |
| Supported-format document selection | Demo 17 tests，取消/所有权/候选格式/PDF 排除通过 |
| Deterministic multi-format fixture corpus | 36 fixtures、checksum/provenance/recipes 通过 |
| Qualified automated acceptance evidence | 每条命令分别记录；缺真实平台，不能整体验收 |
| Public reader package surface | npm/pnpm 所有条件入口、声明及 Android consumer 通过 |
| Controlled multi-format local source and load state | Web 和 native gate/source-free 测试通过；native opening 仍未实现 |
| Reader flow controls are observable and accessible | Chrome/Web accessible controls 通过；native flow 等 4D.2 |

WARNING：跨端 validator 的一致性目前只有代码、共享语料与 Linux 执行证据；Objective-C/XCTest 修改仍须在 Apple 环境编译执行。所有 native source/transfer/render scenarios 保持未覆盖状态，不拿 export 或 mock 替代。其余已实现 Web scenarios 由本轮 clean baseline、Jest 与生成 runtime 测试复核。

**自检结论：本轮本地包可审查；16 个 task 仍未完成，change 保持 active，不可归档/发布。**
