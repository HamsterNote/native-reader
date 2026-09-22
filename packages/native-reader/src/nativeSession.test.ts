import { createNativeSession } from './nativeSession';

test('invalidates stale callbacks and waits for pending core writes before cleanup', async () => {
  let finishWrite: (() => void) | undefined;
  const write = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  let currentSource = 'file:///a.epub';
  const sessionA = createNativeSession('file:///a.epub', () => currentSource);
  const staleReady = jest.fn();
  const staleError = jest.fn();
  const staleStateChange = jest.fn();
  const cleanup = jest.fn();
  const writeOperation = sessionA.run(() => write);

  currentSource = 'file:///b.epub';
  if (sessionA.active()) staleReady();
  if (sessionA.active()) staleError();
  if (sessionA.active()) staleStateChange();
  const cleanupOperation = sessionA.settled().then(cleanup);
  await Promise.resolve();

  expect(cleanup).not.toHaveBeenCalled();
  expect(staleReady).not.toHaveBeenCalled();
  expect(staleError).not.toHaveBeenCalled();
  expect(staleStateChange).not.toHaveBeenCalled();
  finishWrite?.();
  await writeOperation;
  await cleanupOperation;
  expect(cleanup).toHaveBeenCalledTimes(1);
});
