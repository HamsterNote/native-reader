import { readFileSync } from 'node:fs';
import path from 'node:path';

const getInfoAsync = jest.fn();
const readAsStringAsync = jest.fn();
const deleteAsync = jest.fn();
const copyAsync = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync,
  readAsStringAsync,
  deleteAsync,
  copyAsync,
  EncodingType: { Base64: 'base64' },
}));

import { prepareNativeSource } from './nativeSource';
import { NATIVE_PUBLICATION_MAX_BYTES } from './nativePublicationTransfer';

const source = {
  kind: 'uri' as const,
  uri: 'content://provider/document/42',
  name: 'wrong.pdf',
};
const fixture = readFileSync(
  path.resolve(__dirname, '../../../fixtures/fb2/valid-navigation.fb2'),
);
let current: boolean;
beforeEach(() => {
  current = true;
  getInfoAsync.mockReset().mockResolvedValue({
    exists: true,
    isDirectory: false,
    size: fixture.length,
  });
  readAsStringAsync
    .mockReset()
    .mockImplementation(async (_uri, { position, length }) =>
      fixture.subarray(position, position + length).toString('base64'),
    );
});

afterEach(() => {
  expect(copyAsync).not.toHaveBeenCalled();
  expect(deleteAsync).not.toHaveBeenCalled();
});

test('preflight failure does not inspect the source or call any filesystem operation', async () => {
  const hostile = Object.defineProperty({}, 'kind', {
    get() {
      throw new Error('source inspected');
    },
  });
  await expect(
    prepareNativeSource(hostile as typeof source, () => false),
  ).rejects.toThrow('gate is closed');
  expect(getInfoAsync).not.toHaveBeenCalled();
  expect(readAsStringAsync).not.toHaveBeenCalled();
});

test.each([
  'https://host/book.fb2',
  'file://remote/book.fb2',
  'file:///bad%00.fb2',
  'content://provider\\book',
])('rejects source %s before I/O', async (uri) => {
  await expect(
    prepareNativeSource({ ...source, uri }, () => true),
  ).rejects.toThrow('local publication');
  expect(getInfoAsync).not.toHaveBeenCalled();
});

test.each([undefined, NaN, 0, -1, 1.5, NATIVE_PUBLICATION_MAX_BYTES + 1])(
  'rejects size %s without reading',
  async (size) => {
    getInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size });
    await expect(prepareNativeSource(source, () => current)).rejects.toThrow(
      'size',
    );
    expect(readAsStringAsync).not.toHaveBeenCalled();
  },
);

test('returns canonical metadata from content, uses bounded reads, erases only owned bytes', async () => {
  const prepared = await prepareNativeSource(source, () => current);
  expect(prepared.format).toBe('fb2');
  expect(prepared.name).toBe('book.fb2');
  expect(Buffer.from(prepared.bytes)).toEqual(fixture);
  expect(
    readAsStringAsync.mock.calls.every(
      ([, options]) =>
        options.length > 0 && options.length <= 65536 && options.position >= 0,
    ),
  ).toBe(true);
  prepared.cleanup();
  prepared.cleanup();
  expect(prepared.bytes.every((value) => value === 0)).toBe(true);
});

test('retired generation after asynchronous metadata cannot start a read', async () => {
  getInfoAsync.mockImplementation(async () => {
    current = false;
    return { exists: true, isDirectory: false, size: fixture.length };
  });
  await expect(prepareNativeSource(source, () => current)).rejects.toThrow(
    'gate is closed',
  );
  expect(readAsStringAsync).not.toHaveBeenCalled();
});

test('rejects truncated/oversized provider reads and never copies or deletes the source', async () => {
  readAsStringAsync.mockResolvedValue('AA==');
  await expect(prepareNativeSource(source, () => current)).rejects.toThrow();
  readAsStringAsync.mockImplementation(async (_uri, { length }) =>
    Buffer.alloc(length + 1).toString('base64'),
  );
  await expect(prepareNativeSource(source, () => current)).rejects.toThrow();
});
