import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_RUNTIME_MANIFEST = 'manifest.json';
export const WEB_RUNTIME_PUBLIC_DIRECTORY = path.join('public', 'reader');
export const FOLIATE_WEB_RUNTIME_VERSION = 'foliate-web-1';
export const FOLIATE_SOURCE = {
  commit: '78914aef4466eb960965702401634c2cb348e9b1',
  repository: 'https://github.com/johnfactotum/foliate-js.git',
};

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const codepointCompare = (left, right) => {
  const leftPoints = [...left];
  const rightPoints = [...right];
  for (
    let index = 0;
    index < Math.min(leftPoints.length, rightPoints.length);
    index += 1
  ) {
    const difference =
      leftPoints[index].codePointAt(0) - rightPoints[index].codePointAt(0);
    if (difference) return difference;
  }
  return leftPoints.length - rightPoints.length;
};
const sha256 = (contents) =>
  createHash('sha256').update(contents).digest('hex');

const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

async function lstatOptional(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function requireRegularFile(candidate, description) {
  const entry = await lstatOptional(candidate);
  if (!entry) throw new Error(`${description} is missing: ${candidate}`);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(
      `${description} must be a regular file, not a symlink: ${candidate}`,
    );
  }
}

async function requireSafeDirectory(
  candidate,
  description,
  { allowMissing = false } = {},
) {
  const entry = await lstatOptional(candidate);
  if (!entry) {
    if (allowMissing) return false;
    throw new Error(`${description} is missing: ${candidate}`);
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(
      `${description} must be a directory, not a symlink: ${candidate}`,
    );
  }
  return true;
}

const validateAssetPath = (relativePath) => {
  if (
    typeof relativePath !== 'string' ||
    !relativePath ||
    relativePath === WEB_RUNTIME_MANIFEST ||
    relativePath.includes('\\') ||
    relativePath.normalize('NFC') !== relativePath ||
    [...relativePath].some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code <= 0x1f || code === 0x7f);
    }) ||
    /^[A-Za-z]:/.test(relativePath) ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(
      `Foliate Web runtime manifest has an unsafe asset path: ${relativePath}`,
    );
  }
  return relativePath;
};

async function resolveContainedFile(root, relativePath, description) {
  const segments = relativePath.split('/');
  let candidate = root;
  for (const segment of segments) {
    candidate = path.join(candidate, segment);
    const entry = await lstatOptional(candidate);
    if (entry?.isSymbolicLink()) {
      throw new Error(
        `${description} has a symlinked path component: ${relativePath}`,
      );
    }
  }
  candidate = path.resolve(candidate);
  if (!isInside(root, candidate)) {
    throw new Error(`${description} escapes its runtime root: ${relativePath}`);
  }
  await requireRegularFile(candidate, description);
  const canonical = await realpath(candidate);
  if (!isInside(root, canonical)) {
    throw new Error(
      `${description} resolves outside its runtime root: ${relativePath}`,
    );
  }
  return candidate;
}

