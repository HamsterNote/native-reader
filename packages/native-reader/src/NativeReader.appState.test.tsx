import React, { useEffect, useRef } from 'react';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';

import type { AppStateStatus } from 'react-native';

import type { NativeBridgeEvent } from './shared';
import type { ReaderLoadState } from './types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ReaderProps = {
  onDisplayError(): void;
  onLocationChange(
    total: number,
    location: { start: { href: string; index?: number } },
    progress: number,
    section: { href?: string } | null,
  ): void;
  onReady(): void;
  onWebViewMessage(event: NativeBridgeEvent | unknown): void;
};

type ReaderInstance = {
  mounted: boolean;
  props: ReaderProps;
};

const mockReaderInstances: ReaderInstance[] = [];
const mockGoToLocation = jest.fn();
const mockAppStateListeners = new Set<(state: AppStateStatus | null) => void>();
const mockAppState = {
  currentState: null as AppStateStatus | null,
  addEventListener: jest.fn(
    (_event: string, listener: (state: AppStateStatus | null) => void) => {
      mockAppStateListeners.add(listener);
      return { remove: () => mockAppStateListeners.delete(listener) };
    },
  ),
  emit(state: AppStateStatus | null) {
    this.currentState = state;
    for (const listener of [...mockAppStateListeners]) listener(state);
  },
};

jest.mock('react-native', () => ({
  AppState: mockAppState,
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TurboModuleRegistry: {
    get: () => ({
      getConstants: () => ({
        implementationId: 'com.hamsternote.nativereader.securewebview',
        protocolMajor: 1,
        implementationVersion: '13.16.1-hamsternote.1',
        platform: 'android',
        capabilities: [
          'navigation-decision-fail-closed-v1',
          'main-frame-native-gate-v1',
          'subframe-local-root-deny-v1',
          'late-callback-safe-v1',
        ],
      }),
    }),
  },
  View: 'View',
}));

jest.mock('@epubjs-react-native/core', () => ({
  Reader: (props: ReaderProps) => {
    const instanceRef = useRef<ReaderInstance | undefined>(undefined);
    if (!instanceRef.current) {
      instanceRef.current = { mounted: true, props };
      mockReaderInstances.push(instanceRef.current);
    }
    instanceRef.current.props = props;
    useEffect(
      () => () => {
        if (instanceRef.current) instanceRef.current.mounted = false;
      },
      [],
    );
    return null;
  },
  ReaderProvider: ({ children }: React.PropsWithChildren) => children,
  useReader: () => ({ goToLocation: mockGoToLocation }),
}));

jest.mock('./expoFileSystem', () => ({
  createExpoFileSystem: () => () => ({}),
}));

jest.mock('./nativeSource', () => ({
  prepareNativeSource: jest.fn(),
}));

