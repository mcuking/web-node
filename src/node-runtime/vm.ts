/**
 * CJS compilation helpers.
 *
 * Every module — vendored Node.js source or our own builtin — is executed with
 * Classic CommonJS semantics. `primordials` / `privateSymbols` /
 * `perIsolateSymbols` are injected as parameters because downstream Node lib
 * files reference them as free variables (in real Node they are globals wired
 * up by the C++ embedder).
 */

export type CjsExports = Record<string, unknown>;
export type CjsRequire = (request: string) => unknown;

export const CJS_PARAMS = [
  'exports',
  'require',
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

/** Wrap CJS source into a function. The generic parameter list keeps the shape identical to Node. */
export function compileCjs(source: string, filename: string): CjsFunction {
  try {
    // eslint-disable-next-line no-new-func
    return new Function(...(CJS_PARAMS as unknown as string[]), source) as unknown as CjsFunction;
  } catch (err) {
    throw new CompileError(filename, err);
  }
}
