import {
  normalizeFoliateBook,
  type FoliateBookTocItem,
  type ReaderBookNormalization,
} from './bookModel';
import type {
  ReaderByteSource,
  ReaderPublicationFormat,
  ReaderPublicationLayout,
  ReaderReadingFlow,
} from './types';

export const FOLIATE_IFRAME_PROTOCOL_VERSION = 1;
export const READER_IFRAME_SRC = '/reader/reader.html';

const MAX_PRIVATE_PUBLICATION_BYTES = 128 * 1024 * 1024;
const MAX_MODEL_SECTIONS = 10_000;
// These mirror bootstrap.js exactly. Parent validation must reject an oversized
// clone before normalization allocates a second model graph.
const MAX_MODEL_DESTINATIONS = 10_000;
const MAX_MODEL_TOC_NODES = 10_000;
const MAX_MODEL_TOC_DEPTH = 32;
const MAX_MODEL_UTF8_BYTES = 2 * 1024 * 1024;

export const CANONICAL_FORMAT_TUPLES: Readonly<
  Record<ReaderPublicationFormat, Readonly<{ name: string; mimeType: string }>>
> = Object.freeze({
  epub: Object.freeze({
    name: 'book.epub',
    mimeType: 'application/epub+zip',
  }),
  mobi: Object.freeze({
    name: 'book.mobi',
    mimeType: 'application/x-mobipocket-ebook',
  }),
  'kf8-azw3': Object.freeze({
    name: 'book.azw3',
    mimeType: 'application/vnd.amazon.ebook',
  }),
  fb2: Object.freeze({
    name: 'book.fb2',
    mimeType: 'application/x-fictionbook+xml',
  }),
  fbz: Object.freeze({
    name: 'book.fbz',
    mimeType: 'application/x-zip-compressed-fb2',
  }),
  cbz: Object.freeze({
    name: 'book.cbz',
    mimeType: 'application/vnd.comicbook+zip',
  }),
});

export type ReaderIframeHost = HTMLIFrameElement;

type PublicationSectionDto = {
  bytes: number | null;
  index: number;
  key: string;
  linear: boolean;
};

type PublicationDestinationDto = {
  id: string;
  sectionIndex: number;
  sectionKey: string;
};

type PublicationTocDto = {
  destinationId: string | null;
  id: string;
  label: string;
  subitems: PublicationTocDto[];
};

export type PublicationModelDto = {
  destinations: PublicationDestinationDto[];
  direction: 'ltr' | 'rtl' | null;
  fixedLayout: boolean;
  flow: ReaderReadingFlow | null;
  format: ReaderPublicationFormat;
  metadata: { title: string | null };
  modelVersion: 1;
  sections: PublicationSectionDto[];
  toc: PublicationTocDto[];
};

