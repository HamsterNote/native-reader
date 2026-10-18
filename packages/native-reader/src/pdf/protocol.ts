import type {
  PdfPageState,
  PdfSelection,
  PdfSessionIdentity,
  PdfThumbnail,
  PdfLoadState,
} from './contracts';
import type { ReaderTextHighlight } from '../textHighlights';

export const PDF_PROTOCOL = 'hamster-pdf';
export const PDF_PROTOCOL_VERSION = 2;
export const MAX_WEB_PDF_BYTES = 128 * 1024 * 1024;
type Envelope = PdfSessionIdentity & {
  protocol: typeof PDF_PROTOCOL;
  version: 2;
  commandId: number;
};
export type PdfCommand = Envelope &
  (
    | { type: 'open'; bytes: ArrayBuffer }
    | { type: 'navigate' | 'thumbnail'; pageNumber: number }
    | { type: 'scale'; scale: number }
    | { type: 'clear' | 'rotate' | 'dispose' }
    | { type: 'highlights'; highlights: ReaderTextHighlight[] }
  );
export type PdfEvent = Envelope &
  (
    | { type: 'boot' }
    | { type: 'state'; state: PdfLoadState }
    | { type: 'page'; page: PdfPageState }
    | { type: 'selection'; selection: PdfSelection | null }
    | {
        type: 'highlight-hit';
        id: string;
        rect: { x: number; y: number; width: number; height: number };
      }
    | { type: 'selection-error'; message: string | null }
    | { type: 'result'; result: boolean | PdfThumbnail | null }
  );
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype ||
    Object.getPrototypeOf(v) === null);
const fields = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((key) => allowed.includes(key));
const keys = (v: Record<string, unknown>, extra: string[]) =>
  Object.keys(v).every((key) =>
    [
      'protocol',
      'version',
      'sessionId',
      'generation',
      'commandId',
      'type',
      ...extra,
    ].includes(key),
  );
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= max;
const anchor = (v: unknown) => {
  if (
    !record(v) ||
    !fields(v, ['kind', 'pages']) ||
    v.kind !== 'pdf' ||
    !Array.isArray(v.pages) ||
    !v.pages.length ||
    v.pages.length > 64
  )
    return false;
  let count = 0;
  let previous = 0;
  return v.pages.every((p: unknown) => {
    if (
      !record(p) ||
      !fields(p, ['pageNumber', 'startOffset', 'endOffset', 'rects']) ||
      !integer(p.pageNumber, 100000) ||
      p.pageNumber <= previous ||
      !Number.isSafeInteger(p.startOffset) ||
      (p.startOffset as number) < 0 ||
      !integer(p.endOffset) ||
      p.endOffset <= (p.startOffset as number) ||
      !Array.isArray(p.rects) ||
      !p.rects.length
    )
      return false;
    previous = p.pageNumber;
    count += p.rects.length;
    return (
      count <= 64 &&
      p.rects.every(
        (r: unknown) =>
          record(r) &&
          fields(r, ['x', 'y', 'width', 'height']) &&
          ['x', 'y', 'width', 'height'].every(
            (key) =>
              typeof r[key] === 'number' &&
              Number.isFinite(r[key]) &&
              (r[key] as number) >= 0 &&
              (r[key] as number) <= 1,
          ) &&
          (r.width as number) > 0 &&
          (r.height as number) > 0 &&
          (r.x as number) + (r.width as number) <= 1.000001 &&
          (r.y as number) + (r.height as number) <= 1.000001,
      )
    );
  });
};
const highlights = (v: unknown) =>
  Array.isArray(v) &&
  v.length <= 1000 &&
  v.every(
    (h: unknown) =>
      record(h) &&
      fields(h, ['id', 'text', 'color', 'createdAt', 'anchor']) &&
      typeof h.id === 'string' &&
      h.id.length > 0 &&
      h.id.length <= 256 &&
      typeof h.text === 'string' &&
      h.text.length > 0 &&
      h.text.length <= 8192 &&
      Number.isSafeInteger(h.createdAt) &&
      (h.createdAt as number) >= 0 &&
      typeof h.color === 'string' &&
      /^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(h.color) &&
      anchor(h.anchor),
  ) &&
  new Set(v.map((h) => h.id)).size === v.length &&
  JSON.stringify(v).length <= 2_000_000;
export const samePdfIdentity = (
  v: unknown,
  identity: PdfSessionIdentity,
): boolean =>
  record(v) &&
  v.sessionId === identity.sessionId &&
  v.generation === identity.generation;
const page = (v: unknown, identity: PdfSessionIdentity) =>
  record(v) &&
  samePdfIdentity(v, identity) &&
  fields(v, ['sessionId', 'generation', 'pageNumber', 'pageCount', 'status']) &&
  integer(v.pageCount, 100000) &&
  integer(v.pageNumber, v.pageCount);
const thumbnail = (v: unknown, identity: PdfSessionIdentity) =>
  record(v) &&
  samePdfIdentity(v, identity) &&
  fields(v, [
    'sessionId',
    'generation',
    'pageNumber',
    'width',
    'height',
    'uri',
  ]) &&
  integer(v.pageNumber, 100000) &&
  integer(v.width, 112) &&
  integer(v.height, 150) &&
  typeof v.uri === 'string' &&
  v.uri.length <= 200000 &&
  /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v.uri);
