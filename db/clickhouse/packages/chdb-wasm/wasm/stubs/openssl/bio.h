/**
 * Stub openssl/bio.h for WASM builds
 * OpenSSL is not available in WASM sandbox
 */
#pragma once

#include "ssl.h"  // For BIO type

#ifdef __cplusplus
extern "C" {
#endif

// BIO method types
#define BIO_TYPE_SOCKET 5
#define BIO_TYPE_SSL 7
#define BIO_TYPE_MEM 8
#define BIO_TYPE_CONNECT 12
#define BIO_TYPE_ACCEPT 13

// BIO CTRL commands
#define BIO_CTRL_RESET 1
#define BIO_CTRL_EOF 2
#define BIO_CTRL_INFO 3
#define BIO_CTRL_SET 4
#define BIO_CTRL_GET 5
#define BIO_CTRL_PUSH 6
#define BIO_CTRL_POP 7
#define BIO_CTRL_GET_CLOSE 8
#define BIO_CTRL_SET_CLOSE 9
#define BIO_CTRL_PENDING 10
#define BIO_CTRL_FLUSH 11
#define BIO_CTRL_DUP 12
#define BIO_CTRL_WPENDING 13

// BIO flags
#define BIO_FLAGS_READ 0x01
#define BIO_FLAGS_WRITE 0x02
#define BIO_FLAGS_IO_SPECIAL 0x04
#define BIO_FLAGS_RWS (BIO_FLAGS_READ|BIO_FLAGS_WRITE|BIO_FLAGS_IO_SPECIAL)
#define BIO_FLAGS_SHOULD_RETRY 0x08

// Stub BIO method type
typedef struct bio_method_st BIO_METHOD;

// BIO functions - all return NULL or error
static inline BIO *BIO_new(const BIO_METHOD *type) { (void)type; return NULL; }
static inline void BIO_free(BIO *bio) { (void)bio; }
static inline void BIO_free_all(BIO *bio) { (void)bio; }
static inline int BIO_read(BIO *b, void *data, int len) { (void)b; (void)data; (void)len; return -1; }
static inline int BIO_write(BIO *b, const void *data, int len) { (void)b; (void)data; (void)len; return -1; }
static inline int BIO_puts(BIO *b, const char *buf) { (void)b; (void)buf; return -1; }
static inline int BIO_gets(BIO *b, char *buf, int size) { (void)b; (void)buf; (void)size; return -1; }
static inline long BIO_ctrl(BIO *b, int cmd, long larg, void *parg) { (void)b; (void)cmd; (void)larg; (void)parg; return 0; }
static inline int BIO_pending(BIO *b) { (void)b; return 0; }
static inline int BIO_wpending(BIO *b) { (void)b; return 0; }
static inline int BIO_flush(BIO *b) { (void)b; return 0; }
static inline void BIO_set_flags(BIO *b, int flags) { (void)b; (void)flags; }
static inline int BIO_test_flags(const BIO *b, int flags) { (void)b; (void)flags; return 0; }
static inline void BIO_clear_flags(BIO *b, int flags) { (void)b; (void)flags; }
static inline int BIO_should_retry(BIO *b) { (void)b; return 0; }
static inline int BIO_should_read(BIO *b) { (void)b; return 0; }
static inline int BIO_should_write(BIO *b) { (void)b; return 0; }

// BIO method types
static inline const BIO_METHOD *BIO_s_mem(void) { return NULL; }
static inline const BIO_METHOD *BIO_s_socket(void) { return NULL; }
static inline const BIO_METHOD *BIO_s_connect(void) { return NULL; }
static inline const BIO_METHOD *BIO_s_accept(void) { return NULL; }
static inline const BIO_METHOD *BIO_f_ssl(void) { return NULL; }
static inline const BIO_METHOD *BIO_s_file(void) { return NULL; }

// Socket BIO
static inline BIO *BIO_new_socket(int sock, int close_flag) { (void)sock; (void)close_flag; return NULL; }
static inline BIO *BIO_new_ssl(SSL_CTX *ctx, int client) { (void)ctx; (void)client; return NULL; }
static inline BIO *BIO_new_ssl_connect(SSL_CTX *ctx) { (void)ctx; return NULL; }
static inline int BIO_set_conn_hostname(BIO *b, const char *name) { (void)b; (void)name; return 0; }
static inline int BIO_set_conn_port(BIO *b, const char *port) { (void)b; (void)port; return 0; }

// Memory BIO
static inline BIO *BIO_new_mem_buf(const void *buf, int len) { (void)buf; (void)len; return NULL; }
static inline long BIO_get_mem_data(BIO *b, char **pp) { (void)b; (void)pp; return 0; }

// File BIO
static inline BIO *BIO_new_file(const char *filename, const char *mode) { (void)filename; (void)mode; return NULL; }
static inline BIO *BIO_new_fp(void *stream, int flags) { (void)stream; (void)flags; return NULL; }

#ifdef __cplusplus
}
#endif
