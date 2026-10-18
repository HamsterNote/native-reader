import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  FOLIATE_IFRAME_PROTOCOL_VERSION,
  createReaderIframe,
  readWebLocalPublication,
} from './foliateWeb';
import { detectReaderFormat } from './formatDetection';
import type { ReaderLoadState, ReaderSource } from './types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Jest runs this package under the repository's Node environment. The bridge
// itself only needs the same-origin event target surface, so model it directly
// instead of claiming a browser/CSP integration test.
const testWindow = new EventTarget();
class TestHostElement {}
Object.assign(globalThis, {
  HTMLElement: TestHostElement,
  location: { origin: 'https://reader.test' },
  window: testWindow,
});

type FakeIframe = EventTarget & {
  addEventListener: jest.Mock;
  contentDocument: { title: string } | null;
  contentWindow: { postMessage: jest.Mock };
  remove: jest.Mock;
  removeEventListener: jest.Mock;
  removed: boolean;
};

let iframe: FakeIframe;
let readPublication: jest.Mock<Promise<Blob>, [string, AbortSignal?]>;

jest.mock('react-native', () => {
  const ReactRuntime = jest.requireActual('react') as typeof React;
  return {
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    StyleSheet: { create: (styles: unknown) => styles },
    Text: 'Text',
    View: ReactRuntime.forwardRef<unknown, React.PropsWithChildren>(
      (props, ref) => ReactRuntime.createElement('View', { ...props, ref }),
    ),
  };
});

jest.mock('./foliateWeb', () => {
  const actual = jest.requireActual(
    './foliateWeb',
  ) as typeof import('./foliateWeb');
  return {
    ...actual,
    createReaderIframe: jest.fn(),
    readWebLocalPublication: jest.fn(),
  };
});

jest.mock('./formatDetection', () => ({
  detectReaderFormat: jest.fn(),
}));

const { NativeReader } = jest.requireActual('./NativeReader.web') as {
  NativeReader: typeof import('./NativeReader.web').NativeReader;
};

let renderer: ReactTestRenderer | undefined;
let states: ReaderLoadState[];

const canonicalModel = (overrides: Record<string, unknown> = {}) => ({
  modelVersion: 1,
  format: 'epub',
  fixedLayout: false,
  flow: 'paginated',
  direction: 'ltr',
  metadata: { title: 'Bridge fixture' },
  sections: [
    { key: 's:0', index: 0, linear: true, bytes: null },
    { key: 's:1', index: 1, linear: false, bytes: null },
    { key: 's:2', index: 2, linear: true, bytes: null },
  ],
  toc: [
    {
      id: 'toc:0',
      label: 'First',
      destinationId: 'd:0',
      subitems: [
        {
          id: 'toc:1',
          label: 'Nonlinear',
          destinationId: 'd:1',
          subitems: [],
        },
        {
          id: 'toc:2',
          label: 'Unavailable',
          destinationId: null,
          subitems: [],
        },
      ],
    },
  ],
  destinations: [
    { id: 'd:0', sectionKey: 's:0', sectionIndex: 0 },
    { id: 'd:1', sectionKey: 's:1', sectionIndex: 1 },
  ],
  ...overrides,
});

function createIframe(
  hostDocument: { title: string } | null = { title: 'Foliate reader' },
) {
  const target = new EventTarget() as FakeIframe;
  const add = target.addEventListener.bind(target);
  const removeListener = target.removeEventListener.bind(target);
  target.addEventListener = jest.fn(add);
  target.removeEventListener = jest.fn(removeListener);
  target.contentDocument = hostDocument;
  target.contentWindow = { postMessage: jest.fn() };
  target.removed = false;
  target.remove = jest.fn(() => {
    target.removed = true;
  });
  return target;
}

function lastCommand() {
  const call = iframe.contentWindow.postMessage.mock.calls.at(-1);
  return call?.[0] as {
    generation: string;
    payload: Record<string, unknown>;
    protocolVersion: number;
    session: string;
    type: string;
  };
}

