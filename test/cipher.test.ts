import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `crypto` gained real symmetric ciphers: `createCipheriv` / `createDecipheriv`
 * over AES-128/192/256 in ECB, CBC, CTR, CFB, OFB and GCM.
 *
 * Node's ciphers are OpenSSL bindings, and WebCrypto cannot stand in for them —
 * `cipher.update()` / `cipher.final()` are synchronous and streaming, while
 * `subtle` is promise-only. They are therefore implemented in plain JS in
 * `src/node-runtime/crypto/cipher.ts` (FIPS-197 + NIST SP 800-38A/D).
 *
 * Every expected value below was read off **Node v26.9.0** (OpenSSL-backed) by
 * `/tmp/cipher-oracle.cjs`, so this is a differential test against real Node,
 * not a set of hand-copied vectors. The `fips197` / `nist-*` entries are the
 * published FIPS-197 and NIST SP 800-38A/D vectors, kept as a second opinion.
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

const enc = new TextEncoder();
const hex = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
};
const fromHex = (value: string): Uint8Array => {
  const out = new Uint8Array(value.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.substr(i * 2, 2), 16);
  return out;
};

const KEYS: Record<number, Uint8Array> = {
  128: fromHex('00112233445566778899aabbccddeeff'),
  192: fromHex('00112233445566778899aabbccddeeff0011223344556677'),
  256: fromHex('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'),
};
const IV16 = fromHex('0f0e0d0c0b0a09080706050403020100');
const IV12 = fromHex('0f0e0d0c0b0a090807060504');
const AAD = enc.encode('header-v1');
const PT: Record<string, Uint8Array> = {
  p1: enc.encode('The quick brown fox jumps over the lazy dog'), // 43 bytes → padded
  p2: enc.encode('0123456789abcdef'.repeat(4)), // 64 bytes → whole blocks
  p3: new Uint8Array(0),
};

interface Vector {
  ct: string;
  tag?: string;
}

