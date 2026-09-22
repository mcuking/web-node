import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Symmetric key generation (`crypto.generateKey` / `generateKeySync`) and the
 * FIPS flag.
 *
 * Keys are random, so the differential corpus observes shape (type / size /
 * length / JWK) plus the full error surface; the unit tests below check the
 * round-trips and the documented defaults.
 */
vi.setConfig({ testTimeout: 60000 });

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

describe('crypto.generateKey / generateKeySync (differential vs real Node)', () => {
  it('matches the oracle byte-for-byte', async () => {
    const program = fs.readFileSync('tools/crypto-keygen-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/crypto-keygen.json', 'utf8'));

    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
    const out: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: (c) => out.push(c),
      onStderr: () => {},
    });
    runtime.runMain('/project/index.js');

    let stdout = out.join('');
    for (let i = 0; i < 400 && !stdout.includes('__OBS__'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      stdout = out.join('');
    }
    const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
    expect(line, 'probe produced no observation line').toBeTruthy();
    expect(JSON.parse(line!.slice('__OBS__'.length))).toEqual(expected);
  }, 120000);
});

describe('crypto.generateKeySync unit surface', () => {
  it('produces secret KeyObjects of the requested size', () => {
    const crypto = boot();
    for (const [type, length, bytes] of [
      ['hmac', 256, 32],
      ['hmac', 100, 12], // length >> 3
      ['aes', 128, 16],
      ['aes', 192, 24],
      ['aes', 256, 32],
    ] as const) {
      const key = crypto.generateKeySync(type, { length });
      expect(key.type).toBe('secret');
      expect(key.symmetricKeySize).toBe(bytes);
      expect(key.export()).toHaveLength(bytes);
    }
  });

  it('exports as an oct JWK', () => {
    const crypto = boot();
    const key = crypto.generateKeySync('aes', { length: 256 });
    const jwk = key.export({ format: 'jwk' });
    expect(jwk.kty).toBe('oct');
    expect(typeof jwk.k).toBe('string');
    expect(jwk.k).not.toContain('=');
  });

  it('generates an async key through the callback', async () => {
    const crypto = boot();
    const key = await new Promise((resolve, reject) => {
      crypto.generateKey('hmac', { length: 256 }, (error: Error | null, result: unknown) =>
        error ? reject(error) : resolve(result),
      );
    });
    expect((key as { type: string }).type).toBe('secret');
    expect((key as { symmetricKeySize: number }).symmetricKeySize).toBe(32);
  });

  it('requires a callback for the async form', () => {
    const crypto = boot();
    expect(() => crypto.generateKey('hmac', { length: 256 })).toThrowError(/callback/);
  });
});

describe('crypto FIPS flags', () => {
  it('reports FIPS off and ignores setFips', () => {
    const crypto = boot();
    expect(crypto.getFips()).toBe(0);
    expect(crypto.setFips(true)).toBeUndefined();
    expect(crypto.getFips()).toBe(0);
  });
});
