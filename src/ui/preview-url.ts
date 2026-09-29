/**
 * Where a preview for `port` should be loaded from.
 *
 * Three strategies, picked by environment:
 *
 *  - **Dev server** — `<port>.localhost:<devport>`. `*.localhost` resolves to
 *    loopback in every modern browser, so each preview gets a *real origin*:
 *    absolute paths, cookies and storage all behave as they would on a real host.
 *    The dev middleware (`plugins/dev-subdomains.ts`) serves the bootstrap shell.
 *
 *  - **Wildcard domain** (`previewDomain`) — `<port>.<previewDomain>`. This is
 *    the static-hosting answer to the same problem: when the host serves every
 *    `<sub>.<domain>` from this one app (a custom domain with a `*` DNS record,
 *    or plain `localhost` on any static file server), each preview again gets a
 *    real origin. The shell is then a *static asset* (`public/__webnode__/`), so
 *    no dev middleware is involved.
 *
 *  - **Everything else (a build, `vite preview`, GitHub Pages)** — a path prefix
 *    on the app's own origin, `<base>preview/<port>/`. No DNS wildcard is
 *    available, so origin isolation is not an option; the prefix bridge handles
 *    it, with HTML `<base>` injection for relative assets. The prefix is also
 *    what the **pop-out** link uses: a subdomain preview relays through the top
 *    page, so it only works when framed.
 *
 * Kept pure (no `location` read) so the choice is unit-testable.
 */
export interface PreviewEnv {
  /** `import.meta.env.DEV` — true only under `vite dev`. */
  dev: boolean;
  /** `import.meta.env.BASE_URL` — `/` in dev, `/web-node/` on Pages. */
  base: string;
  /** `location.origin`. */
  origin: string;
  /** `location.hostname`. */
  hostname: string;
  /** `location.port` (empty string when the default port is used). */
  port: string;
  /**
   * A wildcard domain whose every `<port>.<domain>` subdomain is served by this
   * same app (M113). Set from `VITE_WEB_NODE_PREVIEW_DOMAIN`. When present, a
   * preview is addressed as a real subdomain origin on **any** host — a custom
   * domain, or even `localhost` on a plain static server.
   */
  previewDomain?: string;
}

export function prefixPreviewUrl(port: number | string, env: PreviewEnv): string {
  return `${env.origin}${env.base}preview/${port}/`;
}

/**
 * The bootstrap shell's path on a preview subdomain. Kept in sync with
 * `SUBDOMAIN_SHELL_PATH` in `public/sw.js` (plain JS, so it cannot be imported).
 */
export const SUBDOMAIN_SHELL_PATH = '/__webnode__/';

/** `*.localhost` is loopback in every browser; a LAN IP is not. */
function isLoopback(name: string): boolean {
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

/**
 * The host a preview for `port` should be served from, or null when no
 * subdomain is available and the caller must fall back to the path prefix.
 */
export function previewSubdomainHost(port: number | string, env: PreviewEnv): string | null {
  const domain = env.previewDomain?.trim().replace(/^\./, '');
  if (domain) return `${port}.${domain}`;
  // The dev middleware serves the shell, so this needs the dev server *and* the
  // origin root (a sub-path build cannot host `<port>.localhost`).
  if (env.dev && env.base === '/' && isLoopback(env.hostname)) return `${port}.localhost`;
  return null;
}

/**
 * The port encoded in a preview subdomain, or null.
 *
 * `<port>.localhost` is always recognised; when `previewDomain` is configured,
 * `<port>.<previewDomain>` is recognised too. Kept in sync with `portFromHost`
 * in `public/sw.js` (plain JS, so it cannot be imported) and unit-tested here.
 */
export function previewPortFromHost(hostname: string, previewDomain?: string): number | null {
  const host = hostname.replace(/:\d+$/, '').toLowerCase();
  const suffixes = ['localhost'];
  const domain = previewDomain?.trim().replace(/^\./, '').toLowerCase();
  if (domain && domain !== 'localhost') suffixes.push(domain);
  for (const suffix of suffixes) {
    if (host === suffix || !host.endsWith(`.${suffix}`)) continue;
    const label = host.slice(0, host.length - suffix.length - 1);
    if (!/^\d+$/.test(label)) continue;
    const port = Number(label);
    if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  }
  return null;
}

/**
 * The URL to load *embedded*. In dev (or on a wildcard domain) this is the
 * origin-isolated subdomain; it must be framed by the app shell, because it
 * relays to the top-level page.
 */
export function previewUrl(port: number | string, env: PreviewEnv): string {
  const host = previewSubdomainHost(port, env);
  if (host) {
    const { protocol } = new URL(env.origin);
    const suffix = env.port ? `:${env.port}` : '';
    // A sub-path build still serves the shell/worker/app under `base`, so the
    // static shell needs to be told where the app lives. `/` is the default.
    const query = env.base === '/' ? '' : `?base=${encodeURIComponent(env.base)}`;
    return `${protocol}//${host}${suffix}${SUBDOMAIN_SHELL_PATH}${query}`;
  }
  return prefixPreviewUrl(port, env);
}
