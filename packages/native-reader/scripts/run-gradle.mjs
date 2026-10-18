import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [directory, ...gradleArgs] = process.argv.slice(2);

if (!directory || gradleArgs.length === 0) {
  throw new Error(
    'Usage: node scripts/run-gradle.mjs <directory> <gradle arguments...>',
  );
}
if (path.isAbsolute(directory) || directory.split(/[\\/]/).includes('..')) {
  throw new Error(
    `Gradle directory must stay within the package root: ${directory}`,
  );
}

const cwd = path.join(packageRoot, directory);
const command = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
console.log(`> ${command} ${gradleArgs.join(' ')}`);
execFileSync(command, gradleArgs, { cwd, stdio: 'inherit' });
