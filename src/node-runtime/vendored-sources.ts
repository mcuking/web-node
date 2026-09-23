/**
 * The eager `?raw` glob for the vendored Node.js sources.
 *
 * This module is used as-is by the test runner (Node), where the sources must be
 * available synchronously the moment the runtime is constructed. In the browser
 * build the `web-node:vendor-sources` specifier is aliased to a stub
 * (`vendored-sources.stub.ts`) so the ~2.3 MB of source text never enters the
 * worker's JS graph — the worker fetches the emitted bundle instead (M107).
 */
const sources = import.meta.glob('../../vendor/node-lib/**/*.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const EAGER_VENDORED: Record<string, string> = {};
for (const [abs, src] of Object.entries(sources)) {
  EAGER_VENDORED[abs.replace(/^.*vendor\/node-lib\//, '')] = src;
}
