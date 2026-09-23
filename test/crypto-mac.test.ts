import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `crypto.createMac` / `crypto.getMacs` (M90.1: front-end + HMAC + BLAKE2b MAC).
 *
 * The remaining providers (KMAC, CMAC, GMAC, BLAKE2s MAC, Poly1305, SipHash)
 * are listed by `getMacs()` but raise NotImplementedError until M90.2-M90.4, so
 * they are deliberately absent from the corpus.
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

describe('crypto.createMac (differential vs real Node)', () => {
  it('matches the oracle exactly', async () => {
    const program = fs.readFileSync('tools/crypto-mac-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/crypto-mac.json', 'utf8'));

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
  });
});

describe('crypto.createMac unit surface', () => {
  it('lists the same providers as Node', () => {
    const crypto = boot();
    expect(crypto.getMacs()).toEqual([
      'blake2bmac', 'blake2smac', 'cmac', 'gmac', 'hmac',
      'kmac-128', 'kmac-256', 'kmac128', 'kmac256', 'poly1305', 'siphash',
    ]);
  });

  it('computes HMAC and BLAKE2b MAC', () => {
    const crypto = boot();
    expect(
      crypto.createMac('hmac', Uint8Array.from([0x6b]), { digest: 'sha256' }).update('d').final('hex'),
    ).toBe('e7ea21c3bcb63a4da3ad78503168d36bdca0be622382ea60a108fad4e4966679');
    const b2 = crypto.createMac('blake2bmac', new Uint8Array(64).fill(1), { outputLength: 16 });
    b2.update('data');
    expect(b2.final('hex')).toBe('5abfb747843a3d8e10269ad462e6d2db');
  });

  it('computes KMAC128 / KMAC256 (NIST SP 800-185 sample #1 / #4)', () => {
    const crypto = boot();
    const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
    const k = fromHex('404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f');
    const x = Uint8Array.from([0, 1, 2, 3]);
    const s = new TextEncoder().encode('My Tagged Application');
    expect(crypto.createMac('kmac128', k, { customization: s, outputLength: 32 }).update(x).final('hex')).toBe(
      '3b1fba963cd8b0b59e8c1a6d71888b7143651af8ba0a7070c0979e2811324aa5',
    );
    expect(crypto.createMac('kmac256', k, { customization: s, outputLength: 64 }).update(x).final('hex')).toBe(
      '20c570c31346f703c9ac36c61c03cb64c3970d0cfc787e9b79599d273a68d2f7f69d4cc3de9d104a351689f27cf6f5951f0103f33f4f24871024d9c27773a8dd',
    );
    // Defaults: 32 bytes for KMAC128, 64 for KMAC256.
    expect(crypto.createMac('kmac128', new Uint8Array(32).fill(1)).update('data').final().length).toBe(32);
    expect(crypto.createMac('kmac256', new Uint8Array(32).fill(1)).update('data').final().length).toBe(64);
  });

  it('computes CMAC / GMAC over AES', () => {
    const crypto = boot();
    expect(crypto.createMac('cmac', new Uint8Array(16).fill(1), { cipher: 'aes-128-cbc' }).update('data').final('hex')).toBe(
      'f3346600cd81405c757d154341c4ee75',
    );
    const g = crypto.createMac('gmac', new Uint8Array(16).fill(1), {
      cipher: 'aes-128-gcm',
      iv: new Uint8Array(12).fill(3),
    });
    g.update('data');
    expect(g.final('hex')).toBe('c1ca454c2e1863efde9bca32ded11efd');
  });

  it('computes BLAKE2s MAC, Poly1305 and SipHash', () => {
    const crypto = boot();
    expect(crypto.createMac('blake2smac', new Uint8Array(16).fill(1)).update('data').final('hex')).toBe(
      '289d018434fd9a3e835589a2d43103c258aa01aa22aeaf7e51ff26540b3bfbe2',
    );
    const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
    const poly = crypto.createMac(
      'poly1305',
      fromHex('85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b'),
    );
    poly.update('Cryptographic Forum Research Group');
    expect(poly.final('hex')).toBe('a8061dc1305136c6c22b8baf0c0127a9');
    expect(crypto.createMac('siphash', new Uint8Array(16).fill(3)).update('data').final('hex')).toBe(
      '191598004cb3dde007c7ac79f3801896',
    );
  });

  it('computes CMAC over DES-EDE and rejects ciphers it cannot serve', () => {
    const crypto = boot();
    // DES-EDE CMAC is real now (see test/crypto-des.test.ts); an 8-byte tag.
    expect(
      crypto.createMac('cmac', new Uint8Array(24).fill(1), { cipher: 'des-ede3-cbc' }).update('data').final('hex'),
    ).toBe('c3edd74ff210864d');
    // Camellia CMAC is real too (see test/crypto-camellia.test.ts); a 16-byte tag.
    expect(
      crypto.createMac('cmac', new Uint8Array(16).fill(1), { cipher: 'camellia-128-cbc' }).update('data').final('hex'),
    ).toBe('db7871c299307e017b90417133beb481');
    // CBC-CTS shares the plain-CBC block function: the CMAC is identical.
    expect(
      crypto.createMac('cmac', new Uint8Array(16).fill(1), { cipher: 'aes-128-cbc-cts' }).update('data').final('hex'),
    ).toBe('f3346600cd81405c757d154341c4ee75');
    // A known-but-unsupported cipher stays loud: CCM cannot back CMAC, exactly
    // as OpenSSL's provider reports its "invalid mode".
    expect(() => crypto.createMac('cmac', new Uint8Array(16).fill(1), { cipher: 'aria-128-ccm' })).toThrowError(
      /invalid mode/i,
    );
  });
});
