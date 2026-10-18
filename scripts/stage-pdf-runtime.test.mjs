import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'pdf-stage-safety-'));
  try {
    const pkg = resolve('packages/native-reader');
    await mkdir(join(root, 'scripts'));
    for (const file of ['stage-pdf-runtime.mjs', 'pdf-runtime-files.mjs'])
      await cp(join(pkg, 'scripts', file), join(root, 'scripts', file));
    await cp(join(pkg, 'src/pdf'), join(root, 'src/pdf'), { recursive: true });
    await cp(join(pkg, 'pdf-shell'), join(root, 'pdf-shell'), {
      recursive: true,
    });
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    const target = join(root, 'public');
    const cli = (...args) =>
      execFileSync(
        process.execPath,
        [
          join(root, 'scripts/stage-pdf-runtime.mjs'),
          '--target',
          target,
          ...args,
        ],
        { stdio: 'pipe' },
      );
    await run({ root, target, cli });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('local PDF stage is deterministic, check-only and never rewrites contracts', async () => {
  await fixture(async ({ root, target, cli }) => {
    const contract = await readFile(join(root, 'src/pdf/contracts.ts'));
    cli();
    const manifest = join(target, 'pdf-runtime/manifest.json');
    const first = await readFile(manifest);
    const before = await stat(manifest);
    cli('--check');
    assert.equal((await stat(manifest)).mtimeMs, before.mtimeMs);
    cli();
    assert.deepEqual(await readFile(manifest), first);
    assert.deepEqual(
      await readFile(join(root, 'src/pdf/contracts.ts')),
      contract,
    );
    const metadata = JSON.parse(first);
    assert.equal(metadata.pdfjsVersion, '5.4.530');
    assert.equal('reader' in metadata, false);
    assert(metadata.files.some((file) => file.path === 'pdf.min.mjs'));
    assert.equal(
      metadata.files.find(
        (file) => file.path === 'wasm/openjpeg_nowasm_fallback.js',
      ).mimeType,
      'text/javascript',
    );
    const adapter = await readFile(
      join(target, 'pdf-runtime/adapter.js'),
      'utf8',
    );
    assert.match(adapter, /from ["']\.\/pdf\.min\.mjs["']/);
    assert.doesNotMatch(adapter, /from ["']pdfjs-dist["']/);
    await writeFile(join(target, 'pdf-runtime/adapter.js'), 'tampered');
    assert.throws(() => cli('--check'), /PDF runtime target mismatch/);
    assert.equal(
      await readFile(join(target, 'pdf-runtime/adapter.js'), 'utf8'),
      'tampered',
    );
    for (const arg of ['--import', '--revision'])
      assert.throws(() => cli(arg, 'obsolete'), /Unsupported PDF argument/);
  });
});

for (const kind of [
  'source-link',
  'source-ancestor',
  'source-special',
  'target-link',
  'target-ancestor',
  'target-asset',
  'stale',
  'target-special',
]) {
  test(
    `local PDF stage rejects ${kind} before writing outside owned assets`,
    { skip: kind.endsWith('special') && process.platform === 'win32' },
    async () => {
      await fixture(async ({ root, target, cli }) => {
        const outside = join(root, 'outside');
        await mkdir(outside);
        await writeFile(join(outside, 'sentinel'), 'untouched');
        if (kind === 'source-link') {
          await rm(join(root, 'src/pdf/pdfDom.ts'));
          await symlink(
            join(outside, 'sentinel'),
            join(root, 'src/pdf/pdfDom.ts'),
          );
        }
        if (kind === 'source-ancestor') {
          await rm(join(root, 'src/pdf'), { recursive: true });
          await symlink(outside, join(root, 'src/pdf'));
        }
        if (kind === 'source-special') {
          await rm(join(root, 'src/pdf/pdfDom.ts'));
          execFileSync('mkfifo', [join(root, 'src/pdf/pdfDom.ts')]);
        }
        if (kind === 'target-link') {
          await mkdir(target);
          await symlink(outside, join(target, 'pdf-runtime'));
        }
        if (kind === 'target-ancestor') await symlink(outside, target);
        if (['target-asset', 'stale', 'target-special'].includes(kind)) {
          cli();
          if (kind === 'target-asset') {
            await rm(join(target, 'pdf-runtime/adapter.js'));
            await symlink(
              join(outside, 'sentinel'),
              join(target, 'pdf-runtime/adapter.js'),
            );
          }
          if (kind === 'stale')
            await writeFile(join(target, 'pdf-runtime/stale'), 'stale');
          if (kind === 'target-special')
            execFileSync('mkfifo', [join(target, 'pdf-runtime/pipe')]);
        }
        assert.throws(() => cli());
        assert.equal(
          await readFile(join(outside, 'sentinel'), 'utf8'),
          'untouched',
        );
      });
    },
  );
}
