import type {
  ReaderByteSource,
  ReaderFormatDetection,
  ReaderFormatError,
} from './types';

const MAX_READ_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_CENTRAL_DIRECTORY_BYTES = 768 * 1024;
const MAX_MIMETYPE_BYTES = 256;
const EOCD_SCAN_BYTES = 65_557;
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_CENTRAL = [0x50, 0x4b, 0x01, 0x02];
const ZIP_EOCD = [0x50, 0x4b, 0x05, 0x06];

/** A routing hint only; PDFKit/PDF.js must validate the complete document. */
export function isPdfCandidate(prefix: Uint8Array): boolean {
  return [0x25, 0x50, 0x44, 0x46, 0x2d].every(
    (value, index) => prefix[index] === value,
  );
}

type ZipEntry = {
  compressedSize: number;
  compression: number;
  encrypted: boolean;
  localOffset: number;
  name: string;
  uncompressedSize: number;
};

type Budget = { total: number };

const error = (
  category: ReaderFormatError['category'],
  message: string,
): ReaderFormatDetection => ({ status: 'error', error: { category, message } });

const startsWith = (bytes: Uint8Array, values: readonly number[]) =>
  values.every((value, index) => bytes[index] === value);

const ascii = (bytes: Uint8Array) =>
  String.fromCharCode(...bytes).replace(/\0.*$/, '');

const lowerAscii = (bytes: Uint8Array) => ascii(bytes).toLowerCase();

const le16 = (bytes: Uint8Array, offset: number) =>
  bytes[offset] | (bytes[offset + 1] << 8);

const le32 = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>>
  0;

const be16 = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] << 8) | bytes[offset + 1];

const be32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>>
  0;

const isSpace = (value: number) =>
  value === 0x09 || value === 0x0a || value === 0x0d || value === 0x20;

function startsAt(bytes: Uint8Array, offset: number, value: string) {
  return value
    .split('')
    .every(
      (character, index) => bytes[offset + index] === character.charCodeAt(0),
    );
}

/** Parses XML prolog misc safely enough to recognize the exact FB2 root. */
function isFb2Document(bytes: Uint8Array) {
  let offset = startsAt(bytes, 0, '\u00ef\u00bb\u00bf') ? 3 : 0;
  while (offset < bytes.length) {
    while (isSpace(bytes[offset])) offset += 1;
    if (startsAt(bytes, offset, '<!--')) {
      const end = bytes.findIndex(
        (_, index) => index >= offset + 4 && startsAt(bytes, index, '-->'),
      );
      if (end < 0) return false;
      offset = end + 3;
      continue;
    }
    if (startsAt(bytes, offset, '<?')) {
      const end = bytes.findIndex(
        (_, index) => index >= offset + 2 && startsAt(bytes, index, '?>'),
      );
      if (end < 0) return false;
      offset = end + 2;
      continue;
    }
    if (startsAt(bytes, offset, '<!DOCTYPE')) {
      let subsetDepth = 0;
      let quote = 0;
      offset += '<!DOCTYPE'.length;
      for (; offset < bytes.length; offset += 1) {
        const value = bytes[offset];
        if (quote) {
          if (value === quote) quote = 0;
          continue;
        }
        if (value === 0x22 || value === 0x27) quote = value;
        else if (value === 0x5b) subsetDepth += 1;
        else if (value === 0x5d && subsetDepth) subsetDepth -= 1;
        else if (value === 0x3e && subsetDepth === 0) break;
      }
      if (offset >= bytes.length) return false;
      offset += 1;
      continue;
    }
    break;
  }
  if (!startsAt(bytes, offset, '<FictionBook')) return false;
  const boundary = bytes[offset + '<FictionBook'.length];
  return boundary === 0x3e || boundary === 0x2f || isSpace(boundary);
}