const VECTORS: Record<string, Vector> = {
  'aes-128-ecb|p1': {
    ct: '2ef6c3fdb1314b5c2c326a2087fe1a8238c5a5db7dff38f6f4eb75b2e55cab3de24ed5cc8134dced885ace705b249ef4',
  },
  'aes-128-ecb|p2': {
    ct: 'aebdd39b144089d5e31cacd35b7a113aaebdd39b144089d5e31cacd35b7a113aaebdd39b144089d5e31cacd35b7a113aaebdd39b144089d5e31cacd35b7a113a00657ea140655a44782747705d422fad',
  },
  'aes-128-ecb|p3': { ct: '00657ea140655a44782747705d422fad' },
  'aes-128-cbc|p1': {
    ct: '1da882ff7d81c19260aa4a07fd2fbef87961fcc2d85b4037fc25a7d9c314046c347013af697b861b9e1ce61bada0f159',
  },
  'aes-128-cbc|p2': {
    ct: 'f04fa6de816345dc1914f6f04dc8fc39edb158ec5bdd95049513336bbc4603cfa5e39445c7b0303cdf0f7be46b21e6e2b16a767c8c6fe2a6def53374a69e4cc28d0fb9216ad035b8548efd7198e440ee',
  },
  'aes-128-cbc|p3': { ct: 'd8f43fc6392d8dced3af48947afeeee4' },
  'aes-128-ctr|p1': {
    ct: '6656131122374f223ba5acf8209c4d9b7d09da5e73ce2687e482bbc57c23db64221af6554ba87d125d0a04',
  },
  'aes-128-ctr|p2': {
    ct: '020f44026777107668bcafe82c8f46dd2b57904d2d8e7dc0af9bb5d17a359e767a4ee40a1ee73205015c028059eda1e41c2c555fd009ade5c308da98149fba7d',
  },
  'aes-128-ctr|p3': { ct: '' },
  'aes-128-cfb|p1': {
    ct: '6656131122374f223ba5acf8209c4d9b33ee41a106f11a082292f9a7f852c266fa94a64d1c2d7630644e14',
  },
  'aes-128-cfb|p2': {
    ct: '020f44026777107668bcafe82c8f46ddddecd47223acb2a76ec1c2ef2e61145dc02e3191caeea7d2af3c0c30a50d7efc0a12197cc2c6df0d8804174ad1125456',
  },
  'aes-128-cfb|p3': { ct: '' },
  'aes-128-ofb|p1': {
    ct: '6656131122374f223ba5acf8209c4d9b6808c706a836be02e613c3e982591773b432979050ef741c9b9bab',
  },
  'aes-128-ofb|p2': {
    ct: '020f44026777107668bcafe82c8f46dd3e568d15f676e545ad0acdfd844f5261ec6685cf05a03b0bc7cdadd043a6e0686f42cb0ef0ce292450e8b091a7d0c976',
  },
  'aes-128-ofb|p3': { ct: '' },
  'aes-128-gcm|p1': {
    ct: '7ae846d13993e39d65640f17895ec6ffa3be26eb15083630c05671b3373f93ecc99f674b70d847c5b4001e',
    tag: 'cce022e21bf6317a90a90c02119a0182',
  },
  'aes-128-gcm|p2': {
    ct: '1eb111c27cd3bcc9367d0c07854dcdb9f5e06cf84b486d778b4f7fa73129d6fe91cb7514259708d2e856180591ca9fed4b1f49c5d0b08ba266071a7b63641969',
    tag: '846376936ebd0e0395a119877771cf15',
  },
  'aes-128-gcm|p3': { ct: '', tag: 'e7c69a687d3317c0a6a7af2712404d2d' },
  'aes-192-ecb|p1': {
    ct: '46d34e0425e95eda2487361462a10c2250de78f11ee8a43286c3e809bab5eafd6506c23c8412a7b1692dace78884a995',
  },
  'aes-192-ecb|p2': {
    ct: '05876bb837a9df97e9dc1bebc0079a0b05876bb837a9df97e9dc1bebc0079a0b05876bb837a9df97e9dc1bebc0079a0b05876bb837a9df97e9dc1bebc0079a0b202500e3273b4c8363090848b5be0a5a',
  },
  'aes-192-ecb|p3': { ct: '202500e3273b4c8363090848b5be0a5a' },
  'aes-192-cbc|p1': {
    ct: '08b73ff7a46cec02a4ce5bea34706432b05495f460e8a031d0fd4517d51d3b7bb93a13f50e8ad4f32eb91d303fe7150d',
  },
  'aes-192-cbc|p2': {
    ct: '5f0704f221aff67af7edfb04b16798886b6f3d7b263d0975b2ebd54a3fc27a2fbf36b5e2594f0dcf1c1060936f1c1dc65b14d4018eaf5b4695ae3db9b9e36dece658b48d1439b5e1ed3782c02ff882bb',
  },
  'aes-192-cbc|p3': { ct: '0b28fe35c9ae31feee87a6555a75bdde' },
  'aes-192-ctr|p1': {
    ct: '4d257d84ec335f2501f0ea393a011b9b667c6848a8a1b89d6c2a21f1d3f275e02bbbff4bb1aa26def52cda',
  },
  'aes-192-ctr|p2': {
    ct: '297c2a97a973007152e9e929361210dd3022225bf6e1e3da27332fe5d5e430f273efed14e4e569c9a97adceb60f3aa38719b04893e01ec2c538827655ec76a29',
  },
  'aes-192-ctr|p3': { ct: '' },
  'aes-192-cfb|p1': {
    ct: '4d257d84ec335f2501f0ea393a011b9bd3af3f753539402964f5ff9dc6b34834cb60abf4b73c0c4b58fba7',
  },
  'aes-192-cfb|p2': {
    ct: '297c2a97a973007152e9e929361210dddf2401b52d5a37c195a0f7eedc7e6d96f0df4d569a35429cb3439938272520e90efb27ea8a26d1c5722ec029bd011b56',
  },
  'aes-192-cfb|p3': { ct: '' },
  'aes-192-ofb|p1': {
    ct: '4d257d84ec335f2501f0ea393a011b9b3f4315e06fa7137d9b967a4e9d79ca47db524a4cbff80019ac1fd3',
  },
  'aes-192-ofb|p2': {
    ct: '297c2a97a973007152e9e929361210dd691d5ff331e7483ad08f745a9b6f8f5583065813eab74f0ef049d5f27354a87939dc8524bdecb36ed54abb57dcf1c31b',
  },
  'aes-192-ofb|p3': { ct: '' },
  'aes-192-gcm|p1': {
    ct: '119e4c5e2004b40302951f6a4abdee8e8e706dcf68ae3f994c1e75eee6b66d8cc98c02db04322c9b6406bb',
    tag: '78d1d2618c172ec4082f100a5407d467',
  },
  'aes-192-gcm|p2': {
    ct: '75c71b4d6544eb57518c1c7a46aee5c8d82e27dc36ee64de07077bfae0a0289e91d81084517d638c3850bd6ee369f33df467db297ed56746c71d29dd4f670115',
    tag: 'a0f363dd12463acd998c11e6c0a5b25d',
  },
  'aes-192-gcm|p3': { ct: '', tag: 'd34b85b7d2a97fcd2366f353be710a2b' },
  'aes-256-ecb|p1': {
    ct: '109935caf47c9892565c66f9414dd0db352688591944284d6cb3e49be5ce0491600a8c1f6dcbe337147d918dd52eb0b1',
  },
  'aes-256-ecb|p2': {
    ct: 'cdf1b3182d9107d395d3776bab088cf5cdf1b3182d9107d395d3776bab088cf5cdf1b3182d9107d395d3776bab088cf5cdf1b3182d9107d395d3776bab088cf5242aea375afffe1afeee410d8154fa32',
  },
  'aes-256-ecb|p3': { ct: '242aea375afffe1afeee410d8154fa32' },
  'aes-256-cbc|p1': {
    ct: '60b0843dc1f18ad922af265f3a8b8f0aca252ce98591cc3114b336564f9f9002ab41db7a271821e9df43a44efa15b904',
  },
  'aes-256-cbc|p2': {
    ct: 'c8a60f1c95df2e4f7cc5a11ac4c040bfd91728307f25c9050ca2927dee6fa5cefcea3425150302be1830a821a84bf56fe1dcc73a847ff349d7fac9360160fdc28b4306115aca8efec99413c5fb714942',
  },
  'aes-256-cbc|p3': { ct: '2258814885f97e0e539cc0613346d8f4' },
  'aes-256-ctr|p1': {
    ct: '5fd2ecd0addb7fe9c4ccb516cd52c079a91dada69f4df9f160a1aeb2a4d6a8d55de1a01e00e3abb7ba6422',
  },
  'aes-256-ctr|p2': {
    ct: '3b8bbbc3e89b20bd97d5b606c141cb3fff43e7b5c10da2b62bb8a0a6a2c0edc705b5b24155ace4a0e632241844e166a46bd3c997c82e941d27124005c7fb3b39',
  },
  'aes-256-ctr|p3': { ct: '' },
  'aes-256-cfb|p1': {
    ct: '5fd2ecd0addb7fe9c4ccb516cd52c079d92bf1c156e55df836965610c4eaa12501f9e22d8f9e6775d4e510',
  },
  'aes-256-cfb|p2': {
    ct: '3b8bbbc3e89b20bd97d5b606c141cb3f71658c73ab858e09f340c8280207141618e7a45d832e1335e04a9640db771a50d7e9ff6597fb48595e1bf46f29ece36c',
  },
  'aes-256-cfb|p3': { ct: '' },
  'aes-256-ofb|p1': {
    ct: '5fd2ecd0addb7fe9c4ccb516cd52c079995324be0fec1a6462e0f92f3c3991edbf2fe2598db545787888b9',
  },
  'aes-256-ofb|p2': {
    ct: '3b8bbbc3e89b20bd97d5b606c141cb3fcf0d6ead51ac412329f9f73b3a2fd4ffe77bf006d8fa0a6f24debfeaf103b8b8ca6dfd50efc9f8accad302b17eadeb7f',
  },
  'aes-256-ofb|p3': { ct: '' },
  'aes-256-gcm|p1': {
    ct: 'ff6acca2ff5aa8c259c5369ff729363a77c2b5225e17d7bfb2dd3c03464b9af43350a0d3798ef2627c7e7f',
    tag: '964aa637adac13df1ef30b986bdd9f31',
  },
  'aes-256-gcm|p2': {
    ct: '9b339bb1ba1af7960adc358ffb3a3d7c219cff3100578cf8f9c43217405ddfe66b04b28c2cc1bd752028795bc8039ae4b9fad38189223d99030d2178acdc60d0',
    tag: '7adf652cf390a8823c0d94dc5c5d8f9a',
  },
  'aes-256-gcm|p3': { ct: '', tag: '7b4e44d8b553518fcd18f4d9fe5e3b29' },
  fips197: { ct: '69c4e0d86a7b0430d8cdb78070b4c55a' },
  'nist-cbc256': { ct: 'f58c4c04d6e5f1ba779eabfb5f7bfbd6' },
  'nist-ctr': { ct: '874d6191b620e3261bef6864990db6ce' },
  'nist-gcm-empty': { ct: '', tag: '58e2fccefa7e3061367f1d57a4e7455a' },
  'gcm-aad-hello': { ct: 'd7ea23d5448c18df5d5bdd', tag: '4e431bfc29d3c5d2d66a8237790e165a' },
};

