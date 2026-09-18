import type {
  NativeReaderProps,
  ReaderContent,
  ReaderPosition,
  ReaderTheme,
} from './index';

const content: ReaderContent = { id: 'sample', title: 'Sample' };
const position: ReaderPosition = { sectionId: '2', progress: 0.5 };
const theme: ReaderTheme = 'sepia';
const complete: NativeReaderProps = {
  content: { ...content, placeholderText: 'Preview' },
  initialPosition: position,
  theme,
  style: { padding: 1 },
  testID: 'reader',
};
const minimum: NativeReaderProps = { content };

// @ts-expect-error content is required
const missingContent: NativeReaderProps = {};
// @ts-expect-error unsupported themes are rejected
const unsupportedTheme: NativeReaderProps = { content, theme: 'paper' };

test('accepts the documented public prop combinations', () => {
  expect(complete.theme).toBe('sepia');
  expect(minimum.content.id).toBe('sample');
  expect(missingContent).toEqual({});
  expect(unsupportedTheme.theme).toBe('paper');
});
