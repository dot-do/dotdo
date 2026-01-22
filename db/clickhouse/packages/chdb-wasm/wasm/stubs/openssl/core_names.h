/**
 * Stub openssl/core_names.h for WASM builds
 * OpenSSL is not available in WASM sandbox
 */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Common parameter names
#define OSSL_KDF_PARAM_DIGEST "digest"
#define OSSL_KDF_PARAM_KEY "key"
#define OSSL_KDF_PARAM_SALT "salt"
#define OSSL_KDF_PARAM_INFO "info"
#define OSSL_KDF_PARAM_MODE "mode"
#define OSSL_KDF_PARAM_ITER "iter"
#define OSSL_KDF_PARAM_PASSWORD "pass"
#define OSSL_KDF_PARAM_PKCS5 "pkcs5"

// MAC names
#define OSSL_MAC_PARAM_DIGEST "digest"
#define OSSL_MAC_PARAM_KEY "key"
#define OSSL_MAC_PARAM_SIZE "size"

// Cipher names
#define OSSL_CIPHER_PARAM_PADDING "padding"
#define OSSL_CIPHER_PARAM_IVLEN "ivlen"
#define OSSL_CIPHER_PARAM_KEYLEN "keylen"
#define OSSL_CIPHER_PARAM_TAGLEN "taglen"

// Algorithm names
#define OSSL_ALG_PARAM_DIGEST "digest"
#define OSSL_ALG_PARAM_CIPHER "cipher"
#define OSSL_ALG_PARAM_MAC "mac"

// Provider names
#define OSSL_PROV_PARAM_NAME "name"
#define OSSL_PROV_PARAM_VERSION "version"

#ifdef __cplusplus
}
#endif
