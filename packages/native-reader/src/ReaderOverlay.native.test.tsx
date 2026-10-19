import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AccessibilityInfo, Platform } from 'react-native';
import { ReaderChrome } from './ReaderChrome';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  Modal: 'Modal',
  StyleSheet: { create: (styles: unknown) => styles },
  AccessibilityInfo: { setAccessibilityFocus: jest.fn() },
  findNodeHandle: (node: { handle: number }) => node.handle,
}));

let tree: ReactTestRenderer;
let mounts: number;
let handles: Map<string, number>;
function SecureReader() {
  useEffect(() => {
    mounts++;
  }, []);
  return <span />;
}
const element = (session = 'native-overlay') => (
  <ReaderChrome
    testID="reader"
    state={{ status: 'ready' }}
    sessionIdentity={session}
    currentIndex={0}
    toc={[]}
    readingFlow="scrolled"
    flowControlAvailable
    onReadingFlowChange={() => undefined}
    onNavigate={() => undefined}
    onPrevious={() => undefined}
    onNext={() => undefined}
  >
    <SecureReader />
  </ReaderChrome>
);
const control = (label: string) =>
  tree.root.findAll(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.props.accessibilityLabel === label,
  )[0]!;
const modal = () => tree.root.findByType('Modal' as never);
const dialog = () =>
  tree.root.findAll(
    (node) =>
      String(node.type) === 'View' && node.props.accessibilityViewIsModal,
  )[0];
const flush = () => act(() => jest.runOnlyPendingTimers());
const focused = () =>
  jest.mocked(AccessibilityInfo.setAccessibilityFocus).mock.calls.at(-1)?.[0];
const measure = () => {
  act(() =>
    tree.root
      .findAllByProps({ testID: 'reader' })
      .find((node) => String(node.type) === 'View')!
      .props.onLayout({
        nativeEvent: { layout: { width: 320, height: 640 } },
      }),
  );
  act(() =>
    modal()
      .findAll(
        (node) => String(node.type) === 'View' && node.props.onLayout,
      )[0]!
      .props.onLayout({
        nativeEvent: { layout: { width: 320, height: 640 } },
      }),
  );
};

beforeEach(() => {
  jest.useFakeTimers();
  Platform.OS = 'android';
  mounts = 0;
  handles = new Map();
  act(() => {
    tree = create(element(), {
      createNodeMock: (node) => {
        const props = node.props as {
          accessibilityLabel?: string;
          accessibilityRole?: string;
          children?: string;
        };
        const label =
          props.accessibilityLabel ??
          (props.accessibilityRole === 'header' ? props.children : undefined);
        const handle = handles.size + 1;
        if (label) handles.set(label, handle);
        return { handle };
      },
    });
  });
});
afterEach(() => {
  act(() => tree.unmount());
  jest.useRealTimers();
});

test('native Modal wires platform close and accessibility without a JS keyboard trap', () => {
  expect(modal().props.visible).toBe(false);
  act(() => control('Toggle table of contents').props.onPress());
  expect(modal().props).toMatchObject({
    visible: true,
    transparent: true,
    presentationStyle: 'overFullScreen',
  });
  expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled();
  measure();
  act(() => modal().props.onShow());
  const titleHandle = handles.get('Contents');
  expect(focused()).toBe(titleHandle);
  expect(dialog()!.props.onKeyDownCapture).toBeUndefined();
  const background = tree.root.findAll(
    (node) =>
      String(node.type) === 'View' &&
      node.props.importantForAccessibility === 'no-hide-descendants',
  )[0]!;
  expect(background.props).toMatchObject({
    accessibilityElementsHidden: true,
    pointerEvents: 'none',
  });
  expect(background.props.onFocusCapture).toBeUndefined();
  act(() => control('Reader settings').props.onPress());
  flush();
  expect(focused()).toBe(titleHandle);
  expect(dialog()!.props.accessibilityLabel).toBe('Reader settings');
  act(() => modal().props.onRequestClose());
  flush();
  expect(dialog()!.props.accessibilityLabel).toBe('Reader contents');
  expect(focused()).toBe(handles.get('Reader settings'));
  act(() => modal().props.onRequestClose());
  flush();
  expect(modal().props.visible).toBe(false);
  expect(dialog()).toBeUndefined();
  expect(background.props.importantForAccessibility).toBe('auto');
  expect(focused()).toBe(handles.get('Toggle table of contents'));
  expect(mounts).toBe(1);
});

test('an early platform show waits for measured content before accessibility focus', () => {
  act(() => control('Toggle table of contents').props.onPress());
  act(() => modal().props.onShow());
  flush();
  expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled();
  measure();
  flush();
  expect(focused()).toBe(handles.get('Contents'));
});

test('iOS restores accessibility focus after dismissal and ignores stale callbacks', () => {
  Platform.OS = 'ios';
  act(() => control('Toggle table of contents').props.onPress());
  act(() => modal().props.onShow());
  const dismiss = modal().props.onDismiss;
  const show = modal().props.onShow;
  jest.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear();
  act(() => control('Close table of contents').props.onPress());
  flush();
  expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled();
  act(() => show());
  expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled();
  act(() => dismiss());
  expect(focused()).toBe(handles.get('Toggle table of contents'));
  act(() => control('Toggle table of contents').props.onPress());
  jest.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear();
  act(() => dismiss());
  expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled();
});

test('replacement closes Modal, clears background isolation and cancels pending focus', () => {
  act(() => control('Toggle table of contents').props.onPress());
  act(() => modal().props.onShow());
  act(() => control('Reader settings').props.onPress());
  act(() => tree.update(element('replacement')));
  jest.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear();
  flush();
  expect(modal().props.visible).toBe(false);
  expect(dialog()).toBeUndefined();
  expect(focused()).toBe(handles.get('Toggle table of contents'));
  expect(
    tree.root.findAllByProps({
      importantForAccessibility: 'no-hide-descendants',
    }),
  ).toHaveLength(0);
  expect(mounts).toBe(1);
});

test('native panels use reader/window width and platform-window height', () => {
  act(() =>
    tree.root
      .findAllByProps({ testID: 'reader' })
      .find((node) => String(node.type) === 'View')!
      .props.onLayout({
        nativeEvent: { layout: { width: 320, height: 640 } },
      }),
  );
  act(() => control('Toggle table of contents').props.onPress());
  const overlay = modal().findAll(
    (node) =>
      String(node.type) === 'View' && node.props.onLayout && !node.props.testID,
  )[0]!;
  act(() =>
    overlay.props.onLayout({
      nativeEvent: { layout: { width: 280, height: 480 } },
    }),
  );
  act(() => control('Reader settings').props.onPress());
  expect(dialog()!.props.style).toEqual(
    expect.arrayContaining([{ width: 248 }, { maxHeight: 448 }]),
  );
});
