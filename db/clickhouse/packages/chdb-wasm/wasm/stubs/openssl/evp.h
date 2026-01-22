/**
 * Stub openssl/evp.h for WASM builds
 * OpenSSL is not available in WASM sandbox
 */
#pragma once

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// EVP types
typedef struct evp_cipher_st EVP_CIPHER;
typedef struct evp_cipher_ctx_st EVP_CIPHER_CTX;
typedef struct evp_md_st EVP_MD;
typedef struct evp_md_ctx_st EVP_MD_CTX;
typedef struct evp_pkey_st EVP_PKEY;
typedef struct evp_pkey_ctx_st EVP_PKEY_CTX;
typedef struct engine_st ENGINE;

// EVP_MD stubs
static inline const EVP_MD *EVP_md5(void) { return NULL; }
static inline const EVP_MD *EVP_sha1(void) { return NULL; }
static inline const EVP_MD *EVP_sha224(void) { return NULL; }
static inline const EVP_MD *EVP_sha256(void) { return NULL; }
static inline const EVP_MD *EVP_sha384(void) { return NULL; }
static inline const EVP_MD *EVP_sha512(void) { return NULL; }
static inline const EVP_MD *EVP_get_digestbyname(const char *name) { (void)name; return NULL; }
static inline int EVP_MD_size(const EVP_MD *md) { (void)md; return 0; }
static inline int EVP_MD_block_size(const EVP_MD *md) { (void)md; return 0; }
static inline int EVP_MD_type(const EVP_MD *md) { (void)md; return 0; }

// EVP_MD_CTX stubs
static inline EVP_MD_CTX *EVP_MD_CTX_new(void) { return NULL; }
static inline void EVP_MD_CTX_free(EVP_MD_CTX *ctx) { (void)ctx; }
static inline int EVP_MD_CTX_reset(EVP_MD_CTX *ctx) { (void)ctx; return 0; }
static inline int EVP_DigestInit(EVP_MD_CTX *ctx, const EVP_MD *type) { (void)ctx; (void)type; return 0; }
static inline int EVP_DigestInit_ex(EVP_MD_CTX *ctx, const EVP_MD *type, ENGINE *impl) { (void)ctx; (void)type; (void)impl; return 0; }
static inline int EVP_DigestUpdate(EVP_MD_CTX *ctx, const void *d, size_t cnt) { (void)ctx; (void)d; (void)cnt; return 0; }
static inline int EVP_DigestFinal(EVP_MD_CTX *ctx, unsigned char *md, unsigned int *s) { (void)ctx; (void)md; (void)s; return 0; }
static inline int EVP_DigestFinal_ex(EVP_MD_CTX *ctx, unsigned char *md, unsigned int *s) { (void)ctx; (void)md; (void)s; return 0; }
static inline int EVP_Digest(const void *data, size_t count, unsigned char *md, unsigned int *size, const EVP_MD *type, ENGINE *impl) {
    (void)data; (void)count; (void)md; (void)size; (void)type; (void)impl; return 0;
}

// EVP_CIPHER stubs
static inline const EVP_CIPHER *EVP_aes_128_cbc(void) { return NULL; }
static inline const EVP_CIPHER *EVP_aes_192_cbc(void) { return NULL; }
static inline const EVP_CIPHER *EVP_aes_256_cbc(void) { return NULL; }
static inline const EVP_CIPHER *EVP_aes_128_gcm(void) { return NULL; }
static inline const EVP_CIPHER *EVP_aes_256_gcm(void) { return NULL; }
static inline const EVP_CIPHER *EVP_aes_128_ctr(void) { return NULL; }
static inline const EVP_CIPHER *EVP_aes_256_ctr(void) { return NULL; }
static inline const EVP_CIPHER *EVP_des_cbc(void) { return NULL; }
static inline const EVP_CIPHER *EVP_des_ede3_cbc(void) { return NULL; }
static inline int EVP_CIPHER_key_length(const EVP_CIPHER *cipher) { (void)cipher; return 0; }
static inline int EVP_CIPHER_iv_length(const EVP_CIPHER *cipher) { (void)cipher; return 0; }
static inline int EVP_CIPHER_block_size(const EVP_CIPHER *cipher) { (void)cipher; return 0; }

