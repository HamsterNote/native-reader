import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

import { runFoliateGated } from './run-foliate-gated.mjs';
import {
  FFLATE_LICENSE,
  FOLIATE_NATIVE_HOST_VERSION,
  FOLIATE_NATIVE_RUNTIME_DIRECTORY,
  FOLIATE_NATIVE_RUNTIME_MANIFEST,
  FOLIATE_RUNTIME_DIRECTORY,
  FOLIATE_RUNTIME_MANIFEST,
  stageFoliateRuntime,
  ZIP_JS_LICENSE,
} from './stage-foliate-runtime.mjs';
import {
  FOLIATE_COMMIT_SHA,
  FOLIATE_SUBMODULE_PATH,
  FOLIATE_UPSTREAM_URL,
  BOOTSTRAP_HINT,
  REVISION_REVIEW_PATH,
} from './verify-foliate-submodule.mjs';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const sourceRoot = path.join(projectRoot, FOLIATE_SUBMODULE_PATH);
const cspSourcePath = path.join(
  projectRoot,
  'packages/native-reader/src/foliate-csp-policy.json',
);
const foliateHostWireCorpusPath = path.join(
  projectRoot,
  'packages/native-reader/secure-webview/foliate-host-wire-corpus.v1.json',
);

function serializePolicy(source, kind) {
  return source.directiveOrder
    .map(
      (name) => `${name} ${source.policies[kind].directives[name].join(' ')}`,
    )
    .join('; ');
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function withTemporaryPackage(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'foliate-runtime-test-'));
  const packageRoot = path.join(root, 'native-reader');
  await mkdir(packageRoot, { recursive: true });
  try {
    await run({ root, packageRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('page v2 validates closed commands, samples real geometry, serializes and retires failures', async () => {
  await withTemporaryPackage(async ({ root, packageRoot }) => {
    await stageFoliateRuntime({
      workspace: root,
      packageRoot,
      sourceRoot,
      validateFn: async () => undefined,
    });
    const source = await readFile(
      path.join(packageRoot, FOLIATE_RUNTIME_DIRECTORY, 'web/bootstrap.js'),
      'utf8',
    );
    const events = [];
    const context = vm.createContext({
      Blob,
      File,
      TextEncoder,
      console,
      setTimeout: (callback, ms) => setTimeout(callback, ms === 3000 ? 30 : ms),
      clearTimeout,
      location: { origin: 'https://reader.test' },
      parent: { postMessage: (event) => events.push(event) },
    });
    vm.runInContext(
      source
        .replace("import './foliate/view.js';", '')
        .replaceAll('export const ', 'const ')
        .replaceAll('import.meta.url', "'https://reader.test/bootstrap.js'") +
        '\nglobalThis.hooks = __hnBootstrapTestHooks;',
      context,
    );
    const hooks = context.hooks;
    const requestId = 'p'.repeat(43);
    assert.ok(hooks.parsePagePayload({ direction: 'next', requestId }));
    for (const payload of [
      { direction: 'left', requestId },
      { direction: 'next', requestId: 'short' },
      { direction: 'next', requestId, extra: 1 },
      { requestId },
    ])
      assert.equal(hooks.parsePagePayload(payload), null);
    assert.equal(
      hooks.parseCommand({
        type: 'page',
        protocolVersion: 1,
        session: 's',
        generation: 'g',
        payload: {},
      }),
      null,
    );
    const createSession = (
      renderer,
      fixedLayout = false,
      sections = [{}, {}, { linear: 'no' }],
    ) => {
      const view = Object.assign(new EventTarget(), {
        renderer,
        isFixedLayout: fixedLayout,
        book: { sections },
        remove() {},
        close() {},
      });
      const session = {
        view,
        session: 'session',
        generation: 'generation',
        modelSent: true,
        currentIndex: 0,
        finalizedBooks: new WeakSet(),
        finalizedRenderers: new WeakSet(),
      };
      hooks.activateTestSession(session);
      return session;
    };
    const renderer = {
      scrolled: true,
      start: 0,
      end: 100,
      viewSize: 250,
      size: 100,
      distances: [],
      async next(distance) {
        this.distances.push(distance);
        this.start += distance ?? 100;
        this.end = this.start + 100;
      },
      async prev() {
        this.start = Math.max(0, this.start - 100);
        this.end = this.start + 100;
      },
    };
    const session = createSession(renderer);
    renderer.nextSection = async () => {
      session.currentIndex = 1;
    };
    renderer.prevSection = async () => {
      session.currentIndex = 0;
    };
    assert.deepEqual(
      { ...hooks.pageBoundaries(session) },
      { canGoPrevious: false, canGoNext: true },
    );
    await hooks.turnPage(session, 1, requestId);
    assert.equal(session.currentIndex, 1);
    assert.equal(
      renderer.start,
      0,
      'scrolled buttons skip directly to the adjacent chapter',
    );
    assert.equal(hooks.pageBoundaries(session).canGoPrevious, true);
    await hooks.turnPage(session, -1, requestId);
    assert.equal(session.currentIndex, 0);
    await hooks.turnPage(session, 1, requestId);
    assert.deepEqual(renderer.distances, []);
    assert.equal(
      renderer.start,
      0,
      'chapter navigation does not invoke viewport scrolling',
    );
    assert.equal(
      hooks.pageBoundaries(session).canGoNext,
      false,
      'last readable chapter is a boundary even at its start',
    );
    session.currentIndex = 1;
    assert.equal(
      hooks.pageBoundaries(session).canGoNext,
      false,
      'nonlinear tail is skipped',
    );
    const before = events.length;
    await hooks.turnPage(session, 1, requestId);
    assert.equal(renderer.start, 0);
    assert.deepEqual(
      events.slice(before).map((event) => event.type),
      ['page-state', 'page-state', 'command-ack'],
    );
    assert.equal(events.at(-2).requestId, requestId);
    assert.ok(
      events
        .filter((event) => event.type === 'page-state')
        .every(
          (event, index, states) =>
            index === 0 || event.revision > states[index - 1].revision,
        ),
    );
    renderer.scrolled = false;
    renderer.atStart = false;
    renderer.atEnd = false;
    assert.deepEqual(
      { ...hooks.pageBoundaries(session) },
      { canGoPrevious: true, canGoNext: true },
      'last chapter middle page is available',
    );
    renderer.atStart = true;
    renderer.atEnd = true;
    assert.deepEqual(
      { ...hooks.pageBoundaries(session) },
      { canGoPrevious: false, canGoNext: false },
    );
    const frames = ['left', 'right'].map(() => ({
      doc: {
        defaultView: {
          frameElement: { parentElement: { style: { display: 'block' } } },
        },
      },
    }));
    const fixed = createSession(
      {
        index: 0,
        rtl: false,
        getContents: () => frames,
        getSpreadOf: (section) => ({ index: 0, side: section.side }),
      },
      true,
      [{ side: 'left' }, { side: 'right' }],
    );
    assert.deepEqual(
      { ...hooks.pageBoundaries(fixed) },
      { canGoPrevious: false, canGoNext: false },
      'landscape spread shows both pages',
    );
    frames[1].doc.defaultView.frameElement.parentElement.style.display = 'none';
    assert.equal(
      hooks.pageBoundaries(fixed).canGoNext,
      true,
      'portrait hidden side remains next',
    );
    fixed.view.renderer.rtl = true;
    assert.equal(
      hooks.pageBoundaries(fixed).canGoPrevious,
      true,
      'RTL reverses side order',
    );
    let release;
    const queueRenderer = {
      atStart: false,
      atEnd: false,
      calls: [],
      next() {
        this.calls.push('next');
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      async prev() {
        this.calls.push('previous');
      },
    };
    const queue = createSession(queueRenderer);
    const first = hooks.turnPage(queue, 1, requestId);
    await Promise.resolve();
    const second = hooks.turnPage(queue, -1, 'q'.repeat(43));
    assert.deepEqual(queueRenderer.calls, ['next']);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(queueRenderer.calls, ['next', 'previous']);
    queueRenderer.setAttribute = (_, flow) => {
      queueRenderer.flow = flow;
      queueRenderer.calls.push('flow');
    };
    queueRenderer.getAttribute = () => queueRenderer.flow;
    const flowQueue = createSession(queueRenderer);
    const pagingBeforeFlow = hooks.turnPage(flowQueue, 1, requestId);
    await Promise.resolve();
    const switching = hooks.handleCurrentCommand({
      type: 'flow',
      session: 'session',
      generation: 'generation',
      payload: { flow: 'scrolled' },
    });
    assert.equal(queueRenderer.calls.at(-1), 'next');
    release();
    await Promise.all([pagingBeforeFlow, switching]);
    assert.equal(queueRenderer.calls.at(-1), 'flow');
    assert.equal(
      events.at(-1).command,
      'flow',
      'queued flow runs after the page releases ownership',
    );
    const overflow = createSession(queueRenderer);
    const inFlight = hooks.turnPage(overflow, 1, requestId);
    await Promise.resolve();
    const queued = hooks.turnPage(overflow, -1, 'q'.repeat(43));
    await hooks.turnPage(overflow, 1, 'r'.repeat(43));
    assert.equal(
      overflow.terminalFailure,
      true,
      'only one competing request may queue',
    );
    const afterOverflow = events.length;
    release();
    await Promise.all([inFlight, queued]);
    assert.equal(events.length, afterOverflow);
    const fault = createSession({
      atStart: false,
      atEnd: false,
      next() {
        throw new Error('engine');
      },
      prev() {},
    });
    await hooks.turnPage(fault, 1, requestId);
    assert.equal(fault.terminalFailure, true);
    assert.equal(events.at(-1).code, 'render-failure');
    let late;
    const hanging = createSession({
      atStart: false,
      atEnd: false,
      next: () =>
        new Promise((resolve) => {
          late = resolve;
        }),
      prev() {},
    });
    await hooks.turnPage(hanging, 1, requestId);
    assert.equal(hanging.terminalFailure, true);
    const retiredEvents = events.length;
    late();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      events.length,
      retiredEvents,
      'late completion cannot publish state or ack',
    );
  });
});

test('stages a reproducible PDF-free Foliate runtime subset', async () => {
  await withTemporaryPackage(async ({ root, packageRoot }) => {
    const options = {
      workspace: root,
      packageRoot,
      sourceRoot,
      validateFn: async () => undefined,
    };
    await stageFoliateRuntime(options);
    const manifestPath = path.join(
      packageRoot,
      FOLIATE_RUNTIME_DIRECTORY,
      FOLIATE_RUNTIME_MANIFEST,
    );
    const firstManifest = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(firstManifest);
    const webRuntimeRoot = path.join(
      packageRoot,
      FOLIATE_RUNTIME_DIRECTORY,
      'web',
    );
    const webManifestPath = path.join(webRuntimeRoot, 'manifest.json');
    const firstWebManifest = await readFile(webManifestPath, 'utf8');
    const webManifest = JSON.parse(firstWebManifest);
    assert.ok(manifest.assets.some((asset) => asset.path === 'view.js'));
    assert.equal(webManifest.runtime, 'foliate-web');
    assert.equal(webManifest.runtimeVersion, 'foliate-web-1');
    assert.ok(webManifest.assets.some((asset) => asset.path === 'reader.html'));
    assert.ok(
      webManifest.assets.some((asset) => asset.path === 'bootstrap.js'),
    );
    assert.deepEqual(
      webManifest.assets
        .filter((asset) => asset.path.startsWith('probes/'))
        .map((asset) => asset.path),
      ['probes/csp-1x1.png', 'probes/csp-external-canary.js'],
    );
    assert.ok(
      webManifest.assets.every((asset) =>
        /^foliate\/|^(?:reader\.html|bootstrap\.js|probes\/|notices\/)/.test(
          asset.path,
        ),
      ),
    );
    for (const asset of webManifest.assets) {
      assert.match(asset.sha256, /^[0-9a-f]{64}$/);
      assert.equal(typeof asset.source, 'string');
      assert.equal(
        asset.size,
        (await readFile(path.join(webRuntimeRoot, asset.path))).length,
      );
    }
    const readerHtml = await readFile(
      path.join(webRuntimeRoot, 'reader.html'),
      'utf8',
    );
    const cspSource = JSON.parse(await readFile(cspSourcePath, 'utf8'));
    const hostCsp = serializePolicy(cspSource, 'host');
    const publicationCsp = serializePolicy(cspSource, 'publication');
    assert.equal(
      /Content-Security-Policy" content="([^"]+)"/.exec(readerHtml)?.[1],
      hostCsp,
    );
    assert.ok(
      readerHtml.indexOf('http-equiv="Content-Security-Policy"') <
        readerHtml.indexOf(
          '<script type="module" src="./bootstrap.js"></script>',
        ),
    );
    const bootstrap = await readFile(
      path.join(webRuntimeRoot, 'bootstrap.js'),
      'utf8',
    );
    assert.match(bootstrap, /import '\.\/foliate\/view\.js';/);
    assert.doesNotMatch(
      bootstrap,
      /(?:\beval\s*\(|innerHTML|script-src\s+(?:blob:|data:|'unsafe-inline'))/,
    );
    assert.match(bootstrap, /script-src 'none'/);
    assert.match(bootstrap, /connect-src 'none'/);
    assert.ok(bootstrap.includes(JSON.stringify(publicationCsp)));
    assert.equal(
      (
        await readFile(path.join(webRuntimeRoot, 'probes', 'csp-1x1.png'))
      ).toString('base64'),
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL3EgAAAABJRU5ErkJggg==',
    );
    assert.match(
      await readFile(
        path.join(webRuntimeRoot, 'probes', 'csp-external-canary.js'),
        'utf8',
      ),
      /document\.currentScript\?\.dataset\.hnCspProbeToken/,
    );
    assert.doesNotMatch(bootstrap, /postMessage\([^,]+,\s*['"]\*['"]\)/);
    assert.doesNotMatch(bootstrap, /\bfetch\s*\(/);
    for (const marker of [
      'event.origin !== location.origin || event.source !== parent',
      'FOLIATE_IFRAME_PROTOCOL_VERSION',
      "'probe', 'open', 'dispose', 'navigate', 'flow', 'page'",
      "'probe-result', 'publication-model', 'ready', 'model', 'location', 'error', 'command-ack', 'page-state'",
      "'probe-result': ['passed']",
      'function handleProbe(command)',
      'function hasPassedProbeBinding(command)',
      'completeProbeResult(passed)',
      'hasOnlyKeys(value',
      'command.session !== session.session',
      'command.generation !== session.generation',
      'value instanceof Blob',
      'new File([payload.file], payload.name',
      'probeEmbeddedEnforcement()',
      'const probeAssets = token => ({',
      'const makeProbeDocument = (token, assets) =>',
      "new URL('./probes/csp-1x1.png?hnCspProbe=' + token, import.meta.url).href",
      "new URL('./probes/csp-external-canary.js?hnCspProbe=' + token, import.meta.url).href",
      "frame.setAttribute('sandbox', FOLIATE_PUBLICATION_IFRAME_SANDBOX)",
      "if (strict) frame.setAttribute('csp', FOLIATE_PUBLICATION_CSP)",
      'frame.src = probeUrl',
      'frameWindow.location?.href !== probeUrl',
      "frameDocument.URL === 'about:blank'",
      'frameDocument.querySelector(\'meta[name="hn-csp-external-probe"]\')?.content',
      "image.getAttribute('src') !== assets.png",
      "script.getAttribute('src') !== assets.script",
      'image.naturalWidth === 1',
      'image.naturalWidth === 0',
      'crossImage.naturalWidth === 0',
      "frame?.removeEventListener?.('load', onLoad)",
      "frame?.removeEventListener?.('error', onError)",
      'URL.revokeObjectURL(probeUrl)',
      "send('probe-result', binding.session, binding.generation, { passed })",
      "let runtimeState = 'fresh'",
      "runtimeState = 'probing'",
      "runtimeState = 'opening'",
      "runtimeState = 'live'",
      "runtimeState = 'disposing'",
      "runtimeState = 'disposed'",
      'FORMAT_TUPLES',
      'payload.file.type !== tuple.mimeType',
      'const hasSection = payload.section !== undefined',
      'if (hasSection === hasDestination) return null',
      'session.detached',
      'startupPending: true',
      'engineFinalized: false',
      'if (!session.startupPending) void finalizeEngine(session)',
      'session.view.renderer?.cancelPendingLoad?.()',
      'session.startupPending = false;',
      'return await finalizeEngine(session);',
      'if (!session || session.engineFinalized) return;',
      'renderer?.invalidatePendingLoads?.();',
      'if (!session.closeAttempted)',
      'session.closeAttempted = true;',
      'session.view.renderer = null;',
      "session.pendingNavigation?.reject(new Error('session disposed'))",
      'locationDto(view, event.detail)',
      "send('ready'",
      "send('model'",
      "send('location'",
      "send('error'",
      "send('command-ack'",
      'onExternalLink: event => event.preventDefault()',
      'try { session.view.close(); } catch {}',
      'try { book.destroy?.(); } catch {}',
      'view.remove();',
      'session.firstReadableIndex = view.book?.sections?.findIndex',
      'await view.renderer.goTo({ index: session.firstReadableIndex })',
      'index !== session.firstReadableIndex',
      'if (session.navigationInFlight || session.pageTurnInFlight || session.pendingNavigation)',
      'session.navigationInFlight = true',
      "sendError(command.session, command.generation, 'navigation-busy')",
      'session.destinationRegistry?.get(payload.destination)',
      'session.navigationInFlight = false',
      'inputPage(session, direction)',
      'observePublicationFrame(session, doc)',
      'stripPublicationRefreshMeta',
      'finalizeLateResources(session)',
      'const index = Number.isInteger(detail?.section?.current)',
      '? detail.section.current',
      'const section = view.book?.sections?.[index];',
      "section != null && section.linear !== 'no'",
      'firstLoad.catch(() => undefined)',
      'if (current(session)) dispose(session);',
      'else await finalizeEngine(session);',
      'void probeEmbeddedEnforcement()',
      '.catch(() => finish(false))',
    ]) {
      assert.ok(
        bootstrap.includes(marker),
        `Missing bootstrap marker: ${marker}`,
      );
    }
    assert.doesNotMatch(bootstrap, /frame\.srcdoc\s*=/);
    assert.doesNotMatch(
      bootstrap,
      /(?:PerformanceResourceTiming|getEntriesByType\?\.|getEntriesByType\('resource'\))/,
    );
    assert.doesNotMatch(
      bootstrap,
      /hnCspInlineProbe|hnCspProbeImageLoaded|onload=/,
    );
    assert.ok(
      bootstrap.indexOf(
        "frame.setAttribute('sandbox', FOLIATE_PUBLICATION_IFRAME_SANDBOX)",
      ) < bootstrap.indexOf('frame.src = probeUrl'),
      'probe must set the publication sandbox before navigation',
    );
    assert.ok(
      bootstrap.indexOf(
        "if (strict) frame.setAttribute('csp', FOLIATE_PUBLICATION_CSP)",
      ) < bootstrap.indexOf('frame.src = probeUrl'),
      'strict probe must install the exact publication CSP before navigation',
    );
    assert.ok(
      bootstrap.indexOf(
        'if (!session.startupPending) void finalizeEngine(session)',
      ) > bootstrap.indexOf('cleanup(session)'),
      'dispose must detach before deciding whether startup engine finalization can run',
    );
    const initialGoTo = bootstrap.indexOf(
      'await view.renderer.goTo({ index: session.firstReadableIndex })',
    );
    assert.ok(
      initialGoTo <
        bootstrap.indexOf('session.startupPending = false;', initialGoTo),
      'initial renderer goTo must settle before startup engine finalization becomes eligible',
    );
    for (const rendererPath of ['paginator.js', 'fixed-layout.js']) {
      const renderer = await readFile(
        path.join(webRuntimeRoot, 'foliate', rendererPath),
        'utf8',
      );
      assert.ok(
        renderer.includes("iframe.setAttribute('csp', publicationCsp)"),
      );
      assert.ok(
        renderer.indexOf("iframe.setAttribute('csp', publicationCsp)") <
          renderer.indexOf('iframe.src = src'),
        `${rendererPath} must set CSP before iframe src`,
      );
      assert.ok(
        renderer.includes(
          "iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')",
        ),
        `${rendererPath} must set the same publication sandbox as probes`,
      );
      assert.ok(
        renderer.indexOf(
          "iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')",
        ) < renderer.indexOf('iframe.src = src'),
        `${rendererPath} must set sandbox before iframe src`,
      );
    }
    const paginator = await readFile(
      path.join(webRuntimeRoot, 'foliate', 'paginator.js'),
      'utf8',
    );
    const outerCancelStart = paginator.indexOf('    cancelPendingLoad() {');
    assert.ok(
      outerCancelStart >= 0,
      'outer foliate-paginator must expose cancellation',
    );
    assert.ok(
      paginator.indexOf('this.__hnCancelled = true', outerCancelStart) >
        outerCancelStart,
      'outer paginator cancel must set renderer cancellation state first',
    );
    assert.ok(
      paginator.indexOf('this.#view?.cancelPendingLoad?.()', outerCancelStart) >
        outerCancelStart,
      'outer paginator cancel must forward to active inner View load',
    );
    assert.ok(
      paginator.includes(
        "if (this.__hnCancelled) throw new Error('HN_FOLIATE_LOAD_CANCELLED')",
      ),
      'paginator section-load continuation must reject before createView after cancellation',
    );
    const fixedLayout = await readFile(
      path.join(webRuntimeRoot, 'foliate', 'fixed-layout.js'),
      'utf8',
    );
    const fixedCancelStart = fixedLayout.indexOf('    cancelPendingLoad() {');
    assert.ok(fixedCancelStart >= 0, 'fixed renderer must expose cancellation');
    assert.ok(
      fixedLayout.indexOf('this.__hnCancelled = true', fixedCancelStart) >
        fixedCancelStart,
      'fixed cancel must set its state before cancelling frames',
    );
    assert.match(paginator, /this\.#observer\.disconnect\(\)/);
    assert.match(paginator, /this\.#view\?\.destroy\?\.\(\)/);
    assert.doesNotMatch(paginator, /this\.#observer\.unobserve\(this\)/);
    for (const rendererPath of ['paginator.js', 'fixed-layout.js']) {
      const renderer = await readFile(
        path.join(webRuntimeRoot, 'foliate', rendererPath),
        'utf8',
      );
      assert.ok(renderer.includes('cancelPendingLoad()'));
      assert.ok(renderer.includes('__hnCancelPendingIframeLoad'));
      assert.ok(renderer.includes('HN_FOLIATE_LOAD_CANCELLED'));
      assert.ok(renderer.includes("src = 'about:blank'"));
      assert.ok(renderer.includes("removeEventListener('load'"));
      assert.ok(renderer.includes("removeEventListener('error'"));
      execFileSync(process.execPath, [
        '--check',
        path.join(webRuntimeRoot, 'foliate', rendererPath),
      ]);
    }
    globalThis.HTMLElement = class HTMLElement {};
    globalThis.customElements = { define: () => undefined };
    globalThis.NodeFilter = {
      SHOW_ELEMENT: 1,
      SHOW_TEXT: 4,
      SHOW_CDATA_SECTION: 8,
      FILTER_ACCEPT: 1,
      FILTER_REJECT: 2,
      FILTER_SKIP: 3,
    };
    class FakeElement extends EventTarget {
      style = { setProperty: () => undefined };
      classList = { toggle: () => undefined };
      children = [];
      append(...children) {
        this.children.push(...children);
      }
      appendChild(child) {
        this.children.push(child);
        return child;
      }
      removeChild(child) {
        this.children = this.children.filter((entry) => entry !== child);
      }
      replaceChildren(...children) {
        this.children = children;
      }
      setAttribute() {}
      removeAttribute() {}
      getAttribute() {
        return undefined;
      }
      remove() {
        this.removed = true;
      }
      getBoundingClientRect() {
        return { width: 1, height: 1, left: 0, right: 1, top: 0, bottom: 1 };
      }
      querySelectorAll() {
        return [];
      }
      addEventListener(...args) {
        return super.addEventListener(...args);
      }
    }
    class FakeShadowRoot extends FakeElement {
      set innerHTML(_value) {}
      getElementById() {
        return new FakeElement();
      }
    }
    globalThis.HTMLElement = class HTMLElement extends FakeElement {
      attachShadow() {
        return new FakeShadowRoot();
      }
    };
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(callback) {
        void callback;
      }
      observe() {}
      disconnect() {}
    };
    globalThis.matchMedia = () => ({ addEventListener: () => undefined });
    let createdFrames = 0;
    let foliateOpenCalls = 0;
    let nextFoliateBook = null;
    globalThis.document = {
      body: new FakeElement(),
      createElement: (name) => {
        if (name === 'foliate-view') {
          const view = new FakeElement();
          view.book = nextFoliateBook ?? {
            dir: 'ltr',
            metadata: { title: 'Harness book' },
            sections: [
              { linear: 'yes', size: 1 },
              { linear: 'no', size: 1 },
            ],
            toc: [{ label: 'Nonlinear', href: '#nonlinear', subitems: [] }],
            resolveHref: async () => ({ index: 1, anchor: () => undefined }),
          };
          view.goToIndices = [];
          view.publicationFrames = [];
          view.renderer = {
            goTo: async ({ index }) => {
              view.goToIndices.push(index);
              const publicationFrame = new EventTarget();
              view.publicationFrames.push(publicationFrame);
              view.dispatchEvent(
                new CustomEvent('load', {
                  detail: {
                    index,
                    doc: {
                      head: { prepend: () => undefined },
                      createElement: () => ({}),
                      querySelectorAll: () => [],
                      addEventListener: () => undefined,
                      defaultView: { frameElement: publicationFrame },
                    },
                  },
                }),
              );
              view.dispatchEvent(
                new CustomEvent('relocate', {
                  detail: {
                    section: { current: index },
                    cfi: null,
                    fraction: null,
                  },
                }),
              );
            },
            getAttribute: () => 'paginated',
            setAttribute: () => undefined,
            atStart: true,
            atEnd: false,
            pageTurns: [],
            next: async () => {
              view.renderer.pageTurns.push('next');
              view.renderer.atStart = false;
            },
            prev: async () => {
              view.renderer.pageTurns.push('prev');
              view.renderer.atStart = true;
            },
          };
          view.open = async () => {
            foliateOpenCalls += 1;
          };
          return view;
        }
        if (name !== 'iframe') return new FakeElement();
        createdFrames += 1;
        const frame = new FakeElement();
        frame.contentDocument = {
          documentElement: { localName: 'html', getAttribute: () => undefined },
          querySelector: () => null,
        };
        Object.defineProperty(frame, 'src', {
          set: () => {
            queueMicrotask(() => frame.dispatchEvent(new Event('load')));
          },
        });
        return frame;
      },
      createRange: () => ({ selectNodeContents: () => undefined }),
    };
    globalThis.requestAnimationFrame = (callback) => callback();
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => '0' });
    for (const rendererPath of ['paginator.js', 'fixed-layout.js']) {
      const {
        __hnCancelPendingIframeLoad,
        __hnCreateRendererCancellation,
        __hnRaceRendererLoad,
      } = await import(
        `${pathToFileURL(path.join(webRuntimeRoot, 'foliate', rendererPath)).href}?cancel-test=1`
      );
      const removedListeners = [];
      const frame = { src: 'blob:pending' };
      let cleanupCalls = 0;
      let rejection;
      const pending = {
        cleanup: () => {
          cleanupCalls += 1;
          removedListeners.push('load', 'error');
        },
        reject: (error) => {
          rejection = error;
        },
      };
      assert.equal(__hnCancelPendingIframeLoad(frame, pending), true);
      assert.equal(cleanupCalls, 1);
      assert.deepEqual(removedListeners, ['load', 'error']);
      assert.equal(frame.src, 'about:blank');
      assert.match(rejection?.message ?? '', /HN_FOLIATE_LOAD_CANCELLED/);
      assert.equal(__hnCancelPendingIframeLoad(frame, null), false);
      const normalCancellation = __hnCreateRendererCancellation();
      assert.equal(
        await __hnRaceRendererLoad(
          Promise.resolve('continued'),
          normalCancellation,
        ),
        'continued',
      );
    }
    const committed = [];
    const revoked = [];
    const originalUrl = globalThis.URL;
    globalThis.URL = {
      ...originalUrl,
      revokeObjectURL: (url) => revoked.push(url),
    };
    for (const loaderPath of ['epub.js', 'mobi.js']) {
      const { __hnCommitObjectUrl } = await import(
        `${pathToFileURL(path.join(webRuntimeRoot, 'foliate', loaderPath)).href}?commit-test=1`
      );
      const cache = new Map();
      const owner = { __hnInvalidated: false };
      assert.equal(
        __hnCommitObjectUrl(owner, cache, 'section', 'blob:kept'),
        'blob:kept',
      );
      assert.equal(cache.get('section'), 'blob:kept');
      owner.__hnInvalidated = true;
      assert.throws(
        () => __hnCommitObjectUrl(owner, cache, 'late', 'blob:late'),
        /HN_FOLIATE_LOAD_CANCELLED/,
      );
      committed.push(...cache.values());
    }
    assert.deepEqual(committed, ['blob:kept', 'blob:kept']);
    assert.deepEqual(revoked, ['blob:late', 'blob:late']);
    const { __hnCommitComicUrls, makeComicBook } = await import(
      `${pathToFileURL(path.join(webRuntimeRoot, 'foliate', 'comic-book.js')).href}?commit-test=1`
    );
    const comicCache = new Map();
    const comicUrls = new Map();
    const comicBook = { __hnInvalidated: false };
    assert.equal(
      __hnCommitComicUrls(
        comicBook,
        comicCache,
        comicUrls,
        'page',
        'blob:source',
        'blob:page',
      ),
      'blob:page',
    );
    comicBook.__hnInvalidated = true;
    assert.throws(
      () =>
        __hnCommitComicUrls(
          comicBook,
          comicCache,
          comicUrls,
          'late',
          'blob:late-source',
          'blob:late-page',
        ),
      /HN_FOLIATE_LOAD_CANCELLED/,
    );
    assert.deepEqual(revoked, [
      'blob:late',
      'blob:late',
      'blob:late-source',
      'blob:late-page',
    ]);
    let resolveComicBlob;
    const comicBlob = new Promise((resolve) => {
      resolveComicBlob = resolve;
    });
    let generatedUrlIndex = 0;
    globalThis.URL = {
      ...globalThis.URL,
      createObjectURL: () => `blob:generated-${++generatedUrlIndex}`,
    };
    const generatedComic = makeComicBook(
      {
        entries: [{ filename: 'page.jpg' }],
        loadBlob: () => comicBlob,
        getSize: () => 1,
      },
      { name: 'book.cbz' },
    );
    let publicComicDestroyCalls = 0;
    const originalComicDestroy = generatedComic.destroy.bind(generatedComic);
    generatedComic.destroy = () => {
      publicComicDestroyCalls += 1;
      return originalComicDestroy();
    };
    const generatedComicLoad = generatedComic.sections[0].load();
    generatedComic.invalidate();
    resolveComicBlob(new Blob(['late comic']));
    await assert.rejects(generatedComicLoad, /HN_FOLIATE_LOAD_CANCELLED/);
    assert.deepEqual(revoked.slice(-1), ['blob:generated-1']);
    const stagedMobi = await readFile(
      path.join(webRuntimeRoot, 'foliate', 'mobi.js'),
      'utf8',
    );
    assert.match(stagedMobi, /unload: \(\) => this\.unloadSection\(section\)/);
    assert.match(stagedMobi, /export class MOBI6/);
    assert.match(stagedMobi, /export class KF8/);
    assert.match(stagedMobi, /__hnCommitObjectUrl\(this, this\.#resourceCache/);
    assert.match(stagedMobi, /__hnCommitObjectUrl\(this, this\.#cache, str/);
    globalThis.DOMParser = class DOMParser {};
    globalThis.XMLSerializer = class XMLSerializer {};
    const { MOBI6, KF8 } = await import(
      `${pathToFileURL(path.join(webRuntimeRoot, 'foliate', 'mobi.js')).href}?class-cleanup-test=1`
    );
    for (const ReaderClass of [MOBI6, KF8]) {
      const reader = new ReaderClass({});
      assert.doesNotThrow(() => reader.invalidate());
      assert.doesNotThrow(() => reader.unloadSection({}));
    }
    const kf8 = new KF8({});
    kf8.invalidate();
    assert.throws(
      () => kf8.__hnTestCommitInline('kindle:inline', {}),
      /HN_FOLIATE_LOAD_CANCELLED/,
    );
    assert.equal(kf8.__hnTestInlineSize(), 0);
    const stagedFb2 = await readFile(
      path.join(webRuntimeRoot, 'foliate', 'fb2.js'),
      'utf8',
    );
    assert.doesNotMatch(stagedFb2, /__hnTrackRendererLoad/);
    const deferred = () => {
      let resolve;
      let reject;
      const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
    };
    const inlineDeferred = deferred();
    const kf8LateInline = new KF8({});
    kf8LateInline.__hnTestSetLoadResourceBlob(() => inlineDeferred.promise);
    const lateInlineLoad = kf8LateInline.loadResource(
      'kindle:embed:1?mime=image/svg+xml',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    kf8LateInline.invalidate();
    inlineDeferred.resolve([new Blob(['inline']), { nodeName: 'svg' }]);
    await assert.rejects(lateInlineLoad, /HN_FOLIATE_LOAD_CANCELLED/);
    assert.equal(kf8LateInline.__hnTestInlineSize(), 0);
    const { Paginator } = await import(
      `${pathToFileURL(path.join(webRuntimeRoot, 'foliate', 'paginator.js')).href}?outer-cancel-test=1`
    );
    const outerPaginator = new Paginator();
    const paginatorLoad = deferred();
    let paginatorUnloads = 0;
    let paginatorInvalidates = 0;
    outerPaginator.open({
      dir: 'ltr',
      sections: [
        {
          linear: 'yes',
          load: () => paginatorLoad.promise,
          unload: () => {
            paginatorUnloads += 1;
          },
          invalidate: () => {
            paginatorInvalidates += 1;
          },
        },
      ],
    });
    const paginatorGoTo = outerPaginator.goTo({ index: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    outerPaginator.cancelPendingLoad();
    await assert.rejects(paginatorGoTo, /HN_FOLIATE_LOAD_CANCELLED/);
    paginatorLoad.resolve('blob:late-section');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(outerPaginator.children.length, 0);
    assert.equal(paginatorUnloads, 1);
    outerPaginator.destroy();
    assert.equal(paginatorInvalidates, 1);
    const neverSettlingPaginator = new Paginator();
    let neverSettlingInvalidates = 0;
    let neverSettlingRendererDestroys = 0;
    neverSettlingPaginator.open({
      dir: 'ltr',
      sections: [
        {
          linear: 'yes',
          load: () => new Promise(() => undefined),
          unload: () => undefined,
          invalidate: () => {
            neverSettlingInvalidates += 1;
          },
        },
      ],
    });
    const neverSettlingGoTo = neverSettlingPaginator.goTo({ index: 0 });
    await Promise.resolve();
    neverSettlingPaginator.cancelPendingLoad();
    await assert.rejects(neverSettlingGoTo, /HN_FOLIATE_LOAD_CANCELLED/);
    const actualNeverSettlingDestroy = neverSettlingPaginator.destroy.bind(
      neverSettlingPaginator,
    );
    neverSettlingPaginator.destroy = () => {
      neverSettlingRendererDestroys += 1;
      return actualNeverSettlingDestroy();
    };

    const rejectingPaginator = new Paginator();
    let rejectRaw;
    const rejectingRaw = new Promise((_, reject) => {
      rejectRaw = reject;
    });
    rejectingPaginator.open({
      dir: 'ltr',
      sections: [{ linear: 'yes', load: () => rejectingRaw }],
    });
    const rejectingGoTo = rejectingPaginator.goTo({ index: 0 });
    await Promise.resolve();
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    process.once('unhandledRejection', onUnhandled);
    rejectingPaginator.cancelPendingLoad();
    await assert.rejects(rejectingGoTo, /HN_FOLIATE_LOAD_CANCELLED/);
    rejectRaw(new Error('raw section failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.removeListener('unhandledRejection', onUnhandled);
    assert.deepEqual(unhandled, []);

    globalThis.CSSStyleSheet = class CSSStyleSheet {
      replaceSync() {}
    };
    const { FixedLayout } = await import(
      `${pathToFileURL(path.join(webRuntimeRoot, 'foliate', 'fixed-layout.js')).href}?outer-cancel-test=1`
    );
    const fixed = new FixedLayout();
    const leftLoad = deferred();
    let leftUnloads = 0;
    let rightLoadCalls = 0;
    fixed.open({
      dir: 'ltr',
      rendition: { spread: 'both' },
      sections: [
        {
          linear: 'yes',
          pageSpread: 'left',
          load: () => leftLoad.promise,
          unload: () => {
            leftUnloads += 1;
          },
        },
        {
          linear: 'yes',
          pageSpread: 'right',
          load: () => {
            rightLoadCalls += 1;
            return Promise.resolve('blob:right');
          },
        },
      ],
    });
    const fixedGoTo = fixed.goTo({ index: 0 });
    await Promise.resolve();
    fixed.cancelPendingLoad();
    await assert.rejects(fixedGoTo, /HN_FOLIATE_LOAD_CANCELLED/);
    leftLoad.resolve('blob:late-left');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(rightLoadCalls, 0);
    assert.equal(leftUnloads, 1);

    const assertFixedPendingCancellation = async (pageSpread, lateKind) => {
      const pending = deferred();
      let unloads = 0;
      let invalidates = 0;
      let markStarted;
      const started = new Promise((resolve) => {
        markStarted = resolve;
      });
      const fixedCase = new FixedLayout();
      fixedCase.open({
        dir: 'ltr',
        rendition: { spread: 'both' },
        sections: [
          {
            linear: 'yes',
            pageSpread,
            load: () => {
              markStarted();
              return pending.promise;
            },
            unload: () => {
              unloads += 1;
            },
            invalidate: () => {
              invalidates += 1;
            },
          },
        ],
      });
      const framesBefore = createdFrames;
      const goTo = fixedCase.goTo({ index: 0 });
      await started;
      const unhandled = [];
      const onUnhandled = (error) => unhandled.push(error);
      process.once('unhandledRejection', onUnhandled);
      fixedCase.cancelPendingLoad();
      await assert.rejects(goTo, /HN_FOLIATE_LOAD_CANCELLED/);
      if (lateKind === 'resolve') pending.resolve(`blob:late-${pageSpread}`);
      else pending.reject(new Error(`late ${pageSpread} failure`));
      await new Promise((resolve) => setTimeout(resolve, 0));
      process.removeListener('unhandledRejection', onUnhandled);
      assert.equal(unloads, 1, `${pageSpread} ${lateKind} unloads once`);
      assert.equal(
        createdFrames,
        framesBefore,
        `${pageSpread} ${lateKind} cannot create a late frame`,
      );
      assert.deepEqual(
        unhandled,
        [],
        `${pageSpread} ${lateKind} has no unhandled rejection`,
      );
      fixedCase.destroy();
      assert.equal(
        invalidates,
        1,
        `${pageSpread} ${lateKind} invalidates once after destroy`,
      );
    };
    for (const pageSpread of ['center', 'left', 'right']) {
      await assertFixedPendingCancellation(pageSpread, 'resolve');
      await assertFixedPendingCancellation(pageSpread, 'reject');
    }

    for (const pageSpread of ['left', 'right']) {
      const blankSpread = new FixedLayout();
      blankSpread.open({
        dir: 'ltr',
        rendition: { spread: 'both', viewport: { width: 1, height: 1 } },
        sections: [
          {
            linear: 'yes',
            pageSpread,
            load: () => Promise.resolve('blob:normal-section'),
          },
        ],
      });
      await blankSpread.goTo({ index: 0 });
    }
    globalThis.window = undefined;
    const probeMessages = [];
    const trustedParent = {
      postMessage: (message, origin) => probeMessages.push({ message, origin }),
    };
    globalThis.parent = trustedParent;
    globalThis.location = { origin: 'https://reader.invalid' };
    const { __hnBootstrapTestHooks } = await import(
      `${pathToFileURL(path.join(webRuntimeRoot, 'bootstrap.js')).href}?finalize-test=1`
    );
    const originalProbeDocument = globalThis.document;
    const originalProbeUrl = globalThis.URL;
    const originalProbeRandomUuid = globalThis.crypto.randomUUID;
    const runEmbeddedProbe = async ({
      control,
      strict,
      faults = {},
      startup,
      supported = true,
    }) => {
      const frames = [];
      let capabilityFramePending = startup !== undefined;
      const originalIframe = globalThis.HTMLIFrameElement;
      globalThis.HTMLIFrameElement = class {};
      if (supported) globalThis.HTMLIFrameElement.prototype.csp = '';
      let nextToken = 0;
      globalThis.crypto.randomUUID = () => `token-${++nextToken}`;
      function ProbeUrl(...args) {
        return new originalUrl(...args);
      }
      ProbeUrl.createObjectURL = () => `blob:probe-${frames.length + 1}`;
      ProbeUrl.revokeObjectURL = (url) => {
        const frame =
          frames.find((candidate) => candidate.src === url) ?? frames.at(-1);
        if (frame) frame.revokeAttempted = true;
        if (faults.revokeObjectURL) throw new Error('revoke failure');
        if (frame) frame.revoked = true;
      };
      globalThis.URL = ProbeUrl;
      globalThis.document = {
        querySelector: () => ({ content: hostCsp }),
        body: {
          append: (frame) => {
            frame.appendAttempted = true;
            if (faults.append) throw new Error('append failure');
            frame.appended = true;
          },
        },
        createElement: (name) => {
          assert.equal(name, 'iframe');
          if (capabilityFramePending) {
            capabilityFramePending = false;
            const attributes = new Map();
            return {
              setAttribute: (key, value) => attributes.set(key, value),
              getAttribute: (key) => attributes.get(key),
            };
          }
          const result = frames.length === 0 ? control : strict;
          const token = `${frames.length === 0 ? 'control' : 'strict'}-token-${frames.length + 1}`;
          const markers = {
            static: { content: 'hn-csp-probe-v1' },
            image: {
              complete: true,
              naturalWidth: result.imageWidth,
              naturalHeight: result.imageHeight,
              dataset: {},
            },
            crossImage: {
              complete: true,
              naturalWidth: result.crossImageWidth,
            },
            script: {},
            external: result.externalMarker ? { content: token } : null,
          };
          const assets = {
            image: `${
              pathToFileURL(path.join(webRuntimeRoot, 'probes', 'csp-1x1.png'))
                .href
            }?hnCspProbe=${token}`,
            crossImage: `https://example.invalid/__hn-csp-probe-${token}`,
            script: `${
              pathToFileURL(
                path.join(webRuntimeRoot, 'probes', 'csp-external-canary.js'),
              ).href
            }?hnCspProbe=${token}`,
          };
          markers.image.getAttribute = (name) =>
            name === 'src' ? (result.imageUrl ?? assets.image) : null;
          markers.crossImage.getAttribute = (name) =>
            name === 'src' ? (result.crossImageUrl ?? assets.crossImage) : null;
          markers.script.getAttribute = (name) =>
            name === 'src' ? (result.scriptUrl ?? assets.script) : null;
          markers.script.dataset = { hnCspProbeToken: token };
          markers.assets = assets;
          const frame = new EventTarget();
          frame.attributes = [];
          frame.contentWindow = { location: {} };
          Object.defineProperty(frame.contentWindow.location, 'href', {
            get: () => frame._src,
          });
          frame.contentDocument = {
            get URL() {
              return result.url ?? frame._src;
            },
            readyState: result.readyState ?? 'complete',
            documentElement: { dataset: {} },
            querySelector: (selector) => {
              if (result.throwOnRead) throw new Error('unreadable probe');
              return (
                {
                  'meta[name="hn-csp-static-probe"]': markers.static,
                  'img[data-hn-csp-probe-image]': markers.image,
                  'img[data-hn-csp-probe-cross-image]': markers.crossImage,
                  'script[data-hn-csp-probe-token]': markers.script,
                  'meta[name="hn-csp-external-probe"]': markers.external,
                }[selector] ?? null
              );
            },
          };
          frame.markers = markers;
          frame.setAttribute = (attribute, value) => {
            frame.attributes.push([attribute, value]);
            if (faults.setAttribute) throw new Error('setAttribute failure');
          };
          const removeEventListener = frame.removeEventListener.bind(frame);
          frame.removeEventListener = (...args) => {
            frame.removeListenerAttempts =
              (frame.removeListenerAttempts ?? 0) + 1;
            if (faults.removeEventListener) {
              throw new Error('removeEventListener failure');
            }
            return removeEventListener(...args);
          };
          const addEventListener = frame.addEventListener.bind(frame);
          frame.addEventListener = (...args) => {
            frame.addListenerAttempts = (frame.addListenerAttempts ?? 0) + 1;
            if (faults.addEventListener)
              throw new Error('addEventListener failure');
            return addEventListener(...args);
          };
          frame.remove = () => {
            frame.removeAttempted = true;
            if (faults.remove) throw new Error('remove failure');
            frame.removed = true;
          };
          Object.defineProperty(frame, 'src', {
            get: () => frame._src,
            set: (url) => {
              frame.srcAttempted = true;
              if (faults.src) throw new Error('src failure');
              frame._src = url;
              frame.sequence = [...frame.attributes, ['src', url]];
              queueMicrotask(() => frame.dispatchEvent(new Event('load')));
            },
          });
          frames.push(frame);
          return frame;
        },
      };
      try {
        if (startup !== undefined) {
          __hnBootstrapTestHooks.resetProbeState();
          __hnBootstrapTestHooks.receiveMessage({
            origin: 'https://reader.invalid',
            source: trustedParent,
            data: {
              type: 'probe',
              protocolVersion: 1,
              session: 'startup',
              generation: 'startup',
              payload: { intrusiveCspDiagnostics: startup },
            },
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
          return { frames, state: __hnBootstrapTestHooks.getProbeState() };
        }
        return {
          passed: await __hnBootstrapTestHooks.probeEmbeddedEnforcement(),
          frames,
        };
      } finally {
        globalThis.document = originalProbeDocument;
        globalThis.URL = originalProbeUrl;
        globalThis.crypto.randomUUID = originalProbeRandomUuid;
        globalThis.HTMLIFrameElement = originalIframe;
      }
    };
    const passingProbe = await runEmbeddedProbe({
      control: {
        imageWidth: 1,
        imageHeight: 1,
        crossImageWidth: 0,
        externalMarker: true,
      },
      strict: {
        imageWidth: 0,
        imageHeight: 0,
        crossImageWidth: 0,
        externalMarker: false,
      },
    });
    assert.equal(
      passingProbe.passed,
      true,
      JSON.stringify(
        passingProbe.frames.map((frame) => ({
          sequence: frame.sequence,
          src: frame.src,
          revoked: frame.revoked,
        })),
      ),
    );
    assert.equal(passingProbe.frames.length, 2);
    assert.equal(
      passingProbe.frames[1].sequence.findIndex(([name]) => name === 'csp') <
        passingProbe.frames[1].sequence.findIndex(([name]) => name === 'src'),
      true,
    );
    assert.equal(passingProbe.frames[0].removed, true);
    assert.equal(passingProbe.frames[1].removed, true);
    assert.equal(passingProbe.frames[0].revoked, true);
    assert.equal(passingProbe.frames[1].revoked, true);
    const wrongUrlControlProbe = await runEmbeddedProbe({
      control: {
        imageWidth: 1,
        imageHeight: 1,
        crossImageWidth: 0,
        imageUrl: 'https://attacker.invalid/csp-1x1.png',
        externalMarker: true,
      },
      strict: {},
    });
    assert.equal(wrongUrlControlProbe.passed, false);
    assert.equal(wrongUrlControlProbe.frames.length, 1);
    assert.equal(wrongUrlControlProbe.frames[0].removed, true);
    const failedControlProbe = await runEmbeddedProbe({
      control: {
        imageWidth: 0,
        imageHeight: 0,
        crossImageWidth: 0,
        externalMarker: true,
      },
      strict: {},
    });
    assert.equal(failedControlProbe.passed, false);
    assert.equal(failedControlProbe.frames.length, 1);
    assert.equal(failedControlProbe.frames[0].removed, true);
    const unreadableStrictProbe = await runEmbeddedProbe({
      control: {
        imageWidth: 1,
        imageHeight: 1,
        crossImageWidth: 0,
        externalMarker: true,
      },
      strict: {
        throwOnRead: true,
      },
    });
    assert.equal(unreadableStrictProbe.passed, false);
    assert.equal(unreadableStrictProbe.frames.length, 2);
    assert.equal(unreadableStrictProbe.frames[1].removed, true);
    for (const fault of ['removeEventListener', 'revokeObjectURL', 'remove']) {
      const cleanupFailure = await runEmbeddedProbe({
        control: {
          imageWidth: 1,
          imageHeight: 1,
          crossImageWidth: 0,
          externalMarker: true,
        },
        strict: {},
        faults: { [fault]: true },
      });
      assert.equal(cleanupFailure.passed, false, `${fault} must fail closed`);
      assert.equal(cleanupFailure.frames.length, 1);
      assert.equal(cleanupFailure.frames[0].revokeAttempted, true);
      assert.equal(cleanupFailure.frames[0].removeAttempted, true);
    }
    for (const fault of ['setAttribute', 'addEventListener', 'src', 'append']) {
      const setupFailure = await runEmbeddedProbe({
        control: {},
        strict: {},
        faults: { [fault]: true },
      });
      assert.equal(setupFailure.passed, false, `${fault} must fail closed`);
      assert.equal(setupFailure.frames.length, 1);
      assert.equal(setupFailure.frames[0].revokeAttempted, true);
      assert.equal(setupFailure.frames[0].removeAttempted, true);
    }
    const quietStartup = await runEmbeddedProbe({ startup: false });
    assert.equal(quietStartup.state.sourceAuthorized, true);
    assert.equal(quietStartup.state.probeResult, 'skipped');
    assert.equal(quietStartup.frames.length, 0);
    const absentCapability = await runEmbeddedProbe({
      startup: false,
      supported: false,
    });
    assert.equal(absentCapability.state.sourceAuthorized, false);
    assert.equal(absentCapability.frames.length, 0);
    const diagnosticStartup = await runEmbeddedProbe({
      startup: true,
      control: {
        imageWidth: 1,
        imageHeight: 1,
        crossImageWidth: 0,
        externalMarker: true,
      },
      strict: {
        imageWidth: 0,
        imageHeight: 0,
        crossImageWidth: 0,
        externalMarker: false,
      },
    });
    assert.equal(diagnosticStartup.state.sourceAuthorized, true);
    assert.equal(diagnosticStartup.state.probeResult, 'passed');
    assert.equal(diagnosticStartup.frames.length, 2);
    const failedDiagnostic = await runEmbeddedProbe({
      startup: true,
      control: {
        imageWidth: 0,
        imageHeight: 0,
        crossImageWidth: 0,
        externalMarker: false,
      },
    });
    assert.equal(failedDiagnostic.state.sourceAuthorized, false);
    assert.equal(failedDiagnostic.state.probeResult, 'failed');
    probeMessages.length = 0;
    __hnBootstrapTestHooks.resetProbeState({ result: 'passed' });
    const probeEvent = (data, overrides = {}) => ({
      origin: 'https://reader.invalid',
      source: trustedParent,
      data,
      ...overrides,
    });
    const probeCommand = (
      session = 'session_A',
      generation = 'generation_A',
    ) => ({
      type: 'probe',
      protocolVersion: 2,
      session,
      generation,
      payload: {},
    });
    __hnBootstrapTestHooks.receiveMessage(probeEvent(probeCommand()));
    assert.equal(probeMessages.length, 1);
    assert.deepEqual(
      __hnBootstrapTestHooks.getProbeState().probeBinding.session,
      'session_A',
    );
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent(probeCommand('session_B', 'generation_B')),
    );
    assert.equal(
      __hnBootstrapTestHooks.getProbeState().probeBinding.session,
      'session_A',
    );
    for (const invalid of [
      probeEvent({ ...probeCommand(), extra: true }),
      probeEvent({ ...probeCommand(), payload: { unexpected: true } }),
      probeEvent({ ...probeCommand(), protocolVersion: 999 }),
      probeEvent(probeCommand(), { origin: 'https://attacker.invalid' }),
      probeEvent(probeCommand(), { source: {} }),
    ]) {
      __hnBootstrapTestHooks.receiveMessage(invalid);
    }
    assert.equal(probeMessages.length, 1);
    assert.deepEqual(probeMessages, [
      {
        message: {
          type: 'probe-result',
          protocolVersion: 2,
          session: 'session_A',
          generation: 'generation_A',
          passed: true,
        },
        origin: 'https://reader.invalid',
      },
    ]);
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent(probeCommand('session_A', 'generation_A')),
    );
    assert.equal(probeMessages.length, 1);
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent({
        type: 'open',
        protocolVersion: 2,
        session: 'session_B',
        generation: 'generation_B',
        payload: {},
      }),
    );
    assert.equal(probeMessages.length, 1);
    __hnBootstrapTestHooks.resetProbeState({
      result: 'passed',
      state: 'fresh',
    });
    probeMessages.length = 0;
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent(probeCommand('session_C', 'generation_C')),
    );
    assert.equal(probeMessages[0]?.message.passed, true);
    const validOpenPayload = {
      file: new File([new Blob(['book'])], 'book.epub', {
        type: 'application/epub+zip',
      }),
      format: 'epub',
      name: 'book.epub',
      mimeType: 'application/epub+zip',
    };
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent({
        type: 'open',
        protocolVersion: 2,
        session: 'session_D',
        generation: 'generation_D',
        payload: validOpenPayload,
      }),
    );
    await Promise.resolve();
    assert.equal(foliateOpenCalls, 0);
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent({
        type: 'open',
        protocolVersion: 2,
        session: 'session_C',
        generation: 'generation_C',
        payload: validOpenPayload,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(foliateOpenCalls, 1);
    assert.deepEqual(
      probeMessages.slice(1).map(({ message }) => message.type),
      ['publication-model', 'model', 'ready', 'command-ack', 'page-state'],
    );
    const openedSession = __hnBootstrapTestHooks.getActiveSession();
    assert.equal(openedSession.destinationRegistry.get('d:0').index, 1);
    assert.equal(__hnBootstrapTestHooks.getProbeState().runtimeState, 'live');
    const navigationMessageStart = probeMessages.length;
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent({
        type: 'navigate',
        protocolVersion: 2,
        session: 'session_C',
        generation: 'generation_C',
        payload: { destination: 'd:0' },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(openedSession.view.goToIndices, [0, 1]);
    assert.deepEqual(
      probeMessages
        .slice(navigationMessageStart)
        .map(({ message }) => message.type),
      ['page-state', 'page-state', 'command-ack'],
    );
    assert.equal(probeMessages.at(-1).message.command, 'navigate');
    assert.equal(
      probeMessages
        .slice(navigationMessageStart)
        .some(({ message }) => message.type === 'location'),
      false,
    );
    assert.equal(openedSession.firstReadableIndex, 0);
    const invalidDestinationMessageStart = probeMessages.length;
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent({
        type: 'navigate',
        protocolVersion: 2,
        session: 'session_C',
        generation: 'generation_C',
        payload: { destination: 'd:99' },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      probeMessages
        .slice(invalidDestinationMessageStart)
        .map(({ message }) => message.type),
      ['error'],
    );
    assert.equal(probeMessages.at(-1).message.code, 'navigation-failure');
    // Retired page commands are unknown; only explicit sections/destinations navigate.
    const beforeUnknown = probeMessages.length;
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent({
        type: 'page-turn',
        protocolVersion: 2,
        session: 'session_C',
        generation: 'generation_C',
        payload: { direction: 'next' },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(probeMessages.length, beforeUnknown);
    assert.deepEqual(openedSession.view.renderer.pageTurns, []);
    // Concurrent flow/navigation must leave the renderer untouched.
    openedSession.navigationInFlight = true;
    const beforeBusy = probeMessages.length;
    for (const [type, payload] of [
      ['navigate', { section: 0 }],
      ['flow', { flow: 'scrolled' }],
    ]) {
      __hnBootstrapTestHooks.receiveMessage(
        probeEvent({
          type,
          payload,
          protocolVersion: 2,
          session: 'session_C',
          generation: 'generation_C',
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      probeMessages.slice(beforeBusy).map(({ message }) => message.code),
      ['navigation-busy', 'navigation-busy'],
    );
    assert.deepEqual(openedSession.view.goToIndices, [0, 1]);
    openedSession.navigationInFlight = false;
    const validModel = {
      modelVersion: 1,
      format: 'epub',
      fixedLayout: false,
      flow: 'paginated',
      direction: 'ltr',
      metadata: { title: null },
      sections: [{ key: 's:0', index: 0, linear: true, bytes: null }],
      toc: [],
      destinations: [],
    };
    assert.equal(
      __hnBootstrapTestHooks.validatePublicationModel({
        ...validModel,
        sections: [{ ...validModel.sections[0], key: 's:1', index: 1 }],
      }),
      false,
    );
    assert.equal(
      __hnBootstrapTestHooks.validatePublicationModel({
        ...validModel,
        fixedLayout: true,
        flow: 'paginated',
      }),
      false,
    );
    assert.equal(
      __hnBootstrapTestHooks.validatePublicationModel({
        ...validModel,
        flow: null,
      }),
      false,
    );
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent({
        type: 'dispose',
        protocolVersion: 2,
        session: 'session_C',
        generation: 'generation_C',
        payload: {},
      }),
    );
    await Promise.resolve();
    __hnBootstrapTestHooks.resetProbeState({
      result: 'passed',
      state: 'fresh',
    });
    probeMessages.length = 0;
    nextFoliateBook = {
      dir: 'ltr',
      metadata: { title: 'x'.repeat(1025) },
      sections: [{ linear: 'yes', size: 1 }],
      toc: [],
      resolveHref: async () => undefined,
    };
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent(
        probeCommand('session_model_failure', 'generation_model_failure'),
      ),
    );
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent({
        type: 'open',
        protocolVersion: 2,
        session: 'session_model_failure',
        generation: 'generation_model_failure',
        payload: validOpenPayload,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      probeMessages.map(({ message }) => message.type),
      ['probe-result', 'error'],
    );
    assert.equal(probeMessages.at(-1).message.code, 'model-failure');
    nextFoliateBook = null;
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent({
        type: 'open',
        protocolVersion: 2,
        session: 'session_C',
        generation: 'generation_C',
        payload: validOpenPayload,
      }),
    );
    assert.equal(foliateOpenCalls, 2);
    // 页级阅读入口与正文替换：window 输入绑定发生在 open 期间。
    const pageTurnBindings = [];
    globalThis.window = {
      addEventListener: (type, handler) =>
        pageTurnBindings.push({ type, handler }),
      removeEventListener: (type, handler) => {
        const index = pageTurnBindings.findIndex(
          (entry) => entry.type === type && entry.handler === handler,
        );
        if (index >= 0) pageTurnBindings.splice(index, 1);
      },
    };
    const refreshTarget = new EventTarget();
    nextFoliateBook = {
      dir: 'ltr',
      metadata: { title: 'Refresh book' },
      sections: [{ linear: 'yes', size: 1 }],
      toc: [],
      resolveHref: async () => undefined,
      transformTarget: refreshTarget,
    };
    __hnBootstrapTestHooks.resetProbeState({
      result: 'passed',
      state: 'fresh',
    });
    probeMessages.length = 0;
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent(probeCommand('session_page', 'generation_page')),
    );
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent({
        type: 'open',
        protocolVersion: 2,
        session: 'session_page',
        generation: 'generation_page',
        payload: validOpenPayload,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pageSession = __hnBootstrapTestHooks.getActiveSession();
    assert.equal(__hnBootstrapTestHooks.getProbeState().runtimeState, 'live');
    // meta refresh 必须在 HTML 字符串变成文档 blob 之前被剥掉；其它类型不动。
    const refreshDetail = {
      data: '<html><head><meta http-equiv="refresh" content="0;url=https://example.invalid/"></head><body>x</body></html>',
      type: 'application/xhtml+xml',
    };
    refreshTarget.dispatchEvent(
      new CustomEvent('data', { detail: refreshDetail }),
    );
    assert.equal(/http-equiv/i.test(refreshDetail.data), false);
    const imageDetail = { data: 'PNG-BYTES', type: 'image/png' };
    refreshTarget.dispatchEvent(
      new CustomEvent('data', { detail: imageDetail }),
    );
    assert.equal(imageDetail.data, 'PNG-BYTES');
    // 分页按键逐页推进，滚轮不参与页操作。
    const dispatchWindowEvent = (type, event) => {
      for (const entry of [...pageTurnBindings])
        if (entry.type === type) entry.handler(event);
    };
    let prevented = 0;
    const keyEvent = (key, extra = {}) => ({
      key,
      preventDefault: () => {
        prevented += 1;
      },
      ...extra,
    });
    const waitForPageTurn = () =>
      new Promise((resolve) => setTimeout(resolve, 160));
    dispatchWindowEvent('keydown', keyEvent('ArrowRight'));
    await waitForPageTurn();
    dispatchWindowEvent('keydown', keyEvent('PageUp'));
    await waitForPageTurn();
    dispatchWindowEvent('wheel', {
      deltaY: 120,
      preventDefault: () => {
        prevented += 1;
      },
    });
    await waitForPageTurn();
    assert.deepEqual(pageSession.view.renderer.pageTurns, ['next', 'prev']);
    assert.equal(prevented, 2);
    // 节流防止一次按键爆发排队多页。
    dispatchWindowEvent('keydown', keyEvent('ArrowRight'));
    dispatchWindowEvent('keydown', keyEvent('ArrowRight'));
    await waitForPageTurn();
    // modifier 组合与滚动模式不劫持原生行为。
    const beforeModifier = pageSession.view.renderer.pageTurns.length;
    dispatchWindowEvent('keydown', keyEvent('ArrowRight', { ctrlKey: true }));
    await new Promise((resolve) => setTimeout(resolve, 160));
    pageSession.view.renderer.scrolled = true;
    dispatchWindowEvent('keydown', keyEvent('ArrowRight'));
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.equal(pageSession.view.renderer.pageTurns.length, beforeModifier);
    dispatchWindowEvent('wheel', {
      deltaY: 120,
      preventDefault: () => {
        prevented += 1;
      },
    });
    assert.equal(
      prevented,
      3,
      'scrolled wheel and keys retain native defaults',
    );
    pageSession.view.renderer.scrolled = false;
    // 正文首次 load 之后再次 load = 文档被跳转替换，必须退出 ready。
    assert.deepEqual(
      probeMessages
        .map(({ message }) => message.type)
        .filter((type) => type !== 'page-state'),
      ['probe-result', 'publication-model', 'model', 'ready', 'command-ack'],
    );
    pageSession.view.publicationFrames[0].dispatchEvent(new Event('load'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      probeMessages
        .slice(-1)
        .map(({ message }) => [message.type, message.code]),
      [['error', 'render-failure']],
    );
    assert.equal(
      __hnBootstrapTestHooks.getProbeState().runtimeState,
      'disposed',
    );
    assert.deepEqual(pageTurnBindings, []);
    nextFoliateBook = null;
    globalThis.window = undefined;
    __hnBootstrapTestHooks.resetProbeState({
      result: 'failed',
      state: 'disposed',
    });
    probeMessages.length = 0;
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent(probeCommand('session_E', 'generation_E')),
    );
    assert.deepEqual(probeMessages[0]?.message, {
      type: 'probe-result',
      protocolVersion: 2,
      session: 'session_E',
      generation: 'generation_E',
      passed: false,
    });
    __hnBootstrapTestHooks.resetProbeState({
      result: 'passed',
      state: 'fresh',
    });
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent(probeCommand('session_model', 'generation_model')),
    );
    const originalAnchor = () => undefined;
    const originalResolvedDestination = { index: 2, anchor: originalAnchor };
    const modelSession = {
      session: 'session_model',
      generation: 'generation_model',
      format: 'epub',
      view: {
        isFixedLayout: false,
        renderer: { getAttribute: () => 'scrolled' },
        book: {
          dir: 'rtl',
          metadata: { title: { zh: '  标题  ', en: '  English title  ' } },
          sections: [
            { linear: 'yes', size: 12 },
            { linear: 'no', size: undefined },
            { linear: 'yes', size: 20 },
          ],
          toc: [
            {
              label: 'Root',
              href: '#one',
              subitems: [
                { label: 'Unresolved', href: '#missing', subitems: [] },
                { label: 'Duplicate', href: '#one', subitems: [] },
              ],
            },
          ],
          resolveHref: async (href) =>
            href === '#one' ? originalResolvedDestination : undefined,
        },
      },
      destinationRegistry: null,
      modelSnapshot: null,
    };
    // Model construction uses the same authenticated binding/session state as open.
    __hnBootstrapTestHooks.activateTestSession(modelSession);
    const publicationModel =
      await __hnBootstrapTestHooks.buildPublicationModel(modelSession);
    assert.equal(publicationModel.modelVersion, 1);
    assert.equal(publicationModel.metadata.title, 'English title');
    assert.deepEqual(
      publicationModel.sections.map((section) => section.key),
      ['s:0', 's:1', 's:2'],
    );
    assert.deepEqual(
      publicationModel.sections.map((section) => section.linear),
      [true, false, true],
    );
    assert.equal(publicationModel.destinations.length, 1);
    assert.deepEqual(publicationModel.destinations[0], {
      id: 'd:0',
      sectionKey: 's:2',
      sectionIndex: 2,
    });
    assert.equal(publicationModel.toc[0].destinationId, 'd:0');
    assert.equal(publicationModel.toc[0].subitems[0].destinationId, null);
    assert.equal(publicationModel.toc[0].subitems[1].destinationId, 'd:0');
    assert.equal(Object.isFrozen(publicationModel), true);
    assert.equal(modelSession.destinationRegistry.get('d:0').index, 2);
    originalResolvedDestination.index = 1;
    originalResolvedDestination.anchor = () => 'mutated';
    assert.equal(modelSession.destinationRegistry.get('d:0').index, 2);
    assert.equal(
      modelSession.destinationRegistry.get('d:0').anchor,
      originalAnchor,
    );
    const cycle = { label: 'Cycle', href: '#one', subitems: [] };
    cycle.subitems.push(cycle);
    const cycleSession = {
      ...modelSession,
      destinationRegistry: null,
      modelSnapshot: null,
      view: {
        ...modelSession.view,
        book: { ...modelSession.view.book, toc: [cycle] },
      },
    };
    __hnBootstrapTestHooks.activateTestSession(cycleSession);
    await assert.rejects(
      __hnBootstrapTestHooks.buildPublicationModel(cycleSession),
      /MODEL_LIMIT/,
    );
    const titleLimitSession = {
      ...modelSession,
      destinationRegistry: null,
      modelSnapshot: null,
      view: {
        ...modelSession.view,
        book: {
          ...modelSession.view.book,
          metadata: { title: 'x'.repeat(1025) },
          toc: [],
        },
      },
    };
    __hnBootstrapTestHooks.activateTestSession(titleLimitSession);
    await assert.rejects(
      __hnBootstrapTestHooks.buildPublicationModel(titleLimitSession),
      /MODEL_LIMIT/,
    );
    const lateResolution = deferred();
    const staleResolverSession = {
      ...modelSession,
      destinationRegistry: null,
      modelSnapshot: null,
      view: {
        ...modelSession.view,
        book: {
          ...modelSession.view.book,
          toc: [{ label: 'Late', href: '#late', subitems: [] }],
          resolveHref: () => lateResolution.promise,
        },
      },
    };
    __hnBootstrapTestHooks.activateTestSession(staleResolverSession);
    const staleModel =
      __hnBootstrapTestHooks.buildPublicationModel(staleResolverSession);
    __hnBootstrapTestHooks.resetProbeState({
      result: 'passed',
      state: 'fresh',
    });
    lateResolution.resolve({ index: 0, anchor: () => undefined });
    await assert.rejects(staleModel, /MODEL_STALE/);
    assert.equal(staleResolverSession.destinationRegistry.size, 0);
    const concurrencyDeferred = Array.from({ length: 12 }, () => deferred());
    let concurrentResolvers = 0;
    let maximumConcurrency = 0;
    const concurrencySession = {
      ...modelSession,
      destinationRegistry: null,
      modelSnapshot: null,
      view: {
        ...modelSession.view,
        book: {
          ...modelSession.view.book,
          toc: concurrencyDeferred.map((_, index) => ({
            label: `T${index}`,
            href: `#${index}`,
            subitems: [],
          })),
          resolveHref: (href) => {
            const index = Number(href.slice(1));
            concurrentResolvers += 1;
            maximumConcurrency = Math.max(
              maximumConcurrency,
              concurrentResolvers,
            );
            return concurrencyDeferred[index].promise.finally(() => {
              concurrentResolvers -= 1;
            });
          },
        },
      },
    };
    __hnBootstrapTestHooks.resetProbeState({
      result: 'passed',
      state: 'fresh',
    });
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent(probeCommand('session_model', 'generation_model')),
    );
    __hnBootstrapTestHooks.activateTestSession(concurrencySession);
    const concurrentModel =
      __hnBootstrapTestHooks.buildPublicationModel(concurrencySession);
    await Promise.resolve();
    assert.ok(maximumConcurrency > 1 && maximumConcurrency <= 8);
    for (const [index, item] of concurrencyDeferred.entries()) {
      item.resolve({ index: index % 3, anchor: () => undefined });
    }
    await concurrentModel;
    const totalDeadlineDeferred = deferred();
    const totalDeadlineSession = {
      ...modelSession,
      destinationRegistry: null,
      modelSnapshot: null,
      view: {
        ...modelSession.view,
        book: {
          ...modelSession.view.book,
          toc: [{ label: 'Deadline', href: '#deadline', subitems: [] }],
          resolveHref: () => totalDeadlineDeferred.promise,
        },
      },
    };
    __hnBootstrapTestHooks.resetProbeState({
      result: 'passed',
      state: 'fresh',
    });
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent(probeCommand('session_model', 'generation_model')),
    );
    __hnBootstrapTestHooks.setModelTestTimeouts({ item: 1000, total: 0 });
    __hnBootstrapTestHooks.activateTestSession(totalDeadlineSession);
    const deadlineModel =
      await __hnBootstrapTestHooks.buildPublicationModel(totalDeadlineSession);
    assert.equal(deadlineModel.destinations.length, 0);
    assert.equal(deadlineModel.toc[0].destinationId, null);
    totalDeadlineDeferred.resolve({ index: 0, anchor: () => undefined });
    await Promise.resolve();
    assert.equal(totalDeadlineSession.destinationRegistry.size, 0);
    __hnBootstrapTestHooks.setModelTestTimeouts(null);
    let clock = 0;
    let synchronousResolverCalls = 0;
    const clockDeadlineSession = {
      ...modelSession,
      destinationRegistry: null,
      modelSnapshot: null,
      view: {
        ...modelSession.view,
        book: {
          ...modelSession.view.book,
          toc: Array.from({ length: 100 }, (_, index) => ({
            label: `Clock ${index}`,
            href: `#clock-${index}`,
            subitems: [],
          })),
          resolveHref: () => {
            synchronousResolverCalls += 1;
            clock += 1;
            return { index: 0, anchor: () => undefined };
          },
        },
      },
    };
    __hnBootstrapTestHooks.resetProbeState({
      result: 'passed',
      state: 'fresh',
    });
    __hnBootstrapTestHooks.receiveMessage(
      probeEvent(probeCommand('session_model', 'generation_model')),
    );
    __hnBootstrapTestHooks.setModelTestTimeouts({ item: 1000, total: 5 });
    __hnBootstrapTestHooks.setModelTestClock({ now: () => clock });
    __hnBootstrapTestHooks.activateTestSession(clockDeadlineSession);
    const clockDeadlineModel =
      await __hnBootstrapTestHooks.buildPublicationModel(clockDeadlineSession);
    assert.equal(synchronousResolverCalls, 5);
    assert.equal(clockDeadlineModel.destinations.length, 0);
    assert.ok(
      clockDeadlineModel.toc.every(
        ({ destinationId }) => destinationId === null,
      ),
    );
    assert.equal(clockDeadlineSession.destinationRegistry.size, 0);
    __hnBootstrapTestHooks.setModelTestClock(null);
    __hnBootstrapTestHooks.setModelTestTimeouts(null);
    let closeCalls = 0;
    const finalSession = {
      view: {
        renderer: neverSettlingPaginator,
        book: generatedComic,
        close: () => {
          closeCalls += 1;
        },
      },
      engineFinalized: false,
      closeAttempted: false,
      finalizedBooks: new WeakSet(),
      finalizedRenderers: new WeakSet(),
    };
    await __hnBootstrapTestHooks.finalizeEngine(finalSession);
    await __hnBootstrapTestHooks.finalizeEngine(finalSession);
    assert.equal(closeCalls, 1);
    assert.equal(neverSettlingInvalidates, 1);
    assert.equal(neverSettlingRendererDestroys, 1);
    assert.equal(publicComicDestroyCalls, 1);
    globalThis.URL = originalUrl;
    assert.ok(manifest.assets.some((asset) => asset.path === 'comic-book.js'));
    assert.ok(
      manifest.assets.some((asset) => asset.path === 'LICENSES/fflate-MIT.txt'),
    );
    assert.ok(
      manifest.assets.some(
        (asset) => asset.path === 'LICENSES/zip.js-BSD-3-Clause.txt',
      ),
    );
    assert.equal(
      await readFile(
        path.join(
          packageRoot,
          FOLIATE_RUNTIME_DIRECTORY,
          'LICENSES/fflate-MIT.txt',
        ),
        'utf8',
      ),
      FFLATE_LICENSE,
    );
    assert.equal(
      await readFile(
        path.join(
          packageRoot,
          FOLIATE_RUNTIME_DIRECTORY,
          'LICENSES/zip.js-BSD-3-Clause.txt',
        ),
        'utf8',
      ),
      ZIP_JS_LICENSE,
    );
    assert.ok(
      manifest.assets.every(
        (asset) =>
          !/(^|\/)(pdf\.js|pdfjs|cmaps|standard_fonts)(\/|$)/i.test(asset.path),
      ),
    );
    const stagedView = await readFile(
      path.join(packageRoot, FOLIATE_RUNTIME_DIRECTORY, 'view.js'),
      'utf8',
    );
    assert.ok(!stagedView.includes("import('./pdf.js')"));
    for (const forbidden of [
      "import('./search.js')",
      "import('./tts.js')",
      'textWalker',
      '#searchResults',
      '#searchDraw',
      '#searchDrawOptions',
      'initTTS',
    ]) {
      assert.ok(!stagedView.includes(forbidden));
    }
    await stageFoliateRuntime(options);
    assert.equal(await readFile(manifestPath, 'utf8'), firstManifest);
    assert.equal(await readFile(webManifestPath, 'utf8'), firstWebManifest);
    await stageFoliateRuntime({ ...options, check: true });
    await writeFile(path.join(webRuntimeRoot, 'bootstrap.js'), 'tampered');
    await assert.rejects(
      () => stageFoliateRuntime({ ...options, check: true }),
      (error) =>
        error.message.includes(
          'Foliate runtime stage differs for web/bootstrap.js',
        ),
    );
  });
});

// 窄结构回归：vendor foliate-view 无 :host 尺寸，host 文档必须静态声明
// html/body/foliate-view 的视口尺寸链，否则 paginator 高度坍缩为 0 并裁剪正文。
test('web reader host document pins a static foliate-view layout', async () => {
  await withTemporaryPackage(async ({ root, packageRoot }) => {
    await stageFoliateRuntime({
      workspace: root,
      packageRoot,
      sourceRoot,
      validateFn: async () => undefined,
    });
    const readerHtml = await readFile(
      path.join(packageRoot, FOLIATE_RUNTIME_DIRECTORY, 'web', 'reader.html'),
      'utf8',
    );
    const styleBlock = /<style>([\s\S]*?)<\/style>/.exec(readerHtml)?.[1];
    assert.ok(styleBlock, 'web reader.html must carry a static host style');
    // html/body 视口尺寸链：margin 0 + 宽高 100%。
    assert.match(styleBlock, /html,\s*\n?\s*body\s*\{[^}]*margin:\s*0/);
    assert.match(styleBlock, /html,\s*\n?\s*body\s*\{[^}]*width:\s*100%/);
    assert.match(styleBlock, /html,\s*\n?\s*body\s*\{[^}]*height:\s*100%/);
    // 约束 overflow：滚动不逃出 reader，host 文档自身不滚动。
    assert.match(styleBlock, /body\s*\{[^}]*overflow:\s*hidden/);
    // foliate-view 必须是占满 host 的块级盒子。
    assert.match(styleBlock, /foliate-view\s*\{[^}]*display:\s*block/);
    assert.match(styleBlock, /foliate-view\s*\{[^}]*width:\s*100%/);
    assert.match(styleBlock, /foliate-view\s*\{[^}]*height:\s*100%/);
    // 样式必须是静态的：host 文档不得出现元素级 inline style 或脚本化样式。
    assert.doesNotMatch(readerHtml, /\sstyle=/);
    assert.doesNotMatch(readerHtml, /<link\s/i);
    // CSP meta 仍需先于样式与 bootstrap 脚本生效。
    assert.ok(
      readerHtml.indexOf('http-equiv="Content-Security-Policy"') <
        readerHtml.indexOf('<style>'),
      'host CSP must precede the static style block',
    );
    assert.ok(
      readerHtml.indexOf('<style>') <
        readerHtml.indexOf(
          '<script type="module" src="./bootstrap.js"></script>',
        ),
      'static layout style must precede the bootstrap module',
    );
  });
});

const importPattern =
  /(?:import\s*(?:[^'"()]+?\s+from\s*)?|import\()['"](\.[^'"]+)['"]/g;

async function stagedModuleClosure(root, relativePath, visited = new Set()) {
  if (visited.has(relativePath)) return visited;
  visited.add(relativePath);
  const source = await readFile(path.join(root, relativePath), 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const imported = path.posix.normalize(
      path.posix.join(path.posix.dirname(relativePath), match[1]),
    );
    assert.ok(
      !imported.startsWith('../'),
      `Import escapes runtime stage: ${imported}`,
    );
    await readFile(path.join(root, imported));
    await stagedModuleClosure(root, imported, visited);
  }
  return visited;
}

test('staged Foliate module graph resolves without out-of-scope modules', async () => {
  await withTemporaryPackage(async ({ root, packageRoot }) => {
    await stageFoliateRuntime({
      workspace: root,
      packageRoot,
      sourceRoot,
      validateFn: async () => undefined,
    });
    const runtimeRoot = path.join(packageRoot, FOLIATE_RUNTIME_DIRECTORY);
    const closure = await stagedModuleClosure(runtimeRoot, 'view.js');
    assert.deepEqual([...closure].sort(), [
      'comic-book.js',
      'epub.js',
      'epubcfi.js',
      'fb2.js',
      'fixed-layout.js',
      'mobi.js',
      'overlayer.js',
      'paginator.js',
      'progress.js',
      'vendor/fflate.js',
      'vendor/zip.js',
      'view.js',
    ]);
    const definitions = new Map();
    globalThis.HTMLElement = class HTMLElement {};
    globalThis.customElements = {
      define(name, elementClass) {
        definitions.set(name, elementClass);
      },
    };
    await import(
      `${pathToFileURL(path.join(runtimeRoot, 'view.js')).href}?smoke=1`
    );
    assert.equal(typeof definitions.get('foliate-view'), 'function');
    const webClosure = await stagedModuleClosure(
      path.join(runtimeRoot, 'web'),
      'bootstrap.js',
    );
    assert.deepEqual([...webClosure].sort(), [
      'bootstrap.js',
      'foliate/comic-book.js',
      'foliate/epub.js',
      'foliate/epubcfi.js',
      'foliate/fb2.js',
      'foliate/fixed-layout.js',
      'foliate/mobi.js',
      'foliate/overlayer.js',
      'foliate/paginator.js',
      'foliate/progress.js',
      'foliate/vendor/fflate.js',
      'foliate/vendor/zip.js',
      'foliate/view.js',
    ]);
  });
});

test('stages a closed, reproducible native Foliate host runtime', async () => {
  await withTemporaryPackage(async ({ root, packageRoot }) => {
    const nativeRoot = path.join(
      packageRoot,
      FOLIATE_RUNTIME_DIRECTORY,
      FOLIATE_NATIVE_RUNTIME_DIRECTORY,
    );
    const options = {
      workspace: root,
      packageRoot,
      sourceRoot,
      validateFn: async () => undefined,
    };

    // A normal stage must replace both a missing runtime and an obsolete
    // host-only bootstrap/manifest pair rather than relying on --check.
    await mkdir(nativeRoot, { recursive: true });
    await writeFile(path.join(nativeRoot, 'bootstrap.js'), 'export {}\n');
    await writeFile(
      path.join(nativeRoot, FOLIATE_NATIVE_RUNTIME_MANIFEST),
      '{"assets":[]}\n',
    );
    await stageFoliateRuntime(options);
    const manifestPath = path.join(nativeRoot, FOLIATE_NATIVE_RUNTIME_MANIFEST);
    const firstManifest = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(firstManifest);
    assert.deepEqual(
      {
        schemaVersion: manifest.schemaVersion,
        runtime: manifest.runtime,
        hostVersion: manifest.hostVersion,
        targetPlatforms: manifest.targetPlatforms,
        source: manifest.source,
      },
      {
        schemaVersion: 1,
        runtime: 'foliate-native-host',
        hostVersion: FOLIATE_NATIVE_HOST_VERSION,
        targetPlatforms: ['android', 'ios'],
        source: {
          commit: FOLIATE_COMMIT_SHA,
          repository: FOLIATE_UPSTREAM_URL,
        },
      },
    );
    for (const asset of manifest.assets) {
      const contents = await readFile(path.join(nativeRoot, asset.path));
      assert.equal(
        createHash('sha256').update(contents).digest('hex'),
        asset.sha256,
        `Native manifest SHA-256 must match ${asset.path}`,
      );
      assert.equal(
        contents.length,
        asset.size,
        `Native manifest size must match ${asset.path}`,
      );
    }
    assert.deepEqual(manifest.notices, [
      { path: 'foliate/LICENSE', license: 'MIT', appliesTo: 'foliate/**' },
      {
        path: 'notices/fflate-MIT.txt',
        license: 'MIT',
        appliesTo: 'foliate/vendor/fflate.js',
      },
      {
        path: 'notices/zip.js-BSD-3-Clause.txt',
        license: 'BSD-3-Clause',
        appliesTo: 'foliate/vendor/zip.js',
      },
    ]);
    for (const required of [
      'reader.html',
      'bootstrap.js',
      'probes/csp-1x1.png',
      'probes/csp-external-canary.js',
      'foliate/LICENSE',
      'notices/fflate-MIT.txt',
      'notices/zip.js-BSD-3-Clause.txt',
    ]) {
      assert.ok(
        manifest.assets.some((asset) => asset.path === required),
        `Native runtime is missing ${required}`,
      );
    }
    assert.ok(
      manifest.assets.every(
        (asset) =>
          /^[a-f0-9]{64}$/.test(asset.sha256) &&
          Number.isSafeInteger(asset.size) &&
          typeof asset.source === 'string' &&
          typeof asset.category === 'string' &&
          typeof asset.license === 'string' &&
          /^(?:[-\w.+/]+; charset=utf-8|image\/png)$/.test(asset.mimeType),
      ),
    );
    const nativeProbeAssets = new Map(
      manifest.assets.map((asset) => [asset.path, asset]),
    );
    assert.deepEqual(nativeProbeAssets.get('probes/csp-1x1.png'), {
      path: 'probes/csp-1x1.png',
      sha256:
        '74ea8cc007d1134250692981ea7b50b7979ac712c7e95309dcf606d6f97e4e8b',
      size: 70,
      source: 'generated:foliate-native-csp-probe-png-v1',
      category: 'csp-probe-image',
      license: 'CC0-1.0',
      mimeType: 'image/png',
    });
    assert.deepEqual(nativeProbeAssets.get('probes/csp-external-canary.js'), {
      path: 'probes/csp-external-canary.js',
      sha256:
        '77311ffaf0cb6748785d6259257acb11c745a63d478132866413ad32ca6fd09a',
      size: 286,
      source: 'generated:foliate-native-csp-probe-external-canary-v1',
      category: 'csp-probe-script',
      license: 'MIT',
      mimeType: 'text/javascript; charset=utf-8',
    });
    assert.equal(
      (await readFile(path.join(nativeRoot, 'probes', 'csp-1x1.png'))).toString(
        'base64',
      ),
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL3EgAAAABJRU5ErkJggg==',
    );
    const nativeCanary = await readFile(
      path.join(nativeRoot, 'probes', 'csp-external-canary.js'),
      'utf8',
    );
    assert.match(
      nativeCanary,
      /document\.currentScript\?\.dataset\.hnCspProbeToken/,
    );
    assert.doesNotMatch(nativeCanary, /(?:fetch\s*\(|import\s*\(|eval\s*\()/);
    assert.ok(
      manifest.assets.every(
        (asset) =>
          !/(^|\/)(pdf\.js|pdfjs|cmaps|standard_fonts|search\.js|tts\.js|text-walker\.js)(\/|$)/i.test(
            asset.path,
          ),
      ),
    );
    const readerHtml = await readFile(
      path.join(nativeRoot, 'reader.html'),
      'utf8',
    );
    assert.match(readerHtml, /hn-foliate-native-host-version/);
    assert.match(
      readerHtml,
      /Private host exposes no page-world publication capability/,
    );
    assert.ok(
      readerHtml.indexOf('Content-Security-Policy') <
        readerHtml.indexOf('<script type="module" src="./bootstrap.js">'),
    );
    const nativeBootstrap = await readFile(
      path.join(nativeRoot, 'bootstrap.js'),
      'utf8',
    );
    assert.match(
      nativeBootstrap,
      /export function installFoliateNativeHostBridge\(port\) \{/,
    );
    assert.doesNotMatch(
      nativeBootstrap,
      /\b(?:ReactNativeWebView|window|webkit|messageHandlers|parent|globalThis)\s*(?:\.|\[)|addJavascriptInterface/,
    );
    const closure = await stagedModuleClosure(nativeRoot, 'bootstrap.js');
    for (const required of [
      'renderer.js',
      'nativeFoliateProtocol.js',
      'nativePublicationTransfer.js',
      'publicationFormats.js',
      'foliate/view.js',
    ])
      assert.ok(closure.has(required));
    // Exercise the real generated parser/ledger/installer. This unit seam keeps
    // DOM rendering absent; browser E2E separately runs the staged native renderer.
    const modules = {};
    for (const name of [
      'bootstrap',
      'nativeFoliateProtocol',
      'nativePublicationTransfer',
      'publicationFormats',
    ]) {
      const source = await readFile(
        path.join(nativeRoot, name + '.js'),
        'utf8',
      );
      modules['./' + name + '.js'] = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText;
    }
    const bootstrap = `const moduleSources = ${JSON.stringify(modules)};
      const cache = {'./renderer.js': {installNativeRenderer: () => () => undefined}};
      function load(name) {
        if (cache[name]) return cache[name];
        const module = { exports: {} }; cache[name] = module.exports;
        new Function('require', 'module', 'exports', moduleSources[name])(load, module, module.exports);
        return module.exports;
      }
      const {installFoliateNativeHostBridge} = load('./bootstrap.js');`;
    const context = vm.createContext({
      TextEncoder,
    });
    vm.runInContext(
      `${bootstrap.replace(/export const /g, 'const ').replace(/export function /g, 'function ')}\nglobalThis.exports = { installFoliateNativeHostBridge };`,
      context,
    );
    const sent = [];
    const listeners = new Set();
    const port = {
      postMessage: (data) => sent.push(JSON.parse(data)),
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
      start: () => undefined,
      close: () => {
        port.closed = true;
      },
    };
    const emit = (data) => {
      for (const listener of listeners) listener({ data });
    };
    const nativeCommand = (type, payload = {}, commandId = 0) =>
      JSON.stringify({
        protocol: 'hn-foliate-host',
        version: 1,
        direction: 'native-to-host',
        type,
        session: 'A'.repeat(43),
        generation: 'G'.repeat(43),
        commandId: ['z', 'a', 'm', 'b'][commandId].repeat(43),
        payload,
      });
    assert.equal(context.exports.installFoliateNativeHostBridge(port), true);
    assert.equal(context.exports.installFoliateNativeHostBridge(port), false);
    assert.equal(
      listeners.size,
      1,
      'no messages are processed before private install',
    );
    emit(nativeCommand('bind'));
    assert.deepEqual(sent, [
      {
        protocol: 'hn-foliate-host',
        version: 1,
        direction: 'host-to-native',
        type: 'ack',
        session: 'A'.repeat(43),
        generation: 'G'.repeat(43),
        commandId: 'z'.repeat(43),
        payload: { command: 'bind', status: 'bridge-bound' },
      },
    ]);
    emit(nativeCommand('navigate', { target: 'd:7' }, 1));
    emit(nativeCommand('flow', { flow: 'scrolled' }, 2));
    assert.deepEqual(
      sent.slice(1).map((message) => message.payload),
      [
        { command: 'navigate', status: 'not-ready' },
        { command: 'flow', status: 'not-ready' },
      ],
    );
    emit(nativeCommand('bind', {}, 3));
    assert.equal(port.closed, true, 'a second bind is terminal');
    assert.equal(
      listeners.size,
      0,
      'terminal violation tears down the private port',
    );
    assert.deepEqual(sent.at(-1).payload, {
      code: 'protocol-violation',
      terminal: true,
    });
    const sequenceContext = vm.createContext({
      TextEncoder,
    });
    vm.runInContext(
      `${bootstrap.replace(/export const /g, 'const ').replace(/export function /g, 'function ')}\nglobalThis.exports = { installFoliateNativeHostBridge };`,
      sequenceContext,
    );
    const sequenceSent = [];
    const sequencePort = {
      postMessage: (data) => sequenceSent.push(JSON.parse(data)),
      addEventListener: (_type, listener) => {
        sequencePort.listener = listener;
      },
      removeEventListener: () => undefined,
      close: () => {
        sequencePort.closed = true;
      },
    };
    assert.equal(
      sequenceContext.exports.installFoliateNativeHostBridge(sequencePort),
      true,
    );
    sequencePort.listener({
      data: nativeCommand('navigate', { target: 0 }, 1),
    });
    assert.equal(sequencePort.closed, true, 'initial command must be bind');

    const staleContext = vm.createContext({
      TextEncoder,
    });
    vm.runInContext(
      `${bootstrap.replace(/export const /g, 'const ').replace(/export function /g, 'function ')}\nglobalThis.exports = { installFoliateNativeHostBridge };`,
      staleContext,
    );
    const staleSent = [];
    const stalePort = {
      postMessage: (data) => staleSent.push(JSON.parse(data)),
      addEventListener: (_type, listener) => {
        stalePort.listener = listener;
      },
      removeEventListener: () => undefined,
      close: () => {
        stalePort.closed = true;
      },
    };
    assert.equal(
      staleContext.exports.installFoliateNativeHostBridge(stalePort),
      true,
    );
    stalePort.listener({ data: nativeCommand('bind') });
    stalePort.listener({
      data: nativeCommand('navigate', { target: 0 }, 1).replace(
        '"session":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"',
        '"session":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"',
      ),
    });
    stalePort.listener({ data: nativeCommand('navigate', { target: 0 }, 1) });
    stalePort.listener({ data: nativeCommand('navigate', { target: 0 }, 1) });
    assert.equal(
      stalePort.closed,
      undefined,
      'stale and duplicate commands are inert',
    );
    assert.deepEqual(
      staleSent.map((message) => message.commandId),
      ['z'.repeat(43), 'a'.repeat(43)],
    );
    const duplicateContext = vm.createContext({
      TextEncoder,
    });
    vm.runInContext(
      `${bootstrap.replace(/export const /g, 'const ').replace(/export function /g, 'function ')}\nglobalThis.exports = { installFoliateNativeHostBridge };`,
      duplicateContext,
    );
    const duplicateSent = [];
    const duplicatePort = {
      postMessage: (data) => duplicateSent.push(JSON.parse(data)),
      addEventListener: (_type, listener) => {
        duplicatePort.listener = listener;
      },
      removeEventListener: () => undefined,
      close: () => {
        duplicatePort.closed = true;
      },
    };
    assert.equal(
      duplicateContext.exports.installFoliateNativeHostBridge(duplicatePort),
      true,
    );
    duplicatePort.listener({ data: nativeCommand('bind') });
    duplicatePort.listener({
      data: nativeCommand('bind').replace(
        '"protocol":"hn-foliate-host",',
        '"protocol":"hn-foliate-host","protocol":"hn-foliate-host",',
      ),
    });
    assert.equal(duplicatePort.closed, true, 'duplicate JSON key is terminal');
    assert.deepEqual(duplicateSent.at(-1).payload, {
      code: 'protocol-violation',
      terminal: true,
    });
    const corpus = JSON.parse(
      await readFile(foliateHostWireCorpusPath, 'utf8'),
    );
    for (const entry of corpus.identityCases.filter(
      (entry) => entry.direction === 'native-to-host',
    )) {
      const identityContext = vm.createContext({
        TextEncoder,
      });
      vm.runInContext(
        `${bootstrap.replace(/export const /g, 'const ').replace(/export function /g, 'function ')}\nglobalThis.exports = { installFoliateNativeHostBridge };`,
        identityContext,
      );
      const received = [];
      const port = {
        postMessage: (data) => received.push(JSON.parse(data)),
        addEventListener: (_type, listener) => {
          port.listener = listener;
        },
        removeEventListener: () => undefined,
        close: () => {
          port.closed = true;
        },
      };
      identityContext.exports.installFoliateNativeHostBridge(port);
      port.listener({
        data: corpus.cases.find((item) => item.id === 'valid-bind').wire,
      });
      port.listener({ data: entry.wire });
      assert.equal(Boolean(port.closed), entry.expect === 'terminal', entry.id);
      assert.equal(
        received.length,
        entry.expect === 'terminal' ? 2 : 1,
        entry.id,
      );
      if (entry.expect === 'no-op') {
        port.listener({
          data: corpus.cases.find((item) => item.id === 'valid-flow').wire,
        });
        assert.equal(received.at(-1).payload.status, 'not-ready', entry.id);
      }
    }
    const malformedIntegers = corpus.cases.filter((entry) =>
      [
        'invalid-fraction',
        'invalid-exponent',
        'invalid-leading-zero',
        'invalid-negative',
        'invalid-unsafe-integer',
      ].includes(entry.id),
    );
    assert.equal(malformedIntegers.length, 5);
    for (const entry of malformedIntegers) {
      const integerContext = vm.createContext({
        TextEncoder,
      });
      vm.runInContext(
        `${bootstrap.replace(/export const /g, 'const ').replace(/export function /g, 'function ')}\nglobalThis.exports = { installFoliateNativeHostBridge };`,
        integerContext,
      );
      const integerPort = {
        postMessage: () => undefined,
        addEventListener: (_type, listener) => {
          integerPort.listener = listener;
        },
        removeEventListener: () => undefined,
        close: () => {
          integerPort.closed = true;
        },
      };
      assert.equal(
        integerContext.exports.installFoliateNativeHostBridge(integerPort),
        true,
      );
      integerPort.listener({ data: entry.wire });
      assert.equal(integerPort.closed, true, `${entry.id} must fail closed`);
    }
    await stageFoliateRuntime(options);
    assert.equal(await readFile(manifestPath, 'utf8'), firstManifest);
    await stageFoliateRuntime({ ...options, check: true });

    await writeFile(path.join(nativeRoot, 'unlisted.js'), 'export {};\n');
    await assert.rejects(
      () => stageFoliateRuntime({ ...options, check: true }),
      /Foliate runtime stage has a different asset list/,
    );
    await stageFoliateRuntime(options);

    await rm(path.join(nativeRoot, 'bootstrap.js'));
    await assert.rejects(
      () => stageFoliateRuntime({ ...options, check: true }),
      /Foliate runtime stage has a different asset list/,
    );
    await stageFoliateRuntime(options);

    // An excluded module cannot be smuggled into the package-private host tree.
    await writeFile(path.join(nativeRoot, 'foliate', 'pdf.js'), 'export {};\n');
    await assert.rejects(
      () => stageFoliateRuntime({ ...options, check: true }),
      /Foliate runtime stage has a different asset list/,
    );
  });
});

async function createUninitializedWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'foliate-gate-test-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'user.name', 'Foliate gate test']);
  await writeFile(
    path.join(root, '.gitmodules'),
    `[submodule "vendor/foliate-js"]\n\tpath = ${FOLIATE_SUBMODULE_PATH}\n\turl = ${FOLIATE_UPSTREAM_URL}\n`,
  );
  const reviewPath = path.join(root, REVISION_REVIEW_PATH);
  await mkdir(path.dirname(reviewPath), { recursive: true });
  await writeFile(
    reviewPath,
    await readFile(path.join(projectRoot, REVISION_REVIEW_PATH)),
  );
  git(root, ['add', '.gitmodules', REVISION_REVIEW_PATH]);
  git(root, ['commit', '--quiet', '-m', 'Add Foliate review metadata']);
  git(root, [
    'update-index',
    '--add',
    '--cacheinfo',
    `160000,${FOLIATE_COMMIT_SHA},${FOLIATE_SUBMODULE_PATH}`,
  ]);
  git(root, ['commit', '--quiet', '-m', 'Add uninitialized Foliate gitlink']);
  return root;
}

test('fails the gate before running an engine-dependent command when uninitialized', async () => {
  const workspace = await createUninitializedWorkspace();
  let commandRan = false;
  try {
    await assert.rejects(
      () =>
        runFoliateGated({
          workspace,
          command: 'node',
          args: ['-e', 'process.exit(0)'],
          runFn: () => {
            commandRan = true;
            return { status: 0 };
          },
        }),
      (error) => error.message.includes(BOOTSTRAP_HINT),
    );
    assert.equal(commandRan, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
