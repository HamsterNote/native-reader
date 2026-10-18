import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { AndroidPdfHandle, AndroidPdfHostProps } from './androidHost';
type ChromeProps = React.ComponentProps<typeof import('./PdfChrome').PdfChrome>;

let mockSequence = 0;
let mockChrome: ChromeProps;
let mockHost: AndroidPdfHostProps;
const mockCommands = jest.fn();
jest.mock('expo-crypto', () => ({
  randomUUID: () =>
    `00000000-0000-0000-0000-${String(++mockSequence).padStart(12, '0')}`,
}));
jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('./PdfChrome', () => ({
  PdfChrome: (props: ChromeProps) => {
    mockChrome = props;
    return React.createElement('Root', { ref: props.rootRef }, props.children);
  },
}));
import { PdfReaderAndroid } from './PdfReader.android';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const Host = React.forwardRef<AndroidPdfHandle, AndroidPdfHostProps>(
  (props, ref) => {
    mockHost = props;
    React.useImperativeHandle(ref, () => ({ setNativeProps: mockCommands }));
    return null;
  },
);
test('RN selection adds measured view offset; keyed replacement retires old events and source state', async () => {
  const onStateChange = jest.fn();
  const onPdfPageChange = jest.fn();
  let renderer!: ReactTestRenderer;
  const source = { kind: 'uri' as const, uri: 'file:///cache/first.pdf' };
  await act(async () => {
    renderer = create(
      <PdfReaderAndroid
        key="A"
        source={source}
        host={Host}
        onStateChange={onStateChange}
        onPdfPageChange={onPdfPageChange}
      />,
      {
        createNodeMock: (element) => ({
          measureInWindow: (callback: (x: number, y: number) => void) => {
            callback(
              element.type === 'Root' ? 10 : 30,
              element.type === 'Root' ? 20 : 80,
            );
          },
        }),
      },
    );
  });
  const config = JSON.parse(mockHost!.configuration);
  const oldReceive = mockHost!.onPdfMessage;
  const event = (value: Record<string, unknown>) =>
    ({
      nativeEvent: {
        data: JSON.stringify({
          protocol: 'hamster-pdf',
          version: 1,
          sessionId: config.sessionId,
          generation: config.generation,
          commandId: 0,
          ...value,
        }),
      },
    }) as Parameters<AndroidPdfHostProps['onPdfMessage']>[0];
  await act(async () => {
    oldReceive(event({ type: 'boot' }));
    oldReceive(
      event({
        type: 'state',
        state: {
          sessionId: config.sessionId,
          generation: config.generation,
          status: 'ready',
          pageCount: 2,
          pageNumber: 1,
        },
      }),
    );
    oldReceive(
      event({
        type: 'selection',
        selection: {
          sessionId: config.sessionId,
          generation: config.generation,
          selectionId: 'selected',
          text: 'Selected PDF',
          coordinateSpace: 'reader',
          rects: [{ x: 2, y: 3, width: 10, height: 8 }],
        },
      }),
    );
  });
  expect(mockChrome!.selection!.rects[0]).toEqual({
    x: 22,
    y: 63,
    width: 10,
    height: 8,
  });
  expect(onPdfPageChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ pageNumber: 1, pageCount: 2 }),
  );
  await act(async () => {
    renderer.update(
      <PdfReaderAndroid
        key="B"
        source={{ kind: 'uri', uri: 'file:///cache/second.pdf' }}
        host={Host}
        onStateChange={onStateChange}
        onPdfPageChange={onPdfPageChange}
      />,
    );
  });
  expect(mockChrome!.selection).toBeNull();
  expect(mockChrome!.page).toBeNull();
  expect(JSON.parse(mockHost!.configuration).sessionId).not.toBe(
    config.sessionId,
  );
  const calls = onStateChange.mock.calls.length;
  await act(async () => {
    oldReceive(
      event({
        type: 'state',
        state: {
          sessionId: config.sessionId,
          generation: config.generation,
          status: 'error',
          error: { category: 'read', code: 'old', message: 'old source' },
        },
      }),
    );
  });
  expect(onStateChange).toHaveBeenCalledTimes(calls);
  await act(async () => renderer.unmount());
  const unmountedCalls = onStateChange.mock.calls.length;
  await act(async () => oldReceive(event({ type: 'boot' })));
  expect(onStateChange).toHaveBeenCalledTimes(unmountedCalls);
});
