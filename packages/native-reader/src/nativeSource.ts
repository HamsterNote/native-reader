import * as FileSystem from 'expo-file-system/legacy';

import { detectReaderFormat } from './formatDetection';
import {
  decodeNativeChunk,
  NATIVE_PUBLICATION_CHUNK_BYTES,
  NATIVE_PUBLICATION_MAX_BYTES,
} from './nativePublicationTransfer';
import { CANONICAL_FORMAT_TUPLES } from './publicationFormats';
import type { ReaderError, ReaderSource } from './types';

export class NativeSourceError extends Error {
  constructor(readonly readerError: ReaderError) {
    super(readerError.message);
  }
}

/**
 * Reads only after a separate runtime preflight. No whole-file copy or arbitrary
 * WebView file grant is needed: bounded bytes go to the private transfer. An
 * unknown size/unsupported content provider fails closed. The host keeps its URI.
 */
export async function prepareNativeSource(
  source: ReaderSource,
  isAuthorized: () => boolean,
  onProgress: () => void = () => undefined,
) {
  const check = () => {
    if (!isAuthorized()) throw new Error('Native source gate is closed');
  };
  check(); // Before inspecting even a host-supplied source getter.
  const uri = source?.kind === 'uri' ? source.uri : undefined;
  if (
    typeof uri !== 'string' ||
    !/^(?:file:\/\/\/|content:\/\/[^/]+\/)/.test(uri) ||
    /[\u0000-\u0020\\]/.test(uri) ||
    /%(?:00|0[ad]|5c)/i.test(uri)
  )
    throw new NativeSourceError({
      category: 'unsupported',
      code: 'UNSUPPORTED_SOURCE',
      message: 'Select a local publication file.',
    });
  const info = await FileSystem.getInfoAsync(uri).catch(() => {
    throw new NativeSourceError({
      category: 'read',
      code: 'READ_FAILED',
      message: 'The publication could not be read.',
    });
  });
  check();
  if (
    !info.exists ||
    info.isDirectory ||
    !Number.isSafeInteger(info.size) ||
    info.size <= 0 ||
    info.size > NATIVE_PUBLICATION_MAX_BYTES
  )
    throw new NativeSourceError({
      category: 'unsupported',
      code: 'UNSUPPORTED_SOURCE',
      message: 'Select a publication with a known size of at most 32 MiB.',
    });
  const size = info.size;
  const read = async (start: number, length: number) => {
    check();
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      start < 0 ||
      length < 0 ||
      length > 64 * 1024 ||
      start + length > size
    )
      throw new Error('Invalid bounded source read');
    if (!length) return new Uint8Array();
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: start,
      length,
    }).catch(() => {
      throw new NativeSourceError({
        category: 'read',
        code: 'READ_FAILED',
        message: 'The publication could not be read.',
      });
    });
    check();
    onProgress();
    let bytes: Uint8Array;
    try {
      bytes = decodeNativeChunk(base64, length);
    } catch {
      throw new NativeSourceError({
        category: 'read',
        code: 'READ_FAILED',
        message: 'The publication could not be read.',
      });
    }
    if (bytes.length !== length)
      throw new NativeSourceError({
        category: 'read',
        code: 'READ_FAILED',
        message: 'The publication changed or could not be read.',
      });
    return bytes;
  };
  const detected = await detectReaderFormat({ size, read });
  check();
  if (detected.status !== 'supported')
    throw new NativeSourceError({
      ...detected.error,
      code:
        detected.error.category === 'unsupported'
          ? 'UNSUPPORTED_EPUB'
          : 'INVALID_EPUB',
    });
  const bytes = new Uint8Array(size);
  try {
    for (
      let offset = 0;
      offset < size;
      offset += NATIVE_PUBLICATION_CHUNK_BYTES
    ) {
      bytes.set(
        await read(
          offset,
          Math.min(NATIVE_PUBLICATION_CHUNK_BYTES, size - offset),
        ),
        offset,
      );
    }
    // Detect the exact transferred snapshot again; source providers may mutate
    // between metadata/detection and the bounded read. No hint selects a parser.
    const snapshot = await detectReaderFormat({
      size,
      read: async (start, length) => bytes.slice(start, start + length),
    });
    check();
    if (snapshot.status !== 'supported' || snapshot.format !== detected.format)
      throw new NativeSourceError({
        category: 'invalid',
        code: 'INVALID_EPUB',
        message: 'The publication changed while reading.',
      });
    let released = false;
    return {
      bytes,
      format: snapshot.format,
      ...CANONICAL_FORMAT_TUPLES[snapshot.format],
      cleanup() {
        if (released) return;
        released = true;
        bytes.fill(0);
      },
    };
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}
