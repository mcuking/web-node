/**
 * CJS compilation helpers.
 *
 * Every module — vendored Node.js source or our own builtin — is executed with
 * Classic CommonJS semantics. `primordials` / `privateSymbols` /
 * `perIsolateSymbols` are injected as parameters because downstream Node lib
 * files reference them as free variables (in real Node they are globals wired
 * up by the C++ embedder).
 */

import { registerCompiledSource } from './source-registry';

type CjsExports = Record<string, unknown>;
export type CjsRequire = (request: string) => unknown;

export const CJS_PARAMS = [
  'exports',
  'require',
  'internalBinding',
  'module',
  '__filename',
  '__dirname',
  'primordials',
  'privateSymbols',
  'perIsolateSymbols',
] as const;

export type CjsFunction = (
  exports: CjsExports,
  require: CjsRequire,
  internalBinding: (name: string) => Record<string, unknown>,
  module: { exports: unknown },
  __filename: string,
  __dirname: string,
  primordials: Record<string, unknown>,
  privateSymbols: Record<string, symbol>,
  perIsolateSymbols: Record<string, symbol>,
) => void;

export class CompileError extends Error {
  filename: string;
  constructor(filename: string, cause: unknown) {
    super(`Failed to compile ${filename}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'CompileError';
    this.filename = filename;
  }
}

/**
 * Wrap CJS source into a function. The generic parameter list keeps the shape identical to Node.
 *
 * `extraParams` binds further free variables for the module body. Node's real
 * CJS wrapper only receives the five locals, and everything else (`process`,
 * `console`, timers) is a genuine global of the Node process. Here the module
 * body shares the ambient JS realm with the host page (a browser worker, or the
 * test runner under Vitest), so a bare `process` would resolve to whatever the
 * host happens to define — in Vitest that is the *host* Node process, and
 * `node:test`'s reporter then writes its report to the host's stdout instead of
 * the sandbox's. Binding these names as parameters makes the vendored code see
 * the sandbox's own globals wherever it runs.
 */
export function compileCjs(
  source: string,
  filename: string,
  extraParams: readonly string[] = [],
): (...args: unknown[]) => void {
  // Tag the unit with a `node:`-style URL so stack frames read like Node's
  // (`node:internal/util/inspect`) and remember the text for source-line recovery.
  try {
    const params = extraParams.length > 0 ? [...CJS_PARAMS, ...extraParams] : CJS_PARAMS;
    return compileTagged(params, source, `node:${filename}`) as unknown as (
      ...args: unknown[]
    ) => void;
  } catch (err) {
    throw new CompileError(filename, err);
  }
}

/**
 * Compile a source string into a function whose stack frames are attributed to
 * `url`, with line numbers that match the source one-to-one.
 *
 * Uses indirect `eval` rather than `new Function`: V8's `Function` wrapper eats
 * two leading lines, which would make every frame report `line + 2`. A one-line
 * function-expression wrapper around the body keeps the offset at zero, so the
 * `//# sourceURL=` tag yields correct file *and* line numbers. The body is also
 * registered so `internal/errors/error_source` can read the offending line back.
 */
export function compileTagged(
  params: readonly string[],
  body: string,
  url: string,
): (...args: unknown[]) => unknown {
  registerCompiledSource(url, body);
  const code = `(function(${params.join(',')}){${body}\n//# sourceURL=${url}\n})`;
  // eslint-disable-next-line no-eval
  return (0, eval)(code) as (...args: unknown[]) => unknown;
}
