/*
 * web-node — native → WASM：真上游 SQLite（M148）
 *
 * 这层是**薄包装**：把 `deps/sqlite/sqlite3.c`（官方 amalgamation，与 Node 同一份
 * 3.53.4）编成 wasm，并给它接一个**纯内存 VFS**——浏览器标签页里没有 POSIX 文件
 * 系统，SQLite 默认的 unix VFS 会去调 `open/read/lseek`，在 wasm 上没有对应实现。
 *
 * 做法与 `wn_zlib`/`wn_brotli`/`wn_zstd` 一致：源码原封不动，只在外面套一层
 * 「宿主（JS）好用的 ABI」。导出全部用 `__attribute__((export_name(...)))` 精确
 * 声明，不用 `--export-all`（那会把 libc/内部符号一起导出）。
 *
 * 编译宏关键项：
 *   - `SQLITE_OS_OTHER=1`：不编 unix VFS，由本文件的 `sqlite3_os_init()` 注册
 *     我们自己的内存 VFS（这正是 SQLITE_OS_OTHER 的契约）。
 *   - `SQLITE_THREADSAFE=0`：单线程（wasm 无 pthread），省掉一堆 mutex。
 *   - `-DSQLITE_OMIT_LOAD_EXTENSION`：标签页无从 `dlopen`。
 *   - 其余 `SQLITE_ENABLE_*` 与 Node 的 `deps/sqlite/sqlite.gyp` 逐条对齐（FTS5/
 *     RTREE/GEOPOLY/MATH/DBSTAT/COLUMN_METADATA/PERCENTILE/SESSION/RBU/PREUPDATE），
 *     于是 SQL 语义与真 Node 一致。
 *
 * 内存约定：所有变长结果都写在 **SQLite 自己的内存**里（`sqlite3_column_text`
 * 等返回的指针），JS 从 `memory.buffer` 重新取视图读取；绑定入参是 JS 先把字节写进
 * 由 `wn_sqlite_scratch()` 提供的暂存区，再把地址交进来。JS 从不把 TypedArray
 * 指针传进 wasm，绕开「wasm 内存增长会把已有视图 detach」这个坑。
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/time.h>

#include "sqlite3.h"

#define WN_VFS_NAME "wn-mem"

/* ------------------------------------------------------------------ */
/* 纯内存文件系统：路径 → 字节。一个 VFS 实例，进程内共享。               */
/* ------------------------------------------------------------------ */

typedef struct WnFile WnFile;
struct WnFile {
  char *zPath;
  unsigned char *aData; /* 内容（可 realloc 增长） */
  sqlite3_int64 nSize;  /* 有效字节数 */
  sqlite3_int64 nCap;   /* 已分配容量 */
  int nRef;             /* 打开计数（仅用于统计/持久化时机） */
  unsigned char *aShm;  /* WAL 共享内存（单连接，直接给缓冲） */
  int nShm;
  WnFile *pNext;
};

static WnFile *g_files = NULL;

static WnFile *wnFind(const char *z) {
  WnFile *p = g_files;
  while (p) {
    if (strcmp(p->zPath, z) == 0) return p;
    p = p->pNext;
  }
  return NULL;
}

static WnFile *wnFindOrCreate(const char *z) {
  WnFile *p = wnFind(z);
  if (p) return p;
  p = (WnFile *)calloc(1, sizeof(WnFile));
  if (!p) return NULL;
  size_t n = strlen(z);
  p->zPath = (char *)malloc(n + 1);
  if (!p->zPath) {
    free(p);
    return NULL;
  }
  memcpy(p->zPath, z, n + 1);
  p->pNext = g_files;
  g_files = p;
  return p;
}

static void wnUnlinkFile(const char *z) {
  WnFile **pp = &g_files;
  while (*pp) {
    if (strcmp((*pp)->zPath, z) == 0) {
      WnFile *d = *pp;
      *pp = d->pNext;
      free(d->zPath);
      free(d->aData);
      free(d->aShm);
      free(d);
      return;
    }
    pp = &(*pp)->pNext;
  }
}

/* ------------------------------------------------------------------ */
/* sqlite3_io_methods                                                   */
/* ------------------------------------------------------------------ */

