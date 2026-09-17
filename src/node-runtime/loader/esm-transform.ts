/**
 * A deliberately small ESM→CJS transformer.
 *
 * Scope: static top-level `import` / `export` statements in user files.
 * Out of scope: top-level await, live bindings, circular ESM edge cases,
 * `import.meta.resolve`. Anything we cannot transform throws loudly at runtime
 * (the loader surfaces a clear message) rather than silently misbehaving.
 *
 * It works statement-by-statement, not line-by-line: a bundled dependency like
 * Vite contains multi-line imports and multi-line template literals, and a
 * naive line split would shred both. `splitStatements()` is a small scanner that
 * tracks strings, template literals (including nested `${…}`), comments, regex
 * literals and bracket depth, so only genuine top-level statements are touched.
 *
 * The generated code refers to injected bindings via `__wn_*` names rather than
 * `exports`/`require`. Real ESM modules may declare their own `require`
 * (`const require = createRequire(import.meta.url)`, as Vite's chunks do), and
 * a parameter of the same name would be a redeclaration error.
 */

let counter = 0;
function uid(prefix: string): string {
  return `__wn_${prefix}_${counter++}`;
}

/** Injected binding names for the CommonJS wrapper parameters. */
export const EXPORTS_BINDING = '__wn_exports';
export const REQUIRE_BINDING = '__wn_require';
/** Async loader backing rewritten dynamic `import()` expressions. */
export const IMPORT_BINDING = '__wn_import';

export interface TransformResult {
  code: string;
  /** Ids imported by this module (so the loader can record edges). */
  imports: string[];
}

const EX = EXPORTS_BINDING;
const RQ = REQUIRE_BINDING;

/**
 * Split source into top-level statements, preserving everything (whitespace,
 * comments) between them. A boundary is a `;` at bracket depth 0, or a `}` that
 * closes a top-level block.
 */
export function splitStatements(src: string): string[] {
  const parts: string[] = [];
  const n = src.length;
  let start = 0;
  let i = 0;
  // Frame stack: base code frame plus one per template-literal `${ … }`.
  const frames: Array<{ depth: number; templateExpr: boolean }> = [{ depth: 0, templateExpr: false }];
  let lastSig = '';
  // The last identifier seen, so a `/` after a keyword (`return /re/`) is read as
  // a regex while a `/` after a plain identifier (`a / b`) is read as division.
  // Getting this wrong desyncs the bracket depth for the rest of the file.
  let lastWord = '';

  const pushStatement = (end: number): void => {
    if (end > start) parts.push(src.slice(start, end));
    start = end;
  };

  // A `}` that closes a bracket can mean "end of statement" (a function/class/
  // control-flow block written without a trailing `;`) or merely "end of an
  // object literal / call argument". Only the former terminates a statement, and
  // the difference is whether the statement *began* with a block keyword.
  const BLOCK_START =
    /^(?:export\s+default\s+|export\s+)?(?:async\s+function|function|class|if|for|while|switch|try|do|with)\b/;
  const endsWithBlock = (upTo: number): boolean => BLOCK_START.test(src.slice(start, upTo).trimStart());

  const REGEX_PRECEDING = '(,=:[!&|?{};+-*%~^<>';
  const REGEX_KEYWORDS = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'do', 'else', 'yield', 'await', 'case', 'throw',
  ]);
  const regexAllowed = (): boolean => {
    if (lastSig === '') return true;
    if (/[A-Za-z0-9_$]/.test(lastSig)) return REGEX_KEYWORDS.has(lastWord);
    return REGEX_PRECEDING.includes(lastSig);
  };

  while (i < n) {
    const frame = frames[frames.length - 1];
    const ch = src[i];

    // --- template literal body -------------------------------------------------
    if (frame.templateExpr === false && frames.length > 1) {
      // We are inside a template literal's raw text.
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        frames.pop();
        lastSig = '`';
        lastWord = '';
        i++;
        continue;
      }
      if (ch === '$' && src[i + 1] === '{') {
        frames.push({ depth: 0, templateExpr: true });
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // --- code context ----------------------------------------------------------
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        if (src[i] === '\n' && quote === "'") break;
        i++;
      }
      lastSig = quote;
      lastWord = '';
      continue;
    }
    if (ch === '`') {
      frames.push({ depth: 0, templateExpr: false });
      lastSig = '`';
      lastWord = '';
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      // Regex literal: scan to the closing unescaped `/` on the same line.
      i++;
      let inClass = false;
      while (i < n) {
        const c = src[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '\n') break;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { i++; break; }
        i++;
      }
      while (i < n && /[a-z]/i.test(src[i])) i++;
      lastSig = '/';
      lastWord = '';
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      frame.depth++;
      lastSig = ch;
      lastWord = '';
      i++;
      continue;
    }
    if (ch === ')' || ch === ']') {
      frame.depth--;
      lastSig = ch;
      lastWord = '';
      i++;
      continue;
    }
    if (ch === '}') {
      if (frame.depth > 0) {
        const closingTopBlock = frame.depth === 1 && frames.length === 1 && endsWithBlock(i);
        frame.depth--;
        lastSig = ch;
        lastWord = '';
        i++;
        if (closingTopBlock) pushStatement(i);
        continue;
      }
      if (frame.templateExpr) {
        frames.pop();
        lastSig = '}';
        lastWord = '';
        i++;
        continue;
      }
      i++;
      pushStatement(i);
      lastSig = '}';
      lastWord = '';
      continue;
    }

    if (ch === ';' && frame.depth === 0) {
      i++;
      pushStatement(i);
      lastSig = ';';
      lastWord = '';
      continue;
    }

    // A new top-level `export` / `import` keyword always starts a statement.
    // Without this, the previous statement (which may end without a `;`, e.g. a
    // function declaration) would swallow the `export` and leave it untransformed.
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if ((word === 'export' || word === 'import') && frame.depth === 0 && frames.length === 1) {
        let k = j;
        while (k < n && /\s/.test(src[k])) k++;
        const next = src[k];
        // `import(` / `import.meta` are expressions, not statement starts.
        const isStatement = !(word === 'import' && (next === '(' || next === '.'));
        if (isStatement && src.slice(start, i).trim() !== '') pushStatement(i);
      }
      lastSig = src[j - 1];
      lastWord = word;
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxX._]/.test(src[j])) j++;
      lastSig = src[j - 1];
      lastWord = '';
      i = j;
      continue;
    }

    if (!/\s/.test(ch)) {
      lastSig = ch;
      lastWord = '';
    }
    i++;
  }
  pushStatement(n);
  return parts;
}

