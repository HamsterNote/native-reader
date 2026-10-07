# HNSecureWebView 生产 seam 原生故障矩阵（CMPAA-106 阶段 3 / Foliate 4B）

本目录是一个**独立 gradle 工程**，把隔离 staging 生成的生产 Android 源码
（显式 `stagedRoot/android/`，由 `scripts/stage-secure-webview.mjs` 生成）
作为 `harness` 模块源码直接编译，并用 JUnit4 + Mockito + Robolectric 在 JVM
上执行 fail-closed 导航 gate 的故障矩阵测试。被测类是发布包真实类，不是副本；
`Uri.parse` 等 Android API 由 Robolectric 执行，不允许退化为 mockable `android.jar`
的默认返回值。

## 运行

```bash
# 在只读 reviewed source/runtime 门禁完成后，直接运行隔离入口（stage + 编译 + 测试）
cd packages/native-reader
node scripts/run-android-fault-matrix-isolated.mjs

# 不调用生产 staging/Gradle 的入口 fixture 测试
node --test scripts/run-android-fault-matrix-isolated.test.mjs

# 无 JDK 时仍可执行的静态合同：4A manifest/CSP gate，4B selector、listener 移除、
# exact-origin private WebMessagePort、闭合 JSON 协议和直接页面能力拒绝。
node android-fault-matrix/verify-csp-gate-contract.mjs
```

前置：JDK 17、Android SDK（compileSdk 36；Robolectric 测试固定 API 35 以兼容
Java 17）、可访问 Maven Central/Google
（react-android:0.86.3 等依赖；隔离副本不依赖原工程相对路径的本地 Maven 后备）。
Gradle wrapper 固定 9.3.1（与 RN 0.86.3 模板一致）。

## 隔离入口与证据边界

`scripts/run-android-fault-matrix-isolated.mjs` 在预先存在的
`~/.cache/opencode-tmp/opencode` 下由 `createOwnedStagingRoot` 用 `mkdtemp`
创建唯一根，**不用 `/tmp`**。
该 cache 根、自建根及 staging 输出在写入前均复用 `assertSafeStagingPaths`，
与真实 package authority、installed WebView/core 的 canonical 路径做双向非重叠检查；
独立 runtime authority 同样参与检查。拒绝 same/parent/child/输出 alias，
不接受用户指定的 foreign staging 目录。

正式命令直接调用上述 wrapper，不推荐会先 sync/stage 修改 source authority 的外层
Foliate gate。package scripts / CI 的调用链整改由另一 lane 维护，不以本 README
宣称其已完成；只读门禁必须在本入口之外完成。

- API：`runIsolatedAndroidFaultMatrix({ packageRoot, workspaceRoot, cacheRoot })`；
  `cacheRoot` 必须已经存在。直接测试可注入 `resolveInstalledInputsFn`、
  `stageSecureWebViewFn`、`runGradleFn`，CLI 不提供绕过或 foreign output 参数。
- `stageSecureWebView` 的 `outputRoot` 直接指向 helper 创建的 wrapper 唯一根（不再另建
  子 stage），`ownership` 原样传递 helper 返回的 capability。写入前及 stage 后均调用
  真实 `assertOwnedStagingRoot`；`sourceRoot/coreRoot`
  来自 `resolveInstalledInputs(workspaceRoot)`。`runtimeRoot`、`productSourceRoot`、
  `referenceIntegrityRoot`、`capabilityRoot` 全部显式指向只读 authority 包，
  **绝不把 stage 当 runtime 输入**。
- wrapper 复制整个 harness 工程到自建根（排除现存 `build/.gradle/.kotlin` 副产物），
  自己调用该副本的 Gradle wrapper，不放宽现有 `run-gradle.mjs` 的 cwd 限制。
  通过 `-PhnFaultMatrixStagedRoot=<absolute-stage>` 和
  `-PhnFaultMatrixRuntimeAssetsRoot=<authority>/foliate-runtime/native` 显式传参。
  oldarch 生产源码和 wire corpus 分别来自 `stagedRoot/android`、
  `stagedRoot/secure-webview`；assets 来自 canonical authority runtime。
  harness 缺少属性或 stage/runtime 重叠会失败，不再硬编码源码相邻路径。
