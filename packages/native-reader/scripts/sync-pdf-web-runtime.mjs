import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../pdf-runtime/', import.meta.url));
const args = process.argv.slice(2);
const index = args.indexOf('--target');
if (index < 0 || !args[index + 1])
  throw new Error('Pass --target <consumer-public-directory>.');
const target = join(resolve(args[index + 1]), 'pdf-runtime');
const check = args.includes('--check');
const manifest = JSON.parse(
  readFileSync(join(source, 'manifest.json'), 'utf8'),
);
if (
  manifest.version !== 1 ||
  manifest.pdfjsVersion !== '5.4.530' ||
  !Array.isArray(manifest.files)
)
  throw new Error('Unsupported PDF runtime manifest.');
const entries = new Map();
const assertNoLinks = (path) => {
  for (let current = resolve(path); ; current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error('PDF symlinks are not supported.');
    if (dirname(current) === current) break;
  }
};
assertNoLinks(source);
assertNoLinks(target);
for (const file of manifest.files) {
  if (
    typeof file.path !== 'string' ||
    !file.path
      .split('/')
      .every(
        (part) =>
          /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..',
      ) ||
    entries.has(file.path)
  )
    throw new Error('Invalid PDF asset path.');
  const path = join(source, file.path);
  assertNoLinks(path);
  const bytes = readFileSync(path);
  if (
    !lstatSync(path).isFile() ||
    bytes.length !== file.size ||
    createHash('sha256').update(bytes).digest('hex') !== file.sha256
  )
    throw new Error('PDF runtime integrity check failed.');
  entries.set(file.path, bytes);
}
entries.set('manifest.json', readFileSync(join(source, 'manifest.json')));
for (const required of [
  'reader.html',
  'shell.css',
  'shell.mjs',
  'protocol.js',
  'adapter.js',
  'pdf.worker.min.mjs',
  'pdf.css',
])
  if (!entries.has(required))
    throw new Error(`PDF runtime missing ${required}.`);
const walk = (base, prefix = '') => {
  if (!existsSync(base)) return;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory())
      walk(join(base, entry.name), prefix + entry.name + '/');
    else if (!entry.isFile() || !entries.has(prefix + entry.name))
      throw new Error('Unexpected PDF runtime target entry.');
  }
};
walk(target);
for (const [name, bytes] of entries) {
  const path = join(target, name);
  if (check) {
    if (!existsSync(path) || !readFileSync(path).equals(bytes))
      throw new Error(`PDF runtime target mismatch: ${name}`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(join(source, name), path);
  }
}
console.log(
  `PDF consumer ${check ? 'checked' : 'synchronized'}: ${manifest.files.length} assets, reader ${manifest.reader.revision}`,
);
