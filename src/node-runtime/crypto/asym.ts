/**
 * Asymmetric keys and signatures, in pure JS.
 *
 * WebCrypto can import/export/generate keys and sign, but only asynchronously;
 * Node's `createPrivateKey`, `crypto.sign`, `generateKeyPairSync` and friends are
 * synchronous, so the ASN.1 codec (`der.ts`) and the curve maths (`ec.ts`) do the
 * work here and the async variants just wrap it.
 *
 * Covers the formats Node emits/accepts for RSA, EC (P-256/P-384/P-521) and
 * Ed25519: PKCS#1, PKCS#8, SPKI and SEC1, PEM and DER. Signatures cover
 * RSA (PKCS#1 v1.5 and PSS), ECDSA (DER and IEEE P1363) and Ed25519.
 */
import { outputBytes } from './byte-out';
import {
  bigIntToBytes,
  bytesToBigInt,
  concatBytes as concat,
  derBitString,
  derEncode,
  derInt,
  derIntValue,
  derNull,
  derOctet,
  derOid,
  derOidHex,
  derParse,
  derSeq,
  expectSeq,
  fromHex,
  pemDecode,
  pemEncode,
  toHex,
  type DerNode,
} from './der';
import {
  coordToBytes,
  curveByNodeName,
  curveByOidHex,
  decodePoint,
  ed25519PublicFromSeed,
  ed25519Sign,
  ed25519Verify,
  ecdsaSign,
  ecdsaVerify,
  encodePoint,
  generator,
  mod,
  modInverse,
  modPow,
  pointMul,
  type Curve,
  type Point,
} from './ec';
import { resolveHash } from './hash';
import {
  modpGroup,
  modpGroupPrivateBits,
  modpGroupPrivateBitsForParams,
} from './modp';

// --- OIDs -------------------------------------------------------------------

const OID_RSA = '2a864886f70d010101';
const OID_EC = '2a8648ce3d0201';
const OID_ED25519 = '2b6570';
/** `dhKeyAgreement` (1.2.840.113549.1.3.1), the OID OpenSSL tags DH with. */
const OID_DH = '2a864886f70d010301';

// --- random -----------------------------------------------------------------

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function randomBelow(limit: bigint): bigint {
  const bytes = Math.ceil(limit.toString(2).length / 8) + 8;
  for (;;) {
    const candidate = bytesToBigInt(randomBytes(bytes));
    const value = candidate % limit;
    if (value !== 0n) return value;
  }
}

/** Uniform random integer in `[0, 2^bits)`. */
function randomBitsBelowPow2(bits: number): bigint {
  if (bits <= 0) return 0n;
  const bytes = (bits + 7) >> 3;
  const buf = randomBytes(bytes);
  const excess = bytes * 8 - bits;
  if (excess > 0) buf[0] &= 0xff >>> excess;
  return bytesToBigInt(buf);
}

/** Number of significant bits in a positive bigint (`BN_num_bits`). */
function bitLength(value: bigint): number {
  return value.toString(2).length;
}

// --- key material -----------------------------------------------------------

export type KeyType = 'private' | 'public' | 'secret';
export type AsymType = 'rsa' | 'ec' | 'ed25519' | 'dh';

export interface RsaMaterial {
  n: bigint;
  e: bigint;
  d?: bigint;
  p?: bigint;
  q?: bigint;
  dp?: bigint;
  dq?: bigint;
  qinv?: bigint;
}

export interface EcMaterial {
  curve: Curve;
  x: bigint;
  y: bigint;
  d?: bigint;
}

export interface EdMaterial {
  /** 32-byte seed; only present on private keys. */
  seed?: Uint8Array;
  /** 32-byte public point. */
  publicKey: Uint8Array;
}

export interface DhMaterial {
  prime: bigint;
  generator: bigint;
  /** Public value `y = g^x mod p`; present on both halves. */
  publicKey?: bigint;
  /** Private exponent `x`; only present on private keys. */
  privateKey?: bigint;
}

export interface KeyMaterial {
  type: KeyType;
  asym?: AsymType;
  rsa?: RsaMaterial;
  ec?: EcMaterial;
  ed?: EdMaterial;
  dh?: DhMaterial;
  /** Raw bytes for `type: 'secret'`. */
  secret?: Uint8Array;
}

export function rsaModulusLength(m: RsaMaterial): number {
  return m.n.toString(2).length;
}

export function modulusByteLength(m: RsaMaterial): number {
  return Math.ceil(rsaModulusLength(m) / 8);
}

// --- DER parsing of keys ----------------------------------------------------

function intOf(node: DerNode): bigint {
  return derInt(node);
}

function parseRsaPrivate(der: Uint8Array): RsaMaterial {
  const seq = expectSeq(derParse(der));
  if (seq.length < 9 || seq[1].tag !== 0x02) throw new Error('rsa: bad PKCS#1 private key');
  return {
    n: intOf(seq[1]),
    e: intOf(seq[2]),
    d: intOf(seq[3]),
    p: intOf(seq[4]),
    q: intOf(seq[5]),
    dp: intOf(seq[6]),
    dq: intOf(seq[7]),
    qinv: intOf(seq[8]),
  };
}

function parseRsaPublic(der: Uint8Array): RsaMaterial {
  const seq = expectSeq(derParse(der));
  return { n: intOf(seq[0]), e: intOf(seq[1]) };
}

function parseEcPrivate(der: Uint8Array, curveHint?: Curve): EcMaterial {
  const seq = expectSeq(derParse(der));
  const privateKey = seq[1].content;
  let curve = curveHint;
  for (const child of seq.slice(2)) {
    if (child.tag === 0xa0) {
      curve = curveByOidHex(derOidHex(derParse(child.content)));
    }
  }
  if (!curve) curve = curveHint;
  if (!curve) throw new Error('ec: missing curve parameters');
  const d = bytesToBigInt(privateKey);
  const point = pointMul(d, generator(curve), curve);
  if (point === null) throw new Error('ec: invalid private scalar');
  return { curve, x: point.x, y: point.y, d };
}

function parseEdPrivate(inner: Uint8Array): EdMaterial {
  // CurvePrivateKey ::= OCTET STRING (the 32-byte seed).
  const node = derParse(inner);
  const seed = node.tag === 0x04 ? node.content : inner;
  if (seed.length !== 32) throw new Error('ed25519: bad private key length');
  // Copy: `seed` may be a Buffer view into the caller's DER, and it is handed
  // to elliptic-curve code that could otherwise alias it.
  const owned = Uint8Array.from(seed);
  return { seed: owned, publicKey: ed25519PublicFromSeed(owned) };
}

function parseDhParams(node: DerNode | undefined): { prime: bigint; generator: bigint } {
  if (!node) throw new Error('dh: missing domain parameters');
  const seq = expectSeq(node);
  return { prime: derInt(seq[0]), generator: derInt(seq[1]) };
}

function parsePrivateKeyInfo(der: Uint8Array): KeyMaterial {
  const seq = expectSeq(derParse(der));
  const algId = expectSeq(seq[1]);
  const oid = derOidHex(algId[0]);
  const inner = seq[2].content;
  if (oid === OID_RSA) return { type: 'private', asym: 'rsa', rsa: parseRsaPrivate(inner) };
  if (oid === OID_EC) {
    const curve = algId.length > 1 ? curveByOidHex(derOidHex(algId[1])) : undefined;
    return { type: 'private', asym: 'ec', ec: parseEcPrivate(inner, curve) };
  }
  if (oid === OID_ED25519) return { type: 'private', asym: 'ed25519', ed: parseEdPrivate(inner) };
  if (oid === OID_DH) {
    const params = parseDhParams(algId[1]);
    return { type: 'private', asym: 'dh', dh: { ...params, privateKey: derInt(derParse(inner)) } };
  }
  throw new Error(`unsupported private key algorithm ${oid}`);
}

