import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(root, 'packages/pdf-kit-expo-module');
const consumer = mkdtempSync(path.join(tmpdir(), 'pdfkit-consumer-'));
const run = (program, args, cwd = root) =>
  execFileSync(program, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
try {
  run('pnpm', ['--filter', '@hamster-note/pdfkit', 'build']);
  const [packed] = JSON.parse(
    run(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer],
      packageRoot,
    ),
  );
  const files = new Set(packed.files.map(({ path: name }) => name));
  for (const name of [
    'build/index.js',
    'build/index.d.ts',
    'expo-module.config.json',
    'ios/HamsterPdfKit.podspec',
    'ios/HamsterPdfKitModule.swift',
    'ios/HamsterPdfKitView.swift',
    'ios/PdfLocalSnapshot.swift',
    'ios/Tests/PdfPolicyTests.swift',
  ])
    assert(files.has(name), `Missing packed file ${name}`);
  assert(
    ![...files].some(
      (name) => name.startsWith('node_modules/') || name.includes('../'),
    ),
  );
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({
      name: 'external-pdfkit-consumer',
      private: true,
      version: '1.0.0',
      dependencies: { '@hamster-note/pdfkit': `file:./${packed.filename}` },
    }),
  );
  // Install the actual artifact offline. No workspace links or native-reader
  // source paths may be used to discover the independent native module.
  run(
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--legacy-peer-deps',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
    ],
    consumer,
  );
  const autolinking = path.join(
    root,
    'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js',
  );
  const resolved = JSON.parse(
    run(
      process.execPath,
      [
        autolinking,
        'resolve',
        '--project-root',
        consumer,
        '--platform',
        'apple',
        '--json',
      ],
      consumer,
    ),
  );
  const module = resolved.modules.find(
    ({ packageName }) => packageName === '@hamster-note/pdfkit',
  );
  assert.equal(module?.modules[0]?.class, 'HamsterPdfKitModule');
  assert.equal(module?.pods[0]?.podName, 'HamsterPdfKit');
  assert(
    module.pods[0].podspecDir.startsWith(path.join(consumer, 'node_modules/')),
  );
  const declaration = readFileSync(
    path.join(consumer, 'node_modules/@hamster-note/pdfkit/build/index.d.ts'),
    'utf8',
  );
  assert(!declaration.includes('../native-reader'));
  // This check is metadata/packaging evidence, not a Swift build or simulator.
  console.log(
    `PDFKit package: ${packed.files.length} files; offline external consumer autolinks HamsterPdfKitModule.`,
  );
  if (process.env.PDFKIT_KEEP_CONSUMER === '1')
    console.log(`Consumer retained at ${consumer}`);
} finally {
  if (process.env.PDFKIT_KEEP_CONSUMER !== '1')
    rmSync(consumer, { recursive: true, force: true });
}
