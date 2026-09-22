import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { argon2 as argon2Pure, ARGON2_D, ARGON2_I, ARGON2_ID } from '../src/node-runtime/crypto/argon2';
import { blake2b } from '../src/node-runtime/crypto/blake2b';

/**
 * Argon2 (`crypto.argon2` / `crypto.argon2Sync`).
 *
 * The differential corpus carries the RFC 9106 vectors, a spread of parameter
 * combinations, the full error surface and the async form; the unit tests below
 * pin the pure-JS primitives (BLAKE2b + the Argon2 core) directly.
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

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

describe('crypto argon2 (differential vs real Node)', () => {
  it('matches the oracle exactly', async () => {
    const program = fs.readFileSync('tools/crypto-argon2-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/crypto-argon2.json', 'utf8'));

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

describe('BLAKE2b primitive', () => {
  it('matches the RFC 7693 vectors', () => {
    expect(hex(blake2b(new TextEncoder().encode('abc'), 64))).toBe(
      'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1' +
        '7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
    );
    expect(hex(blake2b(new Uint8Array(0), 64))).toBe(
      '786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419' +
        'd25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce',
    );
  });
});

describe('Argon2 core', () => {
  it('matches the RFC 9106 vectors for all three variants', () => {
    const base = {
      password: new Uint8Array(32).fill(1),
      salt: new Uint8Array(16).fill(2),
      secret: new Uint8Array(8).fill(3),
      associatedData: new Uint8Array(12).fill(4),
      parallelism: 4,
      tagLength: 32,
      memory: 32,
      passes: 3,
    };
    expect(hex(argon2Pure({ ...base, type: ARGON2_D }))).toBe(
      '512b391b6f1162975371d30919734294f868e3be3984f3c1a13a4db9fabe4acb',
    );
    expect(hex(argon2Pure({ ...base, type: ARGON2_I }))).toBe(
      'c814d9d1dc7f37aa13f0d77f2494bda1c8de6b016dd388d29952a4c4672b6ce8',
    );
    expect(hex(argon2Pure({ ...base, type: ARGON2_ID }))).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });
});

describe('crypto.argon2Sync unit surface', () => {
  it('returns a Buffer of the requested tag length', () => {
    const crypto = boot();
    const tag = crypto.argon2Sync('argon2id', {
      message: 'password',
      nonce: 'somesalt',
      parallelism: 1,
      tagLength: 32,
      memory: 64,
      passes: 2,
    });
    expect(tag.constructor.name).toBe('Buffer');
    expect(tag.length).toBe(32);
  });

  it('rejects an unknown algorithm with the Node message', () => {
    const crypto = boot();
    expect(() => crypto.argon2Sync('argon2x', {})).toThrowError(
      /The argument 'algorithm' must be one of: 'argon2d', 'argon2i', 'argon2id'\. Received 'argon2x'/,
    );
  });

  it('enforces the memory floor of 8 * parallelism', () => {
    const crypto = boot();
    expect(() =>
      crypto.argon2Sync('argon2id', {
        message: 'x',
        nonce: '12345678',
        parallelism: 2,
        tagLength: 32,
        memory: 8,
        passes: 1,
      }),
    ).toThrowError(/The value of "parameters\.memory" is out of range\. It must be >= 16/);
  });

  it('delivers the tag through the async callback', async () => {
    const crypto = boot();
    const tag = await new Promise((resolve, reject) => {
      crypto.argon2(
        'argon2id',
        { message: 'password', nonce: 'somesalt', parallelism: 1, tagLength: 32, memory: 64, passes: 2 },
        (error: Error | null, result: Uint8Array) => (error ? reject(error) : resolve(result)),
      );
    });
    expect((tag as Uint8Array).length).toBe(32);
  });

  it('requires a callback for the async form', () => {
    const crypto = boot();
    expect(() =>
      crypto.argon2('argon2id', { message: 'x', nonce: '12345678', parallelism: 1, tagLength: 32, memory: 64, passes: 1 }),
    ).toThrowError(/callback/);
  });
});
