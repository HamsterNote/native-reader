# Partial implementation evidence

Base: native-reader `45562da04e0af2eb80694537bc5d962ecd320f23`;
Foliate remains `78914aef4466eb960965702401634c2cb348e9b1`.

## Design blocker requiring a decision

The pinned `vendor/foliate-js/paginator.js:979` creates two style elements.
Rules are supplied only through `setStyles()` at line 1100; the reader never
calls that method with CSS. Thus there is no actual injected stylesheet rule
to inspect for task 4.2. Actual Foliate layout styles are assigned to element
style attributes by `setStylesImportant()` (for example, `html` receives
`overflow-wrap: break-word !important` in paginated flow at line 325).

The specification explicitly requires Foliate-injected style elements, while
the design forbids test-injected CSS. Implementation of that assertion is
paused pending owner approval of either a corrected assertion against real
Foliate layout styles, or an intentional production reading stylesheet.
No assertion has been silently substituted and no test CSS was injected.

## Commands and results

- `multica attachment download 01a14e71-3ca7-7f28-b0e7-d7fcada95aef -o ./attachments`: downloaded; original planning files restored with tar.
- `pnpm install --frozen-lockfile`: passed (existing dependency build-script notices).
- `pnpm run foliate:submodule:bootstrap`: passed; unchanged pin above.
- `pnpm run foliate:runtime:stage`: passed; transient generated runtime, not complete platform synchronization.
- `pnpm run test:foliate-runtime`: 5/5 passed, including quiet startup, explicit diagnostic success/failure and missing-capability cases. An earlier run failed on the old auto-probe expectation; the updated regression then passed.
- `pnpm --filter @hamster-note/native-reader exec jest --config ../../jest.config.cjs --rootDir . --runInBand NativeReader.web.test NativeReader.native.gate.test nativeFoliateProtocol.test webSecurity.test`: 4 suites, 85 tests passed.
- `pnpm run fixtures:generate`: 37 deterministic fixtures generated.
- `pnpm run fixtures:check`: 37 fixtures and Foliate format parser checks passed.
- `pnpm run typecheck`: passed for package and consumer.
- `pnpm run lint`: passed for workspace, package and consumer.
- `openspec validate fix-native-reader-diagnostics-blockers --strict`: passed.

## Acceptance still pending

Neither delta has complete browser acceptance. The independent consumer entry
is only a scaffold; the strict E2E test is not yet implemented. No claim of
zero browser errors, successful computed styles, or native-device support is
made. Adversarial CSS/script tests, Firefox rejection, runtime/public/native
asset synchronization checks, full build and full test remain pending.
No push, PR, tag, release, npm publication or WebBase modification occurred.
