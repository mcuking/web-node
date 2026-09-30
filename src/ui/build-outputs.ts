import type { TreeEntry } from '../client';

/**
 * Which files a build produced, so the main worker can adopt them (M139).
 *
 * A build runs in a throwaway worker that never mirrors to the store; the page
 * pulls the results back and mounts them into the shared runtime worker, which is
 * the one that owns the visible tree. Everything under the project's output
 * directory counts, as does any file the build created that was not there before
 * (a bundler that writes somewhere else). Existing files outside the output
 * directory are left alone — re-reading a whole `node_modules` to move three
 * `dist` files would be pure waste.
 */
export function selectBuildOutputs(
  buildTree: readonly TreeEntry[],
  beforePaths: Iterable<string>,
  outputDir: string,
): string[] {
  const seen = new Set(beforePaths);
  const prefix = outputDir.replace(/\/+$/, '') + '/';
  const out: string[] = [];
  for (const entry of buildTree) {
    if (entry.type !== 'file') continue;
    if (entry.path.startsWith(prefix) || !seen.has(entry.path)) out.push(entry.path);
  }
  return out;
}
