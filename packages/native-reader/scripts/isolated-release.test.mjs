import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
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
  packIsolatedRelease,
  prepareIsolatedRelease,
  RELEASE_VERSION,
} from './isolated-release.mjs';
import { digestTree } from './verify-packed-package.mjs';
import {
  createOwnedStagingRoot,
  disposeOwnedStagingRoot,
} from './staging-ownership.mjs';

const cacheRoot = path.join(os.homedir(), '.cache/opencode-tmp/opencode');
const link = (target, destination) =>
  symlink(
    target,
    destination,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
const fixture = async (t) => {
  await mkdir(cacheRoot, { recursive: true });
  const root = await mkdtemp(path.join(cacheRoot, 'hn-isolated-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, 'workspace');
  const packageRoot = path.join(workspaceRoot, 'package');
  const staging = await createOwnedStagingRoot({
    parentRoot: root,
    prefix: 'staging-',
  });
  const artifacts = await createOwnedStagingRoot({
    parentRoot: root,
    prefix: 'artifacts-',
  });
  const stagingRoot = staging.outputRoot;
  const packDestination = artifacts.outputRoot;
  const sourceRoot = path.join(workspaceRoot, 'webview');
  const coreRoot = path.join(workspaceRoot, 'core');
  for (const target of [
    packageRoot,
    stagingRoot,
    packDestination,
    sourceRoot,
    coreRoot,
    path.join(workspaceRoot, 'node_modules'),
  ])
    await mkdir(target, { recursive: true });
  await mkdir(path.join(packageRoot, 'empty-source-dir'));
  await writeFile(
    path.join(packageRoot, 'USER_SOURCE_SENTINEL'),
    'uncommitted source\n',
  );
  await writeFile(path.join(workspaceRoot, 'tsconfig.base.json'), '{}');
  await writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@fixture/native-reader',
      private: true,
      scripts: {
        prepack: 'node scripts/release-lifecycle.mjs refuse-source-pack',
        'pack:release': 'node scripts/isolated-release.mjs',
      },
      dependencies: { 'react-native-webview': '13.16.1' },
      devDependencies: { '@hamster-note/pdfkit': 'workspace:*' },
      peerDependencies: { '@hamster-note/pdfkit': '0.1.0' },
      peerDependenciesMeta: { '@hamster-note/pdfkit': { optional: true } },
    }),
  );
  const options = {
    packageRoot,
    workspaceRoot,
    stagingRoot,
    stagingOwnership: staging.ownership,
    packDestination,
    packOwnership: artifacts.ownership,
    resolveSecureInputs: () => ({ sourceRoot, coreRoot }),
  };
  return { root, options };
};

test('production pack stages isolated copy even when caller sets retired bypass variable', async (t) => {
  const { options } = await fixture(t);
  const previous = process.env.HN_FOLIATE_RUNTIME_ALREADY_VALIDATED;
  process.env.HN_FOLIATE_RUNTIME_ALREADY_VALIDATED = '1';
  let stageCalls = 0;
  try {
    await assert.rejects(
      () =>
        packIsolatedRelease({
          ...options,
          stageFoliateRuntimeFn: async ({ workspace, packageRoot }) => {
            stageCalls += 1;
            assert.equal(workspace, options.workspaceRoot);
            assert.notEqual(packageRoot, options.packageRoot);
            assert.equal(
              path.relative(options.stagingRoot, packageRoot).startsWith('..'),
              false,
            );
            throw new Error('staging sentinel');
          },
        }),
      /staging sentinel/,
    );
    assert.equal(stageCalls, 1);
  } finally {
    if (previous === undefined)
      delete process.env.HN_FOLIATE_RUNTIME_ALREADY_VALIDATED;
    else process.env.HN_FOLIATE_RUNTIME_ALREADY_VALIDATED = previous;
  }
});

