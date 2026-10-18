import foliateCspSource from './foliate-csp-policy.json';

const resourceProtocols = new Set(['blob:', 'data:']);
const publicationOrigin = 'https://publication.invalid';
const maxPercentDecodeDepth = 8;
const schemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function hasForbiddenUrlCharacter(value: string): boolean {
  if (value.includes('\\')) return true;
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function inspectUrlStage(
  value: string,
  allowedProtocol?: string,
): string | undefined {
  // Inspect before trimming so whitespace normalization cannot hide controls.
  if (hasForbiddenUrlCharacter(value)) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.startsWith('/')) return undefined;
  const scheme = normalized.match(schemePattern)?.[0].toLowerCase();
  if (scheme && scheme !== allowedProtocol) return undefined;
  return normalized;
}

function decodeCssEscapes(value: string): string | undefined {
  try {
    return value.replace(
      /\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi,
      (_match, hex: string | undefined, character: string | undefined) =>
        hex
          ? String.fromCodePoint(Number.parseInt(hex, 16))
          : (character ?? ''),
    );
  } catch {
    return undefined;
  }
}

function decodeAndInspectUrl(
  value: string,
  allowResourceProtocol: boolean,
): string | undefined {
  // Establish raw safety before any normalization, including trim.
  if (hasForbiddenUrlCharacter(value)) return undefined;
  const rawProtocol = value.trim().match(schemePattern)?.[0].toLowerCase();
  const allowedProtocol =
    allowResourceProtocol && rawProtocol && resourceProtocols.has(rawProtocol)
      ? rawProtocol
      : undefined;
  const original = inspectUrlStage(value, allowedProtocol);
  if (!original) return undefined;

  const cssDecoded = decodeCssEscapes(original);
  if (cssDecoded === undefined) return undefined;
  let current = inspectUrlStage(cssDecoded, allowedProtocol);
  if (!current) return undefined;

  for (let depth = 0; depth < maxPercentDecodeDepth; depth += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return undefined;
    }
    if (decoded === current) return current;
    const inspected = inspectUrlStage(decoded, allowedProtocol);
    if (!inspected) return undefined;
    current = inspected;
  }

  // A ninth changing decode means the input exceeded the supported depth.
  try {
    return decodeURIComponent(current) === current ? current : undefined;
  } catch {
    return undefined;
  }
}

function isSafeRelativePublicationUrl(value: string): boolean {
  const decoded = decodeAndInspectUrl(value, false);
  if (!decoded) return false;
  try {
    const parsed = new URL(decoded, `${publicationOrigin}/`);
    return parsed.origin === publicationOrigin;
  } catch {
    return false;
  }
}

export function isSafePublicationResourceUrl(value: string): boolean {
  const decoded = decodeAndInspectUrl(value, true);
  if (!decoded) return false;
  const protocol = decoded.match(schemePattern)?.[0].toLowerCase();
  if (protocol) return resourceProtocols.has(protocol);
  try {
    return (
      new URL(decoded, `${publicationOrigin}/`).origin === publicationOrigin
    );
  } catch {
    return false;
  }
}

export function isSafePublicationNavigationUrl(value: string): boolean {
  return isSafeRelativePublicationUrl(value);
}

// Kept as the public navigation predicate used by the web reader's click guard.
export const isSafePublicationUrl = isSafePublicationNavigationUrl;

/** Foliate host/publication 共用的 CSP 指令名。 */
export type FoliateCspDirectiveName =
  | 'default-src'
  | 'script-src'
  | 'style-src'
  | 'img-src'
  | 'font-src'
  | 'media-src'
  | 'frame-src'
  | 'worker-src'
  | 'connect-src'
  | 'object-src'
  | 'form-action'
  | 'base-uri';

/**
 * 可直接被 Web / native host 消费的 Foliate CSP 策略描述。
 */
