import type { BuiltinSpec, BuiltinInitContext } from './types';
import type { VirtualSocket } from '../net/network';
import { notImplemented } from '../errors';

/**
 * `http` builtin — a TS equivalent implementation of the Node core module.
 *
 * Same rationale as `net`: real `lib/http.js` sits on `http_parser`, streams and
 * async_hooks. We implement HTTP/1.1 directly on top of the virtual network so
 * that `http.createServer().listen(port)` + `http.get()` actually work in a tab.
 *
 * Scope: HTTP/1.1 with `Content-Length` and `Transfer-Encoding: chunked` bodies.
 * Connections are persistent by default (HTTP/1.1 keep-alive): the server serves
 * request after request on the same socket and the client pools sockets per
 * `host:port`. No TLS here — see the `https` builtin, which layers on top.
 *
 * Bodies are real streams: `req` is a `Readable` and `res` a `Writable`, so
 * `req.pipe(res)` works and propagates backpressure. A response that never sets
 * `Content-Length` is framed as chunked, and our own client reader decodes that
 * framing again — which is what makes streaming servers reachable through the
 * ServiceWorker bridge.
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

/** Index of the next CRLF at or after `from`, or -1. */
function indexOfCrlf(buf: Uint8Array, from = 0): number {
  for (let i = from; i + 1 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10) return i;
  }
  return -1;
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

/**
 * Incremental HTTP/1.1 reader — head, then body.
 *
 * Understands both framings user code actually produces: `Content-Length` and
 * `Transfer-Encoding: chunked`. After a message completes the reader is `done`
 * but keeps buffering: anything that arrives for the next (pipelined) message
 * is retained and handed back by `rest()`, so a keep-alive connection can be
 * re-armed without losing bytes that raced ahead of the response.
 */
export class HttpMessageReader {
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  #head: ParsedHead | null = null;
  #mode: 'head' | 'length' | 'chunk-size' | 'chunk-data' | 'chunk-crlf' | 'trailer' | 'done' = 'head';
  #remaining = 0;

  constructor(
    private readonly onHead: (head: ParsedHead) => void,
    private readonly onBody: (chunk: Uint8Array) => void,
    private readonly onEnd: () => void,
  ) {}

  /** True once a complete message has been delivered. */
  get done(): boolean {
    return this.#mode === 'done';
  }

  /** Bytes buffered but not yet consumed — i.e. the start of the next message. */
  rest(): Uint8Array {
    return this.#buffer;
  }

