import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageManifest = JSON.parse(
  await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
);
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

  const consumerRoot = path.join(temporaryRoot, 'consumer');
  const tarballPath = path.join(temporaryRoot, packed.filename);
  const peerPackages = Object.entries(packageManifest.peerDependencies).map(
    ([name, version]) => `${name}@${version}`,
  );
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--prefix',
      consumerRoot,
      tarballPath,
      ...peerPackages,
      'typescript@~6.0.3',
      '@types/react@~19.2.2',
    ],
    { stdio: 'inherit' },
  );

  await writeFile(
    path.join(consumerRoot, 'node_modules/react-native/index.js'),
    `exports.StyleSheet = { create: (styles) => styles };\n` +
      `exports.Text = 'Text';\n` +
      `exports.View = 'View';\n`,
  );

  const packageName = packageManifest.name;
  await Promise.all([
    writeFile(
      path.join(consumerRoot, 'verify-esm.mjs'),
      `import { NativeReader } from ${JSON.stringify(packageName)};\n` +
        `if (typeof NativeReader !== 'function') throw new Error('ESM package root did not export NativeReader');\n`,
    ),
    writeFile(
      path.join(consumerRoot, 'verify-cjs.cjs'),
      `const { NativeReader } = require(${JSON.stringify(packageName)});\n` +
        `if (typeof NativeReader !== 'function') throw new Error('CJS package root did not export NativeReader');\n`,
    ),
    writeFile(
      path.join(consumerRoot, 'consumer.ts'),
      `import { NativeReader } from ${JSON.stringify(packageName)};\n` +
        `import type { NativeReaderProps } from ${JSON.stringify(packageName)};\n` +
        `const component: typeof NativeReader = NativeReader;\n` +
        `const props: NativeReaderProps = { content: { id: 'fixture', title: 'Fixture' } };\n` +
        `void [component, props];\n`,
    ),
    writeFile(
      path.join(consumerRoot, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true,
            skipLibCheck: true,
            strict: true,
            target: 'ES2022',
          },
          include: ['consumer.ts'],
        },
        null,
        2,
      )}\n`,
    ),
  ]);
  execFileSync(process.execPath, ['verify-esm.mjs'], {
    cwd: consumerRoot,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, ['verify-cjs.cjs'], {
    cwd: consumerRoot,
    stdio: 'inherit',
  });
  execFileSync(
    process.execPath,
    [
      path.join(consumerRoot, 'node_modules/typescript/bin/tsc'),
      '--project',
      '.',
    ],
    { cwd: consumerRoot, stdio: 'inherit' },
  );
  console.log(
    `Packed package verified in an isolated consumer: ${packed.filename} (${files.length} files).`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
