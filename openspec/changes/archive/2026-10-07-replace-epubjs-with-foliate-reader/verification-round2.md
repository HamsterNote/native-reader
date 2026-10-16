# OpenSpec implementation verification — 2026-10-16 第二轮

> 以下为第二轮历史报告。最新第三轮为 29/45、剩余 16 项；章节导航、协议判定顺序与旧引擎清理已补齐，当前结论见 `verification-round3.md`。

本轮仅执行随机协议标识修正与完整 package gate 修复。依照 OpenSpec 官方 verify-change 工作流，重新核对 tasks、design、五份 delta specs 与实现。`openspec validate` 只证明文档结构；本报告分别记录实现、自动化与平台证据。

**结果：两项派工已完成，整个 change 仍未达到发布/归档条件。** 勾选净增 **2**：4B.1、6.3；由 **23/45 → 25/45**，剩余 **20** 项。没有撤销原有勾选。未执行原生 publication I/O、transfer 或 renderer 接入。

| 维度 | 结论 |
| --- | --- |
| 完整性 | 原 22 个未完成项：2 已修、13 仍有本地代码/验证工作、7 纯平台环境证据阻塞；逐项见下表 |
| 正确性 | 三端 ID schema、RN 随机生成、共享语料和 JVM 状态机有本地证据；完整 Linux package gate 通过 |
| 一致性 | numeric generation/commandId 偏差已修；3.4 页/章导航冲突仍存在；4B.5 stale/schema 判定顺序仍需统一 |

## 实现与依赖边界

`NativeReaderImplementation.native.tsx` 分别以 32 个密码学随机字节生成 session、generation、bind commandId，均为无 padding 的 43 字符 base64url。任何一次随机分配失败都在挂载前 fail closed。React 生命周期 epoch 保持本地数值，不进入 wire。

`nativeFoliateProtocol.ts`、Android `NativeFoliateHostBridge`、iOS `HNSecureFoliateHostRelay.m`、生成的 native bootstrap 与共享 corpus 一起改为字符串 ID。随机 ID 不比较大小；所有已接受 ID 保留去重，ack/error 必须精确关联 inflight ID。每个绑定最多接受 4096 个不同命令，达到上限后 terminal，避免无界内存或淘汰 ID 后重新执行旧命令。bind ack 仍只表示 bridge-bound；transfer namespace 仍拒绝。iOS 14 最低版本和原有 ABI 未变。

`Core import was not found` 的根因是**仓库发布链要求改写已经不存在的旧 core import**，不是缺少旧 core staging 环境。本轮移除 release lifecycle 的 core stage 和 secure WebView 的 core adapter writer；独立发布清单排除两种旧引擎，更新三组 consumer manifests/locks、第三方 notices、tarball 预期和生命周期校验。隔离根、所有权、路径拒绝、失败清理与源码不变性检查继续生效。

完整 gate 又发现并修复了两个旧 consumer 校验问题：固定完整性清单漏掉四个安全 WebView 源文件和 Foliate `view.js`；运行时边界 stub 缺少 `ScrollView`。只对已核验的反向断言与注释允许出现旧桥名称，未放宽产品桥身份检查。增加独立 staging/packed 完整性清单一致性回归，以及注入旧依赖、旧 payload、删除 Foliate 协议入口的失败校验。

**工作区迁移尚未完成。** 根依赖/patch、独立 `stage-bundled-core.mjs`、旧 `nativeSecurity.test.ts` 等仍待 6.1/6.2 清理；此次发布流程不再调用该脚本或解析旧 core 输入。不能用 tarball 的干净结果宣称整个仓库已无旧引擎。

## 验证记录

环境：Linux，Node 24.15.0，pnpm 10.0.0，JDK 17；Foliate pin 保持 `78914aef4466eb960965702401634c2cb348e9b1`。

