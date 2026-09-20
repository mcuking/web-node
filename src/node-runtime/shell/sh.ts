/**
 * A deliberately small shell.
 *
 * npm runs lifecycle scripts through a shell (`sh -c "<script>"`), and `exec`
 * does the same, so a spawn surface without one could only ever run single
 * commands. This implements the subset those paths actually use and refuses
 * everything else *by name*, rather than half-executing it:
 *
 *   supported    quoting ('…', "…", \\ escapes), `$VAR` / `${VAR}` expansion,
 *                `;` `&&` `||`, `|`, `>` `>>` `<` `2>`, leading `VAR=value`
 *                assignments, `#` comments, and the builtins `cd` `pwd` `echo`
 *                `true` `false` `exit`
 *
 *   refused      `$(…)` and backticks, subshells, process substitution,
 *                globbing, background `&`, here-documents, `export`/`unset`,
 *                job control
 *
 * Two semantic simplifications are worth stating plainly, because both would be
 * invisible until they mattered:
 *
 *   1. **Pipelines run stage by stage, not concurrently.** Each stage's stdout
 *      is buffered and handed to the next stage as its stdin. Output is
 *      identical; streaming and backpressure between stages are not modelled,
 *      so `yes | head` would never terminate.
 *   2. **There is no `~` expansion and no globbing** — `*.js` reaches the
 *      program as the literal `*.js`.
 */

import type { Vfs } from '../vfs';
import * as p from '../vfs/posix';
import type { ProcessHost, SpawnRequest } from '../proc/host';
import { SpawnError } from '../proc/host';

/** The script is not valid in this subset (a syntax error, in shell terms). */
export class ShellSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellSyntaxError';
  }
}

/** The script is valid but uses a feature this shell deliberately omits. */
export class ShellUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellUnsupportedError';
  }
}

interface WordPart {
  text: string;
  /** Literal text (from quotes or escapes) is never expanded. */
  quoted: boolean;
}

export interface Word {
  parts: WordPart[];
}

interface Redirect {
  fd: number;
  op: '>' | '>>' | '<';
  word: Word;
}

interface SimpleCommand {
  words: Word[];
  redirects: Redirect[];
}

type Pipeline = SimpleCommand[];

interface ListItem {
  join: 'always' | 'and' | 'or';
  pipeline: Pipeline;
}

export interface Script {
  items: ListItem[];
}

type Token = { type: 'word'; word: Word } | { type: 'op'; op: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const EMPTY = new Uint8Array(0);

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function isNameStart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_]/.test(ch);
}

function isNameChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/** Split a script into words and operators. */
export function tokenize(script: string): Token[] {
  const tokens: Token[] = [];
  let current: Word | null = null;
  let i = 0;

  const pushPart = (text: string, quoted: boolean): void => {
    if (!current) current = { parts: [] };
    current.parts.push({ text, quoted });
  };
  const endWord = (): void => {
    if (current) tokens.push({ type: 'word', word: current });
    current = null;
  };
  const pushOp = (op: string, length: number): void => {
    endWord();
    tokens.push({ type: 'op', op });
    i += length;
  };

  /**
   * Text lifted out of double quotes is literal except for `$…`, so it is split
   * into alternating literal / expandable parts.
   */
  const pushExpandable = (text: string): void => {
    let index = 0;
    while (index < text.length) {
      if (text[index] === '$' && isNameStart(text[index + 1])) {
        let end = index + 1;
        while (isNameChar(text[end])) end += 1;
        pushPart(text.slice(index, end), false);
        index = end;
        continue;
      }
      if (text[index] === '$' && text[index + 1] === '{') {
        const close = text.indexOf('}', index + 2);
        if (close === -1) throw new ShellSyntaxError('unterminated ${…}');
        pushPart(text.slice(index, close + 1), false);
        index = close + 1;
        continue;
      }
      let literal = index;
      while (literal < text.length && text[literal] !== '$') literal += 1;
      pushPart(text.slice(index, literal), true);
      index = literal;
    }
  };

  while (i < script.length) {
    const ch = script[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      endWord();
      i += 1;
      continue;
    }

    // A `#` only starts a comment where a word would start.
    if (ch === '#' && current === null) {
      while (i < script.length && script[i] !== '\n') i += 1;
      continue;
    }

    if (ch === "'") {
      const end = script.indexOf("'", i + 1);
      if (end === -1) throw new ShellSyntaxError('unterminated single-quoted string');
      pushPart(script.slice(i + 1, end), true);
      i = end + 1;
      continue;
    }

    if (ch === '"') {
      let text = '';
      i += 1;
      while (i < script.length && script[i] !== '"') {
        if (script[i] === '\\' && i + 1 < script.length) {
          const next = script[i + 1];
          if (next === '"' || next === '\\' || next === '$' || next === '\n') {
            text += next;
            i += 2;
            continue;
          }
        }
        text += script[i];
        i += 1;
      }
      if (i >= script.length) throw new ShellSyntaxError('unterminated double-quoted string');
      i += 1;
      pushExpandable(text);
      continue;
    }

    if (ch === '\\') {
      if (i + 1 >= script.length) throw new ShellSyntaxError('trailing backslash');
      pushPart(script[i + 1], true);
      i += 2;
      continue;
    }

    if (ch === '`') throw new ShellUnsupportedError('the shell does not support backticks');
    if (ch === '&' && script[i + 1] === '&') {
      pushOp('&&', 2);
      continue;
    }
    if (ch === '&') throw new ShellUnsupportedError('the shell does not support background jobs');
    if (ch === '|' && script[i + 1] === '|') {
      pushOp('||', 2);
      continue;
    }
    if ((ch === '(' || ch === ')') && current === null) {
      throw new ShellUnsupportedError(`the shell does not support subshells ("${ch}")`);
    }
    if (ch === '$' && script[i + 1] === '(') {
      throw new ShellUnsupportedError('the shell does not support command substitution "$(…)"');
    }
    if (ch === '$' && script[i + 1] === '{') {
      const close = script.indexOf('}', i + 2);
      if (close === -1) throw new ShellSyntaxError('unterminated ${…}');
      pushPart(script.slice(i, close + 1), false);
      i = close + 1;
      continue;
    }
    if (ch === '$' && isNameStart(script[i + 1])) {
      let end = i + 1;
      while (isNameChar(script[end])) end += 1;
      pushPart(script.slice(i, end), false);
      i = end;
      continue;
    }

    // `2>` is a redirection only at a token boundary (`echo x2>y` writes "x2").
    if (current === null && script.startsWith('2>>', i)) {
      pushOp('2>>', 3);
      continue;
    }
    if (current === null && script.startsWith('2>', i)) {
      pushOp('2>', 2);
      continue;
    }
    if (script.startsWith('>>', i)) {
      pushOp('>>', 2);
      continue;
    }
    if (ch === '>' || ch === '<' || ch === '|' || ch === ';') {
      pushOp(ch, 1);
      continue;
    }
    if ((ch === '{' || ch === '}') && current === null) {
      throw new ShellUnsupportedError(`the shell does not support group commands ("${ch}")`);
    }

    pushPart(ch, false);
    i += 1;
  }

  endWord();
  return tokens;
}

/** Parse a script into the tiny AST the runner walks. */
export function parse(script: string): Script {
  const tokens = tokenize(script);
  const items: ListItem[] = [];
  let join: ListItem['join'] = 'always';
  let pipeline: Pipeline = [];
  let command: SimpleCommand = { words: [], redirects: [] };

  const endCommand = (): void => {
    if (command.words.length > 0 || command.redirects.length > 0) pipeline.push(command);
    command = { words: [], redirects: [] };
  };
  const endPipeline = (): void => {
    endCommand();
    if (pipeline.length > 0) items.push({ join, pipeline });
    pipeline = [];
    join = 'always';
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'word') {
      command.words.push(token.word);
      continue;
    }
    switch (token.op) {
      case '|':
        endCommand();
        break;
      case ';':
        endPipeline();
        break;
      case '&&':
        endPipeline();
        join = 'and';
        break;
      case '||':
        endPipeline();
        join = 'or';
        break;
      case '>':
      case '>>':
      case '2>':
      case '2>>':
      case '<': {
        const target = tokens[index + 1];
        if (!target || target.type !== 'word') throw new ShellSyntaxError(`"${token.op}" needs a file name`);
        index += 1;
        const fd = token.op.startsWith('2') ? 2 : token.op === '<' ? 0 : 1;
        const op: Redirect['op'] = token.op === '<' ? '<' : token.op.endsWith('>>') ? '>>' : '>';
        command.redirects.push({ fd, op, word: target.word });
        break;
      }
      default:
        throw new ShellUnsupportedError(`the shell does not support "${token.op}"`);
    }
  }
  endPipeline();
  return { items };
}

