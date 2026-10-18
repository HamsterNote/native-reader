import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  NativeReader,
  isReaderTextHighlight as isTextHighlight,
  type NativeReaderProps,
  type ReaderTextHighlight,
} from '@hamster-note/native-reader';

const key = (id: string) => `hamster-native-reader:text-highlights:v1:${id}`;

/** Identity arrives only after the engine's existing authorization and read. */
export function WebHighlightReader(props: NativeReaderProps) {
  const [id, setId] = useState<string>();
  const [values, setValues] = useState<ReaderTextHighlight[]>([]);
  const [error, setError] = useState<string>();
  const owner = useRef(props.source);
  owner.current = props.source;
  const save = (documentId: string, highlights: ReaderTextHighlight[]) => {
    try {
      if (highlights.length > 1000 || !highlights.every(isTextHighlight))
        throw new Error('invalid');
      localStorage.setItem(
        key(documentId),
        JSON.stringify({ version: 1, documentId, highlights }),
      );
      setError(undefined);
    } catch {
      setError('高亮尚未保存，请重试。');
    }
  };
  return (
    <View style={{ flex: 1 }}>
      <NativeReader
        {...props}
        documentId={id}
        highlights={values}
        onDocumentId={(documentId) => {
          if (owner.current !== props.source) return;
          try {
            const raw = localStorage.getItem(key(documentId));
            const data: unknown =
              raw && raw.length <= 16000000 ? JSON.parse(raw) : null;
            let next: ReaderTextHighlight[] = [];
            if (
              data &&
              typeof data === 'object' &&
              'version' in data &&
              data.version === 1 &&
              'documentId' in data &&
              data.documentId === documentId &&
              'highlights' in data &&
              Array.isArray(data.highlights) &&
              data.highlights.length <= 1000
            )
              next = data.highlights.filter(isTextHighlight);
            setValues(next);
            setId(documentId);
          } catch {
            setError('无法读取本地高亮，请重新打开文档。');
          }
        }}
        onHighlightsChange={(next, detail) => {
          if (!id || detail.documentId !== id || owner.current !== props.source)
            return;
          setValues(next);
          save(id, next);
        }}
      />
      {error && (
        <View>
          <Text accessibilityRole="alert">{error}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (id) save(id, values);
            }}
          >
            <Text>重试</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
