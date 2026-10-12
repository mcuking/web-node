/**
 * Browser capability detection (P2b).
 *
 * web-node needs two platform features to run at full fidelity:
 *
 *  - **Cross-origin isolation + `SharedArrayBuffer`.** The rspack wasm build
 *    imports a *shared* linear memory (its thread pool spawns pthreads through
 *    `@emnapi/wasi-threads`), the FS-worker persistence backend runs a blocking
 *    channel over shared memory, and `worker_threads` get real parallelism.
 *    Without `crossOriginIsolated` the browser refuses to construct a
 *    `SharedArrayBuffer`, so those paths cannot run and the UI must fall back
 *    (rspack's build otherwise wedges on the failed transfer).
 *  - **The Origin Private File System** (`navigator.storage.getDirectory`), the
 *    backend for the project store. Without it nothing survives a reload — the
 *    store is in-memory only.
 *
 * This module reports what the *current realm* actually supports so the UI can
 * name the mode it is in instead of failing opaquely. Detection is a pure
 * function of a "scope" object (defaulting to `globalThis`) so it is unit
 * testable without a DOM.
 */
export interface BrowserCapabilities {
  /** `self.crossOriginIsolated` — the precondition for a shared `SharedArrayBuffer`. */
  crossOriginIsolated: boolean;
  /** A `SharedArrayBuffer` constructor is present. */
  sharedArrayBuffer: boolean;
  /** OPFS is reachable (`navigator.storage.getDirectory`). */
  opfs: boolean;
  /** Real parallelism / shared memory are usable (isolation + constructor). */
  realParallelism: boolean;
  /** Projects persist across reloads. */
  persistence: boolean;
}

export interface CapabilityScope {
  crossOriginIsolated?: boolean;
  SharedArrayBuffer?: unknown;
  navigator?: { storage?: { getDirectory?: unknown } };
}

const DEFAULT_SCOPE = globalThis as unknown as CapabilityScope;

export function detectCapabilities(scope: CapabilityScope = DEFAULT_SCOPE): BrowserCapabilities {
  const crossOriginIsolated = scope.crossOriginIsolated === true;
  const sharedArrayBuffer = typeof scope.SharedArrayBuffer === 'function';
  const opfs = typeof scope.navigator?.storage?.getDirectory === 'function';
  return {
    crossOriginIsolated,
    sharedArrayBuffer,
    opfs,
    // A `SharedArrayBuffer` constructor is only exposed/usable under isolation,
    // so require both — a bare constructor check is not enough.
    realParallelism: crossOriginIsolated && sharedArrayBuffer,
    persistence: opfs,
  };
}

/** Machine-readable degraded-mode reasons, most severe first. */
export type CapabilityIssue = 'no-isolation' | 'no-opfs';

export function capabilityIssues(caps: BrowserCapabilities): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  if (!caps.realParallelism) issues.push('no-isolation');
  if (!caps.persistence) issues.push('no-opfs');
  return issues;
}

/** A short, user-facing sentence for a degraded-mode reason. */
export function capabilityMessage(issue: CapabilityIssue): string {
  switch (issue) {
    case 'no-isolation':
      return (
        'cross-origin isolation is off, so SharedArrayBuffer is unavailable — ' +
        'rspack builds and worker_threads run without real parallelism.'
      );
    case 'no-opfs':
      return 'the Origin Private File System is unavailable — projects will not persist across reloads (in-memory only).';
  }
}
