import ePub, { type Book, type Rendition } from 'epubjs';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { createReaderGeneration } from './generation';
import { ReaderChrome } from './ReaderChrome';
import {
  buildSpine,
  categorizeOpenError,
  extractErrorMessage,
  findSpineIndex,
  flattenToc,
  normalizeArchivePath,
  readerError,
  validatePublicationProfile,
  validateSource,
  type PublicationProfile,
  type ReaderNavigation,
  type ReaderPublicationModel,
} from './shared';
import type { NativeReaderProps, ReaderLoadState } from './types';
import {
  isSafePublicationNavigationUrl,
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
  loadInactivityTimeoutMs,
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
    const timeoutMs =
      loadInactivityTimeoutMs === undefined ||
      !Number.isFinite(loadInactivityTimeoutMs) ||
      loadInactivityTimeoutMs < 0
        ? 15_000
        : loadInactivityTimeoutMs;
    const startStageTimeout = () => {
      clearStageTimeout();
      if (timeoutMs === 0) return;
      stageTimeout = setTimeout(
        () => fail(readerError('LOAD_TIMEOUT')),
        timeoutMs,
      );
    };
    startStageTimeout();
    generation.addCleanup(clearStageTimeout);
    generation.addCleanup(() => {
      (containerRef.current as unknown as Element | null)?.replaceChildren();
    });

    void (async () => {
      try {
        book = ePub(sourceUri, { openAs: 'epub' });
        const activeBook = book;
        const handleOpenFailed = (error: unknown) => {
          fail(categorizeOpenError(error));
        };
        activeBook.on('openFailed', handleOpenFailed);
        generation.addCleanup(() => {
          try {
            activeBook.off('openFailed', handleOpenFailed);
            rendition?.destroy();
          } finally {
            book?.destroy();
          }
        });
        await activeBook.ready;
        const metadata = await activeBook.loaded.metadata;
        const [loadedSpine, navigation] = await Promise.all([
          activeBook.loaded.spine,
          activeBook.loaded.navigation,
        ]);
        // Container.packagePath is the untouched rootfile full-path parsed from
        // META-INF/container.xml. Validate it before accepting epub.js' resolved
        // Path, which adds one archive-root slash for otherwise relative paths.
        // epubjs' runtime Container exposes packagePath, but 0.3.x omits it
        // from types/container.d.ts.
        const rawPackagePath = (
          activeBook.container as unknown as { packagePath?: unknown }
        )?.packagePath;
        const packagePath =
          typeof rawPackagePath === 'string'
            ? normalizeArchivePath(rawPackagePath)
            : undefined;
        const packageRequestPath = activeBook.path.toString();
        const enginePackagePath = normalizeArchivePath(
          packageRequestPath.startsWith('/')
            ? packageRequestPath.slice(1)
            : packageRequestPath,
        );
        if (!packagePath || enginePackagePath !== packagePath)
          throw new Error('invalid package path');
        startStageTimeout();
        const spineItems = Array.isArray(loadedSpine)
          ? loadedSpine
          : (
              loadedSpine as unknown as {
                spineItems: Array<{
                  cfiBase?: string;
                  href?: string;
                  idref?: string;
                  index?: number;
                  linear?: boolean;
                  properties?: string[];
                }>;
              }
            ).spineItems;
        const spineInputs: Array<{
          href?: string;
          idref?: string;
          linear: boolean;
          engineIndex: number;
          properties: string[];
        }> = (
          spineItems as Array<{
            href?: string;
            idref?: string;
            index?: number;
            linear?: boolean | string;
            properties?: string[];
          }>
        ).map((item, index) => ({
          href: item.href,
          idref: item.idref,
          linear: item.linear !== false && item.linear !== 'no',
          engineIndex: Number.isInteger(item.index)
            ? (item.index as number)
            : index,
          properties: Array.isArray(item.properties) ? item.properties : [],
        }));
        const initialSpine = buildSpine(spineInputs, [], packagePath);
        if (!initialSpine.length) throw new Error('invalid publication spine');
        const packaging = (
          activeBook as unknown as {
            packaging?: { navPath?: string; ncxPath?: string };
          }
        ).packaging;
        const rawNavigationPath = packaging?.navPath ?? packaging?.ncxPath;
        const navigationPath = rawNavigationPath
          ? normalizeArchivePath(rawNavigationPath, packagePath)
          : packagePath;
        if (!navigationPath) throw new Error('invalid navigation path');
        const archive = (
          activeBook as unknown as {
            archive?: {
              request(path: string, type: string): Promise<Document>;
            };
          }
        ).archive;
        const malformedXml = (document: Document | undefined) =>
          !document?.documentElement ||
          document.getElementsByTagName('parsererror').length > 0;
        const missingOptionalFile = (error: unknown) => {
          const message = extractErrorMessage(error);
          return message.startsWith('File not found in the epub');
        };
        const xmlElements = (document: Document, localName: string) =>
          Array.from(document.getElementsByTagName('*')).filter(
            (element) =>
              element.localName === localName || element.nodeName === localName,
          );
        const readPackageLayouts = async (): Promise<string[]> => {
          if (!archive) throw new Error('publication archive is unavailable');
          const document = await archive.request(packageRequestPath, 'xml');
          if (malformedXml(document)) throw new Error('malformed package XML');
          return xmlElements(document, 'meta')
            .filter(
              (element) =>
                element.getAttribute('property') === 'rendition:layout',
            )
            .map((element) => String(element.textContent ?? ''));
        };
        const readIBooksDisplayOptions = async (): Promise<
          PublicationProfile['iBooksDisplayOptions']
        > => {
          if (!archive) return { state: 'malformed' };
          try {
            const document = await archive.request(
              '/META-INF/com.apple.ibooks.display-options.xml',
              'xml',
            );
            if (malformedXml(document)) return { state: 'malformed' };
            return {
              state: 'parsed',
              fixedLayouts: xmlElements(document, 'option')
                .filter(
                  (element) => element.getAttribute('name') === 'fixed-layout',
                )
                .map((element) => String(element.textContent ?? '')),
            };
          } catch (error) {
            return {
              state: missingOptionalFile(error) ? 'absent' : 'malformed',
            };
          }
        };
        const readEncryption = async (): Promise<
          PublicationProfile['encryption']
        > => {
          if (!archive) return { state: 'malformed' };
          try {
            const document = await archive.request(
              '/META-INF/encryption.xml',
              'xml',
            );
            if (malformedXml(document)) return { state: 'malformed' };
            return {
              state: 'parsed',
              algorithms: xmlElements(document, 'EncryptionMethod')
                .map((element) => element.getAttribute('Algorithm')?.trim())
                .filter((value): value is string => Boolean(value)),
              resourceUris: xmlElements(document, 'CipherReference')
                .map((element) => element.getAttribute('URI')?.trim())
                .filter((value): value is string => Boolean(value)),
            };
          } catch (error) {
            return {
              state: missingOptionalFile(error) ? 'absent' : 'malformed',
            };
          }
        };
        const manifest = (
          activeBook as unknown as {
            packaging?: {
              manifest?: Record<
                string,
                { overlay?: string; 'media-overlay'?: string }
              >;
            };
          }
        ).packaging?.manifest;
        const profile: PublicationProfile = {
          packageLayouts: await readPackageLayouts(),
          spineLayouts: spineInputs.flatMap((item) =>
            item.properties
              .filter((property) => /(?:^|:)layout-/i.test(property))
              .map((value) => ({ engineIndex: item.engineIndex, value })),
          ),
          iBooksDisplayOptions: await readIBooksDisplayOptions(),
          mediaOverlayItemIds: Object.entries(manifest ?? {})
            .filter(([, item]) => item.overlay || item['media-overlay'])
            .map(([id]) => id),
          encryption: await readEncryption(),
        };
        const profileError = validatePublicationProfile(
          profile,
          spineInputs.map((item) => item.engineIndex),
        );
        if (profileError) {
          notify({ status: 'error', error: profileError });
          generation.dispose();
          return;
        }
        const toc = flattenToc(navigation.toc, navigationPath, 0, initialSpine);
        const spine = initialSpine.map((item, index) => ({
          ...item,
          label:
            toc.find((tocItem) => tocItem.archiveKey === item.archiveKey)
              ?.label ?? `Chapter ${index + 1}`,
        }));
        const publication: ReaderPublicationModel = {
          title: metadata.title,
          spine,
          toc,
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
            const anchor = (event.target as Element | null)?.closest?.(
              'a, area',
            );
            const href =
              anchor?.getAttribute('href') ??
              anchor?.getAttribute('xlink:href') ??
              '';
            if (anchor && !isSafePublicationNavigationUrl(href)) {
              event.preventDefault();
              event.stopPropagation();
            }
          });
          contents.document.addEventListener('submit', (event) => {
            event.preventDefault();
            event.stopPropagation();
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

        const display = async (
          href: string,
          spineIndex?: number,
          fragment?: string,
        ) => {
          const index = findSpineIndex(
            publication.spine,
            href,
            spineIndex,
            packagePath,
          );
          if (index < 0) {
            setNavigationError(readerError('RENDER_FAILED'));
            return;
          }
          try {
            if (fragment && spineIndex !== undefined) {
              const section = activeBook.spine.get(spineIndex);
              if (!section) throw new Error('navigation section was not found');
              await section.load(activeBook.load.bind(activeBook));
              let decodedFragment: string;
              try {
                decodedFragment = decodeURIComponent(fragment);
              } catch {
                throw new Error('invalid navigation fragment');
              }
              const target = section.document?.getElementById(decodedFragment);
              if (!target) throw new Error('navigation fragment was not found');
              await rendition?.display(section.cfiFromElement(target));
            } else if (spineIndex === undefined) await rendition?.display(href);
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
          navigate: async (item) =>
            display(
              item.targetHref,
              item.targetEngineIndex,
              item.targetFragment,
            ),
        };
        setModel(publication);
        try {
          await rendition.display(publication.spine[0]?.engineIndex);
        } catch {
          // Initial display belongs to the render phase regardless of the
          // thrown value/message, matching Native publicationError(render).
          fail(readerError('RENDER_FAILED'));
          return;
        }
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
  }, [sourceUri, loadInactivityTimeoutMs]);

  return (
    <ReaderChrome
      currentIndex={currentIndex}
      model={model}
      navigationError={navigationError}
      onNavigate={(item) => void navigationRef.current?.navigate(item)}
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
