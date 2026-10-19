import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const getInfoAsync = jest.fn();
const readAsStringAsync = jest.fn();
const deleteAsync = jest.fn();
const copyAsync = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync,
  readAsStringAsync,
  deleteAsync,
  copyAsync,
  EncodingType: { Base64: 'base64' },
}));
jest.mock('expo-crypto', () => ({
  getRandomValues: (bytes: Uint8Array<ArrayBuffer>) =>
    globalThis.crypto.getRandomValues(bytes),
  digest: (algorithm: string, bytes: Uint8Array<ArrayBuffer>) =>
    globalThis.crypto.subtle.digest(algorithm, bytes),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
import { createNativeReaderSession } from './nativeReaderSession';
import { createNativePublicationTransfer } from './nativePublicationTransfer';
import type { FoliateHostEnvelope } from './nativeFoliateProtocol';

const bytes = readFileSync(
  path.resolve(__dirname, '../../../fixtures/fb2/valid-navigation.fb2'),
);
const source = { kind: 'uri' as const, uri: 'content://private/document/book' };
const model = {
  modelVersion: 1,
  format: 'fb2',
  fixedLayout: false,
  flow: 'scrolled',
  direction: 'ltr',
  metadata: { title: 'Reader' },
  sections: [
    { id: 's:0', index: 0, linear: true },
    { id: 's:1', index: 1, linear: true },
  ],
  destinations: [{ id: 'd:0', sectionId: 's:1', sectionIndex: 1 }],
  toc: [{ id: 'toc:0', destinationId: 'd:0', label: 'Second', subitems: [] }],
};
const sessions: ReturnType<typeof createNativeReaderSession>[] = [];
beforeEach(() => {
  getInfoAsync.mockReset().mockResolvedValue({
    exists: true,
    isDirectory: false,
    size: bytes.length,
  });
  readAsStringAsync
    .mockReset()
    .mockImplementation(async (_uri, { position, length }) =>
      bytes.subarray(position, position + length).toString('base64'),
    );
});
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  expect(deleteAsync).not.toHaveBeenCalled();
  expect(copyAsync).not.toHaveBeenCalled();
  jest.useRealTimers();
});
const tick = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
function setup({
  holdProbe = false,
  rejectProbe = false,
  timeout = 15000,
  holdCommit = false,
  holdNavigate = false,
} = {}) {
  const onState = jest.fn();
  const onSnapshot = jest.fn();
  const wires: FoliateHostEnvelope[] = [];
  let receiver: ReturnType<typeof createNativePublicationTransfer>;
  let current = true;
  let closed = false;
  let resolveCommit!: () => void;
  const commitSent = new Promise<void>((resolve) => {
    resolveCommit = resolve;
  });
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const session = createNativeReaderSession({
    source,
    isCurrent: () => current,
    timeout,
    onState: (state) => {
      onState(state);
      if (state.status === 'ready' || state.status === 'error') resolveReady();
    },
    onSnapshot,
  });
  sessions.push(session);
  const reply = (
    command: FoliateHostEnvelope,
    type: string,
    payload: Record<string, unknown>,
  ) =>
    session.receive(
      JSON.stringify({
        ...command,
        direction: 'host-to-native',
        type,
        payload,
      }),
    );
  const ack = (command: FoliateHostEnvelope, status: string) =>
    reply(command, 'ack', { command: command.type, status });
  const transport = {
    postMessage(wire: string) {
      const command = JSON.parse(wire) as FoliateHostEnvelope;
      wires.push(command);
      if (command.type === 'bind') ack(command, 'bridge-bound');
      else if (command.type === 'probe') {
        if (rejectProbe)
          reply(command, 'error', { code: 'unsupported', terminal: true });
        else if (!holdProbe) ack(command, 'source-authorized');
      } else if (command.type === 'transfer') {
        if (command.payload.type === 'begin')
          receiver = createNativePublicationTransfer(
            {
              session: command.session,
              generation: command.generation,
              transferId: command.payload.transferId as string,
            },
            () => !closed,
            async (value) => createHash('sha256').update(value).digest('hex'),
          );
        if (command.payload.type === 'commit') resolveCommit();
        void receiver.receive(command.payload).then((result) => {
          if (result.status === 'committed') {
            expect(Buffer.from(result.publication.bytes)).toEqual(bytes);
            if (holdCommit) return;
            reply(command, 'model', { model });
            reply(command, 'location', { section: 0, destination: null });
            ack(command, 'ready');
          } else ack(command, result.status);
        });
      } else if (command.type === 'navigate') {
        if (holdNavigate) return;
        if (command.payload.target === 'd:999')
          reply(command, 'error', {
            code: 'navigation-failure',
            terminal: false,
          });
        else {
          reply(command, 'location', { section: 1, destination: null });
          ack(command, 'applied');
        }
      } else if (command.type === 'flow') {
        reply(command, 'model', {
          model: { ...model, flow: command.payload.flow },
        });
        ack(command, 'applied');
      } else if (command.type === 'dispose') {
        closed = true;
        receiver?.dispose();
        ack(command, 'unsupported');
      }
    },
  };
  session.connect(transport);
  return {
    session,
    wires,
    onState,
    onSnapshot,
    ready,
    commitSent,
    reply,
    ack,
    retire: () => {
      current = false;
      session.dispose();
    },
  };
}

test('bind alone cannot read; independent probe authorizes canonical contiguous digest-checked transfer and real-ready projection', async () => {
  const value = setup({ holdProbe: true });
  await tick();
  expect(value.wires.map((wire) => wire.type)).toEqual(['bind', 'probe']);
  expect(getInfoAsync).not.toHaveBeenCalled();
  expect(value.onState).not.toHaveBeenCalled();
  value.ack(value.wires[1], 'source-authorized');
  await value.ready;
  expect(value.onState).toHaveBeenLastCalledWith({ status: 'ready' });
  expect(value.onSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({
    section: 0,
    model: { flow: 'scrolled', layout: 'reflowable' },
  });
  expect(JSON.stringify(value.wires)).not.toContain(source.uri);
  expect(new Set(value.wires.map((wire) => wire.commandId)).size).toBe(
    value.wires.length,
  );
  expect(
    value.wires.every((wire) => /^[A-Za-z0-9_-]{43}$/.test(wire.commandId)),
  ).toBe(true);
  await value.session.navigate('d:0');
  expect(value.onSnapshot.mock.calls.at(-1)?.[0].section).toBe(1);
  await value.session.navigate('d:999');
  expect(value.onSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({
    section: 1,
    navigationError: { category: 'render' },
  });
  await value.session.flow('paginated');
  expect(value.onSnapshot.mock.calls.at(-1)?.[0].model.flow).toBe('paginated');
  await value.session.flow('scrolled');
  expect(value.onSnapshot.mock.calls.at(-1)?.[0].model.flow).toBe('scrolled');
  expect(getInfoAsync).toHaveBeenCalledTimes(1);
});

test('failed preflight is stable unsupported with zero source I/O', async () => {
  const value = setup({ rejectProbe: true });
  await value.ready;
  expect(value.onState).toHaveBeenLastCalledWith({
    status: 'error',
    error: expect.objectContaining({ category: 'unsupported' }),
  });
  expect(getInfoAsync).not.toHaveBeenCalled();
  expect(readAsStringAsync).not.toHaveBeenCalled();
});

test('a late probe cannot authorize a retired source and retirement disposes only once', async () => {
  const value = setup({ holdProbe: true });
  await tick();
  value.retire();
  value.session.dispose();
  value.ack(value.wires[1], 'source-authorized');
  await tick();
  expect(getInfoAsync).not.toHaveBeenCalled();
  expect(value.wires.filter((wire) => wire.type === 'dispose')).toHaveLength(1);
  expect(value.onState).not.toHaveBeenCalled();
});

test('retirement during metadata prevents read, transfer, and state revival', async () => {
  let release!: (value: unknown) => void;
  getInfoAsync.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const value = setup();
  // Native digest is asynchronous; wait for metadata rather than a timer guess.
  await new Promise<void>((resolve) => {
    getInfoAsync.mockImplementationOnce(() => {
      resolve();
      return new Promise((done) => {
        release = done;
      });
    });
  });
  value.retire();
  release({ exists: true, isDirectory: false, size: bytes.length });
  await tick();
  expect(readAsStringAsync).not.toHaveBeenCalled();
  expect(value.wires.some((wire) => wire.type === 'transfer')).toBe(false);
  expect(value.onState).not.toHaveBeenCalled();
});

test('timeout during unacknowledged probe closes before I/O', async () => {
  jest.useFakeTimers();
  const value = setup({ holdProbe: true, timeout: 20 });
  await tick();
  jest.advanceTimersByTime(21);
  await value.ready;
  expect(value.onState).toHaveBeenLastCalledWith({
    status: 'error',
    error: expect.objectContaining({ code: 'LOAD_TIMEOUT' }),
  });
  expect(getInfoAsync).not.toHaveBeenCalled();
});

test('commit acceptance cannot claim ready without a model and initial readable location', async () => {
  const value = setup({ holdCommit: true });
  await value.commitSent;
  value.ack(value.wires.at(-1)!, 'ready');
  await value.ready;
  expect(value.onState.mock.calls.map(([state]) => state.status)).toEqual([
    'error',
  ]);
});

test('a controlled flow change during navigation is applied after that command completes', async () => {
  const value = setup({ holdNavigate: true });
  await value.ready;
  const navigating = value.session.navigate(1);
  const navigation = value.wires.at(-1)!;
  await value.session.flow('paginated');
  expect(value.wires.at(-1)?.type).toBe('navigate');
  value.reply(navigation, 'location', { section: 1, destination: null });
  value.ack(navigation, 'applied');
  await navigating;
  await tick();
  expect(value.onSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({
    section: 1,
    model: { flow: 'paginated' },
  });
});

test('page no-op requires matching state and ack and serializes a deferred flow', async () => {
  const value = setup({ timeout: 0 });
  await value.ready;
  const paging = value.session.page('next');
  const command = value.wires.at(-1)!;
  expect(command.type).toBe('page');
  await value.session.flow('paginated');
  value.reply({ ...command, commandId: 'z'.repeat(43) }, 'page-state', {
    revision: 9,
    canGoPrevious: true,
    canGoNext: false,
  });
  expect(value.onSnapshot.mock.calls.at(-1)?.[0].navigationPending).toBe(true);
  value.ack(command, 'applied');
  expect(value.onSnapshot.mock.calls.at(-1)?.[0].navigationPending).toBe(true);
  value.reply(command, 'page-state', {
    revision: 1,
    canGoPrevious: false,
    canGoNext: false,
  });
  await paging;
  await tick();
  expect(value.wires.at(-1)?.type).toBe('flow');
  expect(value.onSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({
    section: 0,
    model: { flow: 'paginated' },
    navigationPending: false,
  });
  value.reply(value.wires.at(-1)!, 'page-state', {
    revision: 0,
    canGoPrevious: true,
    canGoNext: true,
  });
  expect(value.onSnapshot.mock.calls.at(-1)?.[0].canGoPrevious).toBeNull();
});

test('page has an independent finite deadline and retired replies cannot revive it', async () => {
  const value = setup({ timeout: 0 });
  await value.ready;
  jest.useFakeTimers();
  const paging = value.session.page('next');
  const command = value.wires.at(-1)!;
  jest.advanceTimersByTime(5000);
  await paging;
  expect(value.onState).toHaveBeenLastCalledWith({
    status: 'error',
    error: expect.objectContaining({ category: 'render' }),
  });
  const count = value.onSnapshot.mock.calls.length;
  value.reply(command, 'page-state', {
    revision: 1,
    canGoPrevious: true,
    canGoNext: true,
  });
  value.ack(command, 'applied');
  expect(value.onSnapshot).toHaveBeenCalledTimes(count);
  expect(value.wires.filter((wire) => wire.type === 'dispose')).toHaveLength(1);
});
