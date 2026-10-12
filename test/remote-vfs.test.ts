import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { MemoryVfs } from '../src/node-runtime/vfs/memory';
import { RemoteVfs } from '../src/node-runtime/vfs/remote';
import { applyVfsCall, serveVfsChannel } from '../src/node-runtime/vfs/remote-server';
import { VfsError, type Vfs } from '../src/node-runtime/vfs/types';
import {
  VFS_OP,
  VFS_OP_BY_CODE,
  decodeFrame,
  encodeFrame,
  isReadOnlyVfsOp,
  type VfsCallMeta,
  type VfsResultMeta,
} from '../src/sync/thread-protocol';
import { CONTROL_BYTES, SyncChannel, SyncChannelError } from '../src/sync/sab-rpc';

/**
 * The M147 Phase A VFS bridge: a **real-thread** worker reaching the parent's
 * authoritative `MemoryVfs` over the synchronous shared-memory channel.
 *
 * The tree lives in exactly one place (the parent), so a thread's read/write is
 * applied there and nowhere else — that is what makes the two realms consistent
 * without a merge protocol, and it is what these tests pin: the frame codec, the
 * op dispatch, and the fact that a `VfsError` survives the round trip with its
 * `code`/`syscall`/`path` intact.
 *
 * The channel itself (`Atomics.wait` + the writer queue) is covered by
 * `sab-channel.test.ts`; here we cover the VFS layer on top of it. The blocking
 * end-to-end runs a real `node:worker_threads` worker, because `Atomics.wait` is
 * only meaningful when another thread can wake it.
 */

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function makeVfs(): MemoryVfs {
  const vfs = new MemoryVfs();
  vfs.mkdir('/proj', { recursive: true });
  vfs.mkdir('/proj/src', { recursive: true });
  vfs.writeFile('/proj/index.js', enc('console.log("hi")\n'));
  vfs.writeFile('/proj/src/a.js', enc('export const a = 1;\n'));
  return vfs;
}

describe('thread VFS protocol frames', () => {
  it('round-trips a meta-only frame', () => {
    const meta: VfsCallMeta = { op: 'exists', path: '/proj' };
    const { meta: back, body } = decodeFrame<VfsCallMeta>(encodeFrame(meta));
    expect(back).toEqual(meta);
    expect(body.byteLength).toBe(0);
  });

  it('round-trips a frame carrying a body', () => {
    const meta: VfsCallMeta = { op: 'writeFile', path: '/x', opts: { flag: 'w' } };
    const body = enc('hello world');
    const frame = encodeFrame(meta, body);
    const { meta: back, body: bytes } = decodeFrame<VfsCallMeta>(frame);
    expect(back).toEqual(meta);
    expect(dec(bytes)).toBe('hello world');
  });

  it('reads a frame out of a SharedArrayBuffer-backed view', () => {
    // The errno path arrives inside shared memory, which `TextDecoder` refuses
    // to read directly — `decodeFrame` must copy before decoding.
    const frame = encodeFrame({ op: 'exists', result: true });
    const shared = new Uint8Array(new SharedArrayBuffer(frame.byteLength));
    shared.set(frame);
    expect(decodeFrame<VfsResultMeta>(shared).meta).toEqual({ op: 'exists', result: true });
  });

  it('keeps op codes and names in sync', () => {
    for (const [name, code] of Object.entries(VFS_OP)) {
      expect(VFS_OP_BY_CODE[code]).toBe(name);
    }
  });

  it('lists exactly the lookup ops as read-only', () => {
    const readOnly = Object.entries(VFS_OP)
      .filter(([, code]) => isReadOnlyVfsOp(code))
      .map(([name]) => name)
      .sort();
    expect(readOnly).toEqual(['exists', 'lstat', 'readFile', 'readdir', 'realpath', 'stat']);
  });
});

