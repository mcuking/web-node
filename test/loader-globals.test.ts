import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * A module's own top-level lexical declarations must not collide with the
 * globals the loader injects as wrapper parameters. `topLevelLexicalBindings`
 * catches the common `const Buffer = …` shape, but destructuring like
 * `const { Buffer } = require('buffer')` slips past it — the compiler then
 * reports `Identifier 'Buffer' has already been declared`, and `loadModule`
 * drops the named parameter and retries.
 *
 * Vite's bundled chunks hit exactly this (`const { Buffer } = require('buffer')`
 * and `let WebSocket = class WebSocket …`), so it is worth pinning down.
 */
async function run(source: string): Promise<{ out: string; err: string }> {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(source));
  const out: string[] = [];
  const err: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: (c) => err.push(c),
  });
  runtime.runMain('/project/index.js');
  return { out: out.join(''), err: err.join('') };
}

describe('loader: injected globals vs module-local declarations', () => {
  it('supports destructuring a shadowed global out of require()', async () => {
    const { out } = await run(`
const { Buffer } = require('buffer');
process.stdout.write(Buffer.from('abc').toString('hex'));
`);
    expect(out).toBe('616263');
  });

  it('supports a shadowed class declaration (Vite chunk style)', async () => {
    const { out } = await run(`
let WebSocket = class WebSocket { constructor() { this.kind = 'ws'; } };
process.stdout.write(new WebSocket().kind);
`);
    expect(out).toBe('ws');
  });

  it('still throws for unrelated compile errors', async () => {
    await expect(run('const x = ;')).rejects.toThrow();
  });
});
