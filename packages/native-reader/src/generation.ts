export type ReaderGeneration = {
  current(): boolean;
  addCleanup(cleanup: () => void): void;
  dispose(): void;
};

export function createReaderGeneration(
  generation: number,
  currentGeneration: () => number,
): ReaderGeneration {
  let disposed = false;
  const cleanups = new Set<() => void>();

  return {
    current: () => !disposed && currentGeneration() === generation,
    addCleanup(cleanup) {
      if (disposed) cleanup();
      else cleanups.add(cleanup);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch {
          // One failed library cleanup must not prevent the remaining owners.
        }
      }
      cleanups.clear();
    },
  };
}
