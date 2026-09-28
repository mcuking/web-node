/// <reference types="vite/client" />

declare module '*?raw' {
  const src: string;
  export default src;
}

/** wasm 资产：`?url` 导入拿到构建产出的 URL（M115）。 */
declare module '*.wasm?url' {
  const url: string;
  export default url;
}

/** Absolute (base-prefixed) URL of the emitted vendored-sources bundle (M107). */
declare const __VENDORED_URL__: string;

/**
 * Base-prefixed URL of the emnapi thread-child bootstrap asset (M125). Real
 * browser `Worker`s load it from inside the runtime worker; see
 * `tools/build-wasi-thread-child.mjs`.
 */
declare const __WASI_THREAD_CHILD_URL__: string;

/**
 * Eager or stubbed vendored sources. Tests use the real eager glob; the browser
 * build aliases this to `vendored-sources.stub.ts` (see `vite.config.ts`).
 */
declare module 'web-node:vendor-sources' {
  export const EAGER_VENDORED: Record<string, string>;
}
