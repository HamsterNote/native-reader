# iOS source/publication-free WKWebView hosted spike

这是独立的 UIKit Objective-C App + **真实 hosted XCTest** 工程，不是 mock fault matrix，也不是产品阅读器。直接编译生产 `HNSecureFoliateHostRelay.h/.m`，直接引用已暂存的生产 runtime bundle；不依赖 React Native、Pods 或 publication fixture。

## 固定接口与运行

- 工程：`HNFoliateHostSpike.xcodeproj`
- shared scheme：`HNFoliateHostSpike`
- App target：`HNFoliateHostSpikeApp`
- hosted unit-test target：`HNFoliateHostSpikeTests`
- 最低部署：iOS 14.0；测试 bundle 的 `TEST_HOST` / `BUNDLE_LOADER` 指向 App，并有 target dependency。

在 macOS / Xcode 安装了目标 iOS Simulator runtime 后，从仓库根运行独立 runner：

```sh
python3 packages/native-reader/apple-host-spike/scripts/run-spike.py \
  --output-parent /absolute/existing/external/evidence-directory \
  --runtime-id com.apple.CoreSimulator.SimRuntime.iOS-XX-X
```

`--output-parent` 必须是**外部已存在目录**，不放进 checkout。runner 创建 fresh 输出目录与自有 simulator，不使用或删除用户已有 simulator。runtime identifier 是本机已安装 runtime 的完整 identifier，不是 display name。具体输出文件/退出状态以 `scripts/run-spike.py` 为准；本目录的工程 lane 不修改 runner。

生产引用的锚点特意为工程目录 `HNFoliateHostSpike.xcodeproj`：其下 `../../apple/HNSecureFoliateHostRelay.h/.m` 和 `../../apple/HNSecureWebViewFoliateRuntime.bundle` 落在同包 `apple/` 中。bundle 是 `lastKnownFileType = folder` 的 Resources folder reference，保留 `foliate-runtime/native/` 等目录，不把文件扁平化、不创建副本源、不运行 staging。Apple 首次编译需实际确认 folder copy 结果；资源目录保真由运行时 manifest 测试再检查。

## 固定 test inventory

测试类：`HNFoliateHostSpikeTests`。runner 应完整运行以下 5 个方法，不允许只挑通过项：

| 方法 | 证据 / 断言 |
| --- | --- |
| `testCanonicalBundleManifestClosure` | App 中 canonical bundle 目录存在；manifest 所有 asset 的 SHA-256（CommonCrypto）、size；完整文件集合无 extra/missing、无 symlink。 |
| `testSourceFreeBindAndContentWorldIsolation` | canonical reader `didFinish` 后运行生产 source-free CSP differential preflight；native `bind` commandId 0；唯一 matching `bridge-bound` ack；真实 world/frame/url/origin/body；named/page globals 双向隔离与实际 handler 能力探针。 |
| `testDeactivatedRelayRejectsActualStaleMessageAndNativeSend` | 预检并 bind 后 dispatch source-free dispose commandId 1，主线程立即 deactivate；真实 bootstrap 随后产生的首次 matching dispose ack 被旁观但不接受，native send 拒绝。不是仅证明重复 bind ACK 被去重。 |
| `testDeniedNavigationFailsClosedAndRejectsOldRelay` | 尝试 `about:blank` 被 policy cancel，relay deactivate，canonical document 不被替换；旧消息/发送失效。 |
| `testExactHostURLDepartureRejectsActualStaleMessageAndNativeSend` | 用真实 `history.replaceState` 改变 exact host URL 的 fragment；实际 `WKWebView.URL` 必须离开 canonical URL；旧消息不接受、native send 终止 relay。若平台不支持该行为，诚实失败，不增加 policy 例外。 |

测试的 navigation policy 只允许一次 exact 初始 host，以及生产 relay 活跃预检的严格 permit；每次 allow 立即 return，其它均 abort/deactivate/cancel。测试不调用生产 tuple 接受入口，不创建可调用的生产接受入口。观察子类收到真实 `WKScriptMessage` 后调用 `super`，通过生产 `onAcceptedMessage` 观察是否真正被接受。

`ReactNativeWebView` 仅是**测试自有 page-world 探针 handler**，并非 RN 桥。在 page world 实际暴露此名称，测试从两个 world 分别执行 JavaScript 读取可调用性，同时注入 page-only RN global 并验证 named world 看不到它。UCC 没有 handler 枚举 API；自记注册列表不算隔离证据。DOM 属性故意证明跨 world 共享，**不将共享 DOM 当作全局隔离证据**。

page-world 探针在 JS evaluate 后显式执行 `waitForExpectations:@[pageProbe] timeout:5`，返回后才清除消息回调；`evaluate:` 仅等待自己的 `@[done]`，不消费调用方的消息 expectation。不能依赖 JS completion 与 `WKScriptMessage` 交付时序；超时由 XCTest 正常记为 Failed，并沿用失败 attachment，不手动 fulfill 探针或伪造 tuple。静态回归应检查“设置回调 → page JS evaluate → 显式等待 pageProbe → 清除回调”的位置顺序，以及 helper 使用定向等待；将等待删除或移动到清回调之后应被拒绝。该合同检查由 scripts writer 维护，工程 lane 不跨 scope 修改脚本。

## 证据与边界

每个 test 在 `tearDown` 生成 `public.json` XCTest attachment，`XCTAttachmentLifetimeKeepAlways`；同一 JSON 使用 `HN_HOST_SPIKE_EVIDENCE ` 前缀单行写入 stdout 备份。包含实测 phase、event、evaluation result/error、原始 message tuple/ack、preflight outcome、生产接受消息与断言失败。`continueAfterFailure` 与 failure override 保留失败路径；若进程崩溃/被 kill，无法保证 teardown attachment，应视为不完整证据，不能宣称成功。

`file:` 的真实 origin tuple **没有文档保证**。测试记录 WebKit 实测的 protocol/host/port 并与生产严格条件 `file / empty-host / 0` 比较；不改写 tuple、不放宽 relay。如果 CSP、named-world ESM import、字符串发送或该 tuple 不符合生产预期，测试应失败并保留证据。`sendNativeMessageData:` 返回 YES 只是 dispatch，不是成功 ack；最终以实际生产接受的唯一 matching ack 为准。

全程无 publication URI、source prepare/cache copy/transfer/open/model/flow/render。CSP 预检产生的 control/strict blob iframes 是**预检 document**，不能作为 publication iframe 安全、排版或 source read/copy 的证据。离开 exact host 的测试证明 URL 边界失效，不宣称已替换 publication document。

**创建环境是 Linux，没有 Xcode / Apple SDK / Simulator：工程与 XCTest 尚未编译、尚未运行，当前没有实测 Apple 成功结论。** 静态工程/XML/目录/hash 合同检查不能替代 Apple 编译和真实 hosted 测试；首次 macOS runner 执行仍是必要 gate。

证据标签：旧 `scripts/VERIFICATION_RESULT.json`（28 项记录）是历史快照，不作为当前通过数量或源码版本依据。`scripts/VERIFICATION_RECONCILED.json` 及 scripts writer 后续 current 报告仅代表 **Linux 静态 / 模拟 fixture** 证据；结果、数量与源码匹配应读取 current 报告的 `status`、`fixtureTests`、`commands`、`sourceHashes` 等字段，并复核其对应源码，不在此固定新数量。`STATIC_CONTRACT_PASS_NOT_4B3` 或 RECONCILED/static PASS 均不代表 Mac PASS；`macExecutionVerified` / `realMacExecution` 仍为 false 时不能关闭 Apple gate。
