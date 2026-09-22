import {
  Reader,
  ReaderProvider,
  useReader,
  type Location,
} from '@epubjs-react-native/core';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState, View, type AppStateStatus } from 'react-native';

import { ReaderChrome } from './ReaderChrome';
import { createExpoFileSystem } from './expoFileSystem';
import { createNativeSession, type NativeSession } from './nativeSession';
import { prepareNativeSource } from './nativeSource';
import { continueAfterBestEffortCleanup } from './nativeTransition';
import {
  buildPublicationModel,
  categorizeOpenError,
  findSpineIndex,
  mapPublicationErrorCode,
  parseNativeBridgeEvent,
  readerError,
  validatePublication,
  validateSource,
  type NativeBridgeEvent,
  type ReaderPublicationModel,
} from './shared';
import type { NativeReaderProps, ReaderLoadState } from './types';

type PreparedProps = NativeReaderProps & {
  source: NonNullable<NativeReaderProps['source']>;
};

type SessionProps = Omit<PreparedProps, 'source'> & {
  source: NonNullable<NativeReaderProps['source']> & {
    session: NativeSession;
    sessionRoot?: string;
    rendererCurrent(): boolean;
  };
  onTerminalError(error: ReturnType<typeof readerError>): void;
};

function StaticReaderState({
  props,
  state,
}: {
  props: NativeReaderProps;
  state: ReaderLoadState;
}) {
  const notifiedStateRef = useRef<ReaderLoadState | undefined>(undefined);
  const sourceUriRef = useRef(props.source?.uri);
  if (sourceUriRef.current !== props.source?.uri) {
    sourceUriRef.current = props.source?.uri;
    notifiedStateRef.current = undefined;
  }
  useEffect(() => {
    if (
      notifiedStateRef.current?.status === state.status &&
      (state.status !== 'error' ||
        (notifiedStateRef.current.status === 'error' &&
          notifiedStateRef.current.error.code === state.error.code))
    )
      return;
    notifiedStateRef.current = state;
    props.onStateChange?.(state);
  }, [props.onStateChange, state]);

  return (
    <ReaderChrome
      currentIndex={-1}
      onNavigate={() => undefined}
      onNext={() => undefined}
      onPrevious={() => undefined}
      state={state}
      style={props.style}
      testID={props.testID}
    />
  );
}

type SessionPhase = 'loading' | 'ready' | 'error' | 'disposed';

// AppState 生命周期用单调递增的 epoch 描述。只有真实的状态转换才 +1，
// 重复相同状态返回原对象；这样即使 React 把同一 act 内的
// background→active 合并成最终字符串 active，epoch 也已经前进，
// renderer 创建 effect 仍会重新执行并生成新的 renderer/session。
type AppStateLifecycle = {
  appState: AppStateStatus | null;
  epoch: number;
};

type AppStateLifecycleAction = {
  type: 'change';
  appState: AppStateStatus | null;
};

function createAppStateLifecycle(
  appState: AppStateStatus | null,
): AppStateLifecycle {
  return { appState, epoch: 0 };
}

function reduceAppStateLifecycle(
  previous: AppStateLifecycle,
  action: AppStateLifecycleAction,
): AppStateLifecycle {
  // 基于队列中的前一个状态判断：background→active 各计一次，
  // 而重复 active 不会让 epoch 增长，也不会触发多余的重建。
  if (previous.appState === action.appState) return previous;
  return { appState: action.appState, epoch: previous.epoch + 1 };
}

