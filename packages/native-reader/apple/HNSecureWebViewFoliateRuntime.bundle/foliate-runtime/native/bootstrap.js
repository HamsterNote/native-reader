import {
  applyFoliateHostCommand,
  createFoliateHostCommandLedger,
  parseFoliateHostMessage,
  receiveFoliateHostMessageWithIdentity,
  serializeFoliateHostMessage,
} from './nativeFoliateProtocol.js';
import { createNativePublicationTransfer } from './nativePublicationTransfer.js';
import { installNativeRenderer } from './renderer.js';

const FOLIATE_NATIVE_HOST_VERSION = 'foliate-native-host-1';
const FOLIATE_HOST_PROTOCOL = 'hn-foliate-host';
const FOLIATE_HOST_PROTOCOL_VERSION = 1;
void FOLIATE_NATIVE_HOST_VERSION;
let privatePort = null;
let installed = false;
let binding = null;
let transfer = null;
let renderer = null;
let model = null;
let pending = null;

function send(command, type, payload) {
  if (!privatePort || !binding) return;
  const envelope = {
    protocol: FOLIATE_HOST_PROTOCOL,
    version: FOLIATE_HOST_PROTOCOL_VERSION,
    direction: 'host-to-native',
    type,
    session: binding.session,
    generation: binding.generation,
    commandId: command?.commandId ?? binding.lastCommandId,
    payload,
  };
  const wire = serializeFoliateHostMessage(envelope);
  if (applyFoliateHostCommand(binding, envelope).disposition !== 'accepted')
    return teardown();
  if (
    (type === 'ack' || type === 'error') &&
    pending?.commandId === envelope.commandId
  )
    pending = null;
  privatePort.postMessage(wire);
}
function ack(command, status) {
  send(command, 'ack', { command: command.type, status });
}
function teardown() {
  const port = privatePort;
  privatePort = null;
  const owner = binding;
  const receiver = transfer;
  const render = renderer;
  binding = transfer = renderer = model = pending = null;
  if (owner) owner.terminal = true;
  try {
    receiver?.dispose();
  } catch {
    /* Continue closing the channel. */
  }
  try {
    render?.({
      type: 'dispose',
      protocolVersion: 1,
      session: owner?.session,
      generation: owner?.generation,
      payload: {},
    });
  } catch {
    /* Continue closing the channel. */
  }
  try {
    port?.removeEventListener?.('message', receive);
  } catch {
    /* terminal */
  }
  try {
    port?.close?.();
  } catch {
    /* terminal */
  }
}
function violation() {
  try {
    if (binding && privatePort)
      privatePort.postMessage(
        serializeFoliateHostMessage({
          protocol: FOLIATE_HOST_PROTOCOL,
          version: 1,
          direction: 'host-to-native',
          type: 'error',
          session: binding.session,
          generation: binding.generation,
          commandId: pending?.commandId ?? binding.lastCommandId,
          payload: { code: 'protocol-violation', terminal: true },
        }),
      );
  } catch {
    /* A terminal relay must close even if the encoder fails. */
  } finally {
    teardown();
  }
}
function runtimeEvent(event) {
  if (
    !binding ||
    event.session !== binding.session ||
    event.generation !== binding.generation
  )
    return;
  if (event.type === 'probe-result') {
    if (!pending || pending.type !== 'probe') return;
    if (!event.passed) {
      send(pending, 'error', { code: 'unsupported', terminal: true });
      return teardown();
    }
    ack(pending, 'source-authorized');
  } else if (event.type === 'publication-model') {
    const dto = event.model;
    model = {
      ...dto,
      sections: dto.sections.map(({ key, index, linear }) => ({
        id: key,
        index,
        linear,
      })),
      destinations: dto.destinations.map(
        ({ id, sectionKey, sectionIndex }) => ({
          id,
          sectionId: sectionKey,
          sectionIndex,
        }),
      ),
    };
    send(null, 'model', { model });
  } else if (event.type === 'model' && model) {
    model = { ...model, fixedLayout: event.fixedLayout, flow: event.flow };
    send(null, 'model', { model });
  } else if (event.type === 'location') {
    send(null, 'location', { section: event.index, destination: null });
  } else if (event.type === 'ready') {
    if (
      !model ||
      pending?.type !== 'transfer' ||
      pending.payload.type !== 'commit'
    )
      return violation();
    send(null, 'location', {
      section: model.sections.find((section) => section.linear)?.index ?? 0,
      destination: null,
    });
    ack(pending, 'ready');
  } else if (
    event.type === 'command-ack' &&
    ['navigate', 'flow'].includes(event.command)
  ) {
    if (pending?.type !== event.command) return violation();
    ack(pending, 'applied');
  } else if (event.type === 'error') {
    const recoverable =
      pending?.type === 'navigate' && event.code === 'navigation-failure';
    send(pending, 'error', {
      code: recoverable ? 'navigation-failure' : 'render-failure',
      terminal: !recoverable,
    });
    if (!recoverable) teardown();
  }
}
async function handle(command, owner) {
  pending = command;
  if (command.type === 'bind') {
    ack(command, 'bridge-bound');
    return;
  }
  if (command.type === 'dispose') {
    ack(command, 'unsupported');
    return teardown();
  }
  const runtimeCommand = {
    protocolVersion: 1,
    session: owner.session,
    generation: owner.generation,
    type: command.type,
    payload: command.payload,
  };
  if (command.type === 'probe') {
    renderer(runtimeCommand);
    return;
  }
  if (command.type === 'transfer') {
    const message = command.payload;
    if (!transfer) {
      if (message.type !== 'begin') return violation();
      transfer = createNativePublicationTransfer(
        {
          session: owner.session,
          generation: owner.generation,
          transferId: message.transferId,
        },
        () =>
          binding === owner &&
          owner.sourceAuthorized === true &&
          !owner.terminal,
      );
    }
    const receiver = transfer;
    const result = await receiver.receive(message);
    if (binding !== owner || owner.terminal || transfer !== receiver) return;
    if (result.status === 'committed') {
      const { bytes, format, name, mimeType } = result.publication;
      const file = new Blob([bytes], { type: mimeType });
      bytes.fill(0);
      renderer({
        ...runtimeCommand,
        type: 'open',
        payload: { file, format, name, mimeType },
      });
    } else if (result.status === 'accepted') {
      ack(command, 'accepted');
    } else if (result.status === 'aborted') {
      ack(command, 'aborted');
      teardown();
    } else return violation();
    return;
  }
  if (command.type === 'navigate') {
    runtimeCommand.payload =
      typeof command.payload.target === 'number'
        ? { section: command.payload.target }
        : { destination: command.payload.target };
  }
  if (!model) {
    ack(command, 'not-ready');
    return;
  }
  renderer(runtimeCommand);
}
function receive(event) {
  try {
    if (!privatePort) return;
    if (!binding) {
      const parsed = parseFoliateHostMessage(event?.data);
      if (
        !parsed.ok ||
        parsed.value.type !== 'bind' ||
        parsed.value.direction !== 'native-to-host'
      )
        return teardown();
      binding = createFoliateHostCommandLedger(
        parsed.value.session,
        parsed.value.generation,
      );
    }
    const result = receiveFoliateHostMessageWithIdentity(
      {
        authenticated: true,
        expectedDirection: 'native-to-host',
        expectedSession: binding.session,
        expectedGeneration: binding.generation,
        ledger: binding,
      },
      event?.data,
    );
    if (result.disposition === 'terminal-violation') return violation();
    if (result.disposition !== 'accepted') return;
    void handle(result.envelope, binding).catch(violation);
  } catch {
    violation();
  }
}

// Only the native-owned port/isolated relay calls this lexical module export.
export function installFoliateNativeHostBridge(port) {
  if (
    installed ||
    !port ||
    typeof port.postMessage !== 'function' ||
    typeof port.addEventListener !== 'function'
  )
    return false;
  installed = true;
  privatePort = port;
  renderer = installNativeRenderer(runtimeEvent);
  port.addEventListener('message', receive);
  port.start?.();
  return true;
}
