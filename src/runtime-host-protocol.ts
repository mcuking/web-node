/**
 * The bridge protocol between the app shell and the runtime isolation host.
 *
 * The runtime lives in an iframe on an independent origin (M149), so the app
 * shell cannot reach into that origin's worker directly. The host frame is a
 * **transparent pipe**: it relays the runtime-worker request/response messages
 * verbatim (it never inspects the payload), and it relays HMR frames — which
 * travel on a `BroadcastChannel` scoped to the *runtime's* origin, and so are
 * invisible to the app shell.
 *
 * Every bridge message is tagged with {@link HOST_TAG} so it cannot be confused
 * with the preview iframe's own `postMessage` traffic (which shares the
 * `__wnHmr` shape). The protocol is pure data (no DOM), so the routing helpers
 * are unit-testable.
 */
export const HOST_TAG = '__wnHost';

/** A worker name the host frame maintains. `''` is the shared runtime worker. */
export type HostWorkerName = string;

/** App shell → runtime host frame. */
export type ParentToHost =
  /** Ensure a worker of this name exists (created lazily on first use). */
  | { __wnHost: 'boot'; name: HostWorkerName }
  /** Forward a message to that worker (verbatim). */
  | { __wnHost: 'post'; name: HostWorkerName; data: unknown }
  /** Tear the worker down (used by the throwaway build worker). */
  | { __wnHost: 'terminate'; name: HostWorkerName }
  /** Publish an HMR frame on the runtime origin's channel. */
  | { __wnHost: 'hmr'; port: number; frame: unknown };

/** Runtime host frame → app shell. */
export type HostToParent =
  /**
   * The host document is live and messages will now be relayed. `isolated`
   * reports whether the host origin got COOP/COEP; when false the runtime runs
   * without cross-origin isolation (SharedArrayBuffer unavailable).
   */
  | { __wnHost: 'up'; isolated: boolean }
  /** A message from a worker (verbatim). */
  | { __wnHost: 'data'; name: HostWorkerName; data: unknown }
  /** A worker failed to start or raised an error. */
  | { __wnHost: 'error'; name: HostWorkerName; message: string }
  /** An HMR frame from the runtime origin's channel. */
  | { __wnHost: 'hmr'; port: number; frame: unknown };

/** True for any well-formed bridge message (either direction). */
export function isHostMessage(data: unknown): boolean {
  return typeof data === 'object' && data !== null && HOST_TAG in (data as Record<string, unknown>);
}

/** Narrow an unknown `postMessage` payload to a bridge message of `kind`. */
export function isHostMessageOf<K extends string>(
  data: unknown,
  kind: K,
): data is { __wnHost: K } & Record<string, unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>)[HOST_TAG] === kind
  );
}
