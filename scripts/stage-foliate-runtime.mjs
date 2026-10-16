import { createHash } from 'node:crypto';
import ts from 'typescript';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateFoliateSubmodule } from './verify-foliate-submodule.mjs';
import {
  checkFoliateWebRuntime,
  syncFoliateWebRuntime,
} from '../packages/native-reader/scripts/sync-foliate-web-runtime.mjs';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export const FOLIATE_RUNTIME_DIRECTORY = 'foliate-runtime';
export const FOLIATE_RUNTIME_MANIFEST = 'manifest.json';
export const FOLIATE_WEB_RUNTIME_DIRECTORY = 'web';
export const FOLIATE_WEB_RUNTIME_MANIFEST = 'manifest.json';
export const FOLIATE_NATIVE_RUNTIME_DIRECTORY = 'native';
export const FOLIATE_NATIVE_RUNTIME_MANIFEST = 'manifest.json';
export const FOLIATE_NATIVE_HOST_VERSION = 'foliate-native-host-1';

const codepointCompare = (left, right) => {
  const leftPoints = [...left];
  const rightPoints = [...right];
  for (
    let index = 0;
    index < Math.min(leftPoints.length, rightPoints.length);
    index += 1
  ) {
    const difference =
      leftPoints[index].codePointAt(0) - rightPoints[index].codePointAt(0);
    if (difference) return difference;
  }
  return leftPoints.length - rightPoints.length;
};

export const ZIP_JS_LICENSE = `BSD 3-Clause License

Copyright (c) 2023, Gildas Lormeau

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`;

export const FFLATE_LICENSE = `MIT License

Copyright (c) 2023 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

// Generated, trusted inputs for the iframe[csp] differential probe. They are
// intentionally outside publication control and included in both host manifests.
const CSP_PROBE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL3EgAAAABJRU5ErkJggg==',
  'base64',
);
const CSP_PROBE_EXTERNAL_CANARY = `const token = document.currentScript?.dataset.hnCspProbeToken;
if (typeof token === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(token)) {
  const marker = document.createElement('meta');
  marker.name = 'hn-csp-external-probe';
  marker.content = token;
  document.head.append(marker);
}
`;

const assetDefinitions = [
  ['view.js', 'view', 'MIT'],
  ['epub.js', 'epub', 'MIT'],
  ['epubcfi.js', 'epub', 'MIT'],
  ['mobi.js', 'mobi-kf8-azw3', 'MIT'],
  ['fb2.js', 'fb2-fbz', 'MIT'],
  ['comic-book.js', 'cbz', 'MIT'],
  ['paginator.js', 'reflow-renderer', 'MIT'],
  ['fixed-layout.js', 'fixed-layout-renderer', 'MIT'],
  ['progress.js', 'view-support', 'MIT'],
  ['overlayer.js', 'view-support', 'MIT'],
  [
    'vendor/zip.js',
    'zip-runtime',
    'BSD-3-Clause',
    'https://registry.npmjs.org/@zip.js/zip.js/-/zip.js-2.8.22.tgz',
    '2.8.22',
  ],
  [
    'vendor/fflate.js',
    'mobi-font-runtime',
    'MIT',
    'https://registry.npmjs.org/fflate/-/fflate-0.8.2.tgz',
    '0.8.2',
  ],
  ['LICENSE', 'license-notice', 'MIT'],
];

const forbiddenPath = (relativePath) =>
  /(^|\/)(pdf\.js|pdf\.worker\.mjs|cmaps|standard_fonts|pdfjs)(\/|$)/i.test(
    relativePath,
  );

const sha256 = (contents) =>
  createHash('sha256').update(contents).digest('hex');

const CSP_POLICY_PATH = path.join(
  workspaceRoot,
  'packages/native-reader/src/foliate-csp-policy.json',
);

function stringifyCspPolicy(source, kind) {
  const policy = source?.policies?.[kind];
  if (
    source?.schemaVersion !== 1 ||
    !Array.isArray(source.directiveOrder) ||
    typeof policy?.version !== 'string' ||
    !policy.version ||
    !policy.directives
  ) {
    throw new Error(`Foliate ${kind} CSP source has an unsupported shape`);
  }
  return {
    value: source.directiveOrder
      .map((name) => {
        const values = policy.directives[name];
        if (!Array.isArray(values) || values.length === 0) {
          throw new Error(`Foliate ${kind} CSP is missing directive ${name}`);
        }
        return `${name} ${values.join(' ')}`;
      })
      .join('; '),
    version: policy.version,
  };
}

async function readFoliateCspPolicies() {
  return JSON.parse(await readFile(CSP_POLICY_PATH, 'utf8'));
}

function createWebReaderHtml(hostPolicy) {
  // 可信 host 静态样式：vendor 的 foliate-view 自定义元素本身没有 :host 尺寸，
  // 默认按 inline 0x0 布局，内部 foliate-paginator 随之 height 0 且 overflow
  // hidden，正文会被整体裁剪（计数前进但页面不变）。host 文档必须为
  // html/body/foliate-view 链提供确定的视口尺寸。host CSP 的 style-src 已包含
  // 'unsafe-inline'，此处仅声明静态布局，不改变配色/结构/交互，也不下放任何
  // publication 可控样式。
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="${hostPolicy.value}">
    <title>Foliate reader</title>
    <style>
      html,
      body {
        margin: 0;
        width: 100%;
        height: 100%;
      }
      body {
        /* 滚动只发生在 reader 内部，host 文档自身不滚动。 */
        overflow: hidden;
      }
      foliate-view {
        display: block;
        width: 100%;
        height: 100%;
      }
    </style>
    <script type="module" src="./bootstrap.js"></script>
  </head>
  <body></body>
</html>
`;
}

function createNativeReaderHtml(hostPolicy) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="hn-foliate-native-host-version" content="${FOLIATE_NATIVE_HOST_VERSION}">
    <meta http-equiv="Content-Security-Policy" content="${hostPolicy.value}">
    <title>Foliate native reader host</title>
    <style>html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; } foliate-view { display: block; width: 100%; height: 100%; }</style>
    <!-- Private host exposes no page-world publication capability. -->
    <script type="module" src="./bootstrap.js"></script>
  </head>
  <body>
    <main id="foliate-native-host" aria-label="Publication reader"></main>
  </body>
</html>
`;
}

async function createNativeBootstrap() {
  return readFile(
    path.join(workspaceRoot, 'scripts/native-host-bootstrap.mjs'),
    'utf8',
  );
}

function createWebBootstrap(publicationPolicy, native = false) {
  return `${native ? 'let nativeEventSink = null;\n' : ''}import './foliate/view.js';

// Chromium-only: opening is fail-closed until a control/strict iframe pair
// proves that iframe[csp] blocks executable markup and same-origin HTTP assets.
export const FOLIATE_IFRAME_PROTOCOL_VERSION = 1;
export const FOLIATE_IFRAME_COMMAND_TYPES = Object.freeze(['probe', 'open', 'dispose', 'navigate', 'flow']);
export const FOLIATE_IFRAME_EVENT_TYPES = Object.freeze(['probe-result', 'publication-model', 'ready', 'model', 'location', 'error', 'command-ack']);
export const FOLIATE_PUBLICATION_CSP_VERSION = ${JSON.stringify(publicationPolicy.version)};
export const FOLIATE_PUBLICATION_CSP = ${JSON.stringify(publicationPolicy.value)};
export const FOLIATE_RUNTIME_STATES = Object.freeze(['fresh', 'probing', 'opening', 'live', 'disposing', 'disposed']);

