/**
 * `net.SocketAddress` / `net.BlockList`, plus the IP parsing/formatting they are
 * built on — a TS stand-in for Node's native `block_list` binding
 * (`src/node_sockaddr.cc`) and its JS wrappers (`lib/internal/socketaddress.js`,
 * `lib/internal/blocklist.js`).
 *
 * This is deliberately *not* vendored: those files reach into
 * `internal/worker/js_transferable` (and thus most of the worker machinery) just
 * for `markTransferMode`, which buys nothing here. Instead we reimplement the
 * observable surface — the exact rule strings, `check` semantics, error codes
 * and messages were read off a real Node v26.9.0 first and are asserted in
 * `test/net-address.test.ts`.
 *
 * The formatter follows glibc `inet_ntop` (which is what libuv calls), including
 * its IPv4-mapped / IPv4-compatible dotted-quad rendering.
 */

export interface NetAddressErrorCodes {
  ERR_INVALID_ADDRESS: new () => Error;
  ERR_INVALID_ARG_VALUE: new (name: string, value: unknown, reason?: string) => Error;
  ERR_INVALID_ARG_TYPE: new (name: string, expected: string, actual: unknown) => Error;
  ERR_OUT_OF_RANGE: new (str: string, range: string, input: unknown) => Error;
  ERR_SOCKET_BAD_PORT: new (name: string, port: unknown, allowZero?: boolean) => Error;
}

const INSPECT = Symbol.for('nodejs.util.inspect.custom');

/** Parse `a.b.c.d` into 4 bytes, or null. Mirrors `uv_inet_pton(AF_INET)`. */
function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (m === null) return null;
  const out: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const n = Number(m[i]);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** Parse an IPv6 literal (with `::`, and an optional embedded IPv4) into 16 bytes. */
function parseIPv6(s: string): number[] | null {
  // Zone ids are not accepted by inet_pton.
  if (s.includes('%')) return null;
  if ((s.match(/::/g) ?? []).length > 1) return null;

  const idx = s.indexOf('::');
  let left: string[];
  let right: string[];
  const hasFill = idx !== -1;
  if (hasFill) {
    left = s.slice(0, idx).split(':');
    right = s.slice(idx + 2).split(':');
    if (left.length === 1 && left[0] === '') left = [];
    if (right.length === 1 && right[0] === '') right = [];
  } else {
    left = s.split(':');
    right = [];
  }

  const toBytes = (groups: string[]): number[] | null => {
    const out: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (g === '') return null;
      if (g.includes('.')) {
        // embedded IPv4 must be the final group
        if (i !== groups.length - 1) return null;
        const v4 = parseIPv4(g);
        if (v4 === null) return null;
        out.push(v4[0], v4[1], v4[2], v4[3]);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        const n = parseInt(g, 16);
        out.push(n >> 8, n & 0xff);
      }
    }
    return out;
  };

  const lb = toBytes(left);
  const rb = toBytes(right);
  if (lb === null || rb === null) return null;
  const total = lb.length + rb.length;
  if (total > 16) return null;
  const zeros = 16 - total;
  // Without `::` the literal must be exactly 8 groups; with it, the run must
  // cover at least one group.
  if (!hasFill && zeros !== 0) return null;
  if (hasFill && zeros === 0) return null;
  return [...lb, ...new Array(zeros).fill(0), ...rb];
}

function formatIPv4(bytes: number[]): string {
  return `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
}

/** Canonical IPv6 text, following glibc `inet_ntop6` (longest zero run, leftmost). */
function formatIPv6(bytes: number[]): string {
  const words: number[] = [];
  for (let i = 0; i < 16; i += 2) words.push((bytes[i] << 8) | bytes[i + 1]);

  let bestBase = -1;
  let bestLen = 0;
  let curBase = -1;
  let curLen = 0;
  const commit = (): void => {
    if (curBase !== -1) {
      if (bestBase === -1 || curLen > bestLen) {
        bestBase = curBase;
        bestLen = curLen;
      }
      curBase = -1;
      curLen = 0;
    }
  };
  for (let i = 0; i < 8; i++) {
    if (words[i] === 0) {
      if (curBase === -1) {
        curBase = i;
        curLen = 1;
      } else {
        curLen++;
      }
    } else {
      commit();
    }
  }
  commit();
  if (bestBase !== -1 && bestLen < 2) {
    bestBase = -1;
    bestLen = 0;
  }

  let out = '';
  for (let i = 0; i < 8; i++) {
    if (bestBase !== -1 && i >= bestBase && i < bestBase + bestLen) {
      if (i === bestBase) out += ':';
      continue;
    }
    if (i !== 0) out += ':';
    // glibc renders an IPv4-compatible (`::a.b.c.d`) or IPv4-mapped
    // (`::ffff:a.b.c.d`) address with an embedded dotted quad.
    if (
      i === 6 &&
      bestBase === 0 &&
      (bestLen === 6 ||
        (bestLen === 7 && words[7] !== 0x0001) ||
        (bestLen === 5 && words[5] === 0xffff))
    ) {
      out += `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
      break;
    }
    out += words[i].toString(16);
  }
  if (bestBase !== -1 && bestBase + bestLen === 8) out += ':';
  return out;
}

