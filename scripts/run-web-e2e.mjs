import { createRequire } from 'node:module';
import { runFoliateGated } from './run-foliate-gated.mjs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
await runFoliateGated({
  command: process.execPath,
  args: [require.resolve('@playwright/test/cli'), 'test', ...args],
});
