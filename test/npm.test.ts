import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { encodeBase64 } from '../src/node-runtime/vfs/base64';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { compare, maxSatisfying, satisfies } from '../src/node-runtime/npm/semver';
import { gunzip, untar } from '../src/node-runtime/npm/tarball';
import { nameFromLockPath, parseSri, verifyIntegrity } from '../src/node-runtime/npm';
import type { FetchLike, FetchResponseLike } from '../src/node-runtime/npm/registry';

// ---------------------------------------------------------------------------
// tar/gzip helpers (a tiny synchronous ustar writer for fixtures)
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function writeStr(buf: Uint8Array, offset: number, len: number, value: string): void {
  const bytes = encoder.encode(value);
  buf.set(bytes.subarray(0, len), offset);
}

function writeOctal(buf: Uint8Array, offset: number, len: number, value: number): void {
  writeStr(buf, offset, len, value.toString(8).padStart(len - 1, '0') + '\0');
}

function headerFor(path: string, size: number, typeflag: string): Uint8Array {
  const h = new Uint8Array(512);
  writeStr(h, 0, 100, path);
  writeOctal(h, 100, 8, 0o644);
  writeOctal(h, 108, 8, 0);
  writeOctal(h, 116, 8, 0);
  writeOctal(h, 124, 12, size);
  writeOctal(h, 136, 12, 0);
  h[156] = typeflag.charCodeAt(0);
  writeStr(h, 257, 8, 'ustar');
  writeStr(h, 263, 8, '00');
  for (let i = 148; i < 156; i++) h[i] = 32;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  writeStr(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return h;
}

function pad512(bytes: Uint8Array): Uint8Array {
  const rem = bytes.length % 512;
  if (rem === 0) return bytes;
  const out = new Uint8Array(bytes.length + (512 - rem));
  out.set(bytes, 0);
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function makeTar(entries: Array<{ path: string; data: string }>): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const data = encoder.encode(entry.data);
    blocks.push(headerFor(entry.path, data.length, '0'));
    blocks.push(pad512(data));
  }
  blocks.push(new Uint8Array(1024)); // end of archive
  return concat(blocks);
}

/** A pax extended header record, then a truncated real header. */
function makeTarWithPax(longPath: string, data: string): Uint8Array {
  const payload = encoder.encode(data);
  const record = paxRecord('path', longPath);
  const paxData = encoder.encode(record);
  const blocks: Uint8Array[] = [];
  blocks.push(headerFor('PaxHeaders/fixture', paxData.length, 'x'));
  blocks.push(pad512(paxData));
  blocks.push(headerFor(longPath.slice(0, 100), payload.length, '0'));
  blocks.push(pad512(payload));
  blocks.push(new Uint8Array(1024));
  return concat(blocks);
}

function paxRecord(key: string, value: string): string {
  const base = ` ${key}=${value}\n`;
  let length = base.length + 1;
  // The length prefix itself changes the total; iterate to a fixed point.
  for (let i = 0; i < 4; i++) {
    const candidate = String(length) + base;
    if (candidate.length === length) return candidate;
    length = candidate.length;
  }
  return String(length) + base;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const part = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([part]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------------------
// fake registry
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function bytesResponse(bytes: Uint8Array): FetchResponseLike {
  const copy = bytes.slice();
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    arrayBuffer: async () => copy.buffer,
  };
}

function notFound(): FetchResponseLike {
  return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
}

function fakeRegistry(
  packuments: Record<string, unknown>,
  tarballs: Record<string, Uint8Array>,
): FetchLike {
  return async (url: string) => {
    if (Object.prototype.hasOwnProperty.call(tarballs, url)) return bytesResponse(tarballs[url]);
    const name = decodeURIComponent(url.split('/').pop() ?? '');
    if (Object.prototype.hasOwnProperty.call(packuments, name)) return jsonResponse(packuments[name]);
    return notFound();
  };
}

function makeProject(files: Record<string, string>): MemoryVfs {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) vfs.mkdir(dir, { recursive: true });
    vfs.writeFile(path, encoder.encode(content));
  }
  return vfs;
}

function bootRuntime(vfs: MemoryVfs): { runtime: NodeRuntime; out: string[] } {
  const out: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: (c) => out.push(c),
  });
  return { runtime, out };
}

// ---------------------------------------------------------------------------
// semver
// ---------------------------------------------------------------------------

