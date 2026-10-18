const FOLIATE_NATIVE_HOST_VERSION = "foliate-native-host-1";
const FOLIATE_HOST_PROTOCOL = 'hn-foliate-host';
const FOLIATE_HOST_PROTOCOL_VERSION = 1;

// The platform must retain this port. This module installs neither a window
// listener nor a page-world capability, so an unstaged native channel fails closed.
let privatePort = null;
let binding = null;

const hasOnlyKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const isSession = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const isInteger = value => Number.isSafeInteger(value) && value >= 0;
const commandPayload = (type, payload) => {
  if (type === 'bind' || type === 'dispose') return hasOnlyKeys(payload, []);
  if (type === 'navigate') return hasOnlyKeys(payload, ['target']) && (isInteger(payload.target) || (typeof payload.target === 'string' && /^d:\d+$/.test(payload.target)));
  return type === 'flow' && hasOnlyKeys(payload, ['flow']) && (payload.flow === 'scrolled' || payload.flow === 'paginated');
};
function strictJson(data) {
  let index = 0;
  let depth = 0;
  const whitespace = () => { while (/\s/.test(data[index] || '')) index += 1; };
  const fail = () => { throw new Error('invalid-json'); };
  const enter = () => { if (++depth > 40) fail(); };
  const string = () => {
    let output = '';
    if (data[index++] !== '"') fail();
    while (index < data.length) {
      const character = data[index++];
      if (character === '"') return output;
      if (character < ' ') fail();
      if (character !== '\\') {
        const code = character.charCodeAt(0);
        if (code >= 0xd800 && code <= 0xdbff) {
          const low = data.charCodeAt(index);
          if (low < 0xdc00 || low > 0xdfff) fail();
          output += character + data[index++];
          continue;
        }
        if (code >= 0xdc00 && code <= 0xdfff) fail();
        output += character;
        continue;
      }
      const escaped = data[index++];
      if ('"\\/'.includes(escaped)) output += escaped;
      else if (escaped === 'b') output += '\b';
      else if (escaped === 'f') output += '\f';
      else if (escaped === 'n') output += '\n';
      else if (escaped === 'r') output += '\r';
      else if (escaped === 't') output += '\t';
      else if (escaped === 'u') {
        const token = data.slice(index, index + 4);
        if (!/^[0-9a-f]{4}$/i.test(token)) fail();
        const code = Number.parseInt(token, 16);
        index += 4;
        if (code >= 0xdc00 && code <= 0xdfff) fail();
        if (code >= 0xd800 && code <= 0xdbff) {
          if (data.slice(index, index + 2) !== '\\u') fail();
          const lowToken = data.slice(index + 2, index + 6);
          const low = Number.parseInt(lowToken, 16);
          if (!/^[0-9a-f]{4}$/i.test(lowToken) || low < 0xdc00 || low > 0xdfff) fail();
          index += 6;
          output += String.fromCharCode(code, low);
        } else output += String.fromCharCode(code);
      } else fail();
    }
    fail();
  };
  const value = () => {
    whitespace();
    if (data[index] === '"') return string();
    if (data[index] === '{') {
      enter(); index += 1; const result = Object.create(null); const keys = new Set(); whitespace();
      if (data[index] === '}') { index += 1; depth -= 1; return result; }
      while (true) {
        whitespace(); const key = string();
        if (keys.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail();
        keys.add(key); whitespace(); if (data[index++] !== ':') fail(); result[key] = value(); whitespace();
        if (data[index] === '}') { index += 1; depth -= 1; return result; }
        if (data[index++] !== ',') fail();
      }
    }
    if (data[index] === '[') {
      enter(); index += 1; const result = []; whitespace();
      if (data[index] === ']') { index += 1; depth -= 1; return result; }
      while (true) { result.push(value()); whitespace(); if (data[index] === ']') { index += 1; depth -= 1; return result; } if (data[index++] !== ',') fail(); }
    }
    // The host wire accepts only canonical decimal integer tokens. Parsing
    // lexically prevents JSON number coercion from accepting 1.0 or 1e0.
    const token = /(?:0|[1-9]\d*)/y; token.lastIndex = index;
    const number = token.exec(data)?.[0];
    if (number) { index += number.length; const parsed = Number(number); if (!Number.isFinite(parsed)) fail(); return parsed; }
    for (const [literal, parsed] of [['true', true], ['false', false], ['null', null]]) if (data.startsWith(literal, index)) { index += literal.length; return parsed; }
    fail();
  };
  const result = value(); whitespace(); if (index !== data.length) fail(); return result;
}
function parse(data) {
  if (typeof data !== 'string' || new TextEncoder().encode(data).byteLength > 8192) return null;
  try {
    const value = strictJson(data);
    if (!hasOnlyKeys(value, ['protocol', 'version', 'direction', 'type', 'session', 'generation', 'commandId', 'payload']) || value.protocol !== FOLIATE_HOST_PROTOCOL || value.version !== FOLIATE_HOST_PROTOCOL_VERSION || value.direction !== 'native-to-host' || !['bind', 'navigate', 'flow', 'dispose'].includes(value.type) || !isSession(value.session) || !isInteger(value.generation) || !isInteger(value.commandId) || !commandPayload(value.type, value.payload)) return null;
    return value;
  } catch { return null; }
}
function send(command, type, payload) {
  if (!privatePort || !binding) return;
  privatePort.postMessage(JSON.stringify({ protocol: FOLIATE_HOST_PROTOCOL, version: FOLIATE_HOST_PROTOCOL_VERSION, direction: 'host-to-native', type, session: binding.session, generation: binding.generation, commandId: command?.commandId ?? 0, payload }));
}
function teardown() {
  const port = privatePort;
  privatePort = null;
  binding = null;
  try { port?.removeEventListener?.('message', receive); } catch {}
  try { port?.close?.(); } catch {}
}
function receive(event) {
  const command = parse(event?.data);
  if (!command) {
    if (binding) send(null, 'error', { code: 'protocol-violation', terminal: true });
    return teardown();
  }
  if (!binding) {
    if (command.type !== 'bind' || command.commandId !== 0) return teardown();
    binding = { session: command.session, generation: command.generation, lastCommandId: 0, inflight: 0 };
    send(command, 'ack', { command: 'bind', status: 'bridge-bound' });
    binding.inflight = null;
    return;
  }
  if (command.session !== binding.session || command.generation !== binding.generation) return;
  // Duplicate/old commands belong to an already observed adapter sequence and
  // are inert. A new command must remain strictly monotonic for this session.
  if (command.commandId <= binding.lastCommandId) return;
  if (command.type === 'bind') {
    send(command, 'error', { code: 'protocol-violation', terminal: true });
    return teardown();
  }
  if (binding.inflight !== null && command.type !== 'dispose') {
    send(command, 'error', { code: 'protocol-violation', terminal: true });
    return teardown();
  }
  binding.lastCommandId = command.commandId;
  binding.inflight = command.commandId;
  if (command.type === 'dispose') {
    send(command, 'ack', { command: 'dispose', status: 'unsupported' });
    return teardown();
  }
  send(command, 'ack', { command: command.type, status: 'not-ready' });
  binding.inflight = null;
}

// Only a native-owned private relay may call this imported module binding.
export function installFoliateNativeHostBridge(port) {
  if (privatePort || !port || typeof port.postMessage !== 'function' || typeof port.addEventListener !== 'function') return false;
  privatePort = port;
  port.addEventListener('message', receive);
  port.start?.();
  return true;
}
