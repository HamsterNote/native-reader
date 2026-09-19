import type { StyleProp, ViewStyle } from 'react-native';

export type ReaderSource = {
  kind: 'uri';
  uri: string;
  name?: string;
  mimeType?: string;
};

export type ReaderErrorCode =
  | 'UNSUPPORTED_SOURCE'
  | 'READ_FAILED'
  | 'INVALID_EPUB'
  | 'UNSUPPORTED_EPUB'
  | 'RENDER_FAILED';

export type ReaderError = {
  code: ReaderErrorCode;
  message: string;
};

export type ReaderLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; error: ReaderError };

export type NativeReaderProps = {
  source?: ReaderSource;
  onStateChange?: (state: ReaderLoadState) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};