const bitsOf = (algo: string): number => Number(algo.split('-')[1]);
const modeOf = (algo: string): string => algo.split('-')[2];
const ivFor = (algo: string): Uint8Array | null =>
  modeOf(algo) === 'ecb' ? null : modeOf(algo) === 'gcm' ? IV12 : IV16;

const cipherVectors = Object.keys(VECTORS).filter((key) => key.includes('|p'));

describe('AES ciphers produce Node/OpenSSL byte-for-byte output', () => {
  const crypto = boot()('crypto');

  for (const key of cipherVectors) {
    const [algo, label] = key.split('|');
    const vector = VECTORS[key];
    const mode = modeOf(algo);

    it(`${algo} encrypts ${label}`, () => {
      const cipher = crypto.createCipheriv(algo, KEYS[bitsOf(algo)], ivFor(algo));
      if (mode === 'gcm') cipher.setAAD(AAD);
      const out = hex(cipher.update(PT[label])) + hex(cipher.final());
      expect(out).toBe(vector.ct);
      if (vector.tag) expect(hex(cipher.getAuthTag())).toBe(vector.tag);
    });

    it(`${algo} decrypts ${label} back`, () => {
      const decipher = crypto.createDecipheriv(algo, KEYS[bitsOf(algo)], ivFor(algo));
      if (mode === 'gcm') {
        decipher.setAAD(AAD);
        decipher.setAuthTag(fromHex(vector.tag!));
      }
      const out = hex(decipher.update(fromHex(vector.ct))) + hex(decipher.final());
      expect(out).toBe(hex(PT[label]));
    });
  }
});

