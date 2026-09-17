/**
 * VFS contract.
 *
 * The binding layer only ever talks to this interface, never to the in-memory
 * tree directly. That keeps bindings unit-testable and lets us swap the backing
 * store (memory-only / OPFS-backed / remote) without touching bindings.
 */

export type NodeType = 'file' | 'dir';

export interface Stat {
  type: NodeType;
  size: number;
  mode: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  blksize: number;
  blocks: number;
  atimeMs: number;
  birthtimeMs: number;
}

export interface Dirent {
  name: string;
  type: NodeType;
}

export interface WriteOptions {
  flag?: string;
  mode?: number;
}

export interface MkdirOptions {
  recursive?: boolean;
  mode?: number;
}

export interface ReaddirOptions {
  withFileTypes?: boolean;
  recursive?: boolean;
}

/** Thrown by VFS operations; carries a POSIX errno code so bindings can map to Node errors. */
export class VfsError extends Error {
  code: string;
  errno: number;
  syscall: string;
  path?: string;

  constructor(code: string, syscall: string, path?: string, message?: string) {
    super(message ?? `${code}: ${syscall}${path ? `, '${path}'` : ''}`);
    this.name = 'VfsError';
    this.code = code;
    this.errno = ERRNO[code] ?? -1;
    this.syscall = syscall;
    this.path = path;
  }
}

export const ERRNO: Record<string, number> = {
  EPERM: -1,
  ENOENT: -2,
  ESRCH: -3,
  EINTR: -4,
  EIO: -5,
  ENXIO: -6,
  E2BIG: -7,
  ENOEXEC: -8,
  EBADF: -9,
  ECHILD: -10,
  EAGAIN: -11,
  ENOMEM: -12,
  EACCES: -13,
  EFAULT: -14,
  EBUSY: -16,
  EEXIST: -17,
  EXDEV: -18,
  ENODEV: -19,
  ENOTDIR: -20,
  EISDIR: -21,
  EINVAL: -22,
  ENFILE: -23,
  EMFILE: -24,
  ENOTTY: -25,
  ETXTBSY: -26,
  EFBIG: -27,
  ENOSPC: -28,
  ESPIPE: -29,
  EROFS: -30,
  EMLINK: -31,
  EPIPE: -32,
  EDOM: -33,
  ERANGE: -34,
  ENAMETOOLONG: -36,
  ENOSYS: -38,
  ENOTEMPTY: -39,
  ELOOP: -40,
  EOVERFLOW: -75,
  ENOTSUP: -95,
  EISNAM: -120,
  EKEYREJECTED: -129,
};

export interface Vfs {
  readonly cwd: string;
  chdir(dir: string): void;

  readFile(path: string): Uint8Array;
  writeFile(path: string, data: Uint8Array, opts?: WriteOptions): void;
  appendFile(path: string, data: Uint8Array): void;

  exists(path: string): boolean;
  stat(path: string): Stat;
  mkdir(path: string, opts?: MkdirOptions): void;
  readdir(path: string, opts?: ReaddirOptions): Dirent[];
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): void;
  rename(from: string, to: string): void;
  copyFile(from: string, to: string): void;
  chmod(path: string, mode: number): void;

  /** Resolve a (possibly relative) path against the current working directory. */
  resolve(p: string): string;
}
