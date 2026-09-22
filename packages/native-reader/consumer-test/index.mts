import {
  NativeReader,
  type NativeReaderProps,
  type ReaderSource,
} from '@hamster-note/native-reader';

const source: ReaderSource = { kind: 'uri', uri: 'file:///external.epub' };
const props: NativeReaderProps = { source };
void NativeReader;
void props;
