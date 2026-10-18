/**
 * Internal wire contract for the future native private relay. Keep this module
 * free of platform APIs so Android and iOS can make the same decision before
 * either transport owns the message.
 */
import { validateNativeTransferMessage } from './nativePublicationTransfer.js';
export const FOLIATE_HOST_PROTOCOL = 'hn-foliate-host';
export const FOLIATE_HOST_PROTOCOL_VERSION = 1;
export const FOLIATE_HOST_NORMAL_MESSAGE_BYTES = 8 * 1024;
export const FOLIATE_HOST_MODEL_MESSAGE_BYTES = 2 * 1024 * 1024;
export const FOLIATE_HOST_MAX_DEPTH = 40;
export const FOLIATE_HOST_MAX_COMMANDS = 4096;
const blockedKeys = new Set(['__proto__', 'constructor', 'prototype']);
const directions = ['native-to-host', 'host-to-native'];
const nativeTypes = [
    'bind',
    'probe',
    'transfer',
    'navigate',
    'flow',
    'dispose',
];
const hostTypes = ['ack', 'error', 'model', 'location'];
const formats = ['epub', 'mobi', 'kf8-azw3', 'fb2', 'fbz', 'cbz'];
const isSafeNonNegativeInteger = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isRecord = (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};
const hasOnlyKeys = (value, keys) => Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
const isScalarString = (value, maximum) => typeof value === 'string' &&
    value.length <= maximum &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
