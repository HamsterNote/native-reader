import {
  expect,
  test,
  type Browser,
  type Frame,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveBrowserRuntimeEvidence } from './browserRuntimeEvidence';

type Fixture = {
  expected: { behaviors: string[] };
  file: string;
  format: string;
  limitations: string[];
};

type FixtureManifest = { fixtures: Fixture[] };

const fixtureRoot = path.resolve(process.cwd(), 'fixtures');
const manifestPath = path.join(fixtureRoot, 'manifest.json');
const manifest = JSON.parse(
  readFileSync(manifestPath, 'utf8'),
) as FixtureManifest;
const openingFixtures = manifest.fixtures.filter((fixture) =>
  fixture.expected.behaviors.includes('opens'),
);

type BrowserObservations = {
  controlProbeRequests: string[];
  externalRequests: string[];
  popups: string[];
  publicationRequests: string[];
};

function isChromium(browserName: string) {
  return browserName === 'chromium';
}

type BrowserRuntimeConfig = {
  channel: unknown;
  hasConnectOptions: boolean;
  launchOptions: { executablePath?: unknown } | undefined;
};

async function attachBrowserVersion(
  browser: Browser,
  testInfo: TestInfo,
  runtimeConfig: BrowserRuntimeConfig,
) {
  // executablePath 记录的是配置证据，不是 OS 进程观测。显式 launchOptions pin
  // 优先于 registry 预期默认值，避免在显式 pin 场景下产生重复 revision。
  const evidence = resolveBrowserRuntimeEvidence({
    browserName: testInfo.project.name,
    version: browser.version(),
    launchOptions: runtimeConfig.launchOptions,
    channel: runtimeConfig.channel,
    hasConnectOptions: runtimeConfig.hasConnectOptions,
    // 仅在显式配置缺失时才会被调用。
    readRegistryExecutablePath: () => browser.browserType().executablePath(),
  });
  await testInfo.attach('browser-runtime.json', {
    body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
    contentType: 'application/json',
  });
}

function observeBrowser(page: Page): BrowserObservations {
  const observations: BrowserObservations = {
    controlProbeRequests: [],
    externalRequests: [],
    popups: [],
    publicationRequests: [],
  };
  page.on('request', (request) => {
    const url = request.url();
    // The trusted reader host deliberately loads these control assets before
    // checking the identical strict-CSP case. They are positive evidence, not
    // publication network I/O.
    if (url.includes('/reader/probes/'))
      observations.controlProbeRequests.push(url);
    // A hosted publication is only ever read from a private host-owned blob.
    // Any blob request while the host asset is missing is publication I/O.
    if (url.startsWith('blob:')) observations.publicationRequests.push(url);
    if (
      new URL(url).hostname === 'example.invalid' &&
      !url.includes('/__hn-csp-probe-')
    )
      observations.externalRequests.push(url);
  });
  page.on('popup', (popup) => observations.popups.push(popup.url()));
  return observations;
}

async function openFixture(page: Page, fixture: Fixture) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('select-epub').click();
  await (await chooser).setFiles(path.join(fixtureRoot, fixture.file));
}

async function expectReady(page: Page, fixture: Fixture) {
  await expect(page.getByTestId('source-state')).toHaveText(
    `Selected: ${path.basename(fixture.file)}`,
  );
  await expect(page.getByTestId('reader-status')).toHaveText(
    `Now reading: ${path.basename(fixture.file)}`,
    { timeout: 20_000 },
  );
  await expect(page.getByTestId('demo-reader')).toBeVisible();
}

async function readerFrame(page: Page) {
  const iframe = page.locator('iframe[title="Publication reader"]');
  await expect(iframe).toHaveAttribute('src', '/reader/reader.html');
  return iframe;
}

async function readerHostFrame(page: Page) {
  const host = await (await readerFrame(page)).elementHandle();
  const frame = await host?.contentFrame();
  expect(
    frame,
    'reader host iframe should expose its static document',
  ).toBeTruthy();
  return frame!;
}

// Real renderer state read through the public foliate-view element (which the
// trusted host appends to its own body, unlike the closed-shadow paginator).
// This is engine-visible evidence: section index, page count, and the actual
// renderer page geometry (public controls still navigate linear sections).
type RendererState = {
  sectionIndex: number | null;
  page: number | null;
  pages: number | null;
  atStart: boolean | null;
  atEnd: boolean | null;
};

async function readRendererState(page: Page): Promise<RendererState | null> {
  const host = await readerHostFrame(page);
  return host.evaluate((): RendererState | null => {
    const view = document.querySelector('foliate-view') as unknown as {
      renderer?: {
        atEnd?: unknown;
        atStart?: unknown;
        getContents?: () => Array<{ index?: number }>;
        page?: unknown;
        pages?: unknown;
      };
    } | null;
    const renderer = view?.renderer;
    if (!renderer) return null;
    const contents = renderer.getContents?.() ?? [];
    return {
      sectionIndex:
        typeof contents[0]?.index === 'number' ? contents[0].index : null,
      page: typeof renderer.page === 'number' ? renderer.page : null,
      pages: typeof renderer.pages === 'number' ? renderer.pages : null,
      atStart: typeof renderer.atStart === 'boolean' ? renderer.atStart : null,
      atEnd: typeof renderer.atEnd === 'boolean' ? renderer.atEnd : null,
    };
  });
}

