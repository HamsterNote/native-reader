import { DOMParser } from '@xmldom/xmldom';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { ReaderLoadState } from './types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type MockElement = {
  getAttribute(name: string): string | null;
  localName: string;
  nodeName: string;
  textContent: string | null;
};

type MockDocument = {
  addEventListener: jest.Mock;
  createElement: jest.Mock;
  documentElement: object;
  getElementsByTagName: jest.Mock;
  head: { prepend: jest.Mock };
  querySelectorAll: jest.Mock;
};

type MockBookOptions = {
  archiveRequest?: (path: string) => Promise<unknown>;
  additionalSpineProperties?: string[];
  enginePackagePath?: string;
  fragmentId?: string;
  navigation?: Array<{ href: string; id: string; label: string }>;
  packageLayouts?: string[];
  properties?: string[];
  rawPackagePath?: string;
  spine?: Array<{
    href?: string;
    idref?: string;
    index?: number;
    linear?: boolean | string;
    properties?: string[];
  }>;
};

let mockActiveBook: ReturnType<typeof createMockBook>;

jest.mock('epubjs', () => ({
  __esModule: true,
  default: jest.fn(() => mockActiveBook.book),
}));

jest.mock('react-native', () => {
  const ReactRuntime = jest.requireActual('react') as typeof React;
  return {
    Pressable: 'Pressable',
    StyleSheet: { create: (styles: unknown) => styles },
    Text: 'Text',
    View: ReactRuntime.forwardRef<unknown, React.PropsWithChildren>(
      (props, ref) => ReactRuntime.createElement('View', { ...props, ref }),
    ),
  };
});

const { NativeReader } = jest.requireActual('./NativeReader.web') as {
  NativeReader: typeof import('./NativeReader.web').NativeReader;
};

let renderer: ReactTestRenderer | undefined;

function missingFile(path: string): Promise<never> {
  // epub.js Archive rejects with a plain object rather than an Error.
  return Promise.reject({ message: `File not found in the epub: ${path}` });
}

function createXmlDocument(elements: MockElement[] = [], malformed = false) {
  return {
    documentElement: {},
    getElementsByTagName: jest.fn((name: string) =>
      name === 'parsererror' && malformed ? [{}] : name === '*' ? elements : [],
    ),
  };
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml) as unknown as Document;
}

function createPackageDocument(layouts: string[] = []) {
  return parseXml(
    `<package><metadata>${layouts
      .map(
        (layout) =>
          `<meta property="rendition:layout">${escapeXml(layout)}</meta>`,
      )
      .join('')}</metadata></package>`,
  );
}

function createIBooksDisplayOptionsDocument(fixedLayouts: string[]) {
  return parseXml(
    `<display_options>${fixedLayouts
      .map(
        (layout) => `<option name="fixed-layout">${escapeXml(layout)}</option>`,
      )
      .join('')}</display_options>`,
  );
}

function createContentDocument() {
  const listeners = new Map<string, (event: Event) => void>();
  const document: MockDocument = {
    addEventListener: jest.fn(
      (type: string, listener: (event: Event) => void) =>
        listeners.set(type, listener),
    ),
    createElement: jest.fn(() => ({})),
    documentElement: {},
    getElementsByTagName: jest.fn(() => []),
    head: { prepend: jest.fn() },
    querySelectorAll: jest.fn(() => []),
  };
  return { document, listeners };
}

