import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  FOLIATE_RUNTIME_DIRECTORY,
  stageFoliateRuntime,
} from './stage-foliate-runtime.mjs';
import { runFoliate3a } from './test-foliate-3a.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(workspaceRoot, 'vendor/foliate-js');

test('3A aggregate stages a missing generated runtime before it checks it', async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'foliate-3a-clean-stage-test-'),
  );
  const packageRoot = path.join(root, 'native-reader');
  const runtimeRoot = path.join(packageRoot, FOLIATE_RUNTIME_DIRECTORY);
  const checks = [];
  try {
    await assert.rejects(
      () =>
        stageFoliateRuntime({
          workspace: root,
          packageRoot,
          sourceRoot,
          validateFn: async () => undefined,
          check: true,
        }),
      /runtime stage is missing/,
    );
    await runFoliate3a({
      workspace: root,
      validateFn: async () => undefined,
      stageFn: (options) => {
        checks.push(Boolean(options.check));
        return stageFoliateRuntime({ ...options, packageRoot, sourceRoot });
      },
      commands: [],
    });
    assert.deepEqual(checks, [false, true]);
    await stageFoliateRuntime({
      workspace: root,
      packageRoot,
      sourceRoot,
      validateFn: async () => undefined,
      check: true,
    });
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
