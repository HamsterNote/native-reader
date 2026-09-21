import { readFileSync } from 'node:fs';
import React from 'react';

import {
  buildSpine,
  validatePublication,
  validatePublicationProfile,
  type PublicationPreparedEvent,
  type PublicationProfile,
} from './shared';

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

type RuntimeBuild = (typeof runtimeBuilds)[number];

type NativeRequest = {
  url: string;
  mainDocumentURL?: string;
  isTopFrame?: unknown;
  hasTargetFrame?: unknown;
};

type NativeUrlPolicy = {
  safeElementUrl(
    elementName: string,
    attributeName: string,
    value: string,
  ): boolean;
  safePublicationNavigationUrl(value: string): boolean;
  safePublicationResourceUrl(value: string): boolean;
  sanitizeCss(value: string): string;
  secureContents(contents: { document: unknown }): void;
};

type NativeProfileRuntime = {
  collectPublicationProfile(
    packagePath: string,
    spine: Array<{
      engineIndex: number;
      properties: string[];
    }>,
    manifestEntries: Array<[string, Record<string, unknown>]>,
  ): Promise<PublicationProfile>;
  validatePublicationProfile(
    profile: PublicationProfile,
    engineIndices: number[],
  ): 'INVALID_EPUB' | 'UNSUPPORTED_EPUB' | undefined;
};

type NativeArchiveRuntime = {
  normalizeArchivePath(href: string, base?: string): string | undefined;
  normalizeCanonicalArchivePath(path: string): string | undefined;
  resolvePublicationPackagePath(
    book: unknown,
  ): { packagePath: string; packageRequestPath: string } | undefined;
  normalizePublicationTarget(
    href: string,
    base?: string,
  ): { document: string; fragment?: string } | undefined;
};

function runtimeTemplate(build: RuntimeBuild): string {
  const source = coreFile(build, 'template.js');
  const expression =
    build === 'commonjs'
      ? source.match(/exports\.default = `([\s\S]*)`;\s*$/)?.[1]
      : source.match(/export default `([\s\S]*)`;\s*$/)?.[1];
  expect(expression).toBeDefined();
  return Function(
    'webViewJavaScriptFunctions',
    `return \`${expression ?? ''}\`;`,
  )({ mapObjectToAnnotation: () => 'null' }) as string;
}

function requestHandlerBody(build: RuntimeBuild): string {
  const body = coreFile(build, 'View.js').match(
    /const handleOnShouldStartLoadWithRequest = request => \{([\s\S]*?)\n  \};/,
  )?.[1];
  expect(body).toBeDefined();
  return body ?? '';
}

function requestHandler(
  build: RuntimeBuild,
  isRendering: boolean,
  goToLocation: jest.Mock,
): (request: NativeRequest) => boolean {
  const body = requestHandlerBody(build);
  const directory = 'file:///cache/native-reader-session';
  return Function(
    'allowedUris',
    'templateUri',
    'isRendering',
    'goToLocation',
    `return request => {${body}\n}`,
  )(directory, `${directory}/index.html`, isRendering, goToLocation) as (
    request: NativeRequest,
  ) => boolean;
}

function nativeUrlPolicy(build: RuntimeBuild): NativeUrlPolicy {
  const template = runtimeTemplate(build);
  const urlFunctions = template.match(
    /(const MAX_PERCENT_DECODE_DEPTH = 8;[\s\S]*?)(?=\n\s*function normalizeArchivePath)/,
  )?.[1];
  const sanitizeCssBody = template.match(
    /function sanitizeCss\(css\) \{([\s\S]*?)\n\s*\}\n\s*function secureMarkup/,
  )?.[1];
  const secureContentsBody = template.match(
    /function secureContents\(contents\) \{([\s\S]*?)\n\s*\}\n\s*book\.spine\.hooks/,
  )?.[1];
  expect(urlFunctions).toBeDefined();
  expect(sanitizeCssBody).toBeDefined();
  expect(secureContentsBody).toBeDefined();

  const policy = Function(
    `${urlFunctions ?? ''}
     const sanitizeCss = function (css) {${sanitizeCssBody ?? ''}
     };
     return {
       safeElementUrl,
       safePublicationNavigationUrl,
       safePublicationResourceUrl,
       sanitizeCss
     };`,
  )() as Omit<NativeUrlPolicy, 'secureContents'>;
  const rendererWindow: { open?: () => null } = {};
  const secureContents = Function(
    'safeElementUrl',
    'safePublicationNavigationUrl',
    'safePublicationResourceUrl',
    'sanitizeCss',
    'window',
    `return function secureContents(contents) {${secureContentsBody ?? ''}
     };`,
  )(
    policy.safeElementUrl,
    policy.safePublicationNavigationUrl,
    policy.safePublicationResourceUrl,
    policy.sanitizeCss,
    rendererWindow,
  ) as NativeUrlPolicy['secureContents'];
  return { ...policy, secureContents };
}

