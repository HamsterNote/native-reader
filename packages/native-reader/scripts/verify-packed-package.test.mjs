import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  digestTree,
  withWorkspaceSourceInvariant,
} from './verify-packed-package.mjs';

const fixture = async (t) => {
  const cacheRoot = path.join(os.homedir(), '.cache/opencode-tmp/opencode');
  await mkdir(cacheRoot, { recursive: true });
  const root = await mkdtemp(path.join(cacheRoot, 'hn-pack-invariance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'android'));
  await writeFile(
    path.join(root, 'android/USER_SOURCE_SENTINEL'),
    'outside closure',
  );
  await mkdir(path.join(root, 'empty-dir'));
  await symlink('android/USER_SOURCE_SENTINEL', path.join(root, 'alias'));
  return root;
};

test('whole source invariant accepts success and preserves original failure with no mutation', async (t) => {
  const root = await fixture(t);
  const before = await digestTree(root);
  assert.equal(
    await withWorkspaceSourceInvariant(root, async () => 'ok'),
    'ok',
  );
  const original = new Error('mock pack failure');
  await assert.rejects(
    withWorkspaceSourceInvariant(root, async () => {
      throw original;
    }),
    (error) => error === original,
  );
  assert.equal(await digestTree(root), before);
});

test('whole package guard detects file bytes, entry type, symlink target, empty dirs on success AND failure', async (t) => {
  const mutations = [
    async (root) =>
      writeFile(
        path.join(root, 'android/USER_SOURCE_SENTINEL'),
        'mutated source',
      ),
    async (root) => {
      await rm(path.join(root, 'empty-dir'), { recursive: true });
      await writeFile(path.join(root, 'empty-dir'), 'now file');
    },
    async (root) => {
      await rm(path.join(root, 'alias'));
      await symlink('different-target', path.join(root, 'alias'));
    },
    async (root) => mkdir(path.join(root, 'new-empty-dir')),
    async (root) => rm(path.join(root, 'empty-dir'), { recursive: true }),
    async (root) =>
      writeFile(path.join(root, 'UNCOMMITTED_OUTSIDE_CLOSURE'), 'added'),
  ];
  for (const mutation of mutations) {
    for (const fails of [false, true]) {
      const root = await fixture(t);
      const original = new Error('original verification failure');
      await assert.rejects(
        withWorkspaceSourceInvariant(root, async () => {
          await mutation(root);
          if (fails) throw original;
        }),
        (error) =>
          fails
            ? error instanceof AggregateError &&
              error.errors[0] === original &&
              /complete workspace package source tree/.test(
                error.errors[1].message,
              )
            : /complete workspace package source tree/.test(error.message),
      );
    }
  }
});

test('source digest never follows symlink target contents', async (t) => {
  const root = await fixture(t);
  await symlink('../absent-target', path.join(root, 'dangling'));
  assert.match(await digestTree(root), /^[a-f0-9]{64}$/);
});
