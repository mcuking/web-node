import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import {
  CONTROL_BYTES,
  SyncChannel,
  SyncChannelError,
  serveSyncChannel,
  type SyncAsyncRequest,
} from '../src/sync/sab-rpc';

/**
 * The M120 synchronous channel.
 *
 * `Atomics.wait` is only meaningful when *another* thread can wake it, so the
 * blocking tests run a real `node:worker_threads` worker. The two halves are
 * covered against each other: the real client against a scripted peer, and the
 * real `serveSyncChannel` against a scripted client. The browser end-to-end
 * (FS worker ↔ OPFS) is covered separately, in the page.
 */

const CONTROL = `const H_STATE = 0, H_SEQ = 1, H_OP = 2, H_STATUS = 3, H_REQ_LEN = 4, H_RES_LEN = 5;`;

/** A peer that answers synchronously, slowly, with an error, or never. */
const SERVER_SOURCE = `
const { workerData } = require('node:worker_threads');
const h = new Int32Array(workerData.control);
${CONTROL}
const encoder = new TextEncoder();
function reply(data, bytes, status) {
  if (bytes.length) new Uint8Array(data).set(bytes, 0);
  Atomics.store(h, H_RES_LEN, bytes.length);
  Atomics.store(h, H_STATUS, status);
  Atomics.store(h, H_STATE, 2);
  Atomics.notify(h, H_STATE);
}
workerData.port.on('message', (msg) => {
  const payload = new Uint8Array(msg.data, 0, msg.len);
  if (msg.op === 1) return reply(msg.data, payload.map((b) => b + 1), 0);
  if (msg.op === 2) return void setTimeout(() => reply(msg.data, payload, 0), 40);
  if (msg.op === 3) {
    return reply(msg.data, encoder.encode(JSON.stringify({ code: 'EWHAT', message: 'nope' })), 1);
  }
  if (msg.op === 4) return; // never answers
  reply(msg.data, new Uint8Array(0), 0);
});
`;