function ReaderSession({
  source,
  loadInactivityTimeoutMs,
  onStateChange,
  onTerminalError,
  style,
  testID,
}: SessionProps) {
  const { goToLocation } = useReader();
  const [state, setState] = useState<ReaderLoadState>({ status: 'loading' });
  const [model, setModel] = useState<ReaderPublicationModel>();
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [navigationError, setNavigationError] =
    useState<ReturnType<typeof readerError>>();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const stateChangeRef = useRef(onStateChange);
  const notifiedStatusRef = useRef<ReaderLoadState | undefined>(undefined);
  const phaseRef = useRef<SessionPhase>('loading');
  const profileAcceptedRef = useRef(false);
  const engineReadyRef = useRef(false);
  const modelRef = useRef<ReaderPublicationModel | undefined>(undefined);
  const failWithRef = useRef<(error: ReturnType<typeof readerError>) => void>(
    () => undefined,
  );
  stateChangeRef.current = onStateChange;
  modelRef.current = model;
  const fileSystem = useMemo(
    () => createExpoFileSystem(source.sessionRoot ?? '', source.session),
    [source.session, source.sessionRoot],
  );
  const canCommit = (...phases: SessionPhase[]) =>
    source.session.active() &&
    source.rendererCurrent() &&
    phases.includes(phaseRef.current);
  const notify = (next: ReaderLoadState) => {
    if (!source.session.active() || !source.rendererCurrent()) return;
    setState(next);
    if (
      notifiedStatusRef.current?.status === next.status &&
      (next.status !== 'error' ||
        (notifiedStatusRef.current.status === 'error' &&
          notifiedStatusRef.current.error.code === next.error.code))
    )
      return;
    notifiedStatusRef.current = next;
    stateChangeRef.current?.(next);
  };

  const clearWatchdog = () => {
    if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
  };

  const timeoutMs =
    loadInactivityTimeoutMs === undefined ||
    !Number.isFinite(loadInactivityTimeoutMs) ||
    loadInactivityTimeoutMs < 0
      ? 15_000
      : loadInactivityTimeoutMs;

  const failWith = (error: ReturnType<typeof readerError>) => {
    if (!canCommit('loading', 'ready')) return;
    phaseRef.current = 'error';
    clearWatchdog();
    notify({ status: 'error', error });
    onTerminalError(error);
    // Stop all session-bound file-system work and prevent late bridge events.
    source.session.deactivate();
  };

  const armWatchdog = () => {
    if (!canCommit('loading')) return;
    clearWatchdog();
    if (timeoutMs === 0) return;
    timeoutRef.current = setTimeout(() => {
      if (phaseRef.current === 'loading') failWith(readerError('LOAD_TIMEOUT'));
    }, timeoutMs);
  };
  failWithRef.current = failWith;

  const commitReadyIfPossible = () => {
    if (
      !canCommit('loading') ||
      !profileAcceptedRef.current ||
      !engineReadyRef.current
    )
      return;
    phaseRef.current = 'ready';
    clearWatchdog();
    setCurrentIndex((value) => (value < 0 ? 0 : value));
    notify({ status: 'ready' });
  };

  useEffect(() => {
    const loading: ReaderLoadState = { status: 'loading' };
    phaseRef.current = 'loading';
    profileAcceptedRef.current = false;
    engineReadyRef.current = false;
    modelRef.current = undefined;
    notifiedStatusRef.current = undefined;
    setState(loading);
    setModel(undefined);
    setCurrentIndex(-1);
    setNavigationError(undefined);
    return () => {
      phaseRef.current = 'disposed';
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    };
  }, []);

  // Timeout configuration does not own the session. Re-arm without running
  // the ownership cleanup, which permanently deactivates the current session.
  useEffect(() => {
    if (
      source.session.active() &&
      source.rendererCurrent() &&
      phaseRef.current === 'loading' &&
      timeoutMs > 0
    ) {
      timeoutRef.current = setTimeout(() => {
        if (phaseRef.current === 'loading')
          failWithRef.current(readerError('LOAD_TIMEOUT'));
      }, timeoutMs);
    }
    return () => {
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    };
  }, [source.rendererCurrent, source.session, timeoutMs]);

  const updateLocation = (href: string, engineIndex?: number) => {
    if (!canCommit('ready')) return;
    const index = findSpineIndex(
      modelRef.current?.spine ?? [],
      href,
      engineIndex,
    );
    if (index >= 0) {
      setNavigationError(undefined);
      setCurrentIndex(index);
    }
  };

  const handleBridgeEvent = (rawEvent: unknown) => {
    if (!canCommit('loading', 'ready')) return;
    const candidate = rawEvent as { phase?: unknown; type?: unknown } | null;
    const candidateType =
      candidate !== null && typeof candidate === 'object'
        ? candidate.type
        : undefined;
    const isPublicationEvent =
      typeof candidateType === 'string' &&
      candidateType.startsWith('publication');
    const event = parseNativeBridgeEvent(rawEvent);
    if (!event) {
      if (!isPublicationEvent) return;
      const legalPhase =
        candidateType === 'publicationLocation' ||
        candidateType === 'publicationNavigationError'
          ? canCommit('ready')
          : candidateType === 'publicationError' &&
              candidate?.phase === 'render'
            ? canCommit('loading', 'ready')
            : canCommit('loading');
      if (legalPhase) failWith(readerError('INVALID_EPUB'));
      return;
    }
    if (event.type === 'publicationLocation') {
      if (!canCommit('ready')) return;
      updateLocation(event.href, event.engineIndex);
      return;
    }
    if (event.type === 'publicationNavigationError') {
      if (!canCommit('ready')) return;
      setNavigationError(readerError('RENDER_FAILED'));
      return;
    }
    if (event.type === 'publicationError') {
      const legalPhase =
        event.phase === 'render'
          ? canCommit('loading', 'ready')
          : canCommit('loading');
      if (!legalPhase) return;
      // reason 仅通过显式 allowlist 参与映射，未知值一律 fail-closed。
      failWith(readerError(mapPublicationErrorCode(event.phase, event.reason)));
      return;
    }

    if (!canCommit('loading')) return;
    armWatchdog();
    const profileError = validatePublication(event);
    if (profileError) {
      failWith(profileError);
      return;
    }
    const publication = buildPublicationModel(event);
    if (!publication) {
      failWith(readerError('INVALID_EPUB'));
      return;
    }
    modelRef.current = publication;
    setModel(publication);
    profileAcceptedRef.current = true;
    commitReadyIfPossible();
  };

  return (
    <ReaderChrome
      currentIndex={currentIndex}
      model={model}
      navigationError={navigationError}
      onNavigate={(tocItem) => {
        if (!canCommit('ready')) return;
        if (
          !tocItem ||
          !modelRef.current?.spine.some(
            (item) =>
              item.archiveKey === tocItem.archiveKey &&
              item.engineIndex === tocItem.targetEngineIndex,
          )
        ) {
          setNavigationError(readerError('RENDER_FAILED'));
          return;
        }
        setNavigationError(undefined);
        (
          goToLocation as unknown as (
            target: number | { engineIndex: number; fragment: string },
          ) => void
        )(
          tocItem.targetFragment
            ? {
                engineIndex: tocItem.targetEngineIndex,
                fragment: tocItem.targetFragment,
              }
            : tocItem.targetEngineIndex,
        );
      }}
      onNext={() => {
        if (!canCommit('ready')) return;
        const target = modelRef.current?.spine[currentIndex + 1];
        if (target) {
          setNavigationError(undefined);
          (goToLocation as unknown as (index: number) => void)(
            target.engineIndex,
          );
        }
      }}
      onPrevious={() => {
        if (!canCommit('ready')) return;
        const target = modelRef.current?.spine[currentIndex - 1];
        if (target) {
          setNavigationError(undefined);
          (goToLocation as unknown as (index: number) => void)(
            target.engineIndex,
          );
        }
      }}
      state={state}
      style={style}
      testID={testID}
    >
      <View style={{ flex: 1 }}>
        <Reader
          allowPopups={false}
          allowScriptedContent={false}
          enableSelection={false}
          fileSystem={fileSystem}
          flow="paginated"
          height="100%"
          menuItems={[]}
          onDisplayError={() => failWith(readerError('RENDER_FAILED'))}
          onLocationChange={(
            _total: number,
            location: Location,
            _progress: number,
            section: { href?: string } | null,
          ) => {
            const href = section?.href ?? location.start.href;
            const engineIndex = (
              location.start as typeof location.start & { index?: number }
            ).index;
            updateLocation(href, engineIndex);
          }}
          onNavigationLoaded={() => undefined}
          onPressExternalLink={undefined}
          onStarted={armWatchdog}
          onReady={() => {
            if (!canCommit('loading')) return;
            armWatchdog();
            engineReadyRef.current = true;
            commitReadyIfPossible();
          }}
          onWebViewMessage={(event: NativeBridgeEvent | unknown) =>
            handleBridgeEvent(event)
          }
          spread="none"
          src={source.uri}
          width="100%"
        />
      </View>
    </ReaderChrome>
  );
}

