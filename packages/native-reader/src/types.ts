import type { StyleProp, ViewStyle } from 'react-native';

/** Opt-in static helper. Runtime URI policy remains authoritative for all sources. */
export type ReaderLocalUri =
  `file:${string}` | `content:${string}` | `blob:${string}`;

export type ReaderSource = {
  kind: 'uri';
  /** Host-owned URI. Adapters validate allowed local schemes before reading it. */
  uri: string;
  name?: string;
  mimeType?: string;
};

/** Formats the first Foliate-backed release accepts from a host-owned URI. */
export type ReaderPublicationFormat =
  | 'epub'
  | 'mobi'
  /** KF8 is the content format used by AZW3 files; bytes cannot distinguish names. */
  | 'kf8-azw3'
  | 'fb2'
  | 'fbz'
  | 'cbz';

/** PDF is a separate engine and must never enter the Foliate transfer format. */
export type ReaderDocumentFormat = ReaderPublicationFormat | 'pdf';

/** CBZ uses the fixed-layout renderer; all other first-release formats reflow. */
export type ReaderPublicationLayout = 'reflowable' | 'fixed';

/** Reflow flow requested by the host chrome. Fixed-layout books do not use it. */
export type ReaderReadingFlow = 'scrolled' | 'paginated';

/** Stable cross-format failure classification for format detection and adapters. */
export type ReaderErrorCategory =
  'invalid' | 'unsupported' | 'drm' | 'read' | 'render';

export type ReaderFormatError = {
  category: ReaderErrorCategory;
  message: string;
};

/**
 * Platform adapters provide bounded local reads. This protocol intentionally
 * has no DOM File or remote URL surface, so detection remains platform-neutral.
 */
export type ReaderByteSource = {
  size: number;
  read(start: number, length: number): Promise<Uint8Array>;
};

export type ReaderFormatDetection =
  | {
      status: 'supported';
      format: ReaderPublicationFormat;
      layout: ReaderPublicationLayout;
    }
  | { status: 'error'; error: ReaderFormatError };

export type ReaderErrorCode =
  | 'UNSUPPORTED_SOURCE'
  | 'READ_FAILED'
  | 'INVALID_EPUB'
  | 'UNSUPPORTED_EPUB'
  | 'RENDER_FAILED'
  | 'LOAD_TIMEOUT';

export type ReaderError = {
  /** Stable cross-format presentation category. */
  category: ReaderErrorCategory;
  /** @deprecated EPUB/runtime compatibility detail; do not branch on this cross-format. */
  code?:
    | ReaderErrorCode
    | 'NATIVE_CAPABILITY_UNAVAILABLE'
    | 'PDF_CAPABILITY_UNAVAILABLE';
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
  /**
   * Controlled reading flow for reflowable publications. When omitted the
   * reader manages the flow internally: Web starts in `'paginated'`; the
   * native adapter defaults to `'scrolled'` after its security gate passes.
   * Fixed-layout publications (including image-based CBZ)
   * ignore this preference: their renderer does not offer reflow flows and
   * the flow selector is not adjustable for them.
   */
  readingFlow?: ReaderReadingFlow;
  /**
   * Called when the user picks a different reading flow in the reader's flow
   * selector. Hosts that control `readingFlow` should apply the requested
   * value; platform adapters translate the request into an engine flow
   * command within the same source session, without reopening the source.
   */
  onReadingFlowChange?: (flow: ReaderReadingFlow) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};