const isSession = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const hasBoundedModelBytes = (value) => {
    try {
        return (new TextEncoder().encode(JSON.stringify(value)).byteLength <=
            FOLIATE_HOST_MODEL_MESSAGE_BYTES);
    }
    catch {
        return false;
    }
};
const hasBoundedEnvelopeBytes = (value, maximum) => {
    try {
        return (new TextEncoder().encode(JSON.stringify(value)).byteLength <= maximum);
    }
    catch {
        return false;
    }
};
function validateModel(model) {
    if (!isRecord(model) ||
        !hasOnlyKeys(model, [
            'modelVersion',
            'format',
            'fixedLayout',
            'flow',
            'direction',
            'metadata',
            'sections',
            'toc',
            'destinations',
        ]) ||
        model.modelVersion !== 1 ||
        !formats.includes(model.format) ||
        typeof model.fixedLayout !== 'boolean' ||
        (model.fixedLayout
            ? model.flow !== null
            : model.flow !== 'scrolled' && model.flow !== 'paginated') ||
        (model.direction !== 'ltr' &&
            model.direction !== 'rtl' &&
            model.direction !== null) ||
        !isRecord(model.metadata) ||
        !hasOnlyKeys(model.metadata, ['title']) ||
        !(model.metadata.title === null ||
            isScalarString(model.metadata.title, 1024)) ||
        !Array.isArray(model.sections) ||
        !Array.isArray(model.destinations) ||
        !Array.isArray(model.toc) ||
        model.sections.length > 10000 ||
        model.destinations.length > 10000) {
        return false;
    }
    const sectionIds = new Set();
    const sectionIndexes = new Map();
    for (const [index, section] of model.sections.entries()) {
        if (!isRecord(section) ||
            !hasOnlyKeys(section, ['id', 'index', 'linear']) ||
            !isScalarString(section.id, 64) ||
            !isSafeNonNegativeInteger(section.index) ||
            section.index !== index ||
            typeof section.linear !== 'boolean' ||
            sectionIds.has(section.id)) {
            return false;
        }
        sectionIds.add(section.id);
        sectionIndexes.set(section.id, section.index);
    }
    const destinationIds = new Set();
    for (const destination of model.destinations) {
        if (!isRecord(destination) ||
            !hasOnlyKeys(destination, ['id', 'sectionId', 'sectionIndex']) ||
            !isScalarString(destination.id, 64) ||
            !/^d:\d+$/.test(destination.id) ||
            !isScalarString(destination.sectionId, 64) ||
            !sectionIds.has(destination.sectionId) ||
            sectionIndexes.get(destination.sectionId) !== destination.sectionIndex ||
            !isSafeNonNegativeInteger(destination.sectionIndex) ||
            destinationIds.has(destination.id)) {
            return false;
        }
        destinationIds.add(destination.id);
    }
    const tocIds = new Set();
    const stack = model.toc.map((node) => ({ node, depth: 1 }));
    let count = 0;
    while (stack.length) {
        const current = stack.pop();
        if (!current ||
            ++count > 10000 ||
            current.depth > 32 ||
            !isRecord(current.node)) {
            return false;
        }
        const node = current.node;
        if (!hasOnlyKeys(node, ['id', 'label', 'destinationId', 'subitems']) ||
            !isScalarString(node.id, 64) ||
            !isScalarString(node.label, 2048) ||
            !(node.destinationId === null ||
                (isScalarString(node.destinationId, 64) &&
                    destinationIds.has(node.destinationId))) ||
            !Array.isArray(node.subitems) ||
            tocIds.has(node.id)) {
            return false;
        }
        tocIds.add(node.id);
        for (const child of node.subitems) {
            stack.push({ node: child, depth: current.depth + 1 });
        }
    }
    return hasBoundedModelBytes(model);
}
function validatePayload(direction, type, payload) {
    if (!isRecord(payload))
        return false;
    if (direction === 'native-to-host') {
        if (type === 'bind' || type === 'dispose' || type === 'probe')
            return hasOnlyKeys(payload, []);
        if (type === 'transfer')
            return validateNativeTransferMessage(payload);
        if (type === 'navigate') {
            return (hasOnlyKeys(payload, ['target']) &&
                (isSafeNonNegativeInteger(payload.target) ||
                    (typeof payload.target === 'string' &&
                        /^d:\d+$/.test(payload.target))));
        }
        return (type === 'flow' &&
            hasOnlyKeys(payload, ['flow']) &&
            (payload.flow === 'scrolled' || payload.flow === 'paginated'));
    }
    if (type === 'ack') {
        return (hasOnlyKeys(payload, ['command', 'status']) &&
            typeof payload.command === 'string' &&
            nativeTypes.includes(payload.command) &&
            typeof payload.status === 'string' &&
            ((payload.command === 'bind' && payload.status === 'bridge-bound') ||
                (payload.command === 'probe' &&
                    payload.status === 'source-authorized') ||
                (payload.command === 'transfer' &&
                    ['accepted', 'ready', 'aborted'].includes(payload.status)) ||
                (['navigate', 'flow'].includes(payload.command) &&
                    payload.status === 'applied') ||
                (payload.command !== 'bind' &&
                    (payload.status === 'not-ready' || payload.status === 'unsupported'))));
    }
    if (type === 'error') {
        return (hasOnlyKeys(payload, ['code', 'terminal']) &&
            typeof payload.code === 'string' &&
            [
                'protocol-violation',
                'not-ready',
                'unsupported',
                'render-failure',
                'navigation-failure',
            ].includes(payload.code) &&
            typeof payload.terminal === 'boolean');
    }
    if (type === 'location') {
        return (hasOnlyKeys(payload, ['section', 'destination']) &&
            isSafeNonNegativeInteger(payload.section) &&
            (payload.destination === null ||
                (typeof payload.destination === 'string' &&
                    /^d:\d+$/.test(payload.destination))));
    }
    return (type === 'model' &&
        hasOnlyKeys(payload, ['model']) &&
        validateModel(payload.model));
}
/** Validates a value after a trusted parser has already produced it. */
export function validateFoliateHostEnvelope(value) {
    if (!isRecord(value) ||
        !hasOnlyKeys(value, [
            'protocol',
            'version',
            'direction',
            'type',
            'session',
            'generation',
            'commandId',
            'payload',
        ]) ||
        value.protocol !== FOLIATE_HOST_PROTOCOL ||
        value.version !== FOLIATE_HOST_PROTOCOL_VERSION ||
        !directions.includes(value.direction) ||
        typeof value.type !== 'string' ||
        !isSession(value.session) ||
        !isSession(value.generation) ||
        !isSession(value.commandId)) {
        return { ok: false, reason: 'invalid-envelope' };
    }
    const direction = value.direction;
    const type = value.type;
    if ((direction === 'native-to-host'
        ? !nativeTypes.includes(type)
        : !hostTypes.includes(type)) ||
        !validatePayload(direction, type, value.payload)) {
        return { ok: false, reason: 'invalid-message' };
    }
    if (type === 'transfer' && direction === 'native-to-host') {
        const transfer = value.payload;
        if (transfer.session !== value.session ||
            transfer.generation !== value.generation ||
            transfer.commandId !== value.commandId)
            return { ok: false, reason: 'transfer-identity' };
    }
    if (!hasBoundedEnvelopeBytes(value, type === 'model'
        ? FOLIATE_HOST_MODEL_MESSAGE_BYTES
        : type === 'transfer'
            ? 70 * 1024
            : FOLIATE_HOST_NORMAL_MESSAGE_BYTES)) {
        return { ok: false, reason: 'message-too-large' };
    }
    return { ok: true, value: value };
}
class StrictJsonScanner {
    input;
    index = 0;
    depth = 0;
    constructor(input) {
        this.input = input;
    }
    parse() {
        this.skipWhitespace();
        const value = this.parseValue();
        this.skipWhitespace();
        if (this.index !== this.input.length)
            this.fail('trailing-json');
        return value;
    }
    parseValue() {
        this.skipWhitespace();
        const marker = this.input[this.index];
        if (marker === '{')
            return this.parseObject();
        if (marker === '[')
            return this.parseArray();
        if (marker === '"')
            return this.parseString();
        if (marker === '-' || (marker >= '0' && marker <= '9'))
            return this.parseNumber();
        if (this.input.startsWith('true', this.index))
            return this.literal(true, 4);
        if (this.input.startsWith('false', this.index))
            return this.literal(false, 5);
        if (this.input.startsWith('null', this.index))
            return this.literal(null, 4);
        this.fail('invalid-json');
    }
    parseObject() {
        this.enter();
        this.index += 1;
        const result = Object.create(null);
        const keys = new Set();
        this.skipWhitespace();
        if (this.input[this.index] === '}') {
            this.index += 1;
            this.depth -= 1;
            return result;
        }
        while (true) {
            this.skipWhitespace();
            if (this.input[this.index] !== '"')
                this.fail('invalid-object-key');
            const key = this.parseString();
            if (keys.has(key))
                this.fail('duplicate-key');
            if (blockedKeys.has(key))
                this.fail('blocked-key');
            keys.add(key);
            this.skipWhitespace();
            if (this.input[this.index] !== ':')
                this.fail('invalid-object');
            this.index += 1;
            result[key] = this.parseValue();
            this.skipWhitespace();
            const separator = this.input[this.index];
            if (separator === '}') {
                this.index += 1;
                this.depth -= 1;
                return result;
            }
            if (separator !== ',')
                this.fail('invalid-object');
            this.index += 1;
        }
    }
    parseArray() {
        this.enter();
        this.index += 1;
        const result = [];
        this.skipWhitespace();
        if (this.input[this.index] === ']') {
            this.index += 1;
            this.depth -= 1;
            return result;
        }
        while (true) {
            result.push(this.parseValue());
            this.skipWhitespace();
            const separator = this.input[this.index];
            if (separator === ']') {
                this.index += 1;
                this.depth -= 1;
                return result;
            }
            if (separator !== ',')
                this.fail('invalid-array');
            this.index += 1;
        }
    }
    parseString() {
        let result = '';
        this.index += 1;
        while (this.index < this.input.length) {
            const character = this.input[this.index++];
            if (character === '"')
                return result;
            if (character < ' ')
                this.fail('invalid-string');
            if (character !== '\\') {
                const code = character.charCodeAt(0);
                if (code >= 0xd800 && code <= 0xdbff) {
                    const low = this.input.charCodeAt(this.index);
                    if (low < 0xdc00 || low > 0xdfff)
                        this.fail('invalid-unicode');
                    result += character + this.input[this.index++];
                    continue;
                }
                if (code >= 0xdc00 && code <= 0xdfff)
                    this.fail('invalid-unicode');
                result += character;
                continue;
            }
            const escapedCharacter = this.input[this.index++];
            if (escapedCharacter === '"' ||
                escapedCharacter === '\\' ||
                escapedCharacter === '/') {
                result += escapedCharacter;
            }
            else if (escapedCharacter === 'b')
                result += '\b';
            else if (escapedCharacter === 'f')
                result += '\f';
            else if (escapedCharacter === 'n')
                result += '\n';
            else if (escapedCharacter === 'r')
                result += '\r';
            else if (escapedCharacter === 't')
                result += '\t';
            else if (escapedCharacter === 'u')
                result += this.parseUnicodeEscape();
            else
                this.fail('invalid-escape');
        }
        this.fail('unterminated-string');
    }
    parseUnicodeEscape() {
        const code = Number.parseInt(this.input.slice(this.index, this.index + 4), 16);
        if (!Number.isInteger(code) ||
            !/^[0-9a-fA-F]{4}$/.test(this.input.slice(this.index, this.index + 4))) {
            this.fail('invalid-unicode');
        }
        this.index += 4;
        if (code >= 0xdc00 && code <= 0xdfff)
            this.fail('invalid-unicode');
        if (code < 0xd800 || code > 0xdbff)
            return String.fromCharCode(code);
        if (this.input.slice(this.index, this.index + 2) !== '\\u')
            this.fail('invalid-unicode');
        const low = Number.parseInt(this.input.slice(this.index + 2, this.index + 6), 16);
        if (!Number.isInteger(low) ||
            !/^[0-9a-fA-F]{4}$/.test(this.input.slice(this.index + 2, this.index + 6)) ||
            low < 0xdc00 ||
            low > 0xdfff) {
            this.fail('invalid-unicode');
        }
        this.index += 6;
        return String.fromCharCode(code, low);
    }
    parseNumber() {
        // Every numeric field in this closed wire format is a non-negative,
        // JavaScript-safe decimal integer. Keeping this lexical check here avoids
        // JSON.parse-style coercion of 1.0 and 1e0 before validation can see it.
        const match = /(?:0|[1-9]\d*)/y;
        match.lastIndex = this.index;
        const token = match.exec(this.input)?.[0];
        if (!token)
            this.fail('invalid-number');
        this.index += token.length;
        const value = Number(token);
        if (!Number.isSafeInteger(value))
            this.fail('invalid-integer');
        return value;
    }
    literal(value, length) {
        this.index += length;
        return value;
    }
    skipWhitespace() {
        while (/\s/.test(this.input[this.index] ?? ''))
            this.index += 1;
    }
    enter() {
        this.depth += 1;
        if (this.depth > FOLIATE_HOST_MAX_DEPTH)
            this.fail('depth-limit');
    }
    fail(reason) {
        throw new Error(reason);
    }
}
/**
 * Scans untrusted wire bytes before any identity or schema decision. Keeping
 * this separate from envelope validation lets the identity-aware receiver
 * distinguish a valid stale envelope from a malformed current one without
 * ever falling back to JSON.parse.
 */
