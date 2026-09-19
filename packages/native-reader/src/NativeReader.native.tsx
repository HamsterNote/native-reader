import {
  Reader,
  ReaderProvider,
  useReader,
  type Location,
  type Section,
  type Toc,
} from '@epubjs-react-native/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { ReaderChrome } from './ReaderChrome';
import { createExpoFileSystem } from './expoFileSystem';
import { createNativeSession, type NativeSession } from './nativeSession';
import { prepareNativeSource } from './nativeSource';
import { continueAfterBestEffortCleanup } from './nativeTransition';
import {
  buildSpine,
  categorizeOpenError,
  findSpineIndex,
  flattenToc,
  readerError,
  validateSource,
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
  };
};

function StaticReaderState({
  props,
  state,
}: {
  props: NativeReaderProps;
  state: ReaderLoadState;
}) {
  const notifiedStateRef = useRef<ReaderLoadState | undefined>(undefined);
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

function ReaderSession({ source, onStateChange, style, testID }: SessionProps) {
  const { getMeta, goToLocation } = useReader();
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
  stateChangeRef.current = onStateChange;
  const fileSystem = useMemo(
    () => createExpoFileSystem(source.sessionRoot ?? '', source.session),
    [source.session, source.sessionRoot],
  );
  const active = () => source.session.active();
  const notify = (next: ReaderLoadState) => {
    if (!active()) return;
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

  useEffect(() => {
    const loading: ReaderLoadState = { status: 'loading' };
    setState(loading);
    timeoutRef.current = setTimeout(
      () => fail('reader opening timeout'),
      15_000,
    );
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      source.session.deactivate();
    };
  }, [source.session, source.uri]);

  const fail = (reason: string) => {
    if (!active()) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const next: ReaderLoadState = {
      status: 'error',
      error: categorizeOpenError(new Error(reason)),
    };
    notify(next);
  };

  return (
    <ReaderChrome
      currentIndex={currentIndex}
      model={model}
      navigationError={navigationError}
      onNavigate={(href) => {
        if (findSpineIndex(model?.spine ?? [], href) < 0) {
          setNavigationError(readerError('RENDER_FAILED'));
          return;
        }
        setNavigationError(undefined);
        goToLocation(href);
      }}
      onNext={() => {
        const target = model?.spine[currentIndex + 1];
        if (target) goToLocation(target.href);
      }}
      onPrevious={() => {
        const target = model?.spine[currentIndex - 1];
        if (target) goToLocation(target.href);
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
          onDisplayError={fail}
          onLocationChange={(
            _total: number,
            location: Location,
            _progress: number,
            section: Section | null,
          ) => {
            if (!active()) return;
            const href = section?.href ?? location.start.href;
            const reportedIndex =
              (section as (Section & { index?: number }) | null)?.index ??
              (location.start as typeof location.start & { index?: number })
                .index;
            const index = findSpineIndex(
              model?.spine ?? [],
              href,
              reportedIndex,
            );
            if (index >= 0) setCurrentIndex(index);
          }}
          onNavigationLoaded={({ toc }: { toc: Toc }) => {
            if (!active()) return;
            const flatToc = flattenToc(toc);
            setModel((current) => ({
              title: getMeta().title,
              spine: current?.spine ?? [],
              toc: flatToc,
            }));
          }}
          onPressExternalLink={undefined}
          onReady={() => {
            if (!active()) return;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            const ready: ReaderLoadState = { status: 'ready' };
            setCurrentIndex((value) => (value < 0 ? 0 : value));
            notify(ready);
          }}
          onWebViewMessage={(event: {
            type?: string;
            spine?: Array<{
              id?: string;
              href?: string;
              linear?: boolean;
            }>;
            reason?: string;
          }) => {
            if (!active()) return;
            if (event.type === 'publicationError') {
              fail(event.reason || 'unsupported publication');
            }
            if (event.type === 'publicationLoaded') {
              setModel((current) => ({
                title: getMeta().title,
                spine: buildSpine(event.spine ?? [], current?.toc ?? []),
                toc: current?.toc ?? [],
              }));
            }
          }}
          spread="none"
          src={source.uri}
          width="100%"
        />
      </View>
    </ReaderChrome>
  );
}

export function NativeReader(props: NativeReaderProps) {
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
    session: NativeSession;
  }>();
  const [error, setError] = useState<ReaderLoadState>();
  const stateChangeRef = useRef(props.onStateChange);
  const generationRef = useRef(0);
  const cleanupRef = useRef<() => Promise<void>>(async () => undefined);
  const transitionRef = useRef<Promise<void>>(Promise.resolve());
  const notifiedStatusRef = useRef<ReaderLoadState | undefined>(undefined);
  const currentSourceRef = useRef(props.source.uri);
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

  useEffect(() => {
    const generation = ++generationRef.current;
    setPrepared(undefined);
    setError(undefined);
    notify({ status: 'loading' });
    const previousCleanup = cleanupRef.current;
    cleanupRef.current = async () => undefined;
    const transition = continueAfterBestEffortCleanup(
      transitionRef.current,
      previousCleanup,
      async () => {
        if (generationRef.current !== generation) return;
        const prepared = await prepareNativeSource(props.source.uri);
        if (generationRef.current !== generation) {
          await prepared.cleanup();
          return;
        }
        const session = createNativeSession(
          props.source.uri,
          () => currentSourceRef.current,
        );
        cleanupRef.current = async () => {
          session.deactivate();
          await session.settled();
          await prepared.cleanup();
        };
        setPrepared({
          sourceUri: props.source.uri,
          uri: prepared.uri,
          sessionRoot: prepared.sessionRoot,
          session,
        });
      },
    ).catch((reason: unknown) => {
      if (generationRef.current !== generation) return;
      const next: ReaderLoadState = {
        status: 'error',
        error: categorizeOpenError(reason),
      };
      setError(next);
      notify(next);
    });
    transitionRef.current = transition;
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [props.source.uri]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      void transitionRef.current
        .catch(() => undefined)
        .then(() => cleanupRef.current())
        .catch(() => undefined);
    },
    [],
  );

  const silentProps = { ...props, onStateChange: undefined };
  if (error) return <StaticReaderState props={silentProps} state={error} />;
  if (!prepared || prepared.sourceUri !== props.source.uri)
    return (
      <StaticReaderState props={silentProps} state={{ status: 'loading' }} />
    );

  const source = {
    ...props.source,
    uri: prepared.uri,
    sessionRoot: prepared.sessionRoot,
    session: prepared.session,
  };
  return (
    <ReaderProvider key={prepared.uri}>
      <ReaderSession {...props} source={source} />
    </ReaderProvider>
  );
}
