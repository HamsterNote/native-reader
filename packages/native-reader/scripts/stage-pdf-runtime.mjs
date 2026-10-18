import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  parseArgs,
  readAsset,
  safeAssetPath,
  sha256,
  walkAssets,
  writeAssets,
} from './pdf-runtime-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { target, check } = parseArgs(process.argv.slice(2));
const metadataPath = createRequire(import.meta.url).resolve(
  'pdfjs-dist/package.json',
);
const upstream = dirname(metadataPath);
const metadata = JSON.parse(readAsset(metadataPath).toString());
if (metadata.version !== '5.4.530')
  throw new Error('Unsupported PDF.js version.');
const files = new Map();
const add = (name, bytes, mimeType) => {
  if (!safeAssetPath(name) || files.has(name))
    throw new Error('Invalid PDF asset path.');
  files.set(name, { bytes, mimeType });
};
const compile = (name) =>
  ts.transpileModule(readAsset(join(root, 'src/pdf', name)).toString(), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
    transformers: {
      before: [
        (context) => (source) =>
          ts.visitNode(source, function visit(node) {
            if (
              ts.isImportDeclaration(node) &&
              ts.isStringLiteral(node.moduleSpecifier)
            ) {
              const imports = {
                'pdfjs-dist': './pdf.min.mjs',
                './contracts': './contracts.js',
              };
              const path = imports[node.moduleSpecifier.text];
              if (!path)
                throw new Error(
                  `Unexpected PDF runtime import: ${node.moduleSpecifier.text}`,
                );
              return context.factory.updateImportDeclaration(
                node,
                node.modifiers,
                node.importClause,
                context.factory.createStringLiteral(path),
                node.attributes,
              );
            }
            return ts.visitEachChild(node, visit, context);
          }),
      ],
    },
  }).outputText;
for (const [name, input] of [
  ['adapter.js', 'pdfDom.ts'],
  ['contracts.js', 'contracts.ts'],
  ['protocol.js', 'protocol.ts'],
])
  add(name, Buffer.from(compile(input)), 'text/javascript');
for (const name of ['pdf.min.mjs', 'pdf.worker.min.mjs'])
  add(name, readAsset(join(upstream, 'build', name)), 'text/javascript');
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const source = join(upstream, directory);
  const paths = walkAssets(source);
  if (!paths.length)
    throw new Error(`Missing PDF.js asset directory: ${directory}`);
  for (const name of paths.filter((path) => !path.endsWith('/')))
    add(
      `${directory}/${name}`,
      readAsset(join(source, name)),
      name.endsWith('.wasm')
        ? 'application/wasm'
        : /\.m?js$/.test(name)
          ? 'text/javascript'
          : 'application/octet-stream',
    );
}
add(
  'LICENSE',
  readAsset(join(upstream, 'LICENSE')),
  'application/octet-stream',
);
add(
  'READER_LICENSE',
  readAsset(join(root, 'pdf-shell/SOURCE_LICENSE')),
  'text/plain',
);
add('pdf.css', readAsset(join(root, 'src/pdf/pdf.css')), 'text/css');
for (const name of walkAssets(join(root, 'pdf-shell')).filter(
  (path) => path !== 'SOURCE_LICENSE' && !path.endsWith('/'),
)) {
  if (!/^[a-z-]+\.(html|css|mjs)$/.test(name))
    throw new Error(`Unexpected PDF shell source: ${name}`);
  add(
    name,
    readAsset(join(root, 'pdf-shell', name)),
    name.endsWith('.html')
      ? 'text/html'
      : name.endsWith('.css')
        ? 'text/css'
        : 'text/javascript',
  );
}
const entries = [...files]
  .map(([path, { bytes, mimeType }]) => ({
    path,
    mimeType,
    size: bytes.length,
    sha256: sha256(bytes),
  }))
  .sort((a, b) => a.path.localeCompare(b.path));
const output = new Map([...files].map(([path, { bytes }]) => [path, bytes]));
output.set(
  'manifest.json',
  Buffer.from(
    JSON.stringify(
      { version: 1, pdfjsVersion: metadata.version, files: entries },
      null,
      2,
    ) + '\n',
  ),
);
writeAssets(
  target ? join(target, 'pdf-runtime') : join(root, 'pdf-runtime'),
  output,
  check,
);
console.log(
  `PDF ${check ? 'checked' : 'staged'}: local source, PDF.js ${metadata.version}, ${entries.length} assets`,
);