- 工程 `build` 输出位于 harness 副本；`HOME/USERPROFILE`、Gradle user home、project
  cache、JVM `user.home/tmpdir`、Java preferences、`TMPDIR/TMP/TEMP`、XDG/AppData
  状态均指向唯一根。`ANDROID_USER_HOME/ANDROID_PREFS_ROOT/ANDROID_SDK_HOME` 及
  emulator/AVD 状态也重定位到唯一根；`JAVA_HOME/ANDROID_HOME/ANDROID_SDK_ROOT`
  保持真实 JDK/SDK 安装路径，仅作为只读工具配置，不用作 cache 输出。
- 不继承任意 `JAVA_TOOL_OPTIONS`，清除 `_JAVA_OPTIONS/JDK_JAVA_OPTIONS/JAVA_OPTS/
  GRADLE_OPTS`、Kotlin JVM/compiler 选项、`GRADLE_HOME/GRADLE_RO_DEP_CACHE` 和
  `ORG_GRADLE_PROJECT_*` 注入。所有 inherited 选项都清除，而非尝试解析危险参数；
  这也意味着外部 JVM tuning/agent 不生效。wrapper 自行构造 `JAVA_TOOL_OPTIONS`，
  将自有 home、tmp、preferences 和 Kotlin runfiles 传给 wrapper/build/test 子 JVM，
  并显式覆盖 `org.gradle.jvmargs`，避免工程配置将一次性 build JVM 重新指向真实 home。
- Kotlin 的 CLI property 与 task 级 `compilerExecutionStrategy` 都强制 `in-process`，
  task 策略冻结，不启动/连接 Kotlin daemon；daemon 默认 runfiles/options 仍显式指向
  自有 `kotlin-daemon`，persistent cache 指向自有 `kotlin-cache`，关闭 incremental。
  使用 `--no-daemon`；Gradle 如因 JVM 参数差异创建 single-use build JVM，其状态仍在
  唯一根内，完成后退出。冷 cache 可能重新下载依赖。
- package 在 resolver 前取得摘要；installed WebView、installed core 和 canonical runtime
  分别在解析后取得摘要，全部发生在任何 `mkdtemp/cp/stage/Gradle` 前。runtime 是独立
  authority，即使由 package 内 symlink 指向包外，也单独摘要。每一树都包含类型、bytes、
  隐藏文件、空目录、权限和 link target，不排除原 harness build/cache，不跟内部 symlink。
- 成功、resolver/staging/Gradle 异常都在 `finally` 仅通过 `disposeOwnedStagingRoot`
  清理 helper 创建且 token 授权的唯一根，然后
  逐项复核已取得的所有摘要。一项丢失/不可读也继续复核其余项；原始失败与全部 invariant
  失败用 `AggregateError` 聚合，不互相覆盖。摘要不是对恶意并发换链的原子保护，
  也不是只读挂载或通用工具链沙箱。
- 成功返回 `{ task, authoritySha256 }`。报告在临时副本内生成，随根一起清理，
  **不会留在原 `harness/build`**；持久化报告不在本入口 scope 内。

本轮仅使用 cache 内 mock staging/Gradle fixture 验证路径安全、属性/环境传递、四类
authority 的成功/失败摘要以及自有目录清理；**未运行真实生产 staging、Gradle/JVM/
Robolectric 或设备测试**。已恢复 reviewed source 的事实不等于本轮运行过生产故障矩阵。
需要真实验证时设置 `JAVA_HOME=<jdk17>`、`ANDROID_HOME=<sdk>`，先运行 fixture，
完成只读门禁并获得真实执行授权后再运行上面的直接 wrapper 命令；缺少输入/
JDK/SDK 会报错，不会跳过。4C/4D 仍冻结，本轮不解冻其执行。

