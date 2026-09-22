import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Diffie-Hellman (`createDiffieHellman` / `getDiffieHellman` / `DiffieHellman` /
 * `DiffieHellmanGroup`).
 *
 * Same shape as the other crypto milestones: a differential corpus plus focused
 * unit tests. `generateKeys()` is randomised, so the corpus observes it through
 * lengths only and builds its shared-secret vectors from fixed private keys.
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

describe('Diffie-Hellman (differential vs real Node)', () => {
  it('matches the oracle byte-for-byte', async () => {
    const program = fs.readFileSync('tools/crypto-dh-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/crypto-dh.json', 'utf8'));

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
    for (let i = 0; i < 600 && !stdout.includes('__OBS__'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      stdout = out.join('');
    }
    const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
    expect(line, 'probe produced no observation line').toBeTruthy();
    expect(JSON.parse(line!.slice('__OBS__'.length))).toEqual(expected);
  }, 300000);
});

describe('Diffie-Hellman unit surface', () => {
  it('agrees on a shared secret and pads it to the prime length', () => {
    const crypto = boot();
    const alice = crypto.getDiffieHellman('modp14');
    const bob = crypto.getDiffieHellman('modp14');
    alice.generateKeys();
    bob.generateKeys();
    const a = alice.computeSecret(bob.getPublicKey(), undefined, 'hex');
    const b = bob.computeSecret(alice.getPublicKey(), undefined, 'hex');
    expect(a).toBe(b);
    expect(a).toHaveLength(512); // 256-byte prime
  });

  it('exposes the standard MODP groups', () => {
    const crypto = boot();
    for (const [name, bits] of [['modp15', 3072], ['modp18', 8192]] as const) {
      const group = crypto.getDiffieHellman(name);
      expect(group.getPrime().length).toBe(bits / 8);
      expect(group.getGenerator('hex')).toBe('02');
      expect(group.verifyError).toBe(0);
    }
    expect(() => crypto.getDiffieHellman('modp3')).toThrowError(/Unknown DH group/);
  });

  it('accepts an explicit prime in either encoding', () => {
    const crypto = boot();
    const prime = crypto.getDiffieHellman('modp5').getPrime();
    const fromBuffer = crypto.createDiffieHellman(prime, 2);
    const fromHex = crypto.createDiffieHellman(prime.toString('hex'), 'hex', 2);
    expect(fromBuffer.getPrime('hex')).toBe(fromHex.getPrime('hex'));
    expect(typeof fromBuffer.generateKeys('hex')).toBe('string');
  });

  it('setPrivateKey stores only the private key (public stays unset)', () => {
    const crypto = boot();
    const dh = crypto.createDiffieHellman(crypto.getDiffieHellman('modp14').getPrime(), 2);
    dh.setPrivateKey(new Uint8Array(32).fill(3));
    expect(dh.getPrivateKey().length).toBeGreaterThan(0);
    expect(() => dh.getPublicKey()).toThrowError(/No public key/);
  });

  it('validates the peer key like Node', () => {
    const crypto = boot();
    const dh = crypto.getDiffieHellman('modp14');
    dh.generateKeys();
    expect(() => dh.computeSecret(new Uint8Array(256))).toThrowError(/Supplied key is too small/);
    expect(() => dh.computeSecret(new Uint8Array(256).fill(0xff))).toThrowError(/Supplied key is too large/);
  });

  it('rejects a too-small generated prime', () => {
    const crypto = boot();
    expect(() => crypto.createDiffieHellman(256, 2)).toThrowError(/Invalid DH parameters/);
    expect(() => crypto.createDiffieHellman(511, 2)).toThrowError(/Invalid DH parameters/);
    expect(crypto.createDiffieHellman(512, 2).getPrime().length).toBe(64);
  });
});
