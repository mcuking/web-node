import type { BuiltinSpec, BuiltinInitContext } from './types';

/**
 * `https` builtin — the `http` surface under a TLS-shaped name.
 *
 * There is no TLS in the virtual network: a browser tab cannot open a raw TCP
 * socket, and the ServiceWorker bridge already terminates real TLS at the HTTP
 * layer. So `https.createServer()` / `https.request()` are the `http`
 * implementations, which is the behaviour sandbox code actually wants —
 * `https.get('https://…')` inside a project is a virtual, in-process request.
 *
 * What we deliberately do NOT fake: TLS material (`key`/`cert`/`ca`/`pfx`,
 * SNI contexts, session ticket keys) is *recorded* on the server but never
 * used, because there is no handshake to feed it to; `tls.*` stays
 * unimplemented. The server/agent classes below exist so the surface matches
 * Node (a `https.Server` is not a bare `http.Server`, an `https.Agent` is not a
 * bare `http.Agent`).
 */
export const httpsSpec: BuiltinSpec = {
  id: 'https',
  aliases: ['node:https'],
  origin: 'web-node',
  arity: { Agent: 1, Server: 2, createServer: 2, get: 3, request: 0 },
  deps: ['http'],
  init: (ctx: BuiltinInitContext) => {
    const http = ctx.require('http') as Record<string, unknown>;
    const HttpServer = http.Server as new (listener?: unknown) => Record<string, unknown>;
    const HttpAgent = http.Agent as new (options?: Record<string, unknown>) => Record<string, unknown>;
    const httpRequest = http.request as (...args: unknown[]) => unknown;
    const httpGet = http.get as (...args: unknown[]) => unknown;
    const crypto = ctx.require('crypto') as { randomBytes(size: number): Uint8Array };

    /**
     * `https.Server` — in Node this is a `tls.Server`. Here it extends the
     * virtual `http.Server` and additionally exposes the TLS-config surface,
     * so feature detection and `server.addContext(...)`/`setSecureContext(...)`
     * calls behave rather than crash. The material is recorded, never used.
     */
    class HttpsServer extends HttpServer {
      /** Recorded default TLS context (`setSecureContext`). */
      key?: unknown;
      cert?: unknown;
      ca?: unknown;
      pfx?: unknown;

      #serverData: unknown = null;
      #contexts = new Map<string, Record<string, unknown>>();
      #ticketKeys: Uint8Array;

      constructor(options?: unknown, listener?: (socket: unknown) => void) {
        super(typeof options === 'function' ? options : listener);
        this.#ticketKeys = crypto.randomBytes(48);
        if (options !== null && typeof options === 'object') {
          this.setSecureContext(options as Record<string, unknown>);
        }
      }

      /** `server.setSecureContext(options)` — record the default TLS config. */
      setSecureContext(options: unknown): void {
        if (options === null || typeof options !== 'object') {
          throw new TypeError('The "options" argument must be of type object');
        }
        const opts = options as Record<string, unknown>;
        this.pfx = opts.pfx;
        this.key = opts.key;
        this.cert = opts.cert;
        this.ca = opts.ca;
      }

      /** `server.addContext(servername, context)` — record an SNI context. */
      addContext(servername: string, context: Record<string, unknown>): void {
        if (!servername) {
          throw Object.assign(new Error('Missing servername in addContext'), {
            code: 'ERR_TLS_REQUIRED_SERVER_NAME',
          });
        }
        this.#contexts.set(servername, context);
      }

      /** `server.getTicketKeys()` — the 48-byte session ticket keys. */
      getTicketKeys(): Uint8Array {
        return this.#ticketKeys;
      }

      /** `server.setTicketKeys(keys)` — replace the ticket keys (48 bytes). */
      setTicketKeys(keys: Uint8Array): void {
        if (!(keys instanceof Uint8Array)) {
          throw new TypeError('The "keys" argument must be an instance of Buffer');
        }
        if (keys.byteLength !== 48) {
          throw Object.assign(new Error('Session ticket keys must be a 48-byte buffer'), {
            code: 'ERR_INVALID_ARG_VALUE',
          });
        }
        this.#ticketKeys = keys;
      }

      /** @internal — cluster hand-off payload. */
      _getServerData(): { ticketKeys: string } {
        return { ticketKeys: hex(this.#ticketKeys) };
      }

      /** @internal — restore from a cluster hand-off payload. */
      _setServerData(data: { ticketKeys: string }): void {
        this.setTicketKeys(fromHex(data.ticketKeys));
      }
    }

    /** `https.Agent` — a `http.Agent` plus the TLS session cache. */
    class HttpsAgent extends HttpAgent {
      maxCachedSessions: number;
      /** @internal — `{ map, list }`, exactly like Node's session cache. */
      _sessionCache: { map: Record<string, unknown>; list: string[] } = { map: {}, list: [] };

      constructor(options?: Record<string, unknown>) {
        super(options);
        const opts = options ?? {};
        this.maxCachedSessions =
          opts.maxCachedSessions === undefined ? 100 : Number(opts.maxCachedSessions);
      }

      /** @internal — look up a cached TLS session by agent key. */
      _getSession(key: string): unknown {
        return this._sessionCache.map[key];
      }

      /** @internal — cache a TLS session (LRU-bounded by `maxCachedSessions`). */
      _cacheSession(key: string, session: unknown): void {
        if (this.maxCachedSessions === 0) return;
        if (this._sessionCache.map[key]) {
          this._sessionCache.map[key] = session;
          return;
        }
        if (this._sessionCache.list.length >= this.maxCachedSessions) {
          const oldKey = this._sessionCache.list.shift() as string;
          delete this._sessionCache.map[oldKey];
        }
        this._sessionCache.list.push(key);
        this._sessionCache.map[key] = session;
      }

      /** @internal — drop the session cached for an agent key. */
      _evictSession(key: string): void {
        const index = this._sessionCache.list.indexOf(key);
        if (index === -1) return;
        this._sessionCache.list.splice(index, 1);
        delete this._sessionCache.map[key];
      }
    }

    function hex(bytes: Uint8Array): string {
      let out = '';
      for (const b of bytes) out += b.toString(16).padStart(2, '0');
      return out;
    }
    function fromHex(text: string): Uint8Array {
      const out = new Uint8Array(text.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
      return out;
    }

    const globalAgent = new HttpsAgent();

    const createServer = (options?: unknown, listener?: (socket: unknown) => void): HttpsServer =>
      new HttpsServer(options, listener);

    // Default the agent to `https.globalAgent`, as Node does, when the caller
    // did not pick one.
    const withDefaultAgent = (args: unknown[]): unknown[] => {
      const [options] = args;
      if (options !== null && typeof options === 'object' && (options as Record<string, unknown>).agent === undefined) {
        return [{ ...(options as Record<string, unknown>), agent: globalAgent }, ...args.slice(1)];
      }
      return args;
    };

    const request = (...args: unknown[]): unknown => httpRequest(...withDefaultAgent(args));
    const get = (...args: unknown[]): unknown => httpGet(...withDefaultAgent(args));

    return {
      ...http,
      Agent: HttpsAgent,
      Server: HttpsServer,
      globalAgent,
      createServer,
      request,
      get,
      default: { Agent: HttpsAgent, Server: HttpsServer, globalAgent, createServer, request, get },
    };
  },
};
