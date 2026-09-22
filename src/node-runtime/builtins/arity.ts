/**
 * Align the observable `Function.prototype.length` of a module's exported
 * functions with Node's, without touching their signatures.
 *
 * `length` is a configurable own property, so redefining it is an exact
 * observable-equivalent port — feature detection that reads `fn.length`
 * (optional-argument probing and the like) then behaves exactly as on Node.
 * Only names that resolve to a function are touched; anything else is left as
 * is. Returns `target` so it can wrap a `return { … }` directly.
 */
export function alignArity<T extends object>(target: T, arity: Record<string, number>): T {
  for (const name of Object.keys(arity)) {
    const value = (target as Record<string, unknown>)[name];
    if (typeof value === 'function') {
      Object.defineProperty(value, 'length', { value: arity[name], configurable: true });
    }
  }
  return target;
}