/** Expand a word against an environment (`"$a"` stays literal, `$a` does not). */
export function expandWord(word: Word, env: Record<string, string>): string {
  let out = '';
  for (const part of word.parts) {
    out += part.quoted ? part.text : expandVariables(part.text, env);
  }
  return out;
}

function expandVariables(text: string, env: Record<string, string>): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '$') {
      out += text[i];
      i += 1;
      continue;
    }
    if (text[i + 1] === '{') {
      const close = text.indexOf('}', i + 2);
      if (close === -1) throw new ShellSyntaxError('unterminated ${…}');
      out += env[text.slice(i + 2, close)] ?? '';
      i = close + 1;
      continue;
    }
    let end = i + 1;
    while (isNameChar(text[end])) end += 1;
    if (end === i + 1) {
      // A lone `$` is literal in POSIX shells.
      out += '$';
      i += 1;
      continue;
    }
    out += env[text.slice(i + 1, end)] ?? '';
    i = end;
  }
  return out;
}

export interface ShellOptions {
  host: ProcessHost;
  vfs: Vfs;
  cwd: string;
  env: Record<string, string>;
  stdin?: Uint8Array | null;
  /** Applied to every program the script starts. */
  timeoutMs?: number;
  /** Called as output is produced, in addition to being buffered. */
  onOutput?(chunk: Uint8Array, stream: 'stdout' | 'stderr'): void;
}

export interface ShellResult {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
  /** The shell's working directory after the script ran (`cd` persists). */
  cwd: string;
  /** The shell's environment after the script ran (assignments persist). */
  env: Record<string, string>;
}

/** Thrown by the `exit` builtin to unwind the script. */
class ShellExit {
  code: number;
  constructor(code: number) {
    this.code = code;
  }
}

/** `command not found` is exit 127 in every POSIX shell. */
const EXIT_NOT_FOUND = 127;

interface ShellState {
  cwd: string;
  env: Record<string, string>;
}

interface StageOutcome {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

/** A command after expansion: what to run, with what, and against what. */
interface PreparedCommand {
  empty: boolean;
  name: string;
  args: string[];
  env: Record<string, string>;
  stdin: Uint8Array | null;
}

const BUILTINS = new Set(['cd', 'pwd', 'echo', 'true', 'false', 'exit']);

/** Run a script. */
export async function runShell(script: string, options: ShellOptions): Promise<ShellResult> {
  return runParsed(parse(script), options);
}

/**
 * Shared by the sync and async entry points so both interpret `VAR=value`,
 * builtins and redirections identically.
 */
class ShellRunner {
  #options: ShellOptions;
  #state: ShellState;
  #stdout: Uint8Array[] = [];
  #stderr: Uint8Array[] = [];

  constructor(options: ShellOptions) {
    this.#options = options;
    // npm prepends every reachable `node_modules/.bin` to PATH before handing a
    // lifecycle script to the shell; doing the same is what makes `esbuild`
    // resolve to a local bin instead of "command not found".
    this.#state = { cwd: options.cwd, env: prepareEnv(options.env, options.cwd) };
  }

  get state(): ShellState {
    return this.#state;
  }

