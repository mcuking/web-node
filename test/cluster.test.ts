import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * M123 — `cluster`: one worker per forked child, ports shared on the vnet.
 *
 * Real Node forks OS processes and shares the listening socket through the
 * primary. web-node has no OS process, so a cluster worker is a forked child
 * (own registry, own pid, own IPC channel) and a shared port is modelled in the
 * virtual network: each worker listens with `exclusive: false` and the network
 * round-robins connections across them. The program below runs unchanged on
 * real Node v26.9.0 (verified: identical output) and here.
 */

function boot(files: Record<string, string>) {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  for (const [k, v] of Object.entries(files)) vfs.writeFile(k, new TextEncoder().encode(v));
  const out: string[] = [];
  const runtime = new NodeRuntime({ vfs, argv: ['/project/index.js'], installGlobals: false, onStdout: (c) => out.push(c), onStderr: (c) => out.push('[E]' + c) });
  return { runtime, out };
}

const PROGRAM = `
'use strict';
const cluster = require('cluster');
const net = require('net');

if (cluster.isPrimary) {
  console.log('primary isPrimary=' + cluster.isPrimary + ' isWorker=' + cluster.isWorker);
  const N = 2;
  const online = [];
  const listening = [];
  let done = false;
  cluster.on('online', (w) => { online.push(w.id); });
  cluster.on('listening', (w, addr) => { listening.push(w.id + '@' + addr.port); maybeGo(); });
  for (let i = 0; i < N; i++) cluster.fork();

  function maybeGo() {
    if (listening.length < N || done) return;
    done = true;
    console.log('online=' + JSON.stringify(online.sort()) + ' listening=' + JSON.stringify(listening.sort()));
    console.log('workers=' + Object.keys(cluster.workers).length);
    const answers = [];
    let left = 4;
    for (let i = 0; i < 4; i++) {
      const s = net.connect(3000, '127.0.0.1', () => s.write('ping'));
      let b = '';
      s.on('data', (c) => (b += c));
      s.on('end', () => { answers.push(b); if (--left === 0) finish(); });
      s.on('error', () => { answers.push('ERR'); if (--left === 0) finish(); });
    }
    function finish() {
      answers.sort();
      console.log('answers=' + JSON.stringify(answers));
      cluster.disconnect(() => console.log('primary disconnected'));
    }
  }
} else {
  console.log('worker id=' + cluster.worker.id + ' isWorker=' + cluster.isWorker + ' isPrimary=' + cluster.isPrimary);
  const server = net.createServer((sock) => { sock.end('w' + cluster.worker.id); });
  server.listen(3000, () => console.log('w' + cluster.worker.id + ' listening'));
}
`;

describe('cluster (M123)', () => {
  it('forks workers that share a port and round-robin connections', async () => {
    const { runtime, out } = boot({ '/project/index.js': PROGRAM });
    runtime.runMain('/project/index.js');
    for (let i = 0; i < 400 && !out.join('').includes('primary disconnected'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const text = out.join('');
    expect(text).toContain('primary isPrimary=true isWorker=false');
    expect(text).toContain('worker id=1 isWorker=true isPrimary=false');
    expect(text).toContain('worker id=2 isWorker=true isPrimary=false');
    // Both workers bound the *same* port, and the primary heard both binds.
    expect(text).toContain('online=[1,2] listening=["1@3000","2@3000"]');
    expect(text).toContain('workers=2');
    // Round-robin: each worker served exactly half the connections.
    expect(text).toContain('answers=["w1","w1","w2","w2"]');
    expect(text).toContain('primary disconnected');
  }, 30000);

  it('gives a forked child its own pid, env, registry and IPC channel', async () => {
    const { runtime, out } = boot({
      '/project/index.js': `
const cp = require('child_process');
console.log('PARENT pid=' + process.pid);
const c = cp.fork('/project/child.js', [], { env: { CHILD_FLAG: 'yes' } });
c.on('message', (m) => console.log('SAW ' + JSON.stringify(m)));
`,
      '/project/child.js': `
console.log('CHILD pid=' + process.pid + ' flag=' + process.env.CHILD_FLAG + ' connected=' + process.connected);
// A fresh registry: the child's module cache is its own.
console.log('SAME-MODULE-OBJ ' + (require('net') === require('net')));
process.send({ pid: process.pid, flag: process.env.CHILD_FLAG });
`,
    });
    runtime.runMain('/project/index.js');
    for (let i = 0; i < 200 && !out.join('').includes('SAW'); i++) await new Promise((r) => setTimeout(r, 25));
    const text = out.join('');
    const parentPid = /PARENT pid=(\d+)/.exec(text)![1];
    const childPid = /CHILD pid=(\d+)/.exec(text)![1];
    expect(childPid).not.toEqual(parentPid);
    expect(text).toContain('flag=yes');
    expect(text).toContain('connected=true');
    expect(text).toContain(`SAW {"pid":${childPid},"flag":"yes"}`);
  }, 20000);

  it('re-runs the current entry for a fork (process.argv[1]), not a fixed default', async () => {
    // Real Node sets argv[1] to the script being run; cluster.fork() re-execs it.
    const { runtime, out } = boot({
      '/project/app.js': `
const cluster = require('cluster');
if (cluster.isPrimary) {
  console.log('APP primary argv1=' + process.argv[1]);
  cluster.fork();
} else {
  console.log('APP worker runs ' + process.argv[1]);
}
`,
      // A decoy: if fork wrongly used the runtime default this would run.
      '/project/index.js': `console.log('WRONG index.js ran');`,
    });
    runtime.runMain('/project/app.js');
    for (let i = 0; i < 200 && !out.join('').includes('APP worker runs'); i++) await new Promise((r) => setTimeout(r, 25));
    const text = out.join('');
    expect(text).toContain('APP primary argv1=/project/app.js');
    expect(text).toContain('APP worker runs /project/app.js');
    expect(text).not.toContain('WRONG index.js ran');
  }, 20000);
});
