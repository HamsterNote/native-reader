import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { ReaderBookLocation, ReaderTocDisplayItem } from './bookModel';
import {
  FOLIATE_IFRAME_PROTOCOL_VERSION,
  createBlobByteSource,
  createCanonicalPublicationBlob,
  createReaderIframe,
  normalizePublicationModelDto,
  readWebLocalPublication,
  type NormalizedPublicationModel,
  type ReaderIframeHost,
} from './foliateWeb';
import { detectReaderFormat } from './formatDetection';
import { ReaderChrome } from './ReaderChrome';
import {
  readerError,
  sameReaderLoadState,
  validateSource,
  type ReaderPublicationModel,
} from './shared';
import type {
  NativeReaderProps,
  ReaderError,
  ReaderErrorCategory,
  ReaderLoadState,
  ReaderPublicationFormat,
  ReaderPublicationLayout,
  ReaderReadingFlow,
} from './types';

const initialState: ReaderLoadState = { status: 'idle' };
const DEFAULT_TIMEOUT_MS = 15_000;

type BridgePhase = 'opening' | 'live' | 'disposing' | 'disposed';
type PendingNavigation = {
  acknowledged: boolean;
  linearIndex?: number;
  located: boolean;
  operationId: number;
  reportedSection?: number;
  sectionIndex: number;
};
type PendingFlow = {
  notify: boolean;
  operationId: number;
  reported?: ReaderReadingFlow;
  value: ReaderReadingFlow;
};
type IframeSession = {
  generation: number;
  generationToken: string;
  format?: ReaderPublicationFormat;
  flowTimer?: ReturnType<typeof setTimeout>;
  iframe: ReaderIframeHost;
  normalized?: NormalizedPublicationModel;
  nextOperationId: number;
  openSent: boolean;
  pendingFlow?: PendingFlow;
  pendingNavigation?: PendingNavigation;
  phase: BridgePhase;
  probePassed: boolean;
  probeSent: boolean;
  receivedReady: boolean;
  readAbort?: AbortController;
  readInFlight: boolean;
  session: string;
  timer?: ReturnType<typeof setTimeout>;
  navigationTimer?: ReturnType<typeof setTimeout>;
  onError?: () => void;
  onLoad?: () => void;
  messageListening: boolean;
  terminate(error: ReaderError): void;
};

type BridgeEvent =
  | { type: 'probe-result'; passed: boolean }
  | { type: 'publication-model'; model: unknown }
  | { type: 'ready' }
  | { type: 'model'; fixedLayout: boolean; flow: ReaderReadingFlow | null }
  | {
      type: 'location';
      index: number;
      cfi: string | null;
      fraction: number | null;
    }
  | { type: 'error'; code: string }
  | { type: 'command-ack'; command: 'open' | 'dispose' | 'navigate' | 'flow' };

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isBridgeToken = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);

