import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyNativeDevBundles } from './smoke-native-demo.mjs';

test('requests both complete dev entry graphs and Demo subgraphs on both platforms', async () => {
  const urls = [];
  const results = await verifyNativeDevBundles(
    'http://192.0.2.1:18739',
    async (url) => {
      urls.push(url);
      return new Response('function NativeReaderImplementation() {}', {
        headers: { 'content-type': 'application/javascript; charset=UTF-8' },
      });
    },
  );
  assert.equal(results.length, 4);
  assert.deepEqual(
    urls.map((url) => url.searchParams.get('platform')),
    ['ios', 'ios', 'android', 'android'],
  );
  assert.deepEqual(
    urls.map((url) => url.pathname),
    [
      '/apps/demo/index.ts.bundle',
      '/apps/demo/src/DemoApp.tsx.bundle',
      '/apps/demo/index.ts.bundle',
      '/apps/demo/src/DemoApp.tsx.bundle',
    ],
  );
  for (const url of urls) {
    assert.equal(url.searchParams.get('dev'), 'true');
    if (url.pathname.endsWith('/index.ts.bundle'))
      assert.equal(url.searchParams.get('lazy'), 'false');
  }
});

test('rejects Metro TransformError instead of accepting readiness or a lazy entry URL', async () => {
  await assert.rejects(
    verifyNativeDevBundles(
      'http://localhost:18739',
      async () =>
        new Response(
          JSON.stringify({
            type: 'TransformError',
            message: 'NativeReaderImplementation.native.tsx: Invalid call',
          }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        ),
    ),
    /HTTP 500.*\n.*TransformError/,
  );
});

test('requires the reader implementation in each platform subgraph', async () => {
  let requests = 0;
  await assert.rejects(
    verifyNativeDevBundles(
      'http://localhost:18739',
      async () =>
        new Response(
          ++requests === 4 ? 'unrelated module' : 'NativeReaderImplementation',
          { headers: { 'content-type': 'application/javascript' } },
        ),
    ),
    /missing NativeReaderImplementation/,
  );
  assert.equal(requests, 4);
});

test('rejects non-JavaScript success responses', async () => {
  await assert.rejects(
    verifyNativeDevBundles(
      'http://localhost:18739',
      async () =>
        new Response('NativeReaderImplementation', {
          headers: { 'content-type': 'text/html' },
        }),
    ),
    /expected JavaScript/,
  );
});
