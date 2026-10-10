import { describe, expect, it } from 'vitest';
import { transformEsmToCjs, rewriteCjsDynamicImport } from '../src/node-runtime/loader/esm-transform';

const run = (src: string) => transformEsmToCjs(src, 'file:///mod.js').code;

describe('esm-transform — import.meta rewrite is code-only', () => {
  it('leaves "import.meta" inside string literals untouched', () => {
    // Regression: Vite ships `rawUrl === "import.meta"` as data. A blind regex
    // rewrote the literal, flipped the comparison to false, and disabled HMR.
    const code = run(`const s = 'import.meta';\nif (rawUrl === "import.meta") { hit(); }\n`);
    expect(code).toContain(`'import.meta'`);
    expect(code).toContain(`"import.meta"`);
  });

  it('leaves import.meta inside comments and regexes untouched', () => {
    const code = run(`// see import.meta.url\nconst re = /import\\.meta\\b/;\n`);
    expect(code).toContain('// see import.meta.url');
    expect(code).toContain('/import\\.meta\\b/');
  });

  it('rewrites real import.meta references to the header bindings', () => {
    const code = run(`const u = import.meta.url;\nconst d = import.meta.dirname;\nconst f = import.meta.filename;\nconst h = import.meta.hot;\n`);
    expect(code).toContain('const u = __mod_url;');
    expect(code).toContain('const d = __mod_dir;');
    expect(code).toContain('const f = __mod_file;');
    expect(code).toContain('const h = ({ url: __mod_url }).hot;');
  });

  it('rewrites code inside template-literal interpolations but not raw text', () => {
    const code = run('const t = `raw import.meta ${import.meta.url} end`;\n');
    expect(code).toContain('`raw import.meta ');
    expect(code).toContain('${__mod_url}');
  });

  it('still routes dynamic import() to the async loader', () => {
    const code = run(`const m = import('./x.js');\n`);
    expect(code).toContain('__wn_import(');
  });
});

describe('esm-transform — CommonJS dynamic import() rewrite', () => {
  // A CJS module may legally call `import()` (Vite's own `index.cjs` does). The
  // CJS wrapper is compiled with `new Function`, where V8 rejects `import()`
  // with "A dynamic import callback was not specified".
  it('rewrites a CJS `import()` call to the async loader binding', () => {
    expect(rewriteCjsDynamicImport(`const m = import('./x.js');\n`)).toContain('__wn_import(');
  });

  it('leaves `import(` inside strings and comments untouched', () => {
    const code = rewriteCjsDynamicImport(`const s = "import(.js)";\n// import(commented)\n`);
    expect(code).toContain('"import(.js)"');
    expect(code).toContain('// import(commented)');
  });

  it('does not rewrite `import.meta` (invalid in CJS, so the compiler must reject it)', () => {
    expect(rewriteCjsDynamicImport(`const u = import.meta.url;\n`)).toContain('import.meta.url');
  });

  it('keeps the line break of a call split across lines', () => {
    const code = rewriteCjsDynamicImport(`const m = import\n  ('./x.js');\n`);
    expect(code.split('\n').length).toBe(3);
    expect(code).toContain('__wn_import');
  });
});

describe('esm-transform — string-literal module export names (ES2022)', () => {
  // @rspack/core ships `export { src_rspack as "module.exports", … }`; the
  // specifier used to fall through to `${EX}.${s} = ${s}`, which left the `as`
  // token in place and failed to compile.
  it('rewrites `x as "name"` in an export clause to a computed property', () => {
    const code = run(`const foo = 1;\nexport { foo as "module.exports" };\n`);
    expect(code).toContain('__wn_exports["module.exports"] = foo;');
    expect(code).not.toContain('as "module.exports"');
  });

  it('handles string names alongside plain and `as` entries in one clause', () => {
    const code = run(`const a = 1, b = 2;\nexport { a, b as c, a as "a b" };\n`);
    expect(code).toContain('__wn_exports.a = a;');
    expect(code).toContain('__wn_exports.c = b;');
    expect(code).toContain('__wn_exports["a b"] = a;');
  });

  it('supports string names across a multi-line export block', () => {
    const code = run(`const a = 1, b = 2;\nexport {\n  a,\n  b as "b c",\n};\n`);
    expect(code).toContain('__wn_exports.a = a;');
    expect(code).toContain('__wn_exports["b c"] = b;');
  });

  it('supports a string imported name in an import clause', () => {
    const code = run(`import { "a b" as ab } from './m.js';\n`);
    expect(code).toContain('"a b": ab');
    expect(code).not.toContain('as ab');
  });

  it('supports string names in a re-export clause', () => {
    const code = run(`export { a as "a b" } from './m.js';\n`);
    expect(code).toContain('"a b":');
    expect(code).not.toContain('as "a b"');
  });

  it('supports a string namespace name on `export * as`', () => {
    const code = run(`export * as "ns x" from './m.js';\n`);
    expect(code).toContain('__wn_exports["ns x"] =');
    expect(code).not.toContain('as "ns x"');
  });
});
