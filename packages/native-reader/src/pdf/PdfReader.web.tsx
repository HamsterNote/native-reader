import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { NativeReaderProps, ReaderLoadState } from '../types';
import type { PdfPageState, PdfSelection, PdfRect } from './contracts';
import { useTextHighlights } from '../textHighlights';
import { PdfChrome, type PdfChromeSession } from './PdfChrome';
import { createWebPdfSession } from './webSession';
import { createWebId } from '../webIdentity';

let nextGeneration = 0;
export function PdfReaderWeb(props: NativeReaderProps & { size: number }) {
  const viewport = useRef<View | null>(null);
  const root = useRef<View | null>(null);
  const [state, setState] = useState<ReaderLoadState>({ status: 'loading' });
  const [session, setSession] = useState<PdfChromeSession | null>(null);
  const [page, setPage] = useState<PdfPageState | null>(null);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const snapshot = useRef<PdfSelection | null>(null);
  const [selectedHighlight, setSelectedHighlight] = useState<{
    id: string;
    rect: PdfRect;
  } | null>(null);
  const [highlightError, setHighlightError] = useState<string | null>(null);
  const highlights = useTextHighlights(props);
  const activeSession = useRef<PdfChromeSession | null>(null);
  const busy = useRef(false);
  const callback = useRef(props);
  callback.current = props;
  useEffect(() => {
    let active = true;
    busy.current = false;
    let opened: PdfChromeSession | undefined;
    setPage(null);
    setSelection(null);
    snapshot.current = null;
    setSelectedHighlight(null);
    setHighlightError(null);
    try {
      opened = createWebPdfSession({
        viewport: viewport.current as unknown as HTMLElement,
        coordinateRoot: root.current as unknown as HTMLElement,
        uri: props.source!.uri,
        size: props.size,
        identity: {
          sessionId: createWebId(),
          generation: ++nextGeneration,
        },
        assetBaseUrl: props.pdfAssetBaseUrl,
        timeoutMs: props.loadInactivityTimeoutMs,
        onDocumentId: (id) => {
          if (active) callback.current.onDocumentId?.(id);
        },
        onSelectionError: (message) => {
          if (active) setHighlightError(message);
        },
        onHighlightHit: (id, rect) => {
          if (!active) return;
          setSelectedHighlight(id === '__dismiss__' ? null : { id, rect });
          snapshot.current = null;
          setSelection(null);
        },
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
            if (active) {
              snapshot.current = value;
              setSelection(value);
              if (value) setSelectedHighlight(null);
            }
          },
        },
      });
      setSession(opened);
      activeSession.current = opened;
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
      activeSession.current = null;
      opened?.dispose();
    };
  }, [
    props.source,
    props.size,
    props.pdfAssetBaseUrl,
    props.loadInactivityTimeoutMs,
  ]);
  useEffect(() => {
    if (state.status !== 'ready') return;
    let active = true;
    void session?.setHighlights?.(highlights.values).then((success) => {
      if (active && activeSession.current === session && !success)
        setHighlightError('高亮同步失败，请重试。');
    });
    return () => {
      active = false;
    };
  }, [session, highlights.values, state.status]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('[aria-label="Text selection"]')
      ) {
        setSelectedHighlight(null);
        setSelection(null);
        snapshot.current = null;
        activeSession.current?.clearSelection();
      }
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, []);
  const confirm = async () => {
    const value = snapshot.current;
    if (
      busy.current ||
      !value?.anchor ||
      !session?.setHighlights ||
      activeSession.current !== session ||
      value.sessionId !== session.identity.sessionId
    )
      return;
    busy.current = true;
    snapshot.current = null;
    const highlight = {
      id: createWebId(),
      text: value.text,
      createdAt: Date.now(),
      color: '#ffc107',
      anchor: value.anchor,
    };
    const success = await session.setHighlights([
      ...highlights.values,
      highlight,
    ]);
    if (activeSession.current !== session) return;
    busy.current = false;
    if (!success) {
      setHighlightError('高亮失败，请重新选择后重试。');
      return;
    }
    highlights.commit(highlight, 'create');
    setHighlightError(null);
    session.clearSelection();
  };
  const remove = async (id: string) => {
    const highlight = highlights.values.find((item) => item.id === id);
    if (
      busy.current ||
      !highlight ||
      !session?.setHighlights ||
      activeSession.current !== session
    )
      return;
    busy.current = true;
    setSelectedHighlight(null);
    const success = await session.setHighlights(
      highlights.values.filter((item) => item.id !== id),
    );
    if (activeSession.current !== session) return;
    busy.current = false;
    if (!success) {
      setHighlightError('删除失败，请重试。');
      return;
    }
    highlights.commit(highlight, 'remove');
    setHighlightError(null);
  };
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
      selectedHighlight={selectedHighlight}
      onConfirm={() => {
        void confirm();
      }}
      onRemove={(id) => {
        void remove(id);
      }}
      highlightError={highlightError}
    >
      <View ref={viewport} style={{ flex: 1, minHeight: 240 }} />
    </PdfChrome>
  );
}
