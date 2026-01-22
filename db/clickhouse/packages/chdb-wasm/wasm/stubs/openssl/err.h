/**
 * Stub openssl/err.h for WASM builds
 * OpenSSL is not available in WASM sandbox
 */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

static inline unsigned long ERR_get_error(void) { return 0; }
static inline unsigned long ERR_peek_error(void) { return 0; }
static inline unsigned long ERR_peek_last_error(void) { return 0; }
static inline void ERR_clear_error(void) {}
static inline char *ERR_error_string(unsigned long e, char *buf) { (void)e; (void)buf; return NULL; }
static inline void ERR_error_string_n(unsigned long e, char *buf, size_t len) { (void)e; (void)buf; (void)len; }
static inline const char *ERR_reason_error_string(unsigned long e) { (void)e; return "OpenSSL not available"; }
static inline const char *ERR_lib_error_string(unsigned long e) { (void)e; return "OpenSSL not available"; }
static inline const char *ERR_func_error_string(unsigned long e) { (void)e; return "OpenSSL not available"; }
static inline void ERR_print_errors_fp(void *fp) { (void)fp; }
static inline void ERR_load_crypto_strings(void) {}
static inline void ERR_free_strings(void) {}

#ifdef __cplusplus
}
#endif
