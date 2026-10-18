let nativeEventSink = null;
import './foliate/view.js';

// Chromium-only compatibility authorization; behavioral proof is opt-in.
const FOLIATE_HOST_CSP = "default-src 'none'; script-src 'self'; style-src 'self' blob: 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; media-src 'self' blob: data:; frame-src blob:; worker-src 'none'; connect-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
export const FOLIATE_IFRAME_PROTOCOL_VERSION = 1;
export const FOLIATE_IFRAME_COMMAND_TYPES = Object.freeze(['probe', 'open', 'dispose', 'navigate', 'flow']);
export const FOLIATE_IFRAME_EVENT_TYPES = Object.freeze(['probe-result', 'publication-model', 'ready', 'model', 'location', 'error', 'command-ack']);
export const FOLIATE_PUBLICATION_CSP_VERSION = "foliate-publication-csp-2";
export const FOLIATE_PUBLICATION_CSP = "default-src 'none'; script-src 'none'; style-src blob: data: 'unsafe-inline'; img-src blob: data:; font-src blob: data:; media-src blob: data:; frame-src 'none'; worker-src 'none'; connect-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
export const FOLIATE_RUNTIME_STATES = Object.freeze(['fresh', 'probing', 'opening', 'live', 'disposing', 'disposed']);

const MAX_PUBLICATION_BYTES = 32 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 1000;
const PROBE_STATIC_MARKER = 'hn-csp-probe-v1';
const FOLIATE_PUBLICATION_IFRAME_SANDBOX = 'allow-same-origin allow-scripts';
const NAVIGATION_TIMEOUT_MS = 3000;
const MODEL_RESOLUTION_TIMEOUT_MS = 3000;
const MODEL_TOTAL_DEADLINE_MS = 10000;
const MAX_MODEL_SECTIONS = 10000;
const MAX_MODEL_TOC_NODES = 10000;
const MAX_MODEL_TOC_DEPTH = 32;
const MAX_MODEL_TITLE_LENGTH = 1024;
const MAX_MODEL_LABEL_LENGTH = 2048;
const MAX_MODEL_HREF_LENGTH = 8192;
const MAX_MODEL_UTF8_BYTES = 2 * 1024 * 1024;
const MODEL_RESOLUTION_CONCURRENCY = 8;
const FORMAT_TUPLES = Object.freeze({
  epub: Object.freeze({ name: 'book.epub', mimeType: 'application/epub+zip' }),
  mobi: Object.freeze({ name: 'book.mobi', mimeType: 'application/x-mobipocket-ebook' }),
  'kf8-azw3': Object.freeze({ name: 'book.azw3', mimeType: 'application/vnd.amazon.ebook' }),
  fb2: Object.freeze({ name: 'book.fb2', mimeType: 'application/x-fictionbook+xml' }),
  fbz: Object.freeze({ name: 'book.fbz', mimeType: 'application/x-zip-compressed-fb2' }),
  cbz: Object.freeze({ name: 'book.cbz', mimeType: 'application/vnd.comicbook+zip' }),
});

let runtimeState = 'fresh';
let probeResult = 'pending';
let sourceAuthorized = false;
let probeBinding = null;
let activeSession = null;
let modelTestTimeouts = null;
let modelTestClock = null;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOnlyKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const isToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const isPrivateBlob = value => value instanceof Blob && value.size > 0 && value.size <= MAX_PUBLICATION_BYTES;
const isPrimitive = value => value === null || ['string', 'number', 'boolean'].includes(typeof value);
const isReadableSection = (view, index) => {
  if (!Number.isInteger(index) || index < 0) return false;
  const section = view.book?.sections?.[index];
  return section != null && section.linear !== 'no';
};
const current = session => activeSession === session && runtimeState !== 'disposing' && runtimeState !== 'disposed';
const modelNow = () => modelTestClock?.now?.() ?? Date.now();

// meta refresh 在文档解析时就会排队跳转，文档 load 之后再清理已经太晚：正文
// 会被替换成 chrome-error，界面却仍显示 ready。这里在 HTML 字符串变成文档
// blob 之前剥掉 refresh（EPUB 与 MOBI/KF8 的 data transform 阶段）。
const PUBLICATION_HTML_TYPES = Object.freeze(['text/html', 'application/xhtml+xml']);
const PUBLICATION_REFRESH_META = /<meta\b[^>]*\bhttp-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)[^>]*>/gi;
const stripPublicationRefreshMeta = value =>
  typeof value === 'string' ? value.replace(PUBLICATION_REFRESH_META, '') : value;
function installPublicationTransform(book) {
  const target = book?.transformTarget;
  if (!target?.addEventListener) return;
  target.addEventListener('data', event => {
    const detail = event?.detail;
    if (!detail) return;
    const type = String(detail.type ?? '').split(';')[0].trim().toLowerCase();
    if (!PUBLICATION_HTML_TYPES.includes(type)) return;
    const data = detail.data;
    detail.data = typeof data?.then === 'function'
      ? data.then(stripPublicationRefreshMeta)
      : stripPublicationRefreshMeta(data);
  });
}

