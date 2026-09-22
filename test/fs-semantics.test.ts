import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require('fs') as any;
}

describe('fs semantics fixes', () => {
  it('mkdirSync(recursive) returns the first created dir; rmSync clears trees', () => {
    const fsMod = boot();
    expect(fsMod.mkdirSync('/project/a/b', { recursive: true })).toBe('/project/a');
    // The chain already exists now: nothing was created.
    expect(fsMod.mkdirSync('/project/a/b', { recursive: true })).toBeUndefined();
    fsMod.writeFileSync('/project/a/b/f.txt', 'x');
    expect(() => fsMod.rmSync('/project/a', { recursive: true })).not.toThrow();
    expect(fsMod.existsSync('/project/a')).toBe(false);
    // Without `force`, a missing path is an error; with it, a no-op.
    expect(() => fsMod.rmSync('/project/a')).toThrowError(/ENOENT/);
    expect(() => fsMod.rmSync('/project/a', { force: true })).not.toThrow();
  });

  it('copyFileSync honours COPYFILE_EXCL; ENOENT carries code/syscall/errno', () => {
    const fsMod = boot();
    fsMod.writeFileSync('/project/src.txt', 'data');
    fsMod.copyFileSync('/project/src.txt', '/project/dst.txt');
    expect(fsMod.readFileSync('/project/dst.txt', 'utf8')).toBe('data');
    let code = '';
    try {
      fsMod.copyFileSync('/project/src.txt', '/project/dst.txt', fsMod.constants.COPYFILE_EXCL);
    } catch (e: any) {
      code = e.code;
    }
    expect(code).toBe('EEXIST');

    try {
      fsMod.readFileSync('/project/nope.txt');
      throw new Error('expected a throw');
    } catch (e: any) {
      expect(e.code).toBe('ENOENT');
      expect(e.syscall).toBe('open');
      expect(e.errno).toBe(-2);
      expect(e.name).toBe('Error');
      expect(e.message).toMatch(/ENOENT: no such file or directory, open '\/project\/nope.txt'/);
    }
  });
});

/**
 * Differential test for `fs` semantics — same pattern as
 * test/http-semantics.test.ts. `tools/fs-semantics-probe.cjs` runs unchanged on
 * real Node (oracle -> test/fixtures/fs-semantics.json) and inside web-node;
 * the two JSON blobs must be equal.
 */
describe('fs semantics (differential vs real Node)', () => {
  it('matches the oracle byte-for-byte', async () => {
    const program = fs.readFileSync('tools/fs-semantics-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/fs-semantics.json', 'utf8'));

    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
    const out: string[] = [];
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: (c) => out.push(c),
      onStderr: () => {},
    });
    runtime.runMain('/project/index.js');

    let stdout = out.join('');
    for (let i = 0; i < 200 && !stdout.includes('__OBS__'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      stdout = out.join('');
    }
    const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
    expect(line, 'probe produced no observable line').toBeTruthy();
    expect(JSON.parse(line!.slice('__OBS__'.length))).toEqual(expected);
  });
});