const RE_IMPORT_NAMED = /^import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/;
const RE_IMPORT_BARE = /^import\s+(['"])([^'"]+)\1/;
const RE_IMPORT_ATTRS = /\s+(?:assert|with)\s*\{[\s\S]*\}$/;

function stripAttrs(text: string): string {
  return text.replace(RE_IMPORT_ATTRS, '');
}

/**
 * Strip leading whitespace and comments so detection can test `startsWith`
 * against real syntax. Bundled dependencies put licence banners before the first
 * `import`, which would otherwise hide it (`startsWith('import ')` → false).
 */
function leadTrim(s: string): string {
  let t = s.replace(/^\s+/, '');
  for (;;) {
    if (t.startsWith('//')) {
      const nl = t.indexOf('\n');
      t = nl < 0 ? '' : t.slice(nl + 1).replace(/^\s+/, '');
      continue;
    }
    if (t.startsWith('/*')) {
      const end = t.indexOf('*/');
      t = end < 0 ? '' : t.slice(end + 2).replace(/^\s+/, '');
      continue;
    }
    break;
  }
  return t;
}

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

/**
 * Blank out the *contents* of string literals, template raw text, comments and
 * regex literals, keeping the length identical, so a syntax rewrite can be
 * applied to real code only.
 *
 * Why this exists: the `import.meta` / `import()` rewrite used to run as a plain
 * regex over the whole bundle, which also mutated *data*. A dependency that ships
 * the literal `import.meta` (Vite does: `if (rawUrl === "import.meta")`) had that
 * string rewritten too, silently turning the comparison false and disabling the
 * HMR hot-context injection. Length-preserving masking keeps every index in the
 * original string valid, so edit positions line up 1:1.
 *
 * The token rules mirror `splitStatements` (strings, nested `${…}`, comments,
 * regex-vs-division) because getting the last two wrong desyncs everything after.
 */
function codeMask(src: string): Uint8Array {
  const n = src.length;
  const mask = new Uint8Array(n).fill(1);
  const frames: Array<{ depth: number; templateExpr: boolean }> = [{ depth: 0, templateExpr: false }];
  let lastSig = '';
  let lastWord = '';
  const REGEX_PRECEDING = '(,=:[!&|?{};+-*%~^<>';
  const REGEX_KEYWORDS = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'do', 'else', 'yield', 'await', 'case', 'throw',
  ]);
  const regexAllowed = (): boolean => {
    if (lastSig === '') return true;
    if (/[A-Za-z0-9_$]/.test(lastSig)) return REGEX_KEYWORDS.has(lastWord);
    return REGEX_PRECEDING.includes(lastSig);
  };
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) mask[k] = 0;
  };

  let i = 0;
  while (i < n) {
    const frame = frames[frames.length - 1];
    const ch = src[i];

    if (frame.templateExpr === false && frames.length > 1) {
      if (ch === '\\') {
        blank(i, i + 1);
        i += 2;
        continue;
      }
      if (ch === '`') {
        frames.pop();
        lastSig = '`';
        lastWord = '';
        i++;
        continue;
      }
      if (ch === '$' && src[i + 1] === '{') {
        blank(i, i + 1);
        frames.push({ depth: 0, templateExpr: true });
        i += 2;
        continue;
      }
      blank(i, i + 1);
      i++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      const from = i;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        if (src[i] === '\n' && quote === "'") break;
        i++;
      }
      blank(from, i);
      lastSig = quote;
      lastWord = '';
      continue;
    }
    if (ch === '`') {
      frames.push({ depth: 0, templateExpr: false });
      lastSig = '`';
      lastWord = '';
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const from = i;
      while (i < n && src[i] !== '\n') i++;
      blank(from, i);
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const from = i;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      blank(from, i);
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      const from = i;
      i++;
      let inClass = false;
      while (i < n) {
        const c = src[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '\n') break;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { i++; break; }
        i++;
      }
      while (i < n && /[a-z]/i.test(src[i])) i++;
      blank(from, i);
      lastSig = '/';
      lastWord = '';
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      frame.depth++;
      lastSig = ch;
      lastWord = '';
      i++;
      continue;
    }
    if (ch === ')' || ch === ']') {
      frame.depth--;
      lastSig = ch;
      lastWord = '';
      i++;
      continue;
    }
    if (ch === '}') {
      if (frame.depth > 0) frame.depth--;
      else if (frames.length > 1 && frame.templateExpr) frames.pop();
      lastSig = ch;
      lastWord = '';
      i++;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      lastWord = src.slice(i, j);
      lastSig = src[j - 1];
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxX._]/.test(src[j])) j++;
      lastSig = src[j - 1];
      lastWord = '';
      i = j;
      continue;
    }
    if (!/\s/.test(ch)) {
      lastSig = ch;
      lastWord = '';
    }
    i++;
  }
  return mask;
}

