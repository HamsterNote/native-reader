import React, { forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { PdfKitViewProps } from './pdfKitHost';

const mockChrome = jest.fn();
const mockNative = jest.fn();
const mockCommand = jest.fn(async (value: Record<string, unknown>) => {
  const { uri: _uri, timeoutMs: _timeout, ...envelope } = value;
  void [_uri, _timeout];
  return { ...envelope, type: 'result', result: true };
});
jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('./PdfChrome', () => ({
  PdfChrome: (
    props: Record<string, unknown> & {
      children: React.ReactNode;
      rootRef(view: unknown): void;
    },
  ) => {
    mockChrome(props);
    props.rootRef({
      measureInWindow: (done: (x: number, y: number) => void) => done(10, 20),
    });
    return props.children;
  },
}));
import { PdfReaderIOS } from './PdfReader.ios';
const Host = forwardRef(function MockHost(props: PdfKitViewProps, ref) {
  mockNative(props);
  useImperativeHandle(ref, () => ({ command: mockCommand }));
  return null;
});
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer;
afterEach(() => {
  act(() => mounted?.unmount());
});

test('RN coordinates include reader offsets; keyed replacement revokes late native events', async () => {
  const onStateChange = jest.fn();
  const onPdfPageChange = jest.fn();
  const render = (uri: string) => (
    <PdfReaderIOS
      key={uri}
      source={{ kind: 'uri', uri }}
      host={Host}
      onStateChange={onStateChange}
      onPdfPageChange={onPdfPageChange}
    />
  );
  await act(async () => {
    mounted = create(render('file:///a.pdf'), {
      createNodeMock: () => ({
        measureInWindow: (done: (x: number, y: number) => void) =>
          done(162, 68),
      }),
    });
  });
  const first = mockCommand.mock.calls.find(
    ([value]) => value.type === 'open',
  )![0];
  const emit = mockNative.mock.calls.at(-1)![0].onPdfEvent;
  const native = (type: string, extra: Record<string, unknown>) => ({
    nativeEvent: {
      protocol: 'hamster-pdf',
      version: 1,
      sessionId: first.sessionId,
      generation: first.generation,
      commandId: 0,
      type,
      ...extra,
    },
  });
  const page = {
    sessionId: first.sessionId,
    generation: first.generation,
    pageCount: 3,
    pageNumber: 1,
  };
  await act(async () => {
    emit(native('state', { state: { ...page, status: 'ready' } }));
    emit(native('page', { page }));
    emit(
      native('selection', {
        selection: {
          sessionId: first.sessionId,
          generation: first.generation,
          selectionId: 'sel',
          text: 'Selected PDF text',
          coordinateSpace: 'reader',
          rects: [{ x: 5, y: 6, width: 10, height: 12 }],
        },
      }),
    );
  });
  expect(mockChrome.mock.calls.at(-1)![0].selection.rects).toEqual([
    { x: 157, y: 54, width: 10, height: 12 },
  ]);
  expect(onPdfPageChange).toHaveBeenLastCalledWith(page);
  await act(async () => {
    mounted.update(render('file:///b.pdf'));
  });
  const second = mockCommand.mock.calls
    .filter(([value]) => value.type === 'open')
    .at(-1)![0];
  expect(second.sessionId).not.toBe(first.sessionId);
  expect(second.generation).not.toBe(first.generation);
  expect(mockChrome.mock.calls.at(-1)![0].selection).toBeNull();
  expect(mockChrome.mock.calls.at(-1)![0].page).toBeNull();
  const before = onStateChange.mock.calls.length;
  await act(async () => {
    emit(native('state', { state: { ...page, status: 'ready' } }));
    // Also replay the old packet through the *current* view's event callback.
    mockNative.mock.calls.at(-1)![0].onPdfEvent(native('page', { page }));
  });
  expect(onStateChange).toHaveBeenCalledTimes(before);
  expect(onPdfPageChange).toHaveBeenCalledTimes(1);
  expect(
    mockCommand.mock.calls.filter(([value]) => value.type === 'dispose'),
  ).toHaveLength(1);
});
