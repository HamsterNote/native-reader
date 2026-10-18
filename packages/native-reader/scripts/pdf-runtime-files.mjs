import { createHash, randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
export const safeAssetPath = (path) =>
  typeof path === 'string' &&
  path
    .split('/')
    .every(
      (part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..',
    );
export function assertNoLinks(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink())
      throw new Error('PDF symlinks are not supported.');
    if (current !== resolve(path) && stat && !stat.isDirectory())
      throw new Error('Special PDF ancestor rejected.');
    if (dirname(current) === current) break;
  }
}
export function readAsset(path) {
  assertNoLinks(path);
  if (!lstatSync(path).isFile())
    throw new Error('Special PDF source entry rejected.');
  return readFileSync(path);
}
export function walkAssets(base, prefix = '') {
  assertNoLinks(base);
  const stat = lstatSync(base, { throwIfNoEntry: false });
  if (!stat) return [];
  if (!stat.isDirectory()) throw new Error('Special PDF directory rejected.');
  return readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix + entry.name;
    if (entry.isDirectory())
      return [path + '/', ...walkAssets(join(base, entry.name), path + '/')];
    if (!entry.isFile()) throw new Error('Special PDF runtime entry rejected.');
    return [path];
  });
}
export function assertOwnedTree(target, files) {
  const allowed = new Set(files.keys());
  for (const name of files.keys()) {
    for (let parent = dirname(name); parent !== '.'; parent = dirname(parent))
      allowed.add(parent.replaceAll('\\', '/') + '/');
  }
  for (const path of walkAssets(target))
    if (!allowed.has(path))
      throw new Error('Unexpected PDF runtime target entry.');
}
export function writeAssets(target, files, check) {
  assertNoLinks(target);
  assertOwnedTree(target, files);
  // The caller owns the target exclusively; concurrent writers are outside
  // this CLI contract. Preflight the full tree before the first write.
  for (const name of files.keys()) assertNoLinks(join(target, name));
  for (const [name, bytes] of files) {
    const path = join(target, name);
    if (check) {
      if (
        !lstatSync(path, { throwIfNoEntry: false })?.isFile() ||
        !readAsset(path).equals(bytes)
      )
        throw new Error(`PDF runtime target mismatch: ${name}`);
    } else {
      mkdirSync(dirname(path), { recursive: true });
      const temporary = join(dirname(path), `.pdf-${randomUUID()}`);
      try {
        writeFileSync(temporary, bytes, { flag: 'wx' });
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
  }
}
export function parseArgs(args, requireTarget = false) {
  let target;
  let check = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check') check = true;
    else if (
      args[index] === '--target' &&
      args[index + 1] &&
      !args[index + 1].startsWith('--')
    )
      target = resolve(args[++index]);
    else throw new Error(`Unsupported PDF argument: ${args[index]}`);
  }
  if (requireTarget && !target)
    throw new Error('Pass --target <consumer-public-directory>.');
  return { target, check };
}
