import { createAndroidPdfSession } from './androidSession';
import { PDF_PROTOCOL, PDF_PROTOCOL_VERSION } from './protocol';

const identity = {
  sessionId: '00000000-0000-0000-0000-000000000001',
  generation: 1,
};
function fixture() {
  const events = {
    onMetadata: jest.fn(),
    onStateChange: jest.fn(),
    onPageChange: jest.fn(),
    onSelectionChange: jest.fn(),
  };
  const send = jest.fn();
  const session = createAndroidPdfSession({
    identity,
    send,
    events,
    timeoutMs: 15000,
  });
  const event = (value: Record<string, unknown>) =>
    JSON.stringify({
      protocol: PDF_PROTOCOL,
      version: PDF_PROTOCOL_VERSION,
      ...identity,
      commandId: 0,
      ...value,
    });
  const ready = () => {
    session.receive(event({ type: 'boot' }));
    session.receive(
      event({
        type: 'state',
        state: { ...identity, status: 'ready', pageCount: 3, pageNumber: 1 },
      }),
    );
  };
  return { session, events, send, event, ready };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('no full source or arbitrary URI command is sent; ready requires bound private host', () => {
  const f = fixture();
  expect(f.send).not.toHaveBeenCalled();
  f.session.receive(
    f.event({
      type: 'state',
      state: { ...identity, status: 'ready', pageCount: 3, pageNumber: 1 },
    }),
  );
  expect(f.events.onStateChange).toHaveBeenCalledTimes(1);
  f.ready();
  expect(f.events.onMetadata).toHaveBeenLastCalledWith({
    ...identity,
    pageCount: 3,
  });
  f.session.dispose();
  expect(JSON.parse(f.send.mock.calls[0]![0]).type).toBe('dispose');
});

test('wrong identity, malformed selection and unsolicited result cannot change state', () => {
  const f = fixture();
  f.ready();
  const before = f.events.onStateChange.mock.calls.length;
  f.session.receive(
    f.event({
      type: 'state',
      generation: 2,
      state: {
        ...identity,
        status: 'error',
        error: { category: 'read', code: 'x', message: 'x' },
      },
    }),
  );
  f.session.receive(
    f.event({
      type: 'selection',
      selection: { ...identity, text: 'secret', rects: [] },
    }),
  );
  f.session.receive('{');
  f.session.receive('x'.repeat(262145));
  expect(f.events.onStateChange).toHaveBeenCalledTimes(before);
  expect(f.events.onSelectionChange).not.toHaveBeenCalled();
  f.session.dispose();
});

test('navigation bounds and duplicate or wrong-page thumbnail results are isolated', async () => {
  const f = fixture();
  f.ready();
  expect(await f.session.goToPage(0)).toBe(false);
  expect(await f.session.goToPage(4)).toBe(false);
  const request = f.session.getThumbnail(2);
  const command = JSON.parse(f.send.mock.calls.at(-1)![0]);
  const result = {
    ...identity,
    pageNumber: 1,
    uri: 'data:image/png;base64,AAAA',
    width: 10,
    height: 10,
  };
  f.session.receive(
    f.event({ type: 'result', commandId: command.commandId, result }),
  );
  let settled = false;
  void request.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  result.pageNumber = 2;
  f.session.receive(
    f.event({ type: 'result', commandId: command.commandId, result }),
  );
  expect(await request).toEqual(result);
  f.session.receive(
    f.event({ type: 'result', commandId: command.commandId, result }),
  );
  f.session.dispose();
});

test('thumbnail concurrency is four; teardown settles requests and ignores late events', async () => {
  const f = fixture();
  f.ready();
  const requests = Array.from({ length: 4 }, () => f.session.getThumbnail(1));
  expect(await f.session.getThumbnail(1)).toBeNull();
  expect(f.send).toHaveBeenCalledTimes(4);
  f.session.dispose();
  f.session.dispose();
  expect(await Promise.all(requests)).toEqual([null, null, null, null]);
  const calls = f.events.onStateChange.mock.calls.length;
  f.ready();
  jest.runAllTimers();
  expect(f.events.onStateChange).toHaveBeenCalledTimes(calls);
});

test('source timeout revokes host and a failed thumbnail only affects that request', async () => {
  const f = fixture();
  f.ready();
  const request = f.session.getThumbnail(1);
  jest.advanceTimersByTime(10001);
  expect(await request).toBeNull();
  expect(f.events.onStateChange).toHaveBeenCalledTimes(2);
  f.session.dispose();
  const stalled = fixture();
  jest.advanceTimersByTime(15001);
  expect(stalled.events.onStateChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: 'error' }),
  );
  expect(JSON.parse(stalled.send.mock.calls.at(-1)![0]).type).toBe('dispose');
});
