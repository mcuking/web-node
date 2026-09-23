/// <reference types="vite/client" />

declare module '*?raw' {
  const src: string;
  export default src;
}

/** Absolute (base-prefixed) URL of the emitted vendored-sources bundle (M107). */
declare const __VENDORED_URL__: string;

/**
 * Eager or stubbed vendored sources. Tests use the real eager glob; the browser
 * build aliases this to `vendored-sources.stub.ts` (see `vite.config.ts`).
 */
declare module 'web-node:vendor-sources' {
  export const EAGER_VENDORED: Record<string, string>;
}
