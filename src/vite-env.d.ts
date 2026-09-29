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

/**
 * Absolute (base-prefixed) URL of the emitted vendored-source **core** tier (M126).
 * Only what the realm reads while booting; preloaded from `index.html`.
 */
declare const __VENDORED_CORE_URL__: string;

/**
 * Absolute (base-prefixed) URL of the emitted vendored-source **lazy** tier
 * (M126). Fetched by the worker in the background and awaited only before user
 * code runs.
 */
declare const __VENDORED_REST_URL__: string;

/** Names of every vendored source file, core + lazy (M126). Names only, no source. */
declare const __VENDORED_MANIFEST__: string[];

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
