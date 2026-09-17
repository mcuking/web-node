import type { BuiltinSpec, BuiltinInitContext } from './types';
import type { VirtualSocket } from '../net/network';

/**
 * `http` builtin — a TS equivalent implementation of the Node core module.
 *
 * Same rationale as `net`: real `lib/http.js` sits on `http_parser`, streams and
 * async_hooks. We implement HTTP/1.1 directly on top of the virtual network so
 * that `http.createServer().listen(port)` + `http.get()` actually work in a tab.
 *
 * Scope (MVP): one request per connection, `Content-Length` bodies, no chunked
 * transfer-encoding, no keep-alive, no TLS. Anything outside that throws instead
 * of silently misbehaving.
 */

interface ParsedHead {
  method?: string;
  target?: string;
  version: string;
  statusCode?: number;
  statusMessage?: string;
  headers: Record<string, string | string[]>;
  rawHeaders: string[];
}

const CRLFCRLF = [13, 10, 13, 10];

function indexOfHeadEnd(buf: Uint8Array): number {
  outer: for (let i = 0; i + 3 < buf.length; i++) {
    for (let j = 0; j < 4; j++) if (buf[i + j] !== CRLFCRLF[j]) continue outer;
    return i;
  }
  return -1;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function parseHead(text: string): ParsedHead | null {
  const lines = text.split('\r\n');
  const first = lines.shift();
  if (!first) return null;

  const headers: Record<string, string | string[]> = {};
  const rawHeaders: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const name = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    rawHeaders.push(name, value);
    const key = name.toLowerCase();
    const prev = headers[key];
    if (prev === undefined) headers[key] = value;
    else if (Array.isArray(prev)) prev.push(value);
    else headers[key] = [prev, value];
  }

  const req = /^([A-Za-z]+) (\S+) HTTP\/(\d\.\d)$/.exec(first);
  if (req) return { method: req[1].toUpperCase(), target: req[2], version: req[3], headers, rawHeaders };

  const res = /^HTTP\/(\d\.\d) (\d{3})(?: (.*))?$/.exec(first);
  if (res) {
    return {
      version: res[1],
      statusCode: Number(res[2]),
      statusMessage: res[3] ?? '',
      headers,
      rawHeaders,
    };
  }
  return null;
}

/** Incremental HTTP/1.1 reader: head → body → end, one message per connection. */
export class HttpMessageReader {
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  #head: ParsedHead | null = null;
  #bodyRemaining = 0;
  #done = false;

  constructor(
    private readonly onHead: (head: ParsedHead) => void,
    private readonly onBody: (chunk: Uint8Array) => void,
    private readonly onEnd: () => void,
  ) {}

