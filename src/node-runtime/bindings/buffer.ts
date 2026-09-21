import type { BindingFactory } from './context';

/**
 * `buffer` binding.
 *
 * Node's real internal/buffer.js expects a lot from this binding; for the MVP we
 * implement Buffer directly in the `buffer` builtin and expose only the
 * encoding primitives that are genuinely binding-level (atob/btoa bridges).
 */
export const bufferBinding: BindingFactory = () => ({
  // Node's own limit (`buffer.kMaxLength` on a 64-bit build); `internal/blob.js`
  // bounds a Blob's total length with it.
  kMaxLength: Number.MAX_SAFE_INTEGER,
  atob: (input: string): string => atob(input),
  btoa: (input: string): string => btoa(input),
  // `binding.copyArrayBuffer(dest, destOffset, src, srcOffset, count)`
  // (src/node_buffer.cc): the byte copy the WHATWG byte-stream controller uses
  // when it fills a pull-into descriptor from its queue. It works on whole
  // ArrayBuffers with explicit offsets rather than on views.
  copyArrayBuffer: (
    destination: ArrayBuffer,
    destinationOffset: number,
    source: ArrayBuffer,
    sourceOffset: number,
    byteCount: number,
  ): void => {
    if (destination === source) return;
    new Uint8Array(destination, destinationOffset, byteCount).set(
      new Uint8Array(source, sourceOffset, byteCount),
    );
  },
  // Encoding intrinsics Node exposes from C++ (fast paths). We fall back to the
  // JS implementations in the buffer builtin.
  isAscii: (buf: Uint8Array): boolean => {
    for (let i = 0; i < buf.length; i++) if (buf[i] > 0x7f) return false;
    return true;
  },
  isUtf8: (buf: Uint8Array): boolean => {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
      return true;
    } catch {
      return false;
    }
  },
  // `binding.compare(a, b)` (src/node_buffer.cc): byte-wise compare of two
  // views, normalized to -1/0/1 (first by bytes, then by length). Used by
  // `internal/util/comparisons` to short-circuit buffer equality.
  compare: (a: ArrayBufferView | ArrayBuffer, b: ArrayBufferView | ArrayBuffer): number => {
    const av = toBytes(a);
    const bv = toBytes(b);
    const len = Math.min(av.length, bv.length);
    for (let i = 0; i < len; i++) {
      if (av[i] !== bv[i]) return av[i] < bv[i] ? -1 : 1;
    }
    if (av.length === bv.length) return 0;
    return av.length < bv.length ? -1 : 1;
  },
});

function toBytes(view: ArrayBufferView | ArrayBuffer): Uint8Array {
  if (ArrayBuffer.isView(view)) {
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return new Uint8Array(view as ArrayBuffer);
}
