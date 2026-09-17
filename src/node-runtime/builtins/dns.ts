import type { BuiltinSpec } from './types';
import { notImplemented } from '../errors';

/**
 * `dns` builtin — a loopback-only resolver.
 *
 * There is no real name resolution in a browser tab; the "network" is a virtual
 * TCP layer where every reachable server is bound in-process. So the honest
 * semantics are: every hostname resolves to loopback. That is exactly what
 * tooling wants too — Vite's dev server calls `dns.promises.lookup('localhost')`
 * during `buildStart` purely to decide whether it can advertise `127.0.0.1`.
 *
 * `lookup` mirrors Node's callback contract (options object, `all: true`,
 * `family`, `verbatim`) closely enough for feature-detection code, and the
 * `promises` namespace wraps the same logic.
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

function lookup(hostname: string, options: LookupOptions | LookupCb, callback?: LookupCb): void {
  let opts: LookupOptions;
  let cb: LookupCb;
  if (typeof options === 'function') {
    cb = options;
    opts = {};
  } else {
    if (typeof callback !== 'function') {
      // Match Node: this is a synchronous TypeError, not a callback error.
      throw Object.assign(new TypeError('The "callback" argument must be of type function. Received type ' + typeof callback), {
        code: 'ERR_INVALID_ARG_TYPE',
      });
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

const promises = {
  lookup(hostname: string, options: LookupOptions = {}): Promise<LookupAddress | LookupAddress[]> {
    return new Promise((resolve, reject) => {
      // Re-use the callback form so the two namespaces cannot drift.
      lookup(hostname, options, (err, address, family) => {
        if (err) reject(err);
        else if (options.all) resolve(address as LookupAddress[]);
        else resolve({ address: address as string, family: family as number });
      });
    });
  },
  resolve4(hostname: string): Promise<string[]> {
    return Promise.resolve([LOOPBACK_V4]);
  },
  resolve6(hostname: string): Promise<string[]> {
    return Promise.resolve([LOOPBACK_V6]);
  },
  reverse(ip: string): Promise<string[]> {
    return Promise.resolve(['localhost']);
  },
};

export const dnsPromisesSpec: BuiltinSpec = {
  id: 'dns/promises',
  aliases: ['node:dns/promises'],
  origin: 'web-node',
  init: () => promises,
};

export const dnsSpec: BuiltinSpec = {
  id: 'dns',
  aliases: ['node:dns'],
  origin: 'web-node',
  init: () => {
    const Unsupported = (name: string) => () => {
      throw notImplemented('api', `dns.${name}`);
    };
    return {
      lookup,
      promises,
      reverse: (ip: string, cb: (err: Error | null, hostnames?: string[]) => void) =>
        queueMicrotask(() => cb(null, ['localhost'])),
      resolve4: (host: string, cb: (err: Error | null, addrs?: string[]) => void) =>
        queueMicrotask(() => cb(null, [LOOPBACK_V4])),
      resolve6: (host: string, cb: (err: Error | null, addrs?: string[]) => void) =>
        queueMicrotask(() => cb(null, [LOOPBACK_V6])),
      getDefaultResultOrder: () => 'verbatim',
      setDefaultResultOrder: () => undefined,
      // Query-by-type APIs have no meaning without a resolver.
      resolve: Unsupported('resolve'),
      resolveAny: Unsupported('resolveAny'),
      resolveCname: Unsupported('resolveCname'),
      resolveMx: Unsupported('resolveMx'),
      resolveNaptr: Unsupported('resolveNaptr'),
      resolveNs: Unsupported('resolveNs'),
      resolvePtr: Unsupported('resolvePtr'),
      resolveSoa: Unsupported('resolveSoa'),
      resolveSrv: Unsupported('resolveSrv'),
      resolveTxt: Unsupported('resolveTxt'),
      Resolver: class Resolver {},
      // Error codes Node exposes; feature-detection reads these.
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
    };
  },
};