gen13 ownership 合同已接入：capability 由 helper 模块私有 WeakMap 绑定对象 identity、
canonical root 与 dev/ino，不落盘、不支持序列化/copy/cross-process，也不能给 existing
目录补发。父目录 token 不授权子目录。fixture 直接使用生产 helper 验证真实 token 传递、
无 token/伪造/copy/错 root/子目录/输出 alias 拒绝，以及 dispose 后失效。
cleanup 遇到根被换链或替换 inode 时 fail closed，聚合错误并继续全部 input 复验，
绝不回退裸 `rm`；无法安全清理的目录可能保留供排查。ownership 创建之前失败不会
清理任何 foreign 根。上述证据不替代真实 staging/Gradle 或并发攻击下的原子隔离证据。

## 覆盖矩阵

测试类：`harness/src/test/java/com/hamsternote/nativereader/securewebview/HNSecureWebViewClientFaultMatrixTest.java`

| 场景 | 测试方法 | seam 分支（HNSecureWebViewClient.java） | failClosed=true 期望 |
| --- | --- | --- | --- |
| main-frame deny | `mainFrameDeny_returnsTrue` / `mainFrameDeny_viaWebResourceRequest_returnsTrue` | :159 | 返回 true（阻止加载） |
| main-frame allow | `mainFrameAllow_returnsFalse` | :159 | 返回 false |
| bridge timeout（250ms） | `bridgeTimeout_failClosed_denies` / `bridgeTimeout_failOpen_allows` | :130-132 | 返回 true |
| dispatch exception | `dispatchException_failClosed_denies` / `dispatchException_failOpen_rethrows` | :142-147 | 返回 true / 重抛 |
| Interrupted | `interruptedWhileWaiting_returnsFailClosedAndRestoresFlag` | :138-141 | 返回 true 且恢复中断标志 |
| JS/Catalyst unavailable | `catalystInstanceInactive_*` / `jsContextHolderGone_*` / `messagingModuleMissing_*` | :104-114, :160-164 | 返回 true，且不触达 dispatch |
| React 实例检查异常 | `reactInstanceInspectionThrows_*` | :108-114 | 返回 true / 重抛 |
| late callback 无害化 | `lateCallbackAfterCompletion_isHarmless` | :148-151 + HNSecureWebViewModuleImpl.java:228-237 | 不抛异常、不串扰 |
| subframe 网络/近似 about 拒绝 | `subframeNavigation_networkDeniedWithoutJsGate` / `subframeAuthorityNetworkAndNearAboutUrlsBlocked` | `isAllowedSecureSubframeUrl` + 两个公开入口 | override 返回 true；intercept 返回空响应 |
| subframe 精确 about 放行 | `subframeExactAboutUrlsAllowedWithoutJsGate` | `isAllowedSecureSubframeUrl` | `about:blank` / `about:srcdoc` 返回 false，JS gate 零触达 |
| canonical root 内文件放行 | `subframeCanonicalChildFileAllowed` | canonical `File` parent chain | 仅 root 的严格子路径放行；root 本身拒绝 |
| sibling-prefix 越界拒绝 | `subframeSiblingPrefixBlocked` | canonical `File` parent chain | `hn-secure-root-evil` 从 override 与 intercept 均被阻断 |
| traversal/编码拒绝 | `subframeTraversalAndEncodingVariantsBlocked` | `isUnambiguousLocalFileUri` | `../`、`%2e%2e`、`%2f` 均被阻断 |
| CSP control 成功 + strict 阻断 | `nativeCapabilityGateControlSuccessAndStrictBlockBecomeReadyOnlyAfterDrain` | `NativePlatformCapabilityGate` | evaluate 完成、control JS marker + PNG decode、strict 文档/PNG 阻断/quiet verdict 全部终态，且页面确认 observer/frame/blob URL drain 后才 `READY` |
| strict 文档/外部资源异常 | `nativeCapabilityGateStrictUnintendedExternalAssetExecutionInvalidates` | strict document verdict | 立即 `UNSUPPORTED` |
| strict late canary | `nativeCapabilityGateLateStrictCanaryBeforeDrainNeverExposesReady` | `onStrictCanary` | drain 前任何 canary 均立即 `UNSUPPORTED`，测试明确禁止“先 READY 后撤销” |
| strict JS/PNG/load/bad-drain 失败 | `nativeCapabilityGateStrictJsErrorPngLoadAndBadDrainNeverExposeReady` | strict verdict / `onProbeDrained` | 任一失败排列均不出现 `READY` |
| control JS/PNG/evaluate 失败 / probe 超时 | `nativeCapabilityGateControlJsFailureImageFailureBootstrapFailureAndTimeoutAreFailClosed` | `onControlObservation` / `onProbeEvaluateFailed` / `onProbeTimeout` | `UNSUPPORTED` |
| drain 与消息乱序 | `nativeCapabilityGateDrainAndVerdictPermutationsNeverReadyUntilEveryInputIsTerminal` | `onProbeDrained` + 全部 verdict | drain 可先到，但少任一终态输入绝不 `READY` |
| drain 后排队 timeout/strict 失败 | `nativeCapabilityGateQueuedTimeoutOrStrictFailuresAfterDrainNeverExposeReady` | timeout / strict PNG verdict | drain 本身不是许可；未收全候选 verdict 时排队失败仍无 `READY` |
| evaluate 迟到失败 / drain 中导航 | `nativeCapabilityGateLateEvaluateFailureAndNavigationDuringDrainNeverExposeReady` | evaluate / navigation verdict | 即使 drain 已排队，任一失败或导航均不出现 `READY` |
| drain 后旧 generation 事件 | `nativeCapabilityGatePostDrainOldGenerationEventsCannotRevokeReady` | generation 清理 | `READY` 后旧回调不可影响状态，也不存在 source I/O 窗口 |
| 错 origin/main frame/current URL | `nativeCapabilityGateWrongOriginMainFrameAndCurrentUrlCannotFeedCandidate` | `isTrustedBridgeContext` / `isReady` | 不能喂入 candidate，不能派发 |
| 导航 teardown / legacy unsupported | `nativeCapabilityGateNavigationTeardownAndLegacyUnsupportedNeverExposeReady` | `onNavigation` / `markUnsupported` | 旧 generation 回调无效，不能恢复 READY |
| manifest 路径与 iframe 顺序 | `nativeManifestDeclaresExactCspProbeAssetsAndIframeOrder` | `buildCspProbeScriptForTesting` | 两条 manifest-exact path；strict CSP 与 sandbox 在 `src` / append 前 |
| final private-port bind | `privatePortAcceptsOnlyCurrentHostBindAcknowledgement` | `NativeFoliateHostBridge` | 仅 native-owned channel、精确 host URL 和当前 session/generation 的 `bind` ack 可绑定 |
| stale/duplicate 端口消息 | `privatePortWrongIdentityDuplicateAndOldGenerationAreSilentNoOps` | `NativeFoliateHostBridge` | session/generation 不符或重复 ack 无状态副作用 |
| unknown/transfer/source 拒绝 | `privatePortCurrentMalformedUnknownAndTransferMessagesTerminate` / `privatePortCurrentReadySourceUriAndByteFieldsNeverDispatch` | strict JSON + closed envelope | 当前身份下畸形、`ready`、transfer/URI/base64/bytes/chunk 均 terminal teardown，未实现 source I/O |
| reload 后旧端口失效 | `privatePortNavigationInvalidatesOldPortBeforeSourceIoExists` | `NativeFoliateHostBridge.onNavigation` | 主框架离开 exact host 后旧 generation 不能 bind 或派发 |
| host lexical closure | `privatePortInstallerHasNoPublicRnOrParentCapability` | `buildPrivatePortInstallScriptForTesting` | 安装器仅接受 one-shot token + transferred port，不创建 RN/public/parent bridge |
| secure-host 页面能力 | `secureHostMainFrameNavigationDoesNotReachReactNativeGate` / `secureHostBlocksPopupFileChooserGeolocationAndMediaPermission` | client/chrome production methods | 原生直接拒绝导航、popup、文件选择、地理位置和媒体权限，零 RN 决策回调 |
| selector 与 URL 绕过 | `foliateAssetNamespaceIsReservedAndUnavailableBeforeSelector` / `selectedFoliateHostMainFrameNavigationNeverReachesReactNativeGate` | 严格 `source` / `newSource` selector + AssetLoader/client | 普通 `source.uri`、`loadUrl` 即使等于 `reader.html` 也只得到 `/foliate/` 404，不能进入安全 host |
| selector 主框架许可 | `selectedFoliateHostAllowsOnlyOneNativeOwnedMainFrameRequest` | per-WebView one-shot permit | 仅 selector 发起的 exact `reader.html` 主框架请求可服务；其他主框架请求显式 404 |

