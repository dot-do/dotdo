/**
 * math.cpp - SIDE_MODULE Math Extension for Emscripten Dynamic Linking
 *
 * This is a sample side module extension that demonstrates the dynamic loading
 * architecture. It provides mathematical functions that can be loaded at runtime
 * via dlopen() and shares memory with the core MAIN_MODULE.
 *
 * The extension:
 * - Does NOT include system libraries (gets them from MAIN_MODULE)
 * - Imports core functions (malloc, free, core_log, etc.)
 * - Exports its own math functions callable from JS
 * - Shares memory with the core module
 *
 * Build with:
 *   emcmake cmake -B build/ext-math wasm/extensions/math
 *   emmake make -C build/ext-math
 *
 * Output: ext-math.wasm
 */

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
// For native testing, define EMSCRIPTEN_KEEPALIVE as empty
#define EMSCRIPTEN_KEEPALIVE
#endif

#include <stddef.h>

// ============================================================================
// Forward declarations for core module functions
// These are imported from the MAIN_MODULE at link time
// ============================================================================

extern "C" {
    // Memory management from core
    void* malloc(size_t size);
    void free(void* ptr);

    // Core module wrappers (for logging and error handling)
    void core_log(const char* message);
    void core_set_error(const char* error);
    int core_get_version();
    void core_increment_query_count();

    // Utility functions from core (for cross-module call demonstration)
    int core_add(int a, int b);
}

// ============================================================================
// Extension State
// ============================================================================

static int g_initialized = 0;
static int g_computation_count = 0;

// Extension name constant
static const char* EXT_MATH_NAME = "ext-math";
static const int EXT_MATH_VERSION = 1;

// ============================================================================
// Extension Initialization and Metadata
// ============================================================================

