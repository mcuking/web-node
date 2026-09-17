/**
 * Minimal semver implementation — just enough for npm dependency ranges.
 *
 * Supports: exact (`1.2.3`), partial (`1`, `1.2`), wildcards (`1.x`, `*`),
 * comparators (`> >= < <= =`), caret (`^`), tilde (`~`), hyphen ranges
 * (`1.2.3 - 2.3.4`) and unions (`||`). Prerelease gating follows semver: a
 * prerelease version only satisfies a range when a comparator in the same union
 * shares its [major,minor,patch] tuple.
 *
 * Deliberately dependency-free and small; the full registry client only needs
 * "pick the highest version a range allows".
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
  build: string[];
}

const FULL_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
const PARTIAL_RE = /^([0-9xX*]+(?:\.[0-9xX*]+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(input: string): ParsedVersion | null {
  const m = FULL_RE.exec(String(input).trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? splitPrerelease(m[4]) : [],
    build: m[5] ? m[5].split('.') : [],
  };
}

function splitPrerelease(raw: string): Array<string | number> {
  return raw.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

export function isValid(version: string): boolean {
  return parseVersion(version) !== null;
}

function cmpIdentifier(a: string | number, b: string | number): number {
  const an = typeof a === 'number';
  const bn = typeof b === 'number';
  if (an && bn) return (a as number) - (b as number);
  if (an) return -1; // numeric identifiers sort below alphanumeric
  if (bn) return 1;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  const ap = a.prerelease;
  const bp = b.prerelease;
  if (ap.length === 0 && bp.length === 0) return 0;
  if (ap.length === 0) return 1; // release > prerelease
  if (bp.length === 0) return -1;
  const n = Math.min(ap.length, bp.length);
  for (let i = 0; i < n; i++) {
    const c = cmpIdentifier(ap[i], bp[i]);
    if (c !== 0) return c;
  }
  return ap.length - bp.length;
}

/** Compare two version strings. Throws on invalid input. */
export function compare(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`Invalid version: ${!pa ? a : b}`);
  return compareVersions(pa, pb);
}

// -- ranges -----------------------------------------------------------------

interface Bound {
  gt?: ParsedVersion;
  gte?: ParsedVersion;
  lt?: ParsedVersion;
  lte?: ParsedVersion;
  any?: boolean;
}

interface Comparator {
  bound: Bound;
  hasPre: boolean;
  tuple: ParsedVersion | null;
}

interface Union {
  comps: Comparator[];
}

function mk(major: number, minor: number, patch: number, pre: Array<string | number> = []): ParsedVersion {
  return { major, minor, patch, prerelease: pre, build: [] };
}

/** Parse the version part of a comparator, tolerating partials/wildcards. */
function parsePartial(verStr: string): { nums: Array<number | 'x'>; pre: Array<string | number> } | null {
  const m = PARTIAL_RE.exec(verStr.trim());
  if (!m) return null;
  const nums = m[1].split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : 'x')) as Array<number | 'x'>;
  return { nums, pre: m[2] ? splitPrerelease(m[2]) : [] };
}

function comparator(raw: string): Comparator | null {
  const comp = raw.trim();
  if (comp === '' || comp === '*' || comp === 'x' || comp === 'X') {
    return { bound: { any: true }, hasPre: false, tuple: null };
  }
  const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(comp);
  if (!m) return null;
  const op = m[1] ?? '';
  const parsed = parsePartial(m[2]);
  if (!parsed) return null;

  const { nums, pre } = parsed;
  const wild = nums.indexOf('x');
  const count = wild === -1 ? nums.length : wild;
  const M = count > 0 ? (nums[0] as number) : 0;
  const mi = count > 1 ? (nums[1] as number) : 0;
  const pa = count > 2 ? (nums[2] as number) : 0;
  const hasPre = pre.length > 0;
  const tuple = count >= 3 ? mk(M, mi, pa, pre) : null;

  const exact = (): Comparator => {
    const v = mk(M, count > 1 ? mi : 0, count > 2 ? pa : 0, pre);
    return { bound: { gte: v, lte: v }, hasPre, tuple };
  };

  switch (op) {
    case '':
    case '=': {
      if (count === 0) return { bound: { any: true }, hasPre, tuple: null };
      if (count >= 3) return exact();
      if (count === 2) return { bound: { gte: mk(M, mi, 0, pre), lt: mk(M, mi + 1, 0) }, hasPre, tuple };
      return { bound: { gte: mk(M, 0, 0, pre), lt: mk(M + 1, 0, 0) }, hasPre, tuple };
    }
    case '^': {
      if (count === 0) return { bound: { any: true }, hasPre, tuple: null };
      const lower = mk(M, count > 1 ? mi : 0, count > 2 ? pa : 0, pre);
      let upper: ParsedVersion;
      if (count >= 3) {
        if (M > 0) upper = mk(M + 1, 0, 0);
        else if (mi > 0) upper = mk(0, mi + 1, 0);
        else upper = mk(0, 0, pa + 1);
      } else if (count === 2) {
        upper = M > 0 ? mk(M + 1, 0, 0) : mk(0, mi + 1, 0);
      } else {
        upper = mk(M + 1, 0, 0);
      }
      return { bound: { gte: lower, lt: upper }, hasPre, tuple };
    }
    case '~': {
      if (count === 0) return { bound: { any: true }, hasPre, tuple: null };
      const lower = mk(M, count > 1 ? mi : 0, count > 2 ? pa : 0, pre);
      const upper = count >= 2 ? mk(M, mi + 1, 0) : mk(M + 1, 0, 0);
      return { bound: { gte: lower, lt: upper }, hasPre, tuple };
    }
    case '>': {
      if (count === 0) return { bound: { any: true }, hasPre, tuple: null };
      if (count >= 3) return { bound: { gt: mk(M, mi, pa, pre) }, hasPre, tuple };
      if (count === 2) return { bound: { gte: mk(M, mi + 1, 0) }, hasPre, tuple };
      return { bound: { gte: mk(M + 1, 0, 0) }, hasPre, tuple };
    }
    case '>=': {
      if (count === 0) return { bound: { any: true }, hasPre, tuple: null };
      return { bound: { gte: mk(M, count > 1 ? mi : 0, count > 2 ? pa : 0, pre) }, hasPre, tuple };
    }
    case '<': {
      if (count === 0) return { bound: { any: true }, hasPre, tuple: null };
      return { bound: { lt: mk(M, count > 1 ? mi : 0, count > 2 ? pa : 0, pre) }, hasPre, tuple };
    }
    case '<=': {
      if (count === 0) return { bound: { any: true }, hasPre, tuple: null };
      if (count >= 3) return { bound: { lte: mk(M, mi, pa, pre) }, hasPre, tuple };
      if (count === 2) return { bound: { lt: mk(M, mi + 1, 0) }, hasPre, tuple };
      return { bound: { lt: mk(M + 1, 0, 0) }, hasPre, tuple };
    }
    default:
      return null;
  }
}

