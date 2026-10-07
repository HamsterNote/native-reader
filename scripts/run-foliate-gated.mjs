import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stageFoliateRuntime } from './stage-foliate-runtime.mjs';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * Runs a command only after the submodule validator and deterministic runtime
 * staging have both succeeded. Staging owns validation, avoiding nested gates.
 */
export async function runFoliateGated({
  workspace = workspaceRoot,
  command,
  args = [],
  stageFn = stageFoliateRuntime,
  runFn = (nextCommand, nextArgs) =>
    spawnSync(nextCommand, nextArgs, { stdio: 'inherit' }),
} = {}) {
  if (!command) throw new Error('A gated command is required after --');
  await stageFn({ workspace });
  const result = runFn(command, args);
  if (result?.error) throw result.error;
  if (result?.status !== 0) process.exitCode = result?.status ?? 1;
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const separator = process.argv.indexOf('--');
  const [command, ...args] =
    separator >= 0 ? process.argv.slice(separator + 1) : [];
  await runFoliateGated({ command, args });
}
