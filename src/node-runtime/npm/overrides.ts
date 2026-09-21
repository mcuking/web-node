/**
 * npm `overrides` / yarn `resolutions`.
 *
 * A project can force a transitive dependency onto a chosen range without
 * editing the package that asked for it — the usual reason being a security
 * advisory or a broken release somewhere down the tree. The shapes we read are
 * npm's:
 *
 *   "overrides": { "foo": "1.2.3" }                    // foo anywhere in the tree
 *   "overrides": { "bar": { "foo": "1.2.3" } }         // foo, but only under bar
 *   "overrides": { "bar": { ".": "2.0.0" } }           // bar itself
 *   "overrides": { "bar": { "baz": { "foo": "1.2.3" } } }
 *   "overrides": { "foo": "$foo" }                     // "same range as the root dep"
 *
 * `resolutions` (yarn) is read as a flat table when `overrides` is absent.
 *
 * A rule is keyed by a *package-name path*: `["bar", "foo"]` means "foo when it
 * is (transitively) a dependency of bar". The most specific matching rule wins —
 * longest path, and on a tie the later one, which is npm's rule too.
 *
 * Two npm features are deliberately not supported:
 *   - version-scoped keys (`"foo@^1.2.0": "2.0.0"`), which scope by the range a
 *     dependent asked for. They are reported in `ignored` rather than guessed at,
 *     so an install can warn instead of silently pinning the wrong thing.
 *   - `$`-prefixed *keys* (they are only meaningful on values).
 */

export interface OverrideRule {
  /** Package-name path, root-first (`['bar', 'foo']`). */
  path: string[];
  /** The replacement range that won the `$ref` resolution. */
  spec: string;
}

export interface OverrideTable {
  rules: OverrideRule[];
  /** Keys that were recognised but are outside the supported subset. */
  ignored: string[];
  /**
   * The override range for `name` at a point in the tree, or `undefined`.
   * `ancestors` are the package names from the root down to `name`'s parent.
   */
  find(name: string, ancestors: readonly string[]): string | undefined;
}

export interface OverrideRoot {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: unknown;
  resolutions?: unknown;
}

/** `foo` → `{ name: 'foo' }`; `foo@^1` → `{ name: 'foo', range: '^1' }`. */
export function parseOverrideKey(key: string): { name: string; range?: string } {
  if (key === '.') return { name: '.' };
  // A scoped name (`@scope/pkg`) contains the only `/` *before* any version `@`,
  // so start searching after it.
  const searchFrom = key.startsWith('@') ? key.indexOf('/') : 0;
  if (searchFrom === -1) return { name: key };
  const at = key.indexOf('@', searchFrom);
  if (at <= 0 || at === key.length - 1) return { name: key };
  return { name: key.slice(0, at), range: key.slice(at + 1) };
}

/** Is `needle` an ordered subsequence of `haystack`? */
function isSubsequence(needle: readonly string[], haystack: readonly string[]): boolean {
  let i = 0;
  for (const item of haystack) {
    if (i < needle.length && needle[i] === item) i += 1;
  }
  return i === needle.length;
}

export function buildOverrideTable(root: OverrideRoot): OverrideTable {
  const rules: OverrideRule[] = [];
  const ignored: string[] = [];
  const refs = new Map<string, string>();
  for (const [name, spec] of Object.entries(root.dependencies ?? {})) refs.set(name, spec);
  for (const [name, spec] of Object.entries(root.devDependencies ?? {})) {
    if (!refs.has(name)) refs.set(name, spec);
  }

  const usingOverrides = root.overrides !== undefined && root.overrides !== null;
  const source = usingOverrides ? 'overrides' : 'resolutions';
  const table = usingOverrides ? root.overrides : root.resolutions;

  const label = (path: readonly string[]): string => (path.length ? `${source}.${path.join('.')}` : source);

  const valueFor = (spec: string, path: readonly string[]): string | undefined => {
    if (!spec.startsWith('$')) return spec;
    const resolved = refs.get(spec.slice(1));
    if (resolved === undefined) {
      ignored.push(`${label(path)} ("${spec}" does not name a root dependency)`);
      return undefined;
    }
    return resolved;
  };

  const walk = (node: unknown, path: string[]): void => {
    if (node === null || typeof node !== 'object') {
      if (typeof node !== 'string') ignored.push(label(path));
      return;
    }
    for (const [rawKey, value] of Object.entries(node as Record<string, unknown>)) {
      const keyPath = [...path, rawKey];
      if (rawKey.startsWith('$')) {
        ignored.push(`${label(keyPath)} ($-prefixed keys are not supported)`);
        continue;
      }
      const { name, range } = parseOverrideKey(rawKey);
      if (range !== undefined) {
        ignored.push(`${label(keyPath)} (version-scoped keys are not supported)`);
        continue;
      }
      const childPath = name === '.' ? path : [...path, name];
      if (childPath.length === 0) {
        ignored.push(`${label(keyPath)} (no package named)`);
        continue;
      }
      if (typeof value === 'string') {
        const spec = valueFor(value, childPath);
        if (spec !== undefined) rules.push({ path: childPath, spec });
      } else if (value !== null && typeof value === 'object') {
        walk(value, childPath);
      } else {
        ignored.push(`${label(childPath)} (expected a range or a nested object)`);
      }
    }
  };

  if (typeof table === 'string') {
    ignored.push(`${source} (expected an object)`);
  } else if (table !== undefined && table !== null) {
    walk(table, []);
  }

  const find = (name: string, ancestors: readonly string[]): string | undefined => {
    let best: OverrideRule | undefined;
    for (const rule of rules) {
      if (rule.path[rule.path.length - 1] !== name) continue;
      if (!isSubsequence(rule.path.slice(0, -1), ancestors)) continue;
      // Longest path wins; a later rule wins a tie (npm's rule).
      if (!best || rule.path.length >= best.path.length) best = rule;
    }
    return best?.spec;
  };

  return { rules, ignored, find };
}
