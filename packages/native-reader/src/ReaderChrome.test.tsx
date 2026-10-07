import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ReaderChrome } from './ReaderChrome';
import type { ReaderBookLocation, ReaderTocDisplayItem } from './bookModel';
import type { ReaderPublicationModel, ReaderTocItem } from './shared';
import type { ReaderLoadState, ReaderReadingFlow } from './types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// 与 NativeReader.web.test.tsx 相同的轻量 react-native mock：host 组件以
// 字符串渲染，accessibility props 原样透传，测试只走公开可访问性表面。
jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
}));

const readyState: ReaderLoadState = { status: 'ready' };

const tocEntry: ReaderTocItem = {
  id: 'toc-2',
  href: 'chapter-2.xhtml',
  archiveKey: 'chapter-2.xhtml',
  targetEngineIndex: 1,
  targetHref: 'chapter-2.xhtml',
  label: 'Second chapter',
  depth: 1,
};

const model: ReaderPublicationModel = {
  title: 'Fixture title',
  spine: [
    {
      id: 'spine-0',
      idref: 'chapter-1',
      href: 'chapter-1.xhtml',
      archiveKey: 'chapter-1.xhtml',
      label: 'First chapter',
      engineIndex: 0,
    },
    {
      id: 'spine-1',
      idref: 'chapter-2',
      href: 'chapter-2.xhtml',
      archiveKey: 'chapter-2.xhtml',
      label: 'Second chapter',
      engineIndex: 1,
    },
    {
      id: 'spine-2',
      idref: 'chapter-3',
      href: 'chapter-3.xhtml',
      archiveKey: 'chapter-3.xhtml',
      label: 'Third chapter',
      engineIndex: 2,
    },
  ],
  toc: [tocEntry],
};

let renderer: ReactTestRenderer | undefined;

type ChromeOptions = {
  currentIndex?: number;
  flowControlAvailable?: boolean;
  onNavigate?: (item: ReaderTocItem) => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onReadingFlowChange?: (flow: ReaderReadingFlow) => void;
  onTocNavigate?: (
    location: ReaderBookLocation,
    item: ReaderTocDisplayItem,
  ) => void;
  onTocRecoverable?: (itemId: string) => void;
  publicationLayout?: 'reflowable' | 'fixed';
  readingFlow?: ReaderReadingFlow;
  state?: ReaderLoadState;
  style?: object;
  testID?: string;
  toc?: readonly ReaderTocDisplayItem[];
};

function chromeElement(options: ChromeOptions) {
  return (
    <ReaderChrome
      currentIndex={options.currentIndex ?? 1}
      model={model}
      onNavigate={options.onNavigate ?? (() => undefined)}
      onNext={options.onNext ?? (() => undefined)}
      onPrevious={options.onPrevious ?? (() => undefined)}
      {...(options.flowControlAvailable !== undefined
        ? { flowControlAvailable: options.flowControlAvailable }
        : {})}
      {...(options.onReadingFlowChange
        ? { onReadingFlowChange: options.onReadingFlowChange }
        : {})}
      {...(options.onTocNavigate
        ? { onTocNavigate: options.onTocNavigate }
        : {})}
      {...(options.onTocRecoverable
        ? { onTocRecoverable: options.onTocRecoverable }
        : {})}
      {...(options.publicationLayout
        ? { publicationLayout: options.publicationLayout }
        : {})}
      {...(options.readingFlow ? { readingFlow: options.readingFlow } : {})}
      state={options.state ?? readyState}
      {...(options.style ? { style: options.style } : {})}
      {...(options.testID ? { testID: options.testID } : {})}
      {...(options.toc ? { toc: options.toc } : {})}
    />
  );
}

function renderChrome(options: ChromeOptions = {}) {
  act(() => {
    renderer = create(chromeElement(options));
  });
  return renderer!;
}

function updateChrome(options: ChromeOptions = {}) {
  act(() => {
    renderer!.update(chromeElement(options));
  });
}

function findByLabel(label: string) {
  return renderer!.root.findAllByProps({ accessibilityLabel: label });
}

function textContent(node: { children: Array<string | object> }): string {
  return node.children.filter((child) => typeof child === 'string').join('');
}

async function pressText(label: string) {
  const text = renderer!.root
    .findAll((node) => textContent(node) === label)
    .find((node) => node.parent?.props.accessibilityRole === 'button');
  expect(text?.parent?.type).toBe('Pressable');
  await act(async () => {
    await text?.parent?.props.onPress();
  });
}

// 中立 TOC 条目通过公开 accessibility label 发现并激活（label 可能带
// non-linear/unavailable 后缀，故不走可见文本匹配）。
async function pressAccessibilityLabel(label: string) {
  const control = findByLabel(label)[0];
  expect(control?.props.accessibilityRole).toBe('button');
  await act(async () => {
    await control?.props.onPress();
  });
}

