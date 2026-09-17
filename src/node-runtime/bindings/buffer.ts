import type { BindingFactory } from './context';

/**
 * `buffer` binding.
 *
 * Node's real internal/buffer.js expects a lot from this binding; for the MVP we
 * implement Buffer directly in the `buffer` builtin and expose only the
 * encoding primitives that are genuinely binding-level (atob/btoa bridges).
 */
export const bufferBinding: BindingFactory = () => ({
  atob: (input: string): string => atob(input),
  btoa: (input: string): string => btoa(input),
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
});
