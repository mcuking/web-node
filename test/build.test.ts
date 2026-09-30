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

describe('demo projects', () => {
  it('ships one self-contained directory per project', () => {
    const { run, out } = boot(
      {
        ...DEMO_FILES,
        '/project/list.js': `
          const fs = require('fs');
          const has = (p) => fs.existsSync(p);
          console.log('vite     ' + has('/project/vite/src/App.vue') + ' ' + has('/project/vite/index.html'));
          console.log('vitecfg  ' + has('/project/vite/vite.config.mjs'));
          console.log('webpack  ' + has('/project/webpack/src/index.js') + ' ' + has('/project/webpack/webpack.config.mjs'));
          console.log('rspack   ' + has('/project/rspack/src/main.mjs') + ' ' + has('/project/rspack/webnode-binding.cjs'));
          console.log('node     ' + has('/project/node/index.js') + ' ' + has('/project/node/lib/report.js'));
        `,
      },
      '/project/list.js',
    );
    run();
    expect(out.join('')).toContain('vite     true true');
    expect(out.join('')).toContain('vitecfg  true');
    expect(out.join('')).toContain('webpack  true true');
    expect(out.join('')).toContain('rspack   true true');
    expect(out.join('')).toContain('node     true true');
  });

  it('explains how to install vite when it is missing', async () => {
    const { run, out } = boot(DEMO_FILES, '/project/vite/build.mjs');
    run();
    await tick(20);
    expect(out.join('')).toContain('not installed yet');
    expect(out.join('')).not.toContain('failed');
  });

  it('explains how to install the vite dev server when it is missing', async () => {
    const { run, out } = boot(DEMO_FILES, '/project/vite/dev.mjs');
    run();
    await tick(20);
    expect(out.join('')).toContain('not installed yet');
  });

  it('explains how to install webpack when it is missing', async () => {
    const { run, out } = boot(DEMO_FILES, '/project/webpack/build.mjs');
    run();
    await tick(20);
    expect(out.join('')).toContain('not installed yet');
    expect(out.join('')).not.toContain('failed');
  });

  it('explains how to install rspack when it is missing', async () => {
    const { run, out } = boot(DEMO_FILES, '/project/rspack/build.mjs');
    run();
    await tick(20);
    expect(out.join('')).toContain('not installed yet');
    expect(out.join('')).not.toContain('failed');
  });
});

describe('fs/promises, perf_hooks and url builtins', () => {
  it('exposes fs/promises with the same functions as fs.promises', () => {
    const { run, out } = boot(
      {
        '/project/index.js': `
          const fsp = require('fs/promises');
          const fs = require('fs');
          console.log('same ' + (fsp === fs.promises));
          console.log('types ' + [typeof fsp.readFile, typeof fsp.writeFile, typeof fsp.stat, typeof fsp.mkdir].join(','));
        `,
      },
      '/project/index.js',
    );
    run();
    expect(out.join('')).toContain('same true');
    expect(out.join('')).toContain('types function,function,function,function');
  });

  it('exposes perf_hooks.performance and url helpers', () => {
    const { run, out } = boot(
      {
        '/project/index.js': `
          const perf = require('perf_hooks');
          const url = require('url');
          console.log('now ' + (typeof perf.performance.now()));
          console.log('toPath ' + url.fileURLToPath('file:///project/dist/app.esm.js'));
          console.log('toURL ' + url.pathToFileURL('/project/a b.js').href);
        `,
      },
      '/project/index.js',
    );
    run();
    expect(out.join('')).toContain('now number');
    expect(out.join('')).toContain('toPath /project/dist/app.esm.js');
    expect(out.join('')).toContain('toURL file:///project/a%20b.js');
  });

  it('does not inject host-identical globals into CommonJS wrappers', () => {
    // A module may declare its own top-level `const btoa`; injecting the host
    // btoa as a wrapper parameter would collide ("already been declared").
    const { run, out } = boot(
      {
        '/project/index.js': `
          const btoa = function (s) { return 'mine:' + s; };
          const performance = { now: function () { return 1; } };
          console.log(btoa('x') + ' ' + performance.now());
        `,
      },
      '/project/index.js',
    );
    run();
    expect(out.join('')).toBe('mine:x 1\n');
  });
});
