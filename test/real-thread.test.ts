import { describe, expect, it } from 'vitest';
import { Worker as NodeWorker } from 'node:worker_threads';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { applyVfsCall } from '../src/node-runtime/vfs/remote-server';
import { RemoteVfs } from '../src/node-runtime/vfs/remote';
import { RealWorker, realThreadsAvailable, type SpawnedThread } from '../src/node-runtime/proc/real-worker';
import { bootstrapThread } from '../src/node-runtime/proc/thread-bootstrap';
import type { WorkerRequest } from '../src/node-runtime/proc/worker';
import type { Realm } from '../src/node-runtime/realm';
import { NodeRuntime } from '../src/node-runtime/runtime';
import {
  VFS_OP,
  VFS_OP_BY_CODE,
  decodeFrame,
  encodeFrame,
  type ParentToThread,
  type ThreadToParent,
  type VfsCallMeta,
  type VfsResultMeta,
} from '../src/sync/thread-protocol';
import { CONTROL_BYTES, SyncChannel, SyncChannelError } from '../src/sync/sab-rpc';

/**
 * M147 Phase B: the real-thread worker.
 *
 * Two things are proven here:
 *
 *   1. The **parent handle** (`RealWorker`) against a genuine second thread
 *      (`node:worker_threads`): it serves the parent's VFS over the synchronous
 *      shared-memory channel, bridges `online`/`message`/`stdout`/`exit`, and
 *      tears down. The thread runs the raw protocol (it cannot import TS), which
 *      also re-checks the wire format from the other side.
 *   2. The **thread bootstrap** in isolation: it builds its own runtime over a
 *      `RemoteVfs`, installs the worker-side `worker_threads` view, and runs an
 *      entry that reports `isMainThread`/`workerData` and posts back to
 *      `parentPort`.
 */

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

/** Let a `MessagePort` deliver anything still queued (frames flush a tick later). */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

/**
 * A `Realm`-shaped object with just enough of `stream` for `RealWorker` to build
 * its stdio pipes, so the handle can be exercised without a full `NodeRuntime`.
 * The tests consume `stdout` (request.stdout is true), so no real stream is needed.
 */
