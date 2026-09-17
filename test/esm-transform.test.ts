import { describe, expect, it } from 'vitest';
import { transformEsmToCjs } from '../src/node-runtime/loader/esm-transform';

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
