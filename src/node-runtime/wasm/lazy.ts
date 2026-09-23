/**
 * native → WASM (M119): **lazy** module loading.
 *
 * `WASM_MODULES` (`wasm/index.ts`) is instantiated eagerly at worker startup
 * because bindings are built synchronously. That is fine for the small codec
 * modules, but the OpenSSL subset is ~2.3 MB — eagerly awaiting it would undo
 * M107's startup work. So big modules live here instead: they are fetched in
 * the background after boot, and callers check `wasmLoaded(name)` before using
 * them (`bindings/openssl.ts` exposes that as `opensslReady()`).
 */
import wnOpensslUrl from './artifacts/wn_openssl.wasm?url';
import { instantiateWasm } from './loader';
import { installWasm, wasmLoaded } from './registry';

/** Modules that are fetched after startup rather than awaited at boot. */
export const LAZY_WASM_MODULES: Record<string, string> = {
  wn_openssl: wnOpensslUrl,
};

const pending = new Map<string, Promise<boolean>>();

function absolute(url: string): string {
  const href = (globalThis as { location?: { href?: string } }).location?.href;
  if (!href) return url;
  try {
    return new URL(url, href).href;
  } catch {
    return url;
  }
}

/**
 * Fetch + instantiate a lazy module (idempotent, memoised). Resolves to
 * `true` when the module is usable and `false` when loading failed — a failed
 * lazy module is a performance regression, never a correctness one, so callers
 * just keep using the fallback.
 */
export function loadWasmModule(name: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (wasmLoaded(name)) return Promise.resolve(true);
  const url = LAZY_WASM_MODULES[name];
  if (url === undefined) return Promise.resolve(false);
  let promise = pending.get(name);
  if (promise === undefined) {
    promise = (async (): Promise<boolean> => {
      try {
        const res = await fetchImpl(absolute(url));
        if (!res.ok) return false;
        installWasm(name, instantiateWasm(await res.arrayBuffer()));
        return true;
      } catch {
        return false;
      }
    })();
    pending.set(name, promise);
  }
  return promise;
}