function scanFoliateHostMessage(data) {
    if (typeof data !== 'string')
        return { ok: false, reason: 'invalid-data' };
    const bytes = new TextEncoder().encode(data).byteLength;
    if (bytes > FOLIATE_HOST_MODEL_MESSAGE_BYTES) {
        return { ok: false, reason: 'message-too-large' };
    }
    try {
        return { ok: true, value: new StrictJsonScanner(data).parse(), bytes };
    }
    catch (error) {
        return {
            ok: false,
            reason: error instanceof Error ? error.message : 'invalid-json',
        };
    }
}
function validateScannedFoliateHostMessage(scanned) {
    const result = validateFoliateHostEnvelope(scanned.value);
    if (!result.ok)
        return result;
    if (scanned.bytes >
        (result.value.type === 'transfer'
            ? 70 * 1024
            : FOLIATE_HOST_NORMAL_MESSAGE_BYTES) &&
        result.value.type !== 'model') {
        return { ok: false, reason: 'message-too-large' };
    }
    return result;
}
/** Parses wire data without JSON.parse so duplicate JSON keys cannot be hidden. */
export function parseFoliateHostMessage(data) {
    const scanned = scanFoliateHostMessage(data);
    return scanned.ok ? validateScannedFoliateHostMessage(scanned) : scanned;
}
export function serializeFoliateHostMessage(value) {
    const validation = validateFoliateHostEnvelope(value);
    if (!validation.ok)
        throw new TypeError(validation.reason);
    const data = JSON.stringify(value);
    const parsed = parseFoliateHostMessage(data);
    if (!parsed.ok)
        throw new TypeError(parsed.reason);
    return data;
}
/** Creates an empty verifier for one adapter-owned session and generation. */
export function createFoliateHostCommandLedger(session, generation) {
    if (!isSession(session) || !isSession(generation)) {
        throw new TypeError('invalid-binding');
    }
    return {
        session,
        generation,
        bound: false,
        terminal: false,
        lastCommandId: undefined,
        usedCommandIds: new Set(),
        lastCommandType: undefined,
        inflightCommandId: undefined,
    };
}
/**
 * Applies direction-specific state rules after strict envelope parsing.
 * Stale identity and duplicate command IDs are inert; current-state schema or
 * sequencing faults terminate the private relay. `bind` is the first command; its
 * acknowledgement proves only bridge binding, never reader readiness.
 */
