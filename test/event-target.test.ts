import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `internal/event_target` is now Node's real `lib/internal/event_target.js`
 * (with `internal/webidl` + `internal/perf/utils`), replacing a stub whose
 * `isEventTarget()` always returned false. Expected values were read off Node
 * v26.9.0 first.
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
  return runtime.realm as any;
}

describe('vendored: internal/event_target', () => {
  it('exposes the real EventTarget / Event / NodeEventTarget classes', () => {
    const realm = boot();
    const et = realm.require('internal/event_target') as any;
    expect(typeof et.EventTarget).toBe('function');
    expect(typeof et.Event).toBe('function');
    expect(typeof et.CustomEvent).toBe('function');
    expect(typeof et.NodeEventTarget).toBe('function');
    expect(typeof et.isEventTarget).toBe('function');
    expect(typeof et.defineEventHandler).toBe('function');
    expect(typeof et.kEvents).toBe('symbol');
    expect(typeof et.kWeakHandler).toBe('symbol');
    expect(typeof et.kResistStopPropagation).toBe('symbol');
  });

  it('dispatches events through a real NodeEventTarget', () => {
    const realm = boot();
    const et = realm.require('internal/event_target') as any;
    const target = new et.NodeEventTarget();
    const seen: string[] = [];
    target.addEventListener('ping', (event: { type: string }) => seen.push(event.type));
    target.dispatchEvent(new et.Event('ping'));
    expect(seen).toEqual(['ping']);
    // Node's `isEventTarget` returns the brand symbol (truthy); verify it is not
    // the old always-false stub.
    expect(et.isEventTarget(target)).toBeTruthy();
  });

  it('reports re-entrant dispatch with ERR_EVENT_RECURSION', () => {
    const realm = boot();
    const et = realm.require('internal/event_target') as any;
    const target = new et.EventTarget();
    const event = new et.Event('boom');
    let caught: any;
    target.addEventListener('boom', () => {
      try {
        target.dispatchEvent(event);
      } catch (err) {
        caught = err;
      }
    });
    target.dispatchEvent(event);
    expect(caught?.code).toBe('ERR_EVENT_RECURSION');
    expect(caught?.message).toBe('The event "boom" is already being dispatched');
  });

  it('does not claim ordinary objects are event targets', () => {
    const realm = boot();
    const { isEventTarget } = realm.require('internal/event_target') as any;
    // Node returns `obj?.constructor?.[kIsEventTarget]`, i.e. `undefined` here.
    expect(isEventTarget({})).toBeFalsy();
    expect(isEventTarget(() => undefined)).toBeFalsy();
  });

  it('lets events.on() iterate a real EventTarget', async () => {
    const realm = boot();
    const et = realm.require('internal/event_target') as any;
    const events = realm.require('events') as any;
    const target = new et.NodeEventTarget();
    // `events.on` returns an async iterator that resolves on the next event.
    const iterator = events.on(target, 'tick');
    const next = iterator.next();
    target.dispatchEvent(new et.Event('tick'));
    const { value } = await next;
    // `events.on()` yields the listener argument list (Node does the same).
    expect(Array.isArray(value)).toBe(true);
    expect(value[0]).toBeInstanceOf(et.Event);
    expect(value[0].type).toBe('tick');
  });

  it('exposes the real internal/webidl helpers', () => {
    const realm = boot();
    const webidl = realm.require('internal/webidl') as any;
    expect(typeof webidl.converters).toBe('object');
    expect(typeof webidl.converters.DOMString).toBe('function');
    expect(webidl.converters.DOMString('x')).toBe('x');
    expect(typeof webidl.convertToInt).toBe('function');
    // Needs both range + signedness, exactly like Node (`NaN` otherwise).
    expect(webidl.convertToInt(7, 8, true)).toBe(7);
    expect(Number.isNaN(webidl.convertToInt(7))).toBe(true);
    expect(typeof webidl.requiredArguments).toBe('function');
    expect(typeof webidl.type).toBe('function');
  });
});
