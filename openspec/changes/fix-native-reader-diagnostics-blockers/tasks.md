# Tasks

## 1. Default diagnostics and source authorization

- [x] 1.1 Separate optional intrusive diagnostics from startup/source authorization in `scripts/stage-foliate-runtime.mjs`; add a trusted host-owned default-off option through existing authenticated startup handling. Verify runtime tests show default startup settles without any canary attempt, explicit opt-in still runs the differential probe, and publication messages cannot enable it.
- [x] 1.2 Preserve required API/embedded-CSP/configuration checks, stable unsupported outcomes, generation disposal and existing native pre-source/private-bridge gates. Verify absent capability and failed explicit diagnostics deny source I/O; verify skipped diagnostics are never reported as behavioral proof. Run `pnpm run test:foliate-runtime` and relevant package gate/bridge tests.

## 2. Publication style compatibility

- [x] 2.1 Add the design's style-only `'unsafe-inline'` allowance and version increment to `packages/native-reader/src/foliate-csp-policy.json`. Add a policy regression comparing all non-style directives to the baseline, including exact `script-src 'none'` and `connect-src 'none'`; verify policy and runtime tests pass.
- [x] 2.2 Extend `scripts/epub-fixture-recipes.mjs` and deterministic fixture generation with the author attribute/style-element book described in design; verify `pnpm run fixtures:generate` followed by `pnpm run fixtures:check` and ensure no remote URLs occur in the positive fixture.
- [x] 2.3 Extend separate adversarial CSP tests for script/event-handler rejection and CSS import/image/font HTTP(S) denial, while preserving iframe sandbox, navigation, bridge and source ownership assertions. Verify `pnpm run e2e:web -- tests/e2e/foliate-reader.spec.ts --project=chromium --workers=1` and Firefox unsupported-before-I/O coverage; record deliberate negative-test errors separately.

## 3. Generated runtime consistency

- [x] 3.1 Bootstrap the existing pinned Foliate submodule with `pnpm run foliate:submodule:bootstrap` and confirm `pnpm run foliate:submodule:check`; regenerate runtime and consumer public assets through `pnpm run foliate:runtime:stage` and `pnpm run foliate:web-runtime:sync`. Verify the pin remains `78914aef4466eb960965702401634c2cb348e9b1` and generated Web/native policy versions/hashes match their manifests.
- [x] 3.2 Verify `pnpm run foliate:runtime:check`, `pnpm run foliate:web-runtime:check`, `pnpm run test:foliate-runtime`, `pnpm run test:foliate-web-runtime`, and relevant native-runtime browser tests. Document platform-specific unverified behavior without claiming browser simulation proves native-device behavior.

## 4. Independent strict consumer acceptance

- [x] 4.1 Add an isolated public-API consumer page and `tests/e2e/reader-diagnostics-consumer.spec.ts` served by the test server. Register unfiltered console.error/requestfailed/pageerror listeners before navigation, including nested frames. Verify the fixture is rendered through real Foliate runtime, with no Demo UI dependency, mocks, route aborts, or diagnostic exemptions.
- [x] 4.2 Implement same-source open/close/reopen without page reload, ready/teardown waits and computed-style assertions for author color `rgb(17, 34, 51)`, author italic rule, actual Foliate pagination styles and a supported flow/layout update. Record real properties/geometry on both opens without injecting test CSS. Run an isolated exported-runtime differential without publication `'unsafe-inline'`, requiring author assertions to fail, then restore and pass; record both commands/results.
- [x] 4.3 Run `pnpm run e2e:web -- tests/e2e/reader-diagnostics-consumer.spec.ts --project=chromium --workers=1`; verify both complete loads and final teardown yield total console.error=0, requestfailed=0, pageerror=0 and zero attempted probe URLs, without allowlists. Retain command output and traces on failure; this single test must expose separate diagnostics and style assertion results.

## 5. Local verification and handoff

- [x] 5.1 Run `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `pnpm run test`; resolve failures attributable to this change and record unrelated/environment failures explicitly. Verify no WebBase edits, Foliate pin changes, non-style CSP relaxation or release side effects appear in the diff.
- [x] 5.2 Deliver a concise implementation summary with exact commands/results, independently assessed delta 1/delta 2 acceptance, policy trade-off reference, changed files and unverified items for owner review. Do not publish npm, tag, release, repin WebBase or open an unnecessary PR; main integration and the final pin-ready SHA follow owner acceptance and authorized delivery.
