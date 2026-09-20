/**
 * `string_decoder` binding — a JS port of `src/string_decoder.cc`.
 *
 * The real `lib/string_decoder.js` is pure JS on top of this binding: it keeps
 * a little native "decoder state" buffer (`Buffer.alloc(kSize)`), stores the
 * numeric encoding in it, and calls `decode()` / `flush()`. The C++ side is a
 * small state machine that splits a byte stream into strings without cutting a
 * multi-byte character in half. We reproduce it byte for byte in JS:
 *
 *   state[0..4)  incomplete character buffer
 *   state[4]     kMissingBytes
 *   state[5]     kBufferedBytes
 *   state[6]     kEncodingField
 *
 * The layout (offsets, encoding codes) mirrors `src/string_decoder.h` and the
 * `encodings` array order registered in `InitializeStringDecoder`.
 */

/** Numeric encoding codes, in the exact order `InitializeStringDecoder` uses. */
const ASCII = 0;
const UTF8 = 1;
const BASE64 = 2;
const BASE64URL = 3;
const UCS2 = 4;
const HEX = 5;
const BUFFER = 6;
const LATIN1 = 7;

/** Field offsets (`enum Fields` in `src/string_decoder.h`). */
const kIncompleteCharactersStart = 0;
const kIncompleteCharactersEnd = 4;
const kMissingBytes = 4;
const kBufferedBytes = 5;
const kEncodingField = 6;
const kNumFields = 7;

/** `sizeof(StringDecoder)` — the state buffer the JS side allocates. */
const kSize = kNumFields;

const ENCODINGS = ['ascii', 'utf8', 'base64', 'base64url', 'utf16le', 'hex', 'buffer', 'latin1'];

const utf8Decoder = new TextDecoder('utf-8');

/**
 * `StringBytes::Encode(isolate, data, length, encoding)` — bytes to JS string.
 * Only the encodings that reach this decoder appear here.
 */
