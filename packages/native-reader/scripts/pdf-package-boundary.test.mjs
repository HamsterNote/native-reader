import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  findForbiddenTarballFiles,
  SECURE_WEBVIEW_INTEGRITY_FILES,
} from './verify-static-native-propagation.mjs';

test('the independent tarball integrity contract covers the complete staged native manifest', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../SECURE_WEBVIEW_SHA256.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(Object.keys(manifest.files), SECURE_WEBVIEW_INTEGRITY_FILES);
});

test('PDF consumer tools are public while source stage and release tools stay private', () => {
  assert.deepEqual(findForbiddenTarballFiles([
    'scripts/sync-foliate-web-runtime.mjs',
    'scripts/sync-pdf-web-runtime.mjs',
    'scripts/pdf-runtime-files.mjs',
  ]), []);
  const internal = [
    'scripts/stage-pdf-runtime.mjs',
    'scripts/isolated-release.mjs',
    'scripts/sync-pdf-web-runtime.mjs.extra',
    'src/pdf/contracts.ts',
    'consumer-test/pdf-contracts.mts',
  ];
  assert.deepEqual(findForbiddenTarballFiles(internal), internal);
});
