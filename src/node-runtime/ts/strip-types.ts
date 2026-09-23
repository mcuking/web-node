/**
 * Pure-JS TypeScript type stripper — `module.stripTypeScriptTypes`'s strip-only
 * mode, without pulling in amaro/SWC's wasm transform.
 *
 * Semantics mirrored from real Node v26.9.0 (which drives amaro/SWC in
 * `strip-only` mode):
 *
 *  - The output is **byte-for-byte the same length** as the input: every span
 *    that carries only type information (type annotations, type parameters and
 *    arguments, `as`/`satisfies` casts, the non-null `!`, TS-only modifiers,
 *    and type-only declarations) is overwritten with spaces. Line breaks inside
 *    a blanked span are preserved so line/column positions stay intact.
 *  - Syntax that cannot be erased without emitting runtime code (enum,
 *    namespace, `import =`, parameter properties, `module`, `export =`) is
 *    rejected with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
 *
 * The two hard problems are (a) telling a `<` that opens type arguments from a
 * relational `<`, and (b) telling `(a, b)` grouping from arrow parameters. Both
 * are resolved the way SWC resolves them:
 *
 *  - `<`: speculatively parse a type-argument list; accept it when the token
 *    after `>` is `(`, a template literal, or cannot begin a primary expression
 *    (otherwise `expr < T > rhs` parses as a comparison and wins).
 *  - `(`: find the matching `)`; it is arrow parameters iff a `=>` (possibly
 *    after a `: ReturnType`) follows.
 */

/** Factory for the two TypeScript-syntax error codes (injected so the shim's
 *  error classes — and therefore `name`/`constructor.name` — stay in control). */
export interface StripTypeScriptErrors {
  unsupported(message: string): Error;
  invalid(message: string): Error;
}

interface Tok {
  k: 'ident' | 'num' | 'str' | 'tpl' | 'regex' | 'punct' | 'eof';
  v: string;
  s: number;
  e: number;
  /** a line terminator appeared before this token */
  nl: boolean;
  /** template-literal substitution source ranges (`${ ... }` bodies) */
  subs?: Array<[number, number]>;
}

const KEYWORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new',
  'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'async',
  'get', 'set', 'of', 'as', 'satisfies', 'interface', 'type', 'declare',
  'namespace', 'module', 'abstract', 'implements', 'private', 'public',
  'protected', 'readonly', 'override', 'accessor', 'keyof', 'unique',
  'infer', 'is', 'asserts', 'out', 'undef',
]);

const PUNCT = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '?.', '??', '**', '==', '!=', '<=', '>=', '&&', '||', '=>', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>',
];

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/** Scan `code` in `[from, to)` into tokens (trivia dropped). */
function scan(code: string, from: number, to: number): Tok[] {
  const toks: Tok[] = [];
  let i = from;
  let sawNl = false;
  let prev: Tok | null = null;

  const push = (k: Tok['k'], s: number, e: number, subs?: Array<[number, number]>): void => {
    const t: Tok = { k, v: code.slice(s, e), s, e, nl: sawNl };
    if (subs) t.subs = subs;
    sawNl = false;
    toks.push(t);
    prev = t;
  };

  while (i < to) {
    const ch = code[i];
    if (ch === '\n' || ch === '\r') { sawNl = true; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v' || ch === '\u00a0' || ch === '\ufeff') { i++; continue; }

    // comments
    if (ch === '/' && code[i + 1] === '/') {
      i += 2;
      while (i < to && code[i] !== '\n' && code[i] !== '\r') i++;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < to && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') sawNl = true;
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === '#') {
      // `#!` hashbang or a private name (`#x`). Consume the `#` plus ident.
      const s = i;
      i++;
      if (code[i] === '!') { while (i < to && code[i] !== '\n') i++; continue; }
      while (i < to && IDENT_PART.test(code[i])) i++;
      push('ident', s, i);
      continue;
    }
    if (IDENT_START.test(ch) || ch === '\\') {
      const s = i;
      i++;
      while (i < to && (IDENT_PART.test(code[i]) || code[i] === '\\')) i++;
      push('ident', s, i);
      continue;
    }
    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(code[i + 1] ?? ''))) {
      const s = i;
      i++;
      while (i < to && /[0-9a-fA-FoOxXbBeE_+\-.n]/.test(code[i])) {
        // stop `+`/`-` unless part of an exponent
        if ((code[i] === '+' || code[i] === '-') && !/[eE]/.test(code[i - 1])) break;
        i++;
      }
      push('num', s, i);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const s = i;
      i++;
      while (i < to && code[i] !== ch) {
        if (code[i] === '\\') i++;
        i++;
      }
      i++;
      push('str', s, i);
      continue;
    }
    if (ch === '`') {
      const s = i;
      i++;
      const subs: Array<[number, number]> = [];
      while (i < to && code[i] !== '`') {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === '$' && code[i + 1] === '{') {
          const exprStart = i + 2;
          i += 2;
          let depth = 1;
          while (i < to && depth > 0) {
            const c = code[i];
            if (c === '{') depth++;
            else if (c === '}') depth--;
            else if (c === '`') { // nested template
              i++;
              while (i < to && code[i] !== '`') { if (code[i] === '\\') i++; i++; }
            } else if (c === '"' || c === "'") {
              const q = c; i++;
              while (i < to && code[i] !== q) { if (code[i] === '\\') i++; i++; }
            } else if (c === '/' && code[i + 1] === '/') {
              while (i < to && code[i] !== '\n') i++;
              continue;
            } else if (c === '/' && code[i + 1] === '*') {
              i += 2; while (i < to && !(code[i] === '*' && code[i + 1] === '/')) i++; i++;
              continue;
            }
            if (depth > 0) i++;
          }
          subs.push([exprStart, i]);
          i++; // consume `}`
          continue;
        }
        i++;
      }
      i++;
      push('tpl', s, i, subs);
      continue;
    }
    if (ch === '/') {
      // regex vs division: `/` opens a regex only where an expression may
      // begin — i.e. not after a value-ending token (ident/number/string/
      // template/`)`/`]`/`++`/`--`) or the value keywords.
      const last: Tok | null = toks.length ? toks[toks.length - 1] : null;
      let canBeRegex: boolean;
      if (!last) canBeRegex = true;
      else if (last.k === 'ident') {
        canBeRegex = KEYWORDS.has(last.v) && !['this', 'super', 'true', 'false', 'null'].includes(last.v);
      } else if (last.k === 'num' || last.k === 'str' || last.k === 'tpl' || last.k === 'regex') {
        canBeRegex = false;
      } else {
        canBeRegex = !(last.v === ')' || last.v === ']' || last.v === '++' || last.v === '--');
      }
      if (canBeRegex) {
        const s = i;
        i++;
        let inClass = false;
        while (i < to && code[i] !== '\n') {
          const c = code[i];
          if (c === '\\') { i += 2; continue; }
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) break;
          i++;
        }
        i++;
        while (i < to && IDENT_PART.test(code[i])) i++;
        push('regex', s, i);
        continue;
      }
    }
    // punctuators
    let matched = '';
    for (const p of PUNCT) {
      if (code.startsWith(p, i)) { matched = p; break; }
    }
    if (matched) {
      // `>>`/`>>>` in a type position should be split; caller handles by value.
      push('punct', i, i + matched.length);
      i += matched.length;
      continue;
    }
    push('punct', i, i + 1);
    i += 1;
  }
  toks.push({ k: 'eof', v: '', s: to, e: to, nl: sawNl });
  return toks;
}

