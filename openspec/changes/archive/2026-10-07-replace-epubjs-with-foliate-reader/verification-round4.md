# OpenSpec implementation verification — HAM-35 / 2026-10-16

验证对象：`2026-10-07-replace-epubjs-with-foliate-reader`，本轮实现提交 `d1b50ba`、`4a0fc10`，验收脚本修复 `819a213`，基线 `d082f8e539a221b631f34974160d5fdecdf1cfb5`。按完整性、正确性和一致性复核 proposal/design/tasks、五份 delta specs、24 条有效 requirements 和 44 个 scenarios。`openspec validate` 只验证文档结构，不替代实现证据。

授权来源：HAM-35 所有者修勾，2026-10-16；原评论 `01a14506-b079-70fc-8e3c-824e7e47d27b`，派工 `01a14508-6b02-7d14-b8ce-38b0bbd79005`。验收调整为 Web/local，设备行为与无法取得的 Safari 证据 waived/removed，不记为通过。完整边界见 `OWNER_WAIVERS.md`。

## 最终状态与勾选净变化

原 45 项按新授权分为 **39 completed + 6 waived/removed**。OpenSpec 有效任务
**39/39，remaining 0**。原已勾选 29 项全部保留，本轮净增 **10**：3.6、4A.1、
4B.4、4B.5、4C.1、4C.2、4D.1、4D.2、4E.1、7.6。没有将豁免项打勾。

| Disposition | 条目/范围 |
| --- | --- |
| 完整条目 waived/removed | 4A.2、4A.3、4B.2、4B.3、4B.6、4E.2 |
| 混合项局部 waived | 4B.4/4B.5/4C/4D/4E.1 中的设备执行证据；WK named-world/restricted-file/initial-CSP 专属集成 |
| 环境证据 waived | 真实 macOS/iOS Safari、Android/iOS 真机行为、独立 Robolectric、Apple XCTest/Xcode 原生验收 |
| 仍未完成的本地范围 | 无 |

## 本轮实现

- `nativeSource.ts` 在 gate 之前不访问 source getter；拒绝远程、混淆 URI、未知/非正/超过 32 MiB 的 size。以 bounded position/length 读取，按内容检测并复核实际传输快照；不复制或删除 host URI。Expo Crypto 提供 native entropy 和 SHA-256，无伪随机后备。
- `nativePublicationTransfer.ts` 强制 canonical metadata、48 KiB chunk、最多 683 chunk、连续序号、精确长度和 SHA-256。late digest、abort、dispose、过期身份、重复/乱序/坏 base64 均有负控；精确 32 MiB 边界实际传输验证。
- adapter → `bind` → `probe` → bounded read → `begin/chunk/commit` → 实际 renderer ready。外层 host/内层 transfer identity 相等，所有消息只经过私有通道；顶层 transfer namespace 仍拒绝。JS/Java/Objective-C schema 与共享语料同步；Apple 未执行。
- `nativeReaderSession.ts` 串行 command/ack、导航错误保留位置、flow 更新不重读源、超时、AppState/source/unmount retire 原通道、缓冲清理和迟到回调隔离。generated native bootstrap 使用私有 MessagePort 与 lexical renderer event sink，复用 Web 的实际 Foliate/CSP 路径。
- 浏览器实测发现并修复 CBZ SVG blob 缺 MIME 导致零尺寸正文的问题；同一 spread 内切换现在更新 side 并发送真实 relocate。CSP 没有放宽。安全断言区分 CSP 拒绝的 request attempt 与真正 response，要求恶意资源全部以 `csp` 失败且无响应。
- iOS bundle manifest、实际读取 allowlist、staging integrity、packed verifier 和 npm/pnpm/Android frozen consumer fixtures 包含四个新增私有模块及 Expo Crypto 依赖。未恢复旧引擎或暴露新包 subpath。

- 原生导出图实际发现 `nativeReaderSession` 通过模型校验引入 Web adapter。将闭合 DTO 的类型/校验/normalization 提取到 `publicationModelDto.ts`，保留 Web re-export；原导出拒绝 Web 模块的检查没有放宽，两端导出重跑通过。
- 独立 packed Web test 仍使用重叠 staging/artifact 根且缺 ownership capability，被安全屏障正确拒绝；改用两个 owned sibling 根和受校验的 cleanup。打包实现及防护不变，该真实消费者导出重跑通过。

## 最终检查记录

