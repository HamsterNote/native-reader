import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { assertSafeStagingPaths } from './staging-path-safety.mjs';
import { createOwnedStagingRoot } from './staging-ownership.mjs';
import {
  cleanSecureWebView,
  DEFAULT_STAGING_WRITERS,
  generateStagedIntegrityManifest,
  stageIosFoliateRuntimeBundle,
  stageSecureWebView,
} from './stage-secure-webview.mjs';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheRoot = path.join(os.homedir(), '.cache/opencode-tmp/opencode');
const execFileAsync = promisify(execFile);
const authorityKeys = [
  'sourceRoot',
  'productSourceRoot',
  'referenceIntegrityRoot',
  'runtimeRoot',
  'capabilityRoot',
];
const mutablePaths = [
  'android',
  'apple',
  'secure-webview',
  'apple-fault-matrix',
  'lib/vendor/core',
  'HNSecureWebView.podspec',
  'react-native.config.js',
  'SECURE_WEBVIEW_SHA256.json',
];

// 树摘要不跟随链接：同时覆盖目录布局、文件字节及 link target。
// 每个危险调用前后摘要必须相同，证明拒绝发生在 cleanup/write 之前。
const treeDigest = async (root) => {
  const hash = createHash('sha256');
  const visit = async (relative = '') => {
    const target = path.join(root, relative);
    const entry = await lstat(target);
    hash.update(JSON.stringify(relative));
    if (entry.isSymbolicLink()) {
      hash.update(`L:${await readlink(target)}`);
    } else if (entry.isDirectory()) {
      hash.update('D:');
      for (const name of (await readdir(target)).sort()) {
        await visit(path.join(relative, name));
      }
    } else {
      hash.update('F:');
      hash.update(await readFile(target));
    }
  };
  await visit();
  return hash.digest('hex');
};

const fixture = async (t) => {
  await mkdir(cacheRoot, { recursive: true });
  const root = await mkdtemp(path.join(cacheRoot, 'hn-staging-path-safety-'));
  // 只删除本测试创建的唯一 root；绝不调用工作区生产 clean/stage。
  t.after(() => rm(root, { recursive: true, force: true }));
  const authority = path.join(root, 'authority');
  const owned = await createOwnedStagingRoot({
    parentRoot: root,
    prefix: 'output-',
  });
  const outputRoot = owned.outputRoot;
  await mkdir(authority);
  await writeFile(
    path.join(authority, 'USER_SOURCE_SENTINEL'),
    'user source\n',
  );
  await mkdir(path.join(outputRoot, 'android'));
  await writeFile(
    path.join(outputRoot, 'android/HN_SECURE_WEBVIEW_GENERATED'),
    'stage-secure-webview.mjs\n',
  );
  await writeFile(
    path.join(outputRoot, 'android/KEEP_UNTIL_SAFE'),
    'owned output\n',
  );
  const plan = { outputRoot, ownership: owned.ownership };
  for (const key of authorityKeys) plan[key] = authority;
  return { root, authority, outputRoot, plan };
};

const rejectUnchanged = async (root, run, expected) => {
  const before = await treeDigest(root);
  await assert.rejects(run, expected);
  assert.equal(
    await treeDigest(root),
    before,
    'refusal must not change any fixture bytes/paths',
  );
};

const linkDirectory = (target, link) =>
  symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');

test('helper allows isolated siblings and duplicate authority aliases; returns canonical roots', async (t) => {
  const { root, authority, outputRoot } = await fixture(t);
  const alias = path.join(root, 'authority-alias');
  await linkDirectory(authority, alias);
  const before = await treeDigest(root);
  const result = await assertSafeStagingPaths({
    outputRoot,
    authorityRoots: [authority, alias, authority],
    mutablePaths,
  });
  assert.deepEqual(result, {
    outputRoot: await realpath(outputRoot),
    authorityRoots: Array(3).fill(await realpath(authority)),
  });
  assert.equal(await treeDigest(root), before);
});

