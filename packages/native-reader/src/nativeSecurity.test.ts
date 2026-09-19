import { readFileSync } from 'node:fs';
import React from 'react';

const { renderToStaticMarkup } = jest.requireActual('react-dom/server') as {
  renderToStaticMarkup(element: React.ReactNode): string;
};

const corePackage = JSON.parse(
  readFileSync(
    require.resolve('@epubjs-react-native/core/package.json'),
    'utf8',
  ),
) as { main: string; module: string; 'react-native': string };

function coreFile(build: 'commonjs' | 'module', file: string): string {
  return readFileSync(
    require.resolve(`@epubjs-react-native/core/lib/${build}/${file}`),
    'utf8',
  );
}

const runtimeBuilds = ['commonjs', 'module'] as const;

test('patched CommonJS is the actual React Native and Metro package entry', () => {
  expect(corePackage.main).toBe('lib/commonjs/index');
  expect(corePackage['react-native']).toBe('lib/commonjs/index');
  expect(corePackage.module).toBe('lib/module/index');
  expect(require.resolve('@epubjs-react-native/core')).toContain(
    '/lib/commonjs/index.js',
  );
});

test('native navigation serializes an adversarial TOC href as data', () => {
  const contexts = runtimeBuilds.map((build) => coreFile(build, 'context.js'));
  const maliciousHref = `chapter');\\line\n</script><script>globalThis.__EPUB_TOC_EXECUTED__=true;//`;
  const serialized = JSON.stringify(maliciousHref).replace(/</g, '\\u003c');
  const generatedScript = `rendition.display(${serialized}); true`;

  for (const context of contexts) {
    expect(context).toContain(
      'const serializedTarget = JSON.stringify(targetCfi)',
    );
    expect(context).not.toContain("rendition.display('${targetCfi}')");
  }
  expect(generatedScript).not.toContain('</script>');
  expect(generatedScript).toContain('\\u003c/script>');
  expect(generatedScript).toContain('\\\\line\\n');
});

test('native template serializes source URI and every injected value as data', () => {
  for (const build of runtimeBuilds) {
    const injection = coreFile(build, 'hooks/useInjectWebviewVariables.js');
    expect(injection).toContain("JSON.stringify(value) ?? 'undefined'");
    expect(injection).toContain('const htmlAttribute = value => String(value)');
    expect(injection).toContain('const file = ${scriptData(book)};');
    expect(injection).not.toContain("const file = '${book}';");
  }
});

test('native template executes with omitted optional Reader values', () => {
  const { useInjectWebVieWVariables } = jest.requireActual(
    '@epubjs-react-native/core/lib/commonjs/hooks/useInjectWebviewVariables.js',
  ) as {
    useInjectWebVieWVariables(): {
      injectWebVieWVariables(values: Record<string, unknown>): string;
    };
  };
  let inject: ((values: Record<string, unknown>) => string) | undefined;
  function Harness() {
    inject = useInjectWebVieWVariables().injectWebVieWVariables;
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));

  const html = inject?.({
    jszip: 'file:///jszip.js',
    epubjs: 'file:///epub.js',
    type: 'epub',
    book: 'file:///book.epub',
    theme: {},
    enableSelection: false,
    allowScriptedContent: false,
    allowPopups: false,
    manager: 'default',
    flow: 'paginated',
    spread: 'none',
  });
  expect(html).toContain('const initialLocations = undefined;');
  expect(html).toContain('snap: undefined');
  expect(html).toContain('fullsize: undefined');

  for (const build of runtimeBuilds) {
    const source = coreFile(build, 'hooks/useInjectWebviewVariables.js');
    const expression = source.match(
      /const scriptData = (value => .*?);\n/,
    )?.[1];
    expect(expression).toBeDefined();
    const scriptData = Function(`return (${expression})`)() as (
      value: unknown,
    ) => string;
    expect(scriptData(undefined)).toBe('undefined');
    expect(scriptData('</script>')).toBe('"\\u003c/script>"');
  }
});

test('native WebView denies network origins and unsafe file access', () => {
  for (const build of runtimeBuilds) {
    const view = coreFile(build, 'View.js');
    const reader = coreFile(build, 'Reader.js');
    expect(view).toContain("originWhitelist: ['file://*', 'about:blank']");
    expect(view).toContain('mixedContentMode: "never"');
    expect(view).toContain('allowUniversalAccessFromFileURLs: false');
    expect(view).toContain('allowFileAccessFromFileURLs: false');
    expect(view).toContain('javaScriptCanOpenWindowsAutomatically: false');
    expect(view).toContain('if (!isLocal) return false');
    expect(view).toContain(
      "decodedUrl.startsWith(`${allowedUris.replace(/\\/$/, '')}/`)",
    );
    expect(view).toContain('decodeURIComponent(request.url)');
    expect(view).toContain('allowingReadAccessToURL: allowedUris');
    expect(reader).toContain('setAllowedUris(documentDirectory)');
    expect(reader).not.toContain('setAllowedUris(`${src}');
    expect(view).not.toContain("originWhitelist: ['*']");
    expect(view).not.toContain('allowUniversalAccessFromFileURLs: true');
    expect(view).not.toContain('allowFileAccessFromFileURLs: true');
  }
});

test('native publication template blocks adversarial resource forms', () => {
  for (const build of runtimeBuilds) {
    const template = coreFile(build, 'template.js');
    for (const selector of [
      '[src]',
      '[href]',
      '[xlink\\\\:href]',
      '[data]',
      '[poster]',
      '[srcset]',
      '[style]',
    ]) {
      expect(template).toContain(selector);
    }
    expect(template).toContain("document.querySelectorAll('style')");
    expect(template).toContain('@import');
    expect(template).toContain("else section.output = '<head>' + csp");
    expect(template).toContain('meta[http-equiv="refresh" i]');
    expect(template).toContain(
      'rendition.hooks.content.register(secureContents)',
    );
    expect(template).toContain('err && err.message');
    expect(template).not.toContain('reason: reason');
  }
});
