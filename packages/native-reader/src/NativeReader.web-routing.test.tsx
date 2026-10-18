import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { NativeReader } from './NativeReader.web';
import { probeWebPdfSource } from './pdf/webSource';
import type { NativeReaderProps } from './types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (value: unknown) => value },
}));
jest.mock('./ReaderChrome', () => ({
  ReaderChrome: (props: { children: React.ReactNode }) =>
    React.createElement('FoliateSurface', null, props.children),
}));
jest.mock('./pdf/PdfReader.web', () => ({
  PdfReaderWeb: (props: NativeReaderProps) =>
    React.createElement('PdfSurface', { name: props.source?.name }),
}));
jest.mock('./pdf/webSource', () => ({ probeWebPdfSource: jest.fn() }));
const probe = jest.mocked(probeWebPdfSource);
let renderer: ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
});
const source = (name: string) => ({
  kind: 'uri' as const,
  uri: `blob:https://reader.test/${name}`,
  name,
});
test('late candidate A cannot replace candidate B, and clearing removes the PDF surface', async () => {
  let finish!: (value: { pdf: boolean; size: number }) => void;
  probe
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ pdf: true, size: 100 });
  const onStateChange = jest.fn();
  await act(async () => {
    renderer = create(
      <NativeReader source={source('A')} onStateChange={onStateChange} />,
    );
  });
  await act(async () => {
    renderer.update(
      <NativeReader source={source('B')} onStateChange={onStateChange} />,
    );
  });
  expect(renderer.root.findByType('PdfSurface' as never).props.name).toBe('B');
  await act(async () => {
    finish({ pdf: true, size: 100 });
  });
  expect(renderer.root.findByType('PdfSurface' as never).props.name).toBe('B');
  await act(async () => {
    renderer.update(<NativeReader onStateChange={onStateChange} />);
  });
  expect(renderer.root.findAllByType('PdfSurface' as never)).toHaveLength(0);
  expect(onStateChange).toHaveBeenLastCalledWith({ status: 'idle' });
});
test('remote sources fail before the probe and unmounted probe rejection has no callback effect', async () => {
  const onStateChange = jest.fn();
  probe.mockClear();
  await act(async () => {
    renderer = create(
      <NativeReader
        source={{ kind: 'uri', uri: 'https://remote.test/book.pdf' }}
        onStateChange={onStateChange}
      />,
    );
  });
  expect(probe).not.toHaveBeenCalled();
  expect(onStateChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: 'error' }),
  );
  let reject!: (reason: Error) => void;
  probe.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await act(async () => {
    renderer.update(
      <NativeReader source={source('pending')} onStateChange={onStateChange} />,
    );
  });
  act(() => renderer.unmount());
  onStateChange.mockClear();
  await act(async () => {
    reject(new Error('retired'));
  });
  expect(onStateChange).not.toHaveBeenCalled();
});
