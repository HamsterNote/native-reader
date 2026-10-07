import {
  createFoliateHostCommandLedger,
  createTerminalProtocolViolation,
  receiveFoliateHostMessage,
  receiveFoliateHostMessageWithIdentity,
  FOLIATE_HOST_MODEL_MESSAGE_BYTES,
  parseFoliateHostMessage,
  serializeFoliateHostMessage,
} from './nativeFoliateProtocol';
import corpus from '../secure-webview/foliate-host-wire-corpus.v1.json';

const session = 'A'.repeat(43);

const command = (
  type: string,
  payload: Record<string, unknown> = {},
  commandId = 1,
) => ({
  protocol: 'hn-foliate-host' as const,
  version: 1 as const,
  direction: 'native-to-host' as const,
  type,
  session,
  generation: 0,
  commandId,
  payload,
});

const parse = (value: unknown) =>
  parseFoliateHostMessage(JSON.stringify(value));

const receiveWithCurrentHostIdentity = (
  ledger: ReturnType<typeof createFoliateHostCommandLedger>,
  data: string,
) =>
  receiveFoliateHostMessageWithIdentity(
    {
      // The private relay has already checked its active frame/port context.
      authenticated: true,
      expectedSession: ledger.session,
      expectedGeneration: ledger.generation,
      expectedDirection: 'host-to-native',
      ledger,
    },
    data,
  );