function createMockBook(options: MockBookOptions = {}) {
  const contentHooks: Array<(contents: unknown) => void> = [];
  const serializeHooks: Array<(output: string, section: object) => void> = [];
  const fragmentElement = { id: options.fragmentId ?? 'target id' };
  const fragmentDocument = {
    getElementById: jest.fn((id: string) =>
      id === fragmentElement.id ? fragmentElement : null,
    ),
  };
  let loadFailure: Error | undefined;
  const book = {
    archive: {
      request: jest.fn((path: string) => {
        if (path === '/EPUB/package.opf')
          return Promise.resolve(createPackageDocument(options.packageLayouts));
        return options.archiveRequest?.(path) ?? missingFile(path);
      }),
    },
    container: {
      packagePath: options.rawPackagePath ?? 'EPUB/package.opf',
    },
    destroy: jest.fn(),
    load: jest.fn(function (this: unknown) {
      if (this !== book) throw new Error('book.load was not bound');
      return Promise.resolve({});
    }),
    loaded: {
      metadata: Promise.resolve({
        title: 'Web fixture',
      }),
      navigation: Promise.resolve({ toc: options.navigation ?? [] }),
      spine: Promise.resolve(
        options.spine ?? [
          {
            href: 'chapter.xhtml',
            idref: 'chapter',
            index: 0,
            linear: true,
            properties: options.properties ?? [],
          },
          ...(options.additionalSpineProperties
            ? [
                {
                  href: 'chapter-2.xhtml',
                  idref: 'chapter-2',
                  index: 1,
                  linear: true,
                  properties: options.additionalSpineProperties,
                },
              ]
            : []),
        ],
      ),
    },
    off: jest.fn(),
    on: jest.fn(),
    packaging: {
      manifest: {},
      navPath: 'nav.xhtml',
    },
    path: {
      toString: () => options.enginePackagePath ?? '/EPUB/package.opf',
    },
    ready: Promise.resolve(),
    renderTo: jest.fn(),
    spine: {
      get: jest.fn(),
      hooks: {
        serialize: {
          deregister: jest.fn(),
          register: jest.fn((hook: (output: string, section: object) => void) =>
            serializeHooks.push(hook),
          ),
        },
      },
    },
  };
  const section = {
    cfiFromElement: jest.fn(
      (element: { id: string }) => `epubcfi(${element.id})`,
    ),
    document: fragmentDocument,
    load: jest.fn(async (request: (path: string) => Promise<unknown>) => {
      if (loadFailure) throw loadFailure;
      await request('chapter.xhtml');
      // Deliberately return a different document. Navigation must use
      // section.document after load, matching epub.js' actual Section API.
      return { getElementById: () => null };
    }),
  };
  book.spine.get.mockReturnValue(section);
  const rendition = {
    destroy: jest.fn(),
    display: jest.fn(async () => undefined),
    hooks: {
      content: {
        deregister: jest.fn(),
        register: jest.fn((hook: (contents: unknown) => void) =>
          contentHooks.push(hook),
        ),
      },
    },
    off: jest.fn(),
    on: jest.fn(),
  };
  book.renderTo.mockReturnValue(rendition);
  return {
    book,
    contentHooks,
    fragmentDocument,
    fragmentElement,
    rendition,
    section,
    serializeHooks,
    setLoadFailure(error?: Error) {
      loadFailure = error;
    },
  };
}

async function flushReader() {
  await act(async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });
}

async function renderReader(options: MockBookOptions = {}) {
  mockActiveBook = createMockBook(options);
  const states: ReaderLoadState[] = [];
  await act(async () => {
    renderer = create(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onStateChange={(state) => states.push(state)}
        source={{ kind: 'uri', uri: 'blob:web-fixture' }}
      />,
      {
        createNodeMock: () => ({ replaceChildren: jest.fn() }),
      },
    );
  });
  await flushReader();
  return { ...mockActiveBook, states };
}

function textContent(node: { children: Array<string | object> }): string {
  return node.children.filter((child) => typeof child === 'string').join('');
}

async function press(label: string) {
  const text = renderer!.root
    .findAll((node) => textContent(node) === label)
    .find((node) => node.parent?.props.accessibilityRole === 'button');
  expect(text?.parent?.type).toBe('Pressable');
  await act(async () => {
    await text?.parent?.props.onPress();
  });
}

afterEach(() => {
  if (renderer) act(() => renderer?.unmount());
  renderer = undefined;
});

test('loads a TOC section before resolving its fragment and keeps navigation failures local', async () => {
  const fixture = await renderReader({
    navigation: [
      { href: 'chapter.xhtml#target%20id', id: 'success', label: 'Success' },
      { href: 'chapter.xhtml#missing', id: 'missing', label: 'Missing' },
      { href: 'chapter.xhtml#bad%', id: 'malformed', label: 'Malformed' },
      { href: 'chapter.xhtml#load-failure', id: 'load', label: 'Load failure' },
    ],
  });

  expect(fixture.states.at(-1)).toEqual({ status: 'ready' });
  expect(
    renderer!.root.findAll((node) => textContent(node) === 'Malformed'),
  ).toHaveLength(0);
  await press('Success');
  expect(fixture.section.load).toHaveBeenCalledWith(expect.any(Function));
  expect(fixture.fragmentDocument.getElementById).toHaveBeenCalledWith(
    'target id',
  );
  expect(fixture.section.cfiFromElement).toHaveBeenCalledWith(
    fixture.fragmentElement,
  );
  expect(fixture.rendition.display).toHaveBeenLastCalledWith(
    'epubcfi(target id)',
  );

  await press('Missing');
  expect(
    renderer!.root.findAllByProps({ accessibilityRole: 'alert' }),
  ).toHaveLength(1);
  expect(fixture.states.at(-1)).toEqual({ status: 'ready' });

  fixture.setLoadFailure(new Error('section load failed'));
  await press('Load failure');
  expect(fixture.states.at(-1)).toEqual({ status: 'ready' });

  fixture.setLoadFailure();
  await press('Success');
  expect(
    renderer!.root.findAllByProps({ accessibilityRole: 'alert' }),
  ).toHaveLength(0);
});