/**
 * Rewrite module-only syntax (`import.meta*`, dynamic `import()`) to the bindings
 * the CJS wrapper provides — but only where it is *code*, never inside strings,
 * templates, comments or regexes (see `codeMask`).
 */
function rewriteModuleSyntax(code: string): string {
  const mask = codeMask(code);
  const chars = code.split('');
  for (let k = 0; k < chars.length; k++) if (!mask[k]) chars[k] = ' ';
  const masked = chars.join('');

  const edits: Array<{ start: number; end: number; text: string }> = [];
  const re = /\bimport\.meta(?:\.(url|filename|dirname))?\b|(?<![\w$.])import\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (/^import\s*\(/.test(m[0])) {
      edits.push({ start, end, text: `${IMPORT_BINDING}(` });
    } else if (m[1] === 'url') {
      edits.push({ start, end, text: '__mod_url' });
    } else if (m[1] === 'filename') {
      edits.push({ start, end, text: '__mod_file' });
    } else if (m[1] === 'dirname') {
      edits.push({ start, end, text: '__mod_dir' });
    } else {
      edits.push({ start, end, text: '({ url: __mod_url })' });
    }
  }

  let out = '';
  let last = 0;
  for (const e of edits) {
    out += code.slice(last, e.start) + e.text;
    last = e.end;
  }
  return out + code.slice(last);
}

