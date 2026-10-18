import {
  NativeReader,
  type NativeReaderProps,
  type ReaderByteSource,
  type ReaderErrorCategory,
  type ReaderError,
  type ReaderPublicationFormat,
  type ReaderReadingFlow,
  type ReaderSource,
} from '@hamster-note/native-reader';

const source: ReaderSource = { kind: 'uri', uri: 'file:///external.epub' };
const props: NativeReaderProps = { source };
const format: ReaderPublicationFormat = 'cbz';
const flow: ReaderReadingFlow = 'paginated';
const category: ReaderErrorCategory = 'unsupported';
const error: ReaderError = { category, message: 'Unsupported source' };
// @ts-expect-error consumers must provide a stable presentation category
const missingCategory: ReaderError = { message: 'Missing category' };
const bytes: ReaderByteSource = { size: 0, read: async () => new Uint8Array() };
void NativeReader;
void props;
void format;
void flow;
void category;
void error;
void missingCategory;
void bytes;
