# Design

## Context

动机见 `proposal.md`。项目使用本地 spec-driven schema；未找到项目内额外的 propose 命令或技能副本，按已安装技能及 CLI artifact instructions 执行。

已观察到的集成点：

- main 的 `apps/demo` 使用 Expo `~57.0.24`、RN `0.86.3`、`expo-document-picker` 和 `expo-file-system`，`web.output=single`。其 `start` 同步两个 Web runtime 后执行 `expo start`，不是明确的 native dev-client 入口；根目录目前只有 `dev:web`。
- `DemoApp.tsx` 已接受 PDF MIME，native picker 用 `copyToCacheDirectory: true`，再把 `{ kind: 'uri', uri, name, mimeType }` 传给包根 `NativeReader`。native 的支持格式文案尚不含 PDF。不应重写 picker 或另做 PDF viewer。
- `apps/demo/metro.config.cjs` 用平台解析选择包根 native source，已有 TLS 可选配置；保留 resolver 和 Web HTTPS 路径。
- #8 分支提供 workspace 包 `@hamster-note/pdfkit`、Expo 注册 `HamsterPdfKit`、`pdfKitHost.ts` capability 检测和 iOS `PdfReader`。能力是 `hamster-pdf` v1、32 MiB、`readyAfterDraw=true`；通过 `command`/`onPdfEvent` 交互。Demo 已在该分支加入 `expo-dev-client` 与 `@hamster-note/pdfkit`。Pod 要求 iOS 16.4+，只接收授权 `file:///`。
- #9 分支在现有 reader 原生包注册 `HNPdfView`，Android `getAndroidPdfHost()` 校验 v1、32 MiB、private port 和 draw-ready。它通过 `configuration`、`command`、`onPdfMessage` 驱动隔离 pdfjs WebView；Gradle 把 `../pdf-runtime` 放入独立 APK asset namespace。无需新增 Android Expo PDF 包，也不借用 Metro URL 供应 PDF shell。
- 两个 PR 尚未合入；分支 SHA 和 base 见 proposal。后续实施前提是依赖合入 main 且上述注册和资源边界保留；若接口变动，先修订这些接口记录和对应任务，不声称已验证合并结果。
- `fixtures/pdf/rejected.pdf` 仅有签名，是故意损坏样本。合法八页文本 PDF 配方存在于 `tests/e2e/pdf-reader.spec.ts` 的 `pdf-lib` 生成逻辑，可复用来提供人类可取得的样本。

## Goals / Non-Goals

**Goals:**

- 明确分开一次性的依赖安装/本地 client 构建安装与每日一条命令启动 Metro。
- 复用现有 Expo prebuild/run 和 autolinking，让两个 native host 与资源实际进入同一 Demo client。
- 用可复现样本和逐项清单交接设备操作，不把 JS/export 结果当作设备证据。

**Non-Goals:**

- 范围边界见 proposal；尤其不实施 renderer、EPUB、安全门禁或 PDF 高亮功能。
- 不在本 change 修复 #8/#9 内部 renderer 缺陷；若人类发现上游问题，记录证据并回交依赖维护者。
- 不要求 EAS、Expo 账号、商店分发或新的 native 构建工具链。本地编译并安装 development client 是自定义模块的必要条件，不能省略为 Expo Go 扫码。

## Decisions

### 1. 在现有 Demo 增加明确的 native 入口

拟新增根目录 `dev:native`，委托 Demo 的 native startup；新增 `native:prepare`、`native:ios` 和 `native:android` 作为可复用的资源准备/首次本地编译入口。名字是本提案定义的待实现命令，不表示当前 main 已支持。

`native:prepare` 复用现有受保护的 Foliate staging/check 与 PDF staging/check，构建 #8 PDFKit workspace 包所需的 JS/type 输出；检查 Android PDF runtime manifest 可用。不要手工复制 native host、修改生成物 hash 或跳过 source/integrity 门禁。首次 native build 前必须完成准备，因为 APK PDF assets 和 CocoaPods 集成不会随 Metro 热更新。

