/**
 * chdb_wasm.cpp - WebAssembly API for chdb
 *
 * This file provides WASM bindings for the chdb embedded ClickHouse engine.
 * It exports a C API that can be called from JavaScript through Emscripten.
 *
 * Required symbols for WASM linking:
 *   - chdb_query
 *   - chdb_query_v2
 *   - chdb_create
 *   - chdb_destroy
 *   - chdb_get_version
 *   - chdb_get_memory_stats
 *   - chdb_clear_cache
 *   - chdb_embedded_server_initialized
 *
 * @see include/chdb_wasm.h for the public API header
 */

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <memory>

// Emscripten-specific headers for WASM export
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
// EMSCRIPTEN_KEEPALIVE prevents dead code elimination for exported functions
#define CHDB_WASM_EXPORT extern "C" EMSCRIPTEN_KEEPALIVE __attribute__((visibility("default")))
#define CHDB_WASM_EXPORT_VAR EMSCRIPTEN_KEEPALIVE __attribute__((visibility("default")))
#elif defined(CHDB_WASM)
#define CHDB_WASM_EXPORT extern "C" __attribute__((visibility("default")))
#define CHDB_WASM_EXPORT_VAR __attribute__((visibility("default")))
#else
#define CHDB_WASM_EXPORT extern "C"
#define CHDB_WASM_EXPORT_VAR
#endif

// Forward declarations - will be filled in as we add more functionality
namespace DB
{
    class Lexer;
    class ParserQuery;
}

// ============================================================================
// Result Structure
// ============================================================================

struct chdb_wasm_result {
    char* buffer;
    size_t length;
    double elapsed;
    uint64_t rows_read;
    uint64_t bytes_read;
    char* error_message;

    chdb_wasm_result()
        : buffer(nullptr)
        , length(0)
        , elapsed(0.0)
        , rows_read(0)
        , bytes_read(0)
        , error_message(nullptr)
    {}

    ~chdb_wasm_result() {
        if (buffer) free(buffer);
        if (error_message) free(error_message);
    }

    void set_error(const char* msg) {
        if (error_message) free(error_message);
        error_message = strdup(msg);
    }

    void set_buffer(const char* data, size_t len) {
        if (buffer) free(buffer);
        buffer = (char*)malloc(len + 1);
        if (buffer) {
            memcpy(buffer, data, len);
            buffer[len] = '\0';
            length = len;
        }
    }
};

// ============================================================================
// Connection Structure
// ============================================================================

struct chdb_wasm_connection {
    bool initialized;
    std::string data_path;  // Path to data directory (memory or filesystem)

    chdb_wasm_connection() : initialized(false), data_path(":memory:") {}
};

// Global connection (WASM is single-threaded, single-instance)
static chdb_wasm_connection* g_connection = nullptr;

// ============================================================================
// WASM Exported Functions
// ============================================================================

/**
 * Get the chdb-wasm version string
 */
CHDB_WASM_EXPORT
const char* chdb_wasm_version() {
    return "chdb-wasm 0.1.0 (ClickHouse 25.8)";
}

/**
 * Initialize chdb-wasm
 * @return 0 on success, non-zero on error
 */
CHDB_WASM_EXPORT
int chdb_wasm_init() {
    if (g_connection) {
        return 0;  // Already initialized
    }

    g_connection = new chdb_wasm_connection();
    g_connection->initialized = true;

    return 0;
}

/**
 * Shutdown chdb-wasm and free resources
 */
CHDB_WASM_EXPORT
void chdb_wasm_shutdown() {
    if (g_connection) {
        delete g_connection;
        g_connection = nullptr;
    }
}

/**
 * Create a new result object
 * @return Pointer to result structure
 */
CHDB_WASM_EXPORT
chdb_wasm_result* chdb_wasm_result_create() {
    return new chdb_wasm_result();
}

/**
 * Free a result object
 * @param result Pointer to result structure
 */
CHDB_WASM_EXPORT
void chdb_wasm_result_free(chdb_wasm_result* result) {
    if (result) {
        delete result;
    }
}

/**
 * Get the result buffer
 * @param result Pointer to result structure
 * @return Pointer to result data buffer
 */
CHDB_WASM_EXPORT
const char* chdb_wasm_result_buffer(chdb_wasm_result* result) {
    return result ? result->buffer : nullptr;
}

/**
 * Get the result buffer length
 * @param result Pointer to result structure
 * @return Length of result data
 */
CHDB_WASM_EXPORT
size_t chdb_wasm_result_length(chdb_wasm_result* result) {
    return result ? result->length : 0;
}

/**
 * Get the query elapsed time
 * @param result Pointer to result structure
 * @return Elapsed time in seconds
 */
CHDB_WASM_EXPORT
double chdb_wasm_result_elapsed(chdb_wasm_result* result) {
    return result ? result->elapsed : 0.0;
}

/**
 * Get the number of rows read
 * @param result Pointer to result structure
 * @return Number of rows read
 */
CHDB_WASM_EXPORT
uint64_t chdb_wasm_result_rows_read(chdb_wasm_result* result) {
    return result ? result->rows_read : 0;
}

/**
 * Get the number of bytes read
 * @param result Pointer to result structure
 * @return Number of bytes read
 */
CHDB_WASM_EXPORT
uint64_t chdb_wasm_result_bytes_read(chdb_wasm_result* result) {
    return result ? result->bytes_read : 0;
}