export function applyFoliateHostCommand(ledger, envelope) {
    if (ledger.terminal)
        return { disposition: 'no-op', reason: 'terminal' };
    if (envelope.session !== ledger.session ||
        envelope.generation !== ledger.generation) {
        return { disposition: 'no-op', reason: 'stale-identity' };
    }
    if (envelope.direction === 'native-to-host') {
        const command = envelope.type;
        if (!ledger.bound) {
            if (command !== 'bind') {
                ledger.terminal = true;
                return { disposition: 'terminal', reason: 'missing-initial-bind' };
            }
            ledger.bound = true;
            ledger.lastCommandId = envelope.commandId;
            ledger.usedCommandIds.add(envelope.commandId);
            ledger.lastCommandType = command;
            ledger.inflightCommandId = envelope.commandId;
            return { disposition: 'accepted', reason: 'bind' };
        }
        if (ledger.usedCommandIds.has(envelope.commandId)) {
            return { disposition: 'no-op', reason: 'duplicate-command' };
        }
        if (command === 'bind') {
            ledger.terminal = true;
            return { disposition: 'terminal', reason: 'duplicate-bind' };
        }
        if (command === 'transfer' && !ledger.sourceAuthorized) {
            ledger.terminal = true;
            return { disposition: 'terminal', reason: 'source-gate-closed' };
        }
        const abort = command === 'transfer' && envelope.payload.type === 'abort';
        if (ledger.inflightCommandId !== undefined &&
            command !== 'dispose' &&
            !abort) {
            ledger.terminal = true;
            return { disposition: 'terminal', reason: 'multiple-inflight' };
        }
        // Never evict an old ID: that would make a replay actionable again.
        if (ledger.usedCommandIds.size >= FOLIATE_HOST_MAX_COMMANDS) {
            ledger.terminal = true;
            return { disposition: 'terminal', reason: 'command-limit' };
        }
        ledger.usedCommandIds.add(envelope.commandId);
        ledger.lastCommandId = envelope.commandId;
        ledger.lastCommandType = command;
        // Dispose may supersede a pending non-dispose command, but it still needs
        // exact ack/error correlation before it closes the relay.
        ledger.inflightCommandId = envelope.commandId;
        return { disposition: 'accepted', reason: command };
    }
    const event = envelope.type;
    if (event === 'model' || event === 'location') {
        return envelope.commandId === ledger.lastCommandId
            ? { disposition: 'accepted', reason: event }
            : { disposition: 'no-op', reason: 'stale-event' };
    }
    if (envelope.commandId !== ledger.inflightCommandId) {
        return { disposition: 'no-op', reason: 'uncorrelated-event' };
    }
    if (event === 'ack') {
        const payload = envelope.payload;
        if (payload.command !== ledger.lastCommandType) {
            ledger.terminal = true;
            return { disposition: 'terminal', reason: 'ack-command-mismatch' };
        }
        ledger.inflightCommandId = undefined;
        if (ledger.lastCommandType === 'probe')
            ledger.sourceAuthorized = envelope.payload.status === 'source-authorized';
        if (ledger.lastCommandType === 'dispose')
            ledger.terminal = true;
        return { disposition: 'accepted', reason: 'ack' };
    }
    const payload = envelope.payload;
    ledger.inflightCommandId = undefined;
    if (payload.terminal)
        ledger.terminal = true;
    return { disposition: 'accepted', reason: 'error' };
}
const staleWireDisposition = () => ({
    disposition: 'stale-noop',
});
function terminalWireDisposition(ledger) {
    ledger.terminal = true;
    return {
        disposition: 'terminal-violation',
        violation: createTerminalProtocolViolation(),
    };
}
/**
 * A stale wire must prove its staleness with a well-formed identity component.
 * An omitted or malformed identity field is instead a closed-schema fault from
 * the authenticated current host. This ordering prevents an unsupported
 * protocol/version/type from hiding behind an overly broad stale classification.
 */