// A page turn updates the renderer before its acknowledgement arrives. Wait for
// the position to stop changing so a following command is not dropped by the
// host's in-flight serialization window.
async function waitForSettledRendererState(page: Page): Promise<RendererState> {
  let previous = await readRendererState(page);
  await page.waitForTimeout(250);
  for (let index = 0; index < 20; index += 1) {
    const current = await readRendererState(page);
    if (
      previous &&
      current &&
      previous.page === current.page &&
      previous.sectionIndex === current.sectionIndex
    )
      return current;
    previous = current;
    await page.waitForTimeout(150);
  }
  return (await readRendererState(page))!;
}

// The reader host renders the publication in two nested closed shadow roots
// (foliate-view > foliate-paginator) around a sandboxed blob iframe. Since
// Playwright locators cannot pierce closed shadow DOM, we walk the browser frame
// tree to the publication iframe and read real geometry through the in-page
// frameElement chain (publication.frameElement -> structural root.host ...).
// No styles are injected and sandbox/CSP/capability probes are untouched.
type Rect = { left: number; top: number; width: number; height: number };
type PublicationGeometry = {
  heading: string | null;
  bodyHasText: boolean;
  frameWidth: number;
  frameHeight: number;
  paginatorHeight: number;
  viewHeight: number;
  headingVisibleInFrame: boolean;
  headingVisibleInHost: boolean;
  headingVisibleOnPage: boolean;
};

async function readPublicationGeometry(
  page: Page,
  headingText: string,
  bodyText: string,
): Promise<PublicationGeometry | null> {
  const host = await readerHostFrame(page);
  const publication = host
    .childFrames()
    .find((candidate) => candidate.url().startsWith('blob:'));
  if (!publication) return null;
  try {
    return await publication.evaluate(
      ({ headingText, bodyText }): PublicationGeometry => {
        const rectOf = (element: Element): Rect => {
          const { left, top, width, height } = element.getBoundingClientRect();
          return { left, top, width, height };
        };
        // Intersection of two rects in one coordinate space; a zero-area result
        // means one clip fully crops the other, so chaining proves clipping.
        const clip = (a: Rect, b: Rect): Rect => ({
          left: Math.max(a.left, b.left),
          top: Math.max(a.top, b.top),
          width: Math.max(
            0,
            Math.min(a.left + a.width, b.left + b.width) -
              Math.max(a.left, b.left),
          ),
          height: Math.max(
            0,
            Math.min(a.top + a.height, b.top + b.height) -
              Math.max(a.top, b.top),
          ),
        });
        const positive = (rect: Rect) => rect.width > 0 && rect.height > 0;
        // Cross-realm safe: a ShadowRoot minted in the host realm is not an
        // instance of the publication realm's ShadowRoot, so test the structural
        // `host` property instead of the prototype.
        const shadowHost = (node: Node): Element | null =>
          (node.getRootNode() as Node & { host?: Element }).host ?? null;

        const headingElement =
          Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).find(
            (node) => (node.textContent ?? '').trim() === headingText,
          ) ?? null;
        const headingRect = headingElement ? rectOf(headingElement) : null;
        const bodyHasText = (document.body?.textContent ?? '').includes(
          bodyText,
        );
        // The iframe's own content box is its visible viewport.
        const publicationViewport: Rect = {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        };

        const geometry: PublicationGeometry = {
          heading: headingElement
            ? (headingElement.textContent ?? '').trim()
            : null,
          bodyHasText,
          frameWidth: 0,
          frameHeight: 0,
          paginatorHeight: 0,
          viewHeight: 0,
          headingVisibleInFrame: false,
          headingVisibleInHost: false,
          headingVisibleOnPage: false,
        };

        const frameElement = window.frameElement;
        if (!frameElement || !headingRect) return geometry;
        const frameRect = rectOf(frameElement);
        geometry.frameWidth = frameRect.width;
        geometry.frameHeight = frameRect.height;
        // Zero-height host bug: missing host CSS leaves foliate-view inline 0x0
        // and collapses the paginator/iframe, so read the ancestor heights.
        const paginator = shadowHost(frameElement);
        const paginatorRect = paginator ? rectOf(paginator) : null;
        if (paginatorRect) geometry.paginatorHeight = paginatorRect.height;
        const view = paginator ? shadowHost(paginator) : null;
        const viewRect = view ? rectOf(view) : null;
        if (viewRect) geometry.viewHeight = viewRect.height;

        geometry.headingVisibleInFrame = positive(
          clip(headingRect, publicationViewport),
        );

        // Map the heading into host-document coordinates (same-origin sandboxed
        // iframe with border:0, so the offset is exact) then clip it through the
        // real ancestor chain: paginator and view rects, then the host viewport.
        const hostWindow = frameElement.ownerDocument?.defaultView ?? null;
        if (!hostWindow) return geometry;
        let hostClip: Rect = {
          left: frameRect.left + headingRect.left,
          top: frameRect.top + headingRect.top,
          width: headingRect.width,
          height: headingRect.height,
        };
        for (const container of [
          paginatorRect,
          viewRect,
          {
            left: 0,
            top: 0,
            width: hostWindow.innerWidth,
            height: hostWindow.innerHeight,
          },
        ])
          if (container) hostClip = clip(hostClip, container);
        geometry.headingVisibleInHost =
          geometry.headingVisibleInFrame && positive(hostClip);

        // Map the surviving host rect onto the top-level page and clip against the
        // top-level window's actual viewport. Single-layer host model: the parent
        // of the reader host window is the top-level window.
        const hostFrameElement = hostWindow.frameElement;
        if (hostFrameElement) {
          const hostRect = rectOf(hostFrameElement);
          const topWindow = hostWindow.parent || hostWindow;
          geometry.headingVisibleOnPage = positive(
            clip(
              {
                left: hostRect.left + hostClip.left,
                top: hostRect.top + hostClip.top,
                width: hostClip.width,
                height: hostClip.height,
              },
              {
                left: 0,
                top: 0,
                width: topWindow.innerWidth,
                height: topWindow.innerHeight,
              },
            ),
          );
        }
        return geometry;
      },
      { headingText, bodyText },
    );
  } catch {
    // Navigation swaps the blob document and destroys the previous execution
    // context. Callers poll, so a transient miss is retried rather than treated
    // as missing content.
    return null;
  }
}

