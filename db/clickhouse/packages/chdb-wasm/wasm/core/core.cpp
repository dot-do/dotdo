/**
 * core.cpp - MAIN_MODULE Implementation for Emscripten Dynamic Linking
 *
 * This is the core module that provides:
 * - System library functions (malloc, free) wrappers for side modules
 * - Shared memory space
 * - Function table for indirect calls
 * - Registry for dynamically loaded extensions
 * - Error handling and logging
 * - Query tracking
 *
 * Build with:
 *   emcmake cmake -B build/core wasm/core
 *   emmake make -C build/core
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
// For native testing, define EMSCRIPTEN_KEEPALIVE as empty
#define EMSCRIPTEN_KEEPALIVE
#endif

#include "exports.h"

// ============================================================================
// Internal Constants
// ============================================================================

#define ERROR_BUFFER_SIZE 1024
#define MAX_EXTENSION_NAME_LENGTH 128

// ============================================================================
// Extension Registry Structure
// ============================================================================

struct Extension {
    char name[MAX_EXTENSION_NAME_LENGTH];
    int (*init_fn)(void);
    bool registered;
};

// ============================================================================
// Shared State
// ============================================================================

static struct {
    int version;
    int query_count;
    int extension_count;
    char last_error[ERROR_BUFFER_SIZE];
    Extension extensions[MAX_EXTENSIONS];
    bool initialized;
} g_state = {
    .version = 1,
    .query_count = 0,
    .extension_count = 0,
    .last_error = "",
    .extensions = {},
    .initialized = false
};

// ============================================================================
// Core Initialization and Version
// ============================================================================

extern "C" {

EMSCRIPTEN_KEEPALIVE
int core_init(void) {
    // Reset all state
    g_state.version = 1;
    g_state.query_count = 0;
    g_state.extension_count = 0;
    g_state.last_error[0] = '\0';
    g_state.initialized = true;

    // Clear extension registry
    for (int i = 0; i < MAX_EXTENSIONS; i++) {
        g_state.extensions[i].name[0] = '\0';
        g_state.extensions[i].init_fn = nullptr;
        g_state.extensions[i].registered = false;
    }

    printf("[CORE] Initialized core module v%d\n", g_state.version);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int core_get_version(void) {
    return g_state.version;
}

// ============================================================================
// Memory Management
// ============================================================================

EMSCRIPTEN_KEEPALIVE
void* core_alloc(size_t size) {
    return malloc(size);
}

EMSCRIPTEN_KEEPALIVE
void core_free(void* ptr) {
    free(ptr);
}

// ============================================================================
// Logging and Error Handling
// ============================================================================

EMSCRIPTEN_KEEPALIVE
void core_log(const char* message) {
    if (message) {
        printf("[CORE] %s\n", message);
    }
}

EMSCRIPTEN_KEEPALIVE
void core_set_error(const char* error) {
    if (error) {
        strncpy(g_state.last_error, error, ERROR_BUFFER_SIZE - 1);
        g_state.last_error[ERROR_BUFFER_SIZE - 1] = '\0';
    } else {
        g_state.last_error[0] = '\0';
    }
}

EMSCRIPTEN_KEEPALIVE
const char* core_get_error(void) {
    return g_state.last_error;
}

// ============================================================================
// Extension Registry
// ============================================================================

EMSCRIPTEN_KEEPALIVE
int core_register_extension(const char* name) {
    if (!name) {
        core_set_error("Extension name cannot be null");
        return -1;
    }

    if (g_state.extension_count >= MAX_EXTENSIONS) {
        core_set_error("Maximum extension count reached");
        return -1;
    }

    int index = g_state.extension_count;
    strncpy(g_state.extensions[index].name, name, MAX_EXTENSION_NAME_LENGTH - 1);
    g_state.extensions[index].name[MAX_EXTENSION_NAME_LENGTH - 1] = '\0';
    g_state.extensions[index].init_fn = nullptr;
    g_state.extensions[index].registered = true;
    g_state.extension_count++;

    printf("[CORE] Registered extension: %s (ID: %d, total: %d)\n",
           name, index, g_state.extension_count);
    return index;
}

EMSCRIPTEN_KEEPALIVE
int core_get_extension_count(void) {
    return g_state.extension_count;
}

EMSCRIPTEN_KEEPALIVE
int extension_register(const char* name, int (*init_fn)(void)) {
    if (!name) {
        core_set_error("Extension name cannot be null");
        return -1;
    }

    if (g_state.extension_count >= MAX_EXTENSIONS) {
        core_set_error("Maximum extension count reached");
        return -1;
    }

    int index = g_state.extension_count;
    strncpy(g_state.extensions[index].name, name, MAX_EXTENSION_NAME_LENGTH - 1);
    g_state.extensions[index].name[MAX_EXTENSION_NAME_LENGTH - 1] = '\0';
    g_state.extensions[index].init_fn = init_fn;
    g_state.extensions[index].registered = true;
    g_state.extension_count++;

    printf("[CORE] Registered extension with init: %s (ID: %d)\n", name, index);
    return index;
}

EMSCRIPTEN_KEEPALIVE
int extension_call(const char* ext_name, const char* func_name, void* args) {
    (void)func_name; // Unused in basic implementation
    (void)args;      // Unused in basic implementation

    if (!ext_name) {
        core_set_error("Extension name cannot be null");
        return -1;
    }

    // Find the extension by name
    for (int i = 0; i < g_state.extension_count; i++) {
        if (g_state.extensions[i].registered &&
            strcmp(g_state.extensions[i].name, ext_name) == 0) {
            // Found the extension - in a full implementation we would
            // look up the function by name and call it
            printf("[CORE] Extension call: %s.%s\n", ext_name, func_name ? func_name : "(null)");
            return 0;
        }
    }

    core_set_error("Extension not found");
    return -1;
}

// ============================================================================
// Query Tracking
// ============================================================================

EMSCRIPTEN_KEEPALIVE
void core_increment_query_count(void) {
    g_state.query_count++;
}

EMSCRIPTEN_KEEPALIVE
int core_get_query_count(void) {
    return g_state.query_count;
}

// ============================================================================
// Utility Functions
// ============================================================================

EMSCRIPTEN_KEEPALIVE
int core_add(int a, int b) {
    return a + b;
}

EMSCRIPTEN_KEEPALIVE
int core_multiply(int a, int b) {
    return a * b;
}

EMSCRIPTEN_KEEPALIVE
int core_process_buffer(const char* buffer, int length) {
    if (!buffer || length <= 0) {
        return 0;
    }

    int sum = 0;
    for (int i = 0; i < length; i++) {
        sum += (unsigned char)buffer[i];
    }
    return sum;
}

} // extern "C"

// ============================================================================
// Main Function (required for MAIN_MODULE, excluded in test builds)
// ============================================================================

#ifndef TEST_BUILD
int main() {
    printf("[CORE] Core module loaded\n");
    return 0;
}
#endif