  get stdout(): Uint8Array {
    return concatChunks(this.#stdout);
  }

  get stderr(): Uint8Array {
    return concatChunks(this.#stderr);
  }

  #emit(chunk: Uint8Array, stream: 'stdout' | 'stderr'): void {
    (stream === 'stdout' ? this.#stdout : this.#stderr).push(chunk);
    this.#options.onOutput?.(chunk, stream);
  }

  async run(ast: Script): Promise<ShellResult> {
    let code = 0;
    try {
      for (const item of ast.items) {
        if (item.join === 'and' && code !== 0) continue;
        if (item.join === 'or' && code === 0) continue;
        const outcome = await this.#pipeline(item.pipeline, null);
        code = outcome.code;
        if (outcome.stdout.length > 0) this.#emit(outcome.stdout, 'stdout');
        if (outcome.stderr.length > 0) this.#emit(outcome.stderr, 'stderr');
      }
    } catch (err) {
      code = this.#absorb(err);
    }
    return this.#result(code);
  }

  runSync(ast: Script): ShellResult {
    let code = 0;
    try {
      if (ast.items.length !== 1 || ast.items[0].pipeline.length !== 1) {
        throw new ShellUnsupportedError(
          'synchronous execution supports a single command only; use the asynchronous API for pipelines or sequences',
        );
      }
      const outcome = this.#commandSync(ast.items[0].pipeline[0]);
      code = outcome.code;
      if (outcome.stdout.length > 0) this.#emit(outcome.stdout, 'stdout');
      if (outcome.stderr.length > 0) this.#emit(outcome.stderr, 'stderr');
    } catch (err) {
      code = this.#absorb(err);
    }
    return this.#result(code);
  }

  /** Turn an exception into an exit code, printing it like a shell would. */
  #absorb(err: unknown): number {
    if (err instanceof ShellExit) return err.code;
    if (err instanceof ShellSyntaxError || err instanceof ShellUnsupportedError) {
      this.#emit(encoder.encode(`sh: ${err.message}\n`), 'stderr');
      return 2;
    }
    if (err instanceof SpawnError && err.code === 'ENOENT') {
      this.#emit(encoder.encode('sh: command not found\n'), 'stderr');
      return EXIT_NOT_FOUND;
    }
    this.#emit(encoder.encode(`sh: ${err instanceof Error ? err.message : String(err)}\n`), 'stderr');
    return 1;
  }

  #result(code: number): ShellResult {
    return { code, stdout: this.stdout, stderr: this.stderr, cwd: this.#state.cwd, env: this.#state.env };
  }

  // ---- pipelines --------------------------------------------------------

  async #pipeline(pipeline: Pipeline, pipelineStdin: Uint8Array | null): Promise<StageOutcome> {
    let stdin = pipelineStdin;
    let outcome: StageOutcome = { code: 0, stdout: EMPTY, stderr: EMPTY };
    const stderrChunks: Uint8Array[] = [];
    for (let index = 0; index < pipeline.length; index += 1) {
      const command = pipeline[index];
      const last = index === pipeline.length - 1;
      if (!last && command.redirects.length > 0) {
        throw new ShellUnsupportedError('redirection is only supported on the last command of a pipeline');
      }
      outcome = await this.#command(command, stdin);
      if (outcome.stderr.length > 0) stderrChunks.push(outcome.stderr);
      stdin = outcome.stdout;
    }
    return this.#applyRedirect(pipeline[pipeline.length - 1], {
      ...outcome,
      stderr: concatChunks(stderrChunks),
    });
  }

  #commandSync(command: SimpleCommand): StageOutcome {
    const parsed = this.#prepare(command);
    if (parsed.empty) return { code: 0, stdout: EMPTY, stderr: EMPTY };
    const builtin = this.#runBuiltin(parsed);
    if (builtin) return this.#applyRedirect(command, builtin);

    const result = this.#options.host.runSync({
      command: parsed.name,
      args: parsed.args,
      cwd: this.#state.cwd,
      env: parsed.env,
      stdin: parsed.stdin,
      timeoutMs: this.#options.timeoutMs,
    });
    return this.#applyRedirect(command, { code: result.code ?? 0, stdout: result.stdout, stderr: result.stderr });
  }

  async #command(command: SimpleCommand, stdin: Uint8Array | null): Promise<StageOutcome> {
    const parsed = this.#prepare(command, stdin);
    if (parsed.empty) return { code: 0, stdout: EMPTY, stderr: EMPTY };
    const builtin = this.#runBuiltin(parsed);
    if (builtin) return builtin;

    try {
      const result = await this.#options.host.run({
        command: parsed.name,
        args: parsed.args,
        cwd: this.#state.cwd,
        env: parsed.env,
        stdin: parsed.stdin,
        timeoutMs: this.#options.timeoutMs,
      });
      if (result.signal) {
        return {
          code: 128,
          stdout: result.stdout,
          stderr: concatChunks([result.stderr, encoder.encode(`sh: ${parsed.name} terminated by ${result.signal}\n`)]),
        };
      }
      return { code: result.code ?? 0, stdout: result.stdout, stderr: result.stderr };
    } catch (err) {
      if (err instanceof SpawnError && err.code === 'ENOENT') {
        return { code: EXIT_NOT_FOUND, stdout: EMPTY, stderr: encoder.encode(`sh: ${parsed.name}: command not found\n`) };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { code: 126, stdout: EMPTY, stderr: encoder.encode(`sh: ${parsed.name}: ${message}\n`) };
    }
  }

  /** Expand the words, peel off assignments and redirections. */
  #prepare(command: SimpleCommand, pipelineStdin: Uint8Array | null = null): PreparedCommand {
    const words = command.words.map((w) => expandWord(w, this.#state.env));
    let consumed = 0;
    const assignments: Record<string, string> = {};
    while (consumed < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[consumed])) {
      const eq = words[consumed].indexOf('=');
      assignments[words[consumed].slice(0, eq)] = words[consumed].slice(eq + 1);
      consumed += 1;
    }
    if (consumed >= words.length) {
      // `FOO=bar` alone sets the variable for the rest of the script.
      Object.assign(this.#state.env, assignments);
      return { empty: true, name: '', args: [], env: this.#state.env, stdin: null };
    }

    let stdin = pipelineStdin;
    const inputRedirect = command.redirects.find((r) => r.fd === 0);
    if (inputRedirect) {
      const from = p.resolve(this.#state.cwd, expandWord(inputRedirect.word, this.#state.env));
      stdin = this.#options.vfs.exists(from) ? this.#options.vfs.readFile(from) : EMPTY;
    }

    const [name, ...args] = words.slice(consumed);
    return { empty: false, name, args, env: { ...this.#state.env, ...assignments }, stdin };
  }

  #runBuiltin(parsed: PreparedCommand): StageOutcome | null {
    if (!BUILTINS.has(parsed.name)) return null;
    if (parsed.name === 'exit') {
      // Unwinds the whole script, which is the only thing `exit` may do.
      const code = parsed.args[0] !== undefined ? Number(parsed.args[0]) : 0;
      throw new ShellExit(Number.isFinite(code) ? code : 0);
    }
    const write = (text: string): Uint8Array => encoder.encode(text);
    switch (parsed.name) {
      case 'cd': {
        const target = parsed.args[0] ?? this.#state.env.HOME ?? '/';
        this.#state.cwd = p.resolve(this.#state.cwd, target);
        return { code: 0, stdout: EMPTY, stderr: EMPTY };
      }
      case 'pwd':
        return { code: 0, stdout: write(this.#state.cwd + '\n'), stderr: EMPTY };
      case 'echo':
        return { code: 0, stdout: write(parsed.args.join(' ') + '\n'), stderr: EMPTY };
      case 'true':
        return { code: 0, stdout: EMPTY, stderr: EMPTY };
      case 'false':
        return { code: 1, stdout: EMPTY, stderr: EMPTY };
      default:
        return null;
    }
  }

  /** Apply the last command's stdout redirection, if any. */
  #applyRedirect(last: SimpleCommand | undefined, outcome: StageOutcome): StageOutcome {
    const redirect = last?.redirects.find((r) => r.fd !== 0);
    if (!redirect) return outcome;
    const target = p.resolve(this.#state.cwd, expandWord(redirect.word, this.#state.env));
    const existing =
      redirect.op === '>>' && this.#options.vfs.exists(target) ? this.#options.vfs.readFile(target) : EMPTY;
    this.#options.vfs.writeFile(target, concatChunks([existing, outcome.stdout]));
    return { ...outcome, stdout: EMPTY };
  }
}

async function runParsed(ast: Script, options: ShellOptions): Promise<ShellResult> {
  return new ShellRunner(options).run(ast);
}

/**
 * Synchronous shell execution, for `execSync`.
 *
 * Only the shape that can honestly be synchronous is accepted: one command,
 * possibly with a redirection. A pipeline or a sequence would need to await a
 * child, and a JavaScript stack cannot be blocked on a promise.
 */
export function runShellSync(script: string, options: ShellOptions): ShellResult {
  return new ShellRunner(options).runSync(parse(script));
}

function prepareEnv(env: Record<string, string>, cwd: string): Record<string, string> {
  const out = { ...env };
  const binDirs: string[] = [];
  const dirs = p.segments(cwd);
  for (let i = dirs.length; i >= 0; i--) {
    binDirs.push('/' + dirs.slice(0, i).concat(['node_modules', '.bin']).join('/'));
  }
  out.PATH = [...binDirs, ...(env.PATH ? env.PATH.split(':') : [])].join(':');
  return out;
}

export { decoder as shellDecoder, encoder as shellEncoder };
