# 带未完成项归档说明

记录日期：2026-10-07。

## 用户授权与验收边界

用户明确确认“同步并带未完成项归档”。本次归档是行政性收尾，不代表全部实现完成、平台验收通过或可发布；主规范中的 SHALL 仍是目标要求，不是已有运行时验收证据。

用户仅明确豁免本次真实 iOS 验证，包括涉及真实 iOS Safari 和真实 `WKWebView` 的行为验证。豁免不等于验证通过，不得用 Playwright WebKit、Linux 静态检查、模拟验证或 bundle/export 成功代替真实 iOS 证据，也不扩大到真实 macOS Safari、真实 branded Edge、Android 验证或任何尚未完成的实现工作。主规范中的平台、安全与实现要求不因此降低。

## 实际进度与证据范围

- `tasks.md` 保留原始勾选状态：19 项已勾选、26 项未勾选；本说明不变更任何任务 checkbox。
- 4A/4B 已有部分实现，并有静态检查、JS 验证以及 Linux JVM/Robolectric 59 项测试证据，不能描述为“完全没有实现”。这些证据只覆盖对应代码、协议和测试环境，不是安装后的 Android WebView 行为证明，也不使 4A/4B 整体完成。
- source-free `WKWebView` spike 工程已经具备，并已进行 Linux 静态检查；当前无 Mac 环境，未运行真实 `WKWebView` spike。restricted-file security-origin、named-world relay 和 synthetic preflight 不得称为已在真实 iOS 上通过。
- Web 已有自动化 baseline。另有范围受限的 export/exact2、缺 host asset 的 Chromium 检查和开发服务器 smoke 通过记录；这些限定证据不代表 3.6 的其它门禁关闭，不把整项 3.6 改成完成。
- 4C/4D 尚无 publication source preparation/transfer/render 实现。归档不解锁 4C/4D 的前置安全门禁，不授权源文件 I/O，也不伪造 actual publication CSP、transfer 或 renderer 行为证据。

## 保留的未完成项

3.6 中其余真实平台与 release 证据仍未闭合；真实 iOS 项仅按本次用户授权豁免，不记录为成功。真实 macOS Safari、真实 branded Edge、Android 安全与行为验证、完整 package raw gate 或正式基础设施例外等仍保留各自要求。范围受限的 Web 检查不扩大为完整 release 验收。

4A/4B 的剩余实现及行为证明、4C/4D 的 source transfer/render、4E 生命周期与平台证据、旧引擎依赖清理、consumer/pack 验证，以及其它 release、文档和验收剩余工作，继续按 `tasks.md` 的未勾选项保留。真实 iOS 验证豁免不免除 iOS 实现，也不免除其它平台工作。

本次只同步规范并记录上述边界；归档后的历史记录不得被解释为实现或 release 完成。旧 `add-cross-platform-epub-reader` 变更文档不在本次同步写入范围内。
