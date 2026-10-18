import { CANONICAL_FORMAT_TUPLES } from './publicationFormats';
import type { ReaderPublicationFormat } from './types';

export const NATIVE_PUBLICATION_MAX_BYTES = 32 * 1024 * 1024;
export const NATIVE_PUBLICATION_CHUNK_BYTES = 48 * 1024;

export type NativePublicationIdentity = Readonly<{
  session: string;
  generation: string;
  transferId: string;
}>;

export type NativeTransferMessage = NativePublicationIdentity & {
  protocol: 'hn-foliate-transfer';
  version: 1;
  commandId: string;
  type: 'begin' | 'chunk' | 'commit' | 'abort';
  payload: Record<string, unknown>;
};

export type CommittedNativePublication = {
  bytes: Uint8Array;
  format: ReaderPublicationFormat;
  name: string;
  mimeType: string;
};

type TransferResult =
  | { status: 'accepted' | 'ignored' | 'aborted' | 'rejected' }
  | { status: 'committed'; publication: CommittedNativePublication };

const token = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function validateNativeTransferMessage(
  value: unknown,
): value is NativeTransferMessage {
  if (
    !record(value) ||
    !keys(value, [
      'protocol',
      'version',
      'session',
      'generation',
      'transferId',
      'commandId',
      'type',
      'payload',
    ]) ||
    value.protocol !== 'hn-foliate-transfer' ||
    value.version !== 1 ||
    !token(value.session) ||
    !token(value.generation) ||
    !token(value.transferId) ||
    !token(value.commandId) ||
    !record(value.payload)
  )
    return false;
  const p = value.payload;
  if (value.type === 'abort') return keys(p, []);
  if (value.type === 'commit')
    return (
      keys(p, ['chunks']) &&
      integer(p.chunks) &&
      p.chunks > 0 &&
      p.chunks <= 683
    );
  if (value.type === 'chunk')
    return (
      keys(p, ['sequence', 'data']) &&
      integer(p.sequence) &&
      p.sequence < 683 &&
      typeof p.data === 'string' &&
      p.data.length > 0 &&
      p.data.length <= 65536 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        p.data,
      )
    );
  if (
    value.type !== 'begin' ||
    !keys(p, [
      'byteLength',
      'sha256',
      'chunkBytes',
      'format',
      'name',
      'mimeType',
    ]) ||
    !integer(p.byteLength) ||
    p.byteLength < 1 ||
    p.byteLength > NATIVE_PUBLICATION_MAX_BYTES ||
    p.chunkBytes !== NATIVE_PUBLICATION_CHUNK_BYTES ||
    typeof p.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(p.sha256) ||
    typeof p.format !== 'string' ||
    !Object.hasOwn(CANONICAL_FORMAT_TUPLES, p.format)
  )
    return false;
  const tuple = CANONICAL_FORMAT_TUPLES[p.format as ReaderPublicationFormat];
  return p.name === tuple.name && p.mimeType === tuple.mimeType;
}

