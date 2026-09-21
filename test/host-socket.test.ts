/**
 * Open WebSockets and the child exit decision.
 *
 * A spawned child is considered finished when its synchronous phase has
 * returned *and* the runtime's active-work delta is back to zero. An open
 * WebSocket is a long-lived *host* handle — it lives on the host's event loop,
 * not in the sandbox timer queue — so without tracking it a child whose only
 * remaining work is a socket was reported as exited while the socket was still
 * open, and any message it delivered afterwards was lost.
 *
 * The grounding is real Node v26.9.0: `new WebSocket(...)` against a server
 * that accepts but never completes the handshake keeps the process alive until
 * the socket is closed/errored (a bare script with nothing else pending does
 * not exit). The tests below pin that the runtime counts an open socket, and
 * that a closed/errored one releases its count so a child still finishes.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

const encoder = new TextEncoder();
const tick = (ms = 8): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A stand-in for the host `WebSocket`: records instances so a test can drive
 * their lifecycle, and behaves like the real one for the runtime's purposes
 * (`addEventListener('close'|'error')`). */
class FakeWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;

  constructor(
    public url: string,
    public protocols?: unknown,
  ) {
    super();
    this.readyState = FakeWebSocket.OPEN;
    FakeWebSocket.instances.push(this);
  }

  /** Simulate a clean close: releases the runtime's handle count. */
  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  /** Simulate a failed connection: `error` then `close`, like a real socket. */
  fail(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event('error'));
    this.dispatchEvent(new Event('close'));
  }
}

const realWebSocket = globalThis.WebSocket;

afterEach(() => {
  FakeWebSocket.instances = [];
  (globalThis as unknown as Record<string, unknown>).WebSocket = realWebSocket;
});

function makeVfs(files: Record<string, string>): MemoryVfs {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) vfs.mkdir(dir, { recursive: true });
    vfs.writeFile(path, encoder.encode(content));
  }
  return vfs;
}

async function runProject(files: Record<string, string>, waitMs = 250): Promise<string> {
  const vfs = makeVfs(files);
  const out: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: (c) => out.push(c),
  });
  runtime.runMain('/project/index.js');
  const deadline = Date.now() + waitMs;
  let last = '';
  let stable = 0;
  while (Date.now() < deadline) {
    await tick(10);
    const now = out.join('');
    if (now !== last) {
      last = now;
      stable = 0;
    } else if (now.length > 0 && ++stable >= 3) {
      break;
    }
  }
  return out.join('');
}

describe('a child whose remaining work is an open WebSocket', () => {
  it('waits for the socket to close instead of exiting early', async () => {
    (globalThis as unknown as Record<string, unknown>).WebSocket = FakeWebSocket;
    const pending = runProject({
      '/project/index.js': `
        const { exec } = require('child_process');
        exec('node /project/child.js', (err, stdout) => {
          console.log('done|' + JSON.stringify(stdout.trim()) + '|err=' + err);
        });
      `,
      '/project/child.js': `
        const ws = new WebSocket('ws://example.test/x');
        ws.addEventListener('close', () => console.log('socket closed'));
        console.log('socket open');
      `,
    });
    // Close the socket from the host after the child has had time to open it.
    // The child must not be reported as exited before this lands.
    await tick(50);
    expect(FakeWebSocket.instances.length).toBe(1);
    FakeWebSocket.instances[0].close();
    const out = await pending;
    expect(out.trim()).toBe('done|"socket open\\nsocket closed"|err=null');
  });

  it('releases the count when the connection fails, so the child still finishes', async () => {
    (globalThis as unknown as Record<string, unknown>).WebSocket = FakeWebSocket;
    const pending = runProject({
      '/project/index.js': `
        const { exec } = require('child_process');
        exec('node /project/child.js', (err, stdout) => {
          console.log('done|' + JSON.stringify(stdout.trim()) + '|err=' + err);
        });
      `,
      '/project/child.js': `
        const ws = new WebSocket('ws://example.test/x');
        ws.addEventListener('error', () => console.log('socket errored'));
      `,
    });
    await tick(50);
    expect(FakeWebSocket.instances.length).toBe(1);
    FakeWebSocket.instances[0].fail();
    const out = await pending;
    expect(out.trim()).toBe('done|"socket errored"|err=null');
  });

  it("does not let the parent's own open socket hold a child open", async () => {
    (globalThis as unknown as Record<string, unknown>).WebSocket = FakeWebSocket;
    const out = await runProject({
      '/project/index.js': `
        const { exec } = require('child_process');
        const parentSocket = new WebSocket('ws://example.test/parent');
        exec('node -e "process.stdout.write(String(6 * 7))"', (err, stdout) => {
          console.log('done|' + stdout + '|parentOpen=' + (parentSocket.readyState === 1));
        });
      `,
    });
    expect(out.trim()).toBe('done|42|parentOpen=true');
  });
});

describe('the sandbox WebSocket wrapper', () => {
  function boot(): NodeRuntime {
    (globalThis as unknown as Record<string, unknown>).WebSocket = FakeWebSocket;
    return new NodeRuntime({
      vfs: makeVfs({}),
      argv: ['/project/index.js'],
      installGlobals: false,
    });
  }

  it('counts a socket as active work and releases it on close', () => {
    const runtime = boot();
    const WS = runtime.sandboxGlobals.WebSocket as new (url: string) => FakeWebSocket;
    const before = runtime.activeTimers;
    const socket = new WS('ws://example.test/x');
    expect(runtime.activeTimers).toBe(before + 1);
    socket.close();
    expect(runtime.activeTimers).toBe(before);
  });

  it('preserves instanceof and the static ready-state constants', () => {
    const runtime = boot();
    const WS = runtime.sandboxGlobals.WebSocket as typeof FakeWebSocket;
    const socket = new WS('ws://example.test/x');
    expect(socket).toBeInstanceOf(FakeWebSocket);
    expect(socket).toBeInstanceOf(WS);
    expect(WS.CONNECTING).toBe(0);
    expect(WS.OPEN).toBe(1);
    expect(WS.CLOSING).toBe(2);
    expect(WS.CLOSED).toBe(3);
  });

  it('drops a stale socket when a new run begins, without going negative', () => {
    const runtime = boot();
    const WS = runtime.sandboxGlobals.WebSocket as new (url: string) => FakeWebSocket;
    const socket = new WS('ws://example.test/x');
    expect(runtime.activeTimers).toBeGreaterThan(0);
    runtime.resetRunState();
    expect(runtime.activeTimers).toBe(0);
    // The abandoned socket finally closes in the *next* run: its release must
    // not touch the new run's count.
    socket.close();
    expect(runtime.activeTimers).toBe(0);
  });
});
