import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FOLIATE_COMMIT_SHA,
  FOLIATE_UPSTREAM_URL,
  validateFoliateSubmodule,
} from './verify-foliate-submodule.mjs';

const workspace = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
// These names are rejection signatures, never dependencies or import targets.
const retired = /epubjs|@epubjs-react-native|stage-bundled-core/i;
const rejectionChecks = new Set([
  'scripts/verify-reader-supply-chain.mjs',
  'scripts/verify-reader-supply-chain.test.mjs',
  'packages/native-reader/scripts/verify-static-native-propagation.mjs',
  'packages/native-reader/scripts/verify-packed-package.mjs',
  'packages/native-reader/scripts/test-release-lifecycle.mjs',
  'packages/native-reader/src/NativeReader.native.gate.test.tsx',
]);

export function assertNoRetiredEngine(text, label) {
  if (retired.test(text)) throw new Error(`Retired engine reference: ${label}`);
}

export async function verifyProjectFiles(root, files) {
  for (const relative of files) {
    if (relative.startsWith('openspec/') || relative.startsWith('vendor/'))
      continue;
    let entry;
    try {
      entry = await lstat(path.join(root, relative));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    assertNoRetiredEngine(relative, relative);
    if (!entry.isFile()) continue;
    const text = await readFile(path.join(root, relative), 'utf8');
    if (rejectionChecks.has(relative)) {
      // Even a rejection-test file cannot import or require an old engine.
      if (
        /(?:from\s*|(?:require|import)\s*\()\s*['"](?:epubjs|@epubjs-react-native)/.test(
          text,
        )
      ) {
        throw new Error(`Retired engine import: ${relative}`);
      }
      continue;
    }
    // A pointer to the active/historical change is not a runtime dependency.
    assertNoRetiredEngine(
      text.replaceAll(
        '2026-10-07-replace-epubjs-with-foliate-reader',
        '<change>',
      ),
      relative,
    );
  }
}

async function treeFiles(root, relative = '') {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Supply-chain tree contains symlink: ${name}`);
    if (entry.isDirectory()) files.push(...(await treeFiles(root, name)));
    else if (entry.isFile()) files.push(name);
  }
  return files.sort();
}

export async function verifyRuntimeRevision(runtimeRoot) {
  const manifest = JSON.parse(
    await readFile(path.join(runtimeRoot, 'manifest.json'), 'utf8'),
  );
  if (
    manifest.source?.commit !== FOLIATE_COMMIT_SHA ||
    manifest.source?.repository !== FOLIATE_UPSTREAM_URL
  ) {
    throw new Error('Generated runtime has an unapproved Foliate revision');
  }
  const declared = manifest.assets.map((asset) => asset.path).sort();
  const actual = (await treeFiles(runtimeRoot)).filter(
    (file) => file !== 'manifest.json',
  );
  if (JSON.stringify(declared) !== JSON.stringify(actual))
    throw new Error('Runtime asset set differs from manifest');
  for (const asset of manifest.assets) {
    if (asset.path.includes('..') || path.isAbsolute(asset.path))
      throw new Error('Invalid runtime asset path');
    const bytes = await readFile(path.join(runtimeRoot, asset.path));
    assertNoRetiredEngine(asset.path, asset.path);
    assertNoRetiredEngine(bytes.toString('utf8'), asset.path);
    if (
      bytes.length !== asset.size ||
      createHash('sha256').update(bytes).digest('hex') !== asset.sha256
    ) {
      throw new Error(`Runtime asset digest mismatch: ${asset.path}`);
    }
  }
}

// Run against the installed tree extracted from the one verified release
// tarball. No workspace source or generated checksum substitutes for its bytes.
export async function verifyPackedEngineTree(packageRoot) {
  for (const relative of await treeFiles(packageRoot)) {
    assertNoRetiredEngine(relative, relative);
    if (relative.startsWith('lib/vendor/core/'))
      throw new Error('Retired engine payload');
    const bytes = await readFile(path.join(packageRoot, relative));
    assertNoRetiredEngine(bytes.toString('utf8'), relative);
  }
  for (const platform of ['web', 'native'])
    await verifyRuntimeRevision(
      path.join(packageRoot, 'foliate-runtime', platform),
    );
}

export async function verifyReaderSupplyChain({ root = workspace } = {}) {
  await validateFoliateSubmodule({ root });
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  await verifyProjectFiles(root, [...new Set(files)]);
  for (const platform of ['web', 'native'])
    await verifyRuntimeRevision(
      path.join(root, 'packages/native-reader/foliate-runtime', platform),
    );
  return { commit: FOLIATE_COMMIT_SHA, files: files.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(await verifyReaderSupplyChain());
