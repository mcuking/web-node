/**
 * The shared JavaScript tokeniser used by the loader and the build-time
 * vendored-source stripper.
 *
 * `codeMask` blanks out the *contents* of string literals, template raw text,
 * comments and regex literals while keeping the length identical, so callers can
 * apply a rewrite (or a deletion) to real code only, with every index still
 * lining up 1:1 with the original string.
 *
 * Why it exists: the `import.meta` / `import()` rewrite used to run as a plain
 * regex over the whole bundle, which also mutated *data*. A dependency that ships
 * the literal `import.meta` (Vite does: `if (rawUrl === "import.meta")`) had that
 * string rewritten too, silently turning the comparison false and disabling the
 * HMR hot-context injection. Length-preserving masking keeps every index in the
 * original string valid, so edit positions line up 1:1.
 *
 * The token rules mirror `splitStatements` (strings, nested `${…}`, comments,
 * regex-vs-division) because getting the last two wrong desyncs everything after.
 */

export interface CodeMaskOptions {
  /**
   * When provided, every `//…` or `/*…*\/` comment span is pushed as
   * `[start, end)` (end exclusive). Strings, templates and regexes are never
   * reported, so a caller can delete comments without touching data.
   */
  comments?: Array<[number, number]>;
}

export function codeMask(src: string, options: CodeMaskOptions = {}): Uint8Array {
  const comments = options.comments;
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
      if (comments) comments.push([from, i]);
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const from = i;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      blank(from, i);
      if (comments) comments.push([from, i]);
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
