import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { stageFoliateRuntime } from './stage-foliate-runtime.mjs';
import {
  checkFoliateWebRuntime,
  syncFoliateWebRuntime,
} from '../packages/native-reader/scripts/sync-foliate-web-runtime.mjs';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const sourceRoot = path.join(workspaceRoot, 'vendor/foliate-js');
const rootSyncCli = path.join(
  workspaceRoot,
  'scripts',
  'stage-foliate-runtime.mjs',
);
const packageSyncCli = path.join(
  workspaceRoot,
  'packages/native-reader/scripts/sync-foliate-web-runtime.mjs',
);

async function withRuntimeFixture(run) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'foliate-web-runtime-test-'),
  );
  const packageRoot = path.join(root, 'native-reader');
  const targetRoot = path.join(root, 'consumer');
  await mkdir(packageRoot, { recursive: true });
  await mkdir(targetRoot, { recursive: true });
  await writeFile(path.join(targetRoot, 'package.json'), '{"private":true}\n');
  await stageFoliateRuntime({
    workspace: root,
    packageRoot,
    sourceRoot,
    validateFn: async () => undefined,
  });
  try {
    await run({
      runtimeRoot: path.join(packageRoot, 'foliate-runtime', 'web'),
      targetRoot,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const expectFailure = async (message, run) => {
  await assert.rejects(run, (error) => error.message.includes(message));
};

test('sync/check copies only the manifest-declared Web runtime and preserves public siblings', async () => {
  await withRuntimeFixture(async ({ runtimeRoot, targetRoot }) => {
    const publicRoot = path.join(targetRoot, 'public');
    await mkdir(publicRoot, { recursive: true });
    await writeFile(path.join(publicRoot, 'application-owned.txt'), 'keep me');

    const synced = await syncFoliateWebRuntime({ runtimeRoot, targetRoot });
    await checkFoliateWebRuntime({ runtimeRoot, targetRoot });
    assert.equal(synced.readerRoot, path.join(publicRoot, 'reader'));
    assert.equal(
      await readFile(path.join(publicRoot, 'application-owned.txt'), 'utf8'),
      'keep me',
    );
    assert.equal(
      await readFile(path.join(publicRoot, 'reader', 'reader.html'), 'utf8'),
      await readFile(path.join(runtimeRoot, 'reader.html'), 'utf8'),
    );
  });
});

test('canonicalizes a symlinked project root while still rejecting public links', async () => {
  await withRuntimeFixture(async ({ runtimeRoot, targetRoot }) => {
    const linkedTarget = path.join(path.dirname(targetRoot), 'consumer-link');
    await symlink(targetRoot, linkedTarget);
    const synced = await syncFoliateWebRuntime({
      runtimeRoot,
      targetRoot: linkedTarget,
    });
    assert.equal(synced.readerRoot, path.join(targetRoot, 'public', 'reader'));
    await checkFoliateWebRuntime({ runtimeRoot, targetRoot: linkedTarget });
  });
});

test('check rejects missing, stale, extra, and hash-mismatched target assets', async () => {
  await withRuntimeFixture(async ({ runtimeRoot, targetRoot }) => {
    const readerRoot = path.join(targetRoot, 'public', 'reader');
    await syncFoliateWebRuntime({ runtimeRoot, targetRoot });
    await rm(path.join(readerRoot, 'bootstrap.js'));
    await expectFailure('missing assets: bootstrap.js', () =>
      checkFoliateWebRuntime({ runtimeRoot, targetRoot }),
    );

    await syncFoliateWebRuntime({ runtimeRoot, targetRoot });
    await writeFile(path.join(readerRoot, 'unexpected.js'), 'unexpected');
    await expectFailure('extra assets: unexpected.js', () =>
      checkFoliateWebRuntime({ runtimeRoot, targetRoot }),
    );

    await syncFoliateWebRuntime({ runtimeRoot, targetRoot });
    await writeFile(path.join(readerRoot, 'manifest.json'), '{}\n');
    await expectFailure('target manifest is stale', () =>
      checkFoliateWebRuntime({ runtimeRoot, targetRoot }),
    );

    await syncFoliateWebRuntime({ runtimeRoot, targetRoot });
    await writeFile(path.join(readerRoot, 'foliate', 'view.js'), 'tampered');
    await expectFailure('target hash mismatch: foliate/view.js', () =>
      checkFoliateWebRuntime({ runtimeRoot, targetRoot }),
    );

    await syncFoliateWebRuntime({ runtimeRoot, targetRoot });
    await writeFile(
      path.join(readerRoot, 'probes', 'csp-external-canary.js'),
      'tampered',
    );
    await expectFailure(
      'target hash mismatch: probes/csp-external-canary.js',
      () => checkFoliateWebRuntime({ runtimeRoot, targetRoot }),
    );
  });
});

test('sync/check reject a missing runtime manifest and invalid project root', async () => {
  await withRuntimeFixture(async ({ runtimeRoot, targetRoot }) => {
    await rm(path.join(runtimeRoot, 'manifest.json'));
    await expectFailure('runtime manifest is missing', () =>
      syncFoliateWebRuntime({ runtimeRoot, targetRoot }),
    );
  });

  await withRuntimeFixture(async ({ runtimeRoot, targetRoot }) => {
    const invalidRoot = path.join(targetRoot, 'not-a-project');
    await expectFailure('target root is missing', () =>
      syncFoliateWebRuntime({ runtimeRoot, targetRoot: invalidRoot }),
    );
  });
});

test('rejects incompatible manifests and every unsafe manifest path form', async () => {
  await withRuntimeFixture(async ({ runtimeRoot, targetRoot }) => {
    const manifestPath = path.join(runtimeRoot, 'manifest.json');
    const original = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const [, mutate, expected] of [
      [
        'runtime version',
        (manifest) => {
          manifest.runtimeVersion = 'unknown';
        },
        'unsupported shape',
      ],
      [
        'repository',
        (manifest) => {
          manifest.source.repository = 'https://example.invalid/foliate.git';
        },
        'unapproved Foliate source',
      ],
      [
        'commit',
        (manifest) => {
          manifest.source.commit = '0'.repeat(40);
        },
        'unapproved Foliate source',
      ],
      [
        'backslash',
        (manifest) => {
          manifest.assets[0].path = 'foliate\\view.js';
        },
        'unsafe asset path',
      ],
      [
        'drive prefix',
        (manifest) => {
          manifest.assets[0].path = 'C:reader.html';
        },
        'unsafe asset path',
      ],
      [
        'absolute',
        (manifest) => {
          manifest.assets[0].path = '/reader.html';
        },
        'unsafe asset path',
      ],
      [
        'dot segment',
        (manifest) => {
          manifest.assets[0].path = './reader.html';
        },
        'unsafe asset path',
      ],
      [
        'parent segment',
        (manifest) => {
          manifest.assets[0].path = '../reader.html';
        },
        'unsafe asset path',
      ],
      [
        'empty segment',
        (manifest) => {
          manifest.assets[0].path = 'foliate//view.js';
        },
        'unsafe asset path',
      ],
      [
        'manifest conflict',
        (manifest) => {
          manifest.assets[0].path = 'manifest.json';
        },
        'unsafe asset path',
      ],
      [
        'control character',
        (manifest) => {
          manifest.assets[0].path = 'foliate/\u0000view.js';
        },
        'unsafe asset path',
      ],
      [
        'non-normal unicode',
        (manifest) => {
          manifest.assets[0].path = 'foliate/cafe\u0301.js';
        },
        'unsafe asset path',
      ],
    ]) {
      const mutated = structuredClone(original);
      mutate(mutated);
      await writeFile(manifestPath, `${JSON.stringify(mutated, null, 2)}\n`);
      await expectFailure(expected, () =>
        syncFoliateWebRuntime({ runtimeRoot, targetRoot }),
      );
    }
  });
});

test('rejects runtime, public, reader, and asset symlinks without touching sibling public files', async () => {
  await withRuntimeFixture(async ({ runtimeRoot, targetRoot }) => {
    const publicRoot = path.join(targetRoot, 'public');
    const readerRoot = path.join(publicRoot, 'reader');
    const outsideRoot = path.join(targetRoot, 'outside');
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(
      path.join(outsideRoot, 'application-owned.txt'),
      'preserved',
    );

    await symlink(
      path.join(runtimeRoot, 'reader.html'),
      path.join(runtimeRoot, 'bootstrap-link.js'),
    );
    const manifestPath = path.join(runtimeRoot, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.assets[0].path = 'bootstrap-link.js';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await expectFailure('symlinked path component', () =>
      syncFoliateWebRuntime({ runtimeRoot, targetRoot }),
    );
    await rm(path.join(runtimeRoot, 'bootstrap-link.js'));

    // Restore a clean fixture after the manifest mutation before target tests.
    await stageFoliateRuntime({
      workspace: targetRoot,
      packageRoot: path.dirname(path.dirname(runtimeRoot)),
      sourceRoot,
      validateFn: async () => undefined,
    });
    await symlink(outsideRoot, publicRoot);
    await expectFailure(
      'public directory must be a directory, not a symlink',
      () => syncFoliateWebRuntime({ runtimeRoot, targetRoot }),
    );
    await rm(publicRoot);
    await mkdir(publicRoot, { recursive: true });
    await symlink(outsideRoot, readerRoot);
    await expectFailure(
      'reader directory must be a directory, not a symlink',
      () => syncFoliateWebRuntime({ runtimeRoot, targetRoot }),
    );
    assert.equal(
      await readFile(path.join(outsideRoot, 'application-owned.txt'), 'utf8'),
      'preserved',
    );
  });
});

test('rejects a symlinked runtime manifest before parsing it', async () => {
  await withRuntimeFixture(async ({ runtimeRoot, targetRoot }) => {
    const manifestPath = path.join(runtimeRoot, 'manifest.json');
    const replacementManifest = path.join(
      runtimeRoot,
      'replacement-manifest.json',
    );
    await writeFile(replacementManifest, await readFile(manifestPath));
    await rm(manifestPath);
    await symlink(replacementManifest, manifestPath);
    await expectFailure('manifest has a symlinked path component', () =>
      syncFoliateWebRuntime({ runtimeRoot, targetRoot }),
    );
  });
});

test('workspace and packed CLI reject a missing --target value', () => {
  for (const args of [
    [rootSyncCli, '--sync', '--target'],
    [packageSyncCli, '--target'],
  ]) {
    assert.throws(
      () => execFileSync(process.execPath, args, { stdio: 'pipe' }),
      (error) => `${error.stderr}`.includes('--target requires a project root'),
    );
  }
});
