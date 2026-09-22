import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Milestone 66: the `crypto` module surface.
 *
 * This file pins the exports that round out `require('crypto')` to match Node's
 * key list — the real class exports (`Hash`/`Hmac`/`Cipheriv`/`Decipheriv`),
 * `subtle`, `randomUUIDv7`, `secureHeapUsed`, `setEngine`, and the constructors
 * / functions whose backend we do not have (which must exist and throw a typed
 * error rather than being absent).
 *
 * Node-side expectations were read off a real Node v26.9.0.
 */
function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require('crypto') as any;
}

describe('crypto class exports', () => {
  it('createHash / createHmac return their exported classes', () => {
    const crypto = boot();
    const h = crypto.createHash('sha256');
    expect(h).toBeInstanceOf(crypto.Hash);
    expect(h.constructor.name).toBe('Hash');
    h.update('abc');
    expect(h.copy().digest('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );

    const m = crypto.createHmac('sha256', 'key');
    expect(m).toBeInstanceOf(crypto.Hmac);
    // `new Hash(...)` behaves like `createHash(...)` (Node deprecates but keeps it)
    expect(new crypto.Hash('sha256').update('abc').digest('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('createCipheriv / createDecipheriv return Cipheriv / Decipheriv', () => {
    const crypto = boot();
    const key = new Uint8Array(16);
    const iv = new Uint8Array(16);
    const c = crypto.createCipheriv('aes-128-cbc', key, iv);
    expect(c).toBeInstanceOf(crypto.Cipheriv);
    expect(crypto.createDecipheriv('aes-128-cbc', key, iv)).toBeInstanceOf(crypto.Decipheriv);
    // round-trip through the class-produced object
    const enc = c.update('hello world', 'utf8', 'hex') + c.final('hex');
    const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
    expect(d.update(enc, 'hex', 'utf8') + d.final('utf8')).toBe('hello world');
  });

  it('Hash / Hmac constructors validate like Node', () => {
    const crypto = boot();
    expect(() => new crypto.Hash(undefined as any)).toThrowError(
      /The "algorithm" argument must be of type string\. Received undefined/,
    );
    expect(() => new crypto.Hmac(undefined as any)).toThrowError(
      /The "hmac" argument must be of type string\. Received undefined/,
    );
  });
});

describe('crypto new real surface', () => {
  it('subtle is the WebCrypto SubtleCrypto', async () => {
    const crypto = boot();
    expect(crypto.subtle).toBe(crypto.webcrypto.subtle);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
    expect(new Uint8Array(digest).length).toBe(32);
  });

  it('randomUUIDv7 emits an RFC 9562 v7 UUID', () => {
    const crypto = boot();
    const id = crypto.randomUUIDv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // the timestamp prefix should decode to roughly now
    const ts = parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
    expect(Math.abs(ts - Date.now())).toBeLessThan(5000);
    expect(() => crypto.randomUUIDv7(42 as any)).toThrowError(
      /The "options" argument must be of type object\. Received type number \(42\)/,
    );
  });

  it('secureHeapUsed reports the disabled heap', () => {
    const crypto = boot();
    expect(crypto.secureHeapUsed()).toEqual({ total: 0, used: 0, utilization: null, min: 2 });
  });

  it('setEngine reports every engine unknown', () => {
    const crypto = boot();
    expect(crypto.setEngine.length).toBe(2);
    expect(() => crypto.setEngine('x')).toThrowError(
      expect.objectContaining({ code: 'ERR_CRYPTO_ENGINE_UNKNOWN' }),
    );
    expect(() => crypto.setEngine('x')).toThrowError('Engine "x" was not found');
  });
});

describe('crypto unsupported-but-present surface throws loudly', () => {
  it('native-only classes are constructible names that throw', () => {
    const crypto = boot();
    for (const name of ['DiffieHellman', 'DiffieHellmanGroup']) {
      expect(typeof crypto[name]).toBe('function');
      expect(crypto[name].name).toBe(name);
      expect(() => new crypto[name]()).toThrowError(/not implemented/i);
    }
  });

  it('unsupported functions exist and throw', () => {
    const crypto = boot();
    for (const name of ['argon2', 'argon2Sync', 'createMac', 'getMacs', 'encapsulate', 'decapsulate']) {
      expect(typeof crypto[name]).toBe('function');
      expect(() => crypto[name]()).toThrowError(/not implemented/i);
    }
  });
});
