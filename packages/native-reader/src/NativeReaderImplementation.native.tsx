import {
  useEffect,
  forwardRef,
  useMemo,
  useRef,
  useState,
  type ForwardRefExoticComponent,
  type RefAttributes,
} from 'react';
import { AppState, Platform, View } from 'react-native';

import { ReaderChrome } from './ReaderChrome';
import {
  createNativeReaderSession,
  nativeHostUnavailableError,
  type NativeReaderSnapshot,
} from './nativeReaderSession';
import { sameReaderLoadState } from './shared';
import type { NativeReaderProps, ReaderLoadState } from './types';

/**
 * The selector deliberately contains no URI, path, bytes, or other publication
 * material. Native code resolves the authenticated Foliate host on its side of
 * the security boundary.
 */
const FOLIATE_NATIVE_HOST = Object.freeze({ nativeHost: 'foliate' as const });

type SecureWebViewHandle = {
  postMessage(data: string): void;
};

type SecureWebViewProps = {
  source: typeof FOLIATE_NATIVE_HOST;
  onError?(): void;
  onLoad?(): void;
  onMessage?(event: { nativeEvent: { data: unknown } }): void;
  style?: unknown;
};

/**
 * Keep the secure WebView out of the entry gate's import graph. The gate loads
 * this implementation only after it has validated the native security ABI.
 */
let secureWebViewAvailable = true;
let HNSecureWebView: ForwardRefExoticComponent<
  SecureWebViewProps & RefAttributes<SecureWebViewHandle>
>;
try {
  // Node/Jest does not resolve React Native's platform suffixes through the
  // package's CommonJS entry, while Metro does. Select the platform module
  // explicitly so the production adapter always mounts the reviewed component.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const secureWebView = require(
    Platform.OS === 'ios'
      ? '../secure-webview/src/HNSecureWebView.ios'
      : '../secure-webview/src/HNSecureWebView.android',
  ) as { default?: unknown };
  HNSecureWebView = (secureWebView.default ??
    secureWebView) as typeof HNSecureWebView;
} catch {
  // A broken/missing private transport remains a safe unsupported screen. It
  // must never fall back to a public WebView or to a source-reading adapter.
  secureWebViewAvailable = false;
  HNSecureWebView = forwardRef<SecureWebViewHandle, SecureWebViewProps>(
    (props, ref) => {
      void props;
      void ref;
      return <View />;
    },
  );
}

export function StaticReaderState({
  props,
  state,
}: {
  props: NativeReaderProps;
  state: ReaderLoadState;
}) {
  const notifiedStateRef = useRef<ReaderLoadState | undefined>(undefined);
  useEffect(() => {
    if (
      notifiedStateRef.current &&
      sameReaderLoadState(notifiedStateRef.current, state)
    )
      return;
    notifiedStateRef.current = state;
    props.onStateChange?.(state);
  }, [props.onStateChange, state]);

  return (
    <ReaderChrome
      currentIndex={-1}
      // The skeleton has no publication model or renderer. Keeping every
      // Chrome action inert prevents it from claiming navigation works.
      onNavigate={() => undefined}
      onNext={() => undefined}
      onPrevious={() => undefined}
      state={state}
      style={props.style}
      testID={props.testID}
    />
  );
}

export function NativeReaderImplementation(props: NativeReaderProps) {
  if (!props.source)
    return <StaticReaderState props={props} state={{ status: 'idle' }} />;
  return <FoliateNativeHost {...props} source={props.source} />;
}

