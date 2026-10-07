# Source-free spike runner 合同与验证边界

`run-spike.py --output-parent <外部现存canonical真目录> --runtime-id <精确iOS runtime identifier>` 为唯一实际Mac入口。Python标准库，无pnpm/RN/Pods/stage/pack，不生成rootmanifest或修改production source。Linux调用必然fail-closed，不能关闭4B.3。

## 输出/authority

- outputparent绝对、canonical、所有parent无symlink；不能是workspace/authority的ancestor或descendant。Mac常见`/var` alias须先转换为真实`/private/var`路径。
- 固定current manifest SHA `4231493d9742d74e9c78704cae60865f01348d41d4c69f1e290ce296a766aaa8`。
- `--incident-anchor`可覆盖本机旧恢复路径，但必须提供**原事故anchor bytes**，SHA仍固定`ed712e6627a56999b9a7a393bb481d35647daf9b4604be184f5cf4ae55dc836a`。不提供/不匹配则preflight失败；不以当前manifest生成“新anchor”。
- fresh0700根，独立deriveddata/xcresult/evidence/home/tmp。启动任何Apple命令前persist完整authority树digest、pins、源码解析inventory。
- `apple/`及实际`HNSecureWebViewFoliateRuntime.bundle/foliate-runtime/native/`为required；写任何输出前检查canonical/no-link及`manifest.json`、`reader.html`、`bootstrap.js`为真实regular文件。缺required即稳定preflight INCOMPLETE，无stage/fallback生成。
- digest涵盖required `apple`（直接relay/runtime在内）、`android`、`secure-webview`、相关production scripts/spike工程与所有runner文件、rootmanifest/package/podspec、workflow及原anchor。包含原始模式/树/空目录/文件全bytes，reject links；finally逐项复核。
- ignored `packages/native-reader/foliate-runtime`为optional：before存在则完整模式/类型/字节摘要且finally相同；before缺则显式`present:false`，finally必须仍absent。突然出现、消失或变成link均INCOMPLETE，不把clean checkout假装拥有ignored生成目录。
- 不在finally删除证据输出。CI不chmod checkout源，不改变/伪装真实mode；before/finally使用原始mode。任何source内容或mode漂移均INCOMPLETE，写权限错误保留失败，不通过chmod补救。保护为检测+fail-closed，不宣称只读mount或对抗恶意同UID。

## Simulator/进程范围

runtime必须在simctl JSON里exact identifier/isAvailable；仅supportedDeviceTypes交集内iPhone。schema无兼容表则未知/拒绝，不退化到booted。

simctl创建独立UUID，明确在before列表中不存在，仅登记成功create返回的合法UUID。任何失败finally仅shutdown/delete这个UUID并复核删除；create超时/未知返回保留creationUnknown，不按名称查找认领、也不删除别人simulator。

xcodebuild test destination=`platform=iOS Simulator,id=<ownedUUID>`，独立derivedData/resultBundle，关闭parallel testing，help实际宣告的package自动resolve禁用flags，且静态project拒绝remote packages/build scripts/RN/Pods。每command短deadline/原始stdout/stderr/exit保存；own unreaped Popen session/group timeout KILL+reap。总run预算2400s、xcodebuild单command最多1800s，cleanup独立90s，不延长测试deadline。

限制：是本子进程session/group控制，不是Mac cgroup/no-escape证明；xcodebuild非组内服务/Simulator后台服务不归process-group控制。cleanup UUID只影响本次创建的设备。host硬杀/SIGKILL或卡住FS调用无法保证finally执行；这类缺证据必须INCOMPLETE，不能猜成功。

## xcresult真实性与gen22对齐

result生成前仅保存version/help及tool paths；**xcresulttool仅help探测**，没有不带`--path`的summary/tests/export/schema调用。`HostSpike.xcresult`存在后才按已探测help使用modern actual API：`get test-results summary/tests --path <actual bundle>`、`export attachments --path <actual bundle> --output-path <fresh export> --test-id <approved source identifier>`。未支持/JSON结构不匹配则保存原xcresult，INCOMPLETE。没有legacy/猜flag fallback。

