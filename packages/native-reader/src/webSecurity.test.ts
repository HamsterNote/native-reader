import { isSafePublicationUrl, securePublicationMarkup } from './webSecurity';

test('uses a default-deny URL policy', () => {
  expect(isSafePublicationUrl('images/cover.jpg')).toBe(true);
  expect(isSafePublicationUrl('blob:local')).toBe(true);
  expect(isSafePublicationUrl('data:image/png;base64,AA==')).toBe(true);
  expect(isSafePublicationUrl('https://attacker.invalid/a')).toBe(false);
  expect(isSafePublicationUrl('//attacker.invalid/a')).toBe(false);
  expect(isSafePublicationUrl('about:srcdoc')).toBe(false);
  expect(isSafePublicationUrl('javascript:alert(1)')).toBe(false);
  expect(isSafePublicationUrl('java%73cript:alert(1)')).toBe(false);
  expect(isSafePublicationUrl('https:%0a//attacker.invalid')).toBe(false);
  expect(isSafePublicationUrl('//attacker.invalid/%0a')).toBe(false);
});

test('sanitizes every resource-bearing HTML and CSS form', () => {
  const secured =
    securePublicationMarkup(`<html><head><style>.x{background:url(https://attacker.invalid/css)}</style></head><body>
    <img src="images/local.png" srcset="images/local.png 1x, https://attacker.invalid/2x 2x">
    <object data="https://attacker.invalid/object"></object>
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
  expect(secured).not.toContain('poster="https:');
  expect(secured).not.toContain('xlink:href="https:');
  expect(secured).toContain('srcset="images/local.png 1x"');
  expect(secured).toContain('url(about:blank)');
  expect(secured).toContain('Content-Security-Policy');
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
