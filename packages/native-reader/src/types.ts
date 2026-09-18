import type { StyleProp, ViewStyle } from 'react-native';

export type ReaderContent = {
  id: string;
  title: string;
  placeholderText?: string;
};

export type ReaderPosition = {
  sectionId?: string;
  progress?: number;
};

export type ReaderTheme = 'light' | 'dark' | 'sepia';

export type NativeReaderProps = {
  content: ReaderContent;
  initialPosition?: ReaderPosition;
  theme?: ReaderTheme;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};