function parseBridgeEvent(value: unknown): BridgeEvent | undefined {
  if (
    !isRecord(value) ||
    value.protocolVersion !== FOLIATE_IFRAME_PROTOCOL_VERSION ||
    !isBridgeToken(value.session) ||
    !isBridgeToken(value.generation) ||
    typeof value.type !== 'string'
  )
    return undefined;
  switch (value.type) {
    case 'probe-result':
      return hasOnlyKeys(value, [
        'type',
        'protocolVersion',
        'session',
        'generation',
        'passed',
      ]) && typeof value.passed === 'boolean'
        ? { type: value.type, passed: value.passed }
        : undefined;
    case 'publication-model':
      return hasOnlyKeys(value, [
        'type',
        'protocolVersion',
        'session',
        'generation',
        'model',
      ])
        ? { type: value.type, model: value.model }
        : undefined;
    case 'ready':
      return hasOnlyKeys(value, [
        'type',
        'protocolVersion',
        'session',
        'generation',
      ])
        ? { type: value.type }
        : undefined;
    case 'model':
      return hasOnlyKeys(value, [
        'type',
        'protocolVersion',
        'session',
        'generation',
        'fixedLayout',
        'flow',
      ]) &&
        typeof value.fixedLayout === 'boolean' &&
        (value.flow === null ||
          value.flow === 'scrolled' ||
          value.flow === 'paginated')
        ? { type: value.type, fixedLayout: value.fixedLayout, flow: value.flow }
        : undefined;
    case 'location':
      return hasOnlyKeys(value, [
        'type',
        'protocolVersion',
        'session',
        'generation',
        'index',
        'cfi',
        'fraction',
      ]) &&
        Number.isSafeInteger(value.index) &&
        (value.index as number) >= 0 &&
        (typeof value.cfi === 'string' || value.cfi === null) &&
        (typeof value.fraction === 'number'
          ? Number.isFinite(value.fraction)
          : value.fraction === null)
        ? {
            type: value.type,
            index: value.index as number,
            cfi: value.cfi as string | null,
            fraction: value.fraction as number | null,
          }
        : undefined;
    case 'error':
      return hasOnlyKeys(value, [
        'type',
        'protocolVersion',
        'session',
        'generation',
        'code',
      ]) &&
        typeof value.code === 'string' &&
        [
          'secure-browser-unsupported',
          'model-failure',
          'render-failure',
          'navigation-busy',
          'navigation-failure',
        ].includes(value.code)
        ? { type: value.type, code: value.code }
        : undefined;
    case 'command-ack':
      return hasOnlyKeys(value, [
        'type',
        'protocolVersion',
        'session',
        'generation',
        'command',
      ]) &&
        (value.command === 'open' ||
          value.command === 'dispose' ||
          value.command === 'navigate' ||
          value.command === 'flow')
        ? { type: value.type, command: value.command }
        : undefined;
    default:
      return undefined;
  }
}

