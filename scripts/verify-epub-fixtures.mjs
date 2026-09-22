import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { crc32 } from './generate-epub-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'fixtures', 'epub');
const manifest = JSON.parse(
  await readFile(path.join(directory, 'manifest.json'), 'utf8'),
);

function inspectStoredZip(bytes) {
  const entries = [];
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const expectedCrc = bytes.readUInt32LE(offset + 14);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString();
    const start = offset + 30 + nameLength + extraLength;
    const content = bytes.subarray(start, start + size);
    if (method !== 0)
      throw new Error(`${name}: expected deterministic stored ZIP entry`);
    if (crc32(content) !== expectedCrc)
      throw new Error(`${name}: CRC mismatch`);
    entries.push({ name, content });
    offset = start + size;
  }
  if (entries.length === 0) throw new Error('No ZIP entries found');
  return entries;
}

for (const fixture of manifest.fixtures) {
  const bytes = await readFile(path.join(directory, fixture.file));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== fixture.bytes)
    throw new Error(`${fixture.file}: byte count mismatch`);
  if (digest !== fixture.sha256)
    throw new Error(`${fixture.file}: SHA-256 mismatch`);
  if (fixture.file === 'malformed.epub') continue;
  const entries = inspectStoredZip(bytes);
  if (
    entries[0].name !== 'mimetype' ||
    entries[0].content.toString() !== 'application/epub+zip'
  ) {
    throw new Error(
      `${fixture.file}: mimetype must be the first uncompressed entry`,
    );
  }
  if (!entries.some(({ name }) => name === 'META-INF/container.xml'))
    throw new Error(`${fixture.file}: missing META-INF/container.xml`);
  if (!entries.some(({ name }) => /(^|\/)[^/]+\.opf$/i.test(name)))
    throw new Error(`${fixture.file}: missing package document`);
}

console.log(
  `Integrity, ZIP structure, and checksums verified for ${manifest.fixtures.length} fixtures.`,
);