function hyphen(lo: string, hi: string): Union | null {
  const a = parsePartial(lo);
  const b = parsePartial(hi);
  if (!a || !b) return null;
  const comps: Comparator[] = [];
  const lowCount = a.nums.indexOf('x') === -1 ? a.nums.length : a.nums.indexOf('x');
  comps.push({
    bound: { gte: mk((a.nums[0] as number) || 0, lowCount > 1 ? (a.nums[1] as number) : 0, lowCount > 2 ? (a.nums[2] as number) : 0, a.pre) },
    hasPre: a.pre.length > 0,
    tuple: null,
  });
  const hiCount = b.nums.indexOf('x') === -1 ? b.nums.length : b.nums.indexOf('x');
  if (hiCount >= 3) comps.push({ bound: { lte: mk(b.nums[0] as number, b.nums[1] as number, b.nums[2] as number, b.pre) }, hasPre: b.pre.length > 0, tuple: null });
  else if (hiCount === 2) comps.push({ bound: { lt: mk(b.nums[0] as number, (b.nums[1] as number) + 1, 0) }, hasPre: false, tuple: null });
  else comps.push({ bound: { lt: mk((b.nums[0] as number) + 1, 0, 0) }, hasPre: false, tuple: null });
  return { comps };
}

function parseRange(range: string): Union[] | null {
  const text = String(range).trim();
  if (text === '') return [{ comps: [{ bound: { any: true }, hasPre: false, tuple: null }] }];

  const unions: Union[] = [];
  for (const rawUnion of text.split('||')) {
    const u = rawUnion.trim();
    if (u === '') continue;
    const hy = /^(\S+)\s+-\s+(\S+)$/.exec(u);
    if (hy) {
      const h = hyphen(hy[1], hy[2]);
      if (h) unions.push(h);
      continue;
    }
    const comps: Comparator[] = [];
    let ok = true;
    for (const part of u.split(/\s+/).filter(Boolean)) {
      const c = comparator(part);
      if (!c) {
        ok = false;
        break;
      }
      comps.push(c);
    }
    if (ok && comps.length) unions.push({ comps });
  }
  return unions.length ? unions : null;
}

function boundAllows(v: ParsedVersion, b: Bound): boolean {
  if (b.any) return true;
  if (b.gt && compareVersions(v, b.gt) <= 0) return false;
  if (b.gte && compareVersions(v, b.gte) < 0) return false;
  if (b.lt && compareVersions(v, b.lt) >= 0) return false;
  if (b.lte && compareVersions(v, b.lte) > 0) return false;
  return true;
}

function sameTuple(a: ParsedVersion, b: ParsedVersion): boolean {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch;
}

export function satisfies(version: string, range: string, includePrerelease = false): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const unions = parseRange(range);
  if (!unions) return false;
  return unions.some((union) => {
    if (!union.comps.every((c) => boundAllows(v, c.bound))) return false;
    if (v.prerelease.length > 0 && !includePrerelease) {
      // A prerelease only matches if a comparator shares its release tuple.
      return union.comps.some((c) => c.hasPre && c.tuple !== null && sameTuple(v, c.tuple));
    }
    return true;
  });
}

/** Highest version in `versions` satisfying `range`, or null. */
export function maxSatisfying(versions: string[], range: string, includePrerelease = false): string | null {
  let best: ParsedVersion | null = null;
  let bestRaw: string | null = null;
  for (const raw of versions) {
    const v = parseVersion(raw);
    if (!v) continue;
    if (!satisfies(raw, range, includePrerelease)) continue;
    if (best === null || compareVersions(v, best) > 0) {
      best = v;
      bestRaw = raw;
    }
  }
  return bestRaw;
}

/** Lowest version in `versions` satisfying `range`, or null. */
export function minSatisfying(versions: string[], range: string, includePrerelease = false): string | null {
  let best: ParsedVersion | null = null;
  let bestRaw: string | null = null;
  for (const raw of versions) {
    const v = parseVersion(raw);
    if (!v) continue;
    if (!satisfies(raw, range, includePrerelease)) continue;
    if (best === null || compareVersions(v, best) < 0) {
      best = v;
      bestRaw = raw;
    }
  }
  return bestRaw;
}
