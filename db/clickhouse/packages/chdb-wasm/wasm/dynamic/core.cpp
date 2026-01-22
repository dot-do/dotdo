/**
 * core.cpp - MAIN_MODULE for Emscripten Dynamic Linking POC
 *
 * This is the main module that provides:
 * - System library functions (malloc, free, printf, etc.)
 * - Shared memory space
 * - Function table for indirect calls
 * - Registry for dynamically loaded extensions
 *
 * Build with: emcc core.cpp -sMAIN_MODULE=2 -sEXPORTED_FUNCTIONS=[...] -o core.js
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

// Maximum number of extensions that can be loaded
#define MAX_EXTENSIONS 16

// Extension registry structure
struct Extension {
    const char* name;
    void* handle;
    bool loaded;
};

static Extension extensions[MAX_EXTENSIONS];
static int extension_count = 0;

// Shared state that extensions can access
struct SharedState {
    int version;
    size_t total_memory_used;
    int query_count;
    char last_error[256];
};

static SharedState shared_state = {
    .version = 1,
    .total_memory_used = 0,
    .query_count = 0,
    .last_error = ""
};

// ============================================================================
// Core Functions (exported and available to extensions)
// ============================================================================

extern "C" {

/**
 * Get the core module version
 */
EMSCRIPTEN_KEEPALIVE
int core_get_version() {
    return shared_state.version;
}

/**
 * Allocate memory (wrapper for malloc, available to extensions)
 */
EMSCRIPTEN_KEEPALIVE
void* core_alloc(size_t size) {
    void* ptr = malloc(size);
    if (ptr) {
        shared_state.total_memory_used += size;
    }
    return ptr;
}

/**
 * Free memory (wrapper for free, available to extensions)
 */
EMSCRIPTEN_KEEPALIVE
void core_free(void* ptr) {
    if (ptr) {
        free(ptr);
        // Note: We can't accurately track deallocation size without additional bookkeeping
    }
}

/**
 * Log a message (demonstrates shared I/O)
 */
EMSCRIPTEN_KEEPALIVE
void core_log(const char* message) {
    printf("[CORE] %s\n", message);
}

/**
 * Set error message (shared state access)
 */
EMSCRIPTEN_KEEPALIVE
void core_set_error(const char* error) {
    strncpy(shared_state.last_error, error, sizeof(shared_state.last_error) - 1);
    shared_state.last_error[sizeof(shared_state.last_error) - 1] = '\0';
}

/**
 * Get last error message
 */
EMSCRIPTEN_KEEPALIVE
const char* core_get_error() {
    return shared_state.last_error;
}

/**
 * Get pointer to shared state (for extensions that need direct access)
 */
EMSCRIPTEN_KEEPALIVE
SharedState* core_get_shared_state() {
    return &shared_state;
}

/**
 * Register an extension (called by JS loader after dlopen)
 */
EMSCRIPTEN_KEEPALIVE
int core_register_extension(const char* name) {
    if (extension_count >= MAX_EXTENSIONS) {
        core_set_error("Maximum extension count reached");
        return -1;
    }

    extensions[extension_count].name = strdup(name);
    extensions[extension_count].loaded = true;
    extensions[extension_count].handle = nullptr; // Will be set by JS
    extension_count++;

    printf("[CORE] Registered extension: %s (total: %d)\n", name, extension_count);
    return extension_count - 1;
}

/**
 * Get number of loaded extensions
 */
EMSCRIPTEN_KEEPALIVE
int core_get_extension_count() {
    return extension_count;
}

/**
 * Increment query counter (shared state mutation)
 */
EMSCRIPTEN_KEEPALIVE
void core_increment_query_count() {
    shared_state.query_count++;
}

/**
 * Get query count
 */
EMSCRIPTEN_KEEPALIVE
int core_get_query_count() {
    return shared_state.query_count;
}

// ============================================================================
// Simple computation functions to verify cross-module calls
// ============================================================================

/**
 * Add two integers (baseline for performance comparison)
 */
EMSCRIPTEN_KEEPALIVE
int core_add(int a, int b) {
    return a + b;
}

/**
 * Multiply two integers
 */
EMSCRIPTEN_KEEPALIVE
int core_multiply(int a, int b) {
    return a * b;
}

/**
 * Process a buffer (for memory sharing tests)
 */
EMSCRIPTEN_KEEPALIVE
int core_process_buffer(const char* buffer, int length) {
    int sum = 0;
    for (int i = 0; i < length; i++) {
        sum += (unsigned char)buffer[i];
    }
    return sum;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the core module
 */
EMSCRIPTEN_KEEPALIVE
int core_init() {
    printf("[CORE] Initializing core module v%d\n", shared_state.version);
    memset(extensions, 0, sizeof(extensions));
    extension_count = 0;
    shared_state.total_memory_used = 0;
    shared_state.query_count = 0;
    shared_state.last_error[0] = '\0';
    return 0;
}

} // extern "C"

/**
 * Main function (required for MAIN_MODULE)
 */
int main() {
    printf("[CORE] Core module loaded\n");
    return 0;
}