afterEach(() => {
  if (renderer) act(() => renderer?.unmount());
  renderer = undefined;
});

test('renders the reflow flow selector with scrolled selected by default', () => {
  renderChrome({ onReadingFlowChange: () => undefined });

  expect(findByLabel('Reading flow')).toHaveLength(1);
  const scrolled = findByLabel('Scrolled reading flow');
  const paginated = findByLabel('Paginated reading flow');
  expect(scrolled).toHaveLength(1);
  expect(paginated).toHaveLength(1);
  expect(scrolled[0]?.props.accessibilityState).toEqual({
    disabled: false,
    selected: true,
  });
  expect(paginated[0]?.props.accessibilityState).toEqual({
    disabled: false,
    selected: false,
  });
});

test('reports the user flow pick and follows the controlled readingFlow prop', async () => {
  const onReadingFlowChange = jest.fn();
  renderChrome({ onReadingFlowChange });

  await pressText('Paginated');
  expect(onReadingFlowChange).toHaveBeenCalledTimes(1);
  expect(onReadingFlowChange).toHaveBeenCalledWith('paginated');
  // Chrome 是受控展示：host 未更新 readingFlow 前选中态不变。
  expect(
    findByLabel('Paginated reading flow')[0]?.props.accessibilityState.selected,
  ).toBe(false);

  updateChrome({ onReadingFlowChange, readingFlow: 'paginated' });
  expect(
    findByLabel('Paginated reading flow')[0]?.props.accessibilityState.selected,
  ).toBe(true);
  expect(
    findByLabel('Scrolled reading flow')[0]?.props.accessibilityState.selected,
  ).toBe(false);

  await pressText('Scrolled');
  expect(onReadingFlowChange).toHaveBeenLastCalledWith('scrolled');
});

test('replaces the selector with a fixed-layout notice for fixed-layout publications', () => {
  renderChrome({
    onReadingFlowChange: () => undefined,
    publicationLayout: 'fixed',
  });

  expect(findByLabel('Reading flow')).toHaveLength(0);
  expect(findByLabel('Scrolled reading flow')).toHaveLength(0);
  expect(findByLabel('Paginated reading flow')).toHaveLength(0);
  expect(findByLabel('Fixed-layout publication')).toHaveLength(1);
});

test('disables the flow selector when no onReadingFlowChange callback exists', () => {
  renderChrome();

  for (const label of ['Scrolled reading flow', 'Paginated reading flow']) {
    const button = findByLabel(label)[0];
    expect(button?.props.disabled).toBe(true);
    expect(button?.props.accessibilityState.disabled).toBe(true);
  }
});

test('hides flow controls outside the ready state', () => {
  renderChrome({
    onReadingFlowChange: () => undefined,
    state: { status: 'loading' },
  });

  expect(findByLabel('Reading flow')).toHaveLength(0);
  expect(findByLabel('Reading flow status')).toHaveLength(0);
  expect(findByLabel('Fixed-layout publication')).toHaveLength(0);
});

test('shows a truthful non-interactive status when the engine cannot apply flow changes', () => {
  // 旧引擎路径：渲染 flow 固定 paginated，UI 必须如实呈现且无可操作控件。
  renderChrome({ flowControlAvailable: false, readingFlow: 'paginated' });

  expect(findByLabel('Reading flow')).toHaveLength(0);
  expect(findByLabel('Scrolled reading flow')).toHaveLength(0);
  expect(findByLabel('Paginated reading flow')).toHaveLength(0);
  const status = findByLabel('Reading flow status');
  expect(status).toHaveLength(1);
  // 状态行是纯文本，不是按钮，也不携带任何 selected 状态。
  expect(status[0]?.props.accessibilityRole).not.toBe('button');
  expect(status[0]?.props.accessibilityState?.selected).toBeUndefined();
  expect(status[0]?.props.disabled).toBeUndefined();
  const copy = textContent(status[0] as never);
  expect(copy).toContain('Paged mode');
  expect(copy).toContain("isn't available");
  // 绝不能暗示 scrolled 已生效。
  expect(copy).not.toContain('Scrolling');
});

test('reports a scrolled actual flow truthfully when switching is unavailable', () => {
  renderChrome({ flowControlAvailable: false, readingFlow: 'scrolled' });

  const status = findByLabel('Reading flow status');
  expect(status).toHaveLength(1);
  expect(textContent(status[0] as never)).toContain('Scrolling mode');
  expect(findByLabel('Scrolled reading flow')).toHaveLength(0);
});