JS 响应通过 `HNSecureWebViewModuleImpl.shouldStartLoadWithLockIdentifier`
的**真实回调路径**回灌（与线上 JS 模块收到响应后执行的代码相同）。
`SystemClock.elapsedRealtime()` 在单测中以真实推进的时钟替代，保持
250ms deadline（`SHOULD_OVERRIDE_URL_LOADING_TIMEOUT`）语义与线上一致。
`@RunWith(RobolectricTestRunner.class)` 和 `@Config(sdk = 35)` 使这些断言在真实
Android `Uri` 语义下执行；Mockito static mock 继续仅控制 `SystemClock` seam。

## 架构说明与边界

- 编译变体：`src/main/java` + `src/oldarch`。`src/newarch` 依赖
  react-native-codegen 生成接口，本 harness 不跑 codegen；决策 seam 位于
  arch 无关的 main 源码集，oldarch 变体完整覆盖。newarch 的编译证据由
  外部 tarball consumer 的全量构建（`newArchEnabled=true`）覆盖。
- `createWebViewEvent` 只组装事件载荷、不属于决策分支；测试用 RN 真实
  JVM `WritableMap`（`JavaOnlyMap`）替代，避免单测依赖 `android.view` 与
  `Arguments` 原生绑定。
- `failClosed=false` 且 JS gate 不可用时的 legacy event-and-load 回退路径
  （HNSecureWebViewClient.java:165-173）依赖 `UIManagerHelper` 事件分发，
  不属于 fail-closed 安全语义，不在本矩阵内。
