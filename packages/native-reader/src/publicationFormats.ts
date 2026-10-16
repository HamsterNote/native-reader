import type { ReaderPublicationFormat } from './types';

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
