import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mockRegistryGet = jest.fn().mockReturnValue(null);
const mockGetInfo = jest.fn();
const mockRead = jest.fn();
const mockImplementationRender = jest.fn();

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
  TurboModuleRegistry: { get: mockRegistryGet },
}));
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: mockGetInfo,
  readAsStringAsync: mockRead,
  EncodingType: { Base64: 'base64' },
}));
jest.mock('./NativeReaderImplementation.native', () => ({
  NativeReaderImplementation: mockImplementationRender,
}));

import { NativeReader } from './NativeReader.native';
import type { ReaderSource } from './types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const source: ReaderSource = { kind: 'uri', uri: 'file:///misnamed.epub' };
let mounted: ReactTestRenderer | undefined;

beforeEach(() => {
  mockGetInfo
    .mockReset()
    .mockResolvedValue({ exists: true, isDirectory: false, size: 100 });
  mockRead
    .mockReset()
    .mockResolvedValue(Buffer.from('%PDF-').toString('base64'));
});
afterEach(() => {
  act(() => mounted?.unmount());
  expect(mockImplementationRender).not.toHaveBeenCalled();
});

test('PDF bypasses unavailable Foliate capability, but missing PDF host fails without further I/O', async () => {
  const onStateChange = jest.fn();
  await act(async () => {
    mounted = create(
      <NativeReader source={source} onStateChange={onStateChange} />,
    );
  });
  expect(mockRegistryGet).not.toHaveBeenCalled();
  expect(onStateChange).toHaveBeenLastCalledWith({
    status: 'error',
    error: expect.objectContaining({ code: 'PDF_CAPABILITY_UNAVAILABLE' }),
  });
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockRead.mock.calls[0][1].length).toBe(5);
  expect(onStateChange).not.toHaveBeenCalledWith({ status: 'ready' });
});

test('non-PDF still requires the unchanged Foliate capability after the boolean probe', async () => {
  mockRead.mockResolvedValue(Buffer.from('PK\x03\x04x').toString('base64'));
  const onStateChange = jest.fn();
  await act(async () => {
    mounted = create(
      <NativeReader source={source} onStateChange={onStateChange} />,
    );
  });
  expect(mockRegistryGet).toHaveBeenCalledWith('HNSecureWebViewModule');
  expect(onStateChange).toHaveBeenLastCalledWith({
    status: 'error',
    error: expect.objectContaining({ code: 'NATIVE_CAPABILITY_UNAVAILABLE' }),
  });
  expect(mockRead).toHaveBeenCalledTimes(1);
});

test('unknown size cannot read or reach either renderer capability', async () => {
  mockGetInfo.mockResolvedValue({ exists: true, isDirectory: false });
  const onStateChange = jest.fn();
  await act(async () => {
    mounted = create(
      <NativeReader source={source} onStateChange={onStateChange} />,
    );
  });
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockRegistryGet).not.toHaveBeenCalled();
  expect(onStateChange).toHaveBeenLastCalledWith({
    status: 'error',
    error: expect.objectContaining({ category: 'unsupported' }),
  });
});

test('replacing or clearing an in-flight source prevents its late metadata from reading', async () => {
  let complete!: (info: unknown) => void;
  mockGetInfo.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const onStateChange = jest.fn();
  await act(async () => {
    mounted = create(
      <NativeReader source={source} onStateChange={onStateChange} />,
    );
  });
  await act(async () => {
    mounted!.update(<NativeReader onStateChange={onStateChange} />);
  });
  onStateChange.mockClear();
  await act(async () => {
    complete({ exists: true, isDirectory: false, size: 100 });
  });
  expect(mockRead).not.toHaveBeenCalled();
  expect(onStateChange).not.toHaveBeenCalled();
});
