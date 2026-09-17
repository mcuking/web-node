import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { DEMO_FILES } from '../src/demo-project';

function boot(files: Record<string, string>, entry: string) {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) vfs.mkdir(dir, { recursive: true });
    vfs.writeFile(path, new TextEncoder().encode(content));
  }
  const out: string[] = [];
  const err: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: [entry],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: (c) => err.push(c),
  });
  return {
    vfs,
    out,
    err,
    run: () => {
      try {
        runtime.runMain(entry);
      } catch (e) {
        err.push(String(e));
      }
    },
  };
}

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('require.resolve', () => {
  it('resolves relative, bare and subpath specifiers from the caller', () => {
    const { run, out } = boot(
      {
        '/project/lib/util.js': `module.exports = 1;`,
        '/project/node_modules/tiny/package.json': JSON.stringify({ name: 'tiny', main: 'index.js' }),
        '/project/node_modules/tiny/index.js': `module.exports = 2;`,
        '/project/index.js': `
          const path = require('path');
          console.log('rel  ' + require.resolve('./lib/util.js').replace('/project/', ''));
          console.log('bare ' + require.resolve('tiny').replace('/project/', ''));
          console.log('sub  ' + require.resolve('tiny/package.json').replace('/project/', ''));
        `,
      },
      '/project/index.js',
    );
    run();
    expect(out.join('')).toContain('rel  lib/util.js');
    expect(out.join('')).toContain('bare node_modules/tiny/index.js');
    expect(out.join('')).toContain('sub  node_modules/tiny/package.json');
  });

  it('honours the browser field when resolving', () => {
    const { run, out } = boot(
      {
        '/project/node_modules/dual/package.json': JSON.stringify({
          name: 'dual',
          main: 'lib/node.js',
          browser: 'lib/browser.js',
        }),
        '/project/node_modules/dual/lib/node.js': `module.exports = 1;`,
        '/project/node_modules/dual/lib/browser.js': `module.exports = 2;`,
        '/project/index.js': `console.log(require.resolve('dual').replace('/project/', ''));`,
      },
      '/project/index.js',
    );
    run();
    expect(out.join('')).toBe('node_modules/dual/lib/browser.js\n');
  });
});

describe('demo build script', () => {
  it('explains how to install esbuild-wasm when it is missing', async () => {
    const { run, out } = boot(DEMO_FILES, '/project/build.js');
    run();
    await tick(20);
    expect(out.join('')).toContain('not installed yet');
    expect(out.join('')).not.toContain('build failed');
  });
});