test('helper rejects same, parent, child, and canonical authority alias overlap', async (t) => {
  const { root, authority, outputRoot } = await fixture(t);
  const child = path.join(authority, 'child');
  await mkdir(child);
  const alias = path.join(root, 'authority-alias');
  await linkDirectory(authority, alias);
  for (const [output, authorities] of [
    [authority, [authority]],
    [root, [authority]],
    [child, [authority]],
    [authority, [alias]],
    [outputRoot, [path.join(outputRoot, '../', path.basename(outputRoot))]],
  ]) {
    await rejectUnchanged(
      root,
      () =>
        assertSafeStagingPaths({
          outputRoot: output,
          authorityRoots: authorities,
        }),
      /overlaps authority/,
    );
  }
});

test(
  'Windows drive/case spellings still reject canonical overlap',
  {
    skip: process.platform !== 'win32' && 'requires native Windows filesystem',
  },
  async (t) => {
    const { root, authority } = await fixture(t);
    const canonical = await realpath(authority);
    await rejectUnchanged(
      root,
      () =>
        assertSafeStagingPaths({
          outputRoot: canonical.toUpperCase(),
          authorityRoots: [canonical.toLowerCase()],
        }),
      /overlaps authority/,
    );
  },
);

test('helper rejects symlinked output parent and final output link (including dangling link)', async (t) => {
  const { root, authority, outputRoot } = await fixture(t);
  const parentLink = path.join(root, 'parent-link');
  await linkDirectory(root, parentLink);
  const outputLink = path.join(root, 'output-link');
  await linkDirectory(outputRoot, outputLink);
  const dangling = path.join(root, 'dangling-output');
  await linkDirectory(path.join(root, 'missing'), dangling);
  for (const output of [
    path.join(parentLink, 'output'),
    outputLink,
    dangling,
  ]) {
    await rejectUnchanged(
      root,
      () =>
        assertSafeStagingPaths({
          outputRoot: output,
          authorityRoots: [authority],
        }),
      /symlink\/junction/,
    );
  }
});

test(
  'Windows raw slash/backslash/mixed junction components cannot be folded through dot-dot',
  {
    skip:
      process.platform !== 'win32' &&
      'requires native Windows junction filesystem',
  },
  async (t) => {
    const { root, authority, outputRoot } = await fixture(t);
    const junction = path.join(root, 'junction');
    await linkDirectory(authority, junction);
    const raw = `${junction}\\..\\${path.basename(outputRoot)}`;
    for (const output of [
      raw,
      raw.replaceAll('\\', '/'),
      `${junction.replaceAll('\\', '/')}\\../${path.basename(outputRoot)}`,
    ]) {
      await rejectUnchanged(
        root,
        () =>
          assertSafeStagingPaths({
            outputRoot: output,
            authorityRoots: [authority],
          }),
        /symlink\/junction/,
      );
    }
    await linkDirectory(authority, path.join(outputRoot, 'junction'));
    for (const mutable of [
      'junction\\..\\new',
      'junction/../new',
      'junction\\../new',
    ]) {
      await rejectUnchanged(
        root,
        () =>
          assertSafeStagingPaths({
            outputRoot,
            authorityRoots: [authority],
            mutablePaths: [mutable],
          }),
        /symlink\/junction/,
      );
    }
  },
);

test('stage/clean require process capability even for foreign sibling with generated markers', async (t) => {
  const { root, authority, plan } = await fixture(t);
  const foreign = path.join(root, 'foreign');
  await mkdir(path.join(foreign, 'android'), { recursive: true });
  await writeFile(
    path.join(foreign, 'android/HN_SECURE_WEBVIEW_GENERATED'),
    'stage-secure-webview.mjs\n',
  );
  await writeFile(
    path.join(foreign, 'android/USER_SOURCE_SENTINEL'),
    'not owned',
  );
  for (const run of [stageSecureWebView, cleanSecureWebView]) {
    for (const ownership of [undefined, {}, plan.ownership]) {
      await rejectUnchanged(
        root,
        () => run({ ...plan, outputRoot: foreign, ownership }),
        /capability/,
      );
    }
  }
  await rejectUnchanged(
    root,
    () =>
      stageIosFoliateRuntimeBundle({
        outputRoot: foreign,
        runtimeRoot: authority,
      }),
    /capability/,
  );
  await rejectUnchanged(
    root,
    () => generateStagedIntegrityManifest(foreign),
    /capability/,
  );
  for (const writer of DEFAULT_STAGING_WRITERS) {
    await rejectUnchanged(
      root,
      () => writer.run({ ...plan, outputRoot: foreign, ownership: undefined }),
      /capability/,
    );
  }
  // 显式 isolated CLI 参数也无法 mint/adopt 任意 existing foreign root。
  await rejectUnchanged(
    root,
    () =>
      execFileAsync(process.execPath, [
        path.join(packageRoot, 'scripts/stage-secure-webview.mjs'),
        '--stage',
        '--output-root',
        foreign,
        '--runtime-root',
        authority,
      ]),
    /capability/,
  );
  await rejectUnchanged(
    root,
    () =>
      execFileAsync(process.execPath, [
        path.join(packageRoot, 'scripts/stage-secure-webview.mjs'),
        '--clean',
        '--output-root',
        foreign,
        '--runtime-root',
        authority,
      ]),
    /capability/,
  );
});

