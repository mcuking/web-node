/**
 * VFS contract.
 *
 * The binding layer only ever talks to this interface, never to the in-memory
 * tree directly. That keeps bindings unit-testable and lets us swap the backing
 * store (memory-only / OPFS-backed / remote) without touching bindings.
 */

import type { PathLike } from './posix';

export type { PathLike };

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

/**
 * A change observed on the VFS, handed to `subscribe()` listeners.
 *
 * The VFS is the only place that knows when a file is written, so this is where
 * watching has to start: `fs.watch` is a thin projection of these events, and a
 * dev server (or any tool that reacts to edits) sits on top of that.
 */
export interface VfsChange {
  /** `create` (path did not exist), `change` (content/metadata) or `delete`. */
  type: 'create' | 'change' | 'delete';
  /** Absolute path that changed. */
  path: string;
}

/** Thrown by VFS operations; carries a POSIX errno code so bindings can map to Node errors. */
export class VfsError extends Error {
  code: string;
  errno: number;
  syscall: string;
  path?: string;

  /**
   * A filesystem error shaped like the one Node's `UVException` builds
   * (`lib/internal/errors.js`): `` `${code}: ${description}, ${syscall} '${path}'` ``,
   * with `name` left as `Error`. The description is libuv's own string
   * (`UV_ERRNO_MAP` in `deps/uv/include/uv.h`), which is what `uv_strerror`
   * returns for the matching errno.
   */
  constructor(code: string, syscall: string, path?: string, message?: string) {
    // An explicit message is used verbatim (that call site owns its wording);
    // otherwise build Node's `code: description, syscall 'path'` form.
    if (message !== undefined) {
      super(message);
    } else {
      const described = `${code}: ${ERRNO_DESC[code] ?? 'unknown error'}, ${syscall}`;
      super(path !== undefined ? `${described} '${path}'` : described);
    }
    this.name = 'Error';
    this.code = code;
    this.errno = ERRNO[code] ?? -1;
    this.syscall = syscall;
    this.path = path;
  }
}

/**
 * libuv's errno table (`UV_ERRNO_MAP` in `deps/uv/include/uv.h`), keyed by the
 * negative errno. Generated from the local Node v26.9.0 oracle
 * (`internalBinding('uv').getErrorMap()`), so the `uv` binding's error map and
 * every `VfsError` errno match a real build exactly.
 */
export const ERRNO_DESC: Record<string, string> = {
  EOF: "end of file",
  UNKNOWN: "unknown error",
  ECHARSET: "invalid Unicode character",
  ENONET: "machine is not on the network",
  EREMOTEIO: "remote I/O error",
  EUNATCH: "protocol driver not attached",
  EAI_PROTOCOL: "resolved protocol is unknown",
  EAI_BADHINTS: "invalid value for hints",
  EAI_SOCKTYPE: "socket type not supported",
  EAI_SERVICE: "service not available for socket type",
  EAI_OVERFLOW: "argument buffer overflow",
  EAI_NONAME: "unknown node or service",
  EAI_NODATA: "no address",
  EAI_MEMORY: "out of memory",
  EAI_FAMILY: "ai_family not supported",
  EAI_FAIL: "permanent failure",
  EAI_CANCELED: "request canceled",
  EAI_BADFLAGS: "bad ai_flags value",
  EAI_AGAIN: "temporary failure",
  EAI_ADDRFAMILY: "address family not supported",
  EPROTO: "protocol error",
  ENODATA: "no data available",
  EILSEQ: "illegal byte sequence",
  ECANCELED: "operation canceled",
  EOVERFLOW: "value too large for defined data type",
  EFTYPE: "inappropriate file type or format",
  ENOSYS: "function not implemented",
  ENOTEMPTY: "directory not empty",
  EHOSTUNREACH: "host is unreachable",
  EHOSTDOWN: "host is down",
  ENAMETOOLONG: "name too long",
  ELOOP: "too many symbolic links encountered",
  ECONNREFUSED: "connection refused",
  ETIMEDOUT: "connection timed out",
  ESHUTDOWN: "cannot send after transport endpoint shutdown",
  ENOTCONN: "socket is not connected",
  EISCONN: "socket is already connected",
  ENOBUFS: "no buffer space available",
  ECONNRESET: "connection reset by peer",
  ECONNABORTED: "software caused connection abort",
  ENETUNREACH: "network is unreachable",
  ENETDOWN: "network is down",
  EADDRNOTAVAIL: "address not available",
  EADDRINUSE: "address already in use",
  EAFNOSUPPORT: "address family not supported",
  ENOTSUP: "operation not supported on socket",
  ESOCKTNOSUPPORT: "socket type not supported",
  EPROTONOSUPPORT: "protocol not supported",
  ENOPROTOOPT: "protocol not available",
  EPROTOTYPE: "protocol wrong type for socket",
  EMSGSIZE: "message too long",
  EDESTADDRREQ: "destination address required",
  ENOTSOCK: "socket operation on non-socket",
  EALREADY: "connection already in progress",
  EAGAIN: "resource temporarily unavailable",
  ERANGE: "result too large",
  EPIPE: "broken pipe",
  EMLINK: "too many links",
  EROFS: "read-only file system",
  ESPIPE: "invalid seek",
  ENOSPC: "no space left on device",
  EFBIG: "file too large",
  ETXTBSY: "text file is busy",
  ENOTTY: "inappropriate ioctl for device",
  EMFILE: "too many open files",
  ENFILE: "file table overflow",
  EINVAL: "invalid argument",
  EISDIR: "illegal operation on a directory",
  ENOTDIR: "not a directory",
  ENODEV: "no such device",
  EXDEV: "cross-device link not permitted",
  EEXIST: "file already exists",
  EBUSY: "resource busy or locked",
  EFAULT: "bad address in system call argument",
  EACCES: "permission denied",
  ENOMEM: "not enough memory",
  EBADF: "bad file descriptor",
  ENOEXEC: "exec format error",
  E2BIG: "argument list too long",
  ENXIO: "no such device or address",
  EIO: "i/o error",
  EINTR: "interrupted system call",
  ESRCH: "no such process",
  ENOENT: "no such file or directory",
  EPERM: "operation not permitted",
};

