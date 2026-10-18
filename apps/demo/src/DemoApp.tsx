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

import {
  NativeReader,
  type ReaderLoadState,
  type ReaderSource,
} from '@hamster-note/native-reader';

// Picker MIME 仅是候选提示：阅读器按内容检测格式，这里只用于放宽系统
// 文件选择器的过滤。刻意不包含 application/pdf——本版本不支持 PDF。
// CBZ 是 zip 容器，常见系统选择器只会按容器 MIME/扩展名匹配；列表若不放行
// 容器，宣称支持的 CBZ 会在选择阶段就被隐藏，内容检测没有机会运行。
const PICKER_MIME_HINTS = [
  'application/epub+zip', // EPUB
  'application/x-mobipocket-ebook', // MOBI
  'application/vnd.amazon.ebook', // KF8/AZW3
  'application/x-fictionbook+xml', // FB2
  'application/x-fictionbook+zip', // FBZ
  'application/vnd.comicbook+zip', // CBZ
  'application/x-cbz', // CBZ（部分平台注册的别名）
  'application/zip', // CBZ 兜底：多数平台只把 CBZ 识别为 zip
];

// Web 端的 Expo 实现把该列表直接写进 <input accept>；浏览器对容器 MIME 的
// 匹配并不覆盖所有平台登记，因此额外放行扩展名，仍由内容检测拒绝误选文件。
const PICKER_WEB_ACCEPT_EXTENSIONS = [
  '.epub',
  '.mobi',
  '.azw3',
  '.fb2',
  '.fbz',
  '.cbz',
];

// 唯一对外宣称的格式清单（含 CBZ）。任何 UI 文案都不得超出这个清单。
const SUPPORTED_FORMATS_LABEL = 'EPUB, MOBI, AZW3 (KF8), FB2/FBZ, CBZ';

// Expo Web 把 type 直接写进 <input accept>，原生则按 MIME 过滤；两者共用同一
// 候选集，差异只在 Web 额外放宽扩展名。
const pickerTypes = (): string[] =>
  Platform.OS === 'web'
    ? [...PICKER_MIME_HINTS, ...PICKER_WEB_ACCEPT_EXTENSIONS]
    : [...PICKER_MIME_HINTS];

type SelectedDocument = {
  name: string;
  ownedBlobUri: string | null;
  source: ReaderSource;
};

function webLoadInactivityTimeout(): number | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  const value = new URLSearchParams(window.location.search).get(
    'loadInactivityTimeoutMs',
  );
  if (value === null) return undefined;
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout >= 0 ? timeout : undefined;
}

export function DemoApp() {
  const { width } = useWindowDimensions();
  const [loadInactivityTimeoutMs] = useState(webLoadInactivityTimeout);
  const [selectedDocument, setSelectedDocument] =
    useState<SelectedDocument | null>(null);
  // Demo 级状态条只转述阅读器公开 onStateChange 的状态，不自行解析/渲染。
  const [readerState, setReaderState] = useState<ReaderLoadState>({
    status: 'idle',
  });
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

  async function selectBook() {
    if (pickingRef.current) return;
    pickingRef.current = true;
    setIsPicking(true);
    setPickerError(null);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        base64: false,
        copyToCacheDirectory: Platform.OS !== 'web',
        multiple: false,
        type: pickerTypes(),
      });

      // 取消时原样返回：当前正在阅读的 source 与其 blob/cache 资源保持不变。
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

      // 新 source 会由阅读器重新回报 loading/ready/error；先回到 idle，
      // 避免状态条短暂展示上一本书的陈旧状态。
      setReaderState({ status: 'idle' });
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
        'That book could not be opened. Please choose another file.',
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
            Read your books anywhere.
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
              Books stay on this device and are opened only when you choose one.
            </Text>
            <Text style={styles.formatHint} testID="supported-formats">
              Supported formats: {SUPPORTED_FORMATS_LABEL}
            </Text>
            <Pressable
              accessibilityLabel="Choose a book"
              accessibilityRole="button"
              accessibilityState={{ busy: isPicking, disabled: isPicking }}
              disabled={isPicking}
              onPress={selectBook}
              style={({ pressed }) => [
                styles.pickButton,
                pressed && styles.pickButtonPressed,
                isPicking && styles.pickButtonDisabled,
              ]}
              // testID 沿用旧名：既有浏览器 E2E 仍按它定位，任务 7.2 重写
              // E2E 时统一更名。
              testID="select-epub"
            >
              <Text style={styles.pickButtonText}>
                {isPicking
                  ? 'Opening library...'
                  : selectedDocument
                    ? 'Choose another book'
                    : 'Choose a book'}
              </Text>
            </Pressable>
            <Text style={styles.selectionState} testID="source-state">
              {selectedDocument
                ? `Selected: ${selectedDocument.name}`
                : 'No book selected'}
            </Text>
            {pickerError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {pickerError}
              </Text>
            ) : null}
          </View>

          <View style={styles.readerPanel}>
            {selectedDocument ? (
              <View style={styles.readerSession}>
                <View style={styles.readerStatusBar} testID="reader-status-bar">
                  {readerState.status === 'loading' ? (
                    <Text
                      accessibilityLiveRegion="polite"
                      style={styles.readerStatusText}
                      testID="reader-status"
                    >
                      Opening {selectedDocument.name}...
                    </Text>
                  ) : null}
                  {readerState.status === 'ready' ? (
                    <Text
                      style={styles.readerStatusText}
                      testID="reader-status"
                    >
                      Now reading: {selectedDocument.name}
                    </Text>
                  ) : null}
                  {readerState.status === 'error' ? (
                    <Text
                      accessibilityRole="alert"
                      style={styles.readerStatusError}
                      testID="reader-status"
                    >
                      {readerState.error.message}
                    </Text>
                  ) : null}
                </View>
                <NativeReader
                  loadInactivityTimeoutMs={loadInactivityTimeoutMs}
                  onStateChange={setReaderState}
                  source={selectedDocument.source}
                  style={styles.reader}
                  testID="demo-reader"
                />
                {Platform.OS === 'android' ? (
                  // 公开的 Android 上游限制说明与恢复指引（任务 4.5 的选择器
                  // 就绪前由 "When available" 保持文案诚实）。
                  <Text
                    style={styles.recoveryNote}
                    testID="android-recovery-note"
                  >
                    On Android, page mode and text selection can be limited by
                    the system WebView. When available, scrolling mode is the
                    reliable way to keep reading.
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.emptyReader} testID="reader-empty-state">
                <Text style={styles.emptyReaderMark}>Aa</Text>
                <Text style={styles.emptyReaderTitle}>
                  Your reader is ready
                </Text>
                <Text style={styles.emptyReaderBody}>
                  Select a book to begin reading.
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
  formatHint: { color: '#9fa8a1', fontSize: 12, lineHeight: 18 },
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
  readerSession: { flex: 1 },
  readerStatusBar: {
    borderBottomColor: '#ded7c8',
    borderBottomWidth: 1,
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  readerStatusError: { color: '#9d3c20', fontSize: 13, lineHeight: 18 },
  readerStatusText: { color: '#625f58', fontSize: 13, lineHeight: 18 },
  recoveryNote: {
    borderTopColor: '#ded7c8',
    borderTopWidth: 1,
    color: '#777168',
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
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
