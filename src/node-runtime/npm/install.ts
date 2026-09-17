/**
 * npm installer.
 *
 * Resolves a project's dependency ranges against the registry, applies
 * npm-style hoisting (place as high in the `node_modules` tree as possible;
 * nest only on a version conflict), then downloads each package's tarball once,
 * verifies its integrity and extracts it into the virtual file system.
 *
 * A `package-lock.json` makes a repeat install deterministic: a locked version
 * that still satisfies the declared range is reused, so resolution (and its
 * network round trips) is skipped entirely.
 *
 * Still out of scope (recorded as limitations): lifecycle scripts and `.bin`
 * shims — both need a process to spawn, and the runtime has no
 * `child_process` — plus npm/yarn/pnpm filesystem specs (`file:`, `git+`,
 * `link:`).
 */

import type { Vfs } from '../vfs';
import * as p from '../vfs/posix';
import { createRegistry, type FetchLike, type PackageManifest, type RegistryClient } from './registry';
import { extractTarball } from './tarball';
import { maxSatisfying, satisfies } from './semver';
import { verifyIntegrity } from './integrity';
import { buildLockfile, lockedByName, lockEntryFor, readLockfile, writeLockfile, type LockedPackage } from './lockfile';

export interface InstalledPackage {
  name: string;
  version: string;
  path: string;
}

export interface InstallResult {
  /** Number of package directories written into `node_modules`. */
  packages: number;
  installed: InstalledPackage[];
  /** Non-fatal problems (skipped deps, unsupported specs, …). */
  warnings: string[];
  /** How many packages were reused from the lockfile instead of resolved. */
  fromLockfile: number;
}

export interface InstallOptions {
  cwd: string;
  fetch: FetchLike;
  registry?: string | RegistryClient;
  includeDev?: boolean;
  log?: (message: string) => void;
  /** Safety valve against runaway graphs. */
  maxPackages?: number;
  /** Set false to ignore/replace a lockfile (a "refresh the tree" install). */
  lockfile?: boolean;
  /**
   * Target platform/arch, used only to skip incompatible `optionalDependencies`
   * (npm installs `fsevents` on darwin and skips it elsewhere, for example).
   * Defaults match what the runtime reports: a Linux/wasm process.
   */
  platform?: string;
  arch?: string;
}

/** A dependency resolved to a concrete version, however we got there. */
interface Resolved {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerOptional: Set<string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  bin?: string | Record<string, string>;
  os?: string[];
  cpu?: string[];
  tarball?: string;
  integrity?: string;
  fromLock: boolean;
}

interface Placement {
  nmDir: string;
  resolved: Resolved;
}

function ensureDir(vfs: Vfs, dir: string): void {
  if (dir && dir !== '/') vfs.mkdir(dir, { recursive: true });
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function optionalPeers(meta: PackageManifest['peerDependenciesMeta']): Set<string> {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(meta ?? {})) if (value?.optional) out.add(name);
  return out;
}

/** Does a manifest's os/cpu allow this platform? (`any` and absence mean yes.) */
function platformAllows(list: string[] | undefined, value: string): boolean {
  if (!list || list.length === 0) return true;
  return list.includes('any') || list.includes(value);
}

