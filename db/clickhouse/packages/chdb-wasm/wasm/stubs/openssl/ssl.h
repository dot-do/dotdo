/**
 * Stub openssl/ssl.h for WASM builds
 * OpenSSL is not available in WASM sandbox
 */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Minimal type definitions for compilation
typedef struct ssl_st SSL;
typedef struct ssl_ctx_st SSL_CTX;
typedef struct ssl_method_st SSL_METHOD;
typedef struct ssl_session_st SSL_SESSION;
typedef struct x509_st X509;
typedef struct x509_store_st X509_STORE;
typedef struct x509_store_ctx_st X509_STORE_CTX;
typedef struct evp_pkey_st EVP_PKEY;
typedef struct bio_st BIO;
typedef struct stack_st_X509 STACK_OF_X509;

// SSL verification modes
#define SSL_VERIFY_NONE 0x00
#define SSL_VERIFY_PEER 0x01
#define SSL_VERIFY_FAIL_IF_NO_PEER_CERT 0x02
#define SSL_VERIFY_CLIENT_ONCE 0x04

// SSL error codes
#define SSL_ERROR_NONE 0
#define SSL_ERROR_SSL 1
#define SSL_ERROR_WANT_READ 2
#define SSL_ERROR_WANT_WRITE 3
#define SSL_ERROR_WANT_X509_LOOKUP 4
#define SSL_ERROR_SYSCALL 5
#define SSL_ERROR_ZERO_RETURN 6
#define SSL_ERROR_WANT_CONNECT 7
#define SSL_ERROR_WANT_ACCEPT 8

// SSL CTRL codes
#define SSL_CTRL_SET_TMP_DH 3
#define SSL_CTRL_SET_TMP_ECDH 4
#define SSL_CTRL_OPTIONS 32
#define SSL_CTRL_MODE 33
#define SSL_CTRL_SET_MIN_PROTO_VERSION 123
#define SSL_CTRL_SET_MAX_PROTO_VERSION 124

// SSL modes
#define SSL_MODE_ENABLE_PARTIAL_WRITE 0x00000001L
#define SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER 0x00000002L
#define SSL_MODE_AUTO_RETRY 0x00000004L

// Protocol versions
#define SSL3_VERSION 0x0300
#define TLS1_VERSION 0x0301
#define TLS1_1_VERSION 0x0302
#define TLS1_2_VERSION 0x0303
#define TLS1_3_VERSION 0x0304

// Filetype constants
#define SSL_FILETYPE_PEM 1
#define SSL_FILETYPE_ASN1 2

// Stub functions - all return NULL or error
static inline int SSL_library_init(void) { return 0; }
static inline void SSL_load_error_strings(void) {}
static inline const SSL_METHOD *TLS_method(void) { return NULL; }
static inline const SSL_METHOD *TLS_client_method(void) { return NULL; }
static inline const SSL_METHOD *TLS_server_method(void) { return NULL; }
static inline SSL_CTX *SSL_CTX_new(const SSL_METHOD *method) { (void)method; return NULL; }
static inline void SSL_CTX_free(SSL_CTX *ctx) { (void)ctx; }
static inline SSL *SSL_new(SSL_CTX *ctx) { (void)ctx; return NULL; }
static inline void SSL_free(SSL *ssl) { (void)ssl; }
static inline int SSL_connect(SSL *ssl) { (void)ssl; return -1; }
static inline int SSL_accept(SSL *ssl) { (void)ssl; return -1; }
static inline int SSL_read(SSL *ssl, void *buf, int num) { (void)ssl; (void)buf; (void)num; return -1; }
static inline int SSL_write(SSL *ssl, const void *buf, int num) { (void)ssl; (void)buf; (void)num; return -1; }
static inline int SSL_shutdown(SSL *ssl) { (void)ssl; return -1; }
static inline int SSL_get_error(const SSL *ssl, int ret) { (void)ssl; (void)ret; return -1; }
static inline int SSL_pending(const SSL *ssl) { (void)ssl; return 0; }
static inline int SSL_has_pending(const SSL *ssl) { (void)ssl; return 0; }
static inline void SSL_set_bio(SSL *ssl, BIO *rbio, BIO *wbio) { (void)ssl; (void)rbio; (void)wbio; }
static inline int SSL_set_fd(SSL *ssl, int fd) { (void)ssl; (void)fd; return 0; }
static inline int SSL_get_fd(const SSL *ssl) { (void)ssl; return -1; }
static inline X509 *SSL_get_peer_certificate(const SSL *ssl) { (void)ssl; return NULL; }
static inline long SSL_get_verify_result(const SSL *ssl) { (void)ssl; return 0; }
static inline int SSL_state(const SSL *ssl) { (void)ssl; return 0; }
static inline const char *SSL_state_string_long(const SSL *ssl) { (void)ssl; return "stub"; }