async function read(
  source: ReaderByteSource,
  budget: Budget,
  start: number,
  length: number,
) {
  if (!Number.isSafeInteger(source.size) || source.size < 0)
    throw new Error('invalid-size');
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    start < 0 ||
    length < 0 ||
    start + length > source.size
  )
    throw new Error('invalid-range');
  if (length > MAX_READ_BYTES || budget.total + length > MAX_TOTAL_BYTES)
    throw new Error('probe-limit');
  let bytes: Uint8Array;
  try {
    bytes = await source.read(start, length);
  } catch {
    throw new Error('read-failed');
  }
  if (!(bytes instanceof Uint8Array) || bytes.length !== length)
    throw new Error('read-failed');
  budget.total += length;
  return bytes;
}

async function readRange(
  source: ReaderByteSource,
  budget: Budget,
  start: number,
  length: number,
) {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < length; offset += MAX_READ_BYTES) {
    chunks.push(
      await read(
        source,
        budget,
        start + offset,
        Math.min(MAX_READ_BYTES, length - offset),
      ),
    );
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function findEocd(bytes: Uint8Array) {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (startsWith(bytes.subarray(offset), ZIP_EOCD)) return offset;
  }
  return -1;
}

async function zipEntries(source: ReaderByteSource, budget: Budget) {
  const tailLength = Math.min(EOCD_SCAN_BYTES, source.size);
  const tailStart = source.size - tailLength;
  const tail = await readRange(source, budget, tailStart, tailLength);
  const eocd = findEocd(tail);
  if (eocd < 0) throw new Error('zip-eocd');
  const count = le16(tail, eocd + 10);
  const size = le32(tail, eocd + 12);
  const offset = le32(tail, eocd + 16);
  if (
    count === 0 ||
    count === 0xffff ||
    size === 0xffffffff ||
    offset === 0xffffffff
  )
    throw new Error('zip64-or-empty');
  if (size > MAX_CENTRAL_DIRECTORY_BYTES)
    throw new Error('central-directory-limit');
  const directory = await readRange(source, budget, offset, size);
  const entries: ZipEntry[] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    if (
      cursor + 46 > directory.length ||
      !startsWith(directory.subarray(cursor), ZIP_CENTRAL)
    )
      throw new Error('zip-central');
    const nameLength = le16(directory, cursor + 28);
    const extraLength = le16(directory, cursor + 30);
    const commentLength = le16(directory, cursor + 32);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > directory.length) throw new Error('zip-truncated');
    entries.push({
      compressedSize: le32(directory, cursor + 20),
      compression: le16(directory, cursor + 10),
      encrypted: (le16(directory, cursor + 8) & 1) !== 0,
      localOffset: le32(directory, cursor + 42),
      name: lowerAscii(
        directory.subarray(cursor + 46, cursor + 46 + nameLength),
      ),
      uncompressedSize: le32(directory, cursor + 24),
    });
    cursor = end;
  }
  if (cursor !== directory.length) throw new Error('zip-central-trailing-data');
  return entries;
}

async function storedMimetype(
  source: ReaderByteSource,
  budget: Budget,
  entry: ZipEntry,
) {
  if (
    entry.compression !== 0 ||
    entry.compressedSize !== entry.uncompressedSize ||
    entry.uncompressedSize > MAX_MIMETYPE_BYTES
  )
    throw new Error('epub-mimetype-metadata');
  const header = await read(source, budget, entry.localOffset, 30);
  if (!startsWith(header, ZIP_LOCAL)) throw new Error('zip-local');
  if (
    le16(header, 8) !== 0 ||
    le32(header, 18) !== entry.compressedSize ||
    le32(header, 22) !== entry.uncompressedSize
  )
    throw new Error('epub-mimetype-local-metadata');
  const nameLength = le16(header, 26);
  const extraLength = le16(header, 28);
  const localName = lowerAscii(
    await read(source, budget, entry.localOffset + 30, nameLength),
  );
  if (localName !== entry.name) throw new Error('epub-mimetype-local-name');
  const start = entry.localOffset + 30 + nameLength + extraLength;
  return ascii(await read(source, budget, start, entry.uncompressedSize));
}

