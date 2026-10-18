import { expect, test, type Page } from '@playwright/test';
import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';

let bytes: Buffer;
type TestPdfEvent = {
  type: string;
  commandId?: number;
  state?: { status: string; error: { code: string } };
  result?: boolean | { pageNumber: number };
  page?: { pageNumber: number };
};
declare global {
  interface Window {
    pdfTestEvents: TestPdfEvent[];
    pdfTestSend: (value: unknown) => void;
  }
}
const androidIdentity = {
  sessionId: '00000000-0000-0000-0000-000000000001',
  generation: 1,
};
test.beforeAll(async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= 8; number++) {
    const page = pdf.addPage([400, 520]);
    if (number === 3) page.setRotation(degrees(90));
    page.drawRectangle({
      x: 20,
      y: 20,
      width: 360,
      height: 480,
      color: rgb(0.96, 0.97, 0.98),
    });
    page.drawText(`Expo PDF selectable page ${number}`, {
      x: 30,
      y: 450,
      size: 16,
      font,
    });
    page.drawText('Offline physical page content', {
      x: 30,
      y: 410,
      size: 12,
      font,
    });
  }
  pdf.catalog.set(
    PDFName.of('OpenAction'),
    pdf.context.obj({
      S: PDFName.of('JavaScript'),
      JS: PDFString.of('fetch("https://pdf-canary.invalid/")'),
    }),
  );
  bytes = Buffer.from(await pdf.save());
});
async function upload(page: Page, buffer = bytes, name = 'renamed.epub') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('select-epub').click();
  await (await chooser).setFiles({ name, mimeType: '', buffer });
}
async function open(page: Page) {
  page.on('pageerror', (error) => console.error(error));
  await page.goto('/');
  await upload(page);
  await expect(page.getByTestId('reader-status')).toContainText(
    'Now reading:',
    { timeout: 15000 },
  );
}

test('Android shared shell reads only a private port URL and disposes its actual PDF worker', async ({
  page,
}) => {
  const requested: string[] = [];
  const documentUrl =
    'http://127.0.0.1:8182/pdf-document/00000000-0000-0000-0000-000000000002/document.pdf';
  await page.route('**/pdf-document/**', async (route) => {
    requested.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: bytes,
      headers: {
        'Content-Length': String(bytes.length),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
  await page.goto('/pdf-runtime/android-reader.html');
  await page.evaluate(() =>
    window.postMessage({ type: 'open', url: 'file:///private.pdf' }, '*'),
  );
  expect(requested).toEqual([]);
  const installed = await page.evaluate(async (identity) => {
    const moduleUrl = '/pdf-runtime/android-shell.mjs';
    const { installPdfAndroidPort } = await import(moduleUrl);
    const channel = new MessageChannel();
    const events: TestPdfEvent[] = [];
    channel.port1.onmessage = (event) => events.push(JSON.parse(event.data));
    window.pdfTestEvents = events;
    window.pdfTestSend = (value: unknown) =>
      channel.port1.postMessage(JSON.stringify(value));
    return installPdfAndroidPort(channel.port2, identity);
  }, androidIdentity);
  expect(installed).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.pdfTestEvents[0]?.type))
    .toBe('boot');
  const send = async (value: Record<string, unknown>) =>
    page.evaluate((command) => window.pdfTestSend(command), {
      protocol: 'hamster-pdf',
      version: 1,
      ...androidIdentity,
      commandId: 0,
      ...value,
    });
  await send({ type: 'open', url: 'https://pdf-canary.invalid/document.pdf' });
  await send({ type: 'open', generation: 2, url: documentUrl });
  await send({ type: 'open', url: documentUrl });
  await expect(page.locator('[data-pdf-page="1"]')).toHaveAttribute(
    'data-pdf-rendered',
    'true',
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.pdfTestEvents.some((event) => event.state?.status === 'ready'),
      ),
    )
    .toBe(true);
  expect(requested).toEqual([documentUrl]);
  await send({ type: 'navigate', commandId: 1, pageNumber: 2 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.pdfTestEvents.some(
          (event) => event.commandId === 1 && event.result === true,
        ),
      ),
    )
    .toBe(true);
  await send({ type: 'navigate', commandId: 1, pageNumber: 3 });
  await send({ type: 'thumbnail', commandId: 2, pageNumber: 2 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const result = window.pdfTestEvents.find(
          (event) => event.commandId === 2,
        )?.result;
        return result && typeof result === 'object' ? result.pageNumber : null;
      }),
    )
    .toBe(2);
  const lastPage = await page.evaluate(
    () =>
      window.pdfTestEvents.filter((event) => event.type === 'page').at(-1)?.page
        ?.pageNumber,
  );
  expect(lastPage).toBe(2);
  const darkPixels = await page
    .locator('[data-pdf-page="2"] canvas')
    .evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0;
      for (let index = 0; index < data.length; index += 4)
        if (data[index]! < 100) dark++;
      return dark;
    });
  expect(darkPixels).toBeGreaterThan(100);
  await send({ type: 'dispose', commandId: 3 });
  await expect(page.locator('main canvas')).toHaveCount(0);
});

