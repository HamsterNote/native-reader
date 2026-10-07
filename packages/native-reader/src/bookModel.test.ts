import { mapFoliateBookFailure, normalizeFoliateBook } from './bookModel';

// Mirrors Foliate's actual book contract: sections use opaque ids, while TOC
// href-like strings are interpreted only through the adapter-controlled map.
const book = {
  destinations: {
    'toc:begin': { sectionId: 'sec-a' },
    'toc:landmark': { fragmentId: 'landmark', sectionId: 'sec-b' },
    'toc:notes': { sectionId: 'notes' },
  },
  metadata: { title: { en: 'Model Book', zh: '模型书' } },
  sections: [
    { id: 'sec-a', title: 'One' },
    { id: 'notes', linear: 'no', title: 'Notes' },
    { id: 'sec-b', title: 'Two' },
  ],
  toc: [
    {
      destinationId: 'toc:begin',
      id: 'start',
      label: 'Start',
      subitems: [
        { destinationId: 'toc:landmark', id: 'landmark', label: 'Landmark' },
      ],
    },
    { destinationId: 'missing', id: 'missing', label: 'Missing' },
    { destinationId: 'toc:notes', id: 'notes', label: 'Notes' },
  ],
} as const;

test('normalizes opaque Foliate section ids, nested TOC, and linear projection', () => {
  const result = normalizeFoliateBook(book);
  if (result.status !== 'ready') throw new Error('Expected normalized book');
  expect(result.book.model.title).toBe('Model Book');
  expect(
    result.book.model.spine.map((item) => [item.id, item.engineIndex]),
  ).toEqual([
    ['sec-a', 0],
    ['sec-b', 2],
  ]);
  expect(
    result.book.toc.map(({ id, depth, state }) => [id, depth, state]),
  ).toEqual([
    ['start', 0, 'resolved'],
    ['landmark', 1, 'resolved'],
    ['missing', 0, 'unresolved'],
    ['notes', 0, 'resolved'],
  ]);
  expect(result.book.resolveDestination('toc:landmark')).toEqual({
    fragmentId: 'landmark',
    linearIndex: 1,
    sectionId: 'sec-b',
    sectionIndex: 2,
  });
  // A valid non-linear destination stays resolved for adapters, but has no
  // linear navigation index and is intentionally absent from legacy Chrome TOC.
  expect(result.book.resolveDestination('toc:notes')).toEqual({
    linearIndex: undefined,
    sectionId: 'notes',
    sectionIndex: 1,
  });
  expect(result.book.model.toc.map((item) => item.id)).toEqual([
    'start',
    'landmark',
  ]);
});

test('retains fixed layout and invalid TOC nodes without archive-path assumptions', () => {
  const result = normalizeFoliateBook({ ...book, layout: 'fixed' });
  if (result.status !== 'ready') throw new Error('Expected normalized book');
  expect(result.book.layout).toBe('fixed');
  expect(result.book.resolveDestination('missing')).toBeUndefined();
  expect(result.book.toc.find((item) => item.id === 'missing')).toMatchObject({
    depth: 0,
    label: 'Missing',
    state: 'unresolved',
  });
});

test.each([
  ['epub', { id: 'chapter-1' }, 'chapter-1'],
  ['cbz', { id: 'image/001.jpg' }, 'image/001.jpg'],
  ['fb2', { id: 101 }, '101'],
  ['mobi', { id: 202 }, '202'],
])('projects real %s-style opaque section ids', (_, section, expectedId) => {
  const result = normalizeFoliateBook({ sections: [section] });
  if (result.status !== 'ready') throw new Error('Expected normalized book');
  expect(result.book.model.spine[0]?.id).toBe(expectedId);
  expect(
    result.book.projectCurrentLocation({ sectionId: section.id }),
  ).toMatchObject({
    linearIndex: 0,
    sectionId: expectedId,
  });
});

test('keeps absent TOC, KF8 missing ids, non-linear destinations, and recoverable clicks', () => {
  const result = normalizeFoliateBook({
    destinations: { note: { sectionId: 7 }, missing: { sectionId: 'absent' } },
    sections: [{ id: 7, linear: 'no' }, { title: 'KF8 generated section' }],
    toc: [
      { id: 'note', destinationId: 'note' },
      { id: 'missing', destinationId: 'missing' },
    ],
  });
  if (result.status !== 'ready') throw new Error('Expected normalized book');
  expect(result.book.model.toc).toEqual([]);
  expect(result.book.displayToc.map((item) => item.resolution)).toEqual([
    'resolved-nonlinear',
    'unresolved',
  ]);
  expect(result.book.activateToc('note')).toMatchObject({
    action: 'navigate',
    location: { linearIndex: undefined, sectionId: '7' },
  });
  expect(result.book.activateToc('missing')).toEqual({
    action: 'recoverable-feedback',
    itemId: 'missing',
  });
  expect(normalizeFoliateBook({ sections: [{ id: 'only' }] })).toMatchObject({
    status: 'ready',
    book: { displayToc: [] },
  });
});

test.each([
  [{}, 'invalid'],
  [{ sections: [{ id: 'notes', linear: 'no' }] }, 'unsupported'],
  [{ sections: [{ id: 'one' }, { id: 'one' }] }, 'invalid'],
])('rejects empty or malformed controlled models', (input, category) => {
  expect(normalizeFoliateBook(input)).toMatchObject({
    status: 'error',
    error: { category },
  });
});

test('maps only explicit adapter failure categories', () => {
  expect(mapFoliateBookFailure({ category: 'drm' })).toMatchObject({
    category: 'drm',
  });
  expect(
    mapFoliateBookFailure(new Error('untrusted parser failure')),
  ).toMatchObject({ category: 'invalid' });
});