export type NormalizedPublicationModel = {
  flow: ReaderReadingFlow;
  format: ReaderPublicationFormat;
  layout: ReaderPublicationLayout;
  normalization: Extract<ReaderBookNormalization, { status: 'ready' }>;
  sections: readonly PublicationSectionDto[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const isNonNegativeSafeInteger = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isFormat = (value: unknown): value is ReaderPublicationFormat =>
  typeof value === 'string' && value in CANONICAL_FORMAT_TUPLES;

const isToken = (value: unknown, expression: RegExp): value is string =>
  typeof value === 'string' && expression.test(value);

function parseToc(value: unknown): PublicationTocDto[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  let count = 0;
  const visit = (
    input: unknown[],
    depth: number,
  ): PublicationTocDto[] | undefined => {
    if (input.length === 0) return [];
    if (depth > MAX_MODEL_TOC_DEPTH) return undefined;
    const result: PublicationTocDto[] = [];
    for (const rawNode of input) {
      if (++count > MAX_MODEL_TOC_NODES || !isRecord(rawNode)) return undefined;
      const id = rawNode.id;
      const label = rawNode.label;
      const destinationId = rawNode.destinationId;
      const subitems = rawNode.subitems;
      if (
        !hasOnlyKeys(rawNode, ['id', 'label', 'destinationId', 'subitems']) ||
        !isToken(id, /^toc:\d+$/) ||
        seen.has(id) ||
        typeof label !== 'string' ||
        label.length > 2048 ||
        !(destinationId === null || isToken(destinationId, /^d:\d+$/)) ||
        !Array.isArray(subitems)
      )
        return undefined;
      seen.add(id);
      const children = visit(subitems, depth + 1);
      if (!children) return undefined;
      result.push({
        destinationId: destinationId as string | null,
        id: id as string,
        label: label as string,
        subitems: children,
      });
    }
    return result;
  };
  return visit(value, 1);
}

/**
 * Converts the bootstrap's closed clone-safe model into the neutral Chrome
 * model. The DTO deliberately has no href, URL, DOM, or Foliate object field.
 */
export function normalizePublicationModelDto(
  value: unknown,
): NormalizedPublicationModel | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'modelVersion',
      'format',
      'fixedLayout',
      'flow',
      'direction',
      'metadata',
      'sections',
      'toc',
      'destinations',
    ]) ||
    value.modelVersion !== 1 ||
    !isFormat(value.format) ||
    typeof value.fixedLayout !== 'boolean' ||
    !['ltr', 'rtl', null].includes(value.direction as null) ||
    !isRecord(value.metadata) ||
    !hasOnlyKeys(value.metadata, ['title']) ||
    !(
      typeof value.metadata.title === 'string' || value.metadata.title === null
    ) ||
    (typeof value.metadata.title === 'string' &&
      value.metadata.title.length > 1024) ||
    !Array.isArray(value.sections) ||
    value.sections.length > MAX_MODEL_SECTIONS ||
    !Array.isArray(value.destinations) ||
    value.destinations.length > MAX_MODEL_DESTINATIONS
  )
    return undefined;
  // Match bootstrap's structured-clone budget before parsing nested DTO data.
  // JSON.stringify/TextEncoder failures (including cycles) are untrusted input.
  try {
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      MAX_MODEL_UTF8_BYTES
    )
      return undefined;
  } catch {
    return undefined;
  }
  if (
    (value.fixedLayout && value.flow !== null) ||
    (!value.fixedLayout &&
      value.flow !== 'scrolled' &&
      value.flow !== 'paginated')
  )
    return undefined;

  const sections: PublicationSectionDto[] = [];
  const sectionKeys = new Set<string>();
  for (const rawSection of value.sections) {
    if (
      !isRecord(rawSection) ||
      !hasOnlyKeys(rawSection, ['key', 'index', 'linear', 'bytes']) ||
      !isNonNegativeSafeInteger(rawSection.index) ||
      rawSection.index !== sections.length ||
      rawSection.key !== `s:${rawSection.index}` ||
      typeof rawSection.linear !== 'boolean' ||
      !(
        rawSection.bytes === null || isNonNegativeSafeInteger(rawSection.bytes)
      ) ||
      sectionKeys.has(rawSection.key)
    )
      return undefined;
    sectionKeys.add(rawSection.key);
    sections.push({
      bytes: rawSection.bytes as number | null,
      index: rawSection.index as number,
      key: rawSection.key as string,
      linear: rawSection.linear,
    });
  }

  const destinations: PublicationDestinationDto[] = [];
  const destinationIds = new Set<string>();
  for (const rawDestination of value.destinations) {
    if (
      !isRecord(rawDestination) ||
      !hasOnlyKeys(rawDestination, ['id', 'sectionKey', 'sectionIndex']) ||
      !isToken(rawDestination.id, /^d:\d+$/) ||
      !isNonNegativeSafeInteger(rawDestination.sectionIndex) ||
      rawDestination.sectionKey !== `s:${rawDestination.sectionIndex}` ||
      !sectionKeys.has(rawDestination.sectionKey) ||
      destinationIds.has(rawDestination.id)
    )
      return undefined;
    destinationIds.add(rawDestination.id);
    destinations.push({
      id: rawDestination.id as string,
      sectionIndex: rawDestination.sectionIndex as number,
      sectionKey: rawDestination.sectionKey as string,
    });
  }

  const toc = parseToc(value.toc);
  if (!toc) return undefined;
  const validateTocDestinations = (
    items: readonly PublicationTocDto[],
  ): boolean =>
    items.every(
      (item) =>
        (item.destinationId === null ||
          destinationIds.has(item.destinationId)) &&
        validateTocDestinations(item.subitems),
    );
  if (!validateTocDestinations(toc)) return undefined;

  const layout: ReaderPublicationLayout = value.fixedLayout
    ? 'fixed'
    : 'reflowable';
  const mapToc = (items: readonly PublicationTocDto[]): FoliateBookTocItem[] =>
    items.map((item) => ({
      destinationId: item.destinationId ?? undefined,
      id: item.id,
      label: item.label,
      subitems: mapToc(item.subitems),
    }));
  const normalization = normalizeFoliateBook({
    destinations: Object.fromEntries(
      destinations.map((destination) => [
        destination.id,
        { sectionId: destination.sectionKey },
      ]),
    ),
    layout,
    metadata: { title: value.metadata.title ?? undefined },
    sections: sections.map((section) => ({
      id: section.key,
      linear: section.linear ? undefined : 'no',
    })),
    toc: mapToc(toc),
  });
  if (normalization.status !== 'ready') return undefined;
  return {
    flow: value.fixedLayout ? 'paginated' : (value.flow as ReaderReadingFlow),
    format: value.format as ReaderPublicationFormat,
    layout,
    normalization,
    sections,
  };
}

