/**
 * `crypto.X509Certificate` — a real DER/PEM certificate parser.
 *
 * Node's implementation sits on OpenSSL (`X509View` in `deps/ncrypto`) plus a
 * thin JS wrapper (`lib/internal/crypto/x509.js`). There is no OpenSSL in a
 * page, so this module re-implements the *observable* surface: the same getters
 * with the same string formats, the same `check*`/`verify` semantics, and the
 * same legacy object. The formats are not guessed — they are read off the
 * OpenSSL print helpers Node calls (`X509_NAME_print_ex` with
 * `kX509NameFlagsMultiline`, `ASN1_TIME_print`, `PrintGeneralName`,
 * `SafeX509InfoAccessPrint`, `BIGNUM` hex) and pinned by a differential fixture
 * (`test/fixtures/x509.json`, produced by `tools/x509-oracle.mjs`).
 */

import { TAG, derEncode, derInt, derParse, expectSeq, type DerNode } from './der';
import {
  KeyObject,
  createPublicKey,
  keyMaterialOf,
  verify as asymVerify,
  RSA_PKCS1_PADDING,
} from './asym';
import { resolveHash } from './hash';
import { kByteFactory, outputBytes } from './byte-out';

// --- small helpers ----------------------------------------------------------

const decoder = new TextDecoder();