// Polls until the named chapter is really rendered and visibly unclipped. The
// real chapter heading/body text must be present, every host layout height must
// be positive, and the heading's single surviving intersection must stay
// positive across the publication viewport, the paginator/view/host clip chain,
// and the top-level window viewport.
async function expectPublicationChapter(
  page: Page,
  headingText: string,
  bodyText: string,
) {
  await expect(async () => {
    const geometry = await readPublicationGeometry(page, headingText, bodyText);
    expect(
      geometry,
      `publication frame with rendered "${headingText}" content`,
    ).not.toBeNull();
    // Real rendered text, not just reader chrome state.
    expect(geometry!.heading).toBe(headingText);
    expect(geometry!.bodyHasText).toBe(true);
    // Block the zero-height host regression before trusting any visibility math.
    expect(geometry!.viewHeight).toBeGreaterThan(0);
    expect(geometry!.paginatorHeight).toBeGreaterThan(0);
    expect(geometry!.frameWidth).toBeGreaterThan(0);
    expect(geometry!.frameHeight).toBeGreaterThan(0);
    expect(geometry!.headingVisibleInFrame).toBe(true);
    expect(geometry!.headingVisibleInHost).toBe(true);
    expect(geometry!.headingVisibleOnPage).toBe(true);
  }).toPass({ timeout: 20_000 });
}

// Fixed, actionable public copy owned by NativeReader.web.tsx. The E2E must not
// echo a timeout, a security-boundary rejection, or any private source path.
const RUNTIME_ASSET_ERROR =
  'runtime-asset-missing: Reader host assets are unavailable. Run foliate:web-runtime:sync.';

const assetFailureTitles = [
  'Chromium reports a fixed actionable runtime-asset error when the host load aborts',
  'Chromium reports a fixed actionable runtime-asset error for a 404 host document',
];
const assetCounterNames = [
  'installed',
  'probe',
  'open',
  'dispose',
  'xhr',
  'fetch',
  'fileReader',
  'arrayBuffer',
  'foliateCreated',
  'blobFrame',
  'hostCreated',
  'messageHookUnavailable',
  'deliveryFailure',
] as const;
type AssetCounter = (typeof assetCounterNames)[number];
type AssetCounters = Record<AssetCounter, number>;
const emptyAssetCounters = (): AssetCounters =>
  Object.fromEntries(
    assetCounterNames.map((name) => [name, 0]),
  ) as AssetCounters;
type AssetObservation = {
  scenario: AssetCounters;
  calibration: AssetCounters;
  nestedFrames: number;
  blobNavigations: number;
  overflow: boolean;
  calibrated: boolean;
};
const assetObservations = new WeakMap<Page, AssetObservation>();
const assetNetworkObservations = new WeakMap<Page, BrowserObservations>();