test('Apple fault cleanup rejects foreign bytes before any removal; matching authority seed is cleaned fully', async (t) => {
  const { root, authority, outputRoot, plan } = await fixture(t);
  const relative = 'apple-fault-matrix/HNSecureWebViewDecisionManagerTests.m';
  await mkdir(path.join(authority, 'apple-fault-matrix'));
  await mkdir(path.join(outputRoot, 'apple-fault-matrix'));
  await writeFile(path.join(authority, relative), 'reviewed tests');
  await writeFile(path.join(outputRoot, relative), 'FOREIGN_USER_TESTS');
  for (const run of [stageSecureWebView, cleanSecureWebView]) {
    await rejectUnchanged(root, () => run(plan), /unowned Apple fault matrix/);
  }
  await writeFile(path.join(outputRoot, relative), 'reviewed tests');
  await writeFile(
    path.join(outputRoot, 'apple-fault-matrix/FOREIGN_EXTRA'),
    'unowned',
  );
  await rejectUnchanged(
    root,
    () => cleanSecureWebView(plan),
    /unowned Apple fault matrix/,
  );
  await rm(path.join(outputRoot, 'apple-fault-matrix/FOREIGN_EXTRA'));
  const sourceBefore = await treeDigest(authority);
  await cleanSecureWebView(plan);
  assert.deepEqual(await readdir(outputRoot), []);
  assert.equal(await treeDigest(authority), sourceBefore);
});

test('helper rejects missing/invalid args, absent/file output, absent authority and escaped mutable path', async (t) => {
  const { root, authority, outputRoot } = await fixture(t);
  const file = path.join(root, 'file-output');
  await writeFile(file, 'not a directory\n');
  const valid = { outputRoot, authorityRoots: [authority] };
  for (const options of [
    undefined,
    { authorityRoots: [authority] },
    { ...valid, outputRoot: '' },
    { outputRoot },
    { ...valid, authorityRoots: [] },
    { ...valid, authorityRoots: [undefined] },
    { ...valid, authorityRoots: [path.join(root, 'missing')] },
    { ...valid, authorityRoots: [file] },
    { ...valid, outputRoot: path.join(root, 'missing') },
    { ...valid, outputRoot: file },
    { ...valid, mutablePaths: '../authority' },
    { ...valid, mutablePaths: ['../authority'] },
    { ...valid, mutablePaths: [authority] },
    { ...valid, mutablePaths: [''] },
  ]) {
    await rejectUnchanged(
      root,
      () => assertSafeStagingPaths(options),
      /required|directory|ENOENT|escaped|array/,
    );
  }
});

test('nonexistent components followed by dot-dot cannot turn an absent output into a valid directory', async (t) => {
  const { root, authority, outputRoot } = await fixture(t);
  await rejectUnchanged(
    root,
    () =>
      assertSafeStagingPaths({
        outputRoot: `${outputRoot}${path.sep}missing${path.sep}..`,
        authorityRoots: [authority],
      }),
    /ENOENT/,
  );
});