| 检查 | 结果与证据 |
| --- | --- |
| clean bootstrap / frozen install | PASS；官方 Foliate pin、Node 24.15.0 / pnpm 10.0.0 |
| type / lint / format | PASS；模型模块分离后重跑 |
| fixtures / runtime / supply-chain | PASS；36 fixtures、Web/native manifest exact-set/hash、消费者 sync/check |
| Jest | **361 passed / 26 suites**；模型模块分离后重跑 |
| Node runtime / sync / supply-chain / native export / propagation | **32 passed** |
| production Java JVM | **72 raw cases、47 malformed dispatches、20 identity cases、10 scenarios、4096-command boundary**；不冒充 WebView |
| 全 Playwright | **96 passed / 39 skipped**；CFT 153.0.8010.12、真实 Microsoft Edge 155.0.4283.60、Firefox fail-closed；skip 不计通过 |
| generated native runtime E2E | 全 Playwright 内包含 CFT/Edge 六格式、visible CBZ、同 spread 导航、TOC/flow、bind 无授权、digest 失败及 hostile EPUB/FB2 CSP |
| large-input | 六格式均 ready；五项章节推进，KF8 单节边界；另存 host IO 报告，无虚构阈值/内存数据 |
| Expo dev smoke | PASS；真实 CFT 访问 `expo start --web`，FB2 ready 并从 1/3 导航到 2/3；服务已停止 |
| iOS / Android exports | PASS；source map 验证真实 native host 且不含 Web adapter；仅打包证据 |
| 完整隔离 package gate | PASS（152.77s）；381-file final tarball、npm/pnpm ESM/CJS/条件入口、frozen consumer、Android new-architecture APK；源树 digest 前后一致 |
| 独立 packed Web consumer | PASS；从 tarball 提取 runtime、CLI sync/check、Expo Web export、hash/missing 负控；修复旧测试脚本 staging 调用后通过 |
| OpenSpec | implementation completeness/correctness/coherence 自检；五份 main/delta 对比一致，24 有效 requirements / 44 scenarios；strict validation 通过 |

完整命令、exit code 和耗时见附件 `checks-clean-round4.json` 及对应日志。
包安全前置测试另有 7 passed 和 88 passed / 2 skipped；这两项 skip 不是 PASS。
最终 package tarball SHA-256：`1ed19088639305ae8c7b0c8bc9dacc56b4b35a848e830797dd186a3c77cd763c`。
真实 Linux Edge 来自官方 deb（SHA-256 `0ac9eeec6e670063ffc886654f27cd31b1f07ab7e7b71a3f8a94d28095a65a6c`），通过 `HN_EDGE_EXECUTABLE` 配置；不是换名的 Chromium。

修复前失败保留说明：首次 checkout 尚未同步 public runtime 时 sync-check 拒绝，随后显式 sync/check 通过；首次 native graph 因 Web adapter 引用失败，提取平台中立模型后通过；packed Web test 首次因重叠 staging 根失败，修复调用后通过。先前调试中旧 native closure/依赖 fixture/并发 staging 导致的失败不计为 PASS；最后完整 gate 串行运行并验证源树未变化。历史 Robolectric 下载失败没有被覆盖为通过。

## 验证边界

独立 checkout 先在 `d1b50ba` 跑全 Web/JVM/Node 验收，再前进到 `4a0fc10` 重跑类型/lint/format/361 Jest/原生 export/package；`819a213` 仅修复测试脚本的 staging ownership 并重跑 packed Web consumer export。Node 24.15.0、pnpm 10.0.0、JDK 17。官方 Foliate pin `78914aef4466eb960965702401634c2cb348e9b1`。原生 runtime 的浏览器执行证明 JS renderer/transfer/CSP 集成，不证明实际 Android private port、WK named-world、restricted-file origin 或设备权限行为。

不运行已获豁免的 Robolectric wrapper、Apple XCTest、真实设备或 Safari；历史下载超时和失败报告保留。没有把 `pnpm verify` / `release:verify` 宣称为全绿，严格 Xcode release 命令没有被改成跳过。没有 push、发布包或部署。

## Requirements / scenarios 追踪

