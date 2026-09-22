import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Milestone 73: crypto stub-class prototype fidelity. `Sign`/`Verify` are
 * `stream.Writable` subclasses in Node; `KeyObject`, `X509Certificate`,
 * `DiffieHellman(Group)`, `ECDH` and `Certificate` carry a rich prototype. We
 * have no backend, so classes stay present and shaped like Node (right base,
 * right members) while every entry point throws loudly. Also covers the
 * legacy `prng`/`pseudoRandomBytes`/`rng` aliases (DEP0115).
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
  return { req: (id: string) => runtime.realm.require(id) as any };
}

describe('crypto stub classes', () => {
  it('Sign/Verify extend stream.Writable and are real', () => {
    const { req } = boot();
    const crypto = req('crypto');
    const { Writable } = req('stream');
    for (const name of ['Sign', 'Verify']) {
      const Ctor = crypto[name];
      expect(Ctor.name).toBe(name);
      expect(Ctor.prototype).toBeInstanceOf(Writable);
      expect(typeof Ctor.prototype.write).toBe('function'); // inherited
      // Node validates the algorithm up front; ours does too.
      expect(() => new Ctor()).toThrowError(/The "algorithm" argument must be of type string/);
    }
    for (const m of ['update', 'sign']) expect(typeof crypto.Sign.prototype[m]).toBe('function');
    for (const m of ['update', 'verify']) expect(typeof crypto.Verify.prototype[m]).toBe('function');
  });

  it('KeyObject/X509Certificate/DH/ECDH carry the Node prototype surface', () => {
    const crypto = boot().req('crypto');
    const members: Record<string, string[]> = {
      KeyObject: ['equals', 'toCryptoKey', 'type'],
      X509Certificate: [
        'checkEmail', 'checkHost', 'checkIP', 'checkIssued', 'checkPrivateKey', 'fingerprint',
        'fingerprint256', 'issuer', 'publicKey', 'raw', 'serialNumber', 'subject', 'toJSON',
        'toLegacyObject', 'toString', 'validFrom', 'validTo', 'verify',
      ],
      DiffieHellman: [
        'computeSecret', 'generateKeys', 'getGenerator', 'getPrime', 'getPrivateKey',
        'getPublicKey', 'setPrivateKey', 'setPublicKey',
      ],
      ECDH: ['computeSecret', 'generateKeys', 'getPrivateKey', 'getPublicKey', 'setPrivateKey', 'setPublicKey'],
    };
    for (const [cls, names] of Object.entries(members)) {
      for (const n of names) {
        const descriptor =
          Object.getOwnPropertyDescriptor(crypto[cls].prototype, n) ??
          Object.getOwnPropertyDescriptor(Object.getPrototypeOf(crypto[cls].prototype), n);
        expect(descriptor, `${cls}.prototype.${n}`).toBeTruthy();
      }
    }
    // KeyObject is real now: its constructor validates `type` like Node.
    expect(() => new crypto.KeyObject()).toThrowError(/The argument 'type' is invalid/);
    for (const cls of ['X509Certificate', 'DiffieHellman', 'ECDH']) {
      expect(() => new crypto[cls]()).toThrowError(/not implemented/i);
    }
    expect(typeof crypto.KeyObject.from).toBe('function');
    expect(typeof crypto.ECDH.convertKey).toBe('function');
  });

  it('Certificate exposes the static + instance trio', () => {
    const crypto = boot().req('crypto');
    for (const m of ['exportChallenge', 'exportPublicKey', 'verifySpkac']) {
      expect(typeof crypto.Certificate[m], `static ${m}`).toBe('function');
      expect(typeof crypto.Certificate.prototype[m], `proto ${m}`).toBe('function');
    }
  });

  it('legacy random aliases are non-enumerable aliases of randomBytes', () => {
    const crypto = boot().req('crypto');
    for (const key of ['prng', 'pseudoRandomBytes', 'rng']) {
      expect(crypto[key]).toBe(crypto.randomBytes);
      expect(Object.getOwnPropertyDescriptor(crypto, key)?.enumerable).toBe(false);
    }
  });
});

describe('crypto hash/cipher are Transform subclasses', () => {
  it('Hash/Hmac/Cipheriv/Decipheriv extend stream.Transform', () => {
    const { req } = boot();
    const crypto = req('crypto');
    const { Transform } = req('stream');
    const { Buffer: NodeBuffer } = req('buffer');
    const hash = crypto.createHash('sha256');
    expect(hash).toBeInstanceOf(crypto.Hash);
    expect(hash).toBeInstanceOf(Transform);
    expect(typeof hash.pipe).toBe('function');
    expect(typeof hash.read).toBe('function');
    expect(crypto.createHmac('sha256', 'k')).toBeInstanceOf(Transform);
    const key = NodeBuffer.alloc(16);
    const iv = NodeBuffer.alloc(16);
    expect(crypto.createCipheriv('aes-128-cbc', key, iv)).toBeInstanceOf(crypto.Cipheriv);
    expect(crypto.createCipheriv('aes-128-cbc', key, iv)).toBeInstanceOf(Transform);
    expect(crypto.createDecipheriv('aes-128-cbc', key, iv)).toBeInstanceOf(Transform);
    // Node arity: Hash(algorithm, options), Hmac(algorithm, key, options)
    expect(crypto.Hash.length).toBe(2);
    expect(crypto.Hmac.length).toBe(3);
  });

  it('a hash streams like a Transform', async () => {
    const { req } = boot();
    const crypto = req('crypto');
    const { Buffer: NodeBuffer } = req('buffer');
    const hash = crypto.createHash('sha256');
    const hex = await new Promise<string>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      hash.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      hash.on('end', () => resolve(NodeBuffer.concat(chunks).toString('hex')));
      hash.on('error', reject);
      hash.end('abc');
    });
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('a cipher streams like a Transform', async () => {
    const { req } = boot();
    const crypto = req('crypto');
    const { Buffer: NodeBuffer } = req('buffer');
    const cipher = crypto.createCipheriv('aes-128-ecb', NodeBuffer.alloc(16), null);
    const out = await new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      cipher.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      cipher.on('end', () => resolve(NodeBuffer.concat(chunks)));
      cipher.on('error', reject);
      cipher.end(NodeBuffer.alloc(16));
    });
    expect(out.length).toBe(32); // 16-byte block + one full PKCS#7 padding block
  });
});
