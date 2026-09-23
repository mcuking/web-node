/*
 * web-node — native → WASM：真 zlib（M116）
 *
 * 这层是**薄包装**，把 `deps/zlib` 的流式 C API 封成一个宿主（JS）好用的 ABI：
 * 缓冲区由 wasm 侧持有（`wn_zlib_ensure` 按需 realloc），所以 JS 永远不需要把
 * 自己的 TypedArray 指针传进 wasm——也就绕开了「wasm 内存 grow 会把已有视图
 * detach」这个坑。JS 每次调用前重新取视图即可。
 *
 * 语义（mode → windowBits 映射、字典、错误）逐条对齐 Node 的
 * `src/node_zlib.cc`（`ZlibContext`），这样上层 `builtins/zlib.ts` 的行为能
 * 与真 Node 逐字节一致。
 *
 * 导出用 `__attribute__((export_name(...)))` 精确声明。
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "zlib.h"

/* node_zlib_mode —— 与 Node 的 `enum node_zlib_mode` 同值。 */
enum {
  WN_DEFLATE = 1,
  WN_INFLATE = 2,
  WN_GZIP = 3,
  WN_GUNZIP = 4,
  WN_DEFLATERAW = 5,
  WN_INFLATERAW = 6,
  WN_UNZIP = 7,
};

typedef struct {
  z_stream strm;
  int mode;
  int zlib_init_done;
  int window_bits; /* 模式映射之后的有效值 */
  int level;
  int mem_level;
  int strategy;
  int err;
  /* 由本模块持有的暂存缓冲（都是 wasm 线性内存里的地址）。 */
  uint8_t *in_buf;
  uint32_t in_cap;
  uint8_t *out_buf;
  uint32_t out_cap;
  uint8_t *dict;
  uint32_t dict_cap;
  uint32_t dict_len;
  /* UNZIP：首两个字节是否 gzip 魔数。仅用于「多成员 gzip」判定。 */
  int sniffed;
  int is_gzip;
  /* `Z_STREAM_END` 之后是否拒绝尾随字节。 */
  int reject_garbage;
} wn_zstream;

/* ---------------- 内存 ---------------- */

__attribute__((export_name("wn_zlib_alloc"), used))
void *wn_zlib_alloc(uint32_t size) {
  return malloc(size);
}

__attribute__((export_name("wn_zlib_free"), used))
void wn_zlib_free(void *p) {
  free(p);
}

/* ---------------- 常量 / 工具 ---------------- */

__attribute__((export_name("wn_zlib_version"), used))
const char *wn_zlib_version(void) {
  return zlibVersion();
}

__attribute__((export_name("wn_zlib_crc32"), used))
uint32_t wn_zlib_crc32(uint32_t value, const uint8_t *buf, uint32_t len) {
  return (uint32_t)crc32((uLong)value, (const Bytef *)buf, (uInt)len);
}

__attribute__((export_name("wn_zlib_adler32"), used))
uint32_t wn_zlib_adler32(uint32_t value, const uint8_t *buf, uint32_t len) {
  return (uint32_t)adler32((uLong)value, (const Bytef *)buf, (uInt)len);
}

__attribute__((export_name("wn_zlib_compress_bound"), used))
uint64_t wn_zlib_compress_bound(uint64_t src_len) {
  return (uint64_t)compressBound((uLong)src_len);
}

/* ---------------- 生命周期 ---------------- */

static int effective_window_bits(int mode, int window_bits) {
  int wb = window_bits;
  if (mode == WN_GZIP || mode == WN_GUNZIP) {
    wb += 16;
  }
  if (mode == WN_UNZIP) {
    wb += 32;
  }
  if (mode == WN_DEFLATERAW || mode == WN_INFLATERAW) {
    wb *= -1;
  }
  return wb;
}

