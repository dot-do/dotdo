/**
 * chdb_wasm.h - WebAssembly API header for chdb
 *
 * This header declares the public C API for chdb-wasm, enabling SQL queries
 * in WebAssembly environments (browsers, Node.js, Cloudflare Workers, etc.)
 *
 * Usage from JavaScript:
 *   const chdb = await createChDB();
 *   const handle = chdb._chdb_create();
 *   const result = chdb.ccall('chdb_query', 'number', ['string', 'string'], ['SELECT 1', 'CSV']);
 *   // ... process result ...
 *   chdb._chdb_destroy(handle);
 *
 * Required symbols for WASM export:
 *   - chdb_query
 *   - chdb_query_v2
 *   - chdb_create
 *   - chdb_destroy
 *   - chdb_get_version
 *   - chdb_get_memory_stats
 *   - chdb_clear_cache
 *   - chdb_embedded_server_initialized
 */

#ifndef CHDB_WASM_H
#define CHDB_WASM_H

#ifdef __cplusplus
#include <cstddef>
#include <cstdint>
extern "C" {
#else
#include <stddef.h>
#include <stdint.h>
#endif

/* Export macro for WASM visibility */
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define CHDB_WASM_API EMSCRIPTEN_KEEPALIVE __attribute__((visibility("default")))
#elif defined(CHDB_WASM)
#define CHDB_WASM_API __attribute__((visibility("default")))
#else
#define CHDB_WASM_API
#endif

/* ============================================================================
 * Opaque Types
 * ============================================================================ */

/**
 * Opaque result handle returned by query functions.
 * Use chdb_wasm_result_* functions to access data.
 */
typedef struct chdb_wasm_result chdb_wasm_result;

/* ============================================================================
 * Core API Functions
 * ============================================================================ */

/**
 * Initialize the chdb-wasm engine.
 * Must be called before any query functions.
 * Thread-safe for single-threaded WASM environment.
 *
 * @return 0 on success, non-zero on error
 */
CHDB_WASM_API int chdb_wasm_init(void);

/**
 * Shutdown the chdb-wasm engine and free all resources.
 * Safe to call even if not initialized.
 */
CHDB_WASM_API void chdb_wasm_shutdown(void);

/**
 * Get the chdb-wasm version string.
 *
 * @return Static version string (do not free)
 */
CHDB_WASM_API const char* chdb_wasm_version(void);

/**
 * Check if chdb-wasm is initialized.
 *
 * @return 1 if initialized, 0 otherwise
 */
CHDB_WASM_API int chdb_wasm_is_initialized(void);

/* ============================================================================
 * Query Execution
 * ============================================================================ */

/**
 * Execute a SQL query.
 *
 * @param query   Null-terminated SQL query string
 * @param format  Output format: "CSV", "JSON", "TSV", "Pretty", etc.
 * @return Result handle (must be freed with chdb_wasm_result_free)
 */
CHDB_WASM_API chdb_wasm_result* chdb_wasm_query(const char* query, const char* format);

/**
 * Execute a SQL query with explicit string lengths (binary-safe).
 *
 * @param query       SQL query buffer (may contain null bytes)
 * @param query_len   Length of query in bytes
 * @param format      Output format buffer
 * @param format_len  Length of format string in bytes
 * @return Result handle (must be freed with chdb_wasm_result_free)
 */
CHDB_WASM_API chdb_wasm_result* chdb_wasm_query_n(
    const char* query, size_t query_len,
    const char* format, size_t format_len);

/* ============================================================================
 * Result Accessors
 * ============================================================================ */

/**
 * Create an empty result object.
 * @return New result handle
 */
CHDB_WASM_API chdb_wasm_result* chdb_wasm_result_create(void);

/**
 * Free a result object.
 * @param result Result handle to free
 */
CHDB_WASM_API void chdb_wasm_result_free(chdb_wasm_result* result);

/**
 * Get the result data buffer.
 * @param result Result handle
 * @return Pointer to result data (valid until result is freed)
 */
CHDB_WASM_API const char* chdb_wasm_result_buffer(chdb_wasm_result* result);

/**
 * Get the length of result data.
 * @param result Result handle
 * @return Length in bytes
 */
CHDB_WASM_API size_t chdb_wasm_result_length(chdb_wasm_result* result);

/**
 * Get query execution time.
 * @param result Result handle
 * @return Elapsed time in seconds
 */
CHDB_WASM_API double chdb_wasm_result_elapsed(chdb_wasm_result* result);

/**
 * Get number of rows read.
 * @param result Result handle
 * @return Row count
 */
CHDB_WASM_API uint64_t chdb_wasm_result_rows_read(chdb_wasm_result* result);

/**
 * Get number of bytes read.
 * @param result Result handle
 * @return Byte count
 */
CHDB_WASM_API uint64_t chdb_wasm_result_bytes_read(chdb_wasm_result* result);

/**
 * Get error message (if any).
 * @param result Result handle
 * @return Error string, or NULL if no error
 */
CHDB_WASM_API const char* chdb_wasm_result_error(chdb_wasm_result* result);

/* ============================================================================
 * Memory Helpers (for JavaScript interop)
 * ============================================================================ */

/**
 * Allocate memory in WASM heap.
 * @param size Number of bytes to allocate
 * @return Pointer to allocated memory
 */
CHDB_WASM_API void* chdb_wasm_malloc(size_t size);

/**
 * Free memory in WASM heap.
 * @param ptr Pointer to memory to free
 */
CHDB_WASM_API void chdb_wasm_free(void* ptr);

/* ============================================================================
 * Standard chdb API Compatibility
 * These match the native chdb Python/C API for compatibility.
 * ============================================================================ */

/**
 * Execute a SQL query (chdb Python API compatible).
 */
CHDB_WASM_API chdb_wasm_result* chdb_query(const char* query, const char* format);

/**
 * Execute a SQL query v2 (chdb Python API compatible).
 */
CHDB_WASM_API chdb_wasm_result* chdb_query_v2(const char* query, const char* format);

/**
 * Create/initialize chdb connection.
 * @return Handle value (1 on success, 0 on failure)
 */
CHDB_WASM_API intptr_t chdb_create(void);

/**
 * Destroy chdb connection.
 * @param handle Connection handle from chdb_create
 */
CHDB_WASM_API void chdb_destroy(intptr_t handle);

/**
 * Get chdb version string.
 * @return Static version string
 */
CHDB_WASM_API const char* chdb_get_version(void);

/**
 * Get memory statistics as JSON.
 * @return JSON string with memory info
 */
CHDB_WASM_API const char* chdb_get_memory_stats(void);

/**
 * Clear internal caches.
 * @return 0 on success
 */
CHDB_WASM_API int chdb_clear_cache(void);

/* ============================================================================
 * Global State
 * ============================================================================ */

/**
 * Flag indicating whether the embedded server is initialized.
 * Used by various chdb components.
 */
extern CHDB_WASM_API int chdb_embedded_server_initialized;

#ifdef __cplusplus
}
#endif

#endif /* CHDB_WASM_H */
