import { describe, expect, it } from 'vitest';
import { cshake, kmac, sha3_224, sha3_256, sha3_384, sha3_512, shake128, shake256 } from '../src/node-runtime/crypto/keccak';

/**
 * Keccak / SHA-3 / SHAKE / cSHAKE / KMAC primitives (M90.2), pinned against the
 * published NIST vectors. `createMac` only reaches KMAC today, so the underlying
 * permutation is verified directly here; the KMAC path is additionally checked
 * against Node/OpenSSL by test/crypto-mac.test.ts.
 */
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('SHA-3', () => {
  it('matches the FIPS 202 vectors', () => {
    expect(hex(sha3_224(new Uint8Array(0)))).toBe('6b4e03423667dbb73b6e15454f0eb1abd4597f9a1b078e3f5b5a6bc7');
    expect(hex(sha3_224(bytes('abc')))).toBe('e642824c3f8cf24ad09234ee7d3c766fc9a3a5168d0c94ad73b46fdf');
    expect(hex(sha3_256(new Uint8Array(0)))).toBe('a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a');
    expect(hex(sha3_256(bytes('abc')))).toBe('3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532');
    expect(hex(sha3_384(new Uint8Array(0)))).toBe(
      '0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004',
    );
    expect(hex(sha3_384(bytes('abc')))).toBe(
      'ec01498288516fc926459f58e2c6ad8df9b473cb0fc08c2596da7cf0e49be4b298d88cea927ac7f539f1edf228376d25',
    );
    expect(hex(sha3_512(new Uint8Array(0)))).toBe(
      'a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26',
    );
    expect(hex(sha3_512(bytes('abc')))).toBe(
      'b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0',
    );
  });
});

describe('SHAKE', () => {
  it('matches the FIPS 202 vectors', () => {
    expect(hex(shake128(new Uint8Array(0), 32))).toBe('7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26');
    expect(hex(shake256(new Uint8Array(0), 64))).toBe(
      '46b9dd2b0ba88d13233b3feb743eeb243fcd52ea62b81b82b50c27646ed5762fd75dc4ddd8c0f200cb05019d67b592f6fc821c49479ab48640292eacb3b7c4be',
    );
  });
});

describe('cSHAKE', () => {
  it('reduces to SHAKE when N and S are empty', () => {
    expect(hex(cshake(128, bytes('abc'), 32, new Uint8Array(0), new Uint8Array(0)))).toBe(hex(shake128(bytes('abc'), 32)));
  });

  it('matches the SP 800-185 sample', () => {
    // cSHAKE128(X="00010203", L=256, N="", S="Email Signature") sample #1.
    const x = Uint8Array.from([0, 1, 2, 3]);
    expect(hex(cshake(128, x, 32, new Uint8Array(0), bytes('Email Signature')))).toBe(
      'c1c36925b6409a04f1b504fcbca9d82b4017277cb5ed2b2065fc1d3814d5aaf5',
    );
  });
});

describe('KMAC', () => {
  it('matches SP 800-185 sample #1 / #4', () => {
    const k = Uint8Array.from(
      Array.from({ length: 32 }, (_, i) => 0x40 + i),
    );
    const x = Uint8Array.from([0, 1, 2, 3]);
    const s = bytes('My Tagged Application');
    expect(hex(kmac(128, k, x, 32, s))).toBe('3b1fba963cd8b0b59e8c1a6d71888b7143651af8ba0a7070c0979e2811324aa5');
    expect(hex(kmac(256, k, x, 64, s))).toBe(
      '20c570c31346f703c9ac36c61c03cb64c3970d0cfc787e9b79599d273a68d2f7f69d4cc3de9d104a351689f27cf6f5951f0103f33f4f24871024d9c27773a8dd',
    );
  });
});
