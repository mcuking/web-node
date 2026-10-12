/**
 * `RemoteVfs` — the **thread side** of the M147 real-thread VFS bridge.
 *
 * A real worker lives in its own realm and cannot touch the parent's
 * `MemoryVfs`. This class implements the same `Vfs` contract by forwarding every
 * call to the parent over a synchronous channel (`SyncChannel`, M120): the
 * parent is the single owner of the tree, so a read or a write is applied there
 * and nowhere else. That is what makes the two realms consistent without a merge
 * protocol.
 *
 * Two rules keep the round trips cheap and the semantics exact:
 *
 *   - **Paths go over absolute.** `#cwd` is tracked here (it only changes on
 *     `chdir`), every argument is resolved locally first, so the parent never has
 *     to know this thread's working directory — and a `chdir` cannot drift the
 *     two sides apart.
 *   - **Errors are reconstructed.** A `VfsError` is flattened by the sync
 *     channel into `{code, syscall, path, dest, message}`; it comes back as an
 *     error with a `.code` the binding layer already understands, so `ENOENT`
 *     and friends read exactly as they do in-process.
 */

import { type Dirent, type MkdirOptions, type PathLike, type ReaddirOptions, type Stat, type Vfs, type VfsChange, type WriteOptions, VfsError } from './types';
import * as p from './posix';
import { SyncChannel, SyncChannelError } from '../../sync/sab-rpc';
import { VFS_OP, encodeFrame, decodeFrame, type VfsCallMeta, type VfsResultMeta } from '../../sync/thread-protocol';

/** A no-op change subscription: a remote tree cannot observe the parent's writes. */
const NO_SUBSCRIBE = (): (() => void) => () => undefined;

export class RemoteVfs implements Vfs {
  #channel: SyncChannel;
  #cwd: string;

  constructor(channel: SyncChannel, opts: { cwd?: string } = {}) {
    this.#channel = channel;
    this.#cwd = p.normalize(opts.cwd ?? '/');
  }

  get cwd(): string {
    return this.#cwd;
  }

  /**
   * Round-trip one call. A peer error is re-thrown as a `VfsError` when it
   * carries the POSIX fields the translation needs; anything else propagates as
   * the channel error (a protocol or timeout failure, not a filesystem answer).
   */
  #call(meta: VfsCallMeta, body = new Uint8Array(0) as Uint8Array): { meta: VfsResultMeta; body: Uint8Array } {
    try {
      const reply = this.#channel.call(VFS_OP[meta.op], encodeFrame(meta, body));
      return decodeFrame<VfsResultMeta>(reply);
    } catch (err) {
      throw translate(err);
    }
  }

  /** Everything a caller passes through is resolved against *this* thread's cwd. */
  resolve(input: PathLike): string {
    const path = p.toPathValue(input);
    if (!path) throw new VfsError('ENOENT', 'open', path);
    if (p.isAbsolute(path)) return p.normalize(path);
    return p.resolve(this.#cwd, path);
  }

  chdir(dir: string): void {
    const abs = this.resolve(dir);
    let stat: Stat;
    try {
      stat = this.#statOf('stat', abs);
    } catch (err) {
      // MemoryVfs reports a missing directory as `chdir`, so match that syscall
      // rather than leaking the lookup's own name.
      if (err instanceof VfsError && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        throw new VfsError(err.code, 'chdir', dir);
      }
      throw err;
    }
    if (stat.type !== 'dir') throw new VfsError('ENOTDIR', 'chdir', dir);
    this.#cwd = abs;
  }

  #statOf(op: 'stat' | 'lstat', abs: string): Stat {
    const { meta } = this.#call({ op, path: abs });
    const m = meta as Extract<VfsResultMeta, { op: 'stat' | 'lstat' }>;
    return m.stat;
  }

  readFile(path: string): Uint8Array {
    const { body } = this.#call({ op: 'readFile', path: this.resolve(path) });
    return body;
  }

  writeFile(path: string, data: Uint8Array, opts?: WriteOptions): void {
    this.#call({ op: 'writeFile', path: this.resolve(path), opts }, data);
  }

  appendFile(path: string, data: Uint8Array): void {
    this.#call({ op: 'appendFile', path: this.resolve(path) }, data);
  }

  exists(path: string): boolean {
    const { meta } = this.#call({ op: 'exists', path: this.resolve(path) });
    return (meta as Extract<VfsResultMeta, { op: 'exists' }>).result;
  }

  stat(path: string): Stat {
    return this.#statOf('stat', this.resolve(path));
  }

  lstat(path: string): Stat {
    return this.#statOf('lstat', this.resolve(path));
  }

  mkdir(path: string, opts?: MkdirOptions): string | undefined {
    const { meta } = this.#call({ op: 'mkdir', path: this.resolve(path), opts });
    return (meta as Extract<VfsResultMeta, { op: 'mkdir' }>).result;
  }

  readdir(path: string, opts?: ReaddirOptions): Dirent[] {
    const { meta } = this.#call({ op: 'readdir', path: this.resolve(path), opts });
    return (meta as Extract<VfsResultMeta, { op: 'readdir' }>).entries;
  }

  rm(path: string, opts?: { recursive?: boolean; force?: boolean; syscall?: 'unlink' | 'rmdir' | 'lstat' }): void {
    this.#call({ op: 'rm', path: this.resolve(path), opts });
  }

  rename(from: string, to: string): void {
    this.#call({ op: 'rename', from: this.resolve(from), to: this.resolve(to) });
  }

  copyFile(from: string, to: string, mode?: number): void {
    this.#call({ op: 'copyFile', from: this.resolve(from), to: this.resolve(to), mode });
  }

  chmod(path: string, mode: number): void {
    this.#call({ op: 'chmod', path: this.resolve(path), mode });
  }

  realpath(input: PathLike): string {
    const { meta } = this.#call({ op: 'realpath', path: this.resolve(input) });
    return (meta as Extract<VfsResultMeta, { op: 'realpath' }>).result;
  }

  /**
   * `fsyncSync` reaches through to the parent's durable backend over the same
   * channel (the parent blocks on the *FS worker*, not on this thread, so there
   * is no cycle). A parent without a durable store answers with a no-op.
   */
  sync(path: string): void {
    this.#call({ op: 'sync', path: this.resolve(path) });
  }

  /**
   * Not mirrorable: change notifications are the parent tree's, and a thread
   * that wants them would have to bridge them back. `fs.watch` inside a worker
   * therefore sees nothing — an honest, documented gap.
   */
  subscribe(_listener: (change: VfsChange) => void): () => void {
    return NO_SUBSCRIBE();
  }
}

/** Turn a peer's error envelope back into the `VfsError` the bindings expect. */
function translate(err: unknown): unknown {
  if (!(err instanceof SyncChannelError)) return err;
  const code = (err as { code?: unknown }).code;
  const syscall = (err as { syscall?: unknown }).syscall;
  if (typeof code === 'string' && typeof syscall === 'string') {
    const path = (err as { path?: unknown }).path;
    const dest = (err as { dest?: unknown }).dest;
    return new VfsError(
      code,
      syscall,
      typeof path === 'string' ? path : undefined,
      err.message,
      typeof dest === 'string' ? dest : undefined,
    );
  }
  return err;
}
