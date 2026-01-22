/**
 * wasm_network_stubs.cpp - Network/Socket Stub Implementation for WASM
 *
 * WASM cannot perform raw socket operations. This file provides stub
 * implementations that return appropriate error codes (ENOSYS, ENOTSUP).
 *
 * All functions follow the same pattern:
 * 1. Set errno to ENOSYS (function not implemented)
 * 2. Return -1 for functions returning int
 * 3. Return NULL for functions returning pointers
 * 4. Return (ssize_t)-1 for functions returning ssize_t
 *
 * This allows code that checks return values properly to handle the
 * "not supported" case gracefully.
 */

#ifdef __EMSCRIPTEN__

#include "wasm_network_stubs.h"

#include <errno.h>
#include <string.h>
#include <netdb.h>
#include <stdio.h>
#include <ifaddrs.h>

#ifdef __cplusplus
extern "C" {
#endif

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Log a warning when a network function is called (debug builds only)
 */
#ifdef WASM_NETWORK_DEBUG
static void wasm_network_warn(const char *func_name)
{
    fprintf(stderr, "[WASM] Network function '%s' called but not supported\n", func_name);
}
#define WASM_NET_WARN(name) wasm_network_warn(name)
#else
#define WASM_NET_WARN(name) ((void)0)
#endif

/**
 * Standard stub return: set errno and return error
 */
#define WASM_NET_STUB_RETURN(func_name) \
    do { \
        WASM_NET_WARN(func_name); \
        errno = ENOSYS; \
        return -1; \
    } while (0)

#define WASM_NET_STUB_RETURN_SSIZE(func_name) \
    do { \
        WASM_NET_WARN(func_name); \
        errno = ENOSYS; \
        return (ssize_t)-1; \
    } while (0)

#define WASM_NET_STUB_RETURN_NULL(func_name) \
    do { \
        WASM_NET_WARN(func_name); \
        errno = ENOSYS; \
        return NULL; \
    } while (0)

// ============================================================================
// Socket Creation and Connection
// ============================================================================

int wasm_socket(int domain, int type, int protocol)
{
    (void)domain;
    (void)type;
    (void)protocol;
    WASM_NET_STUB_RETURN("socket");
}

int wasm_socketpair(int domain, int type, int protocol, int sv[2])
{
    (void)domain;
    (void)type;
    (void)protocol;
    (void)sv;
    WASM_NET_STUB_RETURN("socketpair");
}

int wasm_bind(int sockfd, const struct sockaddr *addr, socklen_t addrlen)
{
    (void)sockfd;
    (void)addr;
    (void)addrlen;
    WASM_NET_STUB_RETURN("bind");
}

int wasm_listen(int sockfd, int backlog)
{
    (void)sockfd;
    (void)backlog;
    WASM_NET_STUB_RETURN("listen");
}

int wasm_accept(int sockfd, struct sockaddr *addr, socklen_t *addrlen)
{
    (void)sockfd;
    (void)addr;
    (void)addrlen;
    WASM_NET_STUB_RETURN("accept");
}

int wasm_accept4(int sockfd, struct sockaddr *addr, socklen_t *addrlen, int flags)
{
    (void)sockfd;
    (void)addr;
    (void)addrlen;
    (void)flags;
    WASM_NET_STUB_RETURN("accept4");
}

int wasm_connect(int sockfd, const struct sockaddr *addr, socklen_t addrlen)
{
    (void)sockfd;
    (void)addr;
    (void)addrlen;
    WASM_NET_STUB_RETURN("connect");
}

// ============================================================================
// Data Transmission
// ============================================================================

ssize_t wasm_send(int sockfd, const void *buf, size_t len, int flags)
{
    (void)sockfd;
    (void)buf;
    (void)len;
    (void)flags;
    WASM_NET_STUB_RETURN_SSIZE("send");
}

ssize_t wasm_sendto(int sockfd, const void *buf, size_t len, int flags,
                    const struct sockaddr *dest_addr, socklen_t addrlen)
{
    (void)sockfd;
    (void)buf;
    (void)len;
    (void)flags;
    (void)dest_addr;
    (void)addrlen;
    WASM_NET_STUB_RETURN_SSIZE("sendto");
}

ssize_t wasm_sendmsg(int sockfd, const struct msghdr *msg, int flags)
{
    (void)sockfd;
    (void)msg;
    (void)flags;
    WASM_NET_STUB_RETURN_SSIZE("sendmsg");
}

ssize_t wasm_recv(int sockfd, void *buf, size_t len, int flags)
{
    (void)sockfd;
    (void)buf;
    (void)len;
    (void)flags;
    WASM_NET_STUB_RETURN_SSIZE("recv");
}

ssize_t wasm_recvfrom(int sockfd, void *buf, size_t len, int flags,
                      struct sockaddr *src_addr, socklen_t *addrlen)
{
    (void)sockfd;
    (void)buf;
    (void)len;
    (void)flags;
    (void)src_addr;
    (void)addrlen;
    WASM_NET_STUB_RETURN_SSIZE("recvfrom");
}

ssize_t wasm_recvmsg(int sockfd, struct msghdr *msg, int flags)
{
    (void)sockfd;
    (void)msg;
    (void)flags;
    WASM_NET_STUB_RETURN_SSIZE("recvmsg");
}

// ============================================================================
// Socket Options
// ============================================================================

int wasm_getsockopt(int sockfd, int level, int optname,
                    void *optval, socklen_t *optlen)
{
    (void)sockfd;
    (void)level;
    (void)optname;
    (void)optval;
    (void)optlen;
    WASM_NET_STUB_RETURN("getsockopt");
}

int wasm_setsockopt(int sockfd, int level, int optname,
                    const void *optval, socklen_t optlen)
{
    (void)sockfd;
    (void)level;
    (void)optname;
    (void)optval;
    (void)optlen;
    WASM_NET_STUB_RETURN("setsockopt");
}

int wasm_getsockname(int sockfd, struct sockaddr *addr, socklen_t *addrlen)
{
    (void)sockfd;
    (void)addr;
    (void)addrlen;
    WASM_NET_STUB_RETURN("getsockname");
}

int wasm_getpeername(int sockfd, struct sockaddr *addr, socklen_t *addrlen)
{
    (void)sockfd;
    (void)addr;
    (void)addrlen;
    WASM_NET_STUB_RETURN("getpeername");
}

// ============================================================================
// Network Information
// ============================================================================

int wasm_getaddrinfo(const char *node, const char *service,
                     const struct addrinfo *hints, struct addrinfo **res)
{
    (void)node;
    (void)service;
    (void)hints;

    WASM_NET_WARN("getaddrinfo");

    // Set res to NULL to indicate no results
    if (res)
        *res = NULL;

    // Return EAI_SYSTEM and set errno for proper error handling
    errno = ENOSYS;
    return EAI_SYSTEM;
}

void wasm_freeaddrinfo(struct addrinfo *res)
{
    // No-op since we never allocate anything
    (void)res;
}

int wasm_getnameinfo(const struct sockaddr *addr, socklen_t addrlen,
                     char *host, socklen_t hostlen,
                     char *serv, socklen_t servlen, int flags)
{
    (void)addr;
    (void)addrlen;
    (void)host;
    (void)hostlen;
    (void)serv;
    (void)servlen;
    (void)flags;

    WASM_NET_WARN("getnameinfo");

    errno = ENOSYS;
    return EAI_SYSTEM;
}

struct hostent *wasm_gethostbyname(const char *name)
{
    (void)name;

    WASM_NET_WARN("gethostbyname");

    // Set h_errno for legacy error handling
    h_errno = NO_RECOVERY;
    errno = ENOSYS;
    return NULL;
}

struct hostent *wasm_gethostbyaddr(const void *addr, socklen_t len, int type)
{
    (void)addr;
    (void)len;
    (void)type;

    WASM_NET_WARN("gethostbyaddr");

    h_errno = NO_RECOVERY;
    errno = ENOSYS;
    return NULL;
}

int wasm_getifaddrs(struct ifaddrs **ifap)
{
    WASM_NET_WARN("getifaddrs");

    if (ifap)
        *ifap = NULL;

    errno = ENOSYS;
    return -1;
}

void wasm_freeifaddrs(struct ifaddrs *ifa)
{
    // No-op since we never allocate anything
    (void)ifa;
}

// ============================================================================
// Miscellaneous
// ============================================================================

int wasm_shutdown(int sockfd, int how)
{
    (void)sockfd;
    (void)how;
    WASM_NET_STUB_RETURN("shutdown");
}

int wasm_poll(struct pollfd *fds, nfds_t nfds, int timeout)
{
    (void)fds;
    (void)nfds;
    (void)timeout;
    WASM_NET_STUB_RETURN("poll");
}

// ============================================================================
// Initialization
// ============================================================================

static int wasm_network_stubs_initialized = 0;

void wasm_network_stubs_init(void)
{
    if (wasm_network_stubs_initialized)
        return;

    wasm_network_stubs_initialized = 1;

#ifdef WASM_NETWORK_DEBUG
    fprintf(stderr, "[WASM] Network stubs initialized - socket operations will return ENOSYS\n");
    fprintf(stderr, "[WASM] For HTTP requests, use JavaScript fetch() via Emscripten bindings\n");
#endif
}

// ============================================================================
// Symbol Aliasing
// ============================================================================

/**
 * These weak aliases allow the stubs to be used as drop-in replacements
 * for the standard socket functions. When linked, these will be used
 * instead of the (non-existent) system implementations.
 *
 * Note: Emscripten may provide its own stubs for some of these.
 * The __attribute__((weak)) allows Emscripten's versions to take precedence
 * if they exist and are more appropriate.
 */

#ifndef WASM_NETWORK_NO_ALIASES

// Socket creation and connection
int socket(int domain, int type, int protocol) __attribute__((weak, alias("wasm_socket")));
int socketpair(int domain, int type, int protocol, int sv[2]) __attribute__((weak, alias("wasm_socketpair")));
int bind(int sockfd, const struct sockaddr *addr, socklen_t addrlen) __attribute__((weak, alias("wasm_bind")));
int listen(int sockfd, int backlog) __attribute__((weak, alias("wasm_listen")));
int accept(int sockfd, struct sockaddr *addr, socklen_t *addrlen) __attribute__((weak, alias("wasm_accept")));
int accept4(int sockfd, struct sockaddr *addr, socklen_t *addrlen, int flags) __attribute__((weak, alias("wasm_accept4")));
int connect(int sockfd, const struct sockaddr *addr, socklen_t addrlen) __attribute__((weak, alias("wasm_connect")));

// Data transmission
ssize_t send(int sockfd, const void *buf, size_t len, int flags) __attribute__((weak, alias("wasm_send")));
ssize_t sendto(int sockfd, const void *buf, size_t len, int flags,
               const struct sockaddr *dest_addr, socklen_t addrlen) __attribute__((weak, alias("wasm_sendto")));
ssize_t sendmsg(int sockfd, const struct msghdr *msg, int flags) __attribute__((weak, alias("wasm_sendmsg")));
ssize_t recv(int sockfd, void *buf, size_t len, int flags) __attribute__((weak, alias("wasm_recv")));
ssize_t recvfrom(int sockfd, void *buf, size_t len, int flags,
                 struct sockaddr *src_addr, socklen_t *addrlen) __attribute__((weak, alias("wasm_recvfrom")));
ssize_t recvmsg(int sockfd, struct msghdr *msg, int flags) __attribute__((weak, alias("wasm_recvmsg")));

// Socket options
int getsockopt(int sockfd, int level, int optname,
               void *optval, socklen_t *optlen) __attribute__((weak, alias("wasm_getsockopt")));
int setsockopt(int sockfd, int level, int optname,
               const void *optval, socklen_t optlen) __attribute__((weak, alias("wasm_setsockopt")));
int getsockname(int sockfd, struct sockaddr *addr, socklen_t *addrlen) __attribute__((weak, alias("wasm_getsockname")));
int getpeername(int sockfd, struct sockaddr *addr, socklen_t *addrlen) __attribute__((weak, alias("wasm_getpeername")));

// Network information
int getaddrinfo(const char *node, const char *service,
                const struct addrinfo *hints, struct addrinfo **res) __attribute__((weak, alias("wasm_getaddrinfo")));
void freeaddrinfo(struct addrinfo *res) __attribute__((weak, alias("wasm_freeaddrinfo")));
int getnameinfo(const struct sockaddr *addr, socklen_t addrlen,
                char *host, socklen_t hostlen,
                char *serv, socklen_t servlen, int flags) __attribute__((weak, alias("wasm_getnameinfo")));
struct hostent *gethostbyname(const char *name) __attribute__((weak, alias("wasm_gethostbyname")));
struct hostent *gethostbyaddr(const void *addr, socklen_t len, int type) __attribute__((weak, alias("wasm_gethostbyaddr")));
int getifaddrs(struct ifaddrs **ifap) __attribute__((weak, alias("wasm_getifaddrs")));
void freeifaddrs(struct ifaddrs *ifa) __attribute__((weak, alias("wasm_freeifaddrs")));

// Misc
int shutdown(int sockfd, int how) __attribute__((weak, alias("wasm_shutdown")));
int poll(struct pollfd *fds, nfds_t nfds, int timeout) __attribute__((weak, alias("wasm_poll")));

#endif /* WASM_NETWORK_NO_ALIASES */

#ifdef __cplusplus
}
#endif

#endif /* __EMSCRIPTEN__ */
