import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type TestRenderer = import('react-test-renderer').ReactTestRenderer;

const mockRegistryGet = jest.fn();
const mockImplementationRender = jest.fn();
let mockImplementationLoads = 0;
let mockImplementationShouldThrow = false;
let mockWebViewLoads = 0;

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Modal: 'Modal',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TurboModuleRegistry: { get: mockRegistryGet },
  View: 'View',
}));

jest.mock('./NativeReaderImplementation.native', () => {
  mockImplementationLoads += 1;
  if (mockImplementationShouldThrow) throw new Error('sensitive load failure');
  return {
    NativeReaderImplementation: (props: unknown) => {
      mockImplementationRender(props);
      return null;
    },
  };
});

jest.mock('react-native-webview', () => {
  mockWebViewLoads += 1;
  return {};
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function validAndroidConstants() {
  return {
    implementationId: 'com.hamsternote.nativereader.securewebview',
    protocolMajor: 1,
    implementationVersion: '13.16.1-hamsternote.1',
    platform: 'android',
    capabilities: [
      'navigation-decision-fail-closed-v1',
      'main-frame-native-gate-v1',
      'subframe-local-root-deny-v1',
      'late-callback-safe-v1',
      'native-foliate-host-v1',
    ],
  };
}

function loadRuntime() {
  const React = jest.requireActual('react') as typeof import('react');
  const renderer = jest.requireActual(
    'react-test-renderer',
  ) as typeof import('react-test-renderer');
  const entry = jest.requireActual(
    './index.native',
  ) as typeof import('./index.native');
  return { React, ...renderer, NativeReader: entry.NativeReader };
}

function renderReader(onStateChange = jest.fn()) {
  const { React, act, create, NativeReader } = loadRuntime();
  let renderer: TestRenderer;
  act(() => {
    renderer = create(React.createElement(NativeReader, { onStateChange }));
  });
  return { onStateChange, renderer: renderer! };
}

function renderedText(renderer: TestRenderer): string {
  return renderer.root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => node.children.join(''))
    .join('\n');
}

beforeEach(() => {
  jest.resetModules();
  mockRegistryGet.mockReset();
  mockImplementationRender.mockReset();
  mockImplementationLoads = 0;
  mockImplementationShouldThrow = false;
  mockWebViewLoads = 0;
});

test('importing the native package entry performs no lookup or renderer load', () => {
  mockRegistryGet.mockReturnValue(null);

  loadRuntime();

  expect(mockRegistryGet).not.toHaveBeenCalled();
  expect(mockImplementationLoads).toBe(0);
  expect(mockWebViewLoads).toBe(0);
});

// 迁移后不再借助对已退役引擎的 jest.mock/计数来证明“未加载”；改为直接约束当前
// 原生入口与实现源码不含退役/不再需要的引擎引用（沿用现有 Node 源码约束测试模式）。
test('native entry and implementation sources reference no retired engine', () => {
  const sourceDirectory = dirname(__filename);
  const nativeEntrySource = readFileSync(
    join(sourceDirectory, 'index.native.ts'),
    'utf8',
  );
  const gateSource = readFileSync(
    join(sourceDirectory, 'NativeReader.native.tsx'),
    'utf8',
  );
  const implementationSource = readFileSync(
    join(sourceDirectory, 'NativeReaderImplementation.native.tsx'),
    'utf8',
  );
  const loadedGraphSource = [
    nativeEntrySource,
    gateSource,
    implementationSource,
  ].join('\n');

  for (const retiredEngine of [
    '@epubjs-react-native/core',
    'epubjs',
    'expo-file-system/legacy',
    'react-native-webview',
  ]) {
    expect(loadedGraphSource).not.toContain(retiredEngine);
  }
});

test('a missing native module renders the stable terminal error without loading implementation', () => {
  mockRegistryGet.mockReturnValue(null);
  const { onStateChange, renderer } = renderReader();

  expect(renderedText(renderer)).toContain('NATIVE_CAPABILITY_UNAVAILABLE');
  expect(onStateChange).toHaveBeenCalledWith({
    status: 'error',
    error: expect.objectContaining({
      code: 'NATIVE_CAPABILITY_UNAVAILABLE',
      message: expect.stringContaining('module-unavailable'),
    }),
  });
  expect(mockImplementationLoads).toBe(0);
});

test('getConstants exceptions fail closed without loading implementation', () => {
  mockRegistryGet.mockReturnValue({
    getConstants() {
      throw new Error('sensitive constants failure');
    },
  });
  const { renderer } = renderReader();

  expect(renderedText(renderer)).toContain('NATIVE_CAPABILITY_UNAVAILABLE');
  expect(renderedText(renderer)).toContain('get-constants-failed');
  expect(renderedText(renderer)).not.toContain('sensitive constants failure');
  expect(mockImplementationLoads).toBe(0);
});

test('the real validator permits loading and mounting only after a valid capability', () => {
  mockRegistryGet.mockReturnValue({
    getConstants: () => validAndroidConstants(),
  });
  const props = { testID: 'secure-native-reader' };
  const { React, act, create, NativeReader } = loadRuntime();
  let renderer: TestRenderer;

  act(() => {
    renderer = create(React.createElement(NativeReader, props));
  });
  act(() => {
    renderer.update(
      React.createElement(NativeReader, { testID: 'secure-native-reader-2' }),
    );
  });

  expect(mockRegistryGet).toHaveBeenCalledWith('HNSecureWebViewModule');
  expect(mockRegistryGet).toHaveBeenCalledTimes(1);
  expect(mockImplementationLoads).toBe(1);
  expect(mockImplementationRender).toHaveBeenCalledWith(props);
});

test('an implementation require exception becomes the same stable terminal error', () => {
  mockRegistryGet.mockReturnValue({
    getConstants: () => validAndroidConstants(),
  });
  mockImplementationShouldThrow = true;
  const { renderer } = renderReader();

  expect(renderedText(renderer)).toContain('NATIVE_CAPABILITY_UNAVAILABLE');
  expect(renderedText(renderer)).toContain('implementation-load-failed');
  expect(renderedText(renderer)).not.toContain('sensitive load failure');
  expect(mockImplementationRender).not.toHaveBeenCalled();
});

test('validator mismatch reason propagates without loading implementation', () => {
  mockRegistryGet.mockReturnValue({
    getConstants: () => ({
      ...validAndroidConstants(),
      implementationVersion: '13.16.1-untrusted',
    }),
  });
  const { renderer } = renderReader();

  expect(renderedText(renderer)).toContain('NATIVE_CAPABILITY_UNAVAILABLE');
  expect(renderedText(renderer)).toContain('invalid-implementation-version');
  expect(mockImplementationLoads).toBe(0);
});
