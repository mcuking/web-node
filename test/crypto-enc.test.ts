import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Asymmetric encryption (RSA OAEP / PKCS#1 v1.5, `privateEncrypt`/`publicDecrypt`)
 * and ECDH key agreement.
 *
 * Same shape as test/crypto-asym.test.ts: a differential corpus plus focused
 * unit tests. Ciphertexts are randomised, so the corpus compares decryptions,
 * lengths and booleans rather than raw ciphertext.
 */
vi.setConfig({ testTimeout: 60000 });

/** Avoid `Buffer` (this tsconfig has no Node types). */
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

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

describe('crypto asymmetric encryption + ECDH (differential vs real Node)', () => {
  it('matches the oracle byte-for-byte', async () => {
    const program = fs.readFileSync('tools/crypto-enc-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/crypto-enc.json', 'utf8'));

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

describe('crypto asymmetric encryption unit surface', () => {
  it('RSA-OAEP round-trips, including oaepHash/oaepLabel', () => {
    const crypto = boot();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const message = new TextEncoder().encode('secret payload');
    const label = new TextEncoder().encode('ctx');
    const cipher = crypto.publicEncrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: label },
      message,
    );
    expect(cipher.length).toBe(256);
    const plain = crypto.privateDecrypt(
      { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: label },
      cipher,
    );
    expect(Array.from(plain)).toEqual(Array.from(message));
    // A different label must not decrypt.
    expect(() =>
      crypto.privateDecrypt(
        { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: new TextEncoder().encode('nope') },
        cipher,
      ),
    ).toThrow();
  });

  it('RSA PKCS#1 v1.5 round-trips', () => {
    const crypto = boot();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const message = new TextEncoder().encode('pkcs1 payload');
    const cipher = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, message);
    const plain = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, cipher);
    expect(Array.from(plain)).toEqual(Array.from(message));
  });

  it('privateEncrypt / publicDecrypt round-trip', () => {
    const crypto = boot();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const message = new TextEncoder().encode('raw block');
    const raw = crypto.privateEncrypt(privateKey, message);
    expect(Array.from(crypto.publicDecrypt(publicKey, raw))).toEqual(Array.from(message));
  });
});

describe('ECDH unit surface', () => {
  it('agrees on a shared secret in both directions', () => {
    const crypto = boot();
    const alice = crypto.createECDH('prime256v1');
    const bob = crypto.createECDH('prime256v1');
    alice.generateKeys();
    bob.generateKeys();
    const a = alice.computeSecret(bob.getPublicKey(), undefined, 'hex');
    const b = bob.computeSecret(alice.getPublicKey(), undefined, 'hex');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('convertKey maps between compressed and uncompressed', () => {
    const crypto = boot();
    const ecdh = crypto.createECDH('secp384r1');
    ecdh.generateKeys();
    const uncompressed = ecdh.getPublicKey('hex');
    const compressed = crypto.ECDH.convertKey(fromHex(uncompressed), 'secp384r1', 'hex', 'hex', 'compressed');
    expect(compressed).toHaveLength(2 + 2 * 48);
    const back = crypto.ECDH.convertKey(fromHex(compressed), 'secp384r1', 'hex', 'hex', 'uncompressed');
    expect(back).toBe(uncompressed);
  });

  it('rejects unknown curves like Node (OpenSSL names only)', () => {
    const crypto = boot();
    expect(() => crypto.createECDH('nope')).toThrow();
    // `P-256` is accepted by generateKeyPairSync but not by createECDH.
    expect(() => crypto.createECDH('P-256')).toThrow();
  });
});