test('Android shared shell rejects a document response with the wrong MIME', async ({
  page,
}) => {
  await page.route('**/pdf-document/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: bytes,
      headers: { 'Content-Length': String(bytes.length) },
    }),
  );
  await page.goto('/pdf-runtime/android-reader.html');
  await page.evaluate(async (identity) => {
    const moduleUrl = '/pdf-runtime/android-shell.mjs';
    const { installPdfAndroidPort } = await import(moduleUrl);
    const channel = new MessageChannel();
    window.pdfTestEvents = [];
    channel.port1.onmessage = (event) => {
      const value = JSON.parse(event.data);
      window.pdfTestEvents.push(value);
      if (value.type === 'boot')
        channel.port1.postMessage(
          JSON.stringify({
            protocol: 'hamster-pdf',
            version: 1,
            ...identity,
            commandId: 0,
            type: 'open',
            url: `${location.origin}/pdf-document/00000000-0000-0000-0000-000000000002/document.pdf`,
          }),
        );
    };
    installPdfAndroidPort(channel.port2, identity);
  }, androidIdentity);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.pdfTestEvents.find((event) => event.state?.status === 'error')
            ?.state?.error.code,
      ),
    )
    .toBe('PDF_SOURCE_READ_FAILED');
  await expect(page.locator('canvas')).toHaveCount(0);
});
test('Expo export renders the exact offline runtime, Pages and rotated text across viewports', async ({
  page,
}, info) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (
      !request
        .url()
        .startsWith(`${new URL(info.project.use.baseURL!).origin}/`) &&
      !request.url().startsWith('blob:') &&
      !request.url().startsWith('data:')
    )
      external.push(request.url());
  });
  await open(page);
  const frame = page.frameLocator('iframe[title="PDF document"]');
  await expect(frame.locator('[data-pdf-page="1"]')).toHaveAttribute(
    'data-pdf-rendered',
    'true',
  );
  await expect(frame.locator('[data-pdf-page="1"] .textLayer')).toContainText(
    'Expo PDF selectable page 1',
  );
  await expect(
    page.getByRole('button', { name: 'Page 1', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('pdf-thumbnail-1')).toBeVisible();
  const toolbarTop = await page
    .getByLabel('Page position')
    .evaluate((node) => node.getBoundingClientRect().top);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByLabel('Page position')).toHaveText('2 / 8');
  expect(
    await page
      .getByLabel('Page position')
      .evaluate((node) => node.getBoundingClientRect().top),
  ).toBe(toolbarTop);
  await page
    .getByRole('button', { name: 'Previous page', exact: true })
    .click();
  await expect(page.getByLabel('Page position')).toHaveText('1 / 8');
  if (
    (await page
      .getByRole('button', { name: 'Pages', exact: true })
      .getAttribute('aria-expanded')) === 'false'
  )
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByTestId('pdf-pages-list').evaluate((node) => {
    node.scrollTop = 1500;
    node.dispatchEvent(new Event('scroll'));
  });
  await page
    .getByRole('button', { name: 'Page 8', exact: true })
    .scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Page 8', exact: true }).click();
  await expect(page.getByLabel('Page position')).toHaveText('8 / 8');
  await expect(frame.locator('[data-pdf-page="8"]')).toHaveAttribute(
    'data-pdf-rendered',
    'true',
  );
  if (info.project.name === 'chromium-mobile')
    await expect(
      page.getByRole('button', { name: 'Pages', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false');
  if (
    (await page
      .getByRole('button', { name: 'Pages', exact: true })
      .getAttribute('aria-expanded')) === 'false'
  )
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page
    .getByRole('button', { name: 'Page 3', exact: true })
    .scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Page 3', exact: true }).click();
  await expect(frame.locator('[data-pdf-page="3"]')).toHaveAttribute(
    'data-pdf-rendered',
    'true',
  );
  await page.getByRole('button', { name: 'Rotate page', exact: true }).click();
  await expect(frame.locator('[data-pdf-page="3"]')).toHaveAttribute(
    'data-pdf-rendered',
    'true',
  );
  const pixels = await frame
    .locator('[data-pdf-page="3"] canvas')
    .evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0;
      for (let index = 0; index < data.length; index += 4)
        if (
          data[index]! < 100 &&
          data[index + 1]! < 100 &&
          data[index + 2]! < 100
        )
          dark++;
      return dark;
    });
  expect(pixels).toBeGreaterThan(100);
  const width = await frame
    .locator('[data-pdf-page="3"]')
    .evaluate((node) => node.getBoundingClientRect().width);
  await page.getByLabel('Zoom percent').fill('150');
  await page.getByLabel('Zoom percent').press('Tab');
  await expect
    .poll(async () =>
      Math.round(
        ((await frame
          .locator('[data-pdf-page="3"]')
          .evaluate((node) => node.getBoundingClientRect().width)) /
          width) *
          100,
      ),
    )
    .toBe(150);
  await page.getByLabel('Zoom percent').fill('100');
  await page.getByLabel('Zoom percent').press('Tab');
  for (let turn = 0; turn < 3; turn++)
    await page
      .getByRole('button', { name: 'Rotate page', exact: true })
      .click();
  if (
    (await page
      .getByRole('button', { name: 'Pages', exact: true })
      .getAttribute('aria-expanded')) === 'false'
  )
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByTestId('pdf-pages-list').evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  await page.getByRole('button', { name: 'Page 1', exact: true }).click();
  await expect(frame.locator('[data-pdf-page="1"]')).toHaveAttribute(
    'data-pdf-rendered',
    'true',
  );
  expect(
    await frame.locator('.hn-pdf-viewport canvas').count(),
  ).toBeLessThanOrEqual(5);
  await page.screenshot({
    path: info.outputPath('expo-pdf.png'),
    fullPage: true,
  });
  expect(external).toEqual([]);
});
test('RN Popover uses frame offsets, preserves text and has no storage side effects', async ({
  page,
  isMobile,
}) => {
  await open(page);
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  await pages.click();
  const frame = page.frameLocator('iframe[title="PDF document"]');
  const span = frame.locator('[data-pdf-page="1"] .textLayer span').first();
  await expect(span).toBeVisible();
  if (!isMobile) {
    const bounds = (await span.boundingBox())!;
    await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width - 2,
      bounds.y + bounds.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
  } else
    await span.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
  const highlight = page.getByRole('button', { name: '高亮', exact: true });
  await expect(highlight).toBeVisible();
  const text = await span.evaluate(() => window.getSelection()!.toString());
  const bounds = (await highlight.boundingBox())!;
  const root = (await page.getByTestId('demo-reader').boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(root.x);
  expect(bounds.y).toBeGreaterThanOrEqual(root.y);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(root.y + root.height);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(root.x + root.width);
  expect(
    await page.evaluate(() =>
      document.body.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      ),
    ),
  ).toBe(true);
  expect(
    await span.evaluate(
      (node) =>
        !node.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        ),
    ),
  ).toBe(true);
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...localStorage }),
  );
  await highlight.click({ clickCount: 2 });
  expect(await span.evaluate(() => window.getSelection()!.toString())).toBe(
    text,
  );
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).toBe(
    storage,
  );
  await frame.locator('.hn-pdf-viewport').evaluate((node) => {
    node.scrollTop = 80;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect(highlight).toHaveCount(0);
});
test('replacement retires the iframe, ignores stale messages and preserves host bytes', async ({
  page,
}) => {
  await open(page);
  const old = page
    .frames()
    .find((frame) => frame.url().includes('/pdf-runtime/reader.html'))!;
  const identity = await old.evaluate(() =>
    Object.fromEntries(new URLSearchParams(location.hash.slice(1))),
  );
  await page.evaluate(() => {
    const original = URL.revokeObjectURL.bind(URL);
    Object.assign(window, { revokedPdfUrls: [] });
    URL.revokeObjectURL = (uri) => {
      (window as unknown as { revokedPdfUrls: string[] }).revokedPdfUrls.push(
        uri,
      );
      original(uri);
    };
  });
  await upload(page, Buffer.from('%PDF-invalid'), 'corrupt.pdf');
  await expect(page.getByTestId('reader-status')).toContainText(
    'could not be displayed',
  );
  expect(old.isDetached()).toBe(true);
  await page.evaluate(
    (id) =>
      window.postMessage(
        {
          protocol: 'hamster-pdf',
          version: 1,
          ...id,
          generation: Number(id.generation),
          commandId: 0,
          type: 'state',
          state: {
            ...id,
            generation: Number(id.generation),
            status: 'ready',
            pageCount: 8,
            pageNumber: 1,
          },
        },
        location.origin,
      ),
    identity,
  );
  await expect(page.getByTestId('reader-status')).toContainText(
    'could not be displayed',
  );
  await upload(page);
  await expect(page.getByTestId('reader-status')).toContainText('Now reading:');
  const publication = await page.evaluate(
    () => (window as unknown as { revokedPdfUrls: string[] }).revokedPdfUrls,
  );
  expect(publication.length).toBe(2); // Only the host demo revokes its previous sources.
});

