import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { View } from 'react-native';
import type { NativeReaderProps, ReaderLoadState } from '../types';
import type { PdfPageState, PdfSelection } from './contracts';
import { PdfChrome } from './PdfChrome';
import type { AndroidPdfHandle, AndroidPdfHost } from './androidHost';
import {
  createAndroidPdfSession,
  type AndroidPdfSession,
} from './androidSession';

let generation = 0;
export function PdfReaderAndroid(
  props: NativeReaderProps & { host: AndroidPdfHost },
) {
  const handle = useRef<AndroidPdfHandle | null>(null);
  const root = useRef<View | null>(null);
  const viewport = useRef<View | null>(null);
  const offset = useRef<{ x: number; y: number } | null>(null);
  const current = useRef<AndroidPdfSession | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const revision = useRef(0);
  const [configuration, setConfiguration] = useState<string | null>(null);
  const [session, setSession] = useState<AndroidPdfSession | null>(null);
  const [state, setState] = useState<ReaderLoadState>({ status: 'loading' });
  const [page, setPage] = useState<PdfPageState | null>(null);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const measure = () => {
    const id = ++revision.current;
    offset.current = null;
    current.current?.clearSelection();
    root.current?.measureInWindow((rx, ry) => {
      viewport.current?.measureInWindow((vx, vy) => {
        if (id === revision.current && [rx, ry, vx, vy].every(Number.isFinite))
          offset.current = { x: vx - rx, y: vy - ry };
      });
    });
  };
  useEffect(() => {
    if (!props.source) return;
    let active = true;
    const identity = {
      sessionId: Crypto.randomUUID(),
      generation: ++generation,
    };
    const opened = createAndroidPdfSession({
      identity,
      send: (wire) => handle.current?.setNativeProps({ command: wire }),
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
                    ...(value.error.code === 'PDF_CAPABILITY_UNAVAILABLE'
                      ? { code: 'PDF_CAPABILITY_UNAVAILABLE' as const }
                      : {}),
                  },
                }
              : { status: value.status };
          setState(next);
          callbacks.current.onStateChange?.(next);
        },
        onPageChange(value) {
          if (!active) return;
          setPage(value);
          callbacks.current.onPdfPageChange?.(value);
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
    setPage(null);
    setSelection(null);
    setConfiguration(JSON.stringify({ ...identity, uri: props.source.uri }));
    measure();
    return () => {
      active = false;
      revision.current++;
      current.current = null;
      opened.dispose();
    };
    // One keyed native view is owned by one source; StrictMode gets a fresh identity.
  }, []);
  const Host = props.host;
  return (
    <PdfChrome
      state={state}
      page={page}
      selection={selection}
      session={session}
      style={props.style}
      testID={props.testID}
      rootRef={(view) => {
        root.current = view;
      }}
    >
      <View ref={viewport} onLayout={measure} style={{ flex: 1 }}>
        {configuration && (
          <Host
            key={configuration}
            ref={handle}
            configuration={configuration}
            onPdfMessage={({ nativeEvent }) =>
              current.current?.receive(nativeEvent.data)
            }
            style={{ flex: 1 }}
          />
        )}
      </View>
    </PdfChrome>
  );
}
