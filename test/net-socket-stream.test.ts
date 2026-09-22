import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Milestone 70: `net.Socket` is a real `stream.Duplex` now, so the whole
 * readable/writable surface (pipe, pause/resume, readableEnded, finish, …)
 * comes for free instead of a hand-rolled subset.
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

describe('net.Socket is a Duplex', () => {
  it('exposes the stream surface', () => {
    const { out } = boot(`
      const net = require('net');
      const { Duplex } = require('stream');
      const s = new net.Socket();
      console.log(JSON.stringify({
        isDuplex: s instanceof Duplex,
        pipe: typeof s.pipe, pause: typeof s.pause, resume: typeof s.resume,
        read: typeof s.read, push: typeof s.push, unshift: typeof s.unshift,
        destroy: typeof s.destroy, end: typeof s.end, write: typeof s.write,
        readable: s.readable, writable: s.writable,
        readableEnded: s.readableEnded, writableEnded: s.writableEnded,
        readableLength: typeof s.readableLength, writableLength: typeof s.writableLength,
        writableHighWaterMark: s.writableHighWaterMark,
        StreamAlias: net.Stream === net.Socket,
      }));
      s.destroy();
    `);
    const info = JSON.parse(out.join('').trim());
    expect(info.isDuplex).toBe(true);
    expect(info.StreamAlias).toBe(true);
    for (const k of ['pipe', 'pause', 'resume', 'read', 'push', 'unshift', 'destroy', 'end', 'write']) {
      expect(info[k]).toBe('function');
    }
    expect(info.readableEnded).toBe(false);
    expect(info.writableEnded).toBe(false);
    expect(info.writableHighWaterMark).toBe(65536);
  });

  it('echoes through a real socket and tracks byte counters + pipe', async () => {
    const { out, err } = boot(`
      const net = require('net');
      const server = net.createServer((socket) => {
        socket.on('data', (buf) => console.log('SERVER_GOT', buf.toString()));
        socket.pipe(socket); // echo
      });
      server.listen(0, () => {
        const port = server.address().port;
        const client = net.createConnection(port, '127.0.0.1', () => {
          client.write('ping');
        });
        client.setEncoding('utf8');
        client.on('data', (s) => {
          console.log('CLIENT_GOT', JSON.stringify(s));
          client.end();
        });
        client.on('end', () => {
          console.log('CLIENT_END', client.bytesWritten, client.bytesRead > 0);
          server.close();
        });
      });
    `);
    await new Promise((r) => setTimeout(r, 60));
    const text = out.join('');
    expect(err.join('')).toBe('');
    expect(text).toContain('SERVER_GOT ping');
    expect(text).toContain('CLIENT_GOT "ping"');
    expect(text).toMatch(/CLIENT_END 4 true/);
  });
});
