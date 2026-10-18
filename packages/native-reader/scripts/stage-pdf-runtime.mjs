import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = join(root, 'vendor');
const archive = join(vendor, 'reader-pdf.tgz');
const pinPath = join(vendor, 'reader-pdf.json');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
const value = (key) => args[args.indexOf(key) + 1];
const assertNoLinks = (path) => {
  for (let current = resolve(path); ; current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error('PDF symlinks are not supported.');
    if (dirname(current) === current) break;
  }
};
assertNoLinks(archive);
assertNoLinks(pinPath);
if (args.includes('--import')) {
  const input = resolve(value('--import'));
  const revision = value('--revision');
  if (!/^[a-f0-9]{40}$/.test(revision ?? ''))
    throw new Error('Pass exact --revision <reader Git SHA>.');
  mkdirSync(vendor, { recursive: true });
  copyFileSync(input, archive);
  writeFileSync(
    pinPath,
    JSON.stringify(
      {
        repository: 'https://github.com/HamsterNote/reader',
        revision,
        package: '@hamster-note/reader',
        version: '1.12.0-beta.2',
        pdfjsVersion: '5.4.530',
        archiveSha256: sha(readFileSync(archive)),
      },
      null,
      2,
    ) + '\n',
  );
}
const pin = JSON.parse(readFileSync(pinPath, 'utf8'));
if (sha(readFileSync(archive)) !== pin.archiveSha256)
  throw new Error('Reader artifact hash mismatch.');
const safePath = (path) =>
  typeof path === 'string' &&
  path
    .split('/')
    .every(
      (part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..',
    );
const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  .trim()
  .split('\n');
if (
  !listing.every(
    (name) => name.startsWith('package/') && safePath(name.replace(/\/$/, '')),
  )
)
  throw new Error('Unsafe reader archive path.');
const verbose = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' })
  .trim()
  .split('\n');
if (!verbose.every((line) => /^[d-]/.test(line)))
  throw new Error('Reader archive contains links or special files.');
const temporary = mkdtempSync(join(tmpdir(), 'hn-reader-pdf-'));
try {
  execFileSync('tar', ['-xzf', archive, '-C', temporary]);
  const dist = join(temporary, 'package/dist');
  const pkg = JSON.parse(
    readFileSync(join(temporary, 'package/package.json'), 'utf8'),
  );
  if (
    pkg.name !== pin.package ||
    pkg.version !== pin.version ||
    pkg.dependencies['pdfjs-dist'] !== pin.pdfjsVersion
  )
    throw new Error('Reader package/version mismatch.');
  const manifest = JSON.parse(
    readFileSync(join(dist, 'pdf-runtime/manifest.json'), 'utf8'),
  );
  if (
    manifest.version !== 1 ||
    manifest.pdfjsVersion !== pin.pdfjsVersion ||
    manifest.pdfjsVersion !== '5.4.530' ||
    !Array.isArray(manifest.files)
  )
    throw new Error('Unsupported PDF manifest.');
  const files = new Map();
  files.set('READER_LICENSE', {
    bytes: readFileSync(join(temporary, 'package/LICENSE')),
    mimeType: 'text/plain',
  });
  for (const file of manifest.files) {
    if (!safePath(file.path) || files.has(file.path))
      throw new Error('Invalid PDF asset path.');
    const path = join(dist, 'pdf-runtime', file.path);
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
      throw new Error('Invalid PDF asset type.');
    const bytes = readFileSync(path);
    if (bytes.length !== file.size || sha(bytes) !== file.sha256)
      throw new Error('PDF asset integrity mismatch.');
    files.set(file.path, { bytes, mimeType: file.mimeType });
  }
  for (const name of ['reader.html', 'shell.css', 'shell.mjs'])
    files.set(name, {
      bytes: readFileSync(join(root, 'pdf-shell', name)),
      mimeType: name.endsWith('.html')
        ? 'text/html'
        : name.endsWith('.css')
          ? 'text/css'
          : 'text/javascript',
    });
  const protocol = ts.transpileModule(
    readFileSync(join(root, 'src/pdf/protocol.ts'), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    },
  ).outputText;
  files.set('protocol.js', {
    bytes: Buffer.from(protocol),
    mimeType: 'text/javascript',
  });
  const check = args.includes('--check');
  const entries = [...files]
    .map(([path, { bytes, mimeType }]) => ({
      path,
      mimeType,
      size: bytes.length,
      sha256: sha(bytes),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  files.set('manifest.json', {
    bytes: Buffer.from(
      JSON.stringify(
        {
          version: 1,
          pdfjsVersion: pin.pdfjsVersion,
          reader: pin,
          files: entries,
        },
        null,
        2,
      ) + '\n',
    ),
    mimeType: 'application/json',
  });
  const target = args.includes('--target')
    ? join(resolve(value('--target')), 'pdf-runtime')
    : join(root, 'pdf-runtime');
  assertNoLinks(target);
  const existing = [];
  const walk = (base, prefix = '') => {
    if (!existsSync(base)) return;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(join(base, entry.name), name + '/');
      else if (entry.isFile()) existing.push(name);
      else throw new Error('Special PDF target entry rejected.');
    }
  };
  walk(target);
  if (existing.some((name) => !files.has(name)))
    throw new Error('Unowned/stale PDF assets in target.');
  for (const [name, { bytes }] of files) {
    const path = join(target, name);
    if (check) {
      if (!existsSync(path) || !readFileSync(path).equals(bytes))
        throw new Error(`PDF target differs: ${name}`);
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    }
  }
  console.log(
    `PDF ${check ? 'checked' : 'staged'}: reader ${pin.revision}, PDF.js ${pin.pdfjsVersion}, ${entries.length} assets`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