/** A parsed address: its family, canonical text, and 16-byte comparison form. */
interface Address {
  family: 'ipv4' | 'ipv6';
  text: string;
  bytes: number[]; // always 16; IPv4 is stored IPv4-mapped so cross-forms compare equal
}

function parseAddress(text: string, family: 'ipv4' | 'ipv6', codes: NetAddressErrorCodes): Address {
  if (family === 'ipv4') {
    const b = parseIPv4(text);
    if (b === null) throw new codes.ERR_INVALID_ADDRESS();
    return {
      family,
      text: formatIPv4(b),
      bytes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, ...b],
    };
  }
  const b = parseIPv6(text);
  if (b === null) throw new codes.ERR_INVALID_ADDRESS();
  return { family, text: formatIPv6(b), bytes: b };
}

/** Compare two 16-byte addresses lexicographically. */
function cmpBytes(a: number[], b: number[]): number {
  for (let i = 0; i < 16; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function eqBytes(a: number[], b: number[]): boolean {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface AddressTypes {
  SocketAddress: any;
  BlockList: any;
}

export function createAddressTypes(
  codes: NetAddressErrorCodes,
  runtimeInspect?: (value: unknown) => string,
): AddressTypes {
  const kKind = Symbol('web-node.socketAddress');
  // Prefer the runtime's `util.inspect` so `[INSPECT]` output matches Node's;
  // fall back to a compact JSON-ish form when it is not available.
  const insp =
    runtimeInspect ??
    ((value: unknown): string =>
      `{ ${Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? `'${v}'` : String(v)}`)
        .join(', ')} }`);

  function validateString(value: unknown, name: string): asserts value is string {
    if (typeof value !== 'string') {
      throw new codes.ERR_INVALID_ARG_TYPE(name, 'string', value);
    }
  }

  function validatePort(value: unknown, name: string): number {
    const n = +(value as number);
    if (
      (typeof value !== 'number' && typeof value !== 'string') ||
      !Number.isInteger(n) ||
      n < 0 ||
      n > 0xffff
    ) {
      throw new codes.ERR_SOCKET_BAD_PORT(name, value, true);
    }
    return n;
  }

  class SocketAddress {
    #address: Address;
    #port: number;
    #flowlabel: number;

    static isSocketAddress(value: unknown): boolean {
      return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        (value as Record<symbol, unknown>)[kKind] === true
      );
    }

    /**
     * `SocketAddress.parse(input)` — parse an `"${ip}:${port}"` string. Ports
     * equal to the scheme default (80) are dropped by the URL parser, exactly
     * as in Node. Returns `undefined` when the input is not a socket address.
     */
    static parse(input: unknown): unknown {
      validateString(input, 'input');
      try {
        const u = new URL(`http://${input}`);
        let address = u.hostname;
        const port = Number(u.port) | 0;
        if (address[0] === '[' && address[address.length - 1] === ']') {
          address = address.slice(1, -1);
          return new SocketAddress({ address, port, family: 'ipv6' });
        }
        return new SocketAddress({ address, port });
      } catch {
        return undefined;
      }
    }

    constructor(options: unknown = {}) {
      if (options === null || typeof options !== 'object') {
        throw new codes.ERR_INVALID_ARG_TYPE('options', 'object', options);
      }
      const opts = options as {
        address?: unknown;
        port?: unknown;
        family?: unknown;
        flowlabel?: unknown;
      };
      let family = opts.family ?? 'ipv4';
      if (typeof family === 'string') family = family.toLowerCase();
      if (family !== 'ipv4' && family !== 'ipv6') {
        throw new codes.ERR_INVALID_ARG_VALUE('options.family', opts.family);
      }
      const address =
        opts.address === undefined ? (family === 'ipv4' ? '127.0.0.1' : '::') : opts.address;
      validateString(address, 'options.address');
      const port = validatePort(opts.port ?? 0, 'options.port');
      const flowlabel = opts.flowlabel ?? 0;
      if (
        typeof flowlabel !== 'number' ||
        !Number.isInteger(flowlabel) ||
        flowlabel < 0 ||
        flowlabel > 0xffffffff
      ) {
        throw new codes.ERR_INVALID_ARG_TYPE('options.flowlabel', 'number', flowlabel);
      }
      this.#address = parseAddress(address, family, codes);
      this.#port = port;
      this.#flowlabel = flowlabel;
      (this as Record<symbol, unknown>)[kKind] = true;
    }

    get address(): string {
      return this.#address.text;
    }
    get port(): number {
      return this.#port;
    }
    get family(): 'ipv4' | 'ipv6' {
      return this.#address.family;
    }
    get flowlabel(): number {
      return this.#flowlabel;
    }

    toJSON(): { address: string; port: number; family: string; flowlabel: number } {
      return {
        address: this.address,
        port: this.port,
        family: this.family,
        flowlabel: this.flowlabel,
      };
    }

    [INSPECT](): string {
      return `SocketAddress ${insp(this.toJSON())}`;
    }

    /** @internal comparison form used by BlockList */
    get _bytes(): number[] {
      return this.#address.bytes;
    }
    /** @internal */
    get _family(): 'ipv4' | 'ipv6' {
      return this.#address.family;
    }
  }

  type Rule =
    | { kind: 'address'; addr: Address }
    | { kind: 'subnet'; addr: Address; prefix: number }
    | { kind: 'range'; start: Address; end: Address };

  const ruleText = (r: Rule): string => {
    if (r.kind === 'address') {
      const label = r.addr.family === 'ipv4' ? 'IPv4' : 'IPv6';
      return `Address: ${label} ${r.addr.text}`;
    }
    if (r.kind === 'subnet') {
      const label = r.addr.family === 'ipv4' ? 'IPv4' : 'IPv6';
      return `Subnet: ${label} ${r.addr.text}/${r.prefix}`;
    }
    const label = r.start.family === 'ipv4' ? 'IPv4' : 'IPv6';
    return `Range: ${label} ${r.start.text}-${r.end.text}`;
  };

  function validatePrefix(prefix: unknown, family: 'ipv4' | 'ipv6'): number {
    const max = family === 'ipv4' ? 32 : 128;
    const n = +(prefix as number);
    if (typeof prefix !== 'number' || !Number.isInteger(n)) {
      throw new codes.ERR_INVALID_ARG_TYPE('prefix', 'integer', prefix);
    }
    if (n < 0 || n > max) {
      throw new codes.ERR_OUT_OF_RANGE('prefix', `>= 0 && <= ${max}`, prefix);
    }
    return n;
  }

  /** Precompute the masked comparison bytes for a subnet rule. */
  function subnetMask(r: { addr: Address; prefix: number }): { mask: number[]; bits: number } {
    const bits = r.addr.family === 'ipv4' ? 96 + r.prefix : r.prefix;
    const mask = r.addr.bytes.slice();
    for (let i = 0; i < 16; i++) {
      const lo = i * 8;
      if (lo >= bits) mask[i] = 0;
      else if (lo + 8 > bits) mask[i] &= (0xff << (lo + 8 - bits)) & 0xff;
    }
    return { mask, bits };
  }

  function maskBytes(bytes: number[], bits: number): number[] {
    const out = bytes.slice();
    for (let i = 0; i < 16; i++) {
      const lo = i * 8;
      if (lo >= bits) out[i] = 0;
      else if (lo + 8 > bits) out[i] &= (0xff << (lo + 8 - bits)) & 0xff;
    }
    return out;
  }

  class BlockList {
    #addresses: Array<{ kind: 'address'; addr: Address }> = [];
    #subnets: Array<{ kind: 'subnet'; addr: Address; prefix: number }> = [];
    #ranges: Array<{ kind: 'range'; start: Address; end: Address }> = [];

    static isBlockList(value: unknown): boolean {
      return value instanceof BlockList;
    }

    static PRIVATE_RANGES = Object.freeze([
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '127.0.0.0/8',
      '::1/128',
      '169.254.0.0/16',
      'fe80::/10',
      'fc00::/7',
    ]);

    #rules(): Rule[] {
      return [...this.#addresses, ...this.#subnets, ...this.#ranges];
    }

    get rules(): string[] {
      return this.#rules().map(ruleText);
    }

    get size(): number {
      return this.#addresses.length + this.#subnets.length + this.#ranges.length;
    }

    #asAddress(value: unknown, family: string, name: string): Address {
      if (SocketAddress.isSocketAddress(value)) {
        const sa = value as SocketAddress;
        return { family: sa._family, text: sa.address, bytes: sa._bytes };
      }
      validateString(value, name);
      validateString(family, 'family');
      return parseAddress(value, family.toLowerCase() === 'ipv6' ? 'ipv6' : 'ipv4', codes);
    }

    addAddress(address: unknown, family = 'ipv4'): void {
      // addAddress prepends, so `rules` lists the newest address first.
      this.#addresses.unshift({ kind: 'address', addr: this.#asAddress(address, family, 'address') });
    }

    addAddresses(addresses: unknown, family = 'ipv4'): void {
      if (!Array.isArray(addresses)) {
        throw new codes.ERR_INVALID_ARG_TYPE('addresses', 'Array', addresses);
      }
      const parsed = addresses.map((a, i) => this.#asAddress(a, family, `addresses[${i}]`));
      for (const addr of parsed) this.#addresses.unshift({ kind: 'address', addr });
    }

    addRange(start: unknown, end: unknown, family = 'ipv4'): void {
      const s = this.#asAddress(start, family, 'start');
      const e = this.#asAddress(end, family, 'end');
      if (cmpBytes(s.bytes, e.bytes) > 0) {
        const asSa =
          SocketAddress.isSocketAddress(start) && start instanceof SocketAddress
            ? start
            : new SocketAddress({ address: s.text, family: s.family });
        throw new codes.ERR_INVALID_ARG_VALUE('start', asSa, 'must come before end');
      }
      this.#ranges.push({ kind: 'range', start: s, end: e });
    }

    addSubnet(network: unknown, prefix: unknown, family = 'ipv4'): void {
      const addr = this.#asAddress(network, family, 'network');
      const p = validatePrefix(prefix, addr.family);
      this.#subnets.push({ kind: 'subnet', addr, prefix: p + 0 });
    }

    addCIDR(cidr: unknown): void {
      const { address, prefix, family } = parseCIDR(cidr, codes);
      this.addSubnet(address, prefix, family);
    }

    addCIDRs(cidrs: unknown): void {
      if (!Array.isArray(cidrs)) {
        throw new codes.ERR_INVALID_ARG_TYPE('cidrs', 'Array', cidrs);
      }
      const parsed = cidrs.map((c, i) => {
        validateString(c, `cidrs[${i}]`);
        return parseCIDR(c, codes);
      });
      for (const c of parsed) this.addSubnet(c.address, c.prefix, c.family);
    }

    removeAddress(address: unknown, family = 'ipv4'): void {
      const addr = this.#asAddress(address, family, 'address');
      const i = this.#addresses.findIndex((r) => eqBytes(r.addr.bytes, addr.bytes));
      if (i !== -1) this.#addresses.splice(i, 1);
    }

    removeRange(start: unknown, end: unknown, family = 'ipv4'): void {
      const s = this.#asAddress(start, family, 'start');
      const e = this.#asAddress(end, family, 'end');
      const i = this.#ranges.findIndex(
        (r) => eqBytes(r.start.bytes, s.bytes) && eqBytes(r.end.bytes, e.bytes),
      );
      if (i !== -1) this.#ranges.splice(i, 1);
    }

    removeSubnet(network: unknown, prefix: unknown, family = 'ipv4'): void {
      const addr = this.#asAddress(network, family, 'network');
      const p = validatePrefix(prefix, addr.family);
      const i = this.#subnets.findIndex(
        (r) => eqBytes(r.addr.bytes, addr.bytes) && r.prefix === p,
      );
      if (i !== -1) this.#subnets.splice(i, 1);
    }

    removeCIDR(cidr: unknown): void {
      const { address, prefix, family } = parseCIDR(cidr, codes);
      this.removeSubnet(address, prefix, family);
    }

    check(address: unknown, family = 'ipv4'): boolean {
      let bytes: number[];
      if (SocketAddress.isSocketAddress(address)) {
        bytes = (address as SocketAddress)._bytes;
      } else {
        validateString(address, 'address');
        validateString(family, 'family');
        const fam = family.toLowerCase() === 'ipv4' ? 'ipv4' : 'ipv6';
        // Node's native `checkString` does inet_pton and returns false on a
        // parse failure rather than throwing.
        let parsed: Address | null = null;
        try {
          parsed = parseAddress(address, fam, codes);
        } catch {
          parsed = null;
        }
        if (parsed === null) return false;
        bytes = parsed.bytes;
      }
      for (const r of this.#addresses) if (eqBytes(r.addr.bytes, bytes)) return true;
      for (const r of this.#subnets) {
        const { mask, bits } = subnetMask(r);
        if (eqBytes(mask, maskBytes(bytes, bits))) return true;
      }
      for (const r of this.#ranges) {
        if (cmpBytes(bytes, r.start.bytes) >= 0 && cmpBytes(bytes, r.end.bytes) <= 0) return true;
      }
      return false;
    }

    clear(): void {
      this.#addresses = [];
      this.#subnets = [];
      this.#ranges = [];
    }

    toJSON(): string[] {
      return this.rules;
    }

    fromJSON(data: unknown): void {
      if (!Array.isArray(data)) {
        throw new codes.ERR_INVALID_ARG_TYPE('data', 'Array', data);
      }
      for (const item of data) {
        if (typeof item !== 'string') continue;
        if (item.includes('IPv4')) {
          let m = /Subnet: IPv4 (\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})/.exec(item);
          if (m) {
            this.addSubnet(m[1], parseInt(m[2], 10));
            continue;
          }
          m = /Address: IPv4 (\d{1,3}(?:\.\d{1,3}){3})/.exec(item);
          if (m) {
            this.addAddress(m[1]);
            continue;
          }
          m = /Range: IPv4 (\d{1,3}(?:\.\d{1,3}){3})-(\d{1,3}(?:\.\d{1,3}){3})/.exec(item);
          if (m) {
            this.addRange(m[1], m[2]);
            continue;
          }
        }
        if (item.includes('IPv6')) {
          let m = /Subnet: IPv6 ([0-9a-fA-F:.]{1,45})\/([0-9]{1,3})/i.exec(item);
          if (m) {
            this.addSubnet(m[1], parseInt(m[2], 10), 'ipv6');
            continue;
          }
          m = /Address: IPv6 ([0-9a-fA-F:.]{1,45})/i.exec(item);
          if (m) {
            this.addAddress(m[1], 'ipv6');
            continue;
          }
          m = /Range: IPv6 ([0-9a-fA-F:.]{1,45})-([0-9a-fA-F:.]{1,45})/i.exec(item);
          if (m) {
            this.addRange(m[1], m[2], 'ipv6');
            continue;
          }
        }
      }
    }

    [INSPECT](): string {
      return `BlockList ${insp({ rules: this.rules })}`;
    }
  }

  return { SocketAddress, BlockList };
}

function parseCIDR(
  cidr: unknown,
  codes: NetAddressErrorCodes,
): { address: string; prefix: number; family: 'ipv4' | 'ipv6' } {
  if (typeof cidr !== 'string') {
    throw new codes.ERR_INVALID_ARG_TYPE('cidr', 'string', cidr);
  }
  const slash = cidr.lastIndexOf('/');
  if (slash === -1) {
    throw new codes.ERR_INVALID_ARG_VALUE(
      'cidr',
      cidr,
      'must contain a prefix length (e.g. "10.0.0.0/8")',
    );
  }
  const address = cidr.slice(0, slash);
  const prefixStr = cidr.slice(slash + 1);
  const prefix = parseInt(prefixStr, 10);
  if (Number.isNaN(prefix) || `${prefix}` !== prefixStr) {
    throw new codes.ERR_INVALID_ARG_VALUE('cidr', cidr, 'prefix length must be a valid integer');
  }
  const family: 'ipv4' | 'ipv6' = address.includes(':') ? 'ipv6' : 'ipv4';
  return { address, prefix, family };
}