- 4A.3 在创建两个 iframe 前只预创建**一个** blob URL；control 与 strict 复用相同
  document bytes、相同 appassets 外部 JS/PNG URL 和相同 `allow-same-origin allow-scripts`
  sandbox。strict iframe 的唯一配置差异是其在 `src` 前施加的 publication CSP；静态 host
  CSP 仅保护 `reader.html`，并不被称作 publication CSP。
- `READY` 是一次性 terminal 证明：页面先停止/断开 observer、移除两个 frame、撤销共享
  blob URL，发送 `probe-drained`；原生锁内核对 evaluate、control、strict 文档/PNG/quiet 与
  drain 的所有 verdict 后才发布 `READY`，随后清除 generation token。Robolectric seam
  测试证明状态机和事件关联，不能替代安装设备上对 WebView iframe CSP 的 runtime 验证。
- 4B 在上述 `READY` 后移除一次性的 `WebMessageListener`、干净重载 exact host，再传递
  native-owned `WebMessagePort`。JVM 测试验证 port 状态、闭合 schema 和直接 deny 分支；它
  不证明已安装 Android System WebView 的 port 转移、main-frame delivery 或最终 publication
  CSP 行为。该设备证据仍属于 4E.2。
- `{ nativeHost: 'foliate' }` 仅能作为完整的 `source`（old architecture）或 `newSource`
  （new architecture）map 被接受；它不是顶层 React prop，也不是 URL 比较。非字符串、未知值
  或携带任何额外 key 的 hostile map 都稳定进入 invalid-selector 状态而非抛出 bridge 异常。每个
  WebView 一旦接受 selector 即进入不可降级状态，generic `source`、history/reload/loadUrl、
  injected JS 与 page object 更新都不能恢复；从普通页面切换 selector 必须 remount。`/foliate/`
  在 selector 前一律显式 404，不会回退 HTTPS 网络。最终 `onLoad` 只在私有 port 已可 bind 时发出
  一次，表示 host-ready-to-bind，不表示 publication 已传输或已打开。
