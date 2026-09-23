import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { devSubdomains } from './plugins/dev-subdomains';
import {
  VENDORED_ASSET_FILE,
  vendoredBundlePlugin,
  vendoredBundleText,
  vendoredSourcePlugin,
} from './plugins/vendored-source';

// GitHub Pages serves the site from a sub-path (`/web-node/`), while the dev
// server serves it from the origin root. `BASE_PATH` lets the deploy script set
// the prefix; everything else (service worker scope, preview URLs, the worker
// bundle) is derived from it automatically.
const base = process.env.BASE_PATH || '/';

// The vendored Node sources ship as one preloadable asset (M107) rather than
// being inlined in the worker bundle. The URL carries a content hash so a deploy
// busts caches even though the file name is fixed.
const vendoredJson = vendoredBundleText();
const vendoredUrl = `${base}${VENDORED_ASSET_FILE}?v=${createHash('sha256').update(vendoredJson).digest('hex').slice(0, 12)}`;

export default defineConfig(({ mode }) => {
  // Tests run in Node and need the sources synchronously, so they get the eager
  // glob; every other mode gets the browser stub and fetches the bundle instead.
  const isTest = mode === 'test';
  const vendorSources = resolve(
    __dirname,
    isTest ? 'src/node-runtime/vendored-sources.ts' : 'src/node-runtime/vendored-sources.stub.ts',
  );

  return {
    base,
    define: { __VENDORED_URL__: JSON.stringify(vendoredUrl) },
    resolve: { alias: { 'web-node:vendor-sources': vendorSources } },
    plugins: [vendoredSourcePlugin(), vendoredBundlePlugin(vendoredJson, vendoredUrl), devSubdomains()],
    server: {
      // COOP/COEP so SharedArrayBuffer is available (needed later for wasm/Atomics).
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    build: {
      target: 'es2022',
    },
    worker: {
      format: 'es',
      // The vendored sources are only imported from the worker entry, and Vite
      // builds the worker with its own plugin pipeline — so the stripper has to be
      // registered here as well as above.
      plugins: () => [vendoredSourcePlugin()],
    },
    test: {
      environment: 'node',
      include: ['test/**/*.test.ts'],
    },
  };
});
