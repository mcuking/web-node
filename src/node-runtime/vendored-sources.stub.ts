/**
 * Browser stub for `web-node:vendor-sources`.
 *
 * The real module (`vendored-sources.ts`) eagerly inlines every vendored Node.js
 * source as a string, which is exactly what we don't want on the critical path.
 * In the browser build the specifier resolves here instead, and the worker calls
 * `installVendored()` with the bundle it fetched (M107).
 */
export const EAGER_VENDORED: Record<string, string> = {};
