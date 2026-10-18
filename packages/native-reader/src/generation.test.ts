import { createReaderGeneration } from './generation';

test('disposes each owned resource once and rejects stale generations', () => {
  let current = 1;
  const cleanup = jest.fn();
  const generation = createReaderGeneration(1, () => current);

  generation.addCleanup(cleanup);
  expect(generation.current()).toBe(true);
  current = 2;
  expect(generation.current()).toBe(false);
  generation.dispose();
  generation.dispose();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test('immediately cleans resources registered after disposal', () => {
  const cleanup = jest.fn();
  const generation = createReaderGeneration(1, () => 1);
  generation.dispose();
  generation.addCleanup(cleanup);
  expect(cleanup).toHaveBeenCalledTimes(1);
});
