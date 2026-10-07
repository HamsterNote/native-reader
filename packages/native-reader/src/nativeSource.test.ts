const copyAsync = jest.fn();
const deleteAsync = jest.fn();
const makeDirectoryAsync = jest.fn();
const readAsStringAsync = jest.fn();

jest.mock(
  'expo-file-system/legacy',
  () => ({
    cacheDirectory: 'file:///cache/',
    copyAsync,
    deleteAsync,
    makeDirectoryAsync,
    readAsStringAsync,
    EncodingType: { Base64: 'base64' },
  }),
  { virtual: true },
);

import { prepareNativeSource } from './nativeSource';

beforeEach(() => {
  copyAsync.mockReset().mockResolvedValue(undefined);
  deleteAsync.mockReset().mockResolvedValue(undefined);
  makeDirectoryAsync.mockReset().mockResolvedValue(undefined);
  readAsStringAsync.mockReset().mockResolvedValue('UEsDBAoAAAAA');
});

test('copies a host URI into the exact owned cache root and removes only that copy', async () => {
  const prepared = await prepareNativeSource('content://provider/document/42');

  expect(prepared.uri).toBe('UEsDBAoAAAAA');
  expect(prepared.sessionRoot).toMatch(
    /^file:\/\/\/cache\/hamster-note-native-reader\/session-[a-f0-9]+-\d+\/$/,
  );
  expect(copyAsync).toHaveBeenCalledWith({
    from: 'content://provider/document/42',
    to: expect.stringMatching(/\/publication\.epub$/),
  });
  expect(makeDirectoryAsync).toHaveBeenCalledWith(
    prepared.sessionRoot,
    { intermediates: true },
  );
  expect(prepared.sessionRoot).toContain(
    'file:///cache/hamster-note-native-reader/session-',
  );
  expect(readAsStringAsync).toHaveBeenCalledWith(
    expect.stringMatching(/\/publication\.epub$/),
    { encoding: 'base64' },
  );

  await prepared.cleanup();
  expect(deleteAsync).toHaveBeenCalledWith(prepared.sessionRoot, {
    idempotent: true,
  });
});

test('gives concurrent readers independent owned copies and cleanup', async () => {
  const first = await prepareNativeSource('content://provider/document/42');
  const second = await prepareNativeSource('content://provider/document/42');

  expect(first.sessionRoot).not.toBe(second.sessionRoot);
  expect(first.sessionRoot).toMatch(
    /^file:\/\/\/cache\/hamster-note-native-reader\/session-/,
  );
  expect(second.sessionRoot).toMatch(
    /^file:\/\/\/cache\/hamster-note-native-reader\/session-/,
  );
  await first.cleanup();
  expect(deleteAsync).toHaveBeenCalledWith(first.sessionRoot, {
    idempotent: true,
  });
  expect(deleteAsync).not.toHaveBeenCalledWith(second.sessionRoot, {
    idempotent: true,
  });
});

test('isolates caller-owned file URIs in an owned session', async () => {
  const prepared = await prepareNativeSource('file:///documents/book.epub');
  await prepared.cleanup();

  expect(prepared.uri).toBe('UEsDBAoAAAAA');
  expect(copyAsync).toHaveBeenCalledWith({
    from: 'file:///documents/book.epub',
    to: expect.stringMatching(/\/publication\.epub$/),
  });
  expect(prepared.sessionRoot).toMatch(
    /^file:\/\/\/cache\/hamster-note-native-reader\/session-/,
  );
  expect(deleteAsync).toHaveBeenCalledWith(prepared.sessionRoot, {
    idempotent: true,
  });
});

test('removes a partial session when base64 delivery preparation fails', async () => {
  readAsStringAsync.mockRejectedValueOnce(new Error('read failed'));

  await expect(
    prepareNativeSource('content://provider/document/read-failure'),
  ).rejects.toThrow('read failed');
  expect(deleteAsync).toHaveBeenCalledWith(
    expect.stringMatching(/^file:\/\/\/cache\/hamster-note-native-reader\/session-/),
    { idempotent: true },
  );
});

test('cleanup is best-effort when deleting a stale session fails', async () => {
  const prepared = await prepareNativeSource('content://provider/document/42');
  deleteAsync.mockRejectedValueOnce(new Error('delete failed'));

  await expect(prepared.cleanup()).resolves.toBeUndefined();
});

test('removes a partial session when copying fails', async () => {
  copyAsync.mockRejectedValueOnce(new Error('copy failed'));

  await expect(
    prepareNativeSource('content://provider/document/failure'),
  ).rejects.toThrow('copy failed');
  expect(deleteAsync).toHaveBeenCalledWith(
    expect.stringMatching(/^file:\/\/\/cache\/hamster-note-native-reader\/session-/),
    { idempotent: true },
  );
});