test('fixed layout still replaces every flow affordance when control is unavailable', () => {
  renderChrome({
    flowControlAvailable: false,
    publicationLayout: 'fixed',
    readingFlow: 'paginated',
  });

  expect(findByLabel('Fixed-layout publication')).toHaveLength(1);
  expect(findByLabel('Reading flow')).toHaveLength(0);
  expect(findByLabel('Reading flow status')).toHaveLength(0);
});

test('exposes non-wrapping boundary states on the navigation controls', () => {
  renderChrome({ currentIndex: 0 });
  expect(findByLabel('Previous chapter')[0]?.props.disabled).toBe(true);
  expect(
    findByLabel('Previous chapter')[0]?.props.accessibilityState.disabled,
  ).toBe(true);
  expect(findByLabel('Next chapter')[0]?.props.disabled).toBe(false);
  expect(
    findByLabel('Next chapter')[0]?.props.accessibilityState.disabled,
  ).toBe(false);

  updateChrome({ currentIndex: model.spine.length - 1 });
  expect(findByLabel('Previous chapter')[0]?.props.disabled).toBe(false);
  expect(findByLabel('Next chapter')[0]?.props.disabled).toBe(true);
  expect(
    findByLabel('Next chapter')[0]?.props.accessibilityState.disabled,
  ).toBe(true);
});

test('announces the current position through a polite live region', () => {
  renderChrome({ currentIndex: 1 });

  const position = findByLabel('Chapter position')[0];
  expect(position).toBeDefined();
  expect(textContent(position as never)).toBe('Chapter 2 of 3');
  expect(position?.props.accessibilityLiveRegion).toBe('polite');
});

test('navigates through TOC entries via their visible labels', async () => {
  const onNavigate = jest.fn();
  renderChrome({ onNavigate });

  await pressText('Second chapter');
  expect(onNavigate).toHaveBeenCalledTimes(1);
  expect(onNavigate).toHaveBeenCalledWith(tocEntry);
});

// 中立 displayToc fixture：只含格式中立字段（id/label/depth/resolution/
// location），不含任何 archiveKey/href/CFI。身份形态分别仿 EPUB 字符串、
// CBZ 页项与 FB2/MOBI 的数字 id——渲染不得受身份形态影响。
const neutralLinear: ReaderTocDisplayItem = {
  depth: 0,
  disabled: false,
  id: 'toc-chapter-one',
  label: 'Chapter One',
  location: { sectionId: 'ch1', sectionIndex: 0, linearIndex: 0 },
  recoverable: false,
  resolution: 'resolved-linear',
};
const neutralCbzPage: ReaderTocDisplayItem = {
  depth: 0,
  disabled: false,
  id: 'page-12',
  label: 'Page 12',
  location: { sectionId: 'page-12', sectionIndex: 11, linearIndex: 11 },
  recoverable: false,
  resolution: 'resolved-linear',
};
const neutralNumeric: ReaderTocDisplayItem = {
  depth: 1,
  disabled: false,
  id: '0',
  label: '1. Introduction',
  location: { sectionId: '0', sectionIndex: 1, linearIndex: 1 },
  recoverable: false,
  resolution: 'resolved-linear',
};
const neutralNonlinear: ReaderTocDisplayItem = {
  depth: 0,
  disabled: false,
  id: 'toc-appendix',
  label: 'Appendix',
  // non-linear section：有位置但没有 linearIndex，不是 Prev/Next 序列的一步。
  location: { sectionId: 'appendix', sectionIndex: 4 },
  recoverable: false,
  resolution: 'resolved-nonlinear',
};
const neutralUnresolved: ReaderTocDisplayItem = {
  depth: 0,
  disabled: true,
  id: 'toc-ghost',
  label: 'Ghost chapter',
  recoverable: true,
  resolution: 'unresolved',
};

test('renders the neutral displayToc without EPUB archive identity', () => {
  // EPUB 字符串 id、CBZ 页项、FB2/MOBI 数字 id 都应同样渲染，且 depth 缩进。
  renderChrome({
    toc: [neutralLinear, neutralCbzPage, neutralNumeric],
  });

  expect(findByLabel('Table of contents')).toHaveLength(1);
  for (const item of [neutralLinear, neutralCbzPage, neutralNumeric]) {
    const control = findByLabel(item.label)[0];
    expect(control?.props.accessibilityRole).toBe('button');
    expect(control?.props.style).toEqual({
      paddingLeft: item.depth * 12,
    });
  }
  // 中立路径取代旧 model.toc 渲染，旧条目不再出现。
  expect(findByLabel('Second chapter')).toHaveLength(0);
});

test('renders no TOC surface when the neutral projection is empty', () => {
  renderChrome({ toc: [] });

  expect(findByLabel('Table of contents')).toHaveLength(0);
  // 空中立投影优先于旧 model.toc：不回退渲染旧条目。
  expect(findByLabel('Second chapter')).toHaveLength(0);
});

