import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export function createWebId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function documentDigest(bytes: Uint8Array): Promise<string> {
  if (crypto.subtle)
    return bytesToHex(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', bytes.slice().buffer),
      ),
    );
  return bytesToHex(sha256(bytes));
}
