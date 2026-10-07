import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  await readFile(path.join(root, 'fixtures', 'manifest.json'), 'utf8'),
);
const fixtures = manifest.fixtures.filter(({ expected }) =>
  expected.behaviors.includes('measured-large-smoke'),
);
if (!fixtures.length)
  throw new Error('Manifest has no representative large fixtures');

const report = { schemaVersion: 1, fixtures: [] };
for (const fixture of fixtures) {
  const started = performance.now();
  const bytes = await readFile(path.join(root, 'fixtures', fixture.file));
  const readMilliseconds = performance.now() - started;
  const hashStarted = performance.now();
  const digest = createHash('sha256').update(bytes).digest('hex');
  const sha256Milliseconds = performance.now() - hashStarted;
  if (digest !== fixture.sha256)
    throw new Error(`${fixture.file}: checksum mismatch`);
  report.fixtures.push({
    fixture: fixture.file,
    format: fixture.format,
    bytes: bytes.length,
    readMilliseconds: Number(readMilliseconds.toFixed(3)),
    sha256Milliseconds: Number(sha256Milliseconds.toFixed(3)),
    openOutcome: 'not-rendered',
    navigationOutcome: 'not-rendered',
    observation:
      'Deterministic host-side I/O baseline only; rendering evidence belongs to format-specific runtime acceptance.',
  });
}
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  const output = path.resolve(root, process.argv[outputIndex + 1]);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
