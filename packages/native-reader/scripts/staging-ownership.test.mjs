import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createOwnedStagingRoot,
  assertOwnedStagingRoot,
  disposeOwnedStagingRoot,
} from './staging-ownership.mjs';
import { digestTree } from './verify-packed-package.mjs';

const fixture = async (t) => {
  const cache = path.join(os.homedir(), '.cache/opencode-tmp/opencode');
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(path.join(cache, 'hn-ownership-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

test('ownership only minted by fresh mkdtemp; forged/cloned/mismatched capabilities rejected', async (t) => {
  const root = await fixture(t);
  const foreign = path.join(root, 'foreign');
  await mkdir(foreign);
  await writeFile(
    path.join(foreign, 'HN_SECURE_WEBVIEW_GENERATED'),
    'fake marker',
  );
  const owned = await createOwnedStagingRoot({ parentRoot: root });
  const before = await digestTree(root);
  for (const ownership of [
    undefined,
    {},
    structuredClone(owned.ownership),
    owned.ownership,
  ]) {
    await assert.rejects(
      assertOwnedStagingRoot({ outputRoot: foreign, ownership }),
      /capability/,
    );
    await assert.rejects(
      disposeOwnedStagingRoot({ outputRoot: foreign, ownership }),
      /capability/,
    );
  }
  assert.equal(await digestTree(root), before);
  assert.equal(await assertOwnedStagingRoot(owned), owned.outputRoot);
  await disposeOwnedStagingRoot(owned);
  await assert.rejects(assertOwnedStagingRoot(owned), /capability/);
});

test('capability bound to root identity, not a descendant, replaced inode, or symlink', async (t) => {
  const root = await fixture(t);
  const owned = await createOwnedStagingRoot({ parentRoot: root });
  const child = path.join(owned.outputRoot, 'child');
  await mkdir(child);
  await assert.rejects(
    assertOwnedStagingRoot({ ...owned, outputRoot: child }),
    /does not match/,
  );
  const alias = path.join(root, 'alias');
  await symlink(
    owned.outputRoot,
    alias,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    assertOwnedStagingRoot({ ...owned, outputRoot: alias }),
    /symlink\/junction/,
  );
  await rename(owned.outputRoot, `${owned.outputRoot}-old`);
  await mkdir(owned.outputRoot);
  await writeFile(
    path.join(owned.outputRoot, 'FOREIGN_SENTINEL'),
    'new unrelated root',
  );
  const before = await digestTree(root);
  await assert.rejects(disposeOwnedStagingRoot(owned), /does not match/);
  assert.equal(await digestTree(root), before);
});

test('creation does not adopt existing directory or allow path-bearing prefixes', async (t) => {
  const root = await fixture(t);
  const before = await digestTree(root);
  for (const prefix of ['../foreign', 'dir/name', 'dir\\name', '']) {
    await assert.rejects(
      createOwnedStagingRoot({ parentRoot: root, prefix }),
      /simple name/,
    );
  }
  assert.equal(await digestTree(root), before);
});
