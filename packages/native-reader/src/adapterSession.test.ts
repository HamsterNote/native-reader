import { createReaderAdapterSession } from './adapterSession';
import type { ReaderSource } from './types';

test('uses opaque unique tokens even for the same generation', async () => {
  const first = createReaderAdapterSession(1, () => 1);
  const second = createReaderAdapterSession(1, () => 1);
  expect(first.token).not.toBe(second.token);
  expect(first.token).toMatch(/^session-[a-f0-9]{32}$/);
  expect(first.token).not.toContain('reader-session-');
  expect(first.accepts(second.token)).toBe(false);
  await Promise.all([first.dispose(), second.dispose()]);
});

test('cleans duplicate owned resources exactly once and continues after failures', async () => {
  const session = createReaderAdapterSession(1, () => 1);
  const cleaned: string[] = [];
  const resource = {
    kind: 'blob-url' as const,
    cleanup: () => void cleaned.push('blob'),
  };
  session.own(resource);
  session.own(resource);
  session.own({
    kind: 'renderer',
    cleanup: () => Promise.reject(new Error('renderer failed')),
  });
  session.own({ kind: 'timer', cleanup: () => void cleaned.push('timer') });
  await Promise.all([session.dispose(), session.dispose()]);
  expect(cleaned.sort()).toEqual(['blob', 'timer']);
});

test('disposes a resource acquired after disposal starts and waits for cleanup', async () => {
  let resolve!: (value: string) => void;
  const cleaned: string[] = [];
  const session = createReaderAdapterSession(1, () => 1);
  const acquired = session.acquire(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
    () => ({
      kind: 'temporary-file',
      cleanup: () => void cleaned.push('temporary'),
    }),
  );
  const disposal = session.dispose();
  resolve('prepared');
  await expect(acquired).resolves.toBeUndefined();
  await disposal;
  expect(cleaned).toEqual(['temporary']);
});

test('blocks stale token commits and keeps host sources outside ownership', async () => {
  let generation = 1;
  const session = createReaderAdapterSession(1, () => generation);
  const source: ReaderSource = { kind: 'uri', uri: 'file:///host-owned.epub' };
  const factory = {
    create: async (input: ReaderSource) => {
      expect(input).toBe(source);
      return { size: 0, read: async () => new Uint8Array() };
    },
  };
  await expect(factory.create(source)).resolves.toMatchObject({ size: 0 });
  const updates: string[] = [];
  expect(session.commit('wrong', () => updates.push('wrong'))).toBe(false);
  expect(session.commit(session.token, () => updates.push('current'))).toBe(
    true,
  );
  generation = 2;
  expect(session.commit(session.token, () => updates.push('stale'))).toBe(
    false,
  );
  expect(updates).toEqual(['current']);
  await session.dispose();
});

test('does not start acquisition after disposal and keeps commit receiver-independent', async () => {
  const session = createReaderAdapterSession(1, () => 1);
  const commit = session.commit;
  expect(commit(session.token, () => undefined)).toBe(true);
  await session.dispose();
  let started = false;
  await expect(
    session.acquire(
      async () => {
        started = true;
        return 'late';
      },
      () => undefined,
    ),
  ).resolves.toBeUndefined();
  expect(started).toBe(false);
});
