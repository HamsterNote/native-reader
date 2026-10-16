# Android Physical-Device Evidence

Status: **BLOCKED - NO DEVICE OR AVD AVAILABLE**

This record must not be treated as acceptance evidence until every field below
is completed from an actual device run and Status is changed to `COMPLETE`.

| Field                                                      | Result     |
| ---------------------------------------------------------- | ---------- |
| Date/time (UTC)                                            | INCOMPLETE |
| Tester                                                     | INCOMPLETE |
| Commit SHA                                                 | INCOMPLETE |
| Device model                                               | INCOMPLETE |
| Android/API version                                        | INCOMPLETE |
| Android Studio/Expo versions                               | INCOMPLETE |
| Build command and result                                   | INCOMPLETE |
| Install/launch result                                      | INCOMPLETE |
| Network disabled during offline checks                     | INCOMPLETE |
| `valid-epub2.epub`: chapters, NCX TOC, media               | INCOMPLETE |
| `valid-epub3.epub`: chapters, nav TOC, media               | INCOMPLETE |
| `malformed.epub`: readable error, host remains usable      | INCOMPLETE |
| `fixed-layout.epub`: fixed layout, no reflow control       | INCOMPLETE |
| `scripted-external.epub`: no script/network execution      | INCOMPLETE |
| `large-representative.epub`: open duration and peak memory | INCOMPLETE |
| MOBI/KF8, FB2/FBZ: open, TOC, flow, replacement            | INCOMPLETE |
| CBZ: image navigation, fixed layout, no flow selector      | INCOMPLETE |
| PDF/mislabelled/DRM input: categorized rejection           | INCOMPLETE |
| Initial CSP: script and same/cross-origin canaries         | INCOMPLETE |
| Exact private bridge, host identity, invalid messages      | INCOMPLETE |
| 32 MiB boundary and contiguous digest-checked transfer     | INCOMPLETE |
| Reader-owned cleanup; host source untouched                | INCOMPLETE |
| Background/foreground lifecycle result                     | INCOMPLETE |
| Evidence links (logs/screenshots/video)                    | INCOMPLETE |
| Deviations/issues                                          | INCOMPLETE |

## 2026-09-19 attempt

- `pnpm run bundle:android`: passed.
- `/home/zhangxiao/Android/Sdk/platform-tools/adb devices -l`: executed; no
  attached device or running emulator was listed.
- Device-level EPUB `ready` verification was therefore not executed and this
  document remains non-acceptance evidence.

Use `pnpm run bundle:android` for the platform bundle smoke before creating the
device build. Record measured values rather than subjective terms such as
"fast."

## Foliate continuation boundary

The native adapter currently binds only; source preparation/transfer/rendering
remain blocked by the ordered pre-source safety gates. Do not fill these rows
from mocked tests or JavaScript bundle/export results. iOS requires actual
restricted-file origin/named-world relay and synthetic initial-CSP preflight;
Android requires installed WebView listener proof, clean reload, and final
private-port behavior. Native reflow starts scrolled when implemented; Android
pagination/text-selection recovery must retain scrolled in the same session.
