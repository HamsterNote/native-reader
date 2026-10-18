import assert from 'node:assert/strict';
import test from 'node:test';
import { findForbiddenTarballFiles } from './verify-static-native-propagation.mjs';

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
