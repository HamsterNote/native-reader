import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { NativeReaderProps } from './types';
import { isRecord, useTextHighlights } from './textHighlights';
import { FOLIATE_IFRAME_PROTOCOL_VERSION } from './foliateWeb';
import { createWebId } from './webIdentity';

type Session = {
  iframe: { contentWindow: Window | null; getBoundingClientRect(): DOMRect };
  session: string;
  generationToken: string;
  phase: string;
};
type Bounds = { x: number; y: number; width: number; height: number };
type Selection = {
  selectionId: string;
  text: string;
  cfi: string;
  bounds: Bounds;
};
const bounds = (value: unknown): value is Bounds =>
  isRecord(value) &&
  ['x', 'y', 'width', 'height'].every(
    (key) =>
      typeof value[key] === 'number' &&
      Number.isFinite(value[key]) &&
      Math.abs(value[key]) <= 100000,
  ) &&
  (value.width as number) > 0 &&
  (value.height as number) > 0;

export function useFoliateHighlights(
  props: NativeReaderProps,
  sessionRef: RefObject<Session | undefined>,
  ready: boolean,
) {
  const enabled =
    props.highlights !== undefined ||
    props.defaultHighlights !== undefined ||
    props.onHighlightsChange !== undefined ||
    props.documentId !== undefined;
  const highlights = useTextHighlights(props);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hit, setHit] = useState<{ id: string; bounds: Bounds } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const snapshot = useRef<Selection | null>(null);
  const operation = useRef(0);
  const pending = useRef(
    new Map<
      number,
      {
        session: Session;
        finish(success: boolean): void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const send = (
    action: 'sync' | 'create' | 'remove',
    values: typeof highlights.values,
    selectionId?: string,
  ) => {
    const session = sessionRef.current;
    if (!session || session.phase !== 'live') return Promise.resolve(false);
    const operationId = ++operation.current;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        pending.current.delete(operationId);
        resolve(false);
      }, 10000);
      pending.current.set(operationId, { session, finish: resolve, timer });
      session.iframe.contentWindow?.postMessage(
        {
          type: 'highlights',
          protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION,
          session: session.session,
          generation: session.generationToken,
          payload: {
            operationId,
            action,
            highlights: values.filter(
              (value) => value.anchor.kind === 'epub-cfi',
            ),
            ...(selectionId ? { selectionId } : {}),
          },
        },
        location.origin,
      );
    });
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    let active = true;
    const session = sessionRef.current;
    if (ready && enabled)
      void sendRef.current('sync', highlights.values).then((success) => {
        if (active && sessionRef.current === session && !success)
          setError('高亮同步失败，请重新打开文档。');
      });
    return () => {
      active = false;
    };
  }, [ready, highlights.values, enabled]);
  useEffect(() => {
    snapshot.current = null;
    setSelection(null);
    setHit(null);
    setError(null);
    const requests = pending.current;
    return () => {
      requests.forEach((request) => {
        clearTimeout(request.timer);
        request.finish(false);
      });
      requests.clear();
    };
  }, [props.source]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismiss = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('[data-highlight-popover]')
      ) {
        setHit(null);
        setSelection(null);
        snapshot.current = null;
      }
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, []);
  const receive = (type: string, data: string) => {
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      return;
    }
    if (type === 'highlight-selection') {
      if (value === null) {
        snapshot.current = null;
        setSelection(null);
        return;
      }
      if (
        !isRecord(value) ||
        typeof value.selectionId !== 'string' ||
        value.selectionId.length > 128 ||
        typeof value.text !== 'string' ||
        !value.text.trim() ||
        value.text.length > 8192 ||
        typeof value.cfi !== 'string' ||
        value.cfi.length > 8192 ||
        !/^epubcfi\(.+\)$/.test(value.cfi) ||
        !bounds(value.bounds)
      )
        return;
      snapshot.current = value as Selection;
      setSelection(value as Selection);
      setHit(null);
      setError(null);
    } else if (type === 'highlight-hit') {
      if (value === null) {
        setHit(null);
        return;
      }
      if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        !bounds(value.bounds) ||
        !highlights.values.some((item) => item.id === value.id)
      )
        return;
      snapshot.current = null;
      setSelection(null);
      setHit({ id: value.id, bounds: value.bounds });
    } else if (
      type === 'highlight-error' &&
      typeof value === 'string' &&
      value.length <= 512
    )
      setError(value);
    else if (
      type === 'highlight-result' &&
      isRecord(value) &&
      Number.isSafeInteger(value.operationId) &&
      typeof value.success === 'boolean'
    ) {
      const request = pending.current.get(value.operationId as number);
      if (!request || request.session !== sessionRef.current) return;
      clearTimeout(request.timer);
      pending.current.delete(value.operationId as number);
      if (
        !value.success &&
        typeof value.error === 'string' &&
        value.error.length <= 512
      )
        setError(value.error);
      request.finish(value.success);
    }
  };
  const confirm = async () => {
    const selected = snapshot.current;
    const session = sessionRef.current;
    if (!selected || !session) return;
    snapshot.current = null;
    const highlight = {
      id: createWebId(),
      text: selected.text,
      createdAt: Date.now(),
      color: '#ffc107',
      anchor: { kind: 'epub-cfi' as const, cfi: selected.cfi },
    };
    const success = await send(
      'create',
      [...highlights.values, highlight],
      selected.selectionId,
    );
    if (sessionRef.current !== session) return;
    if (success) {
      highlights.commit(highlight, 'create');
      setSelection(null);
    } else setError('高亮失败，请重新选择后重试。');
  };
  const remove = async () => {
    const highlight = highlights.values.find((item) => item.id === hit?.id);
    const session = sessionRef.current;
    if (!highlight || !session) return;
    setHit(null);
    const success = await send(
      'remove',
      highlights.values.filter((item) => item.id !== highlight.id),
    );
    if (sessionRef.current !== session) return;
    if (success) highlights.commit(highlight, 'remove');
    else setError('删除失败，请重试。');
  };
  const rect = selection?.bounds ?? hit?.bounds;
  const frame =
    rect && ready ? sessionRef.current?.iframe.getBoundingClientRect() : null;
  const popup =
    rect && frame && ready
      ? createPortal(
          <div
            data-highlight-popover="true"
            role="dialog"
            aria-label="Highlight actions"
            style={{
              position: 'fixed',
              zIndex: 100,
              left: Math.max(4, Math.min(frame.left + rect.x, innerWidth - 88)),
              top: Math.max(
                4,
                Math.min(frame.top + rect.y - 42, innerHeight - 42),
              ),
            }}
          >
            <button
              type="button"
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                void (hit ? remove() : confirm());
              }}
              style={{
                width: 80,
                height: 36,
                background: '#fff',
                color: '#222',
                border: '1px solid #aebcb3',
                borderRadius: 6,
              }}
            >
              {hit ? '删除' : '高亮'}
            </button>
          </div>,
          document.body,
        )
      : null;
  return { receive, popup, error };
}