async function renderReader(
  source: ReaderSource = { kind: 'uri', uri: 'blob:fixture' },
  loadInactivityTimeoutMs = 0,
  host: 'absent' | 'present' = 'present',
  dispatchIframeLoad = true,
) {
  iframe = createIframe();
  readPublication = jest.fn<Promise<Blob>, [string, AbortSignal?]>(
    async () => new Blob(['publication']),
  );
  (createReaderIframe as jest.Mock).mockReturnValue(iframe);
  (readWebLocalPublication as jest.Mock).mockImplementation(readPublication);
  (detectReaderFormat as jest.Mock).mockResolvedValue({
    status: 'supported',
    format: 'epub',
    layout: 'reflowable',
  });
  states = [];
  await act(async () => {
    renderer = create(
      <NativeReader
        loadInactivityTimeoutMs={loadInactivityTimeoutMs}
        onStateChange={(value) => states.push(value)}
        source={source}
      />,
      {
        createNodeMock: () =>
          host === 'present'
            ? (new TestHostElement() as unknown as HTMLElement)
            : null,
      },
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  if (host === 'present' && dispatchIframeLoad) {
    await act(async () => {
      iframe.dispatchEvent(new Event('load'));
    });
  }
}

async function receive(
  type: string,
  detail: Record<string, unknown> = {},
  options: { generation?: string; origin?: string; source?: unknown } = {},
) {
  const probe = iframe.contentWindow.postMessage.mock.calls.find(
    ([message]) => message.type === 'probe',
  )?.[0];
  const event = new Event('message') as MessageEvent;
  Object.assign(event, {
    data: {
      type,
      protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION,
      session: probe?.session,
      generation: options.generation ?? probe?.generation,
      ...detail,
    },
    origin: options.origin ?? location.origin,
    source:
      options.source === undefined ? iframe.contentWindow : options.source,
  });
  await act(async () => {
    window.dispatchEvent(event);
  });
}

async function passProbe() {
  await receive('probe-result', { passed: true });
  await act(async () => undefined);
}

async function makeReady() {
  await passProbe();
  await receive('publication-model', { model: canonicalModel() });
  await receive('model', { fixedLayout: false, flow: 'paginated' });
  await receive('ready');
}

// 切到 scrolled 后 Host 必须回落章节导航：这是 scrolled 回归的公共前置。
// timeout 必须与 renderReader 保持一致，否则 session effect 会因依赖变化重建。
async function switchToScrolled(loadInactivityTimeoutMs = 0) {
  await act(async () => {
    renderer!.update(
      <NativeReader
        loadInactivityTimeoutMs={loadInactivityTimeoutMs}
        onStateChange={(value) => states.push(value)}
        readingFlow="scrolled"
        source={{ kind: 'uri', uri: 'blob:fixture' }}
      />,
    );
  });
  expect(lastCommand()).toMatchObject({
    type: 'flow',
    payload: { flow: 'scrolled' },
  });
  await receive('model', { fixedLayout: false, flow: 'scrolled' });
  await receive('command-ack', { command: 'flow' });
}

function controlDisabled(label: string): boolean | undefined {
  return renderer!.root.findAllByProps({ accessibilityLabel: label })[0]?.props
    .accessibilityState?.disabled;
}

function textContent(node: { children: Array<string | object> }): string {
  return node.children.filter((child) => typeof child === 'string').join('');
}

async function press(label: string) {
  const text = renderer!.root
    .findAll((node) => textContent(node) === label)
    .find((node) => node.parent?.props.accessibilityRole === 'button');
  await act(async () => text?.parent?.props.onPress());
}

afterEach(() => {
  if (renderer) act(() => renderer?.unmount());
  renderer = undefined;
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test('creates a static same-origin iframe and sends probe only after its load', async () => {
  await renderReader(undefined, 0, 'present', false);

  // 模拟真实挂载后的等待区间：没有 load 时不能把初始文档当缺资产。
  expect(states.at(-1)).toEqual({ status: 'loading' });
  expect(iframe.contentWindow.postMessage).not.toHaveBeenCalled();
  expect(iframe.remove).not.toHaveBeenCalled();
  expect(readPublication).not.toHaveBeenCalled();
  await act(async () => {
    iframe.dispatchEvent(new Event('load'));
  });

  expect(createReaderIframe).toHaveBeenCalledTimes(1);
  expect(lastCommand()).toMatchObject({
    payload: {},
    protocolVersion: 1,
    type: 'probe',
  });
  expect(iframe.contentWindow.postMessage.mock.calls[0]?.[1]).toBe(
    location.origin,
  );
  expect(readPublication).not.toHaveBeenCalled();
});

test('waits for a real HTMLElement ref callback before creating the iframe or probing', async () => {
  await renderReader(undefined, 0, 'absent');
  expect(createReaderIframe).not.toHaveBeenCalled();
  expect(readPublication).not.toHaveBeenCalled();

  const viewport = renderer!.root.findByProps({
    testID: 'foliate-web-viewport',
  });
  const ref = viewport.props.ref;
  await act(async () => {
    ref(new TestHostElement());
    await Promise.resolve();
  });
  expect(createReaderIframe).toHaveBeenCalledTimes(1);
  expect(readPublication).not.toHaveBeenCalled();
  await act(async () => {
    iframe.dispatchEvent(new Event('load'));
  });
  expect(lastCommand()).toMatchObject({ type: 'probe' });
});

test('does not start I/O or an artificial host timeout while the RN Web host is absent', async () => {
  jest.useFakeTimers();
  try {
    await renderReader(undefined, 25, 'absent');
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(createReaderIframe).not.toHaveBeenCalled();
    expect(readPublication).not.toHaveBeenCalled();
    expect(detectReaderFormat).not.toHaveBeenCalled();
    expect(states).toEqual([{ status: 'loading' }]);
    await act(async () => renderer!.unmount());
  } finally {
    jest.useRealTimers();
  }
});

test('classifies a same-origin 404 host document as a missing runtime asset before probe', async () => {
  await renderReader(undefined, 0, 'present', false);
  // A real route 404 commits a readable same-origin error document and fires
  // `load`; it does not necessarily fire `error`.
  iframe.contentDocument = { title: '404 Not Found' };
  await act(async () => {
    iframe.dispatchEvent(new Event('load'));
  });

  expect(
    iframe.contentWindow.postMessage.mock.calls.some(
      ([message]) => message.type === 'probe' || message.type === 'open',
    ),
  ).toBe(false);
  expect(readPublication).not.toHaveBeenCalled();
  expect(detectReaderFormat).not.toHaveBeenCalled();
  expect(states.at(-1)).toMatchObject({
    error: {
      category: 'render',
      message: expect.stringContaining('runtime-asset-missing'),
    },
    status: 'error',
  });
  expect(states.at(-1)).not.toMatchObject({
    error: { category: 'unsupported', code: 'LOAD_TIMEOUT' },
  });
  expect(iframe.remove).toHaveBeenCalledTimes(1);
});

test('classifies an unreadable null host document as a missing runtime asset', async () => {
  await renderReader(undefined, 0, 'present', false);
  iframe.contentDocument = null;
  await act(async () => {
    iframe.dispatchEvent(new Event('load'));
  });

  expect(
    iframe.contentWindow.postMessage.mock.calls.some(
      ([message]) => message.type === 'probe' || message.type === 'open',
    ),
  ).toBe(false);
  expect(readPublication).not.toHaveBeenCalled();
  expect(detectReaderFormat).not.toHaveBeenCalled();
  expect(states.at(-1)).toMatchObject({
    error: { message: expect.stringContaining('runtime-asset-missing') },
    status: 'error',
  });
  expect(iframe.remove).toHaveBeenCalledTimes(1);
});

test('classifies a cross-origin error document whose read throws as a missing runtime asset', async () => {
  await renderReader(undefined, 0, 'present', false);
  Object.defineProperty(iframe, 'contentDocument', {
    configurable: true,
    get() {
      throw new DOMException('cross-origin', 'SecurityError');
    },
  });
  await act(async () => {
    iframe.dispatchEvent(new Event('load'));
  });

  expect(
    iframe.contentWindow.postMessage.mock.calls.some(
      ([message]) => message.type === 'probe' || message.type === 'open',
    ),
  ).toBe(false);
  expect(readPublication).not.toHaveBeenCalled();
  expect(detectReaderFormat).not.toHaveBeenCalled();
  expect(states.at(-1)).toMatchObject({
    error: { message: expect.stringContaining('runtime-asset-missing') },
    status: 'error',
  });
  expect(iframe.remove).toHaveBeenCalledTimes(1);
});

test('never sends a probe or leaks the source path for an asset error', async () => {
  await renderReader(undefined, 0, 'present', false);
  iframe.contentDocument = { title: '' };
  await act(async () => {
    iframe.dispatchEvent(new Event('load'));
  });

  const failure = states.at(-1);
  expect(failure).toMatchObject({
    error: { message: expect.stringContaining('runtime-asset-missing') },
    status: 'error',
  });
  expect(
    iframe.contentWindow.postMessage.mock.calls.some(
      ([message]) => message.type === 'probe' || message.type === 'open',
    ),
  ).toBe(false);
  expect(readPublication).not.toHaveBeenCalled();
  // The fixed actionable message must not echo the private source identity or
  // the reader route.
  expect(
    failure && failure.status === 'error' && failure.error.message,
  ).not.toContain('blob:fixture');
  expect(
    failure && failure.status === 'error' && failure.error.message,
  ).not.toContain('reader.html');
});

test('still probes and reads only after probe when the host document title matches', async () => {
  await renderReader();

  expect(lastCommand()).toMatchObject({ type: 'probe', payload: {} });
  expect(readPublication).not.toHaveBeenCalled();
  await passProbe();
  expect(readPublication).toHaveBeenCalledWith(
    'blob:fixture',
    expect.anything(),
  );
});

test('ignores a stale load with a foreign error document after host replacement', async () => {
  await renderReader();
  const oldIframe = iframe;
  const oldLoad = oldIframe.addEventListener.mock.calls.find(
    ([type]) => type === 'load',
  )![1] as () => void;
  const replacementIframe = createIframe();
  (createReaderIframe as jest.Mock).mockReturnValueOnce(replacementIframe);
  await act(async () => {
    renderer!.update(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onStateChange={(value) => states.push(value)}
        source={{ kind: 'uri', uri: 'blob:replacement' }}
      />,
    );
  });
  const readOldDocument = jest.fn(() => ({ title: '404 Not Found' }));
  Object.defineProperty(oldIframe, 'contentDocument', { get: readOldDocument });
  const stateBefore = [...states];
  const oldCommandsBefore = [...oldIframe.contentWindow.postMessage.mock.calls];
  const newCommandsBefore = [
    ...replacementIframe.contentWindow.postMessage.mock.calls,
  ];
  // 直接调用实际注册的旧函数，而不是向已移除 listener 的 EventTarget dispatch。
  await act(async () => oldLoad());

  // The retired session must not classify a stale error document or terminate
  // the replacement session that is still opening.
  expect(states.at(-1)).toEqual({ status: 'loading' });
  expect(readPublication).not.toHaveBeenCalled();
  expect(detectReaderFormat).not.toHaveBeenCalled();
  expect(readOldDocument).not.toHaveBeenCalled();
  expect(states).toEqual(stateBefore);
  expect(oldIframe.contentWindow.postMessage.mock.calls).toEqual(
    oldCommandsBefore,
  );
  expect(replacementIframe.contentWindow.postMessage.mock.calls).toEqual(
    newCommandsBefore,
  );
  expect(replacementIframe.remove).not.toHaveBeenCalled();
  expect(oldIframe.remove).toHaveBeenCalledTimes(1);
  await act(async () => renderer!.unmount());
  const stateAfterUnmount = [...states];
  const commandsAfterUnmount = [
    ...oldIframe.contentWindow.postMessage.mock.calls,
  ];
  await act(async () => oldLoad());
  expect(readOldDocument).not.toHaveBeenCalled();
  expect(states).toEqual(stateAfterUnmount);
  expect(oldIframe.contentWindow.postMessage.mock.calls).toEqual(
    commandsAfterUnmount,
  );
  expect(readPublication).not.toHaveBeenCalled();
});

test('directly invoking a retired message listener cannot open or mutate the replacement session', async () => {
  const listen = jest.spyOn(window, 'addEventListener');
  await renderReader();
  const oldIframe = iframe;
  const oldProbe = lastCommand();
  const oldReceive = listen.mock.calls.find(
    ([type]) => type === 'message',
  )![1] as (event: MessageEvent) => void;
  const replacement = createIframe();
  (createReaderIframe as jest.Mock).mockReturnValueOnce(replacement);
  await act(async () =>
    renderer!.update(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onStateChange={(value) => states.push(value)}
        source={{ kind: 'uri', uri: 'blob:replacement' }}
      />,
    ),
  );
  const stateBefore = [...states];
  const commandsBefore = [...replacement.contentWindow.postMessage.mock.calls];
  const oldCommandsBefore = [...oldIframe.contentWindow.postMessage.mock.calls];
  const event = new Event('message') as MessageEvent;
  Object.assign(event, {
    origin: location.origin,
    source: oldIframe.contentWindow,
    data: {
      protocolVersion: oldProbe.protocolVersion,
      session: oldProbe.session,
      generation: oldProbe.generation,
      type: 'probe-result',
      passed: true,
    },
  });
  await act(async () => oldReceive(event));
  expect(states).toEqual(stateBefore);
  expect(readPublication).not.toHaveBeenCalled();
  expect(detectReaderFormat).not.toHaveBeenCalled();
  expect(replacement.contentWindow.postMessage.mock.calls).toEqual(
    commandsBefore,
  );
  expect(oldIframe.contentWindow.postMessage.mock.calls).toEqual(
    oldCommandsBefore,
  );
  expect(replacement.remove).not.toHaveBeenCalled();

  await act(async () => renderer!.unmount());
  const stateAfterUnmount = [...states];
  const commandsAfterUnmount = [
    ...replacement.contentWindow.postMessage.mock.calls,
  ];
  await act(async () => oldReceive(event));
  expect(states).toEqual(stateAfterUnmount);
  expect(replacement.contentWindow.postMessage.mock.calls).toEqual(
    commandsAfterUnmount,
  );
  expect(readPublication).not.toHaveBeenCalled();
});

test('a retired receive rejects valid replacement credentials while the current listener still opens the new source', async () => {
  const listen = jest.spyOn(window, 'addEventListener');
  await renderReader();
  const oldReceive = listen.mock.calls.find(
    ([type]) => type === 'message',
  )![1] as (event: MessageEvent) => void;
  const replacement = createIframe();
  (createReaderIframe as jest.Mock).mockReturnValueOnce(replacement);
  await act(async () =>
    renderer!.update(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onStateChange={(value) => states.push(value)}
        source={{ kind: 'uri', uri: 'blob:replacement' }}
      />,
    ),
  );
  // 真正触发新 iframe load，使用新 listener 实际发出的 probe 凭据，
  // 而非旧 token 或 malformed payload（这些不能暴露退休闭包接管新会话）。
  await act(async () => {
    replacement.dispatchEvent(new Event('load'));
  });
  const newProbe = replacement.contentWindow.postMessage.mock.calls.find(
    ([message]) => message.type === 'probe',
  )![0];
  expect(newProbe).toMatchObject({ type: 'probe', protocolVersion: 1 });
  const event = new Event('message') as MessageEvent;
  Object.assign(event, {
    origin: location.origin,
    source: replacement.contentWindow,
    data: {
      protocolVersion: newProbe.protocolVersion,
      session: newProbe.session,
      generation: newProbe.generation,
      type: 'probe-result',
      passed: true,
    },
  });
  const stateBefore = [...states];
  const commandsBefore = [...replacement.contentWindow.postMessage.mock.calls];
  await act(async () => oldReceive(event));
  expect(readPublication).not.toHaveBeenCalled(); // 旧/新 source 均零读取。
  expect(detectReaderFormat).not.toHaveBeenCalled();
  expect(replacement.contentWindow.postMessage.mock.calls).toEqual(
    commandsBefore,
  );
  expect(
    replacement.contentWindow.postMessage.mock.calls.map(
      ([message]) => message.type,
    ),
  ).toEqual(['probe']);
  expect(replacement.remove).not.toHaveBeenCalled();
  expect(states).toEqual(stateBefore);

  // 同一个合法事件交给当前注册 listener 必须继续正常路径；不靠放宽验证修复。
  await act(async () => {
    window.dispatchEvent(event);
  });
  expect(readPublication).toHaveBeenCalledTimes(1);
  expect(readPublication).toHaveBeenCalledWith(
    'blob:replacement',
    expect.anything(),
  );
  expect(detectReaderFormat).toHaveBeenCalledTimes(1);
  expect(
    replacement.contentWindow.postMessage.mock.calls.map(
      ([message]) => message.type,
    ),
  ).toEqual(['probe', 'open']);
  expect(replacement.remove).not.toHaveBeenCalled();
  await act(async () => renderer!.unmount());
  const stateAfterUnmount = [...states];
  const commandsAfterUnmount = [
    ...replacement.contentWindow.postMessage.mock.calls,
  ];
  const removalsAfterUnmount = replacement.remove.mock.calls.length;
  await act(async () => oldReceive(event));
  expect(readPublication).toHaveBeenCalledTimes(1);
  expect(detectReaderFormat).toHaveBeenCalledTimes(1);
  expect(states).toEqual(stateAfterUnmount);
  expect(replacement.contentWindow.postMessage.mock.calls).toEqual(
    commandsAfterUnmount,
  );
  expect(replacement.remove).toHaveBeenCalledTimes(removalsAfterUnmount);
});

test('terminates a synchronous iframe construction failure without retrying on ref churn', async () => {
  await renderReader(undefined, 0, 'absent');
  (createReaderIframe as jest.Mock).mockImplementationOnce(() => {
    throw new Error('missing runtime');
  });
  const viewport = renderer!.root.findByProps({
    testID: 'foliate-web-viewport',
  });
  const ref = viewport.props.ref;
  await act(async () => {
    ref(new TestHostElement());
  });
  expect(createReaderIframe).toHaveBeenCalledTimes(1);
  expect(states.at(-1)).toMatchObject({
    error: { message: expect.stringContaining('runtime-asset-missing') },
    status: 'error',
  });
  await act(async () => {
    ref(null);
    ref(new TestHostElement());
  });
  expect(createReaderIframe).toHaveBeenCalledTimes(1);
  expect(readPublication).not.toHaveBeenCalled();
  expect(detectReaderFormat).not.toHaveBeenCalled();
});

test('treats secure token generation failure as terminal before iframe construction', async () => {
  await renderReader(undefined, 0, 'absent');
  const getRandomValues = globalThis.crypto.getRandomValues;
  jest.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
    throw new Error('entropy unavailable');
  });
  const viewport = renderer!.root.findByProps({
    testID: 'foliate-web-viewport',
  });
  await act(async () => {
    viewport.props.ref(new TestHostElement());
  });
  expect(createReaderIframe).not.toHaveBeenCalled();
  expect(states.at(-1)).toMatchObject({
    error: { message: expect.stringContaining('runtime-asset-missing') },
    status: 'error',
  });
  expect(readPublication).not.toHaveBeenCalled();
  globalThis.crypto.getRandomValues = getRandomValues;
});

test('removes a partially created iframe when the second token generation fails', async () => {
  await renderReader(undefined, 0, 'absent');
  const partialIframe = createIframe();
  (createReaderIframe as jest.Mock).mockReturnValueOnce(partialIframe);
  const original = globalThis.crypto.getRandomValues;
  let calls = 0;
  jest
    .spyOn(globalThis.crypto, 'getRandomValues')
    .mockImplementation((bytes) => {
      calls += 1;
      if (calls === 2) throw new Error('second token failed');
      return original.call(globalThis.crypto, bytes);
    });
  const viewport = renderer!.root.findByProps({
    testID: 'foliate-web-viewport',
  });
  await act(async () => {
    viewport.props.ref(new TestHostElement());
  });
  expect(partialIframe.remove).toHaveBeenCalledTimes(1);
  expect(partialIframe.addEventListener).not.toHaveBeenCalled();
  expect(partialIframe.contentWindow.postMessage).not.toHaveBeenCalled();
  expect(readPublication).not.toHaveBeenCalled();
  expect(detectReaderFormat).not.toHaveBeenCalled();
});

test('allows a new session after a terminal construction failure when source identity changes', async () => {
  await renderReader(undefined, 0, 'absent');
  (createReaderIframe as jest.Mock).mockImplementationOnce(() => {
    throw new Error('missing runtime');
  });
  const viewport = renderer!.root.findByProps({
    testID: 'foliate-web-viewport',
  });
  await act(async () => {
    viewport.props.ref(new TestHostElement());
  });
  const nextIframe = createIframe();
  (createReaderIframe as jest.Mock).mockReturnValueOnce(nextIframe);
  await act(async () => {
    renderer!.update(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onStateChange={(value) => states.push(value)}
        source={{ kind: 'uri', uri: 'blob:new-source' }}
      />,
    );
  });
  await act(async () => {
    renderer!.root
      .findByProps({ testID: 'foliate-web-viewport' })
      .props.ref(new TestHostElement());
  });
  expect(createReaderIframe).toHaveBeenCalledTimes(2);
  expect(nextIframe.addEventListener).toHaveBeenCalledWith(
    'load',
    expect.any(Function),
  );
  expect(readPublication).not.toHaveBeenCalled();
});

test('ignores late load and error from a replaced host iframe', async () => {
  await renderReader();
  const oldIframe = iframe;
  const replacementIframe = createIframe();
  (createReaderIframe as jest.Mock).mockReturnValueOnce(replacementIframe);
  await act(async () => {
    renderer!.update(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onStateChange={(value) => states.push(value)}
        source={{ kind: 'uri', uri: 'blob:replacement' }}
      />,
    );
  });
  await act(async () => {
    renderer!.root
      .findByProps({ testID: 'foliate-web-viewport' })
      .props.ref(new TestHostElement());
    oldIframe.dispatchEvent(new Event('load'));
    oldIframe.dispatchEvent(new Event('error'));
  });
  expect(oldIframe.remove).toHaveBeenCalledTimes(1);
  expect(readPublication).not.toHaveBeenCalled();
  expect(states.at(-1)).toEqual({ status: 'loading' });
});

test('rejects all unauthenticated or malformed events without source I/O', async () => {
  await renderReader();
  const probe = lastCommand();
  const invalid = [
    { data: null },
    { data: { type: 'probe-result', passed: true } },
    {
      data: {
        type: 'unknown',
        protocolVersion: 1,
        session: probe.session,
        generation: probe.generation,
      },
    },
  ];
  for (const value of invalid) {
    const event = new Event('message') as MessageEvent;
    Object.assign(event, {
      ...value,
      origin: location.origin,
      source: iframe.contentWindow,
    });
    await act(async () => {
      window.dispatchEvent(event);
    });
  }
  await receive(
    'probe-result',
    { passed: true },
    { origin: 'https://wrong.test' },
  );
  await receive('probe-result', { passed: true }, { source: {} });
  await receive(
    'probe-result',
    { passed: true },
    { generation: 'a'.repeat(48) },
  );

  expect(readPublication).not.toHaveBeenCalled();
  expect(states).toEqual([{ status: 'loading' }]);
});

test('ignores a matching-format probe result before it has sent probe', async () => {
  iframe = createIframe();
  readPublication = jest.fn<Promise<Blob>, [string, AbortSignal?]>(
    async () => new Blob(['publication']),
  );
  (createReaderIframe as jest.Mock).mockReturnValue(iframe);
  (readWebLocalPublication as jest.Mock).mockImplementation(readPublication);
  states = [];
  await act(async () => {
    renderer = create(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onStateChange={(value) => states.push(value)}
        source={{ kind: 'uri', uri: 'blob:fixture' }}
      />,
      { createNodeMock: () => ({}) },
    );
    await Promise.resolve();
  });
  const forged = new Event('message') as MessageEvent;
  Object.assign(forged, {
    data: {
      type: 'probe-result',
      protocolVersion: 1,
      session: 'a'.repeat(48),
      generation: 'b'.repeat(48),
      passed: true,
    },
    origin: location.origin,
    source: iframe.contentWindow,
  });
  await act(async () => {
    window.dispatchEvent(forged);
  });
  expect(readPublication).not.toHaveBeenCalled();
});

test('does not access the source after probe failure and reports stable unsupported', async () => {
  await renderReader();
  await receive('probe-result', { passed: false });

  expect(readPublication).not.toHaveBeenCalled();
  expect(
    iframe.contentWindow.postMessage.mock.calls.map(
      ([message]) => message.type,
    ),
  ).toEqual(['probe', 'dispose']);
  expect(iframe.removeEventListener).toHaveBeenCalledWith(
    'load',
    expect.any(Function),
  );
  expect(states.at(-1)).toMatchObject({
    error: { category: 'unsupported' },
    status: 'error',
  });
  expect(iframe.removeEventListener).toHaveBeenCalledWith(
    'load',
    expect.any(Function),
  );
});

test('treats a probe timeout as unsupported without publication I/O', async () => {
  jest.useFakeTimers();
  try {
    await renderReader(undefined, 25);
    await act(async () => {
      jest.advanceTimersByTime(25);
    });
    expect(readPublication).not.toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({
      error: { category: 'unsupported' },
      status: 'error',
    });
  } finally {
    jest.useRealTimers();
  }
});

test.each(['reading', 'rendering'])(
  'opening timeout during %s ignores late work after exact-once cleanup',
  async (stage) => {
    jest.useFakeTimers();
    try {
      await renderReader(undefined, 25);
      let finishRead: (() => void) | undefined;
      if (stage === 'reading') {
        readPublication.mockImplementationOnce(
          () =>
            new Promise<Blob>((resolve) => {
              finishRead = () => resolve(new Blob(['late publication']));
            }),
        );
      }
      await passProbe();
      expect(lastCommand()).toMatchObject({
        type: stage === 'reading' ? 'probe' : 'open',
      });
      const signal = readPublication.mock.calls[0][1];
      await act(async () => {
        jest.advanceTimersByTime(25);
      });
      expect(states.at(-1)).toMatchObject({
        status: 'error',
        error: { code: 'LOAD_TIMEOUT' },
      });
      // A completed read has already released its controller. Only an inflight
      // read needs cancellation when the opening session expires.
      if (stage === 'reading') expect(signal?.aborted).toBe(true);
      expect(iframe.remove).toHaveBeenCalledTimes(1);
      const statesAfterTimeout = [...states];
      const commandsAfterTimeout =
        iframe.contentWindow.postMessage.mock.calls.length;
      await act(async () => finishRead?.());
      await receive('publication-model', { model: canonicalModel() });
      await receive('ready');
      await receive('location', { index: 2, cfi: null, fraction: null });
      await act(async () => {
        renderer!.unmount();
        jest.advanceTimersByTime(100);
      });
      renderer = undefined;
      expect(states).toEqual(statesAfterTimeout);
      expect(iframe.contentWindow.postMessage).toHaveBeenCalledTimes(
        commandsAfterTimeout,
      );
      expect(iframe.remove).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  },
);

test('rejects PDF before open after a successful probe', async () => {
  await renderReader();
  (detectReaderFormat as jest.Mock).mockResolvedValueOnce({
    status: 'error',
    error: {
      category: 'unsupported',
      message: 'PDF is outside the supported format set.',
    },
  });
  await passProbe();

  expect(readPublication).toHaveBeenCalledWith(
    'blob:fixture',
    expect.anything(),
  );
  expect(
    iframe.contentWindow.postMessage.mock.calls.map(
      ([message]) => message.type,
    ),
  ).toEqual(['probe', 'dispose']);
  expect(states.at(-1)).toMatchObject({
    error: { category: 'unsupported' },
    status: 'error',
  });
});

test('uses detected bytes rather than source name or MIME hints for the open tuple', async () => {
  await renderReader({
    kind: 'uri',
    uri: 'blob:fixture',
    name: 'misleading.pdf',
    mimeType: 'application/pdf',
  });
  (detectReaderFormat as jest.Mock).mockResolvedValueOnce({
    status: 'error',
    error: {
      category: 'invalid',
      message: 'Publication bytes are invalid or corrupt.',
    },
  });
  await passProbe();

  // Truncated ZIP is invalid: no open command is allowed despite an EPUB-like
  // source label, demonstrating that labels do not select a parser.
  expect(
    iframe.contentWindow.postMessage.mock.calls.some(
      ([message]) => message.type === 'open',
    ),
  ).toBe(false);
  expect(states.at(-1)).toMatchObject({ error: { category: 'invalid' } });
});

test('opens only a canonical private blob and rejects remote and DRM sources before open', async () => {
  await renderReader();
  await passProbe();
  const open = iframe.contentWindow.postMessage.mock.calls.find(
    ([message]) => message.type === 'open',
  )?.[0];
  expect(open).toMatchObject({
    payload: {
      format: 'epub',
      name: 'book.epub',
      mimeType: 'application/epub+zip',
    },
  });
  expect((open?.payload.file as Blob).type).toBe('application/epub+zip');

  await act(async () => {
    renderer!.update(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onStateChange={(value) => states.push(value)}
        source={{ kind: 'uri', uri: 'https://example.test/book.epub' }}
      />,
    );
  });
  expect(readPublication).toHaveBeenCalledTimes(1);
  expect(states.at(-1)).toMatchObject({ error: { category: 'unsupported' } });
});

test('rejects DRM bytes after the probe but before any open command', async () => {
  await renderReader();
  (detectReaderFormat as jest.Mock).mockResolvedValueOnce({
    status: 'error',
    error: {
      category: 'drm',
      message: 'Encrypted archives are not supported.',
    },
  });
  await passProbe();

  expect(readPublication).toHaveBeenCalledWith(
    'blob:fixture',
    expect.anything(),
  );
  expect(
    iframe.contentWindow.postMessage.mock.calls.some(
      ([message]) => message.type === 'open',
    ),
  ).toBe(false);
  expect(states.at(-1)).toMatchObject({ error: { category: 'drm' } });
  expect(iframe.removeEventListener).toHaveBeenCalledWith(
    'load',
    expect.any(Function),
  );
});

test('cleans the reader host after an authenticated render failure', async () => {
  await renderReader();
  await passProbe();
  await receive('error', { code: 'render-failure' });

  expect(states.at(-1)).toMatchObject({
    error: { category: 'render' },
    status: 'error',
  });
  expect(iframe.removeEventListener).toHaveBeenCalledWith(
    'load',
    expect.any(Function),
  );
  expect(iframe.remove).toHaveBeenCalledTimes(1);
});

test('normalizes the publication DTO and uses linear sections plus destination tokens', async () => {
  await renderReader();
  await makeReady();

  expect(states.at(-1)).toEqual({ status: 'ready' });
  expect(
    renderer!.root.findAllByProps({ accessibilityLabel: 'Table of contents' }),
  ).not.toHaveLength(0);
  await press('Next');
  expect(lastCommand()).toMatchObject({
    type: 'navigate',
    payload: { section: 2 },
  });
  await receive('location', { index: 2, cfi: null, fraction: null });
  await receive('command-ack', { command: 'navigate' });
  expect(
    renderer!.root
      .findAllByProps({ accessibilityLabel: 'Chapter position' })[0]
      ?.children.join(''),
  ).toContain('Chapter 2 of 2');

  await press('Nonlinear');
  expect(lastCommand()).toMatchObject({
    type: 'navigate',
    payload: { destination: 'd:1' },
  });
  await receive('command-ack', { command: 'navigate' });
  expect(
    renderer!.root
      .findAllByProps({ accessibilityLabel: 'Chapter position' })[0]
      ?.children.join(''),
  ).toContain('Chapter 2 of 2');

  await press('Unavailable');
  expect(
    renderer!.root.findAllByProps({
      accessibilityLabel: 'Table of contents feedback',
    }),
  ).toHaveLength(1);
});

test.each(['paginated', 'scrolled'] as const)(
  '%s controls skip nonlinear sections and never wrap',
  async (flow) => {
    await renderReader();
    await makeReady();
    if (flow === 'scrolled') await switchToScrolled();
    expect(controlDisabled('Previous chapter')).toBe(true);
    await press('Next');
    await press('Next');
    expect(
      iframe.contentWindow.postMessage.mock.calls.filter(
        ([message]) => message.type === 'navigate',
      ),
    ).toHaveLength(1);
    expect(lastCommand()).toMatchObject({
      type: 'navigate',
      payload: { section: 2 },
    });
    await receive('command-ack', { command: 'navigate' });
    // An ack alone cannot commit a destination without its relocation.
    expect(controlDisabled('Previous chapter')).toBe(true);
    await receive('location', { index: 2, cfi: null, fraction: null });
    expect(controlDisabled('Next chapter')).toBe(true);
    expect(controlDisabled('Previous chapter')).toBe(false);
    await press('Previous');
    expect(lastCommand()).toMatchObject({
      type: 'navigate',
      payload: { section: 0 },
    });
    await receive('location', { index: 0, cfi: null, fraction: null });
    await receive('command-ack', { command: 'navigate' });
    expect(controlDisabled('Previous chapter')).toBe(true);
  },
);

test('chapter navigation and TOC are rejected while a flow command is pending', async () => {
  await renderReader();
  await makeReady();
  await press('Scrolled');
  expect(lastCommand()).toMatchObject({
    type: 'flow',
    payload: { flow: 'scrolled' },
  });
  const commandsBefore = iframe.contentWindow.postMessage.mock.calls.length;
  // pendingFlow 占用时，TOC 跳转与章节/页级导航都必须被互斥忽略。
  await press('Nonlinear');
  await press('Next');
  expect(
    iframe.contentWindow.postMessage.mock.calls
      .slice(commandsBefore)
      .filter(([message]) => message.type === 'navigate'),
  ).toHaveLength(0);
  // flow 完成后 navigation 恢复可用。
  await receive('model', { fixedLayout: false, flow: 'scrolled' });
  await receive('command-ack', { command: 'flow' });
  await press('Next');
  expect(lastCommand()).toMatchObject({
    type: 'navigate',
    payload: { section: 2 },
  });
});

test('controlled readingFlow is deferred while a navigation is pending and sent afterwards', async () => {
  await renderReader();
  await makeReady();
  await switchToScrolled();
  await press('Next');
  expect(lastCommand()).toMatchObject({
    type: 'navigate',
    payload: { section: 2 },
  });
  const commandsBefore = iframe.contentWindow.postMessage.mock.calls.length;
  // 受控 readingFlow 在导航在飞时到达：先不发。
  await act(async () => {
    renderer!.update(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onStateChange={(value) => states.push(value)}
        readingFlow="paginated"
        source={{ kind: 'uri', uri: 'blob:fixture' }}
      />,
    );
  });
  expect(
    iframe.contentWindow.postMessage.mock.calls
      .slice(commandsBefore)
      .filter(([message]) => message.type === 'flow'),
  ).toHaveLength(0);
  // 导航完成后用最新 readingFlow 重新协调，绝不永久丢弃。
  await receive('location', { index: 2, cfi: null, fraction: null });
  await receive('command-ack', { command: 'navigate' });
  await act(async () => undefined);
  expect(lastCommand()).toMatchObject({
    type: 'flow',
    payload: { flow: 'paginated' },
  });
  await receive('model', { fixedLayout: false, flow: 'paginated' });
  await receive('command-ack', { command: 'flow' });
});

test('controlled readingFlow is deferred during a section navigation and sent afterwards', async () => {
  await renderReader();
  await makeReady();
  await press('Next');
  expect(lastCommand()).toMatchObject({
    type: 'navigate',
    payload: { section: 2 },
  });
  const commandsBefore = iframe.contentWindow.postMessage.mock.calls.length;
  await act(async () => {
    renderer!.update(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onStateChange={(value) => states.push(value)}
        readingFlow="scrolled"
        source={{ kind: 'uri', uri: 'blob:fixture' }}
      />,
    );
  });
  expect(
    iframe.contentWindow.postMessage.mock.calls
      .slice(commandsBefore)
      .filter(([message]) => message.type === 'flow'),
  ).toHaveLength(0);
  await receive('location', { index: 2, cfi: null, fraction: null });
  await receive('command-ack', { command: 'navigate' });
  await act(async () => undefined);
  expect(lastCommand()).toMatchObject({
    type: 'flow',
    payload: { flow: 'scrolled' },
  });
  await receive('model', { fixedLayout: false, flow: 'scrolled' });
  await receive('command-ack', { command: 'flow' });
});

test('a stale generation completion cannot reconcile a deferred controlled flow', async () => {
  await renderReader();
  await makeReady();
  await press('Next');
  await act(async () => {
    renderer!.update(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onStateChange={(value) => states.push(value)}
        readingFlow="scrolled"
        source={{ kind: 'uri', uri: 'blob:fixture' }}
      />,
    );
  });
  // 过期 generation 的 navigation ack 不得触发 flow，也不得完成当前翻页。
  await receive(
    'command-ack',
    { command: 'navigate' },
    { generation: 'a'.repeat(48) },
  );
  expect(
    iframe.contentWindow.postMessage.mock.calls.filter(
      ([message]) => message.type === 'flow',
    ),
  ).toHaveLength(0);
  // 当前 generation 完成才协调最新 readingFlow。
  await receive('location', { index: 2, cfi: null, fraction: null });
  await receive('command-ack', { command: 'navigate' });
  await act(async () => undefined);
  expect(lastCommand()).toMatchObject({
    type: 'flow',
    payload: { flow: 'scrolled' },
  });
});

test('a benign navigation-busy rejection keeps the session live', async () => {
  await renderReader();
  await makeReady();
  await press('Next');
  await receive('error', { code: 'navigation-busy' });
  // 互斥拒绝是 no-op：会话保持 ready，pendingNavigation 被清理。
  expect(states.at(-1)).toEqual({ status: 'ready' });
  expect(iframe.remove).not.toHaveBeenCalled();
  await press('Next');
  expect(lastCommand()).toMatchObject({
    type: 'navigate',
    payload: { section: 2 },
  });
});

test('terminates on an unsolicited navigation acknowledgement', async () => {
  await renderReader();
  await makeReady();
  await receive('location', { index: 2, cfi: null, fraction: null });
  await receive('command-ack', { command: 'navigate' });

  expect(states.at(-1)).toMatchObject({ status: 'error' });
  expect(iframe.remove).toHaveBeenCalledTimes(1);
});

test('terminates a failed paginated navigation command', async () => {
  await renderReader();
  await makeReady();
  await press('Next');
  await receive('error', { code: 'navigation-failure' });

  expect(states.at(-1)).toMatchObject({
    error: { category: 'render' },
    status: 'error',
  });
  expect(iframe.remove).toHaveBeenCalledTimes(1);
});

test('terminates a timed-out section navigation without waiting for a relocate', async () => {
  jest.useFakeTimers();
  try {
    await renderReader(undefined, 25);
    await makeReady();
    await press('Next');
    expect(lastCommand()).toMatchObject({ type: 'navigate' });
    await act(async () => {
      jest.advanceTimersByTime(25);
    });
    expect(states.at(-1)).toMatchObject({
      error: { category: 'render' },
      status: 'error',
    });
    expect(iframe.remove).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('accepts the bootstrap wire order of matching linear location then acknowledgement', async () => {
  await renderReader();
  await makeReady();
  await switchToScrolled();
  await press('Next');
  await receive('location', { index: 2, cfi: null, fraction: null });

  // A matching location is evidence, but not permission to commit until the
  // bootstrap's subsequent command acknowledgement arrives.
  expect(
    renderer!.root
      .findAllByProps({ accessibilityLabel: 'Chapter position' })[0]
      ?.children.join(''),
  ).toContain('Chapter 1 of 2');
  expect(iframe.remove).not.toHaveBeenCalled();
  await receive('command-ack', { command: 'navigate' });
  expect(
    renderer!.root
      .findAllByProps({ accessibilityLabel: 'Chapter position' })[0]
      ?.children.join(''),
  ).toContain('Chapter 2 of 2');
  expect(states.at(-1)).toEqual({ status: 'ready' });
  expect(iframe.remove).not.toHaveBeenCalled();
});

test('also commits an ack-first linear navigation only after its matching location', async () => {
  await renderReader();
  await makeReady();
  await switchToScrolled();
  await press('Next');
  await receive('command-ack', { command: 'navigate' });
  expect(
    renderer!.root
      .findAllByProps({ accessibilityLabel: 'Chapter position' })[0]
      ?.children.join(''),
  ).toContain('Chapter 1 of 2');
  await receive('location', { index: 2, cfi: null, fraction: null });
  expect(
    renderer!.root
      .findAllByProps({ accessibilityLabel: 'Chapter position' })[0]
      ?.children.join(''),
  ).toContain('Chapter 2 of 2');
  expect(iframe.remove).not.toHaveBeenCalled();
});

test('retires navigation on failure so a late matching location cannot change position', async () => {
  await renderReader();
  await makeReady();
  await switchToScrolled();
  await press('Next');
  await receive('error', { code: 'navigation-failure' });
  expect(states.at(-1)).toMatchObject({ status: 'error' });
  await receive('location', { index: 2, cfi: null, fraction: null });
  expect(
    renderer!.root.findAllByProps({ accessibilityLabel: 'Chapter position' }),
  ).toHaveLength(0);
  expect(iframe.remove).toHaveBeenCalledTimes(1);
});

test('retires the session when a pending navigation receives a mismatched location', async () => {
  await renderReader();
  await makeReady();
  await switchToScrolled();
  await press('Next');
  await receive('location', { index: 0, cfi: null, fraction: null });

  expect(states.at(-1)).toMatchObject({
    error: { category: 'render' },
    status: 'error',
  });
  expect(iframe.remove).toHaveBeenCalledTimes(1);
});

test('commits reflow only after matching model report and authenticated ack', async () => {
  const onReadingFlowChange = jest.fn();
  await renderReader();
  await makeReady();
  await act(async () => {
    renderer!.update(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onReadingFlowChange={onReadingFlowChange}
        onStateChange={(value) => states.push(value)}
        readingFlow="scrolled"
        source={{ kind: 'uri', uri: 'blob:fixture' }}
      />,
    );
  });
  expect(lastCommand()).toMatchObject({
    type: 'flow',
    payload: { flow: 'scrolled' },
  });
  await receive('model', { fixedLayout: false, flow: 'scrolled' });
  await receive('command-ack', { command: 'flow' });
  expect(onReadingFlowChange).not.toHaveBeenCalled();
  expect(
    renderer!.root.findAllByProps({
      accessibilityLabel: 'Scrolled reading flow',
    })[0]?.props.accessibilityState.selected,
  ).toBe(true);
});

test('keeps flow unavailable for an authenticated fixed-layout model', async () => {
  await renderReader();
  await passProbe();
  await receive('publication-model', {
    model: canonicalModel({ fixedLayout: true, flow: null }),
  });
  await receive('model', { fixedLayout: true, flow: null });
  await receive('ready');

  expect(
    renderer!.root.findAllByProps({
      accessibilityLabel: 'Fixed-layout publication',
    }),
  ).toHaveLength(1);
  expect(
    renderer!.root.findAllByProps({ accessibilityLabel: 'Reading flow' }),
  ).toHaveLength(0);
  // 固定版式保持章节语义：无页级标签，且沿用章节边界禁用。
  expect(controlDisabled('Previous chapter')).toBe(true);
  expect(controlDisabled('Previous page')).toBeUndefined();
  expect(controlDisabled('Next page')).toBeUndefined();
});

test('terminates a session on an authenticated command acknowledgement without a pending operation', async () => {
  await renderReader();
  await makeReady();
  await receive('command-ack', { command: 'flow' });

  expect(states.at(-1)).toMatchObject({
    error: { category: 'render' },
    status: 'error',
  });
  expect(iframe.remove).toHaveBeenCalledTimes(1);
});

test('terminates a timed-out navigation session so a late acknowledgement cannot complete another command', async () => {
  jest.useFakeTimers();
  try {
    await renderReader(undefined, 25);
    await makeReady();
    await switchToScrolled(25);
    await press('Next');
    const navigation = lastCommand();
    expect(navigation).toMatchObject({
      type: 'navigate',
      payload: { section: 2 },
    });
    await act(async () => {
      jest.advanceTimersByTime(25);
    });
    expect(states.at(-1)).toMatchObject({
      error: { category: 'render' },
      status: 'error',
    });
    expect(iframe.remove).toHaveBeenCalledTimes(1);
    await receive('location', { index: 2, cfi: null, fraction: null });
    await receive('command-ack', { command: 'navigate' });
    expect(states.at(-1)).toMatchObject({ status: 'error' });
    expect(
      iframe.contentWindow.postMessage.mock.calls.filter(
        ([message]) => message.type === 'navigate',
      ),
    ).toHaveLength(1);
  } finally {
    jest.useRealTimers();
  }
});

test('terminates a timed-out flow session and ignores its late model response', async () => {
  jest.useFakeTimers();
  try {
    await renderReader(undefined, 25);
    await makeReady();
    await act(async () => {
      renderer!.update(
        <NativeReader
          loadInactivityTimeoutMs={25}
          onStateChange={(value) => states.push(value)}
          readingFlow="scrolled"
          source={{ kind: 'uri', uri: 'blob:fixture' }}
        />,
      );
    });
    expect(lastCommand()).toMatchObject({
      type: 'flow',
      payload: { flow: 'scrolled' },
    });
    await act(async () => {
      jest.advanceTimersByTime(25);
    });
    await receive('model', { fixedLayout: false, flow: 'scrolled' });
    expect(states.at(-1)).toMatchObject({ status: 'error' });
    expect(
      renderer!.root.findAllByProps({
        accessibilityLabel: 'Scrolled reading flow',
      }),
    ).toHaveLength(0);
  } finally {
    jest.useRealTimers();
  }
});

test('replaces and unmounts sessions without accepting late source or bridge work', async () => {
  let resolveOld: (blob: Blob) => void = () => undefined;
  let oldSignal: AbortSignal | undefined;
  await renderReader();
  readPublication.mockImplementationOnce(
    (_uri, signal) =>
      new Promise<Blob>((resolve) => {
        resolveOld = resolve;
        oldSignal = signal;
      }),
  );
  await passProbe();
  const oldIframe = iframe;
  const replacementIframe = createIframe();
  (createReaderIframe as jest.Mock).mockReturnValueOnce(replacementIframe);
  await act(async () => {
    renderer!.update(
      <NativeReader
        loadInactivityTimeoutMs={0}
        onStateChange={(value) => states.push(value)}
        source={{ kind: 'uri', uri: 'blob:replacement' }}
      />,
    );
  });
  expect(oldIframe.remove).toHaveBeenCalledTimes(1);
  expect(oldSignal?.aborted).toBe(true);
  expect(oldIframe.removeEventListener).toHaveBeenCalledWith(
    'load',
    expect.any(Function),
  );
  resolveOld(new Blob(['late']));
  await act(async () => undefined);
  expect(
    oldIframe.contentWindow.postMessage.mock.calls.filter(
      ([message]) => message.type === 'open',
    ),
  ).toHaveLength(0);
  await act(async () => renderer!.unmount());
  expect(replacementIframe.remove).toHaveBeenCalledTimes(1);
  expect(replacementIframe.removeEventListener).toHaveBeenCalledWith(
    'load',
    expect.any(Function),
  );
});
