/**
 * Command resolution for the controlled spawn surface.
 *
 * A browser tab has no `execve`, so "running a program" here means exactly one
 * of two things: executing a JavaScript file through our own module loader, or
 * running the runtime's own `node` executable against a script. Everything else
 * is *refused*, loudly and by name — a native binary (a `.node` addon, an ELF
 * shipped for the host platform) cannot be executed no matter how much we would
 * like it to be.
 *
 * Keeping this resolution in one place is what makes the surface auditable:
 * there is a single function that decides what a command string turns into.
 *
 * Lookup order, mirroring a shell as closely as the VFS allows:
 *
 *   1. the `node` executable itself (`node`, `node.exe`, `process.execPath`)
 *   2. an explicit path (`./tools/x.js`, `/project/x.js`)
 *   3. `$PATH` directories (npm prepends `node_modules/.bin`, which is how
 *      `npm run` makes local bins visible)
 *   4. `node_modules/.bin/<name>`, walking up from the cwd
 *
 * Every `.bin` entry npm writes is a shell script, which we cannot execute; the
 * installer therefore writes a JavaScript shim instead (see `npm/bin.ts`). A
 * shim carries a marker comment naming the real entry point, and resolution
 * follows that marker so the program sees a truthful `process.argv[1]`.
 */

import type { Vfs } from '../vfs';
import * as p from '../vfs/posix';

/** Marker the installer writes into every generated `.bin` shim. */
export const SHIM_MARKER = 'web-node bin shim:';

export interface ResolveContext {
  vfs: Vfs;
  /** Directory the command runs in (a shell resolves relative to this). */
  cwd: string;
  env: Record<string, string>;
  /** Absolute path of the runtime's own `node` (`process.execPath`). */
  execPath: string;
}

export type Resolution =
  /** The runtime's own `node`, optionally against a script. */
  | { kind: 'node'; script: string | null; args: string[] }
  /** A JavaScript program in the VFS, executed through the module loader. */
  | { kind: 'program'; path: string; args: string[] }
  /** Recognised, but not executable here (native binary, shell script, …). */
  | { kind: 'unsupported'; reason: string; path: string }
  /** Nothing matched. */
  | { kind: 'missing' };

/** The command string a human would type, for error messages. */
export function displayCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

/** Is this the runtime's own `node` executable (under any of its aliases)? */
export function isNodeCommand(command: string, ctx: ResolveContext): boolean {
  if (command === ctx.execPath) return true;
  const base = p.basename(command);
  return base === 'node' || base === 'node.exe' || base === 'web-node';
}

/** First line of a file if it starts with `#!`, else null. */
function readShebang(vfs: Vfs, path: string): string | null {
  let head: Uint8Array;
  try {
    head = vfs.readFile(path).subarray(0, 256);
  } catch {
    return null;
  }
  if (head.length < 2 || head[0] !== 0x23 /* # */ || head[1] !== 0x21 /* ! */) return null;
  let end = 0;
  while (end < head.length && head[end] !== 0x0a && head[end] !== 0x0d) end += 1;
  return new TextDecoder().decode(head.subarray(0, end));
}

