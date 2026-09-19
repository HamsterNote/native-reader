import {
  canLoadNavigationTarget,
  buildSpine,
  categorizeOpenError,
  findSpineIndex,
  flattenToc,
  isPublicationHref,
  normalizeArchivePath,
  validateSource,
  type ReaderPublicationModel,
} from './shared';

const model: ReaderPublicationModel = {
  spine: [
    { id: 'one', href: 'text/one.xhtml', label: 'One' },
    { id: 'two', href: 'text/two.xhtml', label: 'Two' },
    { id: 'three', href: 'text/three.xhtml', label: 'Three' },
  ],
  toc: [],
};

test('accepts only platform-local source URI schemes', () => {
  expect(
    validateSource({ kind: 'uri', uri: 'blob:local' }, 'web'),
  ).toBeUndefined();
  expect(
    validateSource({ kind: 'uri', uri: 'file:///book.epub' }, 'native'),
  ).toBeUndefined();
  expect(
    validateSource({ kind: 'uri', uri: 'content://book' }, 'native'),
  ).toBeUndefined();
  expect(
    validateSource(
      { kind: 'uri', uri: 'https://example.test/book.epub' },
      'web',
    )?.code,
  ).toBe('UNSUPPORTED_SOURCE');
  expect(
    validateSource({ kind: 'uri', uri: 'javascript:alert(1)' }, 'web')?.code,
  ).toBe('UNSUPPORTED_SOURCE');
});

test('normalizes nested TOC and resolves document fragments without changing location', () => {
  expect(
    flattenToc([
      {
        id: 'parent',
        href: 'text/one.xhtml',
        label: 'One',
        subitems: [{ href: 'text/two.xhtml#target', label: 'Two target' }],
      },
    ]),
  ).toEqual([
    { id: 'parent', href: 'text/one.xhtml', label: 'One', depth: 0 },
    {
      id: '1-0-text/two.xhtml#target',
      href: 'text/two.xhtml#target',
      label: 'Two target',
      depth: 1,
    },
  ]);
  expect(findSpineIndex(model.spine, 'text/two.xhtml#target')).toBe(1);
  expect(canLoadNavigationTarget(model, 'text/two.xhtml#target')).toBe(true);
  expect(canLoadNavigationTarget(model, 'missing.xhtml')).toBe(false);
});

test('builds previous and next order from the full linear spine, not the TOC', () => {
  const toc = flattenToc([
    { id: 'one', href: 'text/one.xhtml', label: 'One' },
    { id: 'three', href: 'text/three.xhtml', label: 'Three' },
  ]);
  expect(
    buildSpine(
      [
        { id: 'one', href: 'text/one.xhtml' },
        { id: 'two', href: 'text/two.xhtml' },
        { id: 'skip-bool', href: 'text/skip-bool.xhtml', linear: false },
        { id: 'remote', href: 'https://attacker.invalid/chapter.xhtml' },
        { id: 'three', href: 'text/three.xhtml' },
      ],
      toc,
    ),
  ).toEqual([
    { id: 'one', href: 'text/one.xhtml', label: 'One' },
    { id: 'two', href: 'text/two.xhtml', label: 'Chapter 2' },
    { id: 'three', href: 'text/three.xhtml', label: 'Three' },
  ]);
});

test('uses the reported spine item when an href occurs more than once', () => {
  const repeated = [
    { id: 'before', href: 'text/before.xhtml', label: 'Before' },
    { id: 'repeat-1', href: 'text/repeat.xhtml', label: 'Repeat 1' },
    { id: 'between', href: 'text/between.xhtml', label: 'Between' },
    { id: 'repeat-2', href: 'text/repeat.xhtml', label: 'Repeat 2' },
    { id: 'after', href: 'text/after.xhtml', label: 'After' },
  ];

  expect(findSpineIndex(repeated, 'text/repeat.xhtml', 3)).toBe(3);
  expect(
    repeated[findSpineIndex(repeated, 'text/repeat.xhtml', 3) - 1]?.id,
  ).toBe('between');
  expect(
    repeated[findSpineIndex(repeated, 'text/repeat.xhtml', 3) + 1]?.id,
  ).toBe('after');
});

test('accepts only package-relative publication targets', () => {
  expect(isPublicationHref("text/chapter's.xhtml#part")).toBe(true);
  expect(isPublicationHref('https://attacker.invalid/chapter.xhtml')).toBe(
    false,
  );
  expect(isPublicationHref('//attacker.invalid/chapter.xhtml')).toBe(false);
  expect(isPublicationHref('file:///private/chapter.xhtml')).toBe(false);
  expect(isPublicationHref('../private/chapter.xhtml')).toBe(false);
  expect(isPublicationHref('%2e%2e/private/chapter.xhtml')).toBe(false);
  expect(isPublicationHref('%2f%2fattacker.invalid/chapter.xhtml')).toBe(false);
  expect(isPublicationHref('text/%E0%A4%A.xhtml')).toBe(false);
  expect(findSpineIndex(model.spine, 'one.xhtml')).toBe(-1);
});

test('normalizes legal parent segments relative to an OPF or navigation file', () => {
  expect(
    normalizeArchivePath(
      '../text/chapter.xhtml#part',
      'EPUB/package/package.opf',
    ),
  ).toBe('EPUB/text/chapter.xhtml');
  expect(
    normalizeArchivePath('../../text/chapter.xhtml', 'EPUB/nav/toc.xhtml'),
  ).toBe('text/chapter.xhtml');
  expect(
    normalizeArchivePath('../../../escape.xhtml', 'EPUB/nav/toc.xhtml'),
  ).toBe(undefined);
  expect(normalizeArchivePath('../chapter.xhtml', 'package.opf')).toBe(
    undefined,
  );
});

test('uses stable terminal error categories', () => {
  expect(categorizeOpenError(new Error('permission denied')).code).toBe(
    'READ_FAILED',
  );
  expect(categorizeOpenError(new Error('fixed-layout publication')).code).toBe(
    'UNSUPPORTED_EPUB',
  );
  expect(categorizeOpenError(new Error('bad zip')).code).toBe('INVALID_EPUB');
});
