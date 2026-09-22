/**
 * The legacy `crypto.Certificate` class — SPKAC (Netscape SPKI) support.
 *
 * `crypto.Certificate` is deprecated but still widely deployed for the
 * `verifySpkac` / `exportPublicKey` / `exportChallenge` trio, so the runtime
 * implements it against the same wire format OpenSSL uses rather than stubbing
 * it out.
 *
 * A SPKAC is a base64-encoded `NETSCAPE_SPKI`:
 *
 *   NETSCAPE_SPKI ::= SEQUENCE {
 *     spkac      NETSCAPE_SPKAC,   -- SEQUENCE { pubkey SubjectPublicKeyInfo, challenge IA5String }
 *     sig_algor  AlgorithmIdentifier,
 *     signature  BIT STRING
 *   }
 *
 * `verifySpkac` checks `signature` over the DER of the inner `spkac` using the
 * embedded public key; `exportPublicKey` PEM-encodes that key; `exportChallenge`
 * returns the challenge string. Everything mirrors `crypto/x509/x509spki.c`,
 * `crypto/asn1/x_spki.c` and `ncrypto::VerifySpkac` (the base64 step is
 * OpenSSL's `EVP_DecodeBlock`, which is lenient in a specific way — see below).
 */
import { createPublicKey, verify, type KeyObject } from './asym';
import { TAG, derEncode, derOidHex, derParse, pemEncode } from './der';

/**
 * OpenSSL's `data_ascii2bin` table (crypto/evp/encode.c), verbatim. Values are
 * the decoded 6-bit groups; 0xE0 marks leading/inner whitespace, 0xF0/0xF1/0xF2
 * mark line endings and the EOF sentinel, and 0xFF marks an invalid character.
 */
const ASCII2BIN = new Uint8Array([
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe0, 0xf0, 0xff, 0xff, 0xf1, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xe0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x3e, 0xff, 0xf2, 0xff, 0x3f,
  0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0xff, 0xff, 0xff, 0x00, 0xff, 0xff,
  0xff, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
  0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xff, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x32, 0x33, 0xff, 0xff, 0xff, 0xff, 0xff,
]);

const B64_WS = 0xe0;
const B64_ERROR = 0xff;

function convAscii2Bin(byte: number): number {
  if (byte & 0x80) return B64_ERROR;
  return ASCII2BIN[byte];
}

/** `((v | 0x13) == 0xF3)` — OpenSSL's B64_NOT_BASE64 macro. */
function notBase64(value: number): boolean {
  return (value | 0x13) === 0xf3;
}

/**
 * OpenSSL's `EVP_DecodeBlock`: trim leading whitespace, strip trailing
 * whitespace/line-ending sentinels (but only while more than three bytes
 * remain), require a multiple of four, then decode. It does *not* skip
 * whitespace in the middle of the payload, which is why line-wrapped base64
 * fails to decode. It also never subtracts base64 padding from the final group
 * (the `c == '='` test compares decoded values against the raw character), so
 * the last group always yields three bytes; callers ignore the trailing slack.
 */
export function evpDecodeBase64(bytes: Uint8Array): Uint8Array | null {
  let start = 0;
  let end = bytes.length;
  while (start < end && convAscii2Bin(bytes[start]) === B64_WS) start++;
  while (end - start > 3 && notBase64(convAscii2Bin(bytes[end - 1]))) end--;
  const n = end - start;
  if (n % 4 !== 0) return null;
  if (n === 0) return new Uint8Array(0);

  const out = new Uint8Array((n / 4) * 3);
  let o = 0;
  for (let i = 0; i < n; i += 4) {
    const a = convAscii2Bin(bytes[start + i]);
    const b = convAscii2Bin(bytes[start + i + 1]);
    const c = convAscii2Bin(bytes[start + i + 2]);
    const d = convAscii2Bin(bytes[start + i + 3]);
    if ((a | b | c | d) & 0x80) return null;
    const l = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (l >> 16) & 0xff;
    out[o++] = (l >> 8) & 0xff;
    out[o++] = l & 0xff;
  }
  return out;
}

interface Spkac {
  /** Raw DER of the signed `NETSCAPE_SPKAC`. */
  spkacDer: Uint8Array;
  /** Raw DER of the embedded `SubjectPublicKeyInfo`. */
  publicKeyDer: Uint8Array;
  /** The challenge (IA5String contents). */
  challenge: Uint8Array;
  /** The signature algorithm OID as DER content hex. */
  sigAlgOidHex: string;
  /** The signature bytes (BIT STRING contents without the unused-bits octet). */
  signature: Uint8Array;
}