// 兜底：没有 data transform 钩子的格式（如 FB2）在文档 load 后移除 refresh。
function removePublicationRefreshMetas(doc) {
  doc?.querySelectorAll?.('meta[http-equiv]')?.forEach(node => {
    if (String(node.getAttribute?.('http-equiv') ?? '').trim().toLowerCase() === 'refresh') node.remove?.();
  });
}

// 分页模式下的页级翻页。renderer.next()/prev() 在同章内逐页推进，并在本章
// 最后一页进入相邻 spine section；章节导航仍由 host 的 navigate 命令负责。
const PAGE_TURN_KEYS = Object.freeze({
  ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1, Spacebar: 1,
  ArrowLeft: -1, ArrowUp: -1, PageUp: -1,
});
const PAGE_TURN_THROTTLE_MS = 150;
function pageTurnDirection(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(PAGE_TURN_KEYS, key)
    ? PAGE_TURN_KEYS[key]
    : 0;
}
function terminalFailure(session, code) {
  if (!current(session) || session.terminalFailure) return;
  session.terminalFailure = true;
  sendError(session.session, session.generation, code);
  dispose(session);
}
function turnPage(session, direction) {
  if (!current(session) || runtimeState !== 'live') return false;
  const renderer = session.view?.renderer;
  if (!renderer?.next || !renderer?.prev) return false;
  if (session.pageTurnInFlight || session.navigationInFlight || session.pendingNavigation) return false;
  const now = Date.now();
  if (now - (session.lastPageTurnAt ?? 0) < PAGE_TURN_THROTTLE_MS) return false;
  session.lastPageTurnAt = now;
  session.pageTurnInFlight = true;
  try {
    Promise.resolve(direction > 0 ? renderer.next() : renderer.prev())
      .catch(() => terminalFailure(session, 'render-failure'))
      .finally(() => {
        session.pageTurnInFlight = false;
      });
  } catch {
    session.pageTurnInFlight = false;
    terminalFailure(session, 'render-failure');
    return false;
  }
  return true;
}
function onPageTurnKey(session, event) {
  if (event?.defaultPrevented || event?.metaKey || event?.ctrlKey || event?.altKey) return;
  const direction = pageTurnDirection(event?.key);
  if (!direction) return;
  // 滚动模式保留浏览器/渲染器原生的滚动与按键行为。
  if (session.view?.renderer?.scrolled) return;
  if (turnPage(session, direction)) event.preventDefault?.();
}
function onPageTurnWheel(session, event) {
  if (event?.defaultPrevented || event?.ctrlKey || event?.metaKey) return;
  if (session.view?.renderer?.scrolled) return;
  const delta = Number(event?.deltaY ?? 0);
  if (!Number.isFinite(delta) || Math.abs(delta) < 4) return;
  if (turnPage(session, delta > 0 ? 1 : -1)) event.preventDefault?.();
}
function bindPageTurnInput(session) {
  if (session.pageTurnBound || typeof window?.addEventListener !== 'function') return;
  session.pageTurnBound = true;
  session.onPageTurnKey = event => onPageTurnKey(session, event);
  session.onPageTurnWheel = event => onPageTurnWheel(session, event);
  window.addEventListener('keydown', session.onPageTurnKey, true);
  window.addEventListener('wheel', session.onPageTurnWheel, { capture: true, passive: false });
}
function unbindPageTurnInput(session) {
  if (!session.pageTurnBound || typeof window?.removeEventListener !== 'function') return;
  session.pageTurnBound = false;
  window.removeEventListener('keydown', session.onPageTurnKey, true);
  window.removeEventListener('wheel', session.onPageTurnWheel, true);
}

