import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { devSubdomains } from './plugins/dev-subdomains';
import {
  VENDORED_CORE_FILE,
  VENDORED_REST_FILE,
  splitVendoredSources,
  vendoredBundlePlugin,
  vendoredSourcePlugin,
} from './plugins/vendored-source';

// GitHub Pages serves the site from a sub-path (`/web-node/`), while the dev
// server serves it from the origin root. `BASE_PATH` lets the deploy script set
// the prefix; everything else (service worker scope, preview URLs, the worker
// bundle) is derived from it automatically.
const base = process.env.BASE_PATH || '/';

// The vendored Node sources ship as two preloadable assets (M107 / M126) rather
// than being inlined in the worker bundle. The URLs carry a content hash so a
// deploy busts caches even though the file names are fixed. Only the **core**
// tier (what the realm reads while booting) is preloaded; the lazy tier is pulled
// by the worker in the background so it never competes for the critical path.
const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12);
const { core: vendoredCore, rest: vendoredRest } = splitVendoredSources();
const vendoredCoreJson = JSON.stringify(vendoredCore);
const vendoredRestJson = JSON.stringify(vendoredRest);
const vendoredCoreUrl = `${base}${VENDORED_CORE_FILE}?v=${hash(vendoredCoreJson)}`;
const vendoredRestUrl = `${base}${VENDORED_REST_FILE}?v=${hash(vendoredRestJson)}`;
// The full file list (names only, no source) so the worker can report it without
// having to wait for the lazy tier to land.
const vendoredManifest = Object.keys({ ...vendoredCore, ...vendoredRest }).sort();

// The emnapi **thread-child** bootstrap (M125). A real browser `Worker` can only
// load a script by URL, so it is served as a plain same-origin asset (build it
// with `npm run build:wasi-thread-child`). It lives under `base`, so the runtime
// worker resolves it against `location` rather than assuming the origin root.
const wasiThreadChildUrl = `${base}wasi-thread-child.js`;

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
    define: {
      __VENDORED_CORE_URL__: JSON.stringify(vendoredCoreUrl),
      __VENDORED_REST_URL__: JSON.stringify(vendoredRestUrl),
      __VENDORED_MANIFEST__: JSON.stringify(vendoredManifest),
      __WASI_THREAD_CHILD_URL__: JSON.stringify(wasiThreadChildUrl),
    },
    resolve: { alias: { 'web-node:vendor-sources': vendorSources } },
    plugins: [
      vendoredSourcePlugin(),
      vendoredBundlePlugin(vendoredCoreJson, vendoredRestJson, vendoredCoreUrl, vendoredRestUrl),
      devSubdomains(),
    ],
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
      // The native→WASM modules are fetched as hashed assets in the browser;
      // tests read the committed artifacts off disk instead (see the file).
      setupFiles: ['test/setup-wasm.ts'],
    },
  };
});
