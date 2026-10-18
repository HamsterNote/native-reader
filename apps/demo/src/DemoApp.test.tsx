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

test('starts without a reader until the user chooses a book', () => {
  expect(renderer.root.findByProps({ testID: 'demo-root' })).toBeTruthy();
  expect(
    renderer.root.findByProps({ testID: 'reader-empty-state' }),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({ testID: 'source-state' }).children.join(''),
  ).toBe('No book selected');
  expect(renderer.root.findAllByProps({ testID: 'demo-reader' })).toHaveLength(
    0,
  );
  // Picker 是唯一的用户发起入口，通过稳定 a11y label 可发现。
  const pickButton = renderer.root.findByProps({ testID: 'select-epub' });
  expect(pickButton.props.accessibilityLabel).toBe('Choose a book');
  expect(pickButton.props.accessibilityState).toEqual({
    busy: false,
    disabled: false,
  });
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
    type: expect.arrayContaining(['application/epub+zip']),
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

test('offers PDF as a candidate while native capability remains authoritative', async () => {
  mockGetDocumentAsync.mockResolvedValue({ assets: null, canceled: true });

  await pressPicker();

  const { type } = mockGetDocumentAsync.mock.calls[0]![0] as { type: string[] };
  // 每种支持格式都有 MIME 提示：EPUB / MOBI / KF8-AZW3 / FB2 / FBZ / CBZ。
  expect(type).toEqual(
    expect.arrayContaining([
      'application/epub+zip',
      'application/x-mobipocket-ebook',
      'application/vnd.amazon.ebook',
      'application/x-fictionbook+xml',
      'application/x-fictionbook+zip',
      // CBZ 是 zip 容器：不放行容器 MIME，系统选择器会隐藏 CBZ。
      'application/vnd.comicbook+zip',
      'application/zip',
    ]),
  );
  expect(type).toContain('application/pdf');
  const visibleCopy = renderer.root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => node.children.join(''))
    .join('\n');
  expect(visibleCopy).not.toContain('PDF');
});

test('passes browser-visible accept entries for container formats on Web', async () => {
  mockPlatform.OS = 'web';
  mockGetDocumentAsync.mockResolvedValue({ assets: null, canceled: true });

  await pressPicker();

  const { type } = mockGetDocumentAsync.mock.calls[0]![0] as { type: string[] };
  // Expo Web 把该列表直接写进 <input accept>；扩展名保证 CBZ 等容器格式
  // 在选择阶段不被过滤，误选的其他文件仍由内容检测拒绝。
  expect(type).toEqual(
    expect.arrayContaining([
      'application/zip',
      'application/vnd.comicbook+zip',
      '.cbz',
      '.epub',
      '.mobi',
      '.azw3',
      '.fb2',
      '.fbz',
    ]),
  );
  expect(type).toContain('application/pdf');
  expect(type).toContain('.pdf');
});

test('lists the supported formats as a visible picker hint', () => {
  const hint = renderer.root
    .findByProps({ testID: 'supported-formats' })
    .children.join('');
  for (const format of ['EPUB', 'MOBI', 'AZW3', 'FB2', 'CBZ']) {
    expect(hint).toContain(format);
  }
  expect(hint).not.toContain('PDF');
});

test.each([
  [
    'CBZ',
    {
      mimeType: 'application/vnd.comicbook+zip',
      name: 'comic.cbz',
      uri: 'file:///cache/comic.cbz',
    },
  ],
  [
    'MOBI',
    {
      mimeType: undefined,
      name: 'novel.mobi',
      uri: 'file:///cache/novel.mobi',
    },
  ],
  [
    'AZW3',
    {
      mimeType: 'application/vnd.amazon.ebook',
      name: 'novel.azw3',
      uri: 'file:///cache/novel.azw3',
    },
  ],
  [
    'FB2',
    {
      mimeType: 'application/x-fictionbook+xml',
      name: 'story.fb2',
      uri: 'file:///cache/story.fb2',
    },
  ],
])(
  'passes a %s candidate through with its name/MIME as hints, not parser trust',
  async (_format, asset) => {
    mockGetDocumentAsync.mockResolvedValue({
      assets: [asset],
      canceled: false,
    });

    await pressPicker();

    const { source } = renderer.root.findByProps({
      testID: 'demo-reader',
    }).props;
    // Demo 原样转发名称与 MIME；格式判定完全交给阅读器的内容检测。
    expect(source).toMatchObject({
      kind: 'uri',
      name: asset.name,
      uri: asset.uri,
    });
    if (asset.mimeType === undefined) expect(source.mimeType).toBeUndefined();
    else expect(source.mimeType).toBe(asset.mimeType);
    expect(
      renderer.root.findByProps({ testID: 'source-state' }).children.join(''),
    ).toBe(`Selected: ${asset.name}`);
  },
);

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

test('reflects reader loading, ready, and error states through the public status surface', async () => {
  mockGetDocumentAsync.mockResolvedValue({
    assets: [{ name: 'story.fb2', uri: 'file:///cache/story.fb2' }],
    canceled: false,
  });
  await pressPicker();

  // Demo 只消费阅读器公开的 onStateChange，不自行解析/渲染出版物。
  const onStateChange = renderer.root.findByProps({ testID: 'demo-reader' })
    .props.onStateChange as (state: unknown) => void;
  expect(typeof onStateChange).toBe('function');

  // 新 source 选中后状态条先回到无陈旧状态的 idle。
  expect(
    renderer.root.findAllByProps({ testID: 'reader-status' }),
  ).toHaveLength(0);

  act(() => onStateChange({ status: 'loading' }));
  const loading = renderer.root.findByProps({ testID: 'reader-status' });
  expect(loading.children.join('')).toBe('Opening story.fb2...');
  expect(loading.props.accessibilityLiveRegion).toBe('polite');

  act(() => onStateChange({ status: 'ready' }));
  expect(
    renderer.root.findByProps({ testID: 'reader-status' }).children.join(''),
  ).toBe('Now reading: story.fb2');

  act(() =>
    onStateChange({
      status: 'error',
      error: {
        category: 'invalid',
        message: 'The publication model is invalid.',
      },
    }),
  );
  const failure = renderer.root.findByProps({ testID: 'reader-status' });
  expect(failure.props.accessibilityRole).toBe('alert');
  expect(failure.children.join('')).toBe('The publication model is invalid.');
});

test('presents Android recovery guidance only on Android', async () => {
  act(() => renderer.unmount());
  mockPlatform.OS = 'android';
  mockGetDocumentAsync.mockResolvedValue({
    assets: [{ name: 'novel.mobi', uri: 'file:///cache/novel.mobi' }],
    canceled: false,
  });
  renderDemo();
  await pressPicker();

  const note = renderer.root.findByProps({
    testID: 'android-recovery-note',
  });
  const copy = note.children.join('');
  // 如实说明上游 WebView 限制与 scrolling 恢复路径，不承诺 PDF/远程支持。
  expect(copy).toContain('Android');
  expect(copy).toContain('WebView');
  expect(copy).toContain('scrolling');
  expect(copy).not.toContain('PDF');
});

test('does not present Android recovery guidance on other platforms', async () => {
  mockGetDocumentAsync.mockResolvedValue({
    assets: [{ name: 'book.epub', uri: 'file:///cache/book.epub' }],
    canceled: false,
  });
  await pressPicker();

  expect(
    renderer.root.findAllByProps({ testID: 'android-recovery-note' }),
  ).toHaveLength(0);
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
