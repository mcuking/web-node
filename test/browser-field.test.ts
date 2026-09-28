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

/**
 * `browser` field handling.
 *
 * Only the **string** form is honoured: it selects which *build* of a package to
 * load, which is what lets a Node-only `main` (esbuild-wasm spawns child
 * processes) resolve to its browser build.
 *
 * The **object** form is a bundler substitution table — it swaps the package's
 * own files or Node builtins for browser variants, on the assumption that a
 * browser has no `fs`/`os`/`path`. This runtime provides those builtins, and real
 * Node ignores `browser` entirely, so the table is deliberately not applied.
 */
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

  it('ignores an object map: the real Node file loads, not the browser variant', () => {
    // Bundlers pick `./browser.js`; Node (and this runtime) pick `./node.js`.
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
    expect(out.join('')).toBe('node\n');
  });

  it('does not drop a provided builtin the object map lists as false', () => {
    // TypeScript declares exactly `{ "fs": false, "os": false, "path": false, … }`
    // yet its loader calls `os.platform()`. Honouring the table would hand it `{}`.
    const { run, out } = boot({
      '/project/node_modules/shiny/package.json': JSON.stringify({
        name: 'shiny',
        main: 'index.js',
        browser: { fs: false, os: false, path: false },
      }),
      '/project/node_modules/shiny/index.js': [
        `const fs = require('fs');`,
        `const os = require('os');`,
        `const path = require('path');`,
        `module.exports = [typeof fs.readFileSync, typeof os.platform, typeof path.join].join('/');`,
      ].join('\n'),
      '/project/index.js': `console.log(require('shiny'));`,
    });
    run();
    expect(out.join('')).toBe('function/function/function\n');
  });

  it('does not stub a false bare specifier — Node would refuse it too', () => {
    // Neither `browser` nor the bundler's empty module applies: the runtime
    // provides no `nodereport`, so the require fails exactly as it does on real
    // Node (MODULE_NOT_FOUND), rather than silently yielding `{}`.
    const { run, out } = boot({
      '/project/node_modules/telemetry/package.json': JSON.stringify({
        name: 'telemetry',
        main: 'index.js',
        browser: { nodereport: false },
      }),
      '/project/node_modules/telemetry/index.js': `module.exports = require('nodereport');`,
      '/project/index.js': [
        `try { require('telemetry'); console.log('no-throw'); }`,
        `catch (e) { console.log('threw:' + e.code); }`,
      ].join('\n'),
    });
    run();
    expect(out.join('')).toBe('threw:MODULE_NOT_FOUND\n');
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
