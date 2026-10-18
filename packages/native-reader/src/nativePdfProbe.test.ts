const getInfoAsync = jest.fn();
const readAsStringAsync = jest.fn();
const copyAsync = jest.fn();
const deleteAsync = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync,
  readAsStringAsync,
  copyAsync,
  deleteAsync,
  EncodingType: { Base64: 'base64' },
}));

import { probeNativePdfSource } from './nativePdfProbe';
import { prepareNativeSource } from './nativeSource';
import { NATIVE_PUBLICATION_MAX_BYTES } from './nativePublicationTransfer';

const source = {
  kind: 'uri' as const,
  uri: 'file:///book.epub',
  name: 'book.epub',
};

beforeEach(() => {
  getInfoAsync
    .mockReset()
    .mockResolvedValue({ exists: true, isDirectory: false, size: 100 });
  readAsStringAsync
    .mockReset()
    .mockResolvedValue(Buffer.from('%PDF-').toString('base64'));
});

afterEach(() => {
  expect(copyAsync).not.toHaveBeenCalled();
  expect(deleteAsync).not.toHaveBeenCalled();
});

test('misnamed PDF without MIME yields only true after one five-byte read', async () => {
  expect(await probeNativePdfSource(source, () => true)).toBe(true);
  expect(readAsStringAsync.mock.calls).toEqual([
    [source.uri, { encoding: 'base64', position: 0, length: 5 }],
  ]);
});

test('a non-PDF prefix yields only false, never authority for Foliate', async () => {
  readAsStringAsync.mockResolvedValue(
    Buffer.from('PK\x03\x04x').toString('base64'),
  );
  expect(
    await probeNativePdfSource(
      { ...source, name: 'misleading.pdf', mimeType: 'application/pdf' },
      () => true,
    ),
  ).toBe(false);
  const reads = readAsStringAsync.mock.calls.length;
  await expect(prepareNativeSource(source, () => false)).rejects.toThrow(
    'gate is closed',
  );
  expect(readAsStringAsync).toHaveBeenCalledTimes(reads);
  expect(getInfoAsync).toHaveBeenCalledTimes(1);
});

test.each([
  'https://example.test/book.pdf',
  'http://example.test/book.pdf',
  'file://remote/book.pdf',
  'blob:source',
  'file:///bad%00.pdf',
])('rejects %s before even metadata I/O', async (uri) => {
  await expect(
    probeNativePdfSource({ ...source, uri }, () => true),
  ).rejects.toMatchObject({ readerError: { category: 'unsupported' } });
  expect(getInfoAsync).not.toHaveBeenCalled();
  expect(readAsStringAsync).not.toHaveBeenCalled();
});

test.each([
  undefined,
  NaN,
  Infinity,
  -1,
  0,
  1.5,
  NATIVE_PUBLICATION_MAX_BYTES + 1,
])('size %s cannot authorize a signature read', async (size) => {
  getInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size });
  await expect(probeNativePdfSource(source, () => true)).rejects.toMatchObject({
    readerError: { category: 'unsupported' },
  });
  expect(readAsStringAsync).not.toHaveBeenCalled();
});

test.each([{ exists: false }, { exists: true, isDirectory: true, size: 100 }])(
  'rejects absent files and directories without reading',
  async (info) => {
    getInfoAsync.mockResolvedValue(info);
    await expect(probeNativePdfSource(source, () => true)).rejects.toThrow();
    expect(readAsStringAsync).not.toHaveBeenCalled();
  },
);

test('known short files read no more than their size and are not PDF candidates', async () => {
  getInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 3 });
  readAsStringAsync.mockResolvedValue(Buffer.from('%PD').toString('base64'));
  expect(await probeNativePdfSource(source, () => true)).toBe(false);
  expect(readAsStringAsync.mock.calls[0][1].length).toBe(3);
});

test.each(['AA==', Buffer.alloc(6).toString('base64'), 'not-base64'])(
  'provider response %s fails closed',
  async (encoded) => {
    readAsStringAsync.mockResolvedValue(encoded);
    await expect(
      probeNativePdfSource(source, () => true),
    ).rejects.toMatchObject({ readerError: { category: 'read' } });
  },
);

test('retirement after metadata forbids reading; retirement after read forbids a routing result', async () => {
  let current = true;
  getInfoAsync.mockImplementation(async () => {
    current = false;
    return { exists: true, isDirectory: false, size: 100 };
  });
  await expect(probeNativePdfSource(source, () => current)).rejects.toThrow(
    'retired',
  );
  expect(readAsStringAsync).not.toHaveBeenCalled();
  current = true;
  getInfoAsync.mockResolvedValue({
    exists: true,
    isDirectory: false,
    size: 100,
  });
  readAsStringAsync.mockImplementation(async () => {
    current = false;
    return Buffer.from('%PDF-').toString('base64');
  });
  await expect(probeNativePdfSource(source, () => current)).rejects.toThrow(
    'retired',
  );
});
