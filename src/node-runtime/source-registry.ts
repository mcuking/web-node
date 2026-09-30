/**
 * Registry of the exact source text that was handed to V8 for each compiled
 * module, keyed by the URL we tag it with (`//# sourceURL=`).
 *
 * Why this exists: V8 stack frames only carry a file name / line / column, not
 * the line's text. Node reads the text from its internal `getErrorSourcePositions`
 * binding; userland JS cannot. Tagging each compiled unit with a `sourceURL` and
 * remembering the text lets us (a) show real file names in stack traces and
 * (b) reconstruct the offending source line for messages such as `assert.ok`'s
 * "The expression evaluated to a falsy value:".
 *
 * The compiled string is registered (not the pre-transform original) so its line
 * numbers line up exactly with the frames V8 reports.
 *
 * The registry is bounded. It is process-global and is *not* cleared by
 * `ModuleLoader.reset()` (a run reset drops the module cache but the tagged text
 * would stay behind), so across a long session — HMR recompiles, project
 * switches — it would otherwise accumulate every distinct module ever compiled
 * (a single webpack build alone is ~800 units / ~11 MB of text) just to improve
 * the wording of `assert` failures. A byte-budgeted LRU keeps only the most
 * recently compiled units. When a lookup misses, the consumer falls back to a
 * generic message; nothing else regresses.
 *
 * Note: bounding this map does not, on its own, shrink a build's retained heap,
 * because V8 already keeps a script's source alive while any of its functions
 * are reachable (measured: capping 11 MB -> 4 MB left post-GC heap unchanged).
 * The bound matters for the long-lived, many-module case above and keeps this
 * cache from being an unbounded process-global holder.
 */
export const SOURCE_REGISTRY_MAX_BYTES = 4 * 1024 * 1024;

/** Insertion-ordered LRU: first key is the coldest. */
const compiledSources = new Map<string, string>();
let totalBytes = 0;

/** Drop coldest entries until we are back under budget. Never evicts the newest. */
function evictToBudget(): void {
  while (totalBytes > SOURCE_REGISTRY_MAX_BYTES && compiledSources.size > 1) {
    const oldest = compiledSources.keys().next().value as string;
    const value = compiledSources.get(oldest);
    compiledSources.delete(oldest);
    if (value !== undefined) totalBytes -= value.length;
  }
}

export function registerCompiledSource(url: string, code: string): void {
  const prev = compiledSources.get(url);
  if (prev !== undefined) {
    totalBytes -= prev.length;
    compiledSources.delete(url);
  }
  compiledSources.set(url, code);
  totalBytes += code.length;
  evictToBudget();
}

export function getCompiledSource(url: string | undefined | null): string | undefined {
  if (url === undefined || url === null) return undefined;
  const value = compiledSources.get(url);
  if (value === undefined) return undefined;
  // Refresh recency so a module that actually hit an error stays resident.
  compiledSources.delete(url);
  compiledSources.set(url, value);
  return value;
}

/** Test helper: drop everything (the registry is process-global). */
export function clearCompiledSources(): void {
  compiledSources.clear();
  totalBytes = 0;
}

/** Test helper: current residency. */
export function compiledSourcesStats(): { entries: number; bytes: number } {
  return { entries: compiledSources.size, bytes: totalBytes };
}