| 检查 | 本轮结果 |
| --- | --- |
| Library Jest | 23 suites / 327 tests 通过；新增独立 ID、第二/第三次熵分配失败、去重容量边界；共享 corpus 拒绝数值/非法长度/字符 |
| native bootstrap/runtime tests | 5 tests 通过，包含生成代码的实际私有 port 行为 |
| `JAVA_HOME=... node scripts/test-native-foliate-jvm.mjs` | 从生产 Java 文件逐字提取协议类并编译；48 raw cases、7 scenarios、4096 命令边界通过。只 shim 安装 token 的 Android Base64 API；不模拟协议实现 |
| WK spike runner | Python runner 自检通过；仅基础设施测试，没有执行 XCTest/WKWebView |
| `test:release-safety` | 7 个入口检查、88 个安全测试通过，2 个平台条件 skip |
| `test:secure-webview` / `test:release-lifecycle` | 通过；真实隔离 staging、完整性、Codegen 和恢复/失败清理测试 |
| static native propagation tests | 3 tests 通过，包括独立完整性清单一致性回归 |
| build / typecheck / lint / format | 通过；consumer lock 最后仅恢复原有排版，diff 只删除退休依赖及不再使用的传递依赖 |
| `openspec validate --all --strict --json` | 7 passed / 0 failed；仅结构验证。apply 重新读取确认 25 complete / 20 remaining |
| **完整 `pnpm --filter @hamster-note/native-reader run test:package`** | **退出 0**；npm/pnpm 干净安装、TypeScript browser/react-native 条件解析、真实包入口加载、带平台 stub 的 ESM/CJS smoke、runtime sync/check、注入负控全部通过 |
| Android tarball consumer | `:app:assembleDebug -PnewArchEnabled=true -PreactNativeArchitectures=x86_64` 通过；124 tasks executed，APK 含 HNSecureWebView；构建证据，不是安装后的 WebView 行为证据 |
| iOS export | `pnpm run bundle:ios` 通过，并验证 native entry/private host/module 图；不是 Xcode 构建或真机证明 |
| 完整 Android Robolectric wrapper | **blocked**：隔离缓存从 `services.gradle.org` 下载 Gradle 9.3.1 时读超时；未把独立 JVM 协议测试或 APK 构建冒充该套测试通过 |
| 真正 iOS package build / 真实 Edge/Safari / installed Android | 未执行；Xcode/CocoaPods、真实浏览器和设备环境缺失。默认 Linux package gate 明确跳过真实 Apple 构建；未申请基础设施豁免 |

成功 tarball：`hamster-note-native-reader-0.1.0.tgz`，333 文件，SHA-256 `8bdecb09eb6e42f8ce22cc5bb53f97fba9508134b28c44287d2aa67c44575bfc`。所有 consumers 消费同一摘要产物；最终完整工作区 package 源树摘要未变。测试结束后临时 tarball/APK 按原有流程清理，交付补丁与日志，不声称这些临时文件已发布。

## 原 22 项重新归类

“仍本地可做”表示仍有代码、契约或自动化工作，并非只有设备缺失；其中 4C/4D 必须等待批准的前置安全门，不因本表解锁。纯环境项表示当前主要缺口是实际平台证据，不代表相关实现已经在该平台验收。