// 正文首次 load 之后再出现 load/error，只可能是文档被跳转替换或加载失败。
function observePublicationFrame(session, doc) {
  const frame = doc?.defaultView?.frameElement;
  if (!frame?.addEventListener) return;
  const onLost = () => terminalFailure(session, 'render-failure');
  frame.addEventListener('load', onLost, { once: true });
  frame.addEventListener('error', onLost, { once: true });
  if (session.pageTurnBound) {
    doc.addEventListener?.('keydown', session.onPageTurnKey, true);
    doc.addEventListener?.('wheel', session.onPageTurnWheel, { capture: true, passive: false });
  }
}
function sectionIndexFromDetail(detail) {
  const index = Number.isInteger(detail?.section?.current)
    ? detail.section.current
    : detail?.index;
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

function send(type, session, generation, detail = {}) {
  const eventKeys = {
    'probe-result': ['passed'], ready: [], model: ['fixedLayout', 'flow'], location: ['index', 'cfi', 'fraction'],
    error: ['code'], 'command-ack': ['command'],
  };
  if (type === 'publication-model') {
    if (!hasOnlyKeys(detail, ['model']) || !validatePublicationModel(detail.model)) {
      throw new TypeError('Publication model DTO does not match its closed schema');
    }
    nativeEventSink?.({ type, protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION, session, generation, ...detail });
    return;
  }
  if (!eventKeys[type] || !hasOnlyKeys(detail, eventKeys[type]) || !Object.values(detail).every(isPrimitive)) {
    throw new TypeError('Bridge event DTO must match its closed primitive schema');
  }
  nativeEventSink?.({ type, protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION, session, generation, ...detail });
}
function sendError(session, generation, code) { send('error', session, generation, { code }); }
function sendProbeResult(binding, passed) {
  if (!binding || binding.reported) return;
  binding.reported = true;
  send('probe-result', binding.session, binding.generation, { passed });
}
function completeProbeResult(passed) {
  probeResult = passed ? 'passed' : 'failed';
  sourceAuthorized = passed;
  runtimeState = passed ? 'fresh' : 'disposed';
  sendProbeResult(probeBinding, passed);
}
function locationDto(view, detail) {
  const index = sectionIndexFromDetail(detail);
  if (!isReadableSection(view, index)) return null;
  return {
    index,
    cfi: typeof detail?.cfi === 'string' ? detail.cfi : null,
    fraction: typeof detail?.fraction === 'number' && Number.isFinite(detail.fraction) ? detail.fraction : null,
  };
}
function modelDto(view) {
  const fixedLayout = Boolean(view.isFixedLayout);
  return { fixedLayout, flow: fixedLayout ? null : (view.renderer?.getAttribute('flow') ?? 'paginated') };
}
function isSafeIntegerOrNull(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}
function isPlainObject(value) {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function validatePublicationModel(model) {
  if (!isRecord(model) || !hasOnlyKeys(model, ['modelVersion', 'format', 'fixedLayout', 'flow', 'direction', 'metadata', 'sections', 'toc', 'destinations'])) return false;
  if (model.modelVersion !== 1 || !FORMAT_TUPLES[model.format] || typeof model.fixedLayout !== 'boolean') return false;
  if ((model.fixedLayout && model.flow !== null) || (!model.fixedLayout && !['scrolled', 'paginated'].includes(model.flow)) || !['ltr', 'rtl', null].includes(model.direction)) return false;
  if (!isPlainObject(model.metadata) || !hasOnlyKeys(model.metadata, ['title']) || !(typeof model.metadata.title === 'string' || model.metadata.title === null) || (typeof model.metadata.title === 'string' && model.metadata.title.length > MAX_MODEL_TITLE_LENGTH)) return false;
  if (!Array.isArray(model.sections) || model.sections.length > MAX_MODEL_SECTIONS || !Array.isArray(model.destinations) || !Array.isArray(model.toc)) return false;
  const sectionKeys = new Set();
  for (const section of model.sections) {
    if (!isPlainObject(section) || !hasOnlyKeys(section, ['key', 'index', 'linear', 'bytes']) || !Number.isSafeInteger(section.index) || section.index < 0 || section.index !== sectionKeys.size || section.key !== 's:' + section.index || typeof section.linear !== 'boolean' || !isSafeIntegerOrNull(section.bytes) || sectionKeys.has(section.key)) return false;
    sectionKeys.add(section.key);
  }
  const destinationIds = new Set();
  for (const destination of model.destinations) {
    if (!isPlainObject(destination) || !hasOnlyKeys(destination, ['id', 'sectionKey', 'sectionIndex']) || !/^d:\d+$/.test(destination.id) || destination.sectionKey !== 's:' + destination.sectionIndex || !sectionKeys.has(destination.sectionKey) || !Number.isSafeInteger(destination.sectionIndex) || destinationIds.has(destination.id)) return false;
    destinationIds.add(destination.id);
  }
  const stack = model.toc.map((node) => ({ node, depth: 1 }));
  let nodes = 0;
  const tocIds = new Set();
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (++nodes > MAX_MODEL_TOC_NODES || depth > MAX_MODEL_TOC_DEPTH || !isPlainObject(node) || !hasOnlyKeys(node, ['id', 'label', 'destinationId', 'subitems']) || !/^toc:\d+$/.test(node.id) || tocIds.has(node.id) || typeof node.label !== 'string' || node.label.length > MAX_MODEL_LABEL_LENGTH || !(node.destinationId === null || destinationIds.has(node.destinationId)) || !Array.isArray(node.subitems)) return false;
    tocIds.add(node.id);
    for (const child of node.subitems) stack.push({ node: child, depth: depth + 1 });
  }
  try { return new TextEncoder().encode(JSON.stringify(model)).byteLength <= MAX_MODEL_UTF8_BYTES; }
  catch { return false; }
}
function freezeModel(value) {
  if (Array.isArray(value)) value.forEach(freezeModel);
  else if (isRecord(value)) Object.values(value).forEach(freezeModel);
  return Object.freeze(value);
}
function safeModelString(value, maximum) {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized.length > maximum) throw new Error('MODEL_LIMIT');
    return normalized || null;
  }
  if (!isPlainObject(value)) return value == null ? null : null;
  for (const key of Object.keys(value).sort()) {
    const candidate = value[key];
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim();
    if (normalized.length > maximum) throw new Error('MODEL_LIMIT');
    if (normalized) return normalized;
  }
  return null;
}
async function resolveDestination(session, href, sequence, modelSnapshot, deadlineAt) {
  if (typeof href !== 'string') return null;
  if (href.length > MAX_MODEL_HREF_LENGTH) throw new Error('MODEL_LIMIT');
  if (modelNow() >= deadlineAt) return null;
  let timeout;
  try {
    const remaining = deadlineAt - modelNow();
    if (remaining <= 0) return null;
    const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('MODEL_RESOLUTION_TIMEOUT')), Math.min(modelTestTimeouts?.item ?? MODEL_RESOLUTION_TIMEOUT_MS, remaining)); });
    const resolved = await Promise.race([
      Promise.resolve(session.view.book.resolveHref(href)),
      deadline,
      session.modelDeadline,
    ]);
    clearTimeout(timeout);
    if (modelNow() >= deadlineAt) return null;
    if (!current(session) || modelSnapshot.invalidated || session.modelSnapshot !== modelSnapshot) throw new Error('MODEL_STALE');
    if (!Number.isSafeInteger(resolved?.index) || resolved.index < 0 || !session.view.book.sections?.[resolved.index]) return null;
    const id = 'd:' + sequence;
    const internal = Object.freeze({ index: resolved.index, anchor: resolved.anchor });
    session.destinationRegistry.set(id, internal);
    return { id, sectionKey: 's:' + resolved.index, sectionIndex: resolved.index };
  } catch (error) {
    if (error?.message === 'MODEL_STALE') throw error;
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
async function buildPublicationModel(session) {
  const { book, isFixedLayout, renderer } = session.view;
  if (!book || !renderer || !current(session) || probeBinding?.session !== session.session || probeBinding?.generation !== session.generation) throw new Error('MODEL_STALE');
  const sections = Array.from(book.sections ?? []);
  if (sections.length > MAX_MODEL_SECTIONS) throw new Error('MODEL_LIMIT');
  const registry = new Map();
  session.destinationRegistry = registry;
  const modelSnapshot = { registry, invalidated: false };
  session.modelSnapshot = modelSnapshot;
  const work = [];
  const seen = new WeakSet();
  const toc = [];
  const stack = Array.from(book.toc ?? []).reverse().map((node) => ({ input: node, output: toc, depth: 1 }));
  let tocSequence = 0;
  while (stack.length) {
    const { input, output, depth } = stack.pop();
    if (!isRecord(input) || depth > MAX_MODEL_TOC_DEPTH || ++tocSequence > MAX_MODEL_TOC_NODES || seen.has(input)) throw new Error('MODEL_LIMIT');
    seen.add(input);
    const label = safeModelString(input.label ?? '', MAX_MODEL_LABEL_LENGTH);
    const node = { id: 'toc:' + (tocSequence - 1), label, destinationId: null, subitems: [] };
    output.push(node);
    work.push({ node, href: input.href, sequence: tocSequence - 1 });
    const children = input.subitems ?? [];
    if (!Array.isArray(children)) throw new Error('MODEL_LIMIT');
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ input: children[index], output: node.subitems, depth: depth + 1 });
  }
  const destinations = [];
  const destinationIds = new Set();
  const byHref = new Map();
  let cursor = 0;
  let deadlineExpired = false;
  const deadlineAt = modelNow() + (modelTestTimeouts?.total ?? MODEL_TOTAL_DEADLINE_MS);
  let completeTotalDeadline;
  session.modelDeadline = new Promise((resolve) => { completeTotalDeadline = resolve; });
  const totalDeadline = setTimeout(() => {
    deadlineExpired = true;
    completeTotalDeadline(null);
  }, modelTestTimeouts?.total ?? MODEL_TOTAL_DEADLINE_MS);
  const resolveWorker = async () => {
    while (!deadlineExpired && cursor < work.length) {
      if (modelNow() >= deadlineAt) {
        deadlineExpired = true;
        break;
      }
      const item = work[cursor++];
      if (typeof item.href !== 'string') continue;
      if (!byHref.has(item.href)) {
        byHref.set(item.href, resolveDestination(session, item.href, item.sequence, modelSnapshot, deadlineAt));
      }
      const destination = await byHref.get(item.href);
      if (destination && !destinationIds.has(destination.id)) {
        destinationIds.add(destination.id);
        destinations.push(destination);
      }
      if (!current(session) || modelSnapshot.invalidated || session.modelSnapshot !== modelSnapshot) throw new Error('MODEL_STALE');
      if (modelNow() >= deadlineAt) {
        deadlineExpired = true;
        break;
      }
      item.node.destinationId = destination?.id ?? null;
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(MODEL_RESOLUTION_CONCURRENCY, work.length) }, resolveWorker));
  } catch (error) {
    // In-flight resolver promises may settle after a stale session rejects.
    modelSnapshot.invalidated = true;
    registry.clear();
    throw error;
  } finally {
    clearTimeout(totalDeadline);
    session.modelDeadline = null;
  }
  if (deadlineExpired) {
    modelSnapshot.invalidated = true;
    for (const item of work) item.node.destinationId = null;
    registry.clear();
    destinations.length = 0;
  }
  const model = {
    modelVersion: 1,
    format: session.format,
    fixedLayout: Boolean(isFixedLayout),
    flow: isFixedLayout ? null : (renderer.getAttribute('flow') === 'scrolled' ? 'scrolled' : 'paginated'),
    direction: book.dir === 'ltr' || book.dir === 'rtl' ? book.dir : null,
    metadata: { title: safeModelString(book.metadata?.title ?? null, MAX_MODEL_TITLE_LENGTH) },
    sections: sections.map((section, index) => ({ key: 's:' + index, index, linear: section.linear !== 'no', bytes: isSafeIntegerOrNull(section.size) ? section.size ?? null : null })),
    toc,
    destinations,
  };
  if (!validatePublicationModel(model)) throw new Error('MODEL_INVALID');
  modelSnapshot.model = freezeModel(model);
  return modelSnapshot.model;
}
function installPublicationPolicy(doc) {
  if (!doc?.head || typeof doc.createElement !== 'function') return;
  const meta = doc.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = FOLIATE_PUBLICATION_CSP;
  doc.head.prepend(meta);
  // Defence in depth only: the iframe[csp] attribute is installed before src.
  doc.querySelectorAll?.('script, base, form, object').forEach(node => node.remove());
  doc.addEventListener?.('submit', event => event.preventDefault(), true);
}

