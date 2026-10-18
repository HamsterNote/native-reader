import { createReaderGeneration } from './generation';
import type { ReaderByteSource, ReaderSource } from './types';

export type ReaderOwnedResourceKind =
  | 'blob-url'
  | 'listener'
  | 'renderer'
  | 'session-token'
  | 'temporary-file'
  | 'timer';
export type ReaderOwnedResource = {
  cleanup(): Promise<void> | void;
  kind: ReaderOwnedResourceKind;
};
export type ReaderByteSourceFactory = {
  create(source: ReaderSource): Promise<ReaderByteSource>;
};

export type ReaderAdapterSession = {
  accepts(token: string): boolean;
  acquire<T>(
    operation: () => Promise<T>,
    own: (value: T) => ReaderOwnedResource | undefined,
  ): Promise<T | undefined>;
  commit(token: string, update: () => void): boolean;
  current(): boolean;
  dispose(): Promise<void>;
  own(resource: ReaderOwnedResource): void;
  token: string;
};

function nonce() {
  const bytes = new Uint8Array(16);
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else {
    // Best-effort compatibility fallback. This is a JS stale discriminator,
    // never a bridge authentication credential (task 4 owns that boundary).
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

/** Owns derived resources only. Host source URI never enters this API. */
export function createReaderAdapterSession(
  generationNumber: number,
  currentGeneration: () => number,
): ReaderAdapterSession {
  const generation = createReaderGeneration(
    generationNumber,
    currentGeneration,
  );
  const token = `session-${nonce()}`;
  const resources = new Map<ReaderOwnedResource, Promise<void>>();
  const acquisitions = new Set<Promise<unknown>>();
  let disposal: Promise<void> | undefined;
  const release = (resource: ReaderOwnedResource) => {
    let pending = resources.get(resource);
    if (!pending) {
      pending = Promise.resolve()
        .then(() => resource.cleanup())
        .catch(() => undefined);
      resources.set(resource, pending);
    }
    return pending;
  };
  const own = (resource: ReaderOwnedResource) => {
    if (resources.has(resource)) return;
    if (!generation.current()) {
      void release(resource);
      return;
    }
    generation.addCleanup(() => void release(resource));
  };
  const accepts = (candidate: string) =>
    candidate === token && generation.current();
  return {
    token,
    current: () => generation.current(),
    accepts,
    commit(candidate, update) {
      if (!accepts(candidate)) return false;
      update();
      return true;
    },
    own,
    async acquire(operation, toResource) {
      if (!generation.current()) return undefined;
      const pending = operation();
      acquisitions.add(pending);
      try {
        const value = await pending;
        const resource = toResource(value);
        if (resource) own(resource);
        return generation.current() ? value : undefined;
      } finally {
        acquisitions.delete(pending);
      }
    },
    dispose() {
      disposal ??= (async () => {
        generation.dispose();
        await Promise.allSettled([...acquisitions]);
        await Promise.allSettled([...resources.values()]);
      })();
      return disposal;
    },
  };
}
