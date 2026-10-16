import type {
  ReaderErrorCategory,
  ReaderFormatError,
  ReaderPublicationLayout,
} from './types';
import type {
  ReaderPublicationModel,
  ReaderSpineItem,
  ReaderTocItem,
} from './shared';

export type FoliateBookSection = {
  id?: string | number;
  linear?: 'no' | string;
  title?: string;
};

export type FoliateBookTocItem = {
  destinationId?: string;
  id: string;
  label?: string;
  subitems?: readonly FoliateBookTocItem[];
};

export type FoliateBookDestination = {
  fragmentId?: string;
  sectionId: string | number;
};

export type FoliateBookInput = {
  destinations?: Readonly<Record<string, FoliateBookDestination | undefined>>;
  layout?: ReaderPublicationLayout;
  metadata?: { title?: string | Record<string, string | undefined> };
  sections?: readonly FoliateBookSection[];
  toc?: readonly FoliateBookTocItem[];
};

export type ReaderBookLocation = {
  fragmentId?: string;
  linearIndex?: number;
  sectionId: string;
  sectionIndex: number;
};

export type ReaderBookTocItem = {
  depth: number;
  destinationId?: string;
  id: string;
  label: string;
  location?: ReaderBookLocation;
  state: 'resolved' | 'unresolved';
};

/** UI-ready TOC node independent of EPUB href/archive fields. */
export type ReaderTocDisplayItem = {
  depth: number;
  destinationId?: string;
  disabled: boolean;
  id: string;
  label: string;
  location?: ReaderBookLocation;
  recoverable: boolean;
  resolution: 'resolved-linear' | 'resolved-nonlinear' | 'unresolved';
};

export type ReaderTocActivation =
  | { action: 'navigate'; location: ReaderBookLocation }
  | { action: 'recoverable-feedback'; itemId: string };

export type ReaderBookModel = {
  layout: ReaderPublicationLayout;
  displayToc: ReaderTocDisplayItem[];
  locations: Readonly<Record<string, ReaderBookLocation>>;
  model: ReaderPublicationModel;
  toc: ReaderBookTocItem[];
  activateToc(itemId: string): ReaderTocActivation;
  projectCurrentLocation(location: {
    fragmentId?: string;
    sectionId: string | number;
  }): ReaderBookLocation | undefined;
  resolveDestination(destinationId: string): ReaderBookLocation | undefined;
};

export type ReaderBookNormalization =
  | { status: 'ready'; book: ReaderBookModel }
  | { status: 'error'; error: ReaderFormatError };

const messages: Record<ReaderErrorCategory, string> = {
  drm: 'The publication is encrypted or DRM-protected.',
  invalid: 'The publication model is invalid.',
  read: 'The publication could not be read.',
  render: 'The publication could not be rendered.',
  unsupported: 'The publication model is unsupported.',
};

const error = (category: ReaderErrorCategory): ReaderBookNormalization => ({
  status: 'error',
  error: { category, message: messages[category] },
});

const titleOf = (metadata: FoliateBookInput['metadata']) => {
  const title = metadata?.title;
  return typeof title === 'string'
    ? title.trim() || undefined
    : Object.values(title ?? {})
        .find((value) => value?.trim())
        ?.trim();
};

/** Maps only explicit adapter categories; unknown parser values fail closed. */
export function mapFoliateBookFailure(failure: unknown): ReaderFormatError {
  const category =
    typeof failure === 'object' &&
    failure !== null &&
    'category' in failure &&
    typeof failure.category === 'string' &&
    Object.hasOwn(messages, failure.category)
      ? (failure.category as ReaderErrorCategory)
      : 'invalid';
  return { category, message: messages[category] };
}

/**
 * Format-neutral core model. Section/destination identifiers are opaque and
 * never require EPUB href/archive paths. `model` is a lossy legacy projection
 * retained only until ReaderChrome is migrated to `toc` and `locations`.
 */
