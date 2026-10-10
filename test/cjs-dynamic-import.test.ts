import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Dynamic `import()` from a **CommonJS** module.
 *
 * Real Node lets CJS call `import()`, and libraries rely on it — Vite's own
 * `index.cjs` entry does `import('./dist/node/index.js')` to expose
 * `build`/`createServer`. Our CJS wrapper is compiled with `new Function`, where
 * V8 rejects `import()` with "A dynamic import callback was not specified"
 * because no import callback is passed, so the loader rewrites a CJS module's
 * `import()` to the same async binding the ESM transform uses.
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

describe('CommonJS dynamic import()', () => {
  it('resolves an ESM module and gives back its namespace', async () => {
    const { runtime, out } = boot(
      `(async function () {\n` +
        `  const m = await import('./mod.mjs');\n` +
        `  console.log('KEYS ' + Object.keys(m).sort().join(','));\n` +
        `  console.log('A ' + m.a);\n` +
        `})();\n`,
      { '/project/mod.mjs': 'export const a = 42;\nexport const b = 7;\n' },
    );
    await runtime.drain();
    const text = out.join('');
    expect(text, text).not.toContain('ERR:');
    expect(text).toContain('KEYS a,b');
    expect(text).toContain('A 42');
  });

  it('uses the `import` exports condition (not `require`)', async () => {
    const { runtime, out } = boot(
      `(async function () {\n` +
        `  const m = await import('p');\n` +
        `  console.log('WHICH ' + m.which);\n` +
        `})();\n`,
      {
        '/project/node_modules/p/package.json': JSON.stringify({
          name: 'p',
          version: '1.0.0',
          exports: { '.': { import: './i.mjs', require: './r.cjs' } },
        }),
        '/project/node_modules/p/i.mjs': "export const which = 'import';\n",
        '/project/node_modules/p/r.cjs': "module.exports = { which: 'require' };\n",
      },
    );
    await runtime.drain();
    const text = out.join('');
    expect(text, text).not.toContain('ERR:');
    expect(text).toContain('WHICH import');
  });

  it('leaves `import(` inside strings, comments and regexes untouched', async () => {
    const { runtime, out } = boot(
      `const s = "import('./nope.js')";\n` +
        `// import('./nope.js')\n` +
        `const re = /import\\(/;\n` +
        `console.log('STR ' + s);\n` +
        `console.log('RE ' + re.test("import("));\n`,
    );
    await runtime.drain();
    const text = out.join('');
    expect(text, text).not.toContain('ERR:');
    expect(text).toContain("STR import('./nope.js')");
    expect(text).toContain('RE true');
  });
});
