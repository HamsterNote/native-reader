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
  | 'RENDER_FAILED'
  | 'LOAD_TIMEOUT';

export type ReaderError = {
  code: ReaderErrorCode | 'NATIVE_CAPABILITY_UNAVAILABLE';
  message: string;
};

export type ReaderLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; error: ReaderError };

export type NativeReaderProps = {
  source?: ReaderSource;
  /**
   * Maximum time without trusted loading progress before opening fails.
   * Set to 0 to disable the inactivity watchdog. Defaults to 15 seconds.
   */
  loadInactivityTimeoutMs?: number;
  onStateChange?: (state: ReaderLoadState) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};
