import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `readline` used to be an unsupported module (every property threw). It is now
 * Node's real `lib/readline.js` + `lib/internal/readline/{interface,
 * emitKeypressEvents,promises}.js` + `lib/readline/promises.js` (plus
 * `internal/repl/history`, for terminal-mode history), i.e. the whole module is
 * vendored source. It runs on streams only, so a tab can use all of it — a
 * "terminal" is just `{ input, output }` with `terminal: true`, not a real TTY.
 *
 * Expected output was read off Node v26.9.0 first (the `r1`/`r2` probes in the
 * milestone notes).
 */
function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require.bind(runtime.realm) as (id: string) => any;
}

/** A Writable that records everything written to it, as the `output` half. */
function sink(req: (id: string) => any) {
  const chunks: string[] = [];
  const { Writable } = req('stream');
  const stream = new Writable({
    write(c: { toString(): string }, _e: string, cb: () => void) {
      chunks.push(c.toString());
      cb();
    },
  });
  return { stream, text: () => chunks.join('') };
}

const tick = (ms = 20): Promise<void> => new Promise((res) => setTimeout(res, ms));

describe('vendored: readline', () => {
  it('exposes the real public surface, and readline/promises is a distinct module', () => {
    const req = boot();
    const rl = req('readline');
    const rlp = req('readline/promises');
    expect(Object.keys(rl).sort().join(',')).toBe(
      'Interface,clearLine,clearScreenDown,createInterface,cursorTo,emitKeypressEvents,moveCursor,promises',
    );
    expect(Object.keys(rlp).sort().join(',')).toBe('Interface,Readline,createInterface');
    expect(rl.promises).toBe(rlp);
    // readline/promises has its own Interface; it is *not* a subclass of the
    // plain one (the promise API lives in `internal/readline/promises`).
    expect(rlp.Interface).not.toBe(rl.Interface);
    const i = rlp.createInterface({ input: req('stream').Readable.from([]), terminal: false });
    expect(i instanceof rlp.Interface).toBe(true);
    expect(i instanceof rl.Interface).toBe(false);
    i.close();
  });

  it('emits lines across chunk boundaries and closes when the input ends', async () => {
    const req = boot();
    const rl = req('readline');
    const { Readable } = req('stream');
    const input = Readable.from(['a', 'b\nc\n', 'd']);
    const i = rl.createInterface({ input, terminal: false, crlfDelay: 20 });
    const lines: string[] = [];
    i.on('line', (l: string) => lines.push(l));
    await new Promise<void>((res) => i.on('close', res));
    // 'd' is the trailing partial line: it is flushed on close.
    expect(lines).toEqual(['ab', 'c', 'd']);
    expect(i.closed).toBe(true);
  });

  it('question() writes the prompt and resolves with the answer', async () => {
    const req = boot();
    const rl = req('readline');
    const { Readable } = req('stream');
    const out = sink(req);
    const i = rl.createInterface({ input: Readable.from(['tang\n']), output: out.stream, terminal: false });
    const answer = await new Promise<string>((res) => i.question('who? ', res));
    expect(answer).toBe('tang');
    expect(out.text()).toBe('who? ');
    expect(i.getPrompt()).toBe('> ');
    i.close();
  });

  it('is async-iterable, yielding one line at a time', async () => {
    const req = boot();
    const rl = req('readline');
    const { Readable } = req('stream');
    const i = rl.createInterface({ input: Readable.from(['x\ny\nz\n']), terminal: false });
    const seen: string[] = [];
    for await (const line of i) seen.push(line);
    expect(seen).toEqual(['x', 'y', 'z']);
  });

  it('cursor helpers are real ANSI writers', () => {
    const req = boot();
    const rl = req('readline');
    const { Readable } = req('stream');
    const out = sink(req);
    const i = rl.createInterface({ input: new Readable({ read() {} }), output: out.stream, terminal: false });
    rl.cursorTo(out.stream, 3, 2);
    expect(out.text()).toBe('\u001b[3;4H');
    rl.moveCursor(out.stream, -1, 1);
    expect(out.text()).toBe('\u001b[3;4H\u001b[1D\u001b[1B');
    rl.clearLine(out.stream, 0);
    expect(out.text()).toBe('\u001b[3;4H\u001b[1D\u001b[1B\u001b[2K');
    rl.clearScreenDown(out.stream);
    expect(out.text()).toBe('\u001b[3;4H\u001b[1D\u001b[1B\u001b[2K\u001b[0J');
    i.close();
  });

  it('prompt()/setPrompt() write the prompt but not typed input when not a terminal', () => {
    const req = boot();
    const rl = req('readline');
    const { Readable } = req('stream');
    const out = sink(req);
    const i = rl.createInterface({ input: new Readable({ read() {} }), output: out.stream, terminal: false });
    i.setPrompt('> ');
    i.prompt();
    i.write('hello');
    expect(out.text()).toBe('> ');
    i.close();
  });

  it('parses escape sequences into keypress events', async () => {
    const req = boot();
    const rl = req('readline');
    const { Readable } = req('stream');
    const input = new Readable({ read() {} });
    rl.emitKeypressEvents(input);
    const Buffer = req('buffer').Buffer;
    const keys: unknown[][] = [];
    input.on('keypress', (s: string, k: Record<string, unknown>) =>
      keys.push([s, k?.name, k?.ctrl, k?.shift, k?.meta]),
    );
    for (const seq of ['a', '\u001b[A', '\u0003', 'A', '\u001b[1;5C']) input.push(Buffer.from(seq));
    await tick();
    expect(keys).toEqual([
      ['a', 'a', false, false, false],
      [undefined, 'up', false, false, false],
      ['\u0003', 'c', true, false, false],
      ['A', 'a', false, true, false],
      [undefined, 'right', true, false, false],
    ]);
  });

  it('readline/promises resolves question() and echoes the prompts', async () => {
    const req = boot();
    const rlp = req('readline/promises');
    const { Readable } = req('stream');
    const out = sink(req);
    const input = new Readable({ read() {} });
    const i = rlp.createInterface({ input, output: out.stream, terminal: false });
    const Buffer = req('buffer').Buffer;
    const p1 = i.question('q1? ');
    input.push(Buffer.from('first\n'));
    expect(await p1).toBe('first');
    const p2 = i.question('q2? ');
    input.push(Buffer.from('second\n'));
    expect(await p2).toBe('second');
    expect(out.text()).toBe('q1? q2? ');
    i.close();
  });

  it('echoes lines and keeps a bounded history in terminal mode', async () => {
    const req = boot();
    const rl = req('readline');
    const { Readable } = req('stream');
    const out = sink(req);
    const input = new Readable({ read() {} });
    const i = rl.createInterface({ input, output: out.stream, terminal: true, historySize: 5 });
    const Buffer = req('buffer').Buffer;
    const lines: string[] = [];
    i.on('line', (l: string) => lines.push(l));
    input.push(Buffer.from('one\ntwo\n'));
    await tick();
    expect(lines).toEqual(['one', 'two']);
    // Most recent first, and the echo includes the line + CRLF the terminal writes.
    expect(i.history).toEqual(['two', 'one']);
    expect(out.text()).toContain('one\r\n');
    i.close();
  });
});
