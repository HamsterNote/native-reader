import { createReaderGeneration } from './generation';
import { readFileSync } from 'node:fs';

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

test('web open timeout invalidates the generation and disposes resources', () => {
  const source = readFileSync(require.resolve('./NativeReader.web'), 'utf8');
  expect(source).toContain("fail(readerError('LOAD_TIMEOUT'))");
  expect(source).toContain('loadInactivityTimeoutMs');
  expect(source).toContain('startStageTimeout()');
  expect(source).toContain('generation.dispose()');
  expect(source).toContain('generationRef.current += 1');
  expect(source).toContain('rendition?.destroy()');
  expect(source).toContain('book?.destroy()');
  expect(source).toContain('replaceChildren()');
});