export function transformEsmToCjs(source: string, moduleUrl: string): TransformResult {
  const imports: string[] = [];
  const out: string[] = [];
  const pendingExports: string[] = [];

  for (const piece of splitStatements(source)) {
    const code = leadTrim(piece);

    // --- import statements -------------------------------------------------
    const named = stripAttrs(code).match(RE_IMPORT_NAMED);
    if (named && code.startsWith('import ')) {
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
      out.push(`const ${tmp} = ${RQ}(${JSON.stringify(mod)});`);
      if (nsMatch) parts.push(`${nsMatch[1]} = ${tmp}`);
      if (namedBlock) parts.push(`{ ${transformNamedSpecifiers(namedBlock[1])} } = ${tmp}`);
      if (parts.length > 0) out.push(`const ${parts.join(', ')};`);
      continue;
    }

    const bare = stripAttrs(code).match(RE_IMPORT_BARE);
    if (bare && code.startsWith('import ')) {
      imports.push(bare[2]);
      out.push(`${RQ}(${JSON.stringify(bare[2])});`);
      continue;
    }

    // --- export ... from 'mod' --------------------------------------------
    const exportFrom = code.match(/^export\s+([\s\S]+?)\s+from\s+(['"])([^'"]+)\2/);
    if (exportFrom) {
      const clause = exportFrom[1].trim();
      const mod = exportFrom[3];
      imports.push(mod);
      if (clause === '*') {
        out.push(`Object.assign(${EX}, ${RQ}(${JSON.stringify(mod)}));`);
      } else if (/^\*\s+as\s+/.test(clause)) {
        const name = clause.replace(/^\*\s+as\s+/, '');
        out.push(`${EX}.${name} = ${RQ}(${JSON.stringify(mod)});`);
      } else {
        const block = clause.match(/^\{([\s\S]*)\}$/);
        if (block) {
          const tmp = uid('from');
          out.push(`const ${tmp} = ${RQ}(${JSON.stringify(mod)});`);
          // Re-exports read from the required module, not from local scope:
          // `export { a, b as c } from 'm'` → `exports.a = m.a; exports.c = m.b;`
          const pairs = block[1]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => {
              const m = s.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
              return m ? `${m[2]}: ${tmp}.${m[1]}` : `${s}: ${tmp}.${s}`;
            })
            .join(', ');
          out.push(`Object.assign(${EX}, { ${pairs} });`);
        } else {
          out.push(piece);
        }
      }
      continue;
    }

    // --- export default ----------------------------------------------------
    if (/^export\s+default\s+/.test(code)) {
      const body = code.replace(/^export\s+default\s+/, '');
      if (/^(async\s+)?function\b/.test(body) || /^class\b/.test(body)) {
        const declared = body.match(/(?:function|class)\s+([A-Za-z_$][\w$]*)/)?.[1];
        out.push(body);
        out.push(`${EX}.default = ${declared ?? 'undefined'};`);
      } else {
        out.push(`${EX}.default = ${body.replace(/;$/, '')};`);
      }
      continue;
    }

    // --- export { a, b as c } ---------------------------------------------
    const exportBlock = code.match(/^export\s*\{([\s\S]*)\}\s*;?$/);
    if (exportBlock) {
      const pairs = exportBlock[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const m = s.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
          return m ? `${EX}.${m[2]} = ${m[1]};` : `${EX}.${s} = ${s};`;
        })
        .join(' ');
      out.push(pairs);
      continue;
    }

    // --- export declarations ----------------------------------------------
    const decl = code.match(/^export\s+(const|let|var|async\s+function|function|class)\s+([\s\S]*)$/);
    if (decl) {
      const kind = decl[1];
      const rest = decl[2];
      out.push(`${kind} ${rest}`.replace(/^async\s+function/, 'async function'));
      pendingExports.push(rest);
      continue;
    }

    out.push(piece);
  }

  // Emit `__wn_exports.x = x` for each declared binding.
  const exportLines: string[] = [];
  for (const rest of pendingExports) {
    if (/^(async\s+)?function/.test(rest) || /^class/.test(rest)) {
      const name = rest.match(/^(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/)?.[1];
      if (name) exportLines.push(`${EX}.${name} = ${name};`);
    } else {
      // const a = 1, b = 2;
      const decls = rest.replace(/;?\s*$/, '').split(',');
      for (const d of decls) {
        const name = d.match(/^\s*([A-Za-z_$][\w$]*)/)?.[1];
        if (name) exportLines.push(`${EX}.${name} = ${name};`);
      }
    }
  }

  const header =
    `Object.defineProperty(${EX}, '__esModule', { value: true });\n` +
    `function __wnDefault(m) { return (m && m.__esModule) ? m.default : m; }\n` +
    `const __mod_url = ${JSON.stringify(moduleUrl)};\n` +
    `const __mod_file = __mod_url.replace(/^file:\\/\\//, '');\n` +
    `const __mod_dir = __mod_file.slice(0, __mod_file.lastIndexOf('/')) || '/';\n`;
  // `import.meta` is module-only syntax and would be a hard SyntaxError inside
  // the `new Function` wrapper, so it is rewritten to the header bindings.
  // Dynamic `import()` is likewise unavailable in `new Function` (V8 rejects it
  // with "A dynamic import callback was not specified"), so it is routed to the
  // async loader. Both rewrites must touch *code only* — see `rewriteModuleSyntax`.
  const body = rewriteModuleSyntax(header + out.join('\n') + '\n' + exportLines.join('\n'));
  return { code: body, imports };
}
