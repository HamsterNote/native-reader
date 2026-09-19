import type { ReaderError, ReaderErrorCode, ReaderSource } from './types';

export type ReaderSpineItem = {
  id: string;
  href: string;
  label: string;
  engineIndex?: number;
};

export type ReaderTocItem = {
  id: string;
  href: string;
  label: string;
  depth: number;
};

export type ReaderPublicationModel = {
  title?: string;
  spine: ReaderSpineItem[];
  toc: ReaderTocItem[];
};

export type ReaderNavigation = {
  previous(): Promise<void> | void;
  next(): Promise<void> | void;
  navigate(href: string): Promise<void> | void;
};

type TocInput = {
  id?: string;
  href?: string;
  label?: string;
  subitems?: TocInput[];
};

export type SpineInput = {
  id?: string;
  href?: string;
  linear?: boolean;
};

const messages: Record<ReaderErrorCode, string> = {
  UNSUPPORTED_SOURCE: 'Only a local EPUB URI is supported.',
  READ_FAILED: 'The EPUB file could not be read.',
  INVALID_EPUB: 'The file is not a valid EPUB publication.',
  UNSUPPORTED_EPUB: 'This EPUB publication profile is not supported.',
  RENDER_FAILED: 'The EPUB publication could not be displayed.',
};

export function readerError(code: ReaderErrorCode): ReaderError {
  return { code, message: messages[code] };
}

export function validateSource(
  source: ReaderSource,
  platform: 'native' | 'web',
): ReaderError | undefined {
  const uri = source.uri.trim();
  if (!uri || /^https?:\/\//i.test(uri) || /^javascript:/i.test(uri))
    return readerError('UNSUPPORTED_SOURCE');

  const allowed =
    platform === 'web'
      ? uri.startsWith('blob:')
      : /^(file|content):\/\//i.test(uri);
  return allowed ? undefined : readerError('UNSUPPORTED_SOURCE');
}

export function categorizeOpenError(error: unknown): ReaderError {
  const message = error instanceof Error ? error.message : String(error);
  if (/fixed.?layout|pre-paginated|drm|encrypted|media.?overlay/i.test(message))
    return readerError('UNSUPPORTED_EPUB');
  if (/fetch|read|permission|not found|no such file|network/i.test(message))
    return readerError('READ_FAILED');
  if (/render|display|iframe|webview/i.test(message))
    return readerError('RENDER_FAILED');
  return readerError('INVALID_EPUB');
}

export function flattenToc(items: TocInput[], depth = 0): ReaderTocItem[] {
  return items.flatMap((item, index) => {
    const href = item.href?.trim();
    const current = href
      ? [
          {
            id: item.id || `${depth}-${index}-${href}`,
            href,
            label: item.label?.trim() || href,
            depth,
          },
        ]
      : [];
    return current.concat(flattenToc(item.subitems ?? [], depth + 1));
  });
}

export function buildSpine(
  items: SpineInput[],
  toc: ReaderTocItem[],
): ReaderSpineItem[] {
  return items
    .filter(
      (item) =>
        item.linear !== false && isPublicationHref(item.href?.trim() ?? ''),
    )
    .map((item, index) => {
      const href = item.href?.trim() ?? '';
      return {
        id: item.id || String(index),
        href,
        label:
          toc.find(
            (tocItem) => hrefDocument(tocItem.href) === hrefDocument(href),
          )?.label ?? `Chapter ${index + 1}`,
      };
    });
}

export function normalizeArchivePath(
  href: string,
  base = '',
): string | undefined {
  let value = href.trim().split(/[?#]/, 1)[0] ?? '';
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  try {
    value = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  value = value.replace(/\\/g, '/');
  if (
    !value ||
    value.startsWith('/') ||
    value.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  )
    return undefined;
  const basePath = base ? normalizeArchivePath(base.replace(/^\/+/, '')) : '';
  if (base && basePath === undefined) return undefined;
  const parts = basePath?.split('/').filter(Boolean) ?? [];
  if (parts.length) parts.pop();
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length ? parts.join('/') : undefined;
}

export function hrefDocument(href: string): string {
  return normalizeArchivePath(href) ?? '';
}

export function isPublicationHref(href: string): boolean {
  return normalizeArchivePath(href) !== undefined;
}

export function findSpineIndex(
  spine: ReaderSpineItem[],
  href: string,
  reportedIndex?: number,
): number {
  const target = hrefDocument(href);
  if (!target) return -1;
  if (
    reportedIndex !== undefined &&
    reportedIndex >= 0 &&
    reportedIndex < spine.length &&
    hrefDocument(spine[reportedIndex]?.href ?? '') === target
  )
    return reportedIndex;
  return spine.findIndex((item) => hrefDocument(item.href) === target);
}

export function canLoadNavigationTarget(
  model: ReaderPublicationModel,
  href: string,
): boolean {
  return Boolean(href) && findSpineIndex(model.spine, href) >= 0;
}
