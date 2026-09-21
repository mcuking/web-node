import type { BindingFactory } from './context';

/**
 * `blob` binding.
 *
 * Node's real `internal/blob.js` (`Blob`), `internal/file.js` (`File`) and
 * `stream/consumers` reach the native layer through four entry points —
 * `createBlob`, `createBlobFromFilePath`, `concat` and the object-URL store.
 * In C++ they are all `DataQueue`-shaped (`src/node_blob.cc`,
 * `src/dataqueue/queue.cc`), which exists so a blob can hold file descriptors
 * and be read incrementally without ever materialising the bytes.
 *
 * Every blob this runtime can produce is memory-resident, so the queue
 * collapses to a flat list of `Uint8Array` parts. The observable contract is
 * kept: a reader's `pull()` hands back exactly one entry's bytes per call and
 * then EOS (the C++ `InMemoryReader` returns `STATUS_CONTINUE` with a single
 * vec and `STATUS_EOS` on the next pull), which is what makes
 * `blob.stream()` chunk on the original source boundaries.
 */

// node::bob::Status (src/node_bob.h)
const STATUS_EOS = 0;
const STATUS_CONTINUE = 1;

/** Lets `createBlob` tell our handles from ArrayBuffers/views. */
const kHandle = Symbol('web-node.blobHandle');

interface BlobHandle {
  readonly [kHandle]: true;
  readonly parts: Uint8Array[];
  readonly length: number;
  slice(start: number, end: number): BlobHandle;
  getReader(): BlobReader;
}

function isHandle(value: unknown): value is BlobHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [kHandle]?: unknown })[kHandle] === true
  );
}

function viewOf(source: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  return new Uint8Array(source);
}

/**
 * A reader over flattened byte parts. `pull` is always synchronous here —
 * there is no fd-backed or blocking part — so the `setWakeup` callback the
 * byte-stream controller registers is never actually needed.
 */
class BlobReader {
  #parts: Uint8Array[];
  #index = 0;
  #eos = false;
  #wakeup: (() => void) | undefined;

  constructor(parts: Uint8Array[]) {
    this.#parts = parts;
  }

  setWakeup(fn?: () => void): void {
    this.#wakeup = fn;
  }

  pull(callback: (status: number, buffer?: ArrayBuffer) => void): number {
    if (this.#eos || this.#index >= this.#parts.length) {
      this.#eos = true;
      callback(STATUS_EOS);
      return STATUS_EOS;
    }
    const part = this.#parts[this.#index++];
    // C++ copies the vecs into a fresh ArrayBuffer before handing them over, so
    // the caller can never observe later mutation of the blob's storage.
    const copy = part.slice();
    callback(STATUS_CONTINUE, copy.buffer);
    return STATUS_CONTINUE;
  }
}

function makeHandle(parts: Uint8Array[], length: number): BlobHandle {
  const handle: BlobHandle = {
    [kHandle]: true,
    parts,
    length,
    slice(start: number, end: number): BlobHandle {
      const from = Math.max(0, Math.min(start, length));
      const to = Math.max(from, Math.min(end, length));
      const out: Uint8Array[] = [];
      let offset = 0;
      for (const part of parts) {
        const partStart = offset;
        const partEnd = offset + part.byteLength;
        offset = partEnd;
        if (partEnd <= from || partStart >= to) {
          // Outside the window. A zero-length slice of an in-range part still
          // produces an (empty) entry in Node, but the byte-stream controller
          // drops zero-length buffers anyway, so only the `to > from` case
          // matters.
          continue;
        }
        const sliceStart = Math.max(from, partStart) - partStart;
        const sliceEnd = Math.min(to, partEnd) - partStart;
        out.push(part.subarray(sliceStart, sliceEnd));
      }
      return makeHandle(out, to - from);
    },
    getReader(): BlobReader {
      return new BlobReader(parts);
    },
  };
  return handle;
}

function partsOf(source: unknown): Uint8Array[] {
  if (isHandle(source)) return source.parts;
  return [viewOf(source as ArrayBuffer)];
}

export const blobBinding: BindingFactory = (ctx) => {
  /** The object-URL store behind `URL.createObjectURL` / `resolveObjectURL`. */
  const dataObjects = new Map<string, { handle: BlobHandle; length: number; type: string }>();

  return {
    // `createBlob(sources, length)` (src/node_blob.cc `Blob::New`). Sources are
    // ArrayBuffers, ArrayBufferViews or other blobs' handles (the JS side turns
    // Blobs into their handle before calling in).
    createBlob: (sources: unknown[], length: number): BlobHandle => {
      const parts: Uint8Array[] = [];
      let total = 0;
      for (const source of sources) {
        for (const part of partsOf(source)) {
          parts.push(part);
          total += part.byteLength;
        }
      }
      return makeHandle(parts, typeof length === 'number' ? length : total);
    },

    // `concat(buffers)` (src/node_blob.cc `Concat`): join ArrayBuffers.
    concat: (buffers: ArrayBuffer[]): ArrayBuffer => {
      let total = 0;
      for (const buffer of buffers) total += buffer.byteLength;
      const out = new ArrayBuffer(total);
      const view = new Uint8Array(out);
      let offset = 0;
      for (const buffer of buffers) {
        view.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
      }
      return out;
    },

    // `createBlobFromFilePath(path)` (src/node_blob.cc `BlobFromFilePath`),
    // which backs `fs.openAsBlob`. C++ stats the path and throws the libuv
    // error when that fails, so a missing file raises ENOENT rather than the
    // "could not be read" fallback the JS side has for other failures.
    createBlobFromFilePath: (path: string): [BlobHandle, number] => {
      const resolved = ctx.vfs.resolve(path);
      if (!ctx.vfs.exists(resolved)) {
        const error = new Error(`ENOENT: no such file or directory, stat '${resolved}'`);
        Object.assign(error, { code: 'ENOENT', errno: -2, syscall: 'stat', path: resolved });
        throw error;
      }
      const bytes = ctx.vfs.readFile(resolved);
      return [makeHandle([bytes], bytes.byteLength), bytes.byteLength];
    },

    storeDataObject: (id: string, handle: BlobHandle, length: number, type: string): void => {
      dataObjects.set(id, { handle, length, type });
    },

    getDataObject: (id: string): [BlobHandle, number, string] | undefined => {
      const stored = dataObjects.get(id);
      if (stored === undefined) return undefined;
      return [stored.handle, stored.length, stored.type];
    },

    revokeObjectURL: (url: string): void => {
      // `blob:nodedata:<uuid>` (src/node_blob.cc `RevokeObjectURL`).
      const match = /^blob:nodedata:([^:]*)$/.exec(url);
      if (match !== null) dataObjects.delete(match[1]);
    },
  };
};