function nativeProfileRuntime(
  build: RuntimeBuild,
  book: Record<string, unknown>,
): NativeProfileRuntime {
  const template = runtimeTemplate(build);
  const profileFunctions = template.match(
    /(function malformedXml\(document\) \{[\s\S]*?)(?=\n\s*\/\/ TOC targets)/,
  )?.[1];
  expect(profileFunctions).toBeDefined();
  return Function(
    'book',
    `${profileFunctions ?? ''}
     return { collectPublicationProfile, validatePublicationProfile };`,
  )(book) as NativeProfileRuntime;
}

function nativeArchiveRuntime(build: RuntimeBuild): NativeArchiveRuntime {
  const template = runtimeTemplate(build);
  const archiveFunctions = template.match(
    /(const MAX_PERCENT_DECODE_DEPTH = 8;[\s\S]*?)(?=\n\s*function malformedXml)/,
  )?.[1];
  expect(archiveFunctions).toBeDefined();
  return Function(
    `${archiveFunctions ?? ''}
     return {
       normalizeArchivePath,
       normalizeCanonicalArchivePath,
       resolvePublicationPackagePath,
       normalizePublicationTarget
     };`,
  )() as NativeArchiveRuntime;
}

function profile(
  overrides: Partial<PublicationProfile> = {},
): PublicationProfile {
  return {
    packageLayouts: [],
    spineLayouts: [],
    iBooksDisplayOptions: { state: 'absent' },
    mediaOverlayItemIds: [],
    encryption: { state: 'absent' },
    ...overrides,
  };
}

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
      "serializedTarget = JSON.stringify(targetCfi) ?? 'null'",
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
    // 允许所有 scheme 先进入我们的 fail-closed handler，避免
    // react-native-webview 在 handler 之前调用 Linking.openURL。
    expect(view).toContain("originWhitelist: ['*']");
    expect(view).toContain('mixedContentMode: "never"');
    expect(view).toContain('allowUniversalAccessFromFileURLs: false');
    expect(view).toContain('allowFileAccessFromFileURLs: false');
    expect(view).toContain('javaScriptCanOpenWindowsAutomatically: false');
    expect(view).toContain(
      "const controlledDocumentUrl = `${allowedUris.replace(/\\/$/, '')}/index.html`",
    );
    expect(view).toContain('templateUri !== controlledDocumentUrl');
    expect(view).not.toContain('decodeURIComponent(request.url)');
    expect(view).toContain('allowingReadAccessToURL: allowedUris');
    expect(reader).toContain('setAllowedUris(documentDirectory)');
    expect(reader).not.toContain('setAllowedUris(`${src}');
    expect(view).not.toContain("originWhitelist: ['file://*', 'about:blank']");
    expect(view).not.toContain('allowUniversalAccessFromFileURLs: true');
    expect(view).not.toContain('allowFileAccessFromFileURLs: true');
  }
});

test('CommonJS and ESM request handlers stay behaviorally identical', () => {
  expect(requestHandlerBody('commonjs')).toBe(requestHandlerBody('module'));
});

