import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PdfChrome, type PdfChromeSession } from './PdfChrome';
import type { PdfSelection } from './contracts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  Image: 'Image',
  StyleSheet: { create: (value: unknown) => value },
  FlatList: ({
    data,
    renderItem,
  }: {
    data: number[];
    renderItem: (arg: { item: number }) => React.ReactNode;
  }) =>
    React.createElement(
      'FlatList',
      null,
      data.map((item) =>
        React.createElement(
          React.Fragment,
          { key: item },
          renderItem({ item }),
        ),
      ),
    ),
}));
const identity = { sessionId: 'chrome', generation: 1 };
const selection: PdfSelection = {
  ...identity,
  selectionId: '1',
  coordinateSpace: 'reader',
  text: 'PDF text',
  rects: [{ x: 150, y: 200, width: 100, height: 20 }],
};
let renderer: ReactTestRenderer;
const session = (): PdfChromeSession => ({
  identity,
  goToPage: jest.fn(async () => true),
  getThumbnail: jest.fn(async () => null),
  dispose: jest.fn(),
  clearSelection: jest.fn(),
  setScale: jest.fn(),
  rotate: jest.fn(),
});
const render = (s: PdfChromeSession) =>
  act(() => {
    renderer = create(
      <PdfChrome
        state={{ status: 'ready' }}
        page={{ ...identity, pageNumber: 1, pageCount: 8 }}
        selection={selection}
        session={s}
        testID="root"
      >
        <React.Fragment />
      </PdfChrome>,
    );
  });
const label = (name: string) =>
  renderer.root.findAll(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.props.accessibilityLabel === name,
  )[0]!;
afterEach(() => {
  act(() => renderer?.unmount());
});
test('page controls survive thumbnail failure, expose current state and collapse compact Pages after a jump', async () => {
  const s = session();
  render(s);
  expect(label('Previous page').props.disabled).toBe(true);
  expect(label('Page 1').props.accessibilityState.selected).toBe(true);
  await act(async () => {
    await label('Page 8').props.onPress();
  });
  expect(s.goToPage).toHaveBeenCalledWith(8);
  expect(label('Pages').props.accessibilityState.expanded).toBe(false);
  expect(renderer.root.findAllByType('Image' as never)).toHaveLength(0);
});
test('placeholder consumes repeated clicks without invoking any session operation or persistence', () => {
  const s = session();
  render(s);
  const root = renderer.root.findAll(
    (node) => String(node.type) === 'View' && node.props.testID === 'root',
  )[0]!;
  act(() =>
    root.props.onLayout({
      nativeEvent: { layout: { width: 900, height: 600 } },
    }),
  );
  Object.values(s).forEach((value) => {
    if (jest.isMockFunction(value)) value.mockClear();
  });
  const event = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
  const setItem = jest.fn();
  Object.assign(globalThis, { localStorage: { setItem } });
  act(() => {
    label('高亮').props.onPressIn(event);
    label('高亮').props.onPress(event);
    label('高亮').props.onPress(event);
  });
  for (const value of Object.values(s))
    if (jest.isMockFunction(value)) expect(value).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
  expect(event.preventDefault).toHaveBeenCalledTimes(3);
});
test('zoom submits on blur or enter and restores the applied value after invalid input', () => {
  const s = session();
  render(s);
  const input = () => renderer.root.findByType('TextInput' as never);
  act(() => input().props.onChangeText('150'));
  act(() => input().props.onBlur());
  expect(s.setScale).toHaveBeenLastCalledWith(1.5);
  act(() => input().props.onChangeText('500'));
  act(() => input().props.onBlur());
  expect(input().props.value).toBe('150');
  expect(s.setScale).toHaveBeenCalledTimes(1);
  act(() => input().props.onChangeText('100'));
  act(() => input().props.onSubmitEditing());
  act(() => input().props.onBlur());
  expect(s.setScale).toHaveBeenLastCalledWith(1);
  expect(s.setScale).toHaveBeenCalledTimes(2);
});