test('prepare/pack reject overlapping source/parent/child/alias and output links before callbacks or copy', async (t) => {
  const { root, options } = await fixture(t);
  const child = path.join(options.packageRoot, 'child');
  await mkdir(child);
  const alias = path.join(root, 'source-alias');
  await link(options.packageRoot, alias);
  const outputLink = path.join(root, 'output-link');
  await link(options.stagingRoot, outputLink);
  const parentLink = path.join(root, 'parent-link');
  await link(root, parentLink);
  for (const output of [
    options.packageRoot,
    options.workspaceRoot,
    child,
    alias,
    outputLink,
    path.join(parentLink, 'staging'),
  ]) {
    for (const run of [prepareIsolatedRelease, packIsolatedRelease]) {
      let callbacks = 0;
      const before = await digestTree(root);
      await assert.rejects(
        run({
          ...options,
          stagingRoot: output,
          resolveSecureInputs: () => {
            callbacks += 1;
            throw new Error('must not resolve');
          },
          stageFoliateRuntimeFn: async () => {
            callbacks += 1;
          },
          runReleasePrepackFn: async () => {
            callbacks += 1;
          },
          runPack: async () => {
            callbacks += 1;
          },
        }),
        /overlaps authority|symlink\/junction/,
      );
      assert.equal(callbacks, 0);
      assert.equal(await digestTree(root), before);
    }
  }
  for (const output of [
    options.packageRoot,
    options.workspaceRoot,
    child,
    alias,
    outputLink,
  ]) {
    let callbacks = 0;
    const before = await digestTree(root);
    await assert.rejects(
      packIsolatedRelease({
        ...options,
        packDestination: output,
        resolveSecureInputs: () => {
          callbacks += 1;
          throw new Error('must not resolve');
        },
      }),
      /overlaps authority|symlink\/junction/,
    );
    assert.equal(callbacks, 0);
    assert.equal(await digestTree(root), before);
  }
});

test('pack rejects foreign destination child link and missing args before callbacks', async (t) => {
  const { root, options } = await fixture(t);
  await link(
    options.packageRoot,
    path.join(options.packDestination, 'FOREIGN_SOURCE_LINK'),
  );
  const before = await digestTree(root);
  let calls = 0;
  await assert.rejects(
    packIsolatedRelease({
      ...options,
      stageFoliateRuntimeFn: async () => {
        calls += 1;
      },
    }),
    /symlink\/junction/,
  );
  for (const changes of [
    { stagingRoot: undefined },
    { packDestination: undefined },
    { stagingRoot: path.join(root, 'absent') },
  ]) {
    await assert.rejects(
      packIsolatedRelease({
        ...options,
        ...changes,
        stageFoliateRuntimeFn: async () => {
          calls += 1;
        },
      }),
      /required|ENOENT/,
    );
  }
  assert.equal(calls, 0);
  assert.equal(await digestTree(root), before);
});

test('installed input overlap is rejected before mkdir/copy/Foliate/prepack/npm', async (t) => {
  const { root, options } = await fixture(t);
  for (const run of [prepareIsolatedRelease, packIsolatedRelease]) {
    let calls = 0;
    const before = await digestTree(root);
    await assert.rejects(
      run({
        ...options,
        resolveSecureInputs: () => ({
          sourceRoot: options.stagingRoot,
          coreRoot: options.workspaceRoot,
        }),
        stageFoliateRuntimeFn: async () => {
          calls += 1;
        },
        runReleasePrepackFn: async () => {
          calls += 1;
        },
        runPack: async () => {
          calls += 1;
        },
      }),
      /overlaps authority/,
    );
    assert.equal(calls, 0);
    assert.equal(await digestTree(root), before);
  }
});