test.each(runtimeBuilds)(
  'executes the patched %s frame-aware request matrix',
  (build) => {
    const sessionDirectory = 'file:///cache/native-reader-session';
    const controlledDocument = `${sessionDirectory}/index.html`;
    const goToLocation = jest.fn();
    const handler = requestHandler(build, false, goToLocation);

    // iOS 必须同时提供两个 boolean frame flags；mainDocumentURL 不参与推导。
    expect(
      handler({
        url: controlledDocument,
        mainDocumentURL: 'https://attacker.invalid/',
        isTopFrame: true,
        hasTargetFrame: true,
      }),
    ).toBe(true);
    for (const request of [
      { url: controlledDocument, isTopFrame: true },
      { url: controlledDocument, hasTargetFrame: true },
      {
        url: controlledDocument,
        isTopFrame: 'true',
        hasTargetFrame: true,
      },
      {
        url: controlledDocument,
        isTopFrame: true,
        hasTargetFrame: false,
      },
      {
        url: controlledDocument,
        isTopFrame: false,
        hasTargetFrame: true,
      },
      {
        url: controlledDocument,
        isTopFrame: false,
        hasTargetFrame: false,
      },
    ]) {
      expect(handler(request)).toBe(false);
    }

    // epub.js renderer 子 frame 只允许两个 about URL，且父上下文必须受控。
    for (const url of ['about:srcdoc', 'about:blank']) {
      expect(
        handler({
          url,
          mainDocumentURL: controlledDocument,
          isTopFrame: false,
          hasTargetFrame: true,
        }),
      ).toBe(true);
      expect(
        handler({
          url,
          mainDocumentURL: 'about:srcdoc',
          isTopFrame: false,
          hasTargetFrame: true,
        }),
      ).toBe(true);
      expect(
        handler({
          url,
          mainDocumentURL: controlledDocument,
          isTopFrame: true,
          hasTargetFrame: true,
        }),
      ).toBe(false);
      expect(
        handler({
          url,
          mainDocumentURL: 'https://attacker.invalid/',
          isTopFrame: false,
          hasTargetFrame: true,
        }),
      ).toBe(false);
    }

    // Android 无 frame flags 的兼容路径只接受 exact controlled document。
    expect(handler({ url: controlledDocument })).toBe(true);
    for (const url of [
      'data:text/html,unsafe',
      'blob:unsafe',
      'about:blank',
      'about:srcdoc',
      'https://attacker.invalid/leak',
      `${sessionDirectory}/other.html`,
      `${sessionDirectory}/%69ndex.html`,
    ]) {
      expect(handler({ url })).toBe(false);
    }

    // 顶层 fragment 永远 fail network load，只在身份及主文档契约满足时跳转一次。
    expect(
      handler({
        mainDocumentURL: controlledDocument,
        url: `${controlledDocument}#part`,
        isTopFrame: true,
        hasTargetFrame: true,
      }),
    ).toBe(false);
    expect(goToLocation).toHaveBeenCalledWith('#part');
    expect(goToLocation).toHaveBeenCalledTimes(1);

    for (const request of [
      {
        url: `${controlledDocument}#subframe`,
        mainDocumentURL: controlledDocument,
        isTopFrame: false,
        hasTargetFrame: true,
      },
      {
        url: `${controlledDocument}#no-target`,
        mainDocumentURL: controlledDocument,
        isTopFrame: true,
        hasTargetFrame: false,
      },
      {
        url: `${controlledDocument}#wrong-main`,
        mainDocumentURL: 'https://attacker.invalid/',
        isTopFrame: true,
        hasTargetFrame: true,
      },
      {
        url: `${controlledDocument}#android-wrong-main`,
        mainDocumentURL: 'https://attacker.invalid/',
      },
    ]) {
      expect(handler(request)).toBe(false);
    }
    expect(goToLocation).toHaveBeenCalledTimes(1);

    expect(handler({ url: `${controlledDocument}#android` })).toBe(false);
    expect(goToLocation).toHaveBeenLastCalledWith('#android');
    expect(goToLocation).toHaveBeenCalledTimes(2);

    const renderingNavigation = jest.fn();
    expect(
      requestHandler(
        build,
        true,
        renderingNavigation,
      )({
        url: `${controlledDocument}#rendering`,
        isTopFrame: true,
        hasTargetFrame: true,
      }),
    ).toBe(false);
    expect(renderingNavigation).not.toHaveBeenCalled();
  },
);

