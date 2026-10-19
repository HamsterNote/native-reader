import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const require = createRequire(import.meta.url);

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.stdout?.pipe(process.stdout);
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    child.once('error', reject);
    child.once('close', (status) => {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
      resolve({ status: status ?? 1 });
    });
  });
}

export function expoArguments(mode, args) {
  if (mode === 'ios' || mode === 'android') {
    if (args.length)
      throw new Error(`native:${mode} does not accept extra arguments`);
    return [`run:${mode}`, '--device', '--no-bundler'];
  }
  if (mode !== 'start') throw new Error('Expected start, ios or android');
  let port = '8081';
  if (args.length) {
    if (args.length === 2 && args[0] === '--port') port = args[1];
    else if (args.length === 1 && args[0].startsWith('--port='))
      port = args[0].slice('--port='.length);
    else throw new Error('Usage: pnpm run dev:native [--port 18738]');
  }
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('Metro port must be an integer from 1 to 65535');
  return ['start', '--dev-client', '--lan', '--port', String(Number(port))];
}

export async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () =>
      reject(
        new Error(
          `Metro port ${port} is unavailable; stop its owner or use --port <free-port>`,
        ),
      ),
    );
    server.listen({ host: '0.0.0.0', port, exclusive: true }, () =>
      server.close(resolve),
    );
  });
}

export async function runNativeDemo({
  mode,
  args = [],
  run = runCommand,
  checkPort = assertPortAvailable,
} = {}) {
  const expoArgs = expoArguments(mode, args);
  const options = {
    cwd: workspace,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  };
  const prepare = await run('pnpm', ['run', 'native:prepare'], options);
  if (prepare.error) throw prepare.error;
  if (prepare.status !== 0) return prepare.status ?? 1;
  let env = process.env;
  if (mode === 'start') {
    const port = Number(expoArgs.at(-1));
    await checkPort(port);
    const hostname =
      process.env.REACT_NATIVE_PACKAGER_HOSTNAME?.trim() ||
      Object.values(networkInterfaces())
        .flat()
        .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address;
    if (!hostname)
      throw new Error(
        'No LAN IPv4 found; set REACT_NATIVE_PACKAGER_HOSTNAME to a reachable host address',
      );
    env = { ...process.env, REACT_NATIVE_PACKAGER_HOSTNAME: hostname };
    const server = `http://${hostname}:${port}`;
    console.log(`Requested development server: ${server}`);
    console.log(
      `Open installed client: native-reader-demo://expo-development-client/?url=${encodeURIComponent(server)}`,
    );
  }
  const result = await run(
    process.execPath,
    [
      path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli'),
      ...expoArgs,
    ],
    {
      ...options,
      cwd: path.join(workspace, 'apps/demo'),
      shell: false,
      env,
      // Non-TTY output prevents alternate-port prompts without disabling
      // Metro's file watching and Fast Refresh through CI mode.
      stdio: mode === 'start' ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runNativeDemo({
      mode: process.argv[2],
      args: process.argv.slice(3),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
