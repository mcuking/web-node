/**
 * Vendored Node.js source, compiled with real CommonJS semantics at runtime
 * (instead of letting the bundler transform it).
 *
 * The text comes from one of two places:
 *
 *  - **Tests / Node**: `web-node:vendor-sources` is the eager `?raw` glob, so
 *    the map is populated the moment this module is evaluated (synchronously —
 *    `require` must be able to reach any file immediately).
 *  - **Browser**: that specifier is aliased to an empty stub, and the worker
 *    calls {@link installVendored} with the bundle it fetched from the emitted
 *    asset before it builds the realm (see `worker/runtime.worker.ts`). Keeping
 *    the 2.3 MB of text out of the worker's JS graph is the point: it downloads
 *    in parallel and costs no JS parse (M107).
 */
import { EAGER_VENDORED } from 'web-node:vendor-sources';

/** `vendor/node-lib`-relative path → source text. */
export const VENDORED: Record<string, string> = { ...EAGER_VENDORED };

/**
 * Install sources fetched from the emitted bundle. Accepts either the raw JSON
 * text or a pre-parsed object; keys are merged in.
 */
export function installVendored(payload: string | Record<string, string>): void {
  const map = typeof payload === 'string' ? (JSON.parse(payload) as Record<string, string>) : payload;
  for (const key of Object.keys(map)) VENDORED[key] = map[key];
}

/** True once at least one source is present (test builds start populated). */
export function vendoredLoaded(): boolean {
  return Object.keys(VENDORED).length > 0;
}

export function vendoredSource(rel: string): string | undefined {
  return VENDORED[rel];
}

export const VENDORED_FILES = Object.keys(EAGER_VENDORED).sort();
