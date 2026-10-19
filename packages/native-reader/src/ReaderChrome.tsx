import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { ReaderBookLocation, ReaderTocDisplayItem } from './bookModel';
import type { ReaderPublicationModel, ReaderTocItem } from './shared';
import { useReaderOverlay, type ReaderOverlayLayer } from './useReaderOverlay';
import type {
  NativeReaderProps,
  ReaderError,
  ReaderLoadState,
  ReaderPublicationLayout,
  ReaderReadingFlow,
} from './types';

// Flow 选择器的展示顺序与取值即公开契约：可重排出版物只允许这两种 flow。
const READING_FLOW_OPTIONS: ReadonlyArray<{
  flow: ReaderReadingFlow;
  label: string;
}> = [
  { flow: 'scrolled', label: 'Scrolled' },
  { flow: 'paginated', label: 'Paginated' },
];

// Unresolved TOC 条目的可恢复反馈文案：简洁、不泄露引擎/格式细节。
const TOC_UNAVAILABLE_FEEDBACK =
  "Location isn't available in this publication.";

type ReaderChromeProps = Pick<NativeReaderProps, 'style' | 'testID'> & {
  state: ReaderLoadState;
  model?: ReaderPublicationModel;
  currentIndex: number;
  canGoPrevious?: boolean | null;
  canGoNext?: boolean | null;
  navigationPending?: boolean;
  sessionIdentity?: unknown;
  navigationError?: ReaderError;
  /**
   * Layout of the open publication. Fixed-layout publications (image-based
   * CBZ) do not support reflow flow switching, so the selector is replaced
   * by a fixed-layout notice. Defaults to 'reflowable'.
   */
  publicationLayout?: ReaderPublicationLayout;
  /**
   * Reading flow shown by the flow UI: the selection when the control is
   * interactive, or the engine's actual flow in the non-interactive status
   * line. Adapters must always pass the flow the engine really renders —
   * never a requested-but-unapplied preference. Defaults to 'scrolled', the
   * documented mobile default.
   */
  readingFlow?: ReaderReadingFlow;
  /**
   * Whether the current engine can actually apply a flow change in this
   * session. When false the interactive selector is replaced by a truthful,
   * non-interactive status line, so the UI never implies a flow was applied
   * when it was not. Defaults to true (the future Foliate adapters enable
   * the selector once their renderer acknowledges flow commands).
   */
  flowControlAvailable?: boolean;
  /**
   * Reports the user's flow pick. Platform adapters translate this callback
   * into an engine flow command; without it the selector renders disabled.
   */
  onReadingFlowChange?: (flow: ReaderReadingFlow) => void;
  onPrevious(): void;
  onNext(): void;
  onNavigate(item: ReaderTocItem): void | boolean | Promise<boolean>;
  /**
   * Format-neutral TOC display projection (ReaderBookModel.displayToc).
   * Items carry no EPUB archive/href identity; when this prop is present it
   * replaces the legacy EPUB-shaped `model.toc` rendering entirely.
   */
  toc?: readonly ReaderTocDisplayItem[];
  /**
   * A resolved neutral TOC item was activated. `location.linearIndex` is
   * undefined for resolved-nonlinear items: adapters must navigate to the
   * section directly and must not treat the activation as a linear
   * Previous/Next step.
   */
  onTocNavigate?(
    location: ReaderBookLocation,
    item: ReaderTocDisplayItem,
  ): void | boolean | Promise<boolean>;
  /**
   * An unresolved TOC item was activated. The chrome only shows brief
   * recoverable feedback; the navigation callback is never invoked and the
   * current location never changes for these items.
   */
  onTocRecoverable?(itemId: string): void;
  children?: ReactNode;
};