describe('applyVfsCall against the authoritative tree', () => {
  it('reads, writes and lists', () => {
    const vfs = makeVfs();
    const read = decodeFrame<VfsResultMeta>(
      applyVfsCall(vfs, { op: 'readFile', path: '/proj/index.js' }, new Uint8Array(0)),
    );
    expect(read.meta.op).toBe('readFile');
    expect(dec(read.body)).toBe('console.log("hi")\n');

    applyVfsCall(vfs, { op: 'writeFile', path: '/proj/src/b.js' }, enc('b'));
    expect(dec(vfs.readFile('/proj/src/b.js'))).toBe('b');

    const listed = decodeFrame<VfsResultMeta>(applyVfsCall(vfs, { op: 'readdir', path: '/proj/src' }, new Uint8Array(0)));
    expect((listed.meta as Extract<VfsResultMeta, { op: 'readdir' }>).entries.map((e) => e.name)).toEqual([
      'a.js',
      'b.js',
    ]);
  });

  it('appends without losing the existing bytes', () => {
    const vfs = makeVfs();
    applyVfsCall(vfs, { op: 'appendFile', path: '/proj/index.js' }, enc('// more\n'));
    expect(dec(vfs.readFile('/proj/index.js'))).toBe('console.log("hi")\n// more\n');
  });

  it('reports stat and existence', () => {
    const vfs = makeVfs();
    const stat = decodeFrame<VfsResultMeta>(applyVfsCall(vfs, { op: 'stat', path: '/proj/index.js' }, new Uint8Array(0)));
    expect((stat.meta as Extract<VfsResultMeta, { op: 'stat' }>).stat.type).toBe('file');
    const exists = decodeFrame<VfsResultMeta>(applyVfsCall(vfs, { op: 'exists', path: '/nope' }, new Uint8Array(0)));
    expect((exists.meta as Extract<VfsResultMeta, { op: 'exists' }>).result).toBe(false);
  });

  it('throws the tree error straight through for a miss', () => {
    const vfs = makeVfs();
    expect(() => applyVfsCall(vfs, { op: 'readFile', path: '/proj/missing.js' }, new Uint8Array(0))).toThrowError(
      expect.objectContaining({ code: 'ENOENT', syscall: 'open' }),
    );
    expect(() => applyVfsCall(vfs, { op: 'readFile', path: '/proj' }, new Uint8Array(0))).toThrowError(
      expect.objectContaining({ code: 'EISDIR' }),
    );
    expect(() => applyVfsCall(vfs, { op: 'readdir', path: '/proj/index.js' }, new Uint8Array(0))).toThrowError(
      expect.objectContaining({ code: 'ENOTDIR' }),
    );
  });

  it('leaves an unknown op code unnamed so the bridge can reject it', () => {
    expect(VFS_OP_BY_CODE[999]).toBeUndefined();
  });
});

/**
 * The client (`RemoteVfs`) against the real `applyVfsCall`, wired by an
 * in-process adapter. The adapter stands in for the port + `Atomics.wait` path
 * (proven separately below and in `sab-channel.test.ts`) and rethrows a failure
 * the way `serveSyncChannel`'s error envelope would, so `RemoteVfs`'s own
 * framing, cwd resolution and error reconstruction are exercised deterministically.
 */
