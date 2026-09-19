import { useEffect, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { NativeReader, type ReaderSource } from '@hamster-note/native-reader';

type SelectedDocument = {
  name: string;
  ownedBlobUri: string | null;
  source: ReaderSource;
};

export function DemoApp() {
  const { width } = useWindowDimensions();
  const [selectedDocument, setSelectedDocument] =
    useState<SelectedDocument | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const activeBlobUri = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const pickingRef = useRef(false);
  const isCompact = width < 720;

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (activeBlobUri.current) {
        URL.revokeObjectURL(activeBlobUri.current);
        activeBlobUri.current = null;
      }
    },
    [],
  );

  async function selectEpub() {
    if (pickingRef.current) return;
    pickingRef.current = true;
    setIsPicking(true);
    setPickerError(null);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        base64: false,
        copyToCacheDirectory: Platform.OS !== 'web',
        multiple: false,
        type: 'application/epub+zip',
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      if (!asset) {
        return;
      }

      let uri = asset.uri;
      let nextOwnedBlobUri: string | null = null;

      if (Platform.OS === 'web' && asset.file) {
        uri = URL.createObjectURL(asset.file);
        nextOwnedBlobUri = uri;
      }

      if (!mountedRef.current) {
        if (nextOwnedBlobUri) URL.revokeObjectURL(nextOwnedBlobUri);
        return;
      }

      const previousBlobUri = activeBlobUri.current;
      activeBlobUri.current = nextOwnedBlobUri;
      if (previousBlobUri && previousBlobUri !== nextOwnedBlobUri)
        URL.revokeObjectURL(previousBlobUri);

      setSelectedDocument({
        name: asset.name,
        ownedBlobUri: nextOwnedBlobUri,
        source: {
          kind: 'uri',
          uri,
          name: asset.name,
          mimeType: asset.mimeType,
        },
      });
    } catch {
      setPickerError(
        'That EPUB could not be opened. Please choose another file.',
      );
    } finally {
      pickingRef.current = false;
      if (mountedRef.current) setIsPicking(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} testID="demo-root">
      <ScrollView
        contentContainerStyle={[
          styles.page,
          isCompact ? styles.pageCompact : styles.pageWide,
        ]}
      >
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>Hamster Note</Text>
          <Text style={[styles.heading, isCompact && styles.headingCompact]}>
            Read an EPUB anywhere.
          </Text>
          <Text style={styles.subheading}>
            Choose a local book to open it in the same reader on iOS, Android,
            and the web.
          </Text>
        </View>

        <View
          style={[styles.workspace, isCompact && styles.workspaceCompact]}
          testID={isCompact ? 'layout-compact' : 'layout-wide'}
        >
          <View
            style={[styles.pickerPanel, isCompact && styles.pickerPanelCompact]}
          >
            <Text style={styles.panelTitle}>Your book</Text>
            <Text style={styles.panelBody}>
              EPUB files stay on this device and are opened only when you choose
              one.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: isPicking, disabled: isPicking }}
              disabled={isPicking}
              onPress={selectEpub}
              style={({ pressed }) => [
                styles.pickButton,
                pressed && styles.pickButtonPressed,
                isPicking && styles.pickButtonDisabled,
              ]}
              testID="select-epub"
            >
              <Text style={styles.pickButtonText}>
                {isPicking
                  ? 'Opening library...'
                  : selectedDocument
                    ? 'Choose another EPUB'
                    : 'Choose an EPUB'}
              </Text>
            </Pressable>
            <Text style={styles.selectionState} testID="source-state">
              {selectedDocument
                ? `Selected: ${selectedDocument.name}`
                : 'No EPUB selected'}
            </Text>
            {pickerError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {pickerError}
              </Text>
            ) : null}
          </View>

          <View style={styles.readerPanel}>
            {selectedDocument ? (
              <NativeReader
                source={selectedDocument.source}
                style={styles.reader}
                testID="demo-reader"
              />
            ) : (
              <View style={styles.emptyReader} testID="reader-empty-state">
                <Text style={styles.emptyReaderMark}>Aa</Text>
                <Text style={styles.emptyReaderTitle}>
                  Your reader is ready
                </Text>
                <Text style={styles.emptyReaderBody}>
                  Select an EPUB to begin reading.
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#f3efe5', flex: 1 },
  page: {
    alignSelf: 'center',
    gap: 28,
    maxWidth: 1180,
    minHeight: '100%',
    width: '100%',
  },
  pageCompact: { paddingHorizontal: 18, paddingVertical: 28 },
  pageWide: { paddingHorizontal: 40, paddingVertical: 48 },
  intro: { gap: 8, maxWidth: 700 },
  eyebrow: {
    color: '#9d3c20',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
  },
  heading: {
    color: '#22211f',
    fontFamily: 'Georgia',
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: -1.5,
    lineHeight: 54,
  },
  headingCompact: { fontSize: 36, lineHeight: 41 },
  subheading: { color: '#625f58', fontSize: 17, lineHeight: 26 },
  workspace: { flex: 1, flexDirection: 'row', gap: 22 },
  workspaceCompact: { flexDirection: 'column' },
  pickerPanel: {
    alignSelf: 'stretch',
    backgroundColor: '#242a2b',
    borderRadius: 24,
    gap: 14,
    padding: 24,
    width: 300,
  },
  pickerPanelCompact: { width: '100%' },
  panelTitle: {
    color: '#fffaf0',
    fontFamily: 'Georgia',
    fontSize: 25,
    fontWeight: '700',
  },
  panelBody: { color: '#c8cbc6', fontSize: 14, lineHeight: 21 },
  pickButton: {
    alignItems: 'center',
    backgroundColor: '#e45e35',
    borderRadius: 12,
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  pickButtonPressed: { backgroundColor: '#c94d28' },
  pickButtonDisabled: { opacity: 0.65 },
  pickButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  selectionState: { color: '#eef0e8', fontSize: 13, lineHeight: 19 },
  error: { color: '#ffb39d', fontSize: 13, lineHeight: 19 },
  readerPanel: {
    backgroundColor: '#fffdf8',
    borderColor: '#ded7c8',
    borderRadius: 24,
    borderWidth: 1,
    flex: 1,
    minHeight: 440,
    overflow: 'hidden',
  },
  reader: { flex: 1 },
  emptyReader: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 32,
  },
  emptyReaderMark: {
    color: '#bd4c2a',
    fontFamily: 'Georgia',
    fontSize: 52,
    fontWeight: '700',
  },
  emptyReaderTitle: {
    color: '#282622',
    fontFamily: 'Georgia',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 14,
  },
  emptyReaderBody: { color: '#777168', fontSize: 15, marginTop: 8 },
});
