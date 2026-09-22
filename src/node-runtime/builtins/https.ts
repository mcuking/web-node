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
 * What we deliberately do NOT fake: real TLS options (`key`/`cert`/`ca`,
 * `rejectUnauthorized`) are accepted and ignored rather than silently changing
 * security semantics, and `tls.*` remains unimplemented.
 */
export const httpsSpec: BuiltinSpec = {
  id: 'https',
  aliases: ['node:https'],
  origin: 'web-node',
  arity: { Agent: 1, Server: 2, createServer: 2, get: 3, request: 0 },
  deps: ['http'],
  init: (ctx: BuiltinInitContext) => {
    const http = ctx.require('http') as Record<string, unknown>;
    const server = http.createServer as (...args: unknown[]) => unknown;
    const request = http.request as (...args: unknown[]) => unknown;
    const get = http.get as (...args: unknown[]) => unknown;

    return {
      ...http,
      Agent: http.Agent,
      globalAgent: http.globalAgent,
      createServer: server,
      request,
      get,
      default: { createServer: server, request, get },
    };
  },
};