function cleanup(session) {
  if (!session || session.detached) return;
  session.detached = true;
  unbindPageTurnInput(session);
  const { view, onExternalLink, onLoad, onRelocate } = session;
  view.removeEventListener('external-link', onExternalLink);
  view.removeEventListener('load', onLoad);
  view.removeEventListener('relocate', onRelocate);
  clearTimeout(session.firstLoadTimer);
  clearTimeout(session.navigationTimer);
  session.rejectFirstLoad?.(new Error('session disposed'));
  session.pendingNavigation?.reject(new Error('session disposed'));
  session.pendingNavigation = null;
  session.navigationInFlight = false;
  session.destinationRegistry?.clear();
  session.destinationRegistry = null;
  session.modelSnapshot = null;
  // The staged renderer settles its pending iframe load before DOM detach.
  if (session.startupPending) session.view.renderer?.cancelPendingLoad?.();
  view.remove();
}
function finalizeBook(session) {
  const book = session.view.book;
  if (book && !session.finalizedBooks.has(book)) {
    session.finalizedBooks.add(book);
    try { book.destroy?.(); } catch {}
  }
}
function finalizeLateResources(session) {
  const renderer = session.view.renderer;
  if (renderer && !session.finalizedRenderers.has(renderer)) {
    session.finalizedRenderers.add(renderer);
    try { renderer.destroy?.(); } catch {}
  }
  finalizeBook(session);
}
async function finalizeEngine(session) {
  if (!session || session.engineFinalized) return;
  session.engineFinalized = true;
  const renderer = session.view.renderer;
  // Raw section loaders can still mint cache/blob URLs after the cancellation
  // race rejects. Wait for their tracked settlement before closing the book.
  renderer?.invalidatePendingLoads?.();
  if (renderer) session.view.renderer = null;
  if (!session.closeAttempted) {
    session.closeAttempted = true;
    try { session.view.close(); } catch {}
  }
  if (renderer && !session.finalizedRenderers.has(renderer)) {
    session.finalizedRenderers.add(renderer);
    try { renderer.destroy?.(); } catch {}
  }
  finalizeLateResources(session);
}
function dispose(session = activeSession) {
  if (!session || session.detached) return;
  runtimeState = 'disposing';
  if (activeSession === session) activeSession = null;
  cleanup(session);
  if (!session.startupPending) void finalizeEngine(session);
  runtimeState = 'disposed';
}

