import * as defaultEntry from './index';
import * as nativeEntry from './index.native';
import * as webEntry from './index.web';

jest.mock('@epubjs-react-native/core', () => ({
  Reader: 'Reader',
  ReaderProvider: ({ children }: { children: unknown }) => children,
  useReader: () => ({}),
}));
jest.mock('expo-file-system/legacy', () => ({}), { virtual: true });
jest.mock('epubjs', () => jest.fn());
jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
}));

test('keeps identical minimal runtime exports across package entrypoints', () => {
  for (const entry of [defaultEntry, nativeEntry, webEntry]) {
    expect(Object.keys(entry).sort()).toEqual(['NativeReader']);
  }
});
