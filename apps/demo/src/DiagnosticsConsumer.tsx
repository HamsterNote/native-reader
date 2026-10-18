import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import {
  NativeReader,
  type ReaderLoadState,
  type ReaderReadingFlow,
  type ReaderSource,
} from '@hamster-note/native-reader';

export function DiagnosticsConsumer() {
  const [source, setSource] = useState<ReaderSource>();
  const [selected, setSelected] = useState<ReaderSource>();
  const [state, setState] = useState<ReaderLoadState>({ status: 'idle' });
  const [flow, setFlow] = useState<ReaderReadingFlow>('paginated');
  return (
    <View style={{ height: '100%', flex: 1 }}>
      <input
        aria-label="Publication file"
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (selected) URL.revokeObjectURL(selected.uri);
          const next: ReaderSource = {
            kind: 'uri',
            uri: URL.createObjectURL(file),
            name: file.name,
          };
          setSelected(next);
          setSource(next);
        }}
      />
      <Button title="Open same source" onPress={() => setSource(selected)} />
      <Button
        title="Close publication"
        onPress={() => {
          setSource(undefined);
          setState({ status: 'idle' });
        }}
      />
      <Button title="Use scrolled flow" onPress={() => setFlow('scrolled')} />
      <Text testID="consumer-state">
        {state.status === 'error'
          ? `error: ${state.error.message}`
          : state.status}
      </Text>
      {source ? (
        <NativeReader
          source={source}
          readingFlow={flow}
          onReadingFlowChange={setFlow}
          onStateChange={setState}
          intrusiveCspDiagnostics={
            new URLSearchParams(location.search).get('diagnostics') === 'true'
          }
          style={{ flex: 1 }}
        />
      ) : null}
    </View>
  );
}
