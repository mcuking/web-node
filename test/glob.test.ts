import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Glob matching used to be a stub that threw (`path.matchesGlob`, `fs.glob*`).
 * It is now Node's real `lib/internal/fs/glob.js` — the glob walker plus the
 * matcher — riding on the bundled `internal/deps/minimatch/index` that Node
 * itself ships (esbuild output of `deps/minimatch`, vendored verbatim).
 *
 * Expected values were read off Node v26.9.0 with `process.platform` pinned to
 * `linux` (the platform this runtime reports), so the case-sensitivity branch
 * matches. Probes: `/tmp/wprobe/g2.js` (matcher), `/tmp/wprobe/g4.js` (glob).
 *
 * `cwd` is passed explicitly: the vendored `path.resolve` reads the free
 * `process`, which is the *host* process when the runtime is embedded (these
 * tests boot with `installGlobals: false`). In the browser the sandbox
 * `process` is global, so the default `cwd` is the VFS cwd — that path is
 * exercised by the demo, not here.
 */
function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const files = [
    '/project/index.js',
    '/project/src/a.js',
    '/project/src/b.txt',
    '/project/src/deep/c.js',
  ];
  for (const file of files) {
    const dir = file.slice(0, file.lastIndexOf('/'));
    vfs.mkdir(dir, { recursive: true });
    vfs.writeFile(file, new TextEncoder().encode(file.endsWith('.js') ? '// js\n' : 'text\n'));
  }
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require.bind(runtime.realm) as (id: string) => any;
}

const CWD = '/project';

describe('vendored: internal/fs/glob (real glob matching)', () => {
  it('path.matchesGlob matches Node exactly (linux, case-insensitive magic)', () => {
    const path = boot()('path');
    const cases: Array<[string, string, boolean]> = [
      ['/a/b/c.txt', '**/*.txt', true],
      ['/a/b/c.txt', '**/*.js', false],
      ['/x/Y.js', '**/*.js', true],
      ['/x/y.js', '**/*.JS', true],
      ['a/b.js', '*.js', false],
      ['a/b.js', '**/*.js', true],
      ['src/index.js', 'src/**/*.js', true],
      ['src/deep/x.js', 'src/*.js', false],
      ['foo', 'f*', true],
      ['foo/bar', '**', true],
    ];
    for (const [p, pattern, expected] of cases) {
      expect(path.matchesGlob(p, pattern), `${p} vs ${pattern}`).toBe(expected);
    }
  });

  it('fs.globSync walks the VFS and respects cwd / exclude / withFileTypes', () => {
    const req = boot();
    // Load `path` *before* `fs` on purpose: this is the order that exposed a
    // load-order bug. `internal/fs/glob` destructures `isAbsolute` from
    // `require('path')` at load time, so if `path` pulled `glob` in while it was
    // still `loading`, glob captured a half-built `path` and globSync threw
    // `isAbsolute is not a function`.
    req('path');
    const fs = req('fs');

    expect(fs.globSync('**/*.js', { cwd: CWD })).toEqual(['index.js', 'src/a.js', 'src/deep/c.js']);
    expect(fs.globSync('**/*.js', { cwd: '/project/src' })).toEqual(['a.js', 'deep/c.js']);
    expect(fs.globSync('src/*.js', { cwd: CWD })).toEqual(['src/a.js']);
    expect(
      fs.globSync('**/*.js', { cwd: CWD, exclude: (p: string) => p.includes('deep') }),
    ).toEqual(['index.js', 'src/a.js']);

    const dirents = fs.globSync('*.js', { cwd: CWD, withFileTypes: true });
    expect(
      dirents.map((d: { name: string; isFile(): boolean; parentPath: string }) =>
        `${d.name}:${d.isFile()}:${d.parentPath}`),
    ).toEqual(['index.js:true:/project']);
  });

  it('fs.glob (callback) and fs.promises.glob (async iterator) agree with globSync', async () => {
    const fs = boot()('fs');

    const viaCallback = await new Promise<string[]>((resolve, reject) => {
      fs.glob('src/*.js', { cwd: CWD }, (err: Error | null, matches?: string[]) =>
        err ? reject(err) : resolve(matches as string[]));
    });
    expect(viaCallback).toEqual(['src/a.js']);

    const viaIterator: string[] = [];
    for await (const entry of fs.promises.glob('**/*.js', { cwd: CWD })) viaIterator.push(entry);
    expect(viaIterator).toEqual(['index.js', 'src/a.js', 'src/deep/c.js']);
  });

  it('exposes the real internal/fs/glob surface', () => {
    const req = boot();
    const glob = req('internal/fs/glob');
    expect(Object.keys(glob).sort()).toEqual(['Glob', 'createMatcher', 'matchGlobPattern']);
    expect(typeof glob.matchGlobPattern).toBe('function');
    expect(typeof req('internal/deps/minimatch/index').Minimatch).toBe('function');
  });
});