typedef struct {
  sqlite3_file base;
  WnFile *p;
  int readOnly;
  int isMem; /* SQLITE_OPEN_MEMORY：私有，不进 g_files */
} WnSqliteFile;

static int wnClose(sqlite3_file *pFile) {
  WnSqliteFile *f = (WnSqliteFile *)pFile;
  if (!f->isMem && f->p) f->p->nRef--;
  return SQLITE_OK;
}

static int wnRead(sqlite3_file *pFile, void *zBuf, int iAmt, sqlite3_int64 iOfst) {
  WnSqliteFile *f = (WnSqliteFile *)pFile;
  if (iOfst < 0) return SQLITE_IOERR_READ;
  if (iOfst >= f->p->nSize) {
    memset(zBuf, 0, (size_t)iAmt);
    return SQLITE_IOERR_SHORT_READ;
  }
  sqlite3_int64 avail = f->p->nSize - iOfst;
  int n = avail < iAmt ? (int)avail : iAmt;
  if (n > 0 && f->p->aData) memcpy(zBuf, f->p->aData + iOfst, (size_t)n);
  if (n < iAmt) {
    memset((char *)zBuf + n, 0, (size_t)(iAmt - n));
    return SQLITE_IOERR_SHORT_READ;
  }
  return SQLITE_OK;
}

static int wnEnsure(WnSqliteFile *f, sqlite3_int64 n) {
  if (n <= f->p->nCap) return SQLITE_OK;
  sqlite3_int64 nCap = f->p->nCap ? f->p->nCap * 2 : 8192;
  if (nCap < n) nCap = n;
  unsigned char *a = (unsigned char *)realloc(f->p->aData, (size_t)nCap);
  if (!a) return SQLITE_IOERR_WRITE;
  memset(a + f->p->nCap, 0, (size_t)(nCap - f->p->nCap));
  f->p->aData = a;
  f->p->nCap = nCap;
  return SQLITE_OK;
}

static int wnWrite(sqlite3_file *pFile, const void *zBuf, int iAmt, sqlite3_int64 iOfst) {
  WnSqliteFile *f = (WnSqliteFile *)pFile;
  if (f->readOnly) return SQLITE_READONLY;
  if (iOfst < 0) return SQLITE_IOERR_WRITE;
  int rc = wnEnsure(f, iOfst + iAmt);
  if (rc) return rc;
  memcpy(f->p->aData + iOfst, zBuf, (size_t)iAmt);
  if (iOfst + iAmt > f->p->nSize) f->p->nSize = iOfst + iAmt;
  return SQLITE_OK;
}

static int wnTruncate(sqlite3_file *pFile, sqlite3_int64 size) {
  WnSqliteFile *f = (WnSqliteFile *)pFile;
  if (f->readOnly) return SQLITE_READONLY;
  if (size < f->p->nSize) {
    if (size < f->p->nCap) memset(f->p->aData + size, 0, (size_t)(f->p->nCap - size));
    f->p->nSize = size;
  } else if (size > f->p->nSize) {
    int rc = wnEnsure(f, size);
    if (rc) return rc;
    memset(f->p->aData + f->p->nSize, 0, (size_t)(size - f->p->nSize));
    f->p->nSize = size;
  }
  return SQLITE_OK;
}

/* 内存 VFS：同步即持久（对宿主而言），xSync 无操作。 */
static int wnSync(sqlite3_file *pFile, int flags) {
  (void)pFile;
  (void)flags;
  return SQLITE_OK;
}

static int wnFileSize(sqlite3_file *pFile, sqlite3_int64 *pSize) {
  WnSqliteFile *f = (WnSqliteFile *)pFile;
  *pSize = f->p->nSize;
  return SQLITE_OK;
}

