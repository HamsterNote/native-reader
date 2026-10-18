import type { PdfSessionEvents, PdfThumbnail } from './contracts';
import { createPdfKitSession } from './pdfKitSession';

const identity = { sessionId: 'pdfkit-test', generation: 7 };
const envelope = {
  protocol: 'hamster-pdf',
  version: 1,
  ...identity,
  commandId: 0,
};
const event = <T extends Record<string, unknown>>(type: string, fields: T) => ({
  ...envelope,
  type,
  ...fields,
});
const ready = event('state', {
  state: { ...identity, status: 'ready', pageCount: 3, pageNumber: 1 },
});
let events: PdfSessionEvents;
beforeEach(() => {
  jest.useFakeTimers();
  events = {
    onStateChange: jest.fn(),
    onMetadata: jest.fn(),
    onPageChange: jest.fn(),
    onSelectionChange: jest.fn(),
  };
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
function setup() {
  const command = jest.fn<Promise<unknown>, [Record<string, unknown>]>();
  command.mockImplementation(async (value) => {
    const {
      uri: _uri,
      timeoutMs: _timeout,
      pageNumber: _page,
      scale: _scale,
      ...fields
    } = value;
    void [_uri, _timeout, _page, _scale];
    return { ...fields, type: 'result', result: true };
  });
  const session = createPdfKitSession(
    { command },
    { uri: 'file:///host-owned.pdf', identity, events },
  );
  return { session, command };
}

test('binding and open acknowledgment do not mark the document ready or permit page requests', async () => {
  const { session, command } = setup();
  expect(await session.goToPage(1)).toBe(false);
  expect(await session.getThumbnail(1)).toBeNull();
  expect(events.onStateChange).toHaveBeenCalledTimes(1);
  expect(events.onStateChange).toHaveBeenCalledWith({
    ...identity,
    status: 'loading',
  });
  expect(command.mock.calls[0][0]).toMatchObject({
    type: 'open',
    commandId: 1,
    uri: 'file:///host-owned.pdf',
    timeoutMs: 15000,
  });
  session.receive(ready);
  expect(events.onMetadata).toHaveBeenCalledWith({ ...identity, pageCount: 3 });
  expect(events.onStateChange).toHaveBeenLastCalledWith(ready.state);
  expect(await session.goToPage(3)).toBe(true);
  expect(await session.goToPage(4)).toBe(false);
  expect(await session.goToPage(1.5)).toBe(false);
  session.dispose();
});

test('stale identities and malformed selection events cannot mutate current state', () => {
  const { session } = setup();
  session.receive({ ...ready, generation: 6 });
  session.receive({
    ...ready,
    state: { ...(ready.state as object), generation: 6 },
  });
  expect(events.onMetadata).not.toHaveBeenCalled();
  session.receive(ready);
  session.receive(
    event('selection', {
      selection: {
        ...identity,
        selectionId: 'selection',
        text: 'PDF text',
        coordinateSpace: 'reader',
        rects: [{ x: 1, y: NaN, width: 10, height: 12 }],
      },
    }),
  );
  expect(events.onSelectionChange).not.toHaveBeenCalled();
  const selection = {
    ...identity,
    selectionId: 'selection',
    text: 'PDF text',
    coordinateSpace: 'reader',
    rects: [{ x: 1, y: 2, width: 10, height: 12 }],
  };
  session.receive(event('selection', { selection }));
  expect(events.onSelectionChange).toHaveBeenLastCalledWith(
    identity,
    selection,
  );
  session.dispose();
});

test('thumbnail replies are bounded, tied to the requested page and cancelled on teardown', async () => {
  const { session, command } = setup();
  session.receive(ready);
  const completions: Array<(value: unknown) => void> = [];
  const requests: Array<Record<string, unknown>> = [];
  command.mockImplementation((value) => {
    requests.push(value);
    return new Promise((resolve) =>
      completions.push(resolve as (value: unknown) => void),
    );
  });
  const first = session.getThumbnail(1);
  const second = session.getThumbnail(2);
  const third = session.getThumbnail(3);
  const fourth = session.getThumbnail(1);
  expect(await session.getThumbnail(2)).toBeNull();
  const thumbnail: PdfThumbnail = {
    ...identity,
    pageNumber: 1,
    uri: 'data:image/png;base64,YQ==',
    width: 112,
    height: 150,
  };
  completions[0]({
    ...envelope,
    commandId: requests[0].commandId,
    type: 'result',
    result: thumbnail,
  });
  expect(await first).toEqual(thumbnail);
  // A valid image for a different page still cannot satisfy this request.
  completions[1]({
    ...envelope,
    commandId: requests[1].commandId,
    type: 'result',
    result: thumbnail,
  });
  expect(await second).toBeNull();
  session.dispose();
  expect(await third).toBeNull();
  expect(await fourth).toBeNull();
  completions[2]({
    ...envelope,
    commandId: requests[2].commandId,
    type: 'result',
    result: thumbnail,
  });
  expect(events.onStateChange).toHaveBeenCalledTimes(2);
});

test('clear, scale and rotation stay within the independent PDF command surface', () => {
  const { session, command } = setup();
  session.receive(ready);
  session.setScale(4);
  session.setScale(NaN);
  expect(command).toHaveBeenCalledTimes(1);
  session.setScale(2);
  session.rotate();
  expect(command.mock.calls.map(([value]) => value.type)).toEqual([
    'open',
    'clear',
    'scale',
    'clear',
    'rotate',
  ]);
  expect(events.onSelectionChange).toHaveBeenLastCalledWith(identity, null);
  session.dispose();
});

test('dispose is idempotent, settles requests and ignores every late callback', async () => {
  const { session, command } = setup();
  session.receive(ready);
  const before = (events.onStateChange as jest.Mock).mock.calls.length;
  session.dispose();
  session.dispose();
  session.receive(ready);
  session.receive(
    event('page', { page: { ...identity, pageNumber: 2, pageCount: 3 } }),
  );
  expect(await session.goToPage(1)).toBe(false);
  expect(await session.getThumbnail(1)).toBeNull();
  await jest.runAllTimersAsync();
  expect(
    command.mock.calls.filter(([value]) => value.type === 'dispose'),
  ).toHaveLength(1);
  expect(events.onStateChange).toHaveBeenCalledTimes(before);
  expect(events.onPageChange).not.toHaveBeenCalled();
});

test('a native error or deadline revokes the host without granting ready', async () => {
  const { session, command } = setup();
  await jest.advanceTimersByTimeAsync(15000);
  expect(events.onStateChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: 'error',
      error: expect.objectContaining({ code: 'PDF_LOAD_TIMEOUT' }),
    }),
  );
  session.receive(ready);
  expect(events.onMetadata).not.toHaveBeenCalled();
  expect(command.mock.calls.at(-1)?.[0].type).toBe('dispose');
  const other = setup();
  other.session.receive(
    event('state', {
      state: {
        ...identity,
        status: 'error',
        error: {
          category: 'drm',
          code: 'PDF_ENCRYPTED',
          message: 'Encrypted PDF',
        },
      },
    }),
  );
  other.session.receive(ready);
  expect(events.onStateChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: 'error',
      error: expect.objectContaining({ category: 'drm' }),
    }),
  );
});
