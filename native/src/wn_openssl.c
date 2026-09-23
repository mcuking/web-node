/*
 * wn_openssl.c — thin C ABI over the wasi-built OpenSSL subset (M119).
 *
 * The module is linked against a `libcrypto.a` that was produced by OpenSSL's
 * own `Configure`/`make` for `wasm32-wasip1` (see `native/build.mjs`); see
 * `native/openssl/99-wasi.conf` for the target definition.
 *
 * The ABI is deliberately **generic and name-based**: the JS side maps Node's
 * algorithm names onto OpenSSL's, so the C surface stays small. Handles are
 * returned as `int32_t` (a wasm32 pointer fits) and are opaque to JS.
 *
 * Every entry point returns a non-negative value on success and `-1` on
 * failure; `wn_openssl_last_error()` then yields the OpenSSL error string
 * (same shape as Node's: `error:1C80006B:Provider routines::wrong final block
 * length`).
 */
#include <stdint.h>
#include <string.h>
#include <stdlib.h>

#include <openssl/crypto.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>

/* WASI has no getpid; OpenSSL only uses it for DRBG fork-detection. */
int getpid(void) { return 1; }

#define WN_EXPORT(name) __attribute__((export_name(#name), used)) int32_t name
#define WN_PTR(name) __attribute__((export_name(#name), used)) void *name

/* --- memory + error reporting ---------------------------------------------- */

WN_PTR(wn_alloc)(int32_t size) { return malloc((size_t)size); }
WN_EXPORT(wn_dealloc)(void *ptr) {
    free(ptr);
    return 0;
}

WN_EXPORT(wn_openssl_version)(void) { return (int32_t)OpenSSL_version_num(); }

static char wn_error[256];
static void wn_capture_error(void) {
    unsigned long e = ERR_get_error();
    if (e == 0) {
        wn_error[0] = '\0';
        return;
    }
    ERR_error_string_n(e, wn_error, sizeof(wn_error));
}
WN_PTR(wn_openssl_last_error)(void) { return wn_error; }

/* --- digests ---------------------------------------------------------------- */

static int32_t md_by_name(const char *name, int32_t nlen) {
    /* `name` is not NUL-terminated on the JS side (it lives in wasm memory). */
    char buf[64];
    if (nlen <= 0 || nlen >= (int32_t)sizeof(buf)) return 0;
    memcpy(buf, name, (size_t)nlen);
    buf[nlen] = '\0';
#if OPENSSL_VERSION_NUMBER >= 0x30000000L
    return (int32_t)(intptr_t)EVP_MD_fetch(NULL, buf, NULL);
#else
    return (int32_t)(intptr_t)EVP_get_digestbyname(buf);
#endif
}

WN_EXPORT(wn_digest_size)(const char *name, int32_t nlen) {
    int32_t h = md_by_name(name, nlen);
    if (h == 0) { wn_capture_error(); return -1; }
    EVP_MD *md = (EVP_MD *)(intptr_t)h;
    int size = EVP_MD_get_size(md);
    EVP_MD_free(md);
    if (size <= 0) { wn_capture_error(); return -1; }
    return (int32_t)size;
}

/** One-shot digest. Returns the number of bytes written to `out`. */
WN_EXPORT(wn_digest)(const char *name, int32_t nlen,
                     const uint8_t *data, int32_t dlen, uint8_t *out) {
    int32_t h = md_by_name(name, nlen);
    if (h == 0) { wn_capture_error(); return -1; }
    EVP_MD *md = (EVP_MD *)(intptr_t)h;
    unsigned int outlen = 0;
    int ok = EVP_Digest(data, (size_t)dlen, out, &outlen, md, NULL);
    EVP_MD_free(md);
    if (ok != 1) { wn_capture_error(); return -1; }
    return (int32_t)outlen;
}

/** XOF/one-shot (shake128/256): `outlen` bytes are produced. */
WN_EXPORT(wn_digest_xof)(const char *name, int32_t nlen,
                         const uint8_t *data, int32_t dlen, uint8_t *out, int32_t outlen) {
    int32_t h = md_by_name(name, nlen);
    if (h == 0) { wn_capture_error(); return -1; }
    EVP_MD *md = (EVP_MD *)(intptr_t)h;
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    int ok = ctx != NULL
          && EVP_DigestInit_ex(ctx, md, NULL) == 1
          && EVP_DigestUpdate(ctx, data, (size_t)dlen) == 1
          && EVP_DigestFinalXOF(ctx, out, (size_t)outlen) == 1;
    EVP_MD_CTX_free(ctx);
    EVP_MD_free(md);
    if (!ok) { wn_capture_error(); return -1; }
    return outlen;
}