function utf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** OID contents octets -> dotted string. */
function oidDotted(node: DerNode): string {
  const b = node.content;
  if (b.length === 0) return '';
  const first = b[0];
  const parts: number[] = [Math.floor(first / 40), first % 40];
  let value = 0;
  for (let i = 1; i < b.length; i++) {
    value = value * 128 + (b[i] & 0x7f);
    if ((b[i] & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

/** DER INTEGER contents octets as a big-endian hex string (BIGNUM::toHex). */
function bigIntHex(value: bigint): string {
  let hex = value.toString(16).toUpperCase();
  if (hex.length % 2 === 1) hex = '0' + hex;
  return hex;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// --- ASN.1 time -------------------------------------------------------------

interface ParsedTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parseAsn1Time(node: DerNode): ParsedTime | null {
  const text = utf8(node.content).replace(/\0+$/, '');
  let m: RegExpMatchArray | null;
  if (node.tag === 0x17) {
    // UTCTime: YYMMDDHHMM[SS](Z|+hhmm|-hhmm)
    m = text.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z?/);
    if (!m) return null;
    const yy = Number(m[1]);
    return {
      year: yy < 50 ? 2000 + yy : 1900 + yy,
      month: Number(m[2]), day: Number(m[3]),
      hour: Number(m[4]), minute: Number(m[5]), second: m[6] ? Number(m[6]) : 0,
    };
  }
  if (node.tag === 0x18) {
    // GeneralizedTime: YYYYMMDDHHMM[SS](Z|...)
    m = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z?/);
    if (!m) return null;
    return {
      year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
      hour: Number(m[4]), minute: Number(m[5]), second: m[6] ? Number(m[6]) : 0,
    };
  }
  return null;
}

function asn1TimeToMs(t: ParsedTime): number {
  return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
}

function printAsn1Time(t: ParsedTime): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${MONTHS[t.month - 1]} ${String(t.day).padStart(2, ' ')} ` +
    `${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)} ${t.year} GMT`;
}

// --- Distinguished names ----------------------------------------------------

const DN_SHORT: Record<string, string> = {
  '2.5.4.3': 'CN', '2.5.4.4': 'SN', '2.5.4.5': 'serialNumber', '2.5.4.6': 'C',
  '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.9': 'street', '2.5.4.10': 'O',
  '2.5.4.11': 'OU', '2.5.4.12': 'title', '2.5.4.13': 'description',
  '2.5.4.15': 'businessCategory', '2.5.4.16': 'postalAddress', '2.5.4.17': 'postalCode',
  '2.5.4.20': 'telephoneNumber', '2.5.4.41': 'name', '2.5.4.42': 'GN',
  '2.5.4.43': 'initials', '2.5.4.44': 'generationQualifier',
  '2.5.4.45': 'x500UniqueIdentifier', '2.5.4.46': 'dnQualifier', '2.5.4.65': 'pseudonym',
  '2.5.4.72': 'role', '1.2.840.113549.1.9.1': 'emailAddress',
  '0.9.2342.19200300.100.1.1': 'UID', '0.9.2342.19200300.100.1.25': 'DC',
  '1.3.6.1.4.1.311.60.2.1.3': 'jurisdictionC',
  '2.5.4.97': 'organizationIdentifier',
};

function dnShortName(oid: string): string {
  return DN_SHORT[oid] ?? oid;
}

/** Decode an `AttributeValue` (ANY) into a JS string. */
function attributeValue(node: DerNode): string {
  const c = node.content;
  switch (node.tag) {
    case 0x1e: { // BMPString (UTF-16BE)
      let s = '';
      for (let i = 0; i + 1 < c.length; i += 2) s += String.fromCharCode((c[i] << 8) | c[i + 1]);
      return s;
    }
    case 0x1c: { // UniversalString (UTF-32BE)
      let s = '';
      for (let i = 0; i + 3 < c.length; i += 4) {
        s += String.fromCodePoint((c[i] << 24) | (c[i + 1] << 16) | (c[i + 2] << 8) | c[i + 3]);
      }
      return s;
    }
    default:
      return utf8(c);
  }
}

/** RFC 2253 escaping used by `ASN1_STRFLGS_ESC_2253 | ESC_CTRL`. */
function escape2253(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const code = value.charCodeAt(i);
    if ('",+<>;\\'.includes(ch)) out += '\\' + ch;
    else if (ch === '#' && i === 0) out += '\\#';
    else if ((ch === ' ' && (i === 0 || i === value.length - 1))) out += '\\ ';
    else if (code < 0x20 || code === 0x7f) out += '\\' + code.toString(16).toUpperCase().padStart(2, '0');
    else out += ch;
  }
  return out;
}

interface NameEntry {
  short: string;
  value: string;
}

/** Flatten a `Name` into `{short, value}` entries, in encoding order. */
function nameEntriesRaw(name: DerNode): NameEntry[] {
  const out: NameEntry[] = [];
  for (const rdn of expectSeq(name)) {
    for (const atv of rdn.children ?? []) {
      const [type, value] = expectSeq(atv);
      out.push({ short: dnShortName(oidDotted(type)), value: attributeValue(value) });
    }
  }
  return out;
}

/** The `kX509NameFlagsMultiline` print (newline per RDN, `short=value`). */
function printNameMultiline(name: DerNode): string {
  const lines: string[] = [];
  for (const rdn of expectSeq(name)) {
    const parts: string[] = [];
    for (const atv of rdn.children ?? []) {
      const [type, value] = expectSeq(atv);
      parts.push(`${dnShortName(oidDotted(type))}=${escape2253(attributeValue(value))}`);
    }
    lines.push(parts.join('+'));
  }
  return lines.join('\n');
}

function nameToObject(name: DerNode): Record<string, unknown> {
  const obj: Record<string, unknown> = { __proto__: null } as Record<string, unknown>;
  for (const { short, value } of nameEntriesRaw(name)) {
    if (short in obj) {
      const current = obj[short];
      if (Array.isArray(current)) current.push(value);
      else obj[short] = [current, value];
    } else {
      obj[short] = value;
    }
  }
  return obj;
}

// --- GeneralName printing ---------------------------------------------------

function isSafeAltName(bytes: Uint8Array, utf8Allowed: boolean): boolean {
  for (const c of bytes) {
    if (c === 0x22 || c === 0x5c || c === 0x2c || c === 0x27) return false;
    if (utf8Allowed) {
      if (c < 0x20 || c === 0x7f) return false;
    } else if (c < 0x20 || c > 0x7e) {
      return false;
    }
  }
  return true;
}

function printAltName(bytes: Uint8Array, utf8Allowed: boolean): string {
  if (isSafeAltName(bytes, utf8Allowed)) return utf8(bytes);
  let out = '"';
  for (const c of bytes) {
    if (c === 0x5c) out += '\\\\';
    else if (c === 0x22) out += '\\"';
    else if ((c >= 0x20 && c !== 0x2c && c <= 0x7e) || (utf8Allowed && (c & 0x80) !== 0)) out += String.fromCharCode(c);
    else out += '\\u00' + c.toString(16).padStart(2, '0');
  }
  return out + '"';
}

function printGeneralName(node: DerNode): string {
  const tag = node.tag & 0x1f;
  const bytes = node.content;
  switch (tag) {
    case 1: return 'email:' + printAltName(bytes, false);
    case 2: return 'DNS:' + printAltName(bytes, false);
    case 6: return 'URI:' + printAltName(bytes, false);
    case 7: {
      let ip = 'IP Address:';
      if (bytes.length === 4) return ip + `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
      if (bytes.length === 16) {
        const groups: string[] = [];
        for (let j = 0; j < 8; j++) groups.push(((bytes[2 * j] << 8) | bytes[2 * j + 1]).toString(16).toUpperCase());
        return ip + groups.join(':');
      }
      return ip + `<invalid length=${bytes.length}>`;
    }
    case 4: return 'DirName:' + printAltName(new TextEncoder().encode(printNameMultiline(node.children?.[0] ?? node)), true);
    default: return '<unsupported>';
  }
}