function parseCommand(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, ['type', 'protocolVersion', 'session', 'generation', 'payload'])) return null;
  if (!FOLIATE_IFRAME_COMMAND_TYPES.includes(value.type) || value.protocolVersion !== FOLIATE_IFRAME_PROTOCOL_VERSION || !isToken(value.session) || !isToken(value.generation) || !isRecord(value.payload)) return null;
  return value;
}
function parseProbePayload(payload) {
  return hasOnlyKeys(payload, ['intrusiveCspDiagnostics']) &&
    (payload.intrusiveCspDiagnostics === undefined || typeof payload.intrusiveCspDiagnostics === 'boolean') ? payload : null;
}
function handleProbe(command) {
  if (!parseProbePayload(command.payload)) return;
  if (probeBinding) {
    if (
      probeBinding.session !== command.session ||
      probeBinding.generation !== command.generation
    ) return;
  } else {
    probeBinding = {
      session: command.session,
      generation: command.generation,
      reported: false,
      opened: false,
    };
    if (probeResult !== 'pending') {
      sendProbeResult(probeBinding, sourceAuthorized);
      return;
    }
    runtimeState = 'probing';
    if (!checkStartupCapabilities()) return completeProbeResult(false);
    if (command.payload.intrusiveCspDiagnostics === true) {
      const binding = probeBinding;
      const finish = passed => {
        if (probeBinding === binding && runtimeState === 'probing') completeProbeResult(passed);
      };
      void probeEmbeddedEnforcement().then(finish).catch(() => finish(false));
    } else {
      // Compatibility authorization is not behavioral proof of enforcement.
      probeResult = 'skipped';
      sourceAuthorized = true;
      runtimeState = 'fresh';
    }
  }
  if (sourceAuthorized) sendProbeResult(probeBinding, true);
  else if (probeResult === 'failed') sendProbeResult(probeBinding, false);
}
function hasPassedProbeBinding(command) {
  return sourceAuthorized && runtimeState === 'fresh'
    && probeBinding?.session === command.session
    && probeBinding?.generation === command.generation
    && !probeBinding.opened;
}
function parseOpenPayload(payload) {
  if (!hasOnlyKeys(payload, ['file', 'format', 'name', 'mimeType'])) return null;
  const tuple = FORMAT_TUPLES[payload.format];
  if (!tuple || !isPrivateBlob(payload.file) || typeof payload.name !== 'string' || typeof payload.mimeType !== 'string' || payload.name !== tuple.name || payload.mimeType !== tuple.mimeType || payload.file.type !== tuple.mimeType) return null;
  return payload;
}
function parseNavigatePayload(payload) {
  if (!hasOnlyKeys(payload, ['section', 'destination'])) return null;
  const hasSection = payload.section !== undefined;
  const hasDestination = payload.destination !== undefined;
  if (hasSection === hasDestination) return null;
  if (hasSection && (!Number.isInteger(payload.section) || payload.section < 0)) return null;
  if (hasDestination && (typeof payload.destination !== 'string' || !/^d:[0-9]+$/.test(payload.destination))) return null;
  return payload;
}
function parseFlowPayload(payload) {
  return hasOnlyKeys(payload, ['flow']) && (payload.flow === 'scrolled' || payload.flow === 'paginated') ? payload : null;
}
function checkStartupCapabilities() {
  try {
    if (typeof URL?.createObjectURL !== 'function' || typeof URL?.revokeObjectURL !== 'function' ||
      typeof Blob === 'undefined' || typeof globalThis.crypto?.randomUUID !== 'function' ||
      typeof HTMLIFrameElement === 'undefined' || !('csp' in HTMLIFrameElement.prototype)) return false;
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if (meta?.content !== FOLIATE_HOST_CSP) return false;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', FOLIATE_PUBLICATION_IFRAME_SANDBOX);
    frame.setAttribute('csp', FOLIATE_PUBLICATION_CSP);
    return frame.getAttribute('sandbox') === FOLIATE_PUBLICATION_IFRAME_SANDBOX &&
      frame.getAttribute('csp') === FOLIATE_PUBLICATION_CSP;
  } catch { return false; }
}
function probeEmbeddedEnforcement() {
  runtimeState = 'probing';
  if (
    typeof URL?.createObjectURL !== 'function' ||
    typeof URL?.revokeObjectURL !== 'function' ||
    typeof Blob === 'undefined' ||
    typeof globalThis.crypto?.randomUUID !== 'function'
  ) return Promise.resolve(false);
  const probeAssets = token => ({
    png: new URL('./probes/csp-1x1.png?hnCspProbe=' + token, import.meta.url).href,
    script: new URL('./probes/csp-external-canary.js?hnCspProbe=' + token, import.meta.url).href,
    crossOriginImage: 'https://example.invalid/__hn-csp-probe-' + token,
  });
  const makeProbeDocument = (token, assets) =>
    '<!doctype html><html><head><meta name="hn-csp-static-probe" content="' + PROBE_STATIC_MARKER + '"><script data-hn-csp-probe-token="' + token + '" src="' + assets.script + '"></script></head><body><img data-hn-csp-probe-image src="' + assets.png + '"><img data-hn-csp-probe-cross-image src="' + assets.crossOriginImage + '"></body></html>';
  const runProbeFrame = strict => new Promise(resolve => {
    let frame;
    let probeUrl;
    let token;
    let assets;
    let settled = false;
    let loaded = false;
    let timeout;
    let onLoad;
    let onError;
    const cleanup = () => {
      let clean = true;
      for (const operation of [
        () => clearTimeout(timeout),
        () => frame?.removeEventListener?.('load', onLoad),
        () => frame?.removeEventListener?.('error', onError),
        () => probeUrl && URL.revokeObjectURL(probeUrl),
        () => frame?.remove?.(),
      ]) {
        try { operation(); } catch { clean = false; }
      }
      return clean;
    };
    const finish = value => {
      if (settled) return;
      settled = true;
      const clean = cleanup();
      resolve(Boolean(value) && clean);
    };
    onError = () => finish(false);
    onLoad = () => {
      if (loaded) return finish(false);
      loaded = true;
      try {
        const frameWindow = frame.contentWindow;
        const frameDocument = frame.contentDocument;
        if (
          !frameWindow || !frameDocument ||
          frameWindow.location?.href !== probeUrl ||
          frameDocument.URL === 'about:blank' ||
          frameDocument.readyState !== 'complete'
        ) return finish(false);
        const staticMarker = frameDocument.querySelector('meta[name="hn-csp-static-probe"]');
        const image = frameDocument.querySelector('img[data-hn-csp-probe-image]');
        const crossImage = frameDocument.querySelector('img[data-hn-csp-probe-cross-image]');
        const script = frameDocument.querySelector('script[data-hn-csp-probe-token]');
        if (
          staticMarker?.content !== PROBE_STATIC_MARKER ||
          !image || !crossImage || !script ||
          image.getAttribute('src') !== assets.png ||
          crossImage.getAttribute('src') !== assets.crossOriginImage ||
          script.getAttribute('src') !== assets.script ||
          script.dataset.hnCspProbeToken !== token ||
          !image.complete || !crossImage.complete
        ) return finish(false);
        const externalMarker = frameDocument.querySelector('meta[name="hn-csp-external-probe"]')?.content;
        if (!strict) {
          return finish(
            image.naturalWidth === 1 && image.naturalHeight === 1 &&
            externalMarker === token,
          );
        }
        return finish(
          image.naturalWidth === 0 && image.naturalHeight === 0 &&
          crossImage.naturalWidth === 0 &&
          externalMarker === undefined,
        );
      } catch {
        return finish(false);
      }
    };
    try {
      token = (strict ? 'strict-' : 'control-') + globalThis.crypto.randomUUID();
      assets = probeAssets(token);
      frame = document.createElement('iframe');
      probeUrl = URL.createObjectURL(new Blob([makeProbeDocument(token, assets)], { type: 'text/html' }));
      timeout = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
      frame.setAttribute('sandbox', FOLIATE_PUBLICATION_IFRAME_SANDBOX);
      if (strict) frame.setAttribute('csp', FOLIATE_PUBLICATION_CSP);
      frame.addEventListener('load', onLoad);
      frame.addEventListener('error', onError);
      frame.src = probeUrl;
      document.body.append(frame);
    } catch {
      finish(false);
    }
  });
  return runProbeFrame(false).then(controlPassed =>
    controlPassed ? runProbeFrame(true) : false,
  ).catch(() => false);
}

