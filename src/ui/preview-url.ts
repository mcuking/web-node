/**
 * Where a preview for `port` should be loaded from.
 *
 * Two strategies, picked by environment:
 *
 *  - **Dev server** — `<port>.localhost:<devport>`. `*.localhost` resolves to
 *    loopback in every modern browser, so each preview gets a *real origin*:
 *    absolute paths, cookies and storage all behave as they would on a real host.
 *    The dev middleware (`plugins/dev-subdomains.ts`) serves the bootstrap shell.
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
}

export function prefixPreviewUrl(port: number | string, env: PreviewEnv): string {
  return `${env.origin}${env.base}preview/${port}/`;
}

/**
 * The bootstrap shell's path on a preview subdomain. Kept in sync with
 * `SUBDOMAIN_SHELL_PATH` in `public/sw.js` (plain JS, so it cannot be imported).
 */
export const SUBDOMAIN_SHELL_PATH = '/__webnode__/';

/**
 * The URL to load *embedded*. In dev this is the origin-isolated subdomain; it
 * must be framed by the app shell, because it relays to the top-level page.
 */
export function previewUrl(port: number | string, env: PreviewEnv): string {
  const loopback = env.hostname === 'localhost' || env.hostname === '127.0.0.1';
  // Subdomains need the dev middleware *and* the origin root; a sub-path build
  // (Pages) or a non-dev server must use the prefix instead.
  if (env.dev && env.base === '/' && loopback) {
    const { protocol } = new URL(env.origin);
    const suffix = env.port ? `:${env.port}` : '';
    return `${protocol}//${port}.localhost${suffix}${SUBDOMAIN_SHELL_PATH}`;
  }
  return prefixPreviewUrl(port, env);
}
