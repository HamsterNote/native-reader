# Tasks

## 收口决定（2026-10-19）

本次按人类决定不做设备验证：tasks 5.1–5.3 及 task 2.2 的默认 8081 readiness 均为 **waived：人类决定不做设备验证（2026-10-19）**，不是 pass，以下 checkbox 保持未勾选。2.2 的实现、显式端口 18738/18739 readiness 与失败路径已有自动化记录；默认 8081 被另一项目 Expo 占用，未实跑 readiness。5.x 未验范围含 iOS PDFKit host 挂载/行为、系统菜单抑制、选区手柄及 Pages/Popover 触屏交互，Android HNPdfView 隔离 pdfjs 及同项行为；不将服务端编包成功解释为真机通过。

本次交付边界：Web（EPUB/Web PDF）已验收；自动化与服务端接入检查通过；设备未验（waived）。这是 HAM-56 本次独立决定，不继承 HAM-35 waiver。详细证据与限制见 `report.md` 和 `docs/validation.md`。原任务中的 pending 表述为未验时的默认规则，本次按此处明确决定收口。

## 1. 依赖与 development client 配置

- [x] 1.1 以 #9/#8 合入后的 main 为实施基线，对照 proposal 的分支 SHA，核实 `HamsterPdfKit`、`HNPdfView` 的注册/能力与 Android PDF asset 输入仍存在；验收为记录 main revision 和两条 host 接口核对结果，未合入则记录依赖阻碍，不执行上游合并任务。
- [x] 1.2 复用 #8 Demo 的 `expo-dev-client` / `@hamster-note/pdfkit` workspace 依赖，补齐 SDK 57 development scheme、iOS bundle identifier 和 Android package，保留 `web.output=single` 与 Metro 平台 resolver；用冻结 lockfile 安装和 Expo config 解析确认版本、标识及平台配置正确，忽略自动生成的 Demo 原生工程而不删除已有用户文件。
- [x] 1.3 补齐 autolinking/静态资源集成核验：确认 iOS Expo module 能被发现，Android reader RN package 能带入 `HNPdfView`，Gradle PDF assets 来源为本地受检 runtime；验收为 autolinking 结果和资源输入记录，在对应工具链可用时实际编译，缺少环境明确未验证。

## 2. 根目录启动与首次本地构建入口

- [x] 2.1 新增根目录 `native:prepare`，复用既有受保护的 Foliate/PDF staging/check 和 PDFKit 包构建，不手改生成物或安全 gate；从干净依赖准备后运行该命令，以 manifests/check 成功、必要输出存在及失败时非零退出作为完成证据。
- [ ] 2.2 新增根目录 `dev:native`，准备成功后从现有 Demo 启动 Expo `--dev-client --lan`，默认 8081 且 `--port 18738` 覆盖而不重复传参；验收为两种端口的启动日志和 Metro readiness smoke，端口占用/prepare 失败不静默换口，退出时清理本次测试启动的进程。
- [x] 2.3 新增根目录 `native:ios` / `native:android`，prepare 后分别执行 Expo 本地 `run:ios --device --no-bundler` / `run:android --device --no-bundler` 构建安装流程；验收为入口参数检查及在可用的 Mac/Android 环境中的实际本地构建安装记录，无环境只交接步骤，不用 export 冒充构建成功。

## 3. Demo 最小接入与合法样本

- [x] 3.1 在现有 Demo 更新 native PDF 支持提示，保持系统 picker、cache copy、包根 `NativeReader` 与受控 source/state 接口；针对 PDF 候选 URI 传递、取消保留 source、缺 host 的稳定 unsupported 及无私有模块导入运行受影响的 Demo/reader 测试，保留原有 EPUB 路径和安全行为。
- [x] 3.2 复用现有 `pdf-lib` 八页可选文本配方，提供 `fixtures/pdf/native-demo.pdf` 的确定性生成入口与来源/许可、SHA-256、大小和八页预期记录；验收为重新生成校验一致、PDF 可解析且文本/页数正确，保留损坏 `rejected.pdf`，检查未改变 EPUB 样本与生成配方。

## 4. 文档与自动化集成交接

- [x] 4.1 在根 README 和 `docs/validation.md` 落地 design 中的最小命令、首次 client 编译安装/重建条件、iOS 16.4+/Mac/Xcode/CocoaPods/签名和 Android JDK/SDK/adb 环境、Expo Go 限制；验收为所有列出入口均存在且命令/参数一致，不要求 EAS 或新增打包体系。
- [x] 4.2 补齐同 LAN、IPv4/防火墙、默认 8081 与 `--port 18738`、CLI QR/deep link/手动 bundle URL、非手机 localhost、必要时通告主机地址及 Web HTTPS 与 native Metro 的区别；交付样本传入设备的方法和逐项真机清单，确认不引导关闭 CSP/asset-origin gate。
- [x] 4.3 运行 `pnpm run typecheck`、受影响文件 lint/格式检查、Demo/reader 针对性测试、`pnpm run bundle:ios`、`pnpm run bundle:android` 和 `pnpm run test:native-export`；记录结果与 native graph/host 分流证据，保留 Web 现有入口并做相关回归，不将自动化通过解释为设备通过。

## 5. 人类设备验收（明确不由编码 agent 代验）

- [ ] 5.1 人类在兼容 development client 真机上，从仓库根执行 `pnpm run dev:native` 并以同 LAN 设备连接；记录设备/OS/client revision、实际端口与 Demo 成功加载，确认验收口径一“根目录一条命令起 Expo，native 端可连”。缺设备或不可达网络则保持本项 pending。
- [ ] 5.2 人类在 iOS 真机打开文档中的本地八页 PDF，记录 PDFKit native view 身份、首屏/ready/页数、窄屏 Pages 打开/跳页/返回与滚动当前页；检查长按和选区手柄、Popover 贴边和滚动处理、系统菜单抑制、重复“高亮”无数据副作用、换源/Pages 清理和取消保留阅读。按验收口径二与现有 PDF specs 逐项记录结果，缺设备保持 pending。
- [ ] 5.3 人类在 Android 真机用同一样本执行同一清单并记录 `HNPdfView` 隔离 pdfjs 身份、Pages 与 Popover 结果，同时检查损坏 PDF 的稳定错误及重新选择恢复；与 iOS 分开留证，失败交回上游维护者，缺设备保持 pending，不沿用 HAM-35 waiver。

## 6. 结果归档到交接文档

- [x] 6.1 在验证文档分别汇总自动化、autolinking/本地编译、两平台人类验收的真实结果及未执行原因，并运行 `openspec validate enable-expo-native-pdf-demo --strict`；验收为没有以 JS/export 结果填写真机通过，也没有高亮实现、EPUB 改动、EAS/发布或第二套打包体系的范围扩张。