/** Decode and structurally parse a base64 SPKAC; `null` on any failure. */
function parseSpkac(bytes: Uint8Array): Spkac | null {
  const der = evpDecodeBase64(bytes);
  if (der === null) return null;
  let root;
  try {
    root = derParse(der);
  } catch {
    return null;
  }
  if (root.tag !== TAG.SEQUENCE || !root.children) return null;
  const top = root.children;
  if (top.length !== 3) return null;
  const [spkacNode, sigAlgorNode, sigNode] = top;
  if (spkacNode.tag !== TAG.SEQUENCE || !spkacNode.children) return null;
  if (sigAlgorNode.tag !== TAG.SEQUENCE || !sigAlgorNode.children) return null;
  if (sigNode.tag !== TAG.BIT_STRING) return null;
  const inner = spkacNode.children;
  if (inner.length !== 2) return null;
  const [pubkeyNode, challengeNode] = inner;
  if (pubkeyNode.tag !== TAG.SEQUENCE) return null;
  if (challengeNode.tag !== 0x16) return null; // IA5String
  const sigAlgChildren = sigAlgorNode.children;
  if (sigAlgChildren.length < 1 || sigAlgChildren[0].tag !== TAG.OID) return null;
  if (sigNode.content.length < 1) return null;

  return {
    // Re-encode the signed item the way ASN1_item_verify does before hashing.
    spkacDer: derEncode(spkacNode.tag, spkacNode.content),
    publicKeyDer: derEncode(pubkeyNode.tag, pubkeyNode.content),
    challenge: challengeNode.content,
    sigAlgOidHex: derOidHex(sigAlgChildren[0]),
    signature: sigNode.content.subarray(1),
  };
}

const SIG_OID_TO_HASH: Record<string, string> = {
  '2a864886f70d010104': 'md5', // md5WithRSAEncryption
  '2a864886f70d010105': 'sha1', // sha1WithRSAEncryption
  '2a864886f70d01010b': 'sha256', // sha256WithRSAEncryption
  '2a864886f70d01010c': 'sha384', // sha384WithRSAEncryption
  '2a864886f70d01010d': 'sha512', // sha512WithRSAEncryption
  '2a864886f70d01010e': 'sha224', // sha224WithRSAEncryption
  '2a8648ce3d0401': 'sha1', // ecdsa-with-SHA1
  '2a8648ce3d040301': 'sha224', // ecdsa-with-SHA224
  '2a8648ce3d040302': 'sha256', // ecdsa-with-SHA256
  '2a8648ce3d040303': 'sha384', // ecdsa-with-SHA384
  '2a8648ce3d040304': 'sha512', // ecdsa-with-SHA512
};

const DIGEST_OID_TO_HASH: Record<string, string> = {
  '2a864886f70d0205': 'md5', // md5
  '2b0e03021a': 'sha1', // sha1
  '608648016503040204': 'sha224', // sha224
  '608648016503040201': 'sha256', // sha256
  '608648016503040202': 'sha384', // sha384
  '608648016503040203': 'sha512', // sha512
};

const OID_RSA_ENCRYPTION = '2a864886f70d010101';

/**
 * For the raw `rsaEncryption` signature algorithm OpenSSL reads the digest OID
 * out of the PKCS#1 v1.5 DigestInfo wrapper; recover it so the generic `verify`
 * helper can be used.
 */
function digestFromDigestInfo(signature: Uint8Array): string | null {
  let root;
  try {
    root = derParse(signature);
  } catch {
    return null;
  }
  if (root.tag !== TAG.SEQUENCE || !root.children || root.children.length !== 2) return null;
  const [alg, digest] = root.children;
  if (alg.tag !== TAG.SEQUENCE || !alg.children || alg.children.length < 1) return null;
  if (alg.children[0].tag !== TAG.OID) return null;
  if (digest.tag !== TAG.OCTET_STRING) return null;
  return DIGEST_OID_TO_HASH[derOidHex(alg.children[0])] ?? null;
}

/** Resolve a signature algorithm OID to a hash name, or `null` if unsupported. */
function resolveHash(sigAlgOidHex: string, signature: Uint8Array): string | null {
  if (sigAlgOidHex === OID_RSA_ENCRYPTION) return digestFromDigestInfo(signature);
  return SIG_OID_TO_HASH[sigAlgOidHex] ?? null;
}

/** `verifySpkac` on already-coerced, non-empty input. */
export function verifySpkacBytes(bytes: Uint8Array): boolean {
  const spkac = parseSpkac(bytes);
  if (spkac === null) return false;
  const hash = resolveHash(spkac.sigAlgOidHex, spkac.signature);
  if (hash === null) return false;
  let key: KeyObject;
  try {
    key = createPublicKey(spkac.publicKeyDer);
  } catch {
    return false;
  }
  try {
    return verify(hash, spkac.spkacDer, key, spkac.signature);
  } catch {
    return false;
  }
}

/** `exportPublicKey` on already-coerced, non-empty input; `null` on failure. */
export function exportPublicKeyBytes(bytes: Uint8Array): Uint8Array | null {
  const spkac = parseSpkac(bytes);
  if (spkac === null) return null;
  let der: Uint8Array;
  try {
    // Re-export from the parsed key, mirroring PEM_write_bio_PUBKEY.
    der = createPublicKey(spkac.publicKeyDer).export({ type: 'spki', format: 'der' }) as Uint8Array;
  } catch {
    return null;
  }
  return new TextEncoder().encode(pemEncode('PUBLIC KEY', der));
}

/** `exportChallenge` on already-coerced, non-empty input; `null` on failure. */
export function exportChallengeBytes(bytes: Uint8Array): Uint8Array | null {
  const spkac = parseSpkac(bytes);
  if (spkac === null) return null;
  return spkac.challenge;
}

export type { Spkac };