// --- extensions -------------------------------------------------------------

const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';
const OID_EXT_KEY_USAGE = '2.5.29.37';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';
const OID_INFO_ACCESS = '1.3.6.1.5.5.7.1.1';
const OID_AUTHORITY_KEY_ID = '2.5.29.35';
const OID_SUBJECT_KEY_ID = '2.5.29.14';

interface Extension {
  oid: string;
  value: DerNode; // the DER inside the extnValue OCTET STRING
}

function readExtensions(tbs: DerNode[]): Map<string, Extension> {
  const map = new Map<string, Extension>();
  const wrapper = tbs.find((n) => (n.tag & 0xe0) === 0xa0 && (n.tag & 0x1f) === 3);
  if (!wrapper) return map;
  const seq = wrapper.children?.[0];
  if (!seq) return map;
  for (const ext of expectSeq(seq)) {
    const parts = expectSeq(ext);
    const oid = oidDotted(parts[0]);
    // Skip an optional BOOLEAN `critical` flag.
    const octet = parts.find((p) => p.tag === TAG.OCTET_STRING);
    if (!octet) continue;
    let inner: DerNode | null = null;
    try { inner = derParse(octet.content); } catch { inner = null; }
    if (inner) map.set(oid, { oid, value: inner });
  }
  return map;
}

function bitStringBytes(node: DerNode): Uint8Array {
  // First content octet is the count of unused trailing bits.
  return node.content.subarray(1);
}

function isCa(exts: Map<string, Extension>): boolean {
  const bc = exts.get(OID_BASIC_CONSTRAINTS);
  if (bc) {
    // BasicConstraints ::= SEQUENCE { cA BOOLEAN DEFAULT FALSE, pathLen INTEGER OPTIONAL }
    const kids = bc.value.children ?? [];
    const ca = kids.find((k) => k.tag === TAG.BOOLEAN);
    return ca !== undefined && ca.content[0] !== 0;
  }
  const ku = exts.get(OID_KEY_USAGE);
  if (ku) {
    const bits = bitStringBytes(ku.value);
    // keyCertSign is bit 5 (digitalSignature = 0).
    if (bits.length > 0 && (bits[0] & 0x04) !== 0) return true; // 5 = byte0 bit2
  }
  return false;
}

function extKeyUsageOids(exts: Map<string, Extension>): string[] | undefined {
  const eku = exts.get(OID_EXT_KEY_USAGE);
  if (!eku) return undefined;
  const seq = eku.value.children;
  if (!seq) return undefined;
  return seq.map((n) => oidDotted(n));
}