// EVP_CIPHER_CTX stubs
static inline EVP_CIPHER_CTX *EVP_CIPHER_CTX_new(void) { return NULL; }
static inline void EVP_CIPHER_CTX_free(EVP_CIPHER_CTX *ctx) { (void)ctx; }
static inline int EVP_CIPHER_CTX_reset(EVP_CIPHER_CTX *ctx) { (void)ctx; return 0; }
static inline int EVP_EncryptInit(EVP_CIPHER_CTX *ctx, const EVP_CIPHER *cipher, const unsigned char *key, const unsigned char *iv) {
    (void)ctx; (void)cipher; (void)key; (void)iv; return 0;
}
static inline int EVP_EncryptInit_ex(EVP_CIPHER_CTX *ctx, const EVP_CIPHER *cipher, ENGINE *impl, const unsigned char *key, const unsigned char *iv) {
    (void)ctx; (void)cipher; (void)impl; (void)key; (void)iv; return 0;
}
static inline int EVP_EncryptUpdate(EVP_CIPHER_CTX *ctx, unsigned char *out, int *outl, const unsigned char *in, int inl) {
    (void)ctx; (void)out; (void)outl; (void)in; (void)inl; return 0;
}
static inline int EVP_EncryptFinal(EVP_CIPHER_CTX *ctx, unsigned char *out, int *outl) { (void)ctx; (void)out; (void)outl; return 0; }
static inline int EVP_EncryptFinal_ex(EVP_CIPHER_CTX *ctx, unsigned char *out, int *outl) { (void)ctx; (void)out; (void)outl; return 0; }
static inline int EVP_DecryptInit(EVP_CIPHER_CTX *ctx, const EVP_CIPHER *cipher, const unsigned char *key, const unsigned char *iv) {
    (void)ctx; (void)cipher; (void)key; (void)iv; return 0;
}
static inline int EVP_DecryptInit_ex(EVP_CIPHER_CTX *ctx, const EVP_CIPHER *cipher, ENGINE *impl, const unsigned char *key, const unsigned char *iv) {
    (void)ctx; (void)cipher; (void)impl; (void)key; (void)iv; return 0;
}
static inline int EVP_DecryptUpdate(EVP_CIPHER_CTX *ctx, unsigned char *out, int *outl, const unsigned char *in, int inl) {
    (void)ctx; (void)out; (void)outl; (void)in; (void)inl; return 0;
}
static inline int EVP_DecryptFinal(EVP_CIPHER_CTX *ctx, unsigned char *out, int *outl) { (void)ctx; (void)out; (void)outl; return 0; }
static inline int EVP_DecryptFinal_ex(EVP_CIPHER_CTX *ctx, unsigned char *out, int *outl) { (void)ctx; (void)out; (void)outl; return 0; }

// EVP_PKEY stubs
static inline EVP_PKEY *EVP_PKEY_new(void) { return NULL; }
static inline void EVP_PKEY_free(EVP_PKEY *pkey) { (void)pkey; }
static inline int EVP_PKEY_id(const EVP_PKEY *pkey) { (void)pkey; return 0; }
static inline int EVP_PKEY_bits(const EVP_PKEY *pkey) { (void)pkey; return 0; }
static inline int EVP_PKEY_size(const EVP_PKEY *pkey) { (void)pkey; return 0; }

// PBKDF2
static inline int PKCS5_PBKDF2_HMAC(const char *pass, int passlen, const unsigned char *salt, int saltlen,
                                    int iter, const EVP_MD *digest, int keylen, unsigned char *out) {
    (void)pass; (void)passlen; (void)salt; (void)saltlen; (void)iter; (void)digest; (void)keylen; (void)out;
    return 0;
}
static inline int PKCS5_PBKDF2_HMAC_SHA1(const char *pass, int passlen, const unsigned char *salt, int saltlen,
                                          int iter, int keylen, unsigned char *out) {
    (void)pass; (void)passlen; (void)salt; (void)saltlen; (void)iter; (void)keylen; (void)out;
    return 0;
}

#ifdef __cplusplus
}
#endif
