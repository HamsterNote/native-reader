import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeStagingPaths } from './staging-path-safety.mjs';
import { assertOwnedStagingRoot } from './staging-ownership.mjs';

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

// release 会删除整个 lib，而不仅是 secure adapter；检查完整可变子树。
const mutablePaths = [
  'lib',
  'android',
  'apple',
  'secure-webview',
  'apple-fault-matrix',
  'HNSecureWebView.podspec',
  'react-native.config.js',
  'SECURE_WEBVIEW_SHA256.json',
  'package.json',
  'foliate-runtime',
];

/** 输出 packageRoot 与只读 authorityPackageRoot 必须显式区分。 */
export async function assertReleasePlan({
  packageRoot,
  ownership,
  authorityPackageRoot,
  workspaceRoot = defaultWorkspaceRoot,
  resolveSecureInputs = () => resolveInstalledInputs(workspaceRoot),
} = {}) {
  // 先校验输出，再解析 installed inputs；危险根不得触发任何注入回调。
  const initial = await assertSafeStagingPaths({
    outputRoot: packageRoot,
    authorityRoots: [defaultPackageRoot, authorityPackageRoot, workspaceRoot],
  });
  await assertOwnedStagingRoot({ outputRoot: initial.outputRoot, ownership });
  await assertSafeStagingPaths({
    outputRoot: initial.outputRoot,
    authorityRoots: initial.authorityRoots,
    mutablePaths,
  });
  const inputs = await resolveSecureInputs();
  const safe = await assertSafeStagingPaths({
    outputRoot: initial.outputRoot,
    authorityRoots: [
      ...initial.authorityRoots,
      inputs?.sourceRoot,
      inputs?.coreRoot,
    ],
    mutablePaths,
  });
  const authority = safe.authorityRoots[1];
  return {
    packageRoot: safe.outputRoot,
    ownership,
    authorityPackageRoot: authority,
    workspaceRoot: safe.authorityRoots[2],
    sourceRoot: safe.authorityRoots[3],
    coreRoot: safe.authorityRoots[4],
    outputRoot: safe.outputRoot,
    productSourceRoot: authority,
    referenceIntegrityRoot: authority,
    runtimeRoot: authority,
    capabilityRoot: authority,
  };
}

const optionsForPlan = (options, plan) => ({
  ...options,
  ...plan,
  resolveSecureInputs: () => ({
    sourceRoot: plan.sourceRoot,
    coreRoot: plan.coreRoot,
  }),
});

export async function cleanReleaseStaging(options = {}) {
  const plan = await assertReleasePlan(options);
  const {
    cleanBundledCoreFn = cleanBundledCore,
    cleanSecureWebViewFn = cleanSecureWebView,
  } = options;
  // Secure WebView owns lib/vendor/core/View.android.js while bundled-core
  // owns the containing directory. The parent may only be removed after the
  // child cleanup succeeds: if the adapter is foreign, continuing with core
  // cleanup would recursively delete the very file that failed ownership.
  await cleanSecureWebViewFn(plan);
  await assertReleasePlan(optionsForPlan(options, plan));
  await cleanBundledCoreFn({ ...plan, sourceRoot: plan.coreRoot });
}

export async function cleanBuildRelease(options = {}) {
  const plan = await assertReleasePlan(options);
  const { packageRoot, workspaceRoot } = plan;
  const {
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
  } = options;
  // 删除整个输出树，而不是依赖 Bob 覆盖已有文件，防止旧 gate 混入 tarball。
  await rm(path.join(packageRoot, 'lib'), {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
  await runBob();
}

export async function runReleasePrepack(options = {}) {
  // 必须位于 try 外：失败 preflight 绝不能落入 catch cleanup。
  const plan = await assertReleasePlan(options);
  const context = optionsForPlan(options, plan);
  const {
    cleanReleaseStagingFn = cleanReleaseStaging,
    buildReleaseFn = cleanBuildRelease,
    stageBundledCoreFn = stageBundledCore,
    stageSecureWebViewFn = stageSecureWebView,
  } = options;
  try {
    // 首先恢复可能由上次成功 prepack、异常中断 postpack 留下的 owned 状态。
    await cleanReleaseStagingFn(context);
    await assertReleasePlan(context);
    await buildReleaseFn(context);
    await assertReleasePlan(context);
    await stageBundledCoreFn({ ...context, sourceRoot: plan.coreRoot });
    await assertReleasePlan(context);
    await stageSecureWebViewFn(plan);
    await assertReleasePlan(context);
  } catch (error) {
    const cleanupResults = await Promise.allSettled([
      Promise.resolve().then(async () => {
        // writer 后新增链接时仍 fail closed，不因之前 preflight 成功而误删。
        await assertReleasePlan(context);
        await cleanReleaseStagingFn(context);
      }),
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
  const plan = await assertReleasePlan(options);
  await cleanReleaseStaging(optionsForPlan(options, plan));
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
  if (command === 'refuse-source-pack') refuseSourcePack();
  else {
    throw new Error(
      'Direct prepack/postpack are disabled. Usage: release-lifecycle.mjs refuse-source-pack',
    );
  }
}
