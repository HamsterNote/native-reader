import { bestEffortCleanup } from './lifecycle';

test('continues a source transition when stale session cleanup rejects', async () => {
  const prepareReplacement = jest.fn().mockResolvedValue(undefined);

  await Promise.resolve()
    .then(() =>
      bestEffortCleanup(async () => {
        throw new Error('cache deletion failed');
      }),
    )
    .then(prepareReplacement);

  expect(prepareReplacement).toHaveBeenCalledTimes(1);
});
