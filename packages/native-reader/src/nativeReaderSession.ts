import {
  normalizePublicationModelDto,
  type NormalizedPublicationModel,
} from './publicationModelDto';
import { createNativeProtocolId, digestNativeSource } from './nativeCrypto';
import {
  applyFoliateHostCommand,
  createFoliateHostCommandLedger,
  receiveFoliateHostMessageWithIdentity,
  serializeFoliateHostMessage,
  type FoliateHostEnvelope,
  type FoliateNativeCommandType,
} from './nativeFoliateProtocol';
import { NATIVE_PUBLICATION_CHUNK_BYTES } from './nativePublicationTransfer';
import { NativeSourceError, prepareNativeSource } from './nativeSource';
import type {
  ReaderError,
  ReaderLoadState,
  ReaderReadingFlow,
  ReaderSource,
} from './types';

export type NativeReaderTransport = { postMessage(data: string): void };
export type NativeReaderSnapshot = {
  model?: NormalizedPublicationModel;
  section?: number;
  navigationError?: ReaderError;
};
export const nativeHostUnavailableError = (): ReaderError => ({
  category: 'unsupported',
  code: 'UNSUPPORTED_EPUB',
  message: 'The native publication host is unavailable.',
});
const renderError = (): ReaderError => ({
  category: 'render',
  code: 'RENDER_FAILED',
  message: 'The publication could not be displayed.',
});
const navigationError = (): ReaderError => ({
  category: 'render',
  code: 'RENDER_FAILED',
  message: 'This location is unavailable.',
});

function encodeChunk(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const value =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    output += alphabet[(value >>> 18) & 63] + alphabet[(value >>> 12) & 63];
    output += i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=';
    output += i + 2 < bytes.length ? alphabet[value & 63] : '=';
  }
  return output;
}