function hasExplicitlyStaleWireIdentity(value, context) {
    return (isRecord(value) &&
        ((directions.includes(value.direction) &&
            value.direction !== context.expectedDirection) ||
            (isSession(value.session) && value.session !== context.expectedSession) ||
            (isSession(value.generation) &&
                value.generation !== context.expectedGeneration)));
}
function hasConsistentWireDispositionContext(context) {
    return (isSession(context.expectedSession) &&
        isSession(context.expectedGeneration) &&
        directions.includes(context.expectedDirection) &&
        context.ledger.session === context.expectedSession &&
        context.ledger.generation === context.expectedGeneration);
}
/**
 * Receives one raw private-relay message through the only identity-aware
 * disposition path. Relays must set `authenticated` only after checking their
 * sender/frame/port context. A non-current context, direction, session,
 * generation, or acknowledgement has no ledger side effect. In contrast, a
 * strict-JSON or closed-schema violation in the authenticated current identity
 * context is terminal.
 *
 * Do not pre-parse `data` before calling this function: doing so would let a
 * platform adapter lose StrictJsonScanner's duplicate-key and blocked-key
 * protections. `parseFoliateHostMessage` and `receiveFoliateHostMessage`
 * remain compatibility APIs; new private relay integrations should use this
 * function.
 */
