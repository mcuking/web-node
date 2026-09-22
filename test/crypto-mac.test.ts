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

  it('raises NotImplementedError for the providers still pending', () => {
    const crypto = boot();
    expect(() => crypto.createMac('poly1305', new Uint8Array(32).fill(1))).toThrowError(/not implemented/i);
  });
});
