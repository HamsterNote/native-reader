# Tasks

## 1. 共用 chrome 布局

- [x] 1.1 在 `ReaderChrome.tsx` 重排标题、章节导航与模式区域，按根容器宽度适配宽窄布局，添加长标题单行省略与完整可访问名称；以 320/390/宽容器组件布局用例及根 style/testID 原断言验证，保持 viewport 子树身份。
  Evidence: `pnpm --filter @hamster-note/native-reader exec jest --config ../../jest.config.cjs --rootDir . --runInBand ReaderChrome.test NativeReader.web.test` -> 2 suites / 75 tests passed; 320/390/1000 layout and viewport identity assertions passed.
- [x] 1.2 将 Scrolled/Paginated 改为统一底板的分段控件，补足按压、键盘焦点、选中和禁用样式；通过原 flow 组件测试及新增视觉/焦点检查验证，不更改 labels、roles、受控选中、实际 flow 确认和 fixed/status 优先级。
  Evidence: focused Jest -> 76 passed; `pnpm run e2e:web --workers=2` -> 61 passed / 47 browser-specific skips. Chromium Tab focuses flow with border rgb(40,115,76), selected background follows actual flow; original ack/model, disabled callback, unavailable flow and fixed/status priority tests preserved. Press feedback verified by component test.

## 2. 目录与视口

- [x] 2.1 增加默认收起的 `Toggle table of contents` 开关与 expanded 状态，两条 TOC 路径共用显隐逻辑并保留空中立数组优先级；通过组件测试验证默认、反复开合、无目录、source loading/ready 重置和隐藏条目不可访问。
  Evidence: focused Jest command from 1.1 rerun -> 2 suites / 76 tests passed, including repeat toggles, empty legacy/neutral TOC, loading/ready reset, remount and inaccessible hidden entries. Web explicitly supplies `aria-expanded` alongside native state.
- [x] 2.2 保留限高 160 的独立目录 ScrollView 与条目层级/导航语义，成功跳转保持展开，unresolved 保持位置并反馈；更新 legacy/neutral、nonlinear、recoverable 既有用例先展开再断言，确保 label 和业务断言未丢失。
  Evidence: focused Jest command from 1.1 -> 76 passed; original neutral/legacy ordering, depth, nonlinear and recoverable callback assertions retained, with explicit toggle prerequisites and open-state assertions after activation.
- [x] 2.3 调整必要的 chrome、Web/native 宿主及 Demo 高度约束，保证正文 minHeight 240 和短宿主可滚动到达正文；通过 Web 集成测试验证目录开合/resize 不重建 renderer、不改变 location/flow，后续浏览器量测真实高度与独立滚动。
  Evidence: focused Jest -> 76 passed; `pnpm run e2e:web --project=chromium --grep 'reader chrome at' --workers=1` -> 4 passed (45.8s). Real iframe >=240, TOC <=160, independent scroll, no overlap, same Foliate renderer after toggles/resize. Root minimum follows actual chrome onLayout height; no host/engine modifications needed.

## 3. 样本与自动回归

- [x] 3.1 按现有生成机制新增 `fixtures/epub/reader-chrome-stress.epub`（120+ 字符长标题含连续长词、60+ 项且三级嵌套目录、末项可跳转），补齐 manifest 的生成来源/许可/校验和/预期行为；通过 `pnpm run fixtures:check` 验证确定性与导航可用。
  Evidence: `pnpm run fixtures:generate` -> Generated 37 deterministic multi-format fixtures. `pnpm run fixtures:check` -> Verified 37; Foliate chrome stress verified 202-character title, 63 TOC entries, 3 levels and final section 62. `node --test scripts/fixture-corpus.test.mjs` -> 3 passed. Manifest includes generated provenance, CC0, byte count and SHA-256.
- [x] 3.2 更新 `NativeReader.web.test.tsx` 和 `tests/e2e/foliate-reader.spec.ts` 的目录前置展开操作，保留 flow ack、pending 导航互斥、首尾、source 替换、错误恢复等原覆盖；运行相关组件测试与既有 Web 回归，确认无 label 兼容回归。
  Evidence: `pnpm run test` (after package build prerequisite) -> 24 library suites / 352 tests and 2 Demo suites / 18 tests passed; release lifecycle/staging gates passed. `pnpm run e2e:web --workers=2` -> 61 passed / 47 browser-specific skips. No original tests removed; navigation arrows are discovered through unchanged chapter labels; TOC tests explicitly expand first; selected-color assertions updated to the new documented visual.
