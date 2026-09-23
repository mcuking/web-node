import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `crypto` grew a real synchronous surface: SHA-2 (224/256/384/512), HMAC over
 * every supported digest, PBKDF2, HKDF, scrypt, `timingSafeEqual`, `hash()` and
 * the `randomInt` / `randomFill` family.
 *
 * WebCrypto cannot supply any of the digest/MAC/KDF pieces (it is promise-only)
 * so they are implemented in plain JS in `src/node-runtime/crypto/hash.ts`.
 * Every expected value below was read off **Node v26.9.0** (OpenSSL-backed), so
 * this file is a straight differential test against real Node rather than a set
 * of hand-copied vectors. Probe: `/tmp/crypto-oracle.mjs`.
 */
function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require.bind(runtime.realm) as (id: string) => any;
}

const hex = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
};

const LONG = 'a'.repeat(1000);

const DIGEST_VECTORS: Record<string, Record<string, string>> = {
  md5: {
    '': 'd41d8cd98f00b204e9800998ecf8427e',
    abc: '900150983cd24fb0d6963f7d28e17f72',
    'The quick brown fox jumps over the lazy dog': '9e107d9d372bb6826bd81d3542a419d6',
    [LONG]: 'cabe45dcc9ae5b66ba86600cca6b8ba8',
  },
  sha1: {
    '': 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
    abc: 'a9993e364706816aba3e25717850c26c9cd0d89d',
    'The quick brown fox jumps over the lazy dog': '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12',
    [LONG]: '291e9a6c66994949b57ba5e650361e98fc36b1ba',
  },
  sha224: {
    '': 'd14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f',
    abc: '23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7',
    'The quick brown fox jumps over the lazy dog': '730e109bd7a8a32b1cb9d9a09aa2325d2430587ddbc0c38bad911525',
    [LONG]: '4e8f0ce90b64661a2b5e84be6d93a7d9b76871062f1814433d04a03d',
  },
  sha256: {
    '': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    abc: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'The quick brown fox jumps over the lazy dog': 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    [LONG]: '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
  },
  sha384: {
    '': '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b',
    abc: 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
    'The quick brown fox jumps over the lazy dog':
      'ca737f1014a48f4c0b6dd43cb177b0afd9e5169367544c494011e3317dbf9a509cb1e5dc1e85a941bbee3d7f2afbc9b1',
    [LONG]: 'f54480689c6b0b11d0303285d9a81b21a93bca6ba5a1b4472765dca4da45ee328082d469c650cd3b61b16d3266ab8ced',
  },
  sha512: {
    '': 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    abc: 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    'The quick brown fox jumps over the lazy dog':
      '07e547d9586f6a73f73fbac0435ed76951218fb7d0c8d788a309d785436bbb642e93a252a954f23912547d1e8a3b5ed6e1bfd7097821233fa0538f3db854fee6',
    [LONG]: '67ba5535a46e3f86dbfbed8cbbaf0125c76ed549ff8b0b9e03e0c88cf90fa634fa7b12b47d77b694de488ace8d9a65967dc96df599727d3292a8d9d447709c97',
  },
};

const HMAC_VECTORS: Record<string, string> = {
  md5: '36b89aaa72560638852703acba484b2b',
  sha1: 'b84b002077152646a6da921cf58121705150a967',
  sha224: '123d38df69a42a956cecf50149496b2396e166eae520eb89a9337b93',
  sha256: '095d5a21fe6d0646db223fdf3de6436bb8dfb2fab0b51677ecf6441fcf5f2a67',
  sha384: '061b1060a11fc44acf968a1f668968f0835d08dfe2efaf57ba3c2664c50f11c1571e20f2c1d9b156df9e11d324425be5',
  sha512: '5b6a26f290fb28d52d9f87304f4c46df2263ec9d01987444956f960303b9a6b23ed425a47b637a99609ff9da1fae100fcab3cc279b98fad0ad7409e69e74253b',
};

