import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { bootstrapFoliateSubmodule } from './bootstrap-foliate-submodule.mjs';
import {
  BOOTSTRAP_HINT,
  FOLIATE_BRANCH,
  FOLIATE_COMMIT_SHA,
  FOLIATE_SUBMODULE_PATH,
  FOLIATE_UPSTREAM_URL,
  REVISION_REVIEW_PATH,
  validateFoliateSubmodule,
} from './verify-foliate-submodule.mjs';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const sourceRepository = path.join(projectRoot, FOLIATE_SUBMODULE_PATH);

function git(root, args, input) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

async function writeReview(root, mutate = (review) => review) {
  const reviewPath = path.join(root, REVISION_REVIEW_PATH);
  await mkdir(path.dirname(reviewPath), { recursive: true });
  const review = mutate(
    JSON.parse(
      await readFile(path.join(projectRoot, REVISION_REVIEW_PATH), 'utf8'),
    ),
  );
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
}

async function createFixture({ initialize = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'foliate-submodule-test-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'user.name', 'Foliate submodule test']);
  await writeFile(
    path.join(root, '.gitmodules'),
    `[submodule "vendor/foliate-js"]\n\tpath = ${FOLIATE_SUBMODULE_PATH}\n\turl = ${FOLIATE_UPSTREAM_URL}\n`,
  );
  await writeReview(root);
  git(root, ['add', '.gitmodules', REVISION_REVIEW_PATH]);
  git(root, ['commit', '--quiet', '-m', 'Add Foliate review metadata']);
  git(root, [
    'update-index',
    '--add',
    '--cacheinfo',
    `160000,${FOLIATE_COMMIT_SHA},${FOLIATE_SUBMODULE_PATH}`,
  ]);
  git(root, ['commit', '--quiet', '-m', 'Add Foliate gitlink']);
  if (initialize) {
    git(root, ['submodule', 'init']);
    git(root, ['config', `submodule.vendor/foliate-js.url`, sourceRepository]);
    git(root, [
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'update',
      '--init',
      '--recursive',
      '--',
      FOLIATE_SUBMODULE_PATH,
    ]);
  }
  return { root, submoduleRoot: path.join(root, FOLIATE_SUBMODULE_PATH) };
}

async function expectValidationError(root, text) {
  await assert.rejects(
    () => validateFoliateSubmodule({ root }),
    (error) =>
      error.message.includes(text) && error.message.includes(BOOTSTRAP_HINT),
  );
}

const bootstrap = (root) =>
  bootstrapFoliateSubmodule({ root, allowFileProtocol: true });

async function withFixture(run, options) {
  const fixture = await createFixture(options);
  try {
    await run(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

test('bootstraps a standard detached submodule initialization onto the pinned branch', async () => {
  await withFixture(async ({ root, submoduleRoot }) => {
    assert.throws(() => git(submoduleRoot, ['symbolic-ref', '-q', 'HEAD']));
    const result = await bootstrap(root);
    assert.equal(result.branch, FOLIATE_BRANCH);
    assert.equal(
      git(submoduleRoot, ['symbolic-ref', '--short', 'HEAD']),
      FOLIATE_BRANCH,
    );
    assert.equal(git(submoduleRoot, ['rev-parse', 'HEAD']), FOLIATE_COMMIT_SHA);
  });
});

test('rejects an uninitialized submodule fixture', async () => {
  await withFixture(
    async ({ root }) => expectValidationError(root, 'uninitialized'),
    { initialize: false },
  );
});

test('rejects a detached submodule before bootstrap', async () => {
  await withFixture(async ({ root }) => {
    await expectValidationError(root, 'HEAD is detached');
  });
});

test('rejects a dirty submodule fixture', async () => {
  await withFixture(async ({ root, submoduleRoot }) => {
    await bootstrap(root);
    await writeFile(path.join(submoduleRoot, 'untracked-test-file'), 'dirty\n');
    await expectValidationError(root, 'worktree is dirty');
  });
});

test('rejects untracked and index-mismatched revision review metadata', async () => {
  await withFixture(async ({ root }) => {
    await bootstrap(root);
    git(root, ['rm', '--cached', '--quiet', REVISION_REVIEW_PATH]);
    await expectValidationError(
      root,
      'metadata is missing from the superproject index',
    );
  });
  await withFixture(async ({ root }) => {
    await bootstrap(root);
    await writeReview(root, (review) => ({
      ...review,
      reviewedBy: 'untracked edit',
    }));
    await expectValidationError(
      root,
      'worktree content differs from its index blob',
    );
  });
});

test('rejects malformed Foliate gitlink index states', async () => {
  await withFixture(async ({ root }) => {
    await bootstrap(root);
    git(
      root,
      ['update-index', '--index-info'],
      `160000 ${FOLIATE_COMMIT_SHA} 1\t${FOLIATE_SUBMODULE_PATH}\n`,
    );
    await expectValidationError(root, 'exactly one stage-0 mode-160000');
  });
  await withFixture(async ({ root }) => {
    await bootstrap(root);
    git(root, [
      'update-index',
      '--cacheinfo',
      `100644,${FOLIATE_COMMIT_SHA},${FOLIATE_SUBMODULE_PATH}`,
    ]);
    await expectValidationError(root, 'exactly one stage-0 mode-160000');
  });
});

test('rejects wrong and duplicate .gitmodules Foliate mappings', async () => {
  await withFixture(async ({ root }) => {
    await bootstrap(root);
    await writeFile(
      path.join(root, '.gitmodules'),
      `[submodule "vendor/foliate-js"]\n\tpath = wrong/path\n\turl = ${FOLIATE_UPSTREAM_URL}\n`,
    );
    git(root, ['add', '.gitmodules']);
    await expectValidationError(root, 'exactly one vendor/foliate-js section');
  });
  await withFixture(async ({ root }) => {
    await bootstrap(root);
    await writeFile(
      path.join(root, '.gitmodules'),
      `[submodule "vendor/foliate-js"]\n\tpath = ${FOLIATE_SUBMODULE_PATH}\n\turl = ${FOLIATE_UPSTREAM_URL}\n[submodule "duplicate"]\n\tpath = ${FOLIATE_SUBMODULE_PATH}\n\turl = ${FOLIATE_UPSTREAM_URL}\n`,
    );
    git(root, ['add', '.gitmodules']);
    await expectValidationError(
      root,
      'duplicate or incorrectly named Foliate path mapping',
    );
  });
});

test('rejects an incorrect submodule origin and wrong branch or SHA', async () => {
  await withFixture(async ({ root, submoduleRoot }) => {
    await bootstrap(root);
    git(submoduleRoot, [
      'remote',
      'set-url',
      'origin',
      'https://example.invalid/foliate-js.git',
    ]);
    await expectValidationError(root, 'submodule origin');
  });
  await withFixture(async ({ root, submoduleRoot }) => {
    await bootstrap(root);
    const parent = git(submoduleRoot, ['rev-parse', `${FOLIATE_COMMIT_SHA}^`]);
    git(submoduleRoot, ['checkout', '--quiet', '-B', 'wrong-branch', parent]);
    await expectValidationError(root, 'branch is wrong-branch');
  });
});

test('bootstrap rejects an index .gitmodules URL mismatch before submodule update', async () => {
  await withFixture(async ({ root }) => {
    const official = await readFile(path.join(root, '.gitmodules'), 'utf8');
    await writeFile(
      path.join(root, '.gitmodules'),
      `[submodule "vendor/foliate-js"]\n\tpath = ${FOLIATE_SUBMODULE_PATH}\n\turl = file:///definitely-unreachable-foliate.git\n`,
    );
    git(root, ['add', '.gitmodules']);
    await writeFile(path.join(root, '.gitmodules'), official);
    git(root, [
      'config',
      'submodule.vendor/foliate-js.url',
      'file:///definitely-unreachable-foliate.git',
    ]);
    await assert.rejects(
      () => bootstrap(root),
      (error) => error.message.includes('.gitmodules worktree content differs'),
    );
  });
});

test('bootstrap overrides a stale superproject submodule URL before update', async () => {
  await withFixture(async ({ root, submoduleRoot }) => {
    const commands = [];
    git(root, [
      'config',
      'submodule.vendor/foliate-js.url',
      'file:///definitely-unreachable-foliate.git',
    ]);
    const result = await bootstrapFoliateSubmodule({
      root,
      allowFileProtocol: true,
      runGitFn(commandRoot, args) {
        commands.push({ args, root: commandRoot });
        return git(commandRoot, args);
      },
    });
    assert.equal(result.upstream, FOLIATE_UPSTREAM_URL);
    assert.equal(
      git(root, ['config', '--get', 'submodule.vendor/foliate-js.url']),
      FOLIATE_UPSTREAM_URL,
    );
    assert.equal(git(submoduleRoot, ['rev-parse', 'HEAD']), FOLIATE_COMMIT_SHA);
    const update = commands.find(({ args }) => args.includes('submodule'));
    assert.deepEqual(update?.args.slice(0, 2), [
      '-c',
      `submodule.vendor/foliate-js.url=${FOLIATE_UPSTREAM_URL}`,
    ]);
    assert.equal(
      commands.some(({ args }) =>
        args.includes('file:///definitely-unreachable-foliate.git'),
      ),
      false,
    );
    await assert.doesNotReject(() => validateFoliateSubmodule({ root }));
  });
});
