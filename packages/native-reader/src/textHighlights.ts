import { useRef, useState } from 'react';
import type { ReaderPdfHighlightPage } from './pdf/contracts';
import type { NativeReaderProps } from './types';

export type ReaderTextHighlight = {
  id: string;
  text: string;
  createdAt: number;
  color: string;
  anchor:
    | { kind: 'pdf'; pages: ReaderPdfHighlightPage[] }
    | { kind: 'epub-cfi'; cfi: string };
};
export type ReaderHighlightsChangeDetail = {
  action: 'create' | 'remove';
  id: string;
  documentId: string | undefined;
};

export function useTextHighlights(props: NativeReaderProps) {
  const [internal, setInternal] = useState<{
    source: NativeReaderProps['source'];
    documentId: string | undefined;
    values: readonly ReaderTextHighlight[];
  }>(() => ({
    source: props.source,
    documentId: props.documentId,
    values: props.defaultHighlights ?? [],
  }));
  const local =
    internal.source === props.source && internal.documentId === props.documentId
      ? internal.values
      : (props.defaultHighlights ?? []);
  const values = props.highlights ?? local;
  const latest = useRef({ props, values });
  latest.current = { props, values };
  const commit = (
    highlight: ReaderTextHighlight,
    action: 'create' | 'remove',
  ) => {
    const active = latest.current;
    if (
      active.props.source !== props.source ||
      active.props.documentId !== props.documentId
    )
      return;
    const exists = active.values.some((item) => item.id === highlight.id);
    if ((action === 'create' && exists) || (action === 'remove' && !exists))
      return;
    const next =
      action === 'create'
        ? [...active.values, highlight]
        : active.values.filter((item) => item.id !== highlight.id);
    latest.current = { props: active.props, values: next };
    if (active.props.highlights === undefined)
      setInternal({
        source: props.source,
        documentId: props.documentId,
        values: next,
      });
    active.props.onHighlightsChange?.(next, {
      action,
      id: highlight.id,
      documentId: props.documentId,
    });
  };
  return { values, commit };
}

export function isPdfAnchor(
  value: unknown,
): value is { kind: 'pdf'; pages: ReaderPdfHighlightPage[] } {
  if (
    !isRecord(value) ||
    value.kind !== 'pdf' ||
    !Array.isArray(value.pages) ||
    !value.pages.length ||
    value.pages.length > 64
  )
    return false;
  let previous = 0;
  let count = 0;
  return value.pages.every((page) => {
    if (
      !isRecord(page) ||
      !Number.isSafeInteger(page.pageNumber) ||
      (page.pageNumber as number) <= previous ||
      !Number.isSafeInteger(page.startOffset) ||
      (page.startOffset as number) < 0 ||
      !Number.isSafeInteger(page.endOffset) ||
      (page.endOffset as number) <= (page.startOffset as number) ||
      !Array.isArray(page.rects) ||
      !page.rects.length
    )
      return false;
    previous = page.pageNumber as number;
    count += page.rects.length;
    return (
      count <= 64 &&
      page.rects.every(
        (rect) =>
          isRecord(rect) &&
          ['x', 'y', 'width', 'height'].every(
            (key) =>
              typeof rect[key] === 'number' &&
              Number.isFinite(rect[key]) &&
              rect[key] >= 0 &&
              rect[key] <= 1,
          ) &&
          (rect.width as number) > 0 &&
          (rect.height as number) > 0 &&
          (rect.x as number) + (rect.width as number) <= 1.000001 &&
          (rect.y as number) + (rect.height as number) <= 1.000001,
      )
    );
  });
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function isTextHighlight(value: unknown): value is ReaderTextHighlight {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    value.id.length > 256 ||
    typeof value.text !== 'string' ||
    !value.text.trim() ||
    value.text.length > 8192 ||
    !Number.isSafeInteger(value.createdAt) ||
    (value.createdAt as number) < 0 ||
    typeof value.color !== 'string' ||
    !/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value.color) ||
    !isRecord(value.anchor)
  )
    return false;
  return value.anchor.kind === 'pdf'
    ? isPdfAnchor(value.anchor)
    : value.anchor.kind === 'epub-cfi' &&
        typeof value.anchor.cfi === 'string' &&
        value.anchor.cfi.length <= 8192 &&
        /^epubcfi\(.+\)$/.test(value.anchor.cfi);
}
