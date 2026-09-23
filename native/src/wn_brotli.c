// wn_brotli.c — `zlib` 的 brotli 半边（native → WASM，M118）。
//
// 背后是**真 `deps/brotli`**（上游 brotli 1.2.0）编出的 wasm 模块；本文件是它
// 上面的薄封装，把 Node `src/node_zlib.cc` 的 `BrotliEncoderContext` /
// `BrotliDecoderContext` 的**调用序列与错误语义**照搬过来（写入前后偏移、
// 参数设置、字典装载时机、错误码/文案、`Z_BUF_ERROR` 的兜底）。
//
// ABI 约定与 wn_zlib 一致：句柄是 32 位不透明整数（0 = 失败）；JS 传入的是
// wasm 线性内存里的偏移；每次 `write` 之后用 `*_avail_in/out` 取剩余量，
// 从而与 Node 的 `GetAfterWriteOffsets` 一一对应。

#include <brotli/decode.h>
#include <brotli/encode.h>

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define WN_EXPORT(name) \
  __attribute__((export_name(#name), used)) int32_t name

typedef struct {
  BrotliEncoderState* state;
  BrotliEncoderPreparedDictionary* prepared;
  uint8_t* dict;
  size_t dict_len;
  const uint8_t* next_in;
  size_t avail_in;
  uint8_t* next_out;
  size_t avail_out;
  BrotliEncoderOperation flush;
  int last_result;
} WnBrotliEnc;

typedef struct {
  BrotliDecoderState* state;
  uint8_t* dict;
  size_t dict_len;
  const uint8_t* next_in;
  size_t avail_in;
  uint8_t* next_out;
  size_t avail_out;
  BrotliEncoderOperation flush;  // 解码器只用 PROCESS / FINISH 两个值
  BrotliDecoderResult last_result;
  BrotliDecoderErrorCode error;
  const char* error_string;
} WnBrotliDec;

// --- 编码器 -----------------------------------------------------------------

static void wn_brotli_enc_reinit(WnBrotliEnc* h) {
  if (h->state) BrotliEncoderDestroyInstance(h->state);
  if (h->prepared) BrotliEncoderDestroyPreparedDictionary(h->prepared);
  h->prepared = NULL;
  h->state = BrotliEncoderCreateInstance(NULL, NULL, NULL);
  h->last_result = h->state != NULL;
  if (h->state == NULL) return;
  if (h->dict_len > 0) {
    h->prepared = BrotliEncoderPrepareDictionary(
        BROTLI_SHARED_DICTIONARY_RAW, h->dict_len, h->dict, BROTLI_MAX_QUALITY,
        NULL, NULL, NULL);
    if (h->prepared == NULL ||
        !BrotliEncoderAttachPreparedDictionary(h->state, h->prepared)) {
      h->last_result = 0;
    }
  }
}

WN_EXPORT(wn_brotli_enc_new)(void) {
  WnBrotliEnc* h = (WnBrotliEnc*)calloc(1, sizeof(WnBrotliEnc));
  if (h == NULL) return 0;
  h->flush = BROTLI_OPERATION_PROCESS;
  wn_brotli_enc_reinit(h);
  if (h->state == NULL) {
    free(h);
    return 0;
  }
  return (int32_t)(intptr_t)h;
}

WN_EXPORT(wn_brotli_enc_free)(int32_t handle) {
  WnBrotliEnc* h = (WnBrotliEnc*)(intptr_t)handle;
  if (h == NULL) return 0;
  if (h->state) BrotliEncoderDestroyInstance(h->state);
  if (h->prepared) BrotliEncoderDestroyPreparedDictionary(h->prepared);
  free(h->dict);
  free(h);
  return 0;
}

WN_EXPORT(wn_brotli_enc_reset)(int32_t handle) {
  WnBrotliEnc* h = (WnBrotliEnc*)(intptr_t)handle;
  wn_brotli_enc_reinit(h);
  return h->last_result ? 1 : 0;
}

WN_EXPORT(wn_brotli_enc_set_param)(int32_t handle, int32_t key, uint32_t value) {
  WnBrotliEnc* h = (WnBrotliEnc*)(intptr_t)handle;
  if (h == NULL || h->state == NULL) return 0;
  return BrotliEncoderSetParameter(h->state, (BrotliEncoderParameter)key, value)
             ? 1
             : 0;
}

// 装载预设字典（拷贝一份，生命周期归本句柄）。
WN_EXPORT(wn_brotli_enc_set_dict)(int32_t handle, int32_t ptr, int32_t len) {
  WnBrotliEnc* h = (WnBrotliEnc*)(intptr_t)handle;
  free(h->dict);
  h->dict = NULL;
  h->dict_len = 0;
  if (len > 0) {
    h->dict = (uint8_t*)malloc((size_t)len);
    if (h->dict == NULL) return 0;
    memcpy(h->dict, (const void*)(intptr_t)ptr, (size_t)len);
    h->dict_len = (size_t)len;
  }
  wn_brotli_enc_reinit(h);
  return h->last_result ? 1 : 0;
}

WN_EXPORT(wn_brotli_enc_write)(int32_t handle, int32_t in_ptr, int32_t in_len,
                               int32_t out_ptr, int32_t out_len,
                               int32_t flush) {
  WnBrotliEnc* h = (WnBrotliEnc*)(intptr_t)handle;
  h->next_in = (const uint8_t*)(intptr_t)in_ptr;
  h->avail_in = (size_t)in_len;
  h->next_out = (uint8_t*)(intptr_t)out_ptr;
  h->avail_out = (size_t)out_len;
  h->flush = (BrotliEncoderOperation)flush;
  const uint8_t* next_in = h->next_in;
  h->last_result = BrotliEncoderCompressStream(h->state, h->flush, &h->avail_in,
                                               &next_in, &h->avail_out,
                                               &h->next_out, NULL)
                       ? 1
                       : 0;
  return h->last_result;
}

WN_EXPORT(wn_brotli_enc_avail_in)(int32_t handle) {
  return (int32_t)((WnBrotliEnc*)(intptr_t)handle)->avail_in;
}
WN_EXPORT(wn_brotli_enc_avail_out)(int32_t handle) {
  return (int32_t)((WnBrotliEnc*)(intptr_t)handle)->avail_out;
}
WN_EXPORT(wn_brotli_enc_is_finished)(int32_t handle) {
  WnBrotliEnc* h = (WnBrotliEnc*)(intptr_t)handle;
  return BrotliEncoderIsFinished(h->state) ? 1 : 0;
}
WN_EXPORT(wn_brotli_enc_has_more_output)(int32_t handle) {
  WnBrotliEnc* h = (WnBrotliEnc*)(intptr_t)handle;
  return BrotliEncoderHasMoreOutput(h->state) ? 1 : 0;
}

// --- 解码器 -----------------------------------------------------------------

WN_EXPORT(wn_brotli_dec_new)(void) {
  WnBrotliDec* h = (WnBrotliDec*)calloc(1, sizeof(WnBrotliDec));
  if (h == NULL) return 0;
  h->state = BrotliDecoderCreateInstance(NULL, NULL, NULL);
  if (h->state == NULL) {
    free(h);
    return 0;
  }
  h->last_result = BROTLI_DECODER_RESULT_SUCCESS;
  h->error = BROTLI_DECODER_NO_ERROR;
  h->flush = BROTLI_OPERATION_PROCESS;
  return (int32_t)(intptr_t)h;
}

WN_EXPORT(wn_brotli_dec_free)(int32_t handle) {
  WnBrotliDec* h = (WnBrotliDec*)(intptr_t)handle;
  if (h == NULL) return 0;
  if (h->state) BrotliDecoderDestroyInstance(h->state);
  free(h->dict);
  free(h);
  return 0;
}

WN_EXPORT(wn_brotli_dec_reset)(int32_t handle) {
  WnBrotliDec* h = (WnBrotliDec*)(intptr_t)handle;
  if (h->state) BrotliDecoderDestroyInstance(h->state);
  h->state = BrotliDecoderCreateInstance(NULL, NULL, NULL);
  h->last_result = BROTLI_DECODER_RESULT_SUCCESS;
  h->error = BROTLI_DECODER_NO_ERROR;
  if (h->state == NULL) return 0;
  if (h->dict_len > 0 &&
      !BrotliDecoderAttachDictionary(h->state, BROTLI_SHARED_DICTIONARY_RAW,
                                     h->dict_len, h->dict)) {
    return 0;
  }
  return 1;
}

WN_EXPORT(wn_brotli_dec_set_param)(int32_t handle, int32_t key, uint32_t value) {
  WnBrotliDec* h = (WnBrotliDec*)(intptr_t)handle;
  if (h == NULL || h->state == NULL) return 0;
  return BrotliDecoderSetParameter(h->state, (BrotliDecoderParameter)key, value)
             ? 1
             : 0;
}

WN_EXPORT(wn_brotli_dec_set_dict)(int32_t handle, int32_t ptr, int32_t len) {
  WnBrotliDec* h = (WnBrotliDec*)(intptr_t)handle;
  free(h->dict);
  h->dict = NULL;
  h->dict_len = 0;
  if (len > 0) {
    h->dict = (uint8_t*)malloc((size_t)len);
    if (h->dict == NULL) return 0;
    memcpy(h->dict, (const void*)(intptr_t)ptr, (size_t)len);
    h->dict_len = (size_t)len;
  }
  return wn_brotli_dec_reset(handle);
}

WN_EXPORT(wn_brotli_dec_write)(int32_t handle, int32_t in_ptr, int32_t in_len,
                               int32_t out_ptr, int32_t out_len,
                               int32_t flush) {
  WnBrotliDec* h = (WnBrotliDec*)(intptr_t)handle;
  h->next_in = (const uint8_t*)(intptr_t)in_ptr;
  h->avail_in = (size_t)in_len;
  h->next_out = (uint8_t*)(intptr_t)out_ptr;
  h->avail_out = (size_t)out_len;
  h->flush = (BrotliEncoderOperation)flush;
  const uint8_t* next_in = h->next_in;
  h->last_result = BrotliDecoderDecompressStream(
      h->state, &h->avail_in, &next_in, &h->avail_out, &h->next_out, NULL);
  if (h->last_result == BROTLI_DECODER_RESULT_ERROR) {
    h->error = BrotliDecoderGetErrorCode(h->state);
    h->error_string = BrotliDecoderErrorString(h->error);
  }
  return (int32_t)h->last_result;
}

WN_EXPORT(wn_brotli_dec_avail_in)(int32_t handle) {
  return (int32_t)((WnBrotliDec*)(intptr_t)handle)->avail_in;
}
WN_EXPORT(wn_brotli_dec_avail_out)(int32_t handle) {
  return (int32_t)((WnBrotliDec*)(intptr_t)handle)->avail_out;
}
WN_EXPORT(wn_brotli_dec_result)(int32_t handle) {
  return (int32_t)((WnBrotliDec*)(intptr_t)handle)->last_result;
}
WN_EXPORT(wn_brotli_dec_error_code)(int32_t handle) {
  return (int32_t)((WnBrotliDec*)(intptr_t)handle)->error;
}
// 返回错误文案（`BrotliDecoderErrorString` 的静态字符串；JS 侧加 `ERR_` 前缀）。
WN_EXPORT(wn_brotli_dec_error_string)(int32_t handle) {
  WnBrotliDec* h = (WnBrotliDec*)(intptr_t)handle;
  return (int32_t)(intptr_t)(h->error_string ? h->error_string : "");
}
WN_EXPORT(wn_brotli_dec_is_finished)(int32_t handle) {
  WnBrotliDec* h = (WnBrotliDec*)(intptr_t)handle;
  return BrotliDecoderIsFinished(h->state) ? 1 : 0;
}

// --- 内存（供 JS 把输入/输出缓冲放进 wasm 线性内存）--------------------------

WN_EXPORT(wn_alloc)(int32_t size) {
  return (int32_t)(intptr_t)malloc((size_t)size);
}

WN_EXPORT(wn_dealloc)(int32_t ptr) {
  free((void*)(intptr_t)ptr);
  return 0;
}