test('maps a validated relative rootfile to epub.js archive-root package path', async () => {
  const fixture = await renderReader({
    rawPackagePath: 'EPUB/package.opf',
    enginePackagePath: '/EPUB/package.opf',
  });

  expect(fixture.states.at(-1)).toEqual({ status: 'ready' });
  expect(fixture.book.archive.request).toHaveBeenCalledWith(
    '/EPUB/package.opf',
    'xml',
  );
});

test.each([
  '/EPUB/package.opf',
  '//EPUB/package.opf',
  '/../EPUB/package.opf',
  '%2FEPUB/package.opf',
  '%252FEPUB/package.opf',
])('rejects untrusted raw container rootfile %p', async (rawPackagePath) => {
  const fixture = await renderReader({ rawPackagePath });

  expect(fixture.states.at(-1)).toMatchObject({
    error: { code: 'INVALID_EPUB' },
    status: 'error',
  });
  expect(fixture.book.archive.request).not.toHaveBeenCalled();
});

test('keeps a first-segment colon ZIP identity for a parent-relative chapter', async () => {
  // EPUB/package.opf + ../chapter:1.xhtml：归档根 chapter:1.xhtml 的 canonical
  // 身份首段带冒号，必须按 ZIP entry 接受而不是当成 URL scheme。
  const fixture = await renderReader({
    enginePackagePath: '/EPUB/package.opf',
    fragmentId: 'colon-anchor',
    navigation: [
      {
        href: '../chapter:1.xhtml#colon-anchor',
        id: 'colon',
        label: 'Colon Chapter',
      },
    ],
    rawPackagePath: 'EPUB/package.opf',
    spine: [
      {
        href: '../chapter:1.xhtml',
        idref: 'colon',
        index: 0,
        linear: true,
      },
    ],
  });

  expect(fixture.states.at(-1)).toEqual({ status: 'ready' });
  expect(
    renderer!.root.findAll((node) => textContent(node) === 'Colon Chapter'),
  ).not.toHaveLength(0);

  await press('Colon Chapter');
  expect(fixture.section.load).toHaveBeenCalledWith(expect.any(Function));
  expect(fixture.fragmentDocument.getElementById).toHaveBeenCalledWith(
    'colon-anchor',
  );
  expect(fixture.rendition.display).toHaveBeenLastCalledWith(
    'epubcfi(colon-anchor)',
  );
  expect(
    renderer!.root.findAllByProps({ accessibilityRole: 'alert' }),
  ).toHaveLength(0);
});

test('rejects an engine package path that does not match the validated rootfile', async () => {
  const fixture = await renderReader({
    rawPackagePath: 'EPUB/package.opf',
    enginePackagePath: '/OTHER/package.opf',
  });

  expect(fixture.states.at(-1)).toMatchObject({
    error: { code: 'INVALID_EPUB' },
    status: 'error',
  });
  expect(fixture.book.archive.request).not.toHaveBeenCalled();
});

test('rejects the whole Web spine when one linear item is invalid', async () => {
  const fixture = await renderReader({
    spine: [
      { href: 'chapter.xhtml', idref: 'good', index: 0, linear: true },
      {
        href: 'https:invalid.example/chapter.xhtml',
        idref: 'bad',
        index: 1,
        linear: true,
      },
    ],
  });

  expect(fixture.states.at(-1)).toMatchObject({
    error: { code: 'INVALID_EPUB' },
    status: 'error',
  });
  expect(fixture.book.renderTo).not.toHaveBeenCalled();
});

test('classifies initial display rejection as render phase for plain objects', async () => {
  mockActiveBook = createMockBook();
  mockActiveBook.rendition.display.mockRejectedValueOnce({
    message: 'opaque failure without render keywords',
  });
  const states: ReaderLoadState[] = [];
  await act(async () => {
    renderer = create(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onStateChange={(state) => states.push(state)}
        source={{ kind: 'uri', uri: 'blob:web-fixture' }}
      />,
      { createNodeMock: () => ({ replaceChildren: jest.fn() }) },
    );
  });
  await flushReader();

  expect(states.at(-1)).toMatchObject({
    error: { code: 'RENDER_FAILED' },
    status: 'error',
  });
});

test.each([
  ['duplicate same', ['reflowable', 'reflowable'], 'INVALID_EPUB'],
  [
    'supported then unsupported',
    ['reflowable', 'vendor-layout'],
    'INVALID_EPUB',
  ],
  [
    'unsupported then supported',
    ['vendor-layout', 'reflowable'],
    'INVALID_EPUB',
  ],
  ['blank', ['   '], 'INVALID_EPUB'],
  ['single unsupported', ['vendor-layout'], 'UNSUPPORTED_EPUB'],
] as const)(
  'collects every package rendition:layout declaration: %s',
  async (_name, packageLayouts, code) => {
    const fixture = await renderReader({ packageLayouts: [...packageLayouts] });

    expect(fixture.states.at(-1)).toMatchObject({
      error: { code },
      status: 'error',
    });
  },
);

