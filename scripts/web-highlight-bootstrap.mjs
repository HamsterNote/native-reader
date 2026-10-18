// Inserted only into the Web host. Native wire schemas remain independently gated.
export const webHighlightBootstrap = String.raw`
function highlightBounds(doc, range) {
  const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
  if (!frame) return null;
  const rect = Array.from(range.getClientRects()).find(rect => rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < doc.defaultView.innerWidth && rect.top < doc.defaultView.innerHeight);
  return rect ? { x: rect.left + frame.left, y: rect.top + frame.top, width: rect.width, height: rect.height } : null;
}
function highlightEvent(session, type, data) {
  if (current(session)) send(type, session.session, session.generation, { data: JSON.stringify(data) });
}
function dismissTextSelection(session) {
  session.textSelection = null;
  if (runtimeState !== 'live' || !session.highlightVisible) return;
  session.highlightVisible = false;
  highlightEvent(session, 'highlight-selection', null);
  highlightEvent(session, 'highlight-hit', null);
}
function bindTextHighlights(session, doc, index) {
  if (!doc.addEventListener || !doc.removeEventListener) return;
  if (session.highlightDocs?.has(doc)) return;
  session.highlightDocs ??= new Set();
  session.highlightDocs.add(doc);
  const changed = () => {
    if (!current(session) || runtimeState !== 'live') return;
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      session.textSelection = null;
      return highlightEvent(session, 'highlight-selection', null);
    }
    const range = selection.getRangeAt(0).cloneRange();
    // CFI text offsets must name text nodes, including select-all/element ranges.
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) if (node.textContent.length && range.intersectsNode(node)) nodes.push(node);
    if (!nodes.length) return dismissTextSelection(session);
    if (range.startContainer.nodeType !== Node.TEXT_NODE) range.setStart(nodes[0], 0);
    if (range.endContainer.nodeType !== Node.TEXT_NODE) range.setEnd(nodes.at(-1), nodes.at(-1).textContent.length);
    const text = selection.toString();
    const cfi = session.view.getCFI(index, range);
    const bounds = highlightBounds(doc, range);
    if (text.length > 8192 || cfi.length > 8192 || range.getClientRects().length > 64) {
      session.textSelection = null;
      highlightEvent(session, 'highlight-selection', null);
      return highlightEvent(session, 'highlight-error', '选区过长，请缩小范围后重试。');
    }
    if (!bounds || !text.trim()) return dismissTextSelection(session);
    const value = { selectionId: String(++session.selectionSequence), text, cfi, bounds };
    session.highlightVisible = true;
    session.textSelection = { ...value, doc, range: range.cloneRange() };
    highlightEvent(session, 'highlight-hit', null);
    highlightEvent(session, 'highlight-selection', value);
  };
  const hide = () => dismissTextSelection(session);
  doc.addEventListener('selectionchange', changed);
  doc.addEventListener('scroll', hide, true);
  session.highlightCleanups ??= [];
  session.highlightCleanups.push(() => { doc.removeEventListener('selectionchange', changed); doc.removeEventListener('scroll', hide, true); });
}
const validCfiHighlight = value => isRecord(value) && hasOnlyKeys(value, ['id', 'text', 'createdAt', 'color', 'anchor']) &&
  typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 256 &&
  typeof value.text === 'string' && value.text.trim().length > 0 && value.text.length <= 8192 &&
  Number.isSafeInteger(value.createdAt) && value.createdAt >= 0 && typeof value.color === 'string' && /^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value.color) &&
  isRecord(value.anchor) && hasOnlyKeys(value.anchor, ['kind', 'cfi']) && value.anchor.kind === 'epub-cfi' && typeof value.anchor.cfi === 'string' && value.anchor.cfi.length <= 8192 && /^epubcfi\(.+\)$/.test(value.anchor.cfi);
async function redrawTextHighlights(session, values, remove = session.textHighlights ?? []) {
  for (const value of remove) await session.view.deleteAnnotation({ value: value.anchor.cfi });
  for (const value of values) await session.view.addAnnotation({ value: value.anchor.cfi, color: value.color });
  session.textHighlights = values;
}
async function handleTextHighlightCommand(session, payload) {
  if (!isRecord(payload) || !hasOnlyKeys(payload, ['operationId', 'action', 'highlights', 'selectionId']) ||
    !Number.isSafeInteger(payload.operationId) || payload.operationId <= (session.highlightOperation ?? 0) ||
    !['sync', 'create', 'remove'].includes(payload.action) || !Array.isArray(payload.highlights) ||
    payload.highlights.length > 1000 || !payload.highlights.every(validCfiHighlight) ||
    new Set(payload.highlights.map(value => value.id)).size !== payload.highlights.length || JSON.stringify(payload).length > 2000000) return;
  session.highlightOperation = payload.operationId;
  const result = (success, error = '') => highlightEvent(session, 'highlight-result', { operationId: payload.operationId, success, error });
  if (session.highlightBusy) return result(false, '高亮处理中，请重试。');
  const selected = session.textSelection;
  if (payload.action === 'create') {
    const added = payload.highlights.filter(value => !(session.textHighlights ?? []).some(old => old.id === value.id));
    if (!selected || selected.selectionId !== payload.selectionId || added.length !== 1 || added[0].anchor.cfi !== selected.cfi || added[0].text !== selected.text) return result(false, '选区已失效，请重新选择。');
    session.textSelection = null;
  }
  const previous = session.textHighlights ?? [];
  session.highlightBusy = true;
  try {
    await redrawTextHighlights(session, payload.highlights);
    if (!current(session)) return;
    if (payload.action === 'create') selected.doc.getSelection()?.removeAllRanges();
    if (payload.action !== 'sync') dismissTextSelection(session);
    result(true);
  } catch {
    try { await redrawTextHighlights(session, previous, [...previous, ...payload.highlights]); } catch {}
    result(false, '高亮操作失败，请重试。');
  } finally { session.highlightBusy = false; }
}
function installTextHighlights(session) {
  session.selectionSequence = 0;
  session.textHighlights = [];
  const draw = event => event.detail.draw(Overlayer.highlight, { color: event.detail.annotation.color ?? '#ffc107' });
  const overlay = () => queueMicrotask(() => {
    if (current(session)) for (const value of session.textHighlights) void session.view.addAnnotation({ value: value.anchor.cfi, color: value.color }).catch(() => highlightEvent(session, 'highlight-error', '无法恢复高亮。'));
  });
  const show = event => {
    const { value, index, range } = event.detail;
    const doc = session.view.renderer.getContents().find(item => item.index === index)?.doc;
    if (!doc?.getSelection()?.isCollapsed) return;
    const highlight = [...session.textHighlights].reverse().find(item => item.anchor.cfi === value);
    const bounds = doc && highlightBounds(doc, range);
    if (highlight && bounds) {
      session.highlightVisible = true;
      highlightEvent(session, 'highlight-selection', null);
      highlightEvent(session, 'highlight-hit', { id: highlight.id, bounds });
    }
  };
  session.view.addEventListener('draw-annotation', draw);
  session.view.addEventListener('create-overlay', overlay);
  session.view.addEventListener('show-annotation', show);
  session.highlightCleanups = [() => {
    session.view.removeEventListener('draw-annotation', draw);
    session.view.removeEventListener('create-overlay', overlay);
    session.view.removeEventListener('show-annotation', show);
    session.highlightDocs?.clear();
  }];
}
`;
