import { createPdfDomSession } from './adapter.js';
import {
  parsePdfCommand,
  PDF_PROTOCOL,
  PDF_PROTOCOL_VERSION,
} from './protocol.js';

const fragment = new URLSearchParams(location.hash.slice(1));
const identity = {
  sessionId: fragment.get('sessionId'),
  generation: Number(fragment.get('generation')),
};
const valid =
  /^[a-f0-9-]{36}$/.test(identity.sessionId ?? '') &&
  Number.isSafeInteger(identity.generation) &&
  identity.generation > 0;
let session;
let opened = false;
let disposed = false;
let lastCommand = 0;
const send = (value, commandId = 0) => {
  if (!disposed)
    parent.postMessage(
      {
        protocol: PDF_PROTOCOL,
        version: PDF_PROTOCOL_VERSION,
        ...identity,
        commandId,
        ...value,
      },
      location.origin,
    );
};
const dispose = () => {
  if (disposed) return;
  disposed = true;
  window.removeEventListener('message', receive);
  session?.dispose();
  session = undefined;
};
async function receive(event) {
  if (disposed || event.source !== parent || event.origin !== location.origin)
    return;
  const command = parsePdfCommand(event.data, identity);
  if (!command || command.commandId <= lastCommand) return;
  lastCommand = command.commandId;
  if (command.type === 'dispose') {
    dispose();
    return;
  }
  if (command.type === 'open') {
    if (opened) return;
    opened = true;
    const bytes = new Uint8Array(command.bytes);
    try {
      const viewport = document.querySelector('main');
      session = createPdfDomSession({
        viewport,
        coordinateRoot: viewport,
        bytes,
        identity,
        assetBaseUrl: new URL('./', location.href).href,
        onSelectionError: (message) =>
          send({ type: 'selection-error', message }),
        onHighlightHit: (id, rect) => send({ type: 'highlight-hit', id, rect }),
        onPopoverDismiss: () =>
          send({
            type: 'highlight-hit',
            id: '__dismiss__',
            rect: { x: 0, y: 0, width: 0, height: 0 },
          }),
        events: {
          onStateChange: (state) => send({ type: 'state', state }),
          onMetadata() {},
          onPageChange: (page) => send({ type: 'page', page }),
          onSelectionChange: (_identity, selection) =>
            send({ type: 'selection', selection }),
        },
      });
    } catch {
      send({
        type: 'state',
        state: {
          ...identity,
          status: 'error',
          error: {
            category: 'render',
            code: 'PDF_RUNTIME_UNAVAILABLE',
            message: 'The PDF runtime could not be started.',
          },
        },
      });
    } finally {
      bytes.fill(0);
    }
    return;
  }
  if (!session) return;
  if (command.type === 'clear') session.clearSelection();
  else if (command.type === 'highlights') {
    try {
      session.setHighlights(command.highlights);
      send({ type: 'result', result: true }, command.commandId);
    } catch {
      send({ type: 'result', result: false }, command.commandId);
    }
  } else if (command.type === 'scale') session.setScale(command.scale);
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
}
if (valid && parent !== window) {
  window.addEventListener('message', receive);
  window.addEventListener('pagehide', dispose, { once: true });
  send({ type: 'boot' });
}