export async function readFoliateWebRuntimeManifest(runtimeRoot) {
  await requireSafeDirectory(runtimeRoot, 'Foliate Web runtime root');
  const canonicalRuntimeRoot = await realpath(runtimeRoot);
  const manifestPath = await resolveContainedFile(
    canonicalRuntimeRoot,
    WEB_RUNTIME_MANIFEST,
    'Foliate Web runtime manifest',
  );
  const contents = await readFile(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Foliate Web runtime manifest is invalid JSON: ${manifestPath}`,
      { cause: error },
    );
  }
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.runtime !== 'foliate-web' ||
    manifest.runtimeVersion !== FOLIATE_WEB_RUNTIME_VERSION ||
    !Array.isArray(manifest.assets)
  ) {
    throw new Error(
      `Foliate Web runtime manifest has an unsupported shape: ${manifestPath}`,
    );
  }
  if (
    manifest.source?.repository !== FOLIATE_SOURCE.repository ||
    manifest.source?.commit !== FOLIATE_SOURCE.commit
  ) {
    throw new Error(
      `Foliate Web runtime manifest has an unapproved Foliate source: ${manifestPath}`,
    );
  }

  const paths = new Set();
  const assetPaths = [];
  for (const asset of manifest.assets) {
    const relativePath = validateAssetPath(asset?.path);
    if (paths.has(relativePath)) {
      throw new Error(
        `Foliate Web runtime manifest repeats asset: ${relativePath}`,
      );
    }
    if (
      !Number.isSafeInteger(asset?.size) ||
      asset.size < 0 ||
      !/^[0-9a-f]{64}$/.test(asset?.sha256 ?? '') ||
      typeof asset?.source !== 'string' ||
      !asset.source
    ) {
      throw new Error(
        `Foliate Web runtime manifest has invalid metadata for: ${relativePath}`,
      );
    }
    paths.add(relativePath);
    assetPaths.push(relativePath);
  }
  if (
    assetPaths.join('\0') !== [...assetPaths].sort(codepointCompare).join('\0')
  ) {
    throw new Error(
      'Foliate Web runtime manifest assets must use codepoint path order',
    );
  }
  return {
    manifest,
    manifestPath,
    manifestContents: contents,
    runtimeRoot: canonicalRuntimeRoot,
  };
}

export async function validateFoliateWebRuntime(runtimeRoot) {
  const runtime = await readFoliateWebRuntimeManifest(runtimeRoot);
  for (const asset of runtime.manifest.assets) {
    const assetPath = await resolveContainedFile(
      runtime.runtimeRoot,
      asset.path,
      'Foliate Web runtime asset',
    );
    const contents = await readFile(assetPath);
    if (contents.length !== asset.size || sha256(contents) !== asset.sha256) {
      throw new Error(`Foliate Web runtime asset hash mismatch: ${asset.path}`);
    }
  }
  return runtime;
}

async function resolveTargetReaderRoot(targetRoot) {
  if (!targetRoot)
    throw new Error('Foliate Web runtime target root is required');
  let projectRoot;
  try {
    projectRoot = await realpath(targetRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `Foliate Web runtime target root is missing: ${targetRoot}`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
  await requireSafeDirectory(projectRoot, 'Foliate Web runtime target root');
  await requireRegularFile(
    path.join(projectRoot, 'package.json'),
    'Foliate Web runtime target package.json',
  );
  const publicRoot = path.resolve(projectRoot, 'public');
  const readerRoot = path.resolve(projectRoot, WEB_RUNTIME_PUBLIC_DIRECTORY);
  if (!isInside(projectRoot, publicRoot) || !isInside(publicRoot, readerRoot)) {
    throw new Error(
      `Foliate Web runtime target root is invalid: ${projectRoot}`,
    );
  }
  await requireSafeDirectory(
    publicRoot,
    'Foliate Web runtime public directory',
    { allowMissing: true },
  );
  await requireSafeDirectory(
    readerRoot,
    'Foliate Web runtime reader directory',
    { allowMissing: true },
  );
  return { projectRoot, publicRoot, readerRoot };
}

async function resolveContainedDestination(root, relativePath) {
  const candidate = path.resolve(root, ...relativePath.split('/'));
  if (!isInside(root, candidate)) {
    throw new Error(
      `Foliate Web runtime destination escapes reader directory: ${relativePath}`,
    );
  }
  return candidate;
}

async function listRegularFiles(root, relativePath = '') {
  const directory = path.join(root, relativePath);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    codepointCompare(left.name, right.name),
  )) {
    const nextPath = path.posix.join(relativePath, entry.name);
    const absolutePath = path.join(root, nextPath);
    const entryStat = await lstat(absolutePath);
    if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
      files.push(...(await listRegularFiles(root, nextPath)));
    } else if (entryStat.isFile() && !entryStat.isSymbolicLink()) {
      files.push(nextPath);
    } else {
      throw new Error(
        `Foliate Web runtime target contains a non-regular entry: ${nextPath}`,
      );
    }
  }
  return files;
}

/**
 * Copies only a manifest-validated runtime into a consumer's project-root
 * public/reader directory. Sibling public assets remain application-owned.
 */
export async function syncFoliateWebRuntime({ runtimeRoot, targetRoot }) {
  const runtime = await validateFoliateWebRuntime(runtimeRoot);
  const { publicRoot, readerRoot } = await resolveTargetReaderRoot(targetRoot);
  await mkdir(publicRoot, { recursive: true });
  await requireSafeDirectory(
    publicRoot,
    'Foliate Web runtime public directory',
  );
  // readerRoot was proven non-link above; this is the only cleanup scope.
  await rm(readerRoot, { recursive: true, force: true });
  await mkdir(readerRoot, { recursive: true });
  await requireSafeDirectory(
    readerRoot,
    'Foliate Web runtime reader directory',
  );

  const targetManifest = await resolveContainedDestination(
    readerRoot,
    WEB_RUNTIME_MANIFEST,
  );
  await writeFile(targetManifest, runtime.manifestContents);
  for (const asset of runtime.manifest.assets) {
    const source = await resolveContainedFile(
      runtime.runtimeRoot,
      asset.path,
      'Foliate Web runtime asset',
    );
    const destination = await resolveContainedDestination(
      readerRoot,
      asset.path,
    );
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(source));
    await requireRegularFile(destination, 'Foliate Web runtime target asset');
  }
  return { readerRoot, manifest: runtime.manifest };
}

export async function checkFoliateWebRuntime({ runtimeRoot, targetRoot }) {
  const runtime = await validateFoliateWebRuntime(runtimeRoot);
  const { readerRoot } = await resolveTargetReaderRoot(targetRoot);
  await requireSafeDirectory(
    readerRoot,
    'Foliate Web runtime reader directory',
  );

  const expected = [
    WEB_RUNTIME_MANIFEST,
    ...runtime.manifest.assets.map((asset) => asset.path),
  ].sort(codepointCompare);
  const actual = await listRegularFiles(readerRoot);
  const missing = expected.filter((asset) => !actual.includes(asset));
  if (missing.length)
    throw new Error(
      `Foliate Web runtime target is missing assets: ${missing.join(', ')}`,
    );
  const extra = actual.filter((asset) => !expected.includes(asset));
  if (extra.length)
    throw new Error(
      `Foliate Web runtime target has extra assets: ${extra.join(', ')}`,
    );

  const targetManifestPath = await resolveContainedFile(
    readerRoot,
    WEB_RUNTIME_MANIFEST,
    'Foliate Web runtime target manifest',
  );
  if (
    (await readFile(targetManifestPath, 'utf8')) !== runtime.manifestContents
  ) {
    throw new Error('Foliate Web runtime target manifest is stale');
  }
  for (const asset of runtime.manifest.assets) {
    const targetAsset = await resolveContainedFile(
      readerRoot,
      asset.path,
      'Foliate Web runtime target asset',
    );
    const contents = await readFile(targetAsset);
    if (contents.length !== asset.size || sha256(contents) !== asset.sha256) {
      throw new Error(
        `Foliate Web runtime target hash mismatch: ${asset.path}`,
      );
    }
  }
  return { readerRoot, manifest: runtime.manifest };
}

function parseCliArguments(args) {
  let check = false;
  let targetRoot;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--check') check = true;
    else if (argument === '--target') {
      const value = args[++index];
      if (!value || value.startsWith('--'))
        throw new Error('--target requires a project root');
      targetRoot = value;
    } else throw new Error(`Unknown Foliate Web runtime option: ${argument}`);
  }
  if (!targetRoot)
    throw new Error('Use --target <project-root> for Foliate Web runtime sync');
  return { check, targetRoot };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { check, targetRoot } = parseCliArguments(process.argv.slice(2));
  const runtimeRoot = path.join(packageRoot, 'foliate-runtime', 'web');
  const result = await (check ? checkFoliateWebRuntime : syncFoliateWebRuntime)(
    { runtimeRoot, targetRoot },
  );
  process.stdout.write(
    `Foliate Web runtime ${check ? 'verified' : 'synced'}: ${result.readerRoot}\n`,
  );
}
