import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assertPortAvailable, expoArguments } from './run-native-demo.mjs';

export async function verifyNativeDevBundles(baseURL, fetchBundle = fetch) {
  const results = [];
  for (const platform of ['ios', 'android']) {
    for (const entry of ['apps/demo/index.ts', 'apps/demo/src/DemoApp.tsx']) {
      const url = new URL(`${entry}.bundle`, `${baseURL}/`);
      url.searchParams.set('platform', platform);
      url.searchParams.set('dev', 'true');
      if (entry === 'apps/demo/index.ts') url.searchParams.set('lazy', 'false');
      const response = await fetchBundle(url, {
        signal: AbortSignal.timeout(60000),
      });
      const bundle = await response.text();
      assert.equal(
        response.status,
        200,
        `${url}: HTTP ${response.status}\n${bundle.slice(0, 1000)}`,
      );
      assert.match(
        response.headers.get('content-type') ?? '',
        /(?:application|text)\/javascript/,
        `${url}: expected JavaScript`,
      );
      assert.ok(
        bundle.includes('NativeReaderImplementation'),
        `${url}: missing NativeReaderImplementation`,
      );
      results.push({
        url: url.href,
        status: response.status,
        bytes: Buffer.byteLength(bundle),
        implementationPresent: true,
      });
    }
  }
  return results;
}

async function smokeNativeDemo(args) {
  await mkdir('test-results', { recursive: true });
  const ports = args.length
    ? [Number(expoArguments('start', args).at(-1))]
    : [8081, 18738];
  for (const port of ports) {
    try {
      await assertPortAvailable(port);
    } catch (error) {
      console.error(`SKIP readiness on ${port}: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    const args = [
      'run',
      'dev:native',
      ...(port === 8081 ? [] : ['--port', String(port)]),
    ];
    const child = spawn('pnpm', args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    let exited = false;
    child.on('exit', () => {
      exited = true;
    });
    child.stdout.on('data', (data) => {
      log += data;
    });
    child.stderr.on('data', (data) => {
      log += data;
    });
    const closed = once(child, 'close');
    try {
      const deadline = Date.now() + 60000;
      let ready = false;
      while (Date.now() < deadline && !exited) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/status`, {
            signal: AbortSignal.timeout(1000),
          });
          if ((await response.text()) === 'packager-status:running') {
            ready = true;
            break;
          }
        } catch {
          /* Metro is still starting. */
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.ok(ready, `Metro ${port} failed readiness:\n${log}`);
      const address =
        process.env.REACT_NATIVE_PACKAGER_HOSTNAME ||
        Object.values(networkInterfaces())
          .flat()
          .find((entry) => entry?.family === 'IPv4' && !entry.internal)
          ?.address;
      assert.ok(address, 'Expected LAN IPv4');
      const response = await fetch(`http://${address}:${port}/`, {
        headers: { 'expo-platform': 'ios', accept: 'application/expo+json' },
      });
      assert.equal(response.status, 200);
      const manifest = await response.json();
      const host = manifest.extra.expoClient.hostUri;
      assert.ok(host.endsWith(`:${port}`), host);
      assert.ok(
        !host.startsWith('localhost:') && !host.startsWith('127.0.0.1:'),
        host,
      );
      assert.ok(manifest.launchAsset.url.includes(`:${port}/`));
      assert.ok(!log.includes('reloads are disabled'));
      const bundles = await verifyNativeDevBundles(`http://${address}:${port}`);
      await writeFile(
        `test-results/native-dev-bundles-${port}.json`,
        JSON.stringify(bundles, null, 2),
      );
      for (const bundle of bundles)
        console.log(
          `${bundle.url}: HTTP ${bundle.status}, ${bundle.bytes} bytes, NativeReaderImplementation present`,
        );
      console.log(
        `pnpm ${args.join(' ')}: Metro ready, LAN host ${host}, bundle URL ${manifest.launchAsset.url}`,
      );
    } finally {
      // This group belongs only to the pnpm child started above.
      if (!exited) process.kill(-child.pid, 'SIGINT');
      const forceStop = setTimeout(() => {
        if (!exited) process.kill(-child.pid, 'SIGKILL');
      }, 10000);
      await closed;
      clearTimeout(forceStop);
      await writeFile(`test-results/native-metro-${port}.log`, log);
      await assertPortAvailable(port);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await smokeNativeDemo(process.argv.slice(2));
}
