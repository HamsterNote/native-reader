import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { DemoApp } from './DemoApp';

jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  SafeAreaView: 'SafeAreaView',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
}));
jest.mock(
  '@hamster-note/native-reader',
  () => ({ NativeReader: 'NativeReader' }),
  { virtual: true },
);

let renderer: ReactTestRenderer;
beforeEach(() => {
  act(() => {
    renderer = create(<DemoApp />);
  });
});

test('renders the deterministic default scenario through the package component', () => {
  expect(renderer.root.findByProps({ testID: 'demo-root' })).toBeTruthy();
  expect(
    renderer.root.findByProps({ testID: 'theme-state' }).children.join(''),
  ).toBe('Selected theme: light');
  expect(
    renderer.root.findByProps({ testID: 'position-state' }).children.join(''),
  ).toBe('Selected position: beginning');
  expect(
    renderer.root.findByProps({ testID: 'demo-reader' }).props,
  ).toMatchObject({
    content: { title: 'Field Notes from Hamster Valley' },
    initialPosition: { progress: 0 },
    theme: 'light',
  });
});

test('exposes labelled radio groups and selected states', () => {
  expect(
    renderer.root.findByProps({ accessibilityLabel: 'Reader theme' }).props,
  ).toMatchObject({ accessibilityRole: 'radiogroup' });
  expect(
    renderer.root.findByProps({ testID: 'theme-light' }).props,
  ).toMatchObject({
    accessibilityLabel: 'light theme',
    accessibilityRole: 'radio',
    accessibilityState: { selected: true },
  });
  expect(
    renderer.root.findByProps({ testID: 'theme-dark' }).props,
  ).toMatchObject({ accessibilityState: { selected: false } });
  expect(
    renderer.root.findByProps({ accessibilityLabel: 'Reader position' }).props,
  ).toMatchObject({ accessibilityRole: 'radiogroup' });
  expect(
    renderer.root.findByProps({ testID: 'position-beginning' }).props,
  ).toMatchObject({
    accessibilityLabel: 'beginning position',
    accessibilityRole: 'radio',
    accessibilityState: { selected: true },
  });
});

test.each(['light', 'dark', 'sepia'] as const)(
  'selects the %s theme',
  (theme) => {
    act(() =>
      renderer.root.findByProps({ testID: `theme-${theme}` }).props.onPress(),
    );
    expect(
      renderer.root.findByProps({ testID: 'demo-reader' }).props.theme,
    ).toBe(theme);
    expect(
      renderer.root.findByProps({ testID: 'theme-state' }).children.join(''),
    ).toBe(`Selected theme: ${theme}`);
    expect(
      renderer.root.findByProps({ testID: `theme-${theme}` }).props
        .accessibilityState,
    ).toEqual({ selected: true });
  },
);

test('selects the in-progress fixture without persistence behavior', () => {
  act(() =>
    renderer.root
      .findByProps({ testID: 'position-in-progress' })
      .props.onPress(),
  );
  expect(
    renderer.root.findByProps({ testID: 'demo-reader' }).props.initialPosition,
  ).toEqual({
    sectionId: 'Chapter 3',
    progress: 0.42,
  });
  expect(
    renderer.root.findByProps({ testID: 'position-state' }).children.join(''),
  ).toBe('Selected position: in-progress');
  expect(
    renderer.root.findByProps({ testID: 'position-in-progress' }).props
      .accessibilityState,
  ).toEqual({ selected: true });
  expect(
    renderer.root.findByProps({ testID: 'position-beginning' }).props
      .accessibilityState,
  ).toEqual({ selected: false });
});