/** One source, one transport, one inflight command. Retirement is synchronous. */
export function createNativeReaderSession(options: {
  source: ReaderSource;
  isCurrent(): boolean;
  timeout: number;
  onState(state: ReaderLoadState): void;
  onSnapshot(snapshot: NativeReaderSnapshot): void;
}) {
  const session = createNativeProtocolId();
  const generation = createNativeProtocolId();
  const bindCommandId = createNativeProtocolId();
  const ledger = createFoliateHostCommandLedger(session, generation);
  let transport: NativeReaderTransport | undefined;
  let disposed = false;
  let ready = false;
  let requestedFlow: ReaderReadingFlow | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let prepared: Awaited<ReturnType<typeof prepareNativeSource>> | undefined;
  let snapshot: NativeReaderSnapshot = {};
  let pending:
    | {
        envelope: FoliateHostEnvelope;
        resolve(status: string): void;
        reject(error: Error): void;
        location?: number;
      }
    | undefined;
  const current = () => !disposed && options.isCurrent();
  const emit = () => {
    if (current()) options.onSnapshot(snapshot);
  };
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const release = () => {
    prepared?.cleanup();
    prepared = undefined;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimer();
    release();
    const inflight = pending;
    pending = undefined;
    inflight?.reject(new Error('Retired native reader'));
    // Capture the original channel. Never look up a replacement React ref.
    if (transport && ledger.bound && !ledger.terminal) {
      try {
        const envelope: FoliateHostEnvelope = {
          protocol: 'hn-foliate-host',
          version: 1,
          direction: 'native-to-host',
          type: 'dispose',
          session,
          generation,
          commandId: createNativeProtocolId(),
          payload: {},
        };
        const wire = serializeFoliateHostMessage(envelope);
        if (
          applyFoliateHostCommand(ledger, envelope).disposition === 'accepted'
        )
          transport.postMessage(wire);
      } catch {
        /* Host unmount also invalidates its private port. */
      }
    }
    ledger.terminal = true;
    ledger.sourceAuthorized = false;
    transport = undefined;
  };
  const fail = (error = nativeHostUnavailableError()) => {
    if (!current()) return;
    dispose();
    options.onState({ status: 'error', error });
  };
  const progress = () => {
    clearTimer();
    if (options.timeout > 0 && current())
      timer = setTimeout(
        () =>
          fail({
            category: 'render',
            code: 'LOAD_TIMEOUT',
            message: 'The publication stopped responding.',
          }),
        options.timeout,
      );
  };
  const send = (
    type: FoliateNativeCommandType,
    payload: Record<string, unknown>,
    id = createNativeProtocolId(),
  ): Promise<string> => {
    if (!current() || !transport || pending)
      return Promise.reject(new Error('Native command unavailable'));
    const envelope: FoliateHostEnvelope = {
      protocol: 'hn-foliate-host',
      version: 1,
      direction: 'native-to-host',
      type,
      session,
      generation,
      commandId: id,
      payload,
    };
    return new Promise((resolve, reject) => {
      try {
        const wire = serializeFoliateHostMessage(envelope);
        if (
          applyFoliateHostCommand(ledger, envelope).disposition !== 'accepted'
        )
          throw new Error('Native protocol rejected');
        pending = { envelope, resolve, reject };
        progress();
        transport!.postMessage(wire);
      } catch (error) {
        pending = undefined;
        reject(
          error instanceof Error ? error : new Error('Native send failed'),
        );
      }
    });
  };
  const flushFlow = async () => {
    if (
      !ready ||
      !current() ||
      pending ||
      !requestedFlow ||
      snapshot.model?.layout !== 'reflowable'
    )
      return;
    const flow = requestedFlow;
    requestedFlow = undefined;
    if (snapshot.model.flow === flow) return;
    try {
      if ((await send('flow', { flow })) !== 'applied') fail(renderError());
    } catch {
      fail(renderError());
    }
  };
  const open = async () => {
    try {
      if (
        (await send('bind', {}, bindCommandId)) !== 'bridge-bound' ||
        !current()
      )
        return;
      if ((await send('probe', {})) !== 'source-authorized' || !current())
        return fail();
      // Exercise the native hash facility before publication I/O. Expo supplies
      // secure entropy/digest on Hermes; Web Crypto is only used inside the host.
      await digestNativeSource(new Uint8Array());
      if (!current()) return;
      const source = await prepareNativeSource(
        options.source,
        () => current() && ledger.sourceAuthorized === true,
        progress,
      );
      if (!current()) {
        source.cleanup();
        return;
      }
      prepared = source;
      const sha256 = await digestNativeSource(source.bytes);
      if (!current()) return;
      const transferId = createNativeProtocolId();
      const transfer = (
        type: 'begin' | 'chunk' | 'commit',
        payload: Record<string, unknown>,
      ) => {
        const commandId = createNativeProtocolId();
        return send(
          'transfer',
          {
            protocol: 'hn-foliate-transfer',
            version: 1,
            session,
            generation,
            transferId,
            commandId,
            type,
            payload,
          },
          commandId,
        );
      };
      if (
        (await transfer('begin', {
          byteLength: source.bytes.length,
          sha256,
          chunkBytes: NATIVE_PUBLICATION_CHUNK_BYTES,
          format: source.format,
          name: source.name,
          mimeType: source.mimeType,
        })) !== 'accepted'
      )
        throw new Error('Transfer rejected');
      let sequence = 0;
      for (
        let offset = 0;
        offset < source.bytes.length;
        offset += NATIVE_PUBLICATION_CHUNK_BYTES
      ) {
        if (!current()) return;
        if (
          (await transfer('chunk', {
            sequence,
            data: encodeChunk(
              source.bytes.subarray(
                offset,
                offset + NATIVE_PUBLICATION_CHUNK_BYTES,
              ),
            ),
          })) !== 'accepted'
        )
          throw new Error('Chunk rejected');
        sequence++;
      }
      if (
        (await transfer('commit', { chunks: sequence })) !== 'ready' ||
        !snapshot.model ||
        snapshot.section === undefined ||
        !snapshot.model.sections[snapshot.section]?.linear
      )
        throw new Error('Missing publication readiness');
      if (!current()) return;
      release();
      ready = true;
      clearTimer();
      emit();
      options.onState({ status: 'ready' });
    } catch (error) {
      release();
      fail(
        error instanceof NativeSourceError ? error.readerError : renderError(),
      );
    }
  };
  return {
    generation,
    get disposed() {
      return disposed;
    },
    dispose,
    fail,
    connect(value: NativeReaderTransport | null) {
      if (!current() || transport || ledger.bound) return;
      if (!value) return fail();
      transport = value;
      void open();
    },
    receive(data: unknown) {
      if (!current()) return;
      try {
        const result = receiveFoliateHostMessageWithIdentity(
          {
            authenticated: true,
            expectedDirection: 'host-to-native',
            expectedSession: session,
            expectedGeneration: generation,
            ledger,
          },
          data as string,
        );
        if (result.disposition === 'terminal-violation') return fail();
        if (result.disposition !== 'accepted') return;
        const event = result.envelope;
        if (ledger.terminal)
          return fail(
            event.payload.code === 'render-failure'
              ? renderError()
              : nativeHostUnavailableError(),
          );
        if (event.type === 'ack' || event.type === 'error') {
          const command = pending;
          if (!command || command.envelope.commandId !== event.commandId)
            return fail();
          pending = undefined;
          if (ready) clearTimer();
          else progress();
          if (event.type === 'error') {
            snapshot = { ...snapshot, navigationError: navigationError() };
            emit();
            command.resolve('rejected');
          } else {
            if (command.location !== undefined)
              snapshot = {
                ...snapshot,
                section: command.location,
                navigationError: undefined,
              };
            emit();
            command.resolve(event.payload.status as string);
          }
          void flushFlow();
        } else if (event.type === 'model') {
          const model = event.payload.model as Record<string, unknown>;
          const normalized = normalizePublicationModelDto({
            ...model,
            sections: (
              model.sections as { id: string; index: number; linear: boolean }[]
            ).map(({ id, ...section }) => ({
              ...section,
              key: id,
              bytes: null,
            })),
            destinations: (
              model.destinations as {
                id: string;
                sectionId: string;
                sectionIndex: number;
              }[]
            ).map(({ sectionId, ...destination }) => ({
              ...destination,
              sectionKey: sectionId,
            })),
          });
          if (!normalized) return fail();
          snapshot = { ...snapshot, model: normalized };
          if (!ready) progress();
          emit();
        } else if (event.type === 'location') {
          const section = event.payload.section as number;
          if (!snapshot.model?.sections[section]) return fail();
          if (pending?.envelope.type === 'navigate') pending.location = section;
          else {
            snapshot = { ...snapshot, section };
            emit();
          }
          if (!ready) progress();
        }
      } catch {
        fail();
      }
    },
    async navigate(target: number | string) {
      if (!ready || !current() || pending) return;
      try {
        await send('navigate', { target });
      } catch {
        fail(renderError());
      }
    },
    async flow(flow: ReaderReadingFlow) {
      requestedFlow = flow;
      await flushFlow();
    },
  };
}
