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
 *
 * The public-key half (`wn_pkey_*`) is generic EVP_PKEY plumbing: keys are
 * built from DER (or from raw bytes for the fixed-length algorithms) and the
 * operations name their digest, so RSA / EC / Ed25519 / DH / ML-KEM all share
 * one surface instead of one entry point per algorithm.
 */
#include <stdint.h>
#include <string.h>
#include <stdlib.h>

#include <openssl/core_names.h>
#include <openssl/crypto.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/kdf.h>
#include <openssl/rsa.h>
#include <openssl/x509.h>

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
/**
 * Coarse classification of the last error, so JS can reproduce Node's exact
 * exception *without* sniffing English text or hard-coding OpenSSL's reason
 * codes (they are compared against the `EVP_R_*` macros here instead).
 */
enum {
    WN_ERR_NONE = 0,
    WN_ERR_WRONG_FINAL_BLOCK_LENGTH = 1,
    WN_ERR_BAD_DECRYPT = 2,
    WN_ERR_BAD_IV_LENGTH = 3,
    WN_ERR_OTHER = 4,
};
static int32_t wn_error_kind = WN_ERR_NONE;
static int32_t wn_error_lib = 0;
static char wn_error_reason[128];

static void wn_capture_error(void) {
    wn_error_kind = WN_ERR_NONE;
    wn_error_lib = 0;
    wn_error_reason[0] = '\0';
    unsigned long e = ERR_get_error();
    /* Drop anything queued behind the first error: Node reports the oldest
     * one too (`ERR_peek_error()`), and a stale tail confuses later reads. */
    while (ERR_get_error() != 0) { }
    if (e == 0) {
        wn_error[0] = '\0';
        return;
    }
    ERR_error_string_n(e, wn_error, sizeof(wn_error));
    wn_error_lib = (int32_t)ERR_GET_LIB(e);
    const char *reason = ERR_reason_error_string(e);
    if (reason != NULL) {
        strncpy(wn_error_reason, reason, sizeof(wn_error_reason) - 1);
        wn_error_reason[sizeof(wn_error_reason) - 1] = '\0';
    }
    switch (ERR_GET_REASON(e)) {
        case EVP_R_WRONG_FINAL_BLOCK_LENGTH: wn_error_kind = WN_ERR_WRONG_FINAL_BLOCK_LENGTH; break;
        case EVP_R_BAD_DECRYPT: wn_error_kind = WN_ERR_BAD_DECRYPT; break;
        case EVP_R_INVALID_IV_LENGTH: wn_error_kind = WN_ERR_BAD_IV_LENGTH; break;
        default: wn_error_kind = WN_ERR_OTHER; break;
    }
}
WN_PTR(wn_openssl_last_error)(void) { return wn_error; }
/** Clear the OpenSSL error queue (JS calls this before each fallible entry). */
WN_EXPORT(wn_openssl_clear_error)(void) {
    ERR_clear_error();
    wn_error[0] = '\0';
    wn_error_kind = WN_ERR_NONE;
    wn_error_lib = 0;
    wn_error_reason[0] = '\0';
    return 0;
}
/** One of `WN_ERR_*` for the last captured error (0 when there was none). */
WN_EXPORT(wn_openssl_error_kind)(void) { return wn_error_kind; }
/** `ERR_GET_LIB` of the last captured error (used to rebuild `ERR_OSSL_*` codes). */
WN_EXPORT(wn_openssl_error_lib)(void) { return wn_error_lib; }
/** `ERR_reason_error_string` of the last captured error, or an empty string. */
WN_PTR(wn_openssl_error_reason)(void) { return wn_error_reason; }

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

/* --- ciphers ---------------------------------------------------------------- */

/** Fetch a cipher by its OpenSSL name (`AES-128-CBC`, `ChaCha20-Poly1305`, …). */
static const EVP_CIPHER *cipher_by_name(const char *name, int32_t nlen) {
    char buf[64];
    if (nlen <= 0 || nlen >= (int32_t)sizeof(buf)) return NULL;
    memcpy(buf, name, (size_t)nlen);
    buf[nlen] = '\0';
    return EVP_CIPHER_fetch(NULL, buf, NULL);
}

/**
 * Metadata for a cipher, or -1 when OpenSSL cannot fetch the name.
 * `out` receives `[key_length, iv_length, block_size, mode, flags]` where mode
 * is the `EVP_CIPH_*_MODE` value (`0 stream`, `1 ECB`, `2 CBC`, `3 CFB`,
 * `4 OFB`, `5 CTR`, `6 GCM`, `7 CCM`, `0x10001 XTS`, `0x10002 WRAP`,
 * `0x10003 OCB`, `0x10004 SIV`, `0x10005 GCM-SIV`) and flags is the
 * `EVP_CIPH_FLAG_*` bitmask (`0x4000` CTS, `0x200000` AEAD, `0x2000000` MAC).
 */
