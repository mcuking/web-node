import { defineConfig } from 'vitest/config';
import { devSubdomains } from './plugins/dev-subdomains';
import { vendoredSourcePlugin } from './plugins/vendored-source';

// GitHub Pages serves the site from a sub-path (`/web-node/`), while the dev
// server serves it from the origin root. `BASE_PATH` lets the deploy script set
// the prefix; everything else (service worker scope, preview URLs, the worker
// bundle) is derived from it automatically.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [vendoredSourcePlugin(), devSubdomains()],
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
});
