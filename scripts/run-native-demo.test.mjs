import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import {
  assertPortAvailable,
  expoArguments,
  runNativeDemo,
} from './run-native-demo.mjs';

test('native entry fixes LAN/client mode and forwards exactly one requested port', () => {
  for (const [args, port] of [
    [[], '8081'],
    [['--port', '18738'], '18738'],
    [['--port=18738'], '18738'],
  ]) {
    assert.deepEqual(expoArguments('start', args), [
      'start',
      '--dev-client',
      '--lan',
      '--port',
      port,
    ]);
  }
  for (const args of [
    ['--port', '0'],
    ['--port', '65536'],
    ['--port', 'auto'],
    ['--port', '8081', '--port', '18738'],
  ]) {
    assert.throws(() => expoArguments('start', args));
  }
  for (const mode of ['ios', 'android']) {
    assert.deepEqual(expoArguments(mode, []), [
      `run:${mode}`,
      '--device',
      '--no-bundler',
    ]);
  }
});

test('prepare failure exits nonzero without starting Expo or checking a port', async () => {
  const calls = [];
  const status = await runNativeDemo({
    mode: 'start',
    run: (...args) => {
      calls.push(args);
      return { status: 7 };
    },
    checkPort: () => assert.fail('must not check port'),
  });
  assert.equal(status, 7);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['pnpm', ['run', 'native:prepare']]);
});

test('occupied port fails without launching or reusing another Metro', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  try {
    let calls = 0;
    await assert.rejects(
      runNativeDemo({
        mode: 'start',
        args: ['--port', String(server.address().port)],
        run: () => {
          calls++;
          return { status: 0 };
        },
      }),
      /unavailable.*--port/,
    );
    assert.equal(calls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('successful prepare precedes Expo; startup refuses interactive port changes', async () => {
  const calls = [];
  assert.equal(
    await runNativeDemo({
      mode: 'start',
      args: ['--port', '18738'],
      run: (...args) => {
        calls.push(args);
        return { status: calls.length === 1 ? 0 : 3 };
      },
      checkPort: async (port) => {
        assert.equal(calls.length, 1);
        assert.equal(port, 18738);
      },
    }),
    3,
  );
  assert.deepEqual(calls[1][2].stdio, ['inherit', 'pipe', 'inherit']);
  assert.equal(calls[1][2].env.CI, process.env.CI);
  assert.ok(calls[1][2].env.REACT_NATIVE_PACKAGER_HOSTNAME);
  assert.deepEqual(calls[1][1].slice(-5), [
    'start',
    '--dev-client',
    '--lan',
    '--port',
    '18738',
  ]);
});

test('a released TCP port passes the real availability check', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  await assertPortAvailable(port);
});
