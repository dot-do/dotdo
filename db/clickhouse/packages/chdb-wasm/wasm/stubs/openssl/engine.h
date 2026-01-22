/**
 * Stub openssl/engine.h for WASM builds
 * OpenSSL is not available in WASM sandbox
 */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

typedef struct engine_st ENGINE;

// Engine flags
#define ENGINE_METHOD_ALL 0xFFFF
#define ENGINE_METHOD_RSA 0x0001
#define ENGINE_METHOD_DSA 0x0002
#define ENGINE_METHOD_DH 0x0004
#define ENGINE_METHOD_RAND 0x0008
#define ENGINE_METHOD_CIPHERS 0x0040
#define ENGINE_METHOD_DIGESTS 0x0080

// Engine stubs
static inline int ENGINE_load_builtin_engines(void) { return 0; }
static inline ENGINE *ENGINE_by_id(const char *id) { (void)id; return NULL; }
static inline ENGINE *ENGINE_get_first(void) { return NULL; }
static inline ENGINE *ENGINE_get_next(ENGINE *e) { (void)e; return NULL; }
static inline int ENGINE_free(ENGINE *e) { (void)e; return 1; }
static inline int ENGINE_init(ENGINE *e) { (void)e; return 0; }
static inline int ENGINE_finish(ENGINE *e) { (void)e; return 1; }
static inline int ENGINE_set_default(ENGINE *e, unsigned int flags) { (void)e; (void)flags; return 0; }
static inline const char *ENGINE_get_id(const ENGINE *e) { (void)e; return NULL; }
static inline const char *ENGINE_get_name(const ENGINE *e) { (void)e; return NULL; }

#ifdef __cplusplus
}
#endif
