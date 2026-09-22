import type { BuiltinSpec, BuiltinInitContext } from './types';
import { notImplemented } from '../errors';

/**
 * `dns` / `dns/promises` builtins — a loopback-only resolver.
 *
 * There is no real name resolution in a browser tab; the "network" is a virtual
 * TCP layer where every reachable server is bound in-process. So the honest
 * semantics are: every hostname resolves to loopback. That is exactly what
 * tooling wants too — Vite's dev server calls `dns.promises.lookup('localhost')`
 * during `buildStart` purely to decide whether it can advertise `127.0.0.1`.
 *
 * The two namespaces are derived from **one** descriptor of the query-type
 * surface, so the callback form and the promise form cannot drift.
 */

interface LookupAddress {
  address: string;
  family: number;
}

interface LookupOptions {
  family?: number | 'IPv4' | 'IPv6' | 0;
  hints?: number;
  all?: boolean;
  verbatim?: boolean;
}

const LOOPBACK_V4 = '127.0.0.1';
const LOOPBACK_V6 = '::1';

/** `internal/dns/utils`: the `getaddrinfo` hint flags. */
const FLAGS = { ADDRCONFIG: 1024, V4MAPPED: 2048, ALL: 256 } as const;

/** `internal/dns/utils`: the `cares` error codes exposed by both namespaces. */
const ERROR_CODES = {
  NODATA: 'ENODATA',
  FORMERR: 'EFORMERR',
  SERVFAIL: 'ESERVFAIL',
  NOTFOUND: 'ENOTFOUND',
  NOTIMP: 'ENOTIMP',
  REFUSED: 'EREFUSED',
  BADQUERY: 'EBADQUERY',
  BADNAME: 'EBADNAME',
  BADFAMILY: 'EBADFAMILY',
  BADRESP: 'EBADRESP',
  CONNREFUSED: 'ECONNREFUSED',
  TIMEOUT: 'ETIMEOUT',
  EOF: 'EOF',
  FILE: 'EFILE',
  NOMEM: 'ENOMEM',
  DESTRUCTION: 'EDESTRUCTION',
  BADSTR: 'EBADSTR',
  BADFLAGS: 'EBADFLAGS',
  NONAME: 'ENONAME',
  BADHINTS: 'EBADHINTS',
  NOTINITIALIZED: 'ENOTINITIALIZED',
  LOADIPHLPAPI: 'ELOADIPHLPAPI',
  ADDRGETNETWORKPARAMS: 'EADDRGETNETWORKPARAMS',
  CANCELLED: 'ECANCELLED',
} as const;

/** Pick the address family the caller asked for (default IPv4, like Node). */
function familyOf(family: LookupOptions['family']): 4 | 6 {
  if (family === 6 || family === 'IPv6') return 6;
  return 4;
}

function makeResult(options: LookupOptions): LookupAddress {
  const family = familyOf(options.family);
  return { address: family === 6 ? LOOPBACK_V6 : LOOPBACK_V4, family };
}

type LookupCb = (err: Error | null, address?: string | LookupAddress[], family?: number) => void;
type ResolveCb<T> = (err: Error | null, records?: T[]) => void;

function lookupImpl(hostname: string, options: LookupOptions | LookupCb, callback?: LookupCb): void {
  let opts: LookupOptions;
  let cb: LookupCb;
  if (typeof options === 'function') {
    cb = options;
    opts = {};
  } else {
    if (typeof callback !== 'function') {
      // Match Node: this is a synchronous TypeError, not a callback error.
      throw Object.assign(
        new TypeError(
          'The "callback" argument must be of type function. Received type ' + typeof callback,
        ),
        { code: 'ERR_INVALID_ARG_TYPE' },
      );
    }
    cb = callback;
    opts = options ?? {};
  }
  // Node defers the callback rather than calling it synchronously.
  queueMicrotask(() => {
    if (typeof hostname !== 'string' || hostname.length === 0) {
      cb(Object.assign(new Error('ENOTFOUND ' + hostname), { code: 'ENOTFOUND', hostname }));
      return;
    }
    const result = makeResult(opts);
    if (opts.all) cb(null, [result]);
    else cb(null, result.address, result.family);
  });
}

/**
 * Query-type API descriptors. `ok` ones resolve against the loopback model;
 * the rest have no meaning without a real resolver and throw loudly (rather
 * than silently returning an empty list, which would mislead feature checks).
 */
type ResolverFn = (hostname: string, cb: ResolveCb<unknown>) => void;

const QUERY_TYPES = [
  'resolve',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTlsa',
  'resolveTxt',
] as const;

