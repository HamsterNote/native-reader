import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stageFoliateRuntime } from './stage-foliate-runtime.mjs';
import { validateFoliateSubmodule } from './verify-foliate-submodule.mjs';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const run = (command, args, workspace = workspaceRoot) => {
  const result = spawnSync(command, args, {
    cwd: workspace,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      `Foliate 3A aggregate command failed: ${command} ${args.join(' ')}`,
    );
  }
};

export async function runFoliate3a({
  workspace = workspaceRoot,
  validateFn = validateFoliateSubmodule,
  stageFn = stageFoliateRuntime,
  runFn = run,
  commands = [
    [process.execPath, ['--test', 'scripts/stage-foliate-runtime.test.mjs']],
    [process.execPath, ['--test', 'scripts/test-foliate-3a.test.mjs']],
    [process.execPath, ['--test', 'scripts/sync-foliate-web-runtime.test.mjs']],
    [
      process.execPath,
      ['--test', 'packages/native-reader/scripts/isolated-release.test.mjs'],
    ],
    [
      'pnpm',
      [
        '--filter',
        '@hamster-note/native-reader',
        'run',
        'test:foliate-runtime-package:raw',
      ],
    ],
    [
      'pnpm',
      ['--filter', '@hamster-note/native-reader', 'run', 'test:package:raw'],
    ],
  ],
} = {}) {
  await validateFn({ root: workspace });
  // A clean checkout has no ignored runtime tree. Generate it before any check.
  await stageFn({ workspace, validateFn: async () => undefined });
  await stageFn({ workspace, validateFn: async () => undefined, check: true });
  for (const [command, args] of commands) runFn(command, args, workspace);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runFoliate3a();
}
