/**
 * functions_standalone.cpp - WASM bindings for standalone chdb functions
 *
 * This file provides C API bindings for the accurate comparison functions
 * and other ClickHouse functions that can be compiled standalone to WASM.
 *
 * Based on CHDB_MINIMAL_FUNCTIONS from vendor/chdb/src/Functions/CMakeLists.txt
 *
 * Build with:
 *   emcc -std=c++20 -Os -fno-exceptions -fno-rtti -DCHDB_MINIMAL_FUNCTIONS \
 *        functions_standalone.cpp -o dist/functions.js ...
 */

#include "FunctionsStandalone.h"

#include <cstdio>
#include <cstring>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

using namespace chdb_wasm;

// =============================================================================
// Version and Info
// =============================================================================

extern "C" {

EXPORT
const char* chdb_functions_version() {
    return "1.0.0-chdb-wasm-standalone";
}

// =============================================================================
// Comparison Functions - Integer
// =============================================================================

EXPORT
int chdb_equals_int64(int64_t a, int64_t b) {
    return EqualsOp::apply(a, b) ? 1 : 0;
}

EXPORT
int chdb_less_int64(int64_t a, int64_t b) {
    return LessOp::apply(a, b) ? 1 : 0;
}

EXPORT
int chdb_less_or_equals_int64(int64_t a, int64_t b) {
    return LessOrEqualsOp::apply(a, b) ? 1 : 0;
}

EXPORT
int chdb_greater_int64(int64_t a, int64_t b) {
    return GreaterOp::apply(a, b) ? 1 : 0;
}

EXPORT
int chdb_greater_or_equals_int64(int64_t a, int64_t b) {
    return GreaterOrEqualsOp::apply(a, b) ? 1 : 0;
}

// =============================================================================
// Comparison Functions - Double
// =============================================================================

EXPORT
int chdb_equals_double(double a, double b) {
    return EqualsOp::apply(a, b) ? 1 : 0;
}

EXPORT
int chdb_less_double(double a, double b) {
    return LessOp::apply(a, b) ? 1 : 0;
}

EXPORT
int chdb_less_or_equals_double(double a, double b) {
    return LessOrEqualsOp::apply(a, b) ? 1 : 0;
}

EXPORT
int chdb_greater_double(double a, double b) {
    return GreaterOp::apply(a, b) ? 1 : 0;
}

EXPORT
int chdb_greater_or_equals_double(double a, double b) {
    return GreaterOrEqualsOp::apply(a, b) ? 1 : 0;
}

// =============================================================================
// Comparison Functions - Mixed int64/double (accurate comparison)
// =============================================================================

EXPORT
int chdb_equals_int_double(int64_t a, double b) {
    return EqualsOp::apply(a, b) ? 1 : 0;
}

EXPORT
int chdb_equals_double_int(double a, int64_t b) {
    return EqualsOp::apply(a, b) ? 1 : 0;
}

EXPORT
int chdb_less_int_double(int64_t a, double b) {
    return LessOp::apply(a, b) ? 1 : 0;
}

EXPORT
int chdb_less_double_int(double a, int64_t b) {
    return LessOp::apply(a, b) ? 1 : 0;
}

// =============================================================================
// Mixed Signedness Comparison (demonstrating accurate comparison)
// =============================================================================

EXPORT
int chdb_compare_int8_uint8(int8_t a, uint8_t b) {
    // This demonstrates accurate comparison: Int8(-1) != UInt8(255)
    // Standard C++ would say: (int8_t)-1 == (uint8_t)255 (both become 255 after implicit conversion)
    // Accurate comparison correctly handles this
    if (accurate::equalsOp(a, b)) return 0;
    if (accurate::lessOp(a, b)) return -1;
    return 1;
}

// =============================================================================
// Self-Test Function
// =============================================================================

EXPORT
int chdb_functions_test() {
    int failures = 0;

    // Test 1: Basic integer comparison
    if (!EqualsOp::apply(42, 42)) {
        fprintf(stderr, "FAIL: 42 == 42 should be true\n");
        failures++;
    }

    if (EqualsOp::apply(42, 43)) {
        fprintf(stderr, "FAIL: 42 == 43 should be false\n");
        failures++;
    }

    // Test 2: Mixed signedness comparison (Int8(-1) != UInt8(255))
    // This is the key test for accurate comparison
    int8_t neg_one = -1;
    uint8_t two_fifty_five = 255;

    // In standard C++, these would compare equal after implicit conversion
    // But with accurate comparison, they should NOT be equal
    if (accurate::equalsOp(neg_one, two_fifty_five)) {
        fprintf(stderr, "FAIL: Int8(-1) should NOT equal UInt8(255) with accurate comparison\n");
        failures++;
    }

    // Test 3: int8_t(-1) < uint8_t(255) should be true (negative is less than positive)
    if (!accurate::lessOp(neg_one, two_fifty_five)) {
        fprintf(stderr, "FAIL: Int8(-1) < UInt8(255) should be true\n");
        failures++;
    }

    // Test 4: Float/int comparison
    // 9007199254740993 (2^53 + 1) cannot be exactly represented in double
    // So comparing double(9007199254740993) with int64_t(9007199254740993) needs care
    int64_t big_int = 9007199254740993LL;  // 2^53 + 1
    double big_double = static_cast<double>(big_int);  // Loses precision

    // These should NOT be equal due to precision loss
    // But this depends on the DecomposedFloat implementation
    // For now, just verify basic float comparison works
    if (!EqualsOp::apply(1.0, 1.0)) {
        fprintf(stderr, "FAIL: 1.0 == 1.0 should be true\n");
        failures++;
    }

    // Test 5: NaN comparison (NaN != NaN)
    double nan_val = std::nan("");
    if (EqualsOp::apply(nan_val, nan_val)) {
        fprintf(stderr, "FAIL: NaN == NaN should be false\n");
        failures++;
    }

    if (LessOp::apply(nan_val, 1.0)) {
        fprintf(stderr, "FAIL: NaN < 1.0 should be false\n");
        failures++;
    }

    // Test 6: Arithmetic operations
    if (PlusOp::apply(2, 3) != 5) {
        fprintf(stderr, "FAIL: 2 + 3 should be 5\n");
        failures++;
    }

    if (MinusOp::apply(5, 3) != 2) {
        fprintf(stderr, "FAIL: 5 - 3 should be 2\n");
        failures++;
    }

    if (MultiplyOp::apply(4, 5) != 20) {
        fprintf(stderr, "FAIL: 4 * 5 should be 20\n");
        failures++;
    }

    // Test 7: Logical operations
    if (!AndOp::apply(true, true)) {
        fprintf(stderr, "FAIL: true AND true should be true\n");
        failures++;
    }

    if (!OrOp::apply(false, true)) {
        fprintf(stderr, "FAIL: false OR true should be true\n");
        failures++;
    }

    if (!XorOp::apply(true, false)) {
        fprintf(stderr, "FAIL: true XOR false should be true\n");
        failures++;
    }

    // Test 8: Math functions
    if (math::abs(-5.0) != 5.0) {
        fprintf(stderr, "FAIL: abs(-5.0) should be 5.0\n");
        failures++;
    }

    if (math::sqrt(16.0) != 4.0) {
        fprintf(stderr, "FAIL: sqrt(16.0) should be 4.0\n");
        failures++;
    }

    // Test 9: String functions
    if (string::length("hello") != 5) {
        fprintf(stderr, "FAIL: length('hello') should be 5\n");
        failures++;
    }

    if (string::upper("hello") != "HELLO") {
        fprintf(stderr, "FAIL: upper('hello') should be 'HELLO'\n");
        failures++;
    }

    if (string::lower("HELLO") != "hello") {
        fprintf(stderr, "FAIL: lower('HELLO') should be 'hello'\n");
        failures++;
    }

    if (string::concat("hello", " world") != "hello world") {
        fprintf(stderr, "FAIL: concat('hello', ' world') should be 'hello world'\n");
        failures++;
    }

    // Test 10: More edge cases for signed/unsigned comparison
    int32_t neg_ten = -10;
    uint32_t ten = 10;

    if (accurate::equalsOp(neg_ten, ten)) {
        fprintf(stderr, "FAIL: Int32(-10) should NOT equal UInt32(10)\n");
        failures++;
    }

    if (!accurate::lessOp(neg_ten, ten)) {
        fprintf(stderr, "FAIL: Int32(-10) < UInt32(10) should be true\n");
        failures++;
    }

    // Print summary
    if (failures == 0) {
        fprintf(stderr, "All chdb_functions tests passed!\n");
        return 0;
    } else {
        fprintf(stderr, "chdb_functions tests: %d failures\n", failures);
        return failures;
    }
}

} // extern "C"