export function NativeReaderImplementation(props: NativeReaderProps) {
  if (!props.source) {
    return <StaticReaderState props={props} state={{ status: 'idle' }} />;
  }

  const sourceError = validateSource(props.source, 'native');
  if (sourceError) {
    return (
      <StaticReaderState
        props={props}
        state={{ status: 'error', error: sourceError }}
      />
    );
  }

  return <PreparedReader {...props} source={props.source} />;
}

function PreparedReader(props: PreparedProps) {
  const [prepared, setPrepared] = useState<{
    sourceUri: string;
    uri: string;
    sessionRoot?: string;
    sessions: Set<NativeSession>;
  }>();
  const [renderer, setRenderer] = useState<{
    generation: number;
    session: NativeSession;
    rendererCurrent(): boolean;
  }>();
  const [lifecycle, dispatchLifecycle] = useReducer(
    reduceAppStateLifecycle,
    AppState.currentState,
    createAppStateLifecycle,
  );
  const [error, setError] = useState<ReaderLoadState>();
  const stateChangeRef = useRef(props.onStateChange);
  const preparationGenerationRef = useRef(0);
  const rendererGenerationRef = useRef(0);
  const rendererOwnerRef = useRef<
    | {
        generation: number;
        session: NativeSession;
      }
    | undefined
  >(undefined);
  const appStateRef = useRef<AppStateStatus | null>(AppState.currentState);
  const componentActiveRef = useRef(true);
  const cleanupRef = useRef<() => Promise<void>>(async () => undefined);
  const transitionRef = useRef<Promise<void>>(Promise.resolve());
  const notifiedStatusRef = useRef<ReaderLoadState | undefined>(undefined);
  const terminalErrorRef = useRef<ReaderLoadState | undefined>(undefined);
  const currentSourceRef = useRef(props.source.uri);
  const retireRendererRef = useRef<(clearState?: boolean) => boolean>(
    () => false,
  );
  currentSourceRef.current = props.source.uri;
  stateChangeRef.current = props.onStateChange;

  const notify = (next: ReaderLoadState) => {
    if (
      notifiedStatusRef.current?.status === next.status &&
      (next.status !== 'error' ||
        (notifiedStatusRef.current.status === 'error' &&
          notifiedStatusRef.current.error.code === next.error.code))
    )
      return;
    notifiedStatusRef.current = next;
    stateChangeRef.current?.(next);
  };
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  retireRendererRef.current = (clearState = true) => {
    rendererGenerationRef.current += 1;
    const owner = rendererOwnerRef.current;
    rendererOwnerRef.current = undefined;
    owner?.session.deactivate();
    if (clearState) setRenderer(undefined);
    return owner !== undefined;
  };

  useEffect(() => {
    componentActiveRef.current = true;
    const subscription = AppState.addEventListener('change', (nextState) => {
      // 同步更新 ref，保证 rendererCurrent 立即可见最新状态。
      appStateRef.current = nextState;
      if (
        nextState !== 'active' &&
        retireRendererRef.current() &&
        !terminalErrorRef.current
      )
        notifyRef.current({ status: 'loading' });
      // 交给 reducer 按队列顺序单调推进 epoch。
      dispatchLifecycle({ type: 'change', appState: nextState });
    });
    const currentAppState = AppState.currentState;
    appStateRef.current = currentAppState;
    dispatchLifecycle({ type: 'change', appState: currentAppState });
    return () => {
      componentActiveRef.current = false;
      subscription.remove();
      retireRendererRef.current(false);
    };
  }, []);

  useEffect(() => {
    const generation = ++preparationGenerationRef.current;
    const timeoutMs =
      props.loadInactivityTimeoutMs === undefined ||
      !Number.isFinite(props.loadInactivityTimeoutMs) ||
      props.loadInactivityTimeoutMs < 0
        ? 15_000
        : props.loadInactivityTimeoutMs;
    let preparationTimeout: ReturnType<typeof setTimeout> | undefined;
    let preparationAppState: AppStateStatus | null = appStateRef.current;
    let preparing = true;
    const clearPreparationTimeout = () => {
      if (preparationTimeout !== undefined) clearTimeout(preparationTimeout);
      preparationTimeout = undefined;
    };
    const armPreparationTimeout = () => {
      clearPreparationTimeout();
      if (!preparing || timeoutMs === 0 || preparationAppState !== 'active')
        return;
      preparationTimeout = setTimeout(() => {
        if (
          preparationGenerationRef.current !== generation ||
          !componentActiveRef.current ||
          currentSourceRef.current !== props.source.uri ||
          preparationAppState !== 'active'
        )
          return;
        preparing = false;
        preparationGenerationRef.current += 1;
        const next: ReaderLoadState = {
          status: 'error',
          error: readerError('LOAD_TIMEOUT'),
        };
        terminalErrorRef.current = next;
        setError(next);
        notifyRef.current(next);
      }, timeoutMs);
    };
    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState) => {
        preparationAppState = nextState;
        armPreparationTimeout();
      },
    );
    notifiedStatusRef.current = undefined;
    terminalErrorRef.current = undefined;
    retireRendererRef.current();
    setPrepared(undefined);
    setError(undefined);
    notifyRef.current({ status: 'loading' });
    armPreparationTimeout();
    const previousCleanup = cleanupRef.current;
    cleanupRef.current = async () => undefined;
    const transition = continueAfterBestEffortCleanup(
      transitionRef.current,
      previousCleanup,
      async () => {
        if (preparationGenerationRef.current !== generation) return;
        const result = await prepareNativeSource(props.source.uri);
        if (preparationGenerationRef.current !== generation) {
          await result.cleanup();
          return;
        }
        preparing = false;
        clearPreparationTimeout();
        const sessions = new Set<NativeSession>();
        cleanupRef.current = async () => {
          for (const session of sessions) session.deactivate();
          await Promise.all([...sessions].map((session) => session.settled()));
          await result.cleanup();
        };
        setPrepared({
          sourceUri: props.source.uri,
          uri: result.uri,
          sessionRoot: result.sessionRoot,
          sessions,
        });
      },
    ).catch((reason: unknown) => {
      if (preparationGenerationRef.current !== generation) return;
      preparing = false;
      clearPreparationTimeout();
      const next: ReaderLoadState = {
        status: 'error',
        error: categorizeOpenError(reason),
      };
      terminalErrorRef.current = next;
      setError(next);
      notifyRef.current(next);
    });
    transitionRef.current = transition;
    return () => {
      clearPreparationTimeout();
      appStateSubscription.remove();
      preparing = false;
      if (preparationGenerationRef.current === generation)
        preparationGenerationRef.current += 1;
    };
  }, [props.source.uri, props.loadInactivityTimeoutMs]);

  useEffect(() => {
    if (
      lifecycle.appState !== 'active' ||
      terminalErrorRef.current ||
      !prepared ||
      prepared.sourceUri !== props.source.uri
    )
      return;

    const session = createNativeSession(
      prepared.sourceUri,
      () => currentSourceRef.current,
    );
    prepared.sessions.add(session);
    const generation = ++rendererGenerationRef.current;
    rendererOwnerRef.current = { generation, session };
    const rendererCurrent = () =>
      componentActiveRef.current &&
      appStateRef.current === 'active' &&
      currentSourceRef.current === prepared.sourceUri &&
      rendererGenerationRef.current === generation &&
      rendererOwnerRef.current?.generation === generation &&
      rendererOwnerRef.current.session === session;
    setRenderer({ generation, session, rendererCurrent });

    return () => {
      if (rendererOwnerRef.current?.generation === generation) {
        rendererGenerationRef.current += 1;
        rendererOwnerRef.current = undefined;
      }
      session.deactivate();
      void session
        .settled()
        .then(() => prepared.sessions.delete(session))
        .catch(() => undefined);
    };
    // lifecycle 对象参与依赖：epoch 只在真实状态转换时前进。同一 act 内
    // background→active 合并后字符串仍是 active，但 epoch 已变化，
    // 必须在这里重新创建 renderer。
  }, [lifecycle, prepared, props.source.uri]);

  useEffect(
    () => () => {
      preparationGenerationRef.current += 1;
      // Capture this generation's owner synchronously. Reading cleanupRef after
      // an awaited transition can accidentally dispose a StrictMode replay.
      const cleanup = cleanupRef.current;
      cleanupRef.current = async () => undefined;
      void cleanup().catch(() => undefined);
    },
    [],
  );

  const silentProps = { ...props, onStateChange: undefined };
  if (error) return <StaticReaderState props={silentProps} state={error} />;
  if (
    lifecycle.appState !== 'active' ||
    !prepared ||
    prepared.sourceUri !== props.source.uri ||
    !renderer
  )
    return (
      <StaticReaderState props={silentProps} state={{ status: 'loading' }} />
    );

  const source = {
    ...props.source,
    uri: prepared.uri,
    sessionRoot: prepared.sessionRoot,
    session: renderer.session,
    rendererCurrent: renderer.rendererCurrent,
  };
  return (
    <ReaderProvider key={renderer.generation}>
      <ReaderSession
        {...props}
        onStateChange={notifyRef.current}
        onTerminalError={(terminalError) => {
          const next: ReaderLoadState = {
            status: 'error',
            error: terminalError,
          };
          terminalErrorRef.current = next;
          setError(next);
          retireRendererRef.current();
        }}
        source={source}
      />
    </ReaderProvider>
  );
}