/**
 * Get the error message (if any)
 * @param result Pointer to result structure
 * @return Error message string or NULL if no error
 */
CHDB_WASM_EXPORT
const char* chdb_wasm_result_error(chdb_wasm_result* result) {
    return result ? result->error_message : nullptr;
}

/**
 * Execute a SQL query
 * @param query SQL query string
 * @param format Output format (CSV, JSON, TSV, etc.)
 * @return Pointer to result structure
 */
CHDB_WASM_EXPORT
chdb_wasm_result* chdb_wasm_query(const char* query, const char* format) {
    auto* result = new chdb_wasm_result();

    // Check if initialized
    if (!g_connection || !g_connection->initialized) {
        result->set_error("chdb-wasm not initialized. Call chdb_wasm_init() first.");
        return result;
    }

    if (!query) {
        result->set_error("Query is NULL");
        return result;
    }

    // For now, return a placeholder response
    // TODO: Implement actual query execution when full chdb is built
    std::string response = "chdb-wasm query execution not yet implemented.\n";
    response += "Query: ";
    response += query;
    response += "\n";
    response += "Format: ";
    response += format ? format : "default";
    response += "\n";

    result->set_buffer(response.c_str(), response.length());
    result->rows_read = 0;
    result->bytes_read = 0;
    result->elapsed = 0.001;

    return result;
}

/**
 * Execute a SQL query with length parameters (binary-safe)
 * @param query SQL query string
 * @param query_len Length of query string
 * @param format Output format
 * @param format_len Length of format string
 * @return Pointer to result structure
 */
CHDB_WASM_EXPORT
chdb_wasm_result* chdb_wasm_query_n(
    const char* query, size_t query_len,
    const char* format, size_t format_len)
{
    // Create null-terminated copies
    std::string query_str(query, query_len);
    std::string format_str = format ? std::string(format, format_len) : "CSV";

    return chdb_wasm_query(query_str.c_str(), format_str.c_str());
}

/**
 * Check if chdb-wasm is initialized
 * @return 1 if initialized, 0 otherwise
 */
CHDB_WASM_EXPORT
int chdb_wasm_is_initialized() {
    return (g_connection && g_connection->initialized) ? 1 : 0;
}

// ============================================================================
// Memory Management Helpers
// ============================================================================

/**
 * Allocate memory (for JavaScript to use)
 * @param size Number of bytes to allocate
 * @return Pointer to allocated memory
 */
CHDB_WASM_EXPORT
void* chdb_wasm_malloc(size_t size) {
    return malloc(size);
}

/**
 * Free memory (for JavaScript to use)
 * @param ptr Pointer to memory to free
 */
CHDB_WASM_EXPORT
void chdb_wasm_free(void* ptr) {
    free(ptr);
}

// ============================================================================
// Standard chdb API Aliases (for compatibility with chdb Python API)
// ============================================================================

/**
 * chdb_query - Execute a SQL query (matches Python chdb API)
 * @param query SQL query string
 * @param format Output format
 * @return Pointer to result structure
 */
CHDB_WASM_EXPORT
chdb_wasm_result* chdb_query(const char* query, const char* format) {
    return chdb_wasm_query(query, format);
}

/**
 * chdb_query_v2 - Execute a SQL query with extended options
 * @param query SQL query string
 * @param format Output format
 * @return Pointer to result structure
 */
CHDB_WASM_EXPORT
chdb_wasm_result* chdb_query_v2(const char* query, const char* format) {
    return chdb_wasm_query(query, format);
}

/**
 * chdb_create - Create/initialize chdb connection
 * @return Handle to connection (currently unused, returns 1 on success)
 */
CHDB_WASM_EXPORT
intptr_t chdb_create() {
    int result = chdb_wasm_init();
    return result == 0 ? 1 : 0;  // Return handle-like value
}

/**
 * chdb_destroy - Destroy chdb connection
 * @param handle Connection handle (currently unused)
 */
CHDB_WASM_EXPORT
void chdb_destroy(intptr_t handle) {
    (void)handle;  // Unused in current implementation
    chdb_wasm_shutdown();
}

/**
 * chdb_get_version - Get chdb version string
 * @return Version string
 */
CHDB_WASM_EXPORT
const char* chdb_get_version() {
    return chdb_wasm_version();
}

/**
 * chdb_get_memory_stats - Get memory statistics
 * @return JSON string with memory stats
 */
CHDB_WASM_EXPORT
const char* chdb_get_memory_stats() {
    // Return a simple JSON with current memory info
    // In WASM, we can't easily get detailed memory stats
    static char buffer[256];
    snprintf(buffer, sizeof(buffer),
        "{\"heap_used\": 0, \"heap_total\": 0, \"wasm\": true}");
    return buffer;
}

/**
 * chdb_clear_cache - Clear any internal caches
 * @return 0 on success
 */
CHDB_WASM_EXPORT
int chdb_clear_cache() {
    // No caching implemented yet, just return success
    return 0;
}

// ============================================================================
// Global Variables (exported for WASM)
// ============================================================================

/**
 * chdb_embedded_server_initialized - Flag indicating server initialization state
 * Expected by various chdb components to check if the embedded server is ready.
 * This is a required symbol for WASM linking.
 */
extern "C" {
CHDB_WASM_EXPORT_VAR
int chdb_embedded_server_initialized = 0;
}