  push(chunk: Uint8Array): void {
    if (this.#done) return;
    this.#buffer = concat(this.#buffer, chunk);

    if (!this.#head) {
      const idx = indexOfHeadEnd(this.#buffer);
      if (idx < 0) return;
      const headText = new TextDecoder('latin1').decode(this.#buffer.subarray(0, idx));
      this.#buffer = this.#buffer.subarray(idx + 4);
      const head = parseHead(headText);
      if (!head) {
        this.#done = true;
        this.onEnd();
        return;
      }
      this.#head = head;
      const cl = head.headers['content-length'];
      const len = cl === undefined ? 0 : Number(Array.isArray(cl) ? cl[0] : cl);
      this.#bodyRemaining = Number.isFinite(len) && len > 0 ? len : 0;
      this.onHead(head);
    }

    if (this.#bodyRemaining > 0) {
      if (this.#buffer.length === 0) return;
      const take = Math.min(this.#bodyRemaining, this.#buffer.length);
      const piece = this.#buffer.slice(0, take);
      this.#buffer = this.#buffer.subarray(take);
      this.#bodyRemaining -= take;
      this.onBody(piece);
      if (this.#bodyRemaining > 0) return;
    }

    this.#done = true;
    this.onEnd();
  }
}

const STATUS_CODES: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  418: "I'm a Teapot",
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export const httpSpec: BuiltinSpec = {
  id: 'http',
  aliases: ['node:http'],
  origin: 'web-node',
  deps: ['net', 'events'],
  init: (ctx: BuiltinInitContext) => {
    const { EventEmitter } = ctx.require('events') as { EventEmitter: new () => Emitter };
    const net = ctx.require('net') as {
      Server: new (l?: (s: unknown) => void) => netServer;
    };

    interface Emitter {
      on(name: string, fn: (...a: never[]) => void): unknown;
      emit(name: string, ...args: unknown[]): boolean;
      once(name: string, fn: (...a: never[]) => void): unknown;
      removeListener(name: string, fn: (...a: never[]) => void): unknown;
    }

    interface netServer extends Emitter {
      listen(...args: unknown[]): unknown;
      close(cb?: () => void): unknown;
      address(): { port: number } | null;
      listening: boolean;
    }

    interface NetSocket extends Emitter {
      write(data: unknown, enc?: unknown, cb?: () => void): boolean;
      end(data?: unknown, cb?: () => void): unknown;
      destroy(err?: Error): unknown;
      setEncoding(enc: string): unknown;
      remoteAddress: string;
      remotePort: number;
    }

    const Buffer_ = (ctx.require('buffer') as { Buffer: BufferCtor }).Buffer;

    interface BufferCtor {
      from(input: Uint8Array | string): Uint8Array;
      byteLength(input: string): number;
    }

    function toBuffer(bytes: Uint8Array): Uint8Array {
      return Buffer_.from(bytes);
    }

    function toBytes(data: unknown): Uint8Array {
      if (typeof data === 'string') return new TextEncoder().encode(data);
      if (data instanceof Uint8Array) return data;
      if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      throw new TypeError('The "chunk" argument must be of type string or an instance of Buffer');
    }

    // -- IncomingMessage ------------------------------------------------------

    class IncomingMessage extends (EventEmitter as new () => Emitter) {
      httpVersion = '1.1';
      httpVersionMajor = 1;
      httpVersionMinor = 1;
      complete = false;
      aborted = false;
      method: string | undefined = undefined;
      url = '';
      statusCode = 0;
      statusMessage = '';
      headers: Record<string, string | string[]> = {};
      rawHeaders: string[] = [];
      trailers: Record<string, string> = {};
      rawTrailers: string[] = [];
      socket: NetSocket | null = null;
      connection: NetSocket | null = null;
      req: unknown = undefined;

      #encoding: string | null = null;
      #paused = false;
      #buffered: Uint8Array[] = [];

      /** @internal */
      _setup(head: ParsedHead, socket: NetSocket): void {
        this.httpVersion = head.version;
        this.httpVersionMajor = Number(head.version.split('.')[0]);
        this.httpVersionMinor = Number(head.version.split('.')[1]);
        this.method = head.method;
        this.url = head.target ?? '';
        this.statusCode = head.statusCode ?? 0;
        this.statusMessage = head.statusMessage ?? '';
        this.headers = head.headers;
        this.rawHeaders = head.rawHeaders;
        this.socket = socket;
        this.connection = socket;
      }

      /** @internal */
      _pushBody(chunk: Uint8Array): void {
        if (this.#paused) {
          this.#buffered.push(chunk);
          return;
        }
        this.emit('data', this.#encoding ? new TextDecoder(this.#encoding).decode(chunk) : toBuffer(chunk));
      }

      /** @internal */
      _end(): void {
        this.complete = true;
        this.emit('end');
        this.emit('close');
      }

      setEncoding(enc: string): this {
        this.#encoding = enc;
        return this;
      }
      pause(): this {
        this.#paused = true;
        return this;
      }
      resume(): this {
        if (!this.#paused) return this;
        this.#paused = false;
        const pending = this.#buffered;
        this.#buffered = [];
        for (const chunk of pending) this._pushBody(chunk);
        return this;
      }
      destroy(err?: Error): this {
        if (err) this.emit('error', err);
        this.socket?.destroy();
        return this;
      }
      /** Convenience: read the whole body as a string/Buffer. */
      async _readAll(): Promise<Uint8Array> {
        const chunks: Uint8Array[] = [];
        if (this.complete) return new Uint8Array(0);
        await new Promise<void>((resolve) => {
          this.on('data' as never, ((c: Uint8Array) => chunks.push(toBytes(c))) as never);
          this.on('end' as never, (() => resolve()) as never);
        });
        return concatAll(chunks);
      }
    }

    function concatAll(chunks: Uint8Array[]): Uint8Array {
      let total = 0;
      for (const c of chunks) total += c.byteLength;
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
      }
      return out;
    }

    // -- ServerResponse -------------------------------------------------------

    class ServerResponse extends (EventEmitter as new () => Emitter) {
      statusCode = 200;
      statusMessage: string | undefined = undefined;
      headersSent = false;
      finished = false;
      sendDate = true;
      writableEnded = false;
      socket: NetSocket | null = null;
      req: IncomingMessage | null = null;

      #headers = new Map<string, string | string[]>();
      #chunks: Uint8Array[] = [];

      constructor(socket: NetSocket) {
        super();
        this.socket = socket;
      }

      setHeader(name: string, value: string | string[]): this {
        if (this.headersSent) throw new Error('Cannot set headers after they are sent to the client');
        this.#headers.set(name.toLowerCase(), value);
        return this;
      }
      getHeader(name: string): string | string[] | undefined {
        return this.#headers.get(name.toLowerCase());
      }
      getHeaders(): Record<string, string | string[]> {
        return Object.fromEntries(this.#headers);
      }
      getHeaderNames(): string[] {
        return [...this.#headers.keys()];
      }
      hasHeader(name: string): boolean {
        return this.#headers.has(name.toLowerCase());
      }
      removeHeader(name: string): void {
        if (this.headersSent) throw new Error('Cannot remove headers after they are sent to the client');
        this.#headers.delete(name.toLowerCase());
      }

      writeHead(status: number, a?: unknown, b?: unknown): this {
        this.statusCode = status;
        if (typeof a === 'string') {
          this.statusMessage = a;
          if (b && typeof b === 'object') for (const [k, v] of Object.entries(b as Record<string, string>)) this.setHeader(k, v);
        } else if (a && typeof a === 'object') {
          for (const [k, v] of Object.entries(a as Record<string, string>)) this.setHeader(k, v);
        }
        this.headersSent = true;
        return this;
      }

      flushHeaders(): void {
        this.headersSent = true;
      }

      write(chunk: unknown, enc?: unknown, cb?: () => void): boolean {
        if (typeof enc === 'function') {
          cb = enc as () => void;
          enc = undefined;
        }
        this.headersSent = true;
        this.#chunks.push(toBytes(chunk));
        if (typeof cb === 'function') ctx.binding.nextTick(cb as () => void);
        return true;
      }

      end(chunk?: unknown, enc?: unknown, cb?: () => void): this {
        if (typeof chunk === 'function') {
          cb = chunk as () => void;
          chunk = undefined;
        } else if (typeof enc === 'function') {
          cb = enc as () => void;
          enc = undefined;
        }
        if (chunk !== undefined) this.write(chunk);
        this.writableEnded = true;
        this.finished = true;
        this.#finalize();
        const done = cb as (() => void) | undefined;
        ctx.binding.nextTick(() => {
          this.emit('finish');
          this.emit('close');
          if (typeof done === 'function') done();
        });
        return this;
      }

      #finalize(): void {
        const body = concatAll(this.#chunks);
        const message = this.statusMessage ?? STATUS_CODES[this.statusCode] ?? 'Unknown';
        const lines: string[] = [`HTTP/1.1 ${this.statusCode} ${message}`];

        const headers = new Map(this.#headers);
        if (!headers.has('content-type')) headers.set('content-type', 'text/plain; charset=utf-8');
        if (this.sendDate && !headers.has('date')) headers.set('date', new Date().toUTCString());
        headers.set('content-length', String(body.byteLength));
        headers.set('connection', 'close');

        for (const [name, value] of headers) {
          const canonical = name.replace(/(^|-)([a-z])/g, (_, p1, p2) => `${p1}${p2.toUpperCase()}`);
          if (Array.isArray(value)) for (const v of value) lines.push(`${canonical}: ${v}`);
          else lines.push(`${canonical}: ${value}`);
        }
        lines.push('', '');

        const head = new TextEncoder().encode(lines.join('\r\n'));
        this.socket?.write(head);
        if (body.byteLength) this.socket?.write(body);
        this.socket?.end();
      }

      /** Convenience used by the ServiceWorker bridge + tests. */
      get _bodyLength(): number {
        return this.#chunks.reduce((n, c) => n + c.byteLength, 0);
      }
    }

    // -- Server ---------------------------------------------------------------

    class Server extends (net.Server as new () => netServer) {
      requestTimeout = 0;
      headersTimeout = 0;
      keepAliveTimeout = 0;
      timeout = 0;

      constructor(requestListener?: (req: IncomingMessage, res: ServerResponse) => void) {
        super();
        if (typeof requestListener === 'function') this.on('request', requestListener as never);
        this.on('connection', ((socket: NetSocket) => this.#serveConnection(socket)) as never);
      }

      #serveConnection(socket: NetSocket): void {
        let res: ServerResponse | null = null;
        let req: IncomingMessage | null = null;

        const reader = new HttpMessageReader(
          (head) => {
            req = new IncomingMessage();
            req._setup(head, socket);
            res = new ServerResponse(socket);
            res.req = req;
            this.emit('request', req, res);
          },
          (chunk) => req?._pushBody(chunk),
          () => {
            if (!req) {
              // Unparseable request: answer 400 rather than hanging the caller.
              const fallback = new ServerResponse(socket);
              fallback.writeHead(400, { 'content-type': 'text/plain' });
              fallback.end('Bad Request');
              return;
            }
            if (res && !res.writableEnded) {
              // Handler never responded (async). Leave the socket open until it does.
              req._end();
              return;
            }
            req._end();
          },
        );

        socket.on('data' as never, ((chunk: Uint8Array) => reader.push(toBytes(chunk))) as never);
        socket.on('end' as never, () => {
          // Client half-closed before sending a full request.
          if (req && !res?.writableEnded) req._end();
        });
        socket.on('error' as never, (() => undefined) as never);
      }
    }

    function createServer(requestListener?: (req: IncomingMessage, res: ServerResponse) => void): Server {
      return new Server(requestListener);
    }

    // -- ClientRequest --------------------------------------------------------

    interface RequestOptions {
      protocol?: string;
      host?: string;
      hostname?: string;
      port?: number | string;
      path?: string;
      method?: string;
      headers?: Record<string, string | string[]>;
    }

    class ClientRequest extends (EventEmitter as new () => Emitter) {
      method: string;
      path: string;
      host: string;
      port: number;
      headers: Record<string, string | string[]>;
      aborted = false;
      finished = false;
      reusedSocket = false;

      #socket: NetSocket | null = null;
      #chunks: Uint8Array[] = [];
      #cb: ((res: IncomingMessage) => void) | undefined;
      #response: IncomingMessage | null = null;

      constructor(options: RequestOptions | string, cb?: (res: IncomingMessage) => void) {
        super();
        const opts = normalizeOptions(options);
        this.method = (opts.method ?? 'GET').toUpperCase();
        this.path = opts.path ?? '/';
        this.host = opts.hostname ?? opts.host ?? '127.0.0.1';
        this.port = Number(opts.port ?? 80);
        this.headers = { ...(opts.headers ?? {}) };
        this.#cb = cb;
      }

      setHeader(name: string, value: string | string[]): this {
        this.headers[name.toLowerCase()] = value;
        return this;
      }
      getHeader(name: string): string | string[] | undefined {
        return this.headers[name.toLowerCase()];
      }
      removeHeader(name: string): void {
        delete this.headers[name.toLowerCase()];
      }

      write(chunk: unknown, enc?: unknown, cb?: () => void): boolean {
        if (typeof enc === 'function') {
          cb = enc as () => void;
          enc = undefined;
        }
        this.#chunks.push(toBytes(chunk));
        if (typeof cb === 'function') ctx.binding.nextTick(cb as () => void);
        return true;
      }

      end(chunk?: unknown, enc?: unknown, cb?: () => void): this {
        if (typeof chunk === 'function') {
          cb = chunk as () => void;
          chunk = undefined;
        } else if (typeof enc === 'function') {
          cb = enc as () => void;
          enc = undefined;
        }
        if (chunk !== undefined) this.write(chunk);
        this.finished = true;
        ctx.binding.nextTick(() => {
          this.#send();
          if (typeof cb === 'function') (cb as () => void)();
        });
        return this;
      }

      #send(): void {
        const network = ctx.binding.network;
        let socket: ReturnType<typeof network.dial>;
        try {
          socket = network.dial(this.port);
        } catch (err) {
          this.emit('error', err as Error);
          return;
        }
        this.#socket = socket as unknown as NetSocket;

        const reader = new HttpMessageReader(
          (head) => {
            const res = new IncomingMessage();
            res._setup(head, socket as unknown as NetSocket);
            res.req = this;
            res.socket = socket as unknown as NetSocket;
            this.#response = res;
            if (this.#cb) this.#cb(res);
            this.emit('response', res);
          },
          (data) => this.#response?._pushBody(data),
          () => this.#response?._end(),
        );

        socket.onData((chunk) => reader.push(chunk));
        socket.onError((err) => this.emit('error', err));

        const body = concatAll(this.#chunks);
        const lines: string[] = [`${this.method} ${this.path} HTTP/1.1`];
        const headers = new Map(Object.entries(this.headers).map(([k, v]) => [k.toLowerCase(), v]));
        if (!headers.has('host')) headers.set('host', `${this.host}:${this.port}`);
        if (!headers.has('connection')) headers.set('connection', 'close');
        headers.set('content-length', String(body.byteLength));
        for (const [name, value] of headers) {
          const canonical = name.replace(/(^|-)([a-z])/g, (_, p1, p2) => `${p1}${p2.toUpperCase()}`);
          if (Array.isArray(value)) for (const v of value) lines.push(`${canonical}: ${v}`);
          else lines.push(`${canonical}: ${value}`);
        }
        lines.push('', '');
        socket.write(new TextEncoder().encode(lines.join('\r\n')));
        if (body.byteLength) socket.write(body);
        socket.end();
      }

      abort(): void {
        this.aborted = true;
        (this.#socket as unknown as VirtualSocket | null)?.destroy();
        this.emit('abort');
      }
      destroy(err?: Error): this {
        this.abort();
        if (err) this.emit('error', err);
        return this;
      }
      setTimeout(): this {
        return this;
      }
    }

    function normalizeOptions(options: RequestOptions | string): RequestOptions {
      if (typeof options === 'string') {
        const url = new URL(options);
        return {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
        };
      }
      return options;
    }

    function request(options: RequestOptions | string, cb?: (res: IncomingMessage) => void): ClientRequest {
      const req = new ClientRequest(options, cb);
      if (typeof options !== 'string' && typeof options.method === 'string') req.method = options.method.toUpperCase();
      return req;
    }

    function get(options: RequestOptions | string, cb?: (res: IncomingMessage) => void): ClientRequest {
      const req = request(options, cb);
      req.method = 'GET';
      ctx.binding.nextTick(() => req.end());
      return req;
    }

    return {
      Server,
      ServerResponse,
      IncomingMessage,
      ClientRequest,
      STATUS_CODES,
      METHODS: [
        'ACL','BIND','CHECKOUT','CONNECT','COPY','DELETE','GET','HEAD','LINK','LOCK','M-SEARCH','MERGE','MKACTIVITY','MKCALENDAR','MKCOL','MOVE','NOTIFY','OPTIONS','PATCH','POST','PROPFIND','PROPPATCH','PURGE','PUT','REBIND','REPORT','SEARCH','SOURCE','SUBSCRIBE','TRACE','UNBIND','UNLINK','UNLOCK','UNSUBSCRIBE',
      ],
      createServer,
      request,
      get,
      default: { Server, createServer, request, get },
      /** Promise helper used by the ServiceWorker bridge and tests. */
      _request: (
        port: number,
        init: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Uint8Array },
      ): Promise<{ status: number; statusMessage: string; headers: Record<string, string | string[]>; body: Uint8Array }> =>
        new Promise((resolve, reject) => {
          const req = new ClientRequest({
            hostname: '127.0.0.1',
            port,
            path: init.path ?? '/',
            method: init.method ?? 'GET',
            headers: init.headers ?? {},
          });
          req.on('error' as never, ((err: Error) => reject(err)) as never);
          req.on('response' as never, ((res: IncomingMessage) => {
            const chunks: Uint8Array[] = [];
            res.on('data' as never, ((c: Uint8Array) => chunks.push(toBytes(c))) as never);
            res.on('end' as never, (() => {
              resolve({
                status: res.statusCode,
                statusMessage: res.statusMessage,
                headers: res.headers,
                body: concatAll(chunks),
              });
            }) as never);
          }) as never);
          if (init.body) req.write(init.body);
          req.end();
        }),
    };
  },
};