// 仅两个缺资产用例使用。binding 只传固定枚举，不传 URL、source、token 或消息 payload。
async function installAssetObservation(page: Page) {
  const observation: AssetObservation = {
    scenario: emptyAssetCounters(),
    calibration: emptyAssetCounters(),
    nestedFrames: 0,
    blobNavigations: 0,
    overflow: false,
    calibrated: false,
  };
  assetObservations.set(page, observation);
  let events = 0;
  const calibrationFrames = new WeakSet<Frame>();
  await page
    .context()
    .exposeBinding(
      '__hnAssetEvent',
      ({ page: sender, frame }, phase: unknown, name: unknown) => {
        if (
          sender !== page ||
          (phase !== 'scenario' && phase !== 'calibration') ||
          !assetCounterNames.includes(name as AssetCounter)
        )
          return;
        if (++events > 256) {
          observation.overflow = true;
          return;
        }
        // 校准 frame 的晚到 init/load 仍属正控，不混进真实场景。
        observation[calibrationFrames.has(frame) ? 'calibration' : phase][
          name as AssetCounter
        ] += 1;
      },
    );
  const frameAttached = (frame: Frame) => {
    if (!observation.calibrated) {
      calibrationFrames.add(frame);
      return;
    }
    if (frame.parentFrame() && frame.parentFrame() !== page.mainFrame())
      if (observation.nestedFrames < 256) observation.nestedFrames += 1;
      else observation.overflow = true;
  };
  page.on('frameattached', frameAttached);
  page.on('framenavigated', (frame) => {
    if (
      observation.calibrated &&
      !calibrationFrames.has(frame) &&
      frame.url().startsWith('blob:')
    )
      if (observation.blobNavigations < 256) observation.blobNavigations += 1;
      else observation.overflow = true;
  });
  await page.context().addInitScript(() => {
    type Counter =
      | 'installed'
      | 'probe'
      | 'open'
      | 'dispose'
      | 'xhr'
      | 'fetch'
      | 'fileReader'
      | 'arrayBuffer'
      | 'foliateCreated'
      | 'blobFrame'
      | 'hostCreated'
      | 'messageHookUnavailable'
      | 'deliveryFailure';
    const target = window as typeof window & {
      __hnAssetEvent(phase: string, name: Counter): Promise<void>;
      __hnAssetObserver?: {
        calibrate(): Promise<void>;
        flush(): Promise<void>;
      };
    };
    let calibration = false;
    let delivered = 0;
    let deliveryFailed = false;
    const pending = new Set<Promise<void>>();
    const report = (name: Counter) => {
      if (++delivered > 200) {
        deliveryFailed = true;
        return;
      }
      try {
        const operation = target
          .__hnAssetEvent(calibration ? 'calibration' : 'scenario', name)
          .catch(() => {
            deliveryFailed = true;
          })
          .finally(() => pending.delete(operation));
        pending.add(operation);
      } catch {
        deliveryFailed = true;
      }
    };
    const blobUri = (value: unknown) =>
      typeof value === 'string' && value.startsWith('blob:');
    // 所有 wrapper 同步调用原函数，保留 this/参数/返回值/异常；不阻断网络或修改 CSP。
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      ...args: unknown[]
    ) {
      if (blobUri(args[1])) report('xhr');
      return Reflect.apply(originalOpen, this, args);
    } as typeof originalOpen;
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const input = args[0];
      if (
        blobUri(
          input instanceof Request
            ? input.url
            : input instanceof URL
              ? input.href
              : input,
        )
      )
        report('fetch');
      return Reflect.apply(originalFetch, this, args);
    };
    for (const method of [
      'readAsArrayBuffer',
      'readAsText',
      'readAsDataURL',
      'readAsBinaryString',
    ] as const) {
      const original = FileReader.prototype[method];
      Object.defineProperty(FileReader.prototype, method, {
        configurable: true,
        writable: true,
        value(this: FileReader, ...args: unknown[]) {
          report('fileReader');
          return Reflect.apply(original, this, args);
        },
      });
    }
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function (...args) {
      report('arrayBuffer');
      return Reflect.apply(originalArrayBuffer, this, args);
    };
    const hookedWindows = new WeakSet<Window>();
    const hookMessages = (recipient: Window) => {
      try {
        if (hookedWindows.has(recipient)) return;
        const original = recipient.postMessage;
        const wrapped = function (this: Window, ...args: unknown[]) {
          const message = args[0];
          try {
            if (message && typeof message === 'object') {
              const { type, protocolVersion } = message as {
                type?: unknown;
                protocolVersion?: unknown;
              };
              if (
                protocolVersion === 1 &&
                (type === 'probe' || type === 'open' || type === 'dispose')
              )
                report(type);
            }
          } catch {
            deliveryFailed = true;
          }
          return Reflect.apply(original, this, args);
        };
        Object.defineProperty(recipient, 'postMessage', {
          configurable: true,
          writable: true,
          value: wrapped,
        });
        hookedWindows.add(recipient);
      } catch {
        // 跨源错误文档不能 hook；附件必须保留 coverage 缺口，不能用零计数冒充全覆盖。
        report('messageHookUnavailable');
      }
    };
    hookMessages(window);
    const seenFrames = new WeakSet<HTMLIFrameElement>();
    const seenBlobFrames = new WeakSet<HTMLIFrameElement>();
    const inspectFrame = (frame: HTMLIFrameElement) => {
      if (!seenFrames.has(frame)) {
        seenFrames.add(frame);
        if (frame.getAttribute('src') === '/reader/reader.html')
          report('hostCreated');
        const hook = () => {
          if (frame.contentWindow) hookMessages(frame.contentWindow);
        };
        // capture listener 在 adapter 的普通 load listener 之前重新 hook 新文档。
        frame.addEventListener(
          'load',
          () => {
            if (frame.contentWindow) hookedWindows.delete(frame.contentWindow);
            hook();
          },
          true,
        );
        hook();
      }
      if (blobUri(frame.getAttribute('src')) && !seenBlobFrames.has(frame)) {
        seenBlobFrames.add(frame);
        report('blobFrame');
      }
    };
    const originalCreate = document.createElement.bind(document);
    document.createElement = function (
      ...args: Parameters<typeof originalCreate>
    ) {
      const element = Reflect.apply(originalCreate, document, args);
      if (args[0].toLowerCase() === 'foliate-view') report('foliateCreated');
      return element;
    } as typeof document.createElement;
    const scan = (node: Node) => {
      if (node instanceof HTMLIFrameElement) inspectFrame(node);
      if (node instanceof Element)
        node.querySelectorAll('iframe').forEach(inspectFrame);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(scan);
        // removedNodes 也扫描：不漏同一 turn 插入后移除的 publication frame。
        record.removedNodes.forEach(scan);
        if (record.type === 'attributes') scan(record.target);
      }
    });
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    const flush = async () => {
      await Promise.resolve();
      await Promise.all([...pending]);
      if (deliveryFailed)
        await target.__hnAssetEvent('scenario', 'deliveryFailure');
    };
    target.__hnAssetObserver = {
      flush,
      async calibrate() {
        calibration = true;
        // 真实 test-owned API 调用正控；计数分桶，不伪造 application 的成功证据。
        const blob = new Blob(['observer-control']);
        const uri = URL.createObjectURL(blob);
        const frame = originalCreate('iframe');
        try {
          await blob.arrayBuffer();
          await fetch(uri);
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.onload = () => resolve();
            xhr.onerror = () =>
              reject(new Error('observer xhr control failed'));
            xhr.open('GET', uri);
            xhr.send();
          });
          await new Promise<void>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve();
            reader.onerror = () =>
              reject(new Error('observer reader control failed'));
            reader.readAsArrayBuffer(blob);
          });
          document.createElement('foliate-view');
          document.body.append(frame);
          await new Promise<void>((resolve) => queueMicrotask(resolve));
          if (!frame.contentWindow)
            throw new Error('observer message control missing frame');
          for (const type of ['probe', 'open', 'dispose'])
            frame.contentWindow.postMessage(
              { protocolVersion: 1, type },
              location.origin,
            );
          frame.src = uri;
          await new Promise<void>((resolve) => queueMicrotask(resolve));
          await flush();
        } finally {
          frame.remove();
          URL.revokeObjectURL(uri);
          await flush();
          calibration = false;
        }
      },
    };
    report('installed');
  });
}