test('helper rejects mutable path component and descendant links without following them', async (t) => {
  const { root, authority, outputRoot } = await fixture(t);
  const linkedLib = path.join(outputRoot, 'lib');
  await linkDirectory(authority, linkedLib);
  await rejectUnchanged(
    root,
    () =>
      assertSafeStagingPaths({
        outputRoot,
        authorityRoots: [authority],
        mutablePaths: ['lib/vendor/core'],
      }),
    /symlink\/junction/,
  );
  const nested = path.join(outputRoot, 'android/nested');
  await mkdir(nested);
  await linkDirectory(authority, path.join(nested, 'source-jump'));
  await rejectUnchanged(
    root,
    () =>
      assertSafeStagingPaths({
        outputRoot,
        authorityRoots: [authority],
        mutablePaths: ['android'],
      }),
    /symlink\/junction/,
  );
});

test('dot-dot normalization cannot hide an existing linked output/mutable component', async (t) => {
  const { root, authority, outputRoot } = await fixture(t);
  const outputLink = path.join(root, 'link');
  await linkDirectory(authority, outputLink);
  await rejectUnchanged(
    root,
    () =>
      assertSafeStagingPaths({
        outputRoot: `${outputLink}${path.sep}..${path.sep}output`,
        authorityRoots: [authority],
      }),
    /symlink\/junction/,
  );
  await linkDirectory(authority, path.join(outputRoot, 'android/source-link'));
  await rejectUnchanged(
    root,
    () =>
      assertSafeStagingPaths({
        outputRoot,
        authorityRoots: [authority],
        mutablePaths: ['android/source-link/../uncreated'],
      }),
    /symlink\/junction/,
  );
});

test('authority realpath resolves original symlink/dot-dot components before overlap comparison', async (t) => {
  const { root, authority, outputRoot } = await fixture(t);
  const nestedOutput = path.join(outputRoot, 'nested');
  await mkdir(nestedOutput);
  const alias = path.join(authority, 'nested-alias');
  await linkDirectory(nestedOutput, alias);
  // lexical normalize 得到 authority（错误地允许 sibling），实际 realpath 是 output。
  await rejectUnchanged(
    root,
    () =>
      assertSafeStagingPaths({
        outputRoot,
        authorityRoots: [`${alias}${path.sep}..`],
      }),
    /overlaps authority/,
  );
});

test('stage and clean reject overlap with every authority before cleanup; protected tree digest unchanged', async (t) => {
  const { root, outputRoot, plan } = await fixture(t);
  for (const key of authorityKeys) {
    const overlapping = { ...plan, [key]: outputRoot };
    for (const run of [stageSecureWebView, cleanSecureWebView]) {
      await rejectUnchanged(root, () => run(overlapping), /overlaps authority/);
    }
  }
  // 不能通过把所有显式 authority 换到 fixture 来绕过实际 module packageRoot。
  for (const run of [stageSecureWebView, cleanSecureWebView]) {
    await rejectUnchanged(
      root,
      () => run({ ...plan, outputRoot: packageRoot }),
      /overlaps authority/,
    );
    await rejectUnchanged(
      root,
      () => run({ ...plan, outputRoot: path.join(packageRoot, 'scripts') }),
      /overlaps authority/,
    );
    await rejectUnchanged(
      root,
      () => run({ ...plan, outputRoot: path.dirname(packageRoot) }),
      /overlaps authority/,
    );
  }
});

test('stage and clean reject same/parent/child/alias output before deleting marked fixture source', async (t) => {
  const { root, authority, outputRoot, plan } = await fixture(t);
  const child = path.join(authority, 'child');
  await mkdir(child);
  const alias = path.join(root, 'authority-alias');
  await linkDirectory(authority, alias);
  for (const output of [authority, root, child]) {
    for (const run of [stageSecureWebView, cleanSecureWebView]) {
      await rejectUnchanged(
        root,
        () => run({ ...plan, outputRoot: output }),
        /overlaps authority/,
      );
    }
  }
  for (const run of [stageSecureWebView, cleanSecureWebView]) {
    await rejectUnchanged(
      root,
      () =>
        run({
          ...plan,
          outputRoot: authority,
          productSourceRoot: alias,
          referenceIntegrityRoot: alias,
        }),
      /overlaps authority/,
    );
    await rejectUnchanged(
      root,
      () =>
        run({
          ...plan,
          productSourceRoot: outputRoot,
          referenceIntegrityRoot: alias,
        }),
      /overlaps authority/,
    );
  }
});