export interface FoliateCspPolicy {
  /** JSON 单一来源中锁定的策略版本。 */
  readonly version: string;
  /** 指令名到来源列表的只读映射，native host 可按指令逐项消费。 */
  readonly directives: Readonly<
    Record<FoliateCspDirectiveName, readonly string[]>
  >;
  /** 已序列化的 CSP 字符串，可直接用于响应头或 `<meta content>`。 */
  readonly value: string;
}

export type FoliateCspPolicyKind = 'host' | 'publication';

type FoliateCspSource = {
  readonly schemaVersion: 1;
  readonly directiveOrder: readonly FoliateCspDirectiveName[];
  readonly policies: Readonly<
    Record<
      FoliateCspPolicyKind,
      Readonly<{
        version: string;
        directives: Readonly<
          Record<FoliateCspDirectiveName, readonly string[]>
        >;
      }>
    >
  >;
};

// 该 JSON 同时由 Node staging 与 TS host/native 消费，是 CSP 文本的唯一来源。
const foliateCspPolicies = foliateCspSource as FoliateCspSource;

export function buildFoliateCspPolicyFor(
  kind: FoliateCspPolicyKind,
): FoliateCspPolicy {
  const source = foliateCspPolicies.policies[kind];
  const directives = Object.freeze(
    Object.fromEntries(
      foliateCspPolicies.directiveOrder.map((name) => [
        name,
        Object.freeze([...source.directives[name]]),
      ]),
    ) as Record<FoliateCspDirectiveName, readonly string[]>,
  );
  const value = foliateCspPolicies.directiveOrder
    .map((name) => `${name} ${directives[name].join(' ')}`)
    .join('; ');
  return Object.freeze({ version: source.version, directives, value });
}

export function buildFoliateHostCspPolicy(): FoliateCspPolicy {
  return buildFoliateCspPolicyFor('host');
}

export function buildFoliatePublicationCspPolicy(): FoliateCspPolicy {
  return buildFoliateCspPolicyFor('publication');
}

/**
 * 兼容旧调用方：旧 EPUB sanitizer 仍使用原有 host 策略，不会隐式切换到
 * 不含 self 的 Foliate publication renderer 策略。
 */
export function buildFoliateCspPolicy(): FoliateCspPolicy {
  return buildFoliateHostCspPolicy();
}

export function buildFoliateCsp(): string {
  return buildFoliateHostCspPolicy().value;
}

export function createFoliateCspMetaMarkup(
  kind: FoliateCspPolicyKind = 'host',
): string {
  return `<meta http-equiv="Content-Security-Policy" content="${buildFoliateCspPolicyFor(kind).value}">`;
}

export function applyFoliateCspMeta(
  document: Document,
  kind: FoliateCspPolicyKind = 'host',
): HTMLMetaElement {
  const csp = document.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = buildFoliateCspPolicyFor(kind).value;
  document.head.prepend(csp);
  return csp;
}

export function applyFoliatePublicationCspMeta(
  document: Document,
): HTMLMetaElement {
  return applyFoliateCspMeta(document, 'publication');
}

export function sanitizeCss(css: string): string {
  return css
    .replace(/@import\b[\s\S]*?;/gi, '')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _quote, url) =>
      isSafePublicationResourceUrl(url) ? match : 'url(about:blank)',
    );
}

export function sanitizeSrcset(srcset: string): string {
  return srcset
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) =>
      isSafePublicationResourceUrl(candidate.split(/\s+/, 1)[0] ?? ''),
    )
    .join(', ');
}