async function open(command) {
  if (!hasPassedProbeBinding(command) || activeSession) return;
  const payload = parseOpenPayload(command.payload);
  if (!payload) return;
  probeBinding.opened = true;
  runtimeState = 'opening';
  const view = document.createElement('foliate-view');
  view.setAttribute('aria-label', 'Publication reader');
  view.setAttribute('data-foliate-publication-csp', FOLIATE_PUBLICATION_CSP);
  let resolveFirstLoad, rejectFirstLoad;
  const firstLoad = new Promise((resolve, reject) => { resolveFirstLoad = resolve, rejectFirstLoad = reject; });
  // Disposal may reject before this coroutine reaches await firstLoad.
  firstLoad.catch(() => undefined);
  const session = {
    session: command.session, generation: command.generation, view, detached: false,
    format: payload.format, destinationRegistry: null, modelSnapshot: null,
    startupPending: true, engineFinalized: false, closeAttempted: false,
    modelSent: false,
    firstLoadTimer: null, navigationTimer: null, pendingNavigation: null, navigationInFlight: false,
    pageTurnBound: false, pageTurnInFlight: false, lastPageTurnAt: 0, terminalFailure: false,
    rejectFirstLoad, finalizedBooks: new WeakSet(), finalizedRenderers: new WeakSet(),
    onExternalLink: event => event.preventDefault(),
    onLoad: event => {
      if (!current(session)) return;
      const { doc, index } = event.detail ?? {};
      if (!doc || !isReadableSection(view, index)) return;
      // 每个 in-frame 文档都要清理 refresh 并观察后续导航，不能只处理首个
      // section：其它 section 被跳转替换同样不能继续报 ready。
      removePublicationRefreshMetas(doc);
      observePublicationFrame(session, doc);
      if (index !== session.firstReadableIndex) return;
      installPublicationPolicy(doc);
      resolveFirstLoad();
    },
    onRelocate: event => {
      if (!current(session)) return;
      const resolvedIndex = sectionIndexFromDetail(event.detail);
      if (session.pendingNavigation?.index === resolvedIndex) {
        clearTimeout(session.navigationTimer);
        session.pendingNavigation.resolve();
        session.pendingNavigation = null;
      }
      const location = locationDto(view, event.detail);
      if (session.modelSent) {
        if (location) send('location', session.session, session.generation, location);
      }
    },
  };
  activeSession = session;
  view.addEventListener('external-link', session.onExternalLink);
  view.addEventListener('load', session.onLoad);
  view.addEventListener('relocate', session.onRelocate);
  document.body.append(view);
  try {
    // Foliate treats strings as fetchable URLs; only pass a private File.
    const file = new File([payload.file], payload.name, { type: payload.mimeType });
    session.firstLoadTimer = setTimeout(() => rejectFirstLoad(new Error('first load timeout')), NAVIGATION_TIMEOUT_MS);
    await view.open(file);
    if (!current(session)) {
      session.startupPending = false;
      return await finalizeEngine(session);
    }
    // 必须在任何 section 文档创建之前挂上 transform，否则 refresh 已经生效。
    installPublicationTransform(view.book);
    bindPageTurnInput(session);
    if (!view.isFixedLayout && view.renderer) view.renderer.setAttribute('flow', 'scrolled');
    session.firstReadableIndex = view.book?.sections?.findIndex(section => section?.linear !== 'no');
    if (!isReadableSection(view, session.firstReadableIndex) || !view.renderer?.goTo) throw new Error('missing first readable renderer section');
    await view.renderer.goTo({ index: session.firstReadableIndex });
    if (!current(session)) {
      session.startupPending = false;
      return await finalizeEngine(session);
    }
    await firstLoad;
    if (!current(session)) {
      session.startupPending = false;
      return await finalizeEngine(session);
    }
    clearTimeout(session.firstLoadTimer);
    const publicationModel = await buildPublicationModel(session);
    if (!current(session) || session.modelSnapshot?.model !== publicationModel) {
      session.startupPending = false;
      return await finalizeEngine(session);
    }
    session.startupPending = false;
    runtimeState = 'live';
    send('publication-model', session.session, session.generation, { model: publicationModel });
    send('model', session.session, session.generation, modelDto(view));
    send('ready', session.session, session.generation);
    session.modelSent = true;
    send('command-ack', session.session, session.generation, { command: 'open' });
  } catch (error) {
    session.startupPending = false;
    if (current(session)) sendError(session.session, session.generation, error?.message?.startsWith('MODEL_') ? 'model-failure' : 'render-failure');
    if (current(session)) dispose(session);
    else await finalizeEngine(session);
  }
}

