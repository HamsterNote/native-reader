import {
  CANONICAL_FORMAT_TUPLES,
  READER_IFRAME_SRC,
  createCanonicalPublicationBlob,
  createReaderIframe,
  normalizePublicationModelDto,
  readWebLocalPublication,
} from './foliateWeb';

test('creates the exact static reader source and a detector-canonical private blob', () => {
  expect(READER_IFRAME_SRC).toBe('/reader/reader.html');
  const result = createCanonicalPublicationBlob(new Blob(['book']), 'fb2');
  expect(result).toMatchObject({
    format: 'fb2',
    mimeType: CANONICAL_FORMAT_TUPLES.fb2.mimeType,
    name: CANONICAL_FORMAT_TUPLES.fb2.name,
  });
  expect(result.file.type).toBe(CANONICAL_FORMAT_TUPLES.fb2.mimeType);
});

test('creates one static reader iframe without a required policy on the trusted host shell', () => {
  const attributes = new Map<string, string>();
  const iframe = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    style: {},
  };
  const container = { replaceChildren: jest.fn() };
  const previousDocument = globalThis.document;
  Object.assign(globalThis, {
    document: { createElement: jest.fn(() => iframe) },
  });
  try {
    expect(createReaderIframe(container as unknown as HTMLElement)).toBe(
      iframe,
    );
    expect(attributes.get('src')).toBe('/reader/reader.html');
    expect(attributes.has('csp')).toBe(false);
    expect(attributes.get('title')).toBe('Publication reader');
    expect(iframe.style).toEqual({
      border: '0',
      display: 'block',
      height: '100%',
      width: '100%',
    });
    expect(container.replaceChildren).toHaveBeenCalledWith(iframe);
  } finally {
    Object.assign(globalThis, { document: previousDocument });
  }
});

test('fails closed for a DTO with a raw href, invalid sequence, or unknown destination', () => {
  const model = {
    modelVersion: 1,
    format: 'epub',
    fixedLayout: false,
    flow: 'paginated',
    direction: null,
    metadata: { title: 'Safe' },
    sections: [{ key: 's:0', index: 0, linear: true, bytes: null }],
    toc: [{ id: 'toc:0', label: 'Safe', destinationId: 'd:1', subitems: [] }],
    destinations: [{ id: 'd:1', sectionKey: 's:0', sectionIndex: 0 }],
  };
  expect(normalizePublicationModelDto(model)).toBeDefined();
  expect(
    normalizePublicationModelDto({ ...model, href: 'blob:host-source' }),
  ).toBeUndefined();
  expect(
    normalizePublicationModelDto({
      ...model,
      sections: [{ ...model.sections[0], index: 2 }],
    }),
  ).toBeUndefined();
  expect(
    normalizePublicationModelDto({
      ...model,
      toc: [{ ...model.toc[0], destinationId: 'd:999' }],
    }),
  ).toBeUndefined();
});

test('mirrors bootstrap model bounds before normalization', () => {
  const base = {
    modelVersion: 1,
    format: 'epub',
    fixedLayout: false,
    flow: 'paginated',
    direction: null,
    metadata: { title: 'Safe' },
    sections: [{ key: 's:0', index: 0, linear: true, bytes: null }],
    toc: [],
    destinations: [],
  };
  expect(
    normalizePublicationModelDto({
      ...base,
      destinations: Array.from({ length: 10_001 }, (_, index) => ({
        id: `d:${index}`,
        sectionKey: 's:0',
        sectionIndex: 0,
      })),
    }),
  ).toBeUndefined();
  expect(
    normalizePublicationModelDto({
      ...base,
      toc: Array.from({ length: 1_100 }, (_, index) => ({
        id: `toc:${index}`,
        label: 'x'.repeat(2_000),
        destinationId: null,
        subitems: [],
      })),
    }),
  ).toBeUndefined();
  let toc: Record<string, unknown> = {
    id: 'toc:31',
    label: 'leaf',
    destinationId: null,
    subitems: [],
  };
  for (let index = 30; index >= 0; index -= 1) {
    toc = {
      id: `toc:${index}`,
      label: 'nested',
      destinationId: null,
      subitems: [toc],
    };
  }
  expect(normalizePublicationModelDto({ ...base, toc: [toc] })).toBeDefined();
  const tooDeep: Record<string, unknown> = {
    id: 'toc:32',
    label: 'too deep',
    destinationId: null,
    subitems: [toc],
  };
  expect(
    normalizePublicationModelDto({
      ...base,
      toc: [tooDeep],
    }),
  ).toBeUndefined();
});

test('aborts an in-flight local XHR exactly once', async () => {
  const abort = jest.fn();
  class FakeXhr {
    onerror: (() => void) | undefined;
    onload: (() => void) | undefined;
    response: unknown;
    responseType = '';
    status = 0;
    abort = abort;
    open = jest.fn();
    send = jest.fn();
  }
  const previousXhr = globalThis.XMLHttpRequest;
  Object.assign(globalThis, { XMLHttpRequest: FakeXhr });
  const controller = new AbortController();
  try {
    const read = readWebLocalPublication('blob:fixture', controller.signal);
    controller.abort();
    controller.abort();
    await expect(read).rejects.toThrow('local-publication-read-aborted');
    expect(abort).toHaveBeenCalledTimes(1);
  } finally {
    Object.assign(globalThis, { XMLHttpRequest: previousXhr });
  }
});
