/**
 * exports.h - Core MAIN_MODULE Function Exports
 *
 * This header declares all functions exported by the core MAIN_MODULE.
 * These functions are available to:
 * - JavaScript (via ccall/cwrap)
 * - Side modules (SIDE_MODULE) that link against the core
 *
 * The core module provides:
 * - System library wrappers (malloc, free)
 * - VFS (Virtual File System) abstraction
 * - Extension registry for dynamic loading
 * - Error handling and logging
 * - Query tracking
 * - Utility functions for testing
 */

#ifndef CHDB_CORE_EXPORTS_H
#define CHDB_CORE_EXPORTS_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// ============================================================================
// Core Initialization and Version
// ============================================================================

/**
 * Initialize the core module.
 * Resets all state including error messages, query counts, and extension registry.
 * @return 0 on success, non-zero on failure
 */
int core_init(void);

/**
 * Get the core module version number.
 * @return Version number (currently 1)
 */
int core_get_version(void);

// ============================================================================
// Memory Management
// ============================================================================

/**
 * Allocate memory (wrapper for malloc).
 * This function is exported for side modules to use.
 * @param size Number of bytes to allocate
 * @return Pointer to allocated memory, or NULL on failure
 */
void* core_alloc(size_t size);

/**
 * Free memory (wrapper for free).
 * This function is exported for side modules to use.
 * @param ptr Pointer to memory to free (NULL is safe)
 */
void core_free(void* ptr);

// ============================================================================
// Logging and Error Handling
// ============================================================================

/**
 * Log a message to the console.
 * @param message The message to log (null-terminated string)
 */
void core_log(const char* message);

/**
 * Set the last error message.
 * Messages are truncated if they exceed the internal buffer size (1024 bytes).
 * @param error The error message (null-terminated string)
 */
void core_set_error(const char* error);

/**
 * Get the last error message.
 * @return Pointer to the error message buffer (empty string if no error)
 */
const char* core_get_error(void);

// ============================================================================
// Extension Registry
// ============================================================================

/**
 * Maximum number of extensions that can be registered.
 */
#define MAX_EXTENSIONS 16

/**
 * Register an extension by name.
 * @param name Extension name (will be copied internally)
 * @return Extension ID (>= 0) on success, -1 on failure (max capacity reached)
 */
int core_register_extension(const char* name);

/**
 * Get the number of registered extensions.
 * @return Number of extensions currently registered
 */
int core_get_extension_count(void);

/**
 * Register an extension with an initialization function.
 * @param name Extension name
 * @param init_fn Pointer to initialization function (signature: int fn(void))
 * @return Extension ID (>= 0) on success, -1 on failure
 */
int extension_register(const char* name, int (*init_fn)(void));

/**
 * Call a function on a registered extension.
 * @param ext_name Extension name
 * @param func_name Function name to call
 * @param args Arguments pointer (extension-specific)
 * @return 0 on success, -1 if extension or function not found
 */
int extension_call(const char* ext_name, const char* func_name, void* args);

// ============================================================================
// Query Tracking
// ============================================================================

/**
 * Increment the query execution counter.
 */
void core_increment_query_count(void);

/**
 * Get the current query execution count.
 * @return Number of queries executed since last core_init()
 */
int core_get_query_count(void);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Add two integers.
 * Simple utility function for testing cross-module calls.
 * @param a First operand
 * @param b Second operand
 * @return Sum of a and b
 */
int core_add(int a, int b);

/**
 * Multiply two integers.
 * Simple utility function for testing cross-module calls.
 * @param a First operand
 * @param b Second operand
 * @return Product of a and b
 */
int core_multiply(int a, int b);

/**
 * Process a buffer by summing its bytes.
 * @param buffer Pointer to buffer data (can be NULL if length is 0)
 * @param length Number of bytes in buffer
 * @return Sum of all bytes (as unsigned values)
 */
int core_process_buffer(const char* buffer, int length);

// ============================================================================
// VFS (Virtual File System) Functions
// ============================================================================

/**
 * Open a virtual file.
 * @param path File path (null-terminated string)
 * @param flags Open flags (O_RDONLY=0, O_WRONLY=1, O_RDWR=2, O_CREAT=0x40)
 * @return File descriptor (>= 0) on success, -1 on failure
 */
int vfs_open(const char* path, int flags);

/**
 * Read from a virtual file.
 * @param fd File descriptor from vfs_open
 * @param buffer Buffer to read data into
 * @param count Maximum number of bytes to read
 * @return Number of bytes actually read, or -1 on error
 */
int vfs_read(int fd, void* buffer, int count);

/**
 * Write to a virtual file.
 * @param fd File descriptor from vfs_open
 * @param buffer Buffer containing data to write
 * @param count Number of bytes to write
 * @return Number of bytes actually written, or -1 on error
 */
int vfs_write(int fd, const void* buffer, int count);

/**
 * Close a virtual file.
 * @param fd File descriptor to close
 * @return 0 on success, -1 on error (invalid fd)
 */
int vfs_close(int fd);

/**
 * Seek within a virtual file.
 * @param fd File descriptor
 * @param offset Offset in bytes
 * @param whence SEEK_SET=0, SEEK_CUR=1, SEEK_END=2
 * @return New position in file, or -1 on error
 */
int vfs_seek(int fd, int offset, int whence);

/**
 * Get the size of a virtual file.
 * @param fd File descriptor
 * @return File size in bytes, or -1 on error
 */
int vfs_size(int fd);

#ifdef __cplusplus
}
#endif

#endif // CHDB_CORE_EXPORTS_H
