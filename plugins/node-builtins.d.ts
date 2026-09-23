/**
 * `tsconfig.json` sets `types: []` on purpose: the *runtime* targets the browser,
 * so there is no `@types/node` in this project. Build-time plugins are the only
 * Node-side code here, and they need a couple of Node globals — declared here so
 * the plugin stays type-checked without dragging in the whole Node type surface
 * (which would let `src/` accidentally reference `process`/`Buffer`/etc.).
 */

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): Uint8Array;
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
  }
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
  /** OS path separator (`\\` on Windows, `/` elsewhere). */
  export const sep: string;
}

declare module 'node:crypto' {
  export interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: string): Hash;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
