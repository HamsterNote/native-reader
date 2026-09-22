import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cleanBuildRelease,
  cleanReleaseStaging,
  refuseSourcePack,
  runReleasePostpack,
  runReleasePrepack,
} from './release-lifecycle.mjs';
import { stagingNodeModulesLinkType } from './isolated-release.mjs';
import { stageSecureWebView } from './stage-secure-webview.mjs';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = path.resolve(packageRoot, '../..');
const recoveryRoot = await mkdtemp(
  path.join(os.tmpdir(), 'hn-release-lifecycle-recovery-'),
);

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const exists = async (root, relativePath) => {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

try {
  const failureEvents = [];
  await assert.rejects(
    runReleasePrepack({
      packageRoot: '/injected/package',
      workspaceRoot: '/injected/workspace',
      cleanReleaseStagingFn: async () => {
        failureEvents.push('cleanup');
      },
      buildReleaseFn: async () => {
        failureEvents.push('build');
      },
      stageBundledCoreFn: async () => {
        failureEvents.push('core');
      },
      stageSecureWebViewFn: async () => {
        failureEvents.push('secure');
        throw new Error('injected secure staging failure');
      },
      resolveSecureInputs: () => ({
        sourceRoot: '/injected/source',
        coreRoot: '/injected/core',
      }),
    }),
    /injected secure staging failure/,
  );
  assert.deepEqual(failureEvents, [
    'cleanup',
    'build',
    'core',
    'secure',
    'cleanup',
  ]);

  const cleanupEvents = [];
  await assert.rejects(
    cleanReleaseStaging({
      packageRoot: '/injected/package',
      workspaceRoot: '/injected/workspace',
      cleanBundledCoreFn: async () => {
        cleanupEvents.push('core');
        throw new Error('injected core cleanup failure');
      },
      cleanSecureWebViewFn: async () => {
        cleanupEvents.push('secure');
      },
    }),
    /injected core cleanup failure/,
  );
  assert.deepEqual(cleanupEvents, ['secure', 'core']);

  const rejectedCleanupEvents = [];
  await assert.rejects(
    cleanReleaseStaging({
      packageRoot: '/injected/package',
      workspaceRoot: '/injected/workspace',
      cleanSecureWebViewFn: async () => {
        rejectedCleanupEvents.push('secure');
        throw new Error('injected foreign secure adapter');
      },
      cleanBundledCoreFn: async () => {
        rejectedCleanupEvents.push('core');
      },
    }),
    /injected foreign secure adapter/,
  );
  assert.deepEqual(rejectedCleanupEvents, ['secure']);
  assert.throws(refuseSourcePack, /Source-root npm pack\/publish is disabled/);
  assert.equal(
    stagingNodeModulesLinkType(),
    process.platform === 'win32' ? 'junction' : 'dir',
    'isolated release must use a Windows junction instead of an elevated symlink',
  );

  await cp(
    path.join(packageRoot, 'package.json'),
    path.join(recoveryRoot, 'package.json'),
  );
  await mkdir(path.join(recoveryRoot, 'src'), { recursive: true });
  await cp(
    path.join(packageRoot, 'src/nativeCapability.ts'),
    path.join(recoveryRoot, 'src/nativeCapability.ts'),
  );
  // apple-fault-matrix 是随包发布的源输入：prepack 不会生成它，只会在
  // SECURE_WEBVIEW_SHA256.json 里对它取哈希。隔离的 recoveryRoot 必须与
  // isolated-release 的源树拷贝一样带上该目录，否则 collectIntegrityEntries
  // 会因缺少这个非 staging 输入而 ENOENT。
  await cp(
    path.join(packageRoot, 'apple-fault-matrix'),
    path.join(recoveryRoot, 'apple-fault-matrix'),
    { recursive: true },
  );
  const buildReleaseFn = (options) =>
    cleanBuildRelease({
      ...options,
      runBob: () =>
        cp(path.join(packageRoot, 'lib'), path.join(recoveryRoot, 'lib'), {
          recursive: true,
          // Simulate Bob output, not any release staging that may exist in the
          // source workspace. Real cleanBuildRelease removes lib before Bob.
          filter: (source) => {
            const relative = path.relative(
              path.join(packageRoot, 'lib'),
              source,
            );
            return (
              relative !== 'vendor' && !relative.startsWith(`vendor${path.sep}`)
            );
          },
        }),
    });
  const recoveryOptions = {
    packageRoot: recoveryRoot,
    workspaceRoot,
    buildReleaseFn,
  };

  // Simulate a successful prepack whose postpack hook never ran, then prove the
  // next prepack restores and deterministically rebuilds the owned state.
  await runReleasePrepack(recoveryOptions);
  const firstIntegrity = await readFile(
    path.join(recoveryRoot, 'SECURE_WEBVIEW_SHA256.json'),
    'utf8',
  );
  await writeFile(
    path.join(recoveryRoot, 'lib/STALE_RELEASE_OUTPUT.js'),
    'must be removed before the next build\n',
  );
  await runReleasePrepack(recoveryOptions);
  const secondIntegrity = await readFile(
    path.join(recoveryRoot, 'SECURE_WEBVIEW_SHA256.json'),
    'utf8',
  );
  assert.equal(secondIntegrity, firstIntegrity);
  assert.equal(
    await exists(recoveryRoot, 'lib/STALE_RELEASE_OUTPUT.js'),
    false,
  );
  assert.equal(await exists(recoveryRoot, 'android'), true);
  assert.equal(await exists(recoveryRoot, 'secure-webview'), true);
  const bundledCoreManifest = JSON.parse(
    await readFile(
      path.join(recoveryRoot, 'lib/vendor/core/package.json'),
      'utf8',
    ),
  );
  assert.deepEqual(
    {
      name: bundledCoreManifest.name,
      version: bundledCoreManifest.version,
      private: bundledCoreManifest.private,
      type: bundledCoreManifest.type,
    },
    {
      name: '@epubjs-react-native/core',
      version: '1.4.5',
      private: true,
      type: 'commonjs',
    },
  );
  const stagedManifest = JSON.parse(
    await readFile(path.join(recoveryRoot, 'package.json'), 'utf8'),
  );
  assert.equal(
    stagedManifest.devDependencies?.['@epubjs-react-native/core'],
    undefined,
  );

  await runReleasePostpack({ packageRoot: recoveryRoot, workspaceRoot });
  assert.equal(await exists(recoveryRoot, 'android'), false);
  assert.equal(await exists(recoveryRoot, 'secure-webview'), false);
  assert.equal(await exists(recoveryRoot, 'SECURE_WEBVIEW_SHA256.json'), false);
  assert.equal(await exists(recoveryRoot, 'lib/vendor/core'), false);
  const restoredManifest = JSON.parse(
    await readFile(path.join(recoveryRoot, 'package.json'), 'utf8'),
  );
  assert.equal(
    restoredManifest.devDependencies['@epubjs-react-native/core'],
    '1.4.5',
  );

  // P2-3 失败清理竞态回归：在真实 release 生命周期里注入“快速失败 + 延迟写入”的
  // 并发 writer。父级 catch 的 cleanReleaseStaging 必须在所有 writer settle 之后
  // 才运行，且失败后不得留下或重建任何 staging 内容。
  const raceEvents = [];
  await assert.rejects(
    runReleasePrepack({
      ...recoveryOptions,
      stageSecureWebViewFn: (options) =>
        stageSecureWebView({
          ...options,
          writers: [
            {
              name: 'fast-failure',
              run: async () => {
                raceEvents.push('fast-failure:reject');
                throw new Error('injected concurrent staging failure');
              },
            },
            {
              name: 'delayed-writer',
              run: async ({ outputRoot }) => {
                const android = path.join(outputRoot, 'android');
                await mkdir(android, { recursive: true });
                await writeFile(
                  path.join(android, 'HN_SECURE_WEBVIEW_GENERATED'),
                  'stage-secure-webview.mjs\n',
                );
                raceEvents.push('delayed:marker');
                await delay(120);
                await writeFile(
                  path.join(android, 'LATE_STAGING_WRITE.js'),
                  'must not survive cleanup\n',
                );
                raceEvents.push('delayed:settled');
              },
            },
          ],
        }),
    }),
    /injected concurrent staging failure/,
  );
  assert.deepEqual(raceEvents, [
    'fast-failure:reject',
    'delayed:marker',
    'delayed:settled',
  ]);
  assert.equal(await exists(recoveryRoot, 'android'), false);
  assert.equal(
    await exists(recoveryRoot, 'android/LATE_STAGING_WRITE.js'),
    false,
  );
  assert.equal(await exists(recoveryRoot, 'secure-webview'), false);
  assert.equal(await exists(recoveryRoot, 'SECURE_WEBVIEW_SHA256.json'), false);
  assert.equal(await exists(recoveryRoot, 'lib/vendor/core'), false);
  // 再等待一段时间，确认没有“清理之后才落盘”的写入把 staging 重建出来。
  await delay(200);
  assert.equal(await exists(recoveryRoot, 'android'), false);
  assert.equal(
    await exists(recoveryRoot, 'android/LATE_STAGING_WRITE.js'),
    false,
  );

  process.stdout.write('Release lifecycle verification passed.\n');
} finally {
  await rm(recoveryRoot, { recursive: true, force: true });
}
