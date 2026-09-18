import {
  NativeReader,
  type NativeReaderProps,
  type ReaderContent,
  type ReaderPosition,
  type ReaderTheme,
} from '@hamster-note/native-reader';

const content: ReaderContent = { id: 'external', title: 'External consumer' };
const position: ReaderPosition = { progress: 0.75 };
const theme: ReaderTheme = 'light';
const props: NativeReaderProps = { content, initialPosition: position, theme };
void NativeReader;
void props;