function makeString(bytes: Uint8Array, encoding: number): string {
  switch (encoding) {
    case ASCII: {
      // Non-ASCII bytes are forced into the ASCII range (`nbytes::ForceAscii`).
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 0x7f);
      return s;
    }
    case UTF8:
      return utf8Decoder.decode(bytes);
    case LATIN1: {
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return s;
    }
    case UCS2: {
      // Little-endian UTF-16; a trailing odd byte is dropped.
      const n = bytes.length >> 1;
      let s = '';
      for (let i = 0, k = 0; k < n; i += 2, k++) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
      return s;
    }
    case BASE64: {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
    case BASE64URL: {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      // `simdutf::base64_url` is unpadded (Node's base64url strips `=`).
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    case HEX: {
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
      return s;
    }
    case BUFFER:
      throw new Error('string_decoder: BUFFER encoding is not decodable to a string');
    default:
      throw new Error(`string_decoder: unknown encoding ${encoding}`);
  }
}

function asUint8Array(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** `StringDecoder::DecodeData` — returns the decoded string for one chunk. */
function decode(state: Uint8Array, buf: ArrayBufferView): string {
  const encoding = state[kEncodingField];
  const incomplete = state.subarray(kIncompleteCharactersStart, kIncompleteCharactersEnd);
  let data = asUint8Array(buf);
  let nread = data.length;
  let prepend: string | null = null;
  let body: string;

  if (encoding === UTF8 || encoding === UCS2 || encoding === BASE64 || encoding === BASE64URL) {
    if (state[kMissingBytes] > 0) {
      if (encoding === UTF8) {
        // Bytes we are waiting for must be continuation bytes (10xxxxxx). If one
        // isn't, the incomplete character ends here and the new byte starts a
        // fresh one; the bytes seen so far are still kept.
        for (let i = 0; i < nread && i < state[kMissingBytes]; ++i) {
          if ((data[i] & 0xc0) !== 0x80) {
            state[kMissingBytes] = 0;
            incomplete.set(data.subarray(0, i), state[kBufferedBytes]);
            state[kBufferedBytes] += i;
            data = data.subarray(i);
            nread -= i;
            break;
          }
        }
      }

      const found = Math.min(nread, state[kMissingBytes]);
      incomplete.set(data.subarray(0, found), state[kBufferedBytes]);
      data = data.subarray(found);
      nread -= found;
      state[kMissingBytes] -= found;
      state[kBufferedBytes] += found;

      if (state[kMissingBytes] === 0) {
        prepend = makeString(incomplete.subarray(0, state[kBufferedBytes]), encoding);
        state[kBufferedBytes] = 0;
      }
    }

    if (nread === 0) {
      body = prepend !== null ? prepend : '';
      prepend = null;
    } else {
      if (encoding === UTF8 && (data[nread - 1] & 0x80)) {
        // Ended on a non-ASCII byte: walk back to the lead byte to work out how
        // many bytes are still missing.
        for (let i = nread - 1; ; --i) {
          state[kBufferedBytes]++;
          if ((data[i] & 0xc0) === 0x80) {
            if (state[kBufferedBytes] >= 4 || i === 0) {
              // Either impossible for a Unicode char, or the lead byte isn't in
              // this chunk. Hand the whole thing to the engine decoder.
              state[kBufferedBytes] = 0;
              break;
            }
          } else {
            if ((data[i] & 0xe0) === 0xc0) state[kMissingBytes] = 2;
            else if ((data[i] & 0xf0) === 0xe0) state[kMissingBytes] = 3;
            else if ((data[i] & 0xf8) === 0xf0) state[kMissingBytes] = 4;
            else {
              // Lead byte outside the representable range.
              state[kBufferedBytes] = 0;
              break;
            }

            if (state[kBufferedBytes] >= state[kMissingBytes]) {
              // We have as many or more trailing bytes than needed.
              state[kMissingBytes] = 0;
              state[kBufferedBytes] = 0;
            }
            state[kMissingBytes] -= state[kBufferedBytes];
            break;
          }
        }
      } else if (encoding === UCS2) {
        if ((nread % 2) === 1) {
          state[kBufferedBytes] = 1;
          state[kMissingBytes] = 1;
        } else if ((data[nread - 1] & 0xfc) === 0xd8) {
          // Half of a split UTF-16 surrogate pair.
          state[kBufferedBytes] = 2;
          state[kMissingBytes] = 2;
        }
      } else if (encoding === BASE64 || encoding === BASE64URL) {
        state[kBufferedBytes] = nread % 3;
        if (state[kBufferedBytes] > 0) state[kMissingBytes] = 3 - state[kBufferedBytes];
      }

      if (state[kBufferedBytes] > 0) {
        nread -= state[kBufferedBytes];
        incomplete.set(data.subarray(nread, nread + state[kBufferedBytes]), 0);
      }

      body = nread > 0 ? makeString(data.subarray(0, nread), encoding) : '';
    }

    return prepend === null ? body : prepend + body;
  }

  // ASCII / HEX / LATIN1 have no multi-byte characters to split.
  return makeString(data.subarray(0, nread), encoding);
}

/** `StringDecoder::FlushData` — decode any bytes still held back. */
function flush(state: Uint8Array): string {
  const encoding = state[kEncodingField];
  const incomplete = state.subarray(kIncompleteCharactersStart, kIncompleteCharactersEnd);

  if (encoding === UCS2 && state[kBufferedBytes] % 2 === 1) {
    // A single trailing byte is ignored, like the JS decoder does.
    state[kMissingBytes]--;
    state[kBufferedBytes]--;
  }

  if (state[kBufferedBytes] === 0) return '';

  const ret = makeString(incomplete.subarray(0, state[kBufferedBytes]), encoding);
  state[kMissingBytes] = 0;
  state[kBufferedBytes] = 0;
  return ret;
}

export const stringDecoderBinding = () => ({
  encodings: ENCODINGS,
  kIncompleteCharactersStart,
  kIncompleteCharactersEnd,
  kMissingBytes,
  kBufferedBytes,
  kEncodingField,
  kNumFields,
  kSize,
  decode,
  flush,
});
