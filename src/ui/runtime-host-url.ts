/**
 * Where the **runtime isolation host** lives, and whether an origin is it.
 *
 * The runtime is the realm that executes user code — and the OPFS its projects
 * are persisted to. Running it on the *app shell's* own origin means untrusted
 * code shares the shell's cookies, storage and credentials. So it is hosted in
 * an iframe on an **independent origin** instead, exactly as WebContainer does
 * with a `*.webcontainer-api.io` `credentialless` frame (M149).
 *
 * Three cases, mirroring `preview-url.ts`:
 *
 *  - **Dev server on loopback** — `rt.localhost:<devport>`. `*.localhost` is
 *    loopback in every browser, so the frame gets a real origin with no DNS
 *    setup, and the dev server already serves the whole app on any host.
 *
 *  - **Wildcard domain** (`VITE_WEB_NODE_RUNTIME_DOMAIN`, falling back to the
 *    preview domain) — `rt.<domain>`. The static-hosting expression of the same
 *    idea: every `<sub>.<domain>` is served by this one app.
 *
 *  - **Otherwise** — no isolated host. The runtime stays on the app's own origin
 *    (the behaviour before M149) and the caller says so honestly. A sub-path
 *    deploy such as GitHub Pages has no wildcard, so it lands here.
 *
 * Kept pure (no `location`/`import.meta` read) so the decision is unit-testable.
 */
export interface RuntimeHostEnv {
  /** `import.meta.env.DEV` — true only under `vite dev`. */
  dev: boolean;
  /** `import.meta.env.BASE_URL` — `/` in dev, `/web-node/` on Pages. */
  base: string;
  /** `location.origin` of the app shell. */
  origin: string;
  /** `location.hostname` of the app shell. */
  hostname: string;
  /** `location.port` (empty string when the default port is used). */
  port: string;
  /** Wildcard domain for previews (M113); reused for the runtime host. */
  previewDomain?: string;
  /** Explicit wildcard domain for the runtime host (`VITE_WEB_NODE_RUNTIME_DOMAIN`). */
  runtimeDomain?: string;
}

/** The runtime host shell's path (a Vite HTML entry, so it carries the right asset URLs). */
export const RUNTIME_HOST_SHELL_PATH = '/runtime-host.html';

/** The single label the runtime host gets in front of the wildcard domain. */
export const RUNTIME_HOST_LABEL = 'rt';

/** `*.localhost` is loopback in every browser; a LAN IP is not. */
function isLoopback(name: string): boolean {
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

function normalizedDomain(env: RuntimeHostEnv): string | undefined {
  const domain = (env.runtimeDomain ?? env.previewDomain)?.trim().replace(/^\./, '');
  return domain || undefined;
}

/**
 * The host the runtime isolation frame is served from, or null when no isolated
 * origin is available and the runtime must stay on the app's own origin.
 */
export function runtimeHostHostname(env: RuntimeHostEnv): string | null {
  // A sub-path deploy cannot host a subdomain origin: the frame would be served
  // from the origin root, where the app is not.
  if (env.base !== '/') return null;
  const domain = normalizedDomain(env);
  if (domain) return `${RUNTIME_HOST_LABEL}.${domain}`;
  if (env.dev && isLoopback(env.hostname)) return `${RUNTIME_HOST_LABEL}.localhost`;
  return null;
}

/**
 * The full URL of the runtime host shell to embed, plus its origin (used to
 * accept only that origin's `postMessage` traffic). Null when there is none.
 */
export function runtimeHostFrame(
  env: RuntimeHostEnv,
): { url: string; origin: string; hostname: string } | null {
  const host = runtimeHostHostname(env);
  if (!host) return null;
  const { protocol } = new URL(env.origin);
  const suffix = env.port ? `:${env.port}` : '';
  const origin = `${protocol}//${host}${suffix}`;
  return { url: `${origin}${RUNTIME_HOST_SHELL_PATH}`, origin, hostname: host };
}

/**
 * Whether `hostname` is the runtime host origin for this app. The host shell uses
 * this to recognise itself (it must run its isolation/bootstrap path only there),
 * and the app shell uses it to reject relay traffic from anywhere else.
 */
export function isRuntimeHostHostname(hostname: string, env: RuntimeHostEnv): boolean {
  const host = runtimeHostHostname(env);
  if (!host) return false;
  return hostname.replace(/:\d+$/, '').toLowerCase() === host.toLowerCase();
}
