import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cp,
  mkdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { packIsolatedRelease } from './isolated-release.mjs';
import {
  createOwnedStagingRoot,
  disposeOwnedStagingRoot,
} from './staging-ownership.mjs';
import {
  FFLATE_LICENSE,
  ZIP_JS_LICENSE,
} from '../../../scripts/stage-foliate-runtime.mjs';
import {
  findForbiddenTarballFiles,
  REQUIRED_TARBALL_FILES,
  verifyFoliateNativeRuntime,
  verifyStaticNativePropagation,
} from './verify-static-native-propagation.mjs';
import { verifyFoliateWebExport } from '../../../scripts/verify-foliate-web-export.mjs';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = path.resolve(packageRoot, '../..');
const temporary = await createOwnedStagingRoot({
  parentRoot: os.tmpdir(),
  prefix: 'foliate-runtime-package-test-',
  authorityRoots: [workspaceRoot],
});
const temporaryRoot = temporary.outputRoot;

async function readTarFile(tarball, relativePath) {
  const archive = gunzipSync(await readFile(tarball));
  let offset = 0;
  const expectedName = `package/${relativePath}`;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header
      .subarray(124, 136)
      .toString('utf8')
      .replace(/\0.*$/, '')
      .trim();
    const size = Number.parseInt(sizeText || '0', 8);
    const payloadStart = offset + 512;
    if (name === expectedName)
      return archive
        .subarray(payloadStart, payloadStart + size)
        .toString('utf8');
    offset = payloadStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Tarball is missing ${relativePath}`);
}

const expoBinary = path.join(workspaceRoot, 'node_modules', '.bin', 'expo');

async function writePackedExpoConsumer({ consumerRoot, packedRoot, tarball }) {
  await mkdir(path.join(consumerRoot, 'node_modules', '@hamster-note'), {
    recursive: true,
  });
  // The runtime source is an extracted release tarball, never the workspace package.
  await cp(
    packedRoot,
    path.join(consumerRoot, 'node_modules', '@hamster-note', 'native-reader'),
    { recursive: true },
  );
  for (const dependency of [
    'expo',
    'react',
    'react-dom',
    'react-native',
    'react-native-web',
  ]) {
    await symlink(
      path.join(workspaceRoot, 'node_modules', dependency),
      path.join(consumerRoot, 'node_modules', dependency),
      'dir',
    );
  }
  // The static verifier rejects a dependency that resolves outside the consumer.
  // Copy this small package instead of linking it back to the workspace.
  await cp(
    path.join(workspaceRoot, 'node_modules', 'react-native-webview'),
    path.join(consumerRoot, 'node_modules', 'react-native-webview'),
    { recursive: true },
  );
  await writeFile(
    path.join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'packed-foliate-web-consumer',
        private: true,
        main: 'index.js',
        dependencies: {
          '@hamster-note/native-reader': `file:${path.basename(tarball)}`,
          expo: '~57.0.24',
          react: '19.2.3',
          'react-dom': '19.2.3',
          'react-native': '0.86.3',
          'react-native-web': '~0.21.0',
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(consumerRoot, 'app.json'),
    '{"expo":{"name":"Packed Foliate Consumer","slug":"packed-foliate-consumer","version":"1.0.0","web":{"output":"single"}}}\n',
  );
  await writeFile(
    path.join(consumerRoot, 'index.js'),
    "const React = require('react');\nconst { registerRootComponent } = require('expo');\nconst { Text } = require('react-native');\nconst { NativeReader } = require('@hamster-note/native-reader');\nif (typeof NativeReader !== 'function') throw new TypeError('Packed NativeReader export is unavailable');\nfunction App() { return React.createElement(Text, null, 'Packed Foliate runtime consumer'); }\nregisterRootComponent(App);\n",
  );
}

try {
  const staging = await createOwnedStagingRoot({
    parentRoot: temporaryRoot,
    prefix: 'staging-',
    authorityRoots: [workspaceRoot],
  });
  const artifacts = await createOwnedStagingRoot({
    parentRoot: temporaryRoot,
    prefix: 'artifacts-',
    authorityRoots: [workspaceRoot],
  });
  const release = await packIsolatedRelease({
    packDestination: artifacts.outputRoot,
    packOwnership: artifacts.ownership,
    packageRoot,
    stagingRoot: staging.outputRoot,
    stagingOwnership: staging.ownership,
    workspaceRoot,
  });
  const files = release.packed.files.map(({ path: file }) => file).sort();
  for (const required of REQUIRED_TARBALL_FILES) {
    assert.ok(files.includes(required), `Tarball is missing ${required}`);
  }
  assert.ok(files.includes('foliate-runtime/manifest.json'));
  assert.ok(files.includes('foliate-runtime/web/manifest.json'));
  assert.ok(files.includes('foliate-runtime/web/reader.html'));
  assert.ok(files.includes('foliate-runtime/web/bootstrap.js'));
  assert.ok(files.includes('foliate-runtime/web/probes/csp-1x1.png'));
  assert.ok(
    files.includes('foliate-runtime/web/probes/csp-external-canary.js'),
  );
  assert.ok(files.includes('foliate-runtime/native/manifest.json'));
  assert.ok(files.includes('foliate-runtime/native/reader.html'));
  assert.ok(files.includes('foliate-runtime/native/bootstrap.js'));
  assert.ok(files.includes('foliate-runtime/native/probes/csp-1x1.png'));
  assert.ok(
    files.includes('foliate-runtime/native/probes/csp-external-canary.js'),
  );
  assert.ok(files.includes('scripts/sync-foliate-web-runtime.mjs'));
  assert.ok(files.includes('foliate-runtime/LICENSE'));
  assert.ok(files.includes('foliate-runtime/LICENSES/zip.js-BSD-3-Clause.txt'));
  assert.ok(files.includes('foliate-runtime/LICENSES/fflate-MIT.txt'));
  assert.ok(files.includes('foliate-runtime/vendor/zip.js'));
  assert.ok(files.includes('foliate-runtime/vendor/fflate.js'));
  assert.deepEqual(findForbiddenTarballFiles(files), []);
  assert.equal(
    files.some((file) =>
      /(^|\/)(vendor\/foliate-js|\.git|pdf\.js|pdf\.worker\.mjs|cmaps|standard_fonts)(\/|$)/.test(
        file,
      ),
    ),
    false,
  );
  assert.equal(
    execFileSync(
      'git',
      ['ls-files', 'packages/native-reader/foliate-runtime'],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
      },
    ).trim(),
    '',
  );
  assert.equal(
    await readTarFile(
      release.tarball,
      'foliate-runtime/LICENSES/fflate-MIT.txt',
    ),
    FFLATE_LICENSE,
  );
  assert.equal(
    await readTarFile(
      release.tarball,
      'foliate-runtime/LICENSES/zip.js-BSD-3-Clause.txt',
    ),
    ZIP_JS_LICENSE,
  );
  // Use the emitted tarball rather than the workspace package to prove that a
  // packed consumer can materialize and validate its own project-root runtime.
  const consumerRoot = path.join(temporaryRoot, 'packed-web-consumer');
  const extractedRoot = path.join(temporaryRoot, 'packed-web-runtime');
  await mkdir(extractedRoot, { recursive: true });
  await mkdir(consumerRoot, { recursive: true });
  execFileSync('tar', ['-xzf', release.tarball, '-C', extractedRoot], {
    stdio: 'pipe',
  });
  const packedRoot = path.join(extractedRoot, 'package');
  // Validate the extracted release asset rather than the ignored workspace
  // generation, so the tarball cannot retain a stale or widened native host.
  await verifyFoliateNativeRuntime(packedRoot);
  await writePackedExpoConsumer({
    consumerRoot,
    packedRoot,
    tarball: release.tarball,
  });
  await verifyStaticNativePropagation({
    consumerRoot,
    packageRoot: packedRoot,
    dependencyResolutionRoot: consumerRoot,
  });
  const { checkFoliateWebRuntime, syncFoliateWebRuntime } = await import(
    pathToFileURL(path.join(packedRoot, 'scripts/sync-foliate-web-runtime.mjs'))
      .href
  );
  const runtimeRoot = path.join(packedRoot, 'foliate-runtime/web');
  const packedSyncCli = path.join(
    consumerRoot,
    'node_modules/@hamster-note/native-reader/scripts/sync-foliate-web-runtime.mjs',
  );
  execFileSync(process.execPath, [packedSyncCli, '--target', consumerRoot], {
    stdio: 'inherit',
  });
  execFileSync(
    process.execPath,
    [packedSyncCli, '--check', '--target', consumerRoot],
    { stdio: 'inherit' },
  );
  await checkFoliateWebRuntime({ runtimeRoot, targetRoot: consumerRoot });
  await writeFile(
    path.join(consumerRoot, 'public', 'application-owned.txt'),
    'preserved',
  );
  await syncFoliateWebRuntime({ runtimeRoot, targetRoot: consumerRoot });
  assert.equal(
    await readFile(
      path.join(consumerRoot, 'public', 'application-owned.txt'),
      'utf8',
    ),
    'preserved',
  );
  execFileSync(expoBinary, ['export', '--platform', 'web'], {
    cwd: consumerRoot,
    stdio: 'inherit',
  });
  const exportReader = path.join(consumerRoot, 'dist', 'reader');
  await verifyFoliateWebExport({
    sourceReader: path.join(consumerRoot, 'public', 'reader'),
    exportReader,
  });
  const [, firstAsset] =
    (
      await readFile(
        path.join(consumerRoot, 'public', 'reader', 'manifest.json'),
        'utf8',
      )
    ).match(/"path": "([^"]+)"/) ?? [];
  assert.ok(firstAsset, 'Packed runtime manifest must contain an asset');
  await writeFile(path.join(exportReader, firstAsset), 'stale');
  await assert.rejects(
    verifyFoliateWebExport({
      sourceReader: path.join(consumerRoot, 'public', 'reader'),
      exportReader,
    }),
    /Foliate Web export asset hash mismatch/,
  );
  await unlink(path.join(exportReader, firstAsset));
  await assert.rejects(
    verifyFoliateWebExport({
      sourceReader: path.join(consumerRoot, 'public', 'reader'),
      exportReader,
    }),
    /Foliate Web export is missing assets/,
  );
  process.stdout.write(
    `Foliate runtime tarball and packed Expo consumer inspection passed (${files.length} files): ${consumerRoot}\n`,
  );
} finally {
  await disposeOwnedStagingRoot(temporary);
}
