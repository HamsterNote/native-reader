import type {
  ReaderError,
  ReaderErrorCategory,
  ReaderErrorCode,
  ReaderLoadState,
  ReaderSource,
} from './types';

export type ReaderSpineItem = {
  /** Stable identity for one spine occurrence, including duplicate idrefs/hrefs. */
  id: string;
  idref: string;
  /** Raw engine href, retained for TOC/display compatibility. */
  href: string;
  /** Archive-root-relative document key, resolved against the OPF. */
  archiveKey: string;
  label: string;
  /** Index in the full publication spine, before non-linear items are filtered. */
  engineIndex: number;
};

export type ReaderTocItem = {
  id: string;
  href: string;
  archiveKey: string;
  /** Stable publication spine occurrence selected for this TOC entry. */
  targetEngineIndex: number;
  /** Manifest-relative href for the selected spine occurrence. */
  targetHref: string;
  /** Decoded only by the renderer when resolving an anchor in that occurrence. */
  targetFragment?: string;
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
  navigate(item: ReaderTocItem): Promise<void> | void;
};

export type BridgeTocItem = {
  id?: string;
  href?: string;
  archiveKey?: string;
  targetEngineIndex?: number;
  label?: string;
  subitems?: BridgeTocItem[];
};

export type BridgeSpineItem = {
  idref: string;
  href: string;
  archiveKey: string;
  linear: boolean;
  engineIndex: number;
  properties: string[];
};

export type PublicationProfile = {
  packageLayouts: string[];
  spineLayouts: Array<{ engineIndex: number; value: string }>;
  iBooksDisplayOptions:
    | { state: 'absent' }
    | { state: 'parsed'; fixedLayouts: string[] }
    | { state: 'malformed' };
  mediaOverlayItemIds: string[];
  encryption:
    | { state: 'absent' }
    | {
        state: 'parsed';
        algorithms: string[];
        resourceUris: string[];
      }
    | { state: 'malformed' };
};

export type PublicationPreparedEvent = {
  type: 'publicationPrepared';
  version: 2;
  packagePath: string;
  navigationPath?: string;
  title?: string;
  spine: BridgeSpineItem[];
  toc: BridgeTocItem[];
  profile: PublicationProfile;
};

export type PublicationLocationEvent = {
  type: 'publicationLocation';
  version: 1;
  engineIndex: number;
  href: string;
};

export type PublicationErrorEvent = {
  type: 'publicationError';
  version: 1;
  phase: 'parse' | 'profile' | 'render';
  reason?: string;
};

export type PublicationNavigationErrorEvent = {
  type: 'publicationNavigationError';
  version: 1;
  reason?: string;
};

export type NativeBridgeEvent =
  | PublicationPreparedEvent
  | PublicationLocationEvent
  | PublicationErrorEvent
  | PublicationNavigationErrorEvent;

export type SpineInput = {
  id?: string;
  idref?: string;
  href?: string;
  archiveKey?: string;
  linear?: boolean;
  engineIndex?: number;
  properties?: string[];
};

const messages: Record<ReaderErrorCode, string> = {
  UNSUPPORTED_SOURCE: 'Only a local EPUB URI is supported.',
  READ_FAILED: 'The EPUB file could not be read.',
  INVALID_EPUB: 'The file is not a valid EPUB publication.',
  UNSUPPORTED_EPUB: 'This EPUB publication profile is not supported.',
  RENDER_FAILED: 'The EPUB publication could not be displayed.',
  LOAD_TIMEOUT: 'The EPUB publication stopped making loading progress.',
};

const profileDeclarationAllowlist = {
  packageLayout: new Set(['reflowable']),
  spineLayout: new Set([
    'reflowable',
    'layout-reflowable',
    'rendition:layout-reflowable',
  ]),
  iBooksFixedLayout: new Set(['false', 'no']),
} satisfies Record<string, ReadonlySet<string>>;
const publicationNavigationErrorFields = new Set(['type', 'version', 'reason']);

type DeclarationClassification = 'supported' | 'unsupported' | 'invalid';

