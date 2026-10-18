import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runIsolatedAndroidFaultMatrix } from './run-android-fault-matrix-isolated.mjs';
import {
  assertOwnedStagingRoot,
  disposeOwnedStagingRoot,
} from './staging-ownership.mjs';

const cacheRoot = path.join(os.homedir(), '.cache/opencode-tmp/opencode');
// 共享缓存根在干净环境（CI runner、全新 HOME）里并不存在；此夹具按生产 wrapper
// “cacheRoot 必须预先存在”的约定自己建立它，避免依赖其它夹具文件的执行顺序。
await mkdir(cacheRoot, { recursive: true });
const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// 独立于 wrapper 的完整树 snapshot，不只比较 manifest/已知原生文件。
async function snapshot(root, relative = '') {
  const entry = await lstat(path.join(root, relative));
  if (entry.isSymbolicLink())
    return [
      relative,
      entry.mode,
      'link',
      await readlink(path.join(root, relative)),
    ];
  if (entry.isFile())
    return [
      relative,
      entry.mode,
      'file',
      createHash('sha256')
        .update(await readFile(path.join(root, relative)))
        .digest('hex'),
    ];
  return [
    relative,
    entry.mode,
    'directory',
    await Promise.all(
      (await readdir(path.join(root, relative)))
        .sort()
        .map((name) => snapshot(root, path.join(relative, name))),
    ),
  ];
}