/** The stripper state machine. */
class Stripper {
  private code: string;
  private toks: Tok[];
  private i = 0;
  private blanks: Array<[number, number]> = [];
  private err: StripTypeScriptErrors;
  /** true while parsing a class heritage clause, where `<` always opens type args */
  private commitTypeArgs = false;

  constructor(code: string, toks: Tok[], err: StripTypeScriptErrors) {
    this.code = code;
    this.toks = toks;
    this.err = err;
  }

  // --- token helpers -------------------------------------------------------
  private peek(o = 0): Tok { return this.toks[Math.min(this.i + o, this.toks.length - 1)]; }
  private get cur(): Tok { return this.toks[this.i]; }
  private at(v: string, o = 0): boolean { return this.peek(o).v === v && this.peek(o).k !== 'eof'; }
  private next(): Tok { const t = this.toks[this.i]; if (this.i < this.toks.length - 1) this.i++; return t; }
  private eat(v: string): boolean { if (this.at(v)) { this.next(); return true; } return false; }

  private mark(start: number, end: number): void {
    if (end > start) this.blanks.push([start, end]);
  }
  private markTok(t: Tok, end: number): void { this.mark(t.s, end); }

  /** Skip a balanced run, returning the index just past it and the end offset. */
  private skipBalanced(open: string, close: string): number {
    // consumes from the current token which must be `open`
    this.next();
    let depth = 1;
    while (depth > 0 && this.cur.k !== 'eof') {
      if (this.cur.v === open) depth++;
      else if (this.cur.v === close) depth--;
      if (depth === 0) { const t = this.next(); return t.e; }
      this.next();
    }
    return this.cur.s;
  }

  // --- types ---------------------------------------------------------------
  /** Parse a type starting at the current token; returns its end offset. */
  parseType(): number {
    // type predicates: `x is T`, `asserts x`, `asserts x is T`
    if (this.at('asserts')) {
      this.next();
      if (this.cur.k === 'ident' || this.at('this')) this.next();
      if (this.at('is')) { this.next(); return this.parseType(); }
      return this.toks[this.i - 1].e;
    }
    let end = this.parseUnionType();
    if (this.at('is')) { this.next(); return this.parseType(); }
    // conditional type: T extends U ? A : B
    if (this.at('extends')) {
      this.next();
      end = this.parseUnionType();
      if (this.eat('?')) {
        end = this.parseType();
        if (this.eat(':')) end = this.parseType();
      }
    }
    return end;
  }

  private parseUnionType(): number {
    this.eat('|'); // a leading `|` is allowed (`type X = | A | B`)
    let end = this.parseIntersectionType();
    while (this.at('|')) { this.next(); end = this.parseIntersectionType(); }
    return end;
  }

  private parseIntersectionType(): number {
    let end = this.parseTypeOperator();
    while (this.at('&')) { this.next(); end = this.parseTypeOperator(); }
    return end;
  }

  private parseTypeOperator(): number {
    if (this.at('keyof') || this.at('unique') || this.at('readonly') || this.at('infer')) {
      this.next();
      return this.parseTypeOperator();
    }
    return this.parsePostfixType();
  }

  private parsePostfixType(): number {
    let end = this.parsePrimaryType();
    while (this.at('[')) {
      this.next();
      if (!this.at(']')) this.parseType();
      if (this.at(']')) end = this.next().e;
      else end = this.cur.s;
    }
    return end;
  }

  private parsePrimaryType(): number {
    const t = this.cur;
    if (t.k === 'eof') return t.s;
    // function/ctor type: `(params) => T`, `new (params) => T`, `<T>(params) => T`
    if (this.at('<')) this.parseTypeParams();
    if (this.at('(')) {
      // a `(` starts a parameter list only when a `=>` follows the matching `)`;
      // otherwise it is a parenthesized type like `(() => boolean)`.
      if (this.parenFollowedByArrow() && this.peek(1).v !== '(') {
        this.parseParamList();
        if (this.at('=>')) { this.next(); return this.parseType(); }
        return this.cur.s;
      }
      this.next();
      const inner = this.parseType();
      if (this.at(')')) return this.next().e;
      return Math.max(inner, this.toks[this.i - 1]?.e ?? inner);
    }
    if (this.at('new')) {
      this.next();
      if (this.at('<')) this.parseTypeParams();
      if (this.at('(')) {
        this.parseParamList();
        if (this.at('=>')) { this.next(); return this.parseType(); }
      }
      return this.cur.s;
    }
    if (this.at('typeof')) {
      this.next();
      if (this.at('import')) { this.next(); if (this.at('(')) return this.skipBalanced('(', ')'); return this.parseQualifiedName(); }
      return this.parseQualifiedName();
    }
    if (this.at('import')) {
      this.next();
      if (this.at('(')) return this.skipBalanced('(', ')');
      return this.parseQualifiedName();
    }
    if (this.at('{')) return this.skipBalanced('{', '}');
    if (this.at('[')) return this.skipBalanced('[', ']');
    if (t.k === 'tpl') return this.next().e;
    if (t.k === 'str' || t.k === 'num') return this.next().e;
    if (t.k === 'punct' && t.v === '-') { this.next(); return this.cur.k === 'num' ? this.next().e : t.s; }
    if (t.k === 'ident') {
      let end = this.parseQualifiedName();
      if (this.at('<')) {
        const save = this.i;
        this.parseTypeArgs();
        end = this.toks[this.i - 1].e;
        if (this.i === save) end = this.toks[save - 1]?.e ?? end;
      }
      return end;
    }
    return this.next().e;
  }

