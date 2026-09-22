import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';
import { VENDORED } from '../src/node-runtime/vendored';

/**
 * Structural guard for the `internal/errors` code table.
 *
 * A vendored module that pulls a code off `internal/errors` gets `undefined` if
 * the shim does not define it, and the `new ERR_X(...)` at the call site then
 * throws "is not a constructor" — a latent bug that only surfaces on the rare
 * path that reaches it (that is how ERR_NO_TEMPORAL, ERR_USE_AFTER_CLOSE and
 * friends were hiding). This walks the whole vendored tree, collects the codes
 * it references, and fails if any is missing from the table.
 */

/** Codes a source file pulls off `internal/errors`, destructured or inline. */
function referencedCodes(source: string): string[] {
  const found = new Set<string>();
  // `const { … } = require('internal/errors')` — one or more codes in the braces.
  for (const m of source.matchAll(/const\s*\{([\s\S]*?)\}\s*=\s*require\('internal\/errors'\)/g)) {
    for (const c of m[1].matchAll(/\b(ERR_[A-Z0-9_]+)\b/g)) found.add(c[1]);
  }
  // `require('internal/errors').codes.ERR_X`
  for (const m of source.matchAll(/require\('internal\/errors'\)\.codes\.(ERR_[A-Z0-9_]+)/g)) {
    found.add(m[1]);
  }
  return [...found];
}

describe('internal/errors table covers every referenced code', () => {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  const { codes } = runtime.realm.require('internal/errors') as { codes: Record<string, unknown> };

  const missing: string[] = [];
  const seen = new Set<string>();
  for (const [file, source] of Object.entries(VENDORED)) {
    for (const code of referencedCodes(source)) {
      seen.add(code);
      if (typeof codes[code] !== 'function') missing.push(`${code} (${file})`);
    }
  }

  it('scans a non-trivial number of codes', () => {
    expect(seen.size).toBeGreaterThan(50);
  });

  it('defines every referenced code as a constructor', () => {
    expect(missing).toEqual([]);
  });
});

/**
 * `E(code, msg, SystemError)` codes (`lib/internal/errors.js`).
 *
 * These are a different *kind* of class: `makeSystemErrorWithCode` builds the
 * message from a context object (`${prefix}: ${syscall} returned ${code}
 * (${message}) ${path} => ${dest}`) and sets `name='SystemError'`, rather than
 * filling `%s` placeholders. Registering them through the ordinary
 * `makeErrorClass` path leaves `name='Error'` and drops the suffix — and which
 * codes those are is easy to get wrong by hand, so pin the exact list.
 */
describe('internal/errors SystemError-based codes', () => {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  const { codes } = runtime.realm.require('internal/errors') as {
    codes: Record<string, any>;
  };

  // Every code `internal/errors.js` declares with `SystemError` as its base,
  // with the prefix text it was declared with (`getMessage(key, [], this)`).
  const SYSTEM_CODES: Record<string, string> = {
    ERR_FS_CP_DIR_TO_NON_DIR: 'Cannot overwrite non-directory with directory',
    ERR_FS_CP_EEXIST: 'Target already exists',
    ERR_FS_CP_EINVAL: 'Invalid src or dest',
    ERR_FS_CP_FIFO_PIPE: 'Cannot copy a FIFO pipe',
    ERR_FS_CP_NON_DIR_TO_DIR: 'Cannot overwrite directory with non-directory',
    ERR_FS_CP_SOCKET: 'Cannot copy a socket file',
    ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY: 'Cannot overwrite symlink in subdirectory of self',
    ERR_FS_CP_UNKNOWN: 'Cannot copy an unknown file type',
    ERR_FS_EISDIR: 'Path is a directory',
    ERR_SYSTEM_ERROR: 'A system error occurred',
    ERR_TTY_INIT_FAILED: 'TTY initialization failed',
  };

  it('formats from a context and is named SystemError', () => {
    const ctx = { syscall: 'cp', code: 'EINVAL', message: 'boom', errno: 22, path: '/a', dest: '/b' };
    for (const [code, prefix] of Object.entries(SYSTEM_CODES)) {
      const err = new codes[code](ctx);
      expect(err.name, code).toBe('SystemError');
      expect(err.code, code).toBe(code);
      expect(err.message, code).toBe(`${prefix}: cp returned EINVAL (boom) /a => /b`);
      // `info` carries the context, `errno`/`syscall`/`path`/`dest` read through.
      expect(err.info, code).toBe(ctx);
      expect(err.syscall, code).toBe('cp');
      expect(err.path, code).toBe('/a');
      expect(err.dest, code).toBe('/b');
      expect(String(err), code).toBe(`SystemError [${code}]: ${err.message}`);
    }
  });

  it('exposes the HideStackFramesError companion the call sites reach for', () => {
    // `os.js` throws `new ERR_SYSTEM_ERROR.HideStackFramesError(ctx)` and
    // `internal/fs/utils.js` uses `ERR_FS_EISDIR.HideStackFramesError`.
    for (const code of ['ERR_SYSTEM_ERROR', 'ERR_FS_EISDIR']) {
      const Variant = codes[code].HideStackFramesError;
      expect(typeof Variant, code).toBe('function');
      const err = new Variant({ syscall: 'stat', code: 'ENOENT', message: 'nope' });
      expect(err.code, code).toBe(code);
      expect(err.name, code).toBe('SystemError');
    }
  });
});
