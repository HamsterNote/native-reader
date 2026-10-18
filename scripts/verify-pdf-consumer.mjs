import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const args = process.argv.slice(2);
const argument = (key) => args[args.indexOf(key) + 1];
if (!args.includes('--tarball') || !args.includes('--sha256'))
  throw new Error(
    'Pass the actual --tarball and --sha256 from isolated-release.',
  );
const tarball = resolve(argument('--tarball'));
assert.equal(
  createHash('sha256')
    .update(await readFile(tarball))
    .digest('hex'),
  argument('--sha256'),
);
const temporary = await mkdtemp(join(tmpdir(), 'hn-pdf-consumer-'));
let server;
let browser;
try {
  const names = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .trim()
    .split('\n');
  assert(
    names.every(
      (name) =>
        /^package\/[A-Za-z0-9_./+-]+$/.test(name) &&
        !name.split('/').includes('..'),
    ),
  );
  const types = execFileSync('tar', ['-tvzf', tarball], { encoding: 'utf8' })
    .trim()
    .split('\n');
  assert(
    types.every((line) => /^[d-]/.test(line)),
    'Tarball contains links or special files',
  );
  execFileSync('tar', ['-xzf', tarball, '-C', temporary]);
  const scope = join(temporary, 'node_modules/@hamster-note');
  await mkdir(scope, { recursive: true });
  const packageRoot = join(scope, 'native-reader');
  await rename(join(temporary, 'package'), packageRoot);
  // No peer dependencies are installed: this entry must stay platform-free.
  const contractCheck = `
    const { isPdfPageNumber, getPdfPopoverPosition } = CONTRACTS;
    if (!isPdfPageNumber(1, 3) || isPdfPageNumber(4, 3) ||
        getPdfPopoverPosition(null, 400, 500) !== null)
      throw new Error('Packed PDF contracts are incompatible');
  `;
  for (const [mode, load] of [
    ['commonjs', "require('@hamster-note/native-reader/pdf-contracts')"],
    ['module', "await import('@hamster-note/native-reader/pdf-contracts')"],
  ])
    execFileSync(
      process.execPath,
      [`--input-type=${mode}`, '-e', contractCheck.replace('CONTRACTS', load)],
      { cwd: temporary, stdio: 'pipe' },
    );
  for (const name of [
    'pdf-contracts.mts',
    'pdf-contracts.cts',
    'tsconfig.pdf.json',
  ])
    await copyFile(
      new URL(
        `../packages/native-reader/consumer-test/${name}`,
        import.meta.url,
      ),
      join(temporary, name),
    );
  execFileSync(
    process.execPath,
    [
      new URL('../node_modules/typescript/bin/tsc', import.meta.url).pathname,
      '--project',
      join(temporary, 'tsconfig.pdf.json'),
    ],
    { cwd: temporary, stdio: 'pipe' },
  );
  execFileSync(
    process.execPath,
    [
      join(packageRoot, 'scripts/sync-pdf-web-runtime.mjs'),
      '--target',
      join(temporary, 'public'),
    ],
    { encoding: 'utf8' },
  );
  execFileSync(
    process.execPath,
    [
      join(packageRoot, 'scripts/sync-pdf-web-runtime.mjs'),
      '--target',
      join(temporary, 'public'),
      '--check',
    ],
    { encoding: 'utf8' },
  );
  const root = join(temporary, 'public/pdf-runtime');
  const manifest = JSON.parse(
    await readFile(join(root, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.pdfjsVersion, '5.4.530');
  assert.equal('reader' in manifest, false);
  server = createServer(async (request, response) => {
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html><body style="margin:0;height:700px"></body></html>',
      );
      return;
    }
    const entry = manifest.files.find(
      (file) => request.url === `/pdf-runtime/${file.path}`,
    );
    if (!entry) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', entry.mimeType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(await readFile(join(root, entry.path)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= 3; number++)
    pdf.addPage([400, 520]).drawText(`Packed native PDF page ${number}`, {
      x: 30,
      y: 450,
      size: 16,
      font,
    });
  const bytes = Array.from(await pdf.save());
  browser = await chromium.launch();
  const page = await browser.newPage();
  const external = [];
  const liveWorkers = new Set();
  page.on('worker', (worker) => {
    liveWorkers.add(worker);
    worker.on('close', () => liveWorkers.delete(worker));
  });
  await page.route('**/*', (route) => {
    if (route.request().url().startsWith(`${origin}/`)) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto(origin);
  const evidence = await page.evaluate(
    async ({ bytes, origin }) => {
      const { acceptPdfEvent, PDF_PROTOCOL, PDF_PROTOCOL_VERSION } =
        await import(`${origin}/pdf-runtime/protocol.js`);
      const identity = { sessionId: crypto.randomUUID(), generation: 1 };
      const frame = globalThis.document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      frame.style.cssText = 'width:100%;height:650px;border:0';
      frame.src = `${origin}/pdf-runtime/reader.html#${new URLSearchParams({ sessionId: identity.sessionId, generation: '1' })}`;
      const input = new Uint8Array(bytes);
      let nextCommand = 0;
      let ready, reject;
      const displayed = new Promise((resolve, fail) => {
        ready = resolve;
        reject = fail;
      });
      const readyTimeout = setTimeout(
        () => reject(new Error('Packed PDF runtime did not become ready.')),
        15000,
      );
      const pending = new Map();
      const states = [];
      const send = (value, transfers = []) => {
        const id = ++nextCommand;
        frame.contentWindow.postMessage(
          {
            protocol: PDF_PROTOCOL,
            version: PDF_PROTOCOL_VERSION,
            ...identity,
            commandId: id,
            ...value,
          },
          origin,
          transfers,
        );
        return id;
      };
      const receive = (event) => {
        const value = acceptPdfEvent(
          event,
          frame.contentWindow,
          origin,
          identity,
        );
        if (!value) return;
        if (value.type === 'boot') {
          const owned = input.slice();
          send({ type: 'open', bytes: owned.buffer }, [owned.buffer]);
        }
        if (value.type === 'state') {
          states.push(value.state.status);
          if (value.state.status === 'ready') ready();
          if (value.state.status === 'error')
            reject(new Error(value.state.error.code));
        }
        if (value.type === 'result') {
          pending.get(value.commandId)?.(value.result);
          pending.delete(value.commandId);
        }
      };
      globalThis.window.addEventListener('message', receive);
      globalThis.document.body.append(frame);
      try {
        await displayed;
        const main = frame.contentDocument.querySelector('main');
        const canvas = main.querySelector('canvas');
        const pixels = canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0;
        for (let index = 0; index < pixels.length; index += 4)
          if (
            pixels[index] < 100 &&
            pixels[index + 1] < 100 &&
            pixels[index + 2] < 100
          )
            dark++;
        const request = (value) =>
          new Promise((resolve, fail) => {
            const id = send(value);
            const timer = setTimeout(
              () => fail(new Error('PDF command timed out.')),
              5000,
            );
            pending.set(id, (result) => {
              clearTimeout(timer);
              resolve(result);
            });
          });
        const thumbnail = await request({ type: 'thumbnail', pageNumber: 3 });
        const invalid = await request({ type: 'navigate', pageNumber: 4 });
        return {
          states,
          text: main.textContent,
          dark,
          thumbnail: thumbnail && {
            number: thumbnail.pageNumber,
            width: thumbnail.width,
            height: thumbnail.height,
          },
          invalid,
          hostBytesIntact: input.every(
            (value, index) => value === bytes[index],
          ),
        };
      } finally {
        clearTimeout(readyTimeout);
        send({ type: 'dispose' });
        frame.remove();
        globalThis.window.removeEventListener('message', receive);
      }
    },
    { bytes, origin },
  );
  assert.deepEqual(evidence.states, ['loading', 'ready']);
  assert.match(evidence.text, /Packed native PDF page 1/);
  assert(evidence.dark > 100);
  assert.equal(evidence.thumbnail.number, 3);
  assert(evidence.thumbnail.width <= 112 && evidence.thumbnail.height <= 150);
  assert.equal(evidence.invalid, false);
  assert(evidence.hostBytesIntact);
  assert.deepEqual(external, []);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(liveWorkers.size, 0);
  console.log(
    `Actual native-reader tarball consumer passed: ESM/CJS/no-DOM contracts, ${manifest.files.length} exact offline assets, private bytes, canvas/text/thumbnail, bounds, host ownership and worker teardown. SHA256 ${argument('--sha256')}`,
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
