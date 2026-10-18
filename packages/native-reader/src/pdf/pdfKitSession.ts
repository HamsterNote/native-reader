import type {
  PdfSessionEvents,
  PdfSessionIdentity,
  PdfThumbnail,
} from './contracts';
import type { PdfChromeSession } from './PdfChrome';
import type { PdfKitHandle } from './pdfKitHost';
import { parsePdfEvent, PDF_PROTOCOL, PDF_PROTOCOL_VERSION } from './protocol';

type Options = {
  uri: string;
  identity: PdfSessionIdentity;
  events: PdfSessionEvents;
  timeoutMs?: number;
};
export type PdfKitSession = PdfChromeSession & {
  receive(value: unknown): void;
};

export function createPdfKitSession(
  host: PdfKitHandle,
  options: Options,
): PdfKitSession {
  const { identity, events } = options;
  let sequence = 0;
  let disposed = false;
  let terminal = false;
  let pageCount = 0;
  let thumbnailCount = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const pending = new Set<() => void>();
  const timeoutMs = Math.min(300000, Math.max(0, options.timeoutMs ?? 15000));
  const envelope = (type: string) => ({
    protocol: PDF_PROTOCOL,
    version: PDF_PROTOCOL_VERSION,
    ...identity,
    commandId: ++sequence,
    type,
  });
  const fail = (code: string, message: string) => {
    if (disposed || terminal) return;
    terminal = true;
    events.onStateChange({
      ...identity,
      status: 'error',
      error: { category: 'render', code, message },
    });
    dispose();
  };
  const request = (
    type: string,
    extra: Record<string, unknown> = {},
  ): Promise<unknown> => {
    if (disposed || pending.size >= 32) return Promise.resolve(null);
    const value = { ...envelope(type), ...extra };
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        timers.delete(timer);
        pending.delete(cancel);
        resolve(result);
      };
      const cancel = () => finish(null);
      const timer = setTimeout(cancel, 10000);
      timers.add(timer);
      pending.add(cancel);
      try {
        void host.command(value).then((result) => {
          if (disposed) return finish(null);
          const event = parsePdfEvent(result, identity);
          finish(
            event?.type === 'result' && event.commandId === value.commandId
              ? event.result
              : null,
          );
        }, cancel);
      } catch {
        cancel();
      }
    });
  };
  function dispose() {
    if (disposed) return;
    // Queue revocation before disabling JS delivery. This view is never reused
    // by another source, and native detachment revokes independently as well.
    try {
      void host.command(envelope('dispose')).catch(() => undefined);
    } catch {
      /* detached host */
    }
    disposed = true;
    timers.forEach(clearTimeout);
    timers.clear();
    for (const cancel of [...pending]) cancel();
    events.onSelectionChange(identity, null);
  }
  let deadline: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    deadline = setTimeout(
      () =>
        fail(
          'PDF_LOAD_TIMEOUT',
          'PDF did not render before the load deadline.',
        ),
      timeoutMs,
    );
    timers.add(deadline);
  }
  const session: PdfKitSession = {
    identity,
    receive(value) {
      if (disposed || terminal) return;
      const event = parsePdfEvent(value, identity);
      if (!event || event.commandId !== 0) return;
      if (event.type === 'state') {
        if (event.state.status === 'ready') {
          pageCount = event.state.pageCount;
          if (deadline) {
            clearTimeout(deadline);
            timers.delete(deadline);
          }
          events.onMetadata({ ...identity, pageCount });
        }
        events.onStateChange(event.state);
        if (event.state.status === 'error') {
          terminal = true;
          dispose();
        }
      } else if (event.type === 'page') {
        if (pageCount && pageCount !== event.page.pageCount) return;
        events.onPageChange(event.page);
      } else if (event.type === 'selection') {
        if (pageCount) events.onSelectionChange(identity, event.selection);
      }
    },
    async goToPage(pageNumber) {
      if (
        !Number.isInteger(pageNumber) ||
        pageNumber < 1 ||
        pageNumber > pageCount
      )
        return false;
      return (await request('navigate', { pageNumber })) === true;
    },
    async getThumbnail(pageNumber) {
      if (
        !Number.isInteger(pageNumber) ||
        pageNumber < 1 ||
        pageNumber > pageCount ||
        thumbnailCount >= 4
      )
        return null;
      thumbnailCount++;
      try {
        const value = await request('thumbnail', { pageNumber });
        return value &&
          typeof value === 'object' &&
          (value as PdfThumbnail).pageNumber === pageNumber
          ? (value as PdfThumbnail)
          : null;
      } finally {
        thumbnailCount--;
      }
    },
    clearSelection() {
      if (disposed) return;
      events.onSelectionChange(identity, null);
      void request('clear');
    },
    setScale(scale) {
      if (Number.isFinite(scale) && scale >= 0.5 && scale <= 3) {
        session.clearSelection();
        void request('scale', { scale });
      }
    },
    rotate() {
      session.clearSelection();
      void request('rotate');
    },
    dispose,
  };
  events.onStateChange({ ...identity, status: 'loading' });
  void request('open', { uri: options.uri, timeoutMs }).then((opened) => {
    if (opened !== true)
      fail(
        'PDF_HOST_OPEN_FAILED',
        'The native PDF host could not open the document.',
      );
  });
  return session;
}
