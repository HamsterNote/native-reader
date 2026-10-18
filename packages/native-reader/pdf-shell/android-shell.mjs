/* global window, top, location, document */
import { createPdfDomSession } from './adapter.js';
import {
  parsePdfCommand,
  PDF_PROTOCOL,
  PDF_PROTOCOL_VERSION,
} from './protocol.js';

let installed = false;
const maxBytes = 32 * 1024 * 1024;
const maxWire = 262144;

/** Receives a native-transferred port in the exact top-level packaged document. */
export function installPdfAndroidPort(port, identity) {
  if (
    installed ||
    window !== top ||
    location.pathname !== '/pdf-runtime/android-reader.html' ||
    location.search ||
    location.hash ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      identity?.sessionId ?? '',
    ) ||
    !Number.isSafeInteger(identity?.generation) ||
    identity.generation <= 0 ||
    !port ||
    typeof port.postMessage !== 'function' ||
    typeof port.close !== 'function'
  )
    return false;
  installed = true;
  let session;
  let opened = false;
  let disposed = false;
  let lastCommand = 0;
  const abort = new AbortController();
  const send = (value, commandId = 0) => {
    if (disposed) return;
    const wire = JSON.stringify({
      protocol: PDF_PROTOCOL,
      version: PDF_PROTOCOL_VERSION,
      ...identity,
      commandId,
      ...value,
    });
    if (wire.length <= maxWire) port.postMessage(wire);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    abort.abort();
    window.removeEventListener('pagehide', dispose);
    port.onmessage = null;
    port.onmessageerror = null;
    session?.dispose();
    session = undefined;
    port.close();
  };
  const open = async (url) => {
    let bytes;
    try {
      const response = await fetch(url, {
        signal: abort.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
      const size = Number(response.headers.get('Content-Length'));
      if (
        response.status !== 200 ||
        response.headers.get('Content-Type')?.split(';')[0] !==
          'application/pdf' ||
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > maxBytes
      )
        throw new Error('Invalid PDF response');
      bytes = new Uint8Array(await response.arrayBuffer());
      if (disposed) return;
      if (bytes.length !== size) throw new Error('PDF size changed');
      const viewport = document.querySelector('main');
      session = createPdfDomSession({
        viewport,
        coordinateRoot: viewport,
        bytes,
        identity,
        assetBaseUrl: new URL('./', location.href).href,
        events: {
          onStateChange: (state) => send({ type: 'state', state }),
          onMetadata() {},
          onPageChange: (page) => send({ type: 'page', page }),
          onSelectionChange: (_identity, selection) =>
            send({ type: 'selection', selection }),
        },
      });
    } catch {
      if (!disposed)
        send({
          type: 'state',
          state: {
            ...identity,
            status: 'error',
            error: {
              category: 'read',
              code: 'PDF_SOURCE_READ_FAILED',
              message: 'The local PDF could not be read.',
            },
          },
        });
    } finally {
      bytes?.fill(0);
    }
  };
  const receive = async (event) => {
    if (
      disposed ||
      typeof event.data !== 'string' ||
      event.data.length > maxWire
    )
      return;
    let value;
    try {
      value = JSON.parse(event.data);
    } catch {
      return;
    }
    if (value?.type === 'open') {
      if (
        opened ||
        value.protocol !== PDF_PROTOCOL ||
        value.version !== PDF_PROTOCOL_VERSION ||
        value.sessionId !== identity.sessionId ||
        value.generation !== identity.generation ||
        value.commandId !== 0 ||
        Object.keys(value).sort().join(',') !==
          'commandId,generation,protocol,sessionId,type,url,version' ||
        typeof value.url !== 'string'
      )
        return;
      let url;
      try {
        url = new URL(value.url);
      } catch {
        return;
      }
      if (
        url.origin !== location.origin ||
        url.search ||
        url.hash ||
        !/^\/pdf-document\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/document\.pdf$/.test(
          url.pathname,
        ) ||
        url.href !== value.url
      )
        return;
      opened = true;
      await open(url.href);
      return;
    }
    const command = parsePdfCommand(value, identity);
    if (!command || command.type === 'open' || command.commandId <= lastCommand)
      return;
    lastCommand = command.commandId;
    if (command.type === 'dispose') return dispose();
    if (!session) return;
    if (command.type === 'clear') session.clearSelection();
    else if (command.type === 'scale') session.setScale(command.scale);
    else if (command.type === 'rotate') session.rotate();
    else if (command.type === 'navigate')
      send(
        { type: 'result', result: await session.goToPage(command.pageNumber) },
        command.commandId,
      );
    else if (command.type === 'thumbnail')
      send(
        {
          type: 'result',
          result: await session.getThumbnail(command.pageNumber),
        },
        command.commandId,
      );
  };
  port.onmessage = (event) => {
    void receive(event);
  };
  port.onmessageerror = dispose;
  port.start?.();
  window.addEventListener('pagehide', dispose, { once: true });
  send({ type: 'boot' });
  return true;
}
