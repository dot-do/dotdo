/**
 * test_math.cpp - Native Unit Tests for ext-math Side Module
 *
 * These tests verify the math functions work correctly in a native build
 * before compiling to WASM. This allows faster iteration during development.
 *
 * Build for native:
 *   cmake -B build/ext-math-test -DBUILD_TESTS=ON wasm/extensions/math
 *   make -C build/ext-math-test
 *   ./build/ext-math-test/test_ext_math_native
 *
 * Note: In native builds, the core functions are stubbed out with
 * simple implementations to allow standalone testing.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <cassert>
#include <cmath>

// ============================================================================
// Stub implementations for core functions (used in native testing)
// ============================================================================

static char g_last_error[1024] = "";
static int g_query_count = 0;

extern "C" {

// Stub: Memory allocation (use system malloc)
void* malloc(size_t size);
void free(void* ptr);

// Stub: Core logging - just print to stdout
void core_log(const char* message) {
    printf("[CORE] %s\n", message);
}

// Stub: Error handling
void core_set_error(const char* error) {
    if (error) {
        strncpy(g_last_error, error, sizeof(g_last_error) - 1);
        g_last_error[sizeof(g_last_error) - 1] = '\0';
        printf("[CORE ERROR] %s\n", error);
    }
}

const char* core_get_error() {
    return g_last_error;
}

// Stub: Core version
int core_get_version() {
    return 1;
}

// Stub: Query count tracking
void core_increment_query_count() {
    g_query_count++;
}

int core_get_query_count() {
    return g_query_count;
}

// Stub: Simple addition
int core_add(int a, int b) {
    return a + b;
}

} // extern "C"

// ============================================================================
// Include the math module functions (forward declarations)
// ============================================================================

extern "C" {
    int ext_math_init();
    const char* ext_math_get_name();
    int ext_math_get_version();
    int ext_math_is_initialized();
    int ext_math_get_computation_count();

    long long ext_math_factorial(int n);
    long long ext_math_fibonacci(int n);
    int ext_math_is_prime(int n);
    int ext_math_gcd(int a, int b);
    double ext_math_sqrt(double x);
    long long ext_math_lcm(int a, int b);
    long long ext_math_power(int base, int exp);
    int ext_math_abs(int n);
    int ext_math_count_primes(int n);
    int ext_math_sum_array(const int* arr, int length);
    int* ext_math_create_sequence(int start, int count);
    void ext_math_free_buffer(void* buffer);
}

// ============================================================================
// Test Macros
// ============================================================================

#define TEST_ASSERT(condition, message) \
    do { \
        if (!(condition)) { \
            printf("FAIL: %s (line %d)\n", message, __LINE__); \
            return 1; \
        } \
    } while (0)

#define TEST_ASSERT_EQ(expected, actual, message) \
    do { \
        auto _expected = (expected); \
        auto _actual = (actual); \
        if (_expected != _actual) { \
            printf("FAIL: %s - expected %lld, got %lld (line %d)\n", \
                   message, (long long)_expected, (long long)_actual, __LINE__); \
            return 1; \
        } \
    } while (0)

#define TEST_ASSERT_NEAR(expected, actual, epsilon, message) \
    do { \
        double _expected = (expected); \
        double _actual = (actual); \
        double _diff = _expected - _actual; \
        if (_diff < 0) _diff = -_diff; \
        if (_diff > (epsilon)) { \
            printf("FAIL: %s - expected %.10f, got %.10f (line %d)\n", \
                   message, _expected, _actual, __LINE__); \
            return 1; \
        } \
    } while (0)

#define RUN_TEST(test_fn) \
    do { \
        printf("Running %s...\n", #test_fn); \
        int result = test_fn(); \
        if (result != 0) { \
            printf("  FAILED\n"); \
            failed++; \
        } else { \
            printf("  PASSED\n"); \
            passed++; \
        } \
    } while (0)

// ============================================================================
// Test Cases
// ============================================================================

// Test: Initialization
int test_init() {
    int result = ext_math_init();
    TEST_ASSERT_EQ(0, result, "ext_math_init should return 0");
    TEST_ASSERT_EQ(1, ext_math_is_initialized(), "should be initialized");
    return 0;
}

// Test: Metadata
int test_metadata() {
    ext_math_init();

    const char* name = ext_math_get_name();
    TEST_ASSERT(name != nullptr, "name should not be null");
    TEST_ASSERT(strcmp(name, "ext-math") == 0, "name should be 'ext-math'");

    int version = ext_math_get_version();
    TEST_ASSERT_EQ(1, version, "version should be 1");

    return 0;
}

// Test: Factorial base cases
int test_factorial_base_cases() {
    ext_math_init();

    TEST_ASSERT_EQ(1, ext_math_factorial(0), "factorial(0) = 1");
    TEST_ASSERT_EQ(1, ext_math_factorial(1), "factorial(1) = 1");
    TEST_ASSERT_EQ(2, ext_math_factorial(2), "factorial(2) = 2");

    return 0;
}

// Test: Factorial small values
int test_factorial_small() {
    ext_math_init();

    TEST_ASSERT_EQ(6, ext_math_factorial(3), "factorial(3) = 6");
    TEST_ASSERT_EQ(24, ext_math_factorial(4), "factorial(4) = 24");
    TEST_ASSERT_EQ(120, ext_math_factorial(5), "factorial(5) = 120");
    TEST_ASSERT_EQ(720, ext_math_factorial(6), "factorial(6) = 720");
    TEST_ASSERT_EQ(5040, ext_math_factorial(7), "factorial(7) = 5040");

    return 0;
}

// Test: Factorial larger values
int test_factorial_large() {
    ext_math_init();

    TEST_ASSERT_EQ(3628800, ext_math_factorial(10), "factorial(10) = 3628800");
    TEST_ASSERT_EQ(479001600, ext_math_factorial(12), "factorial(12) = 479001600");
    TEST_ASSERT_EQ(2432902008176640000LL, ext_math_factorial(20), "factorial(20)");

    return 0;
}

// Test: Factorial error cases
int test_factorial_errors() {
    ext_math_init();

    TEST_ASSERT_EQ(-1, ext_math_factorial(-1), "factorial(-1) should fail");
    TEST_ASSERT_EQ(-1, ext_math_factorial(-10), "factorial(-10) should fail");
    TEST_ASSERT_EQ(-1, ext_math_factorial(21), "factorial(21) should fail (overflow)");

    return 0;
}

// Test: Fibonacci base cases
int test_fibonacci_base_cases() {
    ext_math_init();

    TEST_ASSERT_EQ(0, ext_math_fibonacci(0), "fib(0) = 0");
    TEST_ASSERT_EQ(1, ext_math_fibonacci(1), "fib(1) = 1");
    TEST_ASSERT_EQ(1, ext_math_fibonacci(2), "fib(2) = 1");

    return 0;
}

// Test: Fibonacci sequence
int test_fibonacci_sequence() {
    ext_math_init();

    // First 20 Fibonacci numbers: 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144...
    TEST_ASSERT_EQ(2, ext_math_fibonacci(3), "fib(3) = 2");
    TEST_ASSERT_EQ(5, ext_math_fibonacci(5), "fib(5) = 5");
    TEST_ASSERT_EQ(8, ext_math_fibonacci(6), "fib(6) = 8");
    TEST_ASSERT_EQ(55, ext_math_fibonacci(10), "fib(10) = 55");
    TEST_ASSERT_EQ(6765, ext_math_fibonacci(20), "fib(20) = 6765");

    return 0;
}

// Test: Fibonacci error cases
int test_fibonacci_errors() {
    ext_math_init();

    TEST_ASSERT_EQ(-1, ext_math_fibonacci(-1), "fib(-1) should fail");
    TEST_ASSERT_EQ(-1, ext_math_fibonacci(93), "fib(93) should fail (overflow)");

    return 0;
}

// Test: Is prime for small primes
int test_is_prime_small() {
    ext_math_init();

    // Non-primes
    TEST_ASSERT_EQ(0, ext_math_is_prime(0), "0 is not prime");
    TEST_ASSERT_EQ(0, ext_math_is_prime(1), "1 is not prime");
    TEST_ASSERT_EQ(0, ext_math_is_prime(4), "4 is not prime");
    TEST_ASSERT_EQ(0, ext_math_is_prime(6), "6 is not prime");

    // Primes
    TEST_ASSERT_EQ(1, ext_math_is_prime(2), "2 is prime");
    TEST_ASSERT_EQ(1, ext_math_is_prime(3), "3 is prime");
    TEST_ASSERT_EQ(1, ext_math_is_prime(5), "5 is prime");
    TEST_ASSERT_EQ(1, ext_math_is_prime(7), "7 is prime");
    TEST_ASSERT_EQ(1, ext_math_is_prime(11), "11 is prime");

    return 0;
}

// Test: Is prime for larger numbers
int test_is_prime_large() {
    ext_math_init();

    TEST_ASSERT_EQ(1, ext_math_is_prime(97), "97 is prime");
    TEST_ASSERT_EQ(1, ext_math_is_prime(101), "101 is prime");
    TEST_ASSERT_EQ(0, ext_math_is_prime(100), "100 is not prime");
    TEST_ASSERT_EQ(0, ext_math_is_prime(121), "121 is not prime (11*11)");

    return 0;
}

// Test: GCD basic cases
int test_gcd_basic() {
    ext_math_init();

    TEST_ASSERT_EQ(6, ext_math_gcd(48, 18), "gcd(48, 18) = 6");
    TEST_ASSERT_EQ(25, ext_math_gcd(100, 25), "gcd(100, 25) = 25");
    TEST_ASSERT_EQ(1, ext_math_gcd(7, 13), "gcd(7, 13) = 1 (coprime)");

    return 0;
}

// Test: GCD edge cases
int test_gcd_edge_cases() {
    ext_math_init();

    TEST_ASSERT_EQ(15, ext_math_gcd(0, 15), "gcd(0, 15) = 15");
    TEST_ASSERT_EQ(15, ext_math_gcd(15, 0), "gcd(15, 0) = 15");
    TEST_ASSERT_EQ(5, ext_math_gcd(-10, 15), "gcd(-10, 15) = 5");
    TEST_ASSERT_EQ(5, ext_math_gcd(10, -15), "gcd(10, -15) = 5");

    return 0;
}

// Test: Square root
int test_sqrt() {
    ext_math_init();

    TEST_ASSERT_NEAR(2.0, ext_math_sqrt(4.0), 0.001, "sqrt(4) ~ 2");
    TEST_ASSERT_NEAR(3.0, ext_math_sqrt(9.0), 0.001, "sqrt(9) ~ 3");
    TEST_ASSERT_NEAR(1.41421356, ext_math_sqrt(2.0), 0.0001, "sqrt(2) ~ 1.414");
    TEST_ASSERT_NEAR(0.0, ext_math_sqrt(0.0), 0.001, "sqrt(0) = 0");
    TEST_ASSERT_NEAR(1.0, ext_math_sqrt(1.0), 0.001, "sqrt(1) = 1");

    return 0;
}

// Test: Square root negative input
int test_sqrt_negative() {
    ext_math_init();

    double result = ext_math_sqrt(-4.0);
    TEST_ASSERT(result < 0, "sqrt(-4) should return -1");

    return 0;
}

// Test: LCM
int test_lcm() {
    ext_math_init();

    TEST_ASSERT_EQ(12, ext_math_lcm(4, 6), "lcm(4, 6) = 12");
    TEST_ASSERT_EQ(15, ext_math_lcm(3, 5), "lcm(3, 5) = 15");
    TEST_ASSERT_EQ(0, ext_math_lcm(0, 5), "lcm(0, 5) = 0");

    return 0;
}

// Test: Power
int test_power() {
    ext_math_init();

    TEST_ASSERT_EQ(1, ext_math_power(5, 0), "5^0 = 1");
    TEST_ASSERT_EQ(5, ext_math_power(5, 1), "5^1 = 5");
    TEST_ASSERT_EQ(25, ext_math_power(5, 2), "5^2 = 25");
    TEST_ASSERT_EQ(125, ext_math_power(5, 3), "5^3 = 125");
    TEST_ASSERT_EQ(1024, ext_math_power(2, 10), "2^10 = 1024");

    return 0;
}

// Test: Power negative exponent
int test_power_negative_exp() {
    ext_math_init();

    TEST_ASSERT_EQ(-1, ext_math_power(2, -1), "2^-1 should fail");

    return 0;
}

// Test: Absolute value
int test_abs() {
    ext_math_init();

    TEST_ASSERT_EQ(5, ext_math_abs(5), "abs(5) = 5");
    TEST_ASSERT_EQ(5, ext_math_abs(-5), "abs(-5) = 5");
    TEST_ASSERT_EQ(0, ext_math_abs(0), "abs(0) = 0");

    return 0;
}

// Test: Count primes
int test_count_primes() {
    ext_math_init();

    TEST_ASSERT_EQ(0, ext_math_count_primes(1), "count_primes(1) = 0");
    TEST_ASSERT_EQ(1, ext_math_count_primes(2), "count_primes(2) = 1");
    TEST_ASSERT_EQ(4, ext_math_count_primes(10), "count_primes(10) = 4");
    TEST_ASSERT_EQ(25, ext_math_count_primes(100), "count_primes(100) = 25");

    return 0;
}

// Test: Sum array
int test_sum_array() {
    ext_math_init();

    int arr1[] = {1, 2, 3, 4, 5};
    TEST_ASSERT_EQ(15, ext_math_sum_array(arr1, 5), "sum([1,2,3,4,5]) = 15");

    int arr2[] = {10, -5, 3};
    TEST_ASSERT_EQ(8, ext_math_sum_array(arr2, 3), "sum([10,-5,3]) = 8");

    TEST_ASSERT_EQ(0, ext_math_sum_array(nullptr, 5), "sum(null) = 0");
    TEST_ASSERT_EQ(0, ext_math_sum_array(arr1, 0), "sum(arr, 0) = 0");

    return 0;
}

// Test: Create and free sequence
int test_create_sequence() {
    ext_math_init();

    int* seq = ext_math_create_sequence(5, 3);
    TEST_ASSERT(seq != nullptr, "sequence should be allocated");
    TEST_ASSERT_EQ(5, seq[0], "seq[0] = 5");
    TEST_ASSERT_EQ(6, seq[1], "seq[1] = 6");
    TEST_ASSERT_EQ(7, seq[2], "seq[2] = 7");

    ext_math_free_buffer(seq);

    // Test error case
    int* bad_seq = ext_math_create_sequence(0, 0);
    TEST_ASSERT(bad_seq == nullptr, "zero-length sequence should fail");

    return 0;
}

// Test: Computation count tracking
int test_computation_count() {
    // Re-initialize to reset count
    // Note: In the real module, we can't easily reset, so we just check it increments
    ext_math_init();

    int initial_count = ext_math_get_computation_count();

    ext_math_factorial(5);
    ext_math_fibonacci(5);
    ext_math_is_prime(7);

    int final_count = ext_math_get_computation_count();

    TEST_ASSERT(final_count > initial_count, "computation count should increase");

    return 0;
}

// ============================================================================
// Main Test Runner
// ============================================================================

int main() {
    printf("\n");
    printf("================================================================\n");
    printf("  ext-math Native Unit Tests\n");
    printf("================================================================\n");
    printf("\n");

    int passed = 0;
    int failed = 0;

    // Initialization tests
    RUN_TEST(test_init);
    RUN_TEST(test_metadata);

    // Factorial tests
    RUN_TEST(test_factorial_base_cases);
    RUN_TEST(test_factorial_small);
    RUN_TEST(test_factorial_large);
    RUN_TEST(test_factorial_errors);

    // Fibonacci tests
    RUN_TEST(test_fibonacci_base_cases);
    RUN_TEST(test_fibonacci_sequence);
    RUN_TEST(test_fibonacci_errors);

    // Prime tests
    RUN_TEST(test_is_prime_small);
    RUN_TEST(test_is_prime_large);

    // GCD tests
    RUN_TEST(test_gcd_basic);
    RUN_TEST(test_gcd_edge_cases);

    // Sqrt tests
    RUN_TEST(test_sqrt);
    RUN_TEST(test_sqrt_negative);

    // LCM tests
    RUN_TEST(test_lcm);

    // Power tests
    RUN_TEST(test_power);
    RUN_TEST(test_power_negative_exp);

    // Abs tests
    RUN_TEST(test_abs);

    // Count primes tests
    RUN_TEST(test_count_primes);

    // Array tests
    RUN_TEST(test_sum_array);
    RUN_TEST(test_create_sequence);

    // Tracking tests
    RUN_TEST(test_computation_count);

    // Summary
    printf("\n");
    printf("================================================================\n");
    printf("  Results: %d passed, %d failed\n", passed, failed);
    printf("================================================================\n");
    printf("\n");

    return failed > 0 ? 1 : 0;
}
