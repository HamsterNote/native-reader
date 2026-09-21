import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanBundledCore, stageBundledCore } from './stage-bundled-core.mjs';
import {
  cleanSecureWebView,
  resolveInstalledInputs,
  stageSecureWebView,
} from './stage-secure-webview.mjs';

const defaultPackageRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const defaultWorkspaceRoot = path.resolve(defaultPackageRoot, '../..');

const failuresOf = (results) =>
  results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );

export async function cleanReleaseStaging({
  packageRoot = defaultPackageRoot,
  workspaceRoot = defaultWorkspaceRoot,
  cleanBundledCoreFn = cleanBundledCore,
  cleanSecureWebViewFn = cleanSecureWebView,
} = {}) {
  // Secure WebView owns lib/vendor/core/View.android.js while bundled-core
  // owns the containing directory. The parent may only be removed after the
  // child cleanup succeeds: if the adapter is foreign, continuing with core
  // cleanup would recursively delete the very file that failed ownership.
  await cleanSecureWebViewFn({ outputRoot: packageRoot });
  await cleanBundledCoreFn({ packageRoot, workspaceRoot });
}

export async function cleanBuildRelease({
  packageRoot = defaultPackageRoot,
  workspaceRoot = defaultWorkspaceRoot,
  runBob = () => {
    // npm pack --json reserves stdout for its machine-readable result. Keep
    // Bob diagnostics visible without contaminating that JSON stream.
    const output = execFileSync(
      process.execPath,
      [
        path.join(
          workspaceRoot,
          'node_modules/react-native-builder-bob/bin/bob',
        ),
        'build',
      ],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'inherit'],
      },
    );
    process.stderr.write(output);
  },
} = {}) {
  // 删除整个输出树，而不是依赖 Bob 覆盖已有文件，防止旧 gate 混入 tarball。
  await rm(path.join(packageRoot, 'lib'), {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
  await runBob();
}

export async function runReleasePrepack({
  packageRoot = defaultPackageRoot,
  workspaceRoot = defaultWorkspaceRoot,
  cleanReleaseStagingFn = cleanReleaseStaging,
  buildReleaseFn = cleanBuildRelease,
  stageBundledCoreFn = stageBundledCore,
  stageSecureWebViewFn = stageSecureWebView,
  resolveSecureInputs = () => resolveInstalledInputs(workspaceRoot),
} = {}) {
  try {
    // 首先恢复可能由上次成功 prepack、异常中断 postpack 留下的 owned 状态。
    await cleanReleaseStagingFn({ packageRoot, workspaceRoot });
    await buildReleaseFn({ packageRoot, workspaceRoot });
    await stageBundledCoreFn({ packageRoot, workspaceRoot });
    await stageSecureWebViewFn({
      ...resolveSecureInputs(),
      outputRoot: packageRoot,
      capabilityRoot: packageRoot,
    });
  } catch (error) {
    const cleanupResults = await Promise.allSettled([
      Promise.resolve().then(() =>
        cleanReleaseStagingFn({ packageRoot, workspaceRoot }),
      ),
    ]);
    const cleanupFailures = failuresOf(cleanupResults);
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        'Release prepack failed and cleanup was incomplete',
        { cause: error },
      );
    }
    throw error;
  }
}

export async function runReleasePostpack(options = {}) {
  await cleanReleaseStaging(options);
}

export function refuseSourcePack() {
  throw new Error(
    'Source-root npm pack/publish is disabled because release staging must not mutate the workspace. Run pnpm run pack:release and publish the generated tarball instead.',
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const command = process.argv[2];
  if (command === 'prepack') await runReleasePrepack();
  else if (command === 'postpack') await runReleasePostpack();
  else if (command === 'refuse-source-pack') refuseSourcePack();
  else {
    throw new Error(
      'Usage: release-lifecycle.mjs <prepack|postpack|refuse-source-pack>',
    );
  }
}
