import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Browser execution of the shipped native renderer, with a private MessagePort
// standing in for the platform transport. This is NOT Android/WK device proof.
const root = path.resolve('packages/native-reader/foliate-runtime/native');
const assetManifest = JSON.parse(
  readFileSync(path.join(root, 'manifest.json'), 'utf8'),
) as { assets: { path: string; mimeType: string }[] };
const assetTypes = new Map(
  assetManifest.assets.map((asset) => [asset.path, asset.mimeType]),
);
const fixtureRoot = path.resolve('fixtures');
const samples = [
  ['epub/valid-epub3.epub', 'epub', 'book.epub', 'application/epub+zip'],
  [
    'fb2/valid-navigation.fb2',
    'fb2',
    'book.fb2',
    'application/x-fictionbook+xml',
  ],
  [
    'fbz/valid-navigation.fbz',
    'fbz',
    'book.fbz',
    'application/x-zip-compressed-fb2',
  ],
  ['cbz/valid-fixed.cbz', 'cbz', 'book.cbz', 'application/vnd.comicbook+zip'],
  [
    'mobi/valid-mobi6.mobi',
    'mobi',
    'book.mobi',
    'application/x-mobipocket-ebook',
  ],
  [
    'kf8/valid-navigation.azw3',
    'kf8-azw3',
    'book.azw3',
    'application/vnd.amazon.ebook',
  ],
];
type Envelope = {
  type: string;
  commandId: string;
  payload: Record<string, unknown>;
};
declare global {
  interface Window {
    nativeTest: {
      events: Envelope[];
      send(
        type: string,
        payload?: Record<string, unknown>,
        nested?: boolean,
      ): Promise<Envelope>;
    };
  }
}

async function install(page: Page) {
  await page.route('**/native/**', async (route) => {
    const relative = new URL(route.request().url()).pathname.slice(
      '/native/'.length,
    );
    const mimeType = assetTypes.get(relative);
    if (!mimeType) return route.fulfill({ status: 404, body: '' });
    await route.fulfill({
      contentType: mimeType,
      body: readFileSync(path.join(root, relative)),
    });
  });
  await page.route('https://example.invalid/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: readFileSync(path.join(root, 'probes/csp-1x1.png')),
    }),
  );
  await page.goto('/native/reader.html');
  await page.evaluate(async () => {
    const url = '/native/bootstrap.js';
    const { installFoliateNativeHostBridge } = await import(url);
    const channel = new MessageChannel();
    const events: Envelope[] = [];
    const waiters = new Map<string, (event: Envelope) => void>();
    channel.port1.onmessage = (event) => {
      const message = JSON.parse(event.data) as Envelope;
      events.push(message);
      if (message.type === 'ack' || message.type === 'error') {
        const resolve = waiters.get(message.commandId);
        waiters.delete(message.commandId);
        resolve?.(message);
        if (message.type === 'error' && message.payload.terminal) {
          for (const waiting of waiters.values()) waiting(message);
          waiters.clear();
        }
      }
    };
    const id = () =>
      btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    const session = id(),
      generation = id(),
      transferId = id();
    window.nativeTest = {
      events,
      send(type, payload = {}, nested = false) {
        const commandId = id();
        const envelope = {
          protocol: 'hn-foliate-host',
          version: 1,
          direction: 'native-to-host',
          type,
          session,
          generation,
          commandId,
          payload,
        };
        if (nested)
          envelope.payload = {
            protocol: 'hn-foliate-transfer',
            version: 1,
            session,
            generation,
            commandId,
            transferId,
            ...payload,
          };
        return new Promise((resolve) => {
          waiters.set(commandId, resolve);
          channel.port1.postMessage(JSON.stringify(envelope));
        });
      },
    };
    if (!installFoliateNativeHostBridge(channel.port2))
      throw new Error('install failed');
  });
  expect((await command(page, 'bind')).payload.status).toBe('bridge-bound');
}
const command = (
  page: Page,
  type: string,
  payload: Record<string, unknown> = {},
  nested = false,
) =>
  page.evaluate(
    ({ type, payload, nested }) =>
      window.nativeTest.send(type, payload, nested),
    { type, payload, nested },
  );
async function transfer(page: Page, sample: string[], corruptDigest = false) {
  const [file, format, name, mimeType] = sample;
  const bytes = readFileSync(path.join(fixtureRoot, file));
  const sha256 = corruptDigest
    ? '0'.repeat(64)
    : createHash('sha256').update(bytes).digest('hex');
  expect(
    (
      await command(
        page,
        'transfer',
        {
          type: 'begin',
          payload: {
            byteLength: bytes.length,
            sha256,
            chunkBytes: 49152,
            format,
            name,
            mimeType,
          },
        },
        true,
      )
    ).payload.status,
  ).toBe('accepted');
  let sequence = 0;
  for (let offset = 0; offset < bytes.length; offset += 49152) {
    expect(
      (
        await command(
          page,
          'transfer',
          {
            type: 'chunk',
            payload: {
              sequence,
              data: bytes.subarray(offset, offset + 49152).toString('base64'),
            },
          },
          true,
        )
      ).payload.status,
    ).toBe('accepted');
    sequence++;
  }
  return command(
    page,
    'transfer',
    { type: 'commit', payload: { chunks: sequence } },
    true,
  );
}

