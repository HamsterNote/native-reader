import { useEffect, useRef, useState, type ComponentType } from 'react';
import { View } from 'react-native';
import type { NativeReaderProps, ReaderLoadState } from '../types';
import type { PdfPageState, PdfSelection } from './contracts';
import { PdfChrome } from './PdfChrome';
import type { PdfKitHandle, PdfKitViewProps } from './pdfKitHost';
import { createPdfKitSession, type PdfKitSession } from './pdfKitSession';

let generation = 0;
export function PdfReaderIOS(
  props: NativeReaderProps & { host: ComponentType<PdfKitViewProps> },
) {
  const handle = useRef<PdfKitHandle | null>(null);
  const root = useRef<View | null>(null);
  const viewport = useRef<View | null>(null);
  const offset = useRef<{ x: number; y: number } | null>(null);
  const [state, setState] = useState<ReaderLoadState>({ status: 'loading' });
  const [page, setPage] = useState<PdfPageState | null>(null);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [session, setSession] = useState<PdfKitSession | null>(null);
  const current = useRef<PdfKitSession | null>(null);
  const callback = useRef(props);
  callback.current = props;
  const layoutRevision = useRef(0);
  const measure = () => {
    const revision = ++layoutRevision.current;
    offset.current = null;
    current.current?.clearSelection();
    root.current?.measureInWindow((rx, ry) => {
      viewport.current?.measureInWindow((vx, vy) => {
        if (
          revision === layoutRevision.current &&
          [rx, ry, vx, vy].every(Number.isFinite)
        )
          offset.current = { x: vx - rx, y: vy - ry };
      });
    });
  };
  useEffect(() => {
    const host = handle.current;
    if (!host || !props.source) return;
    const value = ++generation;
    const identity = {
      sessionId: `pdfkit-${Date.now()}-${value}`,
      generation: value,
    };
    let active = true;
    const opened = createPdfKitSession(host, {
      uri: props.source.uri,
      identity,
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
          if (!active) return;
          const origin = offset.current;
          setSelection(
            value && origin
              ? {
                  ...value,
                  rects: value.rects.map((rect) => ({
                    ...rect,
                    x: rect.x + origin.x,
                    y: rect.y + origin.y,
                  })),
                }
              : null,
          );
        },
      },
    });
    current.current = opened;
    setSession(opened);
    measure();
    return () => {
      active = false;
      layoutRevision.current++;
      current.current = null;
      opened.dispose();
    };
    // The enclosing keyed component owns one source and one native view.
  }, []);
  const Host = props.host;
  return (
    <PdfChrome
      style={props.style}
      testID={props.testID}
      state={state}
      page={page}
      selection={selection}
      session={session}
      rootRef={(view) => {
        root.current = view;
      }}
    >
      <View ref={viewport} onLayout={measure} style={{ flex: 1 }}>
        <Host
          ref={handle}
          style={{ flex: 1 }}
          onPdfEvent={({ nativeEvent }) =>
            current.current?.receive(nativeEvent)
          }
        />
      </View>
    </PdfChrome>
  );
}
