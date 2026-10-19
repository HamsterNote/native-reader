import { CANONICAL_FORMAT_TUPLES } from './publicationFormats';
import type { ReaderByteSource, ReaderPublicationFormat } from './types';

export { CANONICAL_FORMAT_TUPLES } from './publicationFormats';
export {
  normalizePublicationModelDto,
  type NormalizedPublicationModel,
  type PublicationModelDto,
} from './publicationModelDto';

export const FOLIATE_IFRAME_PROTOCOL_VERSION = 2;
export const READER_IFRAME_SRC = '/reader/reader.html';
const MAX_PRIVATE_PUBLICATION_BYTES = 128 * 1024 * 1024;
export type ReaderIframeHost = HTMLIFrameElement;

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
