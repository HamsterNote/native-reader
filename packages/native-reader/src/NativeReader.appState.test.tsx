import React, { forwardRef, useImperativeHandle, useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppState } from 'react-native';

import type { ReaderLoadState } from './types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type SecureWebViewProps = {
  onError?(): void;
  onLoad?(): void;
  onMessage?(event: { nativeEvent: { data: unknown } }): void;
  source: { nativeHost: 'foliate' };
};

type SecureWebViewHandle = { postMessage(data: string): void };

const sentMessages: string[] = [];
const secureWebViewInstances: SecureWebViewProps[] = [];
const mockPrepareNativeSource = jest.fn();
const mockFormatDetector = jest.fn();
const mockByteReader = jest.fn();
let errorDuringLayoutEffect = false;

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
}));

jest.mock('../secure-webview/src/HNSecureWebView.android', () => ({
  __esModule: true,
  default: forwardRef<SecureWebViewHandle, SecureWebViewProps>((props, ref) => {
    useImperativeHandle(ref, () => ({
      postMessage: (data) => sentMessages.push(data),
    }));
    useLayoutEffect(() => {
      if (errorDuringLayoutEffect) props.onError?.();
    }, [props]);
    secureWebViewInstances.push(props);
    return null;
  }),
}));

// The old adapter's source material pipeline must remain completely inert.
// Explicit mocks make an accidental reintroduction observable in this focused
// skeleton suite even if a future implementation only imports the module.
jest.mock('./nativeSource', () => ({
  prepareNativeSource: mockPrepareNativeSource,
}));
jest.mock('./formatDetection', () => ({
  detectReaderFormat: mockFormatDetector,
}));
jest.mock('./expoFileSystem', () => ({ createExpoFileSystem: mockByteReader }));

const { NativeReaderImplementation, StaticReaderState } = jest.requireActual(
  './NativeReaderImplementation.native',
) as typeof import('./NativeReaderImplementation.native');

const sentinelSource = Object.freeze({
  kind: 'uri' as const,
  // The value is deliberately a sensitive-looking sentinel. A source pipeline
  // must not read/copy it into a secure WebView prop or transport message.
  uri: 'file:///private/never-read/sentinel-publication.epub',
});

function currentWebView(): SecureWebViewProps {
  const value = secureWebViewInstances.at(-1);
  if (!value) throw new Error('Expected a secure native host');
  return value;
}

function bindCommand() {
  const data = sentMessages.at(-1);
  if (!data) throw new Error('Expected a bind command');
  return JSON.parse(data) as {
    commandId: string;
    generation: string;
    payload: Record<string, unknown>;
    session: string;
    type: string;
  };
}

function hostAck(
  command: ReturnType<typeof bindCommand>,
  session = command.session,
) {
  return JSON.stringify({
    protocol: 'hn-foliate-host',
    version: 1,
    direction: 'host-to-native',
    type: 'ack',
    session,
    generation: command.generation,
    commandId: command.commandId,
    payload: { command: 'bind', status: 'bridge-bound' },
  });
}

function stateNames(calls: jest.Mock<void, [ReaderLoadState]>) {
  return calls.mock.calls.map(([value]) => value.status);
}

function mountReader() {
  const onStateChange = jest.fn<void, [ReaderLoadState]>();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <NativeReaderImplementation
        onStateChange={onStateChange}
        source={sentinelSource}
      />,
    );
  });
  return { onStateChange, renderer };
}

beforeEach(() => {
  sentMessages.length = 0;
  secureWebViewInstances.length = 0;
  mockPrepareNativeSource.mockReset();
  mockFormatDetector.mockReset();
  mockByteReader.mockReset();
  errorDuringLayoutEffect = false;
});

test('uses the native-host sentinel and never starts the legacy source pipeline', () => {
  mountReader();

  expect(currentWebView().source).toEqual({ nativeHost: 'foliate' });
  expect(mockPrepareNativeSource).not.toHaveBeenCalled();
  expect(mockFormatDetector).not.toHaveBeenCalled();
  expect(mockByteReader).not.toHaveBeenCalled();
  expect(JSON.stringify(currentWebView())).not.toContain(sentinelSource.uri);
});