async function detectZip(
  source: ReaderByteSource,
  budget: Budget,
): Promise<ReaderFormatDetection> {
  const entries = await zipEntries(source, budget);
  if (entries.some((entry) => entry.encrypted))
    return error('drm', 'Encrypted archives are not supported.');
  const names = new Set(entries.map((entry) => entry.name));
  const mimetype = entries.find((entry) => entry.name === 'mimetype');
  if (mimetype && [...names].some((name) => name.endsWith('.opf'))) {
    if (
      (await storedMimetype(source, budget, mimetype)) !==
      'application/epub+zip'
    )
      return error('invalid', 'EPUB mimetype entry is invalid.');
    return { status: 'supported', format: 'epub', layout: 'reflowable' };
  }
  if ([...names].some((name) => name.endsWith('.fb2')))
    return { status: 'supported', format: 'fbz', layout: 'reflowable' };
  if (
    [...names].some((name) =>
      /\.(avif|bmp|gif|jpe?g|jxl|png|svg|webp)$/i.test(name),
    )
  )
    return { status: 'supported', format: 'cbz', layout: 'fixed' };
  return error('unsupported', 'ZIP archive is not a supported publication.');
}

async function detectPalm(
  source: ReaderByteSource,
  budget: Budget,
): Promise<ReaderFormatDetection | undefined> {
  if (source.size < 68) return undefined;
  const header = await read(source, budget, 0, Math.min(86, source.size));
  if (ascii(header.subarray(60, 68)) !== 'BOOKMOBI') return undefined;
  if (header.length < 86) throw new Error('palm-truncated');
  const recordCount = be16(header, 76);
  if (recordCount === 0) throw new Error('palm-records');
  const recordOffset = be32(header, 78);
  if (recordOffset >= source.size || recordOffset + 20 > source.size)
    throw new Error('palm-record-offset');
  const record = await read(source, budget, recordOffset, 56);
  if (be16(record, 12) !== 0)
    return error('drm', 'Encrypted PalmDOC publications are not supported.');
  if (ascii(record.subarray(16, 20)) !== 'MOBI') throw new Error('mobi-header');
  if (record.length < 56) throw new Error('mobi-truncated');
  const detection: ReaderFormatDetection = {
    status: 'supported' as const,
    format: be32(record, 52) >= 8 ? ('kf8-azw3' as const) : ('mobi' as const),
    layout: 'reflowable' as const,
  };
  return detection;
}

function failure(errorValue: unknown): ReaderFormatDetection {
  const value = errorValue instanceof Error ? errorValue.message : 'invalid';
  if (value === 'read-failed')
    return error('read', 'Publication bytes could not be read.');
  if (value === 'zip64-or-empty' || value === 'central-directory-limit')
    return error(
      'unsupported',
      'Publication archive structure is unsupported.',
    );
  return error('invalid', 'Publication bytes are invalid or corrupt.');
}

/** Content-aware, bounded detector with no URI, File, MIME, filename, or renderer dependency. */
export async function detectReaderFormat(
  source: ReaderByteSource,
): Promise<ReaderFormatDetection> {
  const budget = { total: 0 };
  try {
    const prefix = await read(source, budget, 0, Math.min(86, source.size));
    if (isPdfCandidate(prefix))
      return error('unsupported', 'PDF is outside the supported format set.');
    const palm = await detectPalm(source, budget);
    if (palm) return palm;
    if (startsWith(prefix, ZIP_LOCAL)) return await detectZip(source, budget);
    const xml = await read(source, budget, 0, Math.min(4096, source.size));
    if (isFb2Document(xml))
      return { status: 'supported', format: 'fb2', layout: 'reflowable' };
    return error(
      'unsupported',
      'File bytes do not match a supported publication.',
    );
  } catch (errorValue) {
    return failure(errorValue);
  }
}
