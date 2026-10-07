import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FOLIATE_SUBMODULE_PATH = 'vendor/foliate-js';
export const FOLIATE_UPSTREAM_URL =
  'https://github.com/johnfactotum/foliate-js.git';
export const FOLIATE_COMMIT_SHA = '78914aef4466eb960965702401634c2cb348e9b1';
export const FOLIATE_BRANCH = 'hamsternote-foliate-pin';
export const REVISION_REVIEW_PATH =
  'supply-chain/foliate-js.revision-review.json';
export const BOOTSTRAP_HINT = 'pnpm run foliate:submodule:bootstrap';

const scriptRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function runGit(root, args) {
  try {
    return {
      ok: true,
      output: execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      output: String(error.stderr ?? error.stdout ?? error.message).trim(),
    };
  }
}

function readGit(root, args, description, errors) {
  const result = runGit(root, args);
  if (!result.ok || !result.output) {
    errors.push(`${description}: ${result.output || 'git command failed'}`);
    return undefined;
  }
  return result.output;
}

function parseIndexEntries(output) {
  if (!output) return [];
  return output.split('\n').map((line) => {
    const match = line.match(/^(\d+)\s+([0-9a-f]{40})\s+(\d+)\t(.+)$/);
    return match
      ? {
          mode: match[1],
          object: match[2],
          stage: Number(match[3]),
          path: match[4],
        }
      : { malformed: line };
  });
}

function readTrackedBlob(root, relativePath, description, errors) {
  const entries = parseIndexEntries(
    readGit(
      root,
      ['ls-files', '--stage', '--', relativePath],
      `${description} is missing from the superproject index`,
      errors,
    ),
  );
  if (
    entries.length !== 1 ||
    entries[0].malformed ||
    entries[0].stage !== 0 ||
    entries[0].path !== relativePath
  ) {
    errors.push(`${description} must have exactly one stage-0 index entry`);
    return undefined;
  }
  return entries[0];
}