/** Builds the only publication payload shape the iframe is allowed to receive. */
export function createCanonicalPublicationBlob(
  source: Blob,
  format: ReaderPublicationFormat,
): {
  file: Blob;
  format: ReaderPublicationFormat;
  mimeType: string;
  name: string;
} {
  const tuple = CANONICAL_FORMAT_TUPLES[format];
  if (!tuple || source.size <= 0 || source.size > MAX_PRIVATE_PUBLICATION_BYTES)
    throw new Error('private-publication-size');
  return {
    file: new Blob([source], { type: tuple.mimeType }),
    format,
    mimeType: tuple.mimeType,
    name: tuple.name,
  };
}

/** Gives the detector bounded random access without exposing a URI to the iframe. */
export function createBlobByteSource(blob: Blob): ReaderByteSource {
  return {
    size: blob.size,
    read: async (start, length) =>
      new Uint8Array(await blob.slice(start, start + length).arrayBuffer()),
  };
}

/**
 * Reads only an already validated local blob URI. XHR is deliberately kept in
 * this host-owned capability instead of making a publication URL part of the
 * iframe protocol.
 */
export function readWebLocalPublication(
  uri: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      action();
    };
    const onAbort = () => {
      try {
        request.abort();
      } finally {
        finish(() => reject(new Error('local-publication-read-aborted')));
      }
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    request.open('GET', uri, true);
    request.responseType = 'blob';
    request.onerror = () =>
      finish(() => reject(new Error('local-publication-read-failed')));
    request.onload = () => {
      const blob = request.response;
      if (
        (request.status !== 0 &&
          (request.status < 200 || request.status >= 300)) ||
        !(blob instanceof Blob)
      ) {
        finish(() => reject(new Error('local-publication-read-failed')));
        return;
      }
      finish(() => resolve(blob));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    request.send();
  });
}

/**
 * Creates exactly one static, same-origin reader host.
 *
 * Do not add an iframe[csp] required policy here. The trusted, manifest-backed
 * reader shell owns its host meta CSP; a required policy prevents it from
 * navigating to its static entry point. Publication content remains isolated
 * by the strict required-CSP applied to the inner blob iframe by bootstrap.
 */
export function createReaderIframe(container: HTMLElement): ReaderIframeHost {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Publication reader');
  iframe.setAttribute('src', READER_IFRAME_SRC);
  iframe.style.border = '0';
  iframe.style.display = 'block';
  iframe.style.height = '100%';
  iframe.style.width = '100%';
  container.replaceChildren(iframe);
  return iframe;
}