解析实际Objective-C `@implementation` 的无参数`- (void)test...`清单，拒Swift/重复/空inventory。父合流核准实际5方法，不能从预设数字生成XML成功。现代tests树必须exact inventory、不重跑/parameterized unknown节点、summary计数类型和对应状态一致；失败/skip/非zero exit不能PASS。

静态合同持久校验pageProbe callback注册→pageMarker evaluate→`waitForExpectations:@[pageProbe] timeout:5`→clear顺序；evaluate helper只允许`waitForExpectations:@[done] timeout:5`。屏蔽注释/JS字符串后检查实际语句；fixtures包含删除wait、提前clear、helper全量wait三个拒绝mutation，不修改工程lane源。

gen22 attachment采用`schemaVersion:1`、`test:-[Class testMethod]`、`execution:hosted-xctest-real-wkwebview`、`scope:source/publication-free`，包含events/rawMessages/acceptedMessages/failures/assertionsFailed。collector从每test export实际JSON内容识别，不依赖UUID重命名后文件名；每test恰好一份，与actual xcresult identifier相符。console前缀仅gen22备份，**此runner不从日志恢复PASS**。

- `testCanonicalBundleManifestClosure`：资源闭包hash/集合实测，tuple/preflight/bind明确N/A，不造字段。
- 其余4方法：真实raw WK frame/security origin/currentURL、actual-preflight-outcome、native-bind-dispatch及production-accepted-message保存；PASS要求actual file/emptyhost/0/main/namedworld/exactURL条件，matching commandId0 bridge-bound ack与acceptedMessages一致。
- 正常Failed测试可以因早期preflight失败没有bind/tuple，按原attachment实际缺失记录并判FAIL；崩溃/缺teardown attachment/缺JSON/count不明则INCOMPLETE。

生产relay当前两处顶层NSString使用`NSJSONSerialization dataWithJSONObject:options:0`，工程lane已用`preflight-invocation-exception`/`bind-dispatch-exception`及XCTFail保留可能的同步异常。runner不会修生产、改flags或伪造回调；完整实际Failed+attachment判FAIL，缺attachment判INCOMPLETE。Linux只验证这个分流，不断言Mac必然异常。

工程lane文件已只读检查得到5个方法，但Xcode编译/现代schema/目标runtime设备兼容仍待Oracle gate后真实Mac核验。静态check只检查结构，不作编译器或安全审计替代。

## CI/本机验证

workflow只`workflow_dispatch`，contents:read、checkout无持久凭据；Linuxfixtures/static先行，Mac再fixture/static和唯一run；always上传原xcresult/raw logs/JSON及CLI失败日志。不触碰已有tarball workflow，不安装pnpm依赖或触发prepack。

CI须预配置`NATIVE_READER_INCIDENT_ANCHOR_BASE64`原anchor secret；找不到即失败。runtime_id必填且simctl实际匹配，找不到无fallback。

Linux命令（不使用尚在写的工程的fixture）：

```text
python3 -E -s -B packages/native-reader/apple-host-spike/scripts/test-spike-runner.py
python3 -E -s -B packages/native-reader/apple-host-spike/scripts/test-spike-contract.py
```

fixture数据全部模拟，只证明runner路径/进程/结果门槛；不称WKWebView/Robolectric/Apple实际PASS。没有本轮xcodebuild/simctl/stage/pack真实调用，不关闭4B.3、不启动4C/4D。

证据标签：`VERIFICATION_RESULT.json`是原28项历史记录，保持原字节，不改写为整改后成功。`VERIFICATION_RECONCILED.json`为**current**，显式supersedes旧28/29项记录并给出当前fixture count、源码hash与命令；所有标签仅Linux fixtures/static-only，不是Mac PASS。

API参考（实现仍以目标Mac help/schema为准）：https://keith.github.io/xcode-man-pages/xcresulttool.1.html ； https://keith.github.io/xcode-man-pages/xcodebuild.1.html 。package flags不由上述man页保证，必须target help实际含有才执行。
