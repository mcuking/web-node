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

  /**
   * When set, the response carries no body regardless of its framing headers —
   * this is what a HEAD response looks like (Node keys this off the request
   * method). A function makes it dynamic for pooled keep-alive connections.
   */
  headOnly: boolean | (() => boolean) = false;

  constructor(
    private readonly onHead: (head: ParsedHead) => void,
    private readonly onBody: (chunk: Uint8Array) => void,
    private readonly onEnd: () => void,
    private readonly onTrailer?: (line: string) => void,
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
        // A 1xx interim response (100 Continue, 102 Processing, 103 Early Hints)
        // carries no body and precedes the real response — skip it and keep
        // reading headers. 101 Switching Protocols is a final response.
        const status = head.statusCode;
        if (typeof status === 'number' && status >= 100 && status < 200 && status !== 101) {
          continue;
        }
        this.onHead(head);

        // A HEAD response advertises the headers a GET would but sends no body
        // at all, so no matter the framing headers the body is empty.
        const headOnly = typeof this.headOnly === 'function' ? this.headOnly() : this.headOnly;
        if (headOnly) {
          this.#mode = 'done';
          this.onEnd();
          return;
        }

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
        this.onTrailer?.(line);
        continue; // otherwise a trailer header line
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
  102: 'Processing',
  103: 'Early Hints',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  207: 'Multi-Status',
  208: 'Already Reported',
  226: 'IM Used',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  305: 'Use Proxy',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  418: "I'm a Teapot",
  421: 'Misdirected Request',
  422: 'Unprocessable Entity',
  423: 'Locked',
  424: 'Failed Dependency',
  425: 'Too Early',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates',
  507: 'Insufficient Storage',
  508: 'Loop Detected',
  509: 'Bandwidth Limit Exceeded',
  510: 'Not Extended',
  511: 'Network Authentication Required',
};

