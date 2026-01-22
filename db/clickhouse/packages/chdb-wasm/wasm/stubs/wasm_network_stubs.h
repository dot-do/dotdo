/**
 * wasm_network_stubs.h - Network/Socket Stub Header for WASM
 *
 * WASM cannot perform raw socket operations. This header declares stub
 * functions that replace the standard socket API with implementations
 * that return appropriate error codes (ENOSYS, ENOTSUP).
 *
 * RATIONALE
 * =========
 *
 * WebAssembly runs in a sandboxed environment without direct access to:
 * - Raw sockets (TCP, UDP)
 * - Network interfaces
 * - Low-level I/O operations
 *
 * Instead of failing at link time or crashing at runtime, these stubs
 * provide clean error handling that allows the application to gracefully
 * handle the lack of network support.
 *
 * STUBBED FUNCTIONS
 * =================
 *
 * Socket creation and configuration:
 * - socket()      - Create a socket
 * - socketpair()  - Create a pair of connected sockets
 * - bind()        - Bind socket to address
 * - listen()      - Listen for connections
 * - accept()      - Accept a connection
 * - accept4()     - Accept with flags
 * - connect()     - Connect to a remote address
 *
 * Data transmission:
 * - send()        - Send data on connected socket
 * - sendto()      - Send data to specific address
 * - sendmsg()     - Send message with headers
 * - recv()        - Receive data from socket
 * - recvfrom()    - Receive data with source address
 * - recvmsg()     - Receive message with headers
 *
 * Socket options:
 * - getsockopt()  - Get socket options
 * - setsockopt()  - Set socket options
 * - getsockname() - Get local socket address
 * - getpeername() - Get remote socket address
 *
 * Network information:
 * - getaddrinfo()     - Address resolution
 * - freeaddrinfo()    - Free address info
 * - getnameinfo()     - Name resolution
 * - gethostbyname()   - Host lookup by name (deprecated)
 * - gethostbyaddr()   - Host lookup by address (deprecated)
 * - getifaddrs()      - Get interface addresses
 * - freeifaddrs()     - Free interface addresses
 *
 * Misc:
 * - shutdown()    - Shutdown socket
 * - poll()        - Poll multiple file descriptors (network-related)
 * - select()      - Select on file descriptors (network-related)
 *
 * ERROR CODES
 * ===========
 *
 * All stubbed functions set errno appropriately:
 * - ENOSYS:   Function not implemented
 * - ENOTSUP:  Operation not supported
 * - EAFNOSUPPORT: Address family not supported
 *
 * USAGE
 * =====
 *
 * 1. Include this header in WASM builds
 * 2. Link wasm_network_stubs.cpp
 * 3. The linker will resolve socket calls to these stubs
 *
 * ALTERNATIVES FOR NETWORKING
 * ===========================
 *
 * In browser contexts, use JavaScript interop:
 * - fetch() API for HTTP requests
 * - WebSocket for bidirectional communication
 * - WebRTC for peer-to-peer connections
 *
 * These can be exposed to WASM via Emscripten's JavaScript binding.
 */

#ifndef CLICKHOUSE_WASM_NETWORK_STUBS_H
#define CLICKHOUSE_WASM_NETWORK_STUBS_H

#ifdef __EMSCRIPTEN__

#include <sys/types.h>
#include <sys/socket.h>
#include <netdb.h>
#include <poll.h>