async function readTrackedWorktreeFile({
  root,
  relativePath,
  description,
  requiredMode,
  errors,
}) {
  const entry = readTrackedBlob(root, relativePath, description, errors);
  if (entry && entry.mode !== requiredMode) {
    errors.push(
      `${description} must be a stage-0 mode-${requiredMode} index entry`,
    );
  }
  let worktree;
  let indexed;
  try {
    [worktree, indexed] = await Promise.all([
      readFile(path.join(root, relativePath)),
      Promise.resolve(
        execFileSync('git', ['show', `:${relativePath}`], {
          cwd: root,
          encoding: 'buffer',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      ),
    ]);
  } catch (error) {
    errors.push(`${description} is missing or unreadable: ${error.message}`);
    return undefined;
  }
  if (!entry || entry.mode !== requiredMode) return undefined;
  if (!worktree.equals(indexed)) {
    errors.push(`${description} worktree content differs from its index blob`);
    return undefined;
  }
  return worktree;
}

async function readRevisionReview(root, errors) {
  const worktree = await readTrackedWorktreeFile({
    root,
    relativePath: REVISION_REVIEW_PATH,
    description: 'revision review metadata',
    requiredMode: '100644',
    errors,
  });
  if (!worktree) return undefined;

  let review;
  try {
    review = JSON.parse(worktree.toString('utf8'));
  } catch (error) {
    errors.push(`revision review metadata is invalid JSON: ${error.message}`);
    return undefined;
  }
  if (review?.schemaVersion !== 1)
    errors.push('revision review metadata must use schemaVersion 1');
  if (review?.upstreamRepository !== FOLIATE_UPSTREAM_URL)
    errors.push(
      'revision review metadata has an unexpected upstreamRepository',
    );
  if (review?.approvedCommitSha !== FOLIATE_COMMIT_SHA)
    errors.push('revision review metadata has an unexpected approvedCommitSha');
  if (review?.licenseReview?.status !== 'approved')
    errors.push('revision review metadata requires an approved licenseReview');
  if (!review?.licenseReview?.license || !review?.licenseReview?.reviewedAt)
    errors.push(
      'revision review metadata requires license and reviewedAt values',
    );
  if (review?.requiredReverification?.multiFormatSecurity !== true)
    errors.push(
      'revision review metadata must require multi-format security re-verification',
    );
  if (review?.requiredReverification?.package !== true)
    errors.push(
      'revision review metadata must require package re-verification',
    );
  return review;
}

function parseGitmodules(root, errors) {
  const all = runGit(root, [
    'config',
    '--null',
    '--file',
    '.gitmodules',
    '--list',
  ]);
  if (!all.ok) {
    errors.push(
      `.gitmodules cannot be read: ${all.output || 'git command failed'}`,
    );
    return undefined;
  }
  const values = all.output
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.split('\n'));
  const sectionValues = new Map();
  for (const [key, value] of values) {
    const match = key?.match(/^submodule\.([^.]*)\.(path|url)$/);
    if (!match) continue;
    const [, name, field] = match;
    const section = sectionValues.get(name) ?? {};
    section[field] = [...(section[field] ?? []), value];
    sectionValues.set(name, section);
  }
  const foliate = sectionValues.get('vendor/foliate-js');
  if (
    !foliate ||
    foliate.path?.length !== 1 ||
    foliate.path[0] !== FOLIATE_SUBMODULE_PATH ||
    foliate.url?.length !== 1 ||
    foliate.url[0] !== FOLIATE_UPSTREAM_URL
  ) {
    errors.push(
      '.gitmodules must define exactly one vendor/foliate-js section with the pinned path and official URL',
    );
  }
  const matchingPaths = [...sectionValues.entries()].filter(([, section]) =>
    section.path?.includes(FOLIATE_SUBMODULE_PATH),
  );
  if (
    matchingPaths.length !== 1 ||
    matchingPaths[0]?.[0] !== 'vendor/foliate-js'
  ) {
    errors.push(
      '.gitmodules has a duplicate or incorrectly named Foliate path mapping',
    );
  }
  return errors.length === 0 ? sectionValues : undefined;
}

/**
 * Checks the superproject-controlled .gitmodules bytes before any submodule
 * update can consult a stale local URL or touch the network.
 */
export async function assertFoliateGitmodulesIntegrity({
  root = scriptRoot,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const errors = [];
  const worktree = await readTrackedWorktreeFile({
    root: resolvedRoot,
    relativePath: '.gitmodules',
    description: '.gitmodules',
    requiredMode: '100644',
    errors,
  });
  if (worktree) parseGitmodules(resolvedRoot, errors);
  if (errors.length > 0) {
    throw new Error(
      `Foliate .gitmodules preflight failed:\n- ${errors.join(`\n- `)}`,
    );
  }
}

function readGitlink(root, errors) {
  const entries = parseIndexEntries(
    readGit(
      root,
      ['ls-files', '--stage', '--', FOLIATE_SUBMODULE_PATH],
      'Foliate gitlink is missing from the superproject index',
      errors,
    ),
  );
  if (
    entries.length !== 1 ||
    entries[0].malformed ||
    entries[0].stage !== 0 ||
    entries[0].mode !== '160000' ||
    entries[0].path !== FOLIATE_SUBMODULE_PATH
  ) {
    errors.push(
      'Foliate gitlink must have exactly one stage-0 mode-160000 index entry',
    );
    return undefined;
  }
  if (entries[0].object !== FOLIATE_COMMIT_SHA) {
    errors.push(
      `Foliate gitlink is ${entries[0].object}, not ${FOLIATE_COMMIT_SHA}`,
    );
  }
  return entries[0].object;
}

async function hasDirectory(directory) {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Validates the exact Foliate source revision before generated reader assets
 * exist. Bootstrap creates the required attached local branch from the gitlink.
 */
export async function validateFoliateSubmodule({ root = scriptRoot } = {}) {
  const resolvedRoot = path.resolve(root);
  const errors = [];
  const review = await readRevisionReview(resolvedRoot, errors);
  try {
    await assertFoliateGitmodulesIntegrity({ root: resolvedRoot });
  } catch (error) {
    errors.push(
      error.message.replace('Foliate .gitmodules preflight failed:\n- ', ''),
    );
  }
  const gitlink = readGitlink(resolvedRoot, errors);
  if (review && gitlink && review.approvedCommitSha !== gitlink) {
    errors.push(
      'Foliate gitlink does not match the approved revision metadata',
    );
  }

  const submoduleRoot = path.join(resolvedRoot, FOLIATE_SUBMODULE_PATH);
  if (!(await hasDirectory(submoduleRoot))) {
    errors.push('Foliate submodule is uninitialized');
  } else {
    const origin = readGit(
      submoduleRoot,
      ['remote', 'get-url', 'origin'],
      'Foliate submodule origin cannot be read',
      errors,
    );
    if (origin && origin !== FOLIATE_UPSTREAM_URL) {
      errors.push(
        `Foliate submodule origin is ${origin}, not the official URL`,
      );
    }
    const branch = readGit(
      submoduleRoot,
      ['symbolic-ref', '--short', '-q', 'HEAD'],
      'Foliate submodule HEAD is detached',
      errors,
    );
    if (branch && branch !== FOLIATE_BRANCH) {
      errors.push(
        `Foliate submodule branch is ${branch}, not ${FOLIATE_BRANCH}`,
      );
    }
    const head = readGit(
      submoduleRoot,
      ['rev-parse', 'HEAD'],
      'Foliate submodule HEAD cannot be read',
      errors,
    );
    if (head && head !== FOLIATE_COMMIT_SHA) {
      errors.push(
        `Foliate submodule HEAD is ${head}, not ${FOLIATE_COMMIT_SHA}`,
      );
    }
    if (head && gitlink && head !== gitlink) {
      errors.push(
        'Foliate submodule HEAD does not match the superproject gitlink',
      );
    }
    const status = runGit(submoduleRoot, [
      'status',
      '--porcelain',
      '--untracked-files=all',
    ]);
    if (!status.ok) {
      errors.push(
        `Foliate submodule worktree status cannot be read: ${status.output || 'git command failed'}`,
      );
    } else if (status.output) {
      errors.push('Foliate submodule worktree is dirty');
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Foliate submodule validation failed:\n- ${errors.join(`\n- `)}\nFix with: ${BOOTSTRAP_HINT}`,
    );
  }
  return {
    branch: FOLIATE_BRANCH,
    commit: FOLIATE_COMMIT_SHA,
    root: resolvedRoot,
    upstream: FOLIATE_UPSTREAM_URL,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await validateFoliateSubmodule();
  console.log(
    `Foliate submodule verified: ${result.upstream} at ${result.commit} on ${result.branch}.`,
  );
}
