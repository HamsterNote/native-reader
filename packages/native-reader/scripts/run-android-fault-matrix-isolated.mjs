import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveInstalledInputs,
  stageSecureWebView,
} from './stage-secure-webview.mjs';
import { assertSafeStagingPaths } from './staging-path-safety.mjs';
import {
  assertOwnedStagingRoot,
  createOwnedStagingRoot,
  disposeOwnedStagingRoot,
} from './staging-ownership.mjs';

const defaultPackageRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const defaultCacheRoot = path.join(
  os.homedir(),
  '.cache/opencode-tmp/opencode',
);
const task = ':harness:testDebugUnitTest';

// 每个 authority 单独遍历：隐藏文件、空目录、类型、权限、bytes 和 link target
// 均进入摘要；不沿内部 symlink 读取别的 authority，也不排除 generated 文件。
async function authorityDigest(root) {
  const hash = createHash('sha256');
  const record = (value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  };
  const visit = async (relative = '') => {
    const target = path.join(root, relative);
    const entry = await lstat(target);
    record([relative, entry.mode]);
    if (entry.isSymbolicLink()) {
      record(['link', await readlink(target)]);
    } else if (entry.isDirectory()) {
      record(['directory']);
      for (const name of (await readdir(target)).sort()) {
        await visit(path.join(relative, name));
      }
    } else if (entry.isFile()) {
      record(['file', entry.size]);
      hash.update(await readFile(target));
    } else {
      throw new Error(`Unsupported authority entry: ${target}`);
    }
  };
  await visit();
  return hash.digest('hex');
}

const runGradle = ({ command, args, cwd, env }) =>
  execFileSync(command, args, { cwd, env, stdio: 'inherit' });

// 不尝试解析/过滤 JVM 参数：引号、argfile、agent 与属性覆盖都可能绕过白名单。
// 清空所有 inherited JVM/Gradle/Kotlin 注入入口，仅使用 wrapper 自己构造的参数。
function isolatedEnvironment(ownRoot, jvmProperties) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /^(?:JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|JAVA_OPTS|GRADLE_OPTS|KOTLIN_OPTS|KOTLIN_DAEMON_JVM_OPTIONS|KOTLIN_COMPILER_OPTS|GRADLE_RO_DEP_CACHE|GRADLE_HOME)$/i.test(
        key,
      ) ||
      /^ORG_GRADLE_PROJECT_/i.test(key)
    ) {
      delete env[key];
    }
  }
  const home = path.join(ownRoot, 'home');
  const androidHome = path.join(home, '.android');
  const controlled = {
    // JDK/SDK 安装路径（JAVA_HOME/ANDROID_HOME/ANDROID_SDK_ROOT）保持真实只读配置；
    // 用户状态、preferences、daemon runfiles 和 cache 不使用真实 home。
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: path.parse(home).root.replace(/[\\/]$/, ''),
    HOMEPATH: home.slice(path.parse(home).root.length - 1),
    APPDATA: path.join(home, 'appdata'),
    LOCALAPPDATA: path.join(home, 'local-appdata'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local/share'),
    XDG_STATE_HOME: path.join(home, '.local/state'),
    XDG_RUNTIME_DIR: path.join(ownRoot, 'xdg-runtime'),
    ANDROID_USER_HOME: androidHome,
    ANDROID_PREFS_ROOT: home,
    ANDROID_SDK_HOME: home,
    ANDROID_EMULATOR_HOME: path.join(androidHome, 'emulator'),
    ANDROID_AVD_HOME: path.join(androidHome, 'avd'),
    GRADLE_USER_HOME: path.join(ownRoot, 'gradle-user-home'),
    // 覆盖 wrapper、Gradle build JVM 和所有 test/worker fork 的 Java 默认位置。
    JAVA_TOOL_OPTIONS: jvmProperties.join(' '),
    TMPDIR: path.join(ownRoot, 'tmp'),
    TMP: path.join(ownRoot, 'tmp'),
    TEMP: path.join(ownRoot, 'tmp'),
  };
  // Windows 传递 env 时 key 不区分大小写，避免 inherited home/Temp 等拼写
  // 与受控 HOME/TEMP 共存后，子进程实际选中 foreign 版本。
  const controlledKeys = new Set(
    Object.keys(controlled).map((key) => key.toUpperCase()),
  );
  for (const key of Object.keys(env)) {
    if (controlledKeys.has(key.toUpperCase())) delete env[key];
  }
  return { ...env, ...controlled };
}