#ifdef __cplusplus
extern "C" {
#endif

// ============================================================================
// Socket Creation and Connection
// ============================================================================

/**
 * Create a socket - stub returns -1 with ENOSYS
 */
int wasm_socket(int domain, int type, int protocol);

/**
 * Create a pair of connected sockets - stub returns -1 with ENOSYS
 */
int wasm_socketpair(int domain, int type, int protocol, int sv[2]);

/**
 * Bind socket to address - stub returns -1 with ENOSYS
 */
int wasm_bind(int sockfd, const struct sockaddr *addr, socklen_t addrlen);

/**
 * Listen for connections - stub returns -1 with ENOSYS
 */
int wasm_listen(int sockfd, int backlog);

/**
 * Accept a connection - stub returns -1 with ENOSYS
 */
int wasm_accept(int sockfd, struct sockaddr *addr, socklen_t *addrlen);

/**
 * Accept with flags - stub returns -1 with ENOSYS
 */
int wasm_accept4(int sockfd, struct sockaddr *addr, socklen_t *addrlen, int flags);

/**
 * Connect to remote address - stub returns -1 with ENOSYS
 */
int wasm_connect(int sockfd, const struct sockaddr *addr, socklen_t addrlen);

// ============================================================================
// Data Transmission
// ============================================================================

/**
 * Send data on connected socket - stub returns -1 with ENOSYS
 */
ssize_t wasm_send(int sockfd, const void *buf, size_t len, int flags);

/**
 * Send data to specific address - stub returns -1 with ENOSYS
 */
ssize_t wasm_sendto(int sockfd, const void *buf, size_t len, int flags,
                    const struct sockaddr *dest_addr, socklen_t addrlen);

/**
 * Send message with headers - stub returns -1 with ENOSYS
 */
ssize_t wasm_sendmsg(int sockfd, const struct msghdr *msg, int flags);

/**
 * Receive data from socket - stub returns -1 with ENOSYS
 */
ssize_t wasm_recv(int sockfd, void *buf, size_t len, int flags);

/**
 * Receive data with source address - stub returns -1 with ENOSYS
 */
ssize_t wasm_recvfrom(int sockfd, void *buf, size_t len, int flags,
                      struct sockaddr *src_addr, socklen_t *addrlen);

/**
 * Receive message with headers - stub returns -1 with ENOSYS
 */
ssize_t wasm_recvmsg(int sockfd, struct msghdr *msg, int flags);

// ============================================================================
// Socket Options
// ============================================================================

/**
 * Get socket options - stub returns -1 with ENOSYS
 */
int wasm_getsockopt(int sockfd, int level, int optname,
                    void *optval, socklen_t *optlen);

/**
 * Set socket options - stub returns -1 with ENOSYS
 */
int wasm_setsockopt(int sockfd, int level, int optname,
                    const void *optval, socklen_t optlen);

/**
 * Get local socket address - stub returns -1 with ENOSYS
 */
int wasm_getsockname(int sockfd, struct sockaddr *addr, socklen_t *addrlen);

/**
 * Get remote socket address - stub returns -1 with ENOSYS
 */
int wasm_getpeername(int sockfd, struct sockaddr *addr, socklen_t *addrlen);

// ============================================================================
// Network Information
// ============================================================================

/**
 * Address resolution - stub returns EAI_SYSTEM with ENOSYS
 */
int wasm_getaddrinfo(const char *node, const char *service,
                     const struct addrinfo *hints, struct addrinfo **res);

/**
 * Free address info - stub is a no-op
 */
void wasm_freeaddrinfo(struct addrinfo *res);

/**
 * Name resolution - stub returns EAI_SYSTEM with ENOSYS
 */
int wasm_getnameinfo(const struct sockaddr *addr, socklen_t addrlen,
                     char *host, socklen_t hostlen,
                     char *serv, socklen_t servlen, int flags);

/**
 * Host lookup by name - stub returns NULL with h_errno set
 */
struct hostent *wasm_gethostbyname(const char *name);

/**
 * Host lookup by address - stub returns NULL with h_errno set
 */
struct hostent *wasm_gethostbyaddr(const void *addr, socklen_t len, int type);

/**
 * Get interface addresses - stub returns -1 with ENOSYS
 */
int wasm_getifaddrs(struct ifaddrs **ifap);

/**
 * Free interface addresses - stub is a no-op
 */
void wasm_freeifaddrs(struct ifaddrs *ifa);

// ============================================================================
// Miscellaneous
// ============================================================================

/**
 * Shutdown socket - stub returns -1 with ENOSYS
 */
int wasm_shutdown(int sockfd, int how);

/**
 * Poll file descriptors - stub returns -1 with ENOSYS for socket fds
 */
int wasm_poll(struct pollfd *fds, nfds_t nfds, int timeout);

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize network stubs - call during WASM module startup
 * This logs a warning that network operations are not available
 */
void wasm_network_stubs_init(void);

#ifdef __cplusplus
}
#endif

#endif /* __EMSCRIPTEN__ */

#endif /* CLICKHOUSE_WASM_NETWORK_STUBS_H */