export function receiveFoliateHostMessageWithIdentity(context, data) {
    if (!context.authenticated)
        return staleWireDisposition();
    if (context.ledger.terminal)
        return staleWireDisposition();
    if (!hasConsistentWireDispositionContext(context)) {
        // The caller may race an old adapter context against a replacement ledger.
        // That is stale routing metadata, not authenticated current-host traffic.
        return staleWireDisposition();
    }
    const scanned = scanFoliateHostMessage(data);
    if (!scanned.ok)
        return terminalWireDisposition(context.ledger);
    if (hasExplicitlyStaleWireIdentity(scanned.value, context)) {
        return staleWireDisposition();
    }
    const parsed = validateScannedFoliateHostMessage(scanned);
    if (!parsed.ok)
        return terminalWireDisposition(context.ledger);
    const applied = applyFoliateHostCommand(context.ledger, parsed.value);
    if (applied.disposition === 'accepted') {
        return { disposition: 'accepted', envelope: parsed.value };
    }
    return applied.disposition === 'no-op'
        ? staleWireDisposition()
        : terminalWireDisposition(context.ledger);
}
/**
 * Legacy compatibility receiver without sender/direction context. It retains
 * its historical parse-failure-is-terminal behavior. New private relays must
 * use receiveFoliateHostMessageWithIdentity instead.
 */
export function receiveFoliateHostMessage(ledger, data) {
    const parsed = parseFoliateHostMessage(data);
    if (!parsed.ok) {
        ledger.terminal = true;
        return { disposition: 'terminal', reason: parsed.reason };
    }
    return applyFoliateHostCommand(ledger, parsed.value);
}
/** The later platform adapters use this only after authenticating the sender. */
export function createTerminalProtocolViolation() {
    return { code: 'protocol-violation', terminal: true };
}