- [x] 3.3 为真实 Chromium 增加宽屏、390 与 320 窄屏/320 容器的 chrome E2E，验证 stress 样本标题、目录末项可达、展开/收起、fixed/no-toc、正文至少 240 高度、无 chrome 横向溢出和正文未被覆盖；运行 `pnpm run e2e:web` 并记录 Chromium 渲染与 Firefox fail-closed 结果的不同含义。
  Evidence: final `pnpm run e2e:web --workers=2` -> 61 passed / 47 skipped (1.3m). Reader widths 776/352/282/320, iframe heights 394/240/240/240, TOC height 160, scrollHeight 3064, scrollTop 2905. Five added Chromium cases include exact 679/680 breakpoint checks. Firefox passes its rejection test only; unsupported rendering cases skip. PNG/JSON/accessibility evidence generated; see verification.md.

## 4. 文档与交接验收

- [x] 4.1 更新根 README、包 README、`docs/validation.md`，写入 design 的现有 `apps/demo` Web 启动步骤、默认 URL/端口冲突处理、样本路径、7 项人工点检及旧/新增 accessibility labels；从干净 checkout 逐条执行，记录实际运行入口和点检结果，不依赖截图外壳。
  Evidence: fresh checkout setup commands and outputs are listed individually in verification.md. `pnpm run dev:web --port 18738 --https` with documented task-local TLS files -> real LAN HTTPS 200; Chromium 153.0.8010.12 passed unchanged probe, stress selection, keyboard toggles, last TOC entry and malformed-to-valid recovery at 1440/390/320; pageErrors=[]. Default localhost HTTP, port conflicts, secure LAN HTTPS, all sample paths, seven checks and label compatibility are documented. `ham38-dev-smoke.json` / screenshots attached at handoff.
- [x] 4.2 执行 `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run test`、`pnpm run bundle:ios` 与 `pnpm run bundle:android`，修复本次回归；记录命令结果及无法执行的具体环境原因，bundle 不算设备验证。
  Evidence: final `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check` -> exit 0; format reports all matched files use Prettier. `pnpm run test` -> 24/353 library + 2/18 Demo suites/tests passed after `pnpm --filter @hamster-note/native-reader run build`; existing release safety/staging/lifecycle gates pass, 2 Windows-only cases skip on Linux. `pnpm run bundle:ios` and `pnpm run bundle:android` -> native reader and secure host graph verified, Web adapter excluded. Both are export/build evidence, not device passes. Additional `pnpm run supply-chain:check` -> pinned revision and 381 files verified.
- [x] 4.3 按 design 人工清单提交宽窄屏截图、240 高度与 TOC 滚动记录、键盘/读屏点检和可用 native 环境结果；对无法实际点检的 native 平台明确标记未验证，保留原安全 gate；核对每条 delta 场景与证据映射，并以 `openspec validate polish-reader-chrome --strict` 验证最终规划一致性。
  Evidence: `pnpm run e2e:web --workers=2` -> 61 passed / 47 capability skips; post-TLS default-HTTP `pnpm run e2e:web --project=chromium --grep 'reader chrome|switches layout' --workers=2` -> 5 passed (44.8s). LAN HTTPS Chromium smoke -> 200, secure context, unchanged probe passed, 3 PNGs and JSON geometry/AX snapshots, Enter/Space/Tab focus and error recovery verified, zero page errors. Final `openspec validate polish-reader-chrome --strict` -> valid. All 14 delta scenarios mapped in verification.md. `adb devices -l` -> command not found; `command -v xcrun` -> unavailable on Linux: iOS/Android real-device touch and VoiceOver/TalkBack UNVERIFIED. Browser AX expanded state is verified; actual spoken screen-reader output is UNVERIFIED and remains human acceptance, not claimed from AX attributes or bundles. tmux <tmux-session> (<tmux-session-id>), HTTPS LAN 192.0.2.10:18738, task-local logs and evidence attached.

旧 `add-cross-platform-epub-reader` 归档为独立历史维护事项，不是上述任务的前置依赖。Apply 已完成，等待人工验收；保持所有代码与 change 产物在本地，未提交、推送、创建 PR、归档或同步主规格。任务证据的早期运行次数保留原始结果，最终 gate / 353+18 Jest / 77 focused tests 与平台边界以 verification.md 为准。
