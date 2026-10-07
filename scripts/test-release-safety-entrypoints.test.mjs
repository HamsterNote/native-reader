import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// 仅静态读取入口合同：不 import 生产模块，不 spawn，不运行 stage/pack/clean。
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const read = (relative) => readFile(path.join(workspaceRoot, relative), 'utf8');
const manifest = JSON.parse(await read('packages/native-reader/package.json'));
const iosWorkflow = await read(
  '.github/workflows/native-reader-ios-tarball.yml',
);
const safetyWorkflow = await read(
  '.github/workflows/native-reader-release-safety.yml',
);
const fixtureNames = [
  'staging-path-safety',
  'staging-ownership',
  'release-lifecycle',
  'isolated-release',
  'verify-packed-package',
  'run-android-fault-matrix-isolated',
];
const fixtureCommand = `node --test ${fixtureNames
  .map((name) => `scripts/${name}.test.mjs`)
  .join(' ')}`;
const staticCommand =
  'node --test scripts/test-release-safety-entrypoints.test.mjs';
const safetyPrefix = 'pnpm run test:release-safety && ';

const wrapperScripts = {
  'test:android-fault-matrix:raw':
    'node scripts/run-android-fault-matrix-isolated.mjs',
  'test:package:raw': 'node scripts/verify-packed-package.mjs',
  'test:package:ios:raw':
    'REQUIRE_IOS_CONSUMER=1 node scripts/verify-packed-package.mjs',
  'release:verify:raw': 'pnpm run test:package:ios:raw',
  'test:foliate-runtime-package:raw':
    'node scripts/test-foliate-runtime-package.mjs',
};
const validationEntries = [
  'test',
  'test:secure-webview',
  'test:release-lifecycle',
  'test:consumer',
  'build:verify',
  ...Object.keys(wrapperScripts).map((name) => name.replace(/:raw$/, '')),
];

// 递归展开 package scripts，防止只改外层名称却仍经 raw/别名进入源码 mutator。
function assertNoSourceRuntimeMutator(scripts, entry, ancestors = []) {
  assert.ok(!ancestors.includes(entry), `script cycle: ${entry}`);
  const command = scripts[entry];
  assert.equal(typeof command, 'string', `missing script: ${entry}`);
  assert.doesNotMatch(
    command,
    /run-foliate-gated|stage-foliate-runtime|foliate:(?:runtime|web-runtime):(?:stage|sync|check)|foliate:submodule:bootstrap/,
    `${entry} must not mutate source runtime before isolation`,
  );
  for (const [, child] of command.matchAll(/pnpm run ([\w:-]+)/g)) {
    assertNoSourceRuntimeMutator(scripts, child, [...ancestors, entry]);
  }
}

function assertSafetyChain(scripts) {
  assert.equal(scripts['test:release-safety:raw'], fixtureCommand);
  assert.equal(
    scripts['test:release-safety'],
    'node --test ../../scripts/test-release-safety-entrypoints.test.mjs && pnpm run test:release-safety:raw',
  );
  for (const entry of ['test:raw', 'build:verify:raw']) {
    assert.ok(
      scripts[entry].startsWith(safetyPrefix),
      `${entry} must run safety fixtures before build/integration`,
    );
    assert.ok(scripts[entry].includes('pnpm run foliate:source:check && '));
  }
  assert.equal(
    scripts['foliate:source:check'],
    'node ../../scripts/verify-foliate-submodule.mjs',
  );
}

function assertDirectFixtureWorkflow(workflow) {
  assert.match(workflow, /uses: actions\/setup-node@v4/);
  assert.match(workflow, /node-version: 24/);
  assert.ok(workflow.includes(`run: ${staticCommand}`));
  assert.ok(workflow.includes(`run: ${fixtureCommand}`));
  assert.match(workflow, /working-directory: packages\/native-reader/);
}

test('正式验证及传递 raw 链不经过 source runtime mutator', () => {
  for (const entry of validationEntries) {
    assertNoSourceRuntimeMutator(manifest.scripts, entry);
  }
});

test('隔离集成入口先跑安全夹具，随后直接调用既有 wrapper', () => {
  for (const [raw, command] of Object.entries(wrapperScripts)) {
    assert.equal(manifest.scripts[raw], command);
    const entry = raw.replace(/:raw$/, '');
    // Android wrapper 消费现有 runtime，不负责再生成；保留只读源 revision 校验。
    const sourceCheck =
      entry === 'test:android-fault-matrix'
        ? 'pnpm run foliate:source:check && '
        : '';
    assert.equal(
      manifest.scripts[entry],
      `${safetyPrefix}${sourceCheck}pnpm run ${raw}`,
    );
  }
  assertSafetyChain(manifest.scripts);
});