/** Split a shebang into its interpreter and its one optional argument. */
function parseShebang(shebang: string): { interpreter: string; arg: string | null } {
  const rest = shebang.replace(/^#!\s*/, '').trim();
  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { interpreter: '', arg: null };
  let interpreter = parts[0];
  let arg: string | null = parts[1] ?? null;
  // `#!/usr/bin/env node` names the interpreter indirectly.
  if (p.basename(interpreter) === 'env' && arg) {
    interpreter = arg;
    arg = parts[2] ?? null;
  }
  return { interpreter, arg };
}

/**
 * A `.bin` shim written by our own installer: the shebang says "node", and the
 * marker comment names the entry point the shim forwards to. Following it keeps
 * `process.argv[1]` pointing at the real program rather than at the shim.
 */
function followShim(vfs: Vfs, shimPath: string): string | null {
  let text: string;
  try {
    text = new TextDecoder().decode(vfs.readFile(shimPath).subarray(0, 4096));
  } catch {
    return null;
  }
  const line = text.split(/\r?\n/).find((l) => l.includes(SHIM_MARKER));
  if (!line) return null;
  const target = line.slice(line.indexOf(SHIM_MARKER) + SHIM_MARKER.length).trim();
  if (!target) return null;
  return p.resolve(p.dirname(shimPath), target);
}

/** Look for `name` in each directory of `$PATH`. */
function searchPath(ctx: ResolveContext, name: string): string | null {
  const path = ctx.env.PATH ?? ctx.env.path;
  if (!path) return null;
  for (const dir of path.split(':')) {
    if (!dir) continue;
    const candidate = p.join(p.resolve(dir), name);
    if (isFile(ctx.vfs, candidate)) return candidate;
  }
  return null;
}

/** `.bin` directories on the way up from the cwd (npm's local-bin lookup). */
function searchBinDirs(ctx: ResolveContext, name: string): string | null {
  const dirs = p.segments(ctx.cwd);
  for (let i = dirs.length; i >= 0; i--) {
    const binDir = '/' + dirs.slice(0, i).concat(['node_modules', '.bin']).join('/');
    const candidate = p.join(binDir, name);
    if (isFile(ctx.vfs, candidate)) return candidate;
  }
  return null;
}

function isFile(vfs: Vfs, path: string): boolean {
  if (!vfs.exists(path)) return false;
  try {
    return vfs.stat(path).type === 'file';
  } catch {
    return false;
  }
}

const JS_EXTENSIONS = ['.js', '.cjs', '.mjs'];

/**
 * Classify a concrete file as a runnable program, or explain why it is not.
 *
 * A file with no shebang is only assumed to be JavaScript when its extension
 * says so — otherwise it is almost certainly a native binary, and silently
 * feeding it to the module loader would produce a baffling syntax error instead
 * of an honest "cannot execute a native binary".
 */
export function resolveFile(ctx: ResolveContext, file: string, args: string[]): Resolution {
  const shebang = readShebang(ctx.vfs, file);
  if (shebang) {
    const { interpreter } = parseShebang(shebang);
    const interpBase = p.basename(interpreter);
    if (interpBase === 'node' || interpBase === 'node.exe' || interpBase === 'web-node') {
      const forwarded = followShim(ctx.vfs, file);
      if (forwarded) {
        if (!isFile(ctx.vfs, forwarded)) {
          return { kind: 'unsupported', path: file, reason: `the shim target ${forwarded} does not exist` };
        }
        return resolveFile(ctx, forwarded, args);
      }
      return { kind: 'program', path: file, args };
    }
    return {
      kind: 'unsupported',
      path: file,
      reason: `it is a script for "${interpreter}", and only JavaScript programs can be executed in a tab`,
    };
  }

  if (JS_EXTENSIONS.some((ext) => file.endsWith(ext))) return { kind: 'program', path: file, args };

  return {
    kind: 'unsupported',
    path: file,
    reason: 'it is a native executable (a browser tab cannot run ELF/Mach-O binaries or .node addons)',
  };
}

/**
 * Resolve `command` (+ args) to something the process host can run.
 *
 * `command` may itself carry a path separator; a bare name is looked up through
 * `$PATH` and then `node_modules/.bin`.
 */
export function resolveCommand(ctx: ResolveContext, command: string, args: string[]): Resolution {
  if (isNodeCommand(command, ctx)) {
    return resolveNodeArgs(ctx, args);
  }

  if (command.includes('/')) {
    const abs = p.resolve(ctx.cwd, command);
    if (!isFile(ctx.vfs, abs)) return { kind: 'missing' };
    return resolveFile(ctx, abs, args);
  }

  const fromPath = searchPath(ctx, command) ?? searchBinDirs(ctx, command);
  if (!fromPath) return { kind: 'missing' };
  return resolveFile(ctx, fromPath, args);
}

/**
 * Interpret `node`'s own argv.
 *
 * Only the flags a build script realistically passes are understood: `-e`/`-p`
 * (evaluate a snippet) and `--version`. Anything else that looks like a flag is
 * refused rather than ignored — silently dropping `--experimental-vm-modules`
 * would leave a very confusing failure in its place.
 */
function resolveNodeArgs(ctx: ResolveContext, args: string[]): Resolution {
  const rest = [...args];
  const passthrough: string[] = [];
  while (rest.length > 0) {
    const arg = rest[0];
    if (arg === '--') {
      rest.shift();
      break;
    }
    if (arg === '--version' || arg === '-v') return { kind: 'node', script: null, args: ['--version'] };
    if (arg === '-e' || arg === '--eval' || arg === '-p' || arg === '--print') {
      const code = rest[1];
      if (code === undefined) {
        return { kind: 'unsupported', path: ctx.execPath, reason: `${arg} needs a script argument` };
      }
      // `-e` and `-p` differ only in whether the result is printed; the shell
      // runner models the printing, so the flag is carried through verbatim.
      return { kind: 'node', script: null, args: [arg, code, ...rest.slice(2)] };
    }
    if (arg.startsWith('-')) {
      return { kind: 'unsupported', path: ctx.execPath, reason: `the node flag "${arg}" is not supported` };
    }
    break;
  }

  const script = rest.shift();
  if (script === undefined) return { kind: 'node', script: null, args: passthrough };
  const abs = p.resolve(ctx.cwd, script);
  // A missing script is *not* a failure to start: `node nope.js` starts, fails to
  // load the module, and exits 1. Treating it as a spawn failure would report
  // `'error'` for what Node reports as an ordinary exit — and `fork()` depends
  // on getting the exit.
  if (!isFile(ctx.vfs, abs)) return { kind: 'node', script: abs, args: rest };
  const resolution = resolveFile(ctx, abs, rest);
  // A `.bin` shim pointed at by an explicit `node <shim>` still forwards.
  return resolution;
}
