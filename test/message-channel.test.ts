import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `worker_threads` message passing is Node's real `lib/internal/worker/io.js`
 * (plus `lib/internal/per_context/messageport.js` and the real
 * `lib/internal/worker/js_transferable.js`) running on a JS reimplementation of
 * the `messaging` binding. The binding mirrors `src/node_messaging.cc`'s
 * observable contract: an anonymous `MessageChannel` is a two-member sibling
 * group, messages buffer until the receiver starts, closing one member closes
 * the other, and a transferred `MessagePort` is detached from the sender and
 * re-materialised on the receiving side (including references inside the
 * message).
 *
 * Every expectation below was read off Node v26.9.0 first.
 */
function boot(program: string) {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
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
  return { out, err };
}

const tick = (ms = 80): Promise<void> => new Promise((res) => setTimeout(res, ms));

describe('vendored: MessageChannel / MessagePort', () => {
  it('exposes the worker_threads surface, with real ports', async () => {
    const { out } = boot(`
      const wt = require('worker_threads');
      console.log('main', wt.isMainThread, wt.threadId, wt.parentPort, wt.workerData);
      const { port1, port2 } = new wt.MessageChannel();
      console.log('instanceof', port1 instanceof wt.MessagePort);
      console.log('tag', Object.prototype.toString.call(port1));
      console.log('hasRef', port1.hasRef());
      console.log('refReturn', typeof port1.ref(), typeof port1.unref());
      console.log('refed', port1.hasRef());
      try { new wt.MessagePort(); } catch (e) { console.log('ctor', e.name, e.code, e.message); }
      try { wt.MessageChannel(); } catch (e) { console.log('noNew', e.name, e.code, e.message); }
      try { port1.postMessage(); } catch (e) { console.log('noargs', e.name, e.code, e.message); }
      try { port1.postMessage('x', 'nope'); } catch (e) { console.log('badlist', e.name, e.code, e.message); }
      try { wt.Worker; new wt.Worker('x'); } catch (e) { console.log('worker throws'); }
      port1.close(); port2.close();
    `);
    await tick();
    expect(out.join('')).toBe(
      'main true 0 null null\n' +
        'instanceof true\n' +
        'tag [object EventTarget]\n' +
        'hasRef false\n' +
        'refReturn undefined undefined\n' +
        'refed false\n' +
        'ctor TypeError ERR_CONSTRUCT_CALL_INVALID Constructor cannot be called\n' +
        'noNew TypeError ERR_CONSTRUCT_CALL_REQUIRED Cannot call constructor without `new`\n' +
        'noargs TypeError ERR_MISSING_ARGS Not enough arguments to MessagePort.postMessage\n' +
        'badlist TypeError ERR_INVALID_ARG_TYPE Optional transferList argument must be an iterable\n' +
        'worker throws\n',
    );
  });

  it('delivers a structured clone, and buffers until the receiver starts', async () => {
    const { out } = boot(`
      const { MessageChannel } = require('worker_threads');
      const { port1, port2 } = new MessageChannel();
      const payload = { a: 1, nested: { b: [1, 2, 3] } };
      port1.postMessage(payload);
      payload.a = 99;
      payload.nested.b.push(4);
      console.log('return', port1.postMessage('second'));
      port2.onmessage = (e) => {
        console.log('got', JSON.stringify(e.data), 'type', e.type, 'ports', e.ports.length);
        if (typeof e.data === 'object') console.log('isolated', e.data.a === 1, e.data.nested.b.length === 3);
        port1.close(); port2.close();
      };
    `);
    await tick();
    expect(out.join('')).toBe(
      'return true\n' +
        'got {"a":1,"nested":{"b":[1,2,3]}} type message ports 0\n' +
        'isolated true true\n' +
        'got "second" type message ports 0\n',
    );
  });

  it('keeps post order', async () => {
    const { out } = boot(`
      const { MessageChannel } = require('worker_threads');
      const { port1, port2 } = new MessageChannel();
      const seen = [];
      port2.onmessage = (e) => {
        seen.push(e.data);
        if (seen.length === 3) { console.log('order', seen.join(',')); port1.close(); port2.close(); }
      };
      port1.postMessage(1); port1.postMessage(2); port1.postMessage(3);
    `);
    await tick();
    expect(out.join('')).toBe('order 1,2,3\n');
  });

  it('receiveMessageOnPort reads synchronously and does not start the port', async () => {
    const { out } = boot(`
      const { MessageChannel, receiveMessageOnPort } = require('worker_threads');
      const { port1, port2 } = new MessageChannel();
      port1.postMessage({ q: 'a' });
      console.log('sync', JSON.stringify(receiveMessageOnPort(port2).message));
      console.log('empty', receiveMessageOnPort(port2));
      let started = false;
      port2.onmessage = () => { started = true; };
      port1.postMessage('r');
      port2.on('close', () => {});
      port1.close(); port2.close();
    `);
    await tick();
    expect(out.join('')).toBe('sync {"q":"a"}\nempty undefined\n');
  });

  it('closing one member emits close on both', async () => {
    const { out } = boot(`
      const { MessageChannel } = require('worker_threads');
      const { port1, port2 } = new MessageChannel();
      port1.on('close', () => console.log('p1 close'));
      port2.on('close', () => console.log('p2 close'));
      port1.close();
      console.log('sync');
    `);
    await tick();
    // `close` is reported from the handle teardown, so it lands after the
    // synchronous code (and both members end up closed).
    expect(out.join('')).toBe('sync\np1 close\np2 close\n');
  });

  it('transfers a MessagePort: the receiver gets it, the sender is detached', async () => {
    const { out } = boot(`
      const { MessageChannel } = require('worker_threads');
      const c1 = new MessageChannel();
      const c2 = new MessageChannel();
      c2.port2.onmessage = (m) => console.log('to c2.port2', m.data);
      c1.port2.onmessage = (e) => {
        console.log('got', e.data.tag, 'ports', e.ports.length);
        const transferred = e.ports[0];
        console.log('same object in message', e.data.port === transferred);
        // The received port is entangled with c2's other end, so this reaches
        // c2.port2. Posting on the *sender's* stale handle is silently dropped,
        // exactly as in Node (its handle was closed by the transfer).
        transferred.postMessage('through');
        c2.port1.postMessage('stale');
      };
      c1.port1.postMessage({ tag: 'hello', port: c2.port1 }, [c2.port1]);
      try { c1.port1.postMessage('x', [c2.port1]); } catch (e) {
        console.log('retransfer', e.name, e.message);
      }
    `);
    await tick();
    expect(out.join('')).toBe(
      'retransfer DataCloneError MessagePort in transfer list is already detached\n' +
        'got hello ports 1\n' +
        'same object in message true\n' +
        'to c2.port2 through\n',
    );
  });

  it('transfers an ArrayBuffer (detaching the sender side)', async () => {
    const { out } = boot(`
      const { MessageChannel } = require('worker_threads');
      const { port1, port2 } = new MessageChannel();
      const buffer = new ArrayBuffer(8);
      port2.onmessage = (e) => {
        console.log('bytes', e.data.byteLength);
        console.log('detached', buffer.byteLength);
        port1.close(); port2.close();
      };
      port1.postMessage(buffer, [buffer]);
      console.log('sender', buffer.byteLength);
    `);
    await tick();
    expect(out.join('')).toBe('sender 0\nbytes 8\ndetached 0\n');
  });

  it('rejects the whole DataCloneError surface', async () => {
    const { out } = boot(`
      const { MessageChannel } = require('worker_threads');
      const { port1, port2 } = new MessageChannel();
      const other = new MessageChannel();
      const show = (label, fn) => {
        try { fn(); console.log(label, 'no-throw'); }
        catch (e) { console.log(label, e.name, e.message); }
      };
      show('nested', () => port2.postMessage({ p: other.port1 }));
      show('invalid', () => port2.postMessage('x', [{}]));
      const ab = new ArrayBuffer(4);
      show('dupBuffer', () => port2.postMessage('x', [ab, ab]));
      show('source', () => port2.postMessage('x', [port2]));
      show('dupPort', () => port2.postMessage('x', [other.port1, other.port1]));
      port1.close(); port2.close(); other.port1.close(); other.port2.close();
    `);
    await tick();
    expect(out.join('')).toBe(
      'nested DataCloneError Object that needs transfer was found in message but not listed in transferList\n' +
        'invalid DataCloneError Found invalid value in transferList.\n' +
        'dupBuffer DataCloneError Transfer list contains duplicate ArrayBuffer\n' +
        'source DataCloneError Transfer list contains source port\n' +
        'dupPort DataCloneError Transfer list contains duplicate MessagePort\n',
    );
  });

  it('broadcasts to the other channels on the same name', async () => {
    const { out } = boot(`
      const { BroadcastChannel } = require('worker_threads');
      const a = new BroadcastChannel('room');
      const b = new BroadcastChannel('room');
      b.onmessage = (e) => {
        console.log('b got', JSON.stringify(e.data));
        a.close();
        b.close();
      };
      a.postMessage({ hello: 'world' });
    `);
    await tick();
    expect(out.join('')).toBe('b got {"hello":"world"}\n');
  });
});
