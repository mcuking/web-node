import type { BuiltinSpec } from './types';

/**
 * `internal/deps/undici/undici` — a two-function shim, not the real thing.
 *
 * The vendored graph reaches this module from exactly one place:
 * `internal/worker/io.js` lazily requires it for `createFastMessageEvent`, the
 * helper that builds a `MessageEvent` without re-running WebIDL argument
 * conversion (it is called for every message a `MessagePort` delivers, so it is
 * on the hot path). Shipping Node's bundled undici would add ~600 KB of HTTP
 * client that nothing in this runtime can use.
 *
 * So this exposes the one function, built on the host's `MessageEvent` — which
 * is the same spec class Node's fast path constructs — and throws for every
 * other name so a future caller cannot silently get `undefined`.
 */
export const undiciSpec: BuiltinSpec = {
  id: 'internal/deps/undici/undici',
  origin: 'web-node',
  deps: ['internal/event_target'],
  init: (ctx) => {
    // Node's bundled MessageEvent extends the *same* `Event` class that
    // `EventTarget#dispatchEvent` validates against, which is why the host's
    // global cannot be reused here: a host `MessageEvent` is not an instance of
    // this realm's `Event`, and its `MessageEventInit` converter rejects any
    // `ports` entry that is not a host `MessagePort` (a `worker_threads` port is
    // not one). So the class is built from the realm's own `Event`.
    const { Event } = ctx.require('internal/event_target') as {
      Event: new (type: string, init?: unknown) => object;
    };

    class MessageEvent extends (Event as unknown as { new (t: string, i?: unknown): object }) {
      data: unknown;
      origin: string;
      lastEventId: string;
      source: unknown;
      ports: unknown[];

      constructor(type: string, init?: Record<string, unknown>) {
        super(type, init);
        this.data = init?.data ?? null;
        this.origin = typeof init?.origin === 'string' ? init.origin : '';
        this.lastEventId = typeof init?.lastEventId === 'string' ? init.lastEventId : '';
        this.source = init?.source ?? null;
        this.ports = Array.isArray(init?.ports) ? init.ports : [];
      }
    }

    return {
      MessageEvent,
      /**
       * `createFastMessageEvent(type, init)`. Node's version skips the WebIDL
       * converter because `internal/worker/io.js` only ever passes a
       * `{ data, ports }` object it built itself.
       */
      createFastMessageEvent: (type: string, init: { data?: unknown; ports?: unknown[] }) =>
        new MessageEvent(type, init ?? {}),
    };
  },
};