/** Name → errno (`UV_ERRNO_MAP` order), the inverse of `ERRNO_DESC`. */
export const ERRNO: Record<string, number> = {
  EOF: -4095,
  UNKNOWN: -4094,
  ECHARSET: -4080,
  ENONET: -4056,
  EREMOTEIO: -4030,
  EUNATCH: -4023,
  EAI_PROTOCOL: -3014,
  EAI_BADHINTS: -3013,
  EAI_SOCKTYPE: -3011,
  EAI_SERVICE: -3010,
  EAI_OVERFLOW: -3009,
  EAI_NONAME: -3008,
  EAI_NODATA: -3007,
  EAI_MEMORY: -3006,
  EAI_FAMILY: -3005,
  EAI_FAIL: -3004,
  EAI_CANCELED: -3003,
  EAI_BADFLAGS: -3002,
  EAI_AGAIN: -3001,
  EAI_ADDRFAMILY: -3000,
  EPROTO: -100,
  ENODATA: -96,
  EILSEQ: -92,
  ECANCELED: -89,
  EOVERFLOW: -84,
  EFTYPE: -79,
  ENOSYS: -78,
  ENOTEMPTY: -66,
  EHOSTUNREACH: -65,
  EHOSTDOWN: -64,
  ENAMETOOLONG: -63,
  ELOOP: -62,
  ECONNREFUSED: -61,
  ETIMEDOUT: -60,
  ESHUTDOWN: -58,
  ENOTCONN: -57,
  EISCONN: -56,
  ENOBUFS: -55,
  ECONNRESET: -54,
  ECONNABORTED: -53,
  ENETUNREACH: -51,
  ENETDOWN: -50,
  EADDRNOTAVAIL: -49,
  EADDRINUSE: -48,
  EAFNOSUPPORT: -47,
  ENOTSUP: -45,
  ESOCKTNOSUPPORT: -44,
  EPROTONOSUPPORT: -43,
  ENOPROTOOPT: -42,
  EPROTOTYPE: -41,
  EMSGSIZE: -40,
  EDESTADDRREQ: -39,
  ENOTSOCK: -38,
  EALREADY: -37,
  EAGAIN: -35,
  ERANGE: -34,
  EPIPE: -32,
  EMLINK: -31,
  EROFS: -30,
  ESPIPE: -29,
  ENOSPC: -28,
  EFBIG: -27,
  ETXTBSY: -26,
  ENOTTY: -25,
  EMFILE: -24,
  ENFILE: -23,
  EINVAL: -22,
  EISDIR: -21,
  ENOTDIR: -20,
  ENODEV: -19,
  EXDEV: -18,
  EEXIST: -17,
  EBUSY: -16,
  EFAULT: -14,
  EACCES: -13,
  ENOMEM: -12,
  EBADF: -9,
  ENOEXEC: -8,
  E2BIG: -7,
  ENXIO: -6,
  EIO: -5,
  EINTR: -4,
  ESRCH: -3,
  ENOENT: -2,
  EPERM: -1,
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
  resolve(p: PathLike): string;

  /**
   * Observe changes to the tree. Returns an unsubscribe function.
   *
   * A browser tab has no inotify, so watching is only as live as the writes that
   * go through this VFS — which, for everything running inside the runtime, is
   * all of them.
   */
  subscribe(listener: (change: VfsChange) => void): () => void;
}
