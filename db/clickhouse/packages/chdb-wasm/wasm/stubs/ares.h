/**
 * Stub ares.h for WASM builds
 * c-ares DNS library is not available in WASM sandbox
 *
 * This provides type definitions and stub functions to allow compilation
 * but all DNS operations will fail at runtime.
 */
#pragma once

#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netdb.h>

#ifdef __cplusplus
extern "C" {
#endif

// Socket type
typedef int ares_socket_t;
#define ARES_SOCKET_BAD (-1)

// Channel types
typedef struct ares_channeldata* ares_channel;
typedef struct ares_channeldata ares_channel_t;

// Status codes
#define ARES_SUCCESS 0
#define ARES_ENODATA 1
#define ARES_EFORMERR 2
#define ARES_ESERVFAIL 3
#define ARES_ENOTFOUND 4
#define ARES_ENOTIMP 5
#define ARES_EREFUSED 6
#define ARES_EBADQUERY 7
#define ARES_EBADNAME 8
#define ARES_EBADFAMILY 9
#define ARES_EBADRESP 10
#define ARES_ECONNREFUSED 11
#define ARES_ETIMEOUT 12
#define ARES_EOF 13
#define ARES_EFILE 14
#define ARES_ENOMEM 15
#define ARES_EDESTRUCTION 16
#define ARES_EBADSTR 17
#define ARES_EBADFLAGS 18
#define ARES_ENONAME 19
#define ARES_EBADHINTS 20
#define ARES_ENOTINITIALIZED 21
#define ARES_ELOADIPHLPAPI 22
#define ARES_EADDRGETNETWORKPARAMS 23
#define ARES_ECANCELLED 24

// Init flags
#define ARES_LIB_INIT_NONE 0
#define ARES_LIB_INIT_WIN32 (1 << 0)
#define ARES_LIB_INIT_ALL (ARES_LIB_INIT_WIN32)

// Option flags
#define ARES_OPT_FLAGS (1 << 0)
#define ARES_OPT_TIMEOUT (1 << 1)
#define ARES_OPT_TRIES (1 << 2)
#define ARES_OPT_NDOTS (1 << 3)
#define ARES_OPT_UDP_PORT (1 << 4)
#define ARES_OPT_TCP_PORT (1 << 5)
#define ARES_OPT_SERVERS (1 << 6)
#define ARES_OPT_DOMAINS (1 << 7)
#define ARES_OPT_LOOKUPS (1 << 8)
#define ARES_OPT_SOCK_STATE_CB (1 << 9)
#define ARES_OPT_SORTLIST (1 << 10)
#define ARES_OPT_SOCK_SNDBUF (1 << 11)
#define ARES_OPT_SOCK_RCVBUF (1 << 12)
#define ARES_OPT_TIMEOUTMS (1 << 13)
#define ARES_OPT_ROTATE (1 << 14)
#define ARES_OPT_EDNSPSZ (1 << 15)
#define ARES_OPT_NOROTATE (1 << 16)
#define ARES_OPT_RESOLVCONF (1 << 17)

// Socket state callback type
typedef void (*ares_sock_state_cb)(void *data, ares_socket_t socket_fd, int readable, int writable);

// Options structure
struct ares_options {
    int flags;
    int timeout;
    int tries;
    int ndots;
    unsigned short udp_port;
    unsigned short tcp_port;
    int socket_send_buffer_size;
    int socket_receive_buffer_size;
    struct in_addr *servers;
    int nservers;
    char **domains;
    int ndomains;
    char *lookups;
    ares_sock_state_cb sock_state_cb;
    void *sock_state_cb_data;
    struct apattern *sortlist;
    int nsort;
    int ednspsz;
    char *resolvconf_path;
};

// FD events structure
typedef struct {
    ares_socket_t fd;
    unsigned int events;
} ares_fd_events_t;

// Callback types
typedef void (*ares_callback)(void *arg, int status, int timeouts, unsigned char *abuf, int alen);
typedef void (*ares_host_callback)(void *arg, int status, int timeouts, struct hostent *hostent);
typedef void (*ares_nameinfo_callback)(void *arg, int status, int timeouts, char *node, char *service);

// Stub functions - all return error or do nothing
static inline int ares_library_init(int flags) {
    (void)flags;
    return ARES_ENOTINITIALIZED;
}

static inline int ares_library_init_mem(int flags, void *(*amalloc)(size_t), void (*afree)(void *), void *(*arealloc)(void *, size_t)) {
    (void)flags; (void)amalloc; (void)afree; (void)arealloc;
    return ARES_ENOTINITIALIZED;
}

static inline void ares_library_cleanup(void) {}

static inline int ares_init(ares_channel *channelptr) {
    (void)channelptr;
    return ARES_ENOTINITIALIZED;
}

static inline int ares_init_options(ares_channel *channelptr, struct ares_options *options, int optmask) {
    (void)channelptr; (void)options; (void)optmask;
    return ARES_ENOTINITIALIZED;
}

static inline void ares_destroy(ares_channel channel) {
    (void)channel;
}

static inline void ares_cancel(ares_channel channel) {
    (void)channel;
}

static inline const char *ares_strerror(int code) {
    (void)code;
    return "c-ares not available in WASM";
}

static inline void ares_gethostbyaddr(ares_channel channel, const void *addr, int addrlen, int family, ares_host_callback callback, void *arg) {
    (void)channel; (void)addr; (void)addrlen; (void)family;
    if (callback) callback(arg, ARES_ENOTINITIALIZED, 0, NULL);
}

static inline void ares_gethostbyname(ares_channel channel, const char *name, int family, ares_host_callback callback, void *arg) {
    (void)channel; (void)name; (void)family;
    if (callback) callback(arg, ARES_ENOTINITIALIZED, 0, NULL);
}

static inline void ares_process_fd(ares_channel channel, ares_socket_t read_fd, ares_socket_t write_fd) {
    (void)channel; (void)read_fd; (void)write_fd;
}

static inline struct timeval *ares_timeout(ares_channel channel, struct timeval *maxtv, struct timeval *tv) {
    (void)channel; (void)maxtv;
    if (tv) {
        tv->tv_sec = 0;
        tv->tv_usec = 0;
    }
    return tv;
}

static inline int ares_fds(ares_channel channel, fd_set *read_fds, fd_set *write_fds) {
    (void)channel; (void)read_fds; (void)write_fds;
    return 0;
}

static inline int ares_getsock(ares_channel channel, ares_socket_t *socks, int numsocks) {
    (void)channel; (void)socks; (void)numsocks;
    return 0;
}

#ifdef __cplusplus
}
#endif
