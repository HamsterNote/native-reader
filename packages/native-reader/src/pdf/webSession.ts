import type {
  PdfSelection,
  PdfSessionEvents,
  PdfSessionIdentity,
  PdfThumbnail,
} from './contracts';
import type { PdfChromeSession } from './PdfChrome';
import {
  acceptPdfEvent,
  MAX_WEB_PDF_BYTES,
  PDF_PROTOCOL,
  PDF_PROTOCOL_VERSION,
  type PdfCommand,
} from './protocol';

export const PDF_SHELL_CSP =
  "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'";
type Options = {
  viewport: HTMLElement;
  coordinateRoot: HTMLElement;
  uri: string;
  size: number;
  identity: PdfSessionIdentity;
  events: PdfSessionEvents;
  assetBaseUrl?: string;
  timeoutMs?: number;
};
type Pending = {
  kind: 'navigate' | 'thumbnail';
  resolve(value: boolean | PdfThumbnail | null): void;
  timer: ReturnType<typeof setTimeout>;
};

export function createWebPdfSession(options: Options): PdfChromeSession {
  const { identity, events } = options;
  const source = new URL(options.uri);
  if (
    source.protocol !== 'blob:' ||
    source.origin !== location.origin ||
    !Number.isSafeInteger(options.size) ||
    options.size <= 0 ||
    options.size > MAX_WEB_PDF_BYTES
  )
    throw new Error('Invalid local PDF source.');
  const assets = new URL(
    options.assetBaseUrl ?? '/pdf-runtime/',
    location.href,
  );
  if (
    assets.origin !== location.origin ||
    !/^https?:$/.test(assets.protocol) ||
    !assets.pathname.endsWith('/') ||
    assets.search ||
    assets.hash
  )
    throw new Error('PDF assets must use the application origin.');
  const iframe = document.createElement('iframe');
  const url = new URL('reader.html', assets);
  url.hash = new URLSearchParams({
    sessionId: identity.sessionId,
    generation: String(identity.generation),
  }).toString();
  iframe.src = url.href;
  iframe.title = 'PDF document';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  Object.assign(iframe.style, {
    width: '100%',
    height: '100%',
    border: '0',
    display: 'block',
  });
  let retired = false;
  let booted = false;
  let loaded = false;
  let openSent = false;
  let commandId = 0;
  let pageCount = 0;
  const abort = new AbortController();
  const pending = new Map<number, Pending>();
  const send = (
    command: Record<string, unknown>,
    transfer: Transferable[] = [],
  ) => {
    const id = ++commandId;
    if (!retired)
      iframe.contentWindow?.postMessage(
        {
          protocol: PDF_PROTOCOL,
          version: PDF_PROTOCOL_VERSION,
          ...identity,
          commandId: id,
          ...command,
        },
        assets.origin,
        transfer,
      );
    return id;
  };
  const timeoutMs = options.timeoutMs ?? 15000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fail = (message: string, category: 'read' | 'render' = 'render') => {
    if (retired) return;
    events.onSelectionChange(identity, null);
    events.onStateChange({
      ...identity,
      status: 'error',
      error: { category, code: 'PDF_IFRAME_FAILED', message },
    });
    dispose();
  };
  const start = async () => {
    if (retired || !booted || !loaded || openSent) return;
    openSent = true;
    let bytes: Uint8Array | undefined;
    try {
      const response = await fetch(options.uri, {
        signal: abort.signal,
        redirect: 'error',
      });
      if (
        !response.ok ||
        Number(response.headers.get('Content-Length')) !== options.size
      )
        throw new Error('Source size changed.');
      bytes = new Uint8Array(await response.arrayBuffer());
      if (retired) return;
      if (bytes.length !== options.size)
        throw new Error('Source size changed.');
      send({ type: 'open', bytes: bytes.buffer }, [bytes.buffer]);
    } catch {
      if (!retired) fail('The local PDF could not be read.', 'read');
    } finally {
      if (bytes?.byteLength) bytes.fill(0);
    }
  };
  const mapSelection = (value: PdfSelection | null): PdfSelection | null => {
    if (!value) return null;
    const frame = iframe.getBoundingClientRect();
    const root = options.coordinateRoot.getBoundingClientRect();
    // Browser CSS pixels already include zoom/DPR. Apply only the frame offset.
    return {
      ...value,
      rects: value.rects.map((rect) => ({
        ...rect,
        x: rect.x + frame.left - root.left,
        y: rect.y + frame.top - root.top,
      })),
    };
  };
  const message = (event: MessageEvent) => {
    if (retired) return;
    const value = acceptPdfEvent(
      event,
      iframe.contentWindow,
      assets.origin,
      identity,
    );
    if (!value) return;
    if (value.type === 'boot') {
      if (booted) return;
      booted = true;
      void start();
    } else if (openSent && value.type === 'state') {
      if (value.state.status === 'ready') {
        clearTimeout(timer);
        pageCount = value.state.pageCount;
        events.onMetadata({ ...identity, pageCount });
      }
      events.onStateChange(value.state);
      if (value.state.status === 'error') dispose();
    } else if (openSent && value.type === 'page') {
      pageCount = value.page.pageCount;
      events.onPageChange(value.page);
    } else if (openSent && value.type === 'selection')
      events.onSelectionChange(identity, mapSelection(value.selection));
    else if (openSent && value.type === 'result') {
      const request = pending.get(value.commandId);
      if (
        !request ||
        (request.kind === 'navigate'
          ? typeof value.result !== 'boolean'
          : typeof value.result === 'boolean')
      )
        return;
      clearTimeout(request.timer);
      pending.delete(value.commandId);
      request.resolve(value.result);
    }
  };
  const load = () => {
    if (retired) return;
    if (loaded) {
      fail('The PDF frame navigated unexpectedly.');
      return;
    }
    try {
      const document = iframe.contentDocument;
      if (
        document?.title !== 'Hamster PDF' ||
        iframe.contentWindow?.location.href !== url.href ||
        document
          .querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute('content') !== PDF_SHELL_CSP
      )
        throw new Error('Invalid PDF shell.');
      loaded = true;
      void start();
    } catch {
      fail('The packaged PDF shell is unavailable.');
    }
  };
  const frameError = () => fail('The PDF frame could not be loaded.');
  window.addEventListener('message', message);
  iframe.addEventListener('load', load);
  iframe.addEventListener('error', frameError);
  if (timeoutMs > 0)
    timer = setTimeout(
      () => fail('The PDF renderer stopped making loading progress.'),
      timeoutMs,
    );
  options.viewport.replaceChildren(iframe);
  events.onStateChange({ ...identity, status: 'loading' });
  function dispose() {
    if (retired) return;
    events.onSelectionChange(identity, null);
    send({ type: 'dispose' });
    retired = true;
    abort.abort();
    clearTimeout(timer);
    window.removeEventListener('message', message);
    iframe.removeEventListener('load', load);
    iframe.removeEventListener('error', frameError);
    pending.forEach((request) => {
      clearTimeout(request.timer);
      request.resolve(request.kind === 'navigate' ? false : null);
    });
    pending.clear();
    iframe.remove();
  }
  const request = (
    kind: 'navigate' | 'thumbnail',
    number: number,
  ): Promise<boolean | PdfThumbnail | null> => {
    if (
      retired ||
      !openSent ||
      !Number.isSafeInteger(number) ||
      number < 1 ||
      number > pageCount ||
      pending.size >= 64
    )
      return Promise.resolve(kind === 'navigate' ? false : null);
    return new Promise((resolve) => {
      const id = send({ type: kind, pageNumber: number });
      pending.set(id, {
        kind,
        resolve,
        timer: setTimeout(() => {
          pending.delete(id);
          resolve(kind === 'navigate' ? false : null);
        }, 10000),
      });
    });
  };
  return {
    identity,
    dispose,
    clearSelection: () => {
      events.onSelectionChange(identity, null);
      send({ type: 'clear' });
    },
    goToPage: (number) => request('navigate', number) as Promise<boolean>,
    getThumbnail: (number) =>
      request('thumbnail', number) as Promise<PdfThumbnail | null>,
    setScale: (scale) => {
      events.onSelectionChange(identity, null);
      send({ type: 'scale', scale } satisfies Pick<
        Extract<PdfCommand, { type: 'scale' }>,
        'type' | 'scale'
      >);
    },
    rotate: () => {
      events.onSelectionChange(identity, null);
      send({ type: 'rotate' });
    },
  };
}
