import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FOLIATE_BRANCH,
  FOLIATE_COMMIT_SHA,
  FOLIATE_SUBMODULE_PATH,
  FOLIATE_UPSTREAM_URL,
  assertFoliateGitmodulesIntegrity,
  validateFoliateSubmodule,
} from './verify-foliate-submodule.mjs';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function runGit(root, args) {
  execFileSync('git', args, { cwd: root, stdio: 'inherit' });
}

/**
 * Git's default submodule initialization intentionally detaches HEAD. Convert
 * that checkout into the reviewed local branch at the superproject gitlink.
 */
export async function bootstrapFoliateSubmodule({
  root = workspaceRoot,
  allowFileProtocol = false,
  runGitFn = runGit,
} = {}) {
  const resolvedRoot = path.resolve(root);
  await assertFoliateGitmodulesIntegrity({ root: resolvedRoot });
  runGitFn(resolvedRoot, [
    'config',
    'submodule.vendor/foliate-js.url',
    FOLIATE_UPSTREAM_URL,
  ]);
  const updateArgs = [
    '-c',
    `submodule.vendor/foliate-js.url=${FOLIATE_UPSTREAM_URL}`,
  ];
  if (allowFileProtocol) updateArgs.push('-c', 'protocol.file.allow=always');
  updateArgs.push(
    'submodule',
    'update',
    '--init',
    '--recursive',
    '--',
    FOLIATE_SUBMODULE_PATH,
  );
  runGitFn(resolvedRoot, updateArgs);
  const submoduleRoot = path.join(resolvedRoot, FOLIATE_SUBMODULE_PATH);
  runGitFn(submoduleRoot, [
    'remote',
    'set-url',
    'origin',
    FOLIATE_UPSTREAM_URL,
  ]);
  runGitFn(submoduleRoot, [
    'checkout',
    '--quiet',
    '-B',
    FOLIATE_BRANCH,
    FOLIATE_COMMIT_SHA,
  ]);
  return validateFoliateSubmodule({ root: resolvedRoot });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await bootstrapFoliateSubmodule();
  console.log(
    `Foliate submodule bootstrapped: ${result.branch} at ${result.commit}.`,
  );
}
