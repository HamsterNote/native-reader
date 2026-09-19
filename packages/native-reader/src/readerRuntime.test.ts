import { readFileSync } from 'node:fs';

test('chapter controls navigate directly to adjacent linear spine items', () => {
  const web = readFileSync(require.resolve('./NativeReader.web'), 'utf8');
  const native = readFileSync(require.resolve('./NativeReader.native'), 'utf8');

  expect(web).toContain('publication.spine[currentIndexRef.current - 1]');
  expect(web).toContain('publication.spine[currentIndexRef.current + 1]');
  expect(web).not.toContain('await rendition?.prev()');
  expect(web).not.toContain('await rendition?.next()');
  expect(native).toContain('model?.spine[currentIndex - 1]');
  expect(native).toContain('model?.spine[currentIndex + 1]');
  expect(native).not.toContain('goPrevious();');
  expect(native).not.toContain('goNext();');
});
