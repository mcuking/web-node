import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

function boot(files: Record<string, string>, entry = '/project/index.js') {
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
  const run = () => {
    try {
      runtime.runMain(entry);
    } catch {
      /* asserted via output */
    }
  };
  return { runtime, vfs, out, err, run };
}

describe('package.json "browser" field', () => {
  it('redirects a string browser entry away from the Node main', () => {
    const { run, out } = boot({
      '/project/node_modules/dual/package.json': JSON.stringify({
        name: 'dual',
        main: 'lib/node.js',
        browser: 'lib/browser.js',
      }),
      '/project/node_modules/dual/lib/node.js': `module.exports = 'node';`,
      '/project/node_modules/dual/lib/browser.js': `module.exports = 'browser';`,
      '/project/index.js': `console.log(require('dual'));`,
    });
    run();
    expect(out.join('')).toBe('browser\n');
  });

  it('honours an object browser map (relative file replacement)', () => {
    const { run, out } = boot({
      '/project/node_modules/dual/package.json': JSON.stringify({
        name: 'dual',
        main: 'index.js',
        browser: { './node.js': './browser.js' },
      }),
      '/project/node_modules/dual/index.js': `module.exports = require('./node.js');`,
      '/project/node_modules/dual/node.js': `module.exports = 'node';`,
      '/project/node_modules/dual/browser.js': `module.exports = 'browser';`,
      '/project/index.js': `console.log(require('dual'));`,
    });
    run();
    expect(out.join('')).toBe('browser\n');
  });

  it('maps a dropped Node builtin (browser: false) to an empty module', () => {
    const { run, out } = boot({
      '/project/node_modules/shiny/package.json': JSON.stringify({
        name: 'shiny',
        main: 'index.js',
        browser: { fs: false },
      }),
      '/project/node_modules/shiny/index.js': `module.exports = typeof require('fs').readFileSync;`,
      '/project/index.js': `console.log(require('shiny'));`,
    });
    run();
    expect(out.join('')).toBe('undefined\n');
  });

  it('leaves packages without a browser field on their main entry', () => {
    const { run, out } = boot({
      '/project/node_modules/plain/package.json': JSON.stringify({ name: 'plain', main: 'main.js' }),
      '/project/node_modules/plain/main.js': `module.exports = 'plain';`,
      '/project/index.js': `console.log(require('plain'));`,
    });
    run();
    expect(out.join('')).toBe('plain\n');
  });
});
