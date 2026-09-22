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
  it('Sign/Verify extend stream.Writable with Node prototype members', () => {
    const { req } = boot();
    const crypto = req('crypto');
    const { Writable } = req('stream');
    for (const name of ['Sign', 'Verify']) {
      const Ctor = crypto[name];
      expect(Ctor.name).toBe(name);
      expect(Ctor.prototype).toBeInstanceOf(Writable);
      expect(typeof Ctor.prototype.write).toBe('function'); // inherited
      expect(() => new Ctor()).toThrowError(/not implemented/i);
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
