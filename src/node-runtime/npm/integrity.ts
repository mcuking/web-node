/**
 * Subresource Integrity for downloaded tarballs.
 *
 * The registry records a `dist.integrity` (SRI, usually sha512) and, for older
 * packages, a `dist.shasum` (sha1 hex). We check whichever is present so a
 * tampered or truncated tarball is rejected *before* anything reaches the VFS.
 *
 * Hashing goes through WebCrypto (`crypto.subtle`), which exists both in the
 * browser worker and under Node — no hash algorithm of our own to get wrong.
 */

import { encodeBase64 } from '../vfs/base64';
import type { Dist } from './registry';

const WEB_ALGORITHM: Record<string, string> = {
  sha512: 'SHA-512',
  sha256: 'SHA-256',
  sha1: 'SHA-1',
};

export interface Sri {
  algorithm: string;
  base64: string;
}

/** Parse an SRI string (`sha512-<base64>` entries, whitespace separated). */
export function parseSri(value: string): Sri[] {
  const out: Sri[] = [];
  for (const part of value.trim().split(/\s+/)) {
    if (!part) continue;
    const dash = part.indexOf('-');
    if (dash <= 0) continue;
    out.push({ algorithm: part.slice(0, dash).toLowerCase(), base64: part.slice(dash + 1) });
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** base64 without trailing `=` — SRI writers vary on padding. */
function canonicalBase64(bytes: Uint8Array): string {
  return encodeBase64(bytes).replace(/=+$/, '');
}

function normalizeBase64(text: string): string {
  return text.replace(/=+$/, '');
}

async function digest(algorithm: string, bytes: Uint8Array): Promise<Uint8Array | null> {
  const web = WEB_ALGORITHM[algorithm];
  const subtle = globalThis.crypto?.subtle;
  if (!web || !subtle) return null;
  try {
    // TS 5.6 + DOM: a `Uint8Array<ArrayBufferLike>` is not a `BufferSource`
    // (its buffer may be a SharedArrayBuffer), so hand over a real ArrayBuffer.
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Uint8Array(await subtle.digest(web, data));
  } catch {
    return null;
  }
}

/**
 * Verify `bytes` against a `dist` record, returning the integrity string to
 * record in the lockfile.
 *
 * Throws on a mismatch. Returns `undefined` when the registry supplied nothing
 * we can check (a very old or private registry), so the caller can carry on.
 */
export async function verifyIntegrity(bytes: Uint8Array, dist: Dist): Promise<string | undefined> {
  const integrity = (dist.integrity ?? '').trim();
  if (integrity) {
    const expected = parseSri(integrity);
    let computable = 0;
    for (const sri of expected) {
      const actual = await digest(sri.algorithm, bytes);
      if (!actual) continue; // algorithm we cannot compute — try the next
      computable += 1;
      if (canonicalBase64(actual) === normalizeBase64(sri.base64)) return integrity;
    }
    if (computable > 0) {
      throw new Error(`integrity check failed (expected ${integrity})`);
    }
    // No algorithm we can compute; fall through to shasum if present.
  }

  const shasum = (dist.shasum ?? '').trim().toLowerCase();
  if (shasum) {
    const actual = await digest('sha1', bytes);
    if (actual) {
      if (toHex(actual) !== shasum) throw new Error(`shasum check failed (expected ${shasum})`);
      return `sha1-${encodeBase64(actual)}`;
    }
  }

  return undefined;
}