describe('hn-foliate-host v1', () => {
  test('serializes and parses each permitted command', () => {
    for (const value of [
      command('bind'),
      command('navigate', { target: 0 }),
      command('navigate', { target: 'd:42' }),
      command('flow', { flow: 'scrolled' }),
      command('dispose'),
    ]) {
      const data = serializeFoliateHostMessage(value as never);
      expect(parseFoliateHostMessage(data)).toMatchObject({ ok: true, value });
    }
  });

  test('rejects malformed JSON before it becomes an object', () => {
    expect(
      parseFoliateHostMessage(
        `{"protocol":"hn-foliate-host","protocol":"hn-foliate-host"}`,
      ),
    ).toMatchObject({ ok: false, reason: 'duplicate-key' });
    expect(
      parseFoliateHostMessage(`${JSON.stringify(command('bind'))} trailing`),
    ).toMatchObject({
      ok: false,
      reason: 'trailing-json',
    });
    expect(parseFoliateHostMessage('[]')).toMatchObject({
      ok: false,
      reason: 'invalid-envelope',
    });
    expect(parseFoliateHostMessage('{"__proto__":{}}')).toMatchObject({
      ok: false,
      reason: 'blocked-key',
    });
    expect(parseFoliateHostMessage('{"x":"\\uD800"}')).toMatchObject({
      ok: false,
      reason: 'invalid-unicode',
    });
    expect(
      parseFoliateHostMessage(
        `{"protocol":"hn-foliate-host","version":1,"direction":"native-to-host","type":"bind","session":"${session}","generation":0,"commandId":1,"payload":{}}`,
      ),
    ).toMatchObject({ ok: true });
  });

  test('accepts only canonical JSON decimal integer tokens', () => {
    for (const [name, value] of [
      ['fraction', '1.0'],
      ['exponent', '1e0'],
      ['leading zero', '00'],
      ['negative', '-1'],
      ['unsafe', '9007199254740992'],
    ]) {
      expect(
        parseFoliateHostMessage(
          `{"protocol":"hn-foliate-host","version":1,"direction":"native-to-host","type":"bind","session":"${session}","generation":${value},"commandId":0,"payload":{}}`,
        ),
      ).toMatchObject({ ok: false });
      expect(name).toBeTruthy();
    }
    expect(
      parseFoliateHostMessage(
        `{"protocol":"hn-foliate-host","version":1,"direction":"native-to-host","type":"navigate","session":"${session}","generation":0,"commandId":1,"payload":{"target":1.0}}`,
      ),
    ).toMatchObject({ ok: false });
  });

  test('enforces envelope fields, UTF-8 budgets, and nesting budget', () => {
    expect(parse({ ...command('bind'), unexpected: true })).toMatchObject({
      ok: false,
      reason: 'invalid-envelope',
    });
    expect(
      parse({ ...command('bind'), session: '短'.repeat(43) }),
    ).toMatchObject({
      ok: false,
    });
    expect(parse({ ...command('bind'), generation: -1 })).toMatchObject({
      ok: false,
    });
    expect(
      parse({ ...command('bind'), commandId: Number.MAX_SAFE_INTEGER + 1 }),
    ).toMatchObject({
      ok: false,
    });
    expect(
      parseFoliateHostMessage(
        JSON.stringify(command('bind')) + ' '.repeat(9000),
      ),
    ).toMatchObject({
      ok: false,
      reason: 'message-too-large',
    });
    expect(
      parseFoliateHostMessage(`${'['.repeat(41)}${']'.repeat(41)}`),
    ).toMatchObject({ ok: false, reason: 'depth-limit' });
    expect(
      parseFoliateHostMessage('x'.repeat(FOLIATE_HOST_MODEL_MESSAGE_BYTES + 1)),
    ).toMatchObject({
      ok: false,
      reason: 'message-too-large',
    });
  });

  test('requires bind only before a caller binds and strictly validates command payloads', () => {
    expect(parse(command('bind', { value: true }))).toMatchObject({
      ok: false,
    });
    expect(parse(command('navigate', { target: -1 }))).toMatchObject({
      ok: false,
    });
    expect(
      parse(command('navigate', { target: 'd:not-a-number' })),
    ).toMatchObject({ ok: false });
    expect(
      parse(command('navigate', { target: 'd:1', uri: 'file:///book.epub' })),
    ).toMatchObject({
      ok: false,
    });
    expect(parse(command('flow', { flow: 'sideways' }))).toMatchObject({
      ok: false,
    });
    expect(parse(command('dispose', { source: 'book.epub' }))).toMatchObject({
      ok: false,
    });
  });

  test('rejects transfer and source-bearing namespaces or payloads', () => {
    expect(
      parse({ ...command('bind'), protocol: 'hn-foliate-transfer' }),
    ).toMatchObject({
      ok: false,
    });
    for (const key of ['uri', 'source', 'base64', 'chunk', 'bytes']) {
      expect(parse(command('bind', { [key]: 'forbidden' }))).toMatchObject({
        ok: false,
      });
    }
  });

  test('bounds closed publication models', () => {
    const model = {
      modelVersion: 1,
      format: 'epub',
      fixedLayout: false,
      flow: 'scrolled',
      direction: 'ltr',
      metadata: { title: 'Unicode title \ud83d\udcd6' },
      sections: [{ id: 's:0', index: 0, linear: true }],
      toc: [
        { id: 'toc:0', label: 'Chapter', destinationId: 'd:0', subitems: [] },
      ],
      destinations: [{ id: 'd:0', sectionId: 's:0', sectionIndex: 0 }],
    };
    const event = {
      ...command('bind'),
      direction: 'host-to-native',
      type: 'model',
      payload: { model },
    };
    expect(parse(event)).toEqual({ ok: true, value: event });
    expect(
      parse({
        ...event,
        payload: {
          model: {
            ...model,
            toc: [{ ...model.toc[0], label: 'x'.repeat(2049) }],
          },
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      parse({
        ...event,
        payload: {
          model: {
            ...model,
            sections: Array.from({ length: 10001 }, (_, index) => ({
              id: `s:${index}`,
              index,
              linear: true,
            })),
          },
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      parse({
        ...event,
        payload: {
          model: {
            ...model,
            destinations: [{ id: 'd:0', sectionId: 's:0', sectionIndex: 1 }],
          },
        },
      }),
    ).toMatchObject({ ok: false });
  });

  test('keeps terminal protocol violation explicit for future authenticated adapters', () => {
    expect(createTerminalProtocolViolation()).toEqual({
      code: 'protocol-violation',
      terminal: true,
    });
  });

  test('matches the shared machine-readable wire corpus', () => {
    expect(corpus.schemaVersion).toBe(1);
    for (const entry of [...corpus.cases, ...corpus.semanticCases]) {
      expect(parseFoliateHostMessage(entry.wire).ok).toBe(entry.parse);
    }
  });

  test('enforces the shared adapter-owned command state machine', () => {
    const byId = new Map(
      [...corpus.cases, ...corpus.semanticCases].map((entry) => [
        entry.id,
        entry,
      ]),
    );
    for (const scenario of corpus.scenarios) {
      const ledger = createFoliateHostCommandLedger(session, 0);
      for (const step of scenario.steps) {
        const entry = byId.get(step.case);
        expect(entry).toBeDefined();
        const received = receiveFoliateHostMessage(ledger, entry!.wire);
        expect({
          scenario: scenario.id,
          step: step.case,
          received,
        }).toMatchObject({
          received: { disposition: step.expect },
        });
      }
    }
  });

  test('treats current malformed wire and mismatched acknowledgements as terminal', () => {
    const ledger = createFoliateHostCommandLedger(session, 0);
    expect(receiveFoliateHostMessage(ledger, 'not json')).toMatchObject({
      disposition: 'terminal',
    });

    const mismatch = createFoliateHostCommandLedger(session, 0);
    expect(
      receiveFoliateHostMessage(
        mismatch,
        JSON.stringify(command('bind', {}, 0)),
      ),
    ).toMatchObject({
      disposition: 'accepted',
    });
    const incorrectAck = {
      ...command('bind', {}, 0),
      direction: 'host-to-native',
      type: 'ack',
      payload: { command: 'navigate', status: 'not-ready' },
    };
    expect(
      receiveFoliateHostMessage(mismatch, JSON.stringify(incorrectAck)),
    ).toMatchObject({
      disposition: 'terminal',
      reason: 'ack-command-mismatch',
    });
  });

  test('makes raw wire disposition identity-aware without bypassing strict JSON', () => {
    const ledger = createFoliateHostCommandLedger(session, 0);
    const bind = JSON.stringify(command('bind', {}, 0));
    expect(
      receiveFoliateHostMessageWithIdentity(
        {
          authenticated: true,
          expectedSession: session,
          expectedGeneration: 0,
          expectedDirection: 'native-to-host',
          ledger,
        },
        bind,
      ),
    ).toMatchObject({ disposition: 'accepted' });
    expect(ledger).toMatchObject({ bound: true, inflightCommandId: 0 });

    const beforeWrongDirection = { ...ledger };
    expect(
      receiveWithCurrentHostIdentity(
        ledger,
        JSON.stringify(command('bind', {}, 0)),
      ),
    ).toEqual({ disposition: 'stale-noop' });
    expect(ledger).toEqual(beforeWrongDirection);

    const beforeStaleSession = { ...ledger };
    expect(
      receiveWithCurrentHostIdentity(
        ledger,
        JSON.stringify({
          ...command('bind', {}, 0),
          direction: 'host-to-native',
          type: 'ack',
          session: 'B'.repeat(43),
          payload: { command: 'bind', status: 'bridge-bound' },
        }),
      ),
    ).toEqual({ disposition: 'stale-noop' });
    expect(ledger).toEqual(beforeStaleSession);

    const beforeStaleGeneration = { ...ledger };
    expect(
      receiveWithCurrentHostIdentity(
        ledger,
        JSON.stringify({
          ...command('bind', {}, 0),
          direction: 'host-to-native',
          type: 'ack',
          generation: 1,
          payload: { command: 'bind', status: 'bridge-bound' },
        }),
      ),
    ).toEqual({ disposition: 'stale-noop' });
    expect(ledger).toEqual(beforeStaleGeneration);

    const beforeStaleAck = { ...ledger };
    expect(
      receiveWithCurrentHostIdentity(
        ledger,
        JSON.stringify({
          ...command('bind', {}, 1),
          direction: 'host-to-native',
          type: 'ack',
          payload: { command: 'bind', status: 'bridge-bound' },
        }),
      ),
    ).toEqual({ disposition: 'stale-noop' });
    expect(ledger).toEqual(beforeStaleAck);

    const currentAck = JSON.stringify({
      ...command('bind', {}, 0),
      direction: 'host-to-native',
      type: 'ack',
      payload: { command: 'bind', status: 'bridge-bound' },
    });
    expect(receiveWithCurrentHostIdentity(ledger, currentAck)).toMatchObject({
      disposition: 'accepted',
      envelope: { type: 'ack', commandId: 0 },
    });
    expect(ledger.inflightCommandId).toBeUndefined();
    const beforeDuplicateAck = { ...ledger };
    expect(receiveWithCurrentHostIdentity(ledger, currentAck)).toEqual({
      disposition: 'stale-noop',
    });
    expect(ledger).toEqual(beforeDuplicateAck);

    expect(
      receiveWithCurrentHostIdentity(
        ledger,
        JSON.stringify({
          ...command('bind', {}, 0),
          direction: 'host-to-native',
          type: 'ack',
          // Matching identity makes this a closed-schema violation, not stale.
          payload: { command: 'bind', status: 'not-ready' },
        }),
      ),
    ).toEqual({
      disposition: 'terminal-violation',
      violation: { code: 'protocol-violation', terminal: true },
    });
    expect(ledger.terminal).toBe(true);

    const wrongVersion = createFoliateHostCommandLedger(session, 0);
    expect(
      receiveWithCurrentHostIdentity(
        wrongVersion,
        JSON.stringify({
          ...command('bind', {}, 0),
          direction: 'host-to-native',
          type: 'ack',
          version: 2,
          payload: { command: 'bind', status: 'bridge-bound' },
        }),
      ),
    ).toEqual({
      disposition: 'terminal-violation',
      violation: { code: 'protocol-violation', terminal: true },
    });
    expect(wrongVersion.terminal).toBe(true);
  });

  test('does not silently classify duplicate or blocked JSON keys as stale', () => {
    const currentIdentity =
      `"protocol":"hn-foliate-host","version":1,"direction":"host-to-native",` +
      `"type":"ack","session":"${session}","generation":0,"commandId":0`;

    for (const malformed of [
      `{${currentIdentity},"payload":{},"payload":{}}`,
      `{${currentIdentity},"payload":{"__proto__":{}}}`,
    ]) {
      const ledger = createFoliateHostCommandLedger(session, 0);
      expect(receiveWithCurrentHostIdentity(ledger, malformed)).toEqual({
        disposition: 'terminal-violation',
        violation: { code: 'protocol-violation', terminal: true },
      });
      expect(ledger.terminal).toBe(true);
    }
  });

  test('terminates malformed bytes from an authenticated current host', () => {
    const ledger = createFoliateHostCommandLedger(session, 0);
    expect(receiveWithCurrentHostIdentity(ledger, 'not json')).toEqual({
      disposition: 'terminal-violation',
      violation: { code: 'protocol-violation', terminal: true },
    });
    expect(ledger.terminal).toBe(true);
  });

  test('keeps an unauthenticated transport context inert before wire parsing', () => {
    const ledger = createFoliateHostCommandLedger(session, 0);
    expect(
      receiveFoliateHostMessageWithIdentity(
        {
          authenticated: false,
          expectedSession: session,
          expectedGeneration: 0,
          expectedDirection: 'host-to-native',
          ledger,
        },
        'not json',
      ),
    ).toEqual({ disposition: 'stale-noop' });
    expect(ledger.terminal).toBe(false);
  });

  test('keeps an obsolete adapter context inert without parsing as current', () => {
    const ledger = createFoliateHostCommandLedger(session, 0);
    expect(
      receiveFoliateHostMessageWithIdentity(
        {
          authenticated: true,
          // This represents a stale adapter callback after its ledger changed.
          expectedSession: 'B'.repeat(43),
          expectedGeneration: 0,
          expectedDirection: 'host-to-native',
          ledger,
        },
        'not json',
      ),
    ).toEqual({ disposition: 'stale-noop' });
    expect(ledger.terminal).toBe(false);
  });
});