class FakeReadable {
  #cbs: Array<(chunk: unknown) => void> = [];
  on(event: string, cb: (chunk: unknown) => void): this {
    if (event === 'data') this.#cbs.push(cb);
    return this;
  }
  push(chunk: unknown): boolean {
    for (const cb of this.#cbs) cb(chunk);
    return true;
  }
}
const nodeRealm = (): Realm =>
  ({ require: () => ({ Readable: FakeReadable, Writable: class {} }) }) as unknown as Realm;

/** A loopback `SyncChannel` standing in for the SAB transport (Phase A's trick). */
function loopback(vfs: MemoryVfs): SyncChannel {
  const adapter = {
    timeoutMs: 1000,
    call(op: number, payload: Uint8Array): Uint8Array {
      const { meta, body } = decodeFrame<VfsCallMeta>(payload);
      if (meta.op !== VFS_OP_BY_CODE[op]) throw new Error(`op mismatch: ${op} vs ${meta.op}`);
      try {
        return applyVfsCall(vfs, meta, body);
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        const wire = new SyncChannelError((err as Error).message, typeof code === 'string' ? code : 'ERR_WEB_NODE');
        if (err !== null && typeof err === 'object') Object.assign(wire, err);
        throw wire;
      }
    },
    close(): void {},
  };
  return adapter as unknown as SyncChannel;
}

function makeVfs(): MemoryVfs {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', enc('// entry\n'));
  vfs.writeFile('/project/data.txt', enc('from-parent-tree'));
  return vfs;
}

describe('realThreadsAvailable', () => {
  it('needs crossOriginIsolated and a Worker constructor', () => {
    expect(realThreadsAvailable({ crossOriginIsolated: true, Worker: function () {} })).toBe(true);
    expect(realThreadsAvailable({ crossOriginIsolated: false, Worker: function () {} })).toBe(false);
    expect(realThreadsAvailable({ crossOriginIsolated: true })).toBe(false);
    expect(realThreadsAvailable({})).toBe(false);
  });
});

/**
 * The raw protocol, in a real `node:worker_threads` thread.
 *
 * On the init message the thread reads `/project/data.txt` from the parent's
 * tree over the shared-memory channel and reports it back, then walks the
 * lifecycle. It speaks the frames directly, so this is an independent check of
 * `serveVfsChannel` + the framing from the caller side.
 */
const THREAD_SCRIPT = `
const { parentPort } = require('node:worker_threads');
const decoder = new TextDecoder();
const encoder = new TextEncoder();
parentPort.once('message', (init) => {
  const mp = init.messagePort;
  const h = new Int32Array(init.vfsControl);
  const H_STATE = 0, H_SEQ = 1, H_OP = 2, H_STATUS = 3, H_REQ_LEN = 4, H_RES_LEN = 5;
  let seq = 0;
  const call = (op, meta, body) => {
    body = body || new Uint8Array(0);
    const json = encoder.encode(JSON.stringify(meta));
    const payload = new Uint8Array(4 + json.length + body.length);
    new DataView(payload.buffer).setUint32(0, json.length, true);
    payload.set(json, 4);
    payload.set(body, 4 + json.length);
    const data = new SharedArrayBuffer(Math.max(payload.length, 8192));
    new Uint8Array(data).set(payload, 0);
    seq += 1;
    Atomics.store(h, H_SEQ, seq);
    Atomics.store(h, H_OP, op);
    Atomics.store(h, H_STATUS, 0);
    Atomics.store(h, H_REQ_LEN, payload.length);
    Atomics.store(h, H_RES_LEN, 0);
    Atomics.store(h, H_STATE, 1);
    Atomics.notify(h, H_STATE);
    init.vfsPort.postMessage({ seq, op, len: payload.length, data });
    const deadline = Date.now() + 3000;
    while (Atomics.load(h, H_STATE) !== 2) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('vfs call timed out');
      Atomics.wait(h, H_STATE, 1, left);
    }
    const status = Atomics.load(h, H_STATUS);
    const len = Atomics.load(h, H_RES_LEN);
    const bytes = new Uint8Array(data, 0, len).slice();
    if (status === 1) throw new Error('peer error: ' + decoder.decode(bytes));
    return bytes;
  };
  const readFrame = (bytes) => {
    const metaLen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
    const meta = JSON.parse(decoder.decode(bytes.slice(4, 4 + metaLen)));
    return { meta, body: bytes.subarray(4 + metaLen) };
  };
  mp.postMessage({ t: 'online' });
  try {
    const reply = readFrame(call(1, { op: 'readFile', path: '/project/data.txt' }));
    mp.postMessage({ t: 'message', value: { text: decoder.decode(reply.body), threadId: init.threadId } });
    mp.postMessage({ t: 'stdout', data: encoder.encode('thread says hi\\n') });
    // Wait briefly for a parent->thread message so the reverse path is covered.
    let sawParent = false;
    mp.onmessage = (ev) => {
      if (ev.data && ev.data.t === 'message') {
        sawParent = true;
        mp.postMessage({ t: 'message', value: { echoed: ev.data.value } });
      }
    };
    setTimeout(() => mp.postMessage({ t: 'exit', code: sawParent ? 7 : 3 }), 100);
  } catch (err) {
    mp.postMessage({ t: 'error', message: String(err && err.message || err) });
    mp.postMessage({ t: 'exit', code: 1 });
  }
});
`;

/** A `SpawnedThread` backed by a real `node:worker_threads` Worker. */
function nodeSpawn(): (request: WorkerRequest) => SpawnedThread {
  return () => {
    const worker = new NodeWorker(THREAD_SCRIPT, { eval: true }) as unknown as {
      postMessage(value: unknown, transfer?: unknown): void;
      terminate(): Promise<number>;
      on(event: string, cb: (value: any) => void): void;
    };
    return {
      postMessage: (value, transfer) => worker.postMessage(value, transfer),
      terminate: () => worker.terminate(),
      addEventListener: (type, cb) => {
        if (type === 'message') worker.on('message', (data) => cb({ data } as never));
        else if (type === 'error') worker.on('error', (error) => cb({ error, message: error?.message } as never));
        else if (type === 'messageerror') worker.on('messageerror', (error) => cb({ error } as never));
      },
    };
  };
}

function request(overrides: Partial<WorkerRequest> = {}): WorkerRequest {
  return {
    filename: '/project/index.js',
    workerData: { hello: 'world' },
    argv: ['/bin/node', '/project/index.js'],
    name: 'WorkerThread',
    env: { NODE_ENV: 'test' },
    execArgv: [],
    // Consume stdio on `worker.stdout`/`stderr` rather than forwarding it into
    // the test process's own output.
    stdout: true,
    stderr: true,
    ...overrides,
  };
}

/** Drive a RealWorker to completion, collecting everything it emits. */
function runReal(
  vfs: MemoryVfs,
  req: WorkerRequest,
  opts: { spawn?: (request: WorkerRequest) => SpawnedThread; poke?: (handle: RealWorker) => void } = {},
): Promise<{ messages: unknown[]; stdout: string; exits: number[]; events: string[] }> {
  return new Promise((resolve) => {
    const handle = new RealWorker(req, { vfs, realm: nodeRealm, spawn: opts.spawn ?? nodeSpawn() });
    const messages: unknown[] = [];
    const exits: number[] = [];
    const events: string[] = [];
    let stdout = '';
    (handle.stdout as { on(e: string, cb: (c: unknown) => void): void }).on('data', (chunk) => {
      stdout += dec(chunk as Uint8Array);
    });
    handle.onOnline(() => events.push('online'));
    handle.onMessage((m) => messages.push(m));
    handle.onError((e) => events.push(`error:${(e as Error).message}`));
    handle.onExit((code) => {
      exits.push(code);
      events.push(`exit:${code}`);
      resolve({ messages, stdout, exits, events });
    });
    handle.start(new Map());
    opts.poke?.(handle);
  });
}

describe('RealWorker over a real second thread', () => {
  it('serves the parent VFS and bridges online/message/stdout/exit', async () => {
    const vfs = makeVfs();
    const result = await runReal(vfs, request());
    expect(result.events[0]).toBe('online');
    expect(result.messages[0]).toEqual({ text: 'from-parent-tree', threadId: 2 });
    expect(result.stdout).toBe('thread says hi\n');
    // The thread waited for a parent->thread message that never came ⇒ code 3.
    expect(result.exits).toEqual([3]);
  });

  it('delivers a parent message into the thread and back', async () => {
    const vfs = makeVfs();
    const result = await runReal(vfs, request(), {
      // The thread reports exit 7 once it has seen a parent message.
      poke: (handle) => setTimeout(() => handle.postMessage({ ping: 42 }), 20),
    });
    await new Promise((r) => setTimeout(r, 5));
    // messages[0] is the read result; the echo arrives after the parent message.
    const echoed = result.messages.find((m) => m && typeof m === 'object' && 'echoed' in (m as object));
    expect(echoed).toEqual({ echoed: { ping: 42 } });
    expect(result.exits).toEqual([7]);
  });

  it('terminate() stops the worker and reports exit 1', async () => {
    const vfs = makeVfs();
    const result = await new Promise<{ exits: number[]; code: number | undefined }>((resolve) => {
      const handle = new RealWorker(request(), { vfs, realm: nodeRealm, spawn: nodeSpawn() });
      const exits: number[] = [];
      handle.onExit((code) => {
        exits.push(code);
        resolve({ exits, code });
      });
      handle.start(new Map());
      void handle.terminate();
    });
    expect(result.exits).toEqual([1]);
  });
});

describe('bootstrapThread in isolation', () => {
  function bootWorker(entry: string): {
    frames: ThreadToParent[];
    done: Promise<number>;
    port: MessagePort;
    runtime: NodeRuntime;
  } {
    const vfs = makeVfs();
    vfs.writeFile('/project/index.js', enc(entry));
    const { port1, port2 } = new MessageChannel();
    const frames: ThreadToParent[] = [];
    port1.addEventListener('message', (event: MessageEvent) => frames.push(event.data as ThreadToParent));
    port1.start();
    const { runtime, done } = bootstrapThread(
      {
        kind: 'web-node:thread-init',
        vfsPort: new MessageChannel().port2,
        vfsControl: new SharedArrayBuffer(CONTROL_BYTES),
        messagePort: port2,
        filename: '/project/index.js',
        workerData: { seed: 99 },
        argv: ['/bin/node', '/project/index.js'],
        name: 'unit-thread',
        env: { NODE_ENV: 'test' },
        execArgv: ['--foo'],
        cwd: '/project',
        threadId: 5,
        environmentData: new Map([['k', 'v']]),
        stdin: false,
        stdout: false,
        stderr: false,
      },
      {
        createChannel: () => loopback(vfs),
        installGlobals: false,
      },
    );
    return { frames, done, port: port1, runtime };
  }

  it('installs the worker-side worker_threads view and runs the entry', async () => {
    const { frames, done } = bootWorker(`
const { isMainThread, threadId, threadName, workerData, parentPort, getEnvironmentData } = require('worker_threads');
const proc = require('process');
parentPort.postMessage({
  isMainThread, threadId, threadName, workerData,
  execArgv: proc.execArgv,
  env: getEnvironmentData('k'),
});
`);
    const code = await done;
    await flush();
    const message = frames.find((f) => f.t === 'message');
    expect(message).toEqual({
      t: 'message',
      value: {
        isMainThread: false,
        threadId: 5,
        threadName: 'unit-thread',
        workerData: { seed: 99 },
        execArgv: ['--foo'],
        env: 'v',
      },
    });
    expect(frames[0]).toEqual({ t: 'online' });
    expect(frames.at(-1)).toEqual({ t: 'exit', code: 0 });
    expect(code).toBe(0);
  });

  it('routes console output to stdout frames', async () => {
    const { frames, done } = bootWorker(`console.log('worker output');`);
    await done;
    await flush();
    const stdout = frames.filter((f) => f.t === 'stdout').map((f) => dec((f as { data: Uint8Array }).data)).join('');
    expect(stdout).toContain('worker output');
  });

  it('reports process.exit(code) as the exit frame', async () => {
    const { frames, done } = bootWorker(`process.exit(4);`);
    const code = await done;
    await flush();
    expect(code).toBe(4);
    expect(frames.at(-1)).toEqual({ t: 'exit', code: 4 });
  });

  it('reports a throwing entry as error + exit 1', async () => {
    const { frames, done } = bootWorker(`throw new Error('boom');`);
    const code = await done;
    await flush();
    expect(code).toBe(1);
    const err = frames.find((f) => f.t === 'error');
    expect((err as { message: string }).message).toBe('boom');
    expect(frames.at(-1)).toEqual({ t: 'exit', code: 1 });
  });

  it('delivers a parent->thread message into the worker parentPort', async () => {
    const { frames, done, port } = bootWorker(`
const { parentPort } = require('worker_threads');
parentPort.on('message', (m) => parentPort.postMessage({ got: m }));
`);
    // Give the entry a turn to install its listener, then send.
    await new Promise((r) => setTimeout(r, 5));
    port.postMessage({ t: 'message', value: 'ping' } satisfies ParentToThread);
    // A reply means delivery worked; then stop by finishing the program.
    await new Promise((r) => setTimeout(r, 10));
    expect(frames).toContainEqual({ t: 'message', value: { got: 'ping' } });
    // Keep the run from hanging on the open port: report done, then exit frame
    // arrives once the loop drains (the port here does not ref the runtime).
    const code = await Promise.race([done, new Promise<number>((r) => setTimeout(() => r(-1), 200))]);
    expect(code === 0 || code === -1).toBe(true);
  });

  it('delivers parent stdin into the worker process.stdin', async () => {
    const { frames, done, port } = bootWorker(`
const { parentPort } = require('worker_threads');
const proc = require('process');
proc.stdin.on('data', (d) => parentPort.postMessage({ stdin: Buffer.from(d).toString().trim() }));
proc.stdin.on('end', () => process.exit(0));
`);
    await flush();
    port.postMessage({ t: 'stdin', data: enc('ping\n') } satisfies ParentToThread);
    port.postMessage({ t: 'stdin-end' } satisfies ParentToThread);
    const code = await done;
    await flush();
    expect(frames).toContainEqual({ t: 'message', value: { stdin: 'ping' } });
    expect(code).toBe(0);
  });

  it('refuses a transferList over the thread boundary (Phase C)', async () => {
    const { frames, done } = bootWorker(`
const { parentPort, MessageChannel } = require('worker_threads');
const { port1 } = new MessageChannel();
try {
  parentPort.postMessage({ p: port1 }, [port1]);
  parentPort.postMessage({ ok: true });
} catch (err) {
  parentPort.postMessage({ threw: err.code || err.name });
}
`);
    await done;
    await flush();
    const message = frames.find((f) => f.t === 'message');
    expect((message as { value: { threw?: string } }).value.threw).toBeDefined();
  });
});

describe('RemoteVfs cwd + real worker integration', () => {
  it('a RemoteVfs resolves against the thread cwd the parent chose', () => {
    const vfs = makeVfs();
    const remote = new RemoteVfs(loopback(vfs), { cwd: '/project' });
    expect(dec(remote.readFile('data.txt'))).toBe('from-parent-tree');
  });
});
