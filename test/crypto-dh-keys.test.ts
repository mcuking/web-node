import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * M92.1: DH `KeyObject`s. `tools/crypto-dh-keys-probe.cjs` runs unchanged on
 * real Node and inside web-node; the generated observation must match
 * `test/fixtures/crypto-dh-keys.json` (recorded from real Node with
 * `tools/crypto-dh-keys-oracle.mjs`) exactly.
 */
async function runProbe(program: string): Promise<Record<string, unknown>> {
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
  for (let i = 0; i < 600 && !stdout.includes('__OBS__'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    stdout = out.join('');
  }
  const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
  expect(line, 'probe produced no observation line').toBeTruthy();
  return JSON.parse(line!.slice('__OBS__'.length)) as Record<string, unknown>;
}

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

describe('DH KeyObject (differential vs real Node)', () => {
  it('matches the oracle exactly', async () => {
    const program = fs.readFileSync('tools/crypto-dh-keys-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/crypto-dh-keys.json', 'utf8'));
    const observed = await runProbe(program);
    expect(observed).toEqual(expected);
  }, 60000);
});

describe('DH KeyObject unit surface', () => {
  it('generates a modp14 key pair and round-trips it', () => {
    const crypto = boot();
    const { privateKey, publicKey } = crypto.generateKeyPairSync('dh', { group: 'modp14' });
    expect(privateKey.asymmetricKeyType).toBe('dh');
    expect(publicKey.asymmetricKeyType).toBe('dh');
    expect(publicKey.asymmetricKeyDetails).toEqual({});
    const der = publicKey.export({ type: 'spki', format: 'der' });
    expect(crypto.createPublicKey({ key: der, format: 'der', type: 'spki' }).equals(publicKey)).toBe(true);
    const pem = publicKey.export({ type: 'spki', format: 'pem' });
    expect(crypto.createPublicKey(pem).equals(publicKey)).toBe(true);
    expect(crypto.createPublicKey(privateKey).equals(publicKey)).toBe(true);
  });

  it('rejects a pkcs1 export of a DH key', () => {
    const crypto = boot();
    const { publicKey } = crypto.generateKeyPairSync('dh', { group: 'modp14' });
    expect(() => publicKey.export({ type: 'pkcs1', format: 'pem' })).toThrowError(
      /The selected key encoding pkcs1 can only be used for RSA keys\./,
    );
  });
});
