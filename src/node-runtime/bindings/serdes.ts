import type { BindingContext, BindingFactory } from './context';

/**
 * The `serdes` binding: V8's structured-clone wire format, in JavaScript.
 *
 * Node's `v8.serialize`/`v8.deserialize` are a thin JS shell (`lib/v8.js`)
 * around this binding, whose `Serializer`/`Deserializer` classes are normally
 * C++ wrappers for V8's `ValueSerializer`/`ValueDeserializer`. A browser tab
 * cannot reach those objects, so the whole wire format is reimplemented here,
 * tag for tag, from `deps/v8/src/objects/value-serializer.cc`.
 *
 * The format (V8 serialization version 15):
 *
 *   header    `0xFF` (kVersion) + varint version
 *   tags      one byte each, except `kPadding` (`0x00`) which readers skip
 *   integers  base-128 varints; signed values ZigZag-encoded
 *   strings   `0x22` Latin-1 (varint byte length + bytes) or `0x63` UTF-16LE,
 *             the latter preceded by a `0x00` pad when that keeps it aligned
 *   objects   assigned increasing ids on first visit; a repeat visit emits
 *             `0x5E` + varint id
 *
 * Every expectation is pinned against a real Node (oracle `fnm v26.9.0`). The
 * handful of places where a JS reimplementation cannot reproduce V8 exactly
 * (the elements-kind history of an array, the message text for exotic clone
 * failures, proxies) are called out in the comments and in `docs/DEVLOG.md`.
 */

/* ------------------------------------------------------------------ tags -- */

const T = {
  VERSION: 0xff,
  PADDING: 0x00,
  VERIFY_OBJECT_COUNT: 0x3f,
  THE_HOLE: 0x2d,
  UNDEFINED: 0x5f,
  NULL: 0x30,
  TRUE: 0x54,
  FALSE: 0x46,
  INT32: 0x49,
  UINT32: 0x55,
  DOUBLE: 0x4e,
  BIGINT: 0x5a,
  UTF8_STRING: 0x53,
  ONE_BYTE_STRING: 0x22,
  TWO_BYTE_STRING: 0x63,
  OBJECT_REFERENCE: 0x5e,
  BEGIN_JS_OBJECT: 0x6f,
  END_JS_OBJECT: 0x7b,
  BEGIN_SPARSE_JS_ARRAY: 0x61,
  END_SPARSE_JS_ARRAY: 0x40,
  BEGIN_DENSE_JS_ARRAY: 0x41,
  END_DENSE_JS_ARRAY: 0x24,
  DATE: 0x44,
  TRUE_OBJECT: 0x79,
  FALSE_OBJECT: 0x78,
  NUMBER_OBJECT: 0x6e,
  BIGINT_OBJECT: 0x7a,
  STRING_OBJECT: 0x73,
  REGEXP: 0x52,
  BEGIN_JS_MAP: 0x3b,
  END_JS_MAP: 0x3a,
  BEGIN_JS_SET: 0x27,
  END_JS_SET: 0x2c,
  ARRAY_BUFFER: 0x42,
  IMMUTABLE_ARRAY_BUFFER: 0x43,
  RESIZABLE_ARRAY_BUFFER: 0x7e,
  ARRAY_BUFFER_TRANSFER: 0x74,
  ARRAY_BUFFER_VIEW: 0x56,
  SHARED_ARRAY_BUFFER: 0x75,
  HOST_OBJECT: 0x5c,
  ERROR: 0x72,
} as const;

/** `ErrorTag` — the sub-tags inside a serialized `Error`. */
const E = {
  EVAL: 0x45,
  RANGE: 0x52,
  REFERENCE: 0x46,
  SYNTAX: 0x53,
  TYPE: 0x54,
  URI: 0x55,
  MESSAGE: 0x6d,
  CAUSE: 0x63,
  STACK: 0x73,
  END: 0x2e,
} as const;

/** `ArrayBufferViewTag` — the sub-tag inside a real (non-host) ABV. */
const ABV_TAG: Record<string, number> = {
  Int8Array: 0x62,
  Uint8Array: 0x42,
  Uint8ClampedArray: 0x43,
  Int16Array: 0x77,
  Uint16Array: 0x57,
  Int32Array: 0x64,
  Uint32Array: 0x44,
  Float16Array: 0x68,
  Float32Array: 0x66,
  Float64Array: 0x46,
  BigInt64Array: 0x71,
  BigUint64Array: 0x51,
  DataView: 0x3f,
};

/**
 * `JSRegExp::Flags` as Node v26.9.0 emits them. `0x40` (64) is an internal
 * V8 flag with no JS spelling, which is why `d` is 128 and `v` is 256.
 */
const REGEXP_FLAGS: [string, string, number][] = [
  ['g', 'global', 1],
  ['i', 'ignoreCase', 2],
  ['m', 'multiline', 4],
  ['y', 'sticky', 8],
  ['u', 'unicode', 16],
  ['s', 'dotAll', 32],
  ['d', 'hasIndices', 128],
  // `unicodeSets` (the `v` flag) postdates the ES2022 lib this project targets.
  ['v', 'unicodeSets', 256],
];

/** The `FastBuffer` slot in `lib/v8.js`'s `arrayBufferViewTypeToIndex`. */
const FAST_BUFFER_INDEX = 10;

const LATEST_VERSION = 15;

/* ---------------------------------------------------------------- writer -- */

/** Base-128 varint length, i.e. the byte count `WriteVarint` would use. */
function varintLength(value: number): number {
  let n = 0;
  do {
    n++;
    value = Math.floor(value / 128);
  } while (value > 0);
  return n;
}

