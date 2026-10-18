import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const index = process.argv.indexOf('--baseline');
if (index < 0 || !process.argv[index + 1])
  throw new Error('Pass --baseline <previous-native-runtime-directory>.');
const roots = {
  baseline: resolve(process.argv[index + 1]),
  candidate: resolve('packages/native-reader/pdf-runtime'),
};
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let page = 1; page <= 3; page++)
  pdf
    .addPage([400, 520])
    .drawText(`Equivalent PDF page ${page}`, { x: 30, y: 450, size: 16, font });
const bytes = Array.from(await pdf.save());
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/')
      return response.end('<!doctype html><body style="margin:0"></body>');
    const [, kind, ...parts] = request.url.split('/');
    if (
      !roots[kind] ||
      !parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '..')
    )
      throw new Error('path');
    const path = parts.join('/');
    const manifest = JSON.parse(
      await readFile(join(roots[kind], 'manifest.json')),
    );
    const entry = manifest.files.find((file) => file.path === path);
    if (!entry) throw new Error('asset');
    response.setHeader('Content-Type', entry.mimeType);
    response.end(await readFile(join(roots[kind], path)));
  } catch {
    response.writeHead(404).end();
  }
});
let browser;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  const evidence = {};
  for (const kind of Object.keys(roots)) {
    const page = await browser.newPage({
      viewport: { width: 900, height: 700 },
    });
    const external = [];
    await page.route('**/*', (route) => {
      if (
        route
          .request()
          .url()
          .startsWith(origin + '/')
      )
        return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    await page.goto(origin);
    evidence[kind] = await page.evaluate(
      async ({ origin, kind, bytes }) => {
        const { document, window } = globalThis;
        const base = `${origin}/${kind}/`;
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        style.href = base + 'pdf.css';
        const styled = new Promise((resolve, reject) => {
          style.onload = resolve;
          style.onerror = reject;
        });
        document.head.append(style);
        await styled;
        const { createPdfDomSession } = await import(base + 'adapter.js');
        const viewport = document.createElement('main');
        viewport.className = 'hn-pdf-viewport';
        viewport.style.cssText =
          'position:relative;width:600px;height:600px;overflow:auto';
        document.body.append(viewport);
        const states = [],
          pages = [];
        let metadata, selection, ready;
        const rendered = new Promise((resolve) => {
          ready = resolve;
        });
        const host = new Uint8Array(bytes);
        const session = createPdfDomSession({
          viewport,
          coordinateRoot: viewport,
          bytes: host,
          identity: { sessionId: 'comparison', generation: 1 },
          assetBaseUrl: base,
          events: {
            onStateChange(value) {
              states.push(value);
              if (value.status === 'ready') ready();
            },
            onMetadata(value) {
              metadata = value;
            },
            onPageChange(value) {
              pages.push(value);
            },
            onSelectionChange(_identity, value) {
              selection = value;
            },
          },
        });
        try {
          await rendered;
          const canvas = viewport.querySelector('canvas');
          const pixels = canvas
            .getContext('2d')
            .getImageData(0, 0, canvas.width, canvas.height).data;
          const digest = Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)),
          )
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('');
          const span = viewport.querySelector('.textLayer span');
          const range = document.createRange();
          range.selectNodeContents(span);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
          const thumbnail = await session.getThumbnail(3);
          const invalid = await session.goToPage(4);
          return {
            metadata,
            states,
            pages,
            digest,
            text: viewport.textContent,
            selection,
            thumbnail,
            invalid,
            hostBytesIntact: host.every(
              (value, index) => value === bytes[index],
            ),
          };
        } finally {
          session.dispose();
          viewport.remove();
        }
      },
      { origin, kind, bytes },
    );
    assert.deepEqual(external, []);
    await page.close();
  }
  assert.deepEqual(evidence.candidate, evidence.baseline);
  assert.equal(evidence.candidate.metadata.pageCount, 3);
  assert.equal(evidence.candidate.selection.text, 'Equivalent PDF page 1');
  assert.equal(evidence.candidate.thumbnail.pageNumber, 3);
  assert.equal(evidence.candidate.invalid, false);
  assert.equal(evidence.candidate.hostBytesIntact, true);
  console.log(
    'Baseline/candidate identical: metadata, loading/ready and page events, exact canvas pixels, text, thumbnail, selection payload, bounds and private bytes; external requests zero.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