export function normalizeFoliateBook(
  input: FoliateBookInput,
): ReaderBookNormalization {
  if (!input.sections?.length) return error('invalid');
  const sectionIndex = new Map<string, number>();
  const linearIndex = new Map<string, number>();
  const spine: ReaderSpineItem[] = [];
  input.sections.forEach((section, index) => {
    const id =
      section.id === undefined ? `section:${index}` : String(section.id);
    if (sectionIndex.has(id)) return;
    sectionIndex.set(id, index);
    if (section.linear !== 'no') {
      linearIndex.set(id, spine.length);
      spine.push({
        id,
        idref: id,
        href: id,
        archiveKey: id,
        engineIndex: index,
        label: section.title?.trim() || `Section ${spine.length + 1}`,
      });
    }
  });
  if (sectionIndex.size !== input.sections.length) return error('invalid');
  if (!spine.length) return error('unsupported');

  const resolveDestination = (destinationId: string) => {
    const destination = input.destinations?.[destinationId];
    if (!destination) return undefined;
    const sectionId = String(destination.sectionId);
    const sectionIndexValue = sectionIndex.get(sectionId);
    if (sectionIndexValue === undefined) return undefined;
    return {
      sectionId,
      sectionIndex: sectionIndexValue,
      linearIndex: linearIndex.get(sectionId),
      fragmentId: destination.fragmentId,
    };
  };
  const locations = Object.fromEntries(
    Object.keys(input.destinations ?? {}).flatMap((id) => {
      const location = resolveDestination(id);
      return location ? [[id, location]] : [];
    }),
  );
  const toc: ReaderBookTocItem[] = [];
  const displayToc: ReaderTocDisplayItem[] = [];
  const legacyToc: ReaderTocItem[] = [];
  const flatten = (
    items: readonly FoliateBookTocItem[] | undefined,
    depth: number,
  ) => {
    for (const item of items ?? []) {
      const location = item.destinationId
        ? resolveDestination(item.destinationId)
        : undefined;
      const label = item.label?.trim() || item.id;
      toc.push({
        id: item.id,
        label,
        depth,
        destinationId: item.destinationId,
        location,
        state: location ? 'resolved' : 'unresolved',
      });
      displayToc.push({
        id: item.id,
        label,
        depth,
        destinationId: item.destinationId,
        location,
        disabled: !location,
        recoverable: !location,
        resolution: !location
          ? 'unresolved'
          : location.linearIndex === undefined
            ? 'resolved-nonlinear'
            : 'resolved-linear',
      });
      if (location?.linearIndex !== undefined) {
        const target = spine[location.linearIndex];
        legacyToc.push({
          id: item.id,
          label,
          depth,
          href: item.destinationId ?? item.id,
          archiveKey: target.archiveKey,
          targetHref: target.href,
          targetEngineIndex: target.engineIndex,
          targetFragment: location.fragmentId,
        });
      }
      flatten(item.subitems, depth + 1);
    }
  };
  flatten(input.toc, 0);
  const activateToc = (itemId: string): ReaderTocActivation => {
    const item = displayToc.find((candidate) => candidate.id === itemId);
    return item?.location
      ? { action: 'navigate', location: item.location }
      : { action: 'recoverable-feedback', itemId };
  };
  return {
    status: 'ready',
    book: {
      layout: input.layout ?? 'reflowable',
      displayToc,
      locations,
      model: { title: titleOf(input.metadata), spine, toc: legacyToc },
      toc,
      activateToc,
      projectCurrentLocation(location) {
        const sectionId = String(location.sectionId);
        const sectionIndexValue = sectionIndex.get(sectionId);
        return sectionIndexValue === undefined
          ? undefined
          : {
              sectionId,
              sectionIndex: sectionIndexValue,
              linearIndex: linearIndex.get(sectionId),
              fragmentId: location.fragmentId,
            };
      },
      resolveDestination,
    },
  };
}