function zigzag32(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

class ByteWriter {
  private buf = new Uint8Array(256);
  length = 0;

  private ensure(extra: number): void {
    const need = this.length + extra;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  byte(value: number): void {
    this.ensure(1);
    this.buf[this.length++] = value & 0xff;
  }

  bytes(source: Uint8Array): void {
    if (source.length === 0) return;
    this.ensure(source.length);
    this.buf.set(source, this.length);
    this.length += source.length;
  }

  varint(value: number | bigint): void {
    let v = typeof value === 'bigint' ? value : BigInt(value);
    for (;;) {
      const low = Number(v & 0x7fn);
      v >>= 7n;
      if (v === 0n) {
        this.byte(low);
        return;
      }
      this.byte(low | 0x80);
    }
  }

  zigzag32(value: number): void {
    this.varint(zigzag32(value));
  }

  double(value: number): void {
    this.ensure(8);
    new DataView(this.buf.buffer, this.buf.byteOffset + this.length, 8).setFloat64(0, value, true);
    this.length += 8;
  }

  /** A copy of the bytes written so far. */
  take(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/* ----------------------------------------------------------------- errors -- */

/**
 * `% could not be cloned.` — V8 renders the offending value with
 * `Object::NoSideEffectsToString`, which yields the source text for callables,
 * `String(sym)` for symbols, `[object Tag]` for receivers that keep a custom
 * `toString` (iterators, generators, symbol wrappers) and `#<Ctor>` otherwise.
 *
 * The last two branches are matched structurally rather than by V8 instance
 * type: an exotic receiver whose shape we cannot read is reported as
 * `#<Constructor>`, which is what V8 prints for ordinary objects.
 */
function describeForCloneError(value: unknown): string {
  if (typeof value === 'function') {
    // V8 truncates long sources; ours are verbatim.
    return Function.prototype.toString.call(value);
  }
  if (typeof value === 'symbol') return String(value);
  if (value === null || typeof value !== 'object') return String(value);

  const object = value as Record<string | symbol, unknown>;
  let tag: string;
  try {
    tag = Object.prototype.toString.call(value);
  } catch {
    tag = '[object Object]';
  }
  try {
    if (
      typeof (object as { next?: unknown }).next === 'function' &&
      typeof object[Symbol.toStringTag] === 'string'
    ) {
      return tag;
    }
    if (typeof object.valueOf === 'function' && typeof object.valueOf() === 'symbol') {
      return tag;
    }
  } catch {
    /* a throwing valueOf/next is not worth a second error */
  }
  const ctor = object.constructor as { name?: unknown } | undefined;
  const name = typeof ctor === 'function' && typeof ctor.name === 'string' && ctor.name ? ctor.name : 'Object';
  return `#<${name}>`;
}

/* -------------------------------------------------------------- receiver -- */

/**
 * Receiver kinds V8 refuses to clone because they are special-cased in
 * `WriteJSReceiver`'s instance-type switch with no serialization branch.
 * `Proxy` is deliberately absent: JavaScript cannot see through one, so a
 * proxy of an ordinary object serializes as that object here (documented
 * deviation; V8 throws `#<Object> could not be cloned.`).
 */
function rejectKind(value: object): string | null {
  if (value instanceof WeakMap) return '#<WeakMap>';
  if (value instanceof WeakSet) return '#<WeakSet>';
  if (value instanceof WeakRef) return '#<WeakRef>';
  if (value instanceof FinalizationRegistry) return '#<FinalizationRegistry>';
  if (typeof Promise !== 'undefined' && value instanceof Promise) return '#<Promise>';
  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) {
    return '#<SharedArrayBuffer>';
  }
  const asRecord = value as Record<string | symbol, unknown>;
  if (typeof asRecord.next === 'function' && typeof asRecord[Symbol.toStringTag] === 'string') {
    return Object.prototype.toString.call(value);
  }
  return null;
}

/* ------------------------------------------------------------- serializer -- */

interface HostObjectWriter {
  _writeHostObject(value: object): void;
}

class Serializer implements HostObjectWriter {
  private writer = new ByteWriter();
  private ids = new WeakMap<object, number>();
  private nextId = 0;
  private treatArrayBufferViewsAsHostObjects = false;
  private transfers = new Map<ArrayBuffer, number>();
  private released = false;
  private ctx: BindingContext;

  constructor(ctx: BindingContext) {
    this.ctx = ctx;
  }

  private dataCloneError(message: string): Error {
    const Ctor =
      (this as unknown as { _getDataCloneError?: new (m: string) => Error })._getDataCloneError ?? Error;
    return new Ctor(message);
  }

  private failClone(value: unknown): never {
    throw this.dataCloneError(`${describeForCloneError(value)} could not be cloned.`);
  }

  private failKind(text: string): never {
    throw this.dataCloneError(`${text} could not be cloned.`);
  }

  /* -- low-level surface used by `lib/v8.js` -- */

  writeHeader(): void {
    this.writer.byte(T.VERSION);
    this.writer.varint(LATEST_VERSION);
  }

  writeUint32(value: number): void {
    this.writer.varint(value >>> 0);
  }

  writeUint64(hi: number, lo: number): void {
    this.writer.varint((BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0));
  }

  writeDouble(value: number): void {
    this.writer.double(value);
  }

  writeRawBytes(source: unknown): void {
    if (!ArrayBuffer.isView(source)) {
      throw this.invalidArgType('source', ['TypedArray', 'DataView'], source);
    }
    const view = source as ArrayBufferView;
    this.writer.bytes(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }

  _setTreatArrayBufferViewsAsHostObjects(mode: unknown): void {
    this.treatArrayBufferViewsAsHostObjects = !!mode;
  }

  releaseBuffer(): unknown {
    // V8's `Release()` hands the bytes over and empties the serializer; a
    // second release therefore yields a zero-length Buffer.
    const bytes = this.released ? new Uint8Array(0) : this.writer.take();
    this.released = true;
    return this.toBuffer(bytes);
  }

  transferArrayBuffer(id: unknown, arrayBuffer: unknown): void {
    if (!(arrayBuffer instanceof ArrayBuffer)) {
      throw this.invalidArgType('arrayBuffer', 'ArrayBuffer', arrayBuffer);
    }
    // Keyed the way V8 stores it: the buffer knows its transfer id, so writing
    // it later can emit `kArrayBufferTransfer`.
    this.transfers.set(arrayBuffer, Number(id) >>> 0);
  }

  writeValue(value: unknown): boolean {
    this.writeObject(value);
    return true;
  }

  private toBuffer(bytes: Uint8Array): unknown {
    const Buffer = (
      this.ctx.requireBuiltin?.('buffer') as
        | { Buffer?: { from(b: ArrayBufferLike, o: number, l: number): unknown } }
        | undefined
    )?.Buffer;
    if (!Buffer) return bytes;
    // `releaseBuffer` hands out a standalone allocation, like `node::Buffer::New`.
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer;
    return Buffer.from(ab, 0, bytes.length);
  }

  private invalidArgType(name: string, expected: string | string[], actual: unknown): Error {
    const errors = this.ctx.requireBuiltin?.('internal/errors') as
      | { codes?: Record<string, new (...a: unknown[]) => Error> }
      | undefined;
    const Ctor = errors?.codes?.ERR_INVALID_ARG_TYPE;
    if (Ctor) return new Ctor(name, expected, actual);
    return new TypeError(`The "${name}" argument must be a ${(Array.isArray(expected) ? expected : [expected]).join(' or ')}`);
  }

  /* -- object graph -- */

  private writeObject(value: unknown): void {
    switch (typeof value) {
      case 'number':
        if (Number.isInteger(value) && !Object.is(value, -0) && value >= -2147483648 && value <= 2147483647) {
          this.writer.byte(T.INT32);
          this.writer.zigzag32(value);
        } else {
          this.writer.byte(T.DOUBLE);
          this.writer.double(value);
        }
        return;
      case 'bigint':
        this.writer.byte(T.BIGINT);
        this.writeBigIntContents(value);
        return;
      case 'string':
        this.writeString(value);
        return;
      case 'symbol':
      case 'function':
        this.failClone(value);
        break;
      case 'object':
        break;
      default:
        // `undefined`, `boolean` — the remaining oddballs.
        break;
    }
    if (value === undefined) return void this.writer.byte(T.UNDEFINED);
    if (value === null) return void this.writer.byte(T.NULL);
    if (value === true) return void this.writer.byte(T.TRUE);
    if (value === false) return void this.writer.byte(T.FALSE);
    // A real (non-host) view has its buffer written *before* its own id is
    // handed out, so the two ids stay in V8's order.
    if (
      ArrayBuffer.isView(value) &&
      !this.treatArrayBufferViewsAsHostObjects &&
      this.ids.get(value as object) === undefined
    ) {
      this.writeJSReceiver((value as ArrayBufferView).buffer as object);
    }
    this.writeJSReceiver(value as object);
  }

  private writeJSReceiver(value: object): void {
    const existing = this.ids.get(value);
    if (existing !== undefined) {
      this.writer.byte(T.OBJECT_REFERENCE);
      this.writer.varint(existing);
      return;
    }
    this.ids.set(value, this.nextId++);
    this.writeReceiverBody(value);
  }

  private writeReceiverBody(value: object): void {
    if (Array.isArray(value)) return this.writeArray(value);
    if (value instanceof Date) {
      this.writer.byte(T.DATE);
      this.writer.double(value.getTime());
      return;
    }
    if (value instanceof RegExp) {
      this.writer.byte(T.REGEXP);
      this.writeString(value.source);
      this.writer.varint(regExpFlags(value));
      return;
    }
    if (value instanceof Map) return this.writeMap(value);
    if (value instanceof Set) return this.writeSet(value);
    if (value instanceof ArrayBuffer) return this.writeArrayBuffer(value);
    if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) {
      this.failClone(value);
    }
    if (value instanceof Boolean || value instanceof Number || value instanceof String || isBigIntObject(value)) {
      return this.writePrimitiveWrapper(value);
    }
    if (value instanceof Error) return this.writeError(value);

    const rejected = rejectKind(value);
    if (rejected !== null) this.failKind(rejected);

    if (ArrayBuffer.isView(value)) {
      if (this.treatArrayBufferViewsAsHostObjects) {
        // V8 writes the `kHostObject` tag itself, then hands control to the
        // delegate (`lib/v8.js`'s `_writeHostObject`).
        this.writer.byte(T.HOST_OBJECT);
        return this._writeHostObject(value as object);
      }
      return this.writeArrayBufferView(value as ArrayBufferView);
    }
    return this.writeObjectGraph(value);
  }

  /**
   * Plain objects, class instances and anything else with ordinary data
   * properties. V8's fast path walks map descriptors; the slow path (which a
   * non-empty elements store forces) collects own enumerable string keys with
   * `kKeepNumbers`, so integer-like keys stay numbers and sort first — exactly
   * what `Object.keys` gives, with the key turned back into a number.
   */
  private writeObjectGraph(value: object): void {
    this.writer.byte(T.BEGIN_JS_OBJECT);
    let written = 0;
    for (const key of Object.keys(value)) {
      const numeric = keyAsArrayIndex(key);
      this.writeObject(numeric === null ? key : numeric);
      this.writeObject((value as Record<string, unknown>)[key]);
      written++;
    }
    this.writer.byte(T.END_JS_OBJECT);
    this.writer.varint(written);
  }

  /**
   * A dense array is `PACKED_*` in V8; anything holey goes sparse. We cannot
   * see the elements kind, so the numeric shape stands in for it: an array
   * whose elements are all int32 integers is `PACKED_SMI` (each element a
   * ZigZag int32), an all-numeric array is `PACKED_DOUBLE` (each element a
   * raw double), and one with any non-number is `PACKED_ELEMENTS` (each element
   * written generically). A V8 array can keep a double-kind after its doubles
   * are overwritten by ints; that history is unobservable from JS and is the
   * documented difference.
   */
  private writeArray(value: unknown[]): void {
    const length = value.length;
    let holey = false;
    for (let i = 0; i < length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        holey = true;
        break;
      }
    }

    if (!holey) {
      this.writer.byte(T.BEGIN_DENSE_JS_ARRAY);
      this.writer.varint(length);
      let allNumbers = true;
      let allSmi = true;
      for (let i = 0; i < length; i++) {
        const element = value[i];
        if (typeof element !== 'number') {
          allNumbers = false;
          break;
        }
        if (!Number.isInteger(element) || Object.is(element, -0) || element < -2147483648 || element > 2147483647) {
          allSmi = false;
        }
      }
      if (allNumbers && allSmi) {
        for (let i = 0; i < length; i++) {
          this.writer.byte(T.INT32);
          this.writer.zigzag32(value[i] as number);
        }
      } else if (allNumbers) {
        for (let i = 0; i < length; i++) {
          this.writer.byte(T.DOUBLE);
          this.writer.double(value[i] as number);
        }
      } else {
        for (let i = 0; i < length; i++) this.writeObject(value[i]);
      }
      let written = 0;
      for (const key of Object.keys(value)) {
        if (isIndexBelow(key, length)) continue;
        this.writeObject(key);
        this.writeObject((value as unknown as Record<string, unknown>)[key]);
        written++;
      }
      this.writer.byte(T.END_DENSE_JS_ARRAY);
      this.writer.varint(written);
      this.writer.varint(length);
      return;
    }

    this.writer.byte(T.BEGIN_SPARSE_JS_ARRAY);
    this.writer.varint(length);
    let written = 0;
    for (const key of Object.keys(value)) {
      const numeric = keyAsArrayIndex(key);
      this.writeObject(numeric === null ? key : numeric);
      this.writeObject((value as unknown as Record<string, unknown>)[key]);
      written++;
    }
    this.writer.byte(T.END_SPARSE_JS_ARRAY);
    this.writer.varint(written);
    this.writer.varint(length);
  }

  private writeMap(value: Map<unknown, unknown>): void {
    this.writer.byte(T.BEGIN_JS_MAP);
    let count = 0;
    for (const [key, entry] of value) {
      this.writeObject(key);
      this.writeObject(entry);
      count += 2;
    }
    this.writer.byte(T.END_JS_MAP);
    this.writer.varint(count);
  }

  private writeSet(value: Set<unknown>): void {
    this.writer.byte(T.BEGIN_JS_SET);
    let count = 0;
    for (const element of value) {
      this.writeObject(element);
      count++;
    }
    this.writer.byte(T.END_JS_SET);
    this.writer.varint(count);
  }

  private writeArrayBuffer(value: ArrayBuffer): void {
    const transferId = this.transfers.get(value);
    if (transferId !== undefined) {
      this.writer.byte(T.ARRAY_BUFFER_TRANSFER);
      this.writer.varint(transferId);
      return;
    }
    if ((value as { detached?: boolean }).detached) this.failClone(value);
    this.writer.byte(T.ARRAY_BUFFER);
    this.writer.varint(value.byteLength);
    this.writer.bytes(new Uint8Array(value));
  }

  /** The buffer was already emitted by `writeObject` at the right moment. */
  private writeArrayBufferView(view: ArrayBufferView): void {
    const name = view.constructor?.name ?? 'DataView';
    this.writer.byte(T.ARRAY_BUFFER_VIEW);
    this.writer.varint(ABV_TAG[name] ?? ABV_TAG.DataView);
    this.writer.varint(view.byteOffset);
    this.writer.varint(view.byteLength);
    this.writer.varint(0);
  }

  private writePrimitiveWrapper(value: object): void {
    if (value instanceof Boolean) {
      this.writer.byte(value.valueOf() ? T.TRUE_OBJECT : T.FALSE_OBJECT);
      return;
    }
    if (value instanceof Number) {
      this.writer.byte(T.NUMBER_OBJECT);
      this.writer.double(value.valueOf());
      return;
    }
    if (isBigIntObject(value)) {
      this.writer.byte(T.BIGINT_OBJECT);
      this.writeBigIntContents((value as { valueOf(): bigint }).valueOf());
      return;
    }
    this.writer.byte(T.STRING_OBJECT);
    this.writeString(String((value as String).valueOf()));
  }

  private writeError(value: Error): void {
    this.writer.byte(T.ERROR);
    const name = String((value as { name?: unknown }).name);
    if (name === 'EvalError') this.writer.varint(E.EVAL);
    else if (name === 'RangeError') this.writer.varint(E.RANGE);
    else if (name === 'ReferenceError') this.writer.varint(E.REFERENCE);
    else if (name === 'SyntaxError') this.writer.varint(E.SYNTAX);
    else if (name === 'TypeError') this.writer.varint(E.TYPE);
    else if (name === 'URIError') this.writer.varint(E.URI);

    const message = Object.getOwnPropertyDescriptor(value, 'message');
    if (message && 'value' in message) {
      this.writer.varint(E.MESSAGE);
      this.writeString(String(message.value));
    }
    const stack = (value as { stack?: unknown }).stack;
    if (typeof stack === 'string') {
      this.writer.varint(E.STACK);
      this.writeString(stack);
    }
    const cause = Object.getOwnPropertyDescriptor(value, 'cause');
    if (cause && 'value' in cause) {
      this.writer.varint(E.CAUSE);
      this.writeObject(cause.value);
    }
    this.writer.varint(E.END);
  }

  private writeBigIntContents(value: bigint): void {
    const negative = value < 0n;
    let magnitude = negative ? -value : value;
    let digits = 0;
    while (magnitude > 0n) {
      magnitude >>= 64n;
      digits += 1;
    }
    // `GetBitfieldForSerialization`: the byte length (in bytes, always a
    // multiple of 8) in the high bits, sign in bit 0. Digits follow
    // little-endian.
    this.writer.varint((digits * 16) | (negative ? 1 : 0));
    if (digits === 0) return;
    let remaining = negative ? -value : value;
    const bytes = new Uint8Array(digits * 8);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Number(remaining & 0xffn);
      remaining >>= 8n;
    }
    this.writer.bytes(bytes);
  }

  private writeString(value: string): void {
    let oneByte = true;
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) > 0xff) {
        oneByte = false;
        break;
      }
    }
    if (oneByte) {
      const bytes = new Uint8Array(value.length);
      for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
      this.writer.byte(T.ONE_BYTE_STRING);
      this.writer.varint(bytes.length);
      this.writer.bytes(bytes);
      return;
    }
    const byteLength = value.length * 2;
    // A two-byte string is padded so its payload lands 16-bit aligned.
    if ((this.writer.length + 1 + varintLength(byteLength)) & 1) this.writer.byte(T.PADDING);
    this.writer.byte(T.TWO_BYTE_STRING);
    this.writer.varint(byteLength);
    const bytes = new Uint8Array(byteLength);
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      bytes[i * 2] = unit & 0xff;
      bytes[i * 2 + 1] = unit >> 8;
    }
    this.writer.bytes(bytes);
  }

  /** Overridden by `lib/v8.js`'s `DefaultSerializer`. */
  _writeHostObject(value: object): void {
    this.failClone(value);
  }
}

