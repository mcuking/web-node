/**
 * Byte-output hook shared by the pure-JS asymmetric implementations.
 *
 * Node's `crypto` always hands back `Buffer`s (not bare `Uint8Array`s), and the
 * runtime's `Buffer` only exists inside a `NodeRuntime`. The pure-JS modules
 * therefore return plain `Uint8Array`s and let the builtin layer install a
 * factory that re-wraps them. The factory is attached per class (static) and per
 * instance (own property) using this symbol, so several runtimes can coexist.
 */
export type ByteFactory = (bytes: Uint8Array) => Uint8Array;

export const kByteFactory = Symbol('web-node.crypto.byteFactory');

type Carrier = { [kByteFactory]?: ByteFactory };

/** Encode `bytes`, then wrap it with the carrier's factory (if any). */
export function outputBytes(
  carrier: unknown,
  bytes: Uint8Array,
  encoding: unknown,
  encode: (bytes: Uint8Array, encoding: unknown) => Uint8Array | string,
): Uint8Array | string {
  const encoded = encode(bytes, encoding);
  if (typeof encoded === 'string') return encoded;
  const factory = (carrier as Carrier | undefined)?.[kByteFactory];
  return factory ? factory(encoded) : encoded;
}

/**
 * Wrap a constructor so every instance it produces carries the byte factory.
 *
 * Implemented with `Proxy` (not a subclass) on purpose: `Wrapped.prototype` is
 * `Base.prototype`, so `instanceof` and `Object.getOwnPropertyNames(Wrapped.prototype)`
 * stay exactly as Node exposes them.
 */
export function bufferedClass<T extends abstract new (...args: never[]) => object>(
  Base: T,
  factory: ByteFactory,
): T {
  const Wrapped = new Proxy(Base, {
    construct(target, args, newTarget) {
      const instance = Reflect.construct(target, args, newTarget);
      (instance as Carrier)[kByteFactory] = factory;
      return instance;
    },
    get(target, property, receiver) {
      // The per-wrapper factory lives on the proxy, not the shared target, so
      // `X.convertKey()` can pick it up without leaking across runtimes.
      if (property === kByteFactory) return factory;
      return Reflect.get(target, property, receiver);
    },
  });
  return Wrapped as unknown as T;
}