`dev:native` 在准备成功后启动 `expo start --dev-client --lan`。端口只传一次，默认 8081，显式 `--port 18738` 覆盖。若占用，应直接失败并提示覆盖参数，不让 Expo 交互式悄悄换口。入口沿用现有 Metro resolver，不导入私有 renderer。拒绝另建 Expo app：那会分叉现有 Demo 的选择器和验证路径。

在 Demo Expo 配置设置稳定 development scheme `native-reader-demo` 和 iOS bundle identifier / Android package `com.hamsternote.nativereaderdemo`，供 autolinking、dev launcher 和本地签名使用；保留 `web.output=single`。以 SDK 57 配置解析结果验证，必要时通过 Expo 官方配置项添加 `expo-dev-client` 插件，不手写原生启动器。沿用 SDK 默认架构，不为兼容 host 私自切换架构。

### 2. 一套本地 development client 路线覆盖 iOS/Android

复用 #8 的 `expo-dev-client`、workspace PDFKit 依赖，不重复添加另一套版本。Android 从 reader 的现有 RN autolinking 包拿到 `HNPdfView`；iOS 从 Expo module autolinking 拿到 `HamsterPdfKit`。验证两条 autolinking 结果及 Gradle PDF assets 输入，不能以 Metro 能 resolve JS 判定 native module 已存在。

`native:ios` / `native:android` 在 prepare 后，分别从 `apps/demo` 调用 `expo run:ios --device --no-bundler` / `expo run:android --device --no-bundler`；这是首次编译和安装调试 client，而不是分发包。按 Expo 流程生成本地原生工程，并忽略 Demo 生成的 `ios/`、`android/`，不删除用户已有工程，不运行破坏性的 `prebuild --clean`。依赖或 APK 静态资源变化必须重建安装；仅 JS 变化重新连接 Metro 即可。

Expo Go 和缺少 host 的旧 client 保留现有 `PDF_CAPABILITY_UNAVAILABLE` 失败方式。放宽 capability 检测、改走 Foliate 或直接嵌入普通 WebView 都不满足本期目标。

### 3. 人类最小运行步骤与网络约定

以下为实现后需在 `README.md` / `docs/validation.md` 交付的命令契约，本次 propose 不执行这些实现/构建操作。

从仓库根目录准备（Node 24，pnpm 10.0.0，访问 pinned submodule 的网络权限）：

```sh
pnpm run foliate:submodule:bootstrap
pnpm install --frozen-lockfile
pnpm run native:prepare
```

第一次安装或 native 依赖/资源变化后，按手头平台执行一条：

```sh
# 仅 macOS：安装 Xcode/命令行工具及 CocoaPods；连接并信任 iPhone，
# 开启设备开发者模式，在本地配置可用的 development signing team。
# iPhone 要求 iOS 16.4+；不得在文档中填写证书、口令或 team 私密材料。
pnpm run native:ios

# macOS/Linux/Windows：安装 Expo 57/RN 0.86 要求的 JDK/Android SDK，
# 配置 SDK 工具；真机开启 USB 调试并授权，adb devices 应显示 device。
pnpm run native:android
```

再次运行时，已有兼容 client 的开发机只需：

```sh
pnpm run dev:native
# 8081 已被占用时，停止本次启动并显式改用：
pnpm run dev:native --port 18738
```

手机与运行 Metro 的主机接入同一局域网，放行所选 TCP 端口，确认无 AP/client isolation。用已安装的 development client 打开 Expo 输出的 QR/development URL；手动入口使用相同的 `http://<开发机局域网IPv4>:8081` bundle server 地址，显式改口时替换端口。若 launcher 要求 deep link，使用 CLI 输出的完整链接（包含 dev-client scheme 和编码后的 bundle URL），不要把 Web 页面 URL 当作可供 Expo Go 验证 PDF 的入口。手机上的 `localhost` 指手机自身。

多网卡或容器场景应先保证公布的 LAN IP 实际可路由；可在启动进程中设置 `REACT_NATIVE_PACKAGER_HOSTNAME` 为开发机可达的 IPv4，再用同一根命令启动。它只修正通告地址，不建立隧道。远程不可达主机需要用户提供可达网络，不默认接入 tunnel 或第二套服务。Android emulator 可使用宿主网桥地址，iOS simulator 仅 Mac 可用；模拟器结果不能替代真机验收。