describe('published vectors (FIPS-197, NIST SP 800-38A/D)', () => {
  const crypto = boot()('crypto');

  it('AES-128 ECB single block matches FIPS-197', () => {
    const cipher = crypto.createCipheriv('aes-128-ecb', fromHex('000102030405060708090a0b0c0d0e0f'), null);
    cipher.setAutoPadding(false);
    const out = hex(cipher.update(fromHex('00112233445566778899aabbccddeeff'))) + hex(cipher.final());
    expect(out).toBe(VECTORS.fips197.ct);
  });

  it('AES-256 CBC matches NIST SP 800-38A', () => {
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      fromHex('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4'),
      fromHex('000102030405060708090a0b0c0d0e0f'),
    );
    cipher.setAutoPadding(false);
    const out = hex(cipher.update(fromHex('6bc1bee22e409f96e93d7e117393172a'))) + hex(cipher.final());
    expect(out).toBe(VECTORS['nist-cbc256'].ct);
  });

  it('AES-128 CTR matches NIST SP 800-38A', () => {
    const cipher = crypto.createCipheriv(
      'aes-128-ctr',
      fromHex('2b7e151628aed2a6abf7158809cf4f3c'),
      fromHex('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff'),
    );
    cipher.setAutoPadding(false);
    const out = hex(cipher.update(fromHex('6bc1bee22e409f96e93d7e117393172a'))) + hex(cipher.final());
    expect(out).toBe(VECTORS['nist-ctr'].ct);
  });

  it('AES-128 GCM empty message matches NIST SP 800-38D', () => {
    const cipher = crypto.createCipheriv('aes-128-gcm', fromHex('00'.repeat(16)), fromHex('00'.repeat(12)));
    expect(hex(cipher.final())).toBe(VECTORS['nist-gcm-empty'].ct);
    expect(hex(cipher.getAuthTag())).toBe(VECTORS['nist-gcm-empty'].tag);
  });

  it('GCM authenticates the AAD', () => {
    const cipher = crypto.createCipheriv(
      'aes-128-gcm',
      fromHex('0f0e0d0c0b0a09080706050403020100'),
      IV12,
    );
    cipher.setAAD(AAD);
    const out = hex(cipher.update(enc.encode('hello world'))) + hex(cipher.final());
    expect(out).toBe(VECTORS['gcm-aad-hello'].ct);
    expect(hex(cipher.getAuthTag())).toBe(VECTORS['gcm-aad-hello'].tag);
  });
});

