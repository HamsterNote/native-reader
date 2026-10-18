import * as FileSystem from 'expo-file-system/legacy';

import { isPdfCandidate } from './formatDetection';
import {
  decodeNativeChunk,
  NATIVE_PUBLICATION_MAX_BYTES,
} from './nativePublicationTransfer';
import type { ReaderError, ReaderSource } from './types';

export class NativePdfProbeError extends Error {
  constructor(readonly readerError: ReaderError) {
    super(readerError.message);
  }
}

const unsupported = () =>
  new NativePdfProbeError({
    category: 'unsupported',
    code: 'UNSUPPORTED_SOURCE',
    message: 'Select a local publication with a known size of at most 32 MiB.',
  });
const unreadable = () =>
  new NativePdfProbeError({
    category: 'read',
    code: 'READ_FAILED',
    message: 'The publication could not be read.',
  });

/** Candidate selection only. This boolean never authorizes a full source read. */
export async function probeNativePdfSource(
  source: ReaderSource,
  isCurrent: () => boolean,
): Promise<boolean> {
  const check = () => {
    if (!isCurrent()) throw new Error('PDF source probe retired');
  };
  check();
  let uri: string;
  try {
    const value = source?.kind === 'uri' ? source.uri : undefined;
    if (
      typeof value !== 'string' ||
      !/^(?:file:\/\/\/|content:\/\/[^/]+\/)/.test(value) ||
      /[\u0000-\u0020\\]/.test(value) ||
      /%(?:00|0[ad]|5c)/i.test(value)
    )
      throw unsupported();
    uri = value;
  } catch {
    throw unsupported();
  }
  check();
  const info = await FileSystem.getInfoAsync(uri).catch(() => {
    throw unreadable();
  });
  check();
  if (
    !info.exists ||
    info.isDirectory ||
    !Number.isSafeInteger(info.size) ||
    info.size <= 0 ||
    info.size > NATIVE_PUBLICATION_MAX_BYTES
  )
    throw unsupported();
  const length = Math.min(5, info.size);
  const encoded = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length,
  }).catch(() => {
    throw unreadable();
  });
  check();
  let prefix: Uint8Array | undefined;
  try {
    prefix = decodeNativeChunk(encoded, length);
    if (prefix.length !== length) throw unreadable();
    return isPdfCandidate(prefix);
  } catch {
    throw unreadable();
  } finally {
    prefix?.fill(0);
  }
}