test('保留源构建语义；build:verify 显式清理 lib 而非谎称只读', () => {
  assert.equal(
    manifest.scripts.build,
    'node ../../scripts/run-foliate-gated.mjs -- pnpm run build:raw',
  );
  assert.equal(
    manifest.scripts['build:clean'],
    'node ../../scripts/run-foliate-gated.mjs -- pnpm run build:clean:raw',
  );
  assert.equal(manifest.scripts['build:raw'], 'bob build');
  assert.ok(
    manifest.scripts['build:verify:raw'].includes(
      'pnpm run build:clean:raw && ',
    ),
  );
});

test('Node-only CI 包含真实 Windows filesystem job 和六组 direct fixtures', () => {
  assertDirectFixtureWorkflow(safetyWorkflow);
  assert.match(safetyWorkflow, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(safetyWorkflow, /runs-on: \$\{\{ matrix\.os \}\}/);
  assert.doesNotMatch(
    safetyWorkflow,
    /(?:run:|uses:).*?(?:pnpm|npm |gradle|run-foliate-gated|stage-foliate-runtime|bootstrap|pack:release)/i,
  );
  assert.equal(
    safetyWorkflow.match(/^\s+run: /gm)?.length,
    2,
    'fixture-only job must not add an unreviewed production command',
  );
});

test('iOS CI 先跑安全合同/夹具，再安装并经安全入口验证真实 consumer', () => {
  assertDirectFixtureWorkflow(iosWorkflow);
  assert.match(iosWorkflow, /runs-on: macos-latest/);
  const fixtureIndex = iosWorkflow.indexOf(`run: ${fixtureCommand}`);
  const installIndex = iosWorkflow.indexOf(
    'run: pnpm install --frozen-lockfile',
  );
  const integrationIndex = iosWorkflow.indexOf(
    'run: pnpm --filter @hamster-note/native-reader run release:verify',
  );
  assert.ok(iosWorkflow.indexOf(`run: ${staticCommand}`) < fixtureIndex);
  assert.ok(fixtureIndex < installIndex && installIndex < integrationIndex);
  assert.doesNotMatch(iosWorkflow, /run-foliate-gated|stage-foliate-runtime/);
  assert.equal(iosWorkflow.match(/- 'scripts\/\*\*'/g)?.length, 2);
});

test('合同拒绝任一入口直接 fixture 链漏掉 staging-ownership', () => {
  // 复用既有 assertDirectFixtureWorkflow 合同：模拟两 CI 入口退回五组旧链（漏 ownership）。
  const legacyFixtureCommand = `node --test ${[
    'staging-path-safety',
    'release-lifecycle',
    'isolated-release',
    'verify-packed-package',
    'run-android-fault-matrix-isolated',
  ]
    .map((name) => `scripts/${name}.test.mjs`)
    .join(' ')}`;
  for (const workflow of [safetyWorkflow, iosWorkflow]) {
    assert.ok(workflow.includes(`run: ${fixtureCommand}`));
    assert.throws(() =>
      assertDirectFixtureWorkflow(
        workflow.replace(
          `run: ${fixtureCommand}`,
          `run: ${legacyFixtureCommand}`,
        ),
      ),
    );
  }
});

test('合同检查拒绝 gate 别名绕过、伪只读 --check 和 integration 优先', () => {
  for (const mutation of [
    {
      'test:package:raw':
        'node ../../scripts/run-foliate-gated.mjs -- node scripts/verify-packed-package.mjs',
    },
    {
      'test:package:raw': 'pnpm run hidden:gate',
      'hidden:gate': 'node ../../scripts/stage-foliate-runtime.mjs --check',
    },
  ]) {
    assert.throws(() =>
      assertNoSourceRuntimeMutator(
        { ...manifest.scripts, ...mutation },
        'test:package',
      ),
    );
  }
  for (const entry of ['test:raw', 'build:verify:raw']) {
    assert.throws(() =>
      assertSafetyChain({
        ...manifest.scripts,
        [entry]: `pnpm run test:package:raw && ${manifest.scripts[entry]}`,
      }),
    );
  }
});