describe('cipher streaming and encodings', () => {
  const crypto = boot()('crypto');

  it('chunked updates equal a single update, for every mode', () => {
    const plaintext = enc.encode('The quick brown fox jumps over the lazy dog');
    for (const algo of ['aes-128-cbc', 'aes-128-ctr', 'aes-128-cfb', 'aes-128-ofb', 'aes-128-gcm']) {
      const mode = modeOf(algo);
      const one = crypto.createCipheriv(algo, KEYS[128], ivFor(algo));
      if (mode === 'gcm') one.setAAD(AAD);
      const whole = hex(one.update(plaintext)) + hex(one.final()) + (mode === 'gcm' ? hex(one.getAuthTag()) : '');

      const many = crypto.createCipheriv(algo, KEYS[128], ivFor(algo));
      if (mode === 'gcm') many.setAAD(AAD);
      const parts: string[] = [];
      for (let i = 0; i < plaintext.length; i += 5) {
        parts.push(hex(many.update(plaintext.subarray(i, i + 5))));
      }
      parts.push(hex(many.final()));
      if (mode === 'gcm') parts.push(hex(many.getAuthTag()));
      expect(parts.join('')).toBe(whole);
    }
  });

  it('applies the input and output encodings, like Node', () => {
    const cipher = crypto.createCipheriv('aes-128-ctr', KEYS[128], IV16);
    const asHex = cipher.update('hello', 'utf8', 'hex');
    expect(typeof asHex).toBe('string');
    const cipher2 = crypto.createCipheriv('aes-128-ctr', KEYS[128], IV16);
    const asBuffer = cipher2.update(enc.encode('hello'));
    expect(hex(asBuffer)).toBe(asHex as string);
    expect(hex(cipher.final() as Uint8Array)).toBe('');

    const gcm = crypto.createCipheriv('aes-128-ctr', KEYS[128], IV16);
    gcm.update('68656c6c6f', 'hex');
    const tail = gcm.final('base64');
    expect(typeof tail).toBe('string');
  });

  it('leaves a block cipher without padding when setAutoPadding(false)', () => {
    const cipher = crypto.createCipheriv('aes-128-ecb', KEYS[128], null);
    cipher.setAutoPadding(false);
    // Whole blocks pass straight through; a partial block is a hard error.
    expect(hex(cipher.update(enc.encode('0123456789abcdef')))).toBe(
      VECTORS['aes-128-ecb|p2'].ct.slice(0, 32),
    );
    const partial = crypto.createCipheriv('aes-128-ecb', KEYS[128], null);
    partial.setAutoPadding(false);
    partial.update(fromHex('00'.repeat(8)));
    expect(() => partial.final()).toThrowError(/wrong final block length/);
  });
});