WN_EXPORT(wn_cipher_info)(const char *name, int32_t nlen, int32_t *out) {
    const EVP_CIPHER *cipher = cipher_by_name(name, nlen);
    if (cipher == NULL) { wn_capture_error(); return -1; }
    out[0] = EVP_CIPHER_get_key_length(cipher);
    out[1] = EVP_CIPHER_get_iv_length(cipher);
    out[2] = EVP_CIPHER_get_block_size(cipher);
    out[3] = EVP_CIPHER_get_mode(cipher);
    out[4] = (int32_t)EVP_CIPHER_get_flags(cipher);
    EVP_CIPHER_free((EVP_CIPHER *)cipher);
    return 0;
}

/**
 * Create a cipher context in the "cipher only" state — no key, no IV yet, so
 * the caller can still adjust the IV length (and, for CCM, the tag).
 */
WN_EXPORT(wn_cipher_new)(const char *name, int32_t nlen, int32_t encrypt) {
    const EVP_CIPHER *cipher = cipher_by_name(name, nlen);
    if (cipher == NULL) { wn_capture_error(); return 0; }
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    int ok = ctx != NULL
          && (encrypt ? EVP_EncryptInit_ex(ctx, cipher, NULL, NULL, NULL)
                      : EVP_DecryptInit_ex(ctx, cipher, NULL, NULL, NULL)) == 1;
    EVP_CIPHER_free((EVP_CIPHER *)cipher);
    if (!ok) {
        if (ctx != NULL) EVP_CIPHER_CTX_free(ctx);
        wn_capture_error();
        return 0;
    }
    return (int32_t)(intptr_t)ctx;
}

/** Override the IV length (GCM/CCM/OCB take 12 by default, Node allows more). */
WN_EXPORT(wn_cipher_set_ivlen)(int32_t handle, int32_t length) {
    EVP_CIPHER_CTX *ctx = (EVP_CIPHER_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_IVLEN, length, NULL) != 1) {
        wn_capture_error();
        return -1;
    }
    return 0;
}

