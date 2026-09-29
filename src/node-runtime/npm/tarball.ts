/**
 * Tarball support for the npm client: gzip in, files out.
 *
 * npm publishes packages as `*.tgz` — a gzipped tar (ustar + pax/GNU long-name
 * extensions). We don't need a full tar implementation: we only ever read
 * regular files and directories, and always strip the one leading directory npm
 * wraps everything in — whichever it is named (see `stripRootSegment`).
 *
 * Decompression uses the platform `DecompressionStream` (browser + Node 18+),
 * so there is no zlib dependency in the bundle.
 */

export interface TarEntry {
  path: string;
  type: 'file' | 'dir';
  data: Uint8Array;
  mode: number;
}

const BLOCK = 512;

async function collect(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Gunzip a byte buffer using the platform DecompressionStream. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([toBlobPart(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return collect(stream as ReadableStream<Uint8Array>);
}

function readString(bytes: Uint8Array, start: number, len: number): string {
  let end = start;
  const max = Math.min(start + len, bytes.length);
  while (end < max && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(start, end));
}

function readField(bytes: Uint8Array, start: number, len: number): number {
  // GNU base-256 extension for large numbers.
  if (bytes[start] & 0x80) {
    let n = 0;
    for (let i = start + 1; i < start + len; i++) n = n * 256 + bytes[i];
    return n;
  }
  const s = readString(bytes, start, len).trim();
  if (s === '') return 0;
  const n = parseInt(s, 8);
  return Number.isNaN(n) ? 0 : n;
}

interface PaxRecord {
  path?: string;
  size?: number;
  linkpath?: string;
}

function parsePax(data: Uint8Array): PaxRecord {
  const text = new TextDecoder().decode(data);
  const out: PaxRecord = {};
  let i = 0;
  while (i < text.length) {
    const space = text.indexOf(' ', i);
    if (space === -1) break;
    const length = parseInt(text.slice(i, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, i + length - 1); // drop trailing \n
    const eq = record.indexOf('=');
    if (eq !== -1) {
      const key = record.slice(0, eq);
      const value = record.slice(eq + 1);
      if (key === 'path') out.path = value;
      else if (key === 'size') out.size = parseInt(value, 10);
      else if (key === 'linkpath') out.linkpath = value;
    }
    i += length;
  }
  return out;
}

/**
 * Drop a tarball entry's leading path segment — npm's `strip: 1`.
 *
 * An npm tarball wraps every file in a single directory so it can be unpacked
 * without knowing the package name. `package/` is the convention, but it is not
 * what the field means: npm strips exactly one component whatever its name, and
 * the `@types/*` packages npm publishes prove it — their tarball root is the
 * *unscoped package name* (`@types/node` → `node/…`, `@types/estree` →
 * `estree/…`). Only matching the literal `package/` left those packages nested
 * one level too deep (`@types/node/node/index.d.ts`, so TypeScript could not
 * find `@types/node`) and broke every loader that pulls in typings.
 *
 * The wrapper directory itself (a path with no `/`, e.g. `package` or `node`)
 * strips to the empty string and is dropped by the caller, exactly as npm does.
 */
function stripRootSegment(rawPath: string): string {
  let p = rawPath;
  if (p.startsWith('./')) p = p.slice(2);
  const slash = p.indexOf('/');
  return slash === -1 ? '' : p.slice(slash + 1);
}

/**
 * Parse an uncompressed tar buffer into file/directory entries.
 * Symlinks, hardlinks, devices and fifos are skipped (npm tarballs rarely ship
 * them, and the runtime has no way to model them yet).
 */
export function untar(input: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  let offset = 0;
  let pending: PaxRecord = {};
  let longName: string | null = null;

  while (offset + BLOCK <= input.length) {
    let zero = true;
    for (let i = 0; i < BLOCK; i++) {
      if (input[offset + i] !== 0) {
        zero = false;
        break;
      }
    }
    if (zero) break; // end-of-archive marker

    const header = input.subarray(offset, offset + BLOCK);
    let name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    if (prefix.length > 0 && !name.startsWith('/')) name = `${prefix}/${name}`;
    let size = readField(header, 124, 12);
    const mode = readField(header, 100, 8) || 0o644;
    const typeflag = String.fromCharCode(header[156] || 48);

    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    const data = input.subarray(dataStart, Math.min(dataEnd, input.length));
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (typeflag === 'x' || typeflag === 'g') {
      const rec = parsePax(data);
      if (typeflag === 'x') pending = rec;
      continue;
    }
    if (typeflag === 'L') {
      longName = new TextDecoder().decode(data).replace(/\0[\s\S]*$/, '');
      continue;
    }

    if (longName !== null) {
      name = longName;
      longName = null;
    }
    if (pending.path) name = pending.path;
    if (pending.size !== undefined) size = pending.size;
    pending = {};

    const path = stripRootSegment(name);
    if (path === '') continue;

    if (typeflag === '5' || path.endsWith('/')) {
      out.push({ path: path.replace(/\/+$/, ''), type: 'dir', data: new Uint8Array(0), mode });
      continue;
    }
    if (typeflag === '0' || typeflag === '\0' || typeflag === '') {
      out.push({ path, type: 'file', data: data.slice(), mode });
    }
    // else: symlink/hardlink/device — skipped
  }

  return out;
}

/** O(n) convenience: gunzip then untar. */
export async function extractTarball(tgz: Uint8Array): Promise<TarEntry[]> {
  return untar(await gunzip(tgz));
}

// ---------------------------------------------------------------------------
// Streaming path
// ---------------------------------------------------------------------------
//
// The buffer helpers above are fine for small inputs, but installing a real
// dependency tree means decompressing hundreds of packages whose *decompressed*
// bytes dwarf the tarball. Materialising each package as a whole `Uint8Array`
// (and again as a per-file `slice()`) spikes the worker heap by gigabytes and
// crashes the tab. So the installer never does that: it streams the gzip stream
// through an incremental tar parser and writes one file at a time into the VFS.
//
// `gunzipStream` / `untarStream` / `extractTarballStream` below are the pieces
// the installer uses; the buffer functions stay for tests and small in-VFS
// `file:` tarballs.

/** Wrap a byte buffer as a single-chunk stream without copying it. */
export function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Gunzip a byte *stream* with the platform `DecompressionStream`. */
export function gunzipStream(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  // TS 5.6 + DOM types `DecompressionStream` over `BufferSource`; the stream we
  // feed it is always `Uint8Array`, so narrow it to keep `pipeThrough` happy.
  const decompressor = new DecompressionStream('gzip') as unknown as TransformStream<
    Uint8Array,
    Uint8Array
  >;
  return source.pipeThrough(decompressor);
}

/**
 * Incremental byte reader: hands out exactly the bytes the tar parser asks for,
 * pulling more from the stream only when it must. Peak memory is one requested
 * block (a tar header, or a single file's bytes) — never the whole archive.
 */
class ByteQueue {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  #chunks: Uint8Array[] = [];
  #head = 0;
  #length = 0;
  #ended = false;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.#reader = reader;
  }

  get length(): number {
    return this.#length;
  }

  async #pull(): Promise<void> {
    if (this.#ended) return;
    const { done, value } = await this.#reader.read();
    if (done) {
      this.#ended = true;
      return;
    }
    if (value && value.length > 0) {
      this.#chunks.push(value);
      this.#length += value.length;
    }
  }

  /** Read until at least `n` bytes are buffered, or the stream ends. */
  async ensure(n: number): Promise<void> {
    while (this.#length < n && !this.#ended) await this.#pull();
  }

  /** Consume `n` bytes positionally, discarding them. */
  async skip(n: number): Promise<void> {
    let remaining = Math.min(n, await this.#buffered(n));
    while (remaining > 0) {
      const chunk = this.#chunks[0];
      const available = chunk.length - this.#head;
      const use = Math.min(available, remaining);
      this.#head += use;
      this.#length -= use;
      remaining -= use;
      if (this.#head >= chunk.length) {
        this.#chunks.shift();
        this.#head = 0;
      }
    }
  }

  /** Take up to `n` bytes as a fresh contiguous buffer (fewer at end-of-stream). */
  async take(n: number): Promise<Uint8Array> {
    const count = Math.min(n, await this.#buffered(n));
    const out = new Uint8Array(count);
    let offset = 0;
    while (offset < count) {
      const chunk = this.#chunks[0];
      const available = chunk.length - this.#head;
      const use = Math.min(available, count - offset);
      out.set(chunk.subarray(this.#head, this.#head + use), offset);
      offset += use;
      this.#length -= use;
      this.#head += use;
      if (this.#head >= chunk.length) {
        this.#chunks.shift();
        this.#head = 0;
      }
    }
    return out;
  }

  async #buffered(n: number): Promise<number> {
    await this.ensure(n);
    return this.#length;
  }

  release(): void {
    try {
      this.#reader.releaseLock();
    } catch {
      // reader already released — nothing to do
    }
  }
}

/**
 * Parse a tar *stream* into entries as they are read.
 *
 * Mirrors {@link untar} exactly (same stripping, same pax/GNU long-name
 * handling, same skipping of links/devices) but yields each entry the moment
 * its bytes are available, so the caller can write it out and forget it.
 */
export async function* untarStream(
  source: ReadableStream<Uint8Array>,
): AsyncGenerator<TarEntry, void, undefined> {
  const queue = new ByteQueue(source.getReader());
  let pending: PaxRecord = {};
  let longName: string | null = null;

  const padding = (size: number): number => Math.ceil(size / BLOCK) * BLOCK - size;

  try {
    for (;;) {
      await queue.ensure(BLOCK);
      if (queue.length < BLOCK) break; // truncated archive — stop cleanly
      const header = await queue.take(BLOCK);

      let zero = true;
      for (let i = 0; i < BLOCK; i++) {
        if (header[i] !== 0) {
          zero = false;
          break;
        }
      }
      if (zero) break; // end-of-archive marker

      let name = readString(header, 0, 100);
      const prefix = readString(header, 345, 155);
      if (prefix.length > 0 && !name.startsWith('/')) name = `${prefix}/${name}`;
      let size = readField(header, 124, 12);
      const mode = readField(header, 100, 8) || 0o644;
      const typeflag = String.fromCharCode(header[156] || 48);

      if (typeflag === 'x' || typeflag === 'g') {
        const data = await queue.take(size);
        await queue.skip(padding(size));
        if (typeflag === 'x') pending = parsePax(data);
        continue;
      }
      if (typeflag === 'L') {
        const data = await queue.take(size);
        await queue.skip(padding(size));
        longName = new TextDecoder().decode(data).replace(/\0[\s\S]*$/, '');
        continue;
      }

      const data = await queue.take(size);
      await queue.skip(padding(size));

      if (longName !== null) {
        name = longName;
        longName = null;
      }
      if (pending.path) name = pending.path;
      if (pending.size !== undefined) size = pending.size;
      pending = {};

      const path = stripRootSegment(name);
      if (path === '') continue;

      if (typeflag === '5' || path.endsWith('/')) {
        yield { path: path.replace(/\/+$/, ''), type: 'dir', data: new Uint8Array(0), mode };
        continue;
      }
      if (typeflag === '0' || typeflag === '\0' || typeflag === '') {
        yield { path, type: 'file', data, mode };
      }
      // else: symlink/hardlink/device — skipped
    }
  } finally {
    queue.release();
  }
}

/** Streamed `gunzip` + `untar`: yields entries without buffering the package. */
export async function* extractTarballStream(
  source: ReadableStream<Uint8Array>,
): AsyncGenerator<TarEntry, void, undefined> {
  yield* untarStream(gunzipStream(source));
}
