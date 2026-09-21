# HNSecureWebView 生产 seam 原生故障矩阵（CMPAA-106 阶段 3）

本目录是一个**独立 gradle 工程**，把 staging 生成的生产 Android 源码
（`packages/native-reader/android/`，由 `scripts/stage-secure-webview.mjs` 生成）
作为 `harness` 模块源码直接编译，并用 JUnit4 + Mockito + Robolectric 在 JVM
上执行 fail-closed 导航 gate 的故障矩阵测试。被测类是发布包真实类，不是副本；
`Uri.parse` 等 Android API 由 Robolectric 执行，不允许退化为 mockable `android.jar`
的默认返回值。

## 运行

```bash
# 一条命令（stage + 编译 + 测试）
cd packages/native-reader
yarn test:android-fault-matrix

# 发布级验证会强制运行同一个原生 job；缺少 JDK/SDK 会失败，不会跳过。
yarn build:verify

# 或分步
node scripts/stage-secure-webview.mjs
cd android-fault-matrix
JAVA_HOME=<jdk17> ANDROID_HOME=<sdk> ./gradlew :harness:testDebugUnitTest
```

前置：JDK 17、Android SDK（compileSdk 36；Robolectric 测试固定 API 35 以兼容
Java 17）、可访问 Maven Central/Google
（react-android:0.86.3 等依赖；本仓库 `node_modules/react-native/android`
maven 仓库作为本地后备）。Gradle wrapper 固定 9.3.1（与 RN 0.86.3 模板一致）。
测试报告位于 `harness/build/reports/tests/testDebugUnitTest/index.html`，原始 XML
位于 `harness/build/test-results/testDebugUnitTest/`。

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