async function fixture(t) {
  const root = await mkdtemp(path.join(cacheRoot, 'hn-fault-matrix-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const authority = path.join(root, 'authority');
  const cache = path.join(root, 'cache');
  const source = path.join(root, 'installed-webview');
  const core = path.join(root, 'installed-core');
  const runtime = path.join(root, 'independent-runtime');
  for (const directory of [authority, cache, source, core, runtime])
    await mkdir(directory);
  for (const directory of [
    'foliate-runtime',
    'android-fault-matrix/harness/src/test',
    'android-fault-matrix/harness/build',
    'android-fault-matrix/.gradle',
    '.hidden/empty',
  ])
    await mkdir(path.join(authority, directory), { recursive: true });
  for (const [relative, content] of [
    ['USER_SOURCE', 'authority bytes'],
    ['.hidden/unlisted', 'hidden bytes'],
    ['android-fault-matrix/gradlew', 'mock wrapper'],
    ['android-fault-matrix/harness/src/test/Test.java', 'mock test'],
    [
      'android-fault-matrix/harness/build/foreign-report',
      'never copy existing build',
    ],
    ['android-fault-matrix/.gradle/foreign-cache', 'never copy existing cache'],
  ])
    await writeFile(path.join(authority, relative), content);
  await symlink(
    runtime,
    path.join(authority, 'foliate-runtime/native'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  // 三个包外 authority 都包含未知文件/空目录/悬空链接，摘要不得沿内部 link 遍历。
  for (const directory of [source, core, runtime]) {
    await mkdir(path.join(directory, '.hidden/empty'), { recursive: true });
    await writeFile(
      path.join(directory, '.hidden/unlisted'),
      'authority bytes',
    );
    await symlink('missing-target', path.join(directory, 'link'));
  }
  await writeFile(path.join(runtime, 'manifest.json'), 'real runtime input');
  const externalBefore = await Promise.all(
    [source, core, runtime].map((directory) => snapshot(directory)),
  );
  await symlink(
    source,
    path.join(authority, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await writeFile(path.join(cache, 'FOREIGN_KEEP'), 'foreign cache content');
  let outputRoot;
  let stagePlan;
  let gradleCalls = 0;
  const options = {
    packageRoot: authority,
    workspaceRoot: root,
    cacheRoot: cache,
    resolveInstalledInputsFn: (workspace) => {
      assert.equal(workspace, root);
      return { sourceRoot: source, coreRoot: core };
    },
    stageSecureWebViewFn: async (plan) => {
      // 不 mock ownership 模块：fixture 的首次写入也必须通过真实 capability gate。
      assert.equal(await assertOwnedStagingRoot(plan), plan.outputRoot);
      stagePlan = plan;
      outputRoot = plan.outputRoot;
      assert.equal(plan.sourceRoot, await realpath(source));
      assert.equal(plan.coreRoot, await realpath(core));
      for (const key of [
        'runtimeRoot',
        'productSourceRoot',
        'referenceIntegrityRoot',
        'capabilityRoot',
      ]) {
        assert.equal(plan[key], await realpath(authority), key);
      }
      assert.notEqual(plan.runtimeRoot, plan.outputRoot);
      await mkdir(path.join(plan.outputRoot, 'android'));
      await mkdir(path.join(plan.outputRoot, 'secure-webview'));
      await writeFile(
        path.join(plan.outputRoot, 'android/PRODUCTION'),
        'mock staged production',
      );
      await writeFile(
        path.join(plan.outputRoot, 'secure-webview/WIRE'),
        'mock staged wire',
      );
    },
    runGradleFn: async ({ cwd, args, env, command }) => {
      gradleCalls += 1;
      const ownRoot = outputRoot;
      assert.equal(await assertOwnedStagingRoot(stagePlan), ownRoot);
      assert.equal(cwd, path.join(ownRoot, 'android-fault-matrix'));
      assert.equal(
        command,
        process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
      );
      assert.deepEqual(args, [
        '--no-daemon',
        '--gradle-user-home',
        path.join(ownRoot, 'gradle-user-home'),
        '--project-cache-dir',
        path.join(ownRoot, 'project-cache'),
        `-Duser.home=${path.join(ownRoot, 'home')}`,
        `-Djava.io.tmpdir=${path.join(ownRoot, 'tmp')}`,
        `-Dkotlin.daemon.options=runFilesPath=${path.join(ownRoot, 'kotlin-daemon')}`,
        `-Dkotlin.daemon.custom.run.files.path.for.tests=${path.join(ownRoot, 'kotlin-daemon')}`,
        `-Dorg.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8 ${env.JAVA_TOOL_OPTIONS}`,
        '-Pkotlin.compiler.execution.strategy=in-process',
        '-Pkotlin.incremental=false',
        `-Pkotlin.project.persistent.dir=${path.join(ownRoot, 'kotlin-cache')}`,
        `-PhnFaultMatrixStagedRoot=${outputRoot}`,
        `-PhnFaultMatrixRuntimeAssetsRoot=${await realpath(path.join(authority, 'foliate-runtime/native'))}`,
        ':harness:testDebugUnitTest',
      ]);
      assert.equal(
        env.GRADLE_USER_HOME,
        path.join(ownRoot, 'gradle-user-home'),
      );
      assert.equal(
        env.JAVA_TOOL_OPTIONS,
        [
          `"-Duser.home=${path.join(ownRoot, 'home')}"`,
          `"-Djava.io.tmpdir=${path.join(ownRoot, 'tmp')}"`,
          `"-Djava.util.prefs.userRoot=${path.join(ownRoot, 'home/.java/userPrefs')}"`,
          `"-Djava.util.prefs.systemRoot=${path.join(ownRoot, 'home/.java/systemPrefs')}"`,
          `"-Dkotlin.daemon.options=runFilesPath=${path.join(ownRoot, 'kotlin-daemon')}"`,
          `"-Dkotlin.daemon.custom.run.files.path.for.tests=${path.join(ownRoot, 'kotlin-daemon')}"`,
        ].join(' '),
      );
      const expectedState = {
        HOME: 'home',
        USERPROFILE: 'home',
        APPDATA: 'home/appdata',
        LOCALAPPDATA: 'home/local-appdata',
        ANDROID_USER_HOME: 'home/.android',
        ANDROID_PREFS_ROOT: 'home',
        ANDROID_SDK_HOME: 'home',
        ANDROID_EMULATOR_HOME: 'home/.android/emulator',
        ANDROID_AVD_HOME: 'home/.android/avd',
        XDG_CACHE_HOME: 'home/.cache',
        XDG_CONFIG_HOME: 'home/.config',
        XDG_DATA_HOME: 'home/.local/share',
        XDG_STATE_HOME: 'home/.local/state',
        XDG_RUNTIME_DIR: 'xdg-runtime',
      };
      for (const [key, relative] of Object.entries(expectedState)) {
        assert.equal(env[key], path.join(ownRoot, relative), key);
        assert.ok((await stat(env[key])).isDirectory(), key);
        assert.deepEqual(
          Object.keys(env).filter((name) => name.toUpperCase() === key),
          [key],
          `${key} has no inherited case alias`,
        );
      }
      for (const key of [
        '_JAVA_OPTIONS',
        'JDK_JAVA_OPTIONS',
        'JAVA_OPTS',
        'GRADLE_OPTS',
        'KOTLIN_OPTS',
        'KOTLIN_DAEMON_JVM_OPTIONS',
        'KOTLIN_COMPILER_OPTS',
        'GRADLE_RO_DEP_CACHE',
        'GRADLE_HOME',
      ])
        assert.equal(env[key], undefined, key);
      assert.ok(
        !Object.keys(env).some((key) => /^ORG_GRADLE_PROJECT_/i.test(key)),
      );
      for (const key of ['JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT'])
        assert.equal(
          env[key],
          process.env[key],
          `${key} remains real read-only tool configuration`,
        );
      for (const name of ['TMPDIR', 'TMP', 'TEMP'])
        assert.equal(env[name], path.join(ownRoot, 'tmp'));
      assert.equal(
        await readFile(path.join(cwd, 'harness/src/test/Test.java'), 'utf8'),
        'mock test',
      );
      await assert.rejects(stat(path.join(cwd, 'harness/build')), {
        code: 'ENOENT',
      });
      await assert.rejects(stat(path.join(cwd, '.gradle')), { code: 'ENOENT' });
      // 模拟 Gradle 各类副产物，必须全部落在唯一自建根内。
      for (const directory of [
        path.join(cwd, 'harness/build'),
        path.join(cwd, '.gradle'),
        env.GRADLE_USER_HOME,
        env.TMPDIR,
        ...Object.keys(expectedState).map((key) => env[key]),
        path.join(ownRoot, 'kotlin-daemon'),
        path.join(ownRoot, 'kotlin-cache'),
      ]) {
        await mkdir(directory, { recursive: true });
        await writeFile(
          path.join(directory, 'MOCK_BUILD_OUTPUT'),
          'temporary output',
        );
      }
    },
  };
  const assertClean = async (before) => {
    assert.deepEqual(
      await snapshot(authority),
      before,
      'whole authority tree unchanged',
    );
    assert.deepEqual(
      await Promise.all(
        [source, core, runtime].map((directory) => snapshot(directory)),
      ),
      externalBefore,
      'installed WebView/core and independent runtime unchanged',
    );
    assert.deepEqual(
      await readdir(cache),
      ['FOREIGN_KEEP'],
      'only own unique root cleaned',
    );
    assert.equal(
      await readFile(path.join(cache, 'FOREIGN_KEEP'), 'utf8'),
      'foreign cache content',
    );
    if (outputRoot) await assert.rejects(stat(outputRoot), { code: 'ENOENT' });
  };
  return {
    root,
    authority,
    cache,
    source,
    core,
    runtime,
    options,
    assertClean,
    getOutputRoot: () => outputRoot,
    getStagePlan: () => stagePlan,
    getGradleCalls: () => gradleCalls,
  };
}

test('success: explicit canonical authority inputs/properties, isolated build caches, whole tree invariant and unique cleanup', async (t) => {
  const f = await fixture(t);
  const before = await snapshot(f.authority);
  const first = await runIsolatedAndroidFaultMatrix(f.options);
  const firstRoot = f.getOutputRoot();
  await f.assertClean(before);
  const second = await runIsolatedAndroidFaultMatrix(f.options);
  assert.notEqual(
    f.getOutputRoot(),
    firstRoot,
    'every run owns a fresh mkdtemp root',
  );
  assert.equal(first.authoritySha256, second.authoritySha256);
  assert.match(first.authoritySha256, /^[a-f0-9]{64}$/);
  assert.equal(first.task, ':harness:testDebugUnitTest');
  assert.equal(f.getGradleCalls(), 2);
  await f.assertClean(before);
});

test('wrapper passes a real identity-bound capability and dispose revokes it', async (t) => {
  const f = await fixture(t);
  const before = await snapshot(f.authority);
  let received;
  await runIsolatedAndroidFaultMatrix({
    ...f.options,
    stageSecureWebViewFn: async (plan) => {
      received = plan;
      assert.ok(Object.isFrozen(plan.ownership));
      assert.equal(Object.getPrototypeOf(plan.ownership), null);
      assert.equal(await assertOwnedStagingRoot(plan), plan.outputRoot);
      assert.equal(path.dirname(plan.outputRoot), await realpath(f.cache));
      assert.match(path.basename(plan.outputRoot), /^hn-android-fault-matrix-/);
      await f.options.stageSecureWebViewFn(plan);
    },
  });
  // dispose 删除 WeakMap 登记，失效 token 不能重新授权目录。
  await assert.rejects(
    assertOwnedStagingRoot(received),
    /capability is required/,
  );
  await f.assertClean(before);
});

test('real ownership assertions reject absent/forged/copied/wrong-root/child/alias plans without touching foreign content', async (t) => {
  for (const kind of [
    'absent',
    'forged',
    'copied',
    'wrong-root',
    'child',
    'alias',
  ]) {
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      const foreign = path.join(f.root, 'foreign-staging');
      await mkdir(foreign);
      await writeFile(path.join(foreign, 'FOREIGN_KEEP'), 'never adopt');
      const foreignBefore = await snapshot(foreign);
      const before = await snapshot(f.authority);
      await runIsolatedAndroidFaultMatrix({
        ...f.options,
        stageSecureWebViewFn: async (plan) => {
          assert.equal(await assertOwnedStagingRoot(plan), plan.outputRoot);
          const invalid = { ...plan };
          let expected = /capability is required/;
          if (kind === 'absent') delete invalid.ownership;
          if (kind === 'forged')
            invalid.ownership = Object.freeze(Object.create(null));
          if (kind === 'copied')
            invalid.ownership = structuredClone(plan.ownership);
          if (kind === 'wrong-root') {
            invalid.outputRoot = foreign;
            expected = /does not match/;
          }
          if (kind === 'child') {
            invalid.outputRoot = path.join(
              plan.outputRoot,
              'unauthorized-child-stage',
            );
            await mkdir(invalid.outputRoot);
            expected = /does not match/;
          }
          if (kind === 'alias') {
            invalid.outputRoot = path.join(f.root, 'output-alias');
            await symlink(
              plan.outputRoot,
              invalid.outputRoot,
              process.platform === 'win32' ? 'junction' : 'dir',
            );
            expected = /symlink\/junction/;
          }
          // 所有 gate/dispose 均直接调用生产 helper；没有替换/注入它们的机会。
          await assert.rejects(assertOwnedStagingRoot(invalid), expected);
          await assert.rejects(disposeOwnedStagingRoot(invalid), expected);
          assert.deepEqual(await snapshot(foreign), foreignBefore);
          assert.equal(
            await assertOwnedStagingRoot(plan),
            plan.outputRoot,
            'failed assertion/dispose does not revoke the valid token',
          );
          await f.options.stageSecureWebViewFn(plan);
        },
      });
      await f.assertClean(before);
      assert.deepEqual(await snapshot(foreign), foreignBefore);
    });
  }
});

test('root replacement prevents cleanup of foreign inode and still aggregates original failure plus every input invariant', async (t) => {
  const f = await fixture(t);
  const failure = new Error('mock stage failure after root replacement');
  let original;
  let displaced;
  let foreignBefore;
  await assert.rejects(
    runIsolatedAndroidFaultMatrix({
      ...f.options,
      stageSecureWebViewFn: async (plan) => {
        await f.options.stageSecureWebViewFn(plan);
        original = plan.outputRoot;
        displaced = path.join(f.cache, 'displaced-fixture-own-root');
        // 保留旧 inode 排除重用；只移动 fixture 自有根，不操作真实 source 或 foreign。
        await rename(original, displaced);
        await mkdir(original);
        await writeFile(
          path.join(original, 'FOREIGN_KEEP'),
          'replacement must survive',
        );
        foreignBefore = await snapshot(original);
        for (const directory of [f.authority, f.source, f.core, f.runtime])
          await writeFile(path.join(directory, '.hidden/unlisted'), 'mutated');
        throw failure;
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 6);
      assert.equal(error.errors[0], failure);
      assert.match(error.errors[1].message, /capability does not match/);
      for (const [index, message] of [
        /whole authority package tree/,
        /installed WebView authority tree/,
        /installed core authority tree/,
        /runtime authority tree/,
      ].entries())
        assert.match(error.errors[index + 2].message, message);
      return true;
    },
  );
  assert.equal(f.getGradleCalls(), 0);
  assert.deepEqual(
    await snapshot(original),
    foreignBefore,
    'no bare-rm fallback after disposal refuses a foreign inode',
  );
  assert.ok((await stat(displaced)).isDirectory());
  assert.equal(
    await readFile(path.join(f.cache, 'FOREIGN_KEEP'), 'utf8'),
    'foreign cache content',
  );
  // fixture t.after 仅清理其自有最外层根；wrapper 没有删除任何未授权目录。
});

test('staging and Gradle failure still preserve whole authority tree and clean only own root', async (t) => {
  for (const phase of ['stage', 'gradle', 'resolve']) {
    await t.test(phase, async (t) => {
      const f = await fixture(t);
      const before = await snapshot(f.authority);
      const failure = new Error(`mock ${phase} failure`);
      const options = { ...f.options };
      const key = {
        stage: 'stageSecureWebViewFn',
        gradle: 'runGradleFn',
        resolve: 'resolveInstalledInputsFn',
      }[phase];
      options[key] = async (...args) => {
        await f.options[key](...args);
        throw failure;
      };
      await assert.rejects(
        runIsolatedAndroidFaultMatrix(options),
        (error) => error === failure,
      );
      if (phase !== 'gradle') assert.equal(f.getGradleCalls(), 0);
      await f.assertClean(before);
    });
  }
});

test('reject same/parent/child/canonical alias cache before stage/Gradle, never remove foreign directories', async (t) => {
  const f = await fixture(t);
  const child = path.join(f.authority, 'child');
  await mkdir(child);
  const alias = path.join(f.root, 'alias');
  await symlink(
    f.authority,
    alias,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const before = await snapshot(f.root);
  for (const cache of [
    f.authority,
    f.root,
    child,
    alias,
    f.source,
    f.core,
    f.runtime,
  ]) {
    await assert.rejects(
      runIsolatedAndroidFaultMatrix({ ...f.options, cacheRoot: cache }),
      /overlaps authority|symlink\/junction/,
    );
    assert.deepEqual(await snapshot(f.root), before);
    assert.equal(
      f.getOutputRoot(),
      undefined,
      'no staging before path refusal',
    );
    assert.equal(f.getGradleCalls(), 0);
  }
});

test('authority aliases are canonicalized, not used as writable outputs', async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.root, 'authority-alias');
  await symlink(
    f.authority,
    alias,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const before = await snapshot(f.authority);
  await runIsolatedAndroidFaultMatrix({ ...f.options, packageRoot: alias });
  await f.assertClean(before);
});

test('runtime authority alias into cache is rejected before staging and leaves foreign cache untouched', async (t) => {
  const f = await fixture(t);
  // fixture 自有目录可替换为 alias；绝不对真实 production runtime 操作。
  await rm(path.join(f.authority, 'foliate-runtime/native'), {
    recursive: true,
  });
  await symlink(
    f.cache,
    path.join(f.authority, 'foliate-runtime/native'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const before = await snapshot(f.root);
  await assert.rejects(
    runIsolatedAndroidFaultMatrix(f.options),
    /overlaps authority/,
  );
  assert.deepEqual(await snapshot(f.root), before);
  assert.equal(f.getOutputRoot(), undefined);
  assert.equal(f.getGradleCalls(), 0);
});

test('every authority mutation detected on success/stage failure/Gradle failure, retaining original error', async (t) => {
  const authorities = [
    ['authority', /whole authority package tree/],
    ['source', /installed WebView authority tree/],
    ['core', /installed core authority tree/],
    ['runtime', /runtime authority tree/],
  ];
  for (const [authorityKey, message] of authorities) {
    for (const phase of ['success', 'stage', 'gradle']) {
      await t.test(`${authorityKey}/${phase}`, async (t) => {
        const f = await fixture(t);
        const failure = new Error(`mock ${phase} failure`);
        const options = { ...f.options };
        const key = phase === 'stage' ? 'stageSecureWebViewFn' : 'runGradleFn';
        options[key] = async (...args) => {
          await f.options[key](...args);
          await writeFile(
            path.join(f[authorityKey], '.hidden/unlisted'),
            'unexpected authority mutation',
          );
          if (phase !== 'success') throw failure;
        };
        await assert.rejects(
          runIsolatedAndroidFaultMatrix(options),
          (error) => {
            if (phase === 'success') return message.test(error.message);
            assert.ok(error instanceof AggregateError);
            assert.equal(error.errors[0], failure);
            assert.equal(error.errors.length, 2);
            assert.match(error.errors[1].message, message);
            return true;
          },
        );
        assert.deepEqual(await readdir(f.cache), ['FOREIGN_KEEP']);
        await assert.rejects(stat(f.getOutputRoot()), {
          code: 'ENOENT',
        });
      });
    }
  }
});

test('all invariant errors are aggregated even when a prior authority cannot be read', async (t) => {
  const f = await fixture(t);
  const failure = new Error('mock Gradle failure after multiple mutations');
  await assert.rejects(
    runIsolatedAndroidFaultMatrix({
      ...f.options,
      runGradleFn: async (...args) => {
        await f.options.runGradleFn(...args);
        // fixture 自有 authority 可以删除；用于证明 package 复核失败不短路后三项。
        await rm(f.authority, { recursive: true });
        for (const directory of [f.source, f.core, f.runtime])
          await writeFile(path.join(directory, '.hidden/unlisted'), 'mutated');
        throw failure;
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 5);
      assert.equal(error.errors[0], failure);
      assert.match(
        error.errors[1].message,
        /Cannot recheck whole authority package tree/,
      );
      assert.equal(error.errors[1].cause.code, 'ENOENT');
      assert.match(error.errors[2].message, /installed WebView authority tree/);
      assert.match(error.errors[3].message, /installed core authority tree/);
      assert.match(error.errors[4].message, /runtime authority tree/);
      return true;
    },
  );
  assert.deepEqual(await readdir(f.cache), ['FOREIGN_KEEP']);
});

test('resolver failure still rechecks previously acquired package digest', async (t) => {
  const f = await fixture(t);
  const failure = new Error('resolver failed');
  await assert.rejects(
    runIsolatedAndroidFaultMatrix({
      ...f.options,
      resolveInstalledInputsFn: async () => {
        await writeFile(
          path.join(f.authority, '.hidden/unlisted'),
          'resolver mutation',
        );
        throw failure;
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.equal(error.errors[0], failure);
      assert.match(error.errors[1].message, /whole authority package tree/);
      return true;
    },
  );
  assert.equal(f.getOutputRoot(), undefined);
  assert.equal(f.getGradleCalls(), 0);
  assert.deepEqual(await readdir(f.cache), ['FOREIGN_KEEP']);
});

test('partial canonical resolution failure still rechecks all acquired digests before any writes', async (t) => {
  const f = await fixture(t);
  const before = await snapshot(f.authority);
  await assert.rejects(
    runIsolatedAndroidFaultMatrix({
      ...f.options,
      resolveInstalledInputsFn: () => ({
        sourceRoot: f.source,
        coreRoot: path.join(f.root, 'missing-core'),
      }),
    }),
    { code: 'ENOENT' },
  );
  assert.equal(f.getOutputRoot(), undefined);
  assert.equal(f.getGradleCalls(), 0);
  await f.assertClean(before);
});

test('digest includes file bytes/types, empty directories and internal link targets without following links', async (t) => {
  for (const kind of ['bytes', 'type', 'empty-directory', 'link-target']) {
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      await assert.rejects(
        runIsolatedAndroidFaultMatrix({
          ...f.options,
          runGradleFn: async (...args) => {
            await f.options.runGradleFn(...args);
            for (const directory of [f.source, f.core, f.runtime]) {
              if (kind === 'bytes')
                await writeFile(
                  path.join(directory, '.hidden/unlisted'),
                  'different bytes',
                );
              if (kind === 'type') {
                await rm(path.join(directory, '.hidden/unlisted'));
                await mkdir(path.join(directory, '.hidden/unlisted'));
              }
              if (kind === 'empty-directory')
                await rm(path.join(directory, '.hidden/empty'), {
                  recursive: true,
                });
              if (kind === 'link-target') {
                await rm(path.join(directory, 'link'));
                await symlink(
                  'different-missing-target',
                  path.join(directory, 'link'),
                );
              }
            }
          },
        }),
        (error) => {
          assert.ok(error instanceof AggregateError);
          assert.equal(error.errors.length, 3);
          assert.match(error.errors[0].message, /installed WebView/);
          assert.match(error.errors[1].message, /installed core/);
          assert.match(error.errors[2].message, /runtime authority/);
          return true;
        },
      );
      assert.deepEqual(await readdir(f.cache), ['FOREIGN_KEEP']);
    });
  }
});

test('installed aliases are canonicalized independently before staging', async (t) => {
  const f = await fixture(t);
  const aliases = [];
  for (const [index, directory] of [f.source, f.core].entries()) {
    const alias = path.join(f.root, `installed-alias-${index}`);
    await symlink(
      directory,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    aliases.push(alias);
  }
  const before = await snapshot(f.authority);
  await runIsolatedAndroidFaultMatrix({
    ...f.options,
    resolveInstalledInputsFn: () => ({
      sourceRoot: aliases[0],
      coreRoot: aliases[1],
    }),
  });
  await f.assertClean(before);
});

test('dangerous inherited JVM options and real home/tool caches are cleared, JDK/SDK paths stay read-only', async (t) => {
  const f = await fixture(t);
  const foreign = path.join(f.root, 'foreign-home-and-tools');
  await mkdir(foreign);
  await writeFile(path.join(foreign, 'FOREIGN_KEEP'), 'untouched');
  const inherited = {
    HOME: foreign,
    home: foreign,
    USERPROFILE: foreign,
    UserProfile: foreign,
    ANDROID_USER_HOME: foreign,
    ANDROID_PREFS_ROOT: foreign,
    ANDROID_SDK_HOME: foreign,
    ANDROID_EMULATOR_HOME: foreign,
    ANDROID_AVD_HOME: foreign,
    XDG_CACHE_HOME: foreign,
    XDG_CONFIG_HOME: foreign,
    XDG_RUNTIME_DIR: foreign,
    GRADLE_USER_HOME: foreign,
    Gradle_User_Home: foreign,
    GRADLE_HOME: foreign,
    GRADLE_RO_DEP_CACHE: foreign,
    JAVA_HOME: path.join(foreign, 'jdk'),
    ANDROID_HOME: path.join(foreign, 'sdk'),
    ANDROID_SDK_ROOT: path.join(foreign, 'sdk'),
    JAVA_TOOL_OPTIONS: `-Duser.home=${foreign} -Djava.io.tmpdir=${foreign} -javaagent:${foreign}/agent.jar`,
    Java_Tool_Options: `-Duser.home=${foreign}`,
    _JAVA_OPTIONS: `-Duser.home=${foreign}`,
    JDK_JAVA_OPTIONS: `@${foreign}/jvm-args.txt`,
    JAVA_OPTS: `-Djava.util.prefs.userRoot=${foreign}`,
    GRADLE_OPTS: `-Dorg.gradle.project.kotlin.compiler.execution.strategy=daemon -Dorg.gradle.jvmargs=-Duser.home=${foreign}`,
    KOTLIN_OPTS: `-Dkotlin.daemon.options=runFilesPath=${foreign}`,
    KOTLIN_DAEMON_JVM_OPTIONS: `-Duser.home=${foreign}`,
    KOTLIN_COMPILER_OPTS: `-Djava.io.tmpdir=${foreign}`,
    ORG_GRADLE_PROJECT_kotlinCompiler: 'daemon',
  };
  const previous = Object.fromEntries(
    Object.keys(inherited).map((key) => [key, process.env[key]]),
  );
  const before = await snapshot(f.authority);
  const foreignBefore = await snapshot(foreign);
  try {
    Object.assign(process.env, inherited);
    await runIsolatedAndroidFaultMatrix(f.options);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  await f.assertClean(before);
  assert.deepEqual(await snapshot(foreign), foreignBefore);
});

test('harness uses explicit stage/runtime contract and read-only in-process Kotlin guard', async () => {
  const build = await readFile(
    path.join(packageRoot, 'android-fault-matrix/harness/build.gradle'),
    'utf8',
  );
  assert.match(build, /requiredDirectory\('hnFaultMatrixStagedRoot'\)/);
  assert.match(build, /requiredDirectory\('hnFaultMatrixRuntimeAssetsRoot'\)/);
  assert.match(build, /new File\(stagedRoot, 'android'\)/);
  assert.match(build, /new File\(stagedRoot, 'secure-webview'\)/);
  assert.match(build, /assets\.srcDirs = \[runtimeAssetsRoot\.path\]/);
  assert.match(build, /resources\.srcDirs = \[stagedWire\.path\]/);
  assert.match(build, /stagedAndroid\}\/src\/main\/java/);
  assert.match(build, /stagedAndroid\}\/src\/oldarch/);
  assert.doesNotMatch(
    build,
    /\.\.\/android|\.\.\/secure-webview|\.\.\/foliate-runtime/,
  );
  assert.match(build, /tasks\.withType\(KotlinCompile\)\.configureEach/);
  assert.match(
    build,
    /compilerExecutionStrategy\.set\(KotlinCompilerExecutionStrategy\.IN_PROCESS\)/,
  );
  // 执行期只读兜底：doFirst 读取 compilerExecutionStrategy，偏离 IN_PROCESS 时 fail closed。
  assert.match(build, /\.configureEach\s*\{[\s\S]*?doFirst\s*\{/);
  assert.match(
    build,
    /if\s*\(\s*compilerExecutionStrategy\.get\(\)\s*!=\s*KotlinCompilerExecutionStrategy\.IN_PROCESS\s*\)\s*\{/,
  );
  assert.match(
    build,
    /throw new GradleException\('Kotlin compilerExecutionStrategy 必须是 IN_PROCESS，禁止回退到 daemon\/out-of-process。'\)/,
  );
  // 兜底不得在配置期 set/freeze/afterEvaluate：仅限只读检查。
  assert.doesNotMatch(build, /afterEvaluate/);
  assert.doesNotMatch(
    build,
    /doFirst\s*\{[\s\S]*?compilerExecutionStrategy\.set\(/,
  );
  // 反向合同：禁止在本 task 配置阶段提前 freeze，否则早于插件的 convention+finalizeValueOnRead。
  assert.doesNotMatch(
    build,
    /compilerExecutionStrategy\.(?:finalizeValue|disallowChanges)\(\)/,
  );
});
