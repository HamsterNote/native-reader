import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('native WebView payload opens an owned local EPUB through base64 to ready', async ({
  page,
}) => {
  const bytes = await readFile(
    path.resolve(process.cwd(), 'fixtures/epub/valid-epub3.epub'),
  );
  const coreModule = (relativePath: string) => {
    const overrideRoot = process.env.NATIVE_CORE_E2E_ROOT;
    return overrideRoot
      ? pathToFileURL(path.resolve(overrideRoot, relativePath)).href
      : `@epubjs-react-native/core/${relativePath}`;
  };
  const { useInjectWebVieWVariables } = await import(
    coreModule('lib/commonjs/hooks/useInjectWebviewVariables.js')
  );
  const [jszipModule, epubjsModule] = await Promise.all([
    import(coreModule('lib/commonjs/jszip.js')),
    import(coreModule('lib/commonjs/epubjs.js')),
  ]);
  const bundledSource = (module: { default: unknown }) => {
    const value = module.default as { default?: unknown };
    return String(value.default ?? value);
  };
  let inject: ((values: Record<string, unknown>) => string) | undefined;
  function Harness() {
    inject = useInjectWebVieWVariables().injectWebVieWVariables;
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));

  const html = inject?.({
    jszip:
      'data:text/javascript;base64,' +
      Buffer.from(bundledSource(jszipModule)).toString('base64'),
    epubjs:
      'data:text/javascript;base64,' +
      Buffer.from(bundledSource(epubjsModule)).toString('base64'),
    type: 'base64',
    book: bytes.toString('base64'),
    theme: {},
    enableSelection: false,
    allowScriptedContent: false,
    allowPopups: false,
    manager: 'default',
    flow: 'paginated',
    spread: 'none',
  });
  expect(html).toBeDefined();

  const instrumentedHtml = html!.replace(
    '<head>',
    `<head><script>
      window.__nativeMessages = [];
      window.ReactNativeWebView = { postMessage(message) { window.__nativeMessages.push(message); } };
    </script>`,
  );
  await page.setContent(instrumentedHtml);

  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          (Reflect.get(globalThis, '__nativeMessages') as
            string[] | undefined) ?? []
        ).map((message) => JSON.parse(message) as Record<string, unknown>),
      ),
    )
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'publicationPrepared' }),
        expect.objectContaining({ type: 'onReady' }),
      ]),
    );
  await expect.poll(() => page.locator('iframe').count()).toBeGreaterThan(0);
});
