import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const required = [
  'reader.html',
  'shell.css',
  'shell.mjs',
  'protocol.js',
  'contracts.js',
  'adapter.js',
  'pdf.min.mjs',
  'pdf.worker.min.mjs',
  'pdf.css',
  'LICENSE',
  'READER_LICENSE',
];
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'pdf-consumer-safety-'));
  try {
    const runtime = join(root, 'package/pdf-runtime');
    const scripts = join(root, 'package/scripts');
    await mkdir(runtime, { recursive: true });
    await mkdir(scripts);
    await copyFile(
      new URL(
        '../packages/native-reader/scripts/sync-pdf-web-runtime.mjs',
        import.meta.url,
      ),
      join(scripts, 'sync.mjs'),
    );
    await copyFile(
      new URL(
        '../packages/native-reader/scripts/pdf-runtime-files.mjs',
        import.meta.url,
      ),
      join(scripts, 'pdf-runtime-files.mjs'),
    );
    const bytes = Buffer.from('fixture asset');
    const manifest = {
      version: 1,
      pdfjsVersion: '5.4.530',
      files: required.map((path) => ({
        path,
        mimeType: 'application/octet-stream',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })),
    };
    for (const name of required) await writeFile(join(runtime, name), bytes);
    const saveManifest = () =>
      writeFile(join(runtime, 'manifest.json'), JSON.stringify(manifest));
    await saveManifest();
    const target = join(root, 'public');
    const cli = (...args) =>
      execFileSync(
        process.execPath,
        [join(scripts, 'sync.mjs'), '--target', target, ...args],
        { encoding: 'utf8', stdio: 'pipe' },
      );
    await run({ root, runtime, target, manifest, saveManifest, cli });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('PDF consumer sync checks exact assets, detects mutation and preserves host files', async () => {
  await fixture(async ({ target, cli }) => {
    await mkdir(target);
    await writeFile(join(target, 'host.txt'), 'host-owned');
    cli();
    cli('--check');
    assert.equal(
      await readFile(join(target, 'host.txt'), 'utf8'),
      'host-owned',
    );
    await writeFile(join(target, 'pdf-runtime/adapter.js'), 'tampered');
    assert.throws(() => cli('--check'), /PDF runtime target mismatch/);
    cli();
    await writeFile(join(target, 'pdf-runtime/stale.js'), 'stale');
    assert.throws(() => cli(), /Unexpected PDF runtime target entry/);
  });
});
test('PDF consumer rejects source tampering and manifest traversal before copying', async () => {
  await fixture(async ({ runtime, manifest, saveManifest, cli }) => {
    await writeFile(join(runtime, 'adapter.js'), 'tampered');
    assert.throws(() => cli(), /PDF runtime integrity check failed/);
    manifest.files[0].path = '../escape';
    await saveManifest();
    assert.throws(() => cli(), /Invalid PDF asset path/);
  });
});
test('PDF consumer rejects source and target symlinks, including target ancestors', async () => {
  await fixture(async ({ root, runtime, target, cli }) => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, target);
    assert.throws(() => cli(), /PDF symlinks are not supported/);
    await rm(target);
    await rm(join(runtime, 'adapter.js'));
    await writeFile(join(outside, 'adapter.js'), 'fixture asset');
    await symlink(join(outside, 'adapter.js'), join(runtime, 'adapter.js'));
    assert.throws(() => cli(), /PDF symlinks are not supported/);
  });
});

for (const kind of [
  'missing',
  'duplicate',
  'bad-mime',
  'source-stale',
  'manifest-link',
  'dangling-target',
  'target-ancestor',
  'target-asset',
  'stale-directory',
  'fifo',
]) {
  test(`PDF sync rejects ${kind} before changing any host file`, async () => {
    await fixture(
      async ({ root, runtime, target, manifest, saveManifest, cli }) => {
        const outside = join(root, 'outside');
        await mkdir(outside);
        await writeFile(join(outside, 'sentinel'), 'untouched');
        if (kind === 'missing') await rm(join(runtime, 'adapter.js'));
        if (kind === 'duplicate') {
          manifest.files.push(manifest.files[0]);
          await saveManifest();
        }
        if (kind === 'bad-mime') {
          manifest.files[0].mimeType = 'application/javascript+unsafe';
          await saveManifest();
        }
        if (kind === 'source-stale')
          await writeFile(join(runtime, 'unlisted.js'), 'stale');
        if (kind === 'manifest-link') {
          await copyFile(
            join(runtime, 'manifest.json'),
            join(outside, 'manifest.json'),
          );
          await rm(join(runtime, 'manifest.json'));
          await symlink(
            join(outside, 'manifest.json'),
            join(runtime, 'manifest.json'),
          );
        }
        if (kind === 'dangling-target')
          await symlink(join(root, 'absent'), target);
        if (kind === 'target-ancestor') await symlink(outside, target);
        if (
          kind === 'target-asset' ||
          kind === 'stale-directory' ||
          kind === 'fifo'
        ) {
          cli();
          if (kind === 'target-asset') {
            await rm(join(target, 'pdf-runtime/adapter.js'));
            await symlink(
              join(outside, 'sentinel'),
              join(target, 'pdf-runtime/adapter.js'),
            );
          }
          if (kind === 'stale-directory')
            await mkdir(join(target, 'pdf-runtime/stale'));
          if (kind === 'fifo')
            execFileSync('mkfifo', [join(target, 'pdf-runtime/pipe')]);
        }
        assert.throws(() => cli());
        assert.equal(
          await readFile(join(outside, 'sentinel'), 'utf8'),
          'untouched',
        );
      },
    );
  });
}
