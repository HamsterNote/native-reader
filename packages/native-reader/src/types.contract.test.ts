import type { NativeReaderProps, ReaderLoadState, ReaderSource } from './index';

const source: ReaderSource = {
  kind: 'uri',
  uri: 'file:///selected.epub',
  name: 'selected.epub',
  mimeType: 'application/epub+zip',
};
const complete: NativeReaderProps = {
  source,
  loadInactivityTimeoutMs: 30_000,
  onStateChange: (state: ReaderLoadState) => state.status,
  style: { padding: 1 },
  testID: 'reader',
};
const minimum: NativeReaderProps = {};

// @ts-expect-error DOM File is not a supported cross-platform source
const domFileSource: NativeReaderProps = { source: new File([], 'book.epub') };
const remoteSource: NativeReaderProps = {
  // @ts-expect-error remote-only source variants are not public API
  source: { kind: 'remote', uri: 'https://example.test/book.epub' },
};
// @ts-expect-error legacy placeholder content is not retained
const legacyContent: NativeReaderProps = { content: { id: 'sample' } };

test('accepts the documented public prop combinations', () => {
  expect(complete.source).toBe(source);
  expect(minimum.source).toBeUndefined();
  expect(domFileSource.source).toBeDefined();
  expect(remoteSource.source).toBeDefined();
  expect(legacyContent).toBeDefined();
  expect(complete.loadInactivityTimeoutMs).toBe(30_000);
});
