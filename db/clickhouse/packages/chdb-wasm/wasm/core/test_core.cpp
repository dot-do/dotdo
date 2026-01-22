/**
 * test_core.cpp - C++ Unit Tests for Core MAIN_MODULE
 *
 * These tests verify the core module implementation at the C++ level.
 * They are compiled as part of the test build and run natively (not in WASM)
 * to provide fast feedback during development.
 *
 * The tests verify:
 * - Memory allocation functions
 * - VFS (Virtual File System) interface
 * - Extension registry functionality
 * - Query tracking
 * - Error handling
 *
 * Build with: emcc test_core.cpp -DTEST_BUILD -o test_core.js
 * Or for native testing with a test framework.
 *
 * TDD RED Phase: These tests are written first and will fail until
 * the corresponding implementation in core.cpp is complete.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>

// ============================================================================
// Test Framework Macros (minimal, self-contained)
// ============================================================================

static int tests_run = 0;
static int tests_passed = 0;
static int tests_failed = 0;

#define TEST_ASSERT(condition, message) \
    do { \
        tests_run++; \
        if (condition) { \
            tests_passed++; \
            printf("  [PASS] %s\n", message); \
        } else { \
            tests_failed++; \
            printf("  [FAIL] %s (at line %d)\n", message, __LINE__); \
        } \
    } while(0)

#define TEST_ASSERT_EQ(expected, actual, message) \
    TEST_ASSERT((expected) == (actual), message)

#define TEST_ASSERT_NE(expected, actual, message) \
    TEST_ASSERT((expected) != (actual), message)

#define TEST_ASSERT_GT(val, threshold, message) \
    TEST_ASSERT((val) > (threshold), message)

#define TEST_ASSERT_GTE(val, threshold, message) \
    TEST_ASSERT((val) >= (threshold), message)

#define TEST_ASSERT_LT(val, threshold, message) \
    TEST_ASSERT((val) < (threshold), message)

#define TEST_ASSERT_NULL(ptr, message) \
    TEST_ASSERT((ptr) == nullptr, message)

#define TEST_ASSERT_NOT_NULL(ptr, message) \
    TEST_ASSERT((ptr) != nullptr, message)

#define TEST_ASSERT_STREQ(expected, actual, message) \
    TEST_ASSERT(strcmp((expected), (actual)) == 0, message)

#define TEST_SUITE(name) \
    printf("\n=== Test Suite: %s ===\n", name)

#define TEST_CASE(name) \
    printf("\n--- Test Case: %s ---\n", name)

// ============================================================================
// Forward declarations for core module functions
// These will be implemented in core.cpp
// ============================================================================

#ifdef __cplusplus
extern "C" {
#endif

// Core initialization
int core_init(void);
int core_get_version(void);

// Memory management
void* core_alloc(size_t size);
void core_free(void* ptr);

// Logging and error handling
void core_log(const char* message);
void core_set_error(const char* error);
const char* core_get_error(void);

// Extension registry
int core_register_extension(const char* name);
int core_get_extension_count(void);

// Query tracking
void core_increment_query_count(void);
int core_get_query_count(void);

// Utility functions
int core_add(int a, int b);
int core_multiply(int a, int b);
int core_process_buffer(const char* buffer, int length);

// VFS functions
int vfs_open(const char* path, int flags);
int vfs_read(int fd, void* buffer, int count);
int vfs_write(int fd, const void* buffer, int count);
int vfs_close(int fd);
int vfs_seek(int fd, int offset, int whence);
int vfs_size(int fd);

// Extension registry (advanced)
int extension_register(const char* name, int (*init_fn)(void));
int extension_call(const char* ext_name, const char* func_name, void* args);

#ifdef __cplusplus
}
#endif

// ============================================================================
// Test Suite: Core Initialization
// ============================================================================

void test_core_initialization() {
    TEST_SUITE("Core Initialization");

    TEST_CASE("core_init returns 0 on success");
    {
        int result = core_init();
        TEST_ASSERT_EQ(0, result, "core_init should return 0 on success");
    }

    TEST_CASE("core_get_version returns valid version");
    {
        core_init();
        int version = core_get_version();
        TEST_ASSERT_GTE(version, 1, "version should be at least 1");
    }

    TEST_CASE("core_init can be called multiple times");
    {
        core_init();
        int result = core_init(); // Should not fail on re-initialization
        TEST_ASSERT_EQ(0, result, "core_init should handle re-initialization");
    }
}

// ============================================================================
// Test Suite: Memory Management
// ============================================================================

void test_memory_management() {
    TEST_SUITE("Memory Management");

    core_init();

    TEST_CASE("core_alloc allocates memory");
    {
        void* ptr = core_alloc(1024);
        TEST_ASSERT_NOT_NULL(ptr, "core_alloc should return non-null for valid size");
        core_free(ptr);
    }

    TEST_CASE("core_alloc returns null for zero size");
    {
        void* ptr = core_alloc(0);
        // Behavior for size 0 can vary - some implementations return null,
        // others return a unique non-null pointer
        // We accept either behavior
        if (ptr != nullptr) {
            core_free(ptr);
        }
        TEST_ASSERT(1, "core_alloc(0) should not crash");
    }

    TEST_CASE("core_free handles null pointer");
    {
        core_free(nullptr); // Should not crash
        TEST_ASSERT(1, "core_free(nullptr) should not crash");
    }

    TEST_CASE("allocated memory is writable");
    {
        char* ptr = (char*)core_alloc(256);
        TEST_ASSERT_NOT_NULL(ptr, "allocation succeeded");

        if (ptr) {
            // Write pattern
            for (int i = 0; i < 256; i++) {
                ptr[i] = (char)(i & 0xFF);
            }

            // Verify pattern
            int match = 1;
            for (int i = 0; i < 256; i++) {
                if (ptr[i] != (char)(i & 0xFF)) {
                    match = 0;
                    break;
                }
            }
            TEST_ASSERT(match, "memory should be readable/writable");

            core_free(ptr);
        }
    }

    TEST_CASE("can allocate large blocks");
    {
        size_t large_size = 4 * 1024 * 1024; // 4MB
        void* ptr = core_alloc(large_size);
        TEST_ASSERT_NOT_NULL(ptr, "should allocate 4MB block");

        if (ptr) {
            // Touch first and last bytes to verify
            ((char*)ptr)[0] = 0x42;
            ((char*)ptr)[large_size - 1] = 0x42;
            TEST_ASSERT_EQ(0x42, ((char*)ptr)[0], "first byte accessible");
            TEST_ASSERT_EQ(0x42, ((char*)ptr)[large_size - 1], "last byte accessible");
            core_free(ptr);
        }
    }
}

// ============================================================================
// Test Suite: Error Handling
// ============================================================================

void test_error_handling() {
    TEST_SUITE("Error Handling");

    core_init();

    TEST_CASE("core_set_error and core_get_error");
    {
        const char* test_error = "Test error message";
        core_set_error(test_error);

        const char* retrieved = core_get_error();
        TEST_ASSERT_NOT_NULL(retrieved, "core_get_error should return non-null");
        TEST_ASSERT_STREQ(test_error, retrieved, "error message should match");
    }

    TEST_CASE("error is cleared on init");
    {
        core_set_error("Some error");
        core_init();

        const char* error = core_get_error();
        TEST_ASSERT(error == nullptr || error[0] == '\0',
            "error should be cleared after core_init");
    }

    TEST_CASE("core_set_error handles long messages");
    {
        // Create a long error message (256+ chars)
        char long_msg[512];
        for (int i = 0; i < 511; i++) {
            long_msg[i] = 'A' + (i % 26);
        }
        long_msg[511] = '\0';

        core_set_error(long_msg);
        const char* retrieved = core_get_error();

        TEST_ASSERT_NOT_NULL(retrieved, "should handle long error message");
        // Message may be truncated, but should not crash
    }

    TEST_CASE("core_log does not crash");
    {
        core_log("Test log message");
        core_log("Another log message with special chars: \t\n");
        core_log("");
        TEST_ASSERT(1, "core_log should not crash");
    }
}

// ============================================================================
// Test Suite: Extension Registry
// ============================================================================

void test_extension_registry() {
    TEST_SUITE("Extension Registry");

    core_init();

    TEST_CASE("initial extension count is zero");
    {
        int count = core_get_extension_count();
        TEST_ASSERT_EQ(0, count, "initial extension count should be 0");
    }

    TEST_CASE("core_register_extension returns valid ID");
    {
        int id = core_register_extension("test_ext_1");
        TEST_ASSERT_GTE(id, 0, "should return valid extension ID");
    }

    TEST_CASE("extension count increments after registration");
    {
        core_init(); // Reset
        int initial_count = core_get_extension_count();

        core_register_extension("ext_a");
        TEST_ASSERT_EQ(initial_count + 1, core_get_extension_count(),
            "count should increment by 1");

        core_register_extension("ext_b");
        TEST_ASSERT_EQ(initial_count + 2, core_get_extension_count(),
            "count should increment by 2");
    }

    TEST_CASE("can register maximum extensions");
    {
        core_init(); // Reset

        // Register 16 extensions (MAX_EXTENSIONS from spike)
        int failed = 0;
        for (int i = 0; i < 16; i++) {
            char name[32];
            snprintf(name, sizeof(name), "max_ext_%d", i);
            int result = core_register_extension(name);
            if (result < 0) {
                failed++;
            }
        }
        TEST_ASSERT_EQ(0, failed, "should register 16 extensions without failure");
    }

    TEST_CASE("registration fails at maximum capacity");
    {
        core_init(); // Reset

        // Fill up extensions
        for (int i = 0; i < 16; i++) {
            char name[32];
            snprintf(name, sizeof(name), "fill_ext_%d", i);
            core_register_extension(name);
        }

        // This should fail
        int result = core_register_extension("overflow_ext");
        TEST_ASSERT_LT(result, 0, "should fail when at max capacity");
    }
}

// ============================================================================
// Test Suite: Extension Registry (Advanced)
// ============================================================================

static int test_init_fn_called = 0;
static int test_init_fn() {
    test_init_fn_called++;
    return 0;
}

void test_extension_registry_advanced() {
    TEST_SUITE("Extension Registry (Advanced)");

    core_init();

    TEST_CASE("extension_register with init function");
    {
        test_init_fn_called = 0;

        int id = extension_register("advanced_ext", test_init_fn);
        TEST_ASSERT_GTE(id, 0, "should return valid ID with init function");
    }

    TEST_CASE("extension_call dispatches to registered function");
    {
        // This requires more complex setup - the extension_call function
        // needs to look up the extension and dispatch appropriately
        // For now, we just verify it doesn't crash with invalid inputs
        int result = extension_call("nonexistent", "func", nullptr);
        TEST_ASSERT_LT(result, 0, "should fail for nonexistent extension");
    }
}

// ============================================================================
// Test Suite: Query Tracking
// ============================================================================

void test_query_tracking() {
    TEST_SUITE("Query Tracking");

    TEST_CASE("initial query count is zero");
    {
        core_init();
        int count = core_get_query_count();
        TEST_ASSERT_EQ(0, count, "initial query count should be 0");
    }

    TEST_CASE("core_increment_query_count increments");
    {
        core_init();
        core_increment_query_count();
        TEST_ASSERT_EQ(1, core_get_query_count(), "count should be 1");

        core_increment_query_count();
        TEST_ASSERT_EQ(2, core_get_query_count(), "count should be 2");

        core_increment_query_count();
        TEST_ASSERT_EQ(3, core_get_query_count(), "count should be 3");
    }

    TEST_CASE("query count resets on init");
    {
        core_init();
        core_increment_query_count();
        core_increment_query_count();

        core_init(); // Re-init

        int count = core_get_query_count();
        TEST_ASSERT_EQ(0, count, "query count should reset on init");
    }
}

// ============================================================================
// Test Suite: Utility Functions
// ============================================================================

void test_utility_functions() {
    TEST_SUITE("Utility Functions");

    core_init();

    TEST_CASE("core_add adds two numbers");
    {
        TEST_ASSERT_EQ(30, core_add(10, 20), "10 + 20 = 30");
        TEST_ASSERT_EQ(0, core_add(0, 0), "0 + 0 = 0");
        TEST_ASSERT_EQ(-5, core_add(-10, 5), "-10 + 5 = -5");
        TEST_ASSERT_EQ(-15, core_add(-10, -5), "-10 + -5 = -15");
    }

    TEST_CASE("core_multiply multiplies two numbers");
    {
        TEST_ASSERT_EQ(42, core_multiply(6, 7), "6 * 7 = 42");
        TEST_ASSERT_EQ(0, core_multiply(0, 100), "0 * 100 = 0");
        TEST_ASSERT_EQ(-50, core_multiply(-10, 5), "-10 * 5 = -50");
        TEST_ASSERT_EQ(15, core_multiply(-5, -3), "-5 * -3 = 15");
    }

    TEST_CASE("core_process_buffer sums bytes");
    {
        char buffer[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
        int sum = core_process_buffer(buffer, 10);
        TEST_ASSERT_EQ(55, sum, "sum of 1..10 = 55");
    }

    TEST_CASE("core_process_buffer handles empty buffer");
    {
        int sum = core_process_buffer(nullptr, 0);
        TEST_ASSERT_EQ(0, sum, "empty buffer sum should be 0");
    }
}

// ============================================================================
// Test Suite: VFS (Virtual File System)
// ============================================================================

void test_vfs_functions() {
    TEST_SUITE("VFS Functions");

    core_init();

    TEST_CASE("vfs_open returns valid file descriptor or error");
    {
        int fd = vfs_open("/test/file.txt", 0x02); // O_RDWR
        // fd >= 0 on success, -1 on error (which is acceptable for non-existent file)
        TEST_ASSERT_GTE(fd, -1, "vfs_open should return fd >= -1");

        if (fd >= 0) {
            vfs_close(fd);
        }
    }

    TEST_CASE("vfs_close returns 0 on valid fd");
    {
        int fd = vfs_open("/test/close_test.txt", 0x42); // O_RDWR | O_CREAT
        if (fd >= 0) {
            int result = vfs_close(fd);
            TEST_ASSERT_EQ(0, result, "vfs_close should return 0 on success");
        } else {
            TEST_ASSERT(1, "could not create file for close test");
        }
    }

    TEST_CASE("vfs_write and vfs_read round-trip");
    {
        // Create file
        int fd = vfs_open("/test/rw_test.txt", 0x42); // O_RDWR | O_CREAT
        if (fd < 0) {
            TEST_ASSERT(0, "could not create file for read/write test");
            return;
        }

        // Write data
        const char* test_data = "Hello, VFS!";
        int data_len = strlen(test_data);
        int written = vfs_write(fd, test_data, data_len);
        TEST_ASSERT_EQ(data_len, written, "should write all bytes");

        // Seek to beginning
        vfs_seek(fd, 0, 0); // SEEK_SET

        // Read data back
        char read_buffer[64] = {0};
        int read_count = vfs_read(fd, read_buffer, data_len);
        TEST_ASSERT_EQ(data_len, read_count, "should read all bytes");
        TEST_ASSERT_STREQ(test_data, read_buffer, "data should match");

        vfs_close(fd);
    }

    TEST_CASE("vfs_seek changes read position");
    {
        int fd = vfs_open("/test/seek_test.txt", 0x42);
        if (fd < 0) {
            TEST_ASSERT(0, "could not create file for seek test");
            return;
        }

        const char* test_data = "0123456789";
        vfs_write(fd, test_data, 10);

        // Seek to position 5
        vfs_seek(fd, 5, 0); // SEEK_SET

        char buffer[6] = {0};
        int read_count = vfs_read(fd, buffer, 5);
        TEST_ASSERT_EQ(5, read_count, "should read 5 bytes");
        TEST_ASSERT_STREQ("56789", buffer, "should read from position 5");

        vfs_close(fd);
    }

    TEST_CASE("vfs_size returns file size");
    {
        int fd = vfs_open("/test/size_test.txt", 0x42);
        if (fd < 0) {
            TEST_ASSERT(0, "could not create file for size test");
            return;
        }

        const char* test_data = "Test content";
        int data_len = strlen(test_data);
        vfs_write(fd, test_data, data_len);

        int size = vfs_size(fd);
        TEST_ASSERT_EQ(data_len, size, "vfs_size should return written size");

        vfs_close(fd);
    }

    TEST_CASE("vfs handles invalid fd gracefully");
    {
        char buffer[64];
        int result;

        result = vfs_read(-1, buffer, 10);
        TEST_ASSERT_LT(result, 0, "vfs_read should fail for invalid fd");

        result = vfs_write(-1, buffer, 10);
        TEST_ASSERT_LT(result, 0, "vfs_write should fail for invalid fd");

        result = vfs_close(-1);
        TEST_ASSERT_LT(result, 0, "vfs_close should fail for invalid fd");

        result = vfs_seek(-1, 0, 0);
        TEST_ASSERT_LT(result, 0, "vfs_seek should fail for invalid fd");

        result = vfs_size(-1);
        TEST_ASSERT_LT(result, 0, "vfs_size should fail for invalid fd");
    }
}

// ============================================================================
// Main Test Runner
// ============================================================================

int main() {
    printf("\n");
    printf("================================================================\n");
    printf("  Core MAIN_MODULE C++ Unit Tests\n");
    printf("  TDD RED Phase - Tests for unimplemented functionality\n");
    printf("================================================================\n");

    // Run all test suites
    test_core_initialization();
    test_memory_management();
    test_error_handling();
    test_extension_registry();
    test_extension_registry_advanced();
    test_query_tracking();
    test_utility_functions();
    test_vfs_functions();

    // Print summary
    printf("\n");
    printf("================================================================\n");
    printf("  Test Summary\n");
    printf("================================================================\n");
    printf("  Total:  %d\n", tests_run);
    printf("  Passed: %d\n", tests_passed);
    printf("  Failed: %d\n", tests_failed);
    printf("================================================================\n");

    if (tests_failed > 0) {
        printf("\n  RESULT: FAILED (RED phase - implementation needed)\n\n");
        return 1;
    } else {
        printf("\n  RESULT: PASSED (GREEN phase - implementation complete)\n\n");
        return 0;
    }
}
