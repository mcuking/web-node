import type { BindingFactory } from './context';
import { ERRNO } from '../vfs/types';

const O_RDONLY = 0;
const O_WRONLY = 1;
const O_RDWR = 2;
const O_CREAT = 64;
const O_EXCL = 128;
const O_TRUNC = 512;
const O_APPEND = 1024;
const O_DIRECTORY = 65536;

const SIGNALS: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
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
      dlopen: {},
      errno,
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
      O_DSYNC: 4096,
      O_NONBLOCK: 2048,
      O_NOCTTY: 256,
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
    },
    crypto: {},
    zlib: {},
    dlopen: {},
    trace: {},
    ...errno,
  };
};
