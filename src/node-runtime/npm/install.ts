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
 * A project can also steer the tree from the root: `overrides` / `resolutions`
 * re-point a transitive dependency at a chosen range (see `overrides.ts`), and
 * `file:`/`link:` specifiers install a package straight out of the virtual file
 * system instead of the registry.
 *
 * After the tree is written the installer does the two things npm does next:
 * it writes `node_modules/.bin` shims (as JavaScript, see `bin.ts`) and it runs
 * each package's `preinstall`/`install`/`postinstall` followed by the root
 * project's lifecycle (see `scripts.ts`). Script execution needs a spawn
 * surface and is therefore skipped when no `host` is supplied.
 *
 * Still out of scope (recorded as limitations): git specs (`git+`, `git:`) and
 * `npm run` itself. `link:` is materialised as a copy — the VFS has no symbolic
 * links — so an edit to the linked package is not observed by the consumer.
 */

import type { Vfs } from '../vfs';
import type { ProcessHost } from '../proc/host';
import * as p from '../vfs/posix';
import { createRegistry, type FetchLike, type PackageManifest, type RegistryClient } from './registry';
import { extractTarball } from './tarball';
import { binEntriesFor, writeBinShims, type BinEntry } from './bin';
import { runDependencyScripts, runRootScripts, DEFAULT_SCRIPT_TIMEOUT_MS, type ScriptOutcome } from './scripts';
import { maxSatisfying, satisfies } from './semver';
import { buildOverrideTable } from './overrides';
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
  /** Non-fatal problems (skipped deps, unsupported specs, failed scripts, …). */
  warnings: string[];
  /** How many packages were reused from the lockfile instead of resolved. */
  fromLockfile: number;
  /** `.bin` command names that were linked. */
  binLinks?: string[];
  /** Lifecycle events that actually ran, as `package@version event`. */
  lifecycle?: string[];
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
  /**
   * The spawn surface used to run lifecycle scripts. Without it the install
   * still completes — it just skips scripts, as `--ignore-scripts` would.
   */
  host?: ProcessHost;
  /** Environment for lifecycle scripts (defaults to the runtime's own). */
  env?: Record<string, string>;
  /** Run `preinstall`/`install`/`postinstall`/`prepare` (default true). */
  runScripts?: boolean;
  /** Per-script wall-clock limit. */
  scriptTimeoutMs?: number;
  /** Streamed script output. */
  onOutput?: (chunk: Uint8Array, stream: 'stdout' | 'stderr') => void;
  /**
   * How many tarballs may be in flight at once. The resolution walk stays
   * sequential (it is cheap and order-sensitive), but downloads are the slow
   * part of an install, so they overlap up to this many at a time.
   */
  concurrency?: number;
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
  /** `file:`/`link:` installs carry their bytes instead of a tarball URL. */
  kind?: 'registry' | 'file' | 'link';
  /** A `file:`/`link:` directory to copy into `node_modules`. */
  localDir?: string;
  /** A `file:` tarball, already extracted. */
  localEntries?: Array<{ path: string; type: 'file' | 'dir'; data: Uint8Array }>;
  /** The specifier the range came from, for the lockfile (`file:../foo`). */
  spec?: string;
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

