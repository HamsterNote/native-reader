export type NativeSession = {
  active(): boolean;
  deactivate(): void;
  run<T>(operation: () => Promise<T>): Promise<T>;
  settled(): Promise<void>;
};

export function createNativeSession(
  source?: string,
  currentSource?: () => string,
): NativeSession {
  let active = true;
  const pending = new Set<Promise<unknown>>();
  const isCurrent = () =>
    active && (!source || !currentSource || currentSource() === source);

  return {
    active: isCurrent,
    deactivate: () => {
      active = false;
    },
    async run(operation) {
      if (!isCurrent()) throw new Error('Reader session is inactive');
      const result = operation();
      pending.add(result);
      try {
        return await result;
      } finally {
        pending.delete(result);
      }
    },
    async settled() {
      await Promise.allSettled([...pending]);
    },
  };
}
