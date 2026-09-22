import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Prime generation and primality testing (`crypto.generatePrime(Sync)` /
 * `crypto.checkPrime(Sync)`).
 *
 * Real primality answers are deterministic, so the differential corpus carries
 * them verbatim; generated primes are random, so the corpus records structural
 * invariants (byte/bit length, top bits, congruences) that both sides compute.
 */
vi.setConfig({ testTimeout: 120000 });

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

describe('crypto primes (differential vs real Node)', () => {
  it('matches the oracle exactly', async () => {
    const program = fs.readFileSync('tools/crypto-primes-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/crypto-primes.json', 'utf8'));

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

describe('crypto.checkPrimeSync unit surface', () => {
  it('answers primality for bigints and byte sources alike', () => {
    const crypto = boot();
    expect(crypto.checkPrimeSync(2n)).toBe(true);
    expect(crypto.checkPrimeSync(97n)).toBe(true);
    expect(crypto.checkPrimeSync(91n)).toBe(false);
    expect(crypto.checkPrimeSync(Uint8Array.from([97]))).toBe(true);
    expect(crypto.checkPrimeSync(Uint8Array.from([0x61, 0x1f]))).toBe(false);
  });

  it('rejects a non-bytes candidate with the Node error shape', () => {
    const crypto = boot();
    expect(() => crypto.checkPrimeSync(97 as unknown as bigint)).toThrowError(
      /The "candidate" argument must be of type bigint or an instance of ArrayBuffer, TypedArray, Buffer, or DataView\. Received type number \(97\)/,
    );
  });

  it('rejects a negative bigint candidate', () => {
    const crypto = boot();
    expect(() => crypto.checkPrimeSync(-5n)).toThrowError(
      /The value of "candidate" is out of range\. It must be >= 0\. Received -5n/,
    );
  });
});

describe('crypto.generatePrimeSync unit surface', () => {
  it('returns an ArrayBuffer by default and a bigint on request', () => {
    const crypto = boot();
    const buffer = crypto.generatePrimeSync(64);
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBe(8);

    const bigint = crypto.generatePrimeSync(64, { bigint: true });
    expect(typeof bigint).toBe('bigint');
  });

  it('produces safe primes where the half is prime too', () => {
    const crypto = boot();
    const p = crypto.generatePrimeSync(32, { safe: true, bigint: true }) as bigint;
    expect(crypto.checkPrimeSync(p)).toBe(true);
    expect(crypto.checkPrimeSync((p - 1n) / 2n)).toBe(true);
  });

  it('honours the add/rem congruence', () => {
    const crypto = boot();
    const p = crypto.generatePrimeSync(64, { add: 30n, rem: 11n, bigint: true }) as bigint;
    expect(p % 30n).toBe(11n);
    expect(crypto.checkPrimeSync(p)).toBe(true);
  });

  it('reports OpenSSL bits-too-small for a one-bit size like Node', () => {
    const crypto = boot();
    expect(() => crypto.generatePrimeSync(1)).toThrowError(/bits too small/);
  });

  it('generates asynchronously through the callback', async () => {
    const crypto = boot();
    const prime = await new Promise((resolve, reject) => {
      crypto.generatePrime(32, { bigint: true }, (error: Error | null, result: bigint) =>
        error ? reject(error) : resolve(result),
      );
    });
    expect(typeof prime).toBe('bigint');
    expect(crypto.checkPrimeSync(prime)).toBe(true);
  });

  it('requires a callback for the async form', () => {
    const crypto = boot();
    expect(() => crypto.generatePrime(8)).toThrowError(/callback/);
  });
});