__attribute__((export_name("wn_zlib_new"), used))
wn_zstream *wn_zlib_new(int mode, int level, int window_bits, int mem_level,
                        int strategy) {
  wn_zstream *h = (wn_zstream *)calloc(1, sizeof(wn_zstream));
  if (h == NULL) {
    return NULL;
  }
  h->mode = mode;
  h->level = level;
  h->mem_level = mem_level;
  h->strategy = strategy;
  h->window_bits = effective_window_bits(mode, window_bits);
  h->zlib_init_done = 0;
  h->err = Z_OK;
  return h;
}

/* 惰性 `deflateInit2` / `inflateInit2`（对齐 `ZlibContext::InitZlib`）。
 *
 * 已初始化时返回 `Z_OK`——**不能把 `h->err` 当成功标志**：它保存的是上一次操作的
 * 返回码（可能是 `Z_STREAM_END`/`Z_BUF_ERROR`），拿它当门会误判为「初始化失败」而
 * 跳过真正的写入，调用方就会看到陈旧的 `avail_out`（进而重复输出上一次的字节）。 */
static int wn_init_stream(wn_zstream *h) {
  if (h->zlib_init_done) {
    return Z_OK;
  }
  h->strm.msg = NULL;
  switch (h->mode) {
    case WN_DEFLATE:
    case WN_GZIP:
    case WN_DEFLATERAW:
      h->err = deflateInit2(&h->strm, h->level, Z_DEFLATED, h->window_bits,
                            h->mem_level, h->strategy);
      break;
    case WN_INFLATE:
    case WN_GUNZIP:
    case WN_INFLATERAW:
    case WN_UNZIP:
      h->err = inflateInit2(&h->strm, h->window_bits);
      break;
    default:
      h->err = Z_STREAM_ERROR;
      break;
  }
  if (h->err != Z_OK) {
    return h->err;
  }
  h->zlib_init_done = 1;
  return Z_OK;
}

/*
 * 把写进 `dict` 暂存区的预设字典装进流。对齐 `ZlibContext::SetDictionary`：
 * deflate 侧直接 `deflateSetDictionary`；`INFLATERAW` 直接 `inflateSetDictionary`；
 * 其余 inflate 侧等 `inflate()` 返回 `Z_NEED_DICT` 时再装（见 `wn_zlib_write`）。
 */
static int wn_apply_dictionary(wn_zstream *h) {
  if (h->dict_len == 0) {
    return Z_OK;
  }
  h->err = Z_OK;
  switch (h->mode) {
    case WN_DEFLATE:
    case WN_DEFLATERAW:
      h->err = deflateSetDictionary(&h->strm, h->dict, h->dict_len);
      break;
    case WN_INFLATERAW:
      h->err = inflateSetDictionary(&h->strm, h->dict, h->dict_len);
      break;
    default:
      break;
  }
  return h->err;
}

__attribute__((export_name("wn_zlib_end"), used))
int wn_zlib_end(wn_zstream *h) {
  if (h == NULL) {
    return Z_STREAM_ERROR;
  }
  int status = Z_OK;
  if (h->zlib_init_done) {
    if (h->mode == WN_DEFLATE || h->mode == WN_GZIP ||
        h->mode == WN_DEFLATERAW) {
      status = deflateEnd(&h->strm);
    } else {
      status = inflateEnd(&h->strm);
    }
  }
  if (h->in_buf != NULL) {
    free(h->in_buf);
  }
  if (h->out_buf != NULL) {
    free(h->out_buf);
  }
  if (h->dict != NULL) {
    free(h->dict);
  }
  free(h);
  return status;
}

__attribute__((export_name("wn_zlib_reset"), used))
int wn_zlib_reset(wn_zstream *h) {
  if (h == NULL) {
    return Z_STREAM_ERROR;
  }
  if (wn_init_stream(h) != Z_OK) {
    return h->err;
  }
  h->err = Z_OK;
  switch (h->mode) {
    case WN_DEFLATE:
    case WN_DEFLATERAW:
    case WN_GZIP:
      h->err = deflateReset(&h->strm);
      break;
    case WN_INFLATE:
    case WN_INFLATERAW:
    case WN_GUNZIP:
    case WN_UNZIP:
      h->err = inflateReset(&h->strm);
      break;
    default:
      h->err = Z_STREAM_ERROR;
      break;
  }
  if (h->err != Z_OK) {
    return h->err;
  }
  return wn_apply_dictionary(h);
}

