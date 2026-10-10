import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `require.cache` and `require.extensions` on the CommonJS wrapper.
 *
 * Node's `require` carries both (`require.cache === Module._cache`,
 * `require.extensions === Module._extensions`), and bundled tooling reads them.
 * Vite's `@dcloudio/vite-plugin-uni` does exactly this before instantiating the
 * Vue plugin:
 *
 *   delete require.cache[require.resolve('@vitejs/plugin-vue')];
 *
 * With no `require.cache` that is `delete undefined[...]`, which throws
 * "Cannot convert undefined or null to object" and aborts the whole build. The
 * fix gives the wrapper a `cache` that is a *live view* of the loader's module
 * cache, so a `delete` really evicts.
 */

function boot(program: string, files: Record<string, string> = {}): { runtime: NodeRuntime; out: string[] } {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir) vfs.mkdir(dir, { recursive: true });
    vfs.writeFile(path, new TextEncoder().encode(text));
  }
  vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
  const out: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (chunk) => out.push(chunk),
    onStderr: (chunk) => out.push('ERR:' + chunk),
  });
  runtime.runMain('/project/index.js');
  return { runtime, out };
}

describe('require.cache / require.extensions', () => {
  it('exposes both as objects (like Node)', async () => {
    const { runtime, out } = boot(
      `console.log('CACHE ' + typeof require.cache);\n` +
        `console.log('EXT ' + typeof require.extensions);\n` +
        `console.log('RESOLVE ' + typeof require.resolve);\n`,
    );
    await runtime.drain();
    const text = out.join('');
    expect(text, text).not.toContain('ERR:');
    expect(text).toContain('CACHE object');
    expect(text).toContain('EXT object');
    expect(text).toContain('RESOLVE function');
  });

  it('is cached by require(), and delete require.cache[…] really evicts', async () => {
    const { runtime, out } = boot(
      `const a = require('/project/count.js');\n` +
        `const b = require('/project/count.js');\n` +
        `console.log('SAME ' + (a === b) + ' val=' + a);\n` +
        `delete require.cache[require.resolve('/project/count.js')];\n` +
        `const c = require('/project/count.js');\n` +
        `console.log('AFTER ' + c);\n`,
      { '/project/count.js': 'globalThis.__evaluations = (globalThis.__evaluations || 0) + 1;\nmodule.exports = globalThis.__evaluations;\n' },
    );
    await runtime.drain();
    const text = out.join('');
    expect(text, text).not.toContain('ERR:');
    // First two requires share the cached module (evaluated once)…
    expect(text).toContain('SAME true val=1');
    // …and deleting from the cache forces a re-evaluation.
    expect(text).toContain('AFTER 2');
  });

  it('lists loaded modules through require.cache keys', async () => {
    const { runtime, out } = boot(
      `require('/project/count.js');\n` +
        `console.log('HAS ' + Object.prototype.hasOwnProperty.call(require.cache, require.resolve('/project/count.js')));\n`,
      { '/project/count.js': 'module.exports = 1;\n' },
    );
    await runtime.drain();
    const text = out.join('');
    expect(text, text).not.toContain('ERR:');
    expect(text).toContain('HAS true');
  });
});
