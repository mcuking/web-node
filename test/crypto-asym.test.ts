import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Asymmetric `crypto` (RSA / EC / Ed25519) — keys, signatures, key generation.
 *
 * Two layers:
 *  - the differential corpus in `tools/crypto-asym-probe.cjs`, run here and on
 *    real Node (oracle -> test/fixtures/crypto-asym.json); the JSON must match.
 *  - focused unit tests, so a regression names the broken behaviour directly.
 *
 * Node-side expectations were read off a real Node v26.9.0 (OpenSSL).
 */
// Pure-JS RSA-2048 key generation is milliseconds in isolation but can stretch
// under a fully loaded test pool, so give the whole file a generous default.
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

describe('crypto asymmetric (differential vs real Node)', () => {
  it('matches the oracle byte-for-byte', async () => {
    const program = fs.readFileSync('tools/crypto-asym-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/crypto-asym.json', 'utf8'));

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
    for (let i = 0; i < 800 && !stdout.includes('__OBS__'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      stdout = out.join('');
    }
    const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
    expect(line, 'probe produced no observation line').toBeTruthy();
    expect(JSON.parse(line!.slice('__OBS__'.length))).toEqual(expected);
  }, 120000);
});

describe('crypto asymmetric unit surface', () => {
  it('generateKeyPairSync / sign / verify round-trip for RSA, EC and Ed25519', () => {
    const crypto = boot();
    const message = new TextEncoder().encode('hello asymmetric world');

    for (const [type, options] of [
      ['rsa', { modulusLength: 2048 }],
      ['ec', { namedCurve: 'P-384' }],
      ['ed25519', {}],
    ] as Array<[string, Record<string, unknown>]>) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync(type, options);
      expect(privateKey.type).toBe('private');
      expect(publicKey.type).toBe('public');
      expect(privateKey.asymmetricKeyType).toBe(type);
      const algorithm = type === 'ed25519' ? null : 'sha256';
      const signature = crypto.sign(algorithm, message, privateKey);
      expect(crypto.verify(algorithm, message, publicKey, signature)).toBe(true);
      expect(crypto.verify(algorithm, new TextEncoder().encode('other'), publicKey, signature)).toBe(false);
    }
  });

  it('supports every NIST curve', () => {
    const crypto = boot();
    const message = new TextEncoder().encode('curves');
    for (const namedCurve of ['P-256', 'P-384', 'P-521']) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve });
      const signature = crypto.sign('sha256', message, privateKey);
      expect(crypto.verify('sha256', message, publicKey, signature), namedCurve).toBe(true);
    }
  });

  it('exports and re-imports PKCS#8 / SPKI PEM', () => {
    const crypto = boot();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
    expect(privPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(pubPem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    const reimported = crypto.createPrivateKey(privPem);
    expect(reimported.asymmetricKeyType).toBe('ec');
    expect(reimported.asymmetricKeyDetails.namedCurve).toBe('prime256v1');
    expect(crypto.createPublicKey(reimported).equals(publicKey)).toBe(true);

    const message = new TextEncoder().encode('round-trip');
    const signature = crypto.sign('sha256', message, reimported);
    expect(crypto.verify('sha256', message, crypto.createPublicKey(pubPem), signature)).toBe(true);
  });

  it('createSign / createVerify stream over the same bytes', () => {
    const crypto = boot();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const signer = crypto.createSign('sha256');
    signer.update('one ');
    signer.update('two');
    const signature = signer.sign(privateKey);
    const verifier = crypto.createVerify('sha256');
    verifier.update('one two');
    expect(verifier.verify(publicKey, signature)).toBe(true);
  });

  it('KeyObject validates like Node and reports asymmetricKeyDetails', () => {
    const crypto = boot();
    expect(() => new crypto.KeyObject()).toThrowError(/The argument 'type' is invalid/);
    expect(() => crypto.KeyObject.from({})).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }),
    );
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(privateKey.type).toBe('private');
    expect(privateKey.asymmetricKeyType).toBe('rsa');
    expect(privateKey.asymmetricKeyDetails.modulusLength).toBe(2048);
    expect(privateKey.asymmetricKeyDetails.publicExponent).toBe(65537n);
  });

  it('signing with a public key throws ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE', () => {
    const crypto = boot();
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    expect(() => crypto.sign('sha256', new TextEncoder().encode('x'), publicKey)).toThrowError(
      /Invalid key object type public, expected private/,
    );
  });

  it('RSA-PSS verifies with an explicit saltLength', () => {
    const crypto = boot();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const message = new TextEncoder().encode('pss');
    const signature = crypto.sign('sha256', message, {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    });
    expect(
      crypto.verify(
        'sha256',
        message,
        { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
        signature,
      ),
    ).toBe(true);
  });

  it('getCurves lists the supported curves', () => {
    const crypto = boot();
    for (const curve of ['prime256v1', 'secp384r1', 'secp521r1']) {
      expect(crypto.getCurves()).toContain(curve);
    }
  });

  it('does not mutate Buffer inputs while verifying (regression)', () => {
    // `Buffer.prototype.slice` returns a view, so a careless `slice()` in the
    // Ed25519 decoder used to clear the sign bit inside the caller's signature.
    const crypto = boot();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const message = new TextEncoder().encode('mutation');
    const signature = crypto.sign(null, message, privateKey) as Uint8Array;
    const before = Array.from(signature);
    expect(crypto.verify(null, message, publicKey, signature)).toBe(true);
    expect(Array.from(signature)).toEqual(before);
  });
});
