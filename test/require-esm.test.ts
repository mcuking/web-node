import { describe, expect, it } from 'vitest';
import oracle from './fixtures/require-esm.json';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `require()` of an ES module (Node >= 22.12).
 *
 * The shape handed back is the part that matters: `populateCJSExportsFromESM`
 * in Node's `lib/internal/modules/cjs/loader.js` gives consumers a *module
 * namespace*, not the raw exports object. Transpiled consumers
 * (`_interopRequireDefault` and friends) branch on `__esModule`, so getting the
 * presence of that key wrong silently picks the wrong binding — a module with a
 * default must carry it, a module without one must not.
 *
 * `test/fixtures/require-esm.json` is the oracle: the report Node v26.9.0
 * produces for these exact six modules. The test runs the same program here and
 * compares field by field.
 */

const ORACLE = oracle as Record<
  string,
  { keys: string[]; tag: string; hasEsm: boolean; esm?: boolean }
>;

const MODULES: Record<string, string> = {
  'no-default': "export const a = 1;\nexport function f(){ return 'f'; }\n",
  'with-default': "export const a = 1;\nexport default function d(){ return 'd'; }\n",
  star: "export * from './inner.mjs';\n",
  inner: 'export const xi = 9;\n',
  'reexport-default': "export { default } from './with-default.mjs';\n",
  'es-module-tag': 'export const __esModule = false;\nexport const a = 1;\n',
};

function boot(program: string, extra: Record<string, string> = {}): { runtime: NodeRuntime; out: string[] } {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project/mods', { recursive: true });
  for (const [name, text] of Object.entries({ ...MODULES, ...extra })) {
    vfs.writeFile(`/project/mods/${name}.mjs`, new TextEncoder().encode(text));
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

describe('require(esm)', () => {
  it('hands back a Module namespace that matches Node', async () => {
    const { runtime, out } = boot(`
      const names = ${JSON.stringify(Object.keys(MODULES))};
      const report = {};
      for (const name of names) {
        const m = require('/project/mods/' + name + '.mjs');
        report[name] = {
          keys: Object.keys(m),
          tag: Object.prototype.toString.call(m),
          hasEsm: Object.prototype.hasOwnProperty.call(m, '__esModule'),
          esm: m.__esModule,
        };
      }
      console.log(JSON.stringify(report));
    `);
    await runtime.drain();
    expect(out.join(''), out.join('')).not.toContain('ERR:');
    const report = JSON.parse(out.join('').trim()) as typeof ORACLE;

    // Deep compare against Node. `JSON.parse` cannot produce an `undefined`
    // value, so for the no-default modules where Node's report omits `esm`, the
    // page's report must omit it too — exactly what `toEqual` checks.
    expect(report).toEqual(ORACLE);

    // And spell out the two branches that interop hinges on, so a regression
    // reads clearly even before the diff.
    expect(report['no-default'].tag).toBe('[object Module]');
    expect(report['no-default'].hasEsm).toBe(false);
    expect(report['with-default'].keys).toEqual(['__esModule', 'a', 'default']);
    expect(report['with-default'].esm).toBe(true);
    expect(report['es-module-tag'].esm).toBe(false);
  });

  it('returns the same namespace object on every require (module cache)', async () => {
    const { runtime, out } = boot(`
      const a = require('/project/mods/inner.mjs');
      const b = require('/project/mods/inner.mjs');
      console.log('SAME ' + (a === b));
    `);
    await runtime.drain();
    expect(out.join('')).toContain('SAME true');
  });

  it('throws ERR_REQUIRE_ASYNC_MODULE for a top-level-await graph', async () => {
    const { runtime, out } = boot(
      `
      try {
        require('/project/mods/tla.mjs');
        console.log('NO_THROW');
      } catch (err) {
        console.log('CODE ' + err.code);
        console.log('MSG ' + err.message.split('\\n')[0]);
      }
    `,
      { tla: 'await Promise.resolve();\nexport const y = 1;\n' },
    );
    await runtime.drain();
    const text = out.join('');
    expect(text).toContain('CODE ERR_REQUIRE_ASYNC_MODULE');
    expect(text).toContain(
      'require() cannot be used on an ESM graph with top-level await. Use import() instead.',
    );
  });
});
