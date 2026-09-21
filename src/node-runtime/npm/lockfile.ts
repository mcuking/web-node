/**
 * `package-lock.json` (lockfileVersion 3) read/write.
 *
 * The lockfile is what makes an install *deterministic*: a second install reuses
 * the recorded version, tarball URL and integrity instead of re-resolving ranges
 * against the registry. We keep the entry fields we need to reinstall without a
 * packument — version, resolved, integrity and the dependency edges — so the
 * recorded tree is self-describing.
 *
 * Only the subset of the npm format this installer produces is modelled; unknown
 * fields in a foreign lockfile are preserved in `raw` and written back untouched.
 */

import type { Vfs } from '../vfs';
import * as p from '../vfs/posix';
import type { PackageManifest } from './registry';

export const LOCKFILE_NAME = 'package-lock.json';

export interface LockedPackage {
  version: string;
  resolved?: string;
  integrity?: string;
  /** Set for `link:` installs (npm's flag for a materialised local package). */
  link?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  bin?: string | Record<string, string>;
  dev?: boolean;
  os?: string[];
  cpu?: string[];
}

export interface LockRoot {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * The package name a lockfile path refers to: the last `node_modules/<name>`
 * segment, keeping a scope segment (`node_modules/@scope/pkg`).
 */
export function nameFromLockPath(path: string): string | null {
  const parts = path.split('node_modules/');
  const last = parts[parts.length - 1];
  if (!last || parts.length < 2) return null;
  const segments = last.split('/');
  if (segments[0].startsWith('@')) return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null;
  return segments[0] || null;
}

/**
 * Read the lockfile's package entries, keyed by path relative to `cwd`
 * (e.g. `node_modules/ms`). A missing or unreadable lockfile yields an empty
 * map — a broken lockfile must never break an install.
 */
export function readLockfile(vfs: Vfs, cwd: string): Map<string, LockedPackage> {
  const path = p.join(cwd, LOCKFILE_NAME);
  if (!vfs.exists(path)) return new Map();
  try {
    const parsed = JSON.parse(decode(vfs.readFile(path))) as { packages?: Record<string, LockedPackage> };
    const out = new Map<string, LockedPackage>();
    for (const [key, value] of Object.entries(parsed.packages ?? {})) {
      if (key && value && typeof value.version === 'string') out.set(key, value);
    }
    return out;
  } catch {
    return new Map();
  }
}

/**
 * Index lock entries by package name, shallowest path first, so a rooted entry
 * wins over a nested duplicate.
 */
export function lockedByName(entries: Map<string, LockedPackage>): Map<string, LockedPackage> {
  const out = new Map<string, LockedPackage>();
  const byDepth = [...entries.entries()].sort((a, b) => a[0].split('/').length - b[0].split('/').length);
  for (const [path, entry] of byDepth) {
    const name = nameFromLockPath(path);
    if (name && !out.has(name)) out.set(name, entry);
  }
  return out;
}

/** Render a lockfile from the tree the installer just placed. */
export function buildLockfile(root: LockRoot, packages: Array<{ path: string; entry: LockedPackage }>): string {
  const entries: Record<string, LockedPackage> = {
    '': {
      version: root.version ?? '0.0.0',
      ...(root.dependencies ? { dependencies: root.dependencies } : {}),
      ...(root.devDependencies ? { devDependencies: root.devDependencies } : {}),
    },
  };
  for (const { path, entry } of [...packages].sort((a, b) => a.path.localeCompare(b.path))) {
    entries[path] = entry;
  }
  const doc = {
    ...(root.name ? { name: root.name } : {}),
    version: root.version ?? '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: entries,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function writeLockfile(vfs: Vfs, cwd: string, contents: string): void {
  vfs.writeFile(p.join(cwd, LOCKFILE_NAME), new TextEncoder().encode(contents));
}

/** The lockfile entry for an installed package (the fields we can reinstall from). */
export function lockEntryFor(
  manifest: PackageManifest,
  opts: { resolved?: string; integrity?: string; dev?: boolean; local?: string; link?: boolean },
): LockedPackage {
  const entry: LockedPackage = { version: manifest.version };
  const resolved = opts.resolved ?? opts.local;
  if (resolved) entry.resolved = resolved;
  if (opts.integrity) entry.integrity = opts.integrity;
  if (opts.dev) entry.dev = true;
  if (opts.link) entry.link = true;
  if (manifest.dependencies && Object.keys(manifest.dependencies).length) entry.dependencies = manifest.dependencies;
  if (manifest.optionalDependencies && Object.keys(manifest.optionalDependencies).length) entry.optionalDependencies = manifest.optionalDependencies;
  if (manifest.peerDependencies && Object.keys(manifest.peerDependencies).length) {
    entry.peerDependencies = manifest.peerDependencies;
    if (manifest.peerDependenciesMeta && Object.keys(manifest.peerDependenciesMeta).length) {
      entry.peerDependenciesMeta = manifest.peerDependenciesMeta;
    }
  }
  if (manifest.bin) entry.bin = manifest.bin;
  if (manifest.os && manifest.os.length) entry.os = manifest.os;
  if (manifest.cpu && manifest.cpu.length) entry.cpu = manifest.cpu;
  return entry;
}