/** POSIX path from `from` to `to` (both absolute), for lockfile keys. */
function relativePosix(from: string, to: string): string {
  const a = p.resolve(from).split('/').filter(Boolean);
  const b = p.resolve(to).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

export async function installProject(vfs: Vfs, opts: InstallOptions): Promise<InstallResult> {
  const log = opts.log ?? (() => undefined);
  const client: RegistryClient =
    typeof opts.registry === 'object' && opts.registry !== null
      ? opts.registry
      : createRegistry(opts.fetch, typeof opts.registry === 'string' ? opts.registry : undefined);

  const pkgPath = p.join(opts.cwd, 'package.json');
  if (!vfs.exists(pkgPath)) throw new Error(`npm install: no package.json found in ${opts.cwd}`);

  const rootPkg = JSON.parse(decode(vfs.readFile(pkgPath))) as {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const rootDeps: Record<string, string> = { ...(rootPkg.dependencies ?? {}) };
  const devDeps = opts.includeDev ? { ...(rootPkg.devDependencies ?? {}) } : {};
  Object.assign(rootDeps, devDeps);

  if (Object.keys(rootDeps).length === 0) {
    log('nothing to install — no dependencies declared');
    return { packages: 0, installed: [], warnings: [], fromLockfile: 0 };
  }

  // A locked version that still satisfies the range is reused as-is: no
  // packument fetch, no re-resolution.
  const locked = opts.lockfile === false ? new Map<string, LockedPackage>() : lockedByName(readLockfile(vfs, opts.cwd));
  let fromLockfile = 0;

  const nmRoot = p.join(opts.cwd, 'node_modules');
  const platform = opts.platform ?? 'linux';
  const arch = opts.arch ?? 'wasm32';
  const warnings: string[] = [];
  const placements: Placement[] = [];
  /** nodeModulesDir -> (packageName -> resolved version) */
  const placed = new Map<string, Map<string, string>>();
  /** Accumulated peer requirements: peerName -> { range, by } */
  const peerWanted = new Map<string, { range: string; by: string }>();
  let budget = opts.maxPackages ?? 512;

  const resolve = async (name: string, range: string, quiet = false): Promise<Resolved | null> => {
    const warn = (message: string): void => {
      if (!quiet) warnings.push(message);
    };
    const spec = (range ?? '').trim() || '*';
    if (/^(file:|link:|git\+|git:|https?:)/i.test(spec)) {
      warn(`skipped ${name}: unsupported specifier "${spec}"`);
      return null;
    }

    const entry = locked.get(name);
    if (entry && entry.resolved && satisfies(entry.version, spec)) {
      fromLockfile += 1;
      return {
        name,
        version: entry.version,
        dependencies: entry.dependencies ?? {},
        optionalDependencies: entry.optionalDependencies ?? {},
        peerDependencies: entry.peerDependencies ?? {},
        peerOptional: optionalPeers(entry.peerDependenciesMeta),
        peerDependenciesMeta: entry.peerDependenciesMeta,
        bin: entry.bin,
        os: entry.os,
        cpu: entry.cpu,
        tarball: entry.resolved,
        integrity: entry.integrity,
        fromLock: true,
      };
    }

    const pack = await client.packument(name);
    const tagged = pack['dist-tags']?.[spec];
    const version = tagged ?? maxSatisfying(Object.keys(pack.versions), spec) ?? undefined;
    if (!version || !pack.versions[version]) {
      warn(`no version of ${name} satisfies "${spec}"`);
      return null;
    }
    const manifest: PackageManifest = pack.versions[version];
    return {
      name,
      version,
      dependencies: manifest.dependencies ?? {},
      optionalDependencies: manifest.optionalDependencies ?? {},
      peerDependencies: manifest.peerDependencies ?? {},
      peerOptional: optionalPeers(manifest.peerDependenciesMeta),
      peerDependenciesMeta: manifest.peerDependenciesMeta,
      bin: manifest.bin,
      os: manifest.os,
      cpu: manifest.cpu,
      tarball: manifest.dist?.tarball,
      integrity: manifest.dist?.integrity ?? (manifest.dist?.shasum ? `sha1-${manifest.dist.shasum}` : undefined),
      fromLock: false,
    };
  };

  const wantsPeer = (resolved: Resolved): void => {
    for (const [peer, range] of Object.entries(resolved.peerDependencies)) {
      if (resolved.peerOptional.has(peer)) continue;
      if (!peerWanted.has(peer)) peerWanted.set(peer, { range, by: `${resolved.name}@${resolved.version}` });
    }
  };

  const place = async (
    deps: Record<string, string>,
    chain: string[],
    nestedUnder: string,
    mode: 'required' | 'optional',
  ): Promise<void> => {
    for (const [name, range] of Object.entries(deps)) {
      let resolved: Resolved | null;
      try {
        resolved = await resolve(name, range, mode === 'optional');
      } catch (err) {
        if (mode === 'optional') continue; // optional failures are silent, like npm
        warnings.push(`${name}: ${(err as Error).message}`);
        continue;
      }
      if (!resolved) continue;

      // A platform-specific optional dependency (esbuild's native binaries, or
      // fsevents) is skipped on a non-matching platform — silently, as npm does.
      if (!platformAllows(resolved.os, platform) || !platformAllows(resolved.cpu, arch)) {
        if (mode !== 'optional') warnings.push(`${name}: skipped, does not match ${platform}/${arch}`);
        continue;
      }

      // Walk the chain root-first: reuse a compatible install, or take the
      // first level where the name is not yet occupied.
      let target: string | null = null;
      for (const nmDir of chain) {
        const existing = placed.get(nmDir)?.get(name);
        if (existing === undefined || existing === resolved.version) {
          target = nmDir;
          break;
        }
      }
      if (target === null) target = p.join(nestedUnder, 'node_modules');

      let here = placed.get(target);
      if (!here) {
        here = new Map();
        placed.set(target, here);
      }
      if (here.get(name) === resolved.version) continue; // already satisfied here
      if (here.has(name)) {
        // Root-level conflict we cannot nest our way out of — keep the first.
        warnings.push(`version conflict for ${name} at ${target}; kept ${here.get(name)}, skipped ${resolved.version}`);
        continue;
      }

      if (budget-- <= 0) {
        warnings.push('package budget exceeded — stopping resolution');
        return;
      }

      here.set(name, resolved.version);
      log(`+ ${resolved.name}@${resolved.version}`);
      placements.push({ nmDir: target, resolved });
      wantsPeer(resolved);

      const idx = chain.indexOf(target);
      const baseChain = idx >= 0 ? chain.slice(0, idx + 1) : [...chain, target];
      const childDir = p.join(target, name);
      await place(resolved.dependencies, [...baseChain, p.join(childDir, 'node_modules')], childDir, 'required');
      await place(resolved.optionalDependencies, [...baseChain, p.join(childDir, 'node_modules')], childDir, 'optional');
    }
  };

  await place(rootDeps, [nmRoot], opts.cwd, 'required');

  // npm 7+ auto-installs peers. Place any that no level of the tree satisfied.
  const missingPeers: Record<string, string> = {};
  for (const [peer, want] of peerWanted) {
    const satisfiedSomewhere = [...placed.values()].some((level) => level.has(peer));
    if (!satisfiedSomewhere) {
      missingPeers[peer] = want.range;
      log(`peer  ${peer}@${want.range} (required by ${want.by})`);
    }
  }
  if (Object.keys(missingPeers).length > 0) await place(missingPeers, [nmRoot], opts.cwd, 'required');

  // Download + verify + extract each distinct name@version once.
  const extracted = new Map<string, Awaited<ReturnType<typeof extractTarball>>>();
  const installed: InstalledPackage[] = [];
  const lockPackages: Array<{ path: string; entry: LockedPackage }> = [];

  for (const { nmDir, resolved } of placements) {
    const key = `${resolved.name}@${resolved.version}`;
    let entries = extracted.get(key);
    let integrity = resolved.integrity;
    if (!entries) {
      if (!resolved.tarball) {
        warnings.push(`${key}: no tarball URL (registry or lockfile)`);
        continue;
      }
      log(`↓ ${key}${resolved.fromLock ? ' (lockfile)' : ''}`);
      const tgz = await client.tarball(resolved.tarball);
      const verified = await verifyIntegrity(tgz, { tarball: resolved.tarball, integrity: resolved.integrity });
      if (verified) integrity = verified;
      entries = await extractTarball(tgz);
      extracted.set(key, entries);
    }
    const dir = p.join(nmDir, resolved.name);
    ensureDir(vfs, dir);
    for (const entry of entries) {
      const dest = p.join(dir, entry.path);
      if (entry.type === 'dir') {
        ensureDir(vfs, dest);
      } else {
        ensureDir(vfs, p.dirname(dest));
        vfs.writeFile(dest, entry.data);
      }
    }
    installed.push({ name: resolved.name, version: resolved.version, path: dir });

    const manifest: PackageManifest = {
      name: resolved.name,
      version: resolved.version,
      dependencies: resolved.dependencies,
      optionalDependencies: resolved.optionalDependencies,
      peerDependencies: resolved.peerDependencies,
      peerDependenciesMeta: resolved.peerDependenciesMeta,
      bin: resolved.bin,
      os: resolved.os,
      cpu: resolved.cpu,
      dist: { tarball: resolved.tarball ?? '' },
    };
    const relPath = relativePosix(opts.cwd, dir);
    lockPackages.push({
      path: relPath,
      entry: lockEntryFor(manifest, {
        resolved: resolved.tarball,
        integrity,
        dev: Boolean(devDeps[resolved.name]) && !(rootPkg.dependencies ?? {})[resolved.name],
      }),
    });
  }
  if (opts.lockfile !== false) {
    writeLockfile(vfs, opts.cwd, buildLockfile(rootPkg, lockPackages));
  }

  return { packages: installed.length, installed, warnings, fromLockfile };
}