  private parseQualifiedName(): number {
    let end = this.cur.e;
    if (this.cur.k === 'ident' || this.at('this')) end = this.next().e;
    while (this.at('.') || this.at('?.')) {
      this.next();
      if (this.cur.k === 'ident' || this.cur.k === 'num') end = this.next().e;
      else break;
    }
    return end;
  }

  /** Parse `<T, U extends V = W>`; returns end offset. Assumes `cur === '<'`. */
  private parseTypeParams(): number {
    if (!this.at('<')) return this.cur.s;
    const depthStart = this.i;
    let depth = 0;
    let angle = 0;
    // consume a balanced `<...>` counting nested angles
    let end = this.cur.s;
    while (this.cur.k !== 'eof') {
      const v = this.cur.v;
      if (v === '<') { angle++; this.next(); continue; }
      if (v === '>') { angle--; end = this.next().e; if (angle === 0) break; continue; }
      if (v === '>>') { angle -= 2; end = this.next().e; if (angle <= 0) break; continue; }
      if (v === '>>>') { angle -= 3; end = this.next().e; if (angle <= 0) break; continue; }
      if (v === '=>') { this.next(); continue; }
      // skip nested brackets so `>` inside them doesn't count
      if (v === '(') { this.skipBalanced('(', ')'); continue; }
      if (v === '[') { this.skipBalanced('[', ']'); continue; }
      if (v === '{') { this.skipBalanced('{', '}'); continue; }
      this.next();
    }
    void depthStart; void depth;
    return end;
  }

  /** Parse `<T, U>`; returns end offset or 0 if it doesn't close. */
  private parseTypeArgs(): number {
    const save = this.i;
    if (!this.at('<')) return 0;
    const end = this.parseTypeParams();
    if (this.i === save) return 0;
    // must have actually closed on a `>`
    const closed = this.toks[this.i - 1].v;
    if (closed !== '>' && closed !== '>>' && closed !== '>>>') { this.i = save; return 0; }
    return end;
  }

  private parseParamList(isConstructor = false): void {
    // assumes cur === '('
    this.next();
    while (!this.at(')') && this.cur.k !== 'eof') {
      const before = this.i;
      const thisStart = this.skipParam(isConstructor);
      if (this.at(',')) {
        this.next();
        // a `this` parameter takes its separating comma with it
        if (thisStart >= 0) this.mark(thisStart, this.cur.s);
      }
      if (this.i === before) this.next(); // defensive: never spin
    }
    if (this.at(')')) this.next();
  }

  /** Blank TS syntax inside one parameter; leaves the JS parts. Returns the
   *  start offset of a `this` parameter (so its comma can be erased too), else -1. */
  private skipParam(isConstructor: boolean): number {
    // modifiers — a parameter property emits runtime code
    while (MODIFIERS.has(this.cur.v) && this.cur.k === 'ident') {
      if (isConstructor) {
        throw this.err.unsupported('TypeScript parameter property is not supported in strip-only mode');
      }
      throw this.err.invalid('A parameter property is only allowed in a constructor implementation');
    }
    if (this.at('...')) { this.next(); }
    // `this` parameter — erased entirely
    let thisStart = -1;
    if (this.at('this') && (this.peek(1).v === ':' || this.peek(1).v === ',' || this.peek(1).v === ')')) {
      thisStart = this.cur.s;
      this.markTok(this.cur, this.cur.e);
      this.next();
    } else if (this.at('{')) this.skipBalanced('{', '}');
    else if (this.at('[')) this.skipBalanced('[', ']');
    else if (this.at('(')) { this.next(); this.parseType(); if (this.at(')')) this.next(); }
    else { this.next(); }
    if (this.at('?')) { this.markTok(this.cur, this.cur.e); this.next(); }
    if (this.at(':')) { const colon = this.next(); const end = this.parseType(); this.mark(colon.s, end); }
    if (this.at('=')) { this.next(); this.parseAssign(); }
    return thisStart;
  }

  // --- expressions ---------------------------------------------------------
  private parseExpression(): void { this.parseSequence(); }
  private parseSequence(): void {
    const before0 = this.i;
    this.parseAssign();
    if (this.i === before0) return;
    while (this.at(',')) {
      this.next();
      const before = this.i;
      this.parseAssign();
      if (this.i === before) break;
    }
  }

