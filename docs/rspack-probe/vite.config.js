import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    headers: {
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'credentialless',
      'cross-origin-resource-policy': 'cross-origin',
    },
    fs: { strict: false, allow: ['..'] },
  },
  optimizeDeps: { exclude: ['@rspack/binding-wasm32-wasi', '@napi-rs/wasm-runtime'] },
});
