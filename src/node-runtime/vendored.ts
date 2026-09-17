/**
 * Vendored Node.js source, loaded as raw text so we can compile it with real
 * CommonJS semantics at runtime (instead of letting the bundler transform it).
 *
 * `import.meta.glob` is resolved eagerly at build time, so this works both under
 * Vite (browser) and Vitest (node).
 */
const sources = import.meta.glob('../../vendor/node-lib/**/*.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const VENDORED: Record<string, string> = {};
for (const [abs, src] of Object.entries(sources)) {
  const rel = abs.replace(/^.*vendor\/node-lib\//, '');
  VENDORED[rel] = src;
}

export function vendoredSource(rel: string): string | undefined {
  return VENDORED[rel];
}

export const VENDORED_FILES = Object.keys(VENDORED).sort();