/** A client that parks on `Atomics.wait` and reports what came back. */
const CLIENT_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const h = new Int32Array(workerData.control);
${CONTROL}
(function () {
  const data = new SharedArrayBuffer(workerData.bufferBytes || 64);
  const payload = new TextEncoder().encode(workerData.text);
  new Uint8Array(data).set(payload, 0);
  Atomics.store(h, H_SEQ, 1);
  Atomics.store(h, H_OP, workerData.op);
  Atomics.store(h, H_STATUS, 0);
  Atomics.store(h, H_REQ_LEN, payload.length);
  Atomics.store(h, H_RES_LEN, 0);
  Atomics.store(h, H_STATE, 1);
  workerData.port.postMessage({ seq: 1, op: workerData.op, len: payload.length, data });
  const deadline = Date.now() + 3000;
  while (Atomics.load(h, H_STATE) !== 2) {
    const left = deadline - Date.now();
    if (left <= 0) { parentPort.postMessage({ timedOut: true }); return; }
    Atomics.wait(h, H_STATE, 1, left);
  }
  const len = Atomics.load(h, H_RES_LEN);
  parentPort.postMessage({
    status: Atomics.load(h, H_STATUS),
    bytes: Array.from(new Uint8Array(data, 0, len)).map((b) => String.fromCharCode(b)).join(''),
  });
})();
`;

interface Ports {
  control: SharedArrayBuffer;
  client: MessagePort;
  port2: MessagePort;
}

function openChannel(): Ports {
  const channel = new MessageChannel();
  return { control: new SharedArrayBuffer(CONTROL_BYTES), client: channel.port1, port2: channel.port2 };
}

describe('sync channel (client: real, peer: scripted)', () => {
  it('parks the thread until the peer answers', async () => {
    const { control, client, port2 } = openChannel();
    const worker = new Worker(SERVER_SOURCE, {
      eval: true,
      workerData: { control, port: port2 },
      transferList: [port2],
    });
    const channel = new SyncChannel(client, control, 2000);
    const text = new TextEncoder();
    const started = Date.now();
    // op 2 answers only after 40ms: the delay can only be observed if the caller
    // really parked, since nothing else runs on this thread meanwhile.
    const echoed = channel.call(2, text.encode('ping'));
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    expect(new TextDecoder().decode(echoed)).toBe('ping');
    channel.close();
    await worker.terminate();
  });

  it('returns the peer response bytes', async () => {
    const { control, client, port2 } = openChannel();
    const worker = new Worker(SERVER_SOURCE, {
      eval: true,
      workerData: { control, port: port2 },
      transferList: [port2],
    });
    const channel = new SyncChannel(client, control, 2000);
    expect(Array.from(channel.call(1, new Uint8Array([1, 2, 3])))).toEqual([2, 3, 4]);
    channel.close();
    await worker.terminate();
  });

  it('rethrows the peer error with its code', async () => {
    const { control, client, port2 } = openChannel();
    const worker = new Worker(SERVER_SOURCE, {
      eval: true,
      workerData: { control, port: port2 },
      transferList: [port2],
    });
    const channel = new SyncChannel(client, control, 2000);
    let error: unknown = null;
    // The error envelope arrives in shared memory, and Chrome refuses to decode
    // a view onto one — so the client must copy before parsing it.
    const original = TextDecoder.prototype.decode;
    TextDecoder.prototype.decode = function (this: TextDecoder, input?: ArrayBufferView, options?: TextDecodeOptions) {
      if (input && input.buffer instanceof SharedArrayBuffer) {
        throw new TypeError('The provided ArrayBufferView value must not be shared.');
      }
      return original.call(this, input, options);
    };
    try {
      channel.call(3);
    } catch (e) {
      error = e;
    } finally {
      TextDecoder.prototype.decode = original;
    }
    expect(error).toBeInstanceOf(SyncChannelError);
    expect((error as SyncChannelError).code).toBe('EWHAT');
    expect((error as Error).message).toBe('nope');
    channel.close();
    await worker.terminate();
  });

  it('times out instead of hanging when the peer never answers', async () => {
    const { control, client, port2 } = openChannel();
    const worker = new Worker(SERVER_SOURCE, {
      eval: true,
      workerData: { control, port: port2 },
      transferList: [port2],
    });
    const channel = new SyncChannel(client, control, 2000);
    const started = Date.now();
    let error: unknown = null;
    try {
      channel.call(4, new Uint8Array(0), 0, 0, 200);
    } catch (e) {
      error = e;
    }
    const elapsed = Date.now() - started;
    expect((error as SyncChannelError)?.code).toBe('ERR_WEB_NODE_SYNC_TIMEOUT');
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(1500);
    channel.close();
    await worker.terminate();
  });
});

describe('sync channel (server: real, client: scripted)', () => {
  async function roundTrip(op: number, text: string, sync: Parameters<typeof serveSyncChannel>[2]['sync']) {
    const { control, client, port2 } = openChannel();
    // The worker gets one end and the test thread serves the other; the client
    // only posts (its answer comes back through the shared buffer), so it never
    // reads from its port.
    serveSyncChannel(client, control, { sync });
    const worker = new Worker(CLIENT_SOURCE, {
      eval: true,
      workerData: { control, port: port2, op, text },
      transferList: [port2],
    });
    const reply = await new Promise<{ status: number; bytes: string; timedOut?: boolean }>((resolve, reject) => {
      worker.on('message', resolve as (value: unknown) => void);
      worker.on('error', reject);
    });
    await worker.terminate();
    return reply;
  }

  it('answers through the shared buffer', async () => {
    const reply = await roundTrip(1, 'hello', (_op, payload) => new Uint8Array(payload).reverse());
    expect(reply.status).toBe(0);
    expect(reply.bytes).toBe('olleh');
  });

  it('handles an asynchronous handler without deadlocking', async () => {
    const reply = await roundTrip(1, 'ab', async (_op, payload) => {
      await new Promise((r) => setTimeout(r, 20));
      return new Uint8Array(payload);
    });
    expect(reply.status).toBe(0);
    expect(reply.bytes).toBe('ab');
  });

  it('sends a handler rejection back as an error envelope', async () => {
    const reply = await roundTrip(1, 'ab', () => {
      const err = new Error('boom') as Error & { code: string };
      err.code = 'EBOOM';
      throw err;
    });
    expect(reply.status).toBe(1);
    expect(JSON.parse(reply.bytes)).toEqual({ code: 'EBOOM', message: 'boom' });
  });
});

describe('sync channel async requests', () => {
  it('carries a reply for a request that does not block', async () => {
    const { control, client, port2 } = openChannel();
    const seen: SyncAsyncRequest[] = [];
    serveSyncChannel(port2, control, {
      sync: () => new Uint8Array(0),
      async: async (request) => {
        seen.push(request);
        return { echoed: request.value };
      },
    });
    const reply = new Promise<{ kind: string; result?: unknown }>((resolve) => {
      client.onmessage = (event) => resolve(event.data as { kind: string; result?: unknown });
    });
    client.postMessage({ id: 7, kind: 'anything', value: 42 });
    const result = await reply;
    expect(seen).toHaveLength(1);
    expect(result).toEqual({ id: 7, kind: 'ok', result: { echoed: 42 } });
  });
});
