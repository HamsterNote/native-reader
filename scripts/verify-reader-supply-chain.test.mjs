import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  verifyProjectFiles,
  verifyRuntimeRevision,
  verifyPackedEngineTree,
} from './verify-reader-supply-chain.mjs';
import {
  FOLIATE_COMMIT_SHA,
  FOLIATE_UPSTREAM_URL,
} from './verify-foliate-submodule.mjs';

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hn-supply-chain-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('rejects retired engines in manifests, patches, locks, and project imports', async () =>
  fixture(async (root) => {
    for (const name of ['epubjs', '@epubjs-react-native/core']) {
      for (const relative of [
        'package.json',
        'patches/injected.patch',
        'consumer/package-lock.json',
        'consumer/pnpm-lock.yaml',
        'src/reader.ts',
      ]) {
        const file = path.join(root, relative);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(
          file,
          relative.endsWith('.ts')
            ? `import engine from '${name}';`
            : JSON.stringify({ dependencies: { [name]: '1.0.0' } }),
        );
        await assert.rejects(
          verifyProjectFiles(root, [relative]),
          /Retired engine reference/,
        );
      }
    }
  }));

test('negative guards cannot hide an actual retired import', async () =>
  fixture(async (root) => {
    const relative =
      'packages/native-reader/src/NativeReader.native.gate.test.tsx';
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    const engine = '@epubjs-react-native/core';
    await writeFile(path.join(root, relative), `require('${engine}');`);
    await assert.rejects(
      verifyProjectFiles(root, [relative]),
      /Retired engine import/,
    );
  }));

async function runtime(root) {
  await mkdir(root, { recursive: true });
  const bytes = Buffer.from('export {};\n');
  const manifest = {
    source: { commit: FOLIATE_COMMIT_SHA, repository: FOLIATE_UPSTREAM_URL },
    assets: [
      {
        path: 'bootstrap.js',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
  };
  await writeFile(path.join(root, 'bootstrap.js'), bytes);
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}

test('runtime revision, exact asset set, contents and hashes are enforced', async () =>
  fixture(async (root) => {
    const manifest = await runtime(root);
    await verifyRuntimeRevision(root);
    await writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        ...manifest,
        source: { ...manifest.source, commit: '0'.repeat(40) },
      }),
    );
    await assert.rejects(
      verifyRuntimeRevision(root),
      /unapproved Foliate revision/,
    );
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(path.join(root, 'bootstrap.js'), "import 'epubjs';");
    await assert.rejects(
      verifyRuntimeRevision(root),
      /Retired engine reference/,
    );
    await writeFile(path.join(root, 'bootstrap.js'), 'changed');
    await assert.rejects(verifyRuntimeRevision(root), /digest mismatch/);
    await runtime(root);
    await writeFile(path.join(root, 'extra.js'), '');
    await assert.rejects(verifyRuntimeRevision(root), /asset set/);
  }));

test('packed tree rejects hidden payloads and dependencies', async () =>
  fixture(async (root) => {
    await runtime(path.join(root, 'foliate-runtime/web'));
    await runtime(path.join(root, 'foliate-runtime/native'));
    await writeFile(path.join(root, 'package.json'), '{}');
    await verifyPackedEngineTree(root);
    await writeFile(
      path.join(root, 'package.json'),
      '{"dependencies":{"epubjs":"1.0.0"}}',
    );
    await assert.rejects(
      verifyPackedEngineTree(root),
      /Retired engine reference/,
    );
    await writeFile(path.join(root, 'package.json'), '{}');
    await mkdir(path.join(root, 'lib/vendor/core'), { recursive: true });
    await writeFile(path.join(root, 'lib/vendor/core/index.js'), 'export {};');
    await assert.rejects(
      verifyPackedEngineTree(root),
      /Retired engine payload/,
    );
    assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), '{}');
  }));