  push(chunk: Uint8Array): void {
    this.#buffer = concat(this.#buffer, chunk);
    // Already at a message boundary: stash the bytes for whoever re-arms us.
    if (this.#mode === 'done') return;

    // Loop: a single socket chunk can complete several framing steps (e.g. a
    // whole `5\r\nhello\r\n0\r\n\r\n` arriving in one read).
    for (;;) {
      if (this.#mode === 'head') {
        const idx = indexOfHeadEnd(this.#buffer);
        if (idx < 0) return;
        const headText = new TextDecoder('latin1').decode(this.#buffer.subarray(0, idx));
        this.#buffer = this.#buffer.subarray(idx + 4);
        const head = parseHead(headText);
        if (!head) {
          this.#mode = 'done';
          this.onEnd();
          return;
        }
        this.#head = head;
        this.onHead(head);

        const te = head.headers['transfer-encoding'];
        const teValue = Array.isArray(te) ? te.join(',') : te ?? '';
        const cl = head.headers['content-length'];
        const len = cl === undefined ? 0 : Number(Array.isArray(cl) ? cl[0] : cl);
        if (/chunked/i.test(teValue)) {
          this.#mode = 'chunk-size';
        } else if (Number.isFinite(len) && len > 0) {
          this.#mode = 'length';
          this.#remaining = len;
        } else {
          this.#mode = 'done';
          this.onEnd();
          return;
        }
        continue;
      }

      if (this.#mode === 'length' || this.#mode === 'chunk-data') {
        if (this.#buffer.length === 0) return;
        const take = Math.min(this.#remaining, this.#buffer.length);
        this.onBody(this.#buffer.slice(0, take));
        this.#buffer = this.#buffer.subarray(take);
        this.#remaining -= take;
        if (this.#remaining > 0) return;
        if (this.#mode === 'length') {
          this.#mode = 'done';
          this.onEnd();
          return;
        }
        this.#mode = 'chunk-crlf';
        continue;
      }

      if (this.#mode === 'chunk-size') {
        const lineEnd = indexOfCrlf(this.#buffer);
        if (lineEnd < 0) return;
        const line = new TextDecoder('latin1').decode(this.#buffer.subarray(0, lineEnd)).split(';')[0].trim();
        this.#buffer = this.#buffer.subarray(lineEnd + 2);
        const size = parseInt(line, 16);
        if (!Number.isFinite(size) || size < 0) {
          this.#mode = 'done';
          this.onEnd();
          return;
        }
        if (size === 0) {
          // Last chunk. The (usually empty) trailer section follows, terminated
          // by a CRLF line — it must be consumed so it does not leak into the
          // next message on a keep-alive connection.
          this.#mode = 'trailer';
          continue;
        }
        this.#remaining = size;
        this.#mode = 'chunk-data';
        continue;
      }

      if (this.#mode === 'trailer') {
        const lineEnd = indexOfCrlf(this.#buffer);
        if (lineEnd < 0) return;
        const line = new TextDecoder('latin1').decode(this.#buffer.subarray(0, lineEnd));
        this.#buffer = this.#buffer.subarray(lineEnd + 2);
        if (line === '') {
          this.#mode = 'done';
          this.onEnd();
          return;
        }
        continue; // skip a trailer header line
      }

      // chunk-crlf: consume the CRLF that terminates the previous chunk's data.
      if (this.#buffer.length < 2) return;
      this.#buffer = this.#buffer.subarray(2);
      this.#mode = 'chunk-size';
    }
  }
}

const CRLF = new TextEncoder().encode('\r\n');
const END_CHUNK = new TextEncoder().encode('0\r\n\r\n');

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
  deps: ['net', 'events', 'stream'],
  init: (ctx: BuiltinInitContext) => {
    const { EventEmitter } = ctx.require('events') as { EventEmitter: new () => Emitter };
    const net = ctx.require('net') as {
      Server: new (l?: (s: unknown) => void) => netServer;
    };

    // `req` is a Readable and `res` a Writable, exactly like Node — that is what
    // makes `req.pipe(res)` and `fs.createReadStream(p).pipe(res)` work.
    const { Readable, Writable } = ctx.require('stream') as {
      Readable: new (opts?: Record<string, unknown>) => ReadableLike;
      Writable: new (opts?: Record<string, unknown>) => WritableLike;
    };

    interface Emitter {
      on(name: string, fn: (...a: never[]) => void): unknown;
      emit(name: string, ...args: unknown[]): boolean;
      once(name: string, fn: (...a: never[]) => void): unknown;
      removeListener(name: string, fn: (...a: never[]) => void): unknown;
    }

    interface ReadableLike extends Emitter {
      push(chunk: unknown): boolean;
      pause(): unknown;
      resume(): unknown;
      setEncoding(enc: string): unknown;
      destroy(err?: Error): unknown;
      readableEnded: boolean;
    }

    interface WritableLike extends Emitter {
      write(chunk: unknown, enc?: unknown, cb?: () => void): boolean;
      end(chunk?: unknown, enc?: unknown, cb?: () => void): unknown;
      destroy(err?: Error): unknown;
      writableEnded: boolean;
      writableFinished: boolean;
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

    // -- OutgoingMessage ------------------------------------------------------

    /**
     * Base class of both `ServerResponse` and `ClientRequest` — exported so
     * `res instanceof http.OutgoingMessage` holds, like Node.
     */
    class OutgoingMessage extends (Writable as new (opts?: Record<string, unknown>) => WritableLike) {}

    // -- IncomingMessage ------------------------------------------------------

    class IncomingMessage extends (Readable as new (opts?: Record<string, unknown>) => ReadableLike) {
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

      constructor() {
        // The socket reader pushes bodies at us, so `_read()` has nothing to
        // pull; the Readable base only has to buffer and manage flow.
        super({});
      }

      _read(): void {
        /* bodies arrive through _pushBody() */
      }

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
        this.push(toBuffer(chunk));
      }

      /** @internal */
      _end(): void {
        if (this.complete) return;
        this.complete = true;
        this.push(null);
      }

      /** @internal */
      _destroy(err: Error | null, cb: (err?: Error | null) => void): void {
        // A normally-completed message must NOT tear down its socket: that
        // socket may be a keep-alive connection about to carry the next
        // request (or be sitting in the client's pool). Only an abort/error
        // closes the transport.
        if (err) {
          this.aborted = true;
          this.socket?.destroy();
        }
        cb(err);
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

    class ServerResponse extends OutgoingMessage {
      statusCode = 200;
      statusMessage: string | undefined = undefined;
      headersSent = false;
      finished = false;
      sendDate = true;
      socket: NetSocket | null = null;
      req: IncomingMessage | null = null;

      #headers = new Map<string, string | string[]>();
      #flushed = false;
      #chunked = false;
      #bodyLength = 0;
      #keepAlive = false;

      /** @internal — set by the server so it can re-arm the connection. */
      _onResponseFinish: (() => void) | null = null;

      /** True unless the client or this response asked for `Connection: close`. */
      get shouldKeepAlive(): boolean {
        return this.#keepAlive;
      }

      constructor(socket: NetSocket) {
        // Node's OutgoingMessage is a plain Stream that does not auto-destroy on
        // `finish`; our ServerResponse is a Writable, so opt out explicitly.
        super({ autoDestroy: false });
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
        this.#flush();
      }

      /** @internal — Writable contract: one chunk per `_write`. */
      _write(chunk: unknown, _enc: string, cb: (err?: Error | null) => void): void {
        try {
          this.#flush();
          const bytes = toBytes(chunk);
          this.#bodyLength += bytes.byteLength;
          if (this.#chunked) this.socket?.write(new TextEncoder().encode(bytes.byteLength.toString(16) + '\r\n'));
          if (bytes.byteLength) this.socket?.write(bytes);
          if (this.#chunked) this.socket?.write(CRLF);
          cb(null);
        } catch (err) {
          cb(err as Error);
        }
      }

      /** @internal — Writable contract: terminate the framing and hand back control. */
      _final(cb: (err?: Error | null) => void): void {
        try {
          this.#flush();
          if (this.#chunked) this.socket?.write(END_CHUNK);
          this.finished = true;
          cb(null);
          // The server decides whether to close the socket or keep the
          // connection alive for the next request.
          this._onResponseFinish?.();
        } catch (err) {
          cb(err as Error);
        }
      }

      #flush(): void {
        if (this.#flushed) return;
        this.#flushed = true;
        this.headersSent = true;

        const message = this.statusMessage ?? STATUS_CODES[this.statusCode] ?? 'Unknown';
        const lines: string[] = [`HTTP/1.1 ${this.statusCode} ${message}`];

        const headers = new Map(this.#headers);
        const bodiless = this.statusCode === 204 || this.statusCode === 304 || this.statusCode === 101;
        if (!headers.has('content-type')) headers.set('content-type', 'text/plain; charset=utf-8');
        if (this.sendDate && !headers.has('date')) headers.set('date', new Date().toUTCString());
        if (bodiless) {
          headers.delete('transfer-encoding');
        } else if (!headers.has('content-length')) {
          // No length known up front: frame as chunked, which is exactly what
          // lets `write()` stream instead of buffering the whole body.
          this.#chunked = true;
          headers.set('transfer-encoding', 'chunked');
        }

        // HTTP/1.1 defaults to persistent connections; the client opts out with
        // `Connection: close` (or HTTP/1.0 without `Connection: keep-alive`).
        const reqHeaders = this.req?.headers ?? {};
        const connHeader = headers.get('connection');
        const connValue = String(Array.isArray(connHeader) ? connHeader.join(',') : connHeader ?? '').toLowerCase();
        const clientConn = String(reqHeaders['connection'] ?? '').toLowerCase();
        const version = this.req?.httpVersion ?? '1.1';
        const clientWantsClose =
          connValue.includes('close') || clientConn.includes('close') || (version === '1.0' && !clientConn.includes('keep-alive'));
        this.#keepAlive = !clientWantsClose;
        headers.set('connection', this.#keepAlive ? 'keep-alive' : 'close');

        for (const [name, value] of headers) {
          const canonical = name.replace(/(^|-)([a-z])/g, (_, p1, p2) => `${p1}${p2.toUpperCase()}`);
          if (Array.isArray(value)) for (const v of value) lines.push(`${canonical}: ${v}`);
          else lines.push(`${canonical}: ${value}`);
        }
        lines.push('', '');
        this.socket?.write(new TextEncoder().encode(lines.join('\r\n')));
      }

      /** Bytes handed to the socket (used by the ServiceWorker bridge + tests). */
      get _bodyLength(): number {
        return this.#bodyLength;
      }

      /**
       * @internal — Best-effort error reply for a handler that threw.
       *
       * If nothing has reached the socket yet the status line and headers can
       * still be replaced, so we answer `status` (default 500) and the
       * connection stays usable. Once bytes are on the wire that is impossible:
       * we report failure and let the caller tear the socket down.
       */
      _fail(status = 500): boolean {
        if (this.#flushed) return false;
        this.statusCode = status;
        this.statusMessage = undefined;
        this.#headers = new Map([['content-type', 'text/plain; charset=utf-8']]);
        this.#chunked = false;
        this.#bodyLength = 0;
        this.end('Internal Server Error');
        return true;
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
        this.on('connection', _connectionListener as never);
      }

      /** @internal — Node names this `_connectionListener`; see below. */
      _serveConnection(socket: NetSocket): void {
        let reader: HttpMessageReader;
        let currentReq: IncomingMessage | null = null;

        // Build a reader for the next message on this connection. Each reader
        // owns its request/response pair locally, so re-arming never clobbers
        // the message that is still being parsed. The socket `data` handler
        // always reads the *current* `reader` binding.
        const serveOne = (): void => {
          let req: IncomingMessage | null = null;
          let res: ServerResponse | null = null;
          reader = new HttpMessageReader(
            (head) => {
              const request = new IncomingMessage();
              request._setup(head, socket);
              const response = new ServerResponse(socket);
              response.req = request;
              req = request;
              res = response;
              currentReq = request;
              response._onResponseFinish = () => {
                if (!response.shouldKeepAlive || (socket as unknown as { destroyed?: boolean }).destroyed) {
                  socket.end();
                  return;
                }
                // Keep-alive: re-arm for the next request. Deferred to the next
                // tick so the reader has fully finished this message (a handler
                // may `res.end()` synchronously, from inside `onHead`), and so
                // `rest()` reflects the true leftover rather than mid-message bytes.
                currentReq = null;
                ctx.binding.nextTick(() => {
                  const leftover = reader.rest();
                  serveOne();
                  if (leftover.length > 0) reader.push(leftover);
                });
              };
              // A synchronous throw in a request handler must not wedge the
              // connection: answer 500 (or drop the socket if the response had
              // already started) so the client gets a reply instead of hanging
              // until its timeout.
              try {
                this.emit('request', request, response);
              } catch (err) {
                if (!response._fail(500)) socket.destroy();
                void err;
              }
            },
            (chunk) => req?._pushBody(chunk),
            () => {
              if (!req) {
                // Unparseable request: answer 400 rather than hanging the caller.
                const fallback = new ServerResponse(socket);
                fallback.writeHead(400, { 'content-type': 'text/plain' });
                fallback._onResponseFinish = () => socket.end();
                fallback.end('Bad Request');
                return;
              }
              req._end();
            },
          );
        };

        serveOne();
        socket.on('data' as never, ((chunk: Uint8Array) => reader.push(toBytes(chunk))) as never);
        socket.on('end' as never, (() => {
          // Client half-closed. If it did so mid-body, surface EOF to the handler.
          currentReq?._end();
        }) as never);
        socket.on('error' as never, (() => undefined) as never);
      }
    }

    /**
     * Node's `http._connectionListener`: attach the per-connection HTTP
     * request loop. EventEmitter invokes listeners with `this` = the server.
     */
    function _connectionListener(this: Server, socket: NetSocket): void {
      this._serveConnection(socket);
    }

    function createServer(requestListener?: (req: IncomingMessage, res: ServerResponse) => void): Server {
      return new Server(requestListener);
    }

    // -- client connection pool (keep-alive) ----------------------------------

    interface ResponseHandlers {
      onHead: (head: ParsedHead) => void;
      onData: (chunk: Uint8Array) => void;
      onEnd: () => void;
      onError: (err: Error) => void;
    }

    /**
     * One live client connection, able to carry request after request.
     *
     * The socket data handler is registered exactly once and always feeds the
     * *current* reader, so reusing a connection never accumulates listeners.
     */
    class Connection {
      socket: VirtualSocket;
      reader!: HttpMessageReader;
      current: ResponseHandlers | null = null;
      keepAlive = true;
      destroyed = false;

      constructor(socket: VirtualSocket) {
        this.socket = socket;
        this.arm(new Uint8Array(0));
        socket.onData((chunk) => this.reader.push(chunk));
        socket.onError((err) => {
          const handlers = this.current;
          this.current = null;
          this.destroy();
          handlers?.onError(err);
        });
        socket.onClose(() => {
          // A close while a response is still pending (no `onEnd` yet) means the
          // server dropped the connection mid-response: surface it as an error
          // instead of leaving the caller to hang until its own timeout.
          const handlers = this.current;
          this.current = null;
          this.destroy();
          handlers?.onError(new Error('socket hang up'));
        });
      }

      /** Swap in a fresh reader (optionally primed with raced-ahead bytes). */
      arm(leftover: Uint8Array): void {
        const reader: HttpMessageReader = new HttpMessageReader(          (head) => {
            const conn = head.headers['connection'];
            const value = String(Array.isArray(conn) ? conn.join(',') : conn ?? '').toLowerCase();
            this.keepAlive = !value.includes('close') && !(head.version === '1.0' && !value.includes('keep-alive'));
            this.current?.onHead(head);
          },
          (chunk) => this.current?.onData(chunk),
          () => {
            const handlers = this.current;
            this.current = null;
            const rest = reader.rest();
            if (this.keepAlive && !this.socket.destroyed) pool.release(this, rest);
            else this.destroy();
            handlers?.onEnd();
          },
        );
        this.reader = reader;
        if (leftover.length > 0) reader.push(leftover);
      }

      send(handlers: ResponseHandlers, write: () => void): void {
        this.current = handlers;
        write();
      }

      destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.socket.destroy();
      }
    }

    /** Idle keep-alive connections per port (LIFO). */
    const pool = {
      idle: new Map<number, Array<{ conn: Connection; leftover: Uint8Array }>>(),
      release(conn: Connection, leftover: Uint8Array): void {
        const port = conn.socket.remotePort;
        const list = this.idle.get(port) ?? [];
        list.push({ conn, leftover });
        this.idle.set(port, list);
      },
    };

    function acquire(port: number): Connection {
      const list = pool.idle.get(port);
      while (list && list.length > 0) {
        const entry = list.pop()!;
        const conn = entry.conn;
        if (conn.destroyed || conn.socket.destroyed || conn.socket.readableEnded) continue;
        conn.arm(entry.leftover);
        return conn;
      }
      return new Connection(ctx.binding.network.dial(port));
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
      agent?: unknown;
    }

    class ClientRequest extends OutgoingMessage {
      method: string;
      path: string;
      host: string;
      port: number;
      headers: Record<string, string | string[]>;
      aborted = false;
      finished = false;
      reusedSocket = false;
      agent: unknown = globalAgent;

      #socket: NetSocket | null = null;
      #conn: Connection | null = null;
      #keepAlive = true;
      #agentKeepAlive = true;
      #chunks: Uint8Array[] = [];
      #cb: ((res: IncomingMessage) => void) | undefined;
      #response: IncomingMessage | null = null;

      constructor(options: RequestOptions | string, cb?: (res: IncomingMessage) => void) {
        // See ServerResponse: outgoing messages never auto-destroy on finish.
        super({ autoDestroy: false });
        const opts = normalizeOptions(options);
        this.method = (opts.method ?? 'GET').toUpperCase();
        this.path = opts.path ?? '/';
        this.host = opts.hostname ?? opts.host ?? '127.0.0.1';
        this.port = Number(opts.port ?? 80);
        this.headers = { ...(opts.headers ?? {}) };
        this.#cb = cb;
        // `agent: false` opts out of keep-alive; an Agent instance supplies its
        // own `keepAlive` preference.
        if (opts.agent === false) {
          this.agent = false;
          this.#agentKeepAlive = false;
        } else if (opts.agent instanceof Agent) {
          this.agent = opts.agent;
          this.#agentKeepAlive = opts.agent.keepAlive;
        }
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

      /** @internal — Writable contract: stash the body until `end()`. */
      _write(chunk: unknown, _enc: string, cb: (err?: Error | null) => void): void {
        this.#chunks.push(toBytes(chunk));
        cb(null);
      }

      /** @internal — Writable contract: dial + send once the body is complete. */
      _final(cb: (err?: Error | null) => void): void {
        this.finished = true;
        // Deferred so a dial failure surfaces as an async 'error' event, like a
        // real socket connect, instead of throwing out of `end()`.
        ctx.binding.nextTick(() => {
          this.#send();
          cb(null);
        });
      }

      #send(): void {
        let conn: Connection;
        try {
          conn = acquire(this.port);
        } catch (err) {
          this.emit('error', err as Error);
          return;
        }
        this.#conn = conn;
        this.#socket = conn.socket as unknown as NetSocket;

        const body = concatAll(this.#chunks);
        const lines: string[] = [`${this.method} ${this.path} HTTP/1.1`];
        const headers = new Map(Object.entries(this.headers).map(([k, v]) => [k.toLowerCase(), v]));
        if (!headers.has('host')) headers.set('host', `${this.host}:${this.port}`);
        // HTTP/1.1 is persistent by default; the caller opts out via
        // `Connection: close`.
        const requested = String(headers.get('connection') ?? '').toLowerCase();
        this.#keepAlive = this.#agentKeepAlive && !requested.includes('close');
        if (!headers.has('connection')) headers.set('connection', 'keep-alive');
        headers.set('content-length', String(body.byteLength));
        for (const [name, value] of headers) {
          const canonical = name.replace(/(^|-)([a-z])/g, (_, p1, p2) => `${p1}${p2.toUpperCase()}`);
          if (Array.isArray(value)) for (const v of value) lines.push(`${canonical}: ${v}`);
          else lines.push(`${canonical}: ${value}`);
        }
        lines.push('', '');

        conn.send(
          {
            onHead: (head) => {
              const res = new IncomingMessage();
              res._setup(head, conn.socket as unknown as NetSocket);
              res.req = this;
              res.socket = conn.socket as unknown as NetSocket;
              this.#response = res;
              if (this.#cb) this.#cb(res);
              this.emit('response', res);
            },
            onData: (chunk) => this.#response?._pushBody(chunk),
            onEnd: () => this.#response?._end(),
            onError: (err) => this.emit('error', err),
          },
          () => {
            conn.socket.write(new TextEncoder().encode(lines.join('\r\n')));
            if (body.byteLength) conn.socket.write(body);
            // Keep-alive: leave the connection open for the next request. The
            // body is framed by Content-Length, so the server knows where it ends.
            if (!this.#keepAlive) conn.socket.end();
          },
        );
      }

      abort(): void {
        this.aborted = true;
        (this.#socket as unknown as VirtualSocket | null)?.destroy();
        this.emit('abort');
      }
      _destroy(err: Error | null, cb: (err?: Error | null) => void): void {
        this.abort();
        cb(err);
      }
      setTimeout(): this {
        return this;
      }
    }

    function normalizeOptions(options: RequestOptions | string): RequestOptions {      if (typeof options === 'string') {
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

    // -- Agent + header helpers ----------------------------------------------

    /**
     * `http.Agent`. Our client keeps keep-alive connections in the runtime's own
     * per-port cache, so this tracks options/requests and honours `agent: false`
     * (disable keep-alive) rather than owning the socket pool.
     */
    class Agent {
      options: Record<string, unknown>;
      maxSockets = Infinity;
      maxFreeSockets = 256;
      maxTotalSockets = Infinity;
      keepAlive: boolean;
      scheduling: string;
      timeout?: number;
      requests: Record<string, unknown[]> = {};
      sockets: Record<string, unknown[]> = {};
      freeSockets: Record<string, unknown[]> = {};

      constructor(options: Record<string, unknown> = {}) {
        this.options = { noDelay: true, path: null, ...options };
        this.keepAlive = Boolean(options.keepAlive);
        this.scheduling = String(options.scheduling ?? 'lifo');
        if (options.timeout !== undefined) this.timeout = Number(options.timeout);
        if (options.maxSockets !== undefined) this.maxSockets = Number(options.maxSockets);
        if (options.maxFreeSockets !== undefined) this.maxFreeSockets = Number(options.maxFreeSockets);
      }

      getName(
        options: { host?: string; hostname?: string; port?: number | string; localAddress?: string } = {},
      ): string {
        const host = options.host || options.hostname || 'localhost';
        const port = options.port || '';
        const localAddress = options.localAddress || '';
        return `${host}:${port}:${localAddress}`;
      }

      createConnection(): never {
        throw notImplemented('api', 'http.Agent#createConnection');
      }
      createSocket(): never {
        throw notImplemented('api', 'http.Agent#createSocket');
      }
      addRequest(
        req: unknown,
        options: { host?: string; hostname?: string; port?: number | string },
      ): void {
        const name = this.getName(options);
        (this.requests[name] ??= []).push(req);
      }
      removeSocket(): void {}
      keepSocketAlive(): void {}
      reuseSocket(): void {}
      destroy(): void {
        for (const k of Object.keys(this.sockets)) delete this.sockets[k];
        for (const k of Object.keys(this.freeSockets)) delete this.freeSockets[k];
        for (const k of Object.keys(this.requests)) delete this.requests[k];
      }
    }

    const globalAgent = new Agent({ keepAlive: true, scheduling: 'lifo', timeout: 5000 });

    const maxHeaderSize = 16384;
    // `checkIsHttpToken` / `checkInvalidHeaderChar` from `lib/_http_common.js`.
    const httpTokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
    const strictHeaderCharRegex = /[^\t\x20-\x7e\x80-\xff]/;
    const lenientHeaderCharRegex = /[\x00\x0a\x0d]|[^\x00-\xff]/;
    const checkIsHttpToken = (val: string): boolean => val.length > 0 && httpTokenRegExp.test(val);
    const checkInvalidHeaderChar = (val: string, lenient = false): boolean =>
      (lenient ? lenientHeaderCharRegex : strictHeaderCharRegex).test(val);

    const errorCodes = (): Record<string, new (...a: unknown[]) => Error> =>
      (ctx.require('internal/errors') as { codes: Record<string, new (...a: unknown[]) => Error> }).codes;

    const validateHeaderName = (name: unknown, label?: string): void => {
      if (typeof name !== 'string' || name.length === 0 || !checkIsHttpToken(name)) {
        throw new (errorCodes().ERR_INVALID_HTTP_TOKEN)(label ?? 'Header name', name);
      }
    };
    const validateHeaderValue = (name: unknown, value: unknown, lenient?: boolean): void => {
      if (value === undefined) {
        throw new (errorCodes().ERR_HTTP_INVALID_HEADER_VALUE)(value, name);
      }
      if (checkInvalidHeaderChar(String(value), lenient)) {
        throw new (errorCodes().ERR_INVALID_CHAR)('header content', name);
      }
    };

    let maxIdleHTTPParsers = 1000;
    const setMaxIdleHTTPParsers = (value: unknown): void => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new RangeError('The value of "n" is out of range.');
      }
      maxIdleHTTPParsers = value;
    };
    // We have no proxy support; only fail when the environment actually asks
    // for one, so the common no-op call stays silent.
    const setGlobalProxyFromEnv = (): void => {
      const env =
        (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
      const found = ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'].find(
        (k) => env[k],
      );
      if (found !== undefined) throw notImplemented('api', 'http.setGlobalProxyFromEnv (proxy support)');
    };

    // Node re-exports the globals (since v22); mirror whichever the host has and
    // fall back to loud classes.
    const globalAny = globalThis as unknown as {
      MessageEvent?: unknown;
      CloseEvent?: unknown;
      WebSocket?: unknown;
    };
    const MessageEvent = globalAny.MessageEvent ?? undefined;
    const CloseEvent = globalAny.CloseEvent ?? undefined;
    const WebSocket = globalAny.WebSocket ?? undefined;

    return {
      Server,
      ServerResponse,
      IncomingMessage,
      OutgoingMessage,
      ClientRequest,
      Agent,
      globalAgent,
      maxHeaderSize,
      validateHeaderName,
      validateHeaderValue,
      setMaxIdleHTTPParsers,
      setGlobalProxyFromEnv,
      MessageEvent,
      CloseEvent,
      WebSocket,
      _connectionListener,
      STATUS_CODES,
      METHODS: [
        'ACL','BIND','CHECKOUT','CONNECT','COPY','DELETE','GET','HEAD','LINK','LOCK','M-SEARCH','MERGE','MKACTIVITY','MKCALENDAR','MKCOL','MOVE','NOTIFY','OPTIONS','PATCH','POST','PROPFIND','PROPPATCH','PURGE','PUT','REBIND','REPORT','SEARCH','SOURCE','SUBSCRIBE','TRACE','UNBIND','UNLINK','UNLOCK','UNSUBSCRIBE',
      ],
      createServer,
      request,
      get,
      default: { Server, createServer, request, get },
      /**
       * Streaming variant of `_request` used by the ServiceWorker bridge: instead
       * of buffering the whole body, the caller is handed the head as soon as it
       * arrives and then each body chunk as it is decoded. That is what lets
       * `res.write()`/SSE reach a browser incrementally instead of in one blob.
       */
      _stream: (
        port: number,
        init: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Uint8Array },
        handlers: {
          onHead: (head: { status: number; statusMessage: string; headers: Record<string, string | string[]> }) => void;
          onData: (chunk: Uint8Array) => void;
          onEnd: () => void;
          onError: (err: Error) => void;
        },
      ): void => {
        const req = new ClientRequest({
          hostname: '127.0.0.1',
          port,
          path: init.path ?? '/',
          method: init.method ?? 'GET',
          headers: init.headers ?? {},
        });
        req.on('error' as never, ((err: Error) => handlers.onError(err)) as never);
        req.on('response' as never, ((res: IncomingMessage) => {
          handlers.onHead({ status: res.statusCode, statusMessage: res.statusMessage, headers: res.headers });
          res.on('data' as never, ((c: Uint8Array) => handlers.onData(toBytes(c))) as never);
          res.on('end' as never, (() => handlers.onEnd()) as never);
        }) as never);
        if (init.body) req.write(init.body);
        req.end();
      },
      /** Promise helper used by the ServiceWorker bridge and tests. */
      _request: (
        port: number,
        init: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Uint8Array },
      ): Promise<{ status: number; statusMessage: string; headers: Record<string, string | string[]>; body: Uint8Array }> =>
        new Promise((resolve, reject) => {
          const chunks: Uint8Array[] = [];
          let head: { status: number; statusMessage: string; headers: Record<string, string | string[]> } | null = null;
          const http = ctx.require('http') as unknown as {
            _stream: (
              port: number,
              init: Record<string, unknown>,
              handlers: {
                onHead: (h: { status: number; statusMessage: string; headers: Record<string, string | string[]> }) => void;
                onData: (c: Uint8Array) => void;
                onEnd: () => void;
                onError: (e: Error) => void;
              },
            ) => void;
          };
          // Late-bound: `http` is this very module, already fully constructed by
          // the time `_request` runs.
          http._stream(port, init as Record<string, unknown>, {
            onHead: (h) => {
              head = h;
            },
            onData: (c) => chunks.push(c),
            onEnd: () => resolve({ ...(head as NonNullable<typeof head>), body: concatAll(chunks) }),
            onError: reject,
          });
        }),
    };
  },
};
