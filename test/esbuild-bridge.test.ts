import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { wrapEsbuild, vfsEsbuildPlugin } from '../src/node-runtime/tooling/esbuild-bridge';

/**
 * The esbuild ⇄ VFS bridge.
 *
 * A browser tab has no file system, so `esbuild` is aliased to `esbuild-wasm`.
 * `transform()` is fine (string in/out) but `build()` has no file system of its
 * own and dies with `not implemented on js` the moment it resolves a file. The
 * bridge appends a VFS plugin to every `build()` so it can read the project.
 */

function makeVfs(files: Record<string, string> = {}): MemoryVfs {
  const vfs = new MemoryVfs({ cwd: '/project' });
  for (const [path, text] of Object.entries(files)) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir) vfs.mkdir(dir, { recursive: true });
    vfs.writeFile(path, new TextEncoder().encode(text));
  }
  return vfs;
}

/** A stand-in for esbuild's `build` object, capturing the plugin callbacks. */
function fakeBuild() {
  const resolvers: Array<(args: unknown) => unknown> = [];
  const loaders: Array<(args: unknown) => unknown> = [];
  const build = {
    onResolve(_options: unknown, cb: (args: unknown) => unknown) {
      resolvers.push(cb);
    },
    onLoad(_options: unknown, cb: (args: unknown) => unknown) {
      loaders.push(cb);
    },
  };
  return {
    build,
    resolve: (args: unknown) => resolvers.map((cb) => cb(args)).find((r) => r != null) ?? null,
    load: (args: unknown) => loaders.map((cb) => cb(args)).find((r) => r != null) ?? null,
  };
}

describe('esbuild VFS plugin', () => {
  it('resolves an entry point from the VFS', () => {
    const vfs = makeVfs({ '/project/vite.config.js': 'export default {}' });
    const fake = fakeBuild();
    vfsEsbuildPlugin(vfs).setup(fake.build as never);
    expect(fake.resolve({ path: '/project/vite.config.js', importer: '', kind: 'entry-point' })).toEqual({
      path: '/project/vite.config.js',
    });
  });

  it('resolves a relative import against the importer', () => {
    const vfs = makeVfs({ '/project/a.js': '', '/project/lib/b.mjs': '' });
    const fake = fakeBuild();
    vfsEsbuildPlugin(vfs).setup(fake.build as never);
    expect(fake.resolve({ path: './lib/b', importer: '/project/a.js', kind: 'import-statement' })).toEqual({
      path: '/project/lib/b.mjs',
    });
  });

  it('leaves bare specifiers and core modules to the caller', () => {
    const vfs = makeVfs({ '/project/a.js': '' });
    const fake = fakeBuild();
    vfsEsbuildPlugin(vfs).setup(fake.build as never);
    expect(fake.resolve({ path: 'vue', importer: '/project/a.js', kind: 'import-statement' })).toBeNull();
    expect(fake.resolve({ path: 'node:fs', importer: '/project/a.js', kind: 'import-statement' })).toBeNull();
  });

  it('loads JSON from the VFS but leaves JS to the caller', () => {
    const vfs = makeVfs({ '/project/data.json': '{"n":1}', '/project/a.js': 'export const a = 1' });
    const fake = fakeBuild();
    vfsEsbuildPlugin(vfs).setup(fake.build as never);
    expect(fake.load({ path: '/project/data.json' })).toEqual({ contents: '{"n":1}', loader: 'json' });
    expect(fake.load({ path: '/project/a.js' })).toBeNull();
  });
});

describe('wrapEsbuild', () => {
  it('appends the VFS plugin after the caller’s plugins and re-points default', () => {
    const fake = {
      build: (options: { plugins?: Array<{ name: string }> }) => (options.plugins ?? []).map((p) => p.name),
      transform: () => 'transformed',
      version: '0.0.0',
    };
    const wrapped = wrapEsbuild(fake, makeVfs());
    expect(wrapped.default).toBe(wrapped);
    expect(wrapped.version).toBe('0.0.0');
    expect((wrapped.transform as () => string)()).toBe('transformed');
    expect((wrapped.build as (o: unknown) => string[])({})).toEqual(['web-node-vfs']);
    expect((wrapped.build as (o: unknown) => string[])({ plugins: [{ name: 'vite:foo' }] })).toEqual([
      'vite:foo',
      'web-node-vfs',
    ]);
  });

  it('does not throw when the module exports build as a getter', () => {
    const fake: Record<string, unknown> = {};
    Object.defineProperty(fake, 'build', { get: () => () => 'ok', enumerable: true });
    const wrapped = wrapEsbuild(fake, makeVfs());
    expect(typeof wrapped.build).toBe('function');
    // The wrapper calls the original getter-supplied function.
    expect((wrapped.build as (o: unknown) => unknown)({})).toBeDefined();
  });
});

describe('runtime installs the esbuild bridge', () => {
  it('every require("esbuild") sees the patched build()', async () => {
    const vfs = makeVfs({
      '/project/node_modules/esbuild-wasm/package.json': JSON.stringify({
        name: 'esbuild-wasm',
        version: '0.0.0',
        main: 'main.js',
      }),
      '/project/node_modules/esbuild-wasm/main.js':
        `module.exports = {\n` +
        `  build: function (options) { return (options.plugins || []).map(function (p) { return p.name; }).join(','); },\n` +
        `  transform: function () { return 'transformed'; },\n` +
        `};\n`,
      '/project/index.js':
        `const a = require('esbuild');\n` +
        `const b = require('esbuild');\n` +
        `console.log('SAME ' + (a === b));\n` +
        `console.log('PLUGINS ' + a.build({ plugins: [{ name: 'user' }] }));\n` +
        `console.log('DEFAULT ' + (a.default === a));\n` +
        `console.log('TRANSFORM ' + a.transform());\n` +
        `console.log('PLUGINS2 ' + b.build({}));\n`,
    });
    const out: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: (c) => out.push(c),
      onStderr: (c) => out.push('ERR:' + c),
    });
    runtime.runMain('/project/index.js');
    await runtime.drain();
    const text = out.join('');
    expect(text, text).not.toContain('ERR:');
    // Cached per request: the same wrapped namespace each time.
    expect(text).toContain('SAME true');
    expect(text).toContain('PLUGINS user,web-node-vfs');
    expect(text).toContain('DEFAULT true');
    expect(text).toContain('TRANSFORM transformed');
    expect(text).toContain('PLUGINS2 web-node-vfs');
  });
});
