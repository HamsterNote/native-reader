import { DOMParser } from '@xmldom/xmldom';

import {
  isSafePublicationNavigationUrl,
  isSafePublicationResourceUrl,
  isSafePublicationUrl,
  securePublicationDocument,
  securePublicationMarkup,
} from './webSecurity';

function encodePercentLayers(value: string, depth: number): string {
  let encoded = value;
  for (let index = 0; index < depth; index += 1)
    encoded = encodeURIComponent(encoded);
  return encoded;
}

test('uses a default-deny URL policy', () => {
  expect(isSafePublicationUrl('images/cover.jpg')).toBe(true);
  expect(isSafePublicationResourceUrl('blob:local')).toBe(true);
  expect(isSafePublicationResourceUrl('data:image/png;base64,AA==')).toBe(true);
  expect(isSafePublicationNavigationUrl('blob:local')).toBe(false);
  expect(
    isSafePublicationNavigationUrl('data:text/html,<script>alert(1)</script>'),
  ).toBe(false);
  expect(isSafePublicationNavigationUrl('about:blank')).toBe(false);
  expect(isSafePublicationUrl('https://attacker.invalid/a')).toBe(false);
  expect(isSafePublicationUrl('//attacker.invalid/a')).toBe(false);
  expect(isSafePublicationUrl('about:srcdoc')).toBe(false);
  expect(isSafePublicationUrl('javascript:alert(1)')).toBe(false);
  expect(isSafePublicationUrl('java%73cript:alert(1)')).toBe(false);
  expect(isSafePublicationUrl('https:attacker.invalid/leak')).toBe(false);
  expect(isSafePublicationUrl('https:%5c%5cattacker.invalid/leak')).toBe(false);
  expect(isSafePublicationUrl('https:%0a//attacker.invalid')).toBe(false);
  expect(isSafePublicationUrl('//attacker.invalid/%0a')).toBe(false);
});

test('rejects dangerous URL syntax at every decoding layer', () => {
  for (const value of [
    'https%3Aattacker.invalid/leak',
    'https%253Aattacker.invalid/leak',
    '%2Fattacker.invalid/leak',
    '%252Fattacker.invalid/leak',
    '%2F%2Fattacker.invalid/leak',
    '%252F%252Fattacker.invalid/leak',
    '%5cattacker.invalid/leak',
    '%255cattacker.invalid/leak',
    '%0aimages/cover.jpg',
    '%250aimages/cover.jpg',
    '%C2%85images/cover.jpg',
    '%25C2%2585images/cover.jpg',
  ]) {
    expect(isSafePublicationUrl(value)).toBe(false);
  }

  for (const control of ['\u0000', '\u001f', '\u007f', '\u0080', '\u009f']) {
    expect(isSafePublicationUrl(`${control}images/cover.jpg`)).toBe(false);
  }
  expect(isSafePublicationUrl('images\\cover.jpg')).toBe(false);
  expect(isSafePublicationUrl('images/%')).toBe(false);
  expect(isSafePublicationUrl('images/%GG')).toBe(false);
  expect(isSafePublicationUrl(encodePercentLayers('images/cover.jpg', 8))).toBe(
    true,
  );
  expect(isSafePublicationUrl(encodePercentLayers('images/cover.jpg', 9))).toBe(
    false,
  );
});

test('allows resource schemes only when directly declared', () => {
  expect(isSafePublicationResourceUrl('blob:local')).toBe(true);
  expect(isSafePublicationResourceUrl('data:image/png;base64,AA==')).toBe(true);
  expect(isSafePublicationResourceUrl('%62lob:local')).toBe(false);
  expect(isSafePublicationResourceUrl('%2562lob:local')).toBe(false);
  expect(isSafePublicationResourceUrl('data%3Aimage/png;base64,AA==')).toBe(
    false,
  );
  expect(isSafePublicationResourceUrl('data%253Aimage/png;base64,AA==')).toBe(
    false,
  );
  expect(isSafePublicationNavigationUrl('blob:local')).toBe(false);
  expect(isSafePublicationNavigationUrl('data:image/png;base64,AA==')).toBe(
    false,
  );
  expect(isSafePublicationUrl('#chapter-1')).toBe(true);
  expect(isSafePublicationUrl('chapters/chapter-1.xhtml#start')).toBe(true);
});