export const httpSpec: BuiltinSpec = {
  id: 'http',
  aliases: ['node:http'],
  origin: 'web-node',
  arity: {
    Agent: 1, ClientRequest: 3, Server: 2, ServerResponse: 2, IncomingMessage: 1, OutgoingMessage: 1,
    createServer: 2, get: 3, request: 3, validateHeaderName: 0, validateHeaderValue: 0,
  },
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

    /**
     * Node's `matchKnownFields` (`_http_incoming.js`): returns the lowercased
     * name, optionally flag-prefixed so `_addHeaderLine` knows how to fold
     * duplicates. `\u0000` = join with `', '`, `\u0002` = join with `'; '`,
     * `\u0001` = array field (Set-Cookie), no prefix = drop duplicates.
     */
    function matchKnownFields(field: string, lowercased?: boolean): string {
      switch (field.length) {
        case 3:
          if (field === 'Age' || field === 'age') return 'age';
          break;
        case 4:
          if (field === 'Host' || field === 'host') return 'host';
          if (field === 'From' || field === 'from') return 'from';
          if (field === 'ETag' || field === 'etag') return 'etag';
          if (field === 'Date' || field === 'date') return '\u0000date';
          if (field === 'Vary' || field === 'vary') return '\u0000vary';
          break;
        case 6:
          if (field === 'Server' || field === 'server') return 'server';
          if (field === 'Cookie' || field === 'cookie') return '\u0002cookie';
          if (field === 'Origin' || field === 'origin') return '\u0000origin';
          if (field === 'Expect' || field === 'expect') return '\u0000expect';
          if (field === 'Accept' || field === 'accept') return '\u0000accept';
          break;
        case 7:
          if (field === 'Referer' || field === 'referer') return 'referer';
          if (field === 'Expires' || field === 'expires') return 'expires';
          if (field === 'Upgrade' || field === 'upgrade') return '\u0000upgrade';
          break;
        case 8:
          if (field === 'Location' || field === 'location') return 'location';
          if (field === 'If-Match' || field === 'if-match') return '\u0000if-match';
          break;
        case 10:
          if (field === 'User-Agent' || field === 'user-agent') return 'user-agent';
          if (field === 'Set-Cookie' || field === 'set-cookie') return '\u0001';
          if (field === 'Connection' || field === 'connection') return '\u0000connection';
          break;
        case 11:
          if (field === 'Retry-After' || field === 'retry-after') return 'retry-after';
          break;
        case 12:
          if (field === 'Content-Type' || field === 'content-type') return 'content-type';
          if (field === 'Max-Forwards' || field === 'max-forwards') return 'max-forwards';
          break;
        case 13:
          if (field === 'Authorization' || field === 'authorization') return 'authorization';
          if (field === 'Last-Modified' || field === 'last-modified') return 'last-modified';
          if (field === 'Cache-Control' || field === 'cache-control') return '\u0000cache-control';
          if (field === 'If-None-Match' || field === 'if-none-match') return '\u0000if-none-match';
          break;
        case 14:
          if (field === 'Content-Length' || field === 'content-length') return 'content-length';
          break;
        case 15:
          if (field === 'Accept-Encoding' || field === 'accept-encoding') return '\u0000accept-encoding';
          if (field === 'Accept-Language' || field === 'accept-language') return '\u0000accept-language';
          if (field === 'X-Forwarded-For' || field === 'x-forwarded-for') return '\u0000x-forwarded-for';
          break;
        case 16:
          if (field === 'Content-Encoding' || field === 'content-encoding') return '\u0000content-encoding';
          if (field === 'X-Forwarded-Host' || field === 'x-forwarded-host') return '\u0000x-forwarded-host';
          break;
        case 17:
          if (field === 'If-Modified-Since' || field === 'if-modified-since') return 'if-modified-since';
          if (field === 'Transfer-Encoding' || field === 'transfer-encoding') return '\u0000transfer-encoding';
          if (field === 'X-Forwarded-Proto' || field === 'x-forwarded-proto') return '\u0000x-forwarded-proto';
          break;
        case 19:
          if (field === 'Proxy-Authorization' || field === 'proxy-authorization') return 'proxy-authorization';
          if (field === 'If-Unmodified-Since' || field === 'if-unmodified-since') return 'if-unmodified-since';
          break;
      }
      if (lowercased) return '\u0000' + field;
      return matchKnownFields(field.toLowerCase(), true);
    }

    /** Node's `headersDistinct`/`trailersDistinct` shape: name -> string[]. */
    function distinct(src: Record<string, string | string[]>): Record<string, string[]> {
      const out: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(src)) out[k] = Array.isArray(v) ? v.slice() : [v];
      return out;
    }

    /** Byte length of a would-be body chunk (strings are UTF-8 encoded). */
    function byteLen(data: unknown): number {
      if (typeof data === 'string') return new TextEncoder().encode(data).byteLength;
      if (data instanceof Uint8Array) return data.byteLength;
      if (ArrayBuffer.isView(data)) return data.byteLength;
      if (data instanceof ArrayBuffer) return data.byteLength;
      return 0;
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
     * `res instanceof http.OutgoingMessage` holds, like Node. It carries the
     * shared header surface and the internal plumbing (`_send`/`_storeHeader`/
     * `_flush`/…`_implicitHeader`); the transport-specific line is supplied by
     * the subclasses.
     */
    class OutgoingMessage extends (Writable as new (opts?: Record<string, unknown>) => WritableLike) {
      /** @internal — the rendered head block, once stored. */
      _header = '';

      /** @internal — header store, keyed by lower-cased name (shared with subclasses). */
      _headers = new Map<string, string | string[]>();
      /** @internal — original-cased names for `getRawHeaderNames()`. */
      _rawHeaderNames = new Map<string, string>();
      /** @internal — trailer store, keyed by lower-cased name. */
      _trailers = new Map<string, string | string[]>();
      /** @internal — original-cased trailer names. */
      _rawTrailerNames = new Map<string, string>();
      #socket: NetSocket | null = null;
      /** `message.socket` / `message.connection` — the bound transport. */
      get socket(): NetSocket | null {
        return this.#socket;
      }
      set socket(value: NetSocket | null) {
        this.#socket = value;
      }
      get connection(): NetSocket | null {
        return this.#socket;
      }
      set connection(value: NetSocket | null) {
        this.#socket = value;
      }

      /** Node: `!!this._header` — true once the head block has been staged. */
      get headersSent(): boolean {
        return !!this._header;
      }

      setHeader(name: string, value: string | string[]): this {
        if (this.headersSent) {
          throw new (errorCodes().ERR_HTTP_HEADERS_SENT)('set');
        }
        validateHeaderName(name);
        validateHeaderValue(name, value);
        this._headers.set(name.toLowerCase(), value);
        this._rawHeaderNames.set(name.toLowerCase(), name);
        return this;
      }
      getHeader(name: string): string | string[] | undefined {
        return this._headers.get(name.toLowerCase());
      }
      getHeaders(): Record<string, string | string[]> {
        // Node hands back a null-prototype object here.
        const out: Record<string, string | string[]> = Object.create(null);
        for (const [k, v] of this._headers) out[k] = v;
        return out;
      }
      getHeaderNames(): string[] {
        return [...this._headers.keys()];
      }
      /** The header names exactly as they were first set (case preserved). */
      getRawHeaderNames(): string[] {
        return [...this._rawHeaderNames.values()];
      }
      hasHeader(name: string): boolean {
        return this._headers.has(name.toLowerCase());
      }
      removeHeader(name: string): void {
        if (this.headersSent) {
          throw new (errorCodes().ERR_HTTP_HEADERS_SENT)('remove');
        }
        validateHeaderName(name);
        this._headers.delete(name.toLowerCase());
        this._rawHeaderNames.delete(name.toLowerCase());
      }
      setHeaders(headers: Record<string, string | string[]> | Array<[string, string | string[]]>): void {
        const entries = Array.isArray(headers) ? headers : Object.entries(headers);
        for (const [name, value] of entries) this.setHeader(String(name), value);
      }
      appendHeader(name: string, value: string | string[]): this {
        if (this.headersSent) {
          throw new (errorCodes().ERR_HTTP_HEADERS_SENT)('append');
        }
        const key = name.toLowerCase();
        if (!this._headers.has(key)) return this.setHeader(name, value);
        const prev = this._headers.get(key)!;
        const next = Array.isArray(prev)
          ? prev.concat(value as string | string[])
          : [prev as string].concat(value as string | string[]);
        this._headers.set(key, next as string[]);
        return this;
      }
      addTrailers(headers: Record<string, string | string[]> | Array<[string, string | string[]]>): void {
        const entries = Array.isArray(headers) ? headers : Object.entries(headers);
        for (const [name, value] of entries) {
          validateHeaderName(name);
          validateHeaderValue(name, value);
          const key = String(name).toLowerCase();
          this._trailers.set(key, value);
          this._rawTrailerNames.set(key, String(name));
        }
      }
      setTimeout(msecs: number, cb?: () => void): this {
        if (typeof cb === 'function') this.once('timeout' as never, cb as never);
        (this.#socket as unknown as { setTimeout?: (ms: number) => void } | null)?.setTimeout?.(msecs);
        return this;
      }

      /** @internal — Node reads the `httpValidation` option; we default strict. */
      _isLenientHeaderValidation(): boolean {
        const self = this as unknown as {
          httpValidation?: string;
          req?: { socket?: { server?: { httpValidation?: string } } };
        };
        if (self.httpValidation !== undefined) return self.httpValidation !== 'strict';
        const fromServer = self.req?.socket?.server?.httpValidation;
        if (fromServer !== undefined) return fromServer !== 'strict';
        return false;
      }
      /** @internal — the header names/values exactly as sent. */
      _renderHeaders(): Record<string, string | string[]> {
        if (this._header) {
          throw Object.assign(new Error('Cannot render headers after they are sent to the client'), {
            code: 'ERR_HTTP_HEADERS_SENT',
          });
        }
        return this.getHeaders();
      }
      /** @internal — subclasses supply the request/status line. */
      _implicitHeader(): void {
        throw Object.assign(new Error('The _implicitHeader() method is not implemented'), {
          code: 'ERR_METHOD_NOT_IMPLEMENTED',
        });
      }
      /** @internal — render and stage the head block. */
      _storeHeader(firstLine: string, headers: Record<string, string | string[]>): void {
        let head = firstLine;
        for (const [name, value] of Object.entries(headers)) {
          if (Array.isArray(value)) for (const v of value) head += `${name}: ${v}\r\n`;
          else head += `${name}: ${value}\r\n`;
        }
        head += '\r\n';
        this._header = head;
      }
      /** @internal — write a body chunk (or the staged head) to the transport. */
      _send(data: unknown, _encoding: string, callback?: (err?: Error | null) => void): boolean {
        this.#socket?.write(data);
        if (typeof callback === 'function') callback(null);
        return true;
      }
      /** @internal — like `_send`, but bypasses framing. */
      _writeRaw(data: unknown, _encoding: string, callback?: (err?: Error | null) => void): boolean {
        this.#socket?.write(data);
        if (typeof callback === 'function') callback(null);
        return true;
      }
      /** @internal — Node asserts a socket and emits 'prefinish'. */
      _finish(): void {
        this.emit('prefinish');
      }
      /** @internal — flush the pending head block, then finish if ended. */
      _flush(): void {
        this._flushOutput();
        if ((this as unknown as { finished?: boolean }).finished) this._finish();
      }
      /** @internal — drain the staged head block into the transport. */
      _flushOutput(_socket?: NetSocket | null): boolean | undefined {
        if (!this._header) return undefined;
        const head = this._header;
        this.#socket?.write(head);
        return true;
      }
      /** `message.flushHeaders()` — force the head block out. */
      flushHeaders(): void {
        if (!this._header) this._implicitHeader();
        this._send('', 'utf8');
      }
    }

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
      rawHeaders: string[] = [];
      rawTrailers: string[] = [];
      socket: NetSocket | null = null;
      req: unknown = undefined;
      /** @internal — `joinDuplicateHeaders` option (RFC 9110 leniency). */
      joinDuplicateHeaders = false;

      #headersObj: Record<string, string | string[]> | null = null;
      #headersCount = 0;
      #trailersObj: Record<string, string | string[]> | null = null;
      #trailersCount = 0;
      #dumped = false;
      #abortController: AbortController | null = null;
      #headersDistinct: Record<string, string[]> | null = null;
      #trailersDistinct: Record<string, string[]> | null = null;

      /**
       * The parsed header map. Lazily built from `rawHeaders` the first time it
       * is read (matching Node), and directly assignable.
       */
      get headers(): Record<string, string | string[]> {
        if (this.#headersObj === null) {
          this.#headersObj = Object.create(null) as Record<string, string | string[]>;
          const dest = this.#headersObj;
          for (let n = 0; n < this.#headersCount; n += 2) {
            this._addHeaderLine(this.rawHeaders[n], this.rawHeaders[n + 1], dest);
          }
        }
        return this.#headersObj;
      }
      set headers(value: Record<string, string | string[]>) {
        this.#headersObj = value;
      }

      /** The parsed trailer map (lazily built from `rawTrailers`). */
      get trailers(): Record<string, string | string[]> {
        if (this.#trailersObj === null) {
          this.#trailersObj = Object.create(null) as Record<string, string | string[]>;
          const dest = this.#trailersObj;
          for (let n = 0; n < this.#trailersCount; n += 2) {
            this._addHeaderLine(this.rawTrailers[n], this.rawTrailers[n + 1], dest);
          }
        }
        return this.#trailersObj;
      }
      set trailers(value: Record<string, string | string[]>) {
        this.#trailersObj = value;
      }

      /** `message.connection` — alias of the bound socket (Node accessor). */
      get connection(): NetSocket | null {
        return this.socket;
      }
      set connection(value: NetSocket | null) {
        this.socket = value;
      }

      /** `message.signal` — aborted when the message is destroyed/aborted. */
      get signal(): AbortSignal {
        return (this.#abortController ??= new AbortController()).signal;
      }

      /** A view where every header value is an array and never joined. */
      get headersDistinct(): Record<string, string[]> {
        return (this.#headersDistinct ??= distinct(this.headers));
      }

      /** A view where every trailer value is an array and never joined. */
      get trailersDistinct(): Record<string, string[]> {
        return (this.#trailersDistinct ??= distinct(this.trailers));
      }

      /** `message.setTimeout(msecs, cb)` — arm a socket inactivity timer. */
      setTimeout(msecs: number, cb?: () => void): this {
        if (typeof cb === 'function') this.once('timeout' as never, cb as never);
        (this.socket as unknown as { setTimeout?: (ms: number) => void } | null)?.setTimeout?.(msecs);
        return this;
      }

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
        this.#headersDistinct = null;
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

      /** @internal — one `Name: value` trailer line (after a chunked body). */
      _addTrailer(line: string): void {
        const idx = line.indexOf(':');
        if (idx < 0) return;
        const name = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        // Materialise the trailer map *before* recording the raw pair so the
        // lazy builder and this call do not both insert the same value.
        const dest = this.trailers;
        this.rawTrailers.push(name, value);
        this.#trailersCount = this.rawTrailers.length;
        this._addHeaderLine(name, value, dest);
      }

      /** @internal — parse every (name, value) pair into `headers`/`trailers`. */
      _addHeaderLines(headers: string[], n: number): void {
        if (headers?.length) {
          let dest: Record<string, string | string[]> | null;
          if (this.complete) {
            this.rawTrailers = headers;
            this.#trailersCount = n;
            dest = this.#trailersObj;
          } else {
            this.rawHeaders = headers;
            this.#headersCount = n;
            dest = this.#headersObj;
          }
          if (dest) {
            for (let i = 0; i < n; i += 2) {
              this._addHeaderLine(headers[i], headers[i + 1], dest);
            }
          }
        }
      }

      /** @internal — fold one header line into `dest` (Node's joining rules). */
      _addHeaderLine(field: string, value: string, dest: Record<string, string | string[]>): void {
        field = matchKnownFields(field);
        const flag = field.charCodeAt(0);
        if (flag === 0 || flag === 2) {
          field = field.slice(1);
          const existing = dest[field];
          if (typeof existing === 'string') {
            dest[field] = existing + (flag === 0 ? ', ' : '; ') + value;
          } else {
            dest[field] = value;
          }
        } else if (flag === 1) {
          const existing = dest['set-cookie'];
          if (existing !== undefined) (existing as string[]).push(value);
          else dest['set-cookie'] = [value];
        } else if (this.joinDuplicateHeaders) {
          const existing = dest[field];
          if (existing === undefined) dest[field] = value;
          else dest[field] = `${existing}, ${value}`;
        } else if (dest[field] === undefined) {
          dest[field] = value;
        }
      }

      /** @internal — every value as an array, never joined. */
      _addHeaderLineDistinct(field: string, value: string, dest: Record<string, string[]>): void {
        field = field.toLowerCase();
        if (!dest[field]) dest[field] = [value];
        else dest[field].push(value);
      }

      /** @internal — drain incoming data without buffering it. */
      _dump(): void {
        if (this.#dumped) return;
        this.#dumped = true;
        const self = this as unknown as {
          destroyed: boolean;
          readableLength: number;
          read(n?: number): unknown;
          resume(): unknown;
          removeAllListeners(event?: string): unknown;
        };
        self.removeAllListeners('data');
        if (this.complete && !self.destroyed && self.readableLength === 0) self.read(0);
        else self.resume();
      }

      /** @internal — mark the readable as fully closed (no 'end' event). */
      _dumpAndCloseReadable(): void {
        this.#dumped = true;
        const state = (this as unknown as { _readableState: Record<string, unknown> })._readableState;
        state.ended = true;
        state.endEmitted = true;
        state.destroyed = true;
        state.closed = true;
        state.closeEmitted = true;
      }

      /** @internal */
      _destroy(err: Error | null, cb: (err?: Error | null) => void): void {
        // A normally-completed message must NOT tear down its socket: that
        // socket may be a keep-alive connection about to carry the next
        // request (or be sitting in the client's pool). Only an abort/error
        // closes the transport.
        if (err) {
          this.aborted = true;
          this.#abortController?.abort(err);
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
      finished = false;
      sendDate = true;
      req: IncomingMessage | null = null;

      #statusCode = 200;
      #statusMessage: string | undefined = undefined;
      #sent = false;
      #flushed = false;
      #contentLength: number | null = null;
      #chunked = false;
      #bodyLength = 0;
      #keepAlive = false;

      get statusCode(): number {
        return this.#statusCode;
      }
      set statusCode(value: number) {
        this.#statusCode = value;
      }
      get statusMessage(): string | undefined {
        return this.#statusMessage;
      }
      set statusMessage(value: string | undefined) {
        this.#statusMessage = value;
      }
      /** True once the response head has been staged. */
      get headersSent(): boolean {
        return this.#sent;
      }

      /** @internal — set by the server so it can re-arm the connection. */
      _onResponseFinish: (() => void) | null = null;

      /** @internal — the server's keep-alive timeout, echoed in `Keep-Alive`. */
      _keepAliveTimeout = 0;

      /**
       * `res.end([data])` — Node records the body length up front so the head
       * can carry an accurate `Content-Length` instead of chunking.
       */
      end(chunk?: unknown, encoding?: unknown, cb?: unknown): this {
        if (!this.headersSent && chunk !== undefined && chunk !== null) {
          this.#contentLength = byteLen(chunk);
        }
        return (super.end as (...a: unknown[]) => this)(chunk, encoding, cb);
      }

      /** True unless the client or this response asked for `Connection: close`. */
      get shouldKeepAlive(): boolean {
        return this.#keepAlive;
      }

      /** True once the response is being framed with chunked transfer-encoding. */
      get chunkedEncoding(): boolean {
        return this.#chunked;
      }

      /** @internal — implicitly send the head when the body starts. */
      _implicitHeader(): void {
        this.writeHead(this.statusCode);
      }

      constructor(socket: NetSocket) {
        // Node's OutgoingMessage is a plain Stream that does not auto-destroy on
        // `finish`; our ServerResponse is a Writable, so opt out explicitly.
        super({ autoDestroy: false });
        this.socket = socket;
      }

      /**
       * `res.addTrailers(headers)` — HTTP trailers sent after a chunked body.
       * They are emitted just before the terminating chunk.
       */

      /** `res.assignSocket(socket)` — bind an existing socket to this response. */
      assignSocket(socket: NetSocket): void {
        this.socket = socket;
        (socket as unknown as { _httpMessage?: unknown })._httpMessage = this;
        this.emit('socket' as never, socket as never);
      }
      /** `res.detachSocket(socket)` — unbind (leaves the socket open). */
      detachSocket(socket: NetSocket): void {
        (socket as unknown as { _httpMessage?: unknown })._httpMessage = null;
        if (this.socket === socket) this.socket = null;
      }

      /** `res.setTimeout(msecs, cb)` — arm a socket inactivity timer. */
      setTimeout(msecs: number, cb?: () => void): this {
        if (typeof cb === 'function') this.once('timeout' as never, cb as never);
        (this.socket as unknown as { setTimeout?: (ms: number) => void } | null)?.setTimeout?.(msecs);
        return this;
      }

      /**
       * `res.writeInformation(statusCode, headers, cb)` — write a 1xx interim
       * response directly to the socket, before the final headers are flushed.
       */
      writeInformation(
        statusCode: number,
        headers?: Record<string, string | string[]> | Array<string | string[]> | null,
        cb?: () => void,
      ): void {
        if (this.headersSent) throw new Error('Cannot write headers after they are sent to the client');
        if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 199) {
          throw new RangeError(`The value of "statusCode" is out of range. It must be >= 100 and <= 199. Received ${statusCode}`);
        }
        let head = `HTTP/1.1 ${statusCode} ${STATUS_CODES[statusCode] ?? 'unknown'}\r\n`;
        const entries: Array<[string, unknown]> = [];
        if (Array.isArray(headers)) {
          if (headers.length && Array.isArray(headers[0])) {
            for (const pair of headers as Array<[string, unknown]>) entries.push([String(pair[0]), pair[1]]);
          } else {
            const flat = headers as Array<string | string[]>;
            for (let i = 0; i + 1 < flat.length; i += 2) entries.push([String(flat[i]), flat[i + 1]]);
          }
        } else if (headers && typeof headers === 'object') {
          for (const [k, v] of Object.entries(headers)) entries.push([k, v]);
        }
        for (const [name, value] of entries) {
          if (Array.isArray(value)) for (const v of value) head += `${name}: ${v}\r\n`;
          else head += `${name}: ${value}\r\n`;
        }
        head += '\r\n';
        this.socket?.write(new TextEncoder().encode(head));
        if (typeof cb === 'function') cb();
      }

      /** `res.writeContinue()` — the 100 Continue interim response. */
      writeContinue(cb?: () => void): void {
        this.writeInformation(100, null, cb);
      }
      /** `res.writeProcessing()` — the 102 Processing interim response. */
      writeProcessing(cb?: () => void): void {
        this.writeInformation(102, null, cb);
      }
      /** `res.writeEarlyHints({ link, ... })` — the 103 Early Hints response. */
      writeEarlyHints(hints: { link?: string | string[] } & Record<string, unknown>, cb?: () => void): void {
        const link = hints.link;
        if (link === null || link === undefined) return;
        const value = Array.isArray(link) ? link.join(', ') : String(link);
        if (value.length === 0) return;
        const headers: Record<string, string | string[]> = { Link: value };
        for (const [k, v] of Object.entries(hints)) if (k !== 'link') headers[k] = v as string | string[];
        this.writeInformation(103, headers, cb);
      }

      writeHead(status: number, a?: unknown, b?: unknown): this {
        if (this.headersSent) {
          throw new (errorCodes().ERR_HTTP_HEADERS_SENT)('write');
        }
        // Node coerces with `| 0` and rejects anything outside 100–999.
        const original = status;
        status |= 0;
        if (status < 100 || status > 999) {
          throw new (errorCodes().ERR_HTTP_INVALID_STATUS_CODE)(original);
        }
        this.statusCode = status;
        if (typeof a === 'string') {
          this.statusMessage = a;
          if (b && typeof b === 'object') for (const [k, v] of Object.entries(b as Record<string, string>)) this.setHeader(k, v);
        } else if (a && typeof a === 'object') {
          for (const [k, v] of Object.entries(a as Record<string, string>)) this.setHeader(k, v);
        }
        this.#sent = true;
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
          // A HEAD response carries the headers a GET would (incl. framing) but
          // no body at all; Node discards the chunks and the terminator.
          if (this.req?.method === 'HEAD') {
            cb(null);
            return;
          }
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
          if (this.#chunked && this.req?.method !== 'HEAD') {
            if (this._trailers.size > 0) {
              let tail = '0\r\n';
              for (const [key, value] of this._trailers) {
                const name = this._rawTrailerNames.get(key) ?? key;
                if (Array.isArray(value)) for (const v of value) tail += `${name}: ${v}\r\n`;
                else tail += `${name}: ${value}\r\n`;
              }
              tail += '\r\n';
              this.socket?.write(new TextEncoder().encode(tail));
            } else {
              this.socket?.write(END_CHUNK);
            }
          }
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
        this.#sent = true;

        const message = this.statusMessage ?? STATUS_CODES[this.statusCode] ?? 'Unknown';
        let head = `HTTP/1.1 ${this.statusCode} ${message}\r\n`;

        // Emit user headers first, noting which framing headers they supplied
        // (Node's `processHeader` records these in `state`).
        let sawDate = false;
        let sawConnection = false;
        let sawContentLength = false;
        let sawTransferEncoding = false;
        let connValue = '';
        for (const [name, value] of this._headers) {
          if (name === 'date') sawDate = true;
          else if (name === 'connection') {
            sawConnection = true;
            connValue = String(Array.isArray(value) ? value.join(',') : value).toLowerCase();
          } else if (name === 'content-length') sawContentLength = true;
          else if (name === 'transfer-encoding') sawTransferEncoding = true;
          const canonical = name.replace(/(^|-)([a-z])/g, (_, p1: string, p2: string) => `${p1}${p2.toUpperCase()}`);
          if (Array.isArray(value)) for (const v of value) head += `${canonical}: ${v}\r\n`;
          else head += `${canonical}: ${value}\r\n`;
        }

        // Date (Node adds it after the user's headers, if the user omitted it).
        if (this.sendDate && !sawDate) head += `Date: ${new Date().toUTCString()}\r\n`;

        // HTTP/1.1 defaults to persistent connections; the client opts out with
        // `Connection: close` (or HTTP/1.0 without `Connection: keep-alive`).
        const reqHeaders = this.req?.headers ?? {};
        const clientConn = String(reqHeaders['connection'] ?? '').toLowerCase();
        const version = this.req?.httpVersion ?? '1.1';
        const clientWantsClose =
          clientConn.includes('close') || (version === '1.0' && !clientConn.includes('keep-alive'));
        if (sawConnection) {
          this.#keepAlive = !connValue.includes('close') && !clientWantsClose;
        } else {
          this.#keepAlive = !clientWantsClose;
          if (this.#keepAlive) {
            head += 'Connection: keep-alive\r\n';
            if (this._keepAliveTimeout > 0) {
              head += `Keep-Alive: timeout=${Math.floor(this._keepAliveTimeout / 1000)}\r\n`;
            }
          } else {
            head += 'Connection: close\r\n';
          }
        }

        // Body framing: a known length wins, otherwise stream as chunked. A HEAD
        // response (like 204/304/101) advertises no body framing at all — Node
        // clears `_hasBody`, so neither Content-Length nor chunked is emitted.
        const bodiless =
          this.statusCode === 204 ||
          this.statusCode === 304 ||
          this.statusCode === 101 ||
          this.req?.method === 'HEAD';
        if (bodiless) {
          this.#chunked = false;
        } else if (sawTransferEncoding) {
          this.#chunked = true;
        } else if (!sawContentLength) {
          if (typeof this.#contentLength === 'number') {
            head += `Content-Length: ${this.#contentLength}\r\n`;
          } else {
            this.#chunked = true;
            head += 'Transfer-Encoding: chunked\r\n';
          }
        }

        head += '\r\n';
        this.socket?.write(new TextEncoder().encode(head));
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
        // `_fail` can also run before the handler touched a single header, so
        // reset the shared store to a lone content-type.
        this._headers = new Map([['content-type', 'text/plain; charset=utf-8']]);
        this._rawHeaderNames = new Map([['content-type', 'Content-Type']]);
        this.#chunked = false;
        this.#bodyLength = 0;
        this.end('Internal Server Error');
        return true;
      }
    }

    // -- Server ---------------------------------------------------------------

    class Server extends (net.Server as new () => netServer) {
      requestTimeout = 300000;
      headersTimeout = 60000;
      keepAliveTimeout = 5000;
      maxRequestsPerSocket = 0;
      timeout = 0;

      /** @internal — sockets with an in-flight request (not idle keep-alive). */
      #active = new Set<NetSocket>();

      constructor(requestListener?: (req: IncomingMessage, res: ServerResponse) => void) {
        super();
        if (typeof requestListener === 'function') this.on('request', requestListener as never);
        this.on('connection', _connectionListener as never);
      }

      /** `server.setTimeout(msecs, cb)` — set the server inactivity timeout. */
      setTimeout(msecs: number, cb?: () => void): this {
        this.timeout = msecs;
        if (typeof cb === 'function') this.on('timeout' as never, cb as never);
        return this;
      }

      /** Every socket this server currently owns (accepted connections). */
      #allSockets(): NetSocket[] {
        return [...((this as unknown as { _sockets?: Set<NetSocket> })._sockets ?? [])];
      }

      /**
       * Node's `http.Server#close` drops idle keep-alive connections first
       * (`_http_server.js#httpServerPreClose`), so the server can actually
       * drain and emit 'close' instead of waiting on sockets that are idle by
       * design.
       */
      close(cb?: (err?: Error) => void): this {
        this.closeIdleConnections();
        (super.close as (cb?: (err?: Error) => void) => unknown)(cb);
        return this;
      }

      /** `server.closeAllConnections()` — forcibly destroy every connection. */
      closeAllConnections(): void {
        for (const socket of this.#allSockets()) socket.destroy();
      }

      /** `server.closeIdleConnections()` — destroy only idle keep-alive sockets. */
      closeIdleConnections(): void {
        for (const socket of this.#allSockets()) if (!this.#active.has(socket)) socket.destroy();
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
              response._keepAliveTimeout = this.keepAliveTimeout;
              req = request;
              res = response;
              currentReq = request;
              this.#active.add(socket);
              response._onResponseFinish = () => {
                if (!response.shouldKeepAlive || (socket as unknown as { destroyed?: boolean }).destroyed) {
                  socket.end();
                  return;
                }
                this.#active.delete(socket);
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
            (line) => req?._addTrailer(line),
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
      onTrailer?: (line: string) => void;
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
      /** The in-flight request targeted HEAD, so the response has no body. */
      headOnly = false;

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
          (line) => this.current?.onTrailer?.(line),
        );
        // The reader checks this dynamically (keep-alive connections are pooled
        // and reused across requests with different methods).
        reader.headOnly = () => this.headOnly;
        this.reader = reader;
        if (leftover.length > 0) reader.push(leftover);
      }

      send(handlers: ResponseHandlers, write: () => void): void {
        this.current = handlers;
        write();
      }

      /** Whether the in-flight request targeted HEAD (bodyless response). */
      setHeadOnly(value: boolean): void {
        this.headOnly = value;
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
      host: string;
      port: number;
      protocol = 'http:';
      maxHeadersCount: number | null = null;
      aborted = false;
      finished = false;
      reusedSocket = false;
      agent: unknown = globalAgent;

      /** @internal — port used when `options.port` is absent (https overrides). */
      _defaultPort = 80;

      #path = '/';
      #conn: Connection | null = null;
      #keepAlive = true;
      #agentKeepAlive = true;
      #chunks: Uint8Array[] = [];
      /** True once the caller wrote the body with `write()` (→ chunked framing). */
      #userWrote = false;
      #cb: ((res: IncomingMessage) => void) | undefined;
      #response: IncomingMessage | null = null;

      /**
       * A body produced with `req.write()` is sent chunked (Node only sets
       * `Content-Length` when the whole body is handed to `end(data)`).
       */
      write(chunk: unknown, enc?: unknown, cb?: unknown): boolean {
        this.#userWrote = true;
        return (super.write as (...a: unknown[]) => boolean)(chunk, enc, cb);
      }

      /** The request target (path + query) as sent on the request line. */
      get path(): string {
        return this.#path;
      }
      set path(value: string) {
        this.#path = value;
      }

      constructor(options: RequestOptions | string, cb?: (res: IncomingMessage) => void) {
        // See ServerResponse: outgoing messages never auto-destroy on finish.
        super({ autoDestroy: false });
        const opts = normalizeOptions(options);
        this._defaultPort = Number((opts as { _defaultPort?: number })._defaultPort ?? this._defaultPort);
        if (typeof (opts as { protocol?: string }).protocol === 'string') {
          this.protocol = (opts as { protocol?: string }).protocol as string;
        }
        this.method = (opts.method ?? 'GET').toUpperCase();
        this.path = opts.path ?? '/';
        this.host = opts.hostname ?? opts.host ?? '127.0.0.1';
        this.port = Number(opts.port ?? this._defaultPort);
        // Seed the header store from `options.headers` (lower-cased lookup keys,
        // original case preserved for `getRawHeaderNames()`), exactly like Node.
        for (const [name, value] of Object.entries((opts.headers ?? {}) as Record<string, string | string[]>)) {
          this._headers.set(name.toLowerCase(), value);
          this._rawHeaderNames.set(name.toLowerCase(), name);
        }
        // Node always sends a `Host` header, derived from host + port unless the
        // caller supplied one.
        if (!this._headers.has('host')) {
          const hostHeader = this.port === this._defaultPort ? this.host : `${this.host}:${this.port}`;
          this.setHeader('Host', hostHeader);
        }
        this.#cb = cb;
        // `agent: false` opts out of keep-alive; an Agent instance supplies its
        // own `keepAlive` preference.
        if (opts.agent === false) {
          // Node creates a fresh one-off agent for `agent: false`, which has
          // keep-alive off — so `req.agent` stays an Agent instance.
          const oneOff = new Agent();
          this.agent = oneOff;
          this.#agentKeepAlive = oneOff.keepAlive;
        } else if (opts.agent instanceof Agent) {
          this.agent = opts.agent;
          this.#agentKeepAlive = opts.agent.keepAlive;
        }
      }

      /** `request.setTimeout(msecs, cb)` — arm a socket inactivity timer. */
      setTimeout(msecs: number, cb?: () => void): this {
        if (typeof cb === 'function') this.once('timeout' as never, cb as never);
        (this.socket as unknown as { setTimeout?: (ms: number) => void } | null)?.setTimeout?.(msecs);
        return this;
      }
      /** `request.clearTimeout()` — disarm the socket inactivity timer. */
      clearTimeout(): void {
        (this.socket as unknown as { setTimeout?: (ms: number) => void } | null)?.setTimeout?.(0);
      }

      /** `request.onSocket(socket, err)` — adopt an already-connected socket. */
      onSocket(socket: NetSocket, err?: Error): void {
        this.socket = socket;
        if (err) ctx.binding.nextTick(() => this.emit('error', err));
      }
      /** `request.setNoDelay(noDelay)` — TCP_NODELAY toggle (no-op for a VFS socket). */
      setNoDelay(noDelay?: boolean): this {
        void noDelay;
        return this;
      }
      /** `request.setSocketKeepAlive(enable, initialDelay)` — SO_KEEPALIVE (no-op). */
      setSocketKeepAlive(enable?: boolean, initialDelay?: number): this {
        void enable;
        void initialDelay;
        return this;
      }

      /** @internal — the request headers as they will be sent. */
      _renderHeaders(): Record<string, string | string[]> {
        return { ...this.getHeaders() };
      }
      /** @internal — stage the request line + headers. */
      _implicitHeader(): void {
        this._storeHeader(`${this.method} ${this.path} HTTP/1.1\r\n`, this._renderHeaders());
      }
      /**
       * @internal — Node defers `method(...args)` until the socket connects. Our
       * socket is adopted synchronously, so the call goes straight through.
       */
      _deferToConnect(method: string, ...args: unknown[]): void {
        const socket = this.socket as unknown as
          | { connecting?: boolean; once?: (event: string, fn: () => void) => void }
          | null;
        const run = () => {
          const fn = (this as unknown as Record<string, unknown>)[method];
          if (typeof fn === 'function') (fn as (...a: unknown[]) => unknown).apply(this, args);
        };
        if (!socket || !socket.connecting) run();
        else socket.once?.('connect', run);
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
        this.socket = conn.socket as unknown as NetSocket;
        // A HEAD response announces the headers a GET would but has no body, so
        // tell the reader to stop after the head.
        conn.setHeadOnly(this.method === 'HEAD');

        const body = concatAll(this.#chunks);
        const lines: string[] = [`${this.method} ${this.path} HTTP/1.1`];
        const headers = new Map(this._headers);
        // HTTP/1.1 is persistent by default; the caller opts out via
        // `Connection: close`.
        const requested = String(headers.get('connection') ?? '').toLowerCase();
        this.#keepAlive = this.#agentKeepAlive && !requested.includes('close');
        if (!headers.has('connection')) headers.set('connection', this.#keepAlive ? 'keep-alive' : 'close');
        // Request framing mirrors Node's `_hasBody`/`useChunkedEncodingByDefault`:
        // bodyless methods carry no Content-Length; a body written with `write()`
        // is sent chunked; a body passed to `end(data)` is measured.
        const NO_BODY = ['GET', 'HEAD', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT'];
        let chunkedBody = false;
        if (!headers.has('content-length') && !headers.has('transfer-encoding') && !NO_BODY.includes(this.method)) {
          if (this.#userWrote) {
            headers.set('transfer-encoding', 'chunked');
            chunkedBody = true;
          } else {
            headers.set('content-length', String(body.byteLength));
          }
        }
        for (const [name, value] of headers) {
          const canonical = name.replace(/(^|-)([a-z])/g, (_, p1, p2) => `${p1}${p2.toUpperCase()}`);
          if (Array.isArray(value)) for (const v of value) lines.push(`${canonical}: ${v}`);
          else lines.push(`${canonical}: ${value}`);
        }
        lines.push('', '');
        // Mark the head as sent so `req.headersSent` reflects Node's `!!_header`.
        this._header = lines.join('\r\n');
        // Body wire framing: raw when Content-Length, hex-length chunks otherwise.
        const bodyWire = chunkedBody
          ? concatAll([
              new TextEncoder().encode(body.byteLength.toString(16) + '\r\n'),
              body,
              END_CHUNK,
            ])
          : body;

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
            onEnd: () => {
              // Node detaches the socket from the response once it is complete
              // (so the freed socket isn't destroyed with the message).
              const res = this.#response;
              if (res) {
                res.socket = null;
                res._end();
              }
            },
            onTrailer: (line) => this.#response?._addTrailer(line),
            onError: (err) => this.emit('error', err),
          },
          () => {
            conn.socket.write(new TextEncoder().encode(lines.join('\r\n')));
            if (bodyWire.byteLength) conn.socket.write(bodyWire);
            // Node keeps the write side open even for `Connection: close` — it
            // only tears the socket down once the response is complete (see the
            // reader's onEnd, which destroys a non-keep-alive connection).
            // Half-closing here would drop a response the server writes later.
          },
        );
      }

      abort(): void {
        this.aborted = true;
        (this.socket as unknown as VirtualSocket | null)?.destroy();
        this.emit('abort');
      }
      _destroy(err: Error | null, cb: (err?: Error | null) => void): void {
        this.abort();
        cb(err);
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
    class Agent extends (EventEmitter as new () => Emitter) {
      static defaultMaxSockets = Infinity;
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
        super();
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
        'ACL','BIND','CHECKOUT','CONNECT','COPY','DELETE','GET','HEAD','LINK','LOCK','M-SEARCH','MERGE','MKACTIVITY','MKCALENDAR','MKCOL','MOVE','NOTIFY','OPTIONS','PATCH','POST','PROPFIND','PROPPATCH','PURGE','QUERY','PUT','REBIND','REPORT','SEARCH','SOURCE','SUBSCRIBE','TRACE','UNBIND','UNLINK','UNLOCK','UNSUBSCRIBE',
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
