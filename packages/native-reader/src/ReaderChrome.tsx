import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ReaderBookLocation, ReaderTocDisplayItem } from './bookModel';
import type { ReaderPublicationModel, ReaderTocItem } from './shared';
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
  onNavigate(item: ReaderTocItem): void;
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
  ): void;
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
  const previousDisabled = currentIndex <= 0;
  const nextDisabled = currentIndex < 0 || currentIndex >= total - 1;
  const previousLabel = 'Previous chapter';
  const nextLabel = 'Next chapter';
  // Unresolved TOC 激活的可恢复反馈；下一次成功导航激活时清除。
  const [tocFeedback, setTocFeedback] = useState<string>();
  const activateNeutralToc = (item: ReaderTocDisplayItem) => {
    if (item.resolution === 'unresolved' || !item.location) {
      // 只给可恢复反馈：绝不调用 navigation callback，也绝不改变当前位置。
      setTocFeedback(TOC_UNAVAILABLE_FEEDBACK);
      onTocRecoverable?.(item.id);
      return;
    }
    setTocFeedback(undefined);
    onTocNavigate?.(item.location, item);
  };
  return (
    <View style={[styles.root, style]} testID={testID}>
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
        <>
          {model?.title ? (
            <Text accessibilityRole="header">{model.title}</Text>
          ) : null}
          <View style={styles.toolbar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={previousLabel}
              accessibilityState={{ disabled: previousDisabled }}
              disabled={previousDisabled}
              onPress={onPrevious}
            >
              <Text>Previous</Text>
            </Pressable>
            <Text
              accessibilityLabel="Chapter position"
              accessibilityLiveRegion="polite"
            >
              Chapter {currentIndex + 1} of {total}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={nextLabel}
              accessibilityState={{ disabled: nextDisabled }}
              disabled={nextDisabled}
              onPress={onNext}
            >
              <Text>Next</Text>
            </Pressable>
          </View>
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
            <View accessibilityLabel="Reading flow" style={styles.flowGroup}>
              {READING_FLOW_OPTIONS.map((option) => {
                const selected = readingFlow === option.flow;
                const disabled = !onReadingFlowChange;
                return (
                  <Pressable
                    accessibilityLabel={`${option.label} reading flow`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled, selected }}
                    disabled={disabled}
                    key={option.flow}
                    onPress={() => onReadingFlowChange?.(option.flow)}
                    style={[
                      styles.flowOption,
                      selected && styles.flowOptionSelected,
                      disabled && styles.flowOptionDisabled,
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
                <Text accessibilityRole="header">Table of contents</Text>
                {toc.map((item) => {
                  const unresolved = item.resolution === 'unresolved';
                  const nonlinear = item.resolution === 'resolved-nonlinear';
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
                      key={item.id}
                      onPress={() => activateNeutralToc(item)}
                      style={{ paddingLeft: item.depth * 12 }}
                    >
                      <Text style={unresolved && styles.tocItemUnavailable}>
                        {item.label}
                        {nonlinear ? (
                          <Text style={styles.tocItemHint}> · Non-linear</Text>
                        ) : null}
                        {unresolved ? (
                          <Text style={styles.tocItemHint}> · Unavailable</Text>
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
                  onPress={() => onNavigate(item)}
                  style={{ paddingLeft: item.depth * 12 }}
                >
                  <Text>{item.label}</Text>
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
          {navigationError ? (
            <Text accessibilityRole="alert">{navigationError.message}</Text>
          ) : null}
        </>
      ) : null}
      {state.status === 'loading' || state.status === 'ready' ? (
        <View style={styles.viewport}>{children}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 320 },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 8,
  },
  fixedLayoutNotice: { opacity: 0.7, paddingHorizontal: 8, paddingVertical: 4 },
  flowGroup: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  flowOption: {
    borderColor: '#4d4d4d',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  flowOptionDisabled: { opacity: 0.4 },
  flowOptionSelected: { backgroundColor: '#4d4d4d' },
  flowOptionText: { color: '#4d4d4d', fontSize: 13 },
  flowOptionTextSelected: { color: '#ffffff', fontWeight: '600' },
  flowStatus: { opacity: 0.7, paddingHorizontal: 8, paddingVertical: 4 },
  // 目录容器限高 160，超出部分在 ScrollView 内滚动（ScrollView 自身裁剪溢出），
  // 正文 iframe 永远保有独立空间，不与目录条目叠压。
  // flexGrow:0/flexShrink:0：高度始终贴合内容（上限 160），既不因 RN Web
  // ScrollView 默认 flexGrow 被拉伸出空白，也不在紧凑高度下被压缩。
  toc: { flexGrow: 0, flexShrink: 0, maxHeight: 160 },
  tocContent: { gap: 4, padding: 8 },
  tocFeedback: {
    opacity: 0.7,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tocItemHint: { fontSize: 12, opacity: 0.6 },
  tocItemUnavailable: { opacity: 0.55 },
  viewport: { flex: 1, minHeight: 240 },
});
