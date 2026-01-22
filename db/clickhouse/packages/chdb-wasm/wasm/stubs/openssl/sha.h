/**
 * Stub openssl/sha.h for WASM builds
 * OpenSSL is not available in WASM sandbox
 */
#pragma once

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SHA_DIGEST_LENGTH 20
#define SHA224_DIGEST_LENGTH 28
#define SHA256_DIGEST_LENGTH 32
#define SHA384_DIGEST_LENGTH 48
#define SHA512_DIGEST_LENGTH 64

#define SHA_LBLOCK 16
#define SHA256_CBLOCK 64
#define SHA512_CBLOCK 128

typedef struct SHAstate_st {
    unsigned int h[5];
    unsigned int Nl, Nh;
    unsigned int data[SHA_LBLOCK];
    unsigned int num;
} SHA_CTX;

typedef struct SHA256state_st {
    unsigned int h[8];
    unsigned int Nl, Nh;
    unsigned int data[SHA_LBLOCK];
    unsigned int num, md_len;
} SHA256_CTX;

typedef struct SHA512state_st {
    unsigned long long h[8];
    unsigned long long Nl, Nh;
    union {
        unsigned long long d[SHA_LBLOCK];
        unsigned char p[SHA512_CBLOCK];
    } u;
    unsigned int num, md_len;
} SHA512_CTX;

// SHA-1 stubs
static inline int SHA1_Init(SHA_CTX *c) { (void)c; return 0; }
static inline int SHA1_Update(SHA_CTX *c, const void *data, size_t len) { (void)c; (void)data; (void)len; return 0; }
static inline int SHA1_Final(unsigned char *md, SHA_CTX *c) { (void)md; (void)c; return 0; }
static inline unsigned char *SHA1(const unsigned char *d, size_t n, unsigned char *md) { (void)d; (void)n; (void)md; return NULL; }

// SHA-224 stubs
static inline int SHA224_Init(SHA256_CTX *c) { (void)c; return 0; }
static inline int SHA224_Update(SHA256_CTX *c, const void *data, size_t len) { (void)c; (void)data; (void)len; return 0; }
static inline int SHA224_Final(unsigned char *md, SHA256_CTX *c) { (void)md; (void)c; return 0; }
static inline unsigned char *SHA224(const unsigned char *d, size_t n, unsigned char *md) { (void)d; (void)n; (void)md; return NULL; }

// SHA-256 stubs
static inline int SHA256_Init(SHA256_CTX *c) { (void)c; return 0; }
static inline int SHA256_Update(SHA256_CTX *c, const void *data, size_t len) { (void)c; (void)data; (void)len; return 0; }
static inline int SHA256_Final(unsigned char *md, SHA256_CTX *c) { (void)md; (void)c; return 0; }
static inline unsigned char *SHA256(const unsigned char *d, size_t n, unsigned char *md) { (void)d; (void)n; (void)md; return NULL; }

// SHA-384 stubs
static inline int SHA384_Init(SHA512_CTX *c) { (void)c; return 0; }
static inline int SHA384_Update(SHA512_CTX *c, const void *data, size_t len) { (void)c; (void)data; (void)len; return 0; }
static inline int SHA384_Final(unsigned char *md, SHA512_CTX *c) { (void)md; (void)c; return 0; }
static inline unsigned char *SHA384(const unsigned char *d, size_t n, unsigned char *md) { (void)d; (void)n; (void)md; return NULL; }

// SHA-512 stubs
static inline int SHA512_Init(SHA512_CTX *c) { (void)c; return 0; }
static inline int SHA512_Update(SHA512_CTX *c, const void *data, size_t len) { (void)c; (void)data; (void)len; return 0; }
static inline int SHA512_Final(unsigned char *md, SHA512_CTX *c) { (void)md; (void)c; return 0; }
static inline unsigned char *SHA512(const unsigned char *d, size_t n, unsigned char *md) { (void)d; (void)n; (void)md; return NULL; }

#ifdef __cplusplus
}
#endif