/** Recursively copy a directory tree, skipping `node_modules` and `.git`. */
function copyTree(vfs: Vfs, from: string, to: string): void {
  ensureDir(vfs, to);
  for (const entry of vfs.readdir(from, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const src = p.join(from, entry.name);
    const dst = p.join(to, entry.name);
    if (entry.type === 'dir') copyTree(vfs, src, dst);
    else {
      ensureDir(vfs, p.dirname(dst));
      vfs.writeFile(dst, vfs.readFile(src));
    }
  }
}

/** `file:`/`link:` specifier, split into its kind and (raw) target path. */
function localSpec(spec: string): { kind: 'file' | 'link'; target: string } | null {
  const match = /^(file|link):(.*)$/i.exec(spec);
  if (!match) return null;
  const target = match[2].trim();
  return { kind: match[1].toLowerCase() as 'file' | 'link', target: target === '' ? '.' : target };
}

/**
 * Run `worker` over `items` with at most `limit` in flight, then rethrow the
 * first failure. Every item is attempted even if an earlier one rejects, so no
 * download is left dangling half-scheduled.
 */
async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  const errors: unknown[] = [];
  let next = 0;
  const runner = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        await worker(items[index]);
      } catch (err) {
        errors.push(err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  if (errors.length > 0) throw errors[0];
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
    scripts?: Record<string, string>;
    overrides?: unknown;
    resolutions?: unknown;
  };

  const rootDeps: Record<string, string> = { ...(rootPkg.dependencies ?? {}) };
  const devDeps = opts.includeDev ? { ...(rootPkg.devDependencies ?? {}) } : {};
  Object.assign(rootDeps, devDeps);

  // `overrides`/`resolutions` steer the whole tree from the root, and they
  // apply even on a lockfile-reusing install (that is the point of pinning).
  const overrides = buildOverrideTable(rootPkg);

  if (Object.keys(rootDeps).length === 0) {
    log('nothing to install — no dependencies declared');
    return { packages: 0, installed: [], warnings: [], fromLockfile: 0, binLinks: [], lifecycle: [] };
  }

  // A locked version that still satisfies the range is reused as-is: no
  // packument fetch, no re-resolution.
  const locked = opts.lockfile === false ? new Map<string, LockedPackage>() : lockedByName(readLockfile(vfs, opts.cwd));
  let fromLockfile = 0;

  const nmRoot = p.join(opts.cwd, 'node_modules');
  const platform = opts.platform ?? 'linux';
  const arch = opts.arch ?? 'wasm32';
  const warnings: string[] = [];
  for (const key of overrides.ignored) warnings.push(`override ignored: ${key}`);
  const placements: Placement[] = [];
  /** nodeModulesDir -> (packageName -> resolved version) */
  const placed = new Map<string, Map<string, string>>();
  /** Accumulated peer requirements: peerName -> { range, by } */
  const peerWanted = new Map<string, { range: string; by: string }>();
  let budget = opts.maxPackages ?? 512;

  const resolve = async (
    name: string,
    range: string,
    fromDir: string,
    ancestors: readonly string[],
    quiet = false,
  ): Promise<Resolved | null> => {
    const warn = (message: string): void => {
      if (!quiet) warnings.push(message);
    };
    let spec = (range ?? '').trim() || '*';

    // A root override wins over whatever the dependent asked for.
    const override = overrides.find(name, ancestors);
    if (override !== undefined && override !== spec) {
      log(`override ${name}: ${spec} -> ${override}${ancestors.length ? ` (under ${ancestors.join('>')})` : ''}`);
      spec = override;
    }

    // `file:`/`link:` resolve against the VFS, not the registry.
    const local = localSpec(spec);
    if (local) {
      const target = local.target.startsWith('/') ? p.normalize(local.target) : p.resolve(fromDir, local.target);
      if (!vfs.exists(target)) {
        warn(`skipped ${name}: ${local.kind}: path not found: ${spec}`);
        return null;
      }
      if (vfs.stat(target).type === 'dir') {
        const manifestPath = p.join(target, 'package.json');
        let manifest: { name?: string; version?: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }>; bin?: string | Record<string, string> } | undefined;
        if (vfs.exists(manifestPath)) {
          try {
            manifest = JSON.parse(decode(vfs.readFile(manifestPath)));
          } catch (err) {
            warn(`skipped ${name}: unreadable package.json in ${spec} (${(err as Error).message})`);
            return null;
          }
        } else {
          warn(`${name}: ${spec} has no package.json; using a synthetic manifest`);
        }
        return {
          name: manifest?.name ?? name,
          version: manifest?.version ?? '0.0.0',
          dependencies: manifest?.dependencies ?? {},
          optionalDependencies: manifest?.optionalDependencies ?? {},
          peerDependencies: manifest?.peerDependencies ?? {},
          peerOptional: optionalPeers(manifest?.peerDependenciesMeta),
          peerDependenciesMeta: manifest?.peerDependenciesMeta,
          bin: manifest?.bin,
          kind: local.kind,
          localDir: target,
          spec,
          fromLock: false,
        };
      }
      if (local.kind === 'link') {
        warn(`skipped ${name}: link: target is not a directory (${spec})`);
        return null;
      }
      try {
        const entries = await extractTarball(vfs.readFile(target));
        const pkgEntry =
          entries.find((e) => e.type === 'file' && e.path === 'package.json') ??
          entries.find((e) => e.type === 'file' && e.path.endsWith('/package.json'));
        const manifest = pkgEntry ? (JSON.parse(decode(pkgEntry.data)) as { name?: string; version?: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }>; bin?: string | Record<string, string> }) : undefined;
        return {
          name: manifest?.name ?? name,
          version: manifest?.version ?? '0.0.0',
          dependencies: manifest?.dependencies ?? {},
          optionalDependencies: manifest?.optionalDependencies ?? {},
          peerDependencies: manifest?.peerDependencies ?? {},
          peerOptional: optionalPeers(manifest?.peerDependenciesMeta),
          peerDependenciesMeta: manifest?.peerDependenciesMeta,
          bin: manifest?.bin,
          kind: 'file',
          localEntries: entries,
          spec,
          fromLock: false,
        };
      } catch (err) {
        warn(`skipped ${name}: unreadable tarball ${spec} (${(err as Error).message})`);
        return null;
      }
    }

    if (/^(git\+|git:|https?:)/i.test(spec)) {
      warn(`skipped ${name}: unsupported specifier "${spec}"`);
      return null;
    }

    const entry = locked.get(name);
    if (entry && entry.resolved && /^https?:/i.test(entry.resolved) && satisfies(entry.version, spec)) {
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
        kind: 'registry',
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
      kind: 'registry',
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
    packageDir: string,
    ancestors: readonly string[],
  ): Promise<void> => {
    for (const [name, range] of Object.entries(deps)) {
      let resolved: Resolved | null;
      try {
        resolved = await resolve(name, range, packageDir, ancestors, mode === 'optional');
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
      const childAncestors = [...ancestors, resolved.name];
      await place(resolved.dependencies, [...baseChain, p.join(childDir, 'node_modules')], childDir, 'required', childDir, childAncestors);
      await place(resolved.optionalDependencies, [...baseChain, p.join(childDir, 'node_modules')], childDir, 'optional', childDir, childAncestors);
    }
  };

  await place(rootDeps, [nmRoot], opts.cwd, 'required', opts.cwd, []);

  // npm 7+ auto-installs peers. Place any that no level of the tree satisfied.
  const missingPeers: Record<string, string> = {};
  for (const [peer, want] of peerWanted) {
    const satisfiedSomewhere = [...placed.values()].some((level) => level.has(peer));
    if (!satisfiedSomewhere) {
      missingPeers[peer] = want.range;
      log(`peer  ${peer}@${want.range} (required by ${want.by})`);
    }
  }
  if (Object.keys(missingPeers).length > 0) await place(missingPeers, [nmRoot], opts.cwd, 'required', opts.cwd, []);

  // Download + verify + extract each distinct registry tarball once, up to
  // `concurrency` in flight. Everything is fetched *before* the tree is
  // written, so a failed download (or an integrity mismatch) leaves
  // `node_modules` untouched rather than half-populated.
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 8));
  const extracted = new Map<string, Array<{ path: string; type: 'file' | 'dir'; data: Uint8Array }>>();
  const integrityByKey = new Map<string, string | undefined>();
  const skipped = new Set<string>();
  const downloads: Array<{ key: string; resolved: Resolved }> = [];
  const seen = new Set<string>();
  for (const { resolved } of placements) {
    if (resolved.localDir || resolved.localEntries) continue;
    const key = `${resolved.name}@${resolved.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!resolved.tarball) {
      warnings.push(`${key}: no tarball URL (registry or lockfile)`);
      skipped.add(key);
      continue;
    }
    downloads.push({ key, resolved });
  }
  await runPool(downloads, concurrency, async ({ key, resolved }) => {
    const url = resolved.tarball as string;
    log(`↓ ${key}${resolved.fromLock ? ' (lockfile)' : ''}`);
    const tgz = await client.tarball(url);
    const verified = await verifyIntegrity(tgz, { tarball: url, integrity: resolved.integrity });
    integrityByKey.set(key, verified ?? resolved.integrity);
    extracted.set(key, await extractTarball(tgz));
  });

  const installed: InstalledPackage[] = [];
  const lockPackages: Array<{ path: string; entry: LockedPackage }> = [];
  /** Every package directory written, in placement order (used for bins/scripts). */
  const packageDirs: Array<{ dir: string; manifest: { name?: string; version?: string; bin?: string | Record<string, string>; scripts?: Record<string, string> } }> = [];

  for (const { nmDir, resolved } of placements) {
    const key = `${resolved.name}@${resolved.version}`;
    let entries = resolved.localEntries;
    if (!entries && !resolved.localDir) {
      if (skipped.has(key)) continue;
      entries = extracted.get(key);
      if (!entries) continue;
    }

    const dir = p.join(nmDir, resolved.name);
    ensureDir(vfs, dir);
    if (resolved.localDir) {
      copyTree(vfs, resolved.localDir, dir);
    } else {
      for (const entry of entries as Array<{ path: string; type: 'file' | 'dir'; data: Uint8Array }>) {
        const dest = p.join(dir, entry.path);
        if (entry.type === 'dir') {
          ensureDir(vfs, dest);
        } else {
          ensureDir(vfs, p.dirname(dest));
          vfs.writeFile(dest, entry.data);
        }
      }
    }
    installed.push({ name: resolved.name, version: resolved.version, path: dir });

    // The extracted `package.json` is the authority for `bin` and `scripts`:
    // it is what a lockfile-reused install has too, and it keeps those fields
    // out of the lockfile schema.
    let installedManifest: (typeof packageDirs)[number]['manifest'] = {
      name: resolved.name,
      version: resolved.version,
      bin: resolved.bin,
    };
    const installedPkgPath = p.join(dir, 'package.json');
    if (vfs.exists(installedPkgPath)) {
      try {
        installedManifest = JSON.parse(decode(vfs.readFile(installedPkgPath))) as typeof installedManifest;
        installedManifest.name ??= resolved.name;
        installedManifest.version ??= resolved.version;
      } catch (err) {
        warnings.push(`${resolved.name}@${resolved.version}: unreadable package.json (${(err as Error).message})`);
      }
    }
    packageDirs.push({ dir, manifest: installedManifest });

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
        integrity: integrityByKey.get(key) ?? resolved.integrity,
        dev: Boolean(devDeps[resolved.name]) && !(rootPkg.dependencies ?? {})[resolved.name],
        local: resolved.spec,
        link: resolved.kind === 'link',
      }),
    });
  }
  if (opts.lockfile !== false) {
    writeLockfile(vfs, opts.cwd, buildLockfile(rootPkg, lockPackages));
  }

  // ---- .bin shims -------------------------------------------------------

  const binEntries: BinEntry[] = [];
  for (const { dir, manifest } of packageDirs) {
    binEntries.push(...binEntriesFor(vfs, dir, manifest.name ?? p.basename(dir), manifest.bin));
  }
  const bins = writeBinShims(vfs, binEntries);
  warnings.push(...bins.warnings);
  if (bins.written.size > 0) log(`linked ${bins.written.size} bin(s): ${[...bins.written.keys()].sort().join(', ')}`);

  // ---- lifecycle scripts ------------------------------------------------

  const lifecycle: string[] = [];
  if (opts.host) {
    const scriptOptions = {
      host: opts.host,
      vfs,
      cwd: opts.cwd,
      initCwd: opts.cwd,
      baseEnv: opts.env ?? {},
      timeoutMs: opts.scriptTimeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS,
      ignoreScripts: opts.runScripts === false,
      warnings,
      onOutput: opts.onOutput,
      log,
    };
    const record = (outcomes: ScriptOutcome[]): void => {
      for (const outcome of outcomes) lifecycle.push(`${outcome.package} ${outcome.event}`);
    };
    // npm runs a dependency's scripts as it installs that dependency; running
    // them after the whole tree exists is a documented approximation that keeps
    // `.bin` shims available to every script.
    for (const { dir, manifest } of packageDirs) {
      record(await runDependencyScripts(scriptOptions, dir, manifest));
    }
    record(await runRootScripts(scriptOptions, { ...rootPkg, scripts: rootPkg.scripts }));
  } else if (opts.runScripts !== false) {
    warnings.push('lifecycle scripts skipped: no spawn surface was supplied');
  }

  return {
    packages: installed.length,
    installed,
    warnings,
    fromLockfile,
    binLinks: [...bins.written.keys()].sort(),
    lifecycle,
  };
}