/** Streaming digest context. Handle is an opaque pointer (wasm32). */
WN_EXPORT(wn_digest_new)(const char *name, int32_t nlen) {
    int32_t h = md_by_name(name, nlen);
    if (h == 0) { wn_capture_error(); return 0; }
    EVP_MD *md = (EVP_MD *)(intptr_t)h;
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    int ok = ctx != NULL && EVP_DigestInit_ex(ctx, md, NULL) == 1;
    EVP_MD_free(md);
    if (!ok) {
        if (ctx != NULL) EVP_MD_CTX_free(ctx);
        wn_capture_error();
        return 0;
    }
    return (int32_t)(intptr_t)ctx;
}

WN_EXPORT(wn_digest_update)(int32_t handle, const uint8_t *data, int32_t len) {
    EVP_MD_CTX *ctx = (EVP_MD_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    if (EVP_DigestUpdate(ctx, data, (size_t)len) != 1) { wn_capture_error(); return -1; }
    return 0;
}

WN_EXPORT(wn_digest_final)(int32_t handle, uint8_t *out) {
    EVP_MD_CTX *ctx = (EVP_MD_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    unsigned int outlen = 0;
    if (EVP_DigestFinal_ex(ctx, out, &outlen) != 1) { wn_capture_error(); return -1; }
    return (int32_t)outlen;
}

WN_EXPORT(wn_digest_final_xof)(int32_t handle, uint8_t *out, int32_t outlen) {
    EVP_MD_CTX *ctx = (EVP_MD_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    if (EVP_DigestFinalXOF(ctx, out, (size_t)outlen) != 1) { wn_capture_error(); return -1; }
    return outlen;
}

WN_EXPORT(wn_digest_free)(int32_t handle) {
    EVP_MD_CTX *ctx = (EVP_MD_CTX *)(intptr_t)handle;
    if (ctx != NULL) EVP_MD_CTX_free(ctx);
    return 0;
}

/** Copy of a running context (Node's `Hash.copy()`). */
WN_EXPORT(wn_digest_copy)(int32_t handle) {
    EVP_MD_CTX *ctx = (EVP_MD_CTX *)(intptr_t)handle;
    if (ctx == NULL) return 0;
    EVP_MD_CTX *copy = EVP_MD_CTX_new();
    if (copy == NULL || EVP_MD_CTX_copy_ex(copy, ctx) != 1) {
        if (copy != NULL) EVP_MD_CTX_free(copy);
        wn_capture_error();
        return 0;
    }
    return (int32_t)(intptr_t)copy;
}

/* --- HMAC ------------------------------------------------------------------- */

WN_EXPORT(wn_hmac)(const char *name, int32_t nlen,
                   const uint8_t *key, int32_t klen,
                   const uint8_t *data, int32_t dlen, uint8_t *out) {
    int32_t h = md_by_name(name, nlen);
    if (h == 0) { wn_capture_error(); return -1; }
    EVP_MD *md = (EVP_MD *)(intptr_t)h;
    unsigned int outlen = 0;
    unsigned char *res = HMAC(md, key, klen, data, (size_t)dlen, out, &outlen);
    EVP_MD_free(md);
    if (res == NULL) { wn_capture_error(); return -1; }
    return (int32_t)outlen;
}

WN_EXPORT(wn_hmac_new)(const char *name, int32_t nlen,
                       const uint8_t *key, int32_t klen) {
    int32_t h = md_by_name(name, nlen);
    if (h == 0) { wn_capture_error(); return 0; }
    EVP_MD *md = (EVP_MD *)(intptr_t)h;
    HMAC_CTX *ctx = HMAC_CTX_new();
    int ok = ctx != NULL && HMAC_Init_ex(ctx, key, klen, md, NULL) == 1;
    EVP_MD_free(md);
    if (!ok) {
        if (ctx != NULL) HMAC_CTX_free(ctx);
        wn_capture_error();
        return 0;
    }
    return (int32_t)(intptr_t)ctx;
}

WN_EXPORT(wn_hmac_update)(int32_t handle, const uint8_t *data, int32_t len) {
    HMAC_CTX *ctx = (HMAC_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    if (HMAC_Update(ctx, data, (size_t)len) != 1) { wn_capture_error(); return -1; }
    return 0;
}

WN_EXPORT(wn_hmac_final)(int32_t handle, uint8_t *out) {
    HMAC_CTX *ctx = (HMAC_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    unsigned int outlen = 0;
    if (HMAC_Final(ctx, out, &outlen) != 1) { wn_capture_error(); return -1; }
    return (int32_t)outlen;
}

WN_EXPORT(wn_hmac_free)(int32_t handle) {
    HMAC_CTX *ctx = (HMAC_CTX *)(intptr_t)handle;
    if (ctx != NULL) HMAC_CTX_free(ctx);
    return 0;
}