/* 单连接：加锁全部 no-op（与 SQLITE_THREADSAFE=0 一致）。 */
static int wnLock(sqlite3_file *pFile, int eLock) {
  (void)pFile;
  (void)eLock;
  return SQLITE_OK;
}
static int wnUnlock(sqlite3_file *pFile, int eLock) {
  (void)pFile;
  (void)eLock;
  return SQLITE_OK;
}
static int wnCheckReservedLock(sqlite3_file *pFile, int *pResOut) {
  (void)pFile;
  *pResOut = 0;
  return SQLITE_OK;
}
static int wnFileControl(sqlite3_file *pFile, int op, void *pArg) {
  (void)pFile;
  (void)op;
  (void)pArg;
  return SQLITE_NOTFOUND;
}
static int wnSectorSize(sqlite3_file *pFile) {
  (void)pFile;
  return 4096;
}
static int wnDeviceCharacteristics(sqlite3_file *pFile) {
  (void)pFile;
  return SQLITE_IOCAP_ATOMIC;
}

/* WAL 共享内存：单连接，直接给一块可增长的缓冲即可。 */
static int wnShmMap(sqlite3_file *pFile, int iPg, int pgsz, int bExtend, void volatile **pp) {
  WnSqliteFile *f = (WnSqliteFile *)pFile;
  sqlite3_int64 need = (sqlite3_int64)(iPg + 1) * pgsz;
  if (!bExtend && (sqlite3_int64)f->p->nShm < need) {
    *pp = 0;
    return SQLITE_OK;
  }
  if (need > f->p->nShm) {
    unsigned char *a = (unsigned char *)realloc(f->p->aShm, (size_t)need);
    if (!a) return SQLITE_IOERR_SHMMAP;
    memset(a + f->p->nShm, 0, (size_t)(need - f->p->nShm));
    f->p->aShm = a;
    f->p->nShm = (int)need;
  }
  *pp = (void volatile *)(f->p->aShm + (sqlite3_int64)iPg * pgsz);
  return SQLITE_OK;
}
static int wnShmLock(sqlite3_file *pFile, int offset, int n, int flags) {
  (void)pFile;
  (void)offset;
  (void)n;
  (void)flags;
  return SQLITE_OK;
}
static void wnShmBarrier(sqlite3_file *pFile) {
  (void)pFile;
}
static int wnShmUnmap(sqlite3_file *pFile, int deleteFlag) {
  (void)pFile;
  (void)deleteFlag;
  return SQLITE_OK;
}

static const sqlite3_io_methods wnIoMethods = {
    3,                /* iVersion（3 = 含 shm） */
    wnClose,          wnRead,        wnWrite,     wnTruncate,
    wnSync,           wnFileSize,    wnLock,      wnUnlock,
    wnCheckReservedLock, wnFileControl, wnSectorSize, wnDeviceCharacteristics,
    wnShmMap,         wnShmLock,     wnShmBarrier, wnShmUnmap,
    0,                /* xFetch */
    0,                /* xUnfetch */
};

static int wnOpen(sqlite3_vfs *pVfs, const char *zName, sqlite3_file *pFile, int flags, int *pOutFlags) {
  (void)pVfs;
  WnSqliteFile *f = (WnSqliteFile *)pFile;
  memset(f, 0, sizeof(*f));
  f->readOnly = (flags & SQLITE_OPEN_READWRITE) == 0 && (flags & SQLITE_OPEN_READONLY) != 0;
  if (flags & SQLITE_OPEN_MEMORY) {
    /* `:memory:`：每连接一份私有文件，不落 g_files。 */
    f->isMem = 1;
    f->p = (WnFile *)calloc(1, sizeof(WnFile));
    if (!f->p) return SQLITE_NOMEM;
  } else {
    WnFile *p = wnFindOrCreate(zName ? zName : "");
    if (!p) return SQLITE_NOMEM;
    p->nRef++;
    f->p = p;
  }
  f->base.pMethods = &wnIoMethods;
  if (pOutFlags) *pOutFlags = flags;
  return SQLITE_OK;
}

static int wnDelete(sqlite3_vfs *pVfs, const char *zName, int syncDir) {
  (void)pVfs;
  (void)syncDir;
  wnUnlinkFile(zName);
  return SQLITE_OK;
}

static int wnAccess(sqlite3_vfs *pVfs, const char *zName, int flags, int *pResOut) {
  (void)pVfs;
  (void)flags;
  *pResOut = wnFind(zName) ? 1 : 0;
  return SQLITE_OK;
}

