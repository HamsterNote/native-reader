import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto';

/** The adapter, never the native relay, owns these 256-bit identities. */
export function createNativeProtocolId(): string {
  const bytes = getRandomValues(new Uint8Array(32));
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      result += alphabet[(value >>> bits) & 63];
    }
  }
  if (bits) result += alphabet[(value << (6 - bits)) & 63];
  return result;
}

export async function digestNativeSource(bytes: Uint8Array): Promise<string> {
  const hash = await digest(
    CryptoDigestAlgorithm.SHA256,
    new Uint8Array(bytes),
  );
  return Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}