// SSL_SESSION functions
static inline SSL_SESSION *SSL_get_session(const SSL *ssl) { (void)ssl; return NULL; }
static inline SSL_SESSION *SSL_get1_session(SSL *ssl) { (void)ssl; return NULL; }
static inline int SSL_set_session(SSL *ssl, SSL_SESSION *session) { (void)ssl; (void)session; return 0; }
static inline void SSL_SESSION_free(SSL_SESSION *session) { (void)session; }
static inline int SSL_SESSION_is_resumable(const SSL_SESSION *s) { (void)s; return 0; }

// SSL_CTX functions
static inline int SSL_CTX_set_cipher_list(SSL_CTX *ctx, const char *str) { (void)ctx; (void)str; return 0; }
static inline void SSL_CTX_set_verify(SSL_CTX *ctx, int mode, void *cb) { (void)ctx; (void)mode; (void)cb; }
static inline int SSL_CTX_set_default_verify_paths(SSL_CTX *ctx) { (void)ctx; return 0; }
static inline int SSL_CTX_load_verify_locations(SSL_CTX *ctx, const char *file, const char *dir) { (void)ctx; (void)file; (void)dir; return 0; }
static inline int SSL_CTX_use_certificate_file(SSL_CTX *ctx, const char *file, int type) { (void)ctx; (void)file; (void)type; return 0; }
static inline int SSL_CTX_use_PrivateKey_file(SSL_CTX *ctx, const char *file, int type) { (void)ctx; (void)file; (void)type; return 0; }
static inline int SSL_CTX_use_certificate_chain_file(SSL_CTX *ctx, const char *file) { (void)ctx; (void)file; return 0; }
static inline int SSL_CTX_check_private_key(const SSL_CTX *ctx) { (void)ctx; return 0; }
static inline long SSL_CTX_ctrl(SSL_CTX *ctx, int cmd, long larg, void *parg) { (void)ctx; (void)cmd; (void)larg; (void)parg; return 0; }
static inline long SSL_CTX_set_options(SSL_CTX *ctx, long options) { (void)ctx; (void)options; return 0; }
static inline long SSL_CTX_set_mode(SSL_CTX *ctx, long mode) { (void)ctx; (void)mode; return 0; }
static inline void SSL_CTX_set_session_cache_mode(SSL_CTX *ctx, long mode) { (void)ctx; (void)mode; }
static inline X509_STORE *SSL_CTX_get_cert_store(const SSL_CTX *ctx) { (void)ctx; return NULL; }

// SSL info callback
typedef void (*SSL_info_callback)(const SSL *ssl, int type, int val);
typedef int (*SSL_verify_cb)(int preverify_ok, X509_STORE_CTX *x509_ctx);
static inline void SSL_set_info_callback(SSL *ssl, SSL_info_callback cb) { (void)ssl; (void)cb; }
static inline void SSL_CTX_set_info_callback(SSL_CTX *ctx, SSL_info_callback cb) { (void)ctx; (void)cb; }

// Session cache modes
#define SSL_SESS_CACHE_OFF 0x0000
#define SSL_SESS_CACHE_CLIENT 0x0001
#define SSL_SESS_CACHE_SERVER 0x0002
#define SSL_SESS_CACHE_BOTH (SSL_SESS_CACHE_CLIENT | SSL_SESS_CACHE_SERVER)
#define SSL_SESS_CACHE_NO_AUTO_CLEAR 0x0080
#define SSL_SESS_CACHE_NO_INTERNAL_LOOKUP 0x0100
#define SSL_SESS_CACHE_NO_INTERNAL_STORE 0x0200
#define SSL_SESS_CACHE_NO_INTERNAL (SSL_SESS_CACHE_NO_INTERNAL_LOOKUP | SSL_SESS_CACHE_NO_INTERNAL_STORE)

// Session ID length
#define SSL_MAX_SSL_SESSION_ID_LENGTH 32
#define SSL_MAX_SID_CTX_LENGTH 32

