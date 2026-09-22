import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'fixtures', 'epub');
const manifest = JSON.parse(
  await readFile(path.join(directory, 'manifest.json'), 'utf8'),
);
const fixture = manifest.fixtures.find(({ behaviors }) =>
  behaviors.includes('measured-large-smoke'),
);
if (!fixture) throw new Error('Manifest has no measured large fixture');

const started = performance.now();
const bytes = await readFile(path.join(directory, fixture.file));
const readMilliseconds = performance.now() - started;
const hashStarted = performance.now();
const digest = createHash('sha256').update(bytes).digest('hex');
const hashMilliseconds = performance.now() - hashStarted;
const memory = process.memoryUsage();
if (digest !== fixture.sha256)
  throw new Error('Large fixture checksum mismatch');

const report = {
  fixture: fixture.file,
  bytes: bytes.length,
  readMilliseconds: Number(readMilliseconds.toFixed(3)),
  sha256Milliseconds: Number(hashMilliseconds.toFixed(3)),
  residentSetBytes: memory.rss,
  heapUsedBytes: memory.heapUsed,
  runtime: process.version,
  result: 'pass',
  note: 'Host-side I/O baseline only; device rendering measurements belong in the physical evidence records.',
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  const output = path.resolve(root, process.argv[outputIndex + 1]);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