/**
 * 只消费 authority，唯一可写根由 ownership helper 用 mkdtemp 创建。
 * cacheRoot 必须预先存在，且连同整个自建根与所有 authority canonical 隔离；
 * 不接受用户 output/staging 目录，避免失败 cleanup 删除 foreign 目录。
 * 注入函数仅供直接 fixture 测试；CLI 始终使用真实 staging/Gradle。
 */
export async function runIsolatedAndroidFaultMatrix({
  packageRoot = defaultPackageRoot,
  workspaceRoot = path.resolve(packageRoot, '../..'),
  cacheRoot = defaultCacheRoot,
  resolveInstalledInputsFn = resolveInstalledInputs,
  stageSecureWebViewFn = stageSecureWebView,
  runGradleFn = runGradle,
} = {}) {
  const authority = await realpath(packageRoot);
  const before = await authorityDigest(authority);
  // package 必须在 resolver 前登记；resolver 抛错也不能跳过已取得的摘要。
  const snapshots = [
    { label: 'whole authority package tree', root: authority, before },
  ];
  const failures = [];
  let owned;
  try {
    const installed = await resolveInstalledInputsFn(workspaceRoot);
    const capture = async (label, root) => {
      const canonical = await realpath(root);
      snapshots.push({
        label,
        root: canonical,
        before: await authorityDigest(canonical),
      });
      return canonical;
    };
    // 任一后续 canonical/digest 失败，finally 仍逐项复核已经登记的 authority。
    const sourceRoot = await capture(
      'installed WebView authority tree',
      installed.sourceRoot,
    );
    // Honor a legacy caller's extra read-only authority, without requiring or
    // resolving the retired core for the Foliate host.
    const coreRoot = installed.coreRoot
      ? await capture('installed core authority tree', installed.coreRoot)
      : undefined;
    // runtime 子目录可能是指向包外的 alias；写入前也检查其真实 canonical 根。
    const runtimeAssetsRoot = await capture(
      'runtime authority tree',
      path.join(authority, 'foliate-runtime/native'),
    );
    const authorityRoots = [
      defaultPackageRoot,
      authority,
      sourceRoot,
      ...(coreRoot ? [coreRoot] : []),
      runtimeAssetsRoot,
    ];
    // 在 mkdtemp/cp/stage 之前检查，不能先在非法 cacheRoot 下创建再删除。
    const safeCache = await assertSafeStagingPaths({
      outputRoot: cacheRoot,
      authorityRoots,
    });
    owned = await createOwnedStagingRoot({
      parentRoot: safeCache.outputRoot,
      prefix: 'hn-android-fault-matrix-',
      authorityRoots,
    });
    // token 只授权 helper 创建的同一根；不对 existing 容器补发，也不授权子 stage。
    // harness 副本/工具状态在 stage 完成后加入这个根，最后整体按同一 token dispose。
    const ownRoot = owned.outputRoot;
    const safeStage = await assertSafeStagingPaths({
      outputRoot: ownRoot,
      authorityRoots,
    });
    await assertOwnedStagingRoot(owned);
    await stageSecureWebViewFn({
      outputRoot: safeStage.outputRoot,
      ownership: owned.ownership,
      sourceRoot,
      coreRoot,
      runtimeRoot: authority,
      productSourceRoot: authority,
      referenceIntegrityRoot: authority,
      capabilityRoot: authority,
    });

    await assertOwnedStagingRoot(owned);

    // Gradle 的 project build/.gradle 只能落到副本；不放宽 run-gradle.mjs
    // 的 cwd 合同，也不让原 harness 的 build 副产物改变 whole-package digest。
    const harnessRoot = path.join(ownRoot, 'android-fault-matrix');
    await cp(path.join(authority, 'android-fault-matrix'), harnessRoot, {
      recursive: true,
      dereference: true,
      filter: (source) =>
        !path
          .relative(path.join(authority, 'android-fault-matrix'), source)
          .split(path.sep)
          .some((part) => ['build', '.gradle', '.kotlin'].includes(part)),
    });
    const tmpRoot = path.join(ownRoot, 'tmp');
    const home = path.join(ownRoot, 'home');
    const kotlinRunfiles = path.join(ownRoot, 'kotlin-daemon');
    const kotlinCache = path.join(ownRoot, 'kotlin-cache');
    // 这些参数由我们构造，双引号仅用于支持 cache 路径中的空格。
    // JVM options 中的引号/换行会改变 token 边界，因此在启动前 fail closed。
    if (/[",\r\n]/.test(ownRoot))
      throw new Error(
        'Isolated cache path cannot contain JVM option quotes, commas or newlines',
      );
    const jvmProperties = [
      `"-Duser.home=${home}"`,
      `"-Djava.io.tmpdir=${tmpRoot}"`,
      `"-Djava.util.prefs.userRoot=${path.join(home, '.java/userPrefs')}"`,
      `"-Djava.util.prefs.systemRoot=${path.join(home, '.java/systemPrefs')}"`,
      // Kotlin 2.1.20 的 options parser 及默认 run-dir getter 都显式重定位。
      `"-Dkotlin.daemon.options=runFilesPath=${kotlinRunfiles}"`,
      `"-Dkotlin.daemon.custom.run.files.path.for.tests=${kotlinRunfiles}"`,
    ];
    const env = isolatedEnvironment(ownRoot, jvmProperties);
    for (const directory of [
      tmpRoot,
      home,
      kotlinRunfiles,
      kotlinCache,
      env.ANDROID_USER_HOME,
      env.ANDROID_EMULATOR_HOME,
      env.ANDROID_AVD_HOME,
      env.GRADLE_USER_HOME,
      env.APPDATA,
      env.LOCALAPPDATA,
      env.XDG_CACHE_HOME,
      env.XDG_CONFIG_HOME,
      env.XDG_DATA_HOME,
      env.XDG_STATE_HOME,
      env.XDG_RUNTIME_DIR,
    ])
      await mkdir(directory, { recursive: true });
    // 传入的是 authority 的真实 runtime，不是 stage output（后者不含 runtime 输入）。
    await runGradleFn({
      command: process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
      args: [
        '--no-daemon',
        '--gradle-user-home',
        env.GRADLE_USER_HOME,
        '--project-cache-dir',
        path.join(ownRoot, 'project-cache'),
        `-Duser.home=${home}`,
        `-Djava.io.tmpdir=${tmpRoot}`,
        `-Dkotlin.daemon.options=runFilesPath=${kotlinRunfiles}`,
        `-Dkotlin.daemon.custom.run.files.path.for.tests=${kotlinRunfiles}`,
        // 即使 Gradle 创建一次性 build JVM，也覆盖工程 gradle.properties 的 JVM 参数。
        `-Dorg.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8 ${jvmProperties.join(' ')}`,
        '-Pkotlin.compiler.execution.strategy=in-process',
        '-Pkotlin.incremental=false',
        `-Pkotlin.project.persistent.dir=${kotlinCache}`,
        `-PhnFaultMatrixStagedRoot=${safeStage.outputRoot}`,
        `-PhnFaultMatrixRuntimeAssetsRoot=${runtimeAssetsRoot}`,
        task,
      ],
      cwd: harnessRoot,
      env,
    });
  } catch (error) {
    failures.push(error);
  } finally {
    // 只 dispose 自己取得的 token/root；无 capability 时绝不清理 foreign/cache 根。
    // 换链或目录 identity 不符时 helper fail closed，不回退到裸 rm。
    if (owned) {
      try {
        await disposeOwnedStagingRoot(owned);
      } catch (error) {
        failures.push(error);
      }
    }
    // 不把所有复核包在同一个 try：某一树丢失/不可读也不能跳过其余不变式。
    // 原始 staging/Gradle/resolver/cleanup 失败在前，所有 invariant 失败随后聚合。
    for (const snapshot of snapshots) {
      try {
        if ((await authorityDigest(snapshot.root)) !== snapshot.before) {
          failures.push(
            new Error(`Android fault-matrix mutated the ${snapshot.label}`),
          );
        }
      } catch (error) {
        failures.push(
          new Error(`Cannot recheck ${snapshot.label}: ${snapshot.root}`, {
            cause: error,
          }),
        );
      }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Isolated Android fault-matrix failed');
  return { task, authoritySha256: before };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.length > 2)
    throw new Error(
      'Usage: node scripts/run-android-fault-matrix-isolated.mjs',
    );
  console.log(JSON.stringify(await runIsolatedAndroidFaultMatrix(), null, 2));
}