describe('semver', () => {
  it('orders versions including prereleases', () => {
    expect(compare('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compare('1.2.3', '1.2.3')).toBe(0);
    expect(compare('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compare('1.0.0', '1.0.0-beta')).toBeGreaterThan(0); // release > prerelease
    expect(compare('1.0.0-alpha.1', '1.0.0-alpha.2')).toBeLessThan(0);
  });

  it('handles caret ranges', () => {
    expect(satisfies('1.2.3', '^1.2.3')).toBe(true);
    expect(satisfies('1.9.0', '^1.2.3')).toBe(true);
    expect(satisfies('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfies('0.2.9', '^0.2.3')).toBe(true);
    expect(satisfies('0.3.0', '^0.2.3')).toBe(false);
    expect(satisfies('0.0.3', '^0.0.3')).toBe(true);
    expect(satisfies('0.0.4', '^0.0.3')).toBe(false);
  });

  it('handles tilde, partial and wildcard ranges', () => {
    expect(satisfies('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfies('1.2.0', '1.2')).toBe(true);
    expect(satisfies('1.3.0', '1.2')).toBe(false);
    expect(satisfies('1.4.0', '1.x')).toBe(true);
    expect(satisfies('2.0.0', '1.x')).toBe(false);
    expect(satisfies('3.1.4', '*')).toBe(true);
  });

  it('handles comparators, hyphen ranges and unions', () => {
    expect(satisfies('1.5.0', '>=1.2.0 <2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>=1.2.0 <2.0.0')).toBe(false);
    expect(satisfies('1.5.0', '1.2.3 - 1.9.9')).toBe(true);
    expect(satisfies('2.0.0', '1.2.3 - 1.9.9')).toBe(false);
    expect(satisfies('3.1.0', '^1.0.0 || ^3.0.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.0.0 || ^3.0.0')).toBe(false);
  });

  it('excludes prereleases unless the range opts in', () => {
    expect(satisfies('2.0.0-beta.1', '^1.0.0')).toBe(false);
    expect(satisfies('2.0.0-beta.1', '>=2.0.0-beta.1')).toBe(true);
    expect(satisfies('2.0.0-beta.1', '^1.0.0', true)).toBe(true);
  });

  it('picks the highest satisfying version', () => {
    const versions = ['1.0.0', '1.0.1', '1.1.0', '2.0.0', '2.1.0-beta.1'];
    expect(maxSatisfying(versions, '^1.0.0')).toBe('1.1.0');
    expect(maxSatisfying(versions, '~1.0.0')).toBe('1.0.1');
    expect(maxSatisfying(versions, '*')).toBe('2.0.0');
    expect(maxSatisfying(versions, '^3.0.0')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// tarball
// ---------------------------------------------------------------------------

describe('tarball', () => {
  it('gunzips and untars package files, stripping the package/ prefix', async () => {
    const tgz = await gzip(
      makeTar([
        { path: 'package/package.json', data: '{"name":"x"}' },
        { path: 'package/index.js', data: 'module.exports = 1;' },
        { path: 'package/lib/deep.js', data: 'deep' },
      ]),
    );
    const entries = untar(await gunzip(tgz));
    const files = entries.filter((e) => e.type === 'file').map((e) => e.path).sort();
    expect(files).toEqual(['index.js', 'lib/deep.js', 'package.json']);
    const index = entries.find((e) => e.path === 'index.js')!;
    expect(new TextDecoder().decode(index.data)).toBe('module.exports = 1;');
  });

  it('applies pax extended headers for long paths', async () => {
    const longPath = `package/${'nested/'.repeat(20)}file.js`;
    const entries = untar(makeTarWithPax(longPath, 'long'));
    const file = entries.find((e) => e.type === 'file')!;
    expect(file.path).toBe('nested/'.repeat(20) + 'file.js');
    expect(new TextDecoder().decode(file.data)).toBe('long');
  });
});

// ---------------------------------------------------------------------------
// installer (end to end, offline)
// ---------------------------------------------------------------------------

const alphaTarball = () =>
  gzip(
    makeTar([
      { path: 'package/package.json', data: JSON.stringify({ name: 'alpha', version: '1.0.0', main: 'index.js', dependencies: { beta: '~1.0.0' } }) },
      { path: 'package/index.js', data: `const beta = require('beta'); module.exports = () => 'alpha+' + beta();` },
    ]),
  );

const betaTarball = (version: string, body: string) =>
  gzip(
    makeTar([
      { path: 'package/package.json', data: JSON.stringify({ name: 'beta', version, main: 'index.js' }) },
      { path: 'package/index.js', data: `module.exports = () => ${JSON.stringify(body)};` },
    ]),
  );

function betaManifest(version: string): unknown {
  return {
    name: 'beta',
    version,
    dist: { tarball: `https://registry.npmjs.org/beta/-/beta-${version}.tgz` },
  };
}

function alphaManifest(): unknown {
  return {
    name: 'alpha',
    version: '1.0.0',
    dependencies: { beta: '~1.0.0' },
    dist: { tarball: 'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz' },
  };
}

describe('npm installer', () => {
  it('installs a dependency graph, hoists transitives and requires them', async () => {
    const tarballs: Record<string, Uint8Array> = {
      'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz': await alphaTarball(),
      'https://registry.npmjs.org/beta/-/beta-1.0.1.tgz': await betaTarball('1.0.1', 'beta'),
    };
    const packuments = {
      alpha: { name: 'alpha', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': alphaManifest() } },
      beta: { name: 'beta', 'dist-tags': { latest: '1.0.1' }, versions: { '1.0.0': betaManifest('1.0.0'), '1.0.1': betaManifest('1.0.1') } },
    };

    const vfs = makeProject({
      '/project/package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { alpha: '^1.0.0' } }),
      '/project/index.js': `console.log(require('alpha')());`,
    });
    const { runtime, out } = bootRuntime(vfs);

    const result = await runtime.installDependencies({ fetch: fakeRegistry(packuments, tarballs) });

    expect(result.packages).toBe(2);
    expect(result.warnings).toEqual([]);
    // beta was hoisted to the top-level node_modules
    expect(vfs.exists('/project/node_modules/alpha/index.js')).toBe(true);
    expect(vfs.exists('/project/node_modules/beta/index.js')).toBe(true);

    runtime.runMain('/project/index.js');
    expect(out.join('')).toBe('alpha+beta\n');
  });

  it('nests on a version conflict and still resolves the right version', async () => {
    const tarballs: Record<string, Uint8Array> = {
      'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz': await alphaTarball(),
      'https://registry.npmjs.org/beta/-/beta-1.0.0.tgz': await betaTarball('1.0.0', 'beta-old'),
      'https://registry.npmjs.org/beta/-/beta-1.0.1.tgz': await betaTarball('1.0.1', 'beta-new'),
    };
    const packuments = {
      alpha: { name: 'alpha', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': alphaManifest() } },
      beta: { name: 'beta', 'dist-tags': { latest: '1.0.1' }, versions: { '1.0.0': betaManifest('1.0.0'), '1.0.1': betaManifest('1.0.1') } },
    };

    const vfs = makeProject({
      '/project/package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { beta: '1.0.0', alpha: '^1.0.0' } }),
      '/project/index.js': `console.log(require('beta')(), '/', require('alpha')());`,
    });
    const { runtime, out } = bootRuntime(vfs);

    const result = await runtime.installDependencies({ fetch: fakeRegistry(packuments, tarballs) });
    expect(result.packages).toBe(3); // beta@1.0.0, alpha@1.0.0, beta@1.0.1 (nested)

    const readVersion = (path: string) =>
      (JSON.parse(new TextDecoder().decode(vfs.readFile(path))) as { version: string }).version;
    expect(readVersion('/project/node_modules/beta/package.json')).toBe('1.0.0');
    expect(readVersion('/project/node_modules/alpha/node_modules/beta/package.json')).toBe('1.0.1');

    runtime.runMain('/project/index.js');
    expect(out.join('')).toBe('beta-old / alpha+beta-new\n');
  });

  it('reports a warning when nothing satisfies the range', async () => {
    const packuments = {
      alpha: { name: 'alpha', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': alphaManifest() } },
    };
    const vfs = makeProject({
      '/project/package.json': JSON.stringify({ name: 'demo', dependencies: { alpha: '^9.0.0' } }),
    });
    const { runtime } = bootRuntime(vfs);
    const result = await runtime.installDependencies({ fetch: fakeRegistry(packuments, {}) });
    expect(result.packages).toBe(0);
    expect(result.warnings.join()).toContain('no version of alpha satisfies');
  });

  it('writes a lockfile and reuses it without re-resolving', async () => {
    const tarballs: Record<string, Uint8Array> = {
      'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz': await alphaTarball(),
      'https://registry.npmjs.org/beta/-/beta-1.0.1.tgz': await betaTarball('1.0.1', 'beta'),
    };
    const packuments = {
      alpha: { name: 'alpha', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': alphaManifest() } },
      beta: { name: 'beta', 'dist-tags': { latest: '1.0.1' }, versions: { '1.0.0': betaManifest('1.0.0'), '1.0.1': betaManifest('1.0.1') } },
    };
    let packumentFetches = 0;
    const inner = fakeRegistry(packuments, tarballs);
    const counting: FetchLike = async (url, init) => {
      if (!/\/\/registry\.npmjs\.org\/[^/]+$/.test(url)) return inner(url, init);
      packumentFetches += 1;
      return inner(url, init);
    };

    const vfs = makeProject({
      '/project/package.json': JSON.stringify({ name: 'demo', version: '2.0.0', dependencies: { alpha: '^1.0.0' } }),
    });
    const { runtime } = bootRuntime(vfs);

    const first = await runtime.installDependencies({ fetch: counting });
    expect(first.fromLockfile).toBe(0);
    expect(vfs.exists('/project/package-lock.json')).toBe(true);
    const lock = JSON.parse(new TextDecoder().decode(vfs.readFile('/project/package-lock.json'))) as {
      lockfileVersion: number;
      packages: Record<string, { version: string; resolved?: string; dependencies?: Record<string, string> }>;
    };
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages['node_modules/alpha'].version).toBe('1.0.0');
    expect(lock.packages['node_modules/beta'].version).toBe('1.0.1');
    expect(lock.packages['node_modules/beta'].resolved).toContain('beta-1.0.1.tgz');

    const afterFirst = packumentFetches;
    const second = await runtime.installDependencies({ fetch: counting });
    expect(second.fromLockfile).toBe(2); // alpha + beta, both reused
    expect(second.packages).toBe(first.packages);
    expect(packumentFetches).toBe(afterFirst); // no resolution attempts
  });

  it('verifies tarball integrity and rejects a mismatch', async () => {
    const bytes = await betaTarball('1.0.1', 'beta');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
    const good = `sha512-${encodeBase64(digest)}`;
    expect(parseSri(good)[0].algorithm).toBe('sha512');
    await expect(verifyIntegrity(bytes, { tarball: 'x', integrity: good })).resolves.toBe(good);
    await expect(verifyIntegrity(bytes, { tarball: 'x', integrity: 'sha512-AAAA' })).rejects.toThrow(/integrity check failed/);
    // shasum (sha1 hex) is the legacy fallback
    const sha1 = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
    const hex = [...sha1].map((b) => b.toString(16).padStart(2, '0')).join('');
    await expect(verifyIntegrity(bytes, { tarball: 'x', shasum: hex })).resolves.toBe(`sha1-${encodeBase64(sha1)}`);
    await expect(verifyIntegrity(bytes, { tarball: 'x', shasum: 'deadbeef' })).rejects.toThrow(/shasum check failed/);
  });

  it('refuses to install a package whose registry integrity does not match', async () => {
    const packuments = {
      beta: {
        name: 'beta',
        'dist-tags': { latest: '1.0.1' },
        versions: { '1.0.1': { ...(betaManifest('1.0.1') as object), dist: { tarball: 'https://registry.npmjs.org/beta/-/beta-1.0.1.tgz', integrity: 'sha512-not-the-real-one' } } },
      },
    };
    const tarballs = { 'https://registry.npmjs.org/beta/-/beta-1.0.1.tgz': await betaTarball('1.0.1', 'beta') };
    const vfs = makeProject({ '/project/package.json': JSON.stringify({ name: 'demo', dependencies: { beta: '1.0.1' } }) });
    const { runtime } = bootRuntime(vfs);
    await expect(runtime.installDependencies({ fetch: fakeRegistry(packuments, tarballs) })).rejects.toThrow(/integrity check failed/);
    // Nothing should have been written for the bad package.
    expect(vfs.exists('/project/node_modules/beta/package.json')).toBe(false);
  });

  it('auto-installs a missing peer dependency at the root', async () => {
    const needsGamma = () =>
      gzip(
        makeTar([
          { path: 'package/package.json', data: JSON.stringify({ name: 'alpha', version: '1.0.0', main: 'index.js', peerDependencies: { gamma: '^1.0.0' } }) },
          { path: 'package/index.js', data: `module.exports = () => 'alpha+' + require('gamma')();` },
        ]),
      );
    const gammaTarball = () =>
      gzip(makeTar([
        { path: 'package/package.json', data: JSON.stringify({ name: 'gamma', version: '1.0.0', main: 'index.js' }) },
        { path: 'package/index.js', data: `module.exports = () => 'gamma';` },
      ]));
    const tarballs: Record<string, Uint8Array> = {
      'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz': await needsGamma(),
      'https://registry.npmjs.org/gamma/-/gamma-1.0.0.tgz': await gammaTarball(),
    };
    const packuments = {
      alpha: {
        name: 'alpha',
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { name: 'alpha', version: '1.0.0', peerDependencies: { gamma: '^1.0.0' }, dist: { tarball: 'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz' } } },
      },
      gamma: { name: 'gamma', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name: 'gamma', version: '1.0.0', dist: { tarball: 'https://registry.npmjs.org/gamma/-/gamma-1.0.0.tgz' } } } },
    };
    const vfs = makeProject({
      '/project/package.json': JSON.stringify({ name: 'demo', dependencies: { alpha: '^1.0.0' } }),
      '/project/index.js': `console.log(require('alpha')());`,
    });
    const { runtime, out } = bootRuntime(vfs);
    const result = await runtime.installDependencies({ fetch: fakeRegistry(packuments, tarballs) });
    expect(result.warnings).toEqual([]);
    expect(result.packages).toBe(2);
    expect(vfs.exists('/project/node_modules/gamma/index.js')).toBe(true);
    runtime.runMain('/project/index.js');
    expect(out.join('')).toBe('alpha+gamma\n');
  });

  it('stays silent when an optional dependency cannot be resolved', async () => {    const withOptional = () =>
      gzip(
        makeTar([
          { path: 'package/package.json', data: JSON.stringify({ name: 'alpha', version: '1.0.0', main: 'index.js', optionalDependencies: { 'native-thing': '^1.0.0' } }) },
          { path: 'package/index.js', data: `module.exports = () => 'alpha';` },
        ]),
      );
    const tarballs = { 'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz': await withOptional() };
    const packuments = {
      alpha: {
        name: 'alpha',
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { name: 'alpha', version: '1.0.0', optionalDependencies: { 'native-thing': '^1.0.0' }, dist: { tarball: 'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz' } } },
      },
    };
    const vfs = makeProject({ '/project/package.json': JSON.stringify({ name: 'demo', dependencies: { alpha: '^1.0.0' } }) });
    const { runtime } = bootRuntime(vfs);
    const result = await runtime.installDependencies({ fetch: fakeRegistry(packuments, tarballs) });
    expect(result.packages).toBe(1);
    expect(result.warnings).toEqual([]); // optional failures are silent, like npm
  });

  it('skips an optional dependency for another platform (like npm does)', async () => {
    const withNative = () =>
      gzip(
        makeTar([
          { path: 'package/package.json', data: JSON.stringify({ name: 'alpha', version: '1.0.0', main: 'index.js', optionalDependencies: { 'native-thing': '^1.0.0' } }) },
          { path: 'package/index.js', data: `module.exports = () => 'alpha';` },
        ]),
      );
    const tarballs = {
      'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz': await withNative(),
      'https://registry.npmjs.org/native-thing/-/native-thing-1.0.0.tgz': await betaTarball('1.0.0', 'native'),
    };
    const packuments = {
      alpha: {
        name: 'alpha',
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { name: 'alpha', version: '1.0.0', optionalDependencies: { 'native-thing': '^1.0.0' }, dist: { tarball: 'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz' } } },
      },
      'native-thing': {
        name: 'native-thing',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': { name: 'native-thing', version: '1.0.0', os: ['darwin'], cpu: ['arm64'], dist: { tarball: 'https://registry.npmjs.org/native-thing/-/native-thing-1.0.0.tgz' } },
        },
      },
    };
    const vfs = makeProject({ '/project/package.json': JSON.stringify({ name: 'demo', dependencies: { alpha: '^1.0.0' } }) });
    const { runtime } = bootRuntime(vfs);
    const result = await runtime.installDependencies({ fetch: fakeRegistry(packuments, tarballs) });
    expect(result.packages).toBe(1); // the darwin-only optional dep is not installed
    expect(result.warnings).toEqual([]);
    expect(vfs.exists('/project/node_modules/native-thing')).toBe(false);
  });
});

describe('lockfile paths', () => {
  it('extracts the package name from a node_modules path', () => {
    expect(nameFromLockPath('node_modules/ms')).toBe('ms');
    expect(nameFromLockPath('node_modules/a/node_modules/b')).toBe('b');
    expect(nameFromLockPath('node_modules/@scope/pkg')).toBe('@scope/pkg');
    expect(nameFromLockPath('node_modules/a/node_modules/@scope/pkg')).toBe('@scope/pkg');
    expect(nameFromLockPath('')).toBeNull();
  });
});
