import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildFixtureCorpus, makeManifest } from './generate-fixtures.mjs';

const epubAnchors = new Map([
  [
    'epub/valid-epub2.epub',
    [3373, '2afb9a377837b8ccb0bb2fc70c009e61a41397947ed952097e43b2570505eab9'],
  ],
  [
    'epub/valid-epub3.epub',
    [3338, 'c32be67e2381229323b749c65368ea81133c48f0e6fbb48baaf45b747cbd9d21'],
  ],
  [
    'epub/malformed.epub',
    [46, '340af8ff6789dec46c4f31853b7cfed631bd5fff8bec3526f81c956a57bfc093'],
  ],
  [
    'epub/no-toc-spine.epub',
    [2233, 'b12cacf72393c82fe07260d29b7775994d19ab8370db838fa167050489de4bff'],
  ],
  [
    'epub/nested-relative-paths.epub',
    [2469, '3daca2fe0d43b2f73dba1033894a919e7c38b384cd9ce99907a56a80a01916f1'],
  ],
  [
    'epub/encoded-fragment-anchor.epub',
    [15555, '6534e20ae2e94db89d1a3acd0f2fa8ac330620b776d6043ca89f66a2e6433226'],
  ],
  [
    'epub/first-segment-colon.epub',
    [2011, '7b7fb140431c7679a68603821342aafafaee720d267bc86e37357477641d63ee'],
  ],
  [
    'epub/duplicate-href-spine.epub',
    [2692, '309118c6367963960223f487070288cf44beb64ab7b219e4c0c2d5b94f345b0f'],
  ],
  [
    'epub/fixed-layout.epub',
    [2002, '3c4dbb191741d6d5c6e5182dbc7212e95237f42c556a41505ae3a56357a9bcbf'],
  ],
  [
    'epub/scripted-external.epub',
    [2904, '48e460bc342eb8fd3e2bf50c2781298e18ab5bca55432b46730a9dd8423695d7'],
  ],
  [
    'epub/large-representative.epub',
    [
      1255119,
      'f9084ded9957ae7b935233b738333ac16b0aff77580e4d2ab1a87c8145ecaa29',
    ],
  ],
]);

const run = (script, fixtureRoot, args = []) =>
  new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, ...args],
      {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: { ...process.env, FIXTURE_ROOT: fixtureRoot },
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`${stdout}${stderr}`));
        else resolve(`${stdout}${stderr}`);
      },
    );
  });

test('format-neutral fixture recipes are deterministic and independently declared', () => {
  const first = buildFixtureCorpus();
  const second = buildFixtureCorpus();
  assert.deepEqual(
    first.map(({ file, bytes }) => [file, bytes]),
    second.map(({ file, bytes }) => [file, bytes]),
  );
  const manifest = makeManifest(first);
  assert.equal(manifest.schemaVersion, 2);
  assert.ok(manifest.fixtures.some(({ format }) => format === 'epub'));
  assert.ok(manifest.fixtures.some(({ format }) => format === 'mobi'));
  assert.ok(manifest.fixtures.some(({ format }) => format === 'kf8-azw3'));
  assert.ok(
    manifest.fixtures.every(
      ({ provenance, license }) =>
        provenance.kind === 'generated' && license.expression === 'CC0-1.0',
    ),
  );
  const kf8 = manifest.fixtures.find(
    ({ file }) => file === 'kf8/valid-navigation.azw3',
  );
  assert.deepEqual(kf8?.expected.behaviors, [
    'opens',
    'single-readable-section',
    'toc-navigation',
    'works-offline',
  ]);
  assert.deepEqual(kf8?.limitations, [
    'This fixture proves one readable section and TOC anchor navigation only; it must not be used for cross-chapter Previous/Next acceptance.',
  ]);
  for (const [file, [bytes, sha256]] of epubAnchors) {
    const fixture = manifest.fixtures.find((entry) => entry.file === file);
    assert.deepEqual([fixture?.bytes, fixture?.sha256], [bytes, sha256]);
  }
});

test('checker rejects missing, altered, and undocumented corpus entries', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'hn-fixtures-'));
  try {
    await run('scripts/generate-fixtures.mjs', fixtureRoot);
    await run('scripts/verify-fixtures.mjs', fixtureRoot);
    await unlink(path.join(fixtureRoot, 'fb2', 'valid-navigation.fb2'));
    await assert.rejects(run('scripts/verify-fixtures.mjs', fixtureRoot));
    await run('scripts/generate-fixtures.mjs', fixtureRoot);
    await writeFile(path.join(fixtureRoot, 'undocumented.bin'), 'CC0');
    await assert.rejects(run('scripts/verify-fixtures.mjs', fixtureRoot));
    await rm(path.join(fixtureRoot, 'undocumented.bin'));
    await writeFile(path.join(fixtureRoot, 'pdf', 'rejected.pdf'), 'altered');
    await assert.rejects(run('scripts/verify-fixtures.mjs', fixtureRoot));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('fixture tree walkers reject an extra symlink', async (t) => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'hn-fixtures-'));
  try {
    await run('scripts/generate-fixtures.mjs', fixtureRoot);
    try {
      await symlink('fb2', path.join(fixtureRoot, 'extra-link'), 'dir');
    } catch (error) {
      if (['EPERM', 'EOPNOTSUPP', 'ENOSYS'].includes(error?.code)) {
        t.skip(`symlink is unsupported on this platform: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(run('scripts/verify-fixtures.mjs', fixtureRoot));
    await assert.rejects(
      run('scripts/generate-fixtures.mjs', fixtureRoot, ['--check']),
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