/** Canonical base64 only; limits are checked before allocating decoded bytes. */
export function decodeNativeChunk(value: unknown, limit: number): Uint8Array {
  if (
    typeof value !== 'string' ||
    !integer(limit) ||
    value.length > Math.ceil(limit / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error('Invalid native chunk');
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const length = (value.length / 4) * 3 - padding;
  if (length > limit || length < 0) throw new Error('Invalid native chunk');
  if (
    padding &&
    alphabet.indexOf(value[value.length - padding - 1]) &
      (padding === 2 ? 15 : 3)
  )
    throw new Error('Noncanonical native chunk');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (let index = 0; index < value.length; index += 4) {
    const group =
      (alphabet.indexOf(value[index]) << 18) |
      (alphabet.indexOf(value[index + 1]) << 12) |
      (Math.max(0, alphabet.indexOf(value[index + 2])) << 6) |
      Math.max(0, alphabet.indexOf(value[index + 3]));
    for (const shift of [16, 8, 0]) {
      if (offset < length) bytes[offset++] = (group >>> shift) & 255;
    }
  }
  return bytes;
}

export async function nativePublicationDigest(
  bytes: Uint8Array,
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(bytes),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * One receiver per authenticated private session. Transport authentication and
 * strict JSON scanning MUST precede this state machine. A bind is insufficient:
 * the caller supplies the independently proved and still-current source gate.
 * No bytes escape before exact length/digest verification. It owns no host URI.
 */
export function createNativePublicationTransfer(
  identity: NativePublicationIdentity,
  isAuthorized: () => boolean,
  digest: (bytes: Uint8Array) => Promise<string> = nativePublicationDigest,
) {
  if (!Object.values(identity).every(token))
    throw new Error('Invalid transfer identity');
  let phase: 'fresh' | 'receiving' | 'verifying' | 'closed' = 'fresh';
  let buffer: Uint8Array | undefined;
  let offset = 0;
  let sequence = 0;
  let expectedDigest = '';
  let format: ReaderPublicationFormat | undefined;
  const usedCommands = new Set<string>();
  const close = () => {
    phase = 'closed';
    buffer?.fill(0);
    buffer = undefined;
  };
  const reject = (): TransferResult => {
    close();
    return { status: 'rejected' };
  };
  return {
    dispose: close,
    async receive(value: unknown): Promise<TransferResult> {
      if (phase === 'closed') return { status: 'ignored' };
      try {
        if (!isAuthorized()) return reject();
        if (!record(value)) return reject();
        for (const field of ['session', 'generation', 'transferId'] as const) {
          if (token(value[field]) && value[field] !== identity[field])
            return { status: 'ignored' };
        }
        if (
          !keys(value, [
            'protocol',
            'version',
            'session',
            'generation',
            'transferId',
            'commandId',
            'type',
            'payload',
          ]) ||
          value.protocol !== 'hn-foliate-transfer' ||
          value.version !== 1 ||
          !token(value.session) ||
          !token(value.generation) ||
          !token(value.transferId) ||
          !token(value.commandId) ||
          !record(value.payload)
        )
          return reject();
        if (usedCommands.has(value.commandId) || usedCommands.size >= 1024)
          return reject();
        usedCommands.add(value.commandId);
        const payload = value.payload;
        if (value.type === 'abort') {
          if (!keys(payload, [])) return reject();
          close();
          return { status: 'aborted' };
        }
        if (value.type === 'begin') {
          if (
            phase !== 'fresh' ||
            !keys(payload, [
              'byteLength',
              'sha256',
              'chunkBytes',
              'format',
              'name',
              'mimeType',
            ]) ||
            !integer(payload.byteLength) ||
            payload.byteLength < 1 ||
            payload.byteLength > NATIVE_PUBLICATION_MAX_BYTES ||
            payload.chunkBytes !== NATIVE_PUBLICATION_CHUNK_BYTES ||
            typeof payload.sha256 !== 'string' ||
            !/^[a-f0-9]{64}$/.test(payload.sha256) ||
            typeof payload.format !== 'string' ||
            !Object.hasOwn(CANONICAL_FORMAT_TUPLES, payload.format)
          )
            return reject();
          format = payload.format as ReaderPublicationFormat;
          const tuple = CANONICAL_FORMAT_TUPLES[format];
          if (
            payload.name !== tuple.name ||
            payload.mimeType !== tuple.mimeType
          )
            return reject();
          buffer = new Uint8Array(payload.byteLength);
          expectedDigest = payload.sha256;
          phase = 'receiving';
          return { status: 'accepted' };
        }
        if (phase !== 'receiving' || !buffer || !format) return reject();
        if (value.type === 'chunk') {
          if (
            !keys(payload, ['sequence', 'data']) ||
            payload.sequence !== sequence
          )
            return reject();
          const bytes = decodeNativeChunk(
            payload.data,
            NATIVE_PUBLICATION_CHUNK_BYTES,
          );
          if (
            !bytes.length ||
            bytes.length !==
              Math.min(NATIVE_PUBLICATION_CHUNK_BYTES, buffer.length - offset)
          )
            return reject();
          buffer.set(bytes, offset);
          offset += bytes.length;
          sequence += 1;
          return { status: 'accepted' };
        }
        if (
          value.type !== 'commit' ||
          !keys(payload, ['chunks']) ||
          payload.chunks !== sequence ||
          offset !== buffer.length
        )
          return reject();
        phase = 'verifying';
        const bytes = buffer;
        const actualDigest = await digest(bytes);
        if (
          phase !== 'verifying' ||
          !isAuthorized() ||
          actualDigest !== expectedDigest
        )
          return reject();
        // Ownership moves exactly once. dispose() cannot erase committed data.
        buffer = undefined;
        phase = 'closed';
        return {
          status: 'committed',
          publication: { bytes, format, ...CANONICAL_FORMAT_TUPLES[format] },
        };
      } catch {
        return reject();
      }
    },
  };
}
