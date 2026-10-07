import {
  useEffect,
  forwardRef,
  useMemo,
  useRef,
  useState,
  type ForwardRefExoticComponent,
  type RefAttributes,
} from 'react';
import { Platform, View } from 'react-native';

import { ReaderChrome } from './ReaderChrome';
import {
  applyFoliateHostCommand,
  createFoliateHostCommandLedger,
  receiveFoliateHostMessageWithIdentity,
  serializeFoliateHostMessage,
  type FoliateHostCommandLedger,
} from './nativeFoliateProtocol';
import { sameReaderLoadState } from './shared';
import type { NativeReaderProps, ReaderError, ReaderLoadState } from './types';

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

type FoliateBridgeSession = {
  bridgeBound: boolean;
  disposed: boolean;
  generation: number;
  ledger: FoliateHostCommandLedger;
  session: string;
  transport: SecureWebViewHandle | null;
};

const nativeHostUnavailableError = (): ReaderError => ({
  category: 'unsupported',
  code: 'UNSUPPORTED_EPUB',
  // This intentionally contains no protocol detail, token, source URI, host
  // path, or native error text. Those values may be sensitive host metadata.
  message: 'The native publication host is unavailable.',
});

/** Encodes 32 random bytes as an unpadded, exactly 43-character base64url ID. */
function createSessionId(): string | undefined {
  try {
    // Read both crypto and getRandomValues inside one boundary: in a hostile or
    // incomplete runtime either property may be a throwing getter. There is no
    // pseudo-random fallback because the session authenticates a private host.
    const crypto = globalThis.crypto;
    const random = crypto?.getRandomValues;
    if (typeof random !== 'function') return undefined;

    const bytes = new Uint8Array(32);
    random.call(crypto, bytes);
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let value = '';
    let index = 0;
    for (; index + 2 < bytes.length; index += 3) {
      const group =
        (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
      value += alphabet[(group >>> 18) & 63];
      value += alphabet[(group >>> 12) & 63];
      value += alphabet[(group >>> 6) & 63];
      value += alphabet[group & 63];
    }
    // A 32-byte input has two trailing bytes: 16 payload bits encode to three
    // base64url characters, with no '=' padding in this protocol identifier.
    const trailing = (bytes[index] << 8) | bytes[index + 1];
    value += alphabet[(trailing >>> 10) & 63];
    value += alphabet[(trailing >>> 4) & 63];
    value += alphabet[(trailing << 2) & 63];
    return value;
  } catch {
    return undefined;
  }
}

function createBridgeSession(
  generation: number,
): FoliateBridgeSession | undefined {
  try {
    const session = createSessionId();
    if (!session) return undefined;
    return {
      bridgeBound: false,
      disposed: false,
      generation,
      ledger: createFoliateHostCommandLedger(session, generation),
      session,
      transport: null,
    };
  } catch {
    // Ledger construction is security-critical too. Do not mount a host when
    // identity allocation cannot complete exactly as required.
    return undefined;
  }
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

/**
 * Phase 4B native adapter skeleton.
 *
 * It owns every protocol identity field and only binds the closed native host.
 * It does not receive, inspect, prepare, detect, transfer, or render a source
 * publication. In particular, a successful bind proves transport ownership,
 * not that a publication is open or that a renderer is ready.
 */
export function NativeReaderImplementation({
  source,
  onStateChange,
  style,
  testID,
}: NativeReaderProps) {
  if (!source) {
    return (
      <StaticReaderState
        props={{ onStateChange, style, testID }}
        state={{ status: 'idle' }}
      />
    );
  }

  return (
    <FoliateNativeHost
      onStateChange={onStateChange}
      source={source}
      style={style}
      testID={testID}
    />
  );
}

function FoliateNativeHost({
  source: _source,
  onStateChange,
  style,
  testID,
}: Pick<NativeReaderProps, 'source' | 'onStateChange' | 'style' | 'testID'>) {
  const generationRef = useRef(0);
  const activeGenerationRef = useRef(0);
  const webViewRef = useRef<SecureWebViewHandle | null>(null);
  const notifiedStateRef = useRef<ReaderLoadState | undefined>(undefined);
  const stateChangeRef = useRef(onStateChange);
  const [state, setState] = useState<ReaderLoadState>({ status: 'loading' });
  stateChangeRef.current = onStateChange;

  // Source identity is intentionally only a React lifecycle key. Do not read
  // fields from it: the native host, not JavaScript, owns publication access.
  const bridge = useMemo(() => {
    const generation = (generationRef.current += 1);
    activeGenerationRef.current = generation;
    return createBridgeSession(generation);
  }, [_source]);

  const notify = (next: ReaderLoadState) => {
    if (
      notifiedStateRef.current &&
      sameReaderLoadState(notifiedStateRef.current, next)
    )
      return;
    notifiedStateRef.current = next;
    stateChangeRef.current?.(next);
  };

  const terminate = (session: FoliateBridgeSession) => {
    if (session.disposed || activeGenerationRef.current !== session.generation)
      return;
    session.disposed = true;
    session.ledger.terminal = true;
    // Cut the transport before scheduling React work. A synchronously emitted
    // error can otherwise be followed by a stale load/message callback while
    // React is still committing the error viewport.
    session.transport = null;
    webViewRef.current = null;
    const next: ReaderLoadState = {
      status: 'error',
      error: nativeHostUnavailableError(),
    };
    setState(next);
    notify(next);
  };

  useEffect(() => {
    // StaticReaderState is the sole public-state owner for import/session
    // failures. This effect must remain entirely inert for that branch.
    if (!bridge || !secureWebViewAvailable) return undefined;
    // A host may synchronously call onError from a layout effect before this
    // parent passive effect runs. Never overwrite that terminal error with a
    // late loading update or attempt a bind after its transport was removed.
    if (bridge.disposed || bridge.ledger.terminal) return undefined;

    notifiedStateRef.current = undefined;
    const loading: ReaderLoadState = { status: 'loading' };
    setState(loading);
    notify(loading);
    return () => {
      // Session teardown is local and synchronous. We do not issue a dispose
      // through a potentially reassigned React ref: that could target a newer
      // native host after a source replacement. The closed host invalidates the
      // old transport with this component instance.
      bridge.disposed = true;
      bridge.ledger.terminal = true;
      bridge.transport = null;
    };
  }, [bridge]);

  const sendInitialBind = (session: FoliateBridgeSession) => {
    if (
      session.disposed ||
      session.ledger.bound ||
      activeGenerationRef.current !== session.generation
    )
      return;
    const transport = webViewRef.current;
    if (!transport) {
      terminate(session);
      return;
    }

    const envelope = {
      protocol: 'hn-foliate-host' as const,
      version: 1 as const,
      direction: 'native-to-host' as const,
      type: 'bind' as const,
      session: session.session,
      generation: session.generation,
      commandId: 0,
      payload: {},
    };

    // Recording binding/inflight before the transport call prevents a
    // synchronous host acknowledgement from racing ahead of adapter ownership.
    try {
      const message = serializeFoliateHostMessage(envelope);
      const applied = applyFoliateHostCommand(session.ledger, envelope);
      if (applied.disposition !== 'accepted') {
        terminate(session);
        return;
      }
      session.transport = transport;
      transport.postMessage(message);
    } catch {
      terminate(session);
    }
  };

  const receiveHostMessage = (session: FoliateBridgeSession, data: unknown) => {
    if (session.disposed || activeGenerationRef.current !== session.generation)
      return;

    // Do not pre-parse or otherwise interpret relay bytes. The identity-aware
    // receiver supplies duplicate-key, schema, correlation, and terminal rules.
    let result: ReturnType<typeof receiveFoliateHostMessageWithIdentity>;
    try {
      result = receiveFoliateHostMessageWithIdentity(
        {
          authenticated: true,
          expectedDirection: 'host-to-native',
          expectedGeneration: session.generation,
          expectedSession: session.session,
          ledger: session.ledger,
        },
        data as string,
      );
    } catch {
      // Validators/encoders are dependencies, not trusted host behavior. A
      // synchronous exception must take the same fail-closed terminal path and
      // must never escape a React Native message callback.
      terminate(session);
      return;
    }

    if (result.disposition === 'terminal-violation') {
      terminate(session);
      return;
    }
    if (result.disposition !== 'accepted') return;

    // A syntactically valid terminal host error is accepted by the ledger so
    // that correlation remains strict, then immediately closes this adapter
    // session. Do not leave a terminal ledger mounted as a loading reader.
    if (session.ledger.terminal) {
      terminate(session);
      return;
    }

    // A bind acknowledgement is only private transport state. In particular it
    // cannot expose ready, arm a source watchdog, or create a publication model.
    if (
      result.envelope.type === 'ack' &&
      result.envelope.payload.command === 'bind' &&
      result.envelope.payload.status === 'bridge-bound'
    ) {
      session.bridgeBound = true;
    }
  };

  if (!bridge || !secureWebViewAvailable) {
    return (
      <StaticReaderState
        props={{ onStateChange, style, testID }}
        state={{ status: 'error', error: nativeHostUnavailableError() }}
      />
    );
  }

  return (
    <ReaderChrome
      currentIndex={-1}
      flowControlAvailable={false}
      onNavigate={() => undefined}
      onNext={() => undefined}
      onPrevious={() => undefined}
      readingFlow="paginated"
      state={state}
      style={style}
      testID={testID}
    >
      <View style={{ flex: 1 }}>
        <HNSecureWebView
          // The native host itself must be replaced with the adapter session;
          // otherwise a React prop update could leave an old private transport
          // alive while a new ledger has already been allocated.
          key={bridge.generation}
          onError={() => terminate(bridge)}
          onLoad={() => sendInitialBind(bridge)}
          onMessage={(event) =>
            receiveHostMessage(bridge, event.nativeEvent.data)
          }
          ref={webViewRef}
          source={FOLIATE_NATIVE_HOST}
          style={{ flex: 1 }}
        />
      </View>
    </ReaderChrome>
  );
}
