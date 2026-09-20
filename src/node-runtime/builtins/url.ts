import type { BuiltinSpec } from './types';

function fileURLToPath(input: string | URL): string {
  const url = typeof input === 'string' ? new URL(input) : input;
  if (url.protocol !== 'file:') {
    throw new TypeError(`The URL must be of scheme file, got ${url.protocol}`);
  }
  let path = decodeURIComponent(url.pathname);
  if (url.hostname && url.hostname !== 'localhost') {
    path = '//' + url.hostname + path;
  }
  return path;
}

function pathToFileURL(input: string): URL {
  const path = input.startsWith('/') ? input : '/' + input;
  // Encode the characters that are not URL path safe; keep `/` as the separator.
  const encoded = path
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/%2F/gi, '/'))
    .join('/');
  return new URL('file://' + encoded);
}

/**
 * `url` — Node's URL utilities.
 *
 * WHATWG `URL` / `URLSearchParams` are native browser classes, so they are
 * re-exported directly. The Node-specific helpers real tooling reaches for
 * (`pathToFileURL`, `fileURLToPath`, `urlToHttpOptions`) are implemented on top
 * of them. The legacy `parse`/`format`/`resolve` API is provided in a minimal
 * but honest form.
 */
export const urlSpec: BuiltinSpec = {
  id: 'url',
  aliases: ['node:url'],
  origin: 'web-node',
  init: () => {
    const parse = (input: string): Record<string, unknown> => {
      const u = new URL(input, 'http://localhost');
      return {
        protocol: u.protocol,
        slashes: true,
        auth: u.username ? `${u.username}:${u.password}` : null,
        host: u.host,
        port: u.port,
        hostname: u.hostname,
        hash: u.hash,
        search: u.search,
        query: u.search.slice(1),
        pathname: u.pathname,
        path: u.pathname + u.search,
        href: u.href,
      };
    };

    const format = (obj: {
      protocol?: string;
      hostname?: string;
      host?: string;
      port?: string;
      pathname?: string;
      search?: string;
      query?: string | Record<string, string>;
      hash?: string;
    }): string => {
      const protocol = (obj.protocol ?? 'http:').replace(/:?$/, ':');
      const host = obj.host ?? obj.hostname ?? '';
      const port = obj.port ? ':' + obj.port : '';
      const pathname = obj.pathname ?? '/';
      let search = obj.search ?? '';
      if (!search && obj.query && typeof obj.query === 'object') {
        search = '?' + new URLSearchParams(obj.query).toString();
      } else if (!search && typeof obj.query === 'string') {
        search = '?' + obj.query;
      }
      const hash = obj.hash ? (obj.hash.startsWith('#') ? obj.hash : '#' + obj.hash) : '';
      return `${protocol}//${host}${port}${pathname}${search}${hash}`;
    };

    return {
      URL,
      URLSearchParams,
      pathToFileURL,
      fileURLToPath,
      // Node's `internal/url` predicates. `isURL` duck-types a WHATWG URL
      // (lib/internal/url.js); `isURLInstance` normally checks an internal
      // brand, which the host's URL does not carry, so we fall back to
      // `instanceof`.
      isURL: (self: unknown): boolean => {
        const u = self as { href?: unknown; protocol?: unknown; auth?: unknown; path?: unknown } | null;
        return Boolean(u && u.href && u.protocol && u.auth === undefined && u.path === undefined);
      },
      isURLInstance: (value: unknown): boolean =>
        typeof value === 'object' && value !== null && value instanceof URL,
      urlToHttpOptions: (u: URL) => ({
        protocol: u.protocol,
        hostname: u.hostname.startsWith('[') ? u.hostname.slice(1, -1) : u.hostname,
        hash: u.hash,
        search: u.search,
        pathname: u.pathname,
        path: u.pathname + u.search,
        href: u.href,
        port: u.port,
        auth: u.username ? `${u.username}:${u.password}` : undefined,
      }),
      domainToASCII: (domain: string) => domain,
      domainToUnicode: (domain: string) => domain,
      parse,
      format,
      resolve: (from: string, to: string) => new URL(to, from).href,
      resolveObject: (from: string, to: string) => parse(new URL(to, from).href),
      default: { URL, URLSearchParams, pathToFileURL, fileURLToPath, parse, format },
    };
  },
};
