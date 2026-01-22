/**
 * Stub openssl/kdf.h for WASM builds
 * OpenSSL is not available in WASM sandbox
 */
#pragma once

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct evp_kdf_st EVP_KDF;
typedef struct evp_kdf_ctx_st EVP_KDF_CTX;
typedef struct ossl_param_st OSSL_PARAM;

// KDF type constants
#define EVP_KDF_HKDF 1
#define EVP_KDF_PBKDF2 2
#define EVP_KDF_SCRYPT 3

// EVP_KDF stubs
static inline EVP_KDF *EVP_KDF_fetch(void *libctx, const char *algorithm, const char *properties) {
    (void)libctx; (void)algorithm; (void)properties; return NULL;
}
static inline void EVP_KDF_free(EVP_KDF *kdf) { (void)kdf; }
static inline EVP_KDF_CTX *EVP_KDF_CTX_new(EVP_KDF *kdf) { (void)kdf; return NULL; }
static inline void EVP_KDF_CTX_free(EVP_KDF_CTX *ctx) { (void)ctx; }
static inline int EVP_KDF_derive(EVP_KDF_CTX *ctx, unsigned char *key, size_t keylen, const OSSL_PARAM params[]) {
    (void)ctx; (void)key; (void)keylen; (void)params; return 0;
}
static inline int EVP_KDF_CTX_set_params(EVP_KDF_CTX *ctx, const OSSL_PARAM params[]) {
    (void)ctx; (void)params; return 0;
}

#ifdef __cplusplus
}
#endif