native Metro 默认 HTTP 8081，独立于 Web secure-context/HTTPS 验证；不要为连接手机关闭任何 reader CSP 或私有 asset-origin 检查。保留已有 `dev:web` 与 LAN HTTPS 文档。局域网浏览器打开 Demo 也不能证明 native PDFKit/HNPdfView 工作。

### 4. Demo 改动与设备证据

保持系统 picker 和公开 `NativeReader` source/state 接口，只对 native PDF 支持提示与必要集成做小范围调整。阅读区沿用有界高度布局；若窄屏隐藏 Pages 或 Popover，只修正 Demo 容器约束，不复制 renderer chrome。

将 E2E 中合法八页 PDF 配方复用为可重建的 `fixtures/pdf/native-demo.pdf`，记录生成命令、CC0/生成来源、大小与 SHA-256、预期八页及可选文本。生成器不得修改 EPUB fixture 配方或其文件。保留 `rejected.pdf` 为损坏输入检查，不拿它证明成功渲染。新样本路径为待实现目标。

文档说明用 AirDrop/系统文件应用/USB 或 `adb push` 将样本送入设备的可选文件目录，再经 Demo picker 选择；不把源码机路径直接传给手机 reader。下载的文件需先本地保存，reader 仍只接收授权 local URI。

清单记录：设备/OS/client revision、样本 checksum、平台 host 标识证据、ready 后页面与页数、窄屏 Pages 开关/跳页/滚动反馈、长按与调整选区、Popover 贴边/滚动处理、系统菜单抑制、重复点击“高亮”无副作用、Pages 跳转和换源清理、取消选择保留当前阅读、损坏文件稳定报错。身份确认复用 Xcode/Android Studio/React Native inspector 中 `HamsterPdfKit` / `HNPdfView` 的 native view 或调试证据；不新增公共 renderer 属性，也不靠“能看到 PDF”推断具体 host。

开发阶段在可用环境运行 typecheck、受影响测试、双平台 export/graph 校验与 Metro LAN smoke；在有工具链时额外记录 autolinking 和本地编译。真机触摸/菜单/Pages/Popover 检查保留给人类，尚未执行的项目明确 pending。若设备缺失，不标记“通过”或继承 HAM-35 waiver。

## Risks / Trade-offs

- [#8/#9 未合入或合并后接口变化] -> 实施以合入后的 main 为基线；对照已记录 SHA 检查模块、资源和 lockfile，依赖未落地时仅说明阻碍，不拿当前 main 的 unsupported 当交付成功。
- [旧 development client 缺 native host/静态 PDF assets] -> 文档写明重建安装；验证 autolinking 与原生资源输入，保留稳定 unsupported 行为。
- [main 与交接的 Expo 补丁版本不同] -> 使用 lockfile 的 57.0.24 与既有 SDK 57 依赖，不独立升级 SDK/RN。
- [手机接不通 LAN 或端口被占] -> 固定默认端口、显式覆盖；检查路由/防火墙/通告 IP；不将连接问题误记为 renderer 失败。
- [无 Mac、签名或 Android 工具链] -> 只验证可运行的检查，向人类交接平台步骤与 pending 项；不能用导出或模拟器替代真机证据。
- [上游 native selection/menu 仍有设备风险] -> 使用现有规格检查并记录实际症状；设备失败交回上游，不在本期扩展高亮/renderer 实现。

## Migration Plan

依赖 #9/#8 合入后，在现有 Demo 加入上述命令/配置和最小集成改动，更新 lockfile、有效样本与文档。运行自动化检查并把设备清单交人类。无需数据迁移、发布或部署；回退仅撤销本期 Demo 入口、配置和文档改动，不回滚用户文件或上游 renderer。

## Open Questions

无需要改变范围或验收口径的未决产品问题。设备型号、可用签名环境及 LAN IP 由实际执行者选择；当前未提供，均不可视为已验证。依赖合并后接口保持不变仍是实施前需核实的假设。