test('stage and clean require explicit output/runtime and complete clean authority plan', async (t) => {
  const { root, plan } = await fixture(t);
  for (const run of [stageSecureWebView, cleanSecureWebView]) {
    await rejectUnchanged(root, () => run(), /required/);
    for (const key of ['outputRoot', 'sourceRoot', 'runtimeRoot']) {
      const incomplete = { ...plan };
      delete incomplete[key];
      await rejectUnchanged(root, () => run(incomplete), /required/);
    }
  }
  for (const key of authorityKeys) {
    const incomplete = { ...plan };
    delete incomplete[key];
    await rejectUnchanged(
      root,
      () => cleanSecureWebView(incomplete),
      /required/,
    );
  }
  await rejectUnchanged(
    root,
    () => cleanSecureWebView({ outputRoot: plan.outputRoot }),
    /required/,
  );
  await rejectUnchanged(
    root,
    () => stageSecureWebView({ ...plan, verifyIntegrityReference: false }),
    /requires reference integrity/,
  );
  await rejectUnchanged(
    root,
    () => stageSecureWebView({ ...plan, writeIntegrityManifest: false }),
    /requires reference integrity/,
  );
});

test('stage and clean reject links in every mutable path before deleting any owned output', async (t) => {
  for (const relative of mutablePaths) {
    const { root, authority, outputRoot, plan } = await fixture(t);
    const target = path.join(outputRoot, relative);
    // android 已存在，因此放链接在它的闭包外子目录；其余是直接组件链接。
    const link =
      relative === 'android' ? path.join(target, 'USER_SOURCE_LINK') : target;
    await mkdir(path.dirname(link), { recursive: true });
    await linkDirectory(authority, link);
    for (const run of [stageSecureWebView, cleanSecureWebView]) {
      await rejectUnchanged(root, () => run(plan), /symlink\/junction/);
    }
  }
});

test('stage and clean reject output links and symlinked output parent', async (t) => {
  const { root, outputRoot, plan } = await fixture(t);
  const link = path.join(root, 'output-link');
  const parent = path.join(root, 'parent-link');
  await linkDirectory(outputRoot, link);
  await linkDirectory(root, parent);
  for (const output of [link, path.join(parent, 'output')]) {
    for (const run of [stageSecureWebView, cleanSecureWebView]) {
      await rejectUnchanged(
        root,
        () => run({ ...plan, outputRoot: output }),
        /symlink\/junction/,
      );
    }
  }
});

test('clean accepts canonical product/reference aliases in a complete isolated sibling plan', async (t) => {
  const { root, authority, outputRoot, plan } = await fixture(t);
  const alias = path.join(root, 'reference-alias');
  await linkDirectory(authority, alias);
  const sourceBefore = await treeDigest(authority);
  await cleanSecureWebView({ ...plan, referenceIntegrityRoot: alias });
  assert.deepEqual(await readdir(outputRoot), []);
  assert.equal(await treeDigest(authority), sourceBefore);
});

test('clean preserves ownership preflight: foreign manifest rejects before removing marked output', async (t) => {
  const { root, outputRoot, plan } = await fixture(t);
  await writeFile(
    path.join(outputRoot, 'SECURE_WEBVIEW_SHA256.json'),
    JSON.stringify({
      generator: 'USER_SOURCE_SENTINEL',
    }),
  );
  await rejectUnchanged(
    root,
    () => cleanSecureWebView(plan),
    /unowned integrity manifest/,
  );
});

test('stage/clean reject canonically distinct product/reference roots before cleanup', async (t) => {
  const { root, plan } = await fixture(t);
  const other = path.join(root, 'other-reference');
  await mkdir(other);
  for (const run of [stageSecureWebView, cleanSecureWebView]) {
    await rejectUnchanged(
      root,
      () => run({ ...plan, referenceIntegrityRoot: other }),
      /same reviewed source tree/,
    );
  }
});

