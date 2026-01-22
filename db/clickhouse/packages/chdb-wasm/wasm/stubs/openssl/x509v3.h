/**
 * Stub openssl/x509v3.h for WASM builds
 * OpenSSL is not available in WASM sandbox
 */
#pragma once

#include "ssl.h"  // For X509 type

#ifdef __cplusplus
extern "C" {
#endif

// X509v3 extension NID values
#define NID_subject_alt_name 85
#define NID_commonName 13
#define NID_countryName 14
#define NID_localityName 15
#define NID_stateOrProvinceName 16
#define NID_organizationName 17
#define NID_organizationalUnitName 18

// General name types
#define GEN_OTHERNAME 0
#define GEN_EMAIL 1
#define GEN_DNS 2
#define GEN_X400 3
#define GEN_DIRNAME 4
#define GEN_EDIPARTY 5
#define GEN_URI 6
#define GEN_IPADD 7
#define GEN_RID 8

// X509v3 extension types
typedef struct GENERAL_NAME_st GENERAL_NAME;
typedef struct GENERAL_NAMES_st GENERAL_NAMES;
typedef struct STACK_OF_GENERAL_NAME_st STACK_OF_GENERAL_NAME;

// X509 extension functions
static inline void *X509_get_ext_d2i(X509 *x, int nid, int *crit, int *idx) {
    (void)x; (void)nid; (void)crit; (void)idx; return NULL;
}
static inline int X509_NAME_get_text_by_NID(void *name, int nid, char *buf, int len) {
    (void)name; (void)nid; (void)buf; (void)len; return -1;
}
static inline void *X509_get_subject_name(X509 *x) { (void)x; return NULL; }
static inline void *X509_get_issuer_name(X509 *x) { (void)x; return NULL; }

// Stack operations
static inline int sk_GENERAL_NAME_num(const STACK_OF_GENERAL_NAME *st) { (void)st; return 0; }
static inline GENERAL_NAME *sk_GENERAL_NAME_value(const STACK_OF_GENERAL_NAME *st, int i) { (void)st; (void)i; return NULL; }
static inline void sk_GENERAL_NAME_pop_free(STACK_OF_GENERAL_NAME *st, void (*free_func)(GENERAL_NAME *)) {
    (void)st; (void)free_func;
}

static inline void GENERAL_NAMES_free(GENERAL_NAMES *names) { (void)names; }

#ifdef __cplusplus
}
#endif
