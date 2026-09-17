/**
 * A deliberately small ESM→CJS transformer.
 *
 * Scope (MVP): static top-level `import` / `export` statements in user files.
 * Out of scope: top-level await, live bindings, circular ESM edge cases,
 * `import.meta.resolve`. Anything we cannot transform throws loudly at runtime
 * (the loader surfaces a clear message) rather than silently misbehaving.
 */

let counter = 0;
function uid(prefix: string): string {
  return `__wn_${prefix}_${counter++}`;
}

export interface TransformResult {
  code: string;
  /** Ids imported by this module (so the loader can record edges). */
  imports: string[];
}

const RE_IMPORT_NAMED = /^import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2\s*;?/;
const RE_IMPORT_BARE = /^import\s+(['"])([^'"]+)\1\s*;?/;

function transformNamedSpecifiers(spec: string): string {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      return m ? `${m[1]}: ${m[2]}` : s;
    })
    .join(', ');
}

export function transformEsmToCjs(source: string, moduleUrl: string): TransformResult {
  const imports: string[] = [];
  const lines = source.split('\n');
  const out: string[] = [];
  const pendingExports: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    // --- import statements -------------------------------------------------
    const named = trimmed.match(RE_IMPORT_NAMED);
    if (named && trimmed.startsWith('import ')) {
      const clause = named[1];
      const mod = named[3];
      imports.push(mod);
      const tmp = uid('m');
      const parts: string[] = [];
      let rest = clause.trim();
      const defMatch = rest.match(/^([A-Za-z_$][\w$]*)\s*(?:,([\s\S]*))?$/);
      let nsMatch: RegExpMatchArray | null = null;
      let namedBlock: RegExpMatchArray | null = null;
      if (rest.startsWith('*')) {
        nsMatch = rest.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
      } else if (rest.startsWith('{')) {
        namedBlock = rest.match(/^\{([\s\S]*)\}$/);
      } else if (defMatch) {
        parts.push(`${defMatch[1]} = __wnDefault(${tmp})`);
        rest = (defMatch[2] ?? '').trim();
        if (rest.startsWith('*')) nsMatch = rest.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
        else if (rest.startsWith('{')) namedBlock = rest.match(/^\{([\s\S]*)\}$/);
      }
      out.push(`const ${tmp} = require(${JSON.stringify(mod)});`);
      if (nsMatch) parts.push(`${nsMatch[1]} = ${tmp}`);
      if (namedBlock) parts.push(`{ ${transformNamedSpecifiers(namedBlock[1])} } = ${tmp}`);
      if (parts.length > 0) out.push(`const ${parts.join(', ')};`);
      continue;
    }

    const bare = trimmed.match(RE_IMPORT_BARE);
    if (bare && trimmed.startsWith('import ')) {
      imports.push(bare[2]);
      out.push(`require(${JSON.stringify(bare[2])});`);
      continue;
    }

    // --- export ... from 'mod' --------------------------------------------
    const exportFrom = trimmed.match(/^export\s+([\s\S]+?)\s+from\s+(['"])([^'"]+)\2\s*;?$/);
    if (exportFrom) {
      const clause = exportFrom[1].trim();
      const mod = exportFrom[3];
      imports.push(mod);
      if (clause === '*') {
        out.push(`Object.assign(exports, require(${JSON.stringify(mod)}));`);
      } else if (/^\*\s+as\s+/.test(clause)) {
        const name = clause.replace(/^\*\s+as\s+/, '');
        out.push(`exports.${name} = require(${JSON.stringify(mod)});`);
      } else {
        const block = clause.match(/^\{([\s\S]*)\}$/);
        if (block) {
          const pairs = transformNamedSpecifiers(block[1]);
          out.push(`const __from = require(${JSON.stringify(mod)});`);
          out.push(`Object.assign(exports, { ${pairs} });`);
        }
      }
      continue;
    }

    // --- export default ----------------------------------------------------
    if (/^export\s+default\s+/.test(trimmed)) {
      const body = trimmed.replace(/^export\s+default\s+/, '');
      if (/^(async\s+)?function\b/.test(body) || /^class\b/.test(body)) {
        out.push(body.replace(/^(async\s+)?(function|class)\s*/, (m) => m + ' ').replace(/^(async\s+)?function(\s+\w+)?/, (_m, a, n) => `${a ?? ''}function${n ?? ''}`));
        out.push('exports.default = typeof ' + (body.match(/(?:function|class)\s+([A-Za-z_$][\w$]*)/)?.[1] ?? 'undefined') + " === 'undefined' ? undefined : " + (body.match(/(?:function|class)\s+([A-Za-z_$][\w$]*)/)?.[1] ?? 'undefined') + ';');
      } else {
        out.push(`exports.default = ${body.replace(/;$/, '')};`);
      }
      continue;
    }

    // --- export { a, b as c } ---------------------------------------------
    const exportBlock = trimmed.match(/^export\s*\{([\s\S]*)\}\s*;?$/);
    if (exportBlock) {
      const pairs = exportBlock[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const m = s.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
          return m ? `exports.${m[2]} = ${m[1]};` : `exports.${s} = ${s};`;
        })
        .join(' ');
      out.push(pairs);
      continue;
    }

    // --- export declarations ----------------------------------------------
    const decl = trimmed.match(/^export\s+(const|let|var|async\s+function|function|class)\s+([\s\S]*)$/);
    if (decl) {
      const kind = decl[1];
      const rest = decl[2];
      out.push(`${kind} ${rest}`.replace(/^async\s+function/, 'async function'));
      pendingExports.push(rest);
      continue;
    }

    out.push(line);
  }

  // Emit `exports.x = x` for each declared binding.
  const exportLines: string[] = [];
  for (const rest of pendingExports) {
    if (/^(async\s+)?function/.test(rest) || /^class/.test(rest)) {
      const name = rest.match(/^(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/)?.[1];
      if (name) exportLines.push(`exports.${name} = ${name};`);
    } else {
      // const a = 1, b = 2;
      const decls = rest.replace(/;?\s*$/, '').split(',');
      for (const d of decls) {
        const name = d.match(/^\s*([A-Za-z_$][\w$]*)/)?.[1];
        if (name) exportLines.push(`exports.${name} = ${name};`);
      }
    }
  }

  const header =
    `Object.defineProperty(exports, '__esModule', { value: true });\n` +
    `function __wnDefault(m) { return (m && m.__esModule) ? m.default : m; }\n` +
    `const __mod_url = ${JSON.stringify(moduleUrl)};\n`;
  return { code: header + out.join('\n') + '\n' + exportLines.join('\n'), imports };
}
