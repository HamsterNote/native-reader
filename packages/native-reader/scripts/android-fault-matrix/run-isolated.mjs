import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, cacheRoot] = process.argv.slice(2);
if (!workspace || !cacheRoot || process.argv.length !== 4)
  throw new Error('Expected workspace and empty cache parent');
const packageRoot = path.join(workspace, 'packages/native-reader');
const { runIsolatedAndroidFaultMatrix } = await import(
  pathToFileURL(
    path.join(packageRoot, 'scripts/run-android-fault-matrix-isolated.mjs'),
  )
);
// Invoke the production API with path inputs only, without function injection.
const result = await runIsolatedAndroidFaultMatrix({
  packageRoot,
  workspaceRoot: workspace,
  cacheRoot,
});
console.log(JSON.stringify(result, null, 2));