function classifyDeclaration(
  value: string,
  allowlist: ReadonlySet<string>,
): DeclarationClassification {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'invalid';
  return allowlist.has(normalized) ? 'supported' : 'unsupported';
}

const categories: Record<ReaderErrorCode, ReaderErrorCategory> = {
  UNSUPPORTED_SOURCE: 'unsupported',
  READ_FAILED: 'read',
  INVALID_EPUB: 'invalid',
  UNSUPPORTED_EPUB: 'unsupported',
  RENDER_FAILED: 'render',
  LOAD_TIMEOUT: 'read',
};

export function readerError(code: ReaderErrorCode): ReaderError {
  return { category: categories[code], code, message: messages[code] };
}

/**
 * Load notifications are de-duplicated only when the rendered error is equal.
 * The deprecated detail code alone is insufficient because new adapters may
 * omit it while still reporting distinct stable categories or messages.
 */
export function sameReaderLoadState(
  left: ReaderLoadState,
  right: ReaderLoadState,
) {
  return (
    left.status === right.status &&
    (left.status !== 'error' ||
      (right.status === 'error' &&
        left.error.category === right.error.category &&
        left.error.code === right.error.code &&
        left.error.message === right.error.message))
  );
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

/** Compatibility mapping for failures that do not come from the bridge protocol. */
export function categorizeOpenError(error: unknown): ReaderError {
  const message = extractErrorMessage(error);
  if (/fixed.?layout|pre-paginated|drm|encrypted|media.?overlay/i.test(message))
    return readerError('UNSUPPORTED_EPUB');
  if (/fetch|read|permission|not found|no such file|network/i.test(message))
    return readerError('READ_FAILED');
  if (/render|display|iframe|webview/i.test(message))
    return readerError('RENDER_FAILED');
  return readerError('INVALID_EPUB');
}

/** A publication parser may reject with a plain object instead of an Error. */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message;
  return String(error);
}

/** Keep bridge and direct-renderer phase classification on one public contract. */
export function mapPublicationErrorCode(
  phase: 'parse' | 'profile' | 'render',
  reason: string | undefined,
): ReaderErrorCode {
  if (phase === 'render') return 'RENDER_FAILED';
  if (phase === 'profile' && reason === 'UNSUPPORTED_EPUB')
    return 'UNSUPPORTED_EPUB';
  return 'INVALID_EPUB';
}