async function navigate(session, command, payload) {
  // 页级翻页与章节导航共用同一个 renderer：互斥，不能并发改写位置。
  if (session.navigationInFlight || session.pageTurnInFlight || session.pendingNavigation) {
    return sendError(command.session, command.generation, 'navigation-busy');
  }
  session.navigationInFlight = true;
  try {
    const resolved = payload.destination
      ? session.destinationRegistry?.get(payload.destination)
      : { index: payload.section };
    if (!current(session)) return;
    if (!resolved || !Number.isSafeInteger(resolved.index) || resolved.index < 0 || !session.view.book.sections?.[resolved.index] || (!payload.destination && !isReadableSection(session.view, resolved.index))) {
      return sendError(command.session, command.generation, 'navigation-failure');
    }
    await new Promise((resolve, reject) => {
      session.pendingNavigation = { index: resolved.index, resolve, reject };
      session.navigationTimer = setTimeout(() => reject(new Error('relocate timeout')), NAVIGATION_TIMEOUT_MS);
      Promise.resolve(session.view.renderer?.goTo(resolved)).catch(reject);
    }).catch(() => undefined);
    clearTimeout(session.navigationTimer);
    if (!current(session)) return;
    if (session.pendingNavigation) {
      session.pendingNavigation = null;
      return sendError(command.session, command.generation, 'navigation-failure');
    }
    send('command-ack', command.session, command.generation, { command: 'navigate' });
  } finally {
    clearTimeout(session.navigationTimer);
    session.pendingNavigation = null;
    session.navigationInFlight = false;
  }
}