const selection = (v: unknown, identity: PdfSessionIdentity) =>
  v === null ||
  (record(v) &&
    samePdfIdentity(v, identity) &&
    fields(v, [
      'sessionId',
      'generation',
      'selectionId',
      'text',
      'rects',
      'coordinateSpace',
      'anchor',
    ]) &&
    v.coordinateSpace === 'reader' &&
    (v.anchor === undefined || anchor(v.anchor)) &&
    typeof v.selectionId === 'string' &&
    v.selectionId.length <= 128 &&
    typeof v.text === 'string' &&
    v.text.length > 0 &&
    v.text.length <= 8192 &&
    Array.isArray(v.rects) &&
    v.rects.length > 0 &&
    v.rects.length <= 64 &&
    v.rects.every(
      (r: unknown) =>
        record(r) &&
        fields(r, ['x', 'y', 'width', 'height']) &&
        ['x', 'y', 'width', 'height'].every(
          (key) =>
            typeof r[key] === 'number' &&
            Number.isFinite(r[key]) &&
            Math.abs(r[key] as number) <= 100000,
        ) &&
        (r.width as number) > 0 &&
        (r.height as number) > 0,
    ));
const state = (v: unknown, identity: PdfSessionIdentity) =>
  record(v) &&
  samePdfIdentity(v, identity) &&
  ((v.status === 'loading' &&
    fields(v, ['sessionId', 'generation', 'status'])) ||
    (v.status === 'ready' && page(v, identity)) ||
    (v.status === 'error' &&
      fields(v, ['sessionId', 'generation', 'status', 'error']) &&
      record(v.error) &&
      fields(v.error, ['category', 'code', 'message']) &&
      ['read', 'invalid', 'unsupported', 'drm', 'render'].includes(
        String(v.error.category),
      ) &&
      typeof v.error.code === 'string' &&
      v.error.code.length <= 128 &&
      typeof v.error.message === 'string' &&
      v.error.message.length <= 512));
const envelope = (
  v: unknown,
  identity: PdfSessionIdentity,
): v is Record<string, unknown> =>
  record(v) &&
  samePdfIdentity(v, identity) &&
  v.protocol === PDF_PROTOCOL &&
  v.version === PDF_PROTOCOL_VERSION &&
  Number.isSafeInteger(v.commandId) &&
  (v.commandId as number) >= 0;

export function parsePdfCommand(
  v: unknown,
  identity: PdfSessionIdentity,
): PdfCommand | null {
  if (!envelope(v, identity) || !integer(v.commandId)) return null;
  const valid =
    v.type === 'open'
      ? keys(v, ['bytes']) &&
        v.bytes instanceof ArrayBuffer &&
        v.bytes.byteLength > 0 &&
        v.bytes.byteLength <= MAX_WEB_PDF_BYTES
      : v.type === 'highlights'
        ? keys(v, ['highlights']) && highlights(v.highlights)
        : v.type === 'navigate' || v.type === 'thumbnail'
          ? keys(v, ['pageNumber']) && integer(v.pageNumber, 100000)
          : v.type === 'scale'
            ? keys(v, ['scale']) &&
              typeof v.scale === 'number' &&
              Number.isFinite(v.scale) &&
              v.scale >= 0.5 &&
              v.scale <= 3
            : ['clear', 'rotate', 'dispose'].includes(String(v.type)) &&
              keys(v, []);
  return valid ? (v as unknown as PdfCommand) : null;
}

export function parsePdfEvent(
  v: unknown,
  identity: PdfSessionIdentity,
): PdfEvent | null {
  if (!envelope(v, identity) || (v.type !== 'result' && v.commandId !== 0))
    return null;
  const valid =
    v.type === 'boot'
      ? v.commandId === 0 && keys(v, [])
      : v.type === 'state'
        ? keys(v, ['state']) && state(v.state, identity)
        : v.type === 'page'
          ? keys(v, ['page']) && page(v.page, identity)
          : v.type === 'selection-error'
            ? keys(v, ['message']) &&
              (v.message === null ||
                (typeof v.message === 'string' && v.message.length <= 512))
            : v.type === 'highlight-hit'
              ? keys(v, ['id', 'rect']) &&
                typeof v.id === 'string' &&
                v.id.length > 0 &&
                v.id.length <= 256 &&
                record(v.rect) &&
                fields(v.rect, ['x', 'y', 'width', 'height']) &&
                ['x', 'y', 'width', 'height'].every(
                  (key) =>
                    typeof (v.rect as Record<string, unknown>)[key] ===
                      'number' &&
                    Number.isFinite((v.rect as Record<string, unknown>)[key]) &&
                    Math.abs((v.rect as Record<string, number>)[key]) <= 100000,
                )
              : v.type === 'selection'
                ? keys(v, ['selection']) && selection(v.selection, identity)
                : v.type === 'result' &&
                  integer(v.commandId) &&
                  keys(v, ['result']) &&
                  (v.result === null ||
                    typeof v.result === 'boolean' ||
                    thumbnail(v.result, identity));
  return valid ? (v as unknown as PdfEvent) : null;
}

export function acceptPdfEvent(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  frame: Window | null,
  origin: string,
  identity: PdfSessionIdentity,
): PdfEvent | null {
  return frame && event.source === frame && event.origin === origin
    ? parsePdfEvent(event.data, identity)
    : null;
}
