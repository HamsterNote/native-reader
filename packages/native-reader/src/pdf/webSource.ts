import type { ReaderSource } from '../types';
import { MAX_WEB_PDF_BYTES } from './protocol';

export type WebPdfCandidate = { pdf: boolean; size: number };

/** No full-body fallback: the dispatch exception is exactly bytes 0..4. */
export async function probeWebPdfSource(
  source: ReaderSource,
  signal: AbortSignal,
): Promise<WebPdfCandidate> {
  const uri = new URL(source.uri);
  if (
    uri.protocol !== 'blob:' ||
    uri.origin !== location.origin ||
    uri.hash ||
    uri.search
  )
    throw new Error('Only same-origin local blob sources are supported.');
  const response = await fetch(uri.href, {
    headers: { Range: 'bytes=0-4' },
    signal,
    redirect: 'error',
  });
  const match = /^bytes 0-(\d+)\/(\d+)$/.exec(
    response.headers.get('Content-Range') ?? '',
  );
  const size = Number(match?.[2]);
  const length = Math.min(size, 5);
  if (
    response.status !== 206 ||
    !match ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_WEB_PDF_BYTES ||
    Number(match[1]) !== length - 1 ||
    response.headers.get('Content-Length') !== String(length)
  ) {
    await response.body?.cancel();
    throw new Error(
      'The local publication size or bounded signature response is invalid.',
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  try {
    if (signal.aborted) throw new Error('Source retired.');
    if (bytes.length !== length) throw new Error('Invalid signature length.');
    return {
      pdf:
        bytes.length === 5 &&
        bytes.every((value, index) => value === [37, 80, 68, 70, 45][index]),
      size,
    };
  } finally {
    bytes.fill(0);
  }
}
