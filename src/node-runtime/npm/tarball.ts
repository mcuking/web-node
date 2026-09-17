/**
 * Tarball support for the npm client: gzip in, files out.
 *
 * npm publishes packages as `*.tgz` — a gzipped tar (ustar + pax/GNU long-name
 * extensions). We don't need a full tar implementation: we only ever read
 * regular files and directories, and always strip the leading `package/`
 * directory npm wraps everything in.
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

function stripPackagePrefix(rawPath: string): string {
  let p = rawPath;
  if (p.startsWith('./')) p = p.slice(2);
  if (p.startsWith('package/')) p = p.slice('package/'.length);
  else if (p === 'package') p = '';
  return p;
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

    const path = stripPackagePrefix(name);
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