test('public bundle/manifest writers also reject unsafe paths before any rm/write', async (t) => {
  const { root, authority, outputRoot, plan } = await fixture(t);
  await rejectUnchanged(
    root,
    () =>
      stageIosFoliateRuntimeBundle({
        outputRoot: authority,
        runtimeRoot: authority,
      }),
    /overlaps authority/,
  );
  await rejectUnchanged(
    root,
    () => stageIosFoliateRuntimeBundle({ outputRoot }),
    /required/,
  );
  await mkdir(path.join(outputRoot, 'apple'));
  await linkDirectory(authority, path.join(outputRoot, 'apple/source-link'));
  await rejectUnchanged(
    root,
    () =>
      stageIosFoliateRuntimeBundle({
        outputRoot,
        runtimeRoot: authority,
        ownership: plan.ownership,
      }),
    /symlink\/junction/,
  );
  await linkDirectory(
    authority,
    path.join(outputRoot, 'SECURE_WEBVIEW_SHA256.json'),
  );
  await rejectUnchanged(
    root,
    () =>
      generateStagedIntegrityManifest(outputRoot, {
        ownership: plan.ownership,
      }),
    /symlink\/junction/,
  );
  const moduleAlias = path.join(root, 'module-alias');
  await linkDirectory(packageRoot, moduleAlias);
  await rejectUnchanged(
    root,
    () => generateStagedIntegrityManifest(moduleAlias),
    /symlink\/junction|overlaps authority/,
  );
  // 生成运行时根只允许出现在本次隔离输出内部，且必须声明按平台清单：
  // 干净 checkout 的 authority 树没有生成物，这里必须 fail closed 而不是回退读取。
  await rejectUnchanged(
    root,
    () =>
      stageIosFoliateRuntimeBundle({
        outputRoot,
        runtimeRoot: authority,
        ownership: plan.ownership,
        generatedRuntime: true,
      }),
    /inside the staging output/,
  );
  await rejectUnchanged(
    root,
    () =>
      stageIosFoliateRuntimeBundle({
        outputRoot,
        runtimeRoot: outputRoot,
        ownership: plan.ownership,
        generatedRuntime: true,
      }),
    /missing its native manifest/,
  );
});

test('package-directory CLI refuses no flags/missing output; closed-closure USER_SOURCE_SENTINEL survives', async (t) => {
  const { root } = await fixture(t);
  const clonedPackage = path.join(root, 'cloned-package');
  const scripts = path.join(clonedPackage, 'scripts');
  await mkdir(scripts, { recursive: true });
  for (const script of [
    'stage-secure-webview.mjs',
    'staging-path-safety.mjs',
    'staging-ownership.mjs',
  ]) {
    await cp(
      path.join(packageRoot, 'scripts', script),
      path.join(scripts, script),
    );
  }
  await mkdir(path.join(clonedPackage, 'android'));
  await writeFile(
    path.join(clonedPackage, 'android/HN_SECURE_WEBVIEW_GENERATED'),
    'stage-secure-webview.mjs\n',
  );
  await writeFile(
    path.join(clonedPackage, 'android/USER_SOURCE_SENTINEL'),
    'uncommitted outside closure\n',
  );
  for (const args of [
    [],
    ['--stage'],
    ['--clean'],
    ['--stage', '--runtime-root', clonedPackage],
    ['--clean', '--runtime-root', clonedPackage],
    ['--stage', '--output-root', clonedPackage],
    ['--clean', '--output-root', clonedPackage],
    ['--stage', '--output-root'],
    ['--clean', '--bogus'],
  ]) {
    await rejectUnchanged(
      root,
      () =>
        execFileAsync(
          process.execPath,
          ['scripts/stage-secure-webview.mjs', ...args],
          { cwd: clonedPackage },
        ),
      /Usage:|Explicit outputRoot/,
    );
  }
  // 不解析 workspace 依赖：全部 authority 显式给定，复现原地 stage/clean 拒绝。
  for (const mode of ['--stage', '--clean']) {
    await rejectUnchanged(
      root,
      () =>
        execFileAsync(
          process.execPath,
          [
            'scripts/stage-secure-webview.mjs',
            mode,
            '--output-root',
            clonedPackage,
            '--runtime-root',
            clonedPackage,
            '--source-root',
            clonedPackage,
          ],
          { cwd: clonedPackage },
        ),
      /overlaps authority/,
    );
  }
  assert.equal(
    await readFile(
      path.join(clonedPackage, 'android/USER_SOURCE_SENTINEL'),
      'utf8',
    ),
    'uncommitted outside closure\n',
  );
});