/* ----------------------------------------------------------- number/keys -- */

function isBigIntObject(value: object): boolean {
  return typeof BigInt !== 'undefined' && Object.prototype.toString.call(value) === '[object BigInt]';
}

function regExpFlags(value: RegExp): number {
  const flags = value as unknown as Record<string, boolean>;
  let result = 0;
  for (const [, property, bit] of REGEXP_FLAGS) {
    if (flags[property] === true) result |= bit;
  }
  return result;
}

/** `"12"` → `12`, for keys `KeyAccumulator` keeps as numbers. `-1`/`0x1` do not qualify. */
function keyAsArrayIndex(key: string): number | null {
  if (key.length === 0 || key.length > 10) return null;
  if (key === '0') return 0;
  if (key.charCodeAt(0) < 0x31 || key.charCodeAt(0) > 0x39) return null;
  for (let i = 1; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code < 0x30 || code > 0x39) return null;
  }
  const numeric = Number(key);
  if (!Number.isSafeInteger(numeric) || numeric > 4294967294) return null;
  return numeric;
}

function isIndexBelow(key: string, length: number): boolean {
  const numeric = keyAsArrayIndex(key);
  return numeric !== null && numeric < length;
}

/* ----------------------------------------------------------- deserializer -- */

/** tag → `[constructor, bytes per element]`, for the real-view read path. */
const ABV_BY_TAG: Record<number, [new (b: ArrayBuffer, o: number, l: number) => ArrayBufferView, number]> = {};
for (const [name, bytesPerElement] of [
  ['Int8Array', 1],
  ['Uint8Array', 1],
  ['Uint8ClampedArray', 1],
  ['Int16Array', 2],
  ['Uint16Array', 2],
  ['Int32Array', 4],
  ['Uint32Array', 4],
  ['Float16Array', 2],
  ['Float32Array', 4],
  ['Float64Array', 8],
  ['BigInt64Array', 8],
  ['BigUint64Array', 8],
] as const) {
  const Ctor = (globalThis as unknown as Record<string, unknown>)[name];
  if (typeof Ctor === 'function') {
    ABV_BY_TAG[ABV_TAG[name]] = [Ctor as never, bytesPerElement];
  }
}