async function calibrateAssetObservation(page: Page) {
  await page.evaluate(async () => {
    const observer = (
      window as typeof window & {
        __hnAssetObserver?: { calibrate(): Promise<void> };
      }
    ).__hnAssetObserver;
    if (!observer) throw new Error('runtime asset observer missing');
    await observer.calibrate();
  });
  const observation = assetObservations.get(page)!;
  for (const name of [
    'probe',
    'open',
    'dispose',
    'xhr',
    'fetch',
    'fileReader',
    'arrayBuffer',
    'foliateCreated',
    'blobFrame',
  ] as const)
    expect(
      observation.calibration[name],
      `observer calibration: ${name}`,
    ).toBeGreaterThan(0);
  expect(observation.scenario.installed).toBeGreaterThan(0);
  observation.calibrated = true;
}

async function flushAssetObservation(page: Page) {
  await page.evaluate(async () => {
    await (
      window as typeof window & {
        __hnAssetObserver?: { flush(): Promise<void> };
      }
    ).__hnAssetObserver?.flush();
  });
}

async function attachAssetObservation(page: Page, testInfo: TestInfo) {
  // 即使用例/校准失败也由 afterEach 附件记录；不把默认 status 当最终结果。
  try {
    await flushAssetObservation(page);
  } catch {
    assetObservations.get(page)!.scenario.deliveryFailure += 1;
  }
  const observation = assetObservations.get(page)!;
  const network = assetNetworkObservations.get(page);
  await testInfo.attach('runtime-asset-observation.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          title: testInfo.title,
          status: testInfo.status,
          expectedError: RUNTIME_ASSET_ERROR,
          ...observation,
          network: network
            ? {
                publication: network.publicationRequests.length,
                external: network.externalRequests.length,
                popups: network.popups.length,
                controlProbe: network.controlProbeRequests.length,
              }
            : null,
          coverage: {
            source:
              'host XHR blob open, fetch blob, all FileReader reads, all Blob.arrayBuffer calls',
            messages: observation.scenario.messageHookUnavailable
              ? 'partial: inaccessible error document; observed zero is not full dispatch proof'
              : 'hooked accessible windows only',
            containers:
              'createElement foliate-view; MutationObserver iframe additions/removals/src; Playwright nested attachment/blob navigation',
            limitations: [
              'cross-origin error realms may not run initScript or permit message hooks',
              'workers, streams, Blob.text and non-blob source APIs are outside this observer',
              'test-owned calibration is not application evidence',
            ],
          },
        },
        null,
        2,
      ),
    ),
    contentType: 'application/json',
  });
}

async function expectAssetObservation(page: Page) {
  await flushAssetObservation(page);
  const observation = assetObservations.get(page)!;
  expect(observation.overflow).toBe(false);
  expect(observation.scenario.deliveryFailure).toBe(0);
  expect(observation.calibrated).toBe(true);
  expect(observation.scenario.hostCreated).toBe(1);
  for (const name of [
    'probe',
    'open',
    'xhr',
    'fetch',
    'fileReader',
    'arrayBuffer',
    'foliateCreated',
    'blobFrame',
  ] as const)
    expect(
      observation.scenario[name],
      `asset failure observation: ${name}`,
    ).toBe(0);
  expect(observation.nestedFrames).toBe(0);
  expect(observation.blobNavigations).toBe(0);
}

async function expectRuntimeAssetError(page: Page) {
  const status = page.getByTestId('reader-status');
  await expect(status).toHaveAttribute('role', 'alert');
  await expect(status).toHaveText(RUNTIME_ASSET_ERROR, { timeout: 20_000 });
}

async function expectNoPublicationHost(
  page: Page,
  observations: BrowserObservations,
) {
  // The failed host iframe is torn down, and no publication frame, Foliate
  // renderer, or host-owned blob read may have occurred.
  await expect(page.locator('iframe[title="Publication reader"]')).toHaveCount(
    0,
  );
  await expect(page.locator('iframe[src^="blob:"]')).toHaveCount(0);
  await expect(page.locator('foliate-view')).toHaveCount(0);
  // 缺资产负控失败时也不把原始 blob URI / 私有 URL 写进断言日志。
  expect(observations.publicationRequests.length).toBe(0);
  expect(observations.externalRequests.length).toBe(0);
  expect(observations.popups.length).toBe(0);
}