const MAX_PUBLICATION_BYTES = ${native ? 32 : 128} * 1024 * 1024;
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
    ${native ? 'nativeEventSink?.({ type, protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION, session, generation, ...detail });' : 'parent.postMessage({ type, protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION, session, generation, ...detail }, location.origin);'}
    return;
  }
  if (!eventKeys[type] || !hasOnlyKeys(detail, eventKeys[type]) || !Object.values(detail).every(isPrimitive)) {
    throw new TypeError('Bridge event DTO must match its closed primitive schema');
  }
  ${native ? 'nativeEventSink?.({ type, protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION, session, generation, ...detail });' : 'parent.postMessage({ type, protocolVersion: FOLIATE_IFRAME_PROTOCOL_VERSION, session, generation, ...detail }, location.origin);'}
}
function sendError(session, generation, code) { send('error', session, generation, { code }); }
function sendProbeResult(binding, passed) {
  if (!binding || binding.reported) return;
  binding.reported = true;
  send('probe-result', binding.session, binding.generation, { passed });
}
function completeProbeResult(passed) {
  probeResult = passed ? 'passed' : 'failed';
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
    if (!isPlainObject(destination) || !hasOnlyKeys(destination, ['id', 'sectionKey', 'sectionIndex']) || !/^d:\\d+$/.test(destination.id) || destination.sectionKey !== 's:' + destination.sectionIndex || !sectionKeys.has(destination.sectionKey) || !Number.isSafeInteger(destination.sectionIndex) || destinationIds.has(destination.id)) return false;
    destinationIds.add(destination.id);
  }
  const stack = model.toc.map((node) => ({ node, depth: 1 }));
  let nodes = 0;
  const tocIds = new Set();
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (++nodes > MAX_MODEL_TOC_NODES || depth > MAX_MODEL_TOC_DEPTH || !isPlainObject(node) || !hasOnlyKeys(node, ['id', 'label', 'destinationId', 'subitems']) || !/^toc:\\d+$/.test(node.id) || tocIds.has(node.id) || typeof node.label !== 'string' || node.label.length > MAX_MODEL_LABEL_LENGTH || !(node.destinationId === null || destinationIds.has(node.destinationId)) || !Array.isArray(node.subitems)) return false;
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
  return hasOnlyKeys(payload, []) ? payload : null;
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
  }
  if (probeResult === 'passed') sendProbeResult(probeBinding, true);
  else if (probeResult === 'failed') sendProbeResult(probeBinding, false);
}
function hasPassedProbeBinding(command) {
  return probeResult === 'passed' && runtimeState === 'fresh'
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
    rejectFirstLoad, finalizedBooks: new WeakSet(), finalizedRenderers: new WeakSet(),
    onExternalLink: event => event.preventDefault(),
    onLoad: event => {
      if (!current(session)) return;
      const { doc, index } = event.detail ?? {};
      if (!doc || !isReadableSection(view, index) || index !== session.firstReadableIndex) return;
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
    ${native ? "if (!view.isFixedLayout && view.renderer) view.renderer.setAttribute('flow', 'scrolled');" : ''}\n    session.firstReadableIndex = view.book?.sections?.findIndex(section => section?.linear !== 'no');
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
  if (session.navigationInFlight) {
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
    if (session.navigationInFlight) {
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
  if (runtimeState === 'probing') return;
  if (command.type === 'open') void open(command);
  else void handleCurrentCommand(command);
}

${
  native
    ? ''
    : `export const __hnBootstrapTestHooks = {
  finalizeEngine,
  receiveMessage,
  completeProbeResult,
  buildPublicationModel,
  navigate,
  probeEmbeddedEnforcement,
  validatePublicationModel,
  getActiveSession: () => activeSession,
  getProbeState: () => ({ probeResult, probeBinding, runtimeState }),
  resetProbeState: ({
    result = 'pending',
    state = result === 'passed' ? 'fresh' : result === 'failed' ? 'disposed' : 'probing',
  } = {}) => {
    probeResult = result;
    runtimeState = state;
    probeBinding = null;
    activeSession = null;
  },
  activateTestSession: (session) => {
    activeSession = session;
    runtimeState = 'live';
  },
  setModelTestTimeouts: (value) => {
    modelTestTimeouts = value;
  },
  setModelTestClock: (value) => {
    modelTestClock = value;
  },
};`
}


${
  native
    ? `export function installNativeRenderer(sink) {
  if (nativeEventSink) throw new Error('Renderer already installed');
  nativeEventSink = sink;
  void probeEmbeddedEnforcement().then(completeProbeResult).catch(() => completeProbeResult(false));
  return value => {
    const command = parseCommand(value);
    if (!command) return;
    if (command.type === 'probe') handleProbe(command);
    else if (command.type === 'open') void open(command);
    else void handleCurrentCommand(command);
  };
}`
    : `if (typeof window !== 'undefined') {
  window.addEventListener('message', receiveMessage);

  void probeEmbeddedEnforcement()
    .then(completeProbeResult)
    .catch(() => completeProbeResult(false));
}`
}

`;
}

const pathExists = async (candidate) => {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

function removePdfAdapter(source) {
  const withoutPdfDetector = source.replace(
    /const isPDF = async file => \{[\s\S]*?\n\}\n\nconst isCBZ/m,
    'const isCBZ',
  );
  const withoutPdfAdapter = withoutPdfDetector.replace(
    /\n {4}else if \(await isPDF\(file\)\) \{\n {8}const \{ makePDF \} = await import\('\.\/pdf\.js'\)\n {8}book = await makePDF\(file\)\n {4}\}/,
    '',
  );
  if (
    withoutPdfAdapter === source ||
    withoutPdfAdapter.includes("import('./pdf.js')") ||
    withoutPdfAdapter.includes('isPDF')
  ) {
    throw new Error(
      'Foliate view.js PDF adapter removal did not match upstream',
    );
  }
  return withoutPdfAdapter;
}

function removeOutOfScopeFeatures(source) {
  let transformed = removePdfAdapter(source);
  const transforms = [
    [
      /import \{ textWalker \} from '\.\/text-walker\.js'\n/,
      '',
      "static import './text-walker.js'",
    ],
    [
      / {4}#searchResults = new Map\(\)\n {4}#searchDraw\n {4}#searchDrawOptions\n/,
      '',
      'search state fields',
    ],
    [/ {8}this\.#searchResults = new Map\(\)\n/, '', 'search reset'],
    [
      / {8}const list = this\.#searchResults\.get\(index\)\n {8}if \(list\) for \(const item of list\) this\.addAnnotation\(item\)\n/,
      '',
      'search overlay restoration',
    ],
    [
      / {12}if \(value && !value\.startsWith\(SEARCH_PREFIX\)\) \{\n/,
      '            if (value) {\n',
      'search overlay click filter',
    ],
    [
      / {8}if \(value\.startsWith\(SEARCH_PREFIX\)\) \{[\s\S]*?\n {8}\}\n/,
      '',
      'search annotation branch',
    ],
    [
      / {4}async \* #searchSection\([\s\S]*?\n {4}clearSearch\(\) \{[\s\S]*?\n {4}\}\n/,
      '',
      'search implementation',
    ],
    [/ {4}async initTTS\([\s\S]*?\n {4}\}\n/, '', 'TTS implementation'],
    [/const SEARCH_PREFIX = 'foliate-search:'\n\n/, '', 'search prefix'],
  ];
  for (const [pattern, replacement, description] of transforms) {
    if (!pattern.test(transformed)) {
      throw new Error(
        `Foliate view.js ${description} removal did not match upstream`,
      );
    }
    transformed = transformed.replace(pattern, replacement);
  }
  for (const forbidden of [
    "import('./pdf.js')",
    "import('./search.js')",
    "import('./tts.js')",
    'isPDF',
    'textWalker',
    '#searchResults',
    '#searchDraw',
    '#searchDrawOptions',
    'SEARCH_PREFIX',
    'initTTS',
  ]) {
    if (transformed.includes(forbidden)) {
      throw new Error(
        `Foliate view.js retains out-of-scope feature marker: ${forbidden}`,
      );
    }
  }
  return transformed;
}

function installPublicationCspIntoRenderer(source, relativePath) {
  if (relativePath === 'paginator.js') {
    const cancellationHelper = `export const __hnCancelPendingIframeLoad = (iframe, pending) => {
    if (!pending) return false
    pending.cleanup()
    iframe.src = 'about:blank'
    pending.reject(new Error('HN_FOLIATE_LOAD_CANCELLED'))
    return true
}
export const __hnCreateRendererCancellation = () => {
    let reject
    const promise = new Promise((_, rejectFn) => { reject = rejectFn })
    promise.catch(() => undefined)
    return { promise, reject }
}
export const __hnRaceRendererLoad = (load, cancellation) =>
    cancellation ? Promise.race([load, cancellation.promise]) : load
export const __hnTrackRendererLoad = (renderer, section) => {
    if (!section?.load) return Promise.resolve(undefined)
    renderer.__hnTrackedSections.add(section)
    let raw
    try { raw = Promise.resolve(section.load()) }
    catch (error) { raw = Promise.reject(error) }
    renderer.__hnRawLoads.add(raw)
    raw.then(
        () => { if (renderer.__hnInvalidated) __hnCleanupSection(renderer, section) },
        () => undefined,
    ).finally(() => renderer.__hnRawLoads.delete(raw)).catch(() => undefined)
    return raw
}
export const __hnCleanupSection = (renderer, section) => {
    if (!section || renderer.__hnCleanedSections.has(section)) return
    renderer.__hnCleanedSections.add(section)
    section.unload?.()
}
export const __hnInvalidateRendererLoads = renderer => {
    if (renderer.__hnInvalidated) return false
    renderer.__hnInvalidated = true
    for (const section of renderer.__hnTrackedSections) {
        section.invalidate?.()
        __hnCleanupSection(renderer, section)
    }
    return true
}

`;
    const anchor = 'container: this,';
    const constructorAnchor = 'constructor({ container, onExpand }) {';
    const replacement =
      "container: this,\n            publicationCsp: this.getAttribute('data-foliate-publication-csp'),";
    const cleanupAnchor = `    destroy() {
        this.#observer.unobserve(this)
        this.#view.destroy()
        this.#view = null
        this.sections[this.#index]?.unload?.()
        this.#mediaQuery.removeEventListener('change', this.#mediaQueryListener)
    }`;
    const cleanupReplacement = `    destroy() {
        this.cancelPendingLoad()
        this.#observer.disconnect()
        this.#view?.destroy?.()
        this.#view = null
        this.sections[this.#index]?.unload?.()
        this.#mediaQuery?.removeEventListener?.('change', this.#mediaQueryListener)
    }`;
    if (!source.includes(anchor) || !source.includes(constructorAnchor)) {
      throw new Error(
        'Foliate paginator.js CSP injection did not match upstream',
      );
    }
    const pendingLoadAnchor = `    get document() {
        return this.#iframe.contentDocument
    }
    async load(src, afterLoad, beforeRender) {`;
    const pendingLoadReplacement = `    get document() {
        return this.#iframe.contentDocument
    }
    cancelPendingLoad() {
        const pending = this.__hnPendingLoad
        if (!pending) return
        this.__hnPendingLoad = null
        __hnCancelPendingIframeLoad(this.#iframe, pending)
    }
    async load(src, afterLoad, beforeRender) {`;
    const loadStart = `        return new Promise(resolve => {
            this.#iframe.addEventListener('load', () => {`;
    const loadStartReplacement = `        return new Promise((resolve, reject) => {
            this.cancelPendingLoad()
            const onLoad = () => {`;
    const loadEnd = `                resolve()
            }, { once: true })
            this.#iframe.src = src
        })`;
    const loadEndReplacement = `                this.__hnPendingLoad = null
                cleanup()
                resolve()
            }
            const onError = () => {
                this.__hnPendingLoad = null
                cleanup()
                reject(new Error('HN_FOLIATE_LOAD_ERROR'))
            }
            const cleanup = () => {
                this.#iframe.removeEventListener('load', onLoad)
                this.#iframe.removeEventListener('error', onError)
            }
            this.__hnPendingLoad = { reject, cleanup }
            this.#iframe.addEventListener('load', onLoad, { once: true })
            this.#iframe.addEventListener('error', onError, { once: true })
            this.#iframe.src = src
        })`;
    const fieldsAnchor = '    #lastVisibleRange\n';
    const outerCancel = `    cancelPendingLoad() {
        this.__hnCancelled = true
        this.invalidatePendingLoads()
        this.__hnCancellation?.reject(new Error('HN_FOLIATE_LOAD_CANCELLED'))
        this.#view?.cancelPendingLoad?.()
    }
    __hnTrackSectionLoad(section) {
        return __hnTrackRendererLoad(this, section)
    }
    invalidatePendingLoads() {
        __hnInvalidateRendererLoads(this)
    }
`;
    const outerDisplayAnchor = `    async #display(promise) {
        const { index, src, anchor, onLoad, select } = await promise`;
    const outerDisplayReplacement = `    async #display(promise) {
        const { index, src, anchor, onLoad, select } = await promise
        if (this.__hnCancelled) throw new Error('HN_FOLIATE_LOAD_CANCELLED')`;
    const outerCreateViewAnchor = '    #createView() {';
    const outerCreateViewReplacement = `    #createView() {
        if (this.__hnCancelled) throw new Error('HN_FOLIATE_LOAD_CANCELLED')`;
    const openAnchor = `    open(book) {
        this.bookDir = book.dir`;
    const openReplacement = `    open(book) {
        this.__hnCancelled = false
        this.__hnCancellation = __hnCreateRendererCancellation()
        this.bookDir = book.dir`;
    const sectionLoadAnchor = `            await this.#display(Promise.resolve(this.sections[index].load())
                .then(src => ({ index, src, anchor, onLoad, select }))`;
    const sectionLoadReplacement = `            await this.#display(__hnRaceRendererLoad(this.__hnTrackSectionLoad(this.sections[index]), this.__hnCancellation)
                .then(src => ({ index, src, anchor, onLoad, select }))`;
    const sectionLoadCatchAnchor = `                .catch(e => {
                    console.warn(e)
                    console.warn(new Error(\`Failed to load section \${index}\`))
                    return {}
                }))`;
    const sectionLoadCatchReplacement = `                .catch(e => {
                    if (e?.message === 'HN_FOLIATE_LOAD_CANCELLED') throw e
                    console.warn(e)
                    console.warn(new Error(\`Failed to load section \${index}\`))
                    return {}
                }))`;
    if (
      !source.includes(pendingLoadAnchor) ||
      !source.includes(loadStart) ||
      !source.includes(loadEnd) ||
      !source.includes(fieldsAnchor) ||
      !source.includes(outerDisplayAnchor) ||
      !source.includes(outerCreateViewAnchor) ||
      !source.includes(openAnchor) ||
      !source.includes(sectionLoadAnchor) ||
      !source.includes(sectionLoadCatchAnchor)
    ) {
      throw new Error(
        'Foliate paginator.js cancellable load injection did not match upstream',
      );
    }
    return (
      cancellationHelper +
      source
        .replace(anchor, replacement)
        .replace(
          constructorAnchor,
          'constructor({ container, onExpand, publicationCsp }) {',
        )
        .replace(
          "this.#iframe.setAttribute('part', 'filter')",
          "this.#iframe.setAttribute('part', 'filter')\n        this.#iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')\n        if (publicationCsp) this.#iframe.setAttribute('csp', publicationCsp)",
        )
        .replace(cleanupAnchor, cleanupReplacement)
        .replace(pendingLoadAnchor, pendingLoadReplacement)
        .replace(loadStart, loadStartReplacement)
        .replace(loadEnd, loadEndReplacement)
        .replace(
          fieldsAnchor,
          `${fieldsAnchor}    __hnCancelled = false\n    __hnInvalidated = false\n    __hnCancellation\n    __hnRawLoads = new Set()\n    __hnTrackedSections = new Set()\n    __hnCleanedSections = new WeakSet()\n`,
        )
        .replace(openAnchor, openReplacement)
        .replace(sectionLoadAnchor, sectionLoadReplacement)
        .replace(sectionLoadCatchAnchor, sectionLoadCatchReplacement)
        .replace(outerCreateViewAnchor, outerCreateViewReplacement)
        .replace(outerDisplayAnchor, outerDisplayReplacement)
        .replace(
          '    #beforeRender({ vertical, rtl, background }) {',
          outerCancel + '    #beforeRender({ vertical, rtl, background }) {',
        )
    );
  }
  if (relativePath === 'fixed-layout.js') {
    const cancellationHelper = `export const __hnCancelPendingIframeLoad = (iframe, pending) => {
    if (!pending) return false
    pending.cleanup()
    iframe.src = 'about:blank'
    pending.reject(new Error('HN_FOLIATE_LOAD_CANCELLED'))
    return true
}
export const __hnCreateRendererCancellation = () => {
    let reject
    const promise = new Promise((_, rejectFn) => { reject = rejectFn })
    promise.catch(() => undefined)
    return { promise, reject }
}
export const __hnRaceRendererLoad = (load, cancellation) =>
    cancellation ? Promise.race([load, cancellation.promise]) : load
export const __hnTrackRendererLoad = (renderer, section) => {
    if (!section?.load) return Promise.resolve(undefined)
    renderer.__hnTrackedSections.add(section)
    let raw
    try { raw = Promise.resolve(section.load()) }
    catch (error) { raw = Promise.reject(error) }
    renderer.__hnRawLoads.add(raw)
    raw.then(
        () => { if (renderer.__hnInvalidated) __hnCleanupSection(renderer, section) },
        () => undefined,
    ).finally(() => renderer.__hnRawLoads.delete(raw)).catch(() => undefined)
    return raw
}
export const __hnCleanupSection = (renderer, section) => {
    if (!section || renderer.__hnCleanedSections.has(section)) return
    renderer.__hnCleanedSections.add(section)
    section.unload?.()
}
export const __hnInvalidateRendererLoads = renderer => {
    if (renderer.__hnInvalidated) return false
    renderer.__hnInvalidated = true
    for (const section of renderer.__hnTrackedSections) {
        section.invalidate?.()
        __hnCleanupSection(renderer, section)
    }
    return true
}

`;
    const anchor = "const iframe = document.createElement('iframe')";
    if (!source.includes(anchor)) {
      throw new Error(
        'Foliate fixed-layout.js CSP injection did not match upstream',
      );
    }
    const pendingAnchor = '    #zoom\n';
    const createStart = `        return new Promise(resolve => {
            iframe.addEventListener('load', () => {`;
    const createStartReplacement = `        return new Promise((resolve, reject) => {
            let settled = false
            const cleanup = () => {
                iframe.removeEventListener('load', onLoad)
                iframe.removeEventListener('error', onError)
                this.__hnPendingFrames.delete(cancel)
            }
            const cancel = () => {
                if (settled) return
                settled = true
                __hnCancelPendingIframeLoad(iframe, { cleanup, reject })
                element.remove()
            }
            const onLoad = () => {`;
    const createEnd = `                resolve({
                    element, iframe,
                    width: parseFloat(width),
                    height: parseFloat(height),
                    onZoom,
                })
            }, { once: true })
            iframe.src = src
        })`;
    const createEndReplacement = `                if (settled) return
                settled = true
                cleanup()
                resolve({
                    element, iframe,
                    width: parseFloat(width),
                    height: parseFloat(height),
                    onZoom,
                })
            }
            const onError = () => cancel()
            this.__hnPendingFrames.add(cancel)
            iframe.addEventListener('load', onLoad, { once: true })
            iframe.addEventListener('error', onError, { once: true })
            iframe.src = src
        })`;
    const destroyAnchor = `    destroy() {
        this.#observer.unobserve(this)
    }`;
    const destroyReplacement = `    cancelPendingLoad() {
        this.__hnCancelled = true
        this.invalidatePendingLoads()
        this.__hnCancellation?.reject(new Error('HN_FOLIATE_LOAD_CANCELLED'))
        for (const cancel of this.__hnPendingFrames) cancel()
    }
    __hnTrackSectionLoad(section) {
        return __hnTrackRendererLoad(this, section)
    }
    invalidatePendingLoads() {
        __hnInvalidateRendererLoads(this)
    }
    destroy() {
        this.cancelPendingLoad()
        this.#observer.disconnect()
        this.#root.replaceChildren()
    }`;
    if (
      !source.includes(pendingAnchor) ||
      !source.includes(createStart) ||
      !source.includes(createEnd) ||
      !source.includes(destroyAnchor)
    ) {
      throw new Error(
        'Foliate fixed-layout.js cancellable load injection did not match upstream',
      );
    }
    return (
      cancellationHelper +
      source
        .replace(
          anchor,
          `${anchor}\n        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')\n        const publicationCsp = this.getAttribute('data-foliate-publication-csp')\n        if (publicationCsp) iframe.setAttribute('csp', publicationCsp)`,
        )
        .replace(
          pendingAnchor,
          '    #zoom\n    __hnPendingFrames = new Set()\n    __hnCancelled = false\n    __hnInvalidated = false\n    __hnCancellation\n    __hnRawLoads = new Set()\n    __hnTrackedSections = new Set()\n    __hnCleanedSections = new WeakSet()\n',
        )
        .replace(createStart, createStartReplacement)
        .replace(createEnd, createEndReplacement)
        .replace(
          '    open(book) {\n        this.book = book',
          '    open(book) {\n        this.__hnCancelled = false\n        this.__hnInvalidated = false\n        this.__hnCancellation = __hnCreateRendererCancellation()\n        this.book = book',
        )
        .replace(
          '    async goToSpread(index, side, reason) {\n        if (index < 0 || index > this.#spreads.length - 1) return',
          "    async goToSpread(index, side, reason) {\n        if (this.__hnCancelled) throw new Error('HN_FOLIATE_LOAD_CANCELLED')\n        if (index < 0 || index > this.#spreads.length - 1) return",
        )
        .replace(
          '            const src = await spread.center?.load?.()\n            await this.#showSpread({ center: { index, src } })',
          "            const src = await __hnRaceRendererLoad(this.__hnTrackSectionLoad(spread.center), this.__hnCancellation)\n            if (this.__hnCancelled) throw new Error('HN_FOLIATE_LOAD_CANCELLED')\n            await this.#showSpread({ center: { index, src } })",
        )
        .replace(
          '            const srcL = await spread.left?.load?.()\n            const srcR = await spread.right?.load?.()\n            const left = { index: indexL, src: srcL }',
          "            const srcL = await __hnRaceRendererLoad(this.__hnTrackSectionLoad(spread.left), this.__hnCancellation)\n            if (this.__hnCancelled) throw new Error('HN_FOLIATE_LOAD_CANCELLED')\n            const srcR = await __hnRaceRendererLoad(this.__hnTrackSectionLoad(spread.right), this.__hnCancellation)\n            if (this.__hnCancelled) throw new Error('HN_FOLIATE_LOAD_CANCELLED')\n            const left = { index: indexL, src: srcL }",
        )
        .replace(
          '    async goTo(target) {\n        const { book } = this',
          "    async goTo(target) {\n        if (this.__hnCancelled) throw new Error('HN_FOLIATE_LOAD_CANCELLED')\n        const { book } = this",
        )
        .replace(destroyAnchor, destroyReplacement)
    );
  }
  return source;
}

function passPublicationCspToRenderer(source) {
  const anchor =
    "this.renderer.setAttribute('exportparts', 'head,foot,filter')";
  if (!source.includes(anchor)) {
    throw new Error('Foliate view.js CSP propagation did not match upstream');
  }
  return source.replace(
    anchor,
    `${anchor}\n        const publicationCsp = this.getAttribute('data-foliate-publication-csp')\n        if (publicationCsp) this.renderer.setAttribute('data-foliate-publication-csp', publicationCsp)`,
  );
}

function installMobiLateSectionCleanup(source) {
  const helper = `export const __hnCommitObjectUrl = (owner, cache, key, url) => {
    if (owner.__hnInvalidated) {
        URL.revokeObjectURL(url)
        throw new Error('HN_FOLIATE_LOAD_CANCELLED')
    }
    cache.set(key, url)
    return url
}
export const __hnCommitInlineResource = (owner, inlineMap, url, inline) => {
    if (owner.__hnInvalidated) throw new Error('HN_FOLIATE_LOAD_CANCELLED')
    inlineMap.set(url, inline)
    return url
}

`;
  const sectionLoad = 'load: () => this.loadSection(section),';
  const sectionReplacement = `${sectionLoad}\n                unload: () => this.unloadSection(section),\n                invalidate: () => this.invalidate(),`;
  const classicFields = `    #resourceCache = new Map()
    #textCache = new Map()
    #cache = new Map()`;
  const classicCommit = `        const url = URL.createObjectURL(new Blob([result], { type: this.#type }))
        this.#cache.set(section, url)`;
  const classicResourceCommit = `        const url = URL.createObjectURL(new Blob([raw]))
        this.#resourceCache.set(index, url)`;
  const classicResolve = '    resolveHref(href) {';
  const classicMethods = `    invalidate() {
        this.__hnInvalidated = true
        for (const url of this.#resourceCache.values()) URL.revokeObjectURL(url)
        for (const url of this.#cache.values()) URL.revokeObjectURL(url)
        this.#resourceCache.clear()
        this.#cache.clear()
    }
    unloadSection(section) {
        const url = this.#cache.get(section)
        if (url) URL.revokeObjectURL(url)
        this.#cache.delete(section)
    }
    resolveHref(href) {`;
  const kf8Fields = '    #cache = new Map()';
  const kf8Commit = `        const url = URL.createObjectURL(
            new Blob([this.serializer.serializeToString(doc)], { type: this.#type }))
        this.#cache.set(section, url)`;
  const kf8ResourceCommit = `        const url = inline ? str : URL.createObjectURL(blob)
        if (inline) this.#inlineMap.set(url, inline)
        this.#cache.set(str, url)`;
  const kf8LoadResource = `        const [blob, inline] = await this.loadResourceBlob(str)`;
  const kf8LoadResourceReplacement = `        const [blob, inline] = await (this.__hnTestLoadResourceBlob?.(str) ?? this.loadResourceBlob(str))`;
  const kf8Resolve = '    async resolveHref(href) {';
  const kf8Methods = `    invalidate() {
        this.__hnInvalidated = true
        for (const url of this.#cache.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url)
        this.#cache.clear()
        this.#inlineMap.clear()
    }
    unloadSection(section) {
        const url = this.#cache.get(section)
        if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
        this.#cache.delete(section)
    }
    __hnTestCommitInline(url, inline) {
        return __hnCommitInlineResource(this, this.#inlineMap, url, inline)
    }
    __hnTestInlineSize() {
        return this.#inlineMap.size
    }
    __hnTestSetLoadResourceBlob(loader) {
        this.__hnTestLoadResourceBlob = loader
    }
    async resolveHref(href) {`;
  if (
    !source.includes('class MOBI6 {') ||
    !source.includes('class KF8 {') ||
    !source.includes(classicFields) ||
    !source.includes(classicCommit) ||
    !source.includes(classicResourceCommit) ||
    !source.includes(classicResolve) ||
    !source.includes(kf8Fields) ||
    !source.includes(kf8Commit) ||
    !source.includes(kf8ResourceCommit) ||
    !source.includes(kf8LoadResource) ||
    !source.includes(kf8Resolve)
  ) {
    throw new Error(
      'Foliate mobi.js class-specific invalidation injection did not match upstream',
    );
  }
  return (
    helper +
    source
      .replace('class MOBI6 {', 'export class MOBI6 {')
      .replace('class KF8 {', 'export class KF8 {')
      .replaceAll(sectionLoad, sectionReplacement)
      .replace(classicFields, `${classicFields}\n    __hnInvalidated = false`)
      .replace(
        classicResourceCommit,
        `        const url = URL.createObjectURL(new Blob([raw]))
        __hnCommitObjectUrl(this, this.#resourceCache, index, url)`,
      )
      .replace(
        classicCommit,
        `        const url = URL.createObjectURL(new Blob([result], { type: this.#type }))
        __hnCommitObjectUrl(this, this.#cache, section, url)`,
      )
      .replace(classicResolve, classicMethods)
      .replace(kf8Fields, `${kf8Fields}\n    __hnInvalidated = false`)
      .replace(
        kf8ResourceCommit,
        `        const url = inline ? str : URL.createObjectURL(blob)
        if (inline) __hnCommitInlineResource(this, this.#inlineMap, url, inline)
        else __hnCommitObjectUrl(this, this.#cache, str, url)`,
      )
      .replace(kf8LoadResource, kf8LoadResourceReplacement)
      .replace(
        kf8Commit,
        `        const url = URL.createObjectURL(
            new Blob([this.serializer.serializeToString(doc)], { type: this.#type }))
        __hnCommitObjectUrl(this, this.#cache, section, url)`,
      )
      .replace(kf8Resolve, kf8Methods)
  );
}

function installLateSectionCleanup(source, relativePath) {
  if (relativePath === 'fixed-layout.js') {
    const original = `        if (index === this.#index) {
            this.#render(side)
            return
        }`;
    if (!source.includes(original))
      throw new Error(
        'Foliate fixed-layout same-spread navigation injection did not match upstream',
      );
    return source.replace(
      original,
      `        if (index === this.#index) {
            this.#side = side
            this.#render(side)
            this.#reportLocation(reason)
            return
        }`,
    );
  }

  if (relativePath === 'mobi.js') return installMobiLateSectionCleanup(source);
  if (relativePath === 'epub.js') {
    const helper = `export const __hnCommitObjectUrl = (owner, cache, key, url) => {
    if (owner.__hnInvalidated) {
        URL.revokeObjectURL(url)
        throw new Error('HN_FOLIATE_LOAD_CANCELLED')
    }
    cache.set(key, url)
    return url
}

`;
    const loaderFields = '    #refCount = new Map()\n';
    const createUrl = `        const url = URL.createObjectURL(new Blob([newData], { type: newType }))
        this.#cache.set(href, url)`;
    const createUrlReplacement = `        const url = URL.createObjectURL(new Blob([newData], { type: newType }))
        __hnCommitObjectUrl(this, this.#cache, href, url)`;
    const destroy = `    destroy() {
        for (const url of this.#cache.values()) URL.revokeObjectURL(url)
    }`;
    const destroyReplacement = `    invalidate() {
        this.__hnInvalidated = true
        this.destroy()
    }
    destroy() {
        for (const url of this.#cache.values()) URL.revokeObjectURL(url)
        this.#cache.clear()
    }`;
    const section = `                unload: () => this.#loader.unloadItem(item),`;
    const sectionReplacement = `                unload: () => this.#loader.unloadItem(item),
                invalidate: () => this.#loader.invalidate(),`;
    if (
      !source.includes(loaderFields) ||
      !source.includes(createUrl) ||
      !source.includes(destroy) ||
      !source.includes(section)
    ) {
      throw new Error(
        'Foliate epub.js late commit invalidation injection did not match upstream',
      );
    }
    return (
      helper +
      source
        .replace(loaderFields, `${loaderFields}    __hnInvalidated = false\n`)
        .replace(createUrl, createUrlReplacement)
        .replace(destroy, destroyReplacement)
        .replace(section, sectionReplacement)
    );
  }
  if (relativePath === 'comic-book.js') {
    const helper = `export const __hnCommitComicUrls = (book, cache, urls, name, src, page) => {
    if (book.__hnInvalidated) {
        URL.revokeObjectURL(src)
        URL.revokeObjectURL(page)
        throw new Error('HN_FOLIATE_LOAD_CANCELLED')
    }
    urls.set(name, [src, page])
    cache.set(name, page)
    return page
}

`;
    const fields = `    const cache = new Map()
    const urls = new Map()`;
    const create = `        const src = URL.createObjectURL(await loadBlob(name))
        const page = URL.createObjectURL(`;
    const createReplacement = `        const imageTypes = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', jxl: 'image/jxl' }
        const src = URL.createObjectURL(await loadBlob(name, imageTypes[name.split('.').at(-1)]))
        if (book.__hnInvalidated) {
            URL.revokeObjectURL(src)
            throw new Error('HN_FOLIATE_LOAD_CANCELLED')
        }
        const page = URL.createObjectURL(`;
    const commit = `        urls.set(name, [src, page])
        cache.set(name, page)`;
    const commitReplacement = `        __hnCommitComicUrls(book, cache, urls, name, src, page)`;
    const destroy = `    book.destroy = () => {
        for (const arr of urls.values())
            for (const url of arr) URL.revokeObjectURL(url)
    }`;
    const destroyReplacement = `    const releaseResources = () => {
        for (const arr of urls.values())
            for (const url of arr) URL.revokeObjectURL(url)
        urls.clear()
        cache.clear()
    }
    book.invalidate = () => {
        book.__hnInvalidated = true
        releaseResources()
    }
    book.destroy = () => {
        releaseResources()
    }`;
    const section = `        unload: () => unload(name),`;
    const sectionReplacement = `        unload: () => unload(name),
        invalidate: () => book.invalidate(),`;
    if (
      !source.includes(fields) ||
      !source.includes(create) ||
      !source.includes(commit) ||
      !source.includes(destroy) ||
      !source.includes(section)
    ) {
      throw new Error(
        'Foliate comic-book.js late commit invalidation injection did not match upstream',
      );
    }
    const bookAnchor = '    const book = {}';
    if (!source.includes(bookAnchor)) {
      throw new Error(
        'Foliate comic-book.js book initialization did not match upstream',
      );
    }
    return (
      helper +
      source
        .replace(fields, fields)
        .replace(bookAnchor, `${bookAnchor}\n    book.__hnInvalidated = false`)
        .replace(create, createReplacement)
        .replace(commit, commitReplacement)
        .replace(destroy, destroyReplacement)
        .replace(section, sectionReplacement)
    );
  }
  if (relativePath !== 'mobi.js') return source;
  const helper = `export const __hnCommitObjectUrl = (owner, cache, key, url) => {
    if (owner.__hnInvalidated) {
        URL.revokeObjectURL(url)
        throw new Error('HN_FOLIATE_LOAD_CANCELLED')
    }
    cache.set(key, url)
    return url
}

`;
  const sectionLoad = 'load: () => this.loadSection(section),';
  const sectionLoadReplacement = `${sectionLoad}\n                unload: () => this.unloadSection(section),\n                invalidate: () => this.unloadSection(section),`;
  const resolveHref = '    resolveHref(href) {';
  const unloadSection = `    unloadSection(section) {
        const url = this.#cache.get(section)
        if (url) URL.revokeObjectURL(url)
        this.#cache.delete(section)
    }
    resolveHref(href) {`;
  const cacheFields = '#cache = new Map()\n';
  const classicCommit = `        const url = URL.createObjectURL(new Blob([result], { type: this.#type }))
        this.#cache.set(section, url)`;
  const classicCommitReplacement = `        const url = URL.createObjectURL(new Blob([result], { type: this.#type }))
        __hnCommitObjectUrl(this, this.#cache, section, url)`;
  const kf8Commit = `        const url = URL.createObjectURL(
            new Blob([this.serializer.serializeToString(doc)], { type: this.#type }))
        this.#cache.set(section, url)`;
  const kf8CommitReplacement = `        const url = URL.createObjectURL(
            new Blob([this.serializer.serializeToString(doc)], { type: this.#type }))
        __hnCommitObjectUrl(this, this.#cache, section, url)`;
  const classicResourceCommit = `        const url = URL.createObjectURL(new Blob([raw]))
        this.#resourceCache.set(index, url)`;
  const classicResourceCommitReplacement = `        const url = URL.createObjectURL(new Blob([raw]))
        __hnCommitObjectUrl(this, this.#resourceCache, index, url)`;
  const kf8LoadResource = `    async loadResource(str) {
        if (this.#cache.has(str)) return this.#cache.get(str)
        const [blob, inline] = await (this.__hnTestLoadResourceBlob?.(str) ?? this.loadResourceBlob(str))
        const url = inline ? str : URL.createObjectURL(blob)
        if (inline) this.#inlineMap.set(url, inline)
        if (!inline) __hnCommitObjectUrl(this, this.#cache, str, url)
        else if (this.__hnInvalidated) throw new Error('HN_FOLIATE_LOAD_CANCELLED')
        else this.#cache.set(str, url)
        return url
    }`;
  const kf8LoadResourceReplacement = `    async loadResource(str) {
        if (this.#cache.has(str)) return this.#cache.get(str)
        const [blob, inline] = await (this.__hnTestLoadResourceBlob?.(str) ?? this.loadResourceBlob(str))
        const url = inline ? str : URL.createObjectURL(blob)
        if (inline) __hnCommitInlineResource(this, this.#inlineMap, url, inline)
        else __hnCommitObjectUrl(this, this.#cache, str, url)
        return url
    }`;
  if (
    !source.includes(sectionLoad) ||
    source.split(resolveHref).length !== 2 ||
    source.split(cacheFields).length !== 3 ||
    !source.includes(classicCommit) ||
    !source.includes(kf8Commit) ||
    !source.includes(classicResourceCommit) ||
    !source.includes(kf8LoadResource)
  ) {
    throw new Error(
      'Foliate mobi.js late section cleanup injection did not match upstream',
    );
  }
  return (
    helper +
    source
      .replaceAll(sectionLoad, sectionLoadReplacement)
      .replace(kf8LoadResource, kf8LoadResourceReplacement)
      .replaceAll(cacheFields, `${cacheFields}    __hnInvalidated = false\n`)
      .replace(classicCommit, classicCommitReplacement)
      .replace(kf8Commit, kf8CommitReplacement)
      .replace(classicResourceCommit, classicResourceCommitReplacement)
      .replaceAll(resolveHref, unloadSection)
  );
}

async function writeRuntimeAsset({ definition, sourceRoot, destinationRoot }) {
  const [relativePath, category, license, upstream, version] = definition;
  if (forbiddenPath(relativePath)) {
    throw new Error(
      `Refusing to stage forbidden Foliate asset: ${relativePath}`,
    );
  }

  const sourcePath = path.join(sourceRoot, relativePath);
  const source = await readFile(sourcePath);
  const staged =
    relativePath === 'view.js'
      ? Buffer.from(removeOutOfScopeFeatures(source.toString('utf8')))
      : source;
  const destinationPath = path.join(destinationRoot, relativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, staged);
  return {
    category,
    license,
    path: relativePath,
    sourcePath: `vendor/foliate-js/${relativePath}`,
    sourceSha256: sha256(source),
    sourceSize: source.length,
    stagedSha256: sha256(staged),
    stagedSize: staged.length,
    ...(upstream ? { upstream, version } : {}),
  };
}

async function writeGeneratedAsset({
  destinationRoot,
  relativePath,
  contents,
  metadata,
}) {
  const destinationPath = path.join(destinationRoot, relativePath);
  const staged = Buffer.from(contents);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, staged);
  return {
    path: relativePath,
    sourcePath: metadata.sourcePath,
    sourceSha256: sha256(staged),
    sourceSize: staged.length,
    stagedSha256: sha256(staged),
    stagedSize: staged.length,
    ...metadata,
  };
}

async function writeWebAsset({
  destinationRoot,
  relativePath,
  contents,
  source,
}) {
  const destinationPath = path.join(destinationRoot, relativePath);
  const staged = Buffer.from(contents);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, staged);
  return {
    path: relativePath,
    sha256: sha256(staged),
    size: staged.length,
    source,
  };
}

const nativeMimeType = (relativePath) => {
  if (relativePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (relativePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (relativePath.endsWith('.png')) return 'image/png';
  if (relativePath.endsWith('.txt') || relativePath.endsWith('/LICENSE')) {
    return 'text/plain; charset=utf-8';
  }
  throw new Error(
    `Foliate native runtime has no explicit MIME type: ${relativePath}`,
  );
};

async function writeNativeAsset({
  destinationRoot,
  relativePath,
  contents,
  source,
  category,
  license,
}) {
  const asset = await writeWebAsset({
    destinationRoot,
    relativePath,
    contents,
    source,
  });
  return {
    ...asset,
    category,
    license,
    mimeType: nativeMimeType(relativePath),
  };
}

async function createWebRuntimeStage({ sourceRoot, destinationRoot }) {
  const cspSource = await readFoliateCspPolicies();
  const hostPolicy = stringifyCspPolicy(cspSource, 'host');
  const publicationPolicy = stringifyCspPolicy(cspSource, 'publication');
  const assets = [];
  for (const definition of assetDefinitions) {
    const [relativePath] = definition;
    const source = await readFile(path.join(sourceRoot, relativePath));
    const contents = Buffer.from(
      relativePath === 'view.js'
        ? passPublicationCspToRenderer(
            removeOutOfScopeFeatures(source.toString('utf8')),
          )
        : installLateSectionCleanup(
            installPublicationCspIntoRenderer(
              source.toString('utf8'),
              relativePath,
            ),
            relativePath,
          ),
    );
    const sourceHash = sha256(source);
    assets.push(
      await writeWebAsset({
        destinationRoot,
        relativePath: `foliate/${relativePath}`,
        contents,
        source: `vendor/foliate-js/${relativePath}#sha256=${sourceHash}`,
      }),
    );
  }
  assets.push(
    await writeWebAsset({
      destinationRoot,
      relativePath: 'reader.html',
      contents: createWebReaderHtml(hostPolicy),
      source: `generated:foliate-web-reader-html-${hostPolicy.version}`,
    }),
    await writeWebAsset({
      destinationRoot,
      relativePath: 'bootstrap.js',
      contents: createWebBootstrap(publicationPolicy),
      source: `generated:foliate-web-bootstrap-${publicationPolicy.version}`,
    }),
    await writeWebAsset({
      destinationRoot,
      relativePath: 'probes/csp-1x1.png',
      contents: CSP_PROBE_PNG,
      source: 'generated:foliate-web-csp-probe-png-v1',
    }),
    await writeWebAsset({
      destinationRoot,
      relativePath: 'probes/csp-external-canary.js',
      contents: CSP_PROBE_EXTERNAL_CANARY,
      source: 'generated:foliate-web-csp-probe-external-canary-v1',
    }),
    await writeWebAsset({
      destinationRoot,
      relativePath: 'notices/fflate-MIT.txt',
      contents: FFLATE_LICENSE,
      source: 'generated:fflate-license-v0.8.2',
    }),
    await writeWebAsset({
      destinationRoot,
      relativePath: 'notices/zip.js-BSD-3-Clause.txt',
      contents: ZIP_JS_LICENSE,
      source: 'generated:zip-js-license-v2.8.22',
    }),
  );
  assets.sort((left, right) => codepointCompare(left.path, right.path));
  const manifest = {
    schemaVersion: 1,
    runtime: 'foliate-web',
    runtimeVersion: 'foliate-web-1',
    source: {
      commit: '78914aef4466eb960965702401634c2cb348e9b1',
      repository: 'https://github.com/johnfactotum/foliate-js.git',
    },
    exclusions: [
      'pdf.js',
      'search.js',
      'tts.js',
      'text-walker.js',
      'vendor/pdfjs/',
      'vendor/pdfjs/pdf.worker.mjs',
      'vendor/pdfjs/cmaps/',
      'vendor/pdfjs/standard_fonts/',
    ],
    // The manifest cannot hash itself without becoming recursive. Every copied
    // runtime asset is listed here, and sync copies this manifest verbatim.
    assets,
  };
  await writeFile(
    path.join(destinationRoot, FOLIATE_WEB_RUNTIME_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await assertWebRuntimeClosure({ destinationRoot, manifest });
  return manifest;
}

async function createNativeRuntimeStage({ sourceRoot, destinationRoot }) {
  const cspSource = await readFoliateCspPolicies();
  const hostPolicy = stringifyCspPolicy(cspSource, 'host');
  const publicationPolicy = stringifyCspPolicy(cspSource, 'publication');
  const assets = [];
  for (const definition of assetDefinitions) {
    const [relativePath] = definition;
    const source = await readFile(path.join(sourceRoot, relativePath));
    const contents = Buffer.from(
      relativePath === 'view.js'
        ? passPublicationCspToRenderer(
            removeOutOfScopeFeatures(source.toString('utf8')),
          )
        : installLateSectionCleanup(
            installPublicationCspIntoRenderer(
              source.toString('utf8'),
              relativePath,
            ),
            relativePath,
          ),
    );
    const sourceHash = sha256(source);
    assets.push(
      await writeNativeAsset({
        destinationRoot,
        relativePath: `foliate/${relativePath}`,
        contents,
        source: `vendor/foliate-js/${relativePath}#sha256=${sourceHash}`,
        category:
          relativePath === 'LICENSE' ? 'license-notice' : 'foliate-esm-module',
        license: definition[2],
      }),
    );
  }
  assets.push(
    await writeNativeAsset({
      destinationRoot,
      relativePath: 'reader.html',
      contents: createNativeReaderHtml(hostPolicy),
      source: `generated:foliate-native-reader-html-${hostPolicy.version}`,
      category: 'native-host-document',
      license: 'N/A',
    }),
    await writeNativeAsset({
      destinationRoot,
      relativePath: 'bootstrap.js',
      contents: await createNativeBootstrap(),
      source: `generated:foliate-native-bootstrap-${FOLIATE_NATIVE_HOST_VERSION}`,
      category: 'native-host-bootstrap',
      license: 'N/A',
    }),
    await writeNativeAsset({
      destinationRoot,
      relativePath: 'probes/csp-1x1.png',
      contents: CSP_PROBE_PNG,
      source: 'generated:foliate-native-csp-probe-png-v1',
      category: 'csp-probe-image',
      license: 'CC0-1.0',
    }),
    await writeNativeAsset({
      destinationRoot,
      relativePath: 'probes/csp-external-canary.js',
      contents: CSP_PROBE_EXTERNAL_CANARY,
      source: 'generated:foliate-native-csp-probe-external-canary-v1',
      category: 'csp-probe-script',
      license: 'MIT',
    }),
    await writeNativeAsset({
      destinationRoot,
      relativePath: 'notices/fflate-MIT.txt',
      contents: FFLATE_LICENSE,
      source: 'generated:fflate-license-v0.8.2',
      category: 'license-notice',
      license: 'MIT',
    }),
    await writeNativeAsset({
      destinationRoot,
      relativePath: 'notices/zip.js-BSD-3-Clause.txt',
      contents: ZIP_JS_LICENSE,
      source: 'generated:zip-js-license-v2.8.22',
      category: 'license-notice',
      license: 'BSD-3-Clause',
    }),
  );
  for (const name of [
    'nativeFoliateProtocol',
    'nativePublicationTransfer',
    'publicationFormats',
  ]) {
    const source = await readFile(
      path.join(workspaceRoot, 'packages/native-reader/src', name + '.ts'),
      'utf8',
    );
    const compiled = ts
      .transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
      })
      .outputText.replace(/from '([.][/]\w+)'/g, "from '$1.js'");
    assets.push(
      await writeNativeAsset({
        destinationRoot,
        relativePath: name + '.js',
        contents: compiled,
        source: 'generated:native-protocol-' + name,
        category: 'native-host-bootstrap',
        license: 'N/A',
      }),
    );
  }
  assets.push(
    await writeNativeAsset({
      destinationRoot,
      relativePath: 'renderer.js',
      contents: createWebBootstrap(publicationPolicy, true),
      source: 'generated:native-renderer-v1',
      category: 'native-host-bootstrap',
      license: 'N/A',
    }),
  );
  assets.sort((left, right) => codepointCompare(left.path, right.path));
  const manifest = {
    schemaVersion: 1,
    runtime: 'foliate-native-host',
    hostVersion: FOLIATE_NATIVE_HOST_VERSION,
    targetPlatforms: ['android', 'ios'],
    source: {
      commit: '78914aef4466eb960965702401634c2cb348e9b1',
      repository: 'https://github.com/johnfactotum/foliate-js.git',
    },
    exclusions: [
      'pdf.js',
      'search.js',
      'tts.js',
      'text-walker.js',
      'vendor/pdfjs/',
      'vendor/pdfjs/pdf.worker.mjs',
      'vendor/pdfjs/cmaps/',
      'vendor/pdfjs/standard_fonts/',
    ],
    notices: [
      {
        path: 'foliate/LICENSE',
        license: 'MIT',
        appliesTo: 'foliate/**',
      },
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
    ],
    assets,
  };
  await writeFile(
    path.join(destinationRoot, FOLIATE_NATIVE_RUNTIME_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await assertNativeRuntimeClosure({ destinationRoot, manifest });
  return manifest;
}

async function createRuntimeStage({ sourceRoot, destinationRoot }) {
  const assets = [];
  for (const definition of assetDefinitions) {
    assets.push(
      await writeRuntimeAsset({ definition, sourceRoot, destinationRoot }),
    );
  }
  assets.push(
    await writeGeneratedAsset({
      destinationRoot,
      relativePath: 'LICENSES/fflate-MIT.txt',
      contents: FFLATE_LICENSE,
      metadata: {
        category: 'license-notice',
        license: 'MIT',
        sourcePath: 'https://github.com/101arrowz/fflate/blob/v0.8.2/LICENSE',
        upstream: 'https://github.com/101arrowz/fflate/releases/tag/v0.8.2',
        version: '0.8.2',
      },
    }),
    await writeGeneratedAsset({
      destinationRoot,
      relativePath: 'LICENSES/zip.js-BSD-3-Clause.txt',
      contents: ZIP_JS_LICENSE,
      metadata: {
        category: 'license-notice',
        license: 'BSD-3-Clause',
        sourcePath:
          'https://github.com/gildas-lormeau/zip.js/blob/v2.8.22/LICENSE',
        upstream:
          'https://github.com/gildas-lormeau/zip.js/releases/tag/v2.8.22',
        version: '2.8.22',
      },
    }),
    await writeGeneratedAsset({
      destinationRoot,
      relativePath: 'package.json',
      contents: `${JSON.stringify({ private: true, type: 'module' })}\n`,
      metadata: {
        category: 'runtime-metadata',
        license: 'N/A',
        sourcePath: 'generated:foliate-runtime-package-json',
      },
    }),
  );
  assets.sort((left, right) => codepointCompare(left.path, right.path));
  const manifest = {
    schemaVersion: 1,
    source: {
      commit: '78914aef4466eb960965702401634c2cb348e9b1',
      repository: 'https://github.com/johnfactotum/foliate-js.git',
    },
    exclusions: [
      'pdf.js',
      'vendor/pdfjs/',
      'vendor/pdfjs/pdf.worker.mjs',
      'vendor/pdfjs/cmaps/',
      'vendor/pdfjs/standard_fonts/',
    ],
    assets,
  };
  await writeFile(
    path.join(destinationRoot, FOLIATE_RUNTIME_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

async function listFiles(root, relativePath = '') {
  const directory = path.join(root, relativePath);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    codepointCompare(left.name, right.name),
  )) {
    const nextRelativePath = path.posix.join(relativePath, entry.name);
    if (entry.isDirectory())
      files.push(...(await listFiles(root, nextRelativePath)));
    else if (entry.isFile()) files.push(nextRelativePath);
    else
      throw new Error(
        `Foliate runtime stage has unsupported entry: ${nextRelativePath}`,
      );
  }
  return files;
}

const relativeImportPattern =
  /(?:import\s*(?:[^'"()]+?\s+from\s*)?|import\()['"](\.[^'"]+)['"]/g;

async function assertWebRuntimeClosure({ destinationRoot, manifest }) {
  const assetPaths = new Set(manifest.assets.map((asset) => asset.path));
  for (const requiredPath of [
    'probes/csp-1x1.png',
    'probes/csp-external-canary.js',
  ]) {
    if (!assetPaths.has(requiredPath)) {
      throw new Error(
        `Foliate Web runtime is missing CSP probe asset: ${requiredPath}`,
      );
    }
  }
  const reader = await readFile(
    path.join(destinationRoot, 'reader.html'),
    'utf8',
  );
  const cspOffset = reader.indexOf('http-equiv="Content-Security-Policy"');
  const bootstrapOffset = reader.indexOf(
    '<script type="module" src="./bootstrap.js"></script>',
  );
  if (cspOffset < 0 || bootstrapOffset < 0 || cspOffset > bootstrapOffset) {
    throw new Error(
      'Foliate Web reader.html must declare CSP before bootstrap',
    );
  }
  const bootstrap = await readFile(
    path.join(destinationRoot, 'bootstrap.js'),
    'utf8',
  );
  if (
    /(?:\beval\s*\(|innerHTML|postMessage\([^,]+,\s*['"]\*['"])/.test(bootstrap)
  ) {
    throw new Error(
      'Foliate Web bootstrap contains a prohibited execution path',
    );
  }
  for (const marker of [
    'event.origin !== location.origin || event.source !== parent',
    'FOLIATE_IFRAME_PROTOCOL_VERSION',
    'command.session !== session.session',
    'command.generation !== session.generation',
    'value instanceof Blob',
    'Foliate treats strings as fetchable URLs',
    'event.preventDefault()',
    'try { session.view.close(); } catch {}',
    'try { book.destroy?.(); } catch {}',
    'parent.postMessage({',
    '}, location.origin);',
    'const location = locationDto(view, event.detail)',
    'const { doc, index } = event.detail ?? {};',
    'installPublicationPolicy(doc)',
    'data-foliate-publication-csp',
    'probeEmbeddedEnforcement()',
    "if (strict) frame.setAttribute('csp', FOLIATE_PUBLICATION_CSP)",
    'FOLIATE_PUBLICATION_IFRAME_SANDBOX',
    "frame.setAttribute('sandbox', FOLIATE_PUBLICATION_IFRAME_SANDBOX)",
    'hn-csp-static-probe',
    'hn-csp-external-probe',
    "image.getAttribute('src') !== assets.png",
    "script.getAttribute('src') !== assets.script",
    'image.naturalWidth === 1',
    'image.naturalWidth === 0',
    'URL.revokeObjectURL(probeUrl)',
    'PROBE_TIMEOUT_MS',
    "send('probe-result', binding.session, binding.generation, { passed })",
    "let runtimeState = 'fresh'",
    "runtimeState = 'probing'",
    "runtimeState = 'opening'",
    "runtimeState = 'live'",
    "runtimeState = 'disposing'",
    "runtimeState = 'disposed'",
    'FORMAT_TUPLES',
    'payload.file.type !== tuple.mimeType',
    'session.detached',
    'session.view.renderer?.cancelPendingLoad?.()',
    'view.renderer?.goTo(resolved)',
    "!['opening', 'live'].includes(runtimeState)",
    "['probe', 'open', 'dispose', 'navigate', 'flow']",
    "['probe-result', 'publication-model', 'ready', 'model', 'location', 'error', 'command-ack']",
  ]) {
    if (!bootstrap.includes(marker)) {
      throw new Error(
        `Foliate Web bootstrap is missing protocol marker: ${marker}`,
      );
    }
  }
  for (const rendererPath of [
    'foliate/paginator.js',
    'foliate/fixed-layout.js',
  ]) {
    const renderer = await readFile(
      path.join(destinationRoot, rendererPath),
      'utf8',
    );
    if (!renderer.includes("iframe.setAttribute('csp', publicationCsp)")) {
      throw new Error(
        `Foliate Web renderer is missing initial publication CSP: ${rendererPath}`,
      );
    }
  }
  for (const rendererPath of [
    'foliate/paginator.js',
    'foliate/fixed-layout.js',
  ]) {
    const renderer = await readFile(
      path.join(destinationRoot, rendererPath),
      'utf8',
    );
    if (
      !renderer.includes('cancelPendingLoad()') ||
      !renderer.includes('HN_FOLIATE_LOAD_CANCELLED') ||
      !renderer.includes("src = 'about:blank'")
    ) {
      throw new Error(
        `Foliate Web renderer lacks cancellable startup load: ${rendererPath}`,
      );
    }
  }
  const paginator = await readFile(
    path.join(destinationRoot, 'foliate/paginator.js'),
    'utf8',
  );
  if (
    !paginator.includes('this.#observer.disconnect()') ||
    !paginator.includes('this.#view?.destroy?.()') ||
    paginator.includes('this.#observer.unobserve(this)')
  ) {
    throw new Error('Foliate Web paginator cleanup guard is missing');
  }
  if (
    bootstrap.includes('view.open(payload.name)') ||
    bootstrap.includes('view.open(payload.mimeType)')
  ) {
    throw new Error('Foliate Web bootstrap must not open a source string');
  }
  const visited = new Set();
  const visit = async (relativePath) => {
    if (visited.has(relativePath)) return;
    visited.add(relativePath);
    if (!assetPaths.has(relativePath)) {
      throw new Error(
        `Foliate Web module closure is missing manifest asset: ${relativePath}`,
      );
    }
    const source = await readFile(
      path.join(destinationRoot, relativePath),
      'utf8',
    );
    for (const match of source.matchAll(relativeImportPattern)) {
      const imported = path.posix.normalize(
        path.posix.join(path.posix.dirname(relativePath), match[1]),
      );
      if (imported.startsWith('../') || !assetPaths.has(imported)) {
        throw new Error(
          `Foliate Web module import escapes closure: ${imported}`,
        );
      }
      await visit(imported);
    }
  };
  await visit('bootstrap.js');
  for (const asset of manifest.assets) {
    if (
      forbiddenPath(asset.path) ||
      /(^|\/)(search|tts|text-walker)\.js$/i.test(asset.path)
    ) {
      throw new Error(
        `Foliate Web runtime includes an excluded asset: ${asset.path}`,
      );
    }
  }
}

async function assertNativeRuntimeClosure({ destinationRoot, manifest }) {
  const assetPaths = new Set(manifest.assets.map((asset) => asset.path));
  for (const requiredPath of [
    'reader.html',
    'bootstrap.js',
    'probes/csp-1x1.png',
    'probes/csp-external-canary.js',
    'foliate/LICENSE',
    'notices/fflate-MIT.txt',
    'notices/zip.js-BSD-3-Clause.txt',
  ]) {
    if (!assetPaths.has(requiredPath)) {
      throw new Error(
        `Foliate native runtime is missing required asset: ${requiredPath}`,
      );
    }
  }
  const probeMetadata = new Map(
    manifest.assets.map((asset) => [asset.path, asset]),
  );
  for (const [relativePath, expected] of [
    [
      'probes/csp-1x1.png',
      {
        source: 'generated:foliate-native-csp-probe-png-v1',
        category: 'csp-probe-image',
        license: 'CC0-1.0',
        mimeType: 'image/png',
      },
    ],
    [
      'probes/csp-external-canary.js',
      {
        source: 'generated:foliate-native-csp-probe-external-canary-v1',
        category: 'csp-probe-script',
        license: 'MIT',
        mimeType: 'text/javascript; charset=utf-8',
      },
    ],
  ]) {
    const asset = probeMetadata.get(relativePath);
    if (
      !asset ||
      Object.entries(expected).some(([key, value]) => asset[key] !== value)
    ) {
      throw new Error(
        `Foliate native runtime has invalid CSP probe metadata: ${relativePath}`,
      );
    }
  }
  const reader = await readFile(
    path.join(destinationRoot, 'reader.html'),
    'utf8',
  );
  const cspOffset = reader.indexOf('http-equiv="Content-Security-Policy"');
  const bootstrapOffset = reader.indexOf(
    '<script type="module" src="./bootstrap.js"></script>',
  );
  if (cspOffset < 0 || bootstrapOffset < 0 || cspOffset > bootstrapOffset) {
    throw new Error(
      'Foliate native reader.html must declare host CSP before bootstrap',
    );
  }
  if (
    !reader.includes(
      'Private host exposes no page-world publication capability',
    )
  ) {
    throw new Error(
      'Foliate native reader.html must declare the private capability boundary',
    );
  }
  const bootstrap = await readFile(
    path.join(destinationRoot, 'bootstrap.js'),
    'utf8',
  );
  if (
    !new RegExp(
      `^const FOLIATE_NATIVE_HOST_VERSION = ['"]${FOLIATE_NATIVE_HOST_VERSION}['"];$`,
      'm',
    ).test(bootstrap) ||
    !/^const FOLIATE_HOST_PROTOCOL = 'hn-foliate-host';$/m.test(bootstrap) ||
    !/^const FOLIATE_HOST_PROTOCOL_VERSION = 1;$/m.test(bootstrap) ||
    !/^export function installFoliateNativeHostBridge\(port\) \{$/m.test(
      bootstrap,
    ) ||
    [...bootstrap.matchAll(/^export\s+/gm)].length !== 1
  ) {
    throw new Error(
      'Foliate native bootstrap does not expose exactly one host-only private bridge entry with the required protocol identity',
    );
  }
  for (const [description, pattern] of [
    [
      'page-world global bridge',
      /\b(?:ReactNativeWebView|window|webkit|messageHandlers|parent|globalThis|self)\s*(?:\.|\[)/,
    ],
    [
      'public message listener',
      /\b(?:window|globalThis)\.addEventListener\s*\(\s*['"]message['"]/,
    ],
    ['Android JavaScript interface', /\baddJavascriptInterface\b/],
  ]) {
    if (pattern.test(bootstrap)) {
      throw new Error(
        `Foliate native bootstrap contains out-of-scope behavior: ${description}`,
      );
    }
  }
  for (const asset of manifest.assets) {
    if (
      forbiddenPath(asset.path) ||
      /(^|\/)(search|tts|text-walker)\.js$/i.test(asset.path)
    ) {
      throw new Error(
        `Foliate native runtime includes an excluded asset: ${asset.path}`,
      );
    }
  }
  const visited = new Set();
  const visit = async (relativePath) => {
    if (visited.has(relativePath)) return;
    visited.add(relativePath);
    if (!assetPaths.has(relativePath)) {
      throw new Error(
        `Foliate native module closure is missing manifest asset: ${relativePath}`,
      );
    }
    const source = await readFile(
      path.join(destinationRoot, relativePath),
      'utf8',
    );
    for (const match of source.matchAll(relativeImportPattern)) {
      const imported = path.posix.normalize(
        path.posix.join(path.posix.dirname(relativePath), match[1]),
      );
      if (imported.startsWith('../') || !assetPaths.has(imported)) {
        throw new Error(
          `Foliate native module import escapes closure: ${imported}`,
        );
      }
      await visit(imported);
    }
  };
  await visit('bootstrap.js');
  for (const required of [
    'renderer.js',
    'nativeFoliateProtocol.js',
    'nativePublicationTransfer.js',
    'publicationFormats.js',
    'foliate/view.js',
  ]) {
    if (!visited.has(required))
      throw new Error('Native runtime closure missing ' + required);
  }
}

async function assertMatchesStage({ expectedRoot, destinationRoot, manifest }) {
  if (!(await pathExists(destinationRoot))) {
    throw new Error(
      'Foliate runtime stage is missing; run pnpm run foliate:runtime:stage',
    );
  }
  const expectedFiles = await listFiles(expectedRoot);
  const actualFiles = await listFiles(destinationRoot);
  if (expectedFiles.join('\0') !== actualFiles.join('\0')) {
    throw new Error('Foliate runtime stage has a different asset list');
  }
  for (const relativePath of expectedFiles) {
    const [expected, actual] = await Promise.all([
      readFile(path.join(expectedRoot, relativePath)),
      readFile(path.join(destinationRoot, relativePath)),
    ]);
    if (!expected.equals(actual)) {
      throw new Error(`Foliate runtime stage differs for ${relativePath}`);
    }
  }
  if (manifest.assets.some((asset) => forbiddenPath(asset.path))) {
    throw new Error('Foliate runtime manifest includes a forbidden PDF asset');
  }
  await assertWebRuntimeClosure({
    destinationRoot: path.join(destinationRoot, FOLIATE_WEB_RUNTIME_DIRECTORY),
    manifest: JSON.parse(
      await readFile(
        path.join(
          destinationRoot,
          FOLIATE_WEB_RUNTIME_DIRECTORY,
          FOLIATE_WEB_RUNTIME_MANIFEST,
        ),
        'utf8',
      ),
    ),
  });
  await assertNativeRuntimeClosure({
    destinationRoot: path.join(
      destinationRoot,
      FOLIATE_NATIVE_RUNTIME_DIRECTORY,
    ),
    manifest: JSON.parse(
      await readFile(
        path.join(
          destinationRoot,
          FOLIATE_NATIVE_RUNTIME_DIRECTORY,
          FOLIATE_NATIVE_RUNTIME_MANIFEST,
        ),
        'utf8',
      ),
    ),
  });
}

/**
 * Stages the only Foliate modules allowed for the first reader release.
 * The output is package-private and is intentionally not yet a packed file.
 */
export async function stageFoliateRuntime({
  workspace = workspaceRoot,
  packageRoot = path.join(workspaceRoot, 'packages/native-reader'),
  sourceRoot = path.join(workspaceRoot, 'vendor/foliate-js'),
  validateFn = validateFoliateSubmodule,
  check = false,
} = {}) {
  await validateFn({ root: workspace });
  const destinationRoot = path.join(packageRoot, FOLIATE_RUNTIME_DIRECTORY);
  const temporaryRoot = path.join(
    packageRoot,
    `.${FOLIATE_RUNTIME_DIRECTORY}-${process.pid}-${Date.now()}`,
  );
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true });

  try {
    const manifest = await createRuntimeStage({
      sourceRoot,
      destinationRoot: temporaryRoot,
    });
    const webManifest = await createWebRuntimeStage({
      sourceRoot,
      destinationRoot: path.join(temporaryRoot, FOLIATE_WEB_RUNTIME_DIRECTORY),
    });
    const nativeManifest = await createNativeRuntimeStage({
      sourceRoot,
      destinationRoot: path.join(
        temporaryRoot,
        FOLIATE_NATIVE_RUNTIME_DIRECTORY,
      ),
    });
    if (check) {
      await assertMatchesStage({
        expectedRoot: temporaryRoot,
        destinationRoot,
        manifest,
      });
    } else {
      await rm(destinationRoot, { recursive: true, force: true });
      await rename(temporaryRoot, destinationRoot);
    }
    return { destinationRoot, manifest, webManifest, nativeManifest };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sync = process.argv.includes('--sync');
  const syncCheck = process.argv.includes('--sync-check');
  const targetIndex = process.argv.indexOf('--target');
  if (sync && syncCheck) {
    throw new Error('Use either --sync or --sync-check, not both');
  }
  if (
    targetIndex >= 0 &&
    (!process.argv[targetIndex + 1] ||
      process.argv[targetIndex + 1].startsWith('--'))
  ) {
    throw new Error('--target requires a project root');
  }
  const targetRoot =
    targetIndex >= 0
      ? path.resolve(process.argv[targetIndex + 1] ?? '')
      : path.join(workspaceRoot, 'apps/demo');
  if (sync || syncCheck) {
    // Workspace commands always validate the pinned source and either generate
    // or verify the package runtime before touching an app's public tree.
    await stageFoliateRuntime({ check: syncCheck });
    const runtimeRoot = path.join(
      workspaceRoot,
      'packages/native-reader',
      FOLIATE_RUNTIME_DIRECTORY,
      FOLIATE_WEB_RUNTIME_DIRECTORY,
    );
    const result = await (
      syncCheck ? checkFoliateWebRuntime : syncFoliateWebRuntime
    )({
      runtimeRoot,
      targetRoot,
    });
    console.log(
      `Foliate Web runtime ${syncCheck ? 'verified' : 'synced'} at ${result.readerRoot}.`,
    );
  } else {
    const { destinationRoot, manifest, webManifest, nativeManifest } =
      await stageFoliateRuntime({
        check: process.argv.includes('--check'),
      });
    console.log(
      `Foliate runtime ${process.argv.includes('--check') ? 'verified' : 'staged'}: ${manifest.assets.length} package assets, ${webManifest.assets.length} Web assets, and ${nativeManifest.assets.length} native host assets at ${destinationRoot}.`,
    );
  }
}