function subjectAltNameString(exts: Map<string, Extension>): string | undefined {
  const san = exts.get(OID_SUBJECT_ALT_NAME);
  if (!san) return undefined;
  const names = san.value.children;
  if (!names) return undefined;
  return names.map((n) => printGeneralName(n)).join(', ');
}

const ACCESS_METHOD: Record<string, string> = {
  '1.3.6.1.5.5.7.48.1': 'OCSP',
  '1.3.6.1.5.5.7.48.2': 'CA Issuers',
  '1.3.6.1.5.5.7.48.3': 'Time Stamping',
  '1.3.6.1.5.5.7.48.5': 'CA Repository',
};

function infoAccessString(exts: Map<string, Extension>): string | undefined {
  const aia = exts.get(OID_INFO_ACCESS);
  if (!aia) return undefined;
  const descs = aia.value.children;
  if (!descs) return undefined;
  return descs
    .map((desc) => {
      const [method, location] = (desc.children ?? []);
      const name = ACCESS_METHOD[oidDotted(method)] ?? oidDotted(method);
      return `${name} - ${printGeneralName(location)}`;
    })
    .join('\n');
}

interface GeneralNameEntry {
  kind: 'dns' | 'email' | 'ip' | 'uri';
  value: string;
  ipBytes?: Uint8Array;
}

function generalNames(exts: Map<string, Extension>): GeneralNameEntry[] {
  const san = exts.get(OID_SUBJECT_ALT_NAME);
  if (!san?.value.children) return [];
  const out: GeneralNameEntry[] = [];
  for (const node of san.value.children) {
    const tag = node.tag & 0x1f;
    const bytes = node.content;
    if (tag === 2) out.push({ kind: 'dns', value: utf8(bytes) });
    else if (tag === 1) out.push({ kind: 'email', value: utf8(bytes) });
    else if (tag === 6) out.push({ kind: 'uri', value: utf8(bytes) });
    else if (tag === 7) out.push({ kind: 'ip', value: utf8(bytes), ipBytes: bytes });
  }
  return out;
}

// --- signature algorithms ---------------------------------------------------

interface SigAlgInfo {
  longName: string;
  hash?: string;
  padding?: number;
}

const SIG_ALGS: Record<string, SigAlgInfo> = {
  '1.2.840.113549.1.1.5': { longName: 'sha1WithRSAEncryption', hash: 'sha1', padding: RSA_PKCS1_PADDING },
  '1.2.840.113549.1.1.11': { longName: 'sha256WithRSAEncryption', hash: 'sha256', padding: RSA_PKCS1_PADDING },
  '1.2.840.113549.1.1.12': { longName: 'sha384WithRSAEncryption', hash: 'sha384', padding: RSA_PKCS1_PADDING },
  '1.2.840.113549.1.1.13': { longName: 'sha512WithRSAEncryption', hash: 'sha512', padding: RSA_PKCS1_PADDING },
  '1.2.840.113549.1.1.14': { longName: 'sha224WithRSAEncryption', hash: 'sha224', padding: RSA_PKCS1_PADDING },
  '1.2.840.113549.1.1.10': { longName: 'RSASSA-PSS', hash: 'sha256' },
  '1.2.840.113549.1.1.4': { longName: 'md5WithRSAEncryption', hash: 'md5', padding: RSA_PKCS1_PADDING },
  '1.2.840.10045.4.3.1': { longName: 'ecdsa-with-SHA224', hash: 'sha224' },
  '1.2.840.10045.4.3.2': { longName: 'ecdsa-with-SHA256', hash: 'sha256' },
  '1.2.840.10045.4.3.3': { longName: 'ecdsa-with-SHA384', hash: 'sha384' },
  '1.2.840.10045.4.3.4': { longName: 'ecdsa-with-SHA512', hash: 'sha512' },
  '1.2.840.10045.4.1': { longName: 'ecdsa-with-SHA1', hash: 'sha1' },
  '1.3.101.112': { longName: 'ED25519' },
  '1.2.840.10040.4.3': { longName: 'dsa-with-sha1', hash: 'sha1' },
  '2.16.840.1.101.3.4.3.2': { longName: 'dsa-with-sha256', hash: 'sha256' },
};

