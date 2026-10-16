import { createHash } from 'node:crypto';
import {
  createNativePublicationTransfer,
  decodeNativeChunk,
  NATIVE_PUBLICATION_CHUNK_BYTES as chunkSize,
  NATIVE_PUBLICATION_MAX_BYTES as maxSize,
  type NativeTransferMessage,
} from './nativePublicationTransfer';

const identity = {
  session: 'A'.repeat(43),
  generation: 'G'.repeat(43),
  transferId: 'T'.repeat(43),
};
const digest = async (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const data = Buffer.from('publication snapshot');
let command = 0;
const wire = (
  type: NativeTransferMessage['type'],
  payload = {},
): NativeTransferMessage => ({
  protocol: 'hn-foliate-transfer',
  version: 1,
  ...identity,
  commandId: (++command).toString().padStart(43, 'a'),
  type,
  payload,
});
const begin = async (bytes = data) =>
  wire('begin', {
    byteLength: bytes.length,
    sha256: await digest(bytes),
    chunkBytes: chunkSize,
    format: 'fb2',
    name: 'book.fb2',
    mimeType: 'application/x-fictionbook+xml',
  });
const chunk = (bytes = data, sequence = 0) =>
  wire('chunk', { sequence, data: bytes.toString('base64') });

beforeEach(() => {
  command = 0;
});

test('no preflight means no transfer allocation or committed publication', async () => {
  const hash = jest.fn(digest);
  const receiver = createNativePublicationTransfer(identity, () => false, hash);
  expect(await receiver.receive(await begin())).toEqual({ status: 'rejected' });
  expect(hash).not.toHaveBeenCalled();
});

test('only exact length and SHA-256 commit transfers ownership once', async () => {
  const receiver = createNativePublicationTransfer(
    identity,
    () => true,
    digest,
  );
  expect(await receiver.receive(await begin())).toEqual({ status: 'accepted' });
  expect(await receiver.receive(chunk())).toEqual({ status: 'accepted' });
  const result = await receiver.receive(wire('commit', { chunks: 1 }));
  expect(result.status).toBe('committed');
  if (result.status !== 'committed') throw new Error('missing publication');
  receiver.dispose();
  expect(Buffer.from(result.publication.bytes)).toEqual(data);
  expect(await receiver.receive(wire('commit', { chunks: 1 }))).toEqual({
    status: 'ignored',
  });
});

test('stale identities cannot abort, consume commands, or change current transfer', async () => {
  const receiver = createNativePublicationTransfer(
    identity,
    () => true,
    digest,
  );
  const first = await begin();
  await receiver.receive(first);
  for (const field of ['session', 'generation', 'transferId']) {
    expect(
      await receiver.receive({ ...wire('abort'), [field]: 'B'.repeat(43) }),
    ).toEqual({ status: 'ignored' });
  }
  await receiver.receive(chunk());
  expect((await receiver.receive(wire('commit', { chunks: 1 }))).status).toBe(
    'committed',
  );
});

test.each([
  'duplicate',
  'skipped',
  'early-commit',
  'digest',
  'abort',
  'malformed',
  'oversized-chunk',
])('%s never yields publication bytes', async (fault) => {
  const receiver = createNativePublicationTransfer(
    identity,
    () => true,
    digest,
  );
  const first = await begin();
  if (fault === 'digest') first.payload.sha256 = '0'.repeat(64);
  await receiver.receive(first);
  if (fault === 'duplicate') {
    const message = chunk();
    await receiver.receive(message);
    expect((await receiver.receive(message)).status).toBe('rejected');
  } else if (fault === 'skipped') {
    expect((await receiver.receive(chunk(data, 1))).status).toBe('rejected');
  } else if (fault === 'abort') {
    expect((await receiver.receive(wire('abort'))).status).toBe('aborted');
  } else if (fault === 'malformed') {
    expect((await receiver.receive({ ...chunk(), extra: true })).status).toBe(
      'rejected',
    );
  } else if (fault === 'oversized-chunk') {
    expect(
      (await receiver.receive(chunk(Buffer.alloc(chunkSize + 1)))).status,
    ).toBe('rejected');
  } else if (fault === 'digest') {
    await receiver.receive(chunk());
  }
  expect(
    (await receiver.receive(wire('commit', { chunks: 1 }))).status,
  ).not.toBe('committed');
});

test.each([0, maxSize + 1, Number.MAX_SAFE_INTEGER, 1.5])(
  'rejects invalid begin size %s',
  async (byteLength) => {
    const receiver = createNativePublicationTransfer(
      identity,
      () => true,
      digest,
    );
    const message = await begin();
    message.payload.byteLength = byteLength;
    expect((await receiver.receive(message)).status).toBe('rejected');
  },
);

test('the exact 32 MiB boundary commits with finite contiguous chunks', async () => {
  const bytes = Buffer.alloc(maxSize, 37);
  const receiver = createNativePublicationTransfer(
    identity,
    () => true,
    digest,
  );
  expect((await receiver.receive(await begin(bytes))).status).toBe('accepted');
  let count = 0;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    expect(
      (
        await receiver.receive(
          chunk(bytes.subarray(offset, offset + chunkSize), count++),
        )
      ).status,
    ).toBe('accepted');
  }
  expect(
    (await receiver.receive(wire('commit', { chunks: count }))).status,
  ).toBe('committed');
});

test.each(['dispose', 'abort', 'retire'])(
  'late digest after %s cannot revive publication state',
  async (action) => {
    let finish!: (hash: string) => void;
    let current = true;
    const receiver = createNativePublicationTransfer(
      identity,
      () => current,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await receiver.receive(await begin());
    await receiver.receive(chunk());
    const pending = receiver.receive(wire('commit', { chunks: 1 }));
    if (action === 'dispose') receiver.dispose();
    if (action === 'abort') await receiver.receive(wire('abort'));
    if (action === 'retire') current = false;
    finish(await digest(data));
    expect((await pending).status).toBe('rejected');
  },
);

test.each(['A===', 'AB==', 'AAB=', 'AA==\n', '!!!!'])(
  'rejects noncanonical base64 %s',
  (value) => {
    expect(() => decodeNativeChunk(value, 64)).toThrow();
  },
);
