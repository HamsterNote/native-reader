import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const destination = path.join(
  packageRoot,
  'node_modules/@epubjs-react-native/core',
);

if (process.argv.includes('--clean')) {
  await rm(path.join(packageRoot, 'node_modules'), {
    recursive: true,
    force: true,
  });
} else {
  const sourcePackage = await import.meta
    .resolve('@epubjs-react-native/core/package.json');
  const source = path.dirname(fileURLToPath(sourcePackage));
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}
