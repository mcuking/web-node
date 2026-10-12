/**
 * The default host-worker factory for a real thread (M147, Phase B).
 *
 * Kept in its own module because the `new Worker(new URL(...))` literal is what
 * Vite's worker plugin statically rewrites into a nested worker chunk — and that
 * literal must not sit in a module the whole runtime (and every test) imports
 * unless a real thread is actually being spawned.
 */

import type { SpawnedThread } from './real-worker';
import type { WorkerRequest } from './worker';

/** Spawn a real browser `Worker` running `thread.worker.ts`. */
export function spawnThreadWorker(_request: WorkerRequest): SpawnedThread {
  // The options object must be a **static literal**: Vite only rewrites a worker
  // it can parse statically (a computed `name:` makes the whole expression
  // unparseable). The thread learns its name from the init message instead.
  return new Worker(new URL('../../worker/thread.worker.ts', import.meta.url), { type: 'module' });
}