class Deserializer {
  buffer: unknown;
  private pos = 0;
  private bytes: Uint8Array;
  private ids: unknown[] = [];
  private nextId = 0;
  private version = 0;
  private transfers = new Map<number, ArrayBuffer>();
  private ctx: BindingContext;

  constructor(ctx: BindingContext, buffer: unknown) {
    this.ctx = ctx;
    if (!ArrayBuffer.isView(buffer)) {
      throw this.invalidArgType('buffer', ['TypedArray', 'DataView'], buffer);
    }
    const view = buffer as ArrayBufferView;
    // Node keeps the caller's view on `.buffer` and reads through it; a
    // Uint8Array alias keeps offsets relative to the view.
    this.buffer = buffer;
    this.bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }

  private invalidArgType(name: string, expected: string[], actual: unknown): Error {
    const errors = this.ctx.requireBuiltin?.('internal/errors') as
      | { codes?: Record<string, new (...a: unknown[]) => Error> }
      | undefined;
    const Ctor = errors?.codes?.ERR_INVALID_ARG_TYPE;
    if (Ctor) return new Ctor(name, expected, actual);
    return new TypeError(`The "${name}" argument must be an instance of ${expected.join(' or ')}`);
  }

  private versionError(): Error {
    return new Error('Unable to deserialize cloned data due to invalid or unsupported version.');
  }

