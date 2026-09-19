const allowedProtocols = new Set(['blob:', 'data:']);

function decodeUrl(value: string): string | undefined {
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function decodeCssEscapes(value: string): string {
  return value.replace(
    /\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi,
    (_match, hex: string | undefined, character: string | undefined) =>
      hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : (character ?? ''),
  );
}

export function isSafePublicationUrl(value: string): boolean {
  const decoded = decodeUrl(decodeCssEscapes(value.trim()));
  if (!decoded || /[\u0000-\u001f\u007f]/.test(decoded)) return false;
  if (decoded === 'about:blank' || decoded.startsWith('#')) return true;
  try {
    const parsed = new URL(decoded, 'https://publication.invalid/');
    if (allowedProtocols.has(parsed.protocol)) return true;
    return (
      parsed.origin === 'https://publication.invalid' &&
      !decoded.startsWith('//') &&
      !decoded.startsWith('/')
    );
  } catch {
    return false;
  }
}

export function sanitizeCss(css: string): string {
  return css
    .replace(/@import\b[\s\S]*?;/gi, '')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _quote, url) =>
      isSafePublicationUrl(url) ? match : 'url(about:blank)',
    );
}

export function sanitizeSrcset(srcset: string): string {
  return srcset
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) =>
      isSafePublicationUrl(candidate.split(/\s+/, 1)[0] ?? ''),
    )
    .join(', ');
}

export function securePublicationMarkup(markup: string): string {
  const policy =
    "default-src 'none'; img-src blob: data:; media-src blob: data:; font-src blob: data:; style-src blob: 'unsafe-inline'";
  const sanitized = sanitizeCss(markup)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*(['"]?)refresh\1[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, '')
    .replace(
      /\s(?:src|href|xlink:href|data|poster)\s*=\s*(['"])(?:https?:|javascript:|\/\/)[\s\S]*?\1/gi,
      '',
    )
    .replace(/\ssrcset\s*=\s*(['"])(.*?)\1/gi, (_match, quote, value) => {
      const safe = sanitizeSrcset(value);
      return safe ? ` srcset=${quote}${safe}${quote}` : '';
    });
  const csp = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
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
    .forEach((node) => node.remove());

  for (const node of document.querySelectorAll<HTMLElement>('*')) {
    for (const attribute of Array.from(node.attributes)) {
      if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
    }
  }

  for (const node of document.querySelectorAll<HTMLElement>(
    '[src], [href], [xlink\\:href], [data], [poster], [srcset], [style]',
  )) {
    for (const attribute of ['src', 'href', 'xlink:href', 'data', 'poster']) {
      const value = node.getAttribute(attribute);
      if (value && !isSafePublicationUrl(value))
        node.removeAttribute(attribute);
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

  const csp = document.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = [
    "default-src 'none'",
    'img-src blob: data:',
    'media-src blob: data:',
    'font-src blob: data:',
    "style-src blob: 'unsafe-inline'",
  ].join('; ');
  document.head.prepend(csp);
}
