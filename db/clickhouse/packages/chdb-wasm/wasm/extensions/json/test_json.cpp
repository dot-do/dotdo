/**
 * test_json.cpp - Native Unit Tests for ext-json Side Module
 *
 * These tests verify the JSON functions work correctly in a native build
 * before compiling to WASM. This allows faster iteration during development.
 *
 * Build for native:
 *   cmake -B build/ext-json-test -DBUILD_TESTS=ON wasm/extensions/json
 *   make -C build/ext-json-test
 *   ./build/ext-json-test/test_ext_json_native
 *
 * Note: In native builds, the core functions are stubbed out with
 * simple implementations to allow standalone testing.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <cassert>
#include <cmath>
#include <cstdint>

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

} // extern "C"

// ============================================================================
// Include the JSON module functions (forward declarations)
// ============================================================================

extern "C" {
    int ext_json_init();
    const char* ext_json_get_name();
    int ext_json_get_version();
    int ext_json_is_initialized();
    int ext_json_get_operation_count();

    char* ext_json_extract(const char* json, const char* path);
    char* ext_json_extract_string(const char* json, const char* path);
    int64_t ext_json_extract_int(const char* json, const char* path);
    double ext_json_extract_float(const char* json, const char* path);

    int ext_json_length(const char* json);
    int ext_json_has(const char* json, const char* path);
    char* ext_json_keys(const char* json);
    char* ext_json_values(const char* json);
    char* ext_json_path(const char* json, const char* path);

    void ext_json_free(char* ptr);
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

#define TEST_ASSERT_STR_EQ(expected, actual, message) \
    do { \
        const char* _expected = (expected); \
        const char* _actual = (actual); \
        if (_actual == nullptr) { \
            printf("FAIL: %s - got nullptr, expected \"%s\" (line %d)\n", \
                   message, _expected, __LINE__); \
            return 1; \
        } \
        if (strcmp(_expected, _actual) != 0) { \
            printf("FAIL: %s - expected \"%s\", got \"%s\" (line %d)\n", \
                   message, _expected, _actual, __LINE__); \
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
    int result = ext_json_init();
    TEST_ASSERT_EQ(0, result, "ext_json_init should return 0");
    TEST_ASSERT_EQ(1, ext_json_is_initialized(), "should be initialized");
    return 0;
}

// Test: Metadata
int test_metadata() {
    ext_json_init();

    const char* name = ext_json_get_name();
    TEST_ASSERT(name != nullptr, "name should not be null");
    TEST_ASSERT(strcmp(name, "ext-json") == 0, "name should be 'ext-json'");

    int version = ext_json_get_version();
    TEST_ASSERT_EQ(1, version, "version should be 1");

    return 0;
}

// Test: Extract simple string
int test_extract_string_simple() {
    ext_json_init();

    const char* json = "{\"name\": \"John\"}";
    char* result = ext_json_extract_string(json, "$.name");
    TEST_ASSERT(result != nullptr, "result should not be null");
    TEST_ASSERT_STR_EQ("John", result, "name should be 'John'");
    ext_json_free(result);

    return 0;
}

// Test: Extract nested string
int test_extract_string_nested() {
    ext_json_init();

    const char* json = "{\"person\": {\"name\": \"Alice\", \"city\": \"NYC\"}}";
    char* result = ext_json_extract_string(json, "$.person.name");
    TEST_ASSERT(result != nullptr, "result should not be null");
    TEST_ASSERT_STR_EQ("Alice", result, "person.name should be 'Alice'");
    ext_json_free(result);

    result = ext_json_extract_string(json, "$.person.city");
    TEST_ASSERT(result != nullptr, "result should not be null");
    TEST_ASSERT_STR_EQ("NYC", result, "person.city should be 'NYC'");
    ext_json_free(result);

    return 0;
}

// Test: Extract integer
int test_extract_int() {
    ext_json_init();

    const char* json = "{\"count\": 42, \"negative\": -17, \"large\": 1000000}";

    TEST_ASSERT_EQ(42, ext_json_extract_int(json, "$.count"), "count should be 42");
    TEST_ASSERT_EQ(-17, ext_json_extract_int(json, "$.negative"), "negative should be -17");
    TEST_ASSERT_EQ(1000000, ext_json_extract_int(json, "$.large"), "large should be 1000000");

    return 0;
}

// Test: Extract float
int test_extract_float() {
    ext_json_init();

    const char* json = "{\"price\": 19.99, \"rate\": 0.05, \"scientific\": 1.5e3}";

    TEST_ASSERT_NEAR(19.99, ext_json_extract_float(json, "$.price"), 0.001, "price should be 19.99");
    TEST_ASSERT_NEAR(0.05, ext_json_extract_float(json, "$.rate"), 0.001, "rate should be 0.05");
    TEST_ASSERT_NEAR(1500.0, ext_json_extract_float(json, "$.scientific"), 0.001, "scientific should be 1500.0");

    return 0;
}

// Test: Extract from array
int test_extract_from_array() {
    ext_json_init();

    const char* json = "{\"items\": [\"apple\", \"banana\", \"cherry\"]}";

    char* result = ext_json_extract_string(json, "$.items[0]");
    TEST_ASSERT(result != nullptr, "result should not be null");
    TEST_ASSERT_STR_EQ("apple", result, "items[0] should be 'apple'");
    ext_json_free(result);

    result = ext_json_extract_string(json, "$.items[2]");
    TEST_ASSERT(result != nullptr, "result should not be null");
    TEST_ASSERT_STR_EQ("cherry", result, "items[2] should be 'cherry'");
    ext_json_free(result);

    return 0;
}

// Test: Extract from nested array
int test_extract_from_nested_array() {
    ext_json_init();

    const char* json = "{\"users\": [{\"name\": \"Alice\", \"age\": 30}, {\"name\": \"Bob\", \"age\": 25}]}";

    char* result = ext_json_extract_string(json, "$.users[0].name");
    TEST_ASSERT(result != nullptr, "result should not be null");
    TEST_ASSERT_STR_EQ("Alice", result, "users[0].name should be 'Alice'");
    ext_json_free(result);

    TEST_ASSERT_EQ(25, ext_json_extract_int(json, "$.users[1].age"), "users[1].age should be 25");

    return 0;
}

// Test: JSON length for array
int test_json_length_array() {
    ext_json_init();

    const char* json1 = "[1, 2, 3, 4, 5]";
    TEST_ASSERT_EQ(5, ext_json_length(json1), "array length should be 5");

    const char* json2 = "[]";
    TEST_ASSERT_EQ(0, ext_json_length(json2), "empty array length should be 0");

    const char* json3 = "[{\"a\": 1}, {\"b\": 2}]";
    TEST_ASSERT_EQ(2, ext_json_length(json3), "array of objects length should be 2");

    return 0;
}

// Test: JSON length for object
int test_json_length_object() {
    ext_json_init();

    const char* json1 = "{\"a\": 1, \"b\": 2, \"c\": 3}";
    TEST_ASSERT_EQ(3, ext_json_length(json1), "object length should be 3");

    const char* json2 = "{}";
    TEST_ASSERT_EQ(0, ext_json_length(json2), "empty object length should be 0");

    return 0;
}

// Test: JSON has
int test_json_has() {
    ext_json_init();

    const char* json = "{\"name\": \"John\", \"address\": {\"city\": \"NYC\"}}";

    TEST_ASSERT_EQ(1, ext_json_has(json, "$.name"), "should have $.name");
    TEST_ASSERT_EQ(1, ext_json_has(json, "$.address"), "should have $.address");
    TEST_ASSERT_EQ(1, ext_json_has(json, "$.address.city"), "should have $.address.city");
    TEST_ASSERT_EQ(0, ext_json_has(json, "$.age"), "should not have $.age");
    TEST_ASSERT_EQ(0, ext_json_has(json, "$.address.country"), "should not have $.address.country");

    return 0;
}

// Test: JSON keys
int test_json_keys() {
    ext_json_init();

    const char* json = "{\"name\": \"John\", \"age\": 30, \"city\": \"NYC\"}";
    char* result = ext_json_keys(json);
    TEST_ASSERT(result != nullptr, "result should not be null");

    // Result should be a JSON array of strings
    TEST_ASSERT(result[0] == '[', "result should start with '['");
    TEST_ASSERT(strstr(result, "\"name\"") != nullptr, "should contain 'name'");
    TEST_ASSERT(strstr(result, "\"age\"") != nullptr, "should contain 'age'");
    TEST_ASSERT(strstr(result, "\"city\"") != nullptr, "should contain 'city'");

    ext_json_free(result);

    return 0;
}

// Test: JSON values
int test_json_values() {
    ext_json_init();

    const char* json = "{\"a\": 1, \"b\": 2, \"c\": 3}";
    char* result = ext_json_values(json);
    TEST_ASSERT(result != nullptr, "result should not be null");

    // Result should be a JSON array
    TEST_ASSERT(result[0] == '[', "result should start with '['");
    TEST_ASSERT(strstr(result, "1") != nullptr, "should contain 1");
    TEST_ASSERT(strstr(result, "2") != nullptr, "should contain 2");
    TEST_ASSERT(strstr(result, "3") != nullptr, "should contain 3");

    ext_json_free(result);

    return 0;
}

// Test: Extract raw JSON
int test_extract_raw() {
    ext_json_init();

    const char* json = "{\"data\": {\"nested\": [1, 2, 3]}}";
    char* result = ext_json_extract(json, "$.data");
    TEST_ASSERT(result != nullptr, "result should not be null");
    TEST_ASSERT_STR_EQ("{\"nested\": [1, 2, 3]}", result, "should extract nested object");
    ext_json_free(result);

    result = ext_json_extract(json, "$.data.nested");
    TEST_ASSERT(result != nullptr, "result should not be null");
    TEST_ASSERT_STR_EQ("[1, 2, 3]", result, "should extract array");
    ext_json_free(result);

    return 0;
}

// Test: JSON path alias
int test_json_path() {
    ext_json_init();

    const char* json = "{\"items\": [{\"id\": 1}, {\"id\": 2}]}";
    char* result = ext_json_path(json, "$.items[0]");
    TEST_ASSERT(result != nullptr, "result should not be null");
    TEST_ASSERT_STR_EQ("{\"id\": 1}", result, "should extract first item");
    ext_json_free(result);

    return 0;
}

// Test: String with escape sequences
int test_string_escapes() {
    ext_json_init();

    const char* json = "{\"message\": \"Hello\\nWorld\", \"path\": \"C:\\\\Users\"}";
    char* result = ext_json_extract_string(json, "$.message");
    TEST_ASSERT(result != nullptr, "result should not be null");
    TEST_ASSERT_STR_EQ("Hello\nWorld", result, "should handle newline escape");
    ext_json_free(result);

    result = ext_json_extract_string(json, "$.path");
    TEST_ASSERT(result != nullptr, "result should not be null");
    TEST_ASSERT_STR_EQ("C:\\Users", result, "should handle backslash escape");
    ext_json_free(result);

    return 0;
}

// Test: Null handling
int test_null_handling() {
    ext_json_init();

    // Null inputs should return null/0
    TEST_ASSERT(ext_json_extract(nullptr, "$.foo") == nullptr, "null json should return null");
    TEST_ASSERT(ext_json_extract_string("{}", nullptr) == nullptr, "null path should return null");
    TEST_ASSERT_EQ(0, ext_json_extract_int(nullptr, "$.foo"), "null json should return 0");
    TEST_ASSERT_EQ(-1, ext_json_length(nullptr), "null json should return -1");

    return 0;
}

// Test: Missing path handling
int test_missing_path() {
    ext_json_init();

    const char* json = "{\"name\": \"John\"}";

    // Missing paths should return null/0
    TEST_ASSERT(ext_json_extract(json, "$.age") == nullptr, "missing path should return null");
    TEST_ASSERT(ext_json_extract_string(json, "$.address") == nullptr, "missing path should return null");
    TEST_ASSERT_EQ(0, ext_json_extract_int(json, "$.count"), "missing path should return 0");

    return 0;
}

// Test: Operation count tracking
int test_operation_count() {
    ext_json_init();

    int initial_count = ext_json_get_operation_count();

    const char* json = "{\"a\": 1}";
    ext_json_extract(json, "$.a");
    ext_json_extract_int(json, "$.a");
    ext_json_length(json);

    int final_count = ext_json_get_operation_count();

    TEST_ASSERT(final_count > initial_count, "operation count should increase");
    TEST_ASSERT(final_count >= initial_count + 3, "operation count should increase by at least 3");

    return 0;
}

// ============================================================================
// Main Test Runner
// ============================================================================

int main() {
    printf("\n");
    printf("================================================================\n");
    printf("  ext-json Native Unit Tests\n");
    printf("================================================================\n");
    printf("\n");

    int passed = 0;
    int failed = 0;

    // Initialization tests
    RUN_TEST(test_init);
    RUN_TEST(test_metadata);

    // String extraction tests
    RUN_TEST(test_extract_string_simple);
    RUN_TEST(test_extract_string_nested);

    // Number extraction tests
    RUN_TEST(test_extract_int);
    RUN_TEST(test_extract_float);

    // Array tests
    RUN_TEST(test_extract_from_array);
    RUN_TEST(test_extract_from_nested_array);

    // Length tests
    RUN_TEST(test_json_length_array);
    RUN_TEST(test_json_length_object);

    // Has tests
    RUN_TEST(test_json_has);

    // Keys and values tests
    RUN_TEST(test_json_keys);
    RUN_TEST(test_json_values);

    // Raw extraction tests
    RUN_TEST(test_extract_raw);
    RUN_TEST(test_json_path);

    // Edge case tests
    RUN_TEST(test_string_escapes);
    RUN_TEST(test_null_handling);
    RUN_TEST(test_missing_path);

    // Tracking tests
    RUN_TEST(test_operation_count);

    // Summary
    printf("\n");
    printf("================================================================\n");
    printf("  Results: %d passed, %d failed\n", passed, failed);
    printf("================================================================\n");
    printf("\n");

    return failed > 0 ? 1 : 0;
}