// --- errors -----------------------------------------------------------------

function describe(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return `type string ('${value}')`;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return `type ${t} (${String(value)})`;
  if (t === 'symbol') return `type symbol (${String(value)})`;
  if (t === 'function') return `function ${(value as { name?: string }).name || '<anonymous>'}`;
  if (t === 'undefined') return 'undefined';
  const name = (value as { constructor?: { name?: string } }).constructor?.name;
  return name ? `an instance of ${name}` : 'an object';
}

function coded(name: 'TypeError' | 'Error', code: string, message: string): Error {
  const Ctor = name === 'TypeError' ? TypeError : Error;
  const err = new Ctor(message) as Error & { code?: string };
  err.code = code;
  return err;
}

function invalidArgType(name: string, expected: string, actual: unknown): Error {
  return coded('TypeError', 'ERR_INVALID_ARG_TYPE', `The "${name}" argument must be ${expected}. Received ${describe(actual)}`);
}

/**
 * `util.inspect` renders a KeyObject as `<Kind>Object [KeyObject] {}` — the
 * class name carries the key type. Node prints that shape from
 * `ERR_INVALID_ARG_VALUE('pkey', key)`, so reproduce it verbatim.
 */
function inspectKeyObject(key: { type: string }): string {
  const kind = key.type === 'public' ? 'Public' : key.type === 'private' ? 'Private' : 'Secret';
  return `${kind}KeyObject [KeyObject] {}`;
}

const PEM_NO_START_LINE = (): Error =>
  coded('Error', 'ERR_OSSL_PEM_NO_START_LINE', 'error:0480006C:PEM routines::no start line');

// --- certificate material ---------------------------------------------------

interface CertMaterial {
  der: Uint8Array;
  tbsDer: Uint8Array;
  subjectName: DerNode;
  issuerName: DerNode;
  subject: string;
  issuer: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
  validFromMs: number;
  validToMs: number;
  extKeyUsage: string[] | undefined;
  subjectAltName: string | undefined;
  infoAccess: string | undefined;
  ca: boolean;
  signatureAlgorithm: string | undefined;
  signatureAlgorithmOid: string;
  spkiDer: Uint8Array;
  names: GeneralNameEntry[];
  signatureValue: Uint8Array;
  sigAlg: SigAlgInfo;
}