  private parseAssign(): void {
    // speculative arrow: ident =>  |  ( ... ) [: T] =>  |  <T>( ... ) =>  
    if (this.tryArrow()) return;
    this.parseConditional();
    if (this.cur.k === 'punct' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**=',
      '<<=', '>>=', '>>>=', '&&=', '||=', '??='].includes(this.cur.v)) {
      this.next();
      this.parseAssign();
    }
  }

  private tryArrow(): boolean {
    const save = this.i;
    const saveBlanks = this.blanks.length;
    // <T,>(...) =>  or <T>(...) =>
    if (this.at('<')) {
      const end = this.parseTypeParams();
      if (this.i === save) { this.blanks.length = saveBlanks; return false; }
      const closed = this.toks[this.i - 1].v;
      if ((closed === '>' || closed === '>>' || closed === '>>>') && this.at('(')) {
        const after = this.matchingParenThenArrow(this.i);
        if (after !== null) {
          this.mark(this.toks[save].s, end);
          this.parseParamList();
          if (this.at(':')) { const colon = this.next(); const te = this.parseType(); this.mark(colon.s, te); }
          if (this.at('=>')) { this.next(); this.parseArrowBody(); return true; }
        }
      }
      this.i = save; this.blanks.length = saveBlanks; return false;
    }
    if (this.at('(')) {
      const after = this.matchingParenThenArrow(this.i);
      if (after !== null) {
        this.parseParamList();
        if (this.at(':')) { const colon = this.next(); const te = this.parseType(); this.mark(colon.s, te); }
        if (this.at('=>')) { this.next(); this.parseArrowBody(); return true; }
      }
      this.i = save; this.blanks.length = saveBlanks; return false;
    }
    if (this.cur.k === 'ident' && !KEYWORDS.has(this.cur.v) && this.peek(1).v === '=>') {
      this.next(); this.next(); this.parseArrowBody(); return true;
    }
    if (this.at('async')) {
      // async x => / async ( ... ) =>
      if (this.peek(1).k === 'ident' && !KEYWORDS.has(this.peek(1).v) && this.peek(2).v === '=>') {
        this.next(); this.next(); this.next(); this.parseArrowBody(); return true;
      }
      if (this.peek(1).v === '(') {
        this.next();
        const after = this.matchingParenThenArrow(this.i);
        if (after !== null) {
          this.parseParamList();
          if (this.at(':')) { const colon = this.next(); const te = this.parseType(); this.mark(colon.s, te); }
          if (this.at('=>')) { this.next(); this.parseArrowBody(); return true; }
        }
      }
      this.i = save; this.blanks.length = saveBlanks; return false;
    }
    return false;
  }

  /** Cheap, non-destructive test: is the `(` at the current token closed by a
   *  `)` whose next token is `=>`? (No sub-parsing — avoids exponential cost.) */
  private parenFollowedByArrow(): boolean {
    const p = this.i;
    const save = this.i;
    const close = this.matchingParenOffset();
    const ok = close !== null && this.at('=>');
    this.i = save;
    void p;
    return ok;
  }

  private arrowCache = new Map<number, boolean>();

  /** If the `(` at index `p` is followed (after an optional `: T`) by `=>`,
   *  return the offset of the `)`; else null. Non-destructive. */
  private matchingParenThenArrow(p: number): number | null {
    const cached = this.arrowCache.get(p);
    const save = this.i;
    const saveBlanks = this.blanks.length;
    this.i = p;
    const closeEnd = this.matchingParenOffset();
    if (closeEnd === null) { this.i = save; this.blanks.length = saveBlanks; this.arrowCache.set(p, false); return null; }
    let ok = false;
    if (this.at('=>')) ok = true;
    else if (this.at(':')) {
      const colonSave = this.i;
      this.next();
      this.parseType();
      if (this.at('=>')) ok = true;
      else { this.i = colonSave; }
    }
    this.i = save;
    this.blanks.length = saveBlanks;
    void cached;
    this.arrowCache.set(p, ok);
    return ok ? closeEnd : null;
  }

  /** Consume a balanced `(...)` from the current `(` and return the offset of
   *  the closing `)` (its start). */
  private matchingParenOffset(): number | null {
    if (!this.at('(')) return null;
    this.next();
    let depth = 1;
    while (depth > 0 && this.cur.k !== 'eof') {
      const v = this.cur.v;
      if (v === '(') depth++;
      else if (v === ')') {
        depth--;
        if (depth === 0) { const t = this.cur; this.next(); return t.s; }
      }
      this.next();
    }
    return null;
  }

  private parseArrowBody(): void {
    if (this.at('{')) { this.parseBlock(); return; }
    this.parseAssign();
  }

  private parseConditional(): void {
    this.parseBinary(0);
    if (this.at('?')) {
      this.next();
      this.parseAssign();
      if (this.at(':')) { this.next(); this.parseAssign(); }
    }
  }

  private parseBinary(minPrec: number): void {
    this.parseUnary();
    for (;;) {
      const t = this.cur;
      if (t.k !== 'punct' && t.k !== 'ident') break;
      let prec = BINOP[t.v];
      if (prec === undefined) break;
      if (t.v === 'in' || t.v === 'instanceof') prec = 7;
      if (prec < minPrec) break;
      this.next();
      this.parseBinary(prec + 1);
    }
  }

  private parseUnary(): void {
    if (this.cur.k === 'punct' && ['!', '~', '+', '-', '++', '--'].includes(this.cur.v)) {
      this.next(); this.parseUnary(); this.parseAsSatisfies(); return;
    }
    if (this.at('typeof') || this.at('void') || this.at('delete') || this.at('await')) {
      this.next(); this.parseUnary(); this.parseAsSatisfies(); return;
    }
    this.parsePostfix();
    this.parseAsSatisfies();
  }

  private parseAsSatisfies(): void {
    while ((this.at('as') || this.at('satisfies'))) {
      // `as const` and casts
      const kw = this.next();
      if (this.at('const')) { this.mark(kw.s, this.cur.e); this.next(); continue; }
      const end = this.parseType();
      this.mark(kw.s, end);
    }
  }

  private parsePostfix(): void {
    this.parsePrimary();
    for (;;) {
      const v = this.cur.v;
      if (v === '.' || v === '?.') {
        this.next();
        if (this.cur.k === 'ident' || this.cur.k === 'num' || this.cur.v === 'private') this.next();
        continue;
      }
      if (v === '[') { this.parseBracket(); continue; }
      if (v === '(') { this.parseCallArgs(); continue; }
      if (this.cur.k === 'tpl') { this.next(); continue; }
      if (v === '++' || v === '--') { this.next(); continue; }
      if (v === '!') { this.markTok(this.cur, this.cur.e); this.next(); continue; }
      if (v === '<') {
        // type arguments or comparison
        const save = this.i;
        const saveBlanks = this.blanks.length;
        const end = this.parseTypeArgs();
        if (end === 0) { this.i = save; this.blanks.length = saveBlanks; break; }
        const after = this.cur;
        if (this.commitTypeArgs || after.v === '(' || after.k === 'tpl') {
          this.mark(this.toks[save].s, end);
          continue;
        }
        if (canStartPrimary(after)) { this.i = save; this.blanks.length = saveBlanks; break; }
        this.mark(this.toks[save].s, end);
        continue;
      }
      break;
    }
  }

  /** Parse a `[...]` — array literal or computed member — element by element,
   *  so `as`/type-arguments inside are still erased. */
  private parseBracket(): void {
    this.next(); // [
    while (!this.at(']') && this.cur.k !== 'eof') {
      if (this.at('...')) this.next();
      const before = this.i;
      this.parseAssign();
      if (this.at(',')) this.next();
      else if (this.i === before) this.next();
    }
    if (this.at(']')) this.next();
  }

  private parseCallArgs(): void {
    this.next(); // (
    while (!this.at(')') && this.cur.k !== 'eof') {
      if (this.at('...')) this.next();
      const before = this.i;
      this.parseAssign();
      if (this.at(',')) this.next();
      else if (this.i === before) this.next();
    }
    if (this.at(')')) this.next();
  }

  private parsePrimary(): void {
    const t = this.cur;
    if (t.k === 'eof') return;
    if (t.v === '(') { this.next(); this.parseSequence(); if (this.at(')')) this.next(); return; }
    if (t.v === '[') { this.parseBracket(); return; }
    if (t.v === '{') { this.parseObjectLiteral(); return; }
    if (t.v === 'function') { this.parseFunction(true); return; }
    if (t.v === 'class') { this.parseClass(); return; }
    if (t.v === 'new') { this.next(); if (this.at('.')) { this.next(); this.next(); return; } this.parsePostfix(); return; }
    if (t.v === '<') {
      // `<T>expr` is an unsupported assertion; `<T,>(...) => ...` is handled upstream
      throw this.err.unsupported(
        "The angle-bracket syntax for type assertions, `<T>expr`, is not supported in type strip mode. Instead, use the 'as' syntax: `expr as T`.",
      );
    }
    if (t.k === 'ident' || t.k === 'num' || t.k === 'str' || t.k === 'regex' || t.k === 'tpl') {
      this.next();
      return;
    }
    // do not consume tokens that terminate an expression; let the caller stop
    if (t.v === ')' || t.v === ']' || t.v === '}' || t.v === ',' || t.v === ';' || t.v === ':') return;
    // unknown: consume one token to make progress
    this.next();
  }

  private parseObjectLiteral(): void {
    this.next(); // {
    while (!this.at('}') && this.cur.k !== 'eof') {
      if (this.at('...')) { this.next(); this.parseAssign(); }
      else if ((this.at('get') || this.at('set')) &&
          (this.peek(1).k === 'ident' || this.peek(1).k === 'str' || this.peek(1).k === 'num' || this.peek(1).v === '[')) {
        this.next();
        this.parsePropKey();
        if (this.at('<')) this.parseTypeParams();
        if (this.at('(')) this.parseParamList();
        if (this.at(':')) { const colon = this.next(); const te = this.parseType(); this.mark(colon.s, te); }
        if (this.at('{')) this.parseBlock();
      } else {
        this.parsePropKey();
        if (this.at('?')) { this.markTok(this.cur, this.cur.e); this.next(); }
        if (this.at('(')) {
          this.parseParamList();
          if (this.at(':')) { const colon = this.next(); const te = this.parseType(); this.mark(colon.s, te); }
          if (this.at('{')) this.parseBlock();
        } else {
          if (this.at(':')) { const colon = this.next(); this.parseAssign(); void colon; }
          if (this.at('=')) { this.next(); this.parseAssign(); }
        }
      }
      if (this.at(',')) this.next();
    }
    if (this.at('}')) this.next();
  }

  private parsePropKey(): void {
    if (this.at('[')) { this.skipBalanced('[', ']'); return; }
    if (this.cur.k === 'ident' || this.cur.k === 'str' || this.cur.k === 'num') { this.next(); return; }
    this.next();
  }

  // --- statements ----------------------------------------------------------
  parseProgram(): void {
    while (this.cur.k !== 'eof') {
      const before = this.i;
      this.parseStatement();
      if (this.i === before) this.next();
    }
  }

  private parseBlock(): void {
    if (!this.at('{')) return;
    this.next();
    while (!this.at('}') && this.cur.k !== 'eof') {
      const before = this.i;
      this.parseStatement();
      if (this.i === before) this.next();
    }
    if (this.at('}')) this.next();
  }

  private parseStatement(): void {
    const t = this.cur;
    if (t.v === ';') { this.next(); return; }
    if (t.v === '{') { this.parseBlock(); return; }
    if (t.v === 'interface' && this.peek(1).k === 'ident') return this.blankTypeOnlyDecl();
    if (t.v === 'type' && this.peek(1).k === 'ident' && (this.peek(2).v === '=' || this.peek(2).v === '<')) {
      return this.blankTypeOnlyDecl();
    }
    if (t.v === 'declare') {
      if (this.peek(1).v === 'global') return this.blankDeclareGlobal();
      return this.blankTypeOnlyDecl();
    }
    if (t.v === 'enum') throw this.err.unsupported('TypeScript enum is not supported in strip-only mode');
    if (t.v === 'namespace' && (this.peek(1).k === 'ident' || this.peek(1).k === 'str')) return this.parseNamespace();
    if (t.v === 'module' && (this.peek(1).k === 'ident' || this.peek(1).v === '"') && this.peek(2).v === '{') {
      throw this.err.unsupported('`module` keyword is not supported. Use `namespace` instead.');
    }
    if (t.v === 'import') return this.parseImport();
    if (t.v === 'export') return this.parseExport();
    if (t.v === '@') { while (this.at('@')) { this.next(); this.parsePostfix(); } return this.parseStatement(); }
    if (t.v === 'abstract' && (this.peek(1).v === 'class')) {
      this.markTok(t, t.e); this.next(); return this.parseClass();
    }
    if (t.v === 'function') { this.parseFunction(false); return; }
    if (t.v === 'async' && this.peek(1).v === 'function') { this.next(); this.parseFunction(false); return; }
    if (t.v === 'class') { this.parseClass(); return; }
    if (t.v === 'const' || t.v === 'let' || t.v === 'var') { this.parseVarDecl(); return; }
    if (t.v === 'if') return this.parseIf();
    if (t.v === 'for') return this.parseFor();
    if (t.v === 'while') { this.next(); if (this.at('(')) { this.next(); this.parseSequence(); if (this.at(')')) this.next(); } return this.parseStatement(); }
    if (t.v === 'do') { this.next(); this.parseStatement(); if (this.at('while')) { this.next(); if (this.at('(')) { this.next(); this.parseSequence(); if (this.at(')')) this.next(); } } return; }
    if (t.v === 'with') { this.next(); if (this.at('(')) { this.next(); this.parseSequence(); if (this.at(')')) this.next(); } return this.parseStatement(); }
    if (t.v === 'switch') return this.parseSwitch();
    if (t.v === 'try') return this.parseTry();
    if (t.v === 'return' || t.v === 'throw') {
      this.next();
      if (!this.at(';') && !this.at('}') && !this.cur.nl && this.cur.k !== 'eof') this.parseSequence();
      return;
    }
    if (t.v === 'break' || t.v === 'continue' || t.v === 'debugger') { this.next(); if (this.cur.k === 'ident') this.next(); return; }
    if (t.k === 'ident' && this.peek(1).v === ':') { this.next(); this.next(); return this.parseStatement(); }
    // expression statement
    this.parseSequence();
    if (this.at(';')) this.next();
  }

  private blankTypeOnlyDecl(): void {
    const start = this.cur.s;
    const end = this.endOfStatement();
    this.mark(start, end);
  }

  /** A `namespace`/`module` block is erasable only when its body holds type-only
   *  members; a runtime member (const/let/var/function/class/enum) is rejected. */
  private parseNamespace(exportStart?: number): void {
    const start = exportStart ?? this.cur.s;
    this.next(); // namespace
    if (this.cur.k === 'ident' || this.cur.k === 'str') this.next();
    // dotted names: `namespace A.B.C {}`
    while (this.at('.')) { this.next(); if (this.cur.k === 'ident') this.next(); }
    let runtime = false;
    let end = this.cur.s;
    if (this.at('{')) {
      this.next();
      let depth = 1;
      let sawDeclare = false;
      while (depth > 0 && this.cur.k !== 'eof') {
        const v = this.cur.v;
        if (v === '{') depth++;
        else if (v === '}') { depth--; end = this.next().e; continue; }
        if (depth === 1) {
          if (v === 'declare') sawDeclare = true;
          else if (!sawDeclare && (v === 'const' || v === 'let' || v === 'var' || v === 'function' || v === 'class' || v === 'enum')) {
            runtime = true;
          } else if (v !== 'export') sawDeclare = false;
        }
        end = this.cur.e;
        this.next();
      }
    } else {
      end = this.endOfStatement();
    }
    this.mark(start, end);
    if (this.at(';')) this.next();
    if (runtime) throw this.err.unsupported('TypeScript namespace declaration is not supported in strip-only mode');
  }

  private blankDeclareGlobal(): void {
    const start = this.cur.s;
    const end = this.endOfStatement();
    this.mark(start, end);
  }

  /** Consume tokens to the end of the current declaration, returning the end
   *  offset. Stops after an optional `;` at depth 0, or after the closing `}`
   *  of a block-shaped declaration. */
  private endOfStatement(): number {
    let depth = 0;
    let last = this.cur.s;
    for (;;) {
      const t = this.cur;
      if (t.k === 'eof') return last;
      const v = t.v;
      if (v === '{' || v === '(' || v === '[') depth++;
      else if (v === '}' || v === ')' || v === ']') {
        depth--;
        if (depth < 0) return last;
      }
      if (v === ';' && depth === 0) { const x = this.next(); return x.e; }
      last = t.e;
      this.next();
      if (depth === 0) {
        const n = this.cur;
        if (n.k === 'eof') return last;
        if (n.nl && startsStatement(n)) return last;
      }
    }
  }

  private parseImport(): void {
    if (this.peek(1).v === 'type' && this.peek(2).v !== 'from' && this.peek(2).v !== ',' && this.peek(2).v !== '{' ) {
      return this.blankTypeOnlyDecl();
    }
    if (this.peek(1).v === 'type' && this.peek(2).v === '{') return this.blankTypeOnlyDecl();
    // import X = require(...)
    if (this.peek(1).k === 'ident' && this.peek(2).v === '=') {
      throw this.err.unsupported('TypeScript import equals declaration is not supported in strip-only mode');
    }
    this.next(); // import
    if (this.cur.k === 'str' || this.cur.k === 'tpl') { this.next(); if (this.at(';')) this.next(); return; }
    // import default / * as ns / { ... }
    if (this.cur.k === 'ident') this.next();
    if (this.at(',')) this.next();
    if (this.at('*')) { this.next(); if (this.at('as')) { this.next(); if (this.cur.k === 'ident') this.next(); } }
    if (this.at('{')) this.parseNamedSpecifiers();
    if (this.at('from')) { this.next(); if (this.peek(0).k === 'str' || this.peek(0).k === 'tpl') this.next(); }
    if (this.at(';')) this.next();
  }

  private parseNamedSpecifiers(): void {
    this.next(); // {
    while (!this.at('}') && this.cur.k !== 'eof') {
      const before = this.i;
      if (this.at('type') && this.peek(1).k === 'ident') {
        const kw = this.next(); // type
        this.next(); // name
        if (this.at('as')) {
          this.next();
          if (this.cur.k === 'ident' || this.cur.k === 'str') this.next();
        }
        // a trailing comma is erased along with the type-only specifier
        let end = this.toks[this.i - 1].e;
        if (this.at(',')) { this.next(); end = this.cur.s; }
        this.mark(kw.s, end);
      } else if (this.cur.k === 'ident' || this.cur.k === 'str') {
        this.next();
        if (this.at('as')) { this.next(); if (this.cur.k === 'ident' || this.cur.k === 'str') this.next(); }
      } else { this.next(); }
      if (this.at(',')) this.next();
      if (this.i === before) this.next();
    }
    if (this.at('}')) this.next();
  }

  private parseExport(): void {
    const exportStart = this.cur.s;
    if (this.peek(1).v === 'type' && this.peek(2).v === '{') return this.blankTypeOnlyDecl();
    if (this.peek(1).v === 'type') {
      // export type X = ... | export type * from | export type { }
      return this.blankTypeOnlyDecl();
    }
    if (this.peek(1).v === 'default' && (this.peek(2).v === 'interface' || this.peek(2).v === 'type')) {
      return this.blankTypeOnlyDecl();
    }
    if (this.peek(1).v === '=') {
      throw this.err.unsupported('TypeScript export assignment is not supported in strip-only mode');
    }
    this.next(); // export
    if (this.at('default')) this.next();
    if (this.at('*')) { this.next(); if (this.at('as')) { this.next(); if (this.cur.k === 'ident') this.next(); } if (this.at('from')) { this.next(); if (this.cur.k === 'str') this.next(); } if (this.at(';')) this.next(); return; }
    if (this.at('{')) { this.parseNamedSpecifiers(); if (this.at('from')) { this.next(); if (this.cur.k === 'str') this.next(); } if (this.at(';')) this.next(); return; }
    if (this.at('declare')) return this.blankFrom(exportStart);
    if (this.at('abstract') && this.peek(1).v === 'class') { const t = this.next(); this.markTok(t, t.e); this.parseClass(); return; }
    if (this.at('interface') || this.at('type')) return this.blankFrom(exportStart);
    if (this.at('enum')) throw this.err.unsupported('TypeScript enum is not supported in strip-only mode');
    if (this.at('namespace')) return this.parseNamespace(exportStart);
    if (this.at('function')) { this.parseFunction(false); return; }
    if (this.at('async') && this.peek(1).v === 'function') { this.next(); this.parseFunction(false); return; }
    if (this.at('class')) { this.parseClass(); return; }
    if (this.at('const') || this.at('let') || this.at('var')) { this.parseVarDecl(); return; }
    this.parseSequence();
    if (this.at(';')) this.next();
  }

  /** Blank a declaration whose start offset is already known (e.g. `export`). */
  private blankFrom(start: number): void {
    const end = this.endOfStatement();
    this.mark(start, end);
  }

  private parseVarDecl(): void {
    this.next(); // const/let/var
    for (;;) {
      // binding pattern
      if (this.at('{')) this.skipBalanced('{', '}');
      else if (this.at('[')) this.skipBalanced('[', ']');
      else if (this.cur.k === 'ident') this.next();
      if (this.at('!')) { this.markTok(this.cur, this.cur.e); this.next(); }
      if (this.at(':')) { const colon = this.next(); const end = this.parseType(); this.mark(colon.s, end); }
      if (this.at('=')) { this.next(); this.parseAssign(); }
      if (this.at(',')) { this.next(); continue; }
      break;
    }
    if (this.at(';')) this.next();
  }

  private parseFunction(isExpr: boolean): void {
    void isExpr;
    const start = this.cur.s;
    this.next(); // function
    if (this.at('*')) this.next();
    let nameEnd = start;
    if (this.cur.k === 'ident' || this.cur.v === 'get' || this.cur.v === 'set') nameEnd = this.next().e;
    if (this.at('<')) { const s = this.cur.s; const e = this.parseTypeParams(); this.mark(s, e); }
    if (this.at('(')) this.parseParamList();
    let retEnd = nameEnd;
    if (this.at(':')) { const colon = this.next(); retEnd = this.parseType(); this.mark(colon.s, retEnd); }
    if (this.at('{')) { this.parseBlock(); return; }
    // no body → declaration-only: blank the whole thing
    if (this.at(';')) { const x = this.next(); this.mark(start, x.e); return; }
    if (!isExpr) this.mark(start, this.cur.s);
  }

  private parseIf(): void {
    this.next();
    if (this.at('(')) { this.next(); this.parseSequence(); if (this.at(')')) this.next(); }
    this.parseStatement();
    if (this.at('else')) { this.next(); this.parseStatement(); }
  }

  private parseFor(): void {
    this.next();
    if (this.at('await')) this.next();
    if (this.at('(')) {
      this.next();
      this.parseForHeader();
      if (this.at(')')) this.next();
    }
    this.parseStatement();
  }

  /** Parse a `for (...)` header: declarations/expressions separated by `;`,
   *  plus the `of`/`in` form. Blank type annotations; reject a for-of/in LHS
   *  annotation (Node reports it as an invalid-syntax error). */
  private parseForHeader(): void {
    for (;;) {
      if (this.at(')') || this.cur.k === 'eof') return;
      const before = this.i;
      if (this.at(';')) { this.next(); continue; }
      if (this.at('const') || this.at('let') || this.at('var')) {
        this.next();
        if (this.at('{')) this.skipBalanced('{', '}');
        else if (this.at('[')) this.skipBalanced('[', ']');
        else if (this.cur.k === 'ident' && !KEYWORDS.has(this.cur.v)) this.next();
        if (this.at('!')) { this.markTok(this.cur, this.cur.e); this.next(); }
        let hadAnnotation = false;
        if (this.at(':')) { hadAnnotation = true; const colon = this.next(); const end = this.parseType(); this.mark(colon.s, end); }
        if (this.at('of') || this.at('in')) {
          if (hadAnnotation) {
            throw this.err.invalid("The left-hand side of a 'for...of' statement cannot use a type annotation");
          }
          this.next(); this.parseAssign(); return;
        }
        if (this.at('=')) { this.next(); this.parseAssign(); }
        if (this.at(',')) { this.next(); continue; }
        if (this.i === before) this.next();
        continue;
      }
      this.parseAssign();
      if (this.at(',')) { this.next(); continue; }
      if (this.i === before) this.next();
    }
  }

  private parseSwitch(): void {
    this.next();
    if (this.at('(')) { this.next(); this.parseSequence(); if (this.at(')')) this.next(); }
    if (this.at('{')) {
      this.next();
      while (!this.at('}') && this.cur.k !== 'eof') {
        if (this.at('case')) { this.next(); this.parseSequence(); if (this.at(':')) this.next(); continue; }
        if (this.at('default')) { this.next(); if (this.at(':')) this.next(); continue; }
        const before = this.i;
        this.parseStatement();
        if (this.i === before) this.next();
      }
      if (this.at('}')) this.next();
    }
  }

  private parseTry(): void {
    this.next();
    this.parseBlock();
    if (this.at('catch')) {
      this.next();
      if (this.at('(')) { this.next(); if (this.cur.k === 'ident') this.next(); if (this.at(':')) { const colon = this.next(); const end = this.parseType(); this.mark(colon.s, end); } if (this.at(')')) this.next(); }
      this.parseBlock();
    }
    if (this.at('finally')) { this.next(); this.parseBlock(); }
  }

  private parseClass(): void {
    this.next(); // class
    if (this.cur.k === 'ident' && !KEYWORDS.has(this.cur.v)) this.next();
    if (this.at('<')) { const s = this.cur.s; const e = this.parseTypeParams(); this.mark(s, e); }
    if (this.at('extends')) {
      this.next();
      this.commitTypeArgs = true;
      this.parsePostfix();
      this.commitTypeArgs = false;
    }
    if (this.at('implements')) {
      const start = this.next().s;
      let end = start;
      while (this.cur.k !== 'eof' && !this.at('{')) { end = this.cur.e; this.next(); }
      this.mark(start, end);
    }
    if (this.at('{')) this.parseClassBody();
  }

  private parseClassBody(): void {
    this.next(); // {
    while (!this.at('}') && this.cur.k !== 'eof') {
      if (this.at(';')) { this.next(); continue; }
      const before = this.i;
      this.parseClassMember();
      if (this.i === before) this.next();
    }
    if (this.at('}')) this.next();
  }

  private parseClassMember(): void {
    const start = this.cur.s;
    // decorators `@expr(...)`
    while (this.at('@')) { this.next(); this.parsePostfix(); }
    // `abstract`/`declare` members are declaration-only: erase the whole member
    let k = 0;
    let decl = false;
    while (MODIFIERS.has(this.peek(k).v) && this.peek(k).k === 'ident') {
      if (this.peek(k).v === 'abstract' || this.peek(k).v === 'declare') decl = true;
      k++;
    }
    // an index signature `[k: string]: T` is declaration-only too
    if (this.at('[') && this.peek(1).k === 'ident' && this.peek(2).v === ':') decl = true;
    if (decl) {
      const end = this.endOfStatement();
      this.mark(start, end);
      return;
    }
    while (MODIFIERS.has(this.cur.v) && this.cur.k === 'ident') {
      // `static`/`accessor` are real JS and stay; the rest are TS-only
      if (this.cur.v === 'static' || this.cur.v === 'accessor') this.next();
      else { this.markTok(this.cur, this.cur.e); this.next(); }
    }
    if (this.at('async')) this.next();
    if (this.at('*')) this.next();
    if (this.at('get') || this.at('set')) {
      if (this.peek(1).v !== '(' && this.peek(1).v !== ':' && this.peek(1).v !== '=' && this.peek(1).v !== ';') this.next();
    }
    // name
    let memberName = '';
    if (this.at('[')) this.skipBalanced('[', ']');
    else if (this.cur.k === 'ident' || this.cur.k === 'str' || this.cur.k === 'num' || this.cur.v === 'private') {
      memberName = this.cur.k === 'ident' ? this.cur.v : '';
      this.next();
    }
    if (this.at('?')) { this.markTok(this.cur, this.cur.e); this.next(); }
    if (this.at('!')) { this.markTok(this.cur, this.cur.e); this.next(); }

    let kind: 'method' | 'field' = 'field';
    if (this.at('<')) { const s = this.cur.s; const e = this.parseTypeParams(); this.mark(s, e); }
    let methodName = '';
    if (this.at('(')) { kind = 'method'; this.parseParamList(memberName === 'constructor'); }
    if (this.at(':')) { const colon = this.next(); const end = this.parseType(); this.mark(colon.s, end); }
    // body / initializer
    if (this.at('{')) { this.parseBlock(); return; }
    if (this.at('=')) { this.next(); this.parseAssign(); }
    if (this.at(';')) { const x = this.next(); if (kind === 'method') this.mark(start, x.e); return; }
    if (this.cur.nl || this.cur.k === 'eof') { if (kind === 'method') this.mark(start, this.cur.s); return; }
    if (kind === 'method') {
      // e.g. `m(): void` with no body, followed by another member
      this.mark(start, this.cur.s);
    }
  }

  // --- output --------------------------------------------------------------
  run(): string {
    this.parseProgram();
    return applyBlanks(this.code, this.blanks);
  }

  /** Strip a nested range (e.g. a template substitution) and fold its blanks. */
  stripSub(start: number, end: number): void {
    const sub = new Stripper(this.code, scan(this.code, start, end), this.err);
    sub.parseProgram();
    for (const [a, b] of sub.blanks) this.blanks.push([a, b]);
  }
}