export function ReaderChrome({
  style,
  testID,
  state,
  model,
  currentIndex,
  canGoPrevious = null,
  canGoNext = null,
  navigationPending = false,
  sessionIdentity,
  navigationError,
  publicationLayout = 'reflowable',
  readingFlow = 'scrolled',
  flowControlAvailable = true,
  onReadingFlowChange,
  onPrevious,
  onNext,
  onNavigate,
  toc,
  onTocNavigate,
  onTocRecoverable,
  children,
}: ReaderChromeProps) {
  const total = model?.spine.length ?? 0;
  const previousDisabled = navigationPending || canGoPrevious !== true;
  const nextDisabled = navigationPending || canGoNext !== true;
  const previousLabel = 'Previous page';
  const nextLabel = 'Next page';
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(320);
  const [chromeHeight, setChromeHeight] = useState(184);
  const compact = width < 680;
  const [layer, setLayer] = useState<ReaderOverlayLayer>('closed');
  const tocExpanded = layer !== 'closed';
  const background = useRef<View>(null);
  const dialog = useRef<View>(null);
  const modalTitle = useRef<Text>(null);
  const [modalSize, setModalSize] = useState({ width: 0, height: 320 });
  const modalShown = useRef(false);
  const previousLayer = useRef<ReaderOverlayLayer>('closed');
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const opener = useRef<View>(null);
  const settingsOpener = useRef<View>(null);
  const root = useRef<View>(null);
  const identityRef = useRef(sessionIdentity);
  identityRef.current = sessionIdentity;
  const [tocPending, setTocPending] = useState(false);
  const dismiss = useCallback(
    () => setLayer((value) => (value === 'settings' ? 'drawer' : 'closed')),
    [],
  );
  const restore = useCallback((previousLayer: ReaderOverlayLayer) => {
    // Settings has a newly mounted opener in the returning drawer.
    queueMicrotask(() => {
      const target =
        previousLayer === 'settings' ? settingsOpener.current : opener.current;
      const node = (target ?? root.current) as unknown as {
        focus?(): void;
      } | null;
      node?.focus?.();
    });
  }, []);
  useReaderOverlay({
    layer,
    background,
    dialog,
    dismiss,
    restore,
  });
  const focusAccessibility = (target: View | Text | null) => {
    const handle = target ? findNodeHandle(target) : null;
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  };
  const onModalShow = () => {
    if (layerRef.current === 'closed') return;
    modalShown.current = true;
    if (width > 0 && modalSize.width > 0)
      focusAccessibility(modalTitle.current);
  };
  const onModalDismiss = () => {
    if (layerRef.current === 'closed')
      focusAccessibility(opener.current ?? root.current);
  };
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const previous = previousLayer.current;
    previousLayer.current = layer;
    if (layer === 'closed') modalShown.current = false;
    // iOS restores after onDismiss; Android removes its Dialog synchronously.
    const shouldRestore =
      layer === 'closed' && previous !== 'closed' && Platform.OS !== 'ios';
    const shouldFocusLayer =
      layer !== 'closed' &&
      modalShown.current &&
      width > 0 &&
      modalSize.width > 0;
    if (!shouldRestore && !shouldFocusLayer) return;
    const timer = setTimeout(() => {
      if (layerRef.current !== layer) return;
      focusAccessibility(
        shouldRestore
          ? (opener.current ?? root.current)
          : previous === 'settings' && layer === 'drawer'
            ? settingsOpener.current
            : modalTitle.current,
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [layer, sessionIdentity, width, modalSize.width, modalSize.height]);
  const overlayWidth =
    Platform.OS === 'web' ? width : Math.min(width, modalSize.width);
  const overlayHeight = Platform.OS === 'web' ? height : modalSize.height;
  const [focusedControl, setFocusedControl] = useState<string>();
  // Unresolved TOC 激活的可恢复反馈；下一次成功导航激活时清除。
  const [tocFeedback, setTocFeedback] = useState<string>();
  useEffect(() => {
    setLayer('closed');
    setTocFeedback(undefined);
    setTocPending(false);
  }, [state.status, sessionIdentity]);
  const confirmNavigation = async (
    navigate: () => void | boolean | Promise<boolean>,
  ) => {
    const identity = identityRef.current;
    setTocPending(true);
    try {
      const success = await navigate();
      if (identityRef.current !== identity) return;
      if (success === true) {
        setLayer('closed');
        setTocFeedback(undefined);
      } else if (success === false) setTocFeedback(TOC_UNAVAILABLE_FEEDBACK);
    } catch {
      if (identityRef.current === identity)
        setTocFeedback(TOC_UNAVAILABLE_FEEDBACK);
    } finally {
      if (identityRef.current === identity) setTocPending(false);
    }
  };
  const activateNeutralToc = (item: ReaderTocDisplayItem) => {
    if (item.resolution === 'unresolved' || !item.location) {
      // 只给可恢复反馈：绝不调用 navigation callback，也绝不改变当前位置。
      setTocFeedback(TOC_UNAVAILABLE_FEEDBACK);
      onTocRecoverable?.(item.id);
      return;
    }
    setTocFeedback(undefined);
    void confirmNavigation(() => onTocNavigate?.(item.location!, item));
  };
  return (
    <View
      ref={root}
      tabIndex={-1}
      onLayout={(event) => {
        setWidth(event.nativeEvent.layout.width);
        setHeight(event.nativeEvent.layout.height);
      }}
      style={[
        {
          ...styles.root,
          minHeight:
            state.status === 'ready' ? Math.max(320, 240 + chromeHeight) : 320,
        },
        style,
      ]}
      testID={testID}
    >
      <View
        ref={background}
        style={{ flex: 1 }}
        pointerEvents={tocExpanded ? 'none' : 'auto'}
        accessibilityElementsHidden={
          Platform.OS === 'web' ? undefined : tocExpanded
        }
        importantForAccessibility={
          Platform.OS === 'web'
            ? undefined
            : tocExpanded
              ? 'no-hide-descendants'
              : 'auto'
        }
      >
        {state.status === 'idle' ? (
          <Text accessibilityRole="text">Select a local EPUB to begin.</Text>
        ) : null}
        {state.status === 'loading' ? (
          <Text accessibilityRole="text">Loading EPUB...</Text>
        ) : null}
        {state.status === 'error' ? (
          <View accessibilityRole="alert">
            <Text>{state.error.message}</Text>
            <Text>{state.error.code}</Text>
          </View>
        ) : null}
        {state.status === 'ready' ? (
          <View
            onLayout={(event) =>
              setChromeHeight(event.nativeEvent.layout.height)
            }
            style={styles.chrome}
          >
            <View style={[styles.toolbar, compact && styles.toolbarCompact]}>
              {
                <View
                  style={[styles.heading, compact && styles.headingCompact]}
                >
                  <Pressable
                    ref={opener}
                    accessibilityLabel="Toggle table of contents"
                    accessibilityRole="button"
                    accessibilityState={{ expanded: tocExpanded }}
                    aria-expanded={tocExpanded}
                    {...(Platform.OS === 'web'
                      ? { title: 'Table of contents' }
                      : {})}
                    onPress={() => setLayer('drawer')}
                    style={styles.chapterButton}
                  >
                    <Text style={styles.chapterArrow}>☰</Text>
                  </Pressable>
                  {model?.title ? (
                    <Text
                      accessibilityLabel={model.title}
                      accessibilityRole="header"
                      ellipsizeMode="tail"
                      numberOfLines={1}
                      style={styles.title}
                    >
                      {model.title}
                    </Text>
                  ) : null}
                </View>
              }
              <View
                style={[styles.navigation, compact && styles.navigationCompact]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={previousLabel}
                  accessibilityState={{ disabled: previousDisabled }}
                  disabled={previousDisabled}
                  {...(Platform.OS === 'web' ? { title: previousLabel } : {})}
                  onBlur={() => setFocusedControl(undefined)}
                  onFocus={() => setFocusedControl('previous')}
                  onPress={onPrevious}
                  style={({ pressed }) => [
                    styles.chapterButton,
                    pressed && styles.buttonPressed,
                    previousDisabled && styles.buttonDisabled,
                    focusedControl === 'previous' && styles.buttonFocused,
                  ]}
                >
                  <Text style={styles.chapterArrow}>←</Text>
                </Pressable>
                <Text
                  accessibilityLabel="Chapter position"
                  accessibilityLiveRegion="polite"
                  style={styles.position}
                >
                  Chapter {currentIndex + 1} of {total}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={nextLabel}
                  accessibilityState={{ disabled: nextDisabled }}
                  disabled={nextDisabled}
                  {...(Platform.OS === 'web' ? { title: nextLabel } : {})}
                  onBlur={() => setFocusedControl(undefined)}
                  onFocus={() => setFocusedControl('next')}
                  onPress={onNext}
                  style={({ pressed }) => [
                    styles.chapterButton,
                    pressed && styles.buttonPressed,
                    nextDisabled && styles.buttonDisabled,
                    focusedControl === 'next' && styles.buttonFocused,
                  ]}
                >
                  <Text style={styles.chapterArrow}>→</Text>
                </Pressable>
              </View>
              <Text
                accessibilityLabel="Page navigation status"
                accessibilityLiveRegion="polite"
                numberOfLines={1}
                style={styles.pageStatus}
              >
                {navigationPending
                  ? 'Navigation in progress'
                  : canGoPrevious === null || canGoNext === null
                    ? 'Page navigation temporarily unavailable'
                    : ''}
              </Text>
            </View>
            {navigationError ? (
              <Text accessibilityRole="alert">{navigationError.message}</Text>
            ) : null}
          </View>
        ) : null}
        {state.status === 'loading' || state.status === 'ready' ? (
          <View style={styles.viewport}>{children}</View>
        ) : null}
      </View>
      <ReaderOverlaySurface
        visible={state.status === 'ready' && tocExpanded}
        onShow={onModalShow}
        onDismiss={onModalDismiss}
        onRequestClose={dismiss}
      >
        {state.status === 'ready' && tocExpanded ? (
          <View
            style={styles.overlay}
            onLayout={
              Platform.OS === 'web'
                ? undefined
                : (event) => {
                    if (layerRef.current === 'closed') return;
                    const { width, height } = event.nativeEvent.layout;
                    setModalSize({ width, height });
                  }
            }
          >
            <Pressable
              accessibilityLabel="Dismiss reader dialog"
              onPress={dismiss}
              style={styles.backdrop}
              accessible={false}
              tabIndex={-1}
            />
            <View
              ref={dialog}
              role={Platform.OS === 'web' ? 'dialog' : undefined}
              aria-modal={true}
              accessibilityViewIsModal={true}
              onAccessibilityEscape={dismiss}
              accessibilityLabel={
                layer === 'drawer' ? 'Reader contents' : 'Reader settings'
              }
              tabIndex={-1}
              style={[
                styles.dialog,
                layer === 'drawer' ? styles.drawer : styles.settings,
                {
                  width: Math.max(
                    0,
                    Math.min(layer === 'drawer' ? 320 : 360, overlayWidth - 32),
                  ),
                },
                layer === 'settings' && {
                  maxHeight: Math.max(0, overlayHeight - 32),
                },
              ]}
            >
              <View style={styles.dialogHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    layer === 'drawer'
                      ? 'Close table of contents'
                      : 'Close reader settings'
                  }
                  {...(Platform.OS === 'web' ? { title: 'Close' } : {})}
                  onPress={dismiss}
                  style={styles.chapterButton}
                >
                  <Text style={styles.chapterArrow}>×</Text>
                </Pressable>
                <Text
                  ref={modalTitle}
                  accessible
                  accessibilityRole="header"
                  style={styles.title}
                >
                  {layer === 'drawer' ? 'Contents' : 'Settings'}
                </Text>
                {layer === 'drawer' ? (
                  <Pressable
                    ref={settingsOpener}
                    accessibilityRole="button"
                    accessibilityLabel="Reader settings"
                    {...(Platform.OS === 'web'
                      ? { title: 'Reader settings' }
                      : {})}
                    onPress={() => setLayer('settings')}
                    style={styles.chapterButton}
                  >
                    <Text style={styles.chapterArrow}>⚙</Text>
                  </Pressable>
                ) : null}
              </View>
              {layer === 'settings' ? (
                <ScrollView
                  style={{ flexShrink: 1 }}
                  contentContainerStyle={{ padding: 16, gap: 12 }}
                >
                  {publicationLayout === 'fixed' ? (
                    // 固定版式（CBZ）不提供 reflow flow 切换：明确告知而不是渲染一个
                    // 看似可用、实则无效的控件。
                    <Text
                      accessibilityLabel="Fixed-layout publication"
                      style={styles.fixedLayoutNotice}
                    >
                      Fixed layout
                    </Text>
                  ) : flowControlAvailable ? (
                    <View
                      accessibilityLabel="Reading flow"
                      style={styles.flowGroup}
                    >
                      {READING_FLOW_OPTIONS.map((option) => {
                        const selected = readingFlow === option.flow;
                        const disabled =
                          !onReadingFlowChange || navigationPending;
                        return (
                          <Pressable
                            accessibilityLabel={`${option.label} reading flow`}
                            accessibilityRole="button"
                            accessibilityState={{ disabled, selected }}
                            disabled={disabled}
                            key={option.flow}
                            onPress={() => onReadingFlowChange?.(option.flow)}
                            onBlur={() => setFocusedControl(undefined)}
                            onFocus={() => {
                              setFocusedControl(option.flow);
                            }}
                            style={({ pressed }) => [
                              styles.flowOption,
                              selected && styles.flowOptionSelected,
                              disabled && styles.flowOptionDisabled,
                              pressed && styles.buttonPressed,
                              focusedControl === option.flow &&
                                styles.buttonFocused,
                            ]}
                          >
                            <Text
                              style={[
                                styles.flowOptionText,
                                selected && styles.flowOptionTextSelected,
                              ]}
                            >
                              {option.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    // 引擎不能应用 flow 变更时，渲染非交互的如实状态行：
                    // 显示引擎真实渲染的 flow，绝不显示"选中但未生效"的选择器。
                    <Text
                      accessibilityLabel="Reading flow status"
                      style={styles.flowStatus}
                    >
                      {readingFlow === 'scrolled'
                        ? "Scrolling mode — flow switching isn't available in this version"
                        : "Paged mode — flow switching isn't available in this version"}
                    </Text>
                  )}
                </ScrollView>
              ) : (
                <>
                  {toc ? (
                    // 中立 displayToc 路径：不依赖任何 archiveKey/href/CFI 身份。
                    // 目录必须是 ScrollView：RN Web 的普通 View 默认 overflow:visible，
                    // 长目录会溢出 maxHeight 并直接叠画在下方 iframe 正文上。
                    toc.length ? (
                      <ScrollView
                        accessibilityLabel="Table of contents"
                        contentContainerStyle={styles.tocContent}
                        style={styles.toc}
                      >
                        <Text accessibilityRole="header">
                          Table of contents
                        </Text>
                        {toc.map((item) => {
                          const unresolved = item.resolution === 'unresolved';
                          const nonlinear =
                            item.resolution === 'resolved-nonlinear';
                          return (
                            <Pressable
                              accessibilityLabel={
                                unresolved
                                  ? `${item.label}, location unavailable`
                                  : nonlinear
                                    ? `${item.label}, non-linear section`
                                    : item.label
                              }
                              accessibilityRole="button"
                              disabled={tocPending || navigationPending}
                              accessibilityState={{
                                disabled: tocPending || navigationPending,
                              }}
                              key={item.id}
                              onPress={() => activateNeutralToc(item)}
                              style={{
                                paddingLeft: item.depth * 12,
                                minHeight: 44,
                                justifyContent: 'center',
                              }}
                            >
                              <Text
                                style={[
                                  styles.tocItemText,
                                  unresolved && styles.tocItemUnavailable,
                                ]}
                              >
                                {item.label}
                                {nonlinear ? (
                                  <Text style={styles.tocItemHint}>
                                    {' '}
                                    · Non-linear
                                  </Text>
                                ) : null}
                                {unresolved ? (
                                  <Text style={styles.tocItemHint}>
                                    {' '}
                                    · Unavailable
                                  </Text>
                                ) : null}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    ) : null
                  ) : model?.toc.length ? (
                    // 旧 EPUB-shaped 路径：保留到 Web/native 旧适配器迁入中立模型。
                    <ScrollView
                      accessibilityLabel="Table of contents"
                      contentContainerStyle={styles.tocContent}
                      style={styles.toc}
                    >
                      <Text accessibilityRole="header">Table of contents</Text>
                      {model.toc.map((item) => (
                        <Pressable
                          accessibilityRole="button"
                          key={item.id}
                          disabled={tocPending || navigationPending}
                          accessibilityState={{
                            disabled: tocPending || navigationPending,
                          }}
                          onPress={() => {
                            void confirmNavigation(() => onNavigate(item));
                          }}
                          style={{
                            paddingLeft: item.depth * 12,
                            minHeight: 44,
                            justifyContent: 'center',
                          }}
                        >
                          <Text style={styles.tocItemText}>{item.label}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : null}
                  {tocFeedback ? (
                    <Text
                      accessibilityLabel="Table of contents feedback"
                      accessibilityLiveRegion="polite"
                      style={styles.tocFeedback}
                    >
                      {tocFeedback}
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          </View>
        ) : null}
      </ReaderOverlaySurface>
    </View>
  );
}

function ReaderOverlaySurface({
  visible,
  children,
  onShow,
  onDismiss,
  onRequestClose,
}: {
  visible: boolean;
  children: ReactNode;
  onShow(): void;
  onDismiss(): void;
  onRequestClose(): void;
}) {
  if (Platform.OS === 'web') return children;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      onShow={onShow}
      onDismiss={onDismiss}
      onRequestClose={onRequestClose}
    >
      {children}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 320, minWidth: 0, backgroundColor: '#ffffff' },
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    zIndex: 10,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 22, 18, 0.4)',
  },
  dialog: { backgroundColor: '#ffffff', minWidth: 0, overflow: 'hidden' },
  drawer: {
    height: '100%',
    alignSelf: 'flex-start',
    borderRightWidth: 1,
    borderRightColor: '#e2e5e3',
  },
  settings: { alignSelf: 'center', borderRadius: 8 },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e5e3',
  },
  chrome: { flexShrink: 0 },
  pageStatus: {
    position: 'absolute',
    bottom: 0,
    left: 12,
    right: 12,
    fontSize: 12,
    lineHeight: 12,
    color: '#52645a',
  },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 12,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e5e3',
    backgroundColor: '#f7f9f8',
  },
  toolbarCompact: { alignItems: 'stretch', flexDirection: 'column', gap: 8 },
  heading: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headingCompact: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    minHeight: 44,
    width: '100%',
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '600',
    color: '#202923',
  },
  contentsButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  contentsText: { color: '#365d49', fontSize: 14, fontWeight: '600' },
  navigation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  navigationCompact: { justifyContent: 'space-between' },
  chapterButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  chapterArrow: { color: '#263f32', fontSize: 22 },
  position: {
    fontSize: 14,
    color: '#526057',
    flexShrink: 1,
    textAlign: 'center',
  },
  buttonDisabled: { opacity: 0.35 },
  buttonPressed: { backgroundColor: '#d5e3da' },
  buttonFocused: { borderColor: '#28734c' },
  fixedLayoutNotice: { color: '#526057', fontSize: 14, flexShrink: 1 },
  flowGroup: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    padding: 3,
    borderRadius: 6,
    backgroundColor: '#e8edea',
    flexShrink: 0,
  },
  flowOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderColor: 'transparent',
    borderRadius: 4,
    borderWidth: 2,
    paddingHorizontal: 12,
  },
  flowOptionDisabled: { opacity: 0.4 },
  flowOptionSelected: { backgroundColor: '#ffffff' },
  flowOptionText: { color: '#526057', fontSize: 14 },
  flowOptionTextSelected: {
    color: '#245b3d',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  flowStatus: { color: '#526057', fontSize: 14, flexShrink: 1 },
  // The drawer header stays fixed while its contents consume the remaining height.
  toc: {
    flexGrow: 1,
    flexShrink: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e5e3',
    backgroundColor: '#f7f9f8',
  },
  tocContent: { gap: 4, padding: 12 },
  tocItemText: { color: '#263f32', fontSize: 14, paddingVertical: 8 },
  tocFeedback: {
    opacity: 0.7,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tocItemHint: { fontSize: 12, opacity: 0.6 },
  tocItemUnavailable: { opacity: 0.55 },
  viewport: { flex: 1, flexShrink: 0, minHeight: 240 },
});
