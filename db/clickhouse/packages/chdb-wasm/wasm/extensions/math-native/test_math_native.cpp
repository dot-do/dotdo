/**
 * test_math_native.cpp - Native tests for ext-math-native
 *
 * Provides stub implementations of core functions for native testing
 * and basic verification of math function correctness.
 *
 * Build and run:
 *   cd wasm/extensions/math-native
 *   ./build.sh test
 */

#include <cstdio>
#include <cmath>
#include <cassert>
#include <cstring>

// ============================================================================
// Stub implementations of core functions (for testing only)
// ============================================================================

extern "C" {
    void core_log(const char* message) {
        printf("[LOG] %s\n", message);
    }

    void core_set_error(const char* error) {
        printf("[ERROR] %s\n", error);
    }

    int core_get_version() {
        return 1;
    }
}

// ============================================================================
// Forward declarations of functions to test
// ============================================================================

extern "C" {
    int ext_math_native_init();
    const char* ext_math_native_get_name();
    int ext_math_native_get_version();
    int ext_math_native_is_initialized();
    int ext_math_native_get_call_count();

    double ch_sin(double x);
    double ch_cos(double x);
    double ch_tan(double x);
    double ch_sqrt(double x);
    double ch_pow(double base, double exp);
    double ch_log(double x);
    double ch_exp(double x);
    double ch_abs(double x);
    double ch_pi();
    double ch_e();
    double ch_sigmoid(double x);
    double ch_degrees(double x);
    double ch_radians(double x);
}

// ============================================================================
// Test Helpers
// ============================================================================

static int tests_passed = 0;
static int tests_failed = 0;

#define TOLERANCE 1e-10

void test_equal(const char* name, double actual, double expected) {
    double diff = std::fabs(actual - expected);
    if (diff < TOLERANCE) {
        tests_passed++;
        printf("  PASS: %s = %.10f\n", name, actual);
    } else {
        tests_failed++;
        printf("  FAIL: %s = %.10f (expected %.10f, diff %.10e)\n",
               name, actual, expected, diff);
    }
}

void test_true(const char* name, bool condition) {
    if (condition) {
        tests_passed++;
        printf("  PASS: %s\n", name);
    } else {
        tests_failed++;
        printf("  FAIL: %s\n", name);
    }
}

// ============================================================================
// Test Cases
// ============================================================================

void test_initialization() {
    printf("\n=== Testing Initialization ===\n");

    int result = ext_math_native_init();
    test_true("init returns 0", result == 0);
    test_true("is_initialized returns 1", ext_math_native_is_initialized() == 1);
    test_true("get_name returns correct name",
              strcmp(ext_math_native_get_name(), "ext-math-native") == 0);
    test_true("get_version returns 1", ext_math_native_get_version() == 1);
}

void test_trig_functions() {
    printf("\n=== Testing Trigonometric Functions ===\n");

    test_equal("sin(0)", ch_sin(0.0), 0.0);
    test_equal("sin(pi/2)", ch_sin(M_PI / 2.0), 1.0);
    test_equal("cos(0)", ch_cos(0.0), 1.0);
    test_equal("cos(pi)", ch_cos(M_PI), -1.0);
    test_equal("tan(0)", ch_tan(0.0), 0.0);
}

void test_exp_log_functions() {
    printf("\n=== Testing Exponential/Logarithmic Functions ===\n");

    test_equal("exp(0)", ch_exp(0.0), 1.0);
    test_equal("exp(1)", ch_exp(1.0), M_E);
    test_equal("log(1)", ch_log(1.0), 0.0);
    test_equal("log(e)", ch_log(M_E), 1.0);
}

void test_power_functions() {
    printf("\n=== Testing Power Functions ===\n");

    test_equal("sqrt(4)", ch_sqrt(4.0), 2.0);
    test_equal("sqrt(16)", ch_sqrt(16.0), 4.0);
    test_equal("pow(2, 3)", ch_pow(2.0, 3.0), 8.0);
    test_equal("pow(10, 2)", ch_pow(10.0, 2.0), 100.0);
}

void test_special_functions() {
    printf("\n=== Testing Special Functions ===\n");

    test_equal("abs(-5)", ch_abs(-5.0), 5.0);
    test_equal("abs(5)", ch_abs(5.0), 5.0);
    test_equal("sigmoid(0)", ch_sigmoid(0.0), 0.5);
    test_equal("degrees(pi)", ch_degrees(M_PI), 180.0);
    test_equal("radians(180)", ch_radians(180.0), M_PI);
}

void test_constants() {
    printf("\n=== Testing Mathematical Constants ===\n");

    test_equal("pi()", ch_pi(), M_PI);
    test_equal("e()", ch_e(), M_E);
}

void test_call_count() {
    printf("\n=== Testing Call Counter ===\n");

    int count = ext_math_native_get_call_count();
    test_true("call count > 0 after tests", count > 0);
    printf("  INFO: Total calls made: %d\n", count);
}

// ============================================================================
// Main
// ============================================================================

int main() {
    printf("==============================================\n");
    printf("  ext-math-native Native Test Suite\n");
    printf("==============================================\n");

    test_initialization();
    test_trig_functions();
    test_exp_log_functions();
    test_power_functions();
    test_special_functions();
    test_constants();
    test_call_count();

    printf("\n==============================================\n");
    printf("  Results: %d passed, %d failed\n", tests_passed, tests_failed);
    printf("==============================================\n");

    return tests_failed > 0 ? 1 : 0;
}