test.each([
  ['false then true', ['false', 'true'], 'INVALID_EPUB'],
  ['true then false', ['true', 'false'], 'INVALID_EPUB'],
  ['blank', ['   '], 'INVALID_EPUB'],
  ['single unsupported', ['vendor-layout'], 'UNSUPPORTED_EPUB'],
] as const)(
  'collects every iBooks fixed-layout option: %s',
  async (_name, fixedLayouts, code) => {
    const fixture = await renderReader({
      archiveRequest: async (path) =>
        path.includes('display-options')
          ? createIBooksDisplayOptionsDocument([...fixedLayouts])
          : missingFile(path),
    });

    expect(fixture.states.at(-1)).toMatchObject({
      error: { code },
      status: 'error',
    });
  },
);

test.each([
  [
    'duplicate same on one engine index',
    ['rendition:layout-reflowable', 'rendition:layout-reflowable'],
    undefined,
    'INVALID_EPUB',
  ],
  [
    'supported then unsupported on one engine index',
    ['rendition:layout-reflowable', 'rendition:layout-vendor-extension'],
    undefined,
    'INVALID_EPUB',
  ],
  [
    'unsupported then supported on one engine index',
    ['rendition:layout-vendor-extension', 'rendition:layout-reflowable'],
    undefined,
    'INVALID_EPUB',
  ],
  [
    'trailing unsupported declaration on another engine index',
    ['rendition:layout-reflowable'],
    ['rendition:layout-vendor-extension'],
    'UNSUPPORTED_EPUB',
  ],
] as const)(
  'collects all spine layout properties: %s',
  async (_name, properties, additionalSpineProperties, code) => {
    const fixture = await renderReader({
      properties: [...properties],
      ...(additionalSpineProperties
        ? { additionalSpineProperties: [...additionalSpineProperties] }
        : undefined),
    });

    expect(fixture.states.at(-1)).toMatchObject({
      error: { code },
      status: 'error',
    });
  },
);

test.each([
  ['iBooks display options', '/META-INF/com.apple.ibooks.display-options.xml'],
  ['encryption metadata', '/META-INF/encryption.xml'],
])(
  'treats non-missing %s read failures as malformed',
  async (_name, failedPath) => {
    const fixture = await renderReader({
      archiveRequest: async (path) => {
        if (path === failedPath) throw new Error('archive read failed');
        return missingFile(path);
      },
    });

    expect(fixture.states.at(-1)).toMatchObject({
      error: { code: 'INVALID_EPUB' },
      status: 'error',
    });
  },
);

test.each([
  ['iBooks display options', '/META-INF/com.apple.ibooks.display-options.xml'],
  ['encryption metadata', '/META-INF/encryption.xml'],
])('treats parsererror in %s as malformed', async (_name, malformedPath) => {
  const fixture = await renderReader({
    archiveRequest: async (path) =>
      path === malformedPath ? createXmlDocument([], true) : missingFile(path),
  });

  expect(fixture.states.at(-1)).toMatchObject({
    error: { code: 'INVALID_EPUB' },
    status: 'error',
  });
});

test('blocks data/blob anchor navigation and every form submission in publication contents', async () => {
  const fixture = await renderReader();
  const content = createContentDocument();
  const publicationWindow = { open: jest.fn() };
  fixture.contentHooks[0]?.({
    document: content.document as unknown as Document,
    window: publicationWindow as unknown as Window,
  });

  const click = content.listeners.get('click');
  for (const element of ['a', 'area']) {
    for (const href of ['data:text/html,unsafe', 'blob:unsafe']) {
      const preventDefault = jest.fn();
      const stopPropagation = jest.fn();
      const closest = jest.fn(() => ({
        localName: element,
        getAttribute: (name: string) => (name === 'href' ? href : null),
      }));
      click?.({
        preventDefault,
        stopPropagation,
        target: { closest },
      } as unknown as Event);
      expect(closest).toHaveBeenCalledWith('a, area');
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(stopPropagation).toHaveBeenCalledTimes(1);
    }
  }

  const preventDefault = jest.fn();
  const stopPropagation = jest.fn();
  content.listeners.get('submit')?.({
    preventDefault,
    stopPropagation,
  } as unknown as Event);
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(stopPropagation).toHaveBeenCalledTimes(1);
  expect(publicationWindow.open()).toBeNull();
});