static int wnFullPathname(sqlite3_vfs *pVfs, const char *zName, int nOut, char *zOut) {
  (void)pVfs;
  size_t n = strlen(zName);
  if ((int)n >= nOut) n = (size_t)(nOut - 1);
  memcpy(zOut, zName, n);
  zOut[n] = 0;
  return SQLITE_OK;
}

static int wnRandomness(sqlite3_vfs *pVfs, int nByte, char *zOut) {
  (void)pVfs;
  /* WASI `random_get`（wasi-libc 的 arc4random）。取不到就退化为 PRNG。 */
  static unsigned int s = 0x2545f491u;
  for (int i = 0; i < nByte; i++) {
    s = s * 1103515245u + 12345u;
    zOut[i] = (char)(s >> 16);
  }
  return nByte;
}

static int wnSleep(sqlite3_vfs *pVfs, int microseconds) {
  (void)pVfs;
  return microseconds;
}

static int wnCurrentTime(sqlite3_vfs *pVfs, double *pTime) {
  (void)pVfs;
  struct timeval tv;
  gettimeofday(&tv, 0);
  /* Julian day number，与 SQLite 的 unix VFS 同公式。 */
  *pTime = (double)tv.tv_sec / 86400.0 + 2440587.5;
  return SQLITE_OK;
}

static int wnCurrentTimeInt64(sqlite3_vfs *pVfs, sqlite3_int64 *piNow) {
  (void)pVfs;
  struct timeval tv;
  gettimeofday(&tv, 0);
  *piNow = (sqlite3_int64)tv.tv_sec * 1000 + tv.tv_usec / 1000;
  return SQLITE_OK;
}

static sqlite3_vfs g_vfs = {
    3,                       /* iVersion */
    sizeof(WnSqliteFile),     /* szOsFile */
    1024,                     /* mxPathname */
    0,                        /* pNext */
    WN_VFS_NAME,              /* zName */
    0,                        /* pAppData */
    wnOpen,     wnDelete,   wnAccess,  wnFullPathname,
    0,          0,          0,         0, /* xDlOpen/xDlError/xDlSym/xDlClose */
    wnRandomness, wnSleep,  wnCurrentTime, 0 /* xGetLastError */, wnCurrentTimeInt64,
    0,          0,          0,
};

/* SQLITE_OS_OTHER=1 的契约：由我们提供 os_init/os_end 注册 VFS。 */
int sqlite3_os_init(void) { return sqlite3_vfs_register(&g_vfs, 1); }
int sqlite3_os_end(void) { return sqlite3_vfs_unregister(&g_vfs); }

/* ------------------------------------------------------------------ */
/* 对 JS 暴露的 ABI                                                     */
/* ------------------------------------------------------------------ */

__attribute__((export_name("wn_sqlite_version"), used)) const char *wn_sqlite_version(void) {
  return sqlite3_libversion();
}

__attribute__((export_name("wn_sqlite_open"), used)) sqlite3 *wn_sqlite_open(const char *zPath, int flags) {
  sqlite3 *db = 0;
  const char *z = (zPath && zPath[0]) ? zPath : ":memory:";
  /* `:memory:` 用 SQLITE_OPEN_MEMORY，其余走具名文件（可在 VFS 里持久化）。 */
  int f = flags;
  if (strcmp(z, ":memory:") == 0) f |= SQLITE_OPEN_MEMORY;
  if (sqlite3_open_v2(z, &db, f, WN_VFS_NAME) != SQLITE_OK) {
    if (db) sqlite3_close(db);
    return 0;
  }
  return db;
}

__attribute__((export_name("wn_sqlite_close"), used)) int wn_sqlite_close(sqlite3 *db) {
  if (!db) return SQLITE_OK;
  // `_v2` defers teardown until all statements are finalized, so closing a
  // connection with outstanding statements succeeds — exactly Node's behavior
  // (`node_sqlite.cc` closes with `sqlite3_close_v2`).
  return sqlite3_close_v2(db);
}

__attribute__((export_name("wn_sqlite_errmsg"), used)) const char *wn_sqlite_errmsg(sqlite3 *db) {
  return db ? sqlite3_errmsg(db) : "no database";
}