function loopback(vfs: Vfs): SyncChannel {
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

describe('RemoteVfs over a loopback channel', () => {
  it('resolves relative paths against its own cwd', () => {
    const vfs = makeVfs();
    const remote = new RemoteVfs(loopback(vfs), { cwd: '/proj' });
    expect(dec(remote.readFile('index.js'))).toBe('console.log("hi")\n');
    expect(dec(remote.readFile('./src/a.js'))).toBe('export const a = 1;\n');
    expect(dec(remote.readFile('/proj/src/a.js'))).toBe('export const a = 1;\n');
    expect(remote.resolve('src')).toBe('/proj/src');
  });

  it('tracks chdir locally without disturbing the parent', () => {
    const vfs = makeVfs();
    const remote = new RemoteVfs(loopback(vfs));
    remote.chdir('/proj/src');
    expect(remote.cwd).toBe('/proj/src');
    expect(remote.exists('a.js')).toBe(true);
    // The authoritative tree's cwd is its own concern.
    expect(vfs.cwd).toBe('/');
  });

  it('reports chdir failures as the chdir syscall', () => {
    const remote = new RemoteVfs(loopback(makeVfs()));
    try {
      remote.chdir('/proj/missing');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(VfsError);
      expect((err as VfsError).code).toBe('ENOENT');
      expect((err as VfsError).syscall).toBe('chdir');
    }
  });

  it('writes through to the parent tree', () => {
    const vfs = makeVfs();
    const remote = new RemoteVfs(loopback(vfs), { cwd: '/proj' });
    remote.writeFile('src/hello.txt', enc('remote'));
    expect(dec(vfs.readFile('/proj/src/hello.txt'))).toBe('remote');
    remote.appendFile('src/hello.txt', enc('+'));
    expect(dec(vfs.readFile('/proj/src/hello.txt'))).toBe('remote+');
  });

  it('returns stats, dirents and realpaths', () => {
    const remote = new RemoteVfs(loopback(makeVfs()), { cwd: '/proj' });
    expect(remote.stat('src/a.js').type).toBe('file');
    expect(remote.lstat('src').type).toBe('dir');
    expect(remote.readdir('src').map((e) => e.name)).toEqual(['a.js']);
    expect(remote.realpath('src/a.js')).toBe('/proj/src/a.js');
  });

  it('reconstructs a VfsError with its code, syscall and path', () => {
    const remote = new RemoteVfs(loopback(makeVfs()), { cwd: '/proj' });
    try {
      remote.readFile('missing.js');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(VfsError);
      const e = err as VfsError;
      expect(e.code).toBe('ENOENT');
      expect(e.syscall).toBe('open');
      expect(e.path).toBe('/proj/missing.js');
      expect(e.errno).toBe(-2);
    }
  });
});

/**
 * The real thing: the parent serves its tree on its own thread, a real
 * `node:worker_threads` worker asks over shared memory, and the answer comes
 * back through the parked `Atomics.wait`. The worker speaks the raw protocol
 * (it cannot import the TS client), which also makes this a second, independent
 * check of the wire format.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const h = new Int32Array(workerData.control);
const H_STATE = 0, H_SEQ = 1, H_OP = 2, H_STATUS = 3, H_REQ_LEN = 4, H_RES_LEN = 5;
const encoder = new TextEncoder();
function frame(meta, body) {
  body = body || new Uint8Array(0);
  const json = encoder.encode(JSON.stringify(meta));
  const out = new Uint8Array(4 + json.length + body.length);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  out.set(body, 4 + json.length);
  return out;
}
let seq = 0;
function call(op, payload) {
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
  workerData.port.postMessage({ seq, op, len: payload.length, data });
  const deadline = Date.now() + 3000;
  while (Atomics.load(h, H_STATE) !== 2) {
    const left = deadline - Date.now();
    if (left <= 0) return { status: -1 };
    Atomics.wait(h, H_STATE, 1, left);
  }
  const len = Atomics.load(h, H_RES_LEN);
  return { status: Atomics.load(h, H_STATUS), bytes: Array.from(new Uint8Array(data, 0, len)) };
}
const results = workerData.calls.map((c) => call(c.op, frame(c.meta)));
parentPort.postMessage(results);
`;

describe('VFS bridge across a real thread', () => {
  async function run(calls: Array<{ op: number; meta: VfsCallMeta }>): Promise<Array<{ status: number; bytes?: number[] }>> {
    const vfs = makeVfs();
    const { port1, port2 } = new MessageChannel();
    const control = new SharedArrayBuffer(CONTROL_BYTES);
    const stop = serveVfsChannel(port1, control, vfs);
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { control, port: port2, calls },
      transferList: [port2],
    });
    try {
      return await new Promise<Array<{ status: number; bytes?: number[] }>>((resolve, reject) => {
        worker.on('message', resolve as (value: unknown) => void);
        worker.on('error', reject);
      });
    } finally {
      stop();
      await worker.terminate();
    }
  }

  const fromBytes = (bytes: number[] | undefined): { meta: VfsResultMeta; body: Uint8Array } =>
    decodeFrame<VfsResultMeta>(new Uint8Array(bytes ?? []));

  it('answers reads and writes executed on the parent thread', async () => {
    const results = await run([
      { op: VFS_OP.readFile, meta: { op: 'readFile', path: '/proj/index.js' } },
      { op: VFS_OP.writeFile, meta: { op: 'writeFile', path: '/proj/src/from-thread.txt' } },
      { op: VFS_OP.exists, meta: { op: 'exists', path: '/proj/src/from-thread.txt' } },
    ]);
    expect(results.map((r) => r.status)).toEqual([0, 0, 0]);
    expect(dec(fromBytes(results[0].bytes).body)).toBe('console.log("hi")\n');
    expect((fromBytes(results[2].bytes).meta as Extract<VfsResultMeta, { op: 'exists' }>).result).toBe(true);
  });

  it('sends a real ENOENT back as a decoded error envelope', async () => {
    const results = await run([{ op: VFS_OP.readFile, meta: { op: 'readFile', path: '/proj/nope.js' } }]);
    expect(results[0].status).toBe(1);
    const wire = JSON.parse(dec(new Uint8Array(results[0].bytes ?? []))) as Record<string, unknown>;
    expect(wire.code).toBe('ENOENT');
    expect(wire.syscall).toBe('open');
    expect(wire.path).toBe('/proj/nope.js');
  });
});