/* ---------------- 缓冲区 ---------------- */

/* 按需把入/出缓冲扩到至少这么大（只增不减）。返回 0 表示成功。 */
__attribute__((export_name("wn_zlib_ensure"), used))
int wn_zlib_ensure(wn_zstream *h, uint32_t in_cap, uint32_t out_cap,
                   uint32_t dict_cap) {
  if (h == NULL) {
    return -1;
  }
  if (in_cap > h->in_cap) {
    uint8_t *p = (uint8_t *)realloc(h->in_buf, in_cap);
    if (p == NULL) {
      return -1;
    }
    h->in_buf = p;
    h->in_cap = in_cap;
  }
  if (out_cap > h->out_cap) {
    uint8_t *p = (uint8_t *)realloc(h->out_buf, out_cap);
    if (p == NULL) {
      return -1;
    }
    h->out_buf = p;
    h->out_cap = out_cap;
  }
  if (dict_cap > h->dict_cap) {
    uint8_t *p = (uint8_t *)realloc(h->dict, dict_cap);
    if (p == NULL) {
      return -1;
    }
    h->dict = p;
    h->dict_cap = dict_cap;
  }
  return 0;
}

__attribute__((export_name("wn_zlib_in_ptr"), used))
uint8_t *wn_zlib_in_ptr(wn_zstream *h) { return h->in_buf; }

__attribute__((export_name("wn_zlib_out_ptr"), used))
uint8_t *wn_zlib_out_ptr(wn_zstream *h) { return h->out_buf; }

__attribute__((export_name("wn_zlib_dict_ptr"), used))
uint8_t *wn_zlib_dict_ptr(wn_zstream *h) { return h->dict; }

__attribute__((export_name("wn_zlib_set_dict_len"), used))
void wn_zlib_set_dict_len(wn_zstream *h, uint32_t len) { h->dict_len = len; }

/* ---------------- 字典（deflate / INFLATERAW 在 init 后立即装） ---------------- */

__attribute__((export_name("wn_zlib_apply_dict"), used))
int wn_zlib_apply_dict(wn_zstream *h) {
  if (h == NULL) {
    return Z_STREAM_ERROR;
  }
  if (wn_init_stream(h) != Z_OK) {
    return h->err;
  }
  return wn_apply_dictionary(h);
}

/* ---------------- 推数据 ---------------- */

/*
 * 以 `next_in = in_buf[0..in_len)`、`next_out = out_buf[0..out_len)` 跑一次
 * `deflate`/`inflate`，返回 zlib 返回码。调用后可用 `wn_zlib_avail_*` 查余量。
 *
 * UNZIP 模式先按 Node 的做法嗅探 gzip 魔数（`1f 8b`）再决定用 GUNZIP 还是
 * INFLATE；INFLATE 系在 `Z_NEED_DICT` 时可以装字典并重试（`ZlibContext::DoThreadPoolWork`）。
 */