function parseSubjectPublicKeyInfo(der: Uint8Array): KeyMaterial {
  const seq = expectSeq(derParse(der));
  const algId = expectSeq(seq[0]);
  const oid = derOidHex(algId[0]);
  const bits = seq[1].content.subarray(1); // strip the unused-bits octet
  if (oid === OID_RSA) return { type: 'public', asym: 'rsa', rsa: parseRsaPublic(bits) };
  if (oid === OID_EC) {
    const curve = curveByOidHex(derOidHex(algId[1]));
    if (!curve) throw new Error('ec: unknown curve');
    const point = decodePoint(bits, curve);
    return { type: 'public', asym: 'ec', ec: { curve, x: point.x, y: point.y } };
  }
  if (oid === OID_ED25519) {
    return { type: 'public', asym: 'ed25519', ed: { publicKey: Uint8Array.from(bits) } };
  }
  if (oid === OID_DH) {
    const params = parseDhParams(algId[1]);
    return { type: 'public', asym: 'dh', dh: { ...params, publicKey: derInt(derParse(bits)) } };
  }
  throw new Error(`unsupported public key algorithm ${oid}`);
}

function parsePrivateDer(der: Uint8Array): KeyMaterial {
  const seq = expectSeq(derParse(der));
  const first = seq[0];
  const second = seq[1];
  if (first.tag !== 0x02) throw new Error('key: not a private key');
  if (second.tag === 0x30) return parsePrivateKeyInfo(der); // PKCS#8
  if (second.tag === 0x04) return { type: 'private', asym: 'ec', ec: parseEcPrivate(der) }; // SEC1
  if (second.tag === 0x02) return { type: 'private', asym: 'rsa', rsa: parseRsaPrivate(der) }; // PKCS#1
  throw new Error('key: unrecognised private key structure');
}

function parsePublicDer(der: Uint8Array): KeyMaterial {
  const seq = expectSeq(derParse(der));
  if (seq[0].tag === 0x30) return parseSubjectPublicKeyInfo(der); // SPKI
  if (seq[0].tag === 0x02) return { type: 'public', asym: 'rsa', rsa: parseRsaPublic(der) }; // PKCS#1
  throw new Error('key: unrecognised public key structure');
}

// --- DER encoding of keys ---------------------------------------------------

function encodeRsaPrivate(m: RsaMaterial): Uint8Array {
  if (!m.d || !m.p || !m.q || !m.dp || !m.dq || !m.qinv) throw new Error('rsa: incomplete private key');
  return derSeq(
    derIntValue(0n),
    derIntValue(m.n),
    derIntValue(m.e),
    derIntValue(m.d),
    derIntValue(m.p),
    derIntValue(m.q),
    derIntValue(m.dp),
    derIntValue(m.dq),
    derIntValue(m.qinv),
  );
}

function encodeRsaPublic(m: RsaMaterial): Uint8Array {
  return derSeq(derIntValue(m.n), derIntValue(m.e));
}

function encodeEcPrivate(m: EcMaterial): Uint8Array {
  if (m.d === undefined) throw new Error('ec: not a private key');
  const publicKey = derBitString(encodePoint({ x: m.x, y: m.y }, m.curve));
  return derSeq(derIntValue(1n), derOctet(coordToBytes(m.d, m.curve)), derEncode(0xa0, derOid(oidDotted(m.curve.oidHex))), derEncode(0xa1, publicKey));
}

/**
 * The SEC1 body OpenSSL embeds inside a PKCS#8 EC key omits the `[0]` curve
 * parameters (they are already in the AlgorithmIdentifier); the `[1]` public
 * point is kept.
 */
function encodeEcPrivateKeyInfoBody(m: EcMaterial): Uint8Array {
  if (m.d === undefined) throw new Error('ec: not a private key');
  const publicKey = derBitString(encodePoint({ x: m.x, y: m.y }, m.curve));
  return derSeq(derIntValue(1n), derOctet(coordToBytes(m.d, m.curve)), derEncode(0xa1, publicKey));
}

