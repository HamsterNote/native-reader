import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { Platform } from 'react-native';

import { NativeReader } from './NativeReader';

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
}));

const render = (element: React.ReactElement) => {
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(element);
  });
  return renderer!.root;
};

const text = (root: ReturnType<typeof render>) =>
  root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => node.children.join(''));

test('renders safe defaults and omits absent metadata', () => {
  const root = render(
    <NativeReader content={{ id: 'one', title: 'A Quiet Library' }} />,
  );
  expect(text(root)).toEqual([
    'Reader placeholder',
    'A Quiet Library',
    'Progress: 0%',
    'Theme: light',
  ]);
});

test.each([
  ['light', 0, 'Progress: 0%'],
  ['dark', 0.42, 'Progress: 42%'],
  ['sepia', 2, 'Progress: 100%'],
  ['light', -1, 'Progress: 0%'],
  ['dark', Number.NaN, 'Progress: 0%'],
  ['sepia', Number.POSITIVE_INFINITY, 'Progress: 0%'],
] as const)(
  'renders %s and normalizes progress %s',
  (theme, progress, expected) => {
    const root = render(
      <NativeReader
        content={{
          id: 'one',
          title: 'A Quiet Library',
          placeholderText: 'Sample text',
        }}
        initialPosition={{ sectionId: 'chapter-3', progress }}
        theme={theme}
        testID="reader"
        style={{ opacity: 0.9 }}
      />,
    );
    expect(text(root)).toEqual(
      expect.arrayContaining([
        'Reader placeholder',
        'A Quiet Library',
        'Sample text',
        'Section: chapter-3',
        expected,
        `Theme: ${theme}`,
      ]),
    );
    const surface = root.find(
      (node) =>
        (node.type as unknown) === 'View' && node.props.testID === 'reader',
    );
    expect(surface.props.style[surface.props.style.length - 1]).toEqual({
      opacity: 0.9,
    });
  },
);

test.each(['ios', 'android', 'web'] as const)(
  'keeps placeholder semantics on %s',
  (platform) => {
    Platform.OS = platform;
    const root = render(
      <NativeReader
        content={{
          id: platform,
          title: 'Cross-platform Notes',
          placeholderText: 'Shared content',
        }}
        initialPosition={{ sectionId: 'part-2', progress: 0.25 }}
        theme="sepia"
      />,
    );
    expect(text(root)).toEqual([
      'Reader placeholder',
      'Cross-platform Notes',
      'Shared content',
      'Section: part-2',
      'Progress: 25%',
      'Theme: sepia',
    ]);
  },
);
