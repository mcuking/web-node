import type { BindingFactory } from './context';
import { ERRNO } from '../vfs/types';

const O_RDONLY = 0;
const O_WRONLY = 1;
const O_RDWR = 2;
// Open flags below match the local oracle (`node -p "require('fs').constants"`
// on darwin, Node v26.9.0); the runtime has no libuv of its own, so it exposes
// the same numbers the reference build does.
const O_CREAT = 512;
const O_EXCL = 2048;
const O_TRUNC = 1024;
const O_APPEND = 8;
const O_DIRECTORY = 1048576;

export const FS_OPEN_FLAGS = {
  O_RDONLY,
  O_WRONLY,
  O_RDWR,
  O_CREAT,
  O_EXCL,
  O_TRUNC,
  O_APPEND,
  O_DIRECTORY,
} as const;

export const FS_ACCESS_MODES = { F_OK: 0, X_OK: 1, W_OK: 2, R_OK: 4 } as const;

const SIGNALS: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
  SIGIOT: 6,
  SIGBUS: 7,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGSEGV: 11,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
  SIGSTKFLT: 16,
  SIGCHLD: 17,
  SIGCONT: 18,
  SIGSTOP: 19,
  SIGTSTP: 20,
  SIGTTIN: 21,
  SIGTTOU: 22,
  SIGURG: 23,
  SIGXCPU: 24,
  SIGXFSZ: 25,
  SIGVTALRM: 26,
  SIGPROF: 27,
  SIGWINCH: 28,
  SIGIO: 29,
  SIGINFO: 29,
  SIGPWR: 30,
  SIGSYS: 31,
};

const PRIORITY = {
  PRIORITY_LOW: 19,
  PRIORITY_BELOW_NORMAL: 10,
  PRIORITY_NORMAL: 0,
  PRIORITY_ABOVE_NORMAL: -7,
  PRIORITY_HIGH: -14,
  PRIORITY_HIGHEST: -20,
};

// `dlopen(3)` flags. The runtime is POSIX-shaped throughout (its errno table is
// POSIX), so these are the macOS values Node reports here; `constants` exposes
// them lazily and nothing in the runtime branches on them.
const DLOPEN = {
  RTLD_LAZY: 1,
  RTLD_NOW: 2,
  RTLD_GLOBAL: 8,
  RTLD_LOCAL: 4,
};

/**
 * Platform `errno` names/values, mirroring what Node's `DefineErrnoConstants`
 * (`src/node_constants.cc`) emits from the host `<cerrno>` macros. This is a
 * *different* set from the libuv `ERRNO` table above: libuv adds its own
 * pseudo-codes (`EOF`, `ECHARSET`, …) and drops platform aliases. `constants`
 * exposes this platform set (Node's `constants.os.errno`), while the VFS keeps
 * using the libuv table for `uv_strerror`-shaped messages.
 *
 * Values are the local oracle's (`node --expose-internals` on darwin, v26.9.0),
 * like the `O_*` flags above.
 */
const PLATFORM_ERRNO: Record<string, number> = {
  E2BIG: 7,
  EACCES: 13,
  EADDRINUSE: 48,
  EADDRNOTAVAIL: 49,
  EAFNOSUPPORT: 47,
  EAGAIN: 35,
  EALREADY: 37,
  EBADF: 9,
  EBADMSG: 94,
  EBUSY: 16,
  ECANCELED: 89,
  ECHILD: 10,
  ECONNABORTED: 53,
  ECONNREFUSED: 61,
  ECONNRESET: 54,
  EDEADLK: 11,
  EDESTADDRREQ: 39,
  EDOM: 33,
  EDQUOT: 69,
  EEXIST: 17,
  EFAULT: 14,
  EFBIG: 27,
  EHOSTUNREACH: 65,
  EIDRM: 90,
  EILSEQ: 92,
  EINPROGRESS: 36,
  EINTR: 4,
  EINVAL: 22,
  EIO: 5,
  EISCONN: 56,
  EISDIR: 21,
  ELOOP: 62,
  EMFILE: 24,
  EMLINK: 31,
  EMSGSIZE: 40,
  EMULTIHOP: 95,
  ENAMETOOLONG: 63,
  ENETDOWN: 50,
  ENETRESET: 52,
  ENETUNREACH: 51,
  ENFILE: 23,
  ENOBUFS: 55,
  ENODATA: 96,
  ENODEV: 19,
  ENOENT: 2,
  ENOEXEC: 8,
  ENOLCK: 77,
  ENOLINK: 97,
  ENOMEM: 12,
  ENOMSG: 91,
  ENOPROTOOPT: 42,
  ENOSPC: 28,
  ENOSR: 98,
  ENOSTR: 99,
  ENOSYS: 78,
  ENOTCONN: 57,
  ENOTDIR: 20,
  ENOTEMPTY: 66,
  ENOTSOCK: 38,
  ENOTSUP: 45,
  ENOTTY: 25,
  ENXIO: 6,
  EOPNOTSUPP: 102,
  EOVERFLOW: 84,
  EPERM: 1,
  EPIPE: 32,
  EPROTO: 100,
  EPROTONOSUPPORT: 43,
  EPROTOTYPE: 41,
  ERANGE: 34,
  EROFS: 30,
  ESPIPE: 29,
  ESRCH: 3,
  ESTALE: 70,
  ETIME: 101,
  ETIMEDOUT: 60,
  ETXTBSY: 26,
  EWOULDBLOCK: 35,
  EXDEV: 18,
};