__attribute__((export_name("wn_zlib_write"), used))
int wn_zlib_write(wn_zstream *h, uint32_t in_off, uint32_t in_len,
                  uint32_t out_len, int flush) {
  if (h == NULL) {
    return Z_STREAM_ERROR;
  }
  if (wn_init_stream(h) != Z_OK) {
    return h->err;
  }

  h->strm.next_in = h->in_buf + in_off;
  h->strm.avail_in = (uInt)in_len;
  h->strm.next_out = h->out_buf;
  h->strm.avail_out = (uInt)out_len;

  switch (h->mode) {
    case WN_DEFLATE:
    case WN_GZIP:
    case WN_DEFLATERAW:
      h->err = deflate(&h->strm, flush);
      break;
    case WN_INFLATE:
    case WN_GUNZIP:
    case WN_INFLATERAW:
    case WN_UNZIP: {
      /*
       * UNZIP 的自动识别由 `windowBits + 32`（=47）的 inflate 流自己完成——
       * 这里只嗅探一次首两个字节，用来决定 `Z_STREAM_END` 后要不要继续解
       * 下一个成员（Node 的 `mode_ == GUNZIP` 分支）。**不重建流**。
       */
      if (h->mode == WN_UNZIP && !h->sniffed && in_len >= 2) {
        const uint8_t *p = h->in_buf;
        h->is_gzip = (p[0] == 0x1f && p[1] == 0x8b);
        h->sniffed = 1;
      }
      h->err = inflate(&h->strm, flush);
      if (h->mode != WN_INFLATERAW && h->err == Z_NEED_DICT &&
          h->dict_len > 0) {
        h->err = inflateSetDictionary(&h->strm, h->dict, h->dict_len);
        if (h->err == Z_OK) {
          h->err = inflate(&h->strm, flush);
        } else if (h->err == Z_DATA_ERROR) {
          h->err = Z_NEED_DICT;
        }
      }
      /*
       * 同一 archive 里的多成员 gzip：`Z_STREAM_END` 后若还有非零字节，重置
       * 再来一次。零字节常被用作填充，按 Node 的规则放行。
       */
      while (h->strm.avail_in > 0 && h->err == Z_STREAM_END &&
             !h->reject_garbage &&
             (h->mode == WN_GUNZIP ||
              (h->mode == WN_UNZIP && h->is_gzip)) &&
             h->strm.next_in[0] != 0x00) {
        h->err = inflateReset(&h->strm);
        if (h->err != Z_OK) {
          break;
        }
        h->err = inflate(&h->strm, flush);
      }
      break;
    }
    default:
      h->err = Z_STREAM_ERROR;
      break;
  }
  return h->err;
}

__attribute__((export_name("wn_zlib_avail_in"), used))
uint32_t wn_zlib_avail_in(wn_zstream *h) { return (uint32_t)h->strm.avail_in; }

__attribute__((export_name("wn_zlib_avail_out"), used))
uint32_t wn_zlib_avail_out(wn_zstream *h) { return (uint32_t)h->strm.avail_out; }

__attribute__((export_name("wn_zlib_total_out"), used))
uint64_t wn_zlib_total_out(wn_zstream *h) {
  return (uint64_t)h->strm.total_out;
}

__attribute__((export_name("wn_zlib_adler"), used))
uint32_t wn_zlib_adler(wn_zstream *h) { return (uint32_t)h->strm.adler; }

__attribute__((export_name("wn_zlib_data_type"), used))
int wn_zlib_data_type(wn_zstream *h) { return h->strm.data_type; }

__attribute__((export_name("wn_zlib_errno"), used))
int wn_zlib_errno(wn_zstream *h) { return h->err; }

__attribute__((export_name("wn_zlib_msg"), used))
const char *wn_zlib_msg(wn_zstream *h) { return h->strm.msg; }

/* 是否拒绝 `Z_STREAM_END` 之后的尾随字节（对齐 Node 的 `reject_garbage_after_end_`）。 */
__attribute__((export_name("wn_zlib_set_reject_garbage"), used))
void wn_zlib_set_reject_garbage(wn_zstream *h, int reject) {
  if (h != NULL) h->reject_garbage = reject;
}

/* 参数调整（对齐 `ZlibContext::SetParams`）。 */
__attribute__((export_name("wn_zlib_set_params"), used))
int wn_zlib_set_params(wn_zstream *h, int level, int strategy) {
  if (h == NULL) {
    return Z_STREAM_ERROR;
  }
  if (wn_init_stream(h) != Z_OK) {
    return h->err;
  }
  h->err = Z_OK;
  switch (h->mode) {
    case WN_DEFLATE:
    case WN_DEFLATERAW:
    case WN_GZIP:
      h->err = deflateParams(&h->strm, level, strategy);
      break;
    default:
      break;
  }
  h->level = level;
  h->strategy = strategy;
  return h->err;
}
