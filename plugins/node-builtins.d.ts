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
    digest(): Uint8Array;
  }
  export type Hmac = Hash;
  export function createHash(algorithm: string, options?: { outputLength?: number }): Hash;
  export function createHmac(algorithm: string, key: Uint8Array | string): Hmac;
  export function getHashes(): string[];
  export interface Cipher {
    setAutoPadding(autoPadding?: boolean): this;
    setAAD(aad: Uint8Array, options?: { plaintextLength?: number }): this;
    setAuthTag(tag: Uint8Array): this;
    getAuthTag(): Uint8Array;
    update(data: Uint8Array): Uint8Array;
    final(): Uint8Array;
  }
  export function createCipheriv(
    algorithm: string,
    key: Uint8Array,
    iv: Uint8Array | null,
    options?: { authTagLength?: number },
  ): Cipher;
  export function createDecipheriv(
    algorithm: string,
    key: Uint8Array,
    iv: Uint8Array | null,
    options?: { authTagLength?: number },
  ): Cipher;
  export function pbkdf2Sync(
    password: Uint8Array,
    salt: Uint8Array,
    iterations: number,
    keylen: number,
    digest: string,
  ): Uint8Array;
  export function hkdfSync(
    digest: string,
    ikm: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    keylen: number,
  ): ArrayBuffer;
  export function scryptSync(
    password: Uint8Array,
    salt: Uint8Array,
    keylen: number,
    options: { N: number; r: number; p: number; maxmem: number },
  ): Uint8Array;
  export function argon2Sync(
    algorithm: string,
    parameters: {
      message: Uint8Array;
      nonce: Uint8Array;
      parallelism: number;
      tagLength: number;
      memory: number;
      passes: number;
      secret?: Uint8Array;
      associatedData?: Uint8Array;
    },
  ): Uint8Array;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