describe('cipher aliases and metadata', () => {
  const crypto = boot()('crypto');

  it('resolves the OpenSSL spellings', () => {
    const a = crypto.createCipheriv('aes128', KEYS[128], IV16);
    const b = crypto.createCipheriv('aes-128-cbc', KEYS[128], IV16);
    const pt = PT.p1;
    expect(hex(a.update(pt)) + hex(a.final())).toBe(hex(b.update(pt)) + hex(b.final()));

    const g = crypto.createCipheriv('id-aes128-gcm', KEYS[128], IV12);
    g.setAAD(AAD);
    g.update(PT.p1);
    g.final();
    expect(hex(g.getAuthTag())).toBe(VECTORS['aes-128-gcm|p1'].tag);

    // Cipher names are case-insensitive.
    expect(() => crypto.createCipheriv('AES-256-GCM', KEYS[256], IV12)).not.toThrow();
  });

  it('reports ciphers and their metadata', () => {
    const list = crypto.getCiphers();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toContain('aes-256-gcm');
    expect(list).toContain('aes-128-cbc');
    expect(list).toContain('aes-128-ccm');
    expect(list).toContain('id-aes128-ccm');
    expect([...list].sort()).toEqual(list); // Node returns them sorted

    expect(crypto.getCipherInfo('aes-256-cbc')).toEqual({
      mode: 'cbc',
      name: 'aes-256-cbc',
      nid: 427,
      keyLength: 32,
      blockSize: 16,
      ivLength: 16,
    });
    expect(crypto.getCipherInfo('aes-128-gcm')).toEqual({
      mode: 'gcm',
      name: 'id-aes128-gcm',
      nid: 895,
      keyLength: 16,
      blockSize: 1,
      ivLength: 12,
    });
    expect(crypto.getCipherInfo(419)).toEqual(crypto.getCipherInfo('aes-128-cbc'));
    expect(crypto.getCipherInfo('no-such-cipher')).toBeUndefined();
  });
});