const WORKING_TYPES: Record<string, ResolverFn> = {
  resolve4: (_host, cb) => queueMicrotask(() => cb(null, [LOOPBACK_V4])),
  resolve6: (_host, cb) => queueMicrotask(() => cb(null, [LOOPBACK_V6])),
  reverse: (_host, cb) => queueMicrotask(() => cb(null, ['localhost'])),
};

const unsupported = (name: string): ResolverFn => () => {
  throw notImplemented('api', `dns.${name}`);
};

/** A `Resolver` instance owns its own server list; everything else is shared. */
class Resolver {
  #servers: string[];

  constructor(options?: { timeout?: number; tries?: number }) {
    void options;
    this.#servers = ['127.0.0.1'];
  }

  cancel(): void {}
  getServers(): string[] {
    return this.#servers.slice();
  }
  setServers(servers: unknown): void {
    if (!Array.isArray(servers)) {
      throw Object.assign(new TypeError('The "servers" argument must be an instance of Array.'), {
        code: 'ERR_INVALID_ARG_TYPE',
      });
    }
    this.#servers = servers.map((s) => String(s));
  }
}

/**
 * Build the two namespaces from the same descriptors. `wrap` turns a callback
 * resolver into the promise form for `dns/promises`.
 */
function buildNamespaces() {
  let servers = ['127.0.0.1'];
  const getDefaultResultOrder = (): string => 'verbatim';
  const setDefaultResultOrder = (): void => undefined;
  const getServers = (): string[] => servers.slice();
  const setServers = (next: unknown): void => {
    if (!Array.isArray(next)) {
      throw Object.assign(new TypeError('The "servers" argument must be an instance of Array.'), {
        code: 'ERR_INVALID_ARG_TYPE',
      });
    }
    servers = next.map((s) => String(s));
  };
  const lookupService = (
    _address: string,
    _port: number,
    cb: (err: Error | null, host?: { hostname: string; service: string }) => void,
  ): void => queueMicrotask(() => cb(null, { hostname: 'localhost', service: '' }));

  // Callback surface.
  const cbSurface: Record<string, unknown> = {
    lookup: lookupImpl,
    lookupService,
    getDefaultResultOrder,
    setDefaultResultOrder,
    getServers,
    setServers,
    Resolver,
    ...WORKING_TYPES,
  };
  for (const name of QUERY_TYPES) cbSurface[name] = unsupported(name);

  // Promise surface: same names, promisified.
  const promiseSurface: Record<string, unknown> = {
    lookup(
      hostname: string,
      options: LookupOptions = {},
    ): Promise<LookupAddress | LookupAddress[]> {
      return new Promise((resolve, reject) => {
        lookupImpl(hostname, options, (err, address, family) => {
          if (err) reject(err);
          else if (options.all) resolve(address as LookupAddress[]);
          else resolve({ address: address as string, family: family as number });
        });
      });
    },
    lookupService(address: string, port: number): Promise<{ hostname: string; service: string }> {
      return new Promise((resolve, reject) => {
        lookupService(address, port, (err, host) => (err ? reject(err) : resolve(host!)));
      });
    },
    getDefaultResultOrder,
    setDefaultResultOrder,
    getServers,
    setServers,
    Resolver,
  };
  // `resolve4`/`resolve6`/`reverse` resolve directly; the rest keep throwing.
  promiseSurface.resolve4 = (hostname: string): Promise<string[]> =>
    new Promise((resolve, reject) => {
      WORKING_TYPES.resolve4(hostname, (err, records) =>
        err ? reject(err) : resolve(records as string[]),
      );
    });
  promiseSurface.resolve6 = (hostname: string): Promise<string[]> =>
    new Promise((resolve, reject) => {
      WORKING_TYPES.resolve6(hostname, (err, records) =>
        err ? reject(err) : resolve(records as string[]),
      );
    });
  promiseSurface.reverse = (hostname: string): Promise<string[]> =>
    new Promise((resolve, reject) => {
      WORKING_TYPES.reverse(hostname, (err, records) =>
        err ? reject(err) : resolve(records as string[]),
      );
    });
  for (const name of QUERY_TYPES) promiseSurface[name] = unsupported(name);

  return { cbSurface, promiseSurface, ERROR_CODES };
}

export const dnsPromisesSpec: BuiltinSpec = {
  id: 'dns/promises',
  aliases: ['node:dns/promises'],
  origin: 'web-node',
  init: () => {
    const { promiseSurface, ERROR_CODES: codes } = buildNamespaces();
    return { ...promiseSurface, ...codes };
  },
};

export const dnsSpec: BuiltinSpec = {
  id: 'dns',
  aliases: ['node:dns'],
  origin: 'web-node',
  init: (_ctx: BuiltinInitContext) => {
    const { cbSurface, promiseSurface, ERROR_CODES: codes } = buildNamespaces();
    return { ...cbSurface, promises: promiseSurface, ...FLAGS, ...codes };
  },
};
