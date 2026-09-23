/**
 * `wn_openssl` — thin binding over the wasi-built OpenSSL subset (M119).
 *
 * The module is **lazy**: it is not part of the startup `WASM_MODULES` set (it
 * is ~2.3 MB, which would undo M107's startup work). It is fetched in the
 * background after boot, and every caller must cope with it not being ready
 * yet — hence {@link opensslReady}. Callers fall back to the pure-JS
 * implementation until it lands, which is fine because both are byte-identical
 * to Node.
 *
 * Layout mirrors the other bindings: JS never hands a typed-array pointer to
 * wasm; it allocates inside wasm linear memory, writes the input, calls, and
 * reads the result back (re-taking the view each time, since memory can grow).
 */
import { wasmLoaded, wasmModule } from '../wasm/registry';
import type { WasmExports } from '../wasm/loader';

export const OPENSSL_MODULE = 'wn_openssl';

/** Whether the OpenSSL module has been instantiated yet. */
export function opensslReady(): boolean {
  return wasmLoaded(OPENSSL_MODULE);
}

function ex(): WasmExports {
  return wasmModule(OPENSSL_MODULE);
}

function call<T>(name: string, ...args: number[]): T {
  const fn = ex()[name] as ((...a: number[]) => T) | undefined;
  if (typeof fn !== 'function') {
    throw new Error(`wn_openssl: missing export "${name}"`);
  }
  return fn(...args);
}

function memory(): WebAssembly.Memory {
  return ex().memory as WebAssembly.Memory;
}

function bytes(): Uint8Array {
  return new Uint8Array(memory().buffer);
}

/** OpenSSL version number (`0x30500080` for 3.5.8). */
export function opensslVersion(): number {
  return call<number>('wn_openssl_version');
}

/** The most recent OpenSSL error string, or `''`. */
export function opensslLastError(): string {
  const ptr = call<number>('wn_openssl_last_error');
  if (!ptr) return '';
  const mem = bytes();
  let end = ptr;
  while (end < mem.length && mem[end] !== 0) end++;
  return new TextDecoder().decode(mem.subarray(ptr, end));
}

/** Copy a byte string into fresh wasm memory; returns `[ptr, len]`. */
function push(data: Uint8Array): [number, number] {
  const len = data.byteLength;
  const ptr = call<number>('wn_alloc', Math.max(len, 1));
  if (!ptr) throw new Error('wn_openssl: out of memory');
  if (len > 0) bytes().set(data, ptr);
  return [ptr, len];
}

function free(ptr: number): void {
  if (ptr) call<number>('wn_dealloc', ptr);
}

/** Copy a NUL-free name into wasm memory (kept NUL-free; the C side copies). */
function pushName(name: string): [number, number] {
  return push(new TextEncoder().encode(name));
}

/**
 * Digest `data`, or `null` when OpenSSL does not know `opensslName`.
 * `outputLength` selects the XOF length (shake128/256).
 */
export function opensslDigest(
  opensslName: string,
  data: Uint8Array,
  outputLength?: number,
): Uint8Array | null {
  const [namePtr, nameLen] = pushName(opensslName);
  const [dataPtr, dataLen] = push(data);
  // 64 bytes is enough for every fixed digest we expose; XOFs ask separately.
  const capacity = outputLength ?? 64;
  const outPtr = call<number>('wn_alloc', capacity);
  try {
    const written =
      outputLength === undefined
        ? call<number>('wn_digest', namePtr, nameLen, dataPtr, dataLen, outPtr)
        : call<number>('wn_digest_xof', namePtr, nameLen, dataPtr, dataLen, outPtr, outputLength);
    if (written < 0) return null;
    return bytes().slice(outPtr, outPtr + written);
  } finally {
    free(outPtr);
    free(dataPtr);
    free(namePtr);
  }
}

/** Digest size in bytes for `opensslName`, or `-1` when unknown. */
export function opensslDigestSize(opensslName: string): number {
  const [namePtr, nameLen] = pushName(opensslName);
  try {
    return call<number>('wn_digest_size', namePtr, nameLen);
  } finally {
    free(namePtr);
  }
}

/** HMAC over `data` with `key`, or `null` when `opensslName` is unknown. */
export function opensslHmac(
  opensslName: string,
  key: Uint8Array,
  data: Uint8Array,
): Uint8Array | null {
  const [namePtr, nameLen] = pushName(opensslName);
  const [keyPtr, keyLen] = push(key);
  const [dataPtr, dataLen] = push(data);
  const outPtr = call<number>('wn_alloc', 64);
  try {
    const written = call<number>('wn_hmac', namePtr, nameLen, keyPtr, keyLen, dataPtr, dataLen, outPtr);
    if (written < 0) return null;
    return bytes().slice(outPtr, outPtr + written);
  } finally {
    free(outPtr);
    free(dataPtr);
    free(keyPtr);
    free(namePtr);
  }
}