const MODIFIERS = new Set([
  'public', 'private', 'protected', 'readonly', 'abstract', 'declare',
  'override',
]);

const BINOP: Record<string, number> = {
  '??': 1, '||': 2, '&&': 3, '|': 4, '^': 5, '&': 6,
  '==': 8, '!=': 8, '===': 8, '!==': 8,
  '<': 9, '>': 9, '<=': 9, '>=': 9, in: 9, instanceof: 9,
  '<<': 10, '>>': 10, '>>>': 10,
  '+': 11, '-': 11,
  '*': 12, '/': 12, '%': 12,
  '**': 13,
};

/** Tokens that can begin a primary expression — used to decide when `expr < T >`
 *  should fall back to a comparison instead of an instantiation expression. */
function canStartPrimary(t: Tok): boolean {
  if (t.k === 'ident') {
    if (t.v === 'as' || t.v === 'satisfies') return false;
    return true;
  }
  if (t.k === 'num' || t.k === 'str' || t.k === 'regex') return true;
  if (t.k === 'punct') {
    return t.v === '[' || t.v === '{' || t.v === '(' || t.v === '+' || t.v === '-' ||
      t.v === '!' || t.v === '~' || t.v === '#' || t.v === '...';
  }
  return false;
}

function startsStatement(t: Tok): boolean {
  if (t.k === 'ident') {
    return KEYWORDS.has(t.v) || true; // any identifier may start an expression statement
  }
  return t.v === '[' || t.v === '{' || t.v === '(' || t.v === ';';
}

