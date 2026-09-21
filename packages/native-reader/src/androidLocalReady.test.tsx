import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const setIsLoading = jest.fn();
let mockWebViewProps: Record<string, unknown> | undefined;

beforeEach(() => {
  mockWebViewProps = undefined;
  setIsLoading.mockReset();
});

jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Dimensions: { get: () => ({ width: 320, height: 640 }) },
  Platform: { OS: 'android' },
  StyleSheet: { create: (styles: unknown) => styles },
  View: 'View',
}));

jest.mock('@epubjs-react-native/core/lib/commonjs/context.js', () => {
  const ReactRuntime = jest.requireActual('react') as typeof React;
  return {
    ReaderContext: ReactRuntime.createContext({
      bookmarks: [],
      changeTheme: jest.fn(),
      currentLocation: null,
      goNext: jest.fn(),
      goPrevious: jest.fn(),
      goToLocation: jest.fn(),
      isLoading: false,
      isRendering: false,
      registerBook: jest.fn(),
      removeSelection: jest.fn(),
      setAnnotations: jest.fn(),
      setAtEnd: jest.fn(),
      setAtStart: jest.fn(),
      setBookmarks: jest.fn(),
      setCurrentLocation: jest.fn(),
      setFlow: jest.fn(),
      setInitialAnnotations: jest.fn(),
      setIsBookmarked: jest.fn(),
      setIsLoading,
      setIsRendering: jest.fn(),
      setIsSearching: jest.fn(),
      setKey: jest.fn(),
      setLandmarks: jest.fn(),
      setLocations: jest.fn(),
      setMeta: jest.fn(),
      setProgress: jest.fn(),
      setSearchResults: jest.fn(),
      setSection: jest.fn(),
      setToc: jest.fn(),
      setTotalLocations: jest.fn(),
      theme: { body: { background: '#fff' } },
    }),
    defaultTheme: { body: { background: '#fff' } },
  };
});

// 保留真实 patched core View，只替换 React Native 平台边界。
jest.mock('react-native-webview', () => ({
  WebView: (props: Record<string, unknown>) => {
    mockWebViewProps = props;
    return null;
  },
}));

jest.mock(
  '@epubjs-react-native/core/lib/commonjs/utils/GestureHandler.js',
  () => {
    const ReactRuntime = jest.requireActual('react') as typeof React;
    return {
      GestureHandler: ({ children }: React.PropsWithChildren) =>
        ReactRuntime.createElement(ReactRuntime.Fragment, null, children),
    };
  },
);

const { Reader } = jest.requireActual(
  '@epubjs-react-native/core/lib/commonjs/Reader.js',
) as {
  Reader: React.ComponentType<Record<string, unknown>>;
};

test('Android base64 source reaches the WebView template under React act', async () => {
  const encodedBook = 'UEsDBBQAAAAA'.padEnd(1001, 'A');
  const onWebViewMessage = jest.fn();
  const writes = new Map<string, string>();
  const writeAsStringAsync = jest.fn(async (uri: string, value: string) => {
    writes.set(uri, value);
  });
  const fileSystem = () => ({
    documentDirectory: 'file:///cache/native-reader-session',
    writeAsStringAsync,
    downloadFile: jest.fn(),
    size: 0,
    progress: 0,
    success: false,
    error: null,
  });
  let renderer: ReactTestRenderer;

  await act(async () => {
    renderer = create(
      <Reader
        fileSystem={fileSystem}
        onWebViewMessage={onWebViewMessage}
        renderLoadingFileComponent={() => null}
        src={encodedBook}
      />,
    );
  });

  // Reader 准备本地模板时会跨越多层 promise/effect。逐轮交还事件循环，
  // 直到真实 View 渲染 WebView，避免依赖脆弱的固定两次微任务刷新。
  for (let attempt = 0; attempt < 20 && !mockWebViewProps; attempt += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }

  const html = writes.get('file:///cache/native-reader-session/index.html');
  expect(html).toContain('const type = "base64";');
  expect(html).toContain(`const file = ${JSON.stringify(encodedBook)};`);
  expect(mockWebViewProps).toMatchObject({
    allowUniversalAccessFromFileURLs: false,
    allowingReadAccessToURL: 'file:///cache/native-reader-session',
    originWhitelist: ['*'],
    source: { uri: 'file:///cache/native-reader-session/index.html' },
  });
  const shouldStart = mockWebViewProps?.onShouldStartLoadWithRequest;
  expect(typeof shouldStart).toBe('function');
  const shouldStartRequest = shouldStart as (request: {
    mainDocumentURL?: string;
    url: string;
  }) => boolean;
  const controlledDocument = 'file:///cache/native-reader-session/index.html';
  expect(
    shouldStartRequest({
      mainDocumentURL: controlledDocument,
      url: controlledDocument,
    }),
  ).toBe(true);
  for (const rejectedUrl of [
    'data:text/html,<script>alert(1)</script>',
    'blob:attacker-controlled',
    'about:blank',
    'file:///cache/native-reader-session/%69ndex.html',
    'file:///cache/native-reader-session/other.html',
    'https://attacker.invalid/outside',
  ]) {
    expect(
      shouldStartRequest({
        mainDocumentURL: controlledDocument,
        url: rejectedUrl,
      }),
    ).toBe(false);
  }

  const publicationPrepared = {
    type: 'publicationPrepared',
    version: 2,
    packagePath: 'EPUB/package/content.opf',
    navigationPath: 'EPUB/navigation/toc.xhtml',
    title: 'Bridge fixture',
    spine: [
      {
        idref: 'skip',
        href: '../text/repeat.xhtml',
        archiveKey: 'EPUB/text/repeat.xhtml',
        linear: false,
        engineIndex: 1,
        properties: [],
      },
      {
        idref: 'repeat-a',
        href: '../text/repeat.xhtml',
        archiveKey: 'EPUB/text/repeat.xhtml',
        linear: true,
        engineIndex: 2,
        properties: [],
      },
      {
        idref: 'repeat-b',
        href: '../text/repeat.xhtml',
        archiveKey: 'EPUB/text/repeat.xhtml',
        linear: true,
        engineIndex: 3,
        properties: [],
      },
    ],
    toc: [
      {
        id: 'repeat',
        href: '../text/repeat.xhtml#part',
        archiveKey: 'EPUB/text/repeat.xhtml',
        targetEngineIndex: 2,
        label: 'Repeated',
      },
    ],
    profile: {
      packageLayouts: ['reflowable'],
      spineLayouts: [],
      iBooksDisplayOptions: { state: 'absent' },
      mediaOverlayItemIds: [],
      encryption: { state: 'absent' },
    },
  };
  const onMessage = mockWebViewProps?.onMessage;
  expect(typeof onMessage).toBe('function');
  await act(async () => {
    (onMessage as (event: { nativeEvent: { data: string } }) => void)({
      nativeEvent: { data: JSON.stringify(publicationPrepared) },
    });
  });
  expect(onWebViewMessage).toHaveBeenCalledWith(publicationPrepared);

  await act(async () => {
    renderer!.unmount();
  });
});