extern "C" {

/**
 * Initialize the math extension.
 * Verifies core module compatibility and sets up extension state.
 *
 * @return 0 on success, -1 on failure
 */
EMSCRIPTEN_KEEPALIVE
int ext_math_init() {
    if (g_initialized) {
        core_log("ext-math: Already initialized");
        return 0;
    }

    // Check core module version
    int core_version = core_get_version();
    if (core_version < 1) {
        core_set_error("ext-math requires core module version >= 1");
        return -1;
    }

    // Initialize state
    g_initialized = 1;
    g_computation_count = 0;

    core_log("ext-math: Initialized successfully");
    return 0;
}

/**
 * Get the extension name.
 *
 * @return Pointer to the extension name string
 */
EMSCRIPTEN_KEEPALIVE
const char* ext_math_get_name() {
    return EXT_MATH_NAME;
}

/**
 * Get the extension version.
 *
 * @return Version number
 */
EMSCRIPTEN_KEEPALIVE
int ext_math_get_version() {
    return EXT_MATH_VERSION;
}

/**
 * Check if the extension is initialized.
 *
 * @return 1 if initialized, 0 otherwise
 */
EMSCRIPTEN_KEEPALIVE
int ext_math_is_initialized() {
    return g_initialized;
}

/**
 * Get the count of computations performed.
 *
 * @return Number of math operations performed since initialization
 */
EMSCRIPTEN_KEEPALIVE
int ext_math_get_computation_count() {
    return g_computation_count;
}

// ============================================================================
// Math Functions
// ============================================================================

/**
 * Compute the factorial of n.
 *
 * factorial(0) = 1
 * factorial(n) = n * factorial(n-1)
 *
 * @param n Non-negative integer (0-20 for 64-bit range)
 * @return n! on success, -1 for negative input or overflow
 */
EMSCRIPTEN_KEEPALIVE
long long ext_math_factorial(int n) {
    g_computation_count++;
    core_increment_query_count();

    // Handle invalid input
    if (n < 0) {
        core_set_error("ext_math_factorial: negative input");
        return -1;
    }

    // Prevent overflow (20! = 2,432,902,008,176,640,000 fits in int64)
    if (n > 20) {
        core_set_error("ext_math_factorial: overflow (n > 20)");
        return -1;
    }

    // Base cases
    if (n == 0 || n == 1) {
        return 1;
    }

    // Iterative factorial
    long long result = 1;
    for (int i = 2; i <= n; i++) {
        result *= i;
    }

    return result;
}

/**
 * Compute the n-th Fibonacci number.
 *
 * fib(0) = 0
 * fib(1) = 1
 * fib(n) = fib(n-1) + fib(n-2)
 *
 * @param n Non-negative integer (0-92 for 64-bit range)
 * @return F(n) on success, -1 for negative input or overflow
 */
EMSCRIPTEN_KEEPALIVE
long long ext_math_fibonacci(int n) {
    g_computation_count++;
    core_increment_query_count();

    // Handle invalid input
    if (n < 0) {
        core_set_error("ext_math_fibonacci: negative input");
        return -1;
    }

    // Prevent overflow (fib(92) = 7,540,113,804,746,346,429 fits in int64)
    if (n > 92) {
        core_set_error("ext_math_fibonacci: overflow (n > 92)");
        return -1;
    }

    // Base cases
    if (n == 0) return 0;
    if (n == 1) return 1;

    // Iterative Fibonacci (O(n) time, O(1) space)
    long long prev2 = 0;
    long long prev1 = 1;
    long long current = 0;

    for (int i = 2; i <= n; i++) {
        current = prev1 + prev2;
        prev2 = prev1;
        prev1 = current;
    }

    return current;
}

/**
 * Check if a number is prime.
 *
 * @param n Integer to check
 * @return 1 if prime, 0 if not prime
 */
EMSCRIPTEN_KEEPALIVE
int ext_math_is_prime(int n) {
    g_computation_count++;
    core_increment_query_count();

    // Handle special cases
    if (n < 2) return 0;
    if (n == 2) return 1;
    if (n % 2 == 0) return 0;

    // Check odd divisors up to sqrt(n)
    for (int i = 3; i * i <= n; i += 2) {
        if (n % i == 0) return 0;
    }

    return 1;
}

/**
 * Compute the greatest common divisor of two integers.
 * Uses the Euclidean algorithm.
 *
 * @param a First integer
 * @param b Second integer
 * @return GCD(a, b)
 */
EMSCRIPTEN_KEEPALIVE
int ext_math_gcd(int a, int b) {
    g_computation_count++;
    core_increment_query_count();

    // Handle negative inputs
    if (a < 0) a = -a;
    if (b < 0) b = -b;

    // Handle zero cases
    if (a == 0) return b;
    if (b == 0) return a;

    // Euclidean algorithm
    while (b != 0) {
        int temp = b;
        b = a % b;
        a = temp;
    }

    return a;
}

/**
 * Compute the square root of a number using Newton's method.
 *
 * @param x Non-negative number
 * @return Approximate square root of x, -1 for negative input
 */
EMSCRIPTEN_KEEPALIVE
double ext_math_sqrt(double x) {
    g_computation_count++;
    core_increment_query_count();

    // Handle invalid input
    if (x < 0) {
        core_set_error("ext_math_sqrt: negative input");
        return -1.0;
    }

    // Handle zero
    if (x == 0.0) return 0.0;

    // Handle one
    if (x == 1.0) return 1.0;

    // Newton's method: x_{n+1} = (x_n + S/x_n) / 2
    double guess = x / 2.0;
    double epsilon = 1e-10;

    for (int i = 0; i < 100; i++) {
        double next_guess = (guess + x / guess) / 2.0;
        double diff = next_guess - guess;
        if (diff < 0) diff = -diff;
        if (diff < epsilon) {
            return next_guess;
        }
        guess = next_guess;
    }

    return guess;
}

/**
 * Compute the least common multiple of two integers.
 *
 * @param a First integer
 * @param b Second integer
 * @return LCM(a, b), or 0 if either input is 0
 */
EMSCRIPTEN_KEEPALIVE
long long ext_math_lcm(int a, int b) {
    g_computation_count++;
    core_increment_query_count();

    if (a == 0 || b == 0) return 0;

    // LCM(a, b) = |a * b| / GCD(a, b)
    int gcd = ext_math_gcd(a, b);
    g_computation_count--; // Don't double-count the GCD call

    // Use long long to avoid overflow
    long long result = ((long long)a / gcd) * (long long)b;
    if (result < 0) result = -result;

    return result;
}

/**
 * Compute the power of a number (a^b).
 *
 * @param base Base value
 * @param exp Non-negative exponent
 * @return base^exp, -1 for negative exponent
 */
EMSCRIPTEN_KEEPALIVE
long long ext_math_power(int base, int exp) {
    g_computation_count++;
    core_increment_query_count();

    if (exp < 0) {
        core_set_error("ext_math_power: negative exponent not supported");
        return -1;
    }

    if (exp == 0) return 1;
    if (base == 0) return 0;
    if (base == 1) return 1;

    // Binary exponentiation for efficiency
    long long result = 1;
    long long b = base;

    while (exp > 0) {
        if (exp & 1) {
            result *= b;
        }
        b *= b;
        exp >>= 1;
    }

    return result;
}

/**
 * Compute the absolute value of an integer.
 *
 * @param n Integer
 * @return |n|
 */
EMSCRIPTEN_KEEPALIVE
int ext_math_abs(int n) {
    g_computation_count++;
    return n < 0 ? -n : n;
}

/**
 * Count prime numbers up to n (for performance testing).
 *
 * @param n Upper bound
 * @return Number of primes <= n
 */
EMSCRIPTEN_KEEPALIVE
int ext_math_count_primes(int n) {
    g_computation_count++;
    core_increment_query_count();

    if (n < 2) return 0;

    int count = 0;
    for (int i = 2; i <= n; i++) {
        // Call our own is_prime but don't double-count
        g_computation_count--;
        if (ext_math_is_prime(i)) {
            count++;
        }
    }

    return count;
}

/**
 * Sum an array of integers.
 * Demonstrates shared memory access between core and extension.
 *
 * @param arr Pointer to array of integers (in shared memory)
 * @param length Number of elements
 * @return Sum of array elements
 */
EMSCRIPTEN_KEEPALIVE
int ext_math_sum_array(const int* arr, int length) {
    g_computation_count++;
    core_increment_query_count();

    if (!arr || length <= 0) {
        core_set_error("ext_math_sum_array: invalid input");
        return 0;
    }

    int sum = 0;
    for (int i = 0; i < length; i++) {
        // Use core_add to demonstrate cross-module function calls
        sum = core_add(sum, arr[i]);
    }

    return sum;
}

/**
 * Create a sequence of integers (demonstrates memory allocation via core).
 *
 * @param start Starting value
 * @param count Number of elements
 * @return Pointer to allocated array, or nullptr on failure
 */
EMSCRIPTEN_KEEPALIVE
int* ext_math_create_sequence(int start, int count) {
    g_computation_count++;
    core_increment_query_count();

    if (count <= 0 || count > 10000) {
        core_set_error("ext_math_create_sequence: invalid count");
        return nullptr;
    }

    // Allocate memory via core module
    int* buffer = (int*)malloc(count * sizeof(int));
    if (!buffer) {
        core_set_error("ext_math_create_sequence: allocation failed");
        return nullptr;
    }

    for (int i = 0; i < count; i++) {
        buffer[i] = start + i;
    }

    return buffer;
}

/**
 * Free a buffer allocated by ext_math_create_sequence.
 *
 * @param buffer Pointer to buffer to free
 */
EMSCRIPTEN_KEEPALIVE
void ext_math_free_buffer(void* buffer) {
    if (buffer) {
        free(buffer);
    }
}

} // extern "C"
