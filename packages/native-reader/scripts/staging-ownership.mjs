import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeStagingPaths } from './staging-path-safety.mjs';

const modulePackageRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
// Capability 不落盘、不序列化、不从 generated marker 恢复，也不能给 existing 根补发。
const capabilities = new WeakMap();

export async function createOwnedStagingRoot({
  parentRoot,
  prefix = 'hn-owned-',
  authorityRoots = [],
} = {}) {
  if (!Array.isArray(authorityRoots))
    throw new Error('authorityRoots must be an array');
  if (typeof prefix !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(prefix)) {
    throw new Error('Owned staging prefix must be a simple name');
  }
  const parent = await assertSafeStagingPaths({
    outputRoot: parentRoot,
    authorityRoots: [modulePackageRoot, ...authorityRoots],
  });
  const outputRoot = await realpath(
    await mkdtemp(path.join(parent.outputRoot, prefix)),
  );
  const entry = await lstat(outputRoot);
  const ownership = Object.freeze(Object.create(null));
  capabilities.set(ownership, { outputRoot, dev: entry.dev, ino: entry.ino });
  return { outputRoot, ownership };
}

export async function assertOwnedStagingRoot({ outputRoot, ownership } = {}) {
  const record =
    ownership &&
    (typeof ownership === 'object' || typeof ownership === 'function')
      ? capabilities.get(ownership)
      : undefined;
  if (!record)
    throw new Error(
      'Owned staging capability is required; existing foreign roots cannot be adopted',
    );
  const safe = await assertSafeStagingPaths({
    outputRoot,
    authorityRoots: [modulePackageRoot],
  });
  const equal =
    process.platform === 'win32'
      ? safe.outputRoot.toLowerCase() === record.outputRoot.toLowerCase()
      : safe.outputRoot === record.outputRoot;
  const entry = await lstat(safe.outputRoot);
  if (!equal || entry.dev !== record.dev || entry.ino !== record.ino) {
    throw new Error(
      'Owned staging capability does not match this canonical output directory',
    );
  }
  return safe.outputRoot;
}

export async function disposeOwnedStagingRoot({ outputRoot, ownership } = {}) {
  const canonical = await assertOwnedStagingRoot({ outputRoot, ownership });
  // rm 只移除自己的唯一根；不跟随树内 resolver symlink。
  await rm(canonical, { recursive: true, force: true });
  capabilities.delete(ownership);
}