test('valid sibling mock pack uses unique destination, preserves foreign root and entire authority', async (t) => {
  const { options } = await fixture(t);
  await writeFile(
    path.join(options.packageRoot, 'tsconfig.json'),
    JSON.stringify({ extends: '../../tsconfig.base.json' }),
  );
  const compilerSettings = {
    compilerOptions: { target: 'ES2022', jsx: 'react-jsx' },
  };
  await writeFile(
    path.join(options.workspaceRoot, 'tsconfig.base.json'),
    JSON.stringify(compilerSettings),
  );
  const foreign = path.join(options.stagingRoot, 'staging-workspace');
  await mkdir(foreign);
  await writeFile(path.join(foreign, 'FOREIGN_SENTINEL'), 'keep forever');
  const before = await digestTree(options.workspaceRoot);
  const events = [];
  const result = await packIsolatedRelease({
    ...options,
    stageFoliateRuntimeFn: async ({ packageRoot }) => {
      events.push('foliate');
      assert.notEqual(packageRoot, options.packageRoot);
      await mkdir(path.join(packageRoot, 'foliate-runtime'), {
        recursive: true,
      });
      await writeFile(
        path.join(packageRoot, 'foliate-runtime/MOCK'),
        'mock regeneration',
      );
    },
    runReleasePrepackFn: async (context) => {
      events.push('prepack');
      assert.equal(context.authorityPackageRoot, options.packageRoot);
      assert.notEqual(context.packageRoot, options.packageRoot);
      const config = JSON.parse(
        await readFile(path.join(context.packageRoot, 'tsconfig.json'), 'utf8'),
      );
      assert.deepEqual(
        JSON.parse(
          await readFile(
            path.resolve(context.packageRoot, config.extends),
            'utf8',
          ),
        ),
        compilerSettings,
        'isolated build must resolve the original compiler settings',
      );
      await writeFile(
        path.join(context.packageRoot, 'MOCK_BUILD'),
        'mock build',
      );
    },
    runPack: async (packageRoot, destination) => {
      events.push('pack');
      const manifest = JSON.parse(
        await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
      );
      assert.equal(manifest.version, RELEASE_VERSION);
      assert.equal(manifest.private, undefined);
      assert.equal(manifest.scripts.prepack, undefined);
      assert.equal(manifest.devDependencies['@hamster-note/pdfkit'], '0.1.0');
      assert.equal(manifest.peerDependencies['@hamster-note/pdfkit'], '0.1.0');
      assert.equal(
        manifest.peerDependenciesMeta['@hamster-note/pdfkit'].optional,
        true,
      );
      assert.doesNotMatch(JSON.stringify(manifest), /workspace:/);
      await writeFile(
        path.join(destination, 'fixture.tgz'),
        'mock tarball bytes',
      );
      return JSON.stringify([
        { filename: 'fixture.tgz', version: RELEASE_VERSION, files: [] },
      ]);
    },
  });
  assert.deepEqual(events, ['foliate', 'prepack', 'pack']);
  assert.match(result.tarballSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    result.tarball,
    path.join(options.packDestination, 'fixture.tgz'),
  );
  assert.equal(
    await readFile(path.join(foreign, 'FOREIGN_SENTINEL'), 'utf8'),
    'keep forever',
  );
  assert.equal(await digestTree(options.workspaceRoot), before);
  // CLI 的 finally 只清理 staging；独立 artifact 必须仍在 sibling owned 根。
  await disposeOwnedStagingRoot({
    outputRoot: options.stagingRoot,
    ownership: options.stagingOwnership,
  });
  assert.equal(await readFile(result.tarball, 'utf8'), 'mock tarball bytes');
});