async function handleCurrentCommand(command) {
  const session = activeSession;
  if (!session || !['opening', 'live'].includes(runtimeState) || command.session !== session.session || command.generation !== session.generation) return;
  if (command.type === 'dispose') {
    if (!hasOnlyKeys(command.payload, [])) return;
    dispose(session);
    send('command-ack', command.session, command.generation, { command: 'dispose' });
    return;
  }
  if (runtimeState !== 'live') {
    return;
  } else if (command.type === 'navigate') {
    const payload = parseNavigatePayload(command.payload);
    if (payload) await navigate(session, command, payload);
  } else if (command.type === 'flow') {
    const payload = parseFlowPayload(command.payload);
    if (!payload || session.view.isFixedLayout || !session.view.renderer) return;
    // Navigation and flow cannot mutate the renderer concurrently.
    if (session.navigationInFlight || session.pageTurnInFlight || session.pendingNavigation) {
      return sendError(command.session, command.generation, 'navigation-busy');
    }
    session.view.renderer.setAttribute('flow', payload.flow);
    send('model', command.session, command.generation, modelDto(session.view));
    send('command-ack', command.session, command.generation, { command: 'flow' });
  }
}

function receiveMessage(event) {
  if (event.origin !== location.origin || event.source !== parent) return;
  const command = parseCommand(event.data);
  if (!command) return;
  if (command.type === 'probe') {
    handleProbe(command);
    return;
  }
  if (command.type === 'dispose' && !activeSession && hasOnlyKeys(command.payload, []) &&
    probeBinding?.session === command.session && probeBinding?.generation === command.generation) {
    sourceAuthorized = false;
    runtimeState = 'disposed';
    probeBinding.reported = true;
    return;
  }
  if (runtimeState === 'probing') return;
  if (command.type === 'open') void open(command);
  else void handleCurrentCommand(command);
}




export function installNativeRenderer(sink) {
  if (nativeEventSink) throw new Error('Renderer already installed');
  nativeEventSink = sink;
  return value => {
    const command = parseCommand(value);
    if (!command) return;
    if (command.type === 'probe') handleProbe(command);
    else if (command.type === 'open') void open(command);
    else void handleCurrentCommand(command);
  };
}
