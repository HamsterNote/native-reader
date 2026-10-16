# Owner-authorized acceptance scope — 2026-10-16

HAM-35 的所有者修勾于 2026-10-16 明确授权：“应标记为不需要真机测验，只需要 web 端验证即可”。原评论 ID 为 `01a14506-b079-70fc-8e3c-824e7e47d27b`；本轮派工 `01a14508-6b02-7d14-b8ce-38b0bbd79005` 要求记录豁免、继续本地可验证实现，并仅在新范围完成后归档。

这是验收范围变更，不是设备测试通过。此前的报告、已完成 checkbox 和失败记录保留。

## Waived / removed from acceptance

- 4A.2、4A.3、4B.2、4B.3、4B.6：实际 Android WebView / WKWebView 的资产、frame/origin/world、端口、导航与权限行为证据。
- 4B.4、4B.5：依赖真实 Apple/Android 环境的跨端执行证据；共享语料、严格解析、状态机和 source-free bootstrap 的本地验证仍须保留。
- 4E.2：真机多格式、CSP、桥、资产、传输和 flow 验收；本地有界传输、生命周期、Web 行为测试不在豁免范围。
- 独立 Robolectric wrapper / Apple XCTest 的环境验收，不再要求为本 change 补齐；历史 Gradle 下载失败不改写为通过。
- 3.6、7.6 中真实 macOS/iOS Safari 和真实设备证据；Playwright WebKit 不冒充 Safari。

## Gate interpretation

取消的是开发流程中“必须先获得设备验收记录”的门禁。4C/4D 可以继续本地实现和验证。
运行时门禁不变：ABI/来源认证或行为探针失败必须返回 unsupported；bind 只表示桥已绑定，绝不授权 source I/O；没有可证明的初始 publication CSP 时不能打开书籍。
不得以豁免为由引入公开桥、宽泛资产根、任意 URI、后插 meta 或擦除脚本等安全降级。

仅能在 WKWebView 环境中有意义地验证的 named-world/restricted-file/初始 CSP 集成按上述授权豁免；保留其拒绝路径与安全属性，不声称 iOS publication rendering 已可用。可在本地执行的有界读取、严格传输、序号/digest、生命周期和 Web 引擎测试仍属于实现范围。

最终 task disposition、Web 验证结果和归档判断由本轮 verification 报告记录；本文件本身不使任何 task 通过。
