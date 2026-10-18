import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { webHighlightBootstrap } from './web-highlight-bootstrap.mjs';

const value = (id) => ({
  id,
  text: id,
  createdAt: 1,
  color: '#ffc107',
  anchor: { kind: 'epub-cfi', cfi: `epubcfi(/6/2!/${id})` },
});
function fixture(failCfi) {
  const markers = new Set(),
    events = [];
  const context = vm.createContext({
    runtimeState: 'live',
    current: (session) => !session.disposed,
    send: (type, _session, _generation, payload) =>
      events.push({ type, ...JSON.parse(payload.data) }),
    isRecord: (item) =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
    hasOnlyKeys: (item, keys) =>
      Object.keys(item).every((key) => keys.includes(key)),
  });
  vm.runInContext(
    `${webHighlightBootstrap}; globalThis.command = handleTextHighlightCommand;`,
    context,
  );
  const session = {
    textHighlights: [],
    view: {
      async addAnnotation({ value }) {
        if (value === failCfi) throw new Error('engine failure');
        markers.add(value);
      },
      async deleteAnnotation({ value }) {
        markers.delete(value);
      },
    },
  };
  return {
    session,
    markers,
    events,
    command: (payload) => context.command(session, payload),
  };
}

test('Web Foliate confirmation consumes a snapshot once and rejects repeated commands', async () => {
  const f = fixture();
  const highlight = value('one');
  let cleared = 0;
  f.session.textSelection = {
    selectionId: 'snapshot',
    text: highlight.text,
    cfi: highlight.anchor.cfi,
    doc: {
      getSelection: () => ({
        removeAllRanges() {
          cleared++;
        },
      }),
    },
  };
  const payload = {
    operationId: 1,
    action: 'create',
    highlights: [highlight],
    selectionId: 'snapshot',
  };
  await f.command(payload);
  await f.command(payload);
  assert.equal(cleared, 1);
  assert.equal(f.markers.size, 1);
  assert.equal(
    f.events.filter((event) => event.type === 'highlight-result').length,
    1,
  );
  await f.command({ ...payload, operationId: 2 });
  assert.equal(f.events.at(-1).success, false);
  assert.equal(f.markers.size, 1);
});

test('failed Foliate redraw removes partial markers and restores the previous complete set', async () => {
  const old = value('old'),
    one = value('one'),
    fail = value('fail');
  const f = fixture(fail.anchor.cfi);
  await f.command({ operationId: 1, action: 'sync', highlights: [old] });
  await f.command({ operationId: 2, action: 'sync', highlights: [one, fail] });
  assert.deepEqual([...f.markers], [old.anchor.cfi]);
  assert.equal(f.session.textHighlights[0].id, 'old');
  assert.equal(f.events.at(-1).success, false);
});

test('Web Foliate refuses extra fields, invalid colors and oversized payloads before drawing', async () => {
  const f = fixture();
  for (const highlights of [
    Array(1001).fill(value('one')),
    [{ ...value('one'), text: 'x'.repeat(8193) }],
    [{ ...value('one'), color: '#12345' }],
    [{ ...value('one'), uri: 'file:///secret' }],
  ]) {
    await f.command({ operationId: 1, action: 'sync', highlights });
  }
  assert.equal(f.markers.size, 0);
  assert.equal(f.events.length, 0);
});
