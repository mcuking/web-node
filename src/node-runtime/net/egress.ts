/**
 * Outbound network ("egress") for the sandbox — M122.
 *
 * Everything inside the realm talks to the *virtual* TCP layer
 * (`net/network.ts`), which only knows about ports bound in this tab. A program
 * that dials the public internet used to get `ECONNREFUSED`, exactly as
 * WebContainer gives every real hostname a fake IP and lands on `127.0.0.1:1`.
 *
 * This module adds the missing half: a way to send a request *out* through the
 * host's own network stack. The host is a browser worker, so the only transport
 * available is `fetch()`, which is subject to the host page's CORS rules. That
 * is enough for the large majority of registries/APIs (they send
 * `Access-Control-Allow-Origin: *`), and when it is not, an operator can point
 * `proxy` at their **own** CORS-bridging endpoint — we deliberately do not
 * depend on any third-party hosted proxy (the official WebContainer API requires
 * StackBlitz's; we must be self-sufficient).
 *
 * The layer is intentionally transport-shaped, not HTTP-shaped: it hands back a
 * status line, headers and the body bytes, and `http`/`https` feed those into
 * the same parser they use for virtual responses. Raw TCP is a different story
 * — a browser cannot open one — so `dialTcp` exists only when the operator runs
 * a WebSocket TCP bridge, and its absence surfaces as a loud, typed error rather
 * than a silent hang.
 */

/** The request an egress call describes. `url` is always absolute. */
export interface EgressRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

/** The response, in the shape `http`'s message reader consumes. */
export interface EgressResponse {
  status: number;
  statusMessage: string;
  headers: Record<string, string | string[]>;
  body: Uint8Array;
}

/** A live byte pipe to a remote host (only when a raw-TCP bridge is set). */
export interface EgressTcpSocket {
  write(chunk: Uint8Array): void;
  end(): void;
  destroy(err?: Error): void;
}

export interface Egress {
  /** Perform one HTTP exchange over the host's network. */
  request(req: EgressRequest): Promise<EgressResponse>;
  /**
   * Open a raw byte pipe to `host:port`. Present only when a WebSocket TCP
   * bridge is configured; absent otherwise so `net.connect` can fail honestly.
   */
  dialTcp?(
    host: string,
    port: number,
    handlers: {
      onConnect: () => void;
      onData: (chunk: Uint8Array) => void;
      onEnd: () => void;
      onError: (err: Error) => void;
    },
  ): EgressTcpSocket;
}

/** Minimal structural view of the host `Response` we rely on. */
export interface EgressFetchResponse {
  status: number;
  statusText: string;
  headers: { forEach(cb: (value: string, key: string) => void): void };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface EgressFetch {
  (
    input: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: Uint8Array;
      redirect?: 'follow' | 'manual' | 'error';
    },
  ): Promise<EgressFetchResponse>;
}

export interface EgressOptions {
  /** The host's `fetch` (bound). Required — there is no other transport. */
  fetch: EgressFetch;
  /**
   * CORS bridge. Either a **URL template** containing `{url}` / `%s` (the
   * target URL is substituted, URL-encoded), or a **path prefix** under which
   * the raw target URL is appended. Empty/absent means "direct only": requests
   * that the target's CORS policy rejects will fail, loudly.
   */
  proxy?: string;
  /** Called when the direct attempt fails and we fall back to the proxy. */
  onFallback?: (reason: unknown, url: string) => void;
  /**
   * WebSocket endpoint that relays raw TCP (M122). When set, `net.connect` to a
   * public host tunnels through it; when absent, raw TCP egress is unavailable
   * and dials fail loudly. The bridge speaks a tiny protocol: on open send
   * `{"host":..,"port":..}`, then binary frames are bytes in both directions.
   */
  tcpBridgeUrl?: string;
}

/** Hostnames that never leave the tab: they are the virtual network's. */
export function isLoopbackHost(host: string): boolean {
  if (!host) return true;
  let h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1); // [::1]
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0.0.0.0' ||
    h === '::' ||
    h.endsWith('.localhost') ||
    h.startsWith('127.')
  );
}

/** Expand a proxy spec against a target URL. */
export function applyProxy(proxy: string, target: string): string {
  if (proxy.includes('{url}')) return proxy.replace('{url}', encodeURIComponent(target));
  if (proxy.includes('%s')) return proxy.replace('%s', encodeURIComponent(target));
  const base = proxy.endsWith('/') ? proxy : `${proxy}/`;
  return `${base}${target}`;
}