export function securePublicationMarkup(markup: string): string {
  // 复用同一个策略构建器，避免与 securePublicationDocument 硬编码漂移。
  const csp = createFoliateCspMetaMarkup();
  const sanitized = sanitizeCss(markup)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*(['"]?)refresh\1[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, '')
    .replace(
      /<([a-z][\w:-]*)(\s[^<>]*?)?>/gi,
      (tag, tagName: string, rawAttributes: string | undefined) => {
        if (!rawAttributes) return tag;
        const element = tagName.toLowerCase();
        const attributes = rawAttributes.replace(
          /\s([^\s=/>]+)\s*=\s*(['"])([\s\S]*?)\2/g,
          (attribute, rawName: string, _quote: string, value: string) => {
            const name = rawName.toLowerCase();
            if (name === 'srcdoc' && element === 'iframe') return '';
            const isNavigation =
              name === 'formaction' ||
              ((name === 'href' || name === 'xlink:href') &&
                (element === 'a' || element === 'area')) ||
              (name === 'src' &&
                (element === 'iframe' ||
                  element === 'frame' ||
                  element === 'embed')) ||
              (name === 'action' && element === 'form') ||
              (name === 'data' && element === 'object');
            if (isNavigation)
              return isSafePublicationNavigationUrl(value) ? attribute : '';
            if (
              [
                'src',
                'href',
                'xlink:href',
                'data',
                'poster',
                'srcdoc',
              ].includes(name)
            )
              return isSafePublicationResourceUrl(value) ? attribute : '';
            return attribute;
          },
        );
        return `<${tagName}${attributes}>`;
      },
    )
    .replace(/\ssrcset\s*=\s*(['"])(.*?)\1/gi, (_match, quote, value) => {
      const safe = sanitizeSrcset(value);
      return safe ? ` srcset=${quote}${safe}${quote}` : '';
    });
  if (/<head(?:\s[^>]*)?>/i.test(sanitized))
    return sanitized.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${csp}`);
  if (/<html(?:\s[^>]*)?>/i.test(sanitized))
    return sanitized.replace(
      /<html(\s[^>]*)?>/i,
      (html) => `${html}<head>${csp}</head>`,
    );
  return `<head>${csp}</head>${sanitized}`;
}

export function securePublicationDocument(document: Document): void {
  document
    .querySelectorAll('script, base, meta[http-equiv="refresh" i]')
    .forEach((node) => {
      node.remove();
    });

  for (const node of document.querySelectorAll<HTMLElement>('*')) {
    for (const attribute of Array.from(node.attributes)) {
      if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
    }
  }

  for (const node of document.querySelectorAll<HTMLElement>(
    '[src], [href], [xlink\\:href], [data], [poster], [srcdoc], [action], [formaction], [srcset], [style]',
  )) {
    const element = node.tagName.toLowerCase();
    for (const attribute of [
      'src',
      'href',
      'xlink:href',
      'data',
      'poster',
      'srcdoc',
      'action',
      'formaction',
    ]) {
      const value = node.getAttribute(attribute);
      if (!value) continue;
      if (attribute === 'srcdoc' && element === 'iframe') {
        node.removeAttribute(attribute);
        continue;
      }
      const isNavigation =
        attribute === 'formaction' ||
        ((attribute === 'href' || attribute === 'xlink:href') &&
          (element === 'a' || element === 'area')) ||
        (attribute === 'src' &&
          (element === 'iframe' ||
            element === 'frame' ||
            element === 'embed')) ||
        (attribute === 'action' && element === 'form') ||
        (attribute === 'data' && element === 'object');
      const safe = isNavigation
        ? isSafePublicationNavigationUrl(value)
        : isSafePublicationResourceUrl(value);
      if (!safe) node.removeAttribute(attribute);
    }

    const srcset = node.getAttribute('srcset');
    if (srcset) {
      const safeCandidates = sanitizeSrcset(srcset);
      if (safeCandidates) node.setAttribute('srcset', safeCandidates);
      else node.removeAttribute('srcset');
    }

    const style = node.getAttribute('style');
    if (style) node.setAttribute('style', sanitizeCss(style));
  }

  for (const style of document.querySelectorAll('style')) {
    style.textContent = sanitizeCss(style.textContent ?? '');
  }

  // 与 securePublicationMarkup 共用同一个策略构建器。
  applyFoliateCspMeta(document);
}