test('submits navigation for resolved-linear neutral items through the public callback', async () => {
  const onTocNavigate = jest.fn();
  const onTocRecoverable = jest.fn();
  const onNavigate = jest.fn();
  renderChrome({
    onNavigate,
    onTocNavigate,
    onTocRecoverable,
    toc: [neutralLinear],
  });

  await pressAccessibilityLabel('Chapter One');
  expect(onTocNavigate).toHaveBeenCalledTimes(1);
  expect(onTocNavigate).toHaveBeenCalledWith(
    neutralLinear.location,
    neutralLinear,
  );
  expect(onTocRecoverable).not.toHaveBeenCalled();
  expect(onNavigate).not.toHaveBeenCalled();
  // 当前位置只能由适配器回报，激活本身不改动它。
  expect(textContent(findByLabel('Chapter position')[0] as never)).toBe(
    'Chapter 2 of 3',
  );
  expect(findByLabel('Table of contents feedback')).toHaveLength(0);
});

test('presents resolved-nonlinear items distinctly without pretending linear navigation', async () => {
  const onTocNavigate = jest.fn();
  const onNext = jest.fn();
  const onPrevious = jest.fn();
  renderChrome({
    onNext,
    onPrevious,
    onTocNavigate,
    toc: [neutralNonlinear],
  });

  // 明确呈现：可访问 label 与可见提示都标明 non-linear。
  const control = findByLabel('Appendix, non-linear section');
  expect(control).toHaveLength(1);
  expect(
    renderer!.root.findAll((node) => textContent(node) === ' · Non-linear'),
  ).toHaveLength(1);

  await pressAccessibilityLabel('Appendix, non-linear section');
  // 导航 callback 收到 location，但 linearIndex 为 undefined：绝不假作
  // Prev/Next 的线性步进，也不触碰线性导航控件。
  expect(onTocNavigate).toHaveBeenCalledTimes(1);
  expect(onTocNavigate).toHaveBeenCalledWith(
    neutralNonlinear.location,
    neutralNonlinear,
  );
  expect(neutralNonlinear.location?.linearIndex).toBeUndefined();
  expect(onNext).not.toHaveBeenCalled();
  expect(onPrevious).not.toHaveBeenCalled();
  expect(textContent(findByLabel('Chapter position')[0] as never)).toBe(
    'Chapter 2 of 3',
  );
});

test('unresolved items only show recoverable feedback and never navigate', async () => {
  const onTocNavigate = jest.fn();
  const onTocRecoverable = jest.fn();
  renderChrome({
    onTocNavigate,
    onTocRecoverable,
    toc: [neutralUnresolved, neutralLinear],
  });

  // Unresolved 仍是公开可访问控件（可激活），label 标明 unavailable。
  const control = findByLabel('Ghost chapter, location unavailable');
  expect(control).toHaveLength(1);
  expect(control[0]?.props.accessibilityRole).toBe('button');

  await pressAccessibilityLabel('Ghost chapter, location unavailable');
  expect(onTocRecoverable).toHaveBeenCalledTimes(1);
  expect(onTocRecoverable).toHaveBeenCalledWith('toc-ghost');
  // 绝不调用 navigation callback，绝不修改当前位置。
  expect(onTocNavigate).not.toHaveBeenCalled();
  expect(textContent(findByLabel('Chapter position')[0] as never)).toBe(
    'Chapter 2 of 3',
  );

  // 简洁的可恢复反馈，经 polite live region 播报。
  const feedback = findByLabel('Table of contents feedback');
  expect(feedback).toHaveLength(1);
  expect(textContent(feedback[0] as never)).toBe(
    "Location isn't available in this publication.",
  );
  expect(feedback[0]?.props.accessibilityLiveRegion).toBe('polite');

  // 可恢复：成功导航激活后反馈清除。
  await pressAccessibilityLabel('Chapter One');
  expect(onTocNavigate).toHaveBeenCalledTimes(1);
  expect(findByLabel('Table of contents feedback')).toHaveLength(0);
});

test('forwards host style and testID to the root surface', () => {
  renderChrome({ style: { marginTop: 12 }, testID: 'reader-root' });

  // findByProps 也会匹配 ReaderChrome 复合节点本身，这里锁定 host 根 View
  // （react-native 被 mock 成字符串，host 节点的 type 即 'View'）。
  const root = renderer!.root
    .findAllByProps({ testID: 'reader-root' })
    .find((node) => String(node.type) === 'View');
  expect(root?.props.style).toEqual([
    expect.objectContaining({ flex: 1 }),
    { marginTop: 12 },
  ]);
});
