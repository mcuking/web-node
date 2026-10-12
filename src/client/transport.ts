/**
 * How the app shell talks to the runtime (M149).
 *
 * The runtime worker is addressed through a small {@link RuntimeTransport}
 * interface so the source of the message — a worker on this origin, or a relayed
 * worker inside the cross-origin isolation frame — is an implementation detail.
 * `RuntimeClient` only ever sees `post` / `onData` / `onError` / `terminate`.
 */
import { HOST_TAG, isHostMessageOf, type HostToParent, type ParentToHost } from '../runtime-host-protocol';

export interface RuntimeTransport {
  /** Send a request/command to the runtime worker. */
  post(data: unknown): void;
  /** A message from the runtime worker. */
  onData: ((data: unknown) => void) | null;
  /** A transport- or worker-level error, already formatted for the terminal. */
  onError: ((message: string) => void) | null;
  /** Stop the worker. */
  terminate(): void;
}

/**
 * The worker on the app's *own* origin — the pre-M149 path, kept as the fallback
 * when no isolated host origin is available (a sub-path deploy with no wildcard
 * domain). Everything about it is unchanged from before.
 */
export class WorkerTransport implements RuntimeTransport {
  #worker: Worker;
  onData: ((data: unknown) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor(name = '') {
    // Boot timing handshake (M107): read by the page, harmless elsewhere.
    const boot = (globalThis as { __wnBoot?: { workerSpawnMs: number } }).__wnBoot;
    if (boot) boot.workerSpawnMs = Math.round(performance.now());
    // Both options objects are static literals on purpose: Vite only rewrites a
    // worker it can parse statically. The worker learns it is the throwaway
    // **build** worker from `self.name` (M139), switching it to a read-only view.
    this.#worker =
      name === 'web-node-build'
        ? new Worker(new URL('../worker/runtime.worker.ts', import.meta.url), {
            type: 'module',
            name: 'web-node-build',
          })
        : new Worker(new URL('../worker/runtime.worker.ts', import.meta.url), { type: 'module' });
    this.#worker.onmessage = (event: MessageEvent) => this.onData?.(event.data);
    this.#worker.onerror = (event) =>
      this.onError?.(`[worker error] ${(event as ErrorEvent).message}\n`);
    this.#worker.onmessageerror = (event) =>
      this.onError?.(`[worker message error] ${String((event as MessageEvent).data)}\n`);
  }

  post(data: unknown): void {
    this.#worker.postMessage(data);
  }

  terminate(): void {
    this.#worker.terminate();
  }
}

/**
 * Owns the single cross-origin isolation frame and mints one
 * {@link FrameTransport} per worker name.
 *
 * The frame is created lazily but only once: the runtime (and the OPFS it owns)
 * must be a *single* realm per name even when several `RuntimeClient`s exist
 * (the shared worker and the throwaway build worker). The build worker is a
 * separate name on the *same* origin, so it reads the same store — exactly as
 * two workers on the app origin did before.
 */
export class RuntimeHostBridge {
  #frame: HTMLIFrameElement | null = null;
  #transports = new Map<string, FrameTransport>();
  #hmrListeners = new Set<(port: number, frame: unknown) => void>();
  #up: Promise<boolean>;
  #resolveUp!: (isolated: boolean) => void;
  #upDone = false;
  #isolated: boolean | null = null;

  constructor(
    readonly url: string,
    readonly origin: string,
  ) {
    this.#up = new Promise<boolean>((resolve) => (this.#resolveUp = resolve));
  }

  /** Whether the host origin ended up cross-origin isolated (null until known). */
  get isolated(): boolean | null {
    return this.#isolated;
  }

