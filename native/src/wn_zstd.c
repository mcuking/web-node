// wn_zstd.c — `zlib` 的 zstd 半边（native → WASM，M118）。
//
// 背后是**真 `deps/zstd`**（上游 zstd 1.5.7）编出的 wasm 模块；本文件是它上面的
// 薄封装，对齐 Node `src/node_zlib.cc` 的 `ZstdCompressContext` /
// `ZstdDecompressContext`：流式写入、参数设置、字典装载、**pledged src size 的
// 消耗量核对**（`ZSTD_error_srcSize_wrong`）、解码侧 `frame_complete_` 与
// `Z_BUF_ERROR` 兜底、以及 `ZSTD_getErrorString`/`ZstdStrerror` 的错误形状。
//
// 与 Node 的唯一差异：编译时**不开 `ZSTD_MULTITHREAD`**（wasm32-wasip1 没有线程，
// zstd 的多线程压缩本来就是可选的；Node 的绑定也不暴露它）。

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <zstd.h>
#include <zstd_errors.h>

#define WN_EXPORT(name) \
  __attribute__((export_name(#name), used)) int32_t name

#define ZSTD_CONTENTSIZE_UNKNOWN_V ((uint64_t)-1)

typedef struct {
  ZSTD_CCtx* cctx;
  uint64_t pledged_src_size;
  int has_consumed;
  uint64_t consumed_src_size;
  ZSTD_inBuffer input;
  ZSTD_outBuffer output;
  ZSTD_EndDirective flush;
  ZSTD_ErrorCode error;
  const char* error_string;       // ZSTD_getErrorString
  const char* error_code_string;  // ZstdStrerror（"ZSTD_error_*"）
} WnZstdC;

typedef struct {
  ZSTD_DCtx* dctx;
  ZSTD_inBuffer input;
  ZSTD_outBuffer output;
  ZSTD_EndDirective flush;
  ZSTD_ErrorCode error;
  const char* error_string;
  const char* error_code_string;
  int frame_complete;
} WnZstdD;

// 对齐 Node 的 `ZstdStrerror`：`ZSTD_ErrorCode` 名字。
static const char* wn_zstd_strerror(ZSTD_ErrorCode code) {
  switch (code) {
    case ZSTD_error_no_error: return "ZSTD_error_no_error";
    case ZSTD_error_GENERIC: return "ZSTD_error_GENERIC";
    case ZSTD_error_prefix_unknown: return "ZSTD_error_prefix_unknown";
    case ZSTD_error_version_unsupported: return "ZSTD_error_version_unsupported";
    case ZSTD_error_frameParameter_unsupported: return "ZSTD_error_frameParameter_unsupported";
    case ZSTD_error_frameParameter_windowTooLarge: return "ZSTD_error_frameParameter_windowTooLarge";
    case ZSTD_error_corruption_detected: return "ZSTD_error_corruption_detected";
    case ZSTD_error_checksum_wrong: return "ZSTD_error_checksum_wrong";
    case ZSTD_error_literals_headerWrong: return "ZSTD_error_literals_headerWrong";
    case ZSTD_error_dictionary_corrupted: return "ZSTD_error_dictionary_corrupted";
    case ZSTD_error_dictionary_wrong: return "ZSTD_error_dictionary_wrong";
    case ZSTD_error_dictionaryCreation_failed: return "ZSTD_error_dictionaryCreation_failed";
    case ZSTD_error_parameter_unsupported: return "ZSTD_error_parameter_unsupported";
    case ZSTD_error_parameter_combination_unsupported: return "ZSTD_error_parameter_combination_unsupported";
    case ZSTD_error_parameter_outOfBound: return "ZSTD_error_parameter_outOfBound";
    case ZSTD_error_tableLog_tooLarge: return "ZSTD_error_tableLog_tooLarge";
    case ZSTD_error_maxSymbolValue_tooLarge: return "ZSTD_error_maxSymbolValue_tooLarge";
    case ZSTD_error_maxSymbolValue_tooSmall: return "ZSTD_error_maxSymbolValue_tooSmall";
    case ZSTD_error_stabilityCondition_notRespected: return "ZSTD_error_stabilityCondition_notRespected";
    case ZSTD_error_stage_wrong: return "ZSTD_error_stage_wrong";
    case ZSTD_error_init_missing: return "ZSTD_error_init_missing";
    case ZSTD_error_memory_allocation: return "ZSTD_error_memory_allocation";
    case ZSTD_error_workSpace_tooSmall: return "ZSTD_error_workSpace_tooSmall";
    case ZSTD_error_dstSize_tooSmall: return "ZSTD_error_dstSize_tooSmall";
    case ZSTD_error_srcSize_wrong: return "ZSTD_error_srcSize_wrong";
    case ZSTD_error_dstBuffer_null: return "ZSTD_error_dstBuffer_null";
    case ZSTD_error_noForwardProgress_destFull: return "ZSTD_error_noForwardProgress_destFull";
    case ZSTD_error_noForwardProgress_inputEmpty: return "ZSTD_error_noForwardProgress_inputEmpty";
    default: return "ZSTD_error_GENERIC";
  }
}

// --- 压缩 -------------------------------------------------------------------

WN_EXPORT(wn_zstd_c_new)(void) {
  WnZstdC* h = (WnZstdC*)calloc(1, sizeof(WnZstdC));
  if (h == NULL) return 0;
  h->pledged_src_size = ZSTD_CONTENTSIZE_UNKNOWN_V;
  h->flush = ZSTD_e_continue;
  h->cctx = ZSTD_createCCtx();
  if (h->cctx == NULL) {
    free(h);
    return 0;
  }
  return (int32_t)(intptr_t)h;
}

WN_EXPORT(wn_zstd_c_free)(int32_t handle) {
  WnZstdC* h = (WnZstdC*)(intptr_t)handle;
  if (h == NULL) return 0;
  if (h->cctx) ZSTD_freeCCtx(h->cctx);
  free(h);
  return 0;
}

// 重置（对齐 `ZstdCompressContext::ResetStream` → `Init(pledged_src_size_)`）。
WN_EXPORT(wn_zstd_c_reset)(int32_t handle) {
  WnZstdC* h = (WnZstdC*)(intptr_t)handle;
  if (h->cctx) ZSTD_freeCCtx(h->cctx);
  h->cctx = ZSTD_createCCtx();
  h->error = ZSTD_error_no_error;
  if (h->cctx == NULL) return 0;
  h->has_consumed = h->pledged_src_size != ZSTD_CONTENTSIZE_UNKNOWN_V;
  h->consumed_src_size = 0;
  if (ZSTD_isError(ZSTD_CCtx_setPledgedSrcSize(h->cctx, h->pledged_src_size)))
    return 0;
  return 1;
}

WN_EXPORT(wn_zstd_c_set_pledged)(int32_t handle, int32_t unknown, uint32_t lo,
                                 uint32_t hi) {
  WnZstdC* h = (WnZstdC*)(intptr_t)handle;
  h->pledged_src_size =
      unknown ? ZSTD_CONTENTSIZE_UNKNOWN_V
              : ((uint64_t)hi << 32 | (uint64_t)lo);
  h->has_consumed = h->pledged_src_size != ZSTD_CONTENTSIZE_UNKNOWN_V;
  h->consumed_src_size = 0;
  return 1;
}

WN_EXPORT(wn_zstd_c_set_param)(int32_t handle, int32_t key, int32_t value) {
  WnZstdC* h = (WnZstdC*)(intptr_t)handle;
  if (h == NULL || h->cctx == NULL) return 0;
  size_t r = ZSTD_CCtx_setParameter(h->cctx, (ZSTD_cParameter)key, value);
  return ZSTD_isError(r) ? 0 : 1;
}

WN_EXPORT(wn_zstd_c_set_dict)(int32_t handle, int32_t ptr, int32_t len) {
  WnZstdC* h = (WnZstdC*)(intptr_t)handle;
  if (len <= 0) return 1;
  size_t r = ZSTD_CCtx_loadDictionary(h->cctx, (const void*)(intptr_t)ptr,
                                      (size_t)len);
  return ZSTD_isError(r) ? 0 : 1;
}

WN_EXPORT(wn_zstd_c_write)(int32_t handle, int32_t in_ptr, int32_t in_len,
                           int32_t out_ptr, int32_t out_len, int32_t flush) {
  WnZstdC* h = (WnZstdC*)(intptr_t)handle;
  h->input.src = (const uint8_t*)(intptr_t)in_ptr;
  h->input.size = (size_t)in_len;
  h->input.pos = 0;
  h->output.dst = (uint8_t*)(intptr_t)out_ptr;
  h->output.size = (size_t)out_len;
  h->output.pos = 0;
  h->flush = (ZSTD_EndDirective)flush;

  size_t const input_pos = h->input.pos;
  size_t const remaining = ZSTD_compressStream2(h->cctx, &h->output, &h->input,
                                                h->flush);
  if (h->has_consumed) h->consumed_src_size += h->input.pos - input_pos;

  if (ZSTD_isError(remaining)) {
    h->error = ZSTD_getErrorCode(remaining);
    h->error_string = ZSTD_getErrorString(h->error);
    h->error_code_string = wn_zstd_strerror(h->error);
  } else if (remaining == 0 && h->flush == ZSTD_e_end && h->has_consumed) {
    uint64_t consumed = h->consumed_src_size;
    h->has_consumed = 0;
    if (consumed != h->pledged_src_size) {
      h->error = ZSTD_error_srcSize_wrong;
      h->error_string = ZSTD_getErrorString(h->error);
      h->error_code_string = wn_zstd_strerror(h->error);
    }
  }
  // 返回：0 表示这一轮已把输入吃完且没有待处理输出。
  return (int32_t)remaining;
}

WN_EXPORT(wn_zstd_c_avail_in)(int32_t handle) {
  WnZstdC* h = (WnZstdC*)(intptr_t)handle;
  return (int32_t)(h->input.size - h->input.pos);
}
WN_EXPORT(wn_zstd_c_avail_out)(int32_t handle) {
  WnZstdC* h = (WnZstdC*)(intptr_t)handle;
  return (int32_t)(h->output.size - h->output.pos);
}
WN_EXPORT(wn_zstd_c_error_code)(int32_t handle) {
  return (int32_t)((WnZstdC*)(intptr_t)handle)->error;
}
WN_EXPORT(wn_zstd_c_error_string)(int32_t handle) {
  WnZstdC* h = (WnZstdC*)(intptr_t)handle;
  return (int32_t)(intptr_t)(h->error_string ? h->error_string : "");
}
WN_EXPORT(wn_zstd_c_error_name)(int32_t handle) {
  WnZstdC* h = (WnZstdC*)(intptr_t)handle;
  return (int32_t)(intptr_t)(h->error_code_string ? h->error_code_string : "");
}

// --- 解压 -------------------------------------------------------------------

WN_EXPORT(wn_zstd_d_new)(void) {
  WnZstdD* h = (WnZstdD*)calloc(1, sizeof(WnZstdD));
  if (h == NULL) return 0;
  h->dctx = ZSTD_createDCtx();
  if (h->dctx == NULL) {
    free(h);
    return 0;
  }
  h->flush = ZSTD_e_continue;
  return (int32_t)(intptr_t)h;
}

WN_EXPORT(wn_zstd_d_free)(int32_t handle) {
  WnZstdD* h = (WnZstdD*)(intptr_t)handle;
  if (h == NULL) return 0;
  if (h->dctx) ZSTD_freeDCtx(h->dctx);
  free(h);
  return 0;
}

WN_EXPORT(wn_zstd_d_reset)(int32_t handle) {
  WnZstdD* h = (WnZstdD*)(intptr_t)handle;
  if (h->dctx) ZSTD_freeDCtx(h->dctx);
  h->dctx = ZSTD_createDCtx();
  h->error = ZSTD_error_no_error;
  h->frame_complete = 0;
  return h->dctx == NULL ? 0 : 1;
}

WN_EXPORT(wn_zstd_d_set_param)(int32_t handle, int32_t key, int32_t value) {
  WnZstdD* h = (WnZstdD*)(intptr_t)handle;
  if (h == NULL || h->dctx == NULL) return 0;
  size_t r = ZSTD_DCtx_setParameter(h->dctx, (ZSTD_dParameter)key, value);
  return ZSTD_isError(r) ? 0 : 1;
}

WN_EXPORT(wn_zstd_d_set_dict)(int32_t handle, int32_t ptr, int32_t len) {
  WnZstdD* h = (WnZstdD*)(intptr_t)handle;
  if (len <= 0) return 1;
  size_t r = ZSTD_DCtx_loadDictionary(h->dctx, (const void*)(intptr_t)ptr,
                                      (size_t)len);
  return ZSTD_isError(r) ? 0 : 1;
}

WN_EXPORT(wn_zstd_d_write)(int32_t handle, int32_t in_ptr, int32_t in_len,
                           int32_t out_ptr, int32_t out_len, int32_t flush) {
  WnZstdD* h = (WnZstdD*)(intptr_t)handle;
  h->input.src = (const uint8_t*)(intptr_t)in_ptr;
  h->input.size = (size_t)in_len;
  h->input.pos = 0;
  h->output.dst = (uint8_t*)(intptr_t)out_ptr;
  h->output.size = (size_t)out_len;
  h->output.pos = 0;
  h->flush = (ZSTD_EndDirective)flush;

  // 上一轮已走完一帧、且这是「输出缓冲满」重试（空输入）时直接返回。
  if (h->frame_complete && h->input.size == 0) return 0;

  size_t const ret = ZSTD_decompressStream(h->dctx, &h->output, &h->input);
  if (ZSTD_isError(ret)) {
    h->frame_complete = 0;
    h->error = ZSTD_getErrorCode(ret);
    h->error_string = ZSTD_getErrorString(h->error);
    h->error_code_string = wn_zstd_strerror(h->error);
  } else {
    h->frame_complete = ret == 0;
  }
  return (int32_t)ret;
}

WN_EXPORT(wn_zstd_d_avail_in)(int32_t handle) {
  WnZstdD* h = (WnZstdD*)(intptr_t)handle;
  return (int32_t)(h->input.size - h->input.pos);
}
WN_EXPORT(wn_zstd_d_avail_out)(int32_t handle) {
  WnZstdD* h = (WnZstdD*)(intptr_t)handle;
  return (int32_t)(h->output.size - h->output.pos);
}
WN_EXPORT(wn_zstd_d_error_code)(int32_t handle) {
  return (int32_t)((WnZstdD*)(intptr_t)handle)->error;
}
WN_EXPORT(wn_zstd_d_error_string)(int32_t handle) {
  WnZstdD* h = (WnZstdD*)(intptr_t)handle;
  return (int32_t)(intptr_t)(h->error_string ? h->error_string : "");
}
WN_EXPORT(wn_zstd_d_error_name)(int32_t handle) {
  WnZstdD* h = (WnZstdD*)(intptr_t)handle;
  return (int32_t)(intptr_t)(h->error_code_string ? h->error_code_string : "");
}
WN_EXPORT(wn_zstd_d_frame_complete)(int32_t handle) {
  return ((WnZstdD*)(intptr_t)handle)->frame_complete ? 1 : 0;
}

// --- 内存 -------------------------------------------------------------------

WN_EXPORT(wn_alloc)(int32_t size) {
  return (int32_t)(intptr_t)malloc((size_t)size);
}

WN_EXPORT(wn_dealloc)(int32_t ptr) {
  free((void*)(intptr_t)ptr);
  return 0;
}