test('PDFKit workspace dependency rejects a non-exact public peer without changing source', async (t) => {
  const { options } = await fixture(t);
  const manifestPath = path.join(options.packageRoot, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.peerDependencies['@hamster-note/pdfkit'] = '^0.1.0';
  await writeFile(manifestPath, JSON.stringify(manifest));
  const before = await digestTree(options.workspaceRoot);
  await assert.rejects(
    prepareIsolatedRelease({
      ...options,
      stageFoliateRuntimeFn: async () => {},
      runReleasePrepackFn: async () => {},
    }),
    /exact public peer version/,
  );
  assert.equal(await digestTree(options.workspaceRoot), before);
});

test('source lib is excluded; copied mutable symlink rejects before Foliate/prepack callbacks', async (t) => {
  const { options } = await fixture(t);
  await link(options.packageRoot, path.join(options.packageRoot, 'apple'));
  let calls = 0;
  const before = await digestTree(options.packageRoot);
  await assert.rejects(
    prepareIsolatedRelease({
      ...options,
      stageFoliateRuntimeFn: async () => {
        calls += 1;
      },
      runReleasePrepackFn: async () => {
        calls += 1;
      },
    }),
    /symlink\/junction/,
  );
  assert.equal(calls, 0);
  assert.equal(await digestTree(options.packageRoot), before);
});

test('failed isolated prepack never deletes foreign staging tree or authority', async (t) => {
  const { options } = await fixture(t);
  const before = await digestTree(options.packageRoot);
  await writeFile(
    path.join(options.stagingRoot, 'FOREIGN_SENTINEL'),
    'foreign',
  );
  await assert.rejects(
    prepareIsolatedRelease({
      ...options,
      stageFoliateRuntimeFn: async () => {},
      runReleasePrepackFn: async () => {
        throw new Error('mock writer failure');
      },
    }),
    /mock writer failure/,
  );
  assert.equal(
    await readFile(path.join(options.stagingRoot, 'FOREIGN_SENTINEL'), 'utf8'),
    'foreign',
  );
  assert.equal(await digestTree(options.packageRoot), before);
  assert.ok(
    (await readdir(options.stagingRoot)).some((name) =>
      name.startsWith('staging-workspace-'),
    ),
  );
});

test('source aliases canonicalize before copy and lifecycle authority remains source, not output', async (t) => {
  const { root, options } = await fixture(t);
  const alias = path.join(root, 'source-alias');
  await link(options.packageRoot, alias);
  const before = await digestTree(options.workspaceRoot);
  let calls = 0;
  await prepareIsolatedRelease({
    ...options,
    packageRoot: alias,
    stageFoliateRuntimeFn: async () => {},
    runReleasePrepackFn: async (context) => {
      calls += 1;
      assert.equal(context.authorityPackageRoot, options.packageRoot);
      assert.notEqual(context.packageRoot, options.packageRoot);
    },
  });
  assert.equal(calls, 1);
  assert.equal(await digestTree(options.workspaceRoot), before);
});

test('isolated CLI requires explicit external destination instead of default cwd', async () => {
  const script = fileURLToPath(
    new URL('./isolated-release.mjs', import.meta.url),
  );
  for (const args of [[], ['--pack-destination'], ['--bogus', '/unused']]) {
    await assert.rejects(
      promisify(execFile)(process.execPath, [script, ...args]),
      /Usage: isolated-release/,
    );
  }
});

test('pack staging/artifact roots reject canonical equal, parent, child and aliases before callbacks', async (t) => {
  const { root, options } = await fixture(t);
  const child = path.join(options.stagingRoot, 'child-artifacts');
  await mkdir(child);
  const alias = path.join(root, 'staging-alias');
  await link(options.stagingRoot, alias);
  for (const [stagingRoot, packDestination] of [
    [options.stagingRoot, options.stagingRoot],
    [options.stagingRoot, root],
    [options.stagingRoot, child],
    [options.stagingRoot, alias],
    [alias, options.stagingRoot],
  ]) {
    let calls = 0;
    const before = await digestTree(root);
    await assert.rejects(
      packIsolatedRelease({
        ...options,
        stagingRoot,
        packDestination,
        resolveSecureInputs: () => {
          calls += 1;
          throw new Error('must not resolve');
        },
        stageFoliateRuntimeFn: async () => {
          calls += 1;
        },
        runReleasePrepackFn: async () => {
          calls += 1;
        },
        runPack: async () => {
          calls += 1;
        },
      }),
      /overlaps authority|symlink\/junction/,
    );
    assert.equal(calls, 0);
    assert.equal(await digestTree(root), before);
  }
});

test('foreign existing staging/artifact sibling is never adopted or overwritten', async (t) => {
  const { root, options } = await fixture(t);
  const foreign = path.join(root, 'foreign');
  await mkdir(foreign);
  await writeFile(path.join(foreign, 'FOREIGN_SENTINEL'), 'foreign');
  for (const changes of [
    { stagingRoot: foreign, stagingOwnership: undefined },
    { stagingRoot: foreign },
    { packDestination: foreign, packOwnership: undefined },
    { packDestination: foreign },
  ]) {
    const before = await digestTree(root);
    let calls = 0;
    await assert.rejects(
      packIsolatedRelease({
        ...options,
        ...changes,
        resolveSecureInputs: () => {
          calls += 1;
          throw new Error('must not resolve');
        },
      }),
      /capability/,
    );
    assert.equal(calls, 0);
    assert.equal(await digestTree(root), before);
  }
});