test('sends exactly one initial bind with three independent strong base64url IDs', () => {
  mountReader();
  const host = currentWebView();

  act(() => host.onLoad?.());
  act(() => host.onLoad?.());

  expect(sentMessages).toHaveLength(1);
  const command = bindCommand();
  expect(command.type).toBe('bind');
  expect(command.commandId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(command.generation).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(
    new Set([command.session, command.generation, command.commandId]).size,
  ).toBe(3);
  expect(command.payload).toEqual({});
  expect(command.session).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test('a matching bridge-bound acknowledgement does not expose reader ready', () => {
  const { onStateChange } = mountReader();
  const host = currentWebView();
  act(() => host.onLoad?.());
  act(() =>
    host.onMessage?.({ nativeEvent: { data: hostAck(bindCommand()) } }),
  );

  expect(stateNames(onStateChange)).toEqual(['loading']);
  expect(stateNames(onStateChange)).not.toContain('ready');
});

test('a stale acknowledgement has no state effect', () => {
  const { onStateChange } = mountReader();
  const host = currentWebView();
  act(() => host.onLoad?.());
  const command = bindCommand();
  act(() =>
    host.onMessage?.({
      nativeEvent: { data: hostAck(command, 'B'.repeat(43)) },
    }),
  );

  expect(stateNames(onStateChange)).toEqual(['loading']);
});

test('a malformed authenticated current-host message tears down to a safe error', () => {
  const { onStateChange } = mountReader();
  const host = currentWebView();
  act(() => host.onLoad?.());
  act(() => host.onMessage?.({ nativeEvent: { data: '{bad-json' } }));

  const terminal = onStateChange.mock.calls.at(-1)?.[0];
  expect(terminal).toEqual({
    status: 'error',
    error: expect.objectContaining({ category: 'unsupported' }),
  });
  expect(terminal).not.toEqual(
    expect.objectContaining({ message: expect.stringContaining('sentinel') }),
  );
  // The session is terminal after the violation; later traffic is inert.
  act(() =>
    host.onMessage?.({ nativeEvent: { data: hostAck(bindCommand()) } }),
  );
  expect(stateNames(onStateChange)).toEqual(['loading', 'error']);
});

test('a throwing protocol validator tears down without escaping the message callback', () => {
  const originalTextEncoder = globalThis.TextEncoder;
  const { onStateChange } = mountReader();
  const host = currentWebView();
  act(() => host.onLoad?.());
  globalThis.TextEncoder = class {
    encode() {
      throw new Error('sensitive validator failure');
    }
  } as typeof TextEncoder;

  try {
    expect(() => {
      act(() =>
        host.onMessage?.({ nativeEvent: { data: hostAck(bindCommand()) } }),
      );
    }).not.toThrow();
    expect(stateNames(onStateChange)).toEqual(['loading', 'error']);
    expect(JSON.stringify(onStateChange.mock.calls.at(-1))).not.toContain(
      'sensitive validator failure',
    );
    // Terminal teardown clears the transport: a later load callback cannot bind.
    act(() => host.onLoad?.());
    expect(sentMessages).toHaveLength(1);
  } finally {
    globalThis.TextEncoder = originalTextEncoder;
  }
});

test('missing secure randomness fails closed before mounting a native host', () => {
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: undefined,
  });

  try {
    const { onStateChange } = mountReader();
    expect(secureWebViewInstances).toHaveLength(0);
    expect(sentMessages).toHaveLength(0);
    expect(stateNames(onStateChange)).toEqual(['error']);
    expect(JSON.stringify(onStateChange.mock.calls)).not.toContain('file:');
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  }
});

test.each([2, 3])(
  'entropy failure allocating ID %s never mounts a partially bound host',
  (failureAt) => {
    const originalCrypto = globalThis.crypto;
    let calls = 0;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues(bytes: Uint8Array) {
          if (++calls === failureAt) throw new Error('entropy unavailable');
          return bytes.fill(calls);
        },
      },
    });
    try {
      const { onStateChange } = mountReader();
      expect(secureWebViewInstances).toHaveLength(0);
      expect(sentMessages).toHaveLength(0);
      expect(stateNames(onStateChange)).toEqual(['error']);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
      });
    }
  },
);

test('a throwing crypto getter fails closed before mounting a native host', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    get() {
      throw new Error('sensitive crypto getter failure');
    },
  });

  try {
    const { onStateChange } = mountReader();
    expect(secureWebViewInstances).toHaveLength(0);
    expect(sentMessages).toHaveLength(0);
    expect(stateNames(onStateChange)).toEqual(['error']);
    expect(JSON.stringify(onStateChange.mock.calls)).not.toContain(
      'sensitive crypto getter failure',
    );
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
});

test('a throwing getRandomValues fails closed before mounting or sending bind', () => {
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues() {
        throw new Error('sensitive entropy failure');
      },
    },
  });

  try {
    const { onStateChange } = mountReader();
    expect(secureWebViewInstances).toHaveLength(0);
    expect(sentMessages).toHaveLength(0);
    expect(stateNames(onStateChange)).toEqual(['error']);
    expect(JSON.stringify(onStateChange.mock.calls)).not.toContain(
      'sensitive entropy failure',
    );
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  }
});

test('a throwing getRandomValues getter fails closed before mounting a native host', () => {
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: Object.defineProperty({}, 'getRandomValues', {
      get() {
        throw new Error('sensitive randomness getter failure');
      },
    }),
  });

  try {
    const { onStateChange } = mountReader();
    expect(secureWebViewInstances).toHaveLength(0);
    expect(sentMessages).toHaveLength(0);
    expect(stateNames(onStateChange)).toEqual(['error']);
    expect(JSON.stringify(onStateChange.mock.calls)).not.toContain(
      'sensitive randomness getter failure',
    );
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  }
});