| Requirement | 本轮证据 / 范围 |
| --- | --- |
| Official Foliate source is reproducibly pinned | clean bootstrap、revision/exact-set/hash 检查及负控 |
| Retired EPUB engine artifacts are absent | supply-chain source/runtime/tarball/consumer 检查 |
| Engine revision changes require explicit review | 原有固定 revision 和审查元数据测试；未改 pin |
| Staged native runtime integrity represents the shipped package | 补齐四个私有模块的 bundle closure、allowlist、integrity 与 packed verifier |
| Supported local publication formats | Web Demo 和生成 native runtime 的六格式真实浏览器打开；设备执行 waived |
| Format detection is content-aware | 36 fixtures、bounded detector/source 单测；误导命名与 PDF 拒绝 |
| Normalized publication navigation | Web/Jest、native runtime 章节与 TOC；CBZ 同 spread 回归 |
| Mobile reflow flow preference and recovery | native runtime 初始 scrolled、paginated/scrolled 同会话切换；fixed CBZ 无 flow |
| Owner-authorized Web acceptance scope | 明确授权原文、来源、六项移出验收和混合项局部豁免 |
| Initial host and behavior-proven publication content security policies | host meta CSP + strict publication required-CSP；差分 probe 与 hostile EPUB/FB2；不以 meta 后插或 scrub 替代 |
| Layered Web acceptance evidence | CFT、branded Edge、Firefox、dev smoke、export、package 分开记录；Safari waived |
| Publication navigation and network isolation | 无 popup/top navigation；恶意资源以 CSP 失败而非成功 response；设备 permission/navigation waived |
| Native pre-source gate and actual publication CSP | bind 无 I/O，独立 probe 前无读；失败 unsupported。WK 专属初始 policy 集成 waived，未证明时仍 unsupported |
| Native asset host and private authenticated bridge | manifest-exact 静态/pack 校验和 retained native guards；实际 Android/WK transport 行为 waived |
| Authenticated iframe and native bridge messages | TS/JVM 共享 wire corpus、生成 bootstrap、错误身份与严格 parser；Apple 执行 waived |
| Secure source schema, lifecycle, and source ownership | Web replacement/unmount、native controller/AppState、transfer retirement、shared renderer late cleanup |
| Bounded native source transfer | 32 MiB 精确边界、序号/digest/abort 负控及实际 generated-host E2E |
| Demo consumes the public package | package-root import、clean export、外部消费者 |
| Supported-format document selection | Demo 单测；取消、候选格式、host ownership 与 PDF 不宣称支持 |
| Deterministic multi-format fixture corpus | recipe/provenance/checksum/size 的 36 fixtures 检查 |
| Qualified automated acceptance evidence | 命令分项记录，失败/跳过/豁免不当作 PASS |
| Public reader package surface | npm/pnpm 条件入口、declarations/runtime smoke；私有模块不加 public exports |
| Controlled multi-format local source and load state | current generation 与 gated source/controller 单测；ready 依赖 renderer/model/location |
| Reader flow controls are observable and accessible | Chrome/Web 公共控制测试、native model projection 与 flow/controller 测试 |

## 已知限制（授权保留）

WK named-world/restricted-file/初始 CSP 的真实集成与行为未证明，不声称 iOS publication rendering 已可用。实际 Android WebView、Apple 构建/真机、设备 permission/navigation、隔离 Robolectric、真实 macOS/iOS Safari 均没有 PASS 记录。安全属性与 fail-closed 路径保持；这些是明确的 owner waiver，不是仍未处理的本地实现任务。


## OpenSpec 自检与归档判断

- 完整性：39 项有效任务各有实现/验证；6 个完整条目和混合设备子项已显式 waived，来源明确；未保留未处理的本地实现任务。
- 正确性：通过真实 Web renderer/CSP/导航与负控、native 传输/生命周期/状态机、JVM 和实际 exports/consumers 验证；绑定、probe、source I/O 和 ready 的顺序未降级。
- 一致性：同步 1 个新增授权 requirement 和 4 个修改 requirement；全 5 份 delta 的 24 条有效要求与 main 一致，7 条移除要求均已不存在，未删除其它 scenario。
- 新范围下未发现阻止完成/归档的问题，满足完成与归档条件。完成只针对 HAM-35 所有者授权的 Web/local 范围；不表示跨平台设备认证，也不把仍要求 Xcode 的 `release:verify` 变成通过。
- 旧 `ARCHIVE_NOTES.md` 及前三轮 verification 保留历史原貌；本报告和 `OWNER_WAIVERS.md` 是此次重新收口的依据。

归档已执行：`openspec/changes/archive/2026-10-07-replace-epubjs-with-foliate-reader/`。
主规范先按智能合并流程同步并逐项验证，再以 `openspec archive --skip-specs --yes --json`
移动 change；此处 `--skip-specs` 仅避免重复应用已同步 delta，不代表规范未同步。