/** The whitespace character amaro/SWC emits for a blanked character, chosen so
 *  the replacement has the **same UTF-8 byte length** (this is what keeps byte
 *  offsets — and therefore source maps — stable): 1 -> ' ', 2 -> U+00A0,
 *  3 -> U+2002, 4 -> U+FEFF + ' ' (which is 4 bytes / 2 UTF-16 units, matching
 *  an astral character). Real whitespace (`\n`, `\r`, `\t`, ...) is kept as-is. */
function blankChar(cp: number): string {
  if (cp === 10 || cp === 13 || cp === 9 || cp === 12 || cp === 11 || cp === 32) {
    return String.fromCodePoint(cp);
  }
  const bytes = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  if (bytes === 1) return ' ';
  if (bytes === 2) return '\u00a0';
  if (bytes === 3) return '\u2002';
  return ' \uFEFF';
}

/** Replace every blanked character with a byte-width-preserving space. */
function applyBlanks(code: string, ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return code;
  const merged: Array<[number, number]> = [];
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: string[] = [];
  let cursor = 0;
  for (const [a, b] of merged) {
    if (a > cursor) out.push(code.slice(cursor, a));
    let i = a;
    while (i < b) {
      const cp = code.codePointAt(i) as number;
      out.push(blankChar(cp));
      i += cp > 0xffff ? 2 : 1;
    }
    cursor = b;
  }
  if (cursor < code.length) out.push(code.slice(cursor));
  return out.join('');
}

/** Public entry: strip TypeScript types (strip-only). `code` is unchanged in
 *  length; only type-bearing spans become whitespace. */
export function stripTypeScriptTypesCore(code: string, sourceUrl: string, err: StripTypeScriptErrors): string {
  const stripper = new Stripper(code, scan(code, 0, code.length), err);
  // fold template substitutions first, then the program
  for (const t of stripper['toks'] as Tok[]) {
    if (t.k === 'tpl' && t.subs) {
      for (const [a, b] of t.subs) stripper.stripSub(a, b);
    }
  }
  const out = stripper.run();
  if (sourceUrl) return `${out}\n\n//# sourceURL=${sourceUrl}`;
  return out;
}
