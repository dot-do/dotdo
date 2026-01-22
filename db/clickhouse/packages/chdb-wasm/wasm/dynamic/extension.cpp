/**
 * extension.cpp - SIDE_MODULE for Emscripten Dynamic Linking POC
 *
 * This is an example extension module that:
 * - Does NOT include system libraries (gets them from MAIN_MODULE)
 * - Can call functions exported by the core module
 * - Can share memory with the core module
 * - Exports its own functions callable from JS or core
 *
 * Build with: emcc extension.cpp -sSIDE_MODULE=2 -o extension.wasm
 */

#include <emscripten.h>

// Forward declarations for core module functions
// These will be resolved at link time from the MAIN_MODULE
extern "C" {
    // Core functions we'll import from main module
    void core_log(const char* message);
    void* core_alloc(size_t size);
    void core_free(void* ptr);
    void core_set_error(const char* error);
    int core_get_version();
    void core_increment_query_count();
    int core_add(int a, int b);
}

// ============================================================================
// Extension-specific state
// ============================================================================

static int extension_initialized = 0;
static int computation_count = 0;

// ============================================================================
// Extension Functions (exported)
// ============================================================================

extern "C" {

/**
 * Initialize the extension
 * Demonstrates calling core functions from side module
 */
EMSCRIPTEN_KEEPALIVE
int extension_init() {
    if (extension_initialized) {
        core_log("Extension already initialized");
        return 0;
    }

    core_log("Initializing math extension...");

    int core_version = core_get_version();
    if (core_version < 1) {
        core_set_error("Extension requires core version >= 1");
        return -1;
    }

    extension_initialized = 1;
    computation_count = 0;

    core_log("Math extension initialized successfully");
    return 0;
}

/**
 * Get extension name
 */
EMSCRIPTEN_KEEPALIVE
const char* extension_get_name() {
    return "math_extension";
}

/**
 * Get extension version
 */
EMSCRIPTEN_KEEPALIVE
int extension_get_version() {
    return 1;
}

/**
 * Check if extension is initialized
 */
EMSCRIPTEN_KEEPALIVE
int extension_is_initialized() {
    return extension_initialized;
}

// ============================================================================
// Math Functions (the actual extension functionality)
// ============================================================================

/**
 * Compute factorial
 */
EMSCRIPTEN_KEEPALIVE
long long extension_factorial(int n) {
    computation_count++;
    core_increment_query_count();

    if (n < 0) {
        core_set_error("Factorial: negative input");
        return -1;
    }
    if (n > 20) {
        core_set_error("Factorial: overflow (n > 20)");
        return -1;
    }

    long long result = 1;
    for (int i = 2; i <= n; i++) {
        result *= i;
    }
    return result;
}

/**
 * Compute fibonacci
 */
EMSCRIPTEN_KEEPALIVE
long long extension_fibonacci(int n) {
    computation_count++;
    core_increment_query_count();

    if (n < 0) {
        core_set_error("Fibonacci: negative input");
        return -1;
    }
    if (n > 92) {
        core_set_error("Fibonacci: overflow (n > 92)");
        return -1;
    }

    if (n <= 1) return n;

    long long a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        long long temp = a + b;
        a = b;
        b = temp;
    }
    return b;
}

/**
 * Compute power (a^b) using core_add for demonstration
 * Shows cross-module function calls
 */
EMSCRIPTEN_KEEPALIVE
long long extension_power(int base, int exp) {
    computation_count++;
    core_increment_query_count();

    if (exp < 0) {
        core_set_error("Power: negative exponent not supported");
        return -1;
    }

    long long result = 1;
    for (int i = 0; i < exp; i++) {
        result *= base;
    }
    return result;
}

/**
 * Sum an array (demonstrates shared memory access)
 * The buffer is allocated by JS or core and passed to extension
 */
EMSCRIPTEN_KEEPALIVE
int extension_sum_array(const int* arr, int length) {
    computation_count++;
    core_increment_query_count();

    if (!arr || length <= 0) {
        core_set_error("Sum array: invalid input");
        return 0;
    }

    int sum = 0;
    for (int i = 0; i < length; i++) {
        sum = core_add(sum, arr[i]); // Use core function to demonstrate cross-module call
    }
    return sum;
}

/**
 * Allocate and fill a buffer (demonstrates memory allocation through core)
 */
EMSCRIPTEN_KEEPALIVE
int* extension_create_sequence(int start, int count) {
    computation_count++;
    core_increment_query_count();

    if (count <= 0 || count > 10000) {
        core_set_error("Create sequence: invalid count");
        return nullptr;
    }

    // Use core module's allocator
    int* buffer = (int*)core_alloc(count * sizeof(int));
    if (!buffer) {
        core_set_error("Create sequence: allocation failed");
        return nullptr;
    }

    for (int i = 0; i < count; i++) {
        buffer[i] = start + i;
    }

    return buffer;
}

/**
 * Free a buffer allocated by extension
 */
EMSCRIPTEN_KEEPALIVE
void extension_free_buffer(void* buffer) {
    if (buffer) {
        core_free(buffer);
    }
}

/**
 * Get computation count (extension-local state)
 */
EMSCRIPTEN_KEEPALIVE
int extension_get_computation_count() {
    return computation_count;
}

/**
 * Prime check (a more complex computation for benchmarking)
 */
EMSCRIPTEN_KEEPALIVE
int extension_is_prime(int n) {
    computation_count++;
    core_increment_query_count();

    if (n < 2) return 0;
    if (n == 2) return 1;
    if (n % 2 == 0) return 0;

    for (int i = 3; i * i <= n; i += 2) {
        if (n % i == 0) return 0;
    }
    return 1;
}

/**
 * Count primes up to n (for performance testing)
 */
EMSCRIPTEN_KEEPALIVE
int extension_count_primes(int n) {
    computation_count++;
    core_increment_query_count();

    int count = 0;
    for (int i = 2; i <= n; i++) {
        if (extension_is_prime(i)) {
            count++;
        }
    }
    return count;
}

} // extern "C"