  private dataError(): Error {
    return new Error('Unable to deserialize cloned data.');
  }

  /* -- low-level surface used by `lib/v8.js` -- */

  readHeader(): void {
    if (this.pos < this.bytes.length && this.bytes[this.pos] === T.VERSION) {
      this.pos++;
      const version = this.readVarint();
      if (version === null || version > LATEST_VERSION) throw this.versionError();
      this.version = version;
    }
    // V8's public `ReadHeader` rejects data with no usable version header.
    if (this.version === 0) throw this.versionError();
  }

  getWireFormatVersion(): number {
    return this.version;
  }

  readUint32(): number {
    const value = this.readVarint();
    if (value === null) throw new Error('ReadUint32() failed');
    return value;
  }

  readUint64(): [number, number] {
    const value = this.readVarintBig();
    if (value === null) throw new Error('ReadUint64() failed');
    return [Number((value >> 32n) & 0xffffffffn), Number(value & 0xffffffffn)];
  }

  readDouble(): number {
    if (this.pos + 8 > this.bytes.length) throw this.dataError();
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 8).getFloat64(0, true);
    this.pos += 8;
    return value;
  }

  /** Returns the offset of the bytes, relative to the start of the view. */
  _readRawBytes(length: number): number {
    if (this.pos + length > this.bytes.length) throw this.dataError();
    const offset = this.pos;
    this.pos += length;
    return offset;
  }

  transferArrayBuffer(id: unknown, arrayBuffer: unknown): void {
    if (!(arrayBuffer instanceof ArrayBuffer)) {
      throw this.invalidArgType('arrayBuffer', ['ArrayBuffer'], arrayBuffer);
    }
    this.transfers.set(Number(id) >>> 0, arrayBuffer);
  }

  readValue(): unknown {
    return this.readObject();
  }

  /** Overridden by `lib/v8.js`'s `DefaultDeserializer`. */
  _readHostObject(): unknown {
    throw this.dataError();
  }

  /* -- primitives -- */

  private readVarint(): number | null {
    const value = this.readVarintBig();
    return value === null ? null : Number(value & 0xffffffffn);
  }

  private readVarintBig(): bigint | null {
    let value = 0n;
    let shift = 0n;
    for (;;) {
      if (this.pos >= this.bytes.length) return null;
      const byte = this.bytes[this.pos++];
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
      if (shift > 63n) return null;
    }
  }

  private readZigzag32(): number | null {
    const value = this.readVarint();
    if (value === null) return null;
    return (value >>> 1) ^ -(value & 1);
  }

  /** `ReadTag` swallows the padding bytes writers insert for alignment. */
  private readTag(): number | null {
    for (;;) {
      if (this.pos >= this.bytes.length) return null;
      const tag = this.bytes[this.pos++];
      if (tag !== T.PADDING) return tag;
    }
  }

  private peekTag(): number | null {
    let pos = this.pos;
    for (;;) {
      if (pos >= this.bytes.length) return null;
      const tag = this.bytes[pos++];
      if (tag !== T.PADDING) return tag;
    }
  }

  private addObject(id: number, value: unknown): void {
    this.ids[id] = value;
  }

  private readString(): string | null {
    const tag = this.readTag();
    if (tag === T.ONE_BYTE_STRING) {
      const length = this.readVarint();
      if (length === null) return null;
      const start = this._readRawBytes(length);
      // Node's "one byte" strings are Latin-1 (ISO-8859-1): every byte maps to
      // the same code point. `TextDecoder('latin1')` would apply windows-1252
      // to the C1 range, so decode by hand.
      let out = '';
      for (let i = 0; i < length; i += 4096) {
        const end = Math.min(i + 4096, length);
        out += String.fromCharCode(...this.bytes.subarray(start + i, start + end));
      }
      return out;
    }
    if (tag === T.TWO_BYTE_STRING) {
      const byteLength = this.readVarint();
      if (byteLength === null) return null;
      const start = this._readRawBytes(byteLength);
      // UTF-16LE, code unit by code unit. A `TextDecoder` would replace lone
      // surrogates with U+FFFD; V8 round-trips them verbatim, and JS strings
      // can hold them.
      const units = byteLength >> 1;
      let out = '';
      for (let i = 0; i < units; i += 2048) {
        const end = Math.min(i + 2048, units);
        const chunk = new Array(end - i);
        for (let u = i; u < end; u++) {
          const base = start + u * 2;
          chunk[u - i] = this.bytes[base] | (this.bytes[base + 1] << 8);
        }
        out += String.fromCharCode(...chunk);
      }
      return out;
    }
    if (tag === T.UTF8_STRING) {
      const length = this.readVarint();
      if (length === null) return null;
      const start = this._readRawBytes(length);
      return new TextDecoder().decode(this.bytes.subarray(start, start + length));
    }
    return null;
  }

  private readObject(): unknown {
    const result = this.readObjectInner();
    // A real view (the low-level `Serializer` path) is written as its buffer
    // followed by an `kArrayBufferView` tag describing the window into it.
    if (result instanceof ArrayBuffer && this.peekTag() === T.ARRAY_BUFFER_VIEW) {
      this.readTag();
      return this.readArrayBufferView(result);
    }
    return result;
  }

  private readArrayBufferView(buffer: ArrayBuffer): ArrayBufferView {
    const tag = this.readVarint();
    const byteOffset = this.readVarint();
    const byteLength = this.readVarint();
    const flags = this.version >= 14 ? this.readVarint() : 0;
    if (tag === null || byteOffset === null || byteLength === null || flags === null) throw this.dataError();
    if (byteOffset + byteLength > buffer.byteLength) throw this.dataError();
    const id = this.nextId++;
    let view: ArrayBufferView;
    if (tag === ABV_TAG.DataView) {
      view = new DataView(buffer, byteOffset, byteLength);
    } else {
      const entry = ABV_BY_TAG[tag];
      if (entry === undefined) throw this.dataError();
      const [Ctor, size] = entry;
      if (byteOffset % size !== 0 || byteLength % size !== 0) throw this.dataError();
      view = new Ctor(buffer, byteOffset, byteLength / size);
    }
    this.addObject(id, view);
    return view;
  }

  private readObjectInner(): unknown {
    const tag = this.readTag();
    if (tag === null) throw this.dataError();
    switch (tag) {
      case T.VERIFY_OBJECT_COUNT:
        if (this.readVarint() === null) throw this.dataError();
        return this.readObjectInner();
      case T.UNDEFINED:
        return undefined;
      case T.NULL:
        return null;
      case T.TRUE:
        return true;
      case T.FALSE:
        return false;
      case T.INT32: {
        const value = this.readZigzag32();
        if (value === null) throw this.dataError();
        return value;
      }
      case T.UINT32: {
        const value = this.readVarint();
        if (value === null) throw this.dataError();
        return value;
      }
      case T.DOUBLE:
        return this.readDouble();
      case T.BIGINT:
        return this.readBigInt();
      case T.ONE_BYTE_STRING:
      case T.TWO_BYTE_STRING:
      case T.UTF8_STRING: {
        this.pos--;
        const value = this.readString();
        if (value === null) throw this.dataError();
        return value;
      }
      case T.OBJECT_REFERENCE: {
        const id = this.readVarint();
        if (id === null || id >= this.ids.length || this.ids[id] === undefined) throw this.dataError();
        return this.ids[id];
      }
      case T.BEGIN_JS_OBJECT:
        return this.readObjectGraph();
      case T.BEGIN_SPARSE_JS_ARRAY:
        return this.readSparseArray();
      case T.BEGIN_DENSE_JS_ARRAY:
        return this.readDenseArray();
      case T.DATE: {
        const id = this.nextId++;
        const value = new Date(this.readDouble());
        this.addObject(id, value);
        return value;
      }
      case T.TRUE_OBJECT:
      case T.FALSE_OBJECT: {
        const id = this.nextId++;
        const value = new Boolean(tag === T.TRUE_OBJECT);
        this.addObject(id, value);
        return value;
      }
      case T.NUMBER_OBJECT: {
        const id = this.nextId++;
        const value = new Number(this.readDouble());
        this.addObject(id, value);
        return value;
      }
      case T.BIGINT_OBJECT: {
        const id = this.nextId++;
        const value = Object(this.readBigInt());
        this.addObject(id, value);
        return value;
      }
      case T.STRING_OBJECT: {
        const id = this.nextId++;
        const text = this.readString();
        if (text === null) throw this.dataError();
        const value = new String(text);
        this.addObject(id, value);
        return value;
      }
      case T.REGEXP: {
        const id = this.nextId++;
        const source = this.readString();
        const flags = this.readVarint();
        if (source === null || flags === null) throw this.dataError();
        const letters = REGEXP_FLAGS.filter(([, , bit]) => (flags & bit) === bit)
          .map(([letter]) => letter)
          .join('');
        const value = new RegExp(source, letters);
        this.addObject(id, value);
        return value;
      }
      case T.BEGIN_JS_MAP:
        return this.readMap();
      case T.BEGIN_JS_SET:
        return this.readSet();
      case T.ARRAY_BUFFER:
        return this.readArrayBuffer(false);
      case T.IMMUTABLE_ARRAY_BUFFER:
        return this.readArrayBuffer(false);
      case T.RESIZABLE_ARRAY_BUFFER:
        return this.readArrayBuffer(true);
      case T.ARRAY_BUFFER_TRANSFER: {
        const id = this.readVarint();
        if (id === null) throw this.dataError();
        const buffer = this.transfers.get(id);
        if (buffer === undefined) throw this.dataError();
        return buffer;
      }
      case T.ERROR:
        return this.readError();
      case T.HOST_OBJECT: {
        const id = this.nextId++;
        const value = this._readHostObject();
        this.addObject(id, value);
        return value;
      }
      default:
        throw this.dataError();
    }
  }

  private readBigInt(): bigint {
    const bitfield = this.readVarint();
    if (bitfield === null) throw this.dataError();
    // The bitfield holds the byte length doubled, with the sign in bit 0.
    const byteLength = bitfield >>> 1;
    const negative = (bitfield & 1) === 1;
    if (this.pos + byteLength > this.bytes.length) throw this.dataError();
    let value = 0n;
    for (let i = byteLength - 1; i >= 0; i--) {
      value = (value << 8n) | BigInt(this.bytes[this.pos + i]);
    }
    this.pos += byteLength;
    return negative ? -value : value;
  }

  private readObjectGraph(): unknown {
    const id = this.nextId++;
    const result: Record<string, unknown> = {};
    this.addObject(id, result);
    for (;;) {
      const tag = this.peekTag();
      if (tag === null) throw this.dataError();
      if (tag === T.END_JS_OBJECT) {
        this.readTag();
        if (this.readVarint() === null) throw this.dataError();
        return result;
      }
      const key = this.readObject();
      const value = this.readObject();
      result[String(key)] = value;
    }
  }

  private readDenseArray(): unknown[] {
    const id = this.nextId++;
    const length = this.readVarint();
    if (length === null) throw this.dataError();
    const array: unknown[] = new Array(length);
    this.addObject(id, array);
    for (let i = 0; i < length; i++) {
      if (this.peekTag() === T.THE_HOLE) {
        this.readTag();
        continue;
      }
      array[i] = this.readObject();
    }
    for (;;) {
      const tag = this.peekTag();
      if (tag === null) throw this.dataError();
      if (tag === T.END_DENSE_JS_ARRAY) {
        this.readTag();
        if (this.readVarint() === null || this.readVarint() === null) throw this.dataError();
        return array;
      }
      const key = this.readObject();
      const value = this.readObject();
      (array as unknown as Record<string, unknown>)[String(key)] = value;
    }
  }

  private readSparseArray(): unknown[] {
    const id = this.nextId++;
    const length = this.readVarint();
    if (length === null) throw this.dataError();
    const array: unknown[] = new Array(length);
    this.addObject(id, array);
    for (;;) {
      const tag = this.peekTag();
      if (tag === null) throw this.dataError();
      if (tag === T.END_SPARSE_JS_ARRAY) {
        this.readTag();
        if (this.readVarint() === null || this.readVarint() === null) throw this.dataError();
        return array;
      }
      const key = this.readObject();
      const value = this.readObject();
      (array as unknown as Record<string, unknown>)[String(key)] = value;
    }
  }

  private readMap(): Map<unknown, unknown> {
    const id = this.nextId++;
    const map = new Map<unknown, unknown>();
    this.addObject(id, map);
    for (;;) {
      const tag = this.peekTag();
      if (tag === null) throw this.dataError();
      if (tag === T.END_JS_MAP) {
        this.readTag();
        if (this.readVarint() === null) throw this.dataError();
        return map;
      }
      const key = this.readObject();
      const value = this.readObject();
      map.set(key, value);
    }
  }

  private readSet(): Set<unknown> {
    const id = this.nextId++;
    const set = new Set<unknown>();
    this.addObject(id, set);
    for (;;) {
      const tag = this.peekTag();
      if (tag === null) throw this.dataError();
      if (tag === T.END_JS_SET) {
        this.readTag();
        if (this.readVarint() === null) throw this.dataError();
        return set;
      }
      set.add(this.readObject());
    }
  }

  private readArrayBuffer(resizable: boolean): ArrayBuffer {
    const id = this.nextId++;
    const byteLength = this.readVarint();
    if (byteLength === null) throw this.dataError();
    let maxByteLength = byteLength;
    if (resizable) {
      const max = this.readVarint();
      if (max === null) throw this.dataError();
      maxByteLength = max;
    }
    const start = this._readRawBytes(byteLength);
    const bytes = this.bytes.slice(start, start + byteLength);
    let buffer: ArrayBuffer;
    if (resizable) {
      const ResizableArrayBuffer = ArrayBuffer as unknown as new (
        length: number,
        options: { maxByteLength: number },
      ) => ArrayBuffer;
      buffer = new ResizableArrayBuffer(byteLength, { maxByteLength });
      new Uint8Array(buffer).set(bytes);
    } else {
      buffer = bytes.buffer as ArrayBuffer;
    }
    this.addObject(id, buffer);
    return buffer;
  }

  private readError(): Error {
    const id = this.nextId++;
    let tag = this.readVarint();
    if (tag === null) throw this.dataError();
    let Ctor: new (message?: string) => Error = Error;
    switch (tag) {
      case E.EVAL:
        Ctor = EvalError;
        tag = this.readVarint();
        break;
      case E.RANGE:
        Ctor = RangeError;
        tag = this.readVarint();
        break;
      case E.REFERENCE:
        Ctor = ReferenceError;
        tag = this.readVarint();
        break;
      case E.SYNTAX:
        Ctor = SyntaxError;
        tag = this.readVarint();
        break;
      case E.TYPE:
        Ctor = TypeError;
        tag = this.readVarint();
        break;
      case E.URI:
        Ctor = URIError;
        tag = this.readVarint();
        break;
      default:
        break;
    }
    let message: string | undefined;
    if (tag === E.MESSAGE) {
      const text = this.readString();
      if (text === null) throw this.dataError();
      message = text;
      tag = this.readVarint();
    }
    let stack: string | undefined;
    if (tag === E.STACK) {
      const text = this.readString();
      if (text === null) throw this.dataError();
      stack = text;
      tag = this.readVarint();
    }
    // V8 builds the error with `Factory::NewError`, which captures no stack:
    // an error that had none on the wire still has none afterwards. Calling
    // `new Error()` here would attach a fresh one, so start from the prototype
    // and add only what the wire carried.
    const error = Object.create(Ctor.prototype) as Error;
    if (message !== undefined) {
      Object.defineProperty(error, 'message', {
        value: message,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
    if (stack !== undefined) {
      Object.defineProperty(error, 'stack', {
        value: stack,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
    this.addObject(id, error);
    if (tag === E.CAUSE) {
      const cause = this.readObject();
      Object.defineProperty(error, 'cause', { value: cause, writable: true, enumerable: false, configurable: true });
      tag = this.readVarint();
    }
    if (tag !== E.END) throw this.dataError();
    return error;
  }
}

/* ------------------------------------------------------------- the class -- */

/*
 * `lib/v8.js` writes two prototype properties after requiring this module:
 *   Serializer.prototype._getDataCloneError = Error;
 * so the property must already exist as a writable data property, and
 * `_writeHostObject`/`_readHostObject` defaults must be overridable.
 */
for (const [target, name, value] of [
  [Serializer.prototype, '_getDataCloneError', Error],
  [Deserializer.prototype, '_getDataCloneError', Error],
] as const) {
  Object.defineProperty(target, name, { value, writable: true, configurable: true });
}

export const serdesBinding: BindingFactory = (ctx: BindingContext) => ({
  Serializer: class extends Serializer {
    constructor() {
      super(ctx);
    }
  },
  Deserializer: class extends Deserializer {
    constructor(buffer: unknown) {
      super(ctx, buffer);
    }
  },
});