/** fail-closed 安全检查允许检查的最大 percent 解码层数。 */
const MAX_PERCENT_DECODE_DEPTH = 8;
/** scheme 只在 document component 的起始位置有 URL 语义。 */
const schemeLikeDocument = /^\s*[a-z][a-z0-9+.-]*:/i;
/** query/fragment 中以 `/` 开始的值同样属于绝对路径。 */
const absoluteComponent = /(?:^|[?#&=])\s*\/+/;

/**
 * 单层表示中的危险结构：C0（U+0000-001F）、DEL（U+007F）、
 * C1（U+0080-009F）控制字符、任意反斜杠、scheme-like 前缀、绝对路径。
 */
function hasUnsafeArchiveShape(value: string): boolean {
  if (value.startsWith('/') || value.includes('\\')) return true;
  const document = value.split(/[?#]/, 1)[0] ?? '';
  if (schemeLikeDocument.test(document) || absoluteComponent.test(value))
    return true;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Canonical ZIP identity is no longer a URL; do not split or decode it again.
 * URL scheme 只在 raw document component 中具有语义，因此 canonical entry 身份
 * 允许任意位置（含首段）出现 `:`（例如 `chapter:1.xhtml`），绝不能按 scheme
 * 误拒；危险的反斜杠、绝对路径与控制字符仍然 fail-closed。
 */
function hasUnsafeCanonicalPath(value: string): boolean {
  if (value.startsWith('/') || value.includes('\\')) return true;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** 每个 `%` 都必须开启合法的 `%XX` 转义；孤立或残缺的百分号一律拒绝。 */
function hasInvalidPercentEscape(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '%') continue;
    if (!/^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))) return true;
    index += 2;
  }
  return false;
}

/**
 * 在任何路径/URL 语义解析之前运行的 fail-closed 安全检查：原始表示与最多
 * 8 层 decodeURIComponent 表示中的每一层都不得出现危险结构；原始 URI
 * 表示必须有合法 percent 转义，但解码后产生的字面量 `%` 不再被当作 URI
 * 语法。第 8 层之后若仍能继续解码（说明嵌套更深）则拒绝。
 *
 * 该检查只负责安全判定；业务路径解析必须在调用方基于“只解码一次”的值进行。
 */
export function isSafeArchiveHref(href: string): boolean {
  let current = href;
  // URI 输入本身必须是合法的 percent-encoded 表示。后续层可能合法地产生
  // 字面量 `%`（例如 `%25`），因此不能把业务解码后的 `%` 再当作 URI 语法。
  if (hasInvalidPercentEscape(current)) return false;
  for (let depth = 0; depth < MAX_PERCENT_DECODE_DEPTH; depth += 1) {
    if (hasUnsafeArchiveShape(current)) return false;
    if (!current.includes('%')) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      // 初始表示已经校验；这里的不可解码 `%` 是前一层产生的字面量。
      return depth > 0;
    }
    // 合法转义必然改变字符串；无法推进表示输入异常，fail-closed。
    if (decoded === current) return false;
    current = decoded;
  }
  // 已检查原始值与 8 层解码；仍有百分号说明超出层数上限。
  if (hasUnsafeArchiveShape(current)) return false;
  try {
    return decodeURIComponent(current) === current;
  } catch {
    return true;
  }
}

/**
 * Validate an already-normalized archive identity without percent-decoding it.
 * A canonical key can legitimately contain `%XX` as literal ZIP-entry text.
 */
export function normalizeCanonicalArchivePath(
  path: string,
): string | undefined {
  const value = path;
  if (!value || hasUnsafeCanonicalPath(value)) return undefined;
  const parts: string[] = [];
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

export function normalizeArchivePath(
  href: string,
  base = '',
): string | undefined {
  // 必须先检查完整原始 target，不能让 trim/split 隐藏 query、fragment 或边界控制字符。
  if (!isSafeArchiveHref(href)) return undefined;
  const raw = href.split(/[?#]/, 1)[0] ?? '';
  if (!raw) return undefined;
  // 业务语义只解码一层；反斜杠不会被转换成路径分隔符（已在上方被拒绝）。
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  if (!value) return undefined;

  // base 是已规范化的 ZIP entry 身份，绝不能再次 percent-decode。
  const baseValue = base;
  const basePath = baseValue ? normalizeCanonicalArchivePath(baseValue) : '';
  if (baseValue && basePath === undefined) return undefined;
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

export function normalizePublicationTarget(
  href: string,
  base = '',
): { document: string; fragment?: string } | undefined {
  // fragment/query 也属于安全边界，必须在 trim、split 或路径解析前一起检查。
  if (!isSafeArchiveHref(href)) return undefined;
  const hash = href.indexOf('#');
  const beforeFragment = hash >= 0 ? href.slice(0, hash) : href;
  const query = beforeFragment.indexOf('?');
  const rawDocument =
    query >= 0 ? beforeFragment.slice(0, query) : beforeFragment;
  // fragment 保留原始（可能仍编码）文本：此处不解码，也不把 `+` 当作空格；
  // renderer 在定位锚点时只解码一次。
  const fragment = hash >= 0 ? href.slice(hash + 1) : undefined;
  // Fragment-only links target their containing navigation document.
  const document = rawDocument
    ? normalizeArchivePath(rawDocument, base)
    : hash >= 0 && base
      ? normalizeCanonicalArchivePath(base)
      : undefined;
  if (!document) return undefined;
  return fragment ? { document, fragment } : { document };
}

export function hrefDocument(href: string, base = ''): string {
  return normalizeArchivePath(href, base) ?? '';
}

export function isPublicationHref(href: string, base = ''): boolean {
  return normalizeArchivePath(href, base) !== undefined;
}

export function flattenToc(
  items: BridgeTocItem[],
  basePath = '',
  depth = 0,
  spine: ReaderSpineItem[] = [],
): ReaderTocItem[] {
  return items.flatMap((item, index) => {
    const rawHref = item.href;
    const target = rawHref
      ? normalizePublicationTarget(rawHref, basePath)
      : undefined;
    // 仅在完整原始 target 通过检查后做业务规范化。
    const href = target ? rawHref : undefined;
    const declaredArchiveKey = item.archiveKey
      ? normalizeCanonicalArchivePath(item.archiveKey)
      : target?.document;
    const targetSpineItem = spine.find((spineItem) =>
      item.targetEngineIndex === undefined
        ? spineItem.archiveKey === declaredArchiveKey
        : spineItem.engineIndex === item.targetEngineIndex &&
          spineItem.archiveKey === declaredArchiveKey,
    );
    const current: ReaderTocItem[] =
      href &&
      target &&
      declaredArchiveKey === target.document &&
      targetSpineItem
        ? [
            {
              id: item.id || `${depth}-${index}-${href}`,
              href,
              archiveKey: target.document,
              targetEngineIndex: targetSpineItem.engineIndex,
              targetHref: targetSpineItem.href,
              ...(target.fragment
                ? { targetFragment: target.fragment }
                : undefined),
              label: item.label?.trim() || href,
              depth,
            },
          ]
        : [];
    return current.concat(
      flattenToc(item.subitems ?? [], basePath, depth + 1, spine),
    );
  });
}

export function buildSpine(
  items: SpineInput[],
  toc: ReaderTocItem[],
  packagePath = '',
): ReaderSpineItem[] {
  const seenEngineIndices = new Set<number>();
  const validated = items.map((item, sourceIndex) => {
    const rawHref = item.href ?? '';
    const archiveKey = normalizeArchivePath(rawHref, packagePath);
    const declaredArchiveKey = item.archiveKey
      ? normalizeCanonicalArchivePath(item.archiveKey)
      : archiveKey;
    const engineIndex = item.engineIndex ?? sourceIndex;
    if (
      !archiveKey ||
      declaredArchiveKey !== archiveKey ||
      !Number.isInteger(engineIndex) ||
      engineIndex < 0 ||
      seenEngineIndices.has(engineIndex)
    )
      return undefined;
    seenEngineIndices.add(engineIndex);
    return { archiveKey, engineIndex, item, rawHref, sourceIndex };
  });
  // Any malformed occurrence invalidates the complete publication. Only the
  // UI projection below may omit a structurally valid non-linear occurrence.
  if (
    !validated.length ||
    validated.some((item) => !item) ||
    !items.some((item) => item.linear !== false)
  )
    return [];

  return validated.flatMap((entry) => {
    if (!entry || entry.item.linear === false) return [];
    const { archiveKey, engineIndex, item, rawHref, sourceIndex } = entry;
    // Raw href is also engine identity; whitespace is significant ZIP-entry text.
    const href = rawHref;
    const idref = (item.idref ?? item.id ?? '').trim();
    return [
      {
        id: `${engineIndex}:${idref}`,
        idref,
        href,
        archiveKey,
        label:
          toc.find((tocItem) => tocItem.archiveKey === archiveKey)?.label ??
          `Chapter ${sourceIndex + 1}`,
        engineIndex,
      },
    ];
  });
}

export function findSpineIndex(
  spine: ReaderSpineItem[],
  href: string,
  engineIndex?: number,
  basePath = '',
): number {
  // Engine indices belong to the unfiltered spine. Never interpret them as a
  // reader-model array index or fall back to a duplicate href when absent.
  if (engineIndex !== undefined)
    return spine.findIndex((item) => item.engineIndex === engineIndex);
  const target = normalizeArchivePath(href, basePath);
  if (!target) return -1;
  return spine.findIndex((item) => item.archiveKey === target);
}

export function canLoadNavigationTarget(
  model: ReaderPublicationModel,
  href: string,
  basePath = '',
): boolean {
  return (
    Boolean(href) && findSpineIndex(model.spine, href, undefined, basePath) >= 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

function isTocArray(value: unknown): value is BridgeTocItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        (item.id === undefined || typeof item.id === 'string') &&
        (item.href === undefined || typeof item.href === 'string') &&
        (item.archiveKey === undefined ||
          typeof item.archiveKey === 'string') &&
        (item.targetEngineIndex === undefined ||
          (Number.isInteger(item.targetEngineIndex) &&
            (item.targetEngineIndex as number) >= 0)) &&
        (item.label === undefined || typeof item.label === 'string') &&
        (item.subitems === undefined || isTocArray(item.subitems)),
    )
  );
}

function isProfile(value: unknown): value is PublicationProfile {
  if (!isRecord(value)) return false;
  const display = value.iBooksDisplayOptions;
  const encryption = value.encryption;
  return (
    isStringArray(value.packageLayouts) &&
    Array.isArray(value.spineLayouts) &&
    value.spineLayouts.every(
      (item) =>
        isRecord(item) &&
        Number.isInteger(item.engineIndex) &&
        (item.engineIndex as number) >= 0 &&
        typeof item.value === 'string',
    ) &&
    isRecord(display) &&
    (display.state === 'absent' ||
      display.state === 'malformed' ||
      (display.state === 'parsed' && isStringArray(display.fixedLayouts))) &&
    isStringArray(value.mediaOverlayItemIds) &&
    isRecord(encryption) &&
    (encryption.state === 'absent' ||
      encryption.state === 'malformed' ||
      (encryption.state === 'parsed' &&
        isStringArray(encryption.algorithms) &&
        isStringArray(encryption.resourceUris)))
  );
}

export function parseNativeBridgeEvent(
  value: unknown,
): NativeBridgeEvent | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'publicationLocation') {
    return value.version === 1 &&
      Number.isInteger(value.engineIndex) &&
      (value.engineIndex as number) >= 0 &&
      typeof value.href === 'string'
      ? (value as unknown as PublicationLocationEvent)
      : undefined;
  }
  if (value.type === 'publicationError') {
    return value.version === 1 &&
      (value.phase === 'parse' ||
        value.phase === 'profile' ||
        value.phase === 'render') &&
      (value.reason === undefined || typeof value.reason === 'string')
      ? (value as unknown as PublicationErrorEvent)
      : undefined;
  }
  if (value.type === 'publicationNavigationError') {
    return value.version === 1 &&
      hasOnlyKeys(value, publicationNavigationErrorFields) &&
      (value.reason === undefined || typeof value.reason === 'string')
      ? (value as unknown as PublicationNavigationErrorEvent)
      : undefined;
  }
  if (value.type !== 'publicationPrepared' || value.version !== 2)
    return undefined;
  if (
    typeof value.packagePath !== 'string' ||
    (value.navigationPath !== undefined &&
      typeof value.navigationPath !== 'string') ||
    (value.title !== undefined && typeof value.title !== 'string') ||
    !Array.isArray(value.spine) ||
    !value.spine.every(
      (item) =>
        isRecord(item) &&
        typeof item.idref === 'string' &&
        typeof item.href === 'string' &&
        typeof item.archiveKey === 'string' &&
        typeof item.linear === 'boolean' &&
        Number.isInteger(item.engineIndex) &&
        (item.engineIndex as number) >= 0 &&
        isStringArray(item.properties),
    ) ||
    !isTocArray(value.toc) ||
    !isProfile(value.profile)
  )
    return undefined;
  return value as unknown as PublicationPreparedEvent;
}

/** Validate publication structure/profile before a renderer may become ready. */
export function validatePublication(
  event: PublicationPreparedEvent,
): ReaderError | undefined {
  if (!normalizeCanonicalArchivePath(event.packagePath)) {
    return readerError('INVALID_EPUB');
  }
  if (
    event.navigationPath &&
    !normalizeCanonicalArchivePath(event.navigationPath)
  )
    return readerError('INVALID_EPUB');

  const seenEngineIndices = new Set<number>();
  const spineArchiveKeys = new Map<number, string>();
  for (const item of event.spine) {
    const archiveKey = normalizeArchivePath(item.href, event.packagePath);
    if (
      seenEngineIndices.has(item.engineIndex) ||
      !archiveKey ||
      normalizeCanonicalArchivePath(item.archiveKey) !== archiveKey
    )
      return readerError('INVALID_EPUB');
    seenEngineIndices.add(item.engineIndex);
    spineArchiveKeys.set(item.engineIndex, archiveKey);
  }
  if (!event.spine.some((item) => item.linear))
    return readerError('INVALID_EPUB');

  const navigationBase = event.navigationPath ?? event.packagePath;
  const validateTocItems = (items: BridgeTocItem[]): boolean =>
    items.every((item) => {
      if (!item.href) return validateTocItems(item.subitems ?? []);
      const target = normalizePublicationTarget(item.href, navigationBase);
      const archiveKey = item.archiveKey
        ? normalizeCanonicalArchivePath(item.archiveKey)
        : undefined;
      return Boolean(
        target &&
        archiveKey === target.document &&
        item.targetEngineIndex !== undefined &&
        spineArchiveKeys.get(item.targetEngineIndex) === archiveKey &&
        validateTocItems(item.subitems ?? []),
      );
    });
  if (!validateTocItems(event.toc)) return readerError('INVALID_EPUB');

  return validatePublicationProfile(event.profile, seenEngineIndices);
}

/** Apply the same structured publication-profile policy on every renderer. */
export function validatePublicationProfile(
  profile: PublicationProfile,
  engineIndices: Iterable<number>,
): ReaderError | undefined {
  const knownEngineIndices = new Set(engineIndices);
  if (
    !isProfile(profile) ||
    profile.iBooksDisplayOptions.state === 'malformed' ||
    profile.encryption.state === 'malformed'
  )
    return readerError('INVALID_EPUB');

  // A singleton declaration is required at package/iBooks scope. Check raw
  // counts before classification so duplicate equal values are never hidden.
  if (
    profile.packageLayouts.length > 1 ||
    (profile.iBooksDisplayOptions.state === 'parsed' &&
      profile.iBooksDisplayOptions.fixedLayouts.length > 1)
  )
    return readerError('INVALID_EPUB');

  const spineLayoutIndices = new Set<number>();
  for (const item of profile.spineLayouts) {
    if (spineLayoutIndices.has(item.engineIndex))
      return readerError('INVALID_EPUB');
    spineLayoutIndices.add(item.engineIndex);
  }
  if (
    profile.spineLayouts.some(
      (item) => !knownEngineIndices.has(item.engineIndex),
    )
  )
    return readerError('INVALID_EPUB');

  const declarations = [
    ...profile.packageLayouts.map((value) =>
      classifyDeclaration(value, profileDeclarationAllowlist.packageLayout),
    ),
    ...profile.spineLayouts.map((item) =>
      classifyDeclaration(item.value, profileDeclarationAllowlist.spineLayout),
    ),
    ...(profile.iBooksDisplayOptions.state === 'parsed'
      ? profile.iBooksDisplayOptions.fixedLayouts.map((value) =>
          classifyDeclaration(
            value,
            profileDeclarationAllowlist.iBooksFixedLayout,
          ),
        )
      : []),
  ];
  if (declarations.includes('invalid')) return readerError('INVALID_EPUB');
  if (declarations.includes('unsupported'))
    return readerError('UNSUPPORTED_EPUB');
  if (
    profile.mediaOverlayItemIds.length > 0 ||
    profile.encryption.state === 'parsed'
  )
    return readerError('UNSUPPORTED_EPUB');
  return undefined;
}

export function buildPublicationModel(
  event: PublicationPreparedEvent,
): ReaderPublicationModel | undefined {
  const initialSpine = buildSpine(event.spine, [], event.packagePath);
  const toc = flattenToc(
    event.toc,
    event.navigationPath ?? event.packagePath,
    0,
    initialSpine,
  );
  const spine = initialSpine.map((item, index) => ({
    ...item,
    label:
      toc.find((tocItem) => tocItem.archiveKey === item.archiveKey)?.label ??
      `Chapter ${index + 1}`,
  }));
  if (!spine.length) return undefined;
  return { title: event.title, spine, toc };
}