test.beforeEach(
  async (
    { browser, browserName, page, launchOptions, channel, connectOptions },
    testInfo,
  ) => {
    await attachBrowserVersion(browser, testInfo, {
      channel,
      hasConnectOptions: connectOptions != null,
      launchOptions,
    });
    if (isChromium(browserName) && assetFailureTitles.includes(testInfo.title))
      await installAssetObservation(page);
    await page.goto('/');
    await expect(page.getByTestId('select-epub')).toBeVisible();
  },
);

test.afterEach(async ({ page }, testInfo) => {
  if (assetObservations.has(page)) await attachAssetObservation(page, testInfo);
});

for (const fixture of openingFixtures) {
  test(`Chromium opens manifest fixture ${fixture.file}`, async ({
    browserName,
    page,
  }) => {
    test.skip(
      !isChromium(browserName),
      'Publication rendering is Chromium-only.',
    );
    await openFixture(page, fixture);
    await expectReady(page, fixture);
    await readerFrame(page);
  });
}

test('Chromium proves the authenticated probe with trusted control canaries', async ({
  browserName,
  page,
}) => {
  test.skip(
    !isChromium(browserName),
    'Publication rendering is Chromium-only.',
  );
  const observations = observeBrowser(page);
  const fixture = openingFixtures.find(
    (candidate) => candidate.file === 'epub/valid-epub3.epub',
  )!;

  await openFixture(page, fixture);
  await expectReady(page, fixture);
  const iframe = await readerFrame(page);
  // The outer frame is the trusted static reader host. Strict required CSP is
  // applied by that host only to its untrusted publication blob iframe.
  await expect(iframe).not.toHaveAttribute('csp');
  await expect(iframe).toHaveAttribute('src', '/reader/reader.html');
  // The control canaries must load from the trusted host; their separate
  // cross-origin probe attempt is intentionally not publication network I/O.
  expect(observations.controlProbeRequests).toEqual(
    expect.arrayContaining([
      expect.stringMatching(
        /\/reader\/probes\/csp-1x1\.png\?hnCspProbe=control-/,
      ),
      expect.stringMatching(
        /\/reader\/probes\/csp-external-canary\.js\?hnCspProbe=control-/,
      ),
    ]),
  );
  expect(observations.externalRequests).toEqual([]);
});

test('Chromium ignores malformed iframe-origin bridge messages', async ({
  browserName,
  page,
}) => {
  test.skip(
    !isChromium(browserName),
    'Publication rendering is Chromium-only.',
  );
  const fixture = openingFixtures.find(
    (candidate) => candidate.file === 'epub/valid-epub3.epub',
  )!;
  await openFixture(page, fixture);
  await expectReady(page, fixture);

  const status = page.getByTestId('reader-status');
  const before = await status.textContent();
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith('/reader/reader.html'));
  expect(frame, 'reader host iframe should be observable').toBeDefined();
  await frame!.evaluate(() => {
    parent.postMessage(
      {
        type: 'location',
        protocolVersion: 999,
        session: 'wrong',
        generation: 'wrong',
        index: 999,
        cfi: null,
        fraction: null,
      },
      location.origin,
    );
  });
  await expect(status).toHaveText(before!);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Chromium replaces a live source and retains only the current reader iframe', async ({
  browserName,
  page,
}) => {
  test.skip(
    !isChromium(browserName),
    'Publication rendering is Chromium-only.',
  );
  const first = openingFixtures.find(
    (candidate) => candidate.file === 'epub/valid-epub3.epub',
  )!;
  const second = openingFixtures.find(
    (candidate) => candidate.file === 'fb2/valid-navigation.fb2',
  )!;
  await openFixture(page, first);
  await expectReady(page, first);
  const oldHost = await page
    .locator('iframe[title="Publication reader"]')
    .elementHandle();
  expect(oldHost).not.toBeNull();

  await openFixture(page, second);
  await expectReady(page, second);
  await expect(page.locator('iframe[title="Publication reader"]')).toHaveCount(
    1,
  );
  await expect
    .poll(() => oldHost!.evaluate((element) => element.isConnected))
    .toBe(false);
  await expect(page.getByTestId('source-state')).toHaveText(
    `Selected: ${path.basename(second.file)}`,
  );
});

