import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import type { PortBridgeApi } from '../src/sync/port-bridge';

/**
 * M147 Phase C: a **MessagePort that crosses a realm boundary**.
 *
 * Phase B made a `worker_threads.Worker` run in a real thread, and a real thread
 * is a *separate realm* — so `postMessage(_, [port])` can no longer hand the
 * sibling group across directly. What crosses instead is a small link
 * descriptor; each side owns half of the link and the messaging binding stitches
 * them back together.
 *
 * These tests build **two real `NodeRuntime` realms** (each with its own
 * messaging binding) and wire their bridges to each other with a loopback
 * transport, then move a live `MessagePort` between them — the same operation
 * `jest-worker` (hence terser/rspack) performs when it hands work back to a pool.
 *
 * A symmetric link is used: both realms take the proxy (`handle`) half of a
 * `parent` endpoint, which models "each end is a port in the other's realm" and
 * exercises `onFrame`/`dispatch`/transfer/close. The parent-specific
 * `buildMessage`/`importMessage` path is covered end-to-end by
 * `real-thread.test.ts`.
 */

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

interface AnyPort {
  postMessage(value: unknown, transferList?: unknown): void;
  start(): void;
  close(): void;
  on(name: string, cb: (...args: unknown[]) => void): void;
}

interface Realm {
  runtime: NodeRuntime;
  ports: PortBridgeApi;
  MessageChannel: new () => { port1: AnyPort; port2: AnyPort };
}

function makeRealm(): Realm {
  const vfs = new MemoryVfs({ cwd: '/project' });
  const runtime = new NodeRuntime({ vfs, argv: ['/bin/node'], env: {}, installGlobals: false });
  // Load `internal/worker/io` so it installs `oninit` (event-target `.on`, ref
  // bookkeeping) on the port prototype the binding owns — the same thing the
  // runtime worker's own `worker_threads` load does in production.
  runtime.realm.require('internal/worker/io');
  const binding = runtime.realm.internalBinding('messaging') as unknown as {
    __ports: PortBridgeApi;
    MessageChannel: new () => { port1: AnyPort; port2: AnyPort };
  };
  return { runtime, ports: binding.__ports, MessageChannel: binding.MessageChannel };
}

/** Build two linked realms, each with a started `parent` proxy + a message sink. */
function paired(): { a: Realm; b: Realm; aParent: AnyPort; bParent: AnyPort; aGot: unknown[]; bGot: unknown[] } {
  const a = makeRealm();
  const b = makeRealm();
  a.ports.connect((frame) => b.ports.onFrame(frame));
  b.ports.connect((frame) => a.ports.onFrame(frame));
  const aParent = a.ports.importPort('parent') as AnyPort;
  const bParent = b.ports.importPort('parent') as AnyPort;
  aParent.start();
  bParent.start();
  const aGot: unknown[] = [];
  const bGot: unknown[] = [];
  aParent.on('message', (m) => aGot.push(m));
  bParent.on('message', (m) => bGot.push(m));
  return { a, b, aParent, bParent, aGot, bGot };
}

/** Collect a port's messages, starting it. */
function sink(port: AnyPort): unknown[] {
  const got: unknown[] = [];
  port.on('message', (m) => got.push(m));
  port.start();
  return got;
}

describe('cross-realm MessagePort bridge', () => {
  it('carries a plain message between realms', async () => {
    const { aParent, bGot } = paired();
    aParent.postMessage({ hello: 'world', n: 7 });
    await flush();
    expect(bGot).toEqual([{ hello: 'world', n: 7 }]);
  });

  it('transfers a MessagePort across the boundary and delivers through it', async () => {
    const { a, aParent, bGot } = paired();
    // `port2` stays in realm A; `port1` is transferred to realm B.
    const { port1, port2 } = new a.MessageChannel();
    const aPort2Got = sink(port2);

    aParent.postMessage({ p: port1 }, [port1]);
    await flush();

    // Realm B received a live proxy for `port1`.
    expect(bGot).toHaveLength(1);
    const proxy = (bGot[0] as { p: AnyPort }).p;
    expect(proxy).toBeDefined();
    expect(typeof proxy.postMessage).toBe('function');

    // A message through the transferred port reaches realm A's `port2`.
    proxy.postMessage('from B');
    await flush();
    expect(aPort2Got).toEqual(['from B']);
  });

  it('round-trips a port transferred back the other way', async () => {
    const { a, b, aParent, bGot } = paired();
    const { port1, port2 } = new a.MessageChannel();
    const aPort2Got = sink(port2);

    aParent.postMessage({ p: port1 }, [port1]);
    await flush();
    const proxyToA = (bGot[0] as { p: AnyPort }).p;

    // Realm B hands a fresh channel's end *back* to realm A over its own proxy.
    const back = new b.MessageChannel();
    const bGot2 = sink(back.port2);
    proxyToA.postMessage({ reply: back.port1 }, [back.port1]);
    await flush();

    // Realm A's port2 now holds a proxy it can post through to realm B.
    expect(aPort2Got).toHaveLength(1);
    const inbound = aPort2Got[0] as { reply: AnyPort };
    expect(inbound.reply).toBeDefined();
    sink(inbound.reply);
    inbound.reply.postMessage('round two');
    await flush();
    expect(bGot2).toEqual(['round two']);
  });

  it('propagates close of a transferred port to the origin group', async () => {
    const { a, aParent, bGot } = paired();
    const { port1, port2 } = new a.MessageChannel();
    let port2Closed = false;
    port2.on('close', () => {
      port2Closed = true;
    });
    port2.start();

    aParent.postMessage({ p: port1 }, [port1]);
    await flush();
    const proxy = (bGot[0] as { p: AnyPort }).p;

    // Closing the proxy in realm B disentangles realm A's group, closing `port2`.
    proxy.close();
    await flush();
    expect(port2Closed).toBe(true);
  });
});
