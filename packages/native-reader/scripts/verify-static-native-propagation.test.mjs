import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FOLIATE_NATIVE_RUNTIME_DIRECTORY,
  FOLIATE_RUNTIME_DIRECTORY,
  stageFoliateRuntime,
} from '../../../scripts/stage-foliate-runtime.mjs';
import {
  verifyFoliateNativeRuntime,
  SECURE_WEBVIEW_INTEGRITY_FILES,
} from './verify-static-native-propagation.mjs';
import { collectIntegrityEntries } from './stage-secure-webview.mjs';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const sourceRoot = path.join(workspaceRoot, 'vendor/foliate-js');

const sha256 = (contents) =>
  createHash('sha256').update(contents).digest('hex');

test('native Foliate manifest rejects probe metadata/hash, extra, missing, and excluded assets', async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'foliate-native-manifest-'),
  );
  const packageRoot = path.join(root, 'native-reader');
  const nativeRoot = path.join(
    packageRoot,
    FOLIATE_RUNTIME_DIRECTORY,
    FOLIATE_NATIVE_RUNTIME_DIRECTORY,
  );
  const manifestPath = path.join(nativeRoot, 'manifest.json');
  const stage = () =>
    stageFoliateRuntime({
      workspace: root,
      packageRoot,
      sourceRoot,
      validateFn: async () => undefined,
    });

  try {
    await stage();
    await verifyFoliateNativeRuntime(packageRoot);

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.assets[0].sha256 = '0'.repeat(64);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(
      () => verifyFoliateNativeRuntime(packageRoot),
      /Foliate native runtime asset does not match manifest/,
    );

    await stage();
    const probeManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const probe = probeManifest.assets.find(
      (asset) => asset.path === 'probes/csp-1x1.png',
    );
    assert.ok(probe, 'native manifest must include the CSP probe PNG');
    probe.mimeType = 'text/plain; charset=utf-8';
    await writeFile(
      manifestPath,
      `${JSON.stringify(probeManifest, null, 2)}\n`,
    );
    await assert.rejects(
      () => verifyFoliateNativeRuntime(packageRoot),
      /Foliate native runtime has invalid CSP probe metadata/,
    );

    await stage();
    await writeFile(path.join(nativeRoot, 'probes', 'csp-1x1.png'), 'tampered');
    await assert.rejects(
      () => verifyFoliateNativeRuntime(packageRoot),
      /Foliate native runtime asset does not match manifest: probes\/csp-1x1\.png/,
    );

    await stage();
    await rm(path.join(nativeRoot, 'probes', 'csp-external-canary.js'));
    await assert.rejects(
      () => verifyFoliateNativeRuntime(packageRoot),
      /Foliate runtime manifest asset is missing: foliate-runtime\/native\/probes\/csp-external-canary\.js/,
    );

    await stage();
    await writeFile(
      path.join(nativeRoot, 'probes', 'unlisted.js'),
      'export {};\n',
    );
    await assert.rejects(
      () => verifyFoliateNativeRuntime(packageRoot),
      /Foliate native runtime packaged file set/,
    );

    await stage();
    await rm(path.join(nativeRoot, 'bootstrap.js'));
    await assert.rejects(
      () => verifyFoliateNativeRuntime(packageRoot),
      /Foliate runtime manifest asset is missing/,
    );

    await stage();
    await writeFile(path.join(nativeRoot, 'foliate', 'pdf.js'), 'export {};\n');
    await assert.rejects(
      () => verifyFoliateNativeRuntime(packageRoot),
      /Foliate native runtime packaged file set/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('native Foliate bootstrap rejects host-only contract regressions after manifest rehash', async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'foliate-native-bootstrap-'),
  );
  const packageRoot = path.join(root, 'native-reader');
  const nativeRoot = path.join(
    packageRoot,
    FOLIATE_RUNTIME_DIRECTORY,
    FOLIATE_NATIVE_RUNTIME_DIRECTORY,
  );
  const manifestPath = path.join(nativeRoot, 'manifest.json');
  const bootstrapPath = path.join(nativeRoot, 'bootstrap.js');
  const stage = () =>
    stageFoliateRuntime({
      workspace: root,
      packageRoot,
      sourceRoot,
      validateFn: async () => undefined,
    });
  const mutateBootstrap = async (mutate) => {
    const contents = Buffer.from(
      mutate(await readFile(bootstrapPath, 'utf8')),
      'utf8',
    );
    await writeFile(bootstrapPath, contents);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const asset = manifest.assets.find(
      ({ path: assetPath }) => assetPath === 'bootstrap.js',
    );
    assert.ok(asset, 'native manifest must describe bootstrap.js');
    asset.sha256 = sha256(contents);
    asset.size = contents.length;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  };

  try {
    for (const [description, mutate, expected] of [
      [
        'missing lexical private entry',
        (source) =>
          source.replace(
            'export function installFoliateNativeHostBridge(port) {',
            'function installFoliateNativeHostBridge(port) {',
          ),
        /does not expose exactly one host-only private bridge entry/,
      ],
      [
        'additional public entry',
        (source) => `${source}\nexport const unexpectedNativeEntry = true;\n`,
        /does not expose exactly one host-only private bridge entry/,
      ],
      [
        'Foliate import',
        (source) => `import './foliate/view.js';\n${source}`,
        /Foliate module import/,
      ],
      [
        'publication source capability',
        (source) => `const source = 'untrusted';\n${source}`,
        /publication or source capability/,
      ],
      [
        'publication open capability',
        (source) => `function open() {}\n${source}`,
        /publication open capability/,
      ],
      [
        'React Native global bridge',
        (source) => `ReactNativeWebView.postMessage('untrusted');\n${source}`,
        /page-world global bridge/,
      ],
      [
        'WebKit global bridge',
        (source) => `window.webkit.messageHandlers.bridge;\n${source}`,
        /page-world global bridge/,
      ],
      [
        'public window listener',
        (source) => `window.addEventListener('message', () => {});\n${source}`,
        /page-world global bridge/,
      ],
      [
        'public self listener',
        (source) => `self.addEventListener('message', () => {});\n${source}`,
        /page-world global bridge/,
      ],
    ]) {
      await stage();
      await mutateBootstrap(mutate);
      await assert.rejects(
        () => verifyFoliateNativeRuntime(packageRoot),
        expected,
        description,
      );
    }

    await stage();
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const extraPath = path.join(nativeRoot, 'legacy-4d-bootstrap.js');
    const extraContents = Buffer.from('export const legacy = true;\n');
    await writeFile(extraPath, extraContents);
    manifest.assets.push({
      path: 'legacy-4d-bootstrap.js',
      sha256: sha256(extraContents),
      size: extraContents.length,
      source: 'untrusted:legacy-4d',
      category: 'native-host-bootstrap',
      license: 'N/A',
      mimeType: 'text/javascript; charset=utf-8',
    });
    manifest.assets.sort((left, right) => left.path.localeCompare(right.path));
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(
      () => verifyFoliateNativeRuntime(packageRoot),
      /Foliate native runtime manifest asset (?:order|set)/,
      'unlisted legacy native assets must not join the manifest closure',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('independent packed integrity contract covers every staged native security boundary', async () => {
  const entries = await collectIntegrityEntries(
    path.join(workspaceRoot, 'packages/native-reader'),
    { sourceLayout: true },
  );
  assert.deepEqual(SECURE_WEBVIEW_INTEGRITY_FILES, Object.keys(entries).sort());
});
