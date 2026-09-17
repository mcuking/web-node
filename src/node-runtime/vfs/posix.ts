// Minimal POSIX path helpers used by the VFS and the loader.
// Deliberately independent of the user-facing `path` builtin to avoid cycles.

/** Node's `PathLike`: most path-taking APIs accept a string, a `file:` URL or a Buffer. */
export type PathLike = string | URL | Uint8Array;

/**
 * Coerce a Node `PathLike` argument to a VFS path string. Real tooling calls
 * `fs.readFileSync(fileURLToPath(import.meta.url))` and `fs.readFileSync(new URL(...))`
 * interchangeably, so the VFS funnels every path through this before resolving.
 */
export function toPathValue(value: PathLike): string {
  if (typeof value === 'string') return value;
  if (value instanceof URL) {
    if (value.protocol !== 'file:') {
      throw new TypeError(`The URL must be of scheme file, received '${value.protocol}'`);
    }
    return decodeURIComponent(value.pathname);
  }
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  throw new TypeError('The "path" argument must be of type string or an instance of Buffer or URL');
}

export function normalize(path: string): string {
  if (path.length === 0) return '.';
  const isAbsolute = path.charCodeAt(0) === 47;
  const trailingSeparator = path.charCodeAt(path.length - 1) === 47;

  const parts = path.split('/').filter((p) => p.length > 0 && p !== '.');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!isAbsolute) out.push('..');
    } else {
      out.push(part);
    }
  }
  let result = out.join('/');
  if (result.length === 0) return isAbsolute ? '/' : '.';
  if (trailingSeparator) result += '/';
  return isAbsolute ? '/' + result : result;
}

export function resolve(...segments: string[]): string {
  let resolved = '';
  let isAbsolute = false;
  for (let i = segments.length - 1; i >= 0 && !isAbsolute; i--) {
    const seg = segments[i];
    if (!seg) continue;
    resolved = seg + '/' + resolved;
    isAbsolute = seg.charCodeAt(0) === 47;
  }
  if (!isAbsolute) resolved = '/' + resolved;
  const normalized = normalize(resolved);
  if (normalized.length === 0) return '/';
  // resolve() never preserves a trailing separator (unlike normalize()).
  if (normalized.length > 1 && normalized.endsWith('/')) return normalized.slice(0, -1);
  return normalized;
}

export function join(...segments: string[]): string {
  return normalize(segments.filter((s) => s && s.length > 0).join('/'));
}

export function dirname(path: string): string {
  if (path.length === 0) return '.';
  const hasRoot = path.charCodeAt(0) === 47;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; i--) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 1) return '//';
  return path.slice(0, end);
}

export function basename(path: string, ext?: string): string {
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  if (end === -1) return '';
  const name = path.slice(start, end);
  if (ext && name.endsWith(ext)) return name.slice(0, name.length - ext.length);
  return name;
}

export function extname(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot);
}

export function isAbsolute(path: string): boolean {
  return path.charCodeAt(0) === 47;
}

/** Returns path segments (no leading/trailing slash), '/' -> []. */
export function segments(path: string): string[] {
  return normalize(path).split('/').filter((p) => p.length > 0);
}