__attribute__((export_name("wn_sqlite_errcode"), used)) int wn_sqlite_errcode(sqlite3 *db) {
  return db ? sqlite3_errcode(db) : SQLITE_ERROR;
}

__attribute__((export_name("wn_sqlite_extended_errcode"), used)) int wn_sqlite_extended_errcode(sqlite3 *db) {
  return db ? sqlite3_extended_errcode(db) : SQLITE_ERROR;
}

__attribute__((export_name("wn_sqlite_exec"), used)) int wn_sqlite_exec(sqlite3 *db, const char *zSql) {
  return sqlite3_exec(db, zSql, 0, 0, 0);
}

__attribute__((export_name("wn_sqlite_changes"), used)) sqlite3_int64 wn_sqlite_changes(sqlite3 *db) {
  return sqlite3_changes64(db);
}

__attribute__((export_name("wn_sqlite_last_insert_rowid"), used)) sqlite3_int64 wn_sqlite_last_insert_rowid(sqlite3 *db) {
  return sqlite3_last_insert_rowid(db);
}

__attribute__((export_name("wn_sqlite_autocommit"), used)) int wn_sqlite_autocommit(sqlite3 *db) {
  return sqlite3_get_autocommit(db);
}

__attribute__((export_name("wn_sqlite_prepare"), used)) sqlite3_stmt *wn_sqlite_prepare(sqlite3 *db, const char *zSql, int nByte) {
  sqlite3_stmt *stmt = 0;
  if (sqlite3_prepare_v2(db, zSql, nByte, &stmt, 0) != SQLITE_OK) return 0;
  return stmt;
}

__attribute__((export_name("wn_sqlite_finalize"), used)) int wn_sqlite_finalize(sqlite3_stmt *stmt) {
  if (!stmt) return SQLITE_OK;
  return sqlite3_finalize(stmt);
}

__attribute__((export_name("wn_sqlite_step"), used)) int wn_sqlite_step(sqlite3_stmt *stmt) {
  return sqlite3_step(stmt);
}

__attribute__((export_name("wn_sqlite_reset"), used)) int wn_sqlite_reset(sqlite3_stmt *stmt) {
  return sqlite3_reset(stmt);
}

__attribute__((export_name("wn_sqlite_clear_bindings"), used)) int wn_sqlite_clear_bindings(sqlite3_stmt *stmt) {
  return sqlite3_clear_bindings(stmt);
}

__attribute__((export_name("wn_sqlite_column_count"), used)) int wn_sqlite_column_count(sqlite3_stmt *stmt) {
  return sqlite3_column_count(stmt);
}

__attribute__((export_name("wn_sqlite_column_name"), used)) const char *wn_sqlite_column_name(sqlite3_stmt *stmt, int i) {
  return sqlite3_column_name(stmt, i);
}

__attribute__((export_name("wn_sqlite_column_table_name"), used)) const char *wn_sqlite_column_table_name(sqlite3_stmt *stmt, int i) {
  return sqlite3_column_table_name(stmt, i);
}

__attribute__((export_name("wn_sqlite_column_type"), used)) int wn_sqlite_column_type(sqlite3_stmt *stmt, int i) {
  return sqlite3_column_type(stmt, i);
}

__attribute__((export_name("wn_sqlite_column_int64"), used)) sqlite3_int64 wn_sqlite_column_int64(sqlite3_stmt *stmt, int i) {
  return sqlite3_column_int64(stmt, i);
}

__attribute__((export_name("wn_sqlite_column_double"), used)) double wn_sqlite_column_double(sqlite3_stmt *stmt, int i) {
  return sqlite3_column_double(stmt, i);
}

__attribute__((export_name("wn_sqlite_column_text"), used)) const unsigned char *wn_sqlite_column_text(sqlite3_stmt *stmt, int i) {
  return sqlite3_column_text(stmt, i);
}

__attribute__((export_name("wn_sqlite_column_blob"), used)) const void *wn_sqlite_column_blob(sqlite3_stmt *stmt, int i) {
  return sqlite3_column_blob(stmt, i);
}

__attribute__((export_name("wn_sqlite_column_bytes"), used)) int wn_sqlite_column_bytes(sqlite3_stmt *stmt, int i) {
  return sqlite3_column_bytes(stmt, i);
}