test.beforeEach(async ({ page }) => {
  await install(page);
});
for (const sample of samples)
  test(`native generated runtime opens ${sample[1]} with private bounded transfer`, async ({
    page,
    browserName,
  }) => {
    const probe = await command(page, 'probe');
    if (browserName !== 'chromium') {
      expect(probe.type).toBe('error');
      expect(probe.payload.code).toBe('unsupported');
      await expect(page.locator('foliate-view')).toHaveCount(0);
      return;
    }
    expect(probe.payload.status).toBe('source-authorized');
    expect(await page.locator('foliate-view').count()).toBe(0);
    expect((await transfer(page, sample)).payload.status).toBe('ready');
    const model = (await page.evaluate(
      () =>
        window.nativeTest.events
          .filter((event) => event.type === 'model')
          .at(-1)?.payload.model,
    )) as {
      fixedLayout: boolean;
      flow: string | null;
      sections: { linear: boolean; index: number }[];
      destinations: { id: string }[];
    };
    expect(model.fixedLayout).toBe(sample[1] === 'cbz');
    expect(model.flow).toBe(sample[1] === 'cbz' ? null : 'scrolled');
    await expect(page.locator('foliate-view')).toBeVisible();
    const frames = page
      .mainFrame()
      .childFrames()
      .filter((frame) => frame.url().startsWith('blob:'));
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(
        await frame.evaluate(() => window.frameElement?.getAttribute('csp')),
      ).toContain("script-src 'none'");
    }
    const geometry = async () =>
      Promise.all(
        frames.map((frame) =>
          frame.evaluate(() => ({
            height: window.frameElement?.getBoundingClientRect().height ?? 0,
            style: window.frameElement?.getAttribute('style'),
            images: [...document.images].map((image) => ({
              complete: image.complete,
              width: image.naturalWidth,
              height: image.naturalHeight,
            })),
          })),
        ),
      );
    await expect
      .poll(async () => (await geometry()).some((frame) => frame.height > 0), {
        message: JSON.stringify(await geometry()),
      })
      .toBe(true);
    for (const second of model.sections
      .filter((section) => section.linear)
      .slice(1)) {
      expect(
        (await command(page, 'navigate', { target: second.index })).payload
          .status,
      ).toBe('applied');
      const location = await page.evaluate(
        () =>
          window.nativeTest.events
            .filter((event) => event.type === 'location')
            .at(-1)?.payload.section,
      );
      expect(location).toBe(second.index);
    }
    if (model.destinations.length)
      expect(
        (await command(page, 'navigate', { target: model.destinations[0].id }))
          .payload.status,
      ).toBe('applied');
    const before = await page.evaluate(
      () =>
        window.nativeTest.events
          .filter((event) => event.type === 'location')
          .at(-1)?.payload.section,
    );
    expect(
      (await command(page, 'navigate', { target: 'd:999999' })).payload,
    ).toEqual({ code: 'navigation-failure', terminal: false });
    expect(
      await page.evaluate(
        () =>
          window.nativeTest.events
            .filter((event) => event.type === 'location')
            .at(-1)?.payload.section,
      ),
    ).toBe(before);
    if (!model.fixedLayout)
      for (const flow of ['paginated', 'scrolled']) {
        expect((await command(page, 'flow', { flow })).payload.status).toBe(
          'applied',
        );
        expect(
          await page.evaluate(
            () =>
              (
                window.nativeTest.events
                  .filter((event) => event.type === 'model')
                  .at(-1)?.payload.model as { flow: string }
              ).flow,
          ),
        ).toBe(flow);
      }
    await command(page, 'dispose');
    await expect(page.locator('foliate-view')).toHaveCount(0);
  });

test('native transfer is closed after bind without independent probe', async ({
  page,
}) => {
  const result = await command(
    page,
    'transfer',
    { type: 'commit', payload: { chunks: 1 } },
    true,
  );
  expect(result.payload).toEqual({
    code: 'protocol-violation',
    terminal: true,
  });
  await expect(page.locator('foliate-view')).toHaveCount(0);
});
test('bad digest cannot open a native publication', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium');
  expect((await command(page, 'probe')).payload.status).toBe(
    'source-authorized',
  );
  const result = await transfer(page, samples[1], true);
  expect(result.payload).toEqual({
    code: 'protocol-violation',
    terminal: true,
  });
  await expect(page.locator('foliate-view')).toHaveCount(0);
});

for (const format of ['epub', 'fb2'])
  test(`native ${format} blocks publication network canaries`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium');
    expect((await command(page, 'probe')).payload.status).toBe(
      'source-authorized',
    );
    const requests: string[] = [];
    const failures: string[] = [];
    const responses: string[] = [];
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText === 'csp') failures.push(request.url());
    });
    page.on('response', (response) => {
      if (
        /^https?:/.test(response.url()) &&
        !response.url().includes('/native/')
      )
        responses.push(response.url());
    });
    const popups: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/.test(request.url()) && !request.url().includes('/native/'))
        requests.push(request.url());
    });
    page.on('popup', (popup) => popups.push(popup.url()));
    const sample = [...samples.find((item) => item[1] === format)!];
    sample[0] = `${format}/scripted-external.${format}`;
    expect((await transfer(page, sample)).payload.status).toBe('ready');
    // Reach the malicious FB2 second section through the actual renderer.
    if (format === 'fb2')
      expect(
        (await command(page, 'navigate', { target: 1 })).payload.status,
      ).toBe('applied');
    expect(requests.length).toBeGreaterThan(0);
    await expect
      .poll(() => requests.filter((url) => !failures.includes(url)))
      .toEqual([]);
    expect(responses).toEqual([]);
    expect(popups).toEqual([]);
    await expect(page).toHaveURL(/\/native\/reader.html$/);
    await command(page, 'dispose');
  });
