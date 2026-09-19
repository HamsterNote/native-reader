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
| `fixed-layout.epub`: explicit unsupported result           | INCOMPLETE |
| `scripted-external.epub`: no script/network execution      | INCOMPLETE |
| `large-representative.epub`: open duration and peak memory | INCOMPLETE |
| Background/foreground lifecycle result                     | INCOMPLETE |
| Evidence links (logs/screenshots/video)                    | INCOMPLETE |
| Deviations/issues                                          | INCOMPLETE |

## 2026-09-19 attempt

- `corepack yarn bundle:android`: passed.
- `/home/zhangxiao/Android/Sdk/platform-tools/adb devices -l`: executed; no
  attached device or running emulator was listed.
- Device-level EPUB `ready` verification was therefore not executed and this
  document remains non-acceptance evidence.

Use `yarn bundle:android` for the platform bundle smoke before creating the
device build. Record measured values rather than subjective terms such as
"fast."