/** CCM's mandatory "how long is the plaintext" declaration. */
WN_EXPORT(wn_cipher_set_data_len)(int32_t handle, int32_t length) {
    EVP_CIPHER_CTX *ctx = (EVP_CIPHER_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    int outl = 0;
    if (EVP_CIPHER_CTX_is_encrypting(ctx)) {
        if (EVP_EncryptUpdate(ctx, NULL, &outl, NULL, length) != 1) { wn_capture_error(); return -1; }
    } else {
        if (EVP_DecryptUpdate(ctx, NULL, &outl, NULL, length) != 1) { wn_capture_error(); return -1; }
    }
    return 0;
}

/** Bind the key (and IV) once the context has been fully configured. */
WN_EXPORT(wn_cipher_set_key_iv)(int32_t handle, const uint8_t *key, int32_t klen,
                                const uint8_t *iv, int32_t ivlen) {
    EVP_CIPHER_CTX *ctx = (EVP_CIPHER_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    /* The context already knows its key/IV lengths; these are for the record. */
    (void)klen;
    int ok = EVP_CIPHER_CTX_is_encrypting(ctx)
           ? EVP_EncryptInit_ex(ctx, NULL, NULL, key, ivlen > 0 ? iv : NULL)
           : EVP_DecryptInit_ex(ctx, NULL, NULL, key, ivlen > 0 ? iv : NULL);
    if (ok != 1) { wn_capture_error(); return -1; }
    return 0;
}

/** PKCS#7 padding on/off (must be set before the key is bound in Node, but
 * OpenSSL accepts it any time before the first update). */
WN_EXPORT(wn_cipher_set_padding)(int32_t handle, int32_t padding) {
    EVP_CIPHER_CTX *ctx = (EVP_CIPHER_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    if (EVP_CIPHER_CTX_set_padding(ctx, padding) != 1) { wn_capture_error(); return -1; }
    return 0;
}

/** Additional authenticated data (GCM/CCM/OCB/SIV). */
WN_EXPORT(wn_cipher_aad)(int32_t handle, const uint8_t *aad, int32_t len) {
    EVP_CIPHER_CTX *ctx = (EVP_CIPHER_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    int outl = 0;
    int ok = EVP_CIPHER_CTX_is_encrypting(ctx)
           ? EVP_EncryptUpdate(ctx, NULL, &outl, aad, len)
           : EVP_DecryptUpdate(ctx, NULL, &outl, aad, len);
    if (ok != 1) { wn_capture_error(); return -1; }
    return 0;
}

/** Expected authentication tag (decryption only). CCM wants this before the
 * key is bound; GCM/OCB accept it any time before `final`. */
WN_EXPORT(wn_cipher_set_tag)(int32_t handle, const uint8_t *tag, int32_t len) {
    EVP_CIPHER_CTX *ctx = (EVP_CIPHER_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_TAG, len, (void *)tag) != 1) {
        wn_capture_error();
        return -1;
    }
    return 0;
}

/**
 * Declare an AEAD tag length without a tag. CCM and OCB require this before the
 * key is bound (there is no default); GCM and ChaCha20-Poly1305 have defaults
 * and are validated on the JS side instead.
 */
WN_EXPORT(wn_cipher_set_tag_len)(int32_t handle, int32_t length) {
    EVP_CIPHER_CTX *ctx = (EVP_CIPHER_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_TAG, length, NULL) != 1) {
        wn_capture_error();
        return -1;
    }
    return 0;
}

/** Extract the tag produced by an encrypting AEAD context. */
WN_EXPORT(wn_cipher_get_tag)(int32_t handle, uint8_t *out, int32_t len) {
    EVP_CIPHER_CTX *ctx = (EVP_CIPHER_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_GET_TAG, len, out) != 1) {
        wn_capture_error();
        return -1;
    }
    return len;
}

/** One `update` step. Returns the number of bytes written to `out`, or -1. */
WN_EXPORT(wn_cipher_update)(int32_t handle, const uint8_t *in, int32_t inlen, uint8_t *out) {
    EVP_CIPHER_CTX *ctx = (EVP_CIPHER_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    int outl = 0;
    int ok = EVP_CIPHER_CTX_is_encrypting(ctx)
           ? EVP_EncryptUpdate(ctx, out, &outl, in, inlen)
           : EVP_DecryptUpdate(ctx, out, &outl, in, inlen);
    if (ok != 1) { wn_capture_error(); return -1; }
    return (int32_t)outl;
}

/** Finish the stream. Returns the number of bytes written to `out`, or -1. */
WN_EXPORT(wn_cipher_final)(int32_t handle, uint8_t *out) {
    EVP_CIPHER_CTX *ctx = (EVP_CIPHER_CTX *)(intptr_t)handle;
    if (ctx == NULL) return -1;
    int outl = 0;
    int ok = EVP_CIPHER_CTX_is_encrypting(ctx)
           ? EVP_EncryptFinal_ex(ctx, out, &outl)
           : EVP_DecryptFinal_ex(ctx, out, &outl);
    if (ok != 1) { wn_capture_error(); return -1; }
    return (int32_t)outl;
}

WN_EXPORT(wn_cipher_free)(int32_t handle) {
    EVP_CIPHER_CTX *ctx = (EVP_CIPHER_CTX *)(intptr_t)handle;
    if (ctx != NULL) EVP_CIPHER_CTX_free(ctx);
    return 0;
}

/* --- KDFs ------------------------------------------------------------------- */

/** RFC 8018 PBKDF2 with `md` in the same name-based spelling as the digests. */
WN_EXPORT(wn_pbkdf2)(const char *name, int32_t nlen,
                     const uint8_t *pw, int32_t pwlen,
                     const uint8_t *salt, int32_t saltlen,
                     int32_t iterations, uint8_t *out, int32_t keylen) {
    int32_t h = md_by_name(name, nlen);
    if (h == 0) { wn_capture_error(); return -1; }
    EVP_MD *md = (EVP_MD *)(intptr_t)h;
    int ok = PKCS5_PBKDF2_HMAC((const char *)pw, pwlen, salt, saltlen, iterations, md, keylen, out);
    EVP_MD_free(md);
    if (ok != 1) { wn_capture_error(); return -1; }
    return keylen;
}

/** RFC 5869 HKDF (extract-then-expand). */
WN_EXPORT(wn_hkdf)(const char *name, int32_t nlen,
                   const uint8_t *ikm, int32_t ikmlen,
                   const uint8_t *salt, int32_t saltlen,
                   const uint8_t *info, int32_t infolen,
                   uint8_t *out, int32_t keylen) {
    int32_t h = md_by_name(name, nlen);
    if (h == 0) { wn_capture_error(); return -1; }
    EVP_MD *md = (EVP_MD *)(intptr_t)h;
    EVP_PKEY_CTX *pctx = EVP_PKEY_CTX_new_id(EVP_PKEY_HKDF, NULL);
    size_t outlen = (size_t)keylen;
    int ok = pctx != NULL
          && EVP_PKEY_derive_init(pctx) == 1
          && EVP_PKEY_CTX_set_hkdf_md(pctx, md) == 1
          && (saltlen == 0 || EVP_PKEY_CTX_set1_hkdf_salt(pctx, salt, saltlen) == 1)
          && EVP_PKEY_CTX_set1_hkdf_key(pctx, ikm, ikmlen) == 1
          && (infolen == 0 || EVP_PKEY_CTX_add1_hkdf_info(pctx, info, infolen) == 1)
          && EVP_PKEY_derive(pctx, out, &outlen) == 1;
    if (pctx != NULL) EVP_PKEY_CTX_free(pctx);
    EVP_MD_free(md);
    if (!ok) { wn_capture_error(); return -1; }
    return (int32_t)outlen;
}

/** RFC 7914 scrypt. `maxmem` is enforced by OpenSSL exactly as Node does. */
WN_EXPORT(wn_scrypt)(const uint8_t *pw, int32_t pwlen,
                     const uint8_t *salt, int32_t saltlen,
                     int32_t N, int32_t r, int32_t p, uint32_t maxmem,
                     uint8_t *out, int32_t keylen) {
    int ok = EVP_PBE_scrypt((const char *)pw, (size_t)pwlen, salt, (size_t)saltlen,
                            (uint64_t)N, (uint64_t)r, (uint64_t)p,
                            (uint64_t)maxmem, out, (size_t)keylen);
    if (ok != 1) { wn_capture_error(); return -1; }
    return keylen;
}

/*
 * RFC 9106 Argon2, via the default provider's ARGON2D / ARGON2I / ARGON2ID
 * KDF. `algo` is the bare OpenSSL algorithm name (not NUL-terminated on the
 * JS side).
 *
 * Deliberately omits `OSSL_KDF_PARAM_THREADS`: `deps/ncrypto/ncrypto.cc` only
 * sets it (bumping `OSSL_set_max_threads` on a private library context) to
 * spread lanes across OS threads, and our wasi OpenSSL is built with
 * `thread_scheme=(none)`. Lane count is a *separate* parameter that defines
 * the algorithm, so dropping the thread hint cannot change the output — it
 * only keeps the computation on one lane at a time. The provider rejects
 * `threads > lanes`, which is why raising lanes alone is safe here.
 */
WN_EXPORT(wn_argon2)(const char *algo, int32_t alen,
                     const uint8_t *pw, int32_t pwlen,
                     const uint8_t *salt, int32_t saltlen,
                     const uint8_t *secret, int32_t secretlen,
                     const uint8_t *ad, int32_t adlen,
                     int32_t lanes, int32_t keylen,
                     uint32_t memcost, uint32_t iter,
                     uint8_t *out) {
    char name[16];
    if (alen <= 0 || alen >= (int32_t)sizeof(name)) return -1;
    memcpy(name, algo, (size_t)alen);
    name[alen] = '\0';

    EVP_KDF *kdf = EVP_KDF_fetch(NULL, name, NULL);
    if (kdf == NULL) { wn_capture_error(); return -1; }
    EVP_KDF_CTX *kctx = EVP_KDF_CTX_new(kdf);
    EVP_KDF_free(kdf);
    if (kctx == NULL) { wn_capture_error(); return -1; }

    uint32_t lanes_u = (uint32_t)lanes;
    OSSL_PARAM params[9];
    size_t i = 0;
    params[i++] = OSSL_PARAM_construct_octet_string(
        OSSL_KDF_PARAM_PASSWORD, (void *)pw, (size_t)pwlen);
    params[i++] = OSSL_PARAM_construct_octet_string(
        OSSL_KDF_PARAM_SALT, (void *)salt, (size_t)saltlen);
    params[i++] = OSSL_PARAM_construct_uint32(OSSL_KDF_PARAM_ARGON2_LANES, &lanes_u);
    params[i++] = OSSL_PARAM_construct_uint32(OSSL_KDF_PARAM_ARGON2_MEMCOST, &memcost);
    params[i++] = OSSL_PARAM_construct_uint32(OSSL_KDF_PARAM_ITER, &iter);
    if (secretlen > 0) {
        params[i++] = OSSL_PARAM_construct_octet_string(
            OSSL_KDF_PARAM_SECRET, (void *)secret, (size_t)secretlen);
    }
    if (adlen > 0) {
        params[i++] = OSSL_PARAM_construct_octet_string(
            OSSL_KDF_PARAM_ARGON2_AD, (void *)ad, (size_t)adlen);
    }
    params[i] = OSSL_PARAM_construct_end();

    int ok = EVP_KDF_derive(kctx, out, (size_t)keylen, params);
    EVP_KDF_CTX_free(kctx);
    if (ok != 1) { wn_capture_error(); return -1; }
    return keylen;
}

/* --- public keys (EVP_PKEY) ------------------------------------------------- */

/* Node's `crypto.constants` padding numbers, so JS can pass them through. */
enum {
    WN_PAD_NONE = 0,
    WN_PAD_PKCS1 = 1,
    WN_PAD_NO_PADDING = 3,
    WN_PAD_OAEP = 4,
    WN_PAD_X931 = 5,
    WN_PAD_PSS = 6,
};

static EVP_PKEY *wn_pkey(int32_t handle) { return (EVP_PKEY *)(intptr_t)handle; }

/** Copy a not-necessarily-NUL-terminated wasm string into `buf`. */
static const char *wn_str(const char *src, int32_t len, char *buf, size_t cap) {
    if (len <= 0 || len >= (int32_t)cap) return NULL;
    memcpy(buf, src, (size_t)len);
    buf[len] = '\0';
    return buf;
}

/**
 * Generate a key pair. `name` is the OpenSSL algorithm ("RSA", "EC",
 * "ED25519", "DH", …); `group` is the named group/curve for the algorithms
 * that take one (EC, DH); `bits` the key size for RSA. Returns a private-key
 * handle (0 on failure) — the public half is derived by exporting it.
 */
WN_EXPORT(wn_pkey_keygen)(const char *name, int32_t nlen,
                          const char *group, int32_t glen, int32_t bits) {
    char namebuf[64];
    if (wn_str(name, nlen, namebuf, sizeof(namebuf)) == NULL) return 0;

    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new_from_name(NULL, namebuf, NULL);
    if (ctx == NULL) { wn_capture_error(); return 0; }
    if (EVP_PKEY_keygen_init(ctx) != 1) { EVP_PKEY_CTX_free(ctx); wn_capture_error(); return 0; }

    if (bits > 0) {
        /* Only RSA-style keygen takes a bit count; others keep their default. */
        if (EVP_PKEY_CTX_set_rsa_keygen_bits(ctx, bits) != 1) {
            wn_capture_error();
            EVP_PKEY_CTX_free(ctx);
            return 0;
        }
    }
    if (glen > 0) {
        char groupbuf[64];
        if (wn_str(group, glen, groupbuf, sizeof(groupbuf)) == NULL) {
            EVP_PKEY_CTX_free(ctx);
            return 0;
        }
        OSSL_PARAM params[2];
        params[0] = OSSL_PARAM_construct_utf8_string(OSSL_PKEY_PARAM_GROUP_NAME, groupbuf, 0);
        params[1] = OSSL_PARAM_construct_end();
        if (EVP_PKEY_CTX_set_params(ctx, params) != 1) {
            EVP_PKEY_CTX_free(ctx);
            wn_capture_error();
            return 0;
        }
    }

    EVP_PKEY *pkey = NULL;
    if (EVP_PKEY_keygen(ctx, &pkey) != 1) {
        EVP_PKEY_CTX_free(ctx);
        wn_capture_error();
        return 0;
    }
    EVP_PKEY_CTX_free(ctx);
    return (int32_t)(intptr_t)pkey;
}

/** Import a private (PKCS#8/PKCS#1/SEC1) or public (SPKI/PKCS#1) DER key. */
WN_EXPORT(wn_pkey_from_der)(const uint8_t *der, int32_t len, int32_t is_private) {
    const unsigned char *p = der;
    EVP_PKEY *pkey = is_private ? d2i_AutoPrivateKey(NULL, &p, (long)len)
                                : d2i_PUBKEY(NULL, &p, (long)len);
    if (pkey == NULL) { wn_capture_error(); return 0; }
    return (int32_t)(intptr_t)pkey;
}

/** Import a fixed-length raw key (Ed25519, ML-KEM, X25519, …). */
WN_EXPORT(wn_pkey_from_raw)(const char *name, int32_t nlen,
                            const uint8_t *data, int32_t dlen, int32_t is_private) {
    char namebuf[64];
    if (wn_str(name, nlen, namebuf, sizeof(namebuf)) == NULL) return 0;
    EVP_PKEY *pkey = is_private
        ? EVP_PKEY_new_raw_private_key_ex(NULL, namebuf, NULL, data, (size_t)dlen)
        : EVP_PKEY_new_raw_public_key_ex(NULL, namebuf, NULL, data, (size_t)dlen);
    if (pkey == NULL) { wn_capture_error(); return 0; }
    return (int32_t)(intptr_t)pkey;
}

/** Serialise a key as DER, writing at most `cap` bytes; returns the length. */
WN_EXPORT(wn_pkey_to_der)(int32_t handle, int32_t is_private, uint8_t *out, int32_t cap) {
    EVP_PKEY *pkey = wn_pkey(handle);
    if (pkey == NULL) return -1;
    unsigned char *p = out;
    int len = is_private ? i2d_PrivateKey(pkey, &p) : i2d_PUBKEY(pkey, &p);
    if (len <= 0) { wn_capture_error(); return -1; }
    if (len > cap) { wn_capture_error(); return -1; }
    return (int32_t)len;
}

/** Byte length of the DER (or raw) encoding, so JS can size its buffer. */
WN_EXPORT(wn_pkey_der_size)(int32_t handle, int32_t is_private) {
    EVP_PKEY *pkey = wn_pkey(handle);
    if (pkey == NULL) return -1;
    int len = is_private ? i2d_PrivateKey(pkey, NULL) : i2d_PUBKEY(pkey, NULL);
    if (len <= 0) { wn_capture_error(); return -1; }
    return (int32_t)len;
}

/** Byte length of the raw key encoding (0 when the algorithm has none). */
WN_EXPORT(wn_pkey_raw_size)(int32_t handle, int32_t is_private) {
    EVP_PKEY *pkey = wn_pkey(handle);
    if (pkey == NULL) return -1;
    size_t len = 0;
    int ok = is_private ? EVP_PKEY_get_raw_private_key(pkey, NULL, &len)
                        : EVP_PKEY_get_raw_public_key(pkey, NULL, &len);
    if (ok != 1) { wn_capture_error(); return -1; }
    return (int32_t)len;
}

WN_EXPORT(wn_pkey_to_raw)(int32_t handle, int32_t is_private, uint8_t *out, int32_t cap) {
    EVP_PKEY *pkey = wn_pkey(handle);
    if (pkey == NULL) return -1;
    size_t len = (size_t)cap;
    int ok = is_private ? EVP_PKEY_get_raw_private_key(pkey, out, &len)
                        : EVP_PKEY_get_raw_public_key(pkey, out, &len);
    if (ok != 1) { wn_capture_error(); return -1; }
    return (int32_t)len;
}

WN_EXPORT(wn_pkey_size)(int32_t handle) {
    EVP_PKEY *pkey = wn_pkey(handle);
    if (pkey == NULL) return -1;
    int size = EVP_PKEY_get_size(pkey);
    if (size <= 0) { wn_capture_error(); return -1; }
    return (int32_t)size;
}

WN_EXPORT(wn_pkey_free)(int32_t handle) {
    EVP_PKEY *pkey = wn_pkey(handle);
    if (pkey != NULL) EVP_PKEY_free(pkey);
    return 0;
}

/**
 * Apply Node's `padding`/`saltLength` (and, for OAEP, the digest/label) to a
 * signing context. Only RSA understands these; other algorithms pass 0 and
 * keep OpenSSL's defaults.
 */
static int wn_set_sign_padding(EVP_PKEY_CTX *pctx, int32_t padding, int32_t saltlen) {
    switch (padding) {
        case WN_PAD_PKCS1:
            return EVP_PKEY_CTX_set_rsa_padding(pctx, RSA_PKCS1_PADDING) == 1;
        case WN_PAD_X931:
            return EVP_PKEY_CTX_set_rsa_padding(pctx, RSA_X931_PADDING) == 1;
        case WN_PAD_NO_PADDING:
            return EVP_PKEY_CTX_set_rsa_padding(pctx, RSA_NO_PADDING) == 1;
        case WN_PAD_PSS:
            if (EVP_PKEY_CTX_set_rsa_padding(pctx, RSA_PKCS1_PSS_PADDING) != 1) return 0;
            /* 0 leaves OpenSSL's default (max salt on sign, auto on verify). */
            if (saltlen != 0 && EVP_PKEY_CTX_set_rsa_pss_saltlen(pctx, saltlen) != 1) return 0;
            return 1;
        default:
            return 1;
    }
}

/**
 * Sign `data`. An empty `md` signs the message directly (Ed25519); otherwise
 * OpenSSL hashes it first. `padding`/`saltlen` are Node's constants (0 = the
 * algorithm default). Returns the signature length, or -1.
 */
WN_EXPORT(wn_pkey_sign)(int32_t handle, const char *md, int32_t mdlen,
                        int32_t padding, int32_t saltlen,
                        const uint8_t *data, int32_t dlen,
                        uint8_t *out, int32_t cap) {
    EVP_PKEY *pkey = wn_pkey(handle);
    if (pkey == NULL) return -1;
    char mdbuf[64];
    const char *mdname = mdlen > 0 ? wn_str(md, mdlen, mdbuf, sizeof(mdbuf)) : NULL;
    if (mdlen > 0 && mdname == NULL) return -1;
    EVP_MD *mdobj = mdname != NULL ? EVP_MD_fetch(NULL, mdname, NULL) : NULL;
    if (mdname != NULL && mdobj == NULL) { wn_capture_error(); return -1; }

    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    if (ctx == NULL) { EVP_MD_free(mdobj); return -1; }
    EVP_PKEY_CTX *pctx = NULL;
    int ok = EVP_DigestSignInit(ctx, &pctx, mdobj, NULL, pkey);
    if (ok == 1 && padding != WN_PAD_NONE && pctx != NULL) {
        ok = wn_set_sign_padding(pctx, padding, saltlen);
    }
    size_t siglen = 0;
    if (ok == 1) ok = EVP_DigestSign(ctx, NULL, &siglen, data, (size_t)dlen);
    if (ok == 1 && siglen <= (size_t)cap) {
        ok = EVP_DigestSign(ctx, out, &siglen, data, (size_t)dlen);
    } else if (ok == 1) {
        ok = 0;
    }
    EVP_MD_CTX_free(ctx);
    EVP_MD_free(mdobj);
    if (ok != 1) { wn_capture_error(); return -1; }
    return (int32_t)siglen;
}

/** Verify `sig` over `data`. Returns 1 (valid), 0 (invalid) or -1 (error). */
WN_EXPORT(wn_pkey_verify)(int32_t handle, const char *md, int32_t mdlen,
                          int32_t padding, int32_t saltlen,
                          const uint8_t *data, int32_t dlen,
                          const uint8_t *sig, int32_t siglen) {
    EVP_PKEY *pkey = wn_pkey(handle);
    if (pkey == NULL) return -1;
    char mdbuf[64];
    const char *mdname = mdlen > 0 ? wn_str(md, mdlen, mdbuf, sizeof(mdbuf)) : NULL;
    if (mdlen > 0 && mdname == NULL) return -1;
    EVP_MD *mdobj = mdname != NULL ? EVP_MD_fetch(NULL, mdname, NULL) : NULL;
    if (mdname != NULL && mdobj == NULL) { wn_capture_error(); return -1; }

    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    if (ctx == NULL) { EVP_MD_free(mdobj); return -1; }
    EVP_PKEY_CTX *pctx = NULL;
    int ok = EVP_DigestVerifyInit(ctx, &pctx, mdobj, NULL, pkey);
    if (ok == 1 && padding != WN_PAD_NONE && pctx != NULL) {
        ok = wn_set_sign_padding(pctx, padding, saltlen);
    }
    int res = ok == 1 ? EVP_DigestVerify(ctx, sig, (size_t)siglen, data, (size_t)dlen) : -1;
    EVP_MD_CTX_free(ctx);
    EVP_MD_free(mdobj);
    if (res == 1) return 1;
    if (res == 0) return 0;
    wn_capture_error();
    return -1;
}

/** Apply Node's `padding` (plus OAEP digest/label) to an encrypt context. */
static int wn_set_encrypt_padding(EVP_PKEY_CTX *ctx, int32_t padding,
                                  const char *md, int32_t mdlen,
                                  const uint8_t *label, int32_t labellen) {
    switch (padding) {
        case WN_PAD_PKCS1:
            return EVP_PKEY_CTX_set_rsa_padding(ctx, RSA_PKCS1_PADDING) == 1;
        case WN_PAD_NO_PADDING:
            return EVP_PKEY_CTX_set_rsa_padding(ctx, RSA_NO_PADDING) == 1;
        case WN_PAD_OAEP: {
            if (EVP_PKEY_CTX_set_rsa_padding(ctx, RSA_PKCS1_OAEP_PADDING) != 1) return 0;
            if (mdlen > 0) {
                char mdbuf[64];
                const char *mdname = wn_str(md, mdlen, mdbuf, sizeof(mdbuf));
                if (mdname == NULL) return 0;
                EVP_MD *mdobj = EVP_MD_fetch(NULL, mdname, NULL);
                if (mdobj == NULL) return 0;
                int ok = EVP_PKEY_CTX_set_rsa_oaep_md(ctx, mdobj) == 1;
                EVP_MD_free(mdobj);
                if (!ok) return 0;
            }
            if (labellen > 0) {
                /* `set0` takes ownership, so hand it a copy OpenSSL can free. */
                void *copy = OPENSSL_memdup(label, (size_t)labellen);
                if (copy == NULL) return 0;
                if (EVP_PKEY_CTX_set0_rsa_oaep_label(ctx, copy, labellen) != 1) {
                    OPENSSL_free(copy);
                    return 0;
                }
            }
            return 1;
        }
        default:
            return 1;
    }
}

/** RSA-encrypt `data` (or any key that supports `EVP_PKEY_encrypt`). */
WN_EXPORT(wn_pkey_encrypt)(int32_t handle, int32_t padding,
                           const char *md, int32_t mdlen,
                           const uint8_t *label, int32_t labellen,
                           const uint8_t *data, int32_t dlen,
                           uint8_t *out, int32_t cap) {
    EVP_PKEY *pkey = wn_pkey(handle);
    if (pkey == NULL) return -1;
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new_from_pkey(NULL, pkey, NULL);
    if (ctx == NULL) { wn_capture_error(); return -1; }
    size_t outlen = 0;
    int ok = EVP_PKEY_encrypt_init(ctx);
    if (ok == 1) ok = wn_set_encrypt_padding(ctx, padding, md, mdlen, label, labellen);
    if (ok == 1) ok = EVP_PKEY_encrypt(ctx, NULL, &outlen, data, (size_t)dlen);
    if (ok == 1 && outlen <= (size_t)cap) {
        ok = EVP_PKEY_encrypt(ctx, out, &outlen, data, (size_t)dlen);
    } else if (ok == 1) {
        ok = 0;
    }
    EVP_PKEY_CTX_free(ctx);
    if (ok != 1) { wn_capture_error(); return -1; }
    return (int32_t)outlen;
}

/** RSA-decrypt `data`. Returns the plaintext length, or -1. */
WN_EXPORT(wn_pkey_decrypt)(int32_t handle, int32_t padding,
                           const char *md, int32_t mdlen,
                           const uint8_t *label, int32_t labellen,
                           const uint8_t *data, int32_t dlen,
                           uint8_t *out, int32_t cap) {
    EVP_PKEY *pkey = wn_pkey(handle);
    if (pkey == NULL) return -1;
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new_from_pkey(NULL, pkey, NULL);
    if (ctx == NULL) { wn_capture_error(); return -1; }
    size_t outlen = 0;
    int ok = EVP_PKEY_decrypt_init(ctx);
    if (ok == 1) ok = wn_set_encrypt_padding(ctx, padding, md, mdlen, label, labellen);
    if (ok == 1) ok = EVP_PKEY_decrypt(ctx, NULL, &outlen, data, (size_t)dlen);
    if (ok == 1 && outlen <= (size_t)cap) {
        ok = EVP_PKEY_decrypt(ctx, out, &outlen, data, (size_t)dlen);
    } else if (ok == 1) {
        ok = 0;
    }
    EVP_PKEY_CTX_free(ctx);
    if (ok != 1) { wn_capture_error(); return -1; }
    return (int32_t)outlen;
}

/** ECDH / DH shared secret between our private key and a peer's public key. */
WN_EXPORT(wn_pkey_derive)(int32_t handle, int32_t peer, uint8_t *out, int32_t cap) {
    EVP_PKEY *pkey = wn_pkey(handle);
    EVP_PKEY *peerkey = wn_pkey(peer);
    if (pkey == NULL || peerkey == NULL) return -1;
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new_from_pkey(NULL, pkey, NULL);
    if (ctx == NULL) { wn_capture_error(); return -1; }
    size_t outlen = 0;
    int ok = EVP_PKEY_derive_init(ctx);
    if (ok == 1) ok = EVP_PKEY_derive_set_peer(ctx, peerkey);
    if (ok == 1) ok = EVP_PKEY_derive(ctx, NULL, &outlen);
    if (ok == 1 && outlen <= (size_t)cap) {
        ok = EVP_PKEY_derive(ctx, out, &outlen);
    } else if (ok == 1) {
        ok = 0;
    }
    EVP_PKEY_CTX_free(ctx);
    if (ok != 1) { wn_capture_error(); return -1; }
    return (int32_t)outlen;
}

/**
 * KEM encapsulation (ML-KEM). Writes the ciphertext to `ct` and the shared
 * secret to `ss`; `out[0]`/`out[1]` receive their lengths.
 */
WN_EXPORT(wn_pkey_encapsulate)(int32_t handle,
                               uint8_t *ct, int32_t ctcap,
                               uint8_t *ss, int32_t sscap,
                               int32_t *out) {
    EVP_PKEY *pkey = wn_pkey(handle);
    if (pkey == NULL) return -1;
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new_from_pkey(NULL, pkey, NULL);
    if (ctx == NULL) { wn_capture_error(); return -1; }
    size_t ctlen = (size_t)ctcap;
    size_t sslen = (size_t)sscap;
    int ok = EVP_PKEY_encapsulate_init(ctx, NULL);
    if (ok == 1) ok = EVP_PKEY_encapsulate(ctx, ct, &ctlen, ss, &sslen);
    EVP_PKEY_CTX_free(ctx);
    if (ok != 1) { wn_capture_error(); return -1; }
    out[0] = (int32_t)ctlen;
    out[1] = (int32_t)sslen;
    return 0;
}

/** KEM decapsulation (ML-KEM). `out[0]` receives the shared-secret length. */
WN_EXPORT(wn_pkey_decapsulate)(int32_t handle,
                               const uint8_t *ct, int32_t ctlen,
                               uint8_t *ss, int32_t sscap,
                               int32_t *out) {
    EVP_PKEY *pkey = wn_pkey(handle);
    if (pkey == NULL) return -1;
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new_from_pkey(NULL, pkey, NULL);
    if (ctx == NULL) { wn_capture_error(); return -1; }
    size_t sslen = (size_t)sscap;
    int ok = EVP_PKEY_decapsulate_init(ctx, NULL);
    if (ok == 1) ok = EVP_PKEY_decapsulate(ctx, ss, &sslen, ct, (size_t)ctlen);
    EVP_PKEY_CTX_free(ctx);
    if (ok != 1) { wn_capture_error(); return -1; }
    out[0] = (int32_t)sslen;
    return 0;
}
