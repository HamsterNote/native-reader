import type {
  NativeReaderProps,
  ReaderByteSource,
  ReaderErrorCategory,
  ReaderLoadState,
  ReaderError,
  ReaderPublicationFormat,
  ReaderReadingFlow,
  ReaderLocalUri,
  ReaderSource,
} from './index';

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
  readingFlow: 'paginated',
  onReadingFlowChange: (nextFlow: ReaderReadingFlow) => nextFlow,
  style: { padding: 1 },
  testID: 'reader',
};
const minimum: NativeReaderProps = {};
const supportedFormat: ReaderPublicationFormat = 'kf8-azw3';
const flow: ReaderReadingFlow = 'scrolled';
const category: ReaderErrorCategory = 'drm';
const bytes: ReaderByteSource = {
  size: 4,
  read: async () => new Uint8Array([0, 0, 0, 0]),
};
const localUri: ReaderLocalUri = 'file:///book.epub';
const error: ReaderError = { category: 'drm', message: 'Protected' };
// @ts-expect-error ReaderError category is required for direct presentation
const missingCategory: ReaderError = { message: 'Incomplete error' };

// @ts-expect-error DOM File is not a supported cross-platform source
const domFileSource: NativeReaderProps = { source: new File([], 'book.epub') };
const remoteSource: NativeReaderProps = {
  // @ts-expect-error remote-only source variants are not public API
  source: { kind: 'remote', uri: 'https://example.test/book.epub' },
};
// @ts-expect-error opt-in static helper rejects remote HTTP URI literals
const remoteUri: ReaderLocalUri = 'https://example.test/book.epub';
// @ts-expect-error legacy placeholder content is not retained
const legacyContent: NativeReaderProps = { content: { id: 'sample' } };
// @ts-expect-error reading flow is limited to the documented flow values
const invalidFlow: NativeReaderProps = { readingFlow: 'continuous' };

test('accepts the documented public prop combinations', () => {
  expect(complete.source).toBe(source);
  expect(minimum.source).toBeUndefined();
  expect(domFileSource.source).toBeDefined();
  expect(remoteSource.source).toBeDefined();
  expect(legacyContent).toBeDefined();
  expect(complete.loadInactivityTimeoutMs).toBe(30_000);
  expect(complete.readingFlow).toBe('paginated');
  expect(complete.onReadingFlowChange?.('scrolled')).toBe('scrolled');
  expect(invalidFlow.readingFlow).toBe('continuous');
  expect(supportedFormat).toBe('kf8-azw3');
  expect(flow).toBe('scrolled');
  expect(category).toBe('drm');
  expect(bytes.size).toBe(4);
  expect(localUri).toBe('file:///book.epub');
  expect(remoteUri).toBe('https://example.test/book.epub');
  expect(error.category).toBe('drm');
  expect(missingCategory.message).toBe('Incomplete error');
});