function decodePem(text: string): Uint8Array | null {
  const match = /-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/.exec(text);
  if (!match) return null;
  const b64 = match[1].replace(/[^A-Za-z0-9+/=]/g, '');
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function toUint8(input: unknown): Uint8Array {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw invalidArgType('buffer', 'of type string or an instance of Buffer, TypedArray, or DataView', input);
}

function parseCertificate(input: unknown): CertMaterial {
  const bytes = toUint8(input);
  let der: Uint8Array | undefined;
  const asText = bytes.length > 0 ? utf8(bytes) : '';
  if (asText.includes('-----BEGIN')) {
    der = decodePem(asText) ?? undefined;
  } else {
    der = bytes;
  }
  if (!der) throw PEM_NO_START_LINE();

  let cert: DerNode;
  try {
    cert = derParse(der);
    if (cert.tag !== TAG.SEQUENCE) throw new Error('not a sequence');
  } catch {
    throw PEM_NO_START_LINE();
  }

  const [tbs, sigAlgNode, sigValueNode] = expectSeq(cert);
  if (!tbs || !sigAlgNode || !sigValueNode) throw PEM_NO_START_LINE();

  const tbsDer = derEncode(TAG.SEQUENCE, tbs.content);
  const tbsParts = expectSeq(tbs);

  // version [0] is optional; when present the rest shift by one.
  let idx = 0;
  if ((tbsParts[0].tag & 0xe0) === 0xa0 && (tbsParts[0].tag & 0x1f) === 0) idx = 1;
  const serialNode = tbsParts[idx];
  const issuerNode = tbsParts[idx + 2];
  const validityNode = tbsParts[idx + 3];
  const subjectNode = tbsParts[idx + 4];
  const spkiNode = tbsParts[idx + 5];

  const validityParts = expectSeq(validityNode);
  const validFromT = parseAsn1Time(validityParts[0]);
  const validToT = parseAsn1Time(validityParts[1]);
  if (!validFromT || !validToT) throw PEM_NO_START_LINE();

  const exts = readExtensions(tbsParts);

  const sigOid = oidDotted(expectSeq(sigAlgNode)[0]);
  const sigAlg = SIG_ALGS[sigOid];

  return {
    der,
    tbsDer,
    subjectName: subjectNode,
    issuerName: issuerNode,
    subject: printNameMultiline(subjectNode),
    issuer: printNameMultiline(issuerNode),
    serialNumber: bigIntHex(derInt(serialNode)),
    validFrom: printAsn1Time(validFromT),
    validTo: printAsn1Time(validToT),
    validFromMs: asn1TimeToMs(validFromT),
    validToMs: asn1TimeToMs(validToT),
    extKeyUsage: extKeyUsageOids(exts),
    subjectAltName: subjectAltNameString(exts),
    infoAccess: infoAccessString(exts),
    ca: isCa(exts),
    signatureAlgorithm: sigAlg?.longName,
    signatureAlgorithmOid: sigOid,
    spkiDer: derEncode(TAG.SEQUENCE, spkiNode.content),
    names: generalNames(exts),
    signatureValue: bitStringBytes(sigValueNode),
    sigAlg: sigAlg ?? { longName: sigOid },
  };
}

function hexOf(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

// --- IP parsing -------------------------------------------------------------

function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const v = Number(parts[i]);
    if (v > 255) return null;
    out[i] = v;
  }
  return out;
}

function parseIpv6(text: string): Uint8Array | null {
  let addr = text;
  if (addr.includes('.')) {
    const v4 = parseIpv4(addr.slice(addr.lastIndexOf(':') + 1));
    if (!v4) return null;
    addr = addr.slice(0, addr.lastIndexOf(':') + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups: number[] = [];
  const parseGroup = (g: string): number | null => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : null);
  for (const g of head) { const v = parseGroup(g); if (v === null) return null; groups.push(v); }
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1) { if (head.length !== 8) return null; }
  else { if (missing < 0) return null; for (let i = 0; i < missing; i++) groups.push(0); }
  for (const g of tail) { const v = parseGroup(g); if (v === null) return null; groups.push(v); }
  if (groups.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) { out[i * 2] = groups[i] >> 8; out[i * 2 + 1] = groups[i] & 0xff; }
  return out;
}

function matchHostname(pattern: string, host: string): boolean {
  if (pattern === host) return true;
  if (pattern.startsWith('*.')) {
    const rest = pattern.slice(2).toLowerCase();
    const h = host.toLowerCase();
    const dot = h.indexOf('.');
    return dot > 0 && h.slice(dot + 1) === rest;
  }
  return false;
}

// --- the public class -------------------------------------------------------

interface CertState {
  publicKey?: KeyObject;
}

/**
 * Mirrors `lib/internal/crypto/x509.js`: a caching wrapper with the same
 * getters and methods. Values are computed once and memoized, like Node.
 */
export class X509Certificate {
  #material: CertMaterial;
  #state: CertState = {};

  constructor(buffer: unknown) {
    this.#material = parseCertificate(buffer);
  }

