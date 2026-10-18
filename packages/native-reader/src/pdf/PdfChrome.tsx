import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  getPdfPopoverPosition,
  type PdfPageState,
  type PdfSelection,
  type PdfSession,
  type PdfThumbnail,
} from './contracts';
import type { NativeReaderProps, ReaderLoadState } from '../types';

export type PdfChromeSession = PdfSession & {
  setScale(scale: number): void;
  rotate(): void;
};
type Props = Pick<NativeReaderProps, 'style' | 'testID'> & {
  state: ReaderLoadState;
  page: PdfPageState | null;
  selection: PdfSelection | null;
  session: PdfChromeSession | null;
  rootRef?: (node: View | null) => void;
  children: ReactNode;
};

function Thumbnail({
  number,
  current,
  session,
  visible,
  navigate,
}: {
  number: number;
  current: boolean;
  visible: boolean;
  session: PdfChromeSession | null;
  navigate(page: number): void;
}) {
  const [image, setImage] = useState<PdfThumbnail | null>(null);
  useEffect(() => {
    let active = true;
    if (visible)
      void session
        ?.getThumbnail(number)
        .then((value) => {
          if (active) setImage(value);
        })
        .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [number, session, visible]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Page ${number}`}
      accessibilityState={{ selected: current }}
      aria-selected={current}
      onPress={() => navigate(number)}
      style={[styles.page, current && styles.current]}
    >
      <View style={styles.thumbnail}>
        {image && (
          <Image
            testID={`pdf-thumbnail-${number}`}
            source={{ uri: image.uri }}
            resizeMode="contain"
            style={styles.image}
          />
        )}
      </View>
      <Text style={styles.number}>{number}</Text>
    </Pressable>
  );
}

export function PdfChrome(props: Props) {
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [pagesOpen, setPagesOpen] = useState(true);
  const [visible, setVisible] = useState<Set<number>>(
    () => new Set([1, 2, 3, 4]),
  );
  const [zoom, setZoom] = useState('100');
  const appliedZoom = useRef('100');
  const compact = bounds.width < 640;
  const position = getPdfPopoverPosition(
    props.selection,
    bounds.width,
    bounds.height,
  );
  const viewability = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: number }> }) =>
      setVisible(new Set(viewableItems.map(({ item }) => item))),
  );
  useEffect(() => {
    setZoom('100');
    appliedZoom.current = '100';
    setVisible(new Set([1, 2, 3, 4]));
  }, [props.session]);
  const navigate = (number: number) => {
    props.session?.clearSelection();
    void props.session?.goToPage(number).catch(() => undefined);
    if (compact) setPagesOpen(false);
  };
  const applyZoom = () => {
    const value = Number(zoom);
    if (Number.isFinite(value) && value >= 50 && value <= 300) {
      if (zoom !== appliedZoom.current) props.session?.setScale(value / 100);
      appliedZoom.current = zoom;
    } else setZoom(appliedZoom.current);
  };
  return (
    <View
      ref={props.rootRef}
      style={[styles.root, props.style]}
      testID={props.testID}
      onLayout={({ nativeEvent: { layout } }) => {
        setBounds({ width: layout.width, height: layout.height });
        props.session?.clearSelection();
      }}
    >
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pages"
          accessibilityState={{ expanded: pagesOpen }}
          aria-expanded={pagesOpen}
          onPress={() => {
            props.session?.clearSelection();
            setPagesOpen((value) => !value);
          }}
          style={styles.tool}
        >
          <Text style={styles.symbol}>☰</Text>
        </Pressable>
        <Text
          accessibilityLabel="Page position"
          accessibilityLiveRegion="polite"
          style={styles.counter}
        >
          {props.page?.pageNumber ?? 0} / {props.page?.pageCount ?? 0}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous page"
          disabled={!props.page || props.page.pageNumber <= 1}
          accessibilityState={{
            disabled: !props.page || props.page.pageNumber <= 1,
          }}
          onPress={() => navigate((props.page?.pageNumber ?? 1) - 1)}
          style={styles.tool}
        >
          <Text style={styles.symbol}>‹</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next page"
          disabled={
            !props.page || props.page.pageNumber >= props.page.pageCount
          }
          accessibilityState={{
            disabled:
              !props.page || props.page.pageNumber >= props.page.pageCount,
          }}
          onPress={() => navigate((props.page?.pageNumber ?? 1) + 1)}
          style={styles.tool}
        >
          <Text style={styles.symbol}>›</Text>
        </Pressable>
        <TextInput
          accessibilityLabel="Zoom percent"
          keyboardType="numeric"
          value={zoom}
          onChangeText={setZoom}
          onBlur={applyZoom}
          onSubmitEditing={applyZoom}
          style={styles.zoom}
        />
        <Text>%</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rotate page"
          onPress={() => props.session?.rotate()}
          style={styles.tool}
        >
          <Text style={styles.symbol}>↻</Text>
        </Pressable>
      </View>
      <View style={styles.workspace}>
        <View style={styles.viewport}>{props.children}</View>
        {pagesOpen && (
          <View
            accessibilityLabel="Pages"
            style={[styles.rail, compact && styles.compactRail]}
          >
            <FlatList
              testID="pdf-pages-list"
              data={Array.from(
                { length: props.page?.pageCount ?? 0 },
                (_, index) => index + 1,
              )}
              keyExtractor={String}
              initialNumToRender={6}
              maxToRenderPerBatch={4}
              windowSize={5}
              getItemLayout={(_, index) => ({
                length: 184,
                offset: 184 * index,
                index,
              })}
              onViewableItemsChanged={viewability.current}
              renderItem={({ item }) => (
                <Thumbnail
                  number={item}
                  current={props.page?.pageNumber === item}
                  visible={visible.has(item)}
                  session={props.session}
                  navigate={navigate}
                />
              )}
            />
          </View>
        )}
      </View>
      {props.state.status === 'loading' && (
        <View pointerEvents="none" style={styles.status}>
          <Text accessibilityLiveRegion="polite">Loading PDF…</Text>
        </View>
      )}
      {props.state.status === 'error' && (
        <View style={styles.status}>
          <Text accessibilityRole="alert">{props.state.error.message}</Text>
        </View>
      )}
      {position && (
        <View
          accessibilityRole="none"
          accessibilityLabel="Text selection"
          style={[styles.popover, position]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="高亮"
            onPressIn={(event) => event.preventDefault()}
            onPress={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            style={styles.highlight}
          >
            <Text>高亮</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 320,
    position: 'relative',
    backgroundColor: '#e8ebee',
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 8,
    gap: 4,
    backgroundColor: '#fff',
    borderBottomColor: '#d8dde1',
    borderBottomWidth: 1,
    zIndex: 2,
  },
  tool: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
  symbol: { fontSize: 23, color: '#24372e' },
  counter: { minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
  zoom: {
    width: 44,
    height: 32,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#bcc6c0',
    borderRadius: 4,
    padding: 2,
  },
  workspace: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row-reverse',
    position: 'relative',
  },
  viewport: { flex: 1, minWidth: 0 },
  rail: {
    width: 152,
    backgroundColor: '#f7f9f8',
    borderRightColor: '#cdd6d0',
    borderRightWidth: 1,
  },
  compactRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 1,
    elevation: 3,
  },
  page: {
    height: 184,
    width: 152,
    alignItems: 'center',
    paddingTop: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  current: { borderColor: '#287755', backgroundColor: '#e6f2eb' },
  thumbnail: {
    width: 112,
    height: 150,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d3dad6',
  },
  image: { width: 110, height: 148 },
  number: { lineHeight: 20, color: '#24372e' },
  status: {
    position: 'absolute',
    top: 54,
    right: 8,
    maxWidth: '85%',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 4,
  },
  popover: {
    position: 'absolute',
    width: 80,
    height: 36,
    zIndex: 5,
    elevation: 8,
    backgroundColor: '#fff',
    borderColor: '#aebcb3',
    borderWidth: 1,
    borderRadius: 6,
  },
  highlight: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