/**
 * `constants` binding: errno + open flags + signals. Derived from the host's
 * errno table so VFS errors and Node error codes stay in sync.
 */
export const constantsBinding: BindingFactory = () => {
  const errno: Record<string, number> = {};
  const errnoAbs = ERRNO.ENOENT !== undefined ? Math.abs(ERRNO.ENOENT) : 2;
  for (const [name, value] of Object.entries(ERRNO)) {
    errno[name] = Math.abs(value);
  }
  void errnoAbs;

  return {
    errno,
    errnoMessage: {},
    signals: SIGNALS,
    priority: PRIORITY,
    // Node namespaces the binding's contents (`internalBinding('constants').os`,
    // `.fs`, …). `internal/validators` reads `.os.signals`; keep the flat keys
    // as aliases for the runtime's own callers.
    os: {
      UV_UDP_REUSEADDR: 4,
      dlopen: DLOPEN,
      errno: PLATFORM_ERRNO,
      signals: SIGNALS,
      priority: PRIORITY,
      // `os.devNull` is a string the runtime resolves; `internal/vfs/router`
      // seeds its default mount root from it.
      devNull: '/dev/null',
    },
    fs: {
      O_RDONLY,
      O_WRONLY,
      O_RDWR,
      O_CREAT,
      O_EXCL,
      O_TRUNC,
      O_APPEND,
      O_DIRECTORY,
      // access modes
      F_OK: 0,
      X_OK: 1,
      W_OK: 2,
      R_OK: 4,
      // open flags
      O_SYNC: 128,
      O_DSYNC: 4194304,
      O_NONBLOCK: 4,
      O_NOCTTY: 131072,
      O_SYMLINK: 2097152,
      S_IFMT: 0o170000,
      S_IFREG: 0o100000,
      S_IFDIR: 0o040000,
      S_IFLNK: 0o120000,
      S_IFBLK: 0o060000,
      S_IFCHR: 0o020000,
      S_IFIFO: 0o010000,
      S_IFSOCK: 0o140000,
      S_IRWXU: 0o700,
      S_IRUSR: 0o400,
      S_IWUSR: 0o200,
      S_IXUSR: 0o100,
      S_IRWXG: 0o070,
      S_IRWXO: 0o007,
      // group/other permission bits (`<sys/stat.h>`, same in POSIX)
      S_IRGRP: 0o040,
      S_IWGRP: 0o020,
      S_IXGRP: 0o010,
      S_IROTH: 0o004,
      S_IWOTH: 0o002,
      S_IXOTH: 0o001,
      // `O_NOFOLLOW` (darwin)
      O_NOFOLLOW: 256,
      // libuv symlink / dirent discriminants (internal/fs/utils, internal/vfs)
      UV_FS_SYMLINK_DIR: 1,
      UV_FS_SYMLINK_JUNCTION: 2,
      UV_DIRENT_UNKNOWN: 0,
      UV_DIRENT_FILE: 1,
      UV_DIRENT_DIR: 2,
      UV_DIRENT_LINK: 3,
      UV_DIRENT_FIFO: 4,
      UV_DIRENT_SOCKET: 5,
      UV_DIRENT_CHAR: 6,
      UV_DIRENT_BLOCK: 7,
      UV_FS_O_FILEMAP: 0,
      COPYFILE_EXCL: 1,
      COPYFILE_FICLONE: 2,
      COPYFILE_FICLONE_FORCE: 4,
      // libuv copyfile aliases of the same values (public `constants` keys)
      UV_FS_COPYFILE_EXCL: 1,
      UV_FS_COPYFILE_FICLONE: 2,
      UV_FS_COPYFILE_FICLONE_FORCE: 4,
      // Linux-only custom `O_*` bits; libuv reports 0 on darwin
      UV_FS_O_RANDOM: 0,
      UV_FS_O_SEQUENTIAL: 0,
      UV_FS_O_SHORT_LIVED: 0,
      UV_FS_O_TEMPORARY: 0,
    },
    crypto: {},
    zlib: {},
    dlopen: DLOPEN,
    trace: {},
    // `constants.internal` (`src/node_constants.cc`): how a module with no
    // extension is classified. Read by `internal/vfs/setup.js` when it resolves
    // an extensionless file's `format`.
    internal: {
      EXTENSIONLESS_FORMAT_JAVASCRIPT: 0,
      EXTENSIONLESS_FORMAT_WASM: 1,
    },
    ...errno,
  };
};
