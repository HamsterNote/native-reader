import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateFoliateWebRuntime } from '../packages/native-reader/scripts/sync-foliate-web-runtime.mjs';

const sha256 = (contents) =>
  createHash('sha256').update(contents).digest('hex');

const parseArguments = (args) => {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!['--source-reader', '--export-reader'].includes(flag)) {
      throw new Error(`Unknown Foliate Web export option: ${flag}`);
    }
    const value = args[++index];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a directory`);
    }
    options[flag] = path.resolve(value);
  }
  if (!options['--source-reader'] || !options['--export-reader']) {
    throw new Error(
      'Use --source-reader <public-reader-or-package-runtime> --export-reader <dist-reader>',
    );
  }
  return {
    exportReader: options['--export-reader'],
    sourceReader: options['--source-reader'],
  };
};

async function listRegularFiles(root, relative = '') {
  const directory = path.join(root, relative);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `Foliate Web export reader directory is missing: ${root}`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, 'en'),
  )) {
    const next = path.posix.join(relative, entry.name);
    const entryPath = path.join(root, next);
    const stat = await lstat(entryPath);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      files.push(...(await listRegularFiles(root, next)));
    } else if (stat.isFile() && !stat.isSymbolicLink()) {
      files.push(next);
    } else {
      throw new Error(
        `Foliate Web export contains a non-regular entry: ${next}`,
      );
    }
  }
  return files.sort();
}

export async function verifyFoliateWebExport({ sourceReader, exportReader }) {
  const runtime = await validateFoliateWebRuntime(sourceReader);
  const expected = [
    'manifest.json',
    ...runtime.manifest.assets.map(({ path }) => path),
  ].sort();
  const actual = await listRegularFiles(exportReader);
  const missing = expected.filter((file) => !actual.includes(file));
  if (missing.length) {
    throw new Error(
      `Foliate Web export is missing assets: ${missing.join(', ')}. Run the consumer runtime sync before Expo export.`,
    );
  }
  const extra = actual.filter((file) => !expected.includes(file));
  if (extra.length) {
    throw new Error(
      `Foliate Web export has extra assets: ${extra.join(', ')}. Clean or resync public/reader before Expo export.`,
    );
  }
  const exportManifest = await readFile(
    path.join(exportReader, 'manifest.json'),
    'utf8',
  );
  if (exportManifest !== runtime.manifestContents) {
    throw new Error(
      'Foliate Web export manifest is stale. Run the consumer runtime sync before Expo export.',
    );
  }
  for (const asset of runtime.manifest.assets) {
    const contents = await readFile(path.join(exportReader, asset.path));
    if (contents.length !== asset.size || sha256(contents) !== asset.sha256) {
      throw new Error(
        `Foliate Web export asset hash mismatch: ${asset.path}. Run the consumer runtime sync before Expo export.`,
      );
    }
  }
  return { assets: runtime.manifest.assets.length, exportReader };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const result = await verifyFoliateWebExport(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(
    `Foliate Web export verified: ${result.exportReader} (${result.assets} manifest assets).\n`,
  );
}