describe('crypto: createHash', () => {
  it('matches Node for md5/sha1/sha224/sha256/sha384/sha512', () => {
    const crypto = boot()('crypto');
    for (const [algorithm, vectors] of Object.entries(DIGEST_VECTORS)) {
      for (const [input, expected] of Object.entries(vectors)) {
        expect(crypto.createHash(algorithm).update(input).digest('hex'), `${algorithm}(${input.length})`).toBe(expected);
      }
    }
  });

  it('returns a Buffer from digest() and keeps the digest size right', () => {
    const req = boot();
    const crypto = req('crypto');
    const { Buffer: NodeBuffer } = req('buffer');
    const sizes: Record<string, number> = { md5: 16, sha1: 20, sha224: 28, sha256: 32, sha384: 48, sha512: 64 };
    for (const [algorithm, size] of Object.entries(sizes)) {
      const digest = crypto.createHash(algorithm).update('x').digest();
      expect(digest.length, algorithm).toBe(size);
      expect(NodeBuffer.isBuffer(digest), algorithm).toBe(true);
    }
  });

  it('accepts the OpenSSL spellings of the algorithm name', () => {
    const crypto = boot()('crypto');
    const expected = DIGEST_VECTORS.sha256.abc;
    for (const name of ['sha256', 'SHA256', 'sha-256', 'RSA-SHA256', 'sha256WithRSAEncryption']) {
      expect(crypto.createHash(name).update('abc').digest('hex'), name).toBe(expected);
    }
  });

  it('produces the same digest when update() is chunked', () => {
    const crypto = boot()('crypto');
    const oneShot = crypto.createHash('sha512').update('hello world').digest('hex');
    const chunked = crypto.createHash('sha512').update('hello ').update('wo').update('rld').digest('hex');
    expect(chunked).toBe(oneShot);
    expect(oneShot).toBe('309ecc489c12d6eb4cc40f50c902f2b4d0ed77ee511a7c7a9bcd3ca86d4cd86f989dd35bc5ff499670da34255b45b0cfd830e81f605dcf7dc5542e93ae9cd76f');
  });

  it('finalizes exactly once and copy() snapshots independently', () => {
    const crypto = boot()('crypto');
    const digest = crypto.createHash('sha256');
    digest.update('a');
    expect(digest.digest('hex')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
    expect(() => digest.digest()).toThrowError(/Digest already called/);
    expect(() => digest.update('b')).toThrowError(/Digest already called/);

    const base = crypto.createHash('sha256').update('foo');
    const clone = base.copy();
    expect(base.update('bar').digest('hex')).toBe('c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2');
    expect(clone.update('bar').digest('hex')).toBe('c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2');
  });

  it('rejects an unknown algorithm the way Node does', () => {
    const crypto = boot()('crypto');
    expect(() => crypto.createHash('nope')).toThrowError(/Digest method not supported/);
  });
});

describe('crypto: createHmac', () => {
  it('matches Node for every supported digest', () => {
    const crypto = boot()('crypto');
    for (const [algorithm, expected] of Object.entries(HMAC_VECTORS)) {
      expect(crypto.createHmac(algorithm, 'secret-key').update('hello world').digest('hex'), algorithm).toBe(expected);
    }
  });

  it('treats the key and the data as bytes', () => {
    const req = boot();
    const crypto = req('crypto');
    const { Buffer: NodeBuffer } = req('buffer');
    const mac = crypto.createHmac('sha256', NodeBuffer.from('00ff', 'hex')).update(NodeBuffer.from('deadbeef', 'hex')).digest('base64');
    expect(mac).toBe('QyCorEQkDcwobKlI70C2ygXdw35e2Anb0X1EBXnHutw=');
    expect(crypto.createHmac('sha256', 'k').update('m').digest('hex')).toBe('b60090e3052297aeb5a080889ce2fc4bca957e756faeb4df7d31800ca1e771ec');
  });

  it('rejects an unknown digest with ERR_CRYPTO_INVALID_DIGEST', () => {
    const crypto = boot()('crypto');
    try {
      crypto.createHmac('nope', 'k');
      throw new Error('expected createHmac to throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('ERR_CRYPTO_INVALID_DIGEST');
    }
  });
});

describe('crypto: hash / getHashes', () => {
  it('hash() is the one-shot createHash', () => {
    const crypto = boot()('crypto');
    expect(crypto.hash('sha256', 'abc', 'hex')).toBe(DIGEST_VECTORS.sha256.abc);
    expect(crypto.hash.length).toBe(3);
    expect(hex(crypto.hash('sha256', 'abc'))).toBe(DIGEST_VECTORS.sha256.abc);
    expect(() => crypto.hash('nope', 'abc')).toThrowError(/Digest method nope is not supported/);
  });

  it('getHashes() lists exactly the digests we can compute', () => {
    const crypto = boot()('crypto');
    const hashes = crypto.getHashes();
    for (const name of ['md5', 'sha1', 'sha256', 'sha512', 'RSA-SHA256', 'sha-256']) {
      expect(hashes, name).toContain(name);
    }
    expect(hashes).toEqual([...hashes].sort());
  });
});

describe('crypto: key derivation', () => {
  it('pbkdf2Sync matches Node', () => {
    const crypto = boot()('crypto');
    expect(hex(crypto.pbkdf2Sync('password', 'salt', 1000, 32, 'sha1'))).toBe('6e88be8bad7eae9d9e10aa061224034fed48d03fcbad968b56006784539d5214');
    expect(hex(crypto.pbkdf2Sync('password', 'salt', 1000, 32, 'sha256'))).toBe('632c2812e46d4604102ba7618e9d6d7d2f8128f6266b4a03264d2a0460b7dcb3');
    expect(hex(crypto.pbkdf2Sync('password', 'salt', 1000, 32, 'sha512'))).toBe('afe6c5530785b6cc6b1c6453384731bd5ee432ee549fd42fb6695779ad8a1c5b');
    expect(hex(crypto.pbkdf2Sync('p', 's', 2, 20, 'sha256'))).toBe('1998f3d3f22119b7f9a77c8ae8b1df0d6e5dde8a');
  });

  it('pbkdf2Sync validates iterations and digest', () => {
    const crypto = boot()('crypto');
    try {
      crypto.pbkdf2Sync('p', 's', 0, 8, 'sha256');
      throw new Error('expected to throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('ERR_OUT_OF_RANGE');
    }
    try {
      crypto.pbkdf2Sync('p', 's', 1, 8, 'nope');
      throw new Error('expected to throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('ERR_CRYPTO_INVALID_DIGEST');
    }
  });

  it('pbkdf2() async form resolves the same bytes', async () => {
    const crypto = boot()('crypto');
    const derived = await new Promise<Uint8Array>((resolve, reject) => {
      crypto.pbkdf2('p', 's', 2, 20, 'sha256', (err: Error | null, key?: Uint8Array) => (err ? reject(err) : resolve(key!)));
    });
    expect(hex(derived)).toBe('1998f3d3f22119b7f9a77c8ae8b1df0d6e5dde8a');
  });

  it('hkdfSync matches Node (and returns an ArrayBuffer)', () => {
    const crypto = boot()('crypto');
    const derived = crypto.hkdfSync('sha256', 'key', 'salt', 'info', 42);
    expect(derived).toBeInstanceOf(ArrayBuffer);
    expect(hex(new Uint8Array(derived))).toBe('9ca0d662557439e3b83365f2da4626d35da195c6d9d1779f09838cf9e408966ece99106e2585ace6f083');
    expect(hex(new Uint8Array(crypto.hkdfSync('sha1', 'k', 's', 'i', 16)))).toBe('e9e6d613402479440ad9a297a20e3838');
    expect(hex(new Uint8Array(crypto.hkdfSync('sha512', 'key', 'salt', 'info', 24)))).toBe('24156e2c35525baaf3d0fbb92b734c8032a110a3f12e2596');
  });

  it('scryptSync matches Node across parameter sets', () => {
    const crypto = boot()('crypto');
    expect(hex(crypto.scryptSync('password', 'salt', 32))).toBe('745731af4484f323968969eda289aeee005b5903ac561e64a5aca121797bf773');
    expect(hex(crypto.scryptSync('password', 'salt', 64, { N: 1024, r: 8, p: 1 }))).toBe(
      '16dbc8906763c7f048977a68f9d305f7710e068ca2cd95dab372125bb3f19608175003c79f9cdee65d2e45fc1f169afde0a6806f5d4f2ba0584249d2e66c2c96',
    );
    expect(hex(crypto.scryptSync('p', 's', 16, { N: 16, r: 1, p: 1 }))).toBe('13a6893eaa50d0932074637fa05e1613');
  });

  it('scryptSync rejects illegal params', () => {
    const crypto = boot()('crypto');
    try {
      crypto.scryptSync('p', 's', 8, { N: 3 });
      throw new Error('expected to throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('ERR_CRYPTO_INVALID_SCRYPT_PARAMS');
    }
    try {
      crypto.scryptSync('p', 's', 8, { N: 16384, r: 8, p: 1, maxmem: 1024 });
      throw new Error('expected to throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('ERR_CRYPTO_INVALID_SCRYPT_PARAMS');
    }
  });
});

describe('crypto: timingSafeEqual', () => {
  it('compares in constant time and enforces equal lengths', () => {
    const crypto = boot()('crypto');
    expect(crypto.timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(crypto.timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    try {
      crypto.timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]));
      throw new Error('expected to throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH');
    }
  });
});

describe('crypto: randomness', () => {
  it('randomInt stays in range and validates bounds', () => {
    const crypto = boot()('crypto');
    for (let i = 0; i < 50; i++) {
      const value = crypto.randomInt(10);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(10);
    }
    for (let i = 0; i < 50; i++) {
      const value = crypto.randomInt(5, 10);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThan(10);
    }
    try {
      crypto.randomInt(5, 5);
      throw new Error('expected to throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('ERR_OUT_OF_RANGE');
    }
    try {
      crypto.randomInt(1.5);
      throw new Error('expected to throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('ERR_INVALID_ARG_TYPE');
    }
  });

  it('randomInt supports the callback form', async () => {
    const crypto = boot()('crypto');
    const value = await new Promise<number>((resolve) => crypto.randomInt(3, 7, (_err: Error | null, v: number) => resolve(v)));
    expect(value).toBeGreaterThanOrEqual(3);
    expect(value).toBeLessThan(7);
  });

  it('randomBytes fills a Buffer and randomFillSync mutates in place', () => {
    const req = boot();
    const crypto = req('crypto');
    const { Buffer: NodeBuffer } = req('buffer');
    const bytes = crypto.randomBytes(16);
    expect(bytes.length).toBe(16);
    expect(NodeBuffer.isBuffer(bytes)).toBe(true);
    const target = new Uint8Array(8);
    expect(crypto.randomFillSync(target)).toBe(target);
    expect(crypto.randomFillSync(target, 2, 4)).toBe(target);
  });
});

describe('crypto: unsupported surface', () => {
  it('throws a typed NotImplementedError instead of returning undefined', () => {
    const crypto = boot()('crypto');
    // Symmetric ciphers are all real now (AES, ChaCha20, Camellia, ARIA, SM4…),
    // and so are asymmetric keys/signatures (RSA/EC/Ed25519, see
    // test/crypto-asym.test.ts) and DH key agreement (see
    // test/crypto-dh-secret.test.ts), but the native-only surface still refuses
    // loudly.
    expect(() => crypto.generateKeyPairSync('x25519')).toThrowError(/not implemented/);
  });
});