test('native fragment navigation loads the section document and reports navigation errors', async () => {
  const { ReaderContext, ReaderProvider } = jest.requireActual(
    '@epubjs-react-native/core/lib/commonjs/context.js',
  ) as {
    ReaderContext: React.Context<{
      goToLocation(target: unknown): void;
      registerBook(book: { injectJavaScript(script: string): void }): void;
    }>;
    ReaderProvider: React.ComponentType<React.PropsWithChildren>;
  };
  let readerContext: React.ContextType<typeof ReaderContext> | undefined;
  function Harness() {
    readerContext = React.useContext(ReaderContext);
    return null;
  }
  const injectJavaScript = jest.fn();
  renderToStaticMarkup(
    React.createElement(ReaderProvider, null, React.createElement(Harness)),
  );
  readerContext?.registerBook({ injectJavaScript });
  // `%2520` 只解码一层为 `%20`，不能继续变成空格。
  readerContext?.goToLocation({ engineIndex: 4, fragment: 'target%2520id' });

  const script = injectJavaScript.mock.calls[0]?.[0] as string | undefined;
  expect(script).toContain('await section.load(book.load.bind(book))');
  expect(script).toContain('const document = section.document');
  expect(script).toContain("type: 'publicationNavigationError'");
  expect(script).not.toContain("postPublicationError('render'");

  const targetElement = {};
  const getElementById = jest.fn((id: string) =>
    id === 'target%20id' ? targetElement : null,
  );
  const section = {
    document: undefined as
      { getElementById(id: string): typeof targetElement | null } | undefined,
    load: jest.fn(async () => {
      section.document = {
        getElementById,
      };
    }),
    cfiFromElement: jest.fn(() => 'epubcfi(/6/4!/4/2)'),
  };
  const display = jest.fn(async () => undefined);
  const postMessage = jest.fn();
  const execute = Function('book', 'rendition', 'window', script ?? '');
  execute(
    {
      load: jest.fn(),
      spine: { get: jest.fn(() => section) },
    },
    { display },
    { ReactNativeWebView: { postMessage } },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  expect(section.load).toHaveBeenCalledTimes(1);
  expect(getElementById).toHaveBeenCalledTimes(1);
  expect(getElementById).toHaveBeenCalledWith('target%20id');
  expect(section.cfiFromElement).toHaveBeenCalledWith(targetElement);
  expect(display).toHaveBeenCalledWith('epubcfi(/6/4!/4/2)');
  expect(postMessage).not.toHaveBeenCalled();

  section.document = undefined;
  section.load.mockImplementationOnce(async () => {
    section.document = { getElementById: () => null };
  });
  execute(
    {
      load: jest.fn(),
      spine: { get: jest.fn(() => section) },
    },
    { display },
    { ReactNativeWebView: { postMessage } },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  expect(JSON.parse(postMessage.mock.calls[0]?.[0] as string)).toEqual({
    type: 'publicationNavigationError',
    version: 1,
    reason: 'Navigation fragment was not found',
  });

  injectJavaScript.mockClear();
  postMessage.mockClear();
  readerContext?.goToLocation('epubcfi(/6/8)');
  const cfiScript = injectJavaScript.mock.calls[0]?.[0] as string | undefined;
  const failedDisplay = jest.fn(async () => {
    throw new Error('Display failed');
  });
  Function(
    'book',
    'rendition',
    'window',
    cfiScript ?? '',
  )({}, { display: failedDisplay }, { ReactNativeWebView: { postMessage } });
  await new Promise<void>((resolve) => setImmediate(resolve));

  expect(JSON.parse(postMessage.mock.calls[0]?.[0] as string)).toEqual({
    type: 'publicationNavigationError',
    version: 1,
    reason: 'Display failed',
  });
});

test.each(runtimeBuilds)(
  'executes the patched %s URL and DOM sanitizer',
  (build) => {
    const policy = nativeUrlPolicy(build);
    expect(policy.safePublicationResourceUrl('images/cover.jpg')).toBe(true);
    expect(
      policy.safePublicationResourceUrl('data:image/png;base64,AA=='),
    ).toBe(true);
    expect(policy.safePublicationResourceUrl('blob:renderer-resource')).toBe(
      true,
    );
    expect(policy.safePublicationNavigationUrl('chapter.xhtml#part')).toBe(
      true,
    );

    const unsafeUrls = [
      'https:attacker.invalid/leak',
      'https:%5c%5cattacker.invalid/leak',
      'https://attacker.invalid/leak',
      '//attacker.invalid/leak',
      '/absolute/path',
      '%2fabsolute/path',
      'chapter\\evil.xhtml',
      String.raw`h\74 tps:attacker.invalid/leak`,
      'chapter%0a.xhtml',
      'chapter%C2%80.xhtml',
      'chapter%ZZ.xhtml',
      'chapter%.xhtml',
    ];
    for (const value of unsafeUrls) {
      expect(policy.safePublicationResourceUrl(value)).toBe(false);
      expect(policy.safePublicationNavigationUrl(value)).toBe(false);
    }
    expect(policy.safePublicationNavigationUrl('data:text/html,unsafe')).toBe(
      false,
    );
    expect(policy.safePublicationNavigationUrl('blob:unsafe')).toBe(false);

    const encodeLayers = (value: string, count: number) => {
      let encoded = value;
      for (let index = 0; index < count; index += 1) {
        encoded = encodeURIComponent(encoded);
      }
      return encoded;
    };
    expect(
      policy.safePublicationResourceUrl(encodeLayers('chapter name.xhtml', 8)),
    ).toBe(true);
    expect(
      policy.safePublicationResourceUrl(encodeLayers('chapter name.xhtml', 9)),
    ).toBe(false);

    expect(
      policy.sanitizeCss('a{background:url(https:attacker.invalid/leak)}'),
    ).toContain('url(about:blank)');
    expect(
      policy.sanitizeCss(
        String.raw`a{background:url(h\74 tps:attacker.invalid/leak)}`,
      ),
    ).toContain('url(about:blank)');
    expect(
      policy.sanitizeCss('a{background:url(data:image/png;base64,AA==)}'),
    ).toContain('url(data:image/png;base64,AA==)');

    const listeners = new Map<
      string,
      (event: Record<string, unknown>) => void
    >();
    const document = {
      querySelectorAll: () => [],
      addEventListener: (
        name: string,
        listener: (event: Record<string, unknown>) => void,
      ) => listeners.set(name, listener),
    };
    policy.secureContents({ document });
    const area = {
      getAttribute: (name: string) =>
        name === 'href' ? 'https:attacker.invalid/leak' : null,
    };
    const preventDefault = jest.fn();
    const stopPropagation = jest.fn();
    const closest = jest.fn(() => area);
    listeners.get('click')?.({
      target: { closest },
      preventDefault,
      stopPropagation,
    });
    expect(closest).toHaveBeenCalledWith('a, area');
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(policy.safeElementUrl('area', 'href', 'data:text/html,unsafe')).toBe(
      false,
    );
    expect(
      policy.safeElementUrl('img', 'src', 'data:image/png;base64,AA=='),
    ).toBe(true);
  },
);

test.each(runtimeBuilds)(
  'executes the patched %s archive target normalizers before parsing',
  (build) => {
    const runtime = nativeArchiveRuntime(build);
    const book = (rawPackagePath: unknown, enginePackagePath: string) => ({
      container: { packagePath: rawPackagePath },
      path: { toString: () => enginePackagePath },
    });
    expect(
      runtime.resolvePublicationPackagePath(
        book('EPUB/package.opf', '/EPUB/package.opf'),
      ),
    ).toEqual({
      packagePath: 'EPUB/package.opf',
      packageRequestPath: '/EPUB/package.opf',
    });
    for (const rawPackagePath of [
      '/EPUB/package.opf',
      '//EPUB/package.opf',
      '/../EPUB/package.opf',
      '%2FEPUB/package.opf',
      '%252FEPUB/package.opf',
      '../../package.opf',
    ]) {
      expect(
        runtime.resolvePublicationPackagePath(
          book(rawPackagePath, '/EPUB/package.opf'),
        ),
      ).toBeUndefined();
    }
    expect(
      runtime.resolvePublicationPackagePath(
        book('EPUB/package.opf', '/OTHER/package.opf'),
      ),
    ).toBeUndefined();
    expect(runtime.resolvePublicationPackagePath({})).toBeUndefined();
    expect(
      runtime.resolvePublicationPackagePath(
        book('EPUB%252Fnested/package.opf', '/EPUB%252Fnested/package.opf'),
      ),
    ).toEqual({
      packagePath: 'EPUB%2Fnested/package.opf',
      packageRequestPath: '/EPUB%252Fnested/package.opf',
    });
    // Raw publication targets never receive the trusted engine-path conversion.
    expect(runtime.normalizeArchivePath('/EPUB/package.opf')).toBeUndefined();
    expect(
      runtime.normalizePublicationTarget('/EPUB/chapter.xhtml'),
    ).toBeUndefined();
    expect(
      runtime.normalizePublicationTarget('chapter.xhtml#target%20id'),
    ).toEqual({ document: 'chapter.xhtml', fragment: 'target%20id' });
    expect(runtime.normalizePublicationTarget('chapter.xhtml#note:1')).toEqual({
      document: 'chapter.xhtml',
      fragment: 'note:1',
    });
    expect(
      runtime.normalizePublicationTarget('chapter.xhtml#note%3A1'),
    ).toEqual({ document: 'chapter.xhtml', fragment: 'note%3A1' });
    expect(
      runtime.normalizePublicationTarget('chapter.xhtml?note=a:b#note:1'),
    ).toEqual({ document: 'chapter.xhtml', fragment: 'note:1' });
    expect(
      runtime.normalizePublicationTarget(
        '#target%20id',
        'EPUB/navigation/toc.xhtml',
      ),
    ).toEqual({
      document: 'EPUB/navigation/toc.xhtml',
      fragment: 'target%20id',
    });

    const encodeLayers = (value: string, count: number) => {
      let encoded = value;
      for (let index = 0; index < count; index += 1) {
        encoded = encodeURIComponent(encoded);
      }
      return encoded;
    };
    expect(
      runtime.normalizeArchivePath(encodeLayers('chapter name.xhtml', 8)),
    ).toBe(encodeLayers('chapter name.xhtml', 7));
    expect(
      runtime.normalizeArchivePath(encodeLayers('chapter name.xhtml', 9)),
    ).toBeUndefined();
    const encodedBase = runtime.normalizeArchivePath(
      'EPUB%252Fnested/package.opf',
    );
    expect(encodedBase).toBe('EPUB%2Fnested/package.opf');
    expect(runtime.normalizeArchivePath('chapter.xhtml', encodedBase)).toBe(
      'EPUB%2Fnested/chapter.xhtml',
    );
    expect(runtime.normalizeArchivePath('%2525.xhtml')).toBe('%25.xhtml');
    expect(runtime.normalizeArchivePath('%25.xhtml')).toBe('%.xhtml');
    expect(runtime.normalizeArchivePath('../../chapter.xhtml')).toBeUndefined();
    expect(
      runtime.normalizeArchivePath(
        '../../../chapter.xhtml',
        'EPUB/navigation/toc.xhtml',
      ),
    ).toBeUndefined();
    expect(
      runtime.normalizeArchivePath('__ARCHIVE_ESCAPE__/chapter.xhtml'),
    ).toBe('__ARCHIVE_ESCAPE__/chapter.xhtml');
    expect(runtime.normalizeArchivePath(' chapter.xhtml')).toBe(
      ' chapter.xhtml',
    );
    expect(runtime.normalizeArchivePath('chapter.xhtml')).toBe('chapter.xhtml');

    // canonical ZIP 身份允许首段冒号（chapter:1.xhtml）；scheme 只在原始
    // document component 的起始位置判定。
    expect(runtime.normalizeCanonicalArchivePath('chapter:1.xhtml')).toBe(
      'chapter:1.xhtml',
    );
    expect(
      runtime.normalizeArchivePath('../chapter:1.xhtml', 'EPUB/package.opf'),
    ).toBe('chapter:1.xhtml');
    expect(
      runtime.normalizePublicationTarget(
        '../chapter:1.xhtml#colon-anchor',
        'EPUB/package.opf',
      ),
    ).toEqual({ document: 'chapter:1.xhtml', fragment: 'colon-anchor' });
    expect(
      runtime.normalizeArchivePath('chapter:1.xhtml', 'EPUB/package.opf'),
    ).toBeUndefined();
    expect(
      runtime.normalizePublicationTarget('chapter:1.xhtml#colon-anchor'),
    ).toBeUndefined();

    for (const target of [
      '\tchapter.xhtml',
      'chapter.xhtml\r',
      `chapter.xhtml${String.fromCharCode(0x7f)}`,
      `chapter.xhtml${String.fromCharCode(0x85)}`,
      'chapter.xhtml%7F',
      'chapter.xhtml%C2%85',
      'chapter.xhtml#%00',
      'chapter.xhtml#%2500',
      String.raw`chapter.xhtml#\evil`,
      'chapter.xhtml?value=%00',
      'chapter.xhtml?value=%2500',
      String.raw`chapter.xhtml?value=\evil`,
      'chapter.xhtml?value=%ZZ',
      ' https:attacker.invalid',
      'chapter.xhtml?next=/absolute',
      'chapter.xhtml?next= /absolute',
      'chapter.xhtml?next=%2Fabsolute',
      'chapter.xhtml#/absolute',
    ]) {
      expect(runtime.normalizeArchivePath(target)).toBeUndefined();
      expect(runtime.normalizePublicationTarget(target)).toBeUndefined();
    }
  },
);

test.each(runtimeBuilds)(
  'keeps the patched %s payload identity aligned with the shared native validator',
  (build) => {
    const runtime = nativeArchiveRuntime(build);
    const packagePath = 'EPUB/package.opf';
    const href = '../chapter:1.xhtml';
    // 与 patched template 生成 archiveKey 的路径完全一致。
    const archiveKey = runtime.normalizeArchivePath(href, packagePath);
    expect(archiveKey).toBe('chapter:1.xhtml');
    expect(runtime.normalizeCanonicalArchivePath(archiveKey ?? '')).toBe(
      archiveKey,
    );

    // Native bridge 用同一个 patched 运行时产出的 payload 必须被共享校验器接受。
    const event: PublicationPreparedEvent = {
      type: 'publicationPrepared',
      version: 2,
      packagePath,
      navigationPath: 'EPUB/nav.xhtml',
      title: 'First Segment Colon',
      spine: [
        {
          idref: 'colon',
          href,
          archiveKey: archiveKey ?? '',
          linear: true,
          engineIndex: 0,
          properties: [],
        },
      ],
      toc: [
        {
          id: 'colon',
          href: '../chapter:1.xhtml#colon-anchor',
          archiveKey: archiveKey ?? '',
          targetEngineIndex: 0,
          label: 'Colon Chapter',
        },
      ],
      profile: {
        packageLayouts: [],
        spineLayouts: [],
        iBooksDisplayOptions: { state: 'absent' },
        mediaOverlayItemIds: [],
        encryption: { state: 'absent' },
      },
    };
    expect(validatePublication(event)).toBeUndefined();
    expect(buildSpine(event.spine, [], packagePath)).toHaveLength(1);
  },
);

test('native publication templates retain structural hardening and protocol versions', () => {
  for (const build of runtimeBuilds) {
    const template = runtimeTemplate(build);
    expect(template).toContain("frame-src 'none'");
    expect(template).toContain("object-src 'none'");
    expect(template).toContain("form-action 'none'");
    expect(template).toContain("base-uri 'none'");
    expect(template).toContain("document.addEventListener('submit'");
    expect(template).toContain(
      'rendition.hooks.content.register(secureContents)',
    );
    expect(template).toContain("type: 'publicationPrepared'");
    expect(template).toMatch(/type: 'publicationPrepared',\s*version: 2/);
    expect(template).toMatch(/type: 'publicationLocation',\s*version: 1/);
    expect(template).toMatch(/type: 'publicationError',\s*version: 1/);
    expect(template).toContain('resolvePublicationPackagePath(book)');
    expect(template.indexOf('validatePublicationProfile(profile')).toBeLessThan(
      template.indexOf("type: 'publicationPrepared'"),
    );
  }
});

function xmlElement(
  localName: string,
  attributes: Record<string, string>,
  textContent: string,
) {
  return {
    localName,
    nodeName: localName,
    textContent,
    getAttribute: (name: string) => attributes[name] ?? null,
  };
}

function xmlDocument(elements: ReturnType<typeof xmlElement>[]) {
  return {
    documentElement: {},
    getElementsByTagName: (name: string) =>
      name === 'parsererror' ? [] : name === '*' ? elements : [],
  };
}

test.each(runtimeBuilds)(
  'executes the patched %s Native profile collector without dropping later declarations',
  async (build) => {
    const packageDocument = xmlDocument([
      xmlElement('meta', { property: 'rendition:layout' }, 'reflowable'),
      xmlElement('meta', { property: 'rendition:layout' }, 'pre-paginated'),
    ]);
    const iBooksDocument = xmlDocument([
      xmlElement('option', { name: 'fixed-layout' }, 'false'),
      xmlElement('option', { name: 'fixed-layout' }, 'true'),
    ]);
    const request = jest.fn(async (path: string) => {
      if (path === '/EPUB/package.opf') return packageDocument;
      if (path === '/META-INF/com.apple.ibooks.display-options.xml')
        return iBooksDocument;
      throw new Error('File not found: ' + path);
    });
    const runtime = nativeProfileRuntime(build, { archive: { request } });
    const collected = await runtime.collectPublicationProfile(
      '/EPUB/package.opf',
      [
        {
          engineIndex: 4,
          properties: [
            'rendition:layout-reflowable',
            'rendition:layout-pre-paginated',
          ],
        },
      ],
      [
        ['chapter', { overlay: 'audio-overlay' }],
        ['cover', {}],
      ],
    );

    expect(collected).toEqual({
      packageLayouts: ['reflowable', 'pre-paginated'],
      spineLayouts: [
        { engineIndex: 4, value: 'rendition:layout-reflowable' },
        { engineIndex: 4, value: 'rendition:layout-pre-paginated' },
      ],
      iBooksDisplayOptions: {
        state: 'parsed',
        fixedLayouts: ['false', 'true'],
      },
      mediaOverlayItemIds: ['chapter'],
      encryption: { state: 'absent' },
    });
    expect(request).toHaveBeenCalledWith('/EPUB/package.opf', 'xml');
    expect(request).toHaveBeenCalledWith(
      '/META-INF/com.apple.ibooks.display-options.xml',
      'xml',
    );
    expect(request).toHaveBeenCalledWith('/META-INF/encryption.xml', 'xml');
    expect(runtime.validatePublicationProfile(collected, [4])).toBe(
      'INVALID_EPUB',
    );
    expect(validatePublicationProfile(collected, [4])?.code).toBe(
      'INVALID_EPUB',
    );
  },
);

test.each(runtimeBuilds)(
  'patched %s Native profile validator is order-independent and fail-closed',
  (build) => {
    const runtime = nativeProfileRuntime(build, {});
    const invalidProfiles: PublicationProfile[] = [
      profile({ packageLayouts: ['reflowable', 'reflowable'] }),
      profile({ packageLayouts: ['reflowable', 'pre-paginated'] }),
      profile({ packageLayouts: ['pre-paginated', 'reflowable'] }),
      profile({
        spineLayouts: [
          { engineIndex: 0, value: 'rendition:layout-reflowable' },
          { engineIndex: 0, value: 'rendition:layout-reflowable' },
        ],
      }),
      profile({
        spineLayouts: [
          { engineIndex: 0, value: 'rendition:layout-reflowable' },
          { engineIndex: 0, value: 'rendition:layout-pre-paginated' },
        ],
      }),
      profile({
        spineLayouts: [
          { engineIndex: 0, value: 'rendition:layout-pre-paginated' },
          { engineIndex: 0, value: 'rendition:layout-reflowable' },
        ],
      }),
      profile({
        iBooksDisplayOptions: {
          state: 'parsed',
          fixedLayouts: ['false', 'false'],
        },
      }),
      profile({
        iBooksDisplayOptions: {
          state: 'parsed',
          fixedLayouts: ['false', 'true'],
        },
      }),
      profile({
        iBooksDisplayOptions: {
          state: 'parsed',
          fixedLayouts: ['true', 'false'],
        },
      }),
    ];
    for (const candidate of invalidProfiles) {
      expect(runtime.validatePublicationProfile(candidate, [0])).toBe(
        'INVALID_EPUB',
      );
      expect(validatePublicationProfile(candidate, [0])?.code).toBe(
        'INVALID_EPUB',
      );
    }

    const unsupportedProfiles: PublicationProfile[] = [
      profile({ packageLayouts: ['pre-paginated'] }),
      profile({
        spineLayouts: [
          { engineIndex: 0, value: 'rendition:layout-pre-paginated' },
        ],
      }),
      profile({
        iBooksDisplayOptions: {
          state: 'parsed',
          fixedLayouts: ['true'],
        },
      }),
    ];
    for (const candidate of unsupportedProfiles) {
      expect(runtime.validatePublicationProfile(candidate, [0])).toBe(
        'UNSUPPORTED_EPUB',
      );
      expect(validatePublicationProfile(candidate, [0])?.code).toBe(
        'UNSUPPORTED_EPUB',
      );
    }
  },
);