test('Chromium performs chapter navigation, TOC navigation, and reflow through public controls', async ({
  browserName,
  page,
}) => {
  test.skip(
    !isChromium(browserName),
    'Publication rendering is Chromium-only.',
  );
  const fixture = openingFixtures.find(
    (candidate) => candidate.file === 'epub/valid-epub3.epub',
  )!;
  await openFixture(page, fixture);
  await expectReady(page, fixture);

  // Both flows navigate readable linear sections.
  const previous = page.getByRole('button', { name: /^Previous/ });
  await expect(previous).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Next/ })).toHaveAttribute(
    'aria-label',
    'Next chapter',
  );
  // Real rendered publication evidence, not just the reader chrome counter: the
  // initial chapter heading and paragraph must be visible and unclipped.
  await expectPublicationChapter(
    page,
    'Morning',
    'A bell sounded across the garden.',
  );

  // TOC selects an explicit destination.
  await page
    .getByLabel('Table of contents')
    .getByRole('button', { name: 'Evening', exact: true })
    .click();
  await expect(page.getByLabel('Chapter position')).toHaveText(
    'Chapter 2 of 3',
  );
  await expectPublicationChapter(
    page,
    'Evening',
    'The lantern made a warm circle on the page.',
  );

  await page
    .getByLabel('Table of contents')
    .getByRole('button', { name: 'Night', exact: true })
    .click();
  await expect(page.getByLabel('Chapter position')).toHaveText(
    'Chapter 3 of 3',
  );
  await expectPublicationChapter(
    page,
    'Night',
    'The final observation was written under the stars.',
  );

  const scrolled = page.getByLabel('Scrolled reading flow');
  const paginated = page.getByLabel('Paginated reading flow');
  await paginated.click();
  // ReaderChrome uses labelled buttons with a controlled selected state, not
  // toggle buttons. The selected visual state is committed only after the
  // reader host reports the requested flow and acknowledges the command.
  await expect(paginated).toHaveCSS('background-color', 'rgb(77, 77, 77)');
  await expect(scrolled).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await scrolled.click();
  await expect(scrolled).toHaveCSS('background-color', 'rgb(77, 77, 77)');
  await expect(paginated).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  // scrolled 回落到章节语义：控件标签变回章节。
  await expect(page.getByRole('button', { name: /^Next/ })).toHaveAttribute(
    'aria-label',
    'Next chapter',
  );
  await paginated.click();
  await expect(paginated).toHaveCSS('background-color', 'rgb(77, 77, 77)');
  await expect(page.getByRole('button', { name: /^Next/ })).toHaveAttribute(
    'aria-label',
    'Next chapter',
  );
});

test('Chromium ignores a flow switch racing in-flight section navigation without failing', async ({
  browserName,
  page,
}) => {
  test.skip(
    !isChromium(browserName),
    'Publication rendering is Chromium-only.',
  );
  const fixture = openingFixtures.find(
    (candidate) => candidate.file === 'epub/valid-epub3.epub',
  )!;
  await openFixture(page, fixture);
  await expectReady(page, fixture);

  // 页级翻页在飞时切换 flow：被互斥忽略即可，绝不能把会话推入 error。
  await page.getByRole('button', { name: /^Next/ }).click();
  await page.getByLabel('Scrolled reading flow').click();
  await waitForSettledRendererState(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('reader-status')).toBeVisible();
});

test('Chromium exposes fixed layout without a reflow control', async ({
  browserName,
  page,
}) => {
  test.skip(
    !isChromium(browserName),
    'Publication rendering is Chromium-only.',
  );
  const fixture = openingFixtures.find(
    (candidate) => candidate.file === 'cbz/valid-fixed.cbz',
  )!;
  await openFixture(page, fixture);
  await expectReady(page, fixture);
  await expect(page.getByLabel('Fixed-layout publication')).toBeVisible();
  await expect(page.getByLabel('Reading flow')).toHaveCount(0);
  // 固定版式保持章节语义：控件为章节标签，而非页级标签。
  await expect(page.getByRole('button', { name: /^Next/ })).toHaveAttribute(
    'aria-label',
    'Next chapter',
  );
  await expect(page.getByRole('button', { name: /^Previous/ })).toHaveAttribute(
    'aria-label',
    'Previous chapter',
  );
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 640 },
]) {
  test(`Chromium linear navigation skips long pages at ${viewport.width}px`, async ({
    browserName,
    page,
  }) => {
    test.skip(
      !isChromium(browserName),
      'Publication rendering is Chromium-only.',
    );
    await page.setViewportSize(viewport);
    const fixture = openingFixtures.find(
      (candidate) => candidate.file === 'epub/large-representative.epub',
    )!;
    await openFixture(page, fixture);
    await expectReady(page, fixture);
    const next = page.getByRole('button', {
      name: 'Next chapter',
      exact: true,
    });
    const previous = page.getByRole('button', {
      name: 'Previous chapter',
      exact: true,
    });
    const position = page.getByLabel('Chapter position');
    expect((await readRendererState(page))!.pages).toBeGreaterThan(3);
    await expect(previous).toBeDisabled();
    await next.click();
    await expect(position).toHaveText('Chapter 2 of 48');
    // The narrow Demo places the publication below its controls. Scroll to
    // the reading viewport before checking actual on-screen text.
    await page.locator('iframe').scrollIntoViewIfNeeded();
    await expectPublicationChapter(
      page,
      'Survey 02',
      'The survey team recorded wind, water, seed, stone, and starlight',
    );
    await previous.click();
    await expect(position).toHaveText('Chapter 1 of 48');
    await expect(previous).toBeDisabled();
    await page
      .getByLabel('Table of contents')
      .getByRole('button', { name: 'Survey 48', exact: true })
      .click();
    await expect(position).toHaveText('Chapter 48 of 48');
    await expect(next).toBeDisabled();
    // There are still pages in this last section; section controls must not wrap.
    expect((await readRendererState(page))!.atEnd).toBe(false);
    await page.getByLabel('Scrolled reading flow').click();
    await expect(position).toHaveText('Chapter 48 of 48');
    await expect(next).toBeDisabled();
    await expect(previous).toBeEnabled();
  });
}

