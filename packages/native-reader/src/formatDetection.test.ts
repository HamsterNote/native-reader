declare const process: { cwd: () => string };
declare const require: (module: string) => unknown;

const { readFile } = require('node:fs/promises') as {
  readFile: (file: string) => Promise<Uint8Array>;
};
const { join } = require('node:path') as {
  join: (...parts: string[]) => string;
};

import { detectReaderFormat } from './formatDetection';
import type { ReaderByteSource } from './types';

function source(
  bytes: Uint8Array,
  options: { reject?: boolean } = {},
): ReaderByteSource {
  return {
    size: bytes.length,
    read: async (start, length) => {
      if (options.reject) throw new Error('permission denied');
      return bytes.slice(start, start + length);
    },
  };
}

const put16 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
};
const put32 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
  bytes[offset + 2] = value >>> 16;
  bytes[offset + 3] = value >>> 24;
};
const putBe16 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value >>> 8;
  bytes[offset + 1] = value;
};
const putBe32 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
};

function zip(
  entries: Array<{ encrypted?: boolean; name: string; value?: string }>,
  trailing = 0,
) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let localOffset = 0;
  for (const item of entries) {
    const name = encoder.encode(item.name);
    const value = encoder.encode(item.value ?? 'data');
    const local = new Uint8Array(30 + name.length + value.length);
    local.set([0x50, 0x4b, 0x03, 0x04]);
    put16(local, 6, item.encrypted ? 1 : 0);
    put32(local, 18, value.length);
    put32(local, 22, value.length);
    put16(local, 26, name.length);
    local.set(name, 30);
    local.set(value, 30 + name.length);
    const record = new Uint8Array(46 + name.length);
    record.set([0x50, 0x4b, 0x01, 0x02]);
    put16(record, 8, item.encrypted ? 1 : 0);
    put32(record, 20, value.length);
    put32(record, 24, value.length);
    put16(record, 28, name.length);
    put32(record, 42, localOffset);
    record.set(name, 46);
    locals.push(local);
    central.push(record);
    localOffset += local.length;
  }
  const centralBytes = Uint8Array.from(central.flatMap((value) => [...value]));
  const end = new Uint8Array(22);
  end.set([0x50, 0x4b, 0x05, 0x06]);
  put16(end, 8, entries.length);
  put16(end, 10, entries.length);
  put32(end, 12, centralBytes.length);
  put32(end, 16, localOffset);
  return Uint8Array.from([
    ...locals.flatMap((value) => [...value]),
    ...centralBytes,
    ...new Uint8Array(trailing),
    ...end,
  ]);
}

function palm({ encrypted = false, kf8 = false } = {}) {
  const recordOffset = 86;
  const bytes = new Uint8Array(recordOffset + 56);
  bytes.set(new TextEncoder().encode('BOOKMOBI'), 60);
  putBe16(bytes, 76, 1);
  putBe32(bytes, 78, recordOffset);
  putBe16(bytes, recordOffset + 12, encrypted ? 1 : 0);
  bytes.set(new TextEncoder().encode('MOBI'), recordOffset + 16);
  putBe32(bytes, recordOffset + 52, kf8 ? 8 : 6);
  return bytes;
}

test.each([
  [
    'epub',
    zip([
      { name: 'mimetype', value: 'application/epub+zip' },
      { name: 'EPUB/package.opf' },
    ]),
    'epub',
    'reflowable',
  ],
  ['single-fbz', zip([{ name: 'book.fb2' }]), 'fbz', 'reflowable'],
  ['cbz', zip([{ name: '001.jpg' }]), 'cbz', 'fixed'],
])(
  'detects valid %s bytes without filename or MIME',
  async (_, bytes, format, layout) => {
    await expect(detectReaderFormat(source(bytes))).resolves.toEqual({
      status: 'supported',
      format,
      layout,
    });
  },
);

test('detects actual PalmDB record zero as MOBI6, KF8, and encrypted PalmDOC', async () => {
  await expect(detectReaderFormat(source(palm()))).resolves.toMatchObject({
    status: 'supported',
    format: 'mobi',
  });
  await expect(
    detectReaderFormat(source(palm({ kf8: true }))),
  ).resolves.toMatchObject({ status: 'supported', format: 'kf8-azw3' });
  await expect(
    detectReaderFormat(source(palm({ encrypted: true }))),
  ).resolves.toMatchObject({ status: 'error', error: { category: 'drm' } });
});

test('rejects read failures, corrupt structures, malicious sizes, and PDF by bytes', async () => {
  await expect(
    detectReaderFormat(source(new Uint8Array(100), { reject: true })),
  ).resolves.toMatchObject({ status: 'error', error: { category: 'read' } });
  await expect(
    detectReaderFormat(source(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))),
  ).resolves.toMatchObject({ status: 'error', error: { category: 'invalid' } });
  const malicious = zip([
    { name: 'mimetype', value: 'application/epub+zip' },
    { name: 'book.opf' },
  ]);
  put32(malicious, 22, 0x7fffffff);
  await expect(detectReaderFormat(source(malicious))).resolves.toMatchObject({
    status: 'error',
    error: { category: 'invalid' },
  });
  await expect(
    detectReaderFormat(source(new TextEncoder().encode('%PDF-1.7'))),
  ).resolves.toMatchObject({
    status: 'error',
    error: { category: 'unsupported' },
  });
});

