import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const requirePath = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required and must be a non-empty path`);
  }
  if (process.platform === 'win32' && /^[a-z]:(?:$|[^\\/])/i.test(value)) {
    throw new Error(`${label} must not use a drive-relative Windows path`);
  }
  return value;
};

// Windows 的 realpath 可能保留不同 drive/case 拼写；比较前统一大小写，
// 但返回值仍保留 realpath 原值。POSIX 文件名则必须保持大小写敏感。
const comparisonPath = (value) =>
  process.platform === 'win32' ? value.toLowerCase() : value;
const isWithin = (candidate, root) => {
  const relative = path.relative(
    comparisonPath(root),
    comparisonPath(candidate),
  );
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

const existingEntry = async (target) => {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
};

const rejectLink = (entry, target) => {
  // Node 的 Windows junction 也由 lstat().isSymbolicLink() 标识。
  if (entry?.isSymbolicLink()) {
    throw new Error(
      `Unsafe staging path contains a symlink/junction: ${target}`,
    );
  }
};

const assertNoLinkedComponents = async (target) => {
  // 不先 normalize：link/../output 中 link 仍是现存组件，不能被 path.resolve
  // 折叠掉后漏查。authority 的 realpath 同样必须按原始组件解析。
  const absolute = path.isAbsolute(target)
    ? target
    : `${process.cwd()}${path.sep}${target}`;
  const { root } = path.parse(absolute);
  let current = root;
  for (const component of absolute
    .slice(root.length)
    .split(process.platform === 'win32' ? /[\\/]+/ : /\/+/)
    .filter(Boolean)) {
    current = `${current}${current.endsWith(path.sep) ? '' : path.sep}${component}`;
    const entry = await existingEntry(current);
    if (!entry) break;
    rejectLink(entry, current);
  }
};

const assertNoLinkedTree = async (target) => {
  const entry = await existingEntry(target);
  if (!entry) return;
  rejectLink(entry, target);
  // 不跟随链接，包括隐藏文件、已标记 generated 的目录内的链接。
  // 仅检查可变子树；不会递归读取 authority，也不会修改任何路径。
  if (entry.isDirectory()) {
    for (const name of await readdir(target)) {
      await assertNoLinkedTree(path.join(target, name));
    }
  }
};

/**
 * 删除/写入前的只读安全屏障。output 必须是已存在的真目录，且与每个
 * authority 的 canonical 路径完全隔离；authority 允许同源别名。
 * mutablePaths 可为 output 内的相对/绝对路径，检查所有现存组件及子树。
 * 不保证对恶意并发换链的原子性：调用方必须独占 staging 目录。
 */
export async function assertSafeStagingPaths({
  outputRoot,
  authorityRoots,
  mutablePaths = [],
} = {}) {
  const lexicalOutput = path.resolve(requirePath(outputRoot, 'outputRoot'));
  if (!Array.isArray(authorityRoots) || authorityRoots.length === 0) {
    throw new Error('authorityRoots is required and must be a non-empty array');
  }
  if (!Array.isArray(mutablePaths)) {
    throw new Error('mutablePaths must be an array');
  }
  // realpath 本身会跟随链接，因此必须先拒绝输出路径的链接组件。
  await assertNoLinkedComponents(outputRoot);
  await assertNoLinkedComponents(lexicalOutput);
  const outputEntry = await lstat(outputRoot);
  if (!outputEntry.isDirectory() || outputEntry.isSymbolicLink()) {
    throw new Error('outputRoot must be an existing non-symlink directory');
  }
  const canonicalOutput = await realpath(outputRoot);
  const canonicalAuthorities = await Promise.all(
    authorityRoots.map(async (root, index) => {
      const canonical = await realpath(
        requirePath(root, `authorityRoots[${index}]`),
      );
      if (!(await stat(canonical)).isDirectory()) {
        throw new Error(
          `authorityRoots[${index}] must identify an existing directory`,
        );
      }
      return canonical;
    }),
  );
  for (const authority of canonicalAuthorities) {
    if (
      isWithin(canonicalOutput, authority) ||
      isWithin(authority, canonicalOutput)
    ) {
      throw new Error(
        `Unsafe staging output overlaps authority: ${canonicalOutput} <> ${authority}`,
      );
    }
  }
  for (const mutable of mutablePaths) {
    requirePath(mutable, 'mutablePaths entry');
    const target = path.resolve(lexicalOutput, mutable);
    if (!isWithin(target, lexicalOutput)) {
      throw new Error(`Mutable staging path escaped outputRoot: ${mutable}`);
    }
    await assertNoLinkedComponents(
      path.isAbsolute(mutable)
        ? mutable
        : `${lexicalOutput}${path.sep}${mutable}`,
    );
    await assertNoLinkedComponents(target);
    await assertNoLinkedTree(target);
  }
  return { outputRoot: canonicalOutput, authorityRoots: canonicalAuthorities };
}
