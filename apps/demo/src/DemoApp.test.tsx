import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { DemoApp } from './DemoApp';

let mockWindowWidth = 1024;

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }), {
  virtual: true,
});
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  SafeAreaView: 'SafeAreaView',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ height: 768, width: mockWindowWidth }),
}));
jest.mock(
  '@hamster-note/native-reader',
  () => ({ NativeReader: 'NativeReader' }),
  { virtual: true },
);

const mockGetDocumentAsync = jest.requireMock('expo-document-picker')
  .getDocumentAsync as jest.Mock;
const mockPlatform = jest.requireMock('react-native').Platform as {
  OS: string;
};

let renderer: ReactTestRenderer;

function renderDemo() {
  act(() => {
    renderer = create(<DemoApp />);
  });
}

async function pressPicker() {
  await act(async () => {
    await renderer.root.findByProps({ testID: 'select-epub' }).props.onPress();
  });
}

beforeEach(() => {
  mockGetDocumentAsync.mockReset();
  mockPlatform.OS = 'ios';
  mockWindowWidth = 1024;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: jest.fn(),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: jest.fn(),
  });
  renderDemo();
});

afterEach(() => {
  act(() => renderer.unmount());
  Reflect.deleteProperty(globalThis, 'window');
});

test('starts without a reader until the user chooses an EPUB', () => {
  expect(renderer.root.findByProps({ testID: 'demo-root' })).toBeTruthy();
  expect(
    renderer.root.findByProps({ testID: 'reader-empty-state' }),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({ testID: 'source-state' }).children.join(''),
  ).toBe('No EPUB selected');
  expect(renderer.root.findAllByProps({ testID: 'demo-reader' })).toHaveLength(
    0,
  );
});

test('requests a native cache copy and passes a controlled source to the package reader', async () => {
  mockGetDocumentAsync.mockResolvedValue({
    assets: [
      {
        mimeType: 'application/epub+zip',
        name: 'The Dispossessed.epub',
        uri: 'file:///cache/the-dispossessed.epub',
      },
    ],
    canceled: false,
  });

  await pressPicker();

  expect(mockGetDocumentAsync).toHaveBeenCalledWith({
    base64: false,
    copyToCacheDirectory: true,
    multiple: false,
    type: 'application/epub+zip',
  });
  expect(
    renderer.root.findByProps({ testID: 'demo-reader' }).props,
  ).toMatchObject({
    source: {
      kind: 'uri',
      mimeType: 'application/epub+zip',
      name: 'The Dispossessed.epub',
      uri: 'file:///cache/the-dispossessed.epub',
    },
  });
  expect(
    renderer.root.findByProps({ testID: 'source-state' }).children.join(''),
  ).toBe('Selected: The Dispossessed.epub');
});

test('preserves the active source when a replacement selection is canceled', async () => {
  mockGetDocumentAsync
    .mockResolvedValueOnce({
      assets: [{ name: 'first.epub', uri: 'file:///cache/first.epub' }],
      canceled: false,
    })
    .mockResolvedValueOnce({ assets: null, canceled: true });

  await pressPicker();
  await pressPicker();

  expect(
    renderer.root.findByProps({ testID: 'demo-reader' }).props.source,
  ).toEqual({
    kind: 'uri',
    name: 'first.epub',
    uri: 'file:///cache/first.epub',
  });
  expect(
    renderer.root.findByProps({ testID: 'source-state' }).children.join(''),
  ).toBe('Selected: first.epub');
});

test('owns web blob URLs and revokes them on replacement and unmount', async () => {
  const firstFile = { name: 'first.epub' };
  const secondFile = { name: 'second.epub' };
  mockPlatform.OS = 'web';
  (URL.createObjectURL as jest.Mock)
    .mockReturnValueOnce('blob:first')
    .mockReturnValueOnce('blob:second');
  mockGetDocumentAsync
    .mockResolvedValueOnce({
      assets: [{ file: firstFile, name: 'first.epub', uri: 'picker:first' }],
      canceled: false,
    })
    .mockResolvedValueOnce({ assets: null, canceled: true })
    .mockResolvedValueOnce({
      assets: [{ file: secondFile, name: 'second.epub', uri: 'picker:second' }],
      canceled: false,
    });

  await pressPicker();
  expect(mockGetDocumentAsync).toHaveBeenLastCalledWith(
    expect.objectContaining({ copyToCacheDirectory: false }),
  );
  expect(
    renderer.root.findByProps({ testID: 'demo-reader' }).props.source,
  ).toEqual({
    kind: 'uri',
    name: 'first.epub',
    uri: 'blob:first',
  });

  await pressPicker();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(
    renderer.root.findByProps({ testID: 'demo-reader' }).props.source,
  ).toEqual({
    kind: 'uri',
    name: 'first.epub',
    uri: 'blob:first',
  });

  await pressPicker();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
  expect(
    renderer.root.findByProps({ testID: 'demo-reader' }).props.source,
  ).toEqual({
    kind: 'uri',
    name: 'second.epub',
    uri: 'blob:second',
  });

  act(() => renderer.unmount());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second');
});

test('revokes a web blob created after the picker is unmounted', async () => {
  let resolvePicker!: (result: unknown) => void;
  mockPlatform.OS = 'web';
  mockGetDocumentAsync.mockReturnValueOnce(
    new Promise((resolve) => {
      resolvePicker = resolve;
    }),
  );
  (URL.createObjectURL as jest.Mock).mockReturnValueOnce('blob:late');

  let pending!: Promise<void>;
  act(() => {
    pending = renderer.root
      .findByProps({ testID: 'select-epub' })
      .props.onPress();
  });
  act(() => renderer.unmount());
  resolvePicker({
    assets: [{ file: {}, name: 'late.epub', uri: 'picker:late' }],
    canceled: false,
  });
  await pending;

  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late');
});

test('switches to the compact layout on narrow screens', () => {
  act(() => renderer.unmount());
  mockWindowWidth = 480;
  renderDemo();

  expect(renderer.root.findByProps({ testID: 'layout-compact' })).toBeTruthy();
  expect(renderer.root.findAllByProps({ testID: 'layout-wide' })).toHaveLength(
    0,
  );
});

test('passes a valid web query timeout to the reader', async () => {
  act(() => renderer.unmount());
  mockPlatform.OS = 'web';
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { search: '?loadInactivityTimeoutMs=50' } },
  });
  mockGetDocumentAsync.mockResolvedValue({
    assets: [{ name: 'stalled.epub', uri: 'blob:stalled' }],
    canceled: false,
  });
  renderDemo();

  await pressPicker();

  expect(
    renderer.root.findByProps({ testID: 'demo-reader' }).props
      .loadInactivityTimeoutMs,
  ).toBe(50);
});