test('sanitizes every resource-bearing HTML and CSS form', () => {
  const secured =
    securePublicationMarkup(`<html><head><style>.x{background:url(https://attacker.invalid/css)}</style></head><body>
    <img src="images/local.png" srcset="images/local.png 1x, https://attacker.invalid/2x 2x">
    <object data="https://attacker.invalid/object"></object>
    <object data="data:text/html,object"></object>
    <iframe src="blob:frame"></iframe>
    <iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>
    <frame src="data:text/html,frame">
    <embed src="blob:embed">
    <area href="blob:area">
    <area href="https:attacker.invalid/leak">
    <area href="https%253Aattacker.invalid/leak">
    <form action="data:text/html,form"><button formaction="blob:submit">Submit</button></form>
    <a href="data:text/html,anchor">Unsafe</a>
    <img src="data:image/png;base64,AA==">
    <video poster="https://attacker.invalid/poster.png"></video>
    <svg><image xlink:href="https://attacker.invalid/svg.png" /></svg>
    <div style="background:url(javascript:alert(1))" onclick="globalThis.pwned=true"></div>
    <script>globalThis.pwned = true</script>
    <meta http-equiv="refresh" content="0;url=https://attacker.invalid/refresh">
  </body></html>`);

  expect(secured).not.toContain('<script>');
  expect(secured).not.toContain('onclick=');
  expect(secured).not.toMatch(/http-equiv=["']?refresh/i);
  expect(secured).not.toContain('data="https:');
  expect(secured).not.toContain('data="data:text/html,object"');
  expect(secured).not.toContain('src="blob:frame"');
  expect(secured).not.toContain('srcdoc=');
  expect(secured).not.toContain('src="data:text/html,frame"');
  expect(secured).not.toContain('src="blob:embed"');
  expect(secured).not.toContain('href="blob:area"');
  expect(secured).not.toContain('href="https:attacker.invalid/leak"');
  expect(secured).not.toContain('href="https%253Aattacker.invalid/leak"');
  expect(secured).not.toContain('action="data:text/html,form"');
  expect(secured).not.toContain('formaction="blob:submit"');
  expect(secured).not.toContain('href="data:text/html,anchor"');
  expect(secured).toContain('src="data:image/png;base64,AA=="');
  expect(secured).not.toContain('poster="https:');
  expect(secured).not.toContain('xlink:href="https:');
  expect(secured).toContain('srcset="images/local.png 1x"');
  expect(secured).toContain('url(about:blank)');
  expect(secured).toContain('Content-Security-Policy');
  expect(secured).toContain("frame-src 'none'");
  expect(secured).toContain("object-src 'none'");
  expect(secured).toContain("form-action 'none'");
  expect(secured).toContain("base-uri 'none'");
});

test('injects CSP without a valid head and blocks imports and escaped URLs', () => {
  const secured = securePublicationMarkup(`<html><body><style>
    @import "https://attacker.invalid/import.css";
    .escaped { background: url(\\68 ttps://attacker.invalid/escaped.png) }
  </style><p>No head</p></body></html>`);

  expect(secured).toMatch(/<html><head><meta[^>]+Content-Security-Policy/i);
  expect(secured).not.toContain('@import');
  expect(secured).not.toContain('attacker.invalid');
  expect(secured).toContain('url(about:blank)');

  const fragment = securePublicationMarkup(
    '<p>Malformed headless fragment</p>',
  );
  expect(fragment).toMatch(/^<head><meta[^>]+Content-Security-Policy/i);
});

test('sanitizes href values after DOM entity parsing', () => {
  const document = new DOMParser().parseFromString(
    '<html><head></head><body><a href="java&#x73;cript:alert(1)">Unsafe</a><area href="https&#x3a;attacker.invalid/leak"/></body></html>',
    'text/html',
  );
  const elements = Array.from(document.getElementsByTagName('*'));
  const head = document.getElementsByTagName('head')[0] as HTMLHeadElement;
  const anchor = document.getElementsByTagName('a')[0];
  const area = document.getElementsByTagName('area')[0];

  expect(anchor?.getAttribute('href')).toBe('javascript:alert(1)');
  expect(area?.getAttribute('href')).toBe('https:attacker.invalid/leak');

  Object.defineProperty(document, 'head', { value: head });
  Object.defineProperty(document, 'querySelectorAll', {
    value: (selector: string) => {
      if (selector === 'script, base, meta[http-equiv="refresh" i]') return [];
      if (selector === '*') return elements;
      if (selector === 'style')
        return elements.filter((element) => element.tagName === 'style');
      return elements.filter((element) =>
        Array.from(element.attributes).some((attribute) =>
          [
            'src',
            'href',
            'xlink:href',
            'data',
            'poster',
            'srcdoc',
            'action',
            'formaction',
            'srcset',
            'style',
          ].includes(attribute.name),
        ),
      );
    },
  });
  Object.defineProperty(head, 'prepend', {
    value: (node: Node) => head.insertBefore(node, head.firstChild),
  });

  securePublicationDocument(document);

  expect(anchor?.hasAttribute('href')).toBe(false);
  expect(area?.hasAttribute('href')).toBe(false);
});
