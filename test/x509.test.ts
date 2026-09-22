import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `crypto.X509Certificate` — a real DER/PEM certificate parser.
 *
 * The differential corpus in `tools/x509-probe.cjs` runs here and on real Node
 * (oracle -> `test/fixtures/x509.json`); the JSON must match field for field.
 * Node-side expectations were read off a real Node v26.9.0 (OpenSSL). The
 * fixture certificates live in `test/fixtures/x509/`.
 */
function boot(): any {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require('crypto');
}

describe('crypto.X509Certificate (differential vs real Node)', () => {
  it('matches the oracle field for field', async () => {
    const program = fs.readFileSync('tools/x509-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/x509.json', 'utf8'));

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
  }, 60000);
});

describe('crypto.X509Certificate unit surface', () => {
  const read = (name: string): string => fs.readFileSync(`test/fixtures/x509/${name}`, 'utf8');
  const readBytes = (name: string): Uint8Array => fs.readFileSync(`test/fixtures/x509/${name}`);
  const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

  it('parses a PEM certificate and exposes the DER', () => {
    const crypto = boot();
    const cert = new crypto.X509Certificate(read('leaf.pem'));
    expect(cert.subject).toContain('CN=example.com');
    expect(cert.issuer).toContain('CN=Web-Node Test CA');
    expect(cert.ca).toBe(false);
    expect(cert.raw.length).toBeGreaterThan(0);
    expect(cert.serialNumber).toMatch(/^[0-9A-F]+$/);
    expect(cert.fingerprint).toMatch(/^([0-9A-F]{2}:){19}[0-9A-F]{2}$/);
  });

  it('parses the DER form to the same identity as the PEM form', () => {
    const crypto = boot();
    const fromPem = new crypto.X509Certificate(read('leaf.pem'));
    const fromDer = new crypto.X509Certificate(readBytes('leaf.der'));
    expect(fromDer.fingerprint256).toBe(fromPem.fingerprint256);
    expect(hex(fromDer.raw)).toBe(hex(fromPem.raw));
  });

  it('verifies a signature with the issuer public key', () => {
    const crypto = boot();
    const leaf = new crypto.X509Certificate(read('leaf.pem'));
    const ca = new crypto.X509Certificate(read('ca.pem'));
    expect(leaf.verify(ca.publicKey)).toBe(true);
    expect(leaf.checkIssued(ca)).toBe(true);
    expect(ca.checkIssued(leaf)).toBe(false);
    expect(ca.verify(ca.publicKey)).toBe(true);
  });

  it('matches host / email / IP subject alternative names', () => {
    const crypto = boot();
    const leaf = new crypto.X509Certificate(read('leaf.pem'));
    expect(leaf.checkHost('example.com')).toBe('example.com');
    expect(leaf.checkHost('www.example.com')).toBe('*.example.com');
    expect(leaf.checkHost('bad.example.org')).toBeUndefined();
    expect(leaf.checkEmail('admin@example.com')).toBe('admin@example.com');
    expect(leaf.checkIP('127.0.0.1')).toBe('127.0.0.1');
    expect(leaf.checkIP('10.0.0.1')).toBeUndefined();
  });

  it('rejects invalid input with OpenSSL-shaped errors', () => {
    const crypto = boot();
    expect(() => new crypto.X509Certificate(42)).toThrowError(/must be of type string/);
    expect(() => new crypto.X509Certificate('not a cert')).toThrowError(/PEM routines::no start line/);
    const err = (() => {
      try { new crypto.X509Certificate('nope'); return null; } catch (e: any) { return e; }
    })();
    expect((err as any).code).toBe('ERR_OSSL_PEM_NO_START_LINE');
  });

  it('builds the legacy object with the parsed infoAccess', () => {
    const crypto = boot();
    const leaf = new crypto.X509Certificate(read('leaf.pem'));
    const legacy = leaf.toLegacyObject();
    expect(legacy.subject.CN).toBe('example.com');
    expect(legacy.infoAccess['OCSP - URI']).toEqual(['http://ocsp.example.com']);
    expect(legacy.serialNumber).toBe(leaf.serialNumber);
  });
});
