import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `Blob` (and `File`) is now the real `lib/internal/blob.js` + `lib/internal/file.js`
 * running on a JS `blob` binding. The C++ binding is `DataQueue`-shaped so a blob
 * can be fd-backed and read incrementally; every byte source here is memory
 * resident, so the binding collapses to a flat list of `Uint8Array` parts while
 * keeping the observable contract (`blob.stream()` chunks on the original source
 * boundaries; a reader hands back one entry per `pull`, then EOS).
 *
 * Expected values are read off Node v26.9.0 (probe /tmp/blob-oracle.mjs).
 */
function boot(): { req: (id: string) => any; runtime: NodeRuntime } {
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
  return { req: runtime.realm.require.bind(runtime.realm) as (id: string) => any, runtime };
}

async function drain(stream: any): Promise<unknown[]> {
  const reader = stream.getReader();
  const out: unknown[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe('blob: surface', () => {
  it('exposes Blob/File through `buffer` and as the sandbox globals', () => {
    const { req, runtime } = boot();
    const buffer = req('buffer');
    expect(typeof buffer.Blob).toBe('function');
    expect(typeof buffer.File).toBe('function');
    // The global and the module have to agree on identity: the vendored
    // duplexify's `isBlob` gate keys off the same class.
    expect(runtime.sandboxGlobals.Blob).toBe(buffer.Blob);
    expect(runtime.sandboxGlobals.File).toBe(buffer.File);
    expect(Object.prototype.toString.call(new buffer.Blob([]))).toBe('[object Blob]');
  });

  it('does not expose the host realm Blob', () => {
    const { req } = boot();
    const { Blob } = req('buffer');
    expect(Blob).not.toBe(globalThis.Blob);
  });
});

describe('blob: construction & inspection', () => {
  it('concatenates parts and reports size/type', () => {
    const { req } = boot();
    const { Blob } = req('buffer');
    const b = new Blob(['abc', 'def']);
    expect(b.size).toBe(6);
    expect(b.type).toBe('');
  });

  it('lowercases an explicit type and clamps an unsupported one to ""', () => {
    const { req } = boot();
    const { Blob } = req('buffer');
    expect(new Blob([], { type: 'TEXT/Plain' }).type).toBe('text/plain');
    // A non-printable character invalidates the whole type.
    expect(new Blob([], { type: 'a\nb' }).type).toBe('');
  });

  it('rejects an unknown `endings` value', () => {
    const { req } = boot();
    const { Blob } = req('buffer');
    expect(() => new Blob(['a'], { endings: 'bogus' })).toThrowError(
      /The property 'options\.endings' is invalid/,
    );
  });

  it('flattens nested blobs', async () => {
    const { req } = boot();
    const { Blob } = req('buffer');
    const inner = new Blob(['xy']);
    const outer = new Blob(['a', inner, 'b']);
    expect(outer.size).toBe(4);
    expect(await outer.text()).toBe('axyb');
  });
});

describe('blob: reading', () => {
  it('reads back bytes/text/arrayBuffer', async () => {
    const { req } = boot();
    const { Blob } = req('buffer');
    const b = new Blob(['abc', 'def']);
    expect(new TextDecoder().decode(await b.arrayBuffer())).toBe('abcdef');
    expect(await b.text()).toBe('abcdef');
    expect(Array.from(await b.bytes())).toEqual([97, 98, 99, 100, 101, 102]);
  });

  it('streams on the original source boundaries', async () => {
    const { req } = boot();
    const { Blob } = req('buffer');
    const b = new Blob(['abc', 'def']);
    const chunks = (await drain(b.stream())).map((c) => Array.from(c as Uint8Array));
    expect(chunks).toEqual([
      [97, 98, 99],
      [100, 101, 102],
    ]);
  });

  it('yields the whole byte range as a single chunk', async () => {
    const { req } = boot();
    const { Blob } = req('buffer');
    const big = new Blob([new Uint8Array(200000)]);
    const chunks = (await drain(big.stream())) as Uint8Array[];
    expect(chunks.map((c) => c.length)).toEqual([200000]);
  });

  it('decodes a textStream', async () => {
    const { req } = boot();
    const { Blob } = req('buffer');
    const reader = new Blob(['012']).slice(0, 3).textStream().getReader();
    const out: string[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out.push(value);
    }
    expect(out).toEqual(['012']);
  });
});

describe('blob: slice', () => {
  it('clamps start/end and lowercases a slice type', async () => {
    const { req } = boot();
    const { Blob } = req('buffer');
    const s = new Blob(['0123456789']);
    const slice = s.slice(1, 4, 'TEXT/Plain');
    expect(slice.type).toBe('text/plain');
    expect(slice.size).toBe(3);
    expect(await slice.text()).toBe('123');
  });

  it('supports negative and omitted bounds', async () => {
    const { req } = boot();
    const { Blob } = req('buffer');
    const s = new Blob(['0123456789']);
    expect(s.slice(-3).size).toBe(3);
    expect(await s.slice(-3).text()).toBe('789');
    expect(await s.slice(2, -2).text()).toBe('234567');
  });
});

describe('blob: fs.openAsBlob', () => {
  it('reads a file into a Blob over its bytes', async () => {
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
    vfs.writeFile('/project/hi.txt', new TextEncoder().encode('hello blob file'));
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: () => {},
      onStderr: () => {},
    });
    const fs = runtime.realm.require('fs') as any;
    const blob = await fs.openAsBlob('/project/hi.txt');
    expect(blob.size).toBe(15);
    expect(await blob.text()).toBe('hello blob file');
    const { value } = await blob.stream().getReader().read();
    expect(Array.from(value)).toEqual([
      104, 101, 108, 108, 111, 32, 98, 108, 111, 98, 32, 102, 105, 108, 101,
    ]);
  });

  it('throws a synchronous ENOENT when the file is missing (as Node does)', async () => {
    const { req } = boot();
    const fs = req('fs');
    expect(() => fs.openAsBlob('/definitely/missing')).toThrowError(/ENOENT/);
  });
});
