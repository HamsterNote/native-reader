import {
  acceptPdfEvent,
  parsePdfCommand,
  parsePdfEvent,
  PDF_PROTOCOL,
  PDF_PROTOCOL_VERSION,
} from './protocol';

const identity = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  generation: 4,
};
const envelope = {
  protocol: PDF_PROTOCOL,
  version: PDF_PROTOCOL_VERSION,
  ...identity,
  commandId: 0,
};
const ready = {
  ...envelope,
  type: 'state',
  state: { ...identity, status: 'ready', pageNumber: 1, pageCount: 8 },
};
test('accepts only the current frame, exact origin, identity and version', () => {
  const frame = {} as Window;
  const event = { source: frame, origin: 'https://reader.test', data: ready };
  expect(acceptPdfEvent(event, frame, event.origin, identity)).toEqual(ready);
  expect(
    acceptPdfEvent(event, {} as Window, event.origin, identity),
  ).toBeNull();
  expect(
    acceptPdfEvent(event, frame, 'https://other.test', identity),
  ).toBeNull();
  expect(
    acceptPdfEvent(event, frame, event.origin, { ...identity, generation: 5 }),
  ).toBeNull();
  for (const data of [
    { ...ready, version: 2 },
    { ...ready, sessionId: 'old' },
    { ...ready, uri: 'https://external.test' },
    { ...ready, state: { ...ready.state, pageNumber: 9 } },
  ])
    expect(parsePdfEvent(data, identity)).toBeNull();
});
test('selection and thumbnail messages have finite fields and payload limits', () => {
  const selection = {
    ...identity,
    coordinateSpace: 'reader',
    selectionId: '1',
    text: 'Selected',
    rects: [{ x: 20, y: 30, width: 40, height: 20 }],
  };
  expect(
    parsePdfEvent({ ...envelope, type: 'selection', selection }, identity),
  ).not.toBeNull();
  for (const value of [
    { ...selection, text: 'x'.repeat(8193) },
    { ...selection, rects: Array(65).fill(selection.rects[0]) },
    { ...selection, rects: [{ x: Infinity, y: 0, width: 1, height: 1 }] },
    { ...selection, coordinateSpace: 'screen' },
    { ...selection, generation: 3 },
  ])
    expect(
      parsePdfEvent(
        { ...envelope, type: 'selection', selection: value },
        identity,
      ),
    ).toBeNull();
  expect(
    parsePdfEvent(
      {
        ...envelope,
        commandId: 2,
        type: 'result',
        result: {
          ...identity,
          pageNumber: 1,
          width: 112,
          height: 150,
          uri: 'https://external.test/image.png',
        },
      },
      identity,
    ),
  ).toBeNull();
});
test('commands cannot grant arbitrary URI fetches, unknown operations or invalid pages', () => {
  expect(
    parsePdfCommand(
      { ...envelope, commandId: 1, type: 'open', bytes: new ArrayBuffer(5) },
      identity,
    ),
  ).not.toBeNull();
  for (const command of [
    { type: 'open', uri: 'blob:host-owned' },
    { type: 'navigate', pageNumber: 0 },
    { type: 'navigate', pageNumber: 1.2 },
    { type: 'thumbnail', pageNumber: Infinity },
    { type: 'scale', scale: 10 },
    { type: 'annotate' },
    { type: 'clear', extra: true },
  ])
    expect(
      parsePdfCommand({ ...envelope, commandId: 1, ...command }, identity),
    ).toBeNull();
});