function oidDotted(oidHex: string): string {
  // Reverse the dotted-decimal form from the hex encoding.
  const bytes = fromHex(oidHex);
  const parts: number[] = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let value = 0;
  for (let i = 1; i < bytes.length; i++) {
    value = value * 128 + (bytes[i] & 0x7f);
    if ((bytes[i] & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

function encodePrivateKeyInfo(m: KeyMaterial): Uint8Array {
  if (m.asym === 'rsa' && m.rsa) {
    return derSeq(derIntValue(0n), derSeq(derOid('1.2.840.113549.1.1.1'), derNull()), derOctet(encodeRsaPrivate(m.rsa)));
  }
  if (m.asym === 'ec' && m.ec) {
    return derSeq(
      derIntValue(0n),
      derSeq(derOid(oidDotted(OID_EC)), derOid(oidDotted(m.ec.curve.oidHex))),
      derOctet(encodeEcPrivateKeyInfoBody(m.ec)),
    );
  }
  if (m.asym === 'ed25519' && m.ed?.seed) {
    return derSeq(
      derIntValue(0n),
      derSeq(derOid('1.3.101.112')),
      derOctet(derOctet(m.ed.seed)),
    );
  }
  if (m.asym === 'dh' && m.dh && m.dh.privateKey !== undefined) {
    return derSeq(
      derIntValue(0n),
      derSeq(derOid(oidDotted(OID_DH)), derSeq(derIntValue(m.dh.prime), derIntValue(m.dh.generator))),
      derOctet(derIntValue(m.dh.privateKey)),
    );
  }
  throw new Error('key: cannot encode private key');
}

function encodeSubjectPublicKeyInfo(m: KeyMaterial): Uint8Array {
  if (m.asym === 'rsa' && m.rsa) {
    return derSeq(derSeq(derOid('1.2.840.113549.1.1.1'), derNull()), derBitString(encodeRsaPublic(m.rsa)));
  }
  if (m.asym === 'ec' && m.ec) {
    return derSeq(
      derSeq(derOid(oidDotted(OID_EC)), derOid(oidDotted(m.ec.curve.oidHex))),
      derBitString(encodePoint({ x: m.ec.x, y: m.ec.y }, m.ec.curve)),
    );
  }
  if (m.asym === 'ed25519' && m.ed) {
    return derSeq(derSeq(derOid('1.3.101.112')), derBitString(m.ed.publicKey));
  }
  if (m.asym === 'dh' && m.dh && m.dh.publicKey !== undefined) {
    return derSeq(
      derSeq(derOid(oidDotted(OID_DH)), derSeq(derIntValue(m.dh.prime), derIntValue(m.dh.generator))),
      derBitString(derIntValue(m.dh.publicKey)),
    );
  }
  throw new Error('key: cannot encode public key');
}

// --- KeyObject --------------------------------------------------------------

export const KEY_OBJECT_INTERNAL = Symbol('web-node.crypto.KeyObject');

/** Material lives in a WeakMap so it stays out of the public key shape. */
const MATERIALS = new WeakMap<KeyObject, KeyMaterial>();

export class KeyObject {
  constructor(marker: unknown, material?: KeyMaterial) {
    if (marker !== KEY_OBJECT_INTERNAL || material === undefined) {
      throw invalidArgValue('type', marker);
    }
    MATERIALS.set(this, material);
  }

  static from(key: unknown): KeyObject {
    if (key instanceof KeyObject) return key;
    throw invalidArgType('key', 'an instance of CryptoKey', key);
  }

  #mat(): KeyMaterial {
    const material = MATERIALS.get(this);
    if (!material) throw new Error('KeyObject: detached key material');
    return material;
  }

  get type(): KeyType {
    return this.#mat().type;
  }

  get asymmetricKeyType(): AsymType | undefined {
    return this.#mat().asym;
  }

  get symmetricKeySize(): number | undefined {
    const secret = this.#mat().secret;
    return secret ? secret.length : undefined;
  }

  get asymmetricKeyDetails(): Record<string, unknown> | undefined {
    const m = this.#mat();
    if (m.asym === 'rsa' && m.rsa) return { modulusLength: rsaModulusLength(m.rsa), publicExponent: m.rsa.e };
    if (m.asym === 'ec' && m.ec) return { namedCurve: m.ec.curve.nodeName };
    if (m.asym === 'ed25519') return {};
    if (m.asym === 'dh') return {};
    return undefined;
  }

  equals(other: unknown): boolean {
    if (!(other instanceof KeyObject)) return false;
    if (this.type !== other.type) return false;
    // Secret keys compare by raw bytes (Node does the same in C++).
    if (this.type === 'secret') {
      return toHex(this.#mat().secret ?? new Uint8Array()) === toHex(other.#mat().secret ?? new Uint8Array());
    }
    try {
      const mine = this.export({ type: this.type === 'public' ? 'spki' : 'pkcs8', format: 'der' }) as Uint8Array;
      const theirs = other.export({ type: other.type === 'public' ? 'spki' : 'pkcs8', format: 'der' }) as Uint8Array;
      return toHex(mine) === toHex(theirs);
    } catch {
      return false;
    }
  }

  export(options?: unknown): string | Uint8Array {
    const opts = (typeof options === 'string' ? { format: 'pem', type: options } : (options ?? {})) as {
      format?: string;
      type?: string;
    };
    const format = opts.format ?? 'pem';
    const m = this.#mat();
    if (m.type === 'secret') {
      if (!m.secret) throw new Error('secret key has no material');
      const format = opts.format;
      if (format === undefined || format === 'buffer') return outputBytes(this, m.secret, undefined, (bytes) => bytes) as Uint8Array;
      if (format === 'jwk') {
        return { kty: 'oct', k: base64Url(m.secret) } as unknown as string;
      }
      throw coded('TypeError', 'ERR_INVALID_ARG_VALUE',
        `The property 'options.format' must be one of: undefined, 'buffer', 'jwk'. Received ${describe(format)}`);
    }
    const type = opts.type ?? (m.type === 'public' ? 'spki' : 'pkcs8');
    if (format === 'jwk') return exportJwk(m) as unknown as string;
    const der = exportDer(m, type);
    if (format === 'der') return der;
    if (format === 'pem') {
      const label =
        type === 'spki' ? 'PUBLIC KEY' : type === 'pkcs1' ? (m.type === 'public' ? 'RSA PUBLIC KEY' : 'RSA PRIVATE KEY') : type === 'sec1' ? 'EC PRIVATE KEY' : 'PRIVATE KEY';
      return pemEncode(label, der);
    }
    throw invalidArgValue('options.format', format);
  }

  toCryptoKey(): never {
    throw notImplementedError('api', 'crypto.KeyObject.prototype.toCryptoKey');
  }
}

function incompatibleKeyOptions(type: string, alg: string): Error {
  return coded(
    'Error',
    'ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS',
    `The selected key encoding ${type} can only be used for ${alg} keys.`,
  );
}

/** `export()` rejects a `type` outside the format's enum with an arg-value error. */
function invalidExportType(type: string, _isPublic: boolean): Error {
  return coded(
    'TypeError',
    'ERR_INVALID_ARG_VALUE',
    `The property 'options.type' is invalid. Received '${type}'`,
  );
}

function exportDer(m: KeyMaterial, type: string): Uint8Array {
  if (m.type === 'private') {
    if (type === 'pkcs8') return encodePrivateKeyInfo(m);
    if (type === 'pkcs1') {
      if (!m.rsa) throw incompatibleKeyOptions('pkcs1', 'RSA');
      return encodeRsaPrivate(m.rsa);
    }
    if (type === 'sec1') {
      if (!m.ec) throw incompatibleKeyOptions('sec1', 'EC');
      return encodeEcPrivate(m.ec);
    }
    throw invalidExportType(type, false);
  }
  if (type === 'spki') return encodeSubjectPublicKeyInfo(m);
  if (type === 'pkcs1') {
    if (!m.rsa) throw incompatibleKeyOptions('pkcs1', 'RSA');
    return encodeRsaPublic(m.rsa);
  }
  throw invalidExportType(type, true);
}

export function makeKeyObject(material: KeyMaterial): KeyObject {
  return new KeyObject(KEY_OBJECT_INTERNAL, material);
}

// --- JWK export -------------------------------------------------------------

const CURVE_JWK: Record<string, string> = {
  prime256v1: 'P-256',
  secp384r1: 'P-384',
  secp521r1: 'P-521',
  secp256k1: 'secp256k1',
};

/** base64url of a big-endian integer with no unnecessary leading zero. */
function jwkInt(value: bigint): string {
  const bytes = bigIntToBytes(value);
  let i = 0;
  // JWK integers are unsigned magnitudes; drop both the DER sign pad and any
  // redundant high zero bytes (`BN_bn2bin` semantics).
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  return base64Url(bytes.subarray(i));
}

/** base64url of a fixed-width field element. */
function jwkFixed(value: bigint, size: number): string {
  return base64Url(bigIntToBytes(value, size));
}

/** The `JsonWebKey` shape OpenSSL-backed `exportJwk` produces. */
function exportJwk(m: KeyMaterial): Record<string, string> {
  if (m.rsa) {
    const jwk: Record<string, string> = { kty: 'RSA', n: jwkInt(m.rsa.n), e: jwkInt(m.rsa.e) };
    if (m.type === 'private' && m.rsa.d !== undefined) {
      jwk.d = jwkInt(m.rsa.d);
      if (m.rsa.p !== undefined) jwk.p = jwkInt(m.rsa.p);
      if (m.rsa.q !== undefined) jwk.q = jwkInt(m.rsa.q);
      if (m.rsa.dp !== undefined) jwk.dp = jwkInt(m.rsa.dp);
      if (m.rsa.dq !== undefined) jwk.dq = jwkInt(m.rsa.dq);
      if (m.rsa.qinv !== undefined) jwk.qi = jwkInt(m.rsa.qinv);
    }
    return jwk;
  }
  if (m.ec) {
    const size = m.ec.curve.byteLength;
    const jwk: Record<string, string> = {
      kty: 'EC',
      crv: CURVE_JWK[m.ec.curve.nodeName] ?? m.ec.curve.nodeName,
      x: jwkFixed(m.ec.x, size),
      y: jwkFixed(m.ec.y, size),
    };
    if (m.type === 'private' && m.ec.d !== undefined) jwk.d = jwkFixed(m.ec.d, size);
    return jwk;
  }
  if (m.ed) {
    const jwk: Record<string, string> = { kty: 'OKP', crv: 'Ed25519', x: base64Url(m.ed.publicKey) };
    if (m.type === 'private' && m.ed.seed) jwk.d = base64Url(m.ed.seed);
    return jwk;
  }
  if (m.dh) {
    throw coded('Error', 'ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE', 'Unsupported JWK Key Type.');
  }
  throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', 'The property \'options.format\' must be one of: undefined, \'buffer\', \'jwk\'');
}

export function keyMaterialOf(key: KeyObject): KeyMaterial {
  const material = MATERIALS.get(key);
  if (!material) throw new Error('KeyObject: detached key material');
  return material;
}

// --- createPrivateKey / createPublicKey -------------------------------------

interface KeyInput {
  key: unknown;
  format?: string;
  type?: string;
  encoding?: string;
  passphrase?: unknown;
}

function normalizeKeyInput(input: unknown): KeyInput {
  if (typeof input === 'string') return { key: input, format: 'pem' };
  if (input instanceof Uint8Array) return { key: input, format: 'der' };
  if (input && typeof input === 'object' && !(input instanceof KeyObject)) {
    const obj = input as KeyInput;
    if (obj.key === undefined) throw invalidArgType('key.key', 'string, Buffer, ArrayBuffer, KeyObject, or CryptoKey', undefined);
    return obj;
  }
  return { key: input };
}

function derFromInput(input: KeyInput): Uint8Array {
  const { key, format = 'pem' } = input;
  if (format === 'pem') {
    const text = typeof key === 'string' ? key : new TextDecoder().decode(key as Uint8Array);
    const block = pemDecode(text);
    if (!block) throw new Error('key: no PEM block found');
    return block.der;
  }
  if (format === 'der') {
    if (!(key instanceof Uint8Array)) throw invalidArgType('key.key', 'Buffer', key);
    return key;
  }
  throw invalidArgValue('options.format', format);
}

export function createPrivateKey(input: unknown): KeyObject {
  if (input instanceof KeyObject) {
    if (input.type !== 'private') throw new Error('key: not a private key');
    return input;
  }
  const material = parsePrivateDer(derFromInput(normalizeKeyInput(input)));
  return makeKeyObject(material);
}

export function createPublicKey(input: unknown): KeyObject {
  if (input instanceof KeyObject) {
    const m = keyMaterialOf(input);
    if (m.type === 'public') return input;
    if (m.asym === 'rsa' && m.rsa) return makeKeyObject({ type: 'public', asym: 'rsa', rsa: { n: m.rsa.n, e: m.rsa.e } });
    if (m.asym === 'ec' && m.ec) return makeKeyObject({ type: 'public', asym: 'ec', ec: { curve: m.ec.curve, x: m.ec.x, y: m.ec.y } });
    if (m.asym === 'ed25519' && m.ed) return makeKeyObject({ type: 'public', asym: 'ed25519', ed: { publicKey: m.ed.publicKey } });
    if (m.asym === 'dh' && m.dh && m.dh.privateKey !== undefined) {
      const publicKey = m.dh.publicKey ?? modPow(m.dh.generator, m.dh.privateKey, m.dh.prime);
      return makeKeyObject({ type: 'public', asym: 'dh', dh: { prime: m.dh.prime, generator: m.dh.generator, publicKey } });
    }
    throw new Error('key: cannot derive public key');
  }
  const material = parsePublicDer(derFromInput(normalizeKeyInput(input)));
  return makeKeyObject(material);
}

export function createSecretKey(key: unknown, encoding?: unknown): KeyObject {
  let bytes: Uint8Array;
  if (typeof key === 'string') bytes = decodeString(key, typeof encoding === 'string' ? encoding : 'utf8');
  else if (key instanceof Uint8Array) bytes = Uint8Array.from(key);
  else throw invalidArgType('key', 'string or an instance of Buffer, TypedArray, or DataView', key);
  return makeKeyObject({ type: 'secret', secret: bytes });
}

// --- signature algorithms ---------------------------------------------------

export const RSA_PKCS1_PADDING = 1;
export const RSA_NO_PADDING = 3;
export const RSA_PKCS1_OAEP_PADDING = 4;
export const RSA_X931_PADDING = 5;
export const RSA_PKCS1_PSS_PADDING = 6;
export const RSA_PSS_SALTLEN_DIGEST = -1;
export const RSA_PSS_SALTLEN_MAX_SIGN = -2;
export const RSA_PSS_SALTLEN_AUTO = -2;
export const RSA_PSS_SALTLEN_MAX = -3;

const DIGEST_INFO: Record<string, string> = {
  md5: '3020300c06082a864886f70d020505000410',
  sha1: '3021300906052b0e03021a05000414',
  sha224: '302d300d06096086480165030402040500041c',
  sha256: '3031300d060960864801650304020105000420',
  sha384: '3041300d060960864801650304020205000430',
  sha512: '3051300d060960864801650304020305000440',
};

export interface SignAlgorithm {
  hash: string;
  padding?: number;
  saltLength?: number;
  dsaEncoding?: 'der' | 'ieee-p1363';
  /** When `algorithm` is an object, Node reads the key from `algorithm.key`. */
  key?: unknown;
}

/** Parse the `algorithm` argument of `crypto.sign`/`verify`/`createSign`. */
export function parseSignAlgorithm(algorithm: unknown): SignAlgorithm {
  if (algorithm === null || algorithm === undefined) return { hash: 'none' };
  if (typeof algorithm === 'string') return { hash: normalizeHashName(algorithm) };
  if (typeof algorithm === 'object') {
    const obj = algorithm as { hash?: unknown; key?: unknown; padding?: unknown; saltLength?: unknown; dsaEncoding?: unknown };
    const hash = obj.key !== undefined && obj.hash === undefined ? 'none' : typeof obj.hash === 'string' ? normalizeHashName(obj.hash) : 'none';
    return {
      hash,
      key: obj.key,
      padding: typeof obj.padding === 'number' ? obj.padding : undefined,
      saltLength: typeof obj.saltLength === 'number' ? obj.saltLength : undefined,
      dsaEncoding: obj.dsaEncoding === 'ieee-p1363' ? 'ieee-p1363' : 'der',
    };
  }
  throw invalidArgType('algorithm', 'string or object', algorithm);
}

function normalizeHashName(name: string): string {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const token of ['sha512', 'sha384', 'sha256', 'sha224', 'sha1', 'md5', 'md4']) {
    if (n.includes(token)) return token;
  }
  return n;
}

function digestFor(hash: string, data: Uint8Array): Uint8Array {
  const algo = resolveHash(hash);
  if (!algo) throw notImplementedError('crypto', `digest ${hash}`);
  return algo.hash(data);
}

// --- RSA signatures ---------------------------------------------------------

function rsaPrivateOp(m: RsaMaterial, value: bigint): bigint {
  if (m.d === undefined) throw new Error('rsa: not a private key');
  return modPow(value, m.d, m.n);
}

function rsaPublicOp(m: RsaMaterial, value: bigint): bigint {
  return modPow(value, m.e, m.n);
}

function emsaPkcs1(hash: string, digest: Uint8Array, emLen: number): Uint8Array {
  const prefix = DIGEST_INFO[hash];
  if (!prefix) throw notImplementedError('crypto', `RSA digest ${hash}`);
  const t = concat([fromHex(prefix), digest]);
  if (emLen < t.length + 11) throw new Error('rsa: key too short for signature');
  const ps = new Uint8Array(emLen - t.length - 3).fill(0xff);
  return concat([Uint8Array.of(0, 1), ps, Uint8Array.of(0), t]);
}

function mgf1(hash: string, seed: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let counter = 0;
  let offset = 0;
  while (offset < length) {
    const c = new Uint8Array(4);
    c[0] = (counter >>> 24) & 0xff;
    c[1] = (counter >>> 16) & 0xff;
    c[2] = (counter >>> 8) & 0xff;
    c[3] = counter & 0xff;
    const block = digestFor(hash, concat([seed, c]));
    const take = Math.min(block.length, length - offset);
    out.set(block.subarray(0, take), offset);
    offset += take;
    counter++;
  }
  return out;
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

function emsaPssEncode(hash: string, digest: Uint8Array, emBits: number, saltLength: number): Uint8Array {
  const hLen = digestFor(hash, new Uint8Array(0)).length;
  const emLen = Math.ceil(emBits / 8);
  if (emLen < hLen + saltLength + 2) throw new Error('rsa: key too short for PSS');
  const salt = randomBytes(saltLength);
  const h = digestFor(hash, concat([new Uint8Array(8), digest, salt]));
  const ps = new Uint8Array(emLen - saltLength - hLen - 2);
  const db = concat([ps, Uint8Array.of(1), salt]);
  const dbMask = mgf1(hash, h, emLen - hLen - 1);
  const maskedDB = xorBytes(db, dbMask);
  const clearBits = 8 * emLen - emBits;
  maskedDB[0] &= 0xff >>> clearBits;
  return concat([maskedDB, h, Uint8Array.of(0xbc)]);
}

function emsaPssVerify(hash: string, digest: Uint8Array, em: Uint8Array, emBits: number, saltLength: number): boolean {
  const hLen = digestFor(hash, new Uint8Array(0)).length;
  const emLen = em.length;
  if (emLen < hLen + saltLength + 2) return false;
  if (em[emLen - 1] !== 0xbc) return false;
  const maskedDB = em.subarray(0, emLen - hLen - 1);
  const h = em.subarray(emLen - hLen - 1, emLen - 1);
  const clearBits = 8 * emLen - emBits;
  if ((maskedDB[0] & (0xff << (8 - clearBits) & 0xff)) !== 0) return false;
  const dbMask = mgf1(hash, h, emLen - hLen - 1);
  const db = xorBytes(maskedDB, dbMask);
  db[0] &= 0xff >>> clearBits;
  // DB = 0x00...01 || salt
  let index = 0;
  while (index < db.length && db[index] === 0) index++;
  if (index >= db.length || db[index] !== 1) return false;
  if (db.length - index - 1 !== saltLength) return false;
  const salt = db.subarray(index + 1);
  const expected = digestFor(hash, concat([new Uint8Array(8), digest, salt]));
  return toHex(expected) === toHex(h);
}

function resolvePssSaltLength(alg: SignAlgorithm, emLen: number, hLen: number): number {
  const requested = alg.saltLength ?? hLen;
  if (requested >= 0) return requested;
  if (requested === RSA_PSS_SALTLEN_DIGEST) return hLen;
  // MAX_SIGN / MAX / AUTO: the largest salt that fits.
  return emLen - hLen - 2;
}

function rsaSign(alg: SignAlgorithm, data: Uint8Array, key: KeyObject): Uint8Array {
  const m = keyMaterialOf(key);
  if (m.asym !== 'rsa' || !m.rsa) throw keyTypeError('sign');
  const k = modulusByteLength(m.rsa);
  const emLen = k;
  const hLen = digestFor(alg.hash, new Uint8Array(0)).length;
  const em =
    alg.padding === RSA_PKCS1_PSS_PADDING
      ? emsaPssEncode(alg.hash, digestFor(alg.hash, data), rsaModulusLength(m.rsa) - 1, resolvePssSaltLength(alg, emLen, hLen))
      : emsaPkcs1(alg.hash, digestFor(alg.hash, data), k);
  const s = rsaPrivateOp(m.rsa, bytesToBigInt(em));
  return bigIntToBytes(s, k);
}

function rsaVerify(alg: SignAlgorithm, data: Uint8Array, key: KeyObject, signature: Uint8Array): boolean {
  const m = keyMaterialOf(key);
  if (m.asym !== 'rsa' || !m.rsa) throw keyTypeError('verify');
  const k = modulusByteLength(m.rsa);
  if (signature.length !== k) return false;
  const em = bigIntToBytes(rsaPublicOp(m.rsa, bytesToBigInt(signature)), k);
  if (alg.padding === RSA_PKCS1_PSS_PADDING) {
    const hLen = digestFor(alg.hash, new Uint8Array(0)).length;
    const emBits = rsaModulusLength(m.rsa) - 1;
    const emLen = Math.ceil(emBits / 8);
    const saltLength = resolvePssSaltLength(alg, emLen, hLen);
    return emsaPssVerify(alg.hash, digestFor(alg.hash, data), em, emBits, saltLength);
  }
  const expected = emsaPkcs1(alg.hash, digestFor(alg.hash, data), k);
  return toHex(em) === toHex(expected);
}

// --- ECDSA ------------------------------------------------------------------

function derEncodeEcdsa(sig: { r: bigint; s: bigint }): Uint8Array {
  return derSeq(derIntValue(sig.r), derIntValue(sig.s));
}

function derDecodeEcdsa(sig: Uint8Array): { r: bigint; s: bigint } {
  const seq = expectSeq(derParse(sig));
  return { r: derInt(seq[0]), s: derInt(seq[1]) };
}

function ecdsaSignBytes(alg: SignAlgorithm, data: Uint8Array, key: KeyObject): Uint8Array {
  const m = keyMaterialOf(key);
  if (m.asym !== 'ec' || !m.ec || m.ec.d === undefined) throw keyTypeError('sign');
  const digest = digestFor(alg.hash, data);
  const sig = ecdsaSign(digest, m.ec.d, m.ec.curve, () => randomBelow(m.ec!.curve.n));
  if (alg.dsaEncoding === 'ieee-p1363') {
    return concat([coordToBytes(sig.r, m.ec.curve), coordToBytes(sig.s, m.ec.curve)]);
  }
  return derEncodeEcdsa(sig);
}

function ecdsaVerifyBytes(alg: SignAlgorithm, data: Uint8Array, key: KeyObject, signature: Uint8Array): boolean {
  const m = keyMaterialOf(key);
  if (m.asym !== 'ec' || !m.ec) throw keyTypeError('verify');
  const digest = digestFor(alg.hash, data);
  const point: Point = { x: m.ec.x, y: m.ec.y };
  let sig: { r: bigint; s: bigint };
  if (alg.dsaEncoding === 'ieee-p1363') {
    const len = m.ec.curve.byteLength;
    if (signature.length !== 2 * len) return false;
    sig = { r: bytesToBigInt(signature.subarray(0, len)), s: bytesToBigInt(signature.subarray(len)) };
  } else {
    try {
      sig = derDecodeEcdsa(signature);
    } catch {
      return false;
    }
  }
  return ecdsaVerify(digest, sig, point, m.ec.curve);
}

// --- Ed25519 ----------------------------------------------------------------

function edSignBytes(data: Uint8Array, key: KeyObject): Uint8Array {
  const m = keyMaterialOf(key);
  if (m.asym !== 'ed25519' || !m.ed?.seed) throw keyTypeError('sign');
  return ed25519Sign(m.ed.seed, data);
}

function edVerifyBytes(data: Uint8Array, key: KeyObject, signature: Uint8Array): boolean {
  const m = keyMaterialOf(key);
  if (m.asym !== 'ed25519' || !m.ed) throw keyTypeError('verify');
  return ed25519Verify(m.ed.publicKey, data, signature);
}

// --- public sign / verify ---------------------------------------------------

function resolveKey(key: unknown, want: KeyType): KeyObject {
  if (key instanceof KeyObject) {
    if (want === 'private' && key.type !== 'private') {
      throw coded('Error', 'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE', `Invalid key object type ${key.type}, expected private.`);
    }
    if (want === 'public' && key.type === 'secret') {
      throw coded('Error', 'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE', `Invalid key object type ${key.type}, expected public or private.`);
    }
    return key;
  }
  return want === 'private' ? createPrivateKey(key) : createPublicKey(key);
}

/**
 * Node also accepts an options object in the `key` position:
 * `{ key, padding, saltLength, dsaEncoding }`. Fold its algorithm options into
 * `alg` and hand back the real key.
 */
function unwrapKeyOptions(alg: SignAlgorithm, key: unknown): unknown {
  if (key === null || typeof key !== 'object' || key instanceof KeyObject) return key;
  const options = key as { key?: unknown; padding?: unknown; saltLength?: unknown; dsaEncoding?: unknown };
  if (!('key' in options)) return key;
  if (typeof options.padding === 'number') alg.padding = options.padding;
  if (typeof options.saltLength === 'number') alg.saltLength = options.saltLength;
  if (options.dsaEncoding === 'ieee-p1363') alg.dsaEncoding = 'ieee-p1363';
  else if (options.dsaEncoding === 'der') alg.dsaEncoding = 'der';
  return options.key;
}

export function sign(algorithm: unknown, data: Uint8Array, key: unknown): Uint8Array {
  const alg = parseSignAlgorithm(algorithm);
  const k = resolveKey(unwrapKeyOptions(alg, alg.key ?? key), 'private');
  const m = keyMaterialOf(k);
  if (m.asym === 'rsa') return rsaSign(alg, data, k);
  if (m.asym === 'ec') return ecdsaSignBytes(alg, data, k);
  if (m.asym === 'ed25519') return edSignBytes(data, k);
  throw new Error('crypto.sign: unsupported key');
}

export function verify(algorithm: unknown, data: Uint8Array, key: unknown, signature: Uint8Array): boolean {
  const alg = parseSignAlgorithm(algorithm);
  const k = resolveKey(unwrapKeyOptions(alg, alg.key ?? key), 'public');
  const m = keyMaterialOf(k);
  if (m.asym === 'rsa') return rsaVerify(alg, data, k, signature);
  if (m.asym === 'ec') return ecdsaVerifyBytes(alg, data, k, signature);
  if (m.asym === 'ed25519') return edVerifyBytes(data, k, signature);
  throw new Error('crypto.verify: unsupported key');
}

// --- RSA encryption ---------------------------------------------------------

function rsaDecodeError(): Error {
  return coded('Error', 'ERR_OSSL_RSA_PKCS_DECODING_ERROR', 'error:0200009F:rsa routines::pkcs decoding error');
}

function oaepEncode(hash: string, message: Uint8Array, k: number, label: Uint8Array): Uint8Array {
  const hLen = digestFor(hash, new Uint8Array(0)).length;
  if (message.length > k - 2 * hLen - 2) throw new Error('RSA: data too large for key size');
  const lHash = digestFor(hash, label);
  const ps = new Uint8Array(k - message.length - 2 * hLen - 2);
  const db = concat([lHash, ps, Uint8Array.of(1), message]);
  const seed = randomBytes(hLen);
  const dbMask = mgf1(hash, seed, k - hLen - 1);
  const maskedDB = xorBytes(db, dbMask);
  const seedMask = mgf1(hash, maskedDB, hLen);
  const maskedSeed = xorBytes(seed, seedMask);
  return concat([Uint8Array.of(0), maskedSeed, maskedDB]);
}

function oaepDecode(hash: string, em: Uint8Array, k: number, label: Uint8Array): Uint8Array {
  const hLen = digestFor(hash, new Uint8Array(0)).length;
  if (em.length !== k || em[0] !== 0) throw rsaDecodeError();
  const maskedSeed = em.subarray(1, 1 + hLen);
  const maskedDB = em.subarray(1 + hLen);
  const seedMask = mgf1(hash, maskedDB, hLen);
  const seed = xorBytes(maskedSeed, seedMask);
  const dbMask = mgf1(hash, seed, k - hLen - 1);
  const db = xorBytes(maskedDB, dbMask);
  if (toHex(db.subarray(0, hLen)) !== toHex(digestFor(hash, label))) throw rsaDecodeError();
  let index = hLen;
  while (index < db.length && db[index] === 0) index++;
  if (index >= db.length || db[index] !== 1) throw rsaDecodeError();
  return db.subarray(index + 1);
}

/** EME-PKCS1-v1_5 encryption block: 0x00 0x02 || PS (non-zero) || 0x00 || M. */
function emePkcs1Encode(message: Uint8Array, k: number): Uint8Array {
  if (message.length > k - 11) throw new Error('RSA: data too large for key size');
  const ps = new Uint8Array(k - message.length - 3);
  for (let i = 0; i < ps.length; i++) {
    let byte = 0;
    while (byte === 0) byte = randomBytes(1)[0];
    ps[i] = byte;
  }
  return concat([Uint8Array.of(0, 2), ps, Uint8Array.of(0), message]);
}

function emePkcs1Decode(em: Uint8Array): Uint8Array {
  if (em.length < 11 || em[0] !== 0 || em[1] !== 2) throw rsaDecodeError();
  let index = 2;
  while (index < em.length && em[index] !== 0) index++;
  if (index >= em.length || index < 10) throw rsaDecodeError();
  return em.subarray(index + 1);
}

export interface EncryptOptions {
  key?: unknown;
  padding?: number;
  oaepHash?: string;
  oaepLabel?: Uint8Array;
}

function normalizeEncryptArgs(key: unknown, options?: EncryptOptions): EncryptOptions {
  if (key && typeof key === 'object' && !(key instanceof KeyObject) && 'key' in (key as object)) {
    return key as EncryptOptions;
  }
  return { ...(options ?? {}), key };
}

function rsaEncryptBlock(m: RsaMaterial, padding: number, data: Uint8Array, oaepHash: string, oaepLabel: Uint8Array): Uint8Array {
  const k = modulusByteLength(m);
  let em: Uint8Array;
  if (padding === RSA_PKCS1_OAEP_PADDING) em = oaepEncode(oaepHash, data, k, oaepLabel);
  else if (padding === RSA_PKCS1_PADDING) em = emePkcs1Encode(data, k);
  else if (padding === RSA_NO_PADDING) {
    if (data.length !== k) throw new Error('RSA: data length must equal the modulus size for RSA_NO_PADDING');
    em = data;
  } else throw invalidArgValue('padding', padding);
  return bigIntToBytes(rsaPublicOp(m, bytesToBigInt(em)), k);
}

function rsaDecryptBlock(m: RsaMaterial, padding: number, data: Uint8Array, oaepHash: string, oaepLabel: Uint8Array): Uint8Array {
  const k = modulusByteLength(m);
  if (data.length !== k) throw rsaDecodeError();
  const em = bigIntToBytes(rsaPrivateOp(m, bytesToBigInt(data)), k);
  if (padding === RSA_PKCS1_OAEP_PADDING) return oaepDecode(oaepHash, em, k, oaepLabel);
  if (padding === RSA_PKCS1_PADDING) return emePkcs1Decode(em);
  if (padding === RSA_NO_PADDING) return em;
  throw invalidArgValue('padding', padding);
}

export function publicEncrypt(key: unknown, buffer: Uint8Array, options?: EncryptOptions): Uint8Array {
  const args = normalizeEncryptArgs(key, options);
  const k = resolveKey(args.key, 'public');
  const m = keyMaterialOf(k);
  if (m.asym !== 'rsa' || !m.rsa) throw keyTypeError('publicEncrypt');
  return rsaEncryptBlock(m.rsa, args.padding ?? RSA_PKCS1_OAEP_PADDING, buffer, args.oaepHash ?? 'sha1', args.oaepLabel ?? new Uint8Array(0));
}

export function privateDecrypt(key: unknown, buffer: Uint8Array, options?: EncryptOptions): Uint8Array {
  const args = normalizeEncryptArgs(key, options);
  const k = resolveKey(args.key, 'private');
  const m = keyMaterialOf(k);
  if (m.asym !== 'rsa' || !m.rsa) throw keyTypeError('privateDecrypt');
  return rsaDecryptBlock(m.rsa, args.padding ?? RSA_PKCS1_OAEP_PADDING, buffer, args.oaepHash ?? 'sha1', args.oaepLabel ?? new Uint8Array(0));
}

/** `privateEncrypt` / `publicDecrypt` are the inverse pair used for raw signing. */
export function privateEncrypt(key: unknown, buffer: Uint8Array): Uint8Array {
  const k = resolveKey(key, 'private');
  const m = keyMaterialOf(k);
  if (m.asym !== 'rsa' || !m.rsa) throw keyTypeError('privateEncrypt');
  const length = modulusByteLength(m.rsa);
  const em = emePkcs1Encode(buffer, length);
  return bigIntToBytes(rsaPrivateOp(m.rsa, bytesToBigInt(em)), length);
}

export function publicDecrypt(key: unknown, buffer: Uint8Array): Uint8Array {
  const k = resolveKey(key, 'public');
  const m = keyMaterialOf(k);
  if (m.asym !== 'rsa' || !m.rsa) throw keyTypeError('publicDecrypt');
  const length = modulusByteLength(m.rsa);
  if (buffer.length !== length) throw rsaDecodeError();
  const em = bigIntToBytes(rsaPublicOp(m.rsa, bytesToBigInt(buffer)), length);
  return emePkcs1Decode(em);
}

// --- key generation ---------------------------------------------------------

// Trial division by the primes below this bound rejects the vast majority of
// candidates before any (expensive) Miller-Rabin exponentiation.
const SMALL_PRIME_LIMIT = 30000;
const SMALL_PRIMES: bigint[] = (() => {
  const sieve = new Uint8Array(SMALL_PRIME_LIMIT + 1);
  const primes: bigint[] = [];
  for (let i = 2; i <= SMALL_PRIME_LIMIT; i++) {
    if (sieve[i]) continue;
    primes.push(BigInt(i));
    for (let j = i * i; j <= SMALL_PRIME_LIMIT; j += i) sieve[j] = 1;
  }
  return primes;
})();

function isProbablePrime(candidate: bigint, rounds = 8): boolean {
  if (candidate < 2n) return false;
  for (const prime of SMALL_PRIMES) {
    if (candidate === prime) return true;
    if (candidate % prime === 0n) return false;
  }
  let d = candidate - 1n;
  let r = 0n;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    r++;
  }
  for (let i = 0; i < rounds; i++) {
    const a = 2n + (randomBelow(candidate - 3n) % (candidate - 4n));
    let x = modPow(a, d, candidate);
    if (x === 1n || x === candidate - 1n) continue;
    let composite = true;
    for (let j = 1n; j < r; j++) {
      x = (x * x) % candidate;
      if (x === candidate - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

function generatePrime(bits: number): bigint {
  const bytes = Math.ceil(bits / 8);
  for (;;) {
    const candidateBytes = randomBytes(bytes);
    candidateBytes[0] |= 0x80;
    candidateBytes[bytes - 1] |= 1;
    const candidate = bytesToBigInt(candidateBytes);
    if (candidate.toString(2).length !== bits) continue;
    if ((candidate - 1n) % 65537n === 0n) continue;
    if (isProbablePrime(candidate)) return candidate;
  }
}

export interface GenerateKeyPairOptions {
  modulusLength?: number;
  publicExponent?: number;
  namedCurve?: string;
  /** DH: a named MODP group, e.g. `'modp14'`. */
  group?: string;
  /** DH: an explicit prime (Buffer/TypedArray/DataView). */
  prime?: unknown;
  primeLength?: number;
  /** DH: the generator for an explicit prime. */
  generator?: number;
  publicKeyEncoding?: { type?: string; format?: string };
  privateKeyEncoding?: { type?: string; format?: string };
}

export interface GeneratedKeys {
  publicKey: KeyObject | string | Uint8Array;
  privateKey: KeyObject | string | Uint8Array;
}

function encodeGenerated(
  material: KeyMaterial,
  encoding: { type?: string; format?: string } | undefined,
): KeyObject | string | Uint8Array {
  const keyObject = makeKeyObject(material);
  if (!encoding) return keyObject;
  const format = encoding.format ?? 'pem';
  const type = encoding.type ?? (material.type === 'private' ? 'pkcs8' : 'spki');
  const exported = keyObject.export({ type, format });
  return exported;
}

export function generateKeyPairSync(type: string, options: GenerateKeyPairOptions = {}): GeneratedKeys {
  const material = generateMaterial(type, options);
  const priv = encodeGenerated(material.private, options.privateKeyEncoding);
  const pub = encodeGenerated(material.public, options.publicKeyEncoding);
  return { publicKey: pub, privateKey: priv };
}

function generateMaterial(type: string, options: GenerateKeyPairOptions): { private: KeyMaterial; public: KeyMaterial } {
  if (type === 'rsa') {
    const modulusLength = options.modulusLength ?? 2048;
    const e = BigInt(options.publicExponent ?? 65537);
    const half = modulusLength >> 1;
    for (;;) {
      const p = generatePrime(half);
      const q = generatePrime(modulusLength - half);
      if (p === q) continue;
      const n = p * q;
      if (n.toString(2).length !== modulusLength) continue;
      const lambda = lcm(p - 1n, q - 1n) as bigint;
      if (gcd(e, lambda) !== 1n) continue;
      const d = modInverse(e, lambda);
      // CRT parameters use the (p, q) ordering as generated.
      const dp = d % (p - 1n);
      const dq = d % (q - 1n);
      const qinv = modInverse(q, p);
      const rsa: RsaMaterial = { n, e, d, p, q, dp, dq, qinv };
      return {
        private: { type: 'private', asym: 'rsa', rsa },
        public: { type: 'public', asym: 'rsa', rsa: { n, e } },
      };
    }
  }
  if (type === 'ec') {
    const curve = curveByNodeName(options.namedCurve ?? '');
    if (!curve) throw notImplementedError('crypto', `namedCurve ${options.namedCurve}`);
    const d = randomBelow(curve.n);
    const point = pointMul(d, generator(curve), curve);
    if (point === null) throw new Error('ec: key generation failed');
    const material: EcMaterial = { curve, x: point.x, y: point.y, d };
    return {
      private: { type: 'private', asym: 'ec', ec: material },
      public: { type: 'public', asym: 'ec', ec: { curve, x: point.x, y: point.y } },
    };
  }
  if (type === 'ed25519') {
    const seed = randomBytes(32);
    const publicKey = ed25519PublicFromSeed(seed);
    return {
      private: { type: 'private', asym: 'ed25519', ed: { seed, publicKey } },
      public: { type: 'public', asym: 'ed25519', ed: { publicKey } },
    };
  }
  if (type === 'dh') {
    const { prime, generator } = resolveDhParams(options);
    const privateKey = dhPrivateExponent(prime, generator);
    const publicKey = modPow(generator, privateKey, prime);
    const dh: DhMaterial = { prime, generator };
    return {
      private: { type: 'private', asym: 'dh', dh: { ...dh, publicKey, privateKey } },
      public: { type: 'public', asym: 'dh', dh: { ...dh, publicKey } },
    };
  }
  throw notImplementedError('crypto', `generateKeyPair type ${type}`);
}

/** Node's `Received type ...` rendering for a rejected option value. */
function receivedArgType(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string') return `type string ('${value as string}')`;
  if (type === 'number' || type === 'boolean' || type === 'symbol') {
    return `type ${type} (${String(value)})`;
  }
  if (type === 'bigint') return `type bigint (${String(value)}n)`;
  return `type ${type}`;
}

function dhPrimeToBigInt(value: unknown): bigint {
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return bytesToBigInt(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  throw coded(
    'TypeError',
    'ERR_INVALID_ARG_TYPE',
    `The "options.prime" property must be an instance of Buffer, TypedArray, or DataView. Received ${receivedArgType(value)}`,
  );
}

function generateSafePrime(bits: number): bigint {
  for (;;) {
    const q = generatePrime(bits - 1);
    const p = 2n * q + 1n;
    if (bitLength(p) === bits && isProbablePrime(p)) return p;
  }
}

/** Resolves the DH parameters `generateKeyPair('dh')` was asked for. */
function resolveDhParams(options: GenerateKeyPairOptions): { prime: bigint; generator: bigint } {
  if (options.group === undefined && options.prime === undefined && options.primeLength === undefined) {
    throw coded('TypeError', 'ERR_MISSING_OPTION', 'At least one of the group, prime, or primeLength options is required');
  }
  if (options.group !== undefined) {
    if (typeof options.group !== 'string') {
      throw coded(
        'TypeError',
        'ERR_INVALID_ARG_TYPE',
        `The "options.group" property must be of type string. Received ${receivedArgType(options.group)}`,
      );
    }
    const group = modpGroup(options.group);
    if (!group) throw coded('Error', 'ERR_CRYPTO_UNKNOWN_DH_GROUP', 'Unknown DH group');
    return { prime: BigInt('0x' + group.primeHex), generator: BigInt('0x' + group.generatorHex) };
  }
  let generator = 2n;
  if (options.generator !== undefined) {
    if (typeof options.generator !== 'number') {
      throw coded(
        'TypeError',
        'ERR_INVALID_ARG_TYPE',
        `The "options.generator" property must be of type number. Received ${receivedArgType(options.generator)}`,
      );
    }
    generator = BigInt(options.generator);
  }
  if (options.prime !== undefined) return { prime: dhPrimeToBigInt(options.prime), generator };
  return { prime: generateSafePrime(options.primeLength as number), generator };
}

/**
 * The private exponent OpenSSL keygen draws. A named group (or a prime that
 * matches one) samples uniformly from `[1, 2^keylength]`; anything else uses
 * `bits(p) - 2` bits with the top bit forced (`BN_RAND_TOP_ONE`), clearing bit
 * 0 when `g == 2` and `p % 8 == 3` (so the exponent is not a non-residue).
 */
function dhPrivateExponent(prime: bigint, generator: bigint): bigint {
  const named = modpGroupPrivateBitsForParams(
    toHex(bigIntToBytes(prime)),
    toHex(bigIntToBytes(generator)),
  );
  if (named > 0) return randomBitsBelowPow2(named) + 1n;
  const bits = bitLength(prime) - 2;
  let x = randomBitsBelowPow2(bits - 1) + (1n << BigInt(bits - 1));
  if (generator === 2n && (prime & 7n) === 3n) x &= ~1n;
  return x;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

/** Least common multiple, via gcd; returns `bigint` (never `0n` for key material). */
function lcm(a: bigint, b: bigint): bigint {
  return (a / gcd(a, b)) * b;
}

// --- errors -----------------------------------------------------------------

function describe(value: unknown): string {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string') return `type string ('${value}')`;
  if (type === 'number' || type === 'boolean' || type === 'bigint') return `type ${type} (${String(value)})`;
  if (type === 'undefined') return 'undefined';
  return `an instance of ${(value as object).constructor?.name ?? 'Object'}`;
}

function invalidArgType(name: string, expected: string, actual: unknown): Error {
  return coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "${name}" argument must be ${expected}. Received ${describe(actual)}`);
}

function invalidArgValue(name: string, value: unknown): Error {
  return coded('TypeError', 'ERR_INVALID_ARG_VALUE', `The argument '${name}' is invalid. Received ${describe(value)}`);
}

function invalidProperty(name: string, value: unknown): Error {
  return coded('TypeError', 'ERR_INVALID_ARG_VALUE', `The property '${name}' is invalid. Received ${describe(value)}`);
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function keyTypeError(op: string): Error {
  return coded('Error', 'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE', `Invalid key object type public, expected private for ${op}`);
}

function coded(name: string, code: string, message: string): Error {
  const Ctor = name === 'TypeError' ? TypeError : Error;
  const err = new Ctor(message);
  (err as { code?: string }).code = code;
  return err;
}

function notImplementedError(kind: string, detail: string): Error {
  const err = new Error(`[web-node] ${kind} "${detail}" is not implemented.`);
  (err as { code?: string }).code = 'ERR_WEB_NODE_NOT_IMPLEMENTED';
  return err;
}

function decodeString(input: string, encoding: string): Uint8Array {
  const enc = encoding.toLowerCase();
  if (enc === 'hex') return fromHex(input);
  if (enc === 'base64' || enc === 'base64url') {
    const normalized = enc === 'base64url' ? input.replace(/-/g, '+').replace(/_/g, '/') : input;
    const binary = atob(normalized);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(input);
}

/** Exposed for `KeyObject.from` and the corpus. */
export { notImplementedError as asymNotImplemented };

export interface DiffieHellmanInput {
  privateKey?: unknown;
  publicKey?: unknown;
}

/**
 * `crypto.diffieHellman({ privateKey, publicKey })` — the shared secret between
 * two key objects. Supports DH and (EC)DH; both keys must be the same kind and
 * share their domain parameters.
 */
export function diffieHellman(options: unknown): Uint8Array {
  if (options === null || typeof options !== 'object') {
    throw invalidArgType('options', 'of type object', options);
  }
  const { privateKey, publicKey } = options as DiffieHellmanInput;
  if (!(privateKey instanceof KeyObject)) throw invalidProperty('options.privateKey', privateKey);
  if (!(publicKey instanceof KeyObject)) throw invalidProperty('options.publicKey', publicKey);
  if (privateKey.type !== 'private') {
    throw coded('TypeError', 'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE', `Invalid key object type ${privateKey.type}, expected private.`);
  }
  const privMat = keyMaterialOf(privateKey);
  const pubMat = keyMaterialOf(publicKey);
  if (privMat.asym !== pubMat.asym || (privMat.asym !== 'dh' && privMat.asym !== 'ec')) {
    throw coded(
      'Error',
      'ERR_CRYPTO_INCOMPATIBLE_KEY',
      `Incompatible key types for Diffie-Hellman: ${privMat.asym} and ${pubMat.asym}`,
    );
  }
  const mismatch = (): Error =>
    coded('Error', 'ERR_OSSL_MISMATCHING_DOMAIN_PARAMETERS', 'error:1C8000CB:Provider routines::mismatching domain parameters');
  if (privMat.asym === 'dh') {
    const priv = privMat.dh!;
    const pub = pubMat.dh!;
    if (priv.prime !== pub.prime || priv.generator !== pub.generator) throw mismatch();
    const peer = pub.publicKey ?? (pub.privateKey !== undefined ? modPow(pub.generator, pub.privateKey, pub.prime) : undefined);
    const secret = modPow(peer as bigint, priv.privateKey as bigint, priv.prime);
    return bigIntToBytes(secret, Math.ceil(bitLength(priv.prime) / 8));
  }
  const priv = privMat.ec!;
  const pub = pubMat.ec!;
  if (priv.curve !== pub.curve) throw mismatch();
  const point = pointMul(priv.d as bigint, { x: pub.x, y: pub.y }, priv.curve);
  if (point === null) throw mismatch();
  return bigIntToBytes(point.x, priv.curve.byteLength);
}

/** Curve lookup used by `crypto.getCurves()`. */
export function listCurves(): string[] {
  return ['prime256v1', 'secp256r1', 'secp384r1', 'secp521r1', 'P-256', 'P-384', 'P-521'];
}

/** `crypto.getCiphers`-style helper: is this a known asymmetric family? */
export function isKnownCurve(name: string): boolean {
  return curveByNodeName(name) !== undefined;
}
