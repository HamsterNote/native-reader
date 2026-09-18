import {
  NativeReader,
  type NativeReaderProps,
  type ReaderContent,
  type ReaderPosition,
  type ReaderTheme,
} from '@hamster-note/native-reader';

const content: ReaderContent = { id: 'external', title: 'External consumer' };
const position: ReaderPosition = { sectionId: 'one', progress: 0.25 };
const theme: ReaderTheme = 'dark';
const props: NativeReaderProps = { content, initialPosition: position, theme };
void NativeReader;
void props;