test('Chromium blocks publication network, popup, form, and top navigation attempts', async ({
  browserName,
  page,
}) => {
  test.skip(
    !isChromium(browserName),
    'Publication rendering is Chromium-only.',
  );
  const observations = observeBrowser(page);
  const publicationFrame = new Promise<import('@playwright/test').Frame>(
    (resolve) => {
      page.on('framenavigated', (frame) => {
        if (
          frame.parentFrame()?.url().endsWith('/reader/reader.html') &&
          frame.url().startsWith('blob:')
        )
          resolve(frame);
      });
    },
  );
  const fixture = manifest.fixtures.find(
    (candidate) => candidate.file === 'epub/scripted-external.epub',
  )!;
  await openFixture(page, fixture);
  const publication = await publicationFrame;
  await expectReady(page, fixture);
  const host = await readerHostFrame(page);
  expect(publication.parentFrame()).toBe(host);
  // The hostile fixture's zero-delay refresh replaces its blob document before
  // its controls become browser-interactable. Anchor the real blob frame under
  // the trusted host, then inspect its enforced browser-visible boundary.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  const nodes = await cdp.send('DOM.getFlattenedDocument', {
    depth: -1,
    pierce: true,
  });
  const publicationIframe = nodes.nodes.find(
    (node) =>
      node.nodeName === 'IFRAME' &&
      node.attributes?.some((value) => value.startsWith('blob:')),
  );
  await cdp.detach();
  expect(
    publicationIframe,
    'reader host should contain a browser-visible publication blob iframe',
  ).toBeDefined();
  const attributes = new Map(
    (publicationIframe!.attributes ?? []).flatMap((value, index, all) =>
      index % 2 === 0 ? [[value, all[index + 1] ?? '']] : [],
    ),
  );
  expect(attributes.get('src')).toMatch(/^blob:/);
  expect(attributes.get('csp')).toMatch(/script-src 'none'/);
  expect(attributes.get('csp')).toMatch(/form-action 'none'/);
  expect(attributes.get('sandbox')).toBe('allow-same-origin allow-scripts');
  // The publication's script, links, popup handler, and refresh/form targets
  // cannot remain actionable after this strict boundary takes effect. Start
  // after ready so pre-ready parsing is not treated as a user escape attempt.
  observations.externalRequests.length = 0;
  observations.popups.length = 0;
  await expect(page).toHaveURL(/\/$/);
  // No later external request, popup, or top navigation is accepted at the
  // browser boundary; trusted-host control probes are excluded by observation.
  expect(observations.popups).toEqual([]);
  expect(observations.externalRequests).toEqual([]);
});

test('Firefox fails closed before source publication work', async ({
  browserName,
  page,
}) => {
  test.skip(
    browserName !== 'firefox',
    'This is Firefox-only fail-closed evidence.',
  );
  const observations = observeBrowser(page);
  const fixture = openingFixtures.find(
    (candidate) => candidate.file === 'epub/valid-epub3.epub',
  )!;
  await openFixture(page, fixture);
  await expect(page.getByTestId('reader-status')).toContainText(
    'cannot provide the required isolated reader security boundary',
    { timeout: 10_000 },
  );
  await expect(page.locator('iframe[title="Publication reader"]')).toHaveCount(
    0,
  );
  // Firefox may load the trusted control assets, but fails closed before a
  // publication frame, Foliate content, or source-backed reader can exist.
  expect(observations.controlProbeRequests).toEqual(
    expect.arrayContaining([
      expect.stringMatching(
        /\/reader\/probes\/csp-1x1\.png\?hnCspProbe=control-/,
      ),
      expect.stringMatching(
        /\/reader\/probes\/csp-external-canary\.js\?hnCspProbe=control-/,
      ),
    ]),
  );
  await expect(page.locator('iframe[src^="blob:"]')).toHaveCount(0);
  await expect(page.locator('foliate-view')).toHaveCount(0);
  expect(observations.externalRequests).toEqual([]);
  expect(observations.popups).toEqual([]);
});

test('Chromium reports a fixed actionable runtime-asset error when the host load aborts', async ({
  browserName,
  page,
}) => {
  test.skip(
    !isChromium(browserName),
    'Publication rendering is Chromium-only.',
  );
  await calibrateAssetObservation(page);
  const observations = observeBrowser(page);
  assetNetworkObservations.set(page, observations);
  // A refused/aborted host navigation still commits an unreadable cross-origin
  // error document and fires `load` rather than `error`.
  await page.route('**/reader/reader.html', (route) => route.abort());
  const fixture = openingFixtures.find(
    (candidate) => candidate.file === 'epub/valid-epub3.epub',
  )!;

  await openFixture(page, fixture);
  await expectRuntimeAssetError(page);
  await expectNoPublicationHost(page, observations);
  expect(observations.controlProbeRequests.length).toBe(0);
  await expectAssetObservation(page);
});

test('Chromium reports a fixed actionable runtime-asset error for a 404 host document', async ({
  browserName,
  page,
}) => {
  test.skip(
    !isChromium(browserName),
    'Publication rendering is Chromium-only.',
  );
  await calibrateAssetObservation(page);
  const observations = observeBrowser(page);
  assetNetworkObservations.set(page, observations);
  // A missing asset route returns a readable same-origin error document whose
  // title is not the staged reader template.
  await page.route('**/reader/reader.html', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'text/html',
      body: '<!doctype html><title>404 Not Found</title>',
    }),
  );
  const fixture = openingFixtures.find(
    (candidate) => candidate.file === 'epub/valid-epub3.epub',
  )!;

  await openFixture(page, fixture);
  await expectRuntimeAssetError(page);
  await expectNoPublicationHost(page, observations);
  expect(observations.controlProbeRequests.length).toBe(0);
  await expectAssetObservation(page);
});
