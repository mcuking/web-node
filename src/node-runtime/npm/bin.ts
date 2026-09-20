/**
 * `.bin` shim generation.
 *
 * npm's own shims are POSIX shell scripts, which is precisely the thing this
 * runtime cannot execute. So the installer writes a JavaScript shim instead —
 * the one form that the controlled spawn surface *can* run — while keeping the
 * two properties that make npm's behaviour observable:
 *
 *   - the file lives at `node_modules/.bin/<name>` and is executable, so
 *     tooling that stats or lists the bin directory sees what it expects, and
 *   - running it runs the package's declared entry point, with `process.argv`
 *     pointing at that entry point rather than at the shim.
 *
 * The second property is why the shim carries a marker comment: `command.ts`
 * reads it during resolution and follows it. The `require(...)` line below the
 * marker is real code, so a shim that is `require`d directly still runs the
 * program.
 *
 * Unix only. Windows would additionally need `.cmd`/`.ps1` siblings, and this
 * runtime reports `platform: 'linux'`.
 */

import type { Vfs } from '../vfs';
import * as p from '../vfs/posix';
import { SHIM_MARKER } from '../proc/command';

export interface BinEntry {
  /** The command name (a `bin` key, or the package name for a string `bin`). */
  name: string;
  /** Absolute VFS path of the entry point the shim forwards to. */
  target: string;
  /** Which package declared it, for conflict warnings. */
  package: string;
}

/** Read a package's `bin` field into concrete entries. */
export function binEntriesFor(
  vfs: Vfs,
  packageDir: string,
  packageName: string,
  bin: string | Record<string, string> | undefined,
): BinEntry[] {
  if (!bin) return [];
  if (typeof bin === 'string') {
    // A string `bin` means "the variable part of the package name is the
    // command", which for a scoped package is the name without its scope.
    const command = packageName.includes('/') ? packageName.slice(packageName.indexOf('/') + 1) : packageName;
    return [{ name: command, target: p.resolve(packageDir, bin), package: packageName }];
  }
  return Object.entries(bin).map(([name, rel]) => ({
    name,
    target: p.resolve(packageDir, rel),
    package: packageName,
  }));
}

/** POSIX path from `from` to `to` (both absolute). */
function relativePosix(from: string, to: string): string {
  const a = p.resolve(from).split('/').filter(Boolean);
  const b = p.resolve(to).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

/** The text of a generated shim. Kept tiny and free of anything shell-shaped. */
export function renderShim(target: string, binDir: string): string {
  const relative = relativePosix(binDir, target);
  return [
    '#!/usr/bin/env node',
    `// ${SHIM_MARKER} ${relative}`,
    `require(${JSON.stringify(relative.startsWith('.') ? relative : `./${relative}`)});`,
    '',
  ].join('\n');
}

export interface BinResult {
  /** Command name -> `.bin` path that was written. */
  written: Map<string, string>;
  warnings: string[];
}

/**
 * Write every shim, one `.bin` directory per `node_modules`.
 *
 * npm keeps a bin directory beside each `node_modules` level, so a nested
 * install gets its own. A name collision at the same level keeps the first
 * writer and warns — npm errors outright there, but failing an entire install
 * over a duplicated command name is worse than reporting it.
 */
export function writeBinShims(vfs: Vfs, entries: BinEntry[]): BinResult {
  const written = new Map<string, string>();
  const warnings: string[] = [];
  const claimed = new Map<string, string>();

  for (const entry of entries) {
    // `<nm>/.bin/<name>` sits beside the package's own `node_modules`.
    const nmDir = p.dirname(entry.target) === '/' ? '/' : binDirFor(vfs, entry.target);
    const binDir = p.join(nmDir === '/' ? '' : nmDir, '.bin');
    const shimPath = p.join(binDir, entry.name);
    const key = `${binDir}\u0000${entry.name}`;

    const existing = claimed.get(key);
    if (existing && existing !== entry.package) {
      warnings.push(`duplicate bin "${entry.name}" in ${binDir}: kept ${existing}, skipped ${entry.package}`);
      continue;
    }
    claimed.set(key, entry.package);

    if (binDir && binDir !== '/') vfs.mkdir(binDir, { recursive: true });
    vfs.writeFile(shimPath, new TextEncoder().encode(renderShim(entry.target, binDir || '/')));
    vfs.chmod(shimPath, 0o755);
    written.set(entry.name, shimPath);
  }

  return { written, warnings };
}

/**
 * The `node_modules` a package belongs to: the nearest ancestor directory named
 * `node_modules`.
 */
function binDirFor(vfs: Vfs, target: string): string {
  let dir = p.dirname(target);
  while (dir !== '/' && p.basename(dir) !== 'node_modules') dir = p.dirname(dir);
  void vfs;
  return dir;
}
