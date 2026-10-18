import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mockIosHost = jest.fn();
const mockAndroidHost = jest.fn();
const mockIosRender = jest.fn((_props: unknown) => null);
const mockAndroidRender = jest.fn((_props: unknown) => null);
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value },
  Text: 'Text',
  View: 'View',
}));
jest.mock('./pdf/pdfKitHost', () => ({ getPdfKitHost: mockIosHost }));
jest.mock('./pdf/androidHost', () => ({ getAndroidPdfHost: mockAndroidHost }));
jest.mock('./pdf/PdfReader.ios', () => ({ PdfReaderIOS: mockIosRender }));
jest.mock('./pdf/PdfReader.android', () => ({
  PdfReaderAndroid: mockAndroidRender,
}));
import { Platform } from 'react-native';
import { NativePdfReader } from './NativePdfReader.native';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => jest.clearAllMocks());

test.each(['ios', 'android'] as const)(
  '%s queries and renders only its selected native host',
  async (platform) => {
    Platform.OS = platform;
    const host = () => null;
    mockIosHost.mockReturnValue(host);
    mockAndroidHost.mockReturnValue(host);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <NativePdfReader source={{ kind: 'uri', uri: 'file:///local.pdf' }} />,
      );
    });
    const selected = platform === 'ios' ? mockIosHost : mockAndroidHost;
    const other = platform === 'ios' ? mockAndroidHost : mockIosHost;
    const render = platform === 'ios' ? mockIosRender : mockAndroidRender;
    const otherRender = platform === 'ios' ? mockAndroidRender : mockIosRender;
    expect(selected).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(render.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ host }),
    );
    expect(otherRender).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  },
);

test.each(['ios', 'android'] as const)(
  '%s missing host fails closed without loading either renderer',
  async (platform) => {
    Platform.OS = platform;
    mockIosHost.mockReturnValue(null);
    mockAndroidHost.mockReturnValue(null);
    const onStateChange = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <NativePdfReader
          source={{ kind: 'uri', uri: 'file:///local.pdf' }}
          onStateChange={onStateChange}
        />,
      );
    });
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'PDF_CAPABILITY_UNAVAILABLE' }),
      }),
    );
    expect(mockIosRender).not.toHaveBeenCalled();
    expect(mockAndroidRender).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  },
);
