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
 */
const compiledSources = new Map<string, string>();

export function registerCompiledSource(url: string, code: string): void {
  compiledSources.set(url, code);
}

export function getCompiledSource(url: string | undefined | null): string | undefined {
  if (url === undefined || url === null) return undefined;
  return compiledSources.get(url);
}

/** Test helper: drop everything (the registry is process-global). */
export function clearCompiledSources(): void {
  compiledSources.clear();
}
