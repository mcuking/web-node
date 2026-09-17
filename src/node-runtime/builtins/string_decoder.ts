import type { BuiltinSpec } from './types';

/** `string_decoder` builtin. */
export const stringDecoderSpec: BuiltinSpec = {
  id: 'string_decoder',
  aliases: ['node:string_decoder'],
  origin: 'web-node',
  deps: ['buffer'],
  init: () => {
    class StringDecoder {
      #encoding: string;
      #buffer: number[] = [];
      lastNeed = 0;
      lastTotal = 0;
      lastChar: Uint8Array = new Uint8Array(0);

      constructor(encoding = 'utf8') {
        this.#encoding = encoding.toLowerCase();
      }

      get encoding(): string {
        return this.#encoding;
      }

      write(buffer: Uint8Array): string {
        const bytes = new Uint8Array([...this.#buffer, ...buffer]);
        this.#buffer = [];
        switch (this.#encoding) {
          case 'utf8':
          case 'utf-8':
            return this.#decodeUtf8(bytes);
          case 'utf16le':
          case 'utf-16le':
          case 'ucs2':
          case 'ucs-2':
            return this.#decodeUtf16(bytes);
          case 'latin1':
          case 'binary':
          case 'ascii':
            return this.#decodeLatin1(bytes);
          case 'base64':
            return this.#decodeBase64(bytes, false);
          case 'base64url':
            return this.#decodeBase64(bytes, true);
          case 'hex':
            return this.#decodeHex(bytes);
          default:
            throw new TypeError(`Unknown encoding: ${this.#encoding}`);
        }
      }

      #decodeUtf8(bytes: Uint8Array): string {
        const decoder = new TextDecoder('utf-8', { fatal: false });
        const out = decoder.decode(bytes, { stream: true });
        return out;
      }

      #decodeUtf16(bytes: Uint8Array): string {
        const remainder = bytes.length % 2;
        if (remainder) {
          this.#buffer = [bytes[bytes.length - 1]];
        }
        let s = '';
        const end = bytes.length - remainder;
        for (let i = 0; i < end; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
        return s;
      }

      #decodeLatin1(bytes: Uint8Array): string {
        let s = '';
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return s;
      }

      #decodeBase64(bytes: Uint8Array, url: boolean): string {
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const b64 = btoa(bin);
        return url ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
      }

      #decodeHex(bytes: Uint8Array): string {
        let s = '';
        for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
        return s;
      }

      end(buffer?: Uint8Array): string {
        if (buffer) return this.write(buffer);
        const b = this.#buffer;
        this.#buffer = [];
        return this.write(new Uint8Array(b));
      }
    }

    return { StringDecoder, default: { StringDecoder } };
  },
};
