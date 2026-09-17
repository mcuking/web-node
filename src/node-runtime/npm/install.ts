/**
 * npm installer.
 *
 * Resolves a project's dependency ranges against the registry, applies
 * npm-style hoisting (place as high in the `node_modules` tree as possible;
 * nest only on a version conflict), then downloads each package's tarball once
 * and extracts it into the virtual file system.
 *
 * Out of scope for this milestone (recorded as limitations): lifecycle scripts,
 * `.bin` shims, peer-dependency auto-install, lockfile read/write, integrity
 * verification and npm/yarn/pnpm filesystem specs (`file:`, `git+`, `link:`).
 */

import type { Vfs } from '../vfs';
import * as p from '../vfs/posix';
import { createRegistry, type FetchLike, type PackageManifest, type RegistryClient } from './registry';
import { extractTarball } from './tarball';
import { maxSatisfying } from './semver';

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
}

export interface InstallOptions {
  cwd: string;
  fetch: FetchLike;
  registry?: string | RegistryClient;
  includeDev?: boolean;
  log?: (message: string) => void;
  /** Safety valve against runaway graphs. */
  maxPackages?: number;
}

interface Placement {
  nmDir: string;
  name: string;
  version: string;
  manifest: PackageManifest;
}

function ensureDir(vfs: Vfs, dir: string): void {
  if (dir && dir !== '/') vfs.mkdir(dir, { recursive: true });
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
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
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const rootDeps: Record<string, string> = { ...(rootPkg.dependencies ?? {}) };
  if (opts.includeDev) Object.assign(rootDeps, rootPkg.devDependencies ?? {});

  if (Object.keys(rootDeps).length === 0) {
    log('nothing to install — no dependencies declared');
    return { packages: 0, installed: [], warnings: [] };
  }

  const nmRoot = p.join(opts.cwd, 'node_modules');
  const warnings: string[] = [];
  const placements: Placement[] = [];
  /** nodeModulesDir -> (packageName -> resolved version) */
  const placed = new Map<string, Map<string, string>>();
  let budget = opts.maxPackages ?? 512;

  const pickVersion = async (name: string, range: string): Promise<PackageManifest | null> => {
    const spec = (range ?? '').trim() || '*';
    if (/^(file:|link:|git\+|git:|https?:)/i.test(spec)) {
      warnings.push(`skipped ${name}: unsupported specifier "${spec}"`);
      return null;
    }
    const pack = await client.packument(name);
    const tagged = pack['dist-tags']?.[spec];
    const version = tagged ?? maxSatisfying(Object.keys(pack.versions), spec) ?? undefined;
    if (!version || !pack.versions[version]) {
      warnings.push(`no version of ${name} satisfies "${spec}"`);
      return null;
    }
    return pack.versions[version];
  };

  const placeDeps = async (deps: Record<string, string>, chain: string[], nestedUnder: string): Promise<void> => {
    for (const [name, range] of Object.entries(deps)) {
      let manifest: PackageManifest | null;
      try {
        manifest = await pickVersion(name, range);
      } catch (err) {
        warnings.push(`${name}: ${(err as Error).message}`);
        continue;
      }
      if (!manifest) continue;

      // Walk the chain root-first: reuse a compatible install, or take the
      // first level where the name is not yet occupied.
      let target: string | null = null;
      for (const nmDir of chain) {
        const existing = placed.get(nmDir)?.get(name);
        if (existing === undefined || existing === manifest.version) {
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
      if (here.get(name) === manifest.version) continue; // already satisfied here
      if (here.has(name)) {
        // Root-level conflict we cannot nest our way out of — keep the first.
        warnings.push(`version conflict for ${name} at ${target}; kept ${here.get(name)}, skipped ${manifest.version}`);
        continue;
      }

      if (budget-- <= 0) {
        warnings.push('package budget exceeded — stopping resolution');
        return;
      }

      here.set(name, manifest.version);
      log(`+ ${name}@${manifest.version}`);
      placements.push({ nmDir: target, name, version: manifest.version, manifest });

      const idx = chain.indexOf(target);
      const baseChain = idx >= 0 ? chain.slice(0, idx + 1) : [...chain, target];
      const childDir = p.join(target, name);
      await placeDeps(manifest.dependencies ?? {}, [...baseChain, p.join(childDir, 'node_modules')], childDir);
    }
  };

  await placeDeps(rootDeps, [nmRoot], opts.cwd);

  // Download + extract each distinct name@version once.
  const extracted = new Map<string, Awaited<ReturnType<typeof extractTarball>>>();
  const installed: InstalledPackage[] = [];

  for (const place of placements) {
    const key = `${place.name}@${place.version}`;
    let entries = extracted.get(key);
    if (!entries) {
      log(`↓ ${key}`);
      entries = await extractTarball(await client.tarball(place.manifest.dist.tarball));
      extracted.set(key, entries);
    }
    const dir = p.join(place.nmDir, place.name);
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
    installed.push({ name: place.name, version: place.version, path: dir });
  }

  return { packages: installed.length, installed, warnings };
}