test('handles a valid central directory beyond the old 65K tail window', async () => {
  const bytes = zip(
    Array.from({ length: 900 }, (_, index) => ({
      name: `pages/${String(index).padStart(5, '0')}-${'x'.repeat(40)}.jpg`,
    })),
  );
  await expect(detectReaderFormat(source(bytes))).resolves.toEqual({
    status: 'supported',
    format: 'cbz',
    layout: 'fixed',
  });
});

test('detects FB2 XML independently of MIME and rejects unrelated text', async () => {
  await expect(
    detectReaderFormat(
      source(new TextEncoder().encode('<?xml version="1.0"?><FictionBook/>')),
    ),
  ).resolves.toMatchObject({ status: 'supported', format: 'fb2' });
  await expect(
    detectReaderFormat(source(new TextEncoder().encode('not a book'))),
  ).resolves.toMatchObject({
    status: 'error',
    error: { category: 'unsupported' },
  });
});

test.each([
  Uint8Array.from([
    0xef,
    0xbb,
    0xbf,
    ...new TextEncoder().encode('<?xml version="1.0"?><FictionBook/>'),
  ]),
  new TextEncoder().encode(
    '<!-- comment --><!DOCTYPE FictionBook SYSTEM "fb2.dtd"><FictionBook/>',
  ),
])('recognizes direct FB2 after legal XML misc', async (document) => {
  await expect(detectReaderFormat(source(document))).resolves.toMatchObject({
    status: 'supported',
    format: 'fb2',
  });
});

test.each(['<FictionBookish/>', '<fictionbook/>', '<!-- incomplete'])(
  'rejects near-miss direct FB2 XML: %s',
  async (document) => {
    await expect(
      detectReaderFormat(source(new TextEncoder().encode(document))),
    ).resolves.toMatchObject({
      status: 'error',
      error: { category: 'unsupported' },
    });
  },
);

test('detects real deterministic corpus bytes independently from their labels', async () => {
  const fixture = async (file: string) =>
    new Uint8Array(await readFile(join(process.cwd(), 'fixtures', file)));
  await expect(
    detectReaderFormat(source(await fixture('fb2/valid-navigation.fb2'))),
  ).resolves.toMatchObject({ status: 'supported', format: 'fb2' });
  await expect(
    detectReaderFormat(source(await fixture('fbz/valid-navigation.fbz'))),
  ).resolves.toMatchObject({ status: 'supported', format: 'fbz' });
  await expect(
    detectReaderFormat(source(await fixture('cbz/valid-fixed.cbz'))),
  ).resolves.toMatchObject({
    status: 'supported',
    format: 'cbz',
    layout: 'fixed',
  });
  await expect(
    detectReaderFormat(source(await fixture('cbz/mislabelled-as-epub.epub'))),
  ).resolves.toMatchObject({ status: 'supported', format: 'cbz' });
  await expect(
    detectReaderFormat(source(await fixture('cbz/encrypted-flag.cbz'))),
  ).resolves.toMatchObject({ status: 'error', error: { category: 'drm' } });
  await expect(
    detectReaderFormat(source(await fixture('epub/mislabelled-as-mobi.mobi'))),
  ).resolves.toMatchObject({ status: 'supported', format: 'epub' });
  await expect(
    detectReaderFormat(source(await fixture('fb2/mislabelled-as-cbz.cbz'))),
  ).resolves.toMatchObject({ status: 'supported', format: 'fb2' });
  await expect(
    detectReaderFormat(source(await fixture('fbz/mislabelled-as-epub.epub'))),
  ).resolves.toMatchObject({ status: 'supported', format: 'fbz' });
  await expect(
    detectReaderFormat(source(await fixture('mobi/valid-mobi6.mobi'))),
  ).resolves.toMatchObject({ status: 'supported', format: 'mobi' });
  await expect(
    detectReaderFormat(source(await fixture('kf8/valid-navigation.azw3'))),
  ).resolves.toMatchObject({ status: 'supported', format: 'kf8-azw3' });
  await expect(
    detectReaderFormat(source(await fixture('kf8/mislabelled-as-fb2.fb2'))),
  ).resolves.toMatchObject({ status: 'supported', format: 'kf8-azw3' });
  await expect(
    detectReaderFormat(source(await fixture('kf8/malformed.azw3'))),
  ).resolves.toMatchObject({
    status: 'error',
    error: { category: 'unsupported' },
  });
  await expect(
    detectReaderFormat(source(await fixture('mobi/encrypted-flag.mobi'))),
  ).resolves.toMatchObject({ status: 'error', error: { category: 'drm' } });
  await expect(
    detectReaderFormat(source(await fixture('mobi/malformed.mobi'))),
  ).resolves.toMatchObject({
    status: 'error',
    error: { category: 'unsupported' },
  });
  await expect(
    detectReaderFormat(source(await fixture('pdf/rejected.pdf'))),
  ).resolves.toMatchObject({
    status: 'error',
    error: { category: 'unsupported' },
  });
});