function FoliateNativeHost(
  props: NativeReaderProps & {
    source: NonNullable<NativeReaderProps['source']>;
  },
) {
  const { source, onStateChange, style, testID } = props;
  const epochRef = useRef(0);
  const activeRef = useRef(0);
  const webViewRef = useRef<SecureWebViewHandle | null>(null);
  const callbackRef = useRef(onStateChange);
  callbackRef.current = onStateChange;
  const notifiedRef = useRef<ReaderLoadState | undefined>(undefined);
  const [state, setState] = useState<ReaderLoadState>({ status: 'loading' });
  const [snapshot, setSnapshot] = useState<NativeReaderSnapshot>({});
  const [foreground, setForeground] = useState(
    AppState.currentState === 'active',
  );
  const foregroundRef = useRef(foreground);
  const [resumeEpoch, setResumeEpoch] = useState(0);
  const notify = (value: ReaderLoadState) => {
    setState(value);
    if (notifiedRef.current && sameReaderLoadState(notifiedRef.current, value))
      return;
    notifiedRef.current = value;
    callbackRef.current?.(value);
  };
  const bridge = useMemo(() => {
    const epoch = ++epochRef.current;
    activeRef.current = epoch;
    if (!foreground || !secureWebViewAvailable) return undefined;
    try {
      return createNativeReaderSession({
        source,
        timeout:
          props.loadInactivityTimeoutMs !== undefined &&
          Number.isFinite(props.loadInactivityTimeoutMs) &&
          props.loadInactivityTimeoutMs >= 0
            ? props.loadInactivityTimeoutMs
            : 15000,
        isCurrent: () => activeRef.current === epoch && foregroundRef.current,
        onState: notify,
        onSnapshot: setSnapshot,
      });
    } catch {
      return undefined;
    }
  }, [source, foreground, resumeEpoch]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const active = next === 'active';
      if (active === foregroundRef.current) return;
      foregroundRef.current = active;
      if (!active) {
        activeRef.current = 0;
        bridge?.dispose();
        webViewRef.current = null;
      } else setResumeEpoch((epoch) => epoch + 1);
      setForeground(active);
    });
    return () => subscription.remove();
  }, [bridge]);
  useEffect(() => {
    if (!bridge) return;
    setSnapshot({});
    // onError can be delivered in the child's layout effect before this effect.
    // connect/onMessage own terminal state; do not overwrite that error here.
    if (!bridge.disposed) {
      notifiedRef.current = undefined;
      notify({ status: 'loading' });
    }
    return () => {
      bridge.dispose();
      notifiedRef.current = undefined;
    };
  }, [bridge]);
  useEffect(() => {
    if (state.status === 'ready' && props.readingFlow)
      void bridge?.flow(props.readingFlow);
  }, [bridge, state.status, props.readingFlow, snapshot.model?.flow]);
  if (!foreground)
    return <StaticReaderState props={props} state={{ status: 'loading' }} />;
  if (!bridge)
    return (
      <StaticReaderState
        props={props}
        state={{ status: 'error', error: nativeHostUnavailableError() }}
      />
    );
  const model = snapshot.model;
  const book = model?.normalization.book;
  const location =
    snapshot.section === undefined
      ? undefined
      : book?.projectCurrentLocation({ sectionId: `s:${snapshot.section}` });
  const currentIndex = location?.linearIndex ?? -1;
  const step = (delta: number) => {
    const target = book?.model.spine[currentIndex + delta];
    if (target) void bridge.navigate(Number(target.id.slice(2)));
  };
  return (
    <ReaderChrome
      currentIndex={currentIndex}
      model={book?.model}
      toc={book?.displayToc}
      navigationError={snapshot.navigationError}
      publicationLayout={model?.layout}
      readingFlow={model?.flow ?? 'scrolled'}
      flowControlAvailable={state.status === 'ready'}
      onReadingFlowChange={(flow) => {
        props.onReadingFlowChange?.(flow);
        if (!props.readingFlow) void bridge.flow(flow);
      }}
      onNavigate={() => undefined}
      onNext={() => step(1)}
      onPrevious={() => step(-1)}
      onTocNavigate={(target, item) => {
        void bridge.navigate(item.destinationId ?? target.sectionIndex);
      }}
      state={state}
      style={style}
      testID={testID}
    >
      <View style={{ flex: 1 }}>
        <HNSecureWebView
          key={bridge.generation}
          onError={() => bridge.fail()}
          onLoad={() => bridge.connect(webViewRef.current)}
          onMessage={(event) => bridge.receive(event.nativeEvent.data)}
          ref={webViewRef}
          source={FOLIATE_NATIVE_HOST}
          style={{ flex: 1 }}
        />
      </View>
    </ReaderChrome>
  );
}
