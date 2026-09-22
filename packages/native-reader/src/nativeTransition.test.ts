import { continueAfterBestEffortCleanup } from './nativeTransition';

test('continues A to B source loading when A cleanup rejects', async () => {
  const prepareB = jest.fn().mockResolvedValue(undefined);

  await expect(
    continueAfterBestEffortCleanup(
      Promise.resolve(),
      () => Promise.reject(new Error('A cleanup failed')),
      prepareB,
    ),
  ).resolves.toBeUndefined();
  expect(prepareB).toHaveBeenCalledTimes(1);
});

test('does not wait for stale source work or cleanup before preparing the replacement', async () => {
  const never = new Promise<void>(() => undefined);
  const prepareB = jest.fn().mockResolvedValue(undefined);

  await expect(
    continueAfterBestEffortCleanup(never, () => never, prepareB),
  ).resolves.toBeUndefined();
  expect(prepareB).toHaveBeenCalledTimes(1);
});