function bridgeToken() {
  const bytes = new Uint8Array(24);
  if (!globalThis.crypto?.getRandomValues)
    throw new Error('secure-random-unavailable');
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

const error = (
  category: ReaderErrorCategory,
  message: string,
): ReaderError => ({
  category,
  message,
});

const unsupportedBrowserError = () =>
  error(
    'unsupported',
    'This browser cannot provide the required isolated reader security boundary.',
  );

const runtimeAssetError = () =>
  error(
    'render',
    'runtime-asset-missing: Reader host assets are unavailable. Run foliate:web-runtime:sync.',
  );

// The static Web reader shell is the only template the sync pipeline stages.
// Its `<title>` is `<title>Foliate reader</title>`; no publication content or
// probe response can produce that exact title on a foreign error document.
const READER_HOST_DOCUMENT_TITLE = 'Foliate reader';

function timeoutMs(value: NativeReaderProps['loadInactivityTimeoutMs']) {
  return value === undefined || !Number.isFinite(value) || value < 0
    ? DEFAULT_TIMEOUT_MS
    : value;
}

export function NativeReader({
  source,
  loadInactivityTimeoutMs,
  onReadingFlowChange,
  onStateChange,
  readingFlow,
  style,
  testID,
}: NativeReaderProps) {
  const [state, setState] = useState<ReaderLoadState>(initialState);
  const [model, setModel] = useState<ReaderPublicationModel>();
  const [displayToc, setDisplayToc] = useState<ReaderTocDisplayItem[]>();
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [layout, setLayout] = useState<ReaderPublicationLayout>('reflowable');
  const [activeFlow, setActiveFlow] = useState<ReaderReadingFlow>('paginated');
  const [navigationError, setNavigationError] = useState<ReaderError>();
  const [hostElement, setHostElement] = useState<HTMLElement | null>(null);
  const generationRef = useRef(0);
  const activeSessionRef = useRef<IframeSession | undefined>(undefined);
  const terminalSourceRef = useRef<string | undefined>(undefined);
  const notifiedRef = useRef<ReaderLoadState | undefined>(undefined);
  const stateChangeRef = useRef(onStateChange);
  const flowChangeRef = useRef(onReadingFlowChange);
  stateChangeRef.current = onStateChange;
  flowChangeRef.current = onReadingFlowChange;

  const sourceUri = source?.uri;
  const bindViewport = useCallback((node: View | null) => {
    const host =
      typeof HTMLElement !== 'undefined' && node instanceof HTMLElement
        ? node
        : null;
    setHostElement((current) => (current === host ? current : host));
  }, []);

  useEffect(() => {
    const sourceIdentity = sourceUri ?? '';
    // An error unmounts ReaderChrome's viewport. Do not interpret that ref
    // callback as a request to restart the same terminal source session.
    if (terminalSourceRef.current === sourceIdentity) return undefined;
    if (terminalSourceRef.current !== undefined)
      terminalSourceRef.current = undefined;
    const generation = ++generationRef.current;
    const current = (session: IframeSession) =>
      activeSessionRef.current === session &&
      // 退休的 receive 也能取到 active ref 的新 session；必须同时绑定
      // 创建此闭包的 generation，避免旧 source/错误处理接管新会话。
      session.generation === generation &&
      generationRef.current === generation &&
      session.phase !== 'disposing' &&
      session.phase !== 'disposed';
    const notify = (next: ReaderLoadState, session?: IframeSession) => {
      if (session && !current(session)) return;
      setState(next);
      if (notifiedRef.current && sameReaderLoadState(notifiedRef.current, next))
        return;
      notifiedRef.current = next;
      stateChangeRef.current?.(next);
    };
    const clearTimer = (session: IframeSession) => {
      if (session.timer) clearTimeout(session.timer);
      session.timer = undefined;
    };
    const clearNavigationTimer = (session: IframeSession) => {
      if (session.navigationTimer) clearTimeout(session.navigationTimer);
      session.navigationTimer = undefined;
    };
    const clearFlowTimer = (session: IframeSession) => {
      if (session.flowTimer) clearTimeout(session.flowTimer);
      session.flowTimer = undefined;
    };
    const post = (
      session: IframeSession,
      type: 'probe' | 'open' | 'dispose' | 'navigate' | 'flow',
      payload: Record<string, unknown>,
    ) => {
      if (!current(session) || !session.iframe.contentWindow) return false;
      session.iframe.contentWindow.postMessage(
        {
          type,
          protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION,
          session: session.session,
          generation: session.generationToken,
          payload,
        },
        location.origin,
      );
      return true;
    };
    const dispose = (session: IframeSession, informIframe: boolean) => {
      if (session.phase === 'disposing' || session.phase === 'disposed') return;
      session.phase = 'disposing';
      clearTimer(session);
      clearNavigationTimer(session);
      clearFlowTimer(session);
      session.readAbort?.abort();
      session.readAbort = undefined;
      if (session.onLoad)
        session.iframe.removeEventListener('load', session.onLoad);
      if (session.onError)
        session.iframe.removeEventListener('error', session.onError);
      if (session.messageListening) {
        window.removeEventListener('message', receive);
        session.messageListening = false;
      }
      if (informIframe && session.iframe.contentWindow)
        session.iframe.contentWindow.postMessage(
          {
            type: 'dispose',
            protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION,
            session: session.session,
            generation: session.generationToken,
            payload: {},
          },
          location.origin,
        );
      session.iframe.remove();
      if (activeSessionRef.current === session)
        activeSessionRef.current = undefined;
      session.phase = 'disposed';
    };
    const fail = (session: IframeSession, next: ReaderError) => {
      if (!current(session)) return;
      terminalSourceRef.current = sourceIdentity;
      notify({ status: 'error', error: next }, session);
      dispose(session, true);
      if (generationRef.current === generation) generationRef.current += 1;
    };
    const armLoadTimeout = (session: IframeSession, kind: 'probe' | 'load') => {
      clearTimer(session);
      if (session.phase !== 'opening') return;
      const milliseconds = timeoutMs(loadInactivityTimeoutMs);
      if (milliseconds === 0) return;
      session.timer = setTimeout(() => {
        if (!current(session)) return;
        fail(
          session,
          kind === 'probe'
            ? unsupportedBrowserError()
            : readerError('LOAD_TIMEOUT'),
        );
      }, milliseconds);
    };
    const maybeReady = (session: IframeSession) => {
      if (!current(session) || !session.normalized || !session.receivedReady)
        return;
      session.phase = 'live';
      clearTimer(session);
      const firstLinear = session.normalized.normalization.book.model.spine[0];
      setCurrentIndex(firstLinear ? 0 : -1);
      notify({ status: 'ready' }, session);
    };
    const commitNavigation = (session: IframeSession) => {
      const pending = session.pendingNavigation;
      if (
        !pending ||
        !pending.acknowledged ||
        (pending.linearIndex !== undefined && !pending.located)
      )
        return;
      session.pendingNavigation = undefined;
      clearNavigationTimer(session);
      // Destination tokens can target a non-linear section. Their ack confirms
      // the renderer command but must never invent a linear Chrome position.
      if (pending.linearIndex !== undefined)
        setCurrentIndex(pending.linearIndex);
      setNavigationError(undefined);
    };
    const openAfterProbe = async (session: IframeSession) => {
      try {
        // Source ownership remains with the host. This local read begins only
        // after the authenticated behavior-probe result has passed.
        session.readInFlight = true;
        session.readAbort = new AbortController();
        const blob = await readWebLocalPublication(
          sourceUri!,
          session.readAbort.signal,
        );
        session.readInFlight = false;
        session.readAbort = undefined;
        if (!current(session)) return;
        armLoadTimeout(session, 'load');
        const detection = await detectReaderFormat(createBlobByteSource(blob));
        if (!current(session)) return;
        if (detection.status === 'error') {
          fail(session, detection.error);
          return;
        }
        const payload = createCanonicalPublicationBlob(blob, detection.format);
        if (!current(session)) return;
        session.format = detection.format;
        session.openSent = post(session, 'open', payload);
        if (!session.openSent)
          fail(session, error('render', 'Reader host is unavailable.'));
      } catch {
        session.readInFlight = false;
        session.readAbort = undefined;
        fail(session, error('read', 'Publication bytes could not be read.'));
      }
    };
    const receive = (event: MessageEvent) => {
      const session = activeSessionRef.current;
      if (
        !session ||
        !current(session) ||
        event.origin !== location.origin ||
        event.source !== session.iframe.contentWindow
      )
        return;
      const message = parseBridgeEvent(event.data);
      if (
        !message ||
        !isRecord(event.data) ||
        event.data.session !== session.session ||
        event.data.generation !== session.generationToken
      )
        return;
      switch (message.type) {
        case 'probe-result':
          if (!session.probeSent || session.probePassed || session.openSent)
            return;
          if (!message.passed) {
            fail(session, unsupportedBrowserError());
            return;
          }
          session.probePassed = true;
          armLoadTimeout(session, 'load');
          void openAfterProbe(session);
          return;
        case 'publication-model': {
          if (!session.openSent || session.normalized) return;
          const normalized = normalizePublicationModelDto(message.model);
          if (!normalized || normalized.format !== session.format) {
            fail(session, error('invalid', 'Publication model is invalid.'));
            return;
          }
          session.normalized = normalized;
          setModel(normalized.normalization.book.model);
          setDisplayToc(normalized.normalization.book.displayToc);
          setLayout(normalized.layout);
          setActiveFlow(normalized.flow);
          armLoadTimeout(session, 'load');
          maybeReady(session);
          return;
        }
        case 'ready':
          if (!session.openSent) return;
          session.receivedReady = true;
          armLoadTimeout(session, 'load');
          maybeReady(session);
          return;
        case 'model': {
          const normalized = session.normalized;
          if (
            !normalized ||
            message.fixedLayout !== (normalized.layout === 'fixed')
          ) {
            fail(
              session,
              error('invalid', 'Publication renderer model is invalid.'),
            );
            return;
          }
          if (
            (message.fixedLayout && message.flow !== null) ||
            (!message.fixedLayout &&
              message.flow !== 'scrolled' &&
              message.flow !== 'paginated')
          ) {
            fail(
              session,
              error('invalid', 'Publication renderer flow is invalid.'),
            );
            return;
          }
          const flow: ReaderReadingFlow = message.fixedLayout
            ? 'paginated'
            : (message.flow as ReaderReadingFlow);
          if (session.pendingFlow) session.pendingFlow.reported = flow;
          else if (session.phase === 'opening') setActiveFlow(flow);
          armLoadTimeout(session, 'load');
          return;
        }
        case 'location': {
          const normalized = session.normalized;
          const section = normalized?.sections[message.index];
          const projected = section
            ? normalized.normalization.book.projectCurrentLocation({
                sectionId: section.key,
              })
            : undefined;
          const pending = session.pendingNavigation;
          if (pending) {
            if (
              pending.reportedSection !== undefined ||
              pending.sectionIndex !== message.index
            ) {
              fail(
                session,
                error('render', 'Publication navigation response is stale.'),
              );
              return;
            }
            pending.reportedSection = message.index;
            if (pending.linearIndex !== undefined) {
              if (
                !projected ||
                projected.linearIndex === undefined ||
                projected.linearIndex !== pending.linearIndex
              ) {
                fail(
                  session,
                  error('render', 'Publication navigation response is stale.'),
                );
                return;
              }
              pending.located = true;
            }
            commitNavigation(session);
          } else if (projected?.linearIndex !== undefined) {
            setCurrentIndex(projected.linearIndex);
            setNavigationError(undefined);
          }
          armLoadTimeout(session, 'load');
          return;
        }
        case 'error':
          if (
            message.code === 'navigation-busy' ||
            message.code === 'navigation-failure'
          ) {
            if (!session.pendingNavigation) {
              fail(
                session,
                error('render', 'Publication navigation is stale.'),
              );
              return;
            }
            fail(
              session,
              error('render', 'Publication location is unavailable.'),
            );
            return;
          }
          fail(
            session,
            message.code === 'secure-browser-unsupported'
              ? unsupportedBrowserError()
              : message.code === 'model-failure'
                ? error('invalid', 'Publication model is invalid.')
                : error('render', 'Publication could not be rendered.'),
          );
          return;
        case 'command-ack':
          if (message.command === 'navigate' && session.pendingNavigation) {
            if (session.pendingNavigation.acknowledged) {
              fail(
                session,
                error(
                  'render',
                  'Publication command acknowledgement is stale.',
                ),
              );
              return;
            }
            session.pendingNavigation.acknowledged = true;
            commitNavigation(session);
          } else if (message.command === 'flow' && session.pendingFlow) {
            const pending = session.pendingFlow;
            session.pendingFlow = undefined;
            clearFlowTimer(session);
            if (pending.reported === pending.value) {
              setActiveFlow(pending.value);
              if (pending.notify) flowChangeRef.current?.(pending.value);
              setNavigationError(undefined);
            } else {
              fail(
                session,
                error('render', 'Reading flow could not be applied.'),
              );
              return;
            }
          } else if (
            session.phase === 'live' &&
            (message.command === 'navigate' || message.command === 'flow')
          ) {
            fail(
              session,
              error('render', 'Publication command acknowledgement is stale.'),
            );
            return;
          }
          armLoadTimeout(session, 'load');
          return;
      }
    };

    setModel(undefined);
    setDisplayToc(undefined);
    setCurrentIndex(-1);
    setLayout('reflowable');
    setActiveFlow('paginated');
    setNavigationError(undefined);
    if (!sourceUri) {
      notify(initialState);
      return undefined;
    }
    const sourceError = validateSource({ kind: 'uri', uri: sourceUri }, 'web');
    if (sourceError) {
      notify({ status: 'error', error: sourceError });
      return undefined;
    }
    // ReaderChrome mounts children only in loading/ready states. A real RN Web
    // View ref can arrive after this effect, so host absence is not an error and
    // must never start source I/O or an inactivity timer.
    if (!hostElement) {
      notify({ status: 'loading' });
      return undefined;
    }
    let session: IframeSession | undefined;
    const onLoad = () => {
      if (!session) return;
      if (!current(session) || session.probePassed || session.openSent) return;
      // A real 404/abort/refused host navigation usually commits a same-origin
      // error document and still fires `load`; `error` is not reliable
      // evidence. Classify a readable-but-foreign document (or an unreadable
      // cross-origin error page) as a missing runtime asset before posting any
      // probe or reading the source. This is an error-shape check, not trusted
      // authentication: a correctly titled host whose behavioral CSP probe
      // fails must still end in unsupported below. `createReaderIframe` assigns
      // `src` before inserting the element, so no about:blank load precedes the
      // real document load in the supported session order.
      let hostDocumentTitle: unknown;
      try {
        hostDocumentTitle = session.iframe.contentDocument?.title;
      } catch {
        fail(session, runtimeAssetError());
        return;
      }
      if (hostDocumentTitle !== READER_HOST_DOCUMENT_TITLE) {
        fail(session, runtimeAssetError());
        return;
      }
      session.probeSent = post(session, 'probe', {});
      if (!session.probeSent)
        fail(session, error('render', 'Reader host is unavailable.'));
    };
    const onError = () => {
      if (!session || !current(session)) return;
      fail(session, runtimeAssetError());
    };
    const failBeforeSession = (iframe?: ReaderIframeHost) => {
      // Token and iframe construction happen before listeners, timers, or
      // publication I/O. Still treat every partial construction failure as a
      // terminal generation so a ref churn cannot retry the same source.
      try {
        iframe?.remove();
      } catch {
        // A failed host must not prevent the stable public error state.
      }
      terminalSourceRef.current = sourceIdentity;
      notify({ status: 'error', error: runtimeAssetError() });
      if (generationRef.current === generation) generationRef.current += 1;
    };
    notify({ status: 'loading' }, session);
    let iframe: ReaderIframeHost | undefined;
    try {
      // Preserve an explicit transaction order. The first credential exists
      // before the host is created; a later credential failure still removes
      // that newly-created iframe before the session becomes observable.
      const generationToken = bridgeToken();
      iframe = createReaderIframe(hostElement);
      const sessionToken = bridgeToken();
      session = {
        generation,
        generationToken,
        iframe,
        messageListening: false,
        nextOperationId: 1,
        openSent: false,
        phase: 'opening',
        probePassed: false,
        probeSent: false,
        receivedReady: false,
        readInFlight: false,
        session: sessionToken,
        terminate(next) {
          fail(session!, next);
        },
      };
    } catch {
      failBeforeSession(iframe);
      return undefined;
    }
    activeSessionRef.current = session;
    session.onLoad = onLoad;
    session.onError = onError;
    session.iframe.addEventListener('load', onLoad);
    session.iframe.addEventListener('error', onError);
    window.addEventListener('message', receive);
    session.messageListening = true;
    armLoadTimeout(session, 'probe');
    return () => {
      dispose(session, true);
    };
  }, [hostElement, loadInactivityTimeoutMs, sourceUri]);

  const requestNavigation = (sectionIndex: number, linearIndex?: number) => {
    const session = activeSessionRef.current;
    if (!session || session.phase !== 'live' || session.pendingNavigation)
      return;
    const target = session.normalized?.sections[sectionIndex];
    if (!target || (!target.linear && linearIndex !== undefined)) return;
    if (!session.iframe.contentWindow) return;
    const operationId = session.nextOperationId++;
    session.pendingNavigation = {
      acknowledged: false,
      linearIndex,
      located: false,
      operationId,
      sectionIndex,
    };
    const timeout = timeoutMs(loadInactivityTimeoutMs);
    if (timeout > 0) {
      session.navigationTimer = setTimeout(() => {
        if (
          activeSessionRef.current !== session ||
          session.pendingNavigation?.operationId !== operationId
        )
          return;
        session.terminate(error('render', 'Publication navigation timed out.'));
      }, timeout);
    }
    session.iframe.contentWindow.postMessage(
      {
        type: 'navigate',
        protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION,
        session: session.session,
        generation: session.generationToken,
        // bootstrap's closed schema does not accept an operation field. Keep
        // operationId private and retire the whole session on ambiguity.
        payload: { section: sectionIndex },
      },
      location.origin,
    );
  };
  const requestTocNavigation = (
    tocLocation: ReaderBookLocation,
    item: ReaderTocDisplayItem,
  ) => {
    const session = activeSessionRef.current;
    if (
      !session ||
      session.phase !== 'live' ||
      session.pendingNavigation ||
      !item.destinationId
    )
      return;
    const sectionIndex = session.normalized?.sections.findIndex(
      (section) => section.key === tocLocation.sectionId,
    );
    if (sectionIndex === undefined || sectionIndex < 0) {
      setNavigationError(
        error('render', 'Publication location is unavailable.'),
      );
      return;
    }
    if (!session.iframe.contentWindow) return;
    const operationId = session.nextOperationId++;
    session.pendingNavigation = {
      acknowledged: false,
      linearIndex: tocLocation.linearIndex,
      located: false,
      operationId,
      sectionIndex,
    };
    const timeout = timeoutMs(loadInactivityTimeoutMs);
    if (timeout > 0) {
      session.navigationTimer = setTimeout(() => {
        if (
          activeSessionRef.current !== session ||
          session.pendingNavigation?.operationId !== operationId
        )
          return;
        session.terminate(error('render', 'Publication navigation timed out.'));
      }, timeout);
    }
    session.iframe.contentWindow.postMessage(
      {
        type: 'navigate',
        protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION,
        session: session.session,
        generation: session.generationToken,
        payload: { destination: item.destinationId },
      },
      location.origin,
    );
  };
  const requestFlow = (value: ReaderReadingFlow, notify: boolean) => {
    const session = activeSessionRef.current;
    if (
      !session ||
      session.phase !== 'live' ||
      session.normalized?.layout !== 'reflowable' ||
      session.pendingFlow
    )
      return;
    if (!session.iframe.contentWindow) return;
    const operationId = session.nextOperationId++;
    session.pendingFlow = { notify, operationId, value };
    const timeout = timeoutMs(loadInactivityTimeoutMs);
    if (timeout > 0) {
      session.flowTimer = setTimeout(() => {
        if (
          activeSessionRef.current !== session ||
          session.pendingFlow?.operationId !== operationId
        )
          return;
        session.terminate(
          error('render', 'Reading flow could not be applied.'),
        );
      }, timeout);
    }
    session.iframe.contentWindow.postMessage(
      {
        type: 'flow',
        protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION,
        session: session.session,
        generation: session.generationToken,
        payload: { flow: value },
      },
      location.origin,
    );
  };

  useEffect(() => {
    if (
      state.status === 'ready' &&
      layout === 'reflowable' &&
      readingFlow &&
      readingFlow !== activeFlow
    ) {
      const session = activeSessionRef.current;
      if (
        !session ||
        !session.iframe.contentWindow ||
        session.pendingFlow ||
        session.phase !== 'live'
      )
        return;
      const operationId = session.nextOperationId++;
      session.pendingFlow = { notify: false, operationId, value: readingFlow };
      const timeout = timeoutMs(loadInactivityTimeoutMs);
      if (timeout > 0) {
        session.flowTimer = setTimeout(() => {
          if (
            activeSessionRef.current !== session ||
            session.pendingFlow?.operationId !== operationId
          )
            return;
          session.terminate(
            error('render', 'Reading flow could not be applied.'),
          );
        }, timeout);
      }
      session.iframe.contentWindow.postMessage(
        {
          type: 'flow',
          protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION,
          session: session.session,
          generation: session.generationToken,
          payload: { flow: readingFlow },
        },
        location.origin,
      );
    }
  }, [activeFlow, layout, loadInactivityTimeoutMs, readingFlow, state.status]);

  const previous = () => {
    const session = activeSessionRef.current;
    const spine = session?.normalized?.normalization.book.model.spine;
    const target = spine?.[currentIndex - 1];
    if (target) requestNavigation(target.engineIndex, currentIndex - 1);
  };
  const next = () => {
    const session = activeSessionRef.current;
    const spine = session?.normalized?.normalization.book.model.spine;
    const target = spine?.[currentIndex + 1];
    if (target) requestNavigation(target.engineIndex, currentIndex + 1);
  };
  return (
    <ReaderChrome
      currentIndex={currentIndex}
      flowControlAvailable={state.status === 'ready' && layout === 'reflowable'}
      model={model}
      navigationError={navigationError}
      onNavigate={() => undefined}
      onNext={next}
      onPrevious={previous}
      onReadingFlowChange={(value) => requestFlow(value, true)}
      onTocNavigate={requestTocNavigation}
      publicationLayout={layout}
      readingFlow={activeFlow}
      state={state}
      style={style}
      testID={testID}
      toc={displayToc}
    >
      <View
        ref={bindViewport}
        style={{ flex: 1 }}
        testID="foliate-web-viewport"
      />
    </ReaderChrome>
  );
}
