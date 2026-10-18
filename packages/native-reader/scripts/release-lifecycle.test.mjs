import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  assertReleasePlan,
  cleanBuildRelease,
  cleanReleaseStaging,
  runReleasePostpack,
  runReleasePrepack,
} from './release-lifecycle.mjs';
import { digestTree } from './verify-packed-package.mjs';
import { createOwnedStagingRoot } from './staging-ownership.mjs';

const modulePackageRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const cacheRoot = path.join(os.homedir(), '.cache/opencode-tmp/opencode');
const execFileAsync = promisify(execFile);
const link = (target, destination) =>
  symlink(
    target,
    destination,
    process.platform === 'win32' ? 'junction' : 'dir',
  );

async function releaseFixture(t) {
  await mkdir(cacheRoot, { recursive: true });
  const root = await mkdtemp(path.join(cacheRoot, 'hn-release-plan-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, 'workspace');
  const authorityPackageRoot = path.join(workspaceRoot, 'package');
  const sourceRoot = path.join(workspaceRoot, 'installed-webview');
  const coreRoot = path.join(workspaceRoot, 'installed-core');
  const owned = await createOwnedStagingRoot({
    parentRoot: root,
    prefix: 'output-',
  });
  const packageRoot = owned.outputRoot;
  for (const directory of [
    authorityPackageRoot,
    sourceRoot,
    coreRoot,
    packageRoot,
  ])
    await mkdir(directory, { recursive: true });
  await mkdir(path.join(authorityPackageRoot, 'empty-dir'));
  await writeFile(
    path.join(authorityPackageRoot, 'USER_SOURCE_SENTINEL'),
    'never delete authority\n',
  );
  await writeFile(
    path.join(packageRoot, 'OUTPUT_SENTINEL'),
    'foreign fixture payload\n',
  );
  await writeFile(
    path.join(authorityPackageRoot, 'package.json'),
    JSON.stringify({
      name: '@fixture/native-reader',
      private: true,
      scripts: {
        prepack: 'node scripts/release-lifecycle.mjs refuse-source-pack',
        'pack:release': 'node scripts/isolated-release.mjs',
      },
      dependencies: { 'react-native-webview': '13.16.1' },
    }),
  );
  await writeFile(path.join(workspaceRoot, 'tsconfig.base.json'), '{}');
  await mkdir(path.join(workspaceRoot, 'node_modules'));
  const options = {
    packageRoot,
    ownership: owned.ownership,
    authorityPackageRoot,
    workspaceRoot,
    resolveSecureInputs: () => ({ sourceRoot, coreRoot }),
  };
  return { root, options, sourceRoot, coreRoot };
}

const callbacks = (events) => ({
  cleanReleaseStagingFn: async () => {
    events.push('cleanup');
  },
  buildReleaseFn: async () => {
    events.push('build');
  },
  stageBundledCoreFn: async () => {
    events.push('core');
  },
  stageSecureWebViewFn: async () => {
    events.push('secure');
  },
  cleanSecureWebViewFn: async () => {
    events.push('clean-secure');
  },
  cleanBundledCoreFn: async () => {
    events.push('clean-core');
  },
  runBob: async () => {
    events.push('bob');
  },
});
const entrypoints = [
  cleanBuildRelease,
  cleanReleaseStaging,
  runReleasePrepack,
  runReleasePostpack,
];

test('all release APIs reject same/parent/child/alias/output-link before any mutating callback', async (t) => {
  const { root, options } = await releaseFixture(t);
  const child = path.join(options.authorityPackageRoot, 'child');
  await mkdir(child);
  const alias = path.join(root, 'authority-alias');
  await link(options.authorityPackageRoot, alias);
  const outputLink = path.join(root, 'output-link');
  await link(options.packageRoot, outputLink);
  const parentLink = path.join(root, 'parent-link');
  await link(root, parentLink);
  for (const output of [
    options.authorityPackageRoot,
    options.workspaceRoot,
    child,
    alias,
    outputLink,
    path.join(parentLink, 'output'),
    modulePackageRoot,
    path.dirname(modulePackageRoot),
    path.join(modulePackageRoot, 'scripts'),
  ]) {
    for (const run of entrypoints) {
      const events = [];
      const before = await digestTree(root);
      await assert.rejects(
        run({ ...options, ...callbacks(events), packageRoot: output }),
        /overlaps authority|symlink\/junction/,
      );
      assert.deepEqual(events, []);
      assert.equal(await digestTree(root), before);
    }
  }
});

test('all release APIs reject absent explicit roots/installed authorities without cleanup', async (t) => {
  const { root, options } = await releaseFixture(t);
  for (const run of entrypoints) {
    for (const changes of [
      { packageRoot: undefined },
      { authorityPackageRoot: undefined },
      { resolveSecureInputs: () => ({}) },
      {
        resolveSecureInputs: () => ({
          sourceRoot: options.packageRoot,
          coreRoot: options.packageRoot,
        }),
      },
      {
        resolveSecureInputs: () => {
          throw new Error('preflight resolver failure');
        },
      },
    ]) {
      const events = [];
      const before = await digestTree(root);
      await assert.rejects(
        run({ ...options, ...callbacks(events), ...changes }),
        /required|overlaps authority|preflight resolver failure/,
      );
      assert.deepEqual(events, []);
      assert.equal(await digestTree(root), before);
    }
  }
});

test('complete lib and mutable child links reject before rm or cleanup callback', async (t) => {
  for (const mutable of [
    'lib',
    'lib/module',
    'android',
    'apple',
    'apple-fault-matrix',
    'secure-webview',
    'foliate-runtime',
    'package.json',
    'SECURE_WEBVIEW_SHA256.json',
  ]) {
    const { root, options } = await releaseFixture(t);
    const target = path.join(options.packageRoot, mutable);
    await mkdir(path.dirname(target), { recursive: true });
    await link(options.authorityPackageRoot, target);
    for (const run of entrypoints) {
      const events = [];
      const before = await digestTree(root);
      await assert.rejects(
        run({ ...options, ...callbacks(events) }),
        /symlink\/junction/,
      );
      assert.deepEqual(events, []);
      assert.equal(await digestTree(root), before);
    }
  }
});

test('canonical authority alias builds complete input plan, never uses output as runtime/capability', async (t) => {
  const { root, options, sourceRoot, coreRoot } = await releaseFixture(t);
  const alias = path.join(root, 'authority-alias');
  await link(options.authorityPackageRoot, alias);
  const plan = await assertReleasePlan({
    ...options,
    authorityPackageRoot: alias,
  });
  assert.equal(plan.outputRoot, options.packageRoot);
  assert.equal(plan.sourceRoot, sourceRoot);
  assert.equal(plan.coreRoot, undefined);
  assert.ok(coreRoot); // Retired input is deliberately not resolved by the release plan.
  for (const key of [
    'productSourceRoot',
    'referenceIntegrityRoot',
    'runtimeRoot',
    'capabilityRoot',
  ])
    assert.equal(plan[key], options.authorityPackageRoot);
  // 生成运行时不属于 authority：它只在隔离输出内重新生成（干净 checkout 的源码
  // 树没有 foliate-runtime），因此必须显式指向输出根，且与被审阅的 runtimeRoot
  // 分开。把它误设回 authority 会让发布门禁重新依赖未生成的产物。
  assert.equal(plan.generatedRuntimeRoot, plan.outputRoot);
  assert.notEqual(plan.generatedRuntimeRoot, plan.runtimeRoot);
});

test('valid sibling mock prepack is deterministic, build clears stale lib, cleanup ordered', async (t) => {
  const { options } = await releaseFixture(t);
  const sourceBefore = await digestTree(options.workspaceRoot);
  const events = [];
  const mocked = {
    ...options,
    cleanSecureWebViewFn: async (plan) => {
      events.push('cleanup-secure');
      assert.equal(plan.runtimeRoot, options.authorityPackageRoot);
      await rm(path.join(plan.outputRoot, 'android'), {
        recursive: true,
        force: true,
      });
    },
    cleanBundledCoreFn: async (plan) => {
      events.push('cleanup-core');
      await rm(path.join(plan.packageRoot, 'lib/vendor/core'), {
        recursive: true,
        force: true,
      });
    },
    buildReleaseFn: async (context) =>
      cleanBuildRelease({
        ...context,
        runBob: async () => {
          events.push('build');
          await mkdir(path.join(context.packageRoot, 'lib/module'), {
            recursive: true,
          });
          await writeFile(
            path.join(context.packageRoot, 'lib/module/index.js'),
            'deterministic build\n',
          );
        },
      }),
    stageBundledCoreFn: async (context) => {
      events.push('core');
      await mkdir(path.join(context.packageRoot, 'lib/vendor/core'), {
        recursive: true,
      });
      await writeFile(
        path.join(context.packageRoot, 'lib/vendor/core/index.js'),
        'deterministic core\n',
      );
    },
    stageSecureWebViewFn: async (plan) => {
      events.push('secure');
      await mkdir(path.join(plan.outputRoot, 'android'), { recursive: true });
      await writeFile(
        path.join(plan.outputRoot, 'android/host.java'),
        'deterministic secure\n',
      );
    },
  };
  await runReleasePrepack(mocked);
  const first = await digestTree(options.packageRoot);
  await writeFile(
    path.join(options.packageRoot, 'lib/STALE'),
    'must disappear',
  );
  await runReleasePrepack(mocked);
  assert.equal(await digestTree(options.packageRoot), first);
  assert.deepEqual(
    events,
    Array(2).fill(['cleanup-secure', 'build', 'secure']).flat(),
  );
  await runReleasePostpack(mocked);
  assert.equal((await readdir(options.packageRoot)).includes('android'), false);
  assert.equal(await digestTree(options.workspaceRoot), sourceBefore);
});

test('writer failure cleans only isolated output, and preserves error/settled ordering', async (t) => {
  const { options } = await releaseFixture(t);
  const before = await digestTree(options.authorityPackageRoot);
  const events = [];
  await assert.rejects(
    runReleasePrepack({
      ...options,
      ...callbacks(events),
      stageSecureWebViewFn: async (plan) => {
        const results = await Promise.allSettled([
          Promise.reject(new Error('writer failure')),
          Promise.resolve().then(async () => {
            await writeFile(
              path.join(plan.outputRoot, 'PARTIAL'),
              'isolated only',
            );
            events.push('writer-settled');
          }),
        ]);
        throw results[0].reason;
      },
      cleanReleaseStagingFn: async (context) => {
        events.push('cleanup');
        assert.equal(
          context.authorityPackageRoot,
          options.authorityPackageRoot,
        );
        assert.equal(context.packageRoot, options.packageRoot);
        await rm(path.join(context.packageRoot, 'PARTIAL'), { force: true });
      },
    }),
    /writer failure/,
  );
  assert.deepEqual(events, ['cleanup', 'build', 'writer-settled', 'cleanup']);
  assert.equal(await digestTree(options.authorityPackageRoot), before);
});

test('failed writer adding lib link refuses catch cleanup instead of following authority link', async (t) => {
  const { root, options } = await releaseFixture(t);
  const events = [];
  const before = await digestTree(options.authorityPackageRoot);
  await assert.rejects(
    runReleasePrepack({
      ...options,
      ...callbacks(events),
      stageSecureWebViewFn: async () => {
        await link(
          options.authorityPackageRoot,
          path.join(options.packageRoot, 'lib'),
        );
        throw new Error('writer added link');
      },
    }),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0].message === 'writer added link' &&
      /symlink\/junction/.test(error.errors[1].message),
  );
  assert.deepEqual(events, ['cleanup', 'build']);
  assert.equal(await digestTree(options.authorityPackageRoot), before);
  assert.ok((await readdir(root)).includes(path.basename(options.packageRoot)));
});

test('foreign secure ownership blocks parent cleanup', async (t) => {
  const { options } = await releaseFixture(t);
  const events = [];
  await assert.rejects(
    cleanReleaseStaging({
      ...options,
      cleanSecureWebViewFn: async () => {
        events.push('secure');
        throw new Error('foreign secure adapter');
      },
      cleanBundledCoreFn: async () => {
        events.push('core');
      },
    }),
    /foreign secure adapter/,
  );
  assert.deepEqual(events, ['secure']);
});

test('foreign sibling lib cannot be erased by release APIs despite generated markers or borrowed capability', async (t) => {
  const { root, options } = await releaseFixture(t);
  const foreign = path.join(root, 'foreign-package');
  await mkdir(path.join(foreign, 'lib'), { recursive: true });
  await writeFile(
    path.join(foreign, 'lib/USER_SOURCE_SENTINEL'),
    'foreign library',
  );
  await writeFile(
    path.join(foreign, 'lib/HN_SECURE_WEBVIEW_GENERATED'),
    'stage-secure-webview.mjs',
  );
  for (const run of entrypoints) {
    for (const ownership of [undefined, {}, options.ownership]) {
      const events = [];
      const before = await digestTree(root);
      await assert.rejects(
        run({
          ...options,
          ...callbacks(events),
          packageRoot: foreign,
          ownership,
        }),
        /capability/,
      );
      assert.deepEqual(events, []);
      assert.equal(await digestTree(root), before);
    }
  }
});

test('direct lifecycle prepack/postpack CLI fail closed and source refusal remains', async () => {
  for (const mode of ['prepack', 'postpack'])
    await assert.rejects(
      execFileAsync(process.execPath, [
        path.join(modulePackageRoot, 'scripts/release-lifecycle.mjs'),
        mode,
      ]),
      /Direct prepack\/postpack are disabled/,
    );
  await assert.rejects(
    execFileAsync(process.execPath, [
      path.join(modulePackageRoot, 'scripts/release-lifecycle.mjs'),
      'refuse-source-pack',
    ]),
    /Source-root npm pack\/publish is disabled/,
  );
});
