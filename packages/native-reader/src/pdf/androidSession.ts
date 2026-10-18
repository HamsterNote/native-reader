import type {
  PdfSessionEvents,
  PdfSessionIdentity,
  PdfThumbnail,
} from './contracts';
import type { PdfChromeSession } from './PdfChrome';
import { parsePdfEvent, PDF_PROTOCOL, PDF_PROTOCOL_VERSION } from './protocol';

type Options = {
  identity: PdfSessionIdentity;
  send(wire: string): void;
  events: PdfSessionEvents;
  timeoutMs?: number;
};
type Request = {
  kind: 'navigate' | 'thumbnail';
  pageNumber: number;
  finish(value: boolean | PdfThumbnail | null): void;
};
export type AndroidPdfSession = PdfChromeSession & {
  receive(wire: unknown): void;
};

export function createAndroidPdfSession(options: Options): AndroidPdfSession {
  const { identity, events } = options;
  let retired = false;
  let bound = false;
  let pageCount = 0;
  let sequence = 0;
  let thumbnailCount = 0;
  const pending = new Map<number, Request>();
  const send = (type: string, extra: Record<string, unknown> = {}) => {
    const commandId = ++sequence;
    if (!retired)
      options.send(
        JSON.stringify({
          protocol: PDF_PROTOCOL,
          version: PDF_PROTOCOL_VERSION,
          ...identity,
          commandId,
          type,
          ...extra,
        }),
      );
    return commandId;
  };
  const request = (
    kind: Request['kind'],
    pageNumber: number,
  ): Promise<boolean | PdfThumbnail | null> => {
    if (
      retired ||
      !bound ||
      !Number.isSafeInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > pageCount ||
      pending.size >= 32 ||
      (kind === 'thumbnail' && thumbnailCount >= 4)
    )
      return Promise.resolve(kind === 'navigate' ? false : null);
    if (kind === 'thumbnail') thumbnailCount++;
    return new Promise((resolve) => {
      const id = sequence + 1;
      const finish = (value: boolean | PdfThumbnail | null) => {
        if (!pending.delete(id)) return;
        clearTimeout(timer);
        if (kind === 'thumbnail') thumbnailCount--;
        resolve(value);
      };
      const timer = setTimeout(
        () => finish(kind === 'navigate' ? false : null),
        10000,
      );
      pending.set(id, { kind, pageNumber, finish });
      try {
        send(kind, { pageNumber });
      } catch {
        finish(kind === 'navigate' ? false : null);
      }
    });
  };
  const timeoutMs = Math.min(300000, Math.max(0, options.timeoutMs ?? 15000));
  let deadline: ReturnType<typeof setTimeout> | undefined;
  function dispose() {
    if (retired) return;
    try {
      send('dispose');
    } catch {
      /* Native view detachment also revokes the source. */
    }
    retired = true;
    clearTimeout(deadline);
    for (const request of [...pending.values()])
      request.finish(request.kind === 'navigate' ? false : null);
    events.onSelectionChange(identity, null);
  }
  if (timeoutMs > 0)
    deadline = setTimeout(() => {
      if (retired) return;
      events.onStateChange({
        ...identity,
        status: 'error',
        error: {
          category: 'render',
          code: 'PDF_LOAD_TIMEOUT',
          message: 'The native PDF did not render before the deadline.',
        },
      });
      dispose();
    }, timeoutMs);
  const session: AndroidPdfSession = {
    identity,
    receive(wire) {
      if (retired || typeof wire !== 'string' || wire.length > 262144) return;
      let value: unknown;
      try {
        value = JSON.parse(wire);
      } catch {
        return;
      }
      const event = parsePdfEvent(value, identity);
      if (!event) return;
      if (event.type === 'boot') {
        bound = true;
        return;
      }
      if (event.type === 'state') {
        if (event.state.status !== 'error' && !bound) return;
        if (event.state.status === 'ready') {
          if (pageCount && pageCount !== event.state.pageCount) return;
          pageCount = event.state.pageCount;
          clearTimeout(deadline);
          events.onMetadata({ ...identity, pageCount });
          events.onPageChange(event.state);
        }
        events.onStateChange(event.state);
        if (event.state.status === 'error') dispose();
      } else if (bound && pageCount && event.type === 'page') {
        if (event.page.pageCount === pageCount) events.onPageChange(event.page);
      } else if (bound && pageCount && event.type === 'selection')
        events.onSelectionChange(identity, event.selection);
      else if (bound && pageCount && event.type === 'result') {
        const request = pending.get(event.commandId);
        if (!request) return;
        if (
          request.kind === 'navigate'
            ? typeof event.result !== 'boolean'
            : typeof event.result === 'boolean' ||
              (event.result && event.result.pageNumber !== request.pageNumber)
        )
          return;
        request.finish(event.result);
      }
    },
    goToPage: (page) => request('navigate', page) as Promise<boolean>,
    getThumbnail: (page) =>
      request('thumbnail', page) as Promise<PdfThumbnail | null>,
    clearSelection() {
      if (retired) return;
      events.onSelectionChange(identity, null);
      if (bound) send('clear');
    },
    setScale(scale) {
      if (
        retired ||
        !bound ||
        !Number.isFinite(scale) ||
        scale < 0.5 ||
        scale > 3
      )
        return;
      session.clearSelection();
      send('scale', { scale });
    },
    rotate() {
      if (retired || !bound) return;
      session.clearSelection();
      send('rotate');
    },
    dispose,
  };
  events.onStateChange({ ...identity, status: 'loading' });
  return session;
}
