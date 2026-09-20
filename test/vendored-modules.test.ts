import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * Three more top-level modules are real Node source now: punycode.js (zero
 * native deps), domain.js (over events + async_hooks) and
 * diagnostics_channel.js (over async_hooks, on a small JS binding). Every
 * expected value below was read off a real Node v26 first.
 */
function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return { runtime, realm: runtime.realm as any };
}

describe('vendored: punycode', () => {
  it('encodes/decodes IDN labels and exposes the Node surface', () => {
    const { realm } = boot();
    const punycode = realm.require('punycode');
    expect(punycode.encode('mañana')).toBe('maana-pta');
    expect(punycode.decode('maana-pta')).toBe('mañana');
    expect(punycode.toASCII('☃-⌘.com')).toBe('xn----dqo34k.com');
    expect(Object.keys(punycode).sort()).toEqual([
      'decode',
      'encode',
      'toASCII',
      'toUnicode',
      'ucs2',
      'version',
    ]);
  });
});

describe('vendored: domain', () => {
  it('runs in a scope and routes errors to the error handler', () => {
    const { realm } = boot();
    const domain = realm.require('domain');
    const d = domain.create();
    const methods = ['run', 'add', 'remove', 'bind', 'intercept', 'enter', 'exit'];
    for (const m of methods) expect(typeof d[m]).toBe('function');
    // Node v26 no longer ships the removed `dispose()`.
    expect(d.dispose).toBeUndefined();

    const caught: string[] = [];
    d.on('error', (e: Error) => caught.push(e.message));
    d.run(() => {
      d.emit('error', new Error('boom'));
    });
    expect(caught).toEqual(['boom']);
  });

  it('exports the same surface as Node', () => {
    const { realm } = boot();
    const domain = realm.require('domain');
    expect(Object.keys(domain).sort()).toEqual([
      'Domain',
      '_stack',
      'active',
      'create',
      'createDomain',
    ]);
  });
});

describe('vendored: diagnostics_channel', () => {
  it('publishes to subscribers', () => {
    const { realm } = boot();
    const dc = realm.require('diagnostics_channel');
    expect(Object.keys(dc).sort()).toEqual([
      'BoundedChannel',
      'Channel',
      'boundedChannel',
      'channel',
      'hasSubscribers',
      'subscribe',
      'tracingChannel',
      'unsubscribe',
    ]);

    const seen: unknown[] = [];
    const onMessage = (message: unknown, name: string) => seen.push([name, message]);
    dc.subscribe('demo', onMessage);
    expect(dc.hasSubscribers('demo')).toBe(true);
    dc.channel('demo').publish({ hello: 'world' });
    dc.unsubscribe('demo', onMessage);
    expect(dc.hasSubscribers('demo')).toBe(false);
    expect(seen).toEqual([['demo', { hello: 'world' }]]);
  });

  it('tracingChannel emits start/end around traceSync (needs real async_hooks)', () => {
    const { realm } = boot();
    const dc = realm.require('diagnostics_channel');
    const t = dc.tracingChannel('demo');
    const events: string[] = [];
    for (const ev of ['start', 'end', 'asyncStart', 'asyncEnd', 'error']) {
      t.subscribe({ [ev]: () => events.push(ev) });
    }
    t.traceSync(() => 1);
    expect(events).toEqual(['start', 'end']);
  });
});