// X509 cert defaults
static inline const char *X509_get_default_cert_dir_env(void) { return "SSL_CERT_DIR"; }
static inline const char *X509_get_default_cert_dir(void) { return "/etc/ssl/certs"; }
static inline const char *X509_get_default_cert_file_env(void) { return "SSL_CERT_FILE"; }
static inline const char *X509_get_default_cert_file(void) { return "/etc/ssl/cert.pem"; }

// More SSL_CTX functions
static inline void SSL_CTX_set_verify_depth(SSL_CTX *ctx, int depth) { (void)ctx; (void)depth; }
static inline long SSL_CTX_get_session_cache_mode(SSL_CTX *ctx) { (void)ctx; return SSL_SESS_CACHE_OFF; }
static inline int SSL_CTX_set_session_id_context(SSL_CTX *ctx, const unsigned char *sid_ctx, unsigned int sid_ctx_len) {
    (void)ctx; (void)sid_ctx; (void)sid_ctx_len; return 0;
}
static inline long SSL_CTX_sess_set_cache_size(SSL_CTX *ctx, long t) { (void)ctx; (void)t; return 0; }
static inline long SSL_CTX_sess_get_cache_size(SSL_CTX *ctx) { (void)ctx; return 0; }
static inline long SSL_CTX_set_timeout(SSL_CTX *ctx, long t) { (void)ctx; (void)t; return 0; }
static inline long SSL_CTX_get_timeout(const SSL_CTX *ctx) { (void)ctx; return 0; }

// X509 verification callback
typedef int (*X509_STORE_CTX_verify_cb)(int, X509_STORE_CTX *);
static inline void X509_STORE_set_verify_cb(X509_STORE *ctx, X509_STORE_CTX_verify_cb verify_cb) { (void)ctx; (void)verify_cb; }
static inline int X509_STORE_add_cert(X509_STORE *ctx, X509 *x) { (void)ctx; (void)x; return 0; }
static inline int X509_STORE_add_crl(X509_STORE *ctx, void *x) { (void)ctx; (void)x; return 0; }
static inline int X509_STORE_set_flags(X509_STORE *ctx, unsigned long flags) { (void)ctx; (void)flags; return 0; }

// X509 store context
static inline int X509_STORE_CTX_get_error(X509_STORE_CTX *ctx) { (void)ctx; return 0; }
static inline int X509_STORE_CTX_get_error_depth(X509_STORE_CTX *ctx) { (void)ctx; return 0; }
static inline X509 *X509_STORE_CTX_get_current_cert(X509_STORE_CTX *ctx) { (void)ctx; return NULL; }
static inline void X509_STORE_CTX_set_error(X509_STORE_CTX *ctx, int s) { (void)ctx; (void)s; }

// X509 functions
static inline void X509_free(X509 *x) { (void)x; }
static inline X509 *X509_dup(X509 *x) { (void)x; return NULL; }
static inline const char *X509_verify_cert_error_string(long n) { (void)n; return "certificate verification error"; }

// DH/EC key parameters
typedef struct dh_st DH;
typedef struct ec_key_st EC_KEY;
static inline DH *DH_new(void) { return NULL; }
static inline void DH_free(DH *dh) { (void)dh; }
static inline EC_KEY *EC_KEY_new_by_curve_name(int nid) { (void)nid; return NULL; }
static inline void EC_KEY_free(EC_KEY *key) { (void)key; }

// Named curve NIDs
#define NID_X9_62_prime256v1 415
#define NID_secp384r1 715
#define NID_secp521r1 716

// SSL_CTX DH/ECDH functions
#define SSL_CTX_set_tmp_dh(ctx, dh) SSL_CTX_ctrl(ctx, SSL_CTRL_SET_TMP_DH, 0, (char*)dh)
#define SSL_CTX_set_tmp_ecdh(ctx, ecdh) SSL_CTX_ctrl(ctx, SSL_CTRL_SET_TMP_ECDH, 0, (char*)ecdh)

// Shutdown modes
#define SSL_SENT_SHUTDOWN 1
#define SSL_RECEIVED_SHUTDOWN 2
static inline int SSL_get_shutdown(const SSL *ssl) { (void)ssl; return 0; }
static inline void SSL_set_shutdown(SSL *ssl, int mode) { (void)ssl; (void)mode; }

// Version constants
#define SSL_OP_NO_SSLv2 0x01000000L
#define SSL_OP_NO_SSLv3 0x02000000L
#define SSL_OP_NO_TLSv1 0x04000000L

#ifdef __cplusplus
}
#endif