describe('cipher error behaviour matches Node', () => {
  const crypto = boot()('crypto');

  const codeOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (error) {
      return (error as { code?: string }).code ?? (error as Error).name;
    }
    return 'no-throw';
  };

  it('rejects unknown and unimplemented ciphers distinctly', () => {
    expect(codeOf(() => crypto.createCipheriv('aes-999-cbc', KEYS[128], IV16))).toBe('ERR_CRYPTO_UNKNOWN_CIPHER');
    // Known to OpenSSL but not implemented here → a loud, typed error, not "unknown".
    expect(codeOf(() => crypto.createCipheriv('aes-128-siv', KEYS[128], IV12))).toBe(
      'ERR_WEB_NODE_NOT_IMPLEMENTED',
    );
  });

  it('validates the key and IV', () => {
    expect(codeOf(() => crypto.createCipheriv('aes-128-cbc', KEYS[256], IV16))).toBe('ERR_CRYPTO_INVALID_KEYLEN');
    expect(codeOf(() => crypto.createCipheriv('aes-128-cbc', KEYS[128], fromHex('00'.repeat(3))))).toBe(
      'ERR_CRYPTO_INVALID_IV',
    );
    expect(codeOf(() => crypto.createCipheriv('aes-128-ecb', KEYS[128], IV16))).toBe('ERR_CRYPTO_INVALID_IV');
    expect(codeOf(() => crypto.createCipheriv('aes-128-cbc', KEYS[128], undefined))).toBe('ERR_INVALID_ARG_TYPE');
    expect(codeOf(() => crypto.createCipheriv('aes-128-cbc', 42, IV16))).toBe('ERR_INVALID_ARG_TYPE');
  });

  it('validates the data argument', () => {
    const cipher = crypto.createCipheriv('aes-128-cbc', KEYS[128], IV16);
    expect(codeOf(() => cipher.update(42))).toBe('ERR_INVALID_ARG_TYPE');
  });

  it('rejects a tampered or missing GCM tag', () => {
    const cipher = crypto.createCipheriv('aes-128-gcm', KEYS[128], IV12);
    const ct = fromHex(hex(cipher.update(PT.p1)) + hex(cipher.final()));

    const wrong = crypto.createDecipheriv('aes-128-gcm', KEYS[128], IV12);
    wrong.setAuthTag(fromHex('00'.repeat(16)));
    wrong.update(ct);
    expect(() => wrong.final()).toThrowError('Unsupported state or unable to authenticate data');

    const missing = crypto.createDecipheriv('aes-128-gcm', KEYS[128], IV12);
    missing.update(ct);
    expect(() => missing.final()).toThrowError('Unsupported state or unable to authenticate data');
  });

  it('validates the tag length', () => {
    const decipher = crypto.createDecipheriv('aes-128-gcm', KEYS[128], IV12);
    expect(codeOf(() => decipher.setAuthTag(fromHex('00'.repeat(5))))).toBe('ERR_CRYPTO_INVALID_AUTH_TAG');
  });

  it('detects bad CBC padding', () => {
    const cipher = crypto.createCipheriv('aes-128-cbc', KEYS[128], IV16);
    const ct = fromHex(hex(cipher.update(PT.p2)) + hex(cipher.final()));
    ct[ct.length - 1] ^= 0xff;
    const decipher = crypto.createDecipheriv('aes-128-cbc', KEYS[128], IV16);
    decipher.update(ct);
    expect(codeOf(() => decipher.final())).toBe('ERR_OSSL_BAD_DECRYPT');
  });

  it('enforces the final/update state machine', () => {
    const cipher = crypto.createCipheriv('aes-128-cbc', KEYS[128], IV16);
    cipher.final();
    expect(codeOf(() => cipher.final())).toBe('ERR_CRYPTO_INVALID_STATE');
    expect(() => cipher.update(enc.encode('ab'))).toThrowError('Trying to add data in unsupported state');
  });

  it('only exposes getAuthTag on ciphers and setAuthTag on decipherers', () => {
    const cipher = crypto.createCipheriv('aes-128-cbc', KEYS[128], IV16);
    expect(cipher.setAuthTag).toBeUndefined();
    cipher.final();
    expect(codeOf(() => cipher.getAuthTag())).toBe('ERR_CRYPTO_INVALID_STATE');

    const decipher = crypto.createDecipheriv('aes-128-gcm', KEYS[128], IV12);
    expect(decipher.getAuthTag).toBeUndefined();

    const notAead = crypto.createCipheriv('aes-128-cbc', KEYS[128], IV16);
    expect(codeOf(() => notAead.setAAD(enc.encode('x')))).toBe('ERR_CRYPTO_INVALID_STATE');
  });

  it('does not export the removed legacy createCipher/createDecipher', () => {
    // Node v26 no longer has these; neither do we.
    expect(crypto.createCipher).toBeUndefined();
    expect(crypto.createDecipher).toBeUndefined();
  });
});
