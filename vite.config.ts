import { defineConfig } from 'vitest/config';
import { devSubdomains } from './plugins/dev-subdomains';

// GitHub Pages serves the site from a sub-path (`/web-node/`), while the dev
// server serves it from the origin root. `BASE_PATH` lets the deploy script set
// the prefix; everything else (service worker scope, preview URLs, the worker
// bundle) is derived from it automatically.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [devSubdomains()],
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
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