  #mount(): void {
    if (this.#frame) return;
    window.addEventListener('message', (event) => this.#onMessage(event));
    const frame = document.createElement('iframe');
    frame.title = 'web-node runtime host';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // The runtime executes untrusted code; keep the frame out of layout but not
    // `display:none` (browsers throttle hidden frames).
    frame.style.cssText = 'position:absolute;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
    // No `credentialless` here: a credentialless cross-origin frame is given an
    // **ephemeral** storage partition, which would throw away the runtime's OPFS
    // — and with it every project — on each load (verified with a minimal
    // repro). The frame still gets its own origin (so it cannot read the app
    // shell's cookies/storage), and does not send the shell's credentials on its
    // own requests. `allow="cross-origin-isolated"` *delegates* cross-origin
    // isolation to the frame: without it the frame's COEP/COOP are not enough,
    // because a cross-origin child does not inherit the parent's restricted
    // cross-origin isolation (M149).
    frame.setAttribute('allow', 'cross-origin-isolated');
    frame.src = this.url;
    this.#frame = frame;
    document.body.appendChild(frame);
  }

  #onMessage(event: MessageEvent): void {
    if (event.origin !== this.origin) return;
    const data = event.data as HostToParent | undefined;
    if (!data || typeof data !== 'object' || !(HOST_TAG in data)) return;
    if (isHostMessageOf(data, 'up')) {
      this.#isolated = Boolean(data.isolated);
      this.#upDone = true;
      this.#resolveUp(this.#isolated);
      return;
    }
    if (isHostMessageOf(data, 'data')) {
      this.#transports.get(String(data.name))?.deliver(data.data);
      return;
    }
    if (isHostMessageOf(data, 'error')) {
      this.#transports.get(String(data.name))?.fail(String(data.message));
      return;
    }
    if (isHostMessageOf(data, 'hmr')) {
      for (const listener of this.#hmrListeners) listener(Number(data.port), data.frame);
    }
  }

  #send(msg: ParentToHost): void {
    this.#frame?.contentWindow?.postMessage(msg, this.origin);
  }

  /** Register a listener for HMR frames arriving from the runtime origin. */
  onHmr(listener: (port: number, frame: unknown) => void): void {
    this.#mount();
    this.#hmrListeners.add(listener);
  }

  /** Publish an HMR frame the preview posted, onto the runtime origin's channel. */
  publishHmr(port: number, frame: unknown): void {
    this.#send({ __wnHost: 'hmr', port, frame });
  }

  transport(name: string): RuntimeTransport {
    this.#mount();
    let transport = this.#transports.get(name);
    if (!transport) {
      transport = new FrameTransport(name, this);
      this.#transports.set(name, transport);
    }
    return transport;
  }

  /** @internal — used by {@link FrameTransport}. */
  whenUp(): Promise<boolean> {
    return this.#up;
  }

  /** @internal */
  postTo(name: string, data: unknown): void {
    this.#send({ __wnHost: 'post', name, data });
  }

  /** @internal */
  boot(name: string): void {
    this.#send({ __wnHost: 'boot', name });
  }

  /** @internal */
  terminateRemote(name: string): void {
    this.#send({ __wnHost: 'terminate', name });
  }
}

/**
 * A {@link RuntimeTransport} bound to one worker name inside the host frame.
 *
 * Messages are buffered until the host frame is up (its document loaded and, if
 * needed, reloaded into cross-origin isolation); the `boot` message is sent
 * first so the host creates the worker before any `post` reaches it (both travel
 * over the same source→target queue, so ordering holds).
 */
export class FrameTransport implements RuntimeTransport {
  onData: ((data: unknown) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  #queued: unknown[] = [];
  #live = false;
  #booted = false;
  #terminated = false;

  constructor(
    readonly name: string,
    private readonly bridge: RuntimeHostBridge,
  ) {
    void bridge.whenUp().then(() => {
      if (this.#terminated) return;
      this.#booted = true;
      this.bridge.boot(this.name);
      const pending = this.#queued;
      this.#queued = [];
      this.#live = true;
      for (const data of pending) this.bridge.postTo(this.name, data);
    });
  }

  post(data: unknown): void {
    if (!this.#live) {
      this.#queued.push(data);
      return;
    }
    this.bridge.postTo(this.name, data);
  }

  terminate(): void {
    this.#terminated = true;
    if (this.#booted) this.bridge.terminateRemote(this.name);
    this.#queued = [];
    this.#live = false;
  }

  /** @internal */
  deliver(data: unknown): void {
    this.onData?.(data);
  }

  /** @internal */
  fail(message: string): void {
    this.onError?.(`[worker error] ${message}\n`);
  }
}