test('a missing PDF shell permits only the bounded probe and never a complete source read', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    Object.assign(window, { pdfSourceReads: [] });
    window.fetch = (input, init) => {
      if (String(input).startsWith('blob:'))
        (window as unknown as { pdfSourceReads: string[] }).pdfSourceReads.push(
          new Headers(init?.headers).get('Range') ?? 'full',
        );
      return original(input, init);
    };
  });
  await page.route('**/pdf-runtime/reader.html', (route) => route.abort());
  await page.goto('/?loadInactivityTimeoutMs=600');
  await upload(page);
  await expect(page.getByTestId('reader-status')).toContainText(
    /PDF frame|packaged PDF shell|loading progress/,
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { pdfSourceReads: string[] }).pdfSourceReads,
    ),
  ).toEqual(['bytes=0-4']);
  await expect(page.locator('iframe[title="PDF document"]')).toHaveCount(0);
});

test('replacing a source while its worker loads retires the old frame and late work', async ({
  page,
}) => {
  let resume: (() => void) | undefined;
  let observed!: () => void;
  const requested = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let first = true;
  await page.route('**/pdf-runtime/pdf.worker.min.mjs', async (route) => {
    if (first) {
      first = false;
      observed();
      await new Promise<void>((resolve) => {
        resume = resolve;
      });
    }
    await route.continue().catch(() => undefined);
  });
  try {
    await page.goto('/');
    await upload(page);
    await requested;
    const old = page
      .frames()
      .find((frame) => frame.url().includes('/pdf-runtime/reader.html'))!;
    const replacement = await PDFDocument.create();
    replacement
      .addPage([400, 520])
      .drawText('Replacement document', { x: 30, y: 450, size: 16 });
    replacement.addPage([400, 520]);
    await upload(
      page,
      Buffer.from(await replacement.save()),
      'replacement.epub',
    );
    await expect(page.getByTestId('reader-status')).toContainText(
      'Now reading: replacement.epub',
    );
    expect(old.isDetached()).toBe(true);
    resume?.();
    await expect(
      page
        .frameLocator('iframe[title="PDF document"]')
        .locator('[data-pdf-page="1"] .textLayer'),
    ).toContainText('Replacement document');
    await expect(page.getByLabel('Page position')).toHaveText('1 / 2');
    await expect(page.locator('iframe[title="PDF document"]')).toHaveCount(1);
  } finally {
    resume?.();
  }
});
