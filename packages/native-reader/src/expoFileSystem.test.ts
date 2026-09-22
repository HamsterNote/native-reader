const writeAsStringAsync = jest.fn();

jest.mock(
  'expo-file-system/legacy',
  () => ({
    bundleDirectory: 'file:///bundle/',
    cacheDirectory: 'file:///cache/',
    deleteAsync: jest.fn(),
    getInfoAsync: jest.fn(),
    readAsStringAsync: jest.fn(),
    writeAsStringAsync,
  }),
  { virtual: true },
);

import { createExpoFileSystem } from './expoFileSystem';

beforeEach(() => writeAsStringAsync.mockReset().mockResolvedValue(undefined));

test('builds one self-contained local HTML file for restrictive Android WebView', async () => {
  const fileSystem = createExpoFileSystem('file:///cache/session/')();
  await fileSystem.writeAsStringAsync(
    'file:///cache/session/jszip.min.js',
    'globalThis.JSZip = true;',
  );
  await fileSystem.writeAsStringAsync(
    'file:///cache/session/epub.min.js',
    'globalThis.ePub = true;',
  );
  await fileSystem.writeAsStringAsync(
    'file:///cache/session/index.html',
    '<script src="file:///cache/session/jszip.min.js"></script><script src="file:///cache/session/epub.min.js"></script>',
  );

  expect(writeAsStringAsync).toHaveBeenCalledTimes(1);
  expect(writeAsStringAsync).toHaveBeenCalledWith(
    'file:///cache/session/index.html',
    '<script>globalThis.JSZip = true;</script><script>globalThis.ePub = true;</script>',
    undefined,
  );
});
