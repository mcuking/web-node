import type { BuiltinSpec, BuiltinInitContext } from './types';
import { notImplemented } from '../errors';
import { unsupported } from './unsupported';

/**
 * `tls` builtin — the shape of Node's `tls` module without a TLS engine.
 *
 * A browser tab cannot speak raw TLS, so nothing here performs a handshake.
 * What we DO provide, faithfully:
 *   - the class hierarchy (`SecureContext`, `Server extends net.Server`,
 *     `TLSSocket extends net.Socket`) so `instanceof` and feature detection
 *     match Node;
 *   - `Server`'s TLS-config surface (`addContext`/`setSecureContext`/
 *     `get|setTicketKeys`/`_get|_setServerData`), which records material and
 *     keeps a real 48-byte ticket-key store (self-consistent, like `https.Server`);
 *   - `convertALPNProtocols`, which is pure wire-format encoding.
 * Everything that would need an actual handshake (cipher lists, peer
 * certificates, keying material, sessions) throws a loud `NotImplementedError`
 * rather than inventing a value. Unlisted properties keep the module's usual
 * "using an unsupported API throws" behaviour via the shared proxy.
 */
export const tlsSpec: BuiltinSpec = {
  id: 'tls',
  aliases: ['node:tls'],
  origin: 'web-node',
  deps: ['net', 'stream', 'crypto'],
  arity: {
    SecureContext: 4,
    Server: 2,
    TLSSocket: 2,
    checkServerIdentity: 2,
    convertALPNProtocols: 2,
    createSecureContext: 1,
    createServer: 2,
    setDefaultCACertificates: 1,
    connect: 0,
    getCACertificates: 0,
    getCertificateCompressionAlgorithms: 0,
    getCiphers: 0,
  },
  init: (ctx: BuiltinInitContext) => {
    const net = ctx.require('net') as { Server: unknown; Socket: unknown };
    const NetServer = net.Server as new (listener?: unknown) => Record<string, unknown>;
    const NetSocket = net.Socket as new () => Record<string, unknown>;
    const crypto = ctx.require('crypto') as { randomBytes(size: number): Uint8Array };
    const BufferCtor = (ctx.require('buffer') as {
      Buffer: {
        from(input: string | Uint8Array | ArrayBuffer): Uint8Array & { write(s: string, o: number): number };
        byteLength(s: string): number;
        allocUnsafe(n: number): Uint8Array & { write(s: string, o: number): number };
      };
    }).Buffer;

    const tlsUnavailable = (member: string): never => {
      throw notImplemented(
        'api',
        `tls.${member}`,
        'The virtual network terminates TLS at the HTTP layer; there is no TLS engine.',
      );
    };

    /** `tls.SecureContext` — holds TLS credentials; impossible without an engine. */
    class SecureContext {
      constructor(..._args: unknown[]) {
        tlsUnavailable('SecureContext');
      }
    }

    /** `tls.TLSSocket` — a `net.Socket` wrapped in TLS. */
    class TLSSocket extends NetSocket {
      constructor(_socket?: unknown, _options?: unknown) {
        super();
        tlsUnavailable('TLSSocket');
      }

      // --- Node's TLS-specific prototype members (all loud: no engine) ------
      _destroySSL(): never {
        return tlsUnavailable('TLSSocket#_destroySSL');
      }
      _emitTLSError(): never {
        return tlsUnavailable('TLSSocket#_emitTLSError');
      }
      _finishInit(): never {
        return tlsUnavailable('TLSSocket#_finishInit');
      }
      _handleTimeout(): never {
        return tlsUnavailable('TLSSocket#_handleTimeout');
      }
      _init(..._args: unknown[]): never {
        return tlsUnavailable('TLSSocket#_init');
      }
      _releaseControl(): never {
        return tlsUnavailable('TLSSocket#_releaseControl');
      }
      _start(): never {
        return tlsUnavailable('TLSSocket#_start');
      }
      _tlsError(): never {
        return tlsUnavailable('TLSSocket#_tlsError');
      }
      _wrapHandle(..._args: unknown[]): never {
        return tlsUnavailable('TLSSocket#_wrapHandle');
      }

      /** Nothing to renegotiate without a session. */
      disableRenegotiation(): void {}
      /** Tracing needs a TLS engine to emit into. */
      enableTrace(): void {}

      exportKeyingMaterial(..._args: unknown[]): never {
        return tlsUnavailable('TLSSocket#exportKeyingMaterial');
      }
      getCertificate(): never {
        return tlsUnavailable('TLSSocket#getCertificate');
      }
      getCipher(): never {
        return tlsUnavailable('TLSSocket#getCipher');
      }
      getEphemeralKeyInfo(): never {
        return tlsUnavailable('TLSSocket#getEphemeralKeyInfo');
      }
      getFinished(): never {
        return tlsUnavailable('TLSSocket#getFinished');
      }
      getPeerCertificate(..._args: unknown[]): never {
        return tlsUnavailable('TLSSocket#getPeerCertificate');
      }
      getPeerFinished(): never {
        return tlsUnavailable('TLSSocket#getPeerFinished');
      }
      getPeerX509Certificate(): never {
        return tlsUnavailable('TLSSocket#getPeerX509Certificate');
      }
      getProtocol(): never {
        return tlsUnavailable('TLSSocket#getProtocol');
      }
      getSession(): never {
        return tlsUnavailable('TLSSocket#getSession');
      }
      getSharedSigalgs(): never {
        return tlsUnavailable('TLSSocket#getSharedSigalgs');
      }
      getTLSTicket(): never {
        return tlsUnavailable('TLSSocket#getTLSTicket');
      }
      getX509Certificate(): never {
        return tlsUnavailable('TLSSocket#getX509Certificate');
      }

      /** No session ever exists here, so it is never reused. */
      isSessionReused(): boolean {
        return false;
      }

      renegotiate(..._args: unknown[]): never {
        return tlsUnavailable('TLSSocket#renegotiate');
      }
      setKeyCert(..._args: unknown[]): never {
        return tlsUnavailable('TLSSocket#setKeyCert');
      }
      setMaxSendFragment(..._args: unknown[]): never {
        return tlsUnavailable('TLSSocket#setMaxSendFragment');
      }
      setServername(..._args: unknown[]): never {
        return tlsUnavailable('TLSSocket#setServername');
      }
      setSession(..._args: unknown[]): never {
        return tlsUnavailable('TLSSocket#setSession');
      }
    }

    /** `tls.Server` — a `net.Server` with the TLS-config surface. */
    class Server extends NetServer {
      key?: unknown;
      cert?: unknown;
      ca?: unknown;
      pfx?: unknown;

      #serverData: unknown = null;
      #contexts = new Map<string, Record<string, unknown>>();
      #ticketKeys: Uint8Array;

      constructor(options?: unknown, listener?: (socket: unknown) => void) {
        super(typeof options === 'function' ? options : listener);
        this.#ticketKeys = crypto.randomBytes(48);
        if (options !== null && typeof options === 'object') {
          this.setSecureContext(options as Record<string, unknown>);
        }
      }

      setSecureContext(options: unknown): void {
        if (options === null || typeof options !== 'object') {
          throw new TypeError('The "options" argument must be of type object');
        }
        const opts = options as Record<string, unknown>;
        this.pfx = opts.pfx;
        this.key = opts.key;
        this.cert = opts.cert;
        this.ca = opts.ca;
      }
      addContext(servername: string, context: Record<string, unknown>): void {
        if (!servername) {
          throw Object.assign(new Error('Missing servername in addContext'), {
            code: 'ERR_TLS_REQUIRED_SERVER_NAME',
          });
        }
        this.#contexts.set(servername, context);
      }
      getTicketKeys(): Uint8Array {
        return this.#ticketKeys;
      }
      setTicketKeys(keys: Uint8Array): void {
        if (!(keys instanceof Uint8Array)) {
          throw new TypeError('The "keys" argument must be an instance of Buffer');
        }
        if (keys.byteLength !== 48) {
          throw Object.assign(new Error('Session ticket keys must be a 48-byte buffer'), {
            code: 'ERR_INVALID_ARG_VALUE',
          });
        }
        this.#ticketKeys = keys;
      }
      _getServerData(): { ticketKeys: string } {
        return { ticketKeys: hex(this.#ticketKeys) };
      }
      _setServerData(data: { ticketKeys: string }): void {
        this.setTicketKeys(fromHex(data.ticketKeys));
      }
    }

    function hex(bytes: Uint8Array): string {
      let out = '';
      for (const b of bytes) out += b.toString(16).padStart(2, '0');
      return out;
    }
    function fromHex(text: string): Uint8Array {
      const out = new Uint8Array(text.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
      return out;
    }

    /** Node's `convertProtocols`: length-prefixed ALPN wire format. */
    function convertProtocols(protocols: string[]): Uint8Array {
      const lens: number[] = new Array(protocols.length);
      let total = 0;
      for (let i = 0; i < protocols.length; i++) {
        const protocol = protocols[i];
        if (typeof protocol !== 'string') {
          throw new TypeError('The "protocols" argument must be of type string');
        }
        const len = BufferCtor.byteLength(protocol);
        if (len === 0) {
          throw Object.assign(new RangeError(`The argument 'protocols[${i}]' must be a non-empty string`), {
            code: 'ERR_INVALID_ARG_VALUE',
          });
        }
        if (len > 255) {
          throw Object.assign(
            new RangeError(
              `The byte length of the protocol at index ${i} exceeds the maximum length. It must be <= 255.`,
            ),
            { code: 'ERR_OUT_OF_RANGE' },
          );
        }
        lens[i] = len;
        total += 1 + len;
      }
      const buff = BufferCtor.allocUnsafe(total);
      let offset = 0;
      for (let i = 0; i < protocols.length; i++) {
        buff[offset++] = lens[i];
        buff.write(protocols[i], offset);
        offset += lens[i];
      }
      return buff;
    }

    /** Reject malformed length-prefixed ALPN buffers. */
    function validateALPNBuffer(buffer: Uint8Array): void {
      let offset = 0;
      while (offset < buffer.length) {
        const len = buffer[offset];
        if (len === 0) {
          throw Object.assign(new RangeError("The argument 'ALPNProtocols' must not contain zero-length protocol"), {
            code: 'ERR_INVALID_ARG_VALUE',
          });
        }
        if (offset + 1 + len > buffer.length) {
          throw Object.assign(new RangeError("The argument 'ALPNProtocols' contains truncated protocol"), {
            code: 'ERR_INVALID_ARG_VALUE',
          });
        }
        offset += 1 + len;
      }
    }

    /** `tls.convertALPNProtocols(protocols, out)` — pure encoder. */
    function convertALPNProtocols(protocols: unknown, out: Record<string, unknown>): undefined {
      if (Array.isArray(protocols)) {
        out.ALPNProtocols = convertProtocols(protocols as string[]);
      } else if (protocols instanceof Uint8Array) {
        const buf = BufferCtor.from(protocols);
        validateALPNBuffer(buf);
        out.ALPNProtocols = buf;
      } else if (ArrayBuffer.isView(protocols)) {
        const view = protocols as ArrayBufferView;
        const slice = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
        const buf = BufferCtor.from(slice as ArrayBuffer);
        validateALPNBuffer(buf);
        out.ALPNProtocols = buf;
      }
      return undefined;
    }

    function checkServerIdentity(): never {
      return tlsUnavailable('checkServerIdentity');
    }
    function createSecureContext(): never {
      return tlsUnavailable('createSecureContext');
    }
    function connect(): never {
      return tlsUnavailable('connect');
    }
    function getCACertificates(): never {
      return tlsUnavailable('getCACertificates');
    }
    function getCiphers(): never {
      return tlsUnavailable('getCiphers');
    }
    function getCertificateCompressionAlgorithms(): never {
      return tlsUnavailable('getCertificateCompressionAlgorithms');
    }
    function setDefaultCACertificates(): never {
      return tlsUnavailable('setDefaultCACertificates');
    }

    function createServer(options?: unknown, listener?: (socket: unknown) => void): Server {
      return new Server(options, listener);
    }

    return unsupported('tls', {
      SecureContext,
      Server,
      TLSSocket,
      convertALPNProtocols,
      createSecureContext,
      createServer,
      connect,
      checkServerIdentity,
      getCACertificates,
      getCiphers,
      getCertificateCompressionAlgorithms,
      setDefaultCACertificates,
    });
  },
};