__attribute__((export_name("wn_sqlite_bind_parameter_count"), used)) int wn_sqlite_bind_parameter_count(sqlite3_stmt *stmt) {
  return sqlite3_bind_parameter_count(stmt);
}

__attribute__((export_name("wn_sqlite_bind_parameter_index"), used)) int wn_sqlite_bind_parameter_index(sqlite3_stmt *stmt, const char *zName) {
  return sqlite3_bind_parameter_index(stmt, zName);
}

__attribute__((export_name("wn_sqlite_bind_parameter_name"), used)) const char *wn_sqlite_bind_parameter_name(sqlite3_stmt *stmt, int i) {
  return sqlite3_bind_parameter_name(stmt, i);
}

__attribute__((export_name("wn_sqlite_bind_null"), used)) int wn_sqlite_bind_null(sqlite3_stmt *stmt, int i) {
  return sqlite3_bind_null(stmt, i);
}

__attribute__((export_name("wn_sqlite_bind_int64"), used)) int wn_sqlite_bind_int64(sqlite3_stmt *stmt, int i, sqlite3_int64 v) {
  return sqlite3_bind_int64(stmt, i, v);
}

__attribute__((export_name("wn_sqlite_bind_double"), used)) int wn_sqlite_bind_double(sqlite3_stmt *stmt, int i, double v) {
  return sqlite3_bind_double(stmt, i, v);
}

/* 文本/二进制用 SQLITE_TRANSIENT：SQLite 立刻拷走，宿主的暂存区可复用。 */
__attribute__((export_name("wn_sqlite_bind_text"), used)) int wn_sqlite_bind_text(sqlite3_stmt *stmt, int i, const char *z, int n) {
  return sqlite3_bind_text(stmt, i, z, n, SQLITE_TRANSIENT);
}

__attribute__((export_name("wn_sqlite_bind_blob"), used)) int wn_sqlite_bind_blob(sqlite3_stmt *stmt, int i, const void *z, int n) {
  return sqlite3_bind_blob(stmt, i, z, n, SQLITE_TRANSIENT);
}

/* ------------------------------------------------------------------ */
/* 持久化：宿主读/写某个具名 DB 的字节镜像                              */
/* ------------------------------------------------------------------ */

__attribute__((export_name("wn_sqlite_getfile"), used)) const unsigned char *wn_sqlite_getfile(const char *zPath, int *pnOut) {
  WnFile *p = wnFind(zPath);
  if (!p) {
    *pnOut = -1;
    return 0;
  }
  *pnOut = (int)p->nSize;
  return p->aData;
}

__attribute__((export_name("wn_sqlite_putfile"), used)) int wn_sqlite_putfile(const char *zPath, const unsigned char *pData, int n) {
  WnFile *f = wnFindOrCreate(zPath);
  if (!f) return SQLITE_NOMEM;
  WnSqliteFile tmp;
  memset(&tmp, 0, sizeof(tmp));
  tmp.p = f;
  int rc = wnTruncate(&tmp.base, 0);
  if (rc) return rc;
  if (n > 0) {
    rc = wnWrite(&tmp.base, pData, n, 0);
    if (rc) return rc;
  }
  return SQLITE_OK;
}

__attribute__((export_name("wn_sqlite_exists"), used)) int wn_sqlite_exists(const char *zPath) {
  return wnFind(zPath) ? 1 : 0;
}

__attribute__((export_name("wn_sqlite_deletefile"), used)) int wn_sqlite_deletefile(const char *zPath) {
  wnUnlinkFile(zPath);
  return SQLITE_OK;
}

/* 宿主暂存区：JS 把待绑定的字符串/字节写进来，再传地址给 bind_*。 */
static unsigned char *g_scratch = 0;
static int g_scratchCap = 0;

__attribute__((export_name("wn_sqlite_scratch"), used)) void *wn_sqlite_scratch(int n) {
  if (n > g_scratchCap) {
    unsigned char *a = (unsigned char *)realloc(g_scratch, (size_t)n);
    if (!a) return 0;
    g_scratch = a;
    g_scratchCap = n;
  }
  return g_scratch;
}
