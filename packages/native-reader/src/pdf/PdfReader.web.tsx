import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { NativeReaderProps, ReaderLoadState } from '../types';
import type { PdfPageState, PdfSelection } from './contracts';
import { PdfChrome, type PdfChromeSession } from './PdfChrome';
import { createWebPdfSession } from './webSession';

let nextGeneration = 0;
export function PdfReaderWeb(props: NativeReaderProps & { size: number }) {
  const viewport = useRef<View | null>(null);
  const root = useRef<View | null>(null);
  const [state, setState] = useState<ReaderLoadState>({ status: 'loading' });
  const [session, setSession] = useState<PdfChromeSession | null>(null);
  const [page, setPage] = useState<PdfPageState | null>(null);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const callback = useRef(props);
  callback.current = props;
  useEffect(() => {
    let active = true;
    let opened: PdfChromeSession | undefined;
    setPage(null);
    setSelection(null);
    try {
      opened = createWebPdfSession({
        viewport: viewport.current as unknown as HTMLElement,
        coordinateRoot: root.current as unknown as HTMLElement,
        uri: props.source!.uri,
        size: props.size,
        identity: {
          sessionId: crypto.randomUUID(),
          generation: ++nextGeneration,
        },
        assetBaseUrl: props.pdfAssetBaseUrl,
        timeoutMs: props.loadInactivityTimeoutMs,
        events: {
          onMetadata() {},
          onStateChange(value) {
            if (!active) return;
            const next: ReaderLoadState =
              value.status === 'error'
                ? {
                    status: 'error',
                    error: {
                      category: value.error.category,
                      message: value.error.message,
                    },
                  }
                : { status: value.status };
            setState(next);
            callback.current.onStateChange?.(next);
          },
          onPageChange(value) {
            if (active) {
              setPage(value);
              callback.current.onPdfPageChange?.(value);
            }
          },
          onSelectionChange(_identity, value) {
            if (active) setSelection(value);
          },
        },
      });
      setSession(opened);
    } catch {
      const failure: ReaderLoadState = {
        status: 'error',
        error: {
          category: 'unsupported',
          code: 'PDF_CAPABILITY_UNAVAILABLE',
          message: 'The PDF runtime is unavailable.',
        },
      };
      setState(failure);
      callback.current.onStateChange?.(failure);
    }
    return () => {
      active = false;
      opened?.dispose();
    };
  }, [
    props.source,
    props.size,
    props.pdfAssetBaseUrl,
    props.loadInactivityTimeoutMs,
  ]);
  return (
    <PdfChrome
      rootRef={(value) => {
        root.current = value;
      }}
      style={props.style}
      testID={props.testID}
      state={state}
      page={page}
      selection={selection}
      session={session}
    >
      <View ref={viewport} style={{ flex: 1, minHeight: 240 }} />
    </PdfChrome>
  );
}