test('a synchronous host layout error stays terminal and never sends bind', () => {
  errorDuringLayoutEffect = true;
  const { onStateChange } = mountReader();

  expect(stateNames(onStateChange)).toEqual(['error']);
  expect(sentMessages).toHaveLength(0);
});

test('unmount detaches the private relay before later host traffic arrives', () => {
  const { onStateChange, renderer } = mountReader();
  const host = currentWebView();
  act(() => host.onLoad?.());
  const command = bindCommand();
  act(() => renderer.unmount());
  act(() => {
    host.onMessage?.({ nativeEvent: { data: '{bad-json' } });
  });
  act(() => {
    host.onMessage?.({ nativeEvent: { data: hostAck(command) } });
  });

  expect(stateNames(onStateChange)).toEqual(['loading']);
});

test('source replacement retires the old session before the new host can bind', () => {
  const { onStateChange, renderer } = mountReader();
  const firstHost = currentWebView();
  act(() => firstHost.onLoad?.());
  const firstCommand = bindCommand();
  const replacement = { ...sentinelSource, name: 'replacement' };
  act(() => {
    renderer.update(
      <NativeReaderImplementation
        onStateChange={onStateChange}
        source={replacement}
      />,
    );
  });
  const secondHost = currentWebView();
  act(() =>
    firstHost.onMessage?.({ nativeEvent: { data: hostAck(firstCommand) } }),
  );
  act(() => secondHost.onLoad?.());

  expect(sentMessages).toHaveLength(2);
  expect(bindCommand().session).not.toBe(firstCommand.session);
  expect(stateNames(onStateChange)).toEqual(['loading', 'loading']);
});

test('native host errors remain stable unsupported errors without source details', () => {
  const { onStateChange } = mountReader();
  const host = currentWebView();
  act(() => host.onError?.());
  act(() => host.onError?.());

  expect(stateNames(onStateChange)).toEqual(['loading', 'error']);
  const error = onStateChange.mock.calls.at(-1)?.[0];
  expect(error).toEqual({
    status: 'error',
    error: {
      category: 'unsupported',
      code: 'UNSUPPORTED_EPUB',
      message: 'The native publication host is unavailable.',
    },
  });
  expect(JSON.stringify(error)).not.toContain('file:');
  expect(JSON.stringify(error)).not.toContain('private');
});

test('static fallback still de-duplicates matching public states', () => {
  const onStateChange = jest.fn<void, [ReaderLoadState]>();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <StaticReaderState
        props={{ onStateChange }}
        state={{ status: 'loading' }}
      />,
    );
  });
  act(() => {
    renderer.update(
      <StaticReaderState
        props={{ onStateChange }}
        state={{ status: 'loading' }}
      />,
    );
  });
  expect(onStateChange).toHaveBeenCalledTimes(1);
});

test('background retires the channel synchronously and foreground creates a fresh binding', () => {
  const { onStateChange, renderer } = mountReader();
  const host = currentWebView();
  act(() => host.onLoad?.());
  const first = bindCommand();
  const listener = (AppState.addEventListener as jest.Mock).mock.calls.at(
    -1,
  )[1];
  act(() => {
    listener('background');
    host.onMessage?.({ nativeEvent: { data: '{bad-json' } });
    host.onLoad?.();
  });
  expect(sentMessages).toHaveLength(1);
  expect(stateNames(onStateChange)).not.toContain('error');
  act(() =>
    (AppState.addEventListener as jest.Mock).mock.calls.at(-1)[1]('active'),
  );
  const replacement = currentWebView();
  act(() => replacement.onLoad?.());
  expect(sentMessages).toHaveLength(2);
  expect(bindCommand().generation).not.toBe(first.generation);
  act(() => host.onError?.());
  expect(stateNames(onStateChange)).not.toContain('error');
  const subscription = (AppState.addEventListener as jest.Mock).mock.results.at(
    -1,
  )!.value;
  act(() => renderer.unmount());
  expect(subscription.remove).toHaveBeenCalledTimes(1);
  expect(mockPrepareNativeSource).not.toHaveBeenCalled();
  expect(mockByteReader).not.toHaveBeenCalled();
});

test('an initially background app never mounts or binds a host', () => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });
  try {
    const { renderer } = mountReader();
    expect(secureWebViewInstances).toHaveLength(0);
    expect(sentMessages).toHaveLength(0);
    act(() => renderer.unmount());
  } finally {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
  }
});

test('a rapid background/active pair in one React batch still recreates the channel', () => {
  const { renderer } = mountReader();
  act(() => currentWebView().onLoad?.());
  const first = bindCommand();
  const listener = (AppState.addEventListener as jest.Mock).mock.calls.at(
    -1,
  )[1];
  act(() => {
    listener('background');
    listener('active');
  });
  act(() => currentWebView().onLoad?.());
  expect(sentMessages).toHaveLength(2);
  expect(bindCommand().generation).not.toBe(first.generation);
  act(() => renderer.unmount());
});
