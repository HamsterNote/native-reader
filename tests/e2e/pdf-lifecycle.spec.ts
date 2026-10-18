import { expect, test } from '@playwright/test';

// Ported from the archived DOM adapter lifecycle tests. Only the engine is
// controlled; DOM, scheduling and the compiled adapter run in the browser.
const engine = `
const mock = globalThis.pdfLifecycle = { pages: [], renders: 0, cleanups: 0, failPage: 0, hold: false, finish: [] };
export const PDFWorker = { create: () => ({ destroy() {} }) };
export class TextLayer { async render() {} cancel() {} }
export function getDocument() {
  return { destroy: async () => {}, promise: Promise.resolve({ numPages: 80,
    async getPage(number) {
      mock.pages.push(number);
      if (number === mock.failPage) throw new Error('thumbnail unavailable');
      return { rotate: 0, cleanup() { mock.cleanups++; },
        getViewport: ({scale}) => ({width:400*scale,height:520*scale,rotation:0}),
        getTextContent: async () => ({}),
        render() { mock.renders++; return { cancel() {}, promise: mock.hold ? new Promise(resolve => mock.finish.push(resolve)) : Promise.resolve() }; }
      };
    }
  }) };
}
`;

test.beforeEach(async ({ page }) => {
  await page.route('**/pdf-runtime/pdf.min.mjs', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: engine,
    }),
  );
  await page.goto('/');
});

test('thumbnail failure stays local and invalid pages never reach the engine', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createPdfDomSession } = await import('/pdf-runtime/adapter.js');
    const viewport = document.createElement('div');
    viewport.style.cssText =
      'position:relative;width:600px;height:520px;overflow:auto';
    document.body.append(viewport);
    const states: string[] = [];
    let ready!: () => void;
    const rendered = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const session = createPdfDomSession({
      viewport,
      coordinateRoot: viewport,
      bytes: new Uint8Array([1]),
      identity: { sessionId: 'lifecycle', generation: 1 },
      assetBaseUrl: new URL('/pdf-runtime/', location.href).href,
      events: {
        onStateChange(state: { status: string }) {
          states.push(state.status);
          if (state.status === 'ready') ready();
        },
        onMetadata() {},
        onPageChange() {},
        onSelectionChange() {},
      },
    });
    await rendered;
    // @ts-expect-error Test-only engine diagnostics.
    const mock = window.pdfLifecycle;
    const invalid = [
      await session.getThumbnail(0),
      await session.getThumbnail(81),
    ];
    const invalidCalls = mock.pages.filter(
      (number: number) => number === 0 || number === 81,
    ).length;
    mock.failPage = 40;
    const failed = await session.getThumbnail(40);
    const next = await session.getThumbnail(41);
    await session.goToPage(20);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const surfaces = viewport.querySelectorAll('canvas').length;
    session.dispose();
    viewport.remove();
    return {
      invalid,
      invalidCalls,
      failed,
      next,
      states,
      surfaces,
      cleanups: mock.cleanups,
    };
  });
  expect(result.invalid).toEqual([null, null]);
  expect(result.invalidCalls).toBe(0);
  expect(result.failed).toBeNull();
  expect(result.next).toMatchObject({ pageNumber: 41, generation: 1 });
  expect(result.states).toEqual(['loading', 'ready']);
  expect(result.surfaces).toBeLessThanOrEqual(5);
  expect(result.cleanups).toBeGreaterThan(0);
});

test('dispose settles queued thumbnails and late renders cannot restore old content', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createPdfDomSession } = await import('/pdf-runtime/adapter.js');
    const viewport = document.createElement('div');
    viewport.style.cssText =
      'position:relative;width:600px;height:520px;overflow:auto';
    document.body.append(viewport);
    let ready!: () => void;
    const rendered = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let pageEvents = 0;
    const session = createPdfDomSession({
      viewport,
      coordinateRoot: viewport,
      bytes: new Uint8Array([1]),
      identity: { sessionId: 'retired', generation: 1 },
      assetBaseUrl: new URL('/pdf-runtime/', location.href).href,
      events: {
        onStateChange(state: { status: string }) {
          if (state.status === 'ready') ready();
        },
        onMetadata() {},
        onPageChange() {
          pageEvents++;
        },
        onSelectionChange() {},
      },
    });
    await rendered;
    // @ts-expect-error Test-only engine diagnostics.
    const mock = window.pdfLifecycle;
    mock.hold = true;
    const thumbnails = [40, 41, 42, 43].map((number) =>
      session.getThumbnail(number),
    );
    while (mock.finish.length < 2)
      await new Promise((resolve) => setTimeout(resolve, 5));
    session.dispose();
    session.dispose();
    const count = pageEvents;
    const values = await Promise.all(thumbnails);
    mock.finish.forEach((resolve: () => void) => resolve());
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = {
      values,
      lateThumbnail: await session.getThumbnail(40),
      lateNavigation: await session.goToPage(1),
      extraEvents: pageEvents - count,
      children: viewport.childElementCount,
    };
    viewport.remove();
    return result;
  });
  expect(result).toEqual({
    values: [null, null, null, null],
    lateThumbnail: null,
    lateNavigation: false,
    extraEvents: 0,
    children: 0,
  });
});
