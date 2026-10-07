/**
 * 纯单测（node:test，无浏览器、无 Playwright）：直接负控
 * `resolveBrowserRuntimeEvidence` 的关键语义。
 *
 * 刻意命名为 `*.focused.ts` 而非 `*.spec.ts` / `*.test.ts`，以免进入 Playwright
 * 的 testDir 清单。运行方式：
 *   node --test tests/e2e/browserRuntimeEvidence.focused.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBrowserRuntimeEvidence } from './browserRuntimeEvidence.ts';

const REGISTRY_DEFAULT = '/registry/expected/chromium';

test('explicit executablePath wins and never calls the registry default API', () => {
  let registryCalls = 0;
  const evidence = resolveBrowserRuntimeEvidence({
    browserName: 'chromium',
    version: '1.2.3',
    launchOptions: { executablePath: '/custom/pinned/chrome' },
    readRegistryExecutablePath: () => {
      registryCalls += 1;
      return REGISTRY_DEFAULT;
    },
  });

  assert.equal(evidence.executablePath, '/custom/pinned/chrome');
  assert.equal(evidence.executablePathSource, 'launchOptions-configured');
  // explicit 与 registry 默认不同，且证明完全没有调用默认 API。
  assert.notEqual(evidence.executablePath, REGISTRY_DEFAULT);
  assert.equal(registryCalls, 0);
});

test('undefined executablePath uses the registry default and marks it expected', () => {
  let registryCalls = 0;
  const evidence = resolveBrowserRuntimeEvidence({
    browserName: 'chromium',
    version: '1.2.3',
    launchOptions: {},
    readRegistryExecutablePath: () => {
      registryCalls += 1;
      return REGISTRY_DEFAULT;
    },
  });

  assert.equal(evidence.executablePath, REGISTRY_DEFAULT);
  assert.equal(evidence.executablePathSource, 'registry-default-expected');
  assert.equal(registryCalls, 1);
});

test('empty-string executablePath fails loudly instead of silently succeeding', () => {
  let registryCalls = 0;
  assert.throws(
    () =>
      resolveBrowserRuntimeEvidence({
        browserName: 'chromium',
        version: '1.2.3',
        launchOptions: { executablePath: '' },
        readRegistryExecutablePath: () => {
          registryCalls += 1;
          return REGISTRY_DEFAULT;
        },
      }),
    TypeError,
  );
  // 不允许把 registry 默认值伪装成“配置成功”。
  assert.equal(registryCalls, 0);
});

test('wrong-type executablePath fails loudly instead of silently falling back', () => {
  assert.throws(
    () =>
      resolveBrowserRuntimeEvidence({
        browserName: 'chromium',
        version: '1.2.3',
        launchOptions: { executablePath: 42 },
        readRegistryExecutablePath: () => REGISTRY_DEFAULT,
      }),
    TypeError,
  );
});

test('browserName and version pass through unchanged', () => {
  const evidence = resolveBrowserRuntimeEvidence({
    browserName: 'firefox',
    version: '9.9.9',
    launchOptions: { executablePath: '/custom/firefox' },
    readRegistryExecutablePath: () => REGISTRY_DEFAULT,
  });

  assert.equal(evidence.browserName, 'firefox');
  assert.equal(evidence.version, '9.9.9');
  // 明确不是 OS 进程观测。
  assert.equal(
    evidence.executablePathObservation,
    'configured-not-os-process-observed',
  );
});

test('channel and connect configurations are conservatively annotated, not claimed as local actual', () => {
  const withChannel = resolveBrowserRuntimeEvidence({
    browserName: 'chromium',
    version: '1.0.0',
    launchOptions: { executablePath: '/custom/chrome' },
    channel: 'chrome',
    readRegistryExecutablePath: () => REGISTRY_DEFAULT,
  });
  assert.ok(
    withChannel.executablePathCaveats.some((caveat) =>
      caveat.startsWith('channel-configured:'),
    ),
  );

  const withConnect = resolveBrowserRuntimeEvidence({
    browserName: 'chromium',
    version: '1.0.0',
    launchOptions: {},
    hasConnectOptions: true,
    readRegistryExecutablePath: () => REGISTRY_DEFAULT,
  });
  assert.ok(
    withConnect.executablePathCaveats.some((caveat) =>
      caveat.startsWith('connect-configured:'),
    ),
  );

  // 普通本地项目不凭空添加边界标注。
  const plain = resolveBrowserRuntimeEvidence({
    browserName: 'chromium',
    version: '1.0.0',
    launchOptions: {},
    readRegistryExecutablePath: () => REGISTRY_DEFAULT,
  });
  assert.deepEqual(plain.executablePathCaveats, []);
});