/** Turn a host `Response` into an `EgressResponse`, flattening the headers. */
async function readResponse(res: EgressFetchResponse): Promise<EgressResponse> {
  const headers: Record<string, string | string[]> = {};
  res.headers.forEach((value: string, key: string) => {
    const k = key.toLowerCase();
    const existing = headers[k];
    if (existing === undefined) headers[k] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else headers[k] = [existing, value];
  });
  const body = new Uint8Array(await res.arrayBuffer());
  return {
    status: res.status,
    statusMessage: res.statusText || '',
    headers,
    body,
  };
}

class HostEgress implements Egress {
  #fetch: EgressFetch;
  #proxy?: string;
  #onFallback?: (reason: unknown, url: string) => void;
  #tcpBridgeUrl?: string;

  constructor(opts: EgressOptions) {
    this.#fetch = opts.fetch;
    this.#proxy = opts.proxy && opts.proxy.trim() ? opts.proxy : undefined;
    this.#onFallback = opts.onFallback;
    this.#tcpBridgeUrl = opts.tcpBridgeUrl && opts.tcpBridgeUrl.trim() ? opts.tcpBridgeUrl : undefined;
  }

  /** Present only when a raw-TCP bridge is configured. */
  dialTcp?: Egress['dialTcp'];

  async request(req: EgressRequest): Promise<EgressResponse> {
    const init = {
      method: req.method,
      headers: req.headers,
      body: req.body && req.body.byteLength > 0 ? req.body : undefined,
      redirect: 'follow' as const,
    };
    // `GET`/`HEAD` may not carry a body; a Uint8Array of length 0 is fine to omit.
    if (req.method === 'GET' || req.method === 'HEAD') delete (init as { body?: unknown }).body;
    try {
      return await readResponse(await this.#fetch(req.url, init));
    } catch (err) {
      if (!this.#proxy) throw normalizeEgressError(err, req.url);
      this.#onFallback?.(err, req.url);
      const proxied = applyProxy(this.#proxy, req.url);
      try {
        return await readResponse(await this.#fetch(proxied, init));
      } catch (proxyErr) {
        // The proxy is the fallback; if it also fails, report *its* failure but
        // keep the original as the cause so the message names both attempts.
        const e = normalizeEgressError(proxyErr, proxied);
        (e as { cause?: unknown }).cause = err;
        throw e;
      }
    }
  }
}

/**
 * A browser turns a CORS/network failure into a bare `TypeError: Failed to
 * fetch`. That is useless to user code, so we tag it with the target and a code,
 * which keeps `err.code` meaningful while staying honest about the cause.
 */
function normalizeEgressError(err: unknown, url: string): Error & { code?: string; target?: string } {
  if (err instanceof Error) {
    const e = err as Error & { code?: string; target?: string };
    if (!e.code) e.code = 'ERR_WEB_NODE_EGRESS';
    e.target = url;
    return e;
  }
  const e = new Error(String(err)) as Error & { code?: string; target?: string };
  e.code = 'ERR_WEB_NODE_EGRESS';
  e.target = url;
  return e;
}

export function createEgress(opts: EgressOptions): Egress {
  const egress = new HostEgress(opts);
  if (opts.tcpBridgeUrl && opts.tcpBridgeUrl.trim()) {
    const url = opts.tcpBridgeUrl;
    egress.dialTcp = (host, port, handlers) => openTcpBridge(url, host, port, handlers);
  }
  return egress;
}

/**
 * A `WebSocket`-backed raw TCP pipe. The socket is only as real as the server on
 * the other end; this side just frames bytes.
 */
function openTcpBridge(
  url: string,
  host: string,
  port: number,
  handlers: Parameters<NonNullable<Egress['dialTcp']>>[2],
): EgressTcpSocket {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  let opened = false;
  let closed = false;
  const queue: Uint8Array[] = [];
  ws.onopen = () => {
    ws.send(JSON.stringify({ host, port }));
    opened = true;
    for (const chunk of queue.splice(0)) ws.send(chunk);
    handlers.onConnect();
  };
  ws.onmessage = (ev: MessageEvent) => {
    const data = ev.data;
    if (typeof data === 'string') return; // protocol chatter, not payload
    if (data instanceof ArrayBuffer) handlers.onData(new Uint8Array(data));
    else if (data instanceof Uint8Array) handlers.onData(data);
  };
  ws.onerror = () => {
    if (!closed) handlers.onError(new Error(`egress TCP bridge error for ${host}:${port}`));
  };
  ws.onclose = () => {
    if (closed) return;
    closed = true;
    handlers.onEnd();
  };
  return {
    write(chunk) {
      if (closed) return;
      if (!opened) queue.push(chunk);
      else ws.send(chunk);
    },
    end() {
      if (closed) return;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    },
    destroy() {
      if (closed) return;
      closed = true;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    },
  };
}
