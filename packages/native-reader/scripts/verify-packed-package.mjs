import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), 'native-reader-package-'),
);

try {
  const [packed] = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--json', '--pack-destination', temporaryRoot],
      {
        cwd: packageRoot,
        encoding: 'utf8',
      },
    ),
  );
  const files = packed.files.map(({ path: file }) => file);
  const required = [
    'lib/commonjs/index.js',
    'lib/module/index.js',
    'lib/typescript/commonjs/src/index.d.ts',
    'lib/typescript/module/src/index.d.ts',
    'src/index.ts',
    'src/index.native.ts',
    'src/index.web.ts',
    'node_modules/@epubjs-react-native/core/lib/commonjs/View.js',
  ];

  for (const file of required) {
    if (!files.includes(file))
      throw new Error(`Packed package is missing ${file}`);
  }
  const forbidden = files.filter(
    (file) =>
      file.includes('.test.') ||
      file.startsWith('consumer-test/') ||
      file.startsWith('apps/'),
  );
  if (forbidden.length)
    throw new Error(
      `Packed package contains private files: ${forbidden.join(', ')}`,
    );

  const consumer = path.join(temporaryRoot, 'consumer');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(consumer));
  const tarball = path.join(temporaryRoot, packed.filename);
  await writeFile(
    path.join(consumer, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: {
          '@hamster-note/native-reader': `file:${tarball}`,
          '@types/react': '~19.2.2',
          expo: '~57.0.24',
          react: '19.2.3',
          'react-native': '0.86.3',
          typescript: '~6.0.3',
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(consumer, 'index.mts'),
    "import { NativeReader, type ReaderSource } from '@hamster-note/native-reader';\nconst source: ReaderSource = { kind: 'uri', uri: 'file:///book.epub' };\nvoid NativeReader; void source;\n",
  );
  await writeFile(
    path.join(consumer, 'index.cts'),
    "import { NativeReader, type ReaderSource } from '@hamster-note/native-reader';\nconst source: ReaderSource = { kind: 'uri', uri: 'file:///book.epub' };\nvoid NativeReader; void source;\n",
  );
  await writeFile(
    path.join(consumer, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: {
        jsx: 'react-jsx',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: 'ES2022',
      },
      include: ['index.mts', 'index.cts'],
    })}\n`,
  );
  execFileSync('npm', ['install', '--ignore-scripts'], {
    cwd: consumer,
    stdio: 'pipe',
  });
  execFileSync('npx', ['tsc', '--project', 'tsconfig.json'], {
    cwd: consumer,
    stdio: 'pipe',
  });
  execFileSync(
    'node',
    [
      '--input-type=module',
      '--eval',
      "if (!import.meta.resolve('@hamster-note/native-reader')) process.exit(1)",
    ],
    { cwd: consumer, stdio: 'pipe' },
  );
  execFileSync(
    'node',
    [
      '--input-type=commonjs',
      '--eval',
      "if (!require.resolve('@hamster-note/native-reader')) process.exit(1)",
    ],
    { cwd: consumer, stdio: 'pipe' },
  );

  console.log(
    `Packed package and isolated ESM/CJS consumer verified: ${packed.filename} (${files.length} files).`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