  get subject(): string { return this.#material.subject; }
  get subjectAltName(): string | undefined { return this.#material.subjectAltName; }
  get issuer(): string { return this.#material.issuer; }
  get issuerCertificate(): undefined { return undefined; }
  get infoAccess(): string | undefined { return this.#material.infoAccess; }
  get validFrom(): string { return this.#material.validFrom; }
  get validTo(): string { return this.#material.validTo; }
  get validFromDate(): Date { return new Date(this.#material.validFromMs); }
  get validToDate(): Date { return new Date(this.#material.validToMs); }
  get fingerprint(): string { return this.#fingerprint('sha1'); }
  get fingerprint256(): string { return this.#fingerprint('sha256'); }
  get fingerprint512(): string { return this.#fingerprint('sha512'); }
  get keyUsage(): string[] | undefined { return this.#material.extKeyUsage; }
  get serialNumber(): string { return this.#material.serialNumber; }
  get signatureAlgorithm(): string | undefined { return this.#material.signatureAlgorithm; }
  get signatureAlgorithmOid(): string { return this.#material.signatureAlgorithmOid; }
  get raw(): Uint8Array {
    return outputBytes(this, this.#material.der, 'buffer', (b) => b) as Uint8Array;
  }
  get publicKey(): KeyObject {
    if (this.#state.publicKey === undefined) {
      const key = createPublicKey(this.#material.spkiDer);
      (key as { [kByteFactory]?: unknown })[kByteFactory] = (this as { [kByteFactory]?: unknown })[kByteFactory];
      this.#state.publicKey = key;
    }
    return this.#state.publicKey;
  }
  get ca(): boolean { return this.#material.ca; }

  #fingerprint(hash: string): string {
    const algo = resolveHash(hash);
    if (!algo) throw new Error(`unsupported hash: ${hash}`);
    const digest = algo.hash(this.#material.der);
    return [...digest].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
  }

  toString(): string {
    return pemEncode('CERTIFICATE', this.#material.der);
  }

  /** No standard JSON encoding exists, so Node falls back to the PEM string. */
  toJSON(): string {
    return this.toString();
  }

  checkHost(name: unknown, options?: unknown): string | undefined {
    validateString(name, 'name');
    validateFlags(options);
    for (const entry of this.#material.names) {
      if (entry.kind === 'dns' && matchHostname(entry.value, name as string)) return entry.value;
    }
    if (!this.#material.names.some((e) => e.kind === 'dns')) {
      // OpenSSL falls back to the subject CN when there are no DNS SANs.
      const cn = nameEntriesRaw(this.#material.subjectName).find((e) => e.short === 'CN');
      if (cn && cn.value === name) return cn.value;
    }
    return undefined;
  }

  checkEmail(email: unknown, options?: unknown): string | undefined {
    validateString(email, 'email');
    validateFlags(options);
    const lower = (email as string).toLowerCase();
    for (const entry of this.#material.names) {
      if (entry.kind === 'email' && entry.value.toLowerCase() === lower) return entry.value;
    }
    return undefined;
  }

  checkIP(ip: unknown, options?: unknown): string | undefined {
    validateString(ip, 'ip');
    validateFlags(options);
    const wanted = parseIpv4(ip as string) ?? parseIpv6(ip as string);
    if (!wanted) return undefined;
    for (const entry of this.#material.names) {
      if (entry.kind !== 'ip' || !entry.ipBytes || entry.ipBytes.length !== wanted.length) continue;
      let same = true;
      for (let i = 0; i < wanted.length; i++) if (wanted[i] !== entry.ipBytes[i]) { same = false; break; }
      if (same) return ip as string;
    }
    return undefined;
  }

  checkIssued(otherCert: unknown): boolean {
    if (!(otherCert instanceof X509Certificate)) {
      throw invalidArgType('otherCert', 'an instance of X509Certificate', otherCert);
    }
    const mine = derEncode(TAG.SEQUENCE, this.#material.issuerName.content);
    const theirs = derEncode(TAG.SEQUENCE, otherCert.#material.subjectName.content);
    return hexOf(mine) === hexOf(theirs);
  }

  checkPrivateKey(pkey: unknown): boolean {
    if (!(pkey instanceof KeyObject)) throw invalidArgType('pkey', 'an instance of KeyObject', pkey);
    if (pkey.type !== 'private') {
      throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', `The argument 'pkey' is invalid. Received ${inspectKeyObject(pkey)}`);
    }
    const publicPart = createPublicKey(pkey);
    const spki = publicPart.export({ type: 'spki', format: 'der' }) as Uint8Array;
    return hexOf(spki) === hexOf(this.#material.spkiDer);
  }

  verify(pkey: unknown): boolean {
    if (!(pkey instanceof KeyObject)) throw invalidArgType('pkey', 'an instance of KeyObject', pkey);
    if (pkey.type !== 'public') {
      throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', `The argument 'pkey' is invalid. Received ${inspectKeyObject(pkey)}`);
    }
    const alg = this.#material.sigAlg;
    if (alg.hash === undefined) return false;
    try {
      return asymVerify(
        { hash: alg.hash, padding: alg.padding ?? RSA_PKCS1_PADDING },
        this.#material.tbsDer,
        pkey,
        this.#material.signatureValue,
      );
    } catch {
      return false;
    }
  }

  toLegacyObject(): Record<string, unknown> {
    const m = this.#material;
    const keyMaterial = keyMaterialOf(this.publicKey);
    const legacy: Record<string, unknown> = {};
    legacy.subject = nameToObject(m.subjectName);
    legacy.issuer = nameToObject(m.issuerName);
    if (m.subjectAltName !== undefined) legacy.subjectaltname = m.subjectAltName;
    if (m.infoAccess !== undefined) legacy.infoAccess = m.infoAccess;
    legacy.ca = m.ca;
    if (keyMaterial.rsa) {
      legacy.modulus = keyMaterial.rsa.n.toString(16).toUpperCase();
      legacy.exponent = '0x' + keyMaterial.rsa.e.toString(16).toUpperCase();
      legacy.pubkey = outputBytes(this, m.spkiDer, 'buffer', (b) => b);
      legacy.bits = keyMaterial.rsa.n.toString(2).length;
    }
    legacy.valid_from = m.validFrom;
    legacy.valid_to = m.validTo;
    legacy.fingerprint = this.fingerprint;
    legacy.fingerprint256 = this.fingerprint256;
    legacy.fingerprint512 = this.fingerprint512;
    if (m.extKeyUsage !== undefined) legacy.ext_key_usage = m.extKeyUsage;
    legacy.serialNumber = m.serialNumber;
    legacy.raw = outputBytes(this, m.der, 'buffer', (b) => b);
    return translatePeerCertificate(legacy);
  }
}

function validateString(value: unknown, name: string): void {
  if (typeof value !== 'string') throw invalidArgType(name, 'of type string', value);
}

function validateFlags(options: unknown): void {
  if (options === undefined) return;
  if (options === null || typeof options !== 'object') throw invalidArgType('options', 'of type object', options);
  const opts = options as Record<string, unknown>;
  const subject = opts.subject ?? 'default';
  validateString(subject, 'options.subject');
  if (subject !== 'default' && subject !== 'always' && subject !== 'never') {
    throw coded('TypeError', 'ERR_INVALID_ARG_VALUE', `The argument 'options.subject' is invalid. Received '${String(subject)}'`);
  }
  for (const key of ['wildcards', 'partialWildcards', 'multiLabelWildcards', 'singleLabelSubdomains']) {
    if (opts[key] !== undefined && typeof opts[key] !== 'boolean') {
      throw invalidArgType(`options.${key}`, 'of type boolean', opts[key]);
    }
  }
}

/** Port of `translatePeerCertificate` from `internal/tls/common`. */
function translatePeerCertificate(c: Record<string, unknown>): Record<string, unknown> {
  if (c.infoAccess != null && typeof c.infoAccess === 'string') {
    const info = c.infoAccess;
    const obj: Record<string, string[]> = { __proto__: null } as unknown as Record<string, string[]>;
    info.replace(/([^\n:]*):([^\n]*)(?:\n|$)/g, (_all, key: string, val: string) => {
      let value = val;
      if (value.charCodeAt(0) === 0x22) value = JSON.parse(value) as string;
      if (key in obj) obj[key].push(value);
      else obj[key] = [value];
      return '';
    });
    c.infoAccess = obj;
  }
  return c;
}

function pemEncode(label: string, der: Uint8Array): string {
  let b64 = '';
  for (const b of der) b64 += String.fromCharCode(b);
  b64 = btoa(b64);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

export type { CertMaterial };