| Task | 分类 | 当前事实与下一步 |
| --- | --- | --- |
| 3.4 | 仍本地可做 | paginated Previous/Next 逐页行为与批准的 linear-section 契约不符；先对齐实现/契约 |
| 3.6 | 纯环境阻塞 | 完整 Linux package gate 已通过；上轮 dev smoke、asset-missing E2E 有证据。仍缺真实 branded Edge、macOS/iOS Safari |
| 4A.1 | 仍本地可做 | 发布链已移除旧 payload；`nativeSecurity.test.ts` 仍 resolve 旧 core，整项不勾选 |
| 4A.2 | 纯环境阻塞 | 仍需安装后平台的 manifest/path/MIME/受限根拒绝证据 |
| 4A.3 | 纯环境阻塞 | 仍需 installed WebView 的 listener、clean reload、失败前零源 I/O 证明 |
| 4B.1 | **已修，勾选** | 三种 43 字符随机 ID、strict parser/corpus、重复/inflight/容量规则已对齐；iOS 14 与 ABI 保持 |
| 4B.2 | 纯环境阻塞 | final private-port、main-frame、无公开 fallback 的 installed Android 证明缺失 |
| 4B.3 | 纯环境阻塞 | 缺真实 WK restricted-file tuple、named world relay、synthetic preflight 行为证据 |
| 4B.4 | 仍本地可做 | source-free bootstrap 已有测试；仍需统一 stale 身份与 schema 失效的判定顺序、补跨端 parity；不能提前关闭 |
| 4B.5 | 仍本地可做 | JS 先识别可证明的 stale identity，native/bootstrap 仍先进行完整 schema 验证；旧身份且坏 payload 的结果可能不同。需补统一语料；另缺 iOS 执行和完整 Android wrapper 成功记录 |
| 4B.6 | 纯环境阻塞 | 需实际平台 navigation/popup/download/permission/scheme 拒绝与无 callback 副作用证据 |
| 4C.1 | 仍本地可做 | 32 MiB 有界源准备未接入；须先完成 4B pre-source 门禁 |
| 4C.2 | 仍本地可做 | begin/chunk/commit/abort、连续序列和 SHA-256 transfer 未实现；依赖 4C.1 |
| 4D.1 | 仍本地可做 | actual publication 初始 CSP 注入未接通；实现后还需真实 canary，依赖 4C |
| 4D.2 | 仍本地可做 | 原生 renderer/open/ready/flow 未实现；依赖 4A–4D.1 |
| 4E.1 | 仍本地可做 | 未来 source/transfer/render 的 AppState、abort、迟到事件及 exact-once 所有权集成仍缺 |
| 4E.2 | 纯环境阻塞 | 真实 iOS/Android 多格式平台行为证据缺失；APK/export 不替代 |
| 6.1 | 仍本地可做 | workspace 旧依赖/override/patch/lock/孤立脚本仍在；未声称全仓无旧引擎 |
| 6.2 | 仍本地可做 | 当前发布及 consumer 断言已修；旧 core 测试和剩余脚本/文档引用仍待整体清理 |
| 6.3 | **已修，勾选** | tarball 无旧引擎 payload，发布依赖及三个 consumer lock 已清理；全部声明的 JS 条件入口、类型入口与 Android APK consumer 通过；Apple 平台行为另记 |
| 6.4 | 仍本地可做 | 本轮新增 tarball 退休引擎注入负控；全仓 manifest/patch/lock 扫描仍依赖 6.1，整项不勾选 |
| 7.6 | 仍本地可做 | 完整 clean-checkout 汇总验收尚未重做，且含真实浏览器/Apple/设备环境依赖；不是“纯缺设备” |

## Requirement / scenario 自检

重新核对 23 条有效 requirements、43 scenarios（不将 REMOVED 的历史要求计入）。上一轮 `verification.md` 的对照表作为既有证据索引，本轮变动如下；未列项目仍维持原来的通过/部分/未实现判定。

| Requirement | 本轮核对 |
| --- | --- |
| Authenticated iframe and native bridge messages | 随机 ID 缺口已修；共享 corpus/命令状态机本地通过；stale/schema 跨端顺序和真实平台验证仍不足，不把整个 requirement 记为通过 |
| Staged native runtime integrity represents the shipped package | 固定完整性集合与 staging 一致，tarball/两个安装树及 Android APK 有证据；篡改/漏文件与 payload 注入负控通过 |
| Public reader package surface | npm/pnpm browser/react-native/import/require 的入口与声明通过，iOS export 图正确；不外推 Xcode/运行时行为 |
| Demo consumes the public package | packed-consumer runtime 同步/条件入口缺口已补，Demo 仍走包根；实际设备集成另记 |
| Qualified automated acceptance evidence / Layered Web acceptance evidence | 新增完整 Linux package 与 APK 构建证据；真实 Edge/Safari/Apple 仍开放 |
| Retired EPUB engine artifacts are absent | **仍未满足**：tarball 与 consumer 清理完成，但 source workspace 的旧引擎依赖、patch 和测试还在 |

CRITICAL：20 个未完成 task 均列于上表；尤其 bounded native transfer、actual publication CSP、mobile renderer/flow 仍无完整实现。WARNING：3.4 导航契约冲突、4B.4/4B.5 stale/schema 顺序和平台测试缺口。没有为了满足勾选而缩小 requirement 或增加豁免。

**OpenSpec 自检结论：本轮交付可审查，change 仍不可归档/发布。**
