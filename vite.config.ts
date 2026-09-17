import { defineConfig } from 'vitest/config';

export default defineConfig({
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