const { NativeReader } = jest.requireActual(
  './index.native',
) as typeof import('./index.native');
const { prepareNativeSource } = jest.requireMock(
  './nativeSource',
) as typeof import('./nativeSource');
const mockPrepareNativeSource = jest.mocked(prepareNativeSource);
const source = { kind: 'uri' as const, uri: 'file:///books/example.epub' };
const publicationPrepared: NativeBridgeEvent = {
  type: 'publicationPrepared',
  version: 2,
  packagePath: 'EPUB/package.opf',
  navigationPath: 'EPUB/toc.xhtml',
  title: 'Lifecycle fixture',
  spine: [
    {
      idref: 'chapter-1',
      href: 'chapter-1.xhtml',
      archiveKey: 'EPUB/chapter-1.xhtml',
      linear: true,
      engineIndex: 0,
      properties: [],
    },
  ],
  toc: [
    {
      id: 'chapter-1',
      href: 'chapter-1.xhtml',
      archiveKey: 'EPUB/chapter-1.xhtml',
      targetEngineIndex: 0,
      label: 'Chapter 1',
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

function currentReader(): ReaderInstance {
  for (let index = mockReaderInstances.length - 1; index >= 0; index -= 1) {
    const reader = mockReaderInstances[index];
    if (reader?.mounted) return reader;
  }
  throw new Error('Expected a mounted Reader');
}

function stateCodes(onStateChange: jest.Mock<void, [ReaderLoadState]>) {
  return onStateChange.mock.calls.map(([state]) =>
    state.status === 'error' ? `error:${state.error.code}` : state.status,
  );
}

async function flushEffects() {
  for (let pass = 0; pass < 4; pass += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountReader(options?: {
  appState?: AppStateStatus | null;
  loadInactivityTimeoutMs?: number;
}) {
  mockAppState.currentState =
    options?.appState === undefined ? 'active' : options.appState;
  const onStateChange = jest.fn<void, [ReaderLoadState]>();
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <NativeReader
        loadInactivityTimeoutMs={options?.loadInactivityTimeoutMs}
        onStateChange={onStateChange}
        source={source}
      />,
    );
  });
  await flushEffects();
  return { onStateChange, renderer: renderer! };
}

function emitAppState(state: AppStateStatus | null) {
  act(() => mockAppState.emit(state));
}

function prepareAndReady(reader: ReaderInstance) {
  act(() => {
    reader.props.onWebViewMessage(publicationPrepared);
    reader.props.onReady();
  });
}

function driveLateCallbacks(reader: ReaderInstance) {
  reader.props.onWebViewMessage(publicationPrepared);
  reader.props.onReady();
  reader.props.onLocationChange(
    1,
    { start: { href: 'chapter-1.xhtml', index: 0 } },
    1,
    null,
  );
  reader.props.onWebViewMessage({
    type: 'publicationNavigationError',
    version: 1,
    reason: 'late navigation failure',
  });
  reader.props.onWebViewMessage({
    type: 'publicationError',
    version: 1,
    phase: 'render',
    reason: 'late render failure',
  });
  reader.props.onDisplayError();
}

function textContent(renderer: ReactTestRenderer) {
  return renderer.root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => node.children.join(''))
    .join('\n');
}

beforeEach(() => {
  jest.useFakeTimers();
  mockReaderInstances.length = 0;
  mockAppState.currentState = 'active';
  mockAppStateListeners.clear();
  mockGoToLocation.mockReset();
  mockPrepareNativeSource.mockReset();
  mockPrepareNativeSource.mockResolvedValue({
    cleanup: jest.fn(async () => undefined),
    sessionRoot: 'file:///cache/native-reader',
    uri: 'prepared-epub-base64',
  });
});

afterEach(() => {
  jest.useRealTimers();
});

test('treats initial null, background, and later null as non-active renderer generations', async () => {
  const { onStateChange, renderer } = await mountReader({ appState: null });

  expect(mockPrepareNativeSource).toHaveBeenCalledTimes(1);
  expect(mockReaderInstances).toHaveLength(0);

  emitAppState('active');
  const firstReader = currentReader();
  emitAppState('background');
  expect(firstReader.mounted).toBe(false);
  act(() => driveLateCallbacks(firstReader));
  expect(stateCodes(onStateChange)).not.toContain('ready');
  expect(
    stateCodes(onStateChange).some((state) => state.startsWith('error')),
  ).toBe(false);

  emitAppState('active');
  const secondReader = currentReader();
  expect(secondReader).not.toBe(firstReader);
  prepareAndReady(secondReader);
  expect(
    stateCodes(onStateChange).filter((state) => state === 'ready'),
  ).toHaveLength(1);

  emitAppState(null);
  expect(secondReader.mounted).toBe(false);
  act(() => driveLateCallbacks(secondReader));
  expect(
    stateCodes(onStateChange).filter((state) => state === 'ready'),
  ).toHaveLength(1);

  emitAppState('active');
  const thirdReader = currentReader();
  expect(thirdReader).not.toBe(secondReader);
  prepareAndReady(thirdReader);
  expect(
    stateCodes(onStateChange).filter((state) => state === 'ready'),
  ).toHaveLength(2);
  expect(mockPrepareNativeSource).toHaveBeenCalledTimes(1);

  await act(async () => renderer.unmount());
});

test('retires the old renderer and creates a new one when background and active land in the same act', async () => {
  const { onStateChange, renderer } = await mountReader();
  const firstReader = currentReader();

  // 同一个 act 内连续 emit background、active：React 会把两次更新合并，
  // 最终 appState 字符串仍是 active，但生命周期 epoch 已前进两次。
  act(() => {
    mockAppState.emit('background');
    mockAppState.emit('active');
  });

  // 旧 Reader 必须被同步卸载/停用。
  expect(firstReader.mounted).toBe(false);

  // 必须创建新 Reader/session，且 prepared source 复用，不重复 prepare。
  const secondReader = currentReader();
  expect(secondReader).not.toBe(firstReader);
  expect(mockReaderInstances).toHaveLength(2);
  expect(mockPrepareNativeSource).toHaveBeenCalledTimes(1);

  // 旧 Reader 迟到的 ready/profile/location/error 一律不得改变状态。
  act(() => driveLateCallbacks(firstReader));
  expect(stateCodes(onStateChange)).not.toContain('ready');
  expect(
    stateCodes(onStateChange).some((state) => state.startsWith('error')),
  ).toBe(false);

  // 新 Reader 仍然可以正常 ready。
  prepareAndReady(secondReader);
  expect(
    stateCodes(onStateChange).filter((state) => state === 'ready'),
  ).toHaveLength(1);

  await act(async () => renderer.unmount());
});

test('retires the old renderer once when active, inactive, background, and active land in the same act', async () => {
  const { onStateChange, renderer } = await mountReader();
  const firstReader = currentReader();

  act(() => {
    mockAppState.emit('inactive');
    mockAppState.emit('background');
    mockAppState.emit('active');
  });

  expect(firstReader.mounted).toBe(false);
  const secondReader = currentReader();
  expect(secondReader).not.toBe(firstReader);
  // 批次内三次转换只应在提交后创建一个新 renderer。
  expect(mockReaderInstances).toHaveLength(2);
  expect(mockPrepareNativeSource).toHaveBeenCalledTimes(1);

  prepareAndReady(secondReader);
  expect(
    stateCodes(onStateChange).filter((state) => state === 'ready'),
  ).toHaveLength(1);

  await act(async () => renderer.unmount());
});

test('repeated active states in the same act do not recreate the renderer', async () => {
  const { onStateChange, renderer } = await mountReader();
  const reader = currentReader();

  act(() => {
    mockAppState.emit('active');
    mockAppState.emit('active');
  });

  // 重复相同状态不增长 epoch，因此不产生新 Reader，旧 Reader 仍挂载可用。
  expect(mockReaderInstances).toHaveLength(1);
  expect(reader.mounted).toBe(true);
  prepareAndReady(reader);
  expect(
    stateCodes(onStateChange).filter((state) => state === 'ready'),
  ).toHaveLength(1);

  await act(async () => renderer.unmount());
});

test('ignores profile, ready, location, and navigation callbacks after timeout', async () => {
  const { onStateChange, renderer } = await mountReader({
    loadInactivityTimeoutMs: 100,
  });
  const reader = currentReader();

  act(() => jest.advanceTimersByTime(100));
  expect(stateCodes(onStateChange)).toContain('error:LOAD_TIMEOUT');

  act(() => driveLateCallbacks(reader));
  expect(stateCodes(onStateChange)).not.toContain('ready');
  expect(textContent(renderer)).toContain('LOAD_TIMEOUT');
  emitAppState('background');
  emitAppState('active');
  expect(mockReaderInstances).toHaveLength(1);

  await act(async () => renderer.unmount());
});

test.each([
  [
    'publication render error',
    (reader: ReaderInstance) => {
      reader.props.onWebViewMessage({
        type: 'publicationError',
        version: 1,
        phase: 'render',
        reason: 'initial display failed',
      });
    },
  ],
  ['display error', (reader: ReaderInstance) => reader.props.onDisplayError()],
] as const)(
  '%s is terminal and rejects late callbacks',
  async (_name, fail) => {
    const { onStateChange, renderer } = await mountReader();
    const reader = currentReader();

    act(() => fail(reader));
    expect(stateCodes(onStateChange)).toContain('error:RENDER_FAILED');
    act(() => driveLateCallbacks(reader));
    expect(stateCodes(onStateChange)).not.toContain('ready');

    emitAppState('background');
    emitAppState('active');
    expect(mockReaderInstances).toHaveLength(1);

    const stateCountBeforeUnmount = onStateChange.mock.calls.length;
    await act(async () => renderer.unmount());
    act(() => driveLateCallbacks(reader));
    expect(onStateChange).toHaveBeenCalledTimes(stateCountBeforeUnmount);
  },
);

// publicationError 的 reason 是渲染器侧的原始错误消息：只有 phase=profile 且
// reason 精确等于 UNSUPPORTED_EPUB 的显式 allowlist 才映射为
// UNSUPPORTED_EPUB；profile 的 INVALID_EPUB、未知/缺失 reason 以及 parse
// 阶段一律 fail-closed 为 INVALID_EPUB；render 始终 RENDER_FAILED，reason
// 从不被直接信任为 code。这里从 WebView bridge 端到端驱动 ReaderSession 与
// onStateChange/渲染结果，并验证错误终态后拒绝一切迟到回调。
const publicationErrorCases = [
  [
    'profile + UNSUPPORTED_EPUB',
    { phase: 'profile', reason: 'UNSUPPORTED_EPUB' },
    'error:UNSUPPORTED_EPUB',
  ],
  [
    'profile + INVALID_EPUB',
    { phase: 'profile', reason: 'INVALID_EPUB' },
    'error:INVALID_EPUB',
  ],
  [
    'profile + unknown reason',
    { phase: 'profile', reason: 'rendition:layout-pre-paginated' },
    'error:INVALID_EPUB',
  ],
  [
    'profile + cross-phase code reason',
    { phase: 'profile', reason: 'RENDER_FAILED' },
    'error:INVALID_EPUB',
  ],
  ['profile + missing reason', { phase: 'profile' }, 'error:INVALID_EPUB'],
  [
    'parse + arbitrary reason',
    { phase: 'parse', reason: 'invalid package path' },
    'error:INVALID_EPUB',
  ],
  [
    'parse + UNSUPPORTED_EPUB reason',
    { phase: 'parse', reason: 'UNSUPPORTED_EPUB' },
    'error:INVALID_EPUB',
  ],
  [
    'render + UNSUPPORTED_EPUB reason',
    { phase: 'render', reason: 'UNSUPPORTED_EPUB' },
    'error:RENDER_FAILED',
  ],
] as const;

test.each(publicationErrorCases)(
  'publicationError %s maps to %s and is terminal',
  async (_name, event, expectedState) => {
    const { onStateChange, renderer } = await mountReader();
    const reader = currentReader();

    act(() => {
      reader.props.onWebViewMessage({
        type: 'publicationError',
        version: 1,
        ...event,
      });
    });

    const codes = stateCodes(onStateChange);
    expect(codes.at(-1)).toBe(expectedState);
    expect(codes).not.toContain('ready');
    // ReaderChrome 同时渲染 message 与 code，确保映射结果一路到达 UI。
    expect(textContent(renderer)).toContain(
      expectedState.slice('error:'.length),
    );

    const stateCountAfterError = onStateChange.mock.calls.length;

    // 终态后旧 Renderer 的迟到 profile/ready/location/navigation/error
    // 回调一律不得改变状态，也不得把错误覆盖成 ready。
    act(() => driveLateCallbacks(reader));
    expect(onStateChange).toHaveBeenCalledTimes(stateCountAfterError);
    expect(stateCodes(onStateChange).at(-1)).toBe(expectedState);

    // AppState 往返也不得重建 Renderer 让错误被吞掉或重试。
    emitAppState('background');
    emitAppState('active');
    expect(mockReaderInstances).toHaveLength(1);

    await act(async () => renderer.unmount());
    act(() => driveLateCallbacks(reader));
    expect(onStateChange).toHaveBeenCalledTimes(stateCountAfterError);
  },
);

test('ignores callbacks from a Reader destroyed by component unmount', async () => {
  const { onStateChange, renderer } = await mountReader();
  const reader = currentReader();
  const stateCountBeforeUnmount = onStateChange.mock.calls.length;

  await act(async () => renderer.unmount());
  act(() => driveLateCallbacks(reader));
  expect(onStateChange).toHaveBeenCalledTimes(stateCountBeforeUnmount);
});

test('publicationNavigationError preserves ready and successful location or navigation clears it', async () => {
  const { onStateChange, renderer } = await mountReader();
  const reader = currentReader();
  prepareAndReady(reader);
  act(() => jest.advanceTimersByTime(15_000));
  expect(stateCodes(onStateChange).at(-1)).toBe('ready');

  act(() => {
    reader.props.onWebViewMessage({
      type: 'publicationNavigationError',
      version: 1,
      reason: 'target unavailable',
    });
  });
  expect(stateCodes(onStateChange).at(-1)).toBe('ready');
  expect(textContent(renderer)).toContain(
    'The EPUB publication could not be displayed.',
  );

  act(() => {
    reader.props.onLocationChange(
      1,
      { start: { href: 'chapter-1.xhtml', index: 0 } },
      1,
      null,
    );
  });
  expect(textContent(renderer)).not.toContain(
    'The EPUB publication could not be displayed.',
  );

  act(() => {
    reader.props.onWebViewMessage({
      type: 'publicationNavigationError',
      version: 1,
    });
  });
  const tocButton = renderer.root.find(
    (node: ReactTestInstance) =>
      String(node.type) === 'Pressable' &&
      node.props.accessibilityLabel === undefined,
  );
  act(() => tocButton.props.onPress());
  expect(mockGoToLocation).toHaveBeenCalledWith(0);
  expect(textContent(renderer)).not.toContain(
    'The EPUB publication could not be displayed.',
  );
  expect(stateCodes(onStateChange).at(-1)).toBe('ready');

  await act(async () => renderer.unmount());
});
