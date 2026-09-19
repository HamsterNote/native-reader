import ePub, { type Book, type Rendition } from 'epubjs';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { createReaderGeneration } from './generation';
import { ReaderChrome } from './ReaderChrome';
import {
  categorizeOpenError,
  findSpineIndex,
  flattenToc,
  normalizeArchivePath,
  readerError,
  validateSource,
  type ReaderNavigation,
  type ReaderPublicationModel,
} from './shared';
import type { NativeReaderProps, ReaderLoadState } from './types';
import {
  isSafePublicationUrl,
  securePublicationDocument,
  securePublicationMarkup,
} from './webSecurity';

type EpubContents = {
  document: Document;
  window: Window;
};

const initialState: ReaderLoadState = { status: 'idle' };

function sameLoadState(left: ReaderLoadState, right: ReaderLoadState) {
  return (
    left.status === right.status &&
    (left.status !== 'error' ||
      (right.status === 'error' && left.error.code === right.error.code))
  );
}

export function NativeReader({
  source,
  onStateChange,
  style,
  testID,
}: NativeReaderProps) {
  const [state, setState] = useState<ReaderLoadState>(initialState);
  const [model, setModel] = useState<ReaderPublicationModel>();
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [navigationError, setNavigationError] =
    useState<ReturnType<typeof readerError>>();
  const containerRef = useRef<View>(null);
  const generationRef = useRef(0);
  const navigationRef = useRef<ReaderNavigation | undefined>(undefined);
  const currentIndexRef = useRef(-1);
  const stateChangeRef = useRef(onStateChange);
  const notifiedStateRef = useRef<ReaderLoadState | undefined>(undefined);
  stateChangeRef.current = onStateChange;

  const sourceUri = source?.uri;

  useEffect(() => {
    const generationNumber = ++generationRef.current;
    const generation = createReaderGeneration(
      generationNumber,
      () => generationRef.current,
    );
    setModel(undefined);
    setCurrentIndex(-1);
    currentIndexRef.current = -1;
    setNavigationError(undefined);
    navigationRef.current = undefined;

    const notify = (next: ReaderLoadState) => {
      if (!generation.current()) return;
      setState(next);
      if (
        notifiedStateRef.current &&
        sameLoadState(notifiedStateRef.current, next)
      )
        return;
      notifiedStateRef.current = next;
      stateChangeRef.current?.(next);
    };

    if (!sourceUri) {
      notify(initialState);
      return () => generation.dispose();
    }

    const sourceError = validateSource({ kind: 'uri', uri: sourceUri }, 'web');
    if (sourceError) {
      notify({ status: 'error', error: sourceError });
      return () => generation.dispose();
    }

    notify({ status: 'loading' });
    let book: Book | undefined;
    let rendition: Rendition | undefined;
    let stageTimeout: ReturnType<typeof setTimeout> | undefined;
    const clearStageTimeout = () => {
      if (stageTimeout) clearTimeout(stageTimeout);
      stageTimeout = undefined;
    };
    const fail = (error: ReturnType<typeof readerError>) => {
      if (!generation.current()) return;
      notify({ status: 'error', error });
      generation.dispose();
      if (generationRef.current === generationNumber)
        generationRef.current += 1;
    };
    const startStageTimeout = (milliseconds: number) => {
      clearStageTimeout();
      stageTimeout = setTimeout(
        () => fail(readerError('INVALID_EPUB')),
        milliseconds,
      );
    };
    startStageTimeout(3_000);
    generation.addCleanup(clearStageTimeout);
    generation.addCleanup(() => {
      (containerRef.current as unknown as Element | null)?.replaceChildren();
    });

    void (async () => {
      try {
        book = ePub(sourceUri, { openAs: 'epub' });
        const activeBook = book;
        generation.addCleanup(() => {
          try {
            rendition?.destroy();
          } finally {
            book?.destroy();
          }
        });
        await activeBook.ready;
        const metadata = await activeBook.loaded.metadata;
        if (/pre-paginated|fixed/i.test(metadata.layout ?? '')) {
          throw new Error('fixed-layout publication');
        }

        const [loadedSpine, navigation] = await Promise.all([
          activeBook.loaded.spine,
          activeBook.loaded.navigation,
        ]);
        const packagePath = activeBook.path.toString();
        startStageTimeout(3_000);
        const spineItems = Array.isArray(loadedSpine)
          ? loadedSpine
          : (
              loadedSpine as unknown as {
                spineItems: Array<{
                  cfiBase?: string;
                  href?: string;
                  index?: number;
                  linear?: boolean;
                }>;
              }
            ).spineItems;
        const spine = spineItems
          .filter(
            (item) =>
              item.linear !== false &&
              normalizeArchivePath(item.href ?? '', packagePath) !== undefined,
          )
          .map((item, index) => ({
            id: item.cfiBase || String(index),
            href: item.href ?? '',
            label: `Chapter ${index + 1}`,
            engineIndex: item.index,
          }));
        if (!spine.length) throw new Error('invalid publication spine');
        const publication: ReaderPublicationModel = {
          title: metadata.title,
          spine,
          toc: flattenToc(navigation.toc),
        };

        const element = containerRef.current as unknown as Element | null;
        if (!element || !generation.current()) return;
        const secureSerialization = (
          output: string,
          section: { output?: string },
        ) => {
          section.output = securePublicationMarkup(output);
        };
        activeBook.spine.hooks.serialize.register(secureSerialization);
        generation.addCleanup(() =>
          book?.spine.hooks.serialize.deregister(secureSerialization),
        );
        rendition = book.renderTo(element, {
          allowScriptedContent: false,
          flow: 'paginated',
          height: '100%',
          manager: 'default',
          spread: 'none',
          width: '100%',
        });
        const secureContents = (contents: EpubContents) => {
          securePublicationDocument(contents.document);
          contents.document.addEventListener('click', (event) => {
            const anchor = (event.target as Element | null)?.closest?.('a');
            const href = anchor?.getAttribute('href') ?? '';
            if (!isSafePublicationUrl(href)) {
              event.preventDefault();
              event.stopPropagation();
            }
          });
          contents.window.open = () => null;
        };
        rendition.hooks.content.register(secureContents);
        generation.addCleanup(() =>
          rendition?.hooks.content.deregister(secureContents),
        );

        const updateLocation = (location: {
          start?: { href?: string; index?: number };
        }) => {
          if (!generation.current()) return;
          const index = findSpineIndex(
            publication.spine,
            location.start?.href ?? '',
            location.start?.index,
          );
          if (index >= 0) {
            currentIndexRef.current = index;
            setCurrentIndex(index);
          }
        };
        rendition.on('relocated', updateLocation);
        generation.addCleanup(() =>
          rendition?.off('relocated', updateLocation),
        );

        const display = async (href: string, spineIndex?: number) => {
          const index = findSpineIndex(publication.spine, href);
          if (index < 0) {
            setNavigationError(readerError('RENDER_FAILED'));
            return;
          }
          try {
            if (spineIndex === undefined) await rendition?.display(href);
            else await rendition?.display(spineIndex);
            if (generation.current()) {
              currentIndexRef.current = index;
              setCurrentIndex(index);
              setNavigationError(undefined);
            }
          } catch {
            if (generation.current())
              setNavigationError(readerError('RENDER_FAILED'));
          }
        };
        navigationRef.current = {
          previous: async () => {
            const target = publication.spine[currentIndexRef.current - 1];
            if (target) await display(target.href, target.engineIndex);
          },
          next: async () => {
            const target = publication.spine[currentIndexRef.current + 1];
            if (target) await display(target.href, target.engineIndex);
          },
          navigate: display,
        };
        setModel(publication);
        await rendition.display(publication.spine[0]?.href);
        if (!generation.current()) return;
        currentIndexRef.current = 0;
        setCurrentIndex(0);
        clearStageTimeout();
        notify({ status: 'ready' });
      } catch (error) {
        fail(categorizeOpenError(error));
      }
    })();

    return () => generation.dispose();
  }, [sourceUri]);

  return (
    <ReaderChrome
      currentIndex={currentIndex}
      model={model}
      navigationError={navigationError}
      onNavigate={(href) => void navigationRef.current?.navigate(href)}
      onNext={() => void navigationRef.current?.next()}
      onPrevious={() => void navigationRef.current?.previous()}
      state={state}
      style={style}
      testID={testID}
    >
      <View ref={containerRef} style={{ flex: 1 }} testID="epub-web-viewport" />
    </ReaderChrome>
  );
}
