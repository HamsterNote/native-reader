import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertOwnedTree,
  parseArgs,
  readAsset,
  safeAssetPath,
  sha256,
  writeAssets,
} from './pdf-runtime-files.mjs';

const source = fileURLToPath(new URL('../pdf-runtime/', import.meta.url));
const { target, check } = parseArgs(process.argv.slice(2), true);
const manifestBytes = readAsset(join(source, 'manifest.json'));
const manifest = JSON.parse(manifestBytes.toString());
if (
  manifest.version !== 1 ||
  manifest.pdfjsVersion !== '5.4.530' ||
  !Array.isArray(manifest.files) ||
  'reader' in manifest
)
  throw new Error('Unsupported PDF runtime manifest.');
const files = new Map();
const types = new Set([
  'text/html',
  'text/css',
  'text/javascript',
  'text/plain',
  'application/wasm',
  'application/octet-stream',
]);
for (const file of manifest.files) {
  if (
    !file ||
    !safeAssetPath(file.path) ||
    file.path === 'manifest.json' ||
    files.has(file.path)
  )
    throw new Error('Invalid PDF asset path.');
  if (
    !types.has(file.mimeType) ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    !/^[a-f0-9]{64}$/.test(file.sha256)
  )
    throw new Error('Invalid PDF asset metadata.');
  const bytes = readAsset(join(source, file.path));
  if (bytes.length !== file.size || sha256(bytes) !== file.sha256)
    throw new Error('PDF runtime integrity check failed.');
  files.set(file.path, bytes);
}
for (const name of [
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
])
  if (!files.has(name)) throw new Error(`PDF runtime missing ${name}.`);
files.set('manifest.json', manifestBytes);
assertOwnedTree(source, files);
writeAssets(join(target, 'pdf-runtime'), files, check);
console.log(
  `PDF consumer ${check ? 'checked' : 'synchronized'}: ${manifest.files.length} assets, PDF.js ${manifest.pdfjsVersion}`,
);
