/**
 * test_read_buffer.cpp - Unit tests for ReadBufferFromVFS
 *
 * This file tests the ReadBufferFromVFS implementation with mock VFS functions.
 * It can be compiled natively (not WASM) for testing.
 *
 * Compile: g++ -std=c++17 -o test_read_buffer test_read_buffer.cpp ReadBufferFromVFS.cpp -I.
 * Run: ./test_read_buffer
 */

#include <cassert>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

// =============================================================================
// Mock VFS Implementation
// =============================================================================

namespace MockVFS
{

static std::vector<char> mock_file_data;
static int64_t mock_file_position = 0;
static bool file_is_open = false;
static int next_handle = 1;

void setFileData(const std::string& data)
{
    mock_file_data.assign(data.begin(), data.end());
    mock_file_position = 0;
    file_is_open = false;
}

void setFileData(const std::vector<char>& data)
{
    mock_file_data = data;
    mock_file_position = 0;
    file_is_open = false;
}

void reset()
{
    mock_file_data.clear();
    mock_file_position = 0;
    file_is_open = false;
}

} // namespace MockVFS

// Define VFS types before including ReadBufferFromVFS.h to prevent redefinition
#define VFS_TYPES_DEFINED
#define VFS_INVALID_HANDLE (-1)
#define VFS_O_RDONLY 0x0001
#define VFS_SEEK_SET 0
#define VFS_SEEK_CUR 1
#define VFS_SEEK_END 2
#define VFS_OK 0

// Mock VFS C API implementations
extern "C"
{

typedef int32_t vfs_handle_t;

typedef struct vfs_stat {
    uint32_t mode;
    uint32_t _pad0;
    uint64_t size;
    uint64_t mtime;
    uint64_t ctime;
} vfs_stat_t;

// Flag to allow opening empty files (for empty_file test)
static bool allow_empty_file = false;

vfs_handle_t vfs_open(const char* path, int32_t flags)
{
    (void)path;
    (void)flags;

    // Allow empty files if explicitly permitted or if mock data was set
    if (MockVFS::mock_file_data.empty() && !allow_empty_file)
        return -2; // ENOENT

    MockVFS::file_is_open = true;
    MockVFS::mock_file_position = 0;
    allow_empty_file = false;  // Reset after use
    return MockVFS::next_handle++;
}

int32_t vfs_close(vfs_handle_t handle)
{
    (void)handle;
    MockVFS::file_is_open = false;
    return 0;
}

int64_t vfs_read(vfs_handle_t handle, void* buffer, size_t size)
{
    (void)handle;

    if (!MockVFS::file_is_open)
        return -9; // EBADF

    if (MockVFS::mock_file_position >= static_cast<int64_t>(MockVFS::mock_file_data.size()))
        return 0; // EOF

    size_t available = MockVFS::mock_file_data.size() - MockVFS::mock_file_position;
    size_t to_read = std::min(size, available);

    std::memcpy(buffer, MockVFS::mock_file_data.data() + MockVFS::mock_file_position, to_read);
    MockVFS::mock_file_position += to_read;

    return static_cast<int64_t>(to_read);
}

int64_t vfs_seek(vfs_handle_t handle, int64_t offset, int32_t whence)
{
    (void)handle;

    if (!MockVFS::file_is_open)
        return -9; // EBADF

    int64_t new_pos = 0;
    int64_t file_size = static_cast<int64_t>(MockVFS::mock_file_data.size());

    switch (whence)
    {
        case 0: // SEEK_SET
            new_pos = offset;
            break;
        case 1: // SEEK_CUR
            new_pos = MockVFS::mock_file_position + offset;
            break;
        case 2: // SEEK_END
            new_pos = file_size + offset;
            break;
        default:
            return -22; // EINVAL
    }

    if (new_pos < 0)
        return -22; // EINVAL

    MockVFS::mock_file_position = new_pos;
    return new_pos;
}

int32_t vfs_stat(const char* path, vfs_stat_t* st)
{
    (void)path;

    if (MockVFS::mock_file_data.empty())
        return -2; // ENOENT

    st->mode = 0x8000; // S_IFREG
    st->_pad0 = 0;
    st->size = MockVFS::mock_file_data.size();
    st->mtime = 0;
    st->ctime = 0;
    return 0;
}

int32_t vfs_fstat(vfs_handle_t handle, vfs_stat_t* st)
{
    (void)handle;
    return vfs_stat("", st);
}

} // extern "C"

// Now include the header after the mock is defined
#include "ReadBufferFromVFS.h"

using namespace DB;

// =============================================================================
// Test Framework
// =============================================================================

static int tests_run = 0;
static int tests_passed = 0;

#define TEST(name) \
    void test_##name(); \
    static struct Test_##name { \
        Test_##name() { \
            std::cout << "Running " #name "..." << std::endl; \
            tests_run++; \
            MockVFS::reset(); \
            try { \
                test_##name(); \
                tests_passed++; \
                std::cout << "  PASS" << std::endl; \
            } catch (const std::exception& e) { \
                std::cout << "  FAIL: " << e.what() << std::endl; \
            } \
        } \
    } test_instance_##name; \
    void test_##name()

#define ASSERT(cond) \
    if (!(cond)) { \
        throw std::runtime_error("Assertion failed: " #cond); \
    }

#define ASSERT_EQ(a, b) \
    if ((a) != (b)) { \
        std::ostringstream ss; \
        ss << "Assertion failed: " << #a << " != " << #b << " (" << (a) << " != " << (b) << ")"; \
        throw std::runtime_error(ss.str()); \
    }

// =============================================================================
// Tests
// =============================================================================

TEST(open_nonexistent_file)
{
    // Don't set any mock data - file doesn't exist
    ReadBufferFromVFS buf("/nonexistent.txt");

    ASSERT(!buf.isOpen());
    ASSERT(buf.eof());
    ASSERT_EQ(buf.getFileSize(), 0);
}

TEST(open_and_read_small_file)
{
    MockVFS::setFileData("Hello, World!");

    ReadBufferFromVFS buf("/test.txt", 4096);

    ASSERT(buf.isOpen());
    ASSERT_EQ(buf.getFileSize(), 13);
    ASSERT(!buf.eof());

    char data[20];
    size_t bytes = buf.read(data, 5);
    ASSERT_EQ(bytes, 5);
    ASSERT_EQ(std::string(data, 5), "Hello");

    bytes = buf.read(data, 20);
    ASSERT_EQ(bytes, 8);
    ASSERT_EQ(std::string(data, 8), ", World!");

    // Now should be at EOF
    ASSERT(buf.eof());
}

TEST(read_byte)
{
    MockVFS::setFileData("ABC");

    ReadBufferFromVFS buf("/test.txt", 4096);

    ASSERT_EQ(buf.readByte(), 'A');
    ASSERT_EQ(buf.readByte(), 'B');
    ASSERT_EQ(buf.readByte(), 'C');
    ASSERT_EQ(buf.readByte(), -1);  // EOF
}

TEST(peek)
{
    MockVFS::setFileData("XY");

    ReadBufferFromVFS buf("/test.txt", 4096);

    ASSERT_EQ(buf.peek(), 'X');
    ASSERT_EQ(buf.peek(), 'X');  // Peek doesn't advance
    ASSERT_EQ(buf.readByte(), 'X');
    ASSERT_EQ(buf.peek(), 'Y');
}

TEST(ignore)
{
    MockVFS::setFileData("ABCDEFGH");

    ReadBufferFromVFS buf("/test.txt", 4096);

    buf.ignore(3);  // Skip ABC
    ASSERT_EQ(buf.readByte(), 'D');

    buf.ignore(2);  // Skip EF
    ASSERT_EQ(buf.readByte(), 'G');
}

TEST(seek_set)
{
    MockVFS::setFileData("0123456789");

    ReadBufferFromVFS buf("/test.txt", 4096);

    // Read some data first
    char data[5];
    buf.read(data, 3);
    ASSERT_EQ(std::string(data, 3), "012");

    // Seek to position 5
    int64_t pos = buf.seek(5, VFS_SEEK_SET);
    ASSERT_EQ(pos, 5);

    // Read from new position
    buf.read(data, 3);
    ASSERT_EQ(std::string(data, 3), "567");
}

TEST(seek_cur)
{
    MockVFS::setFileData("0123456789");

    ReadBufferFromVFS buf("/test.txt", 4096);

    // Read 2 bytes
    char data[5];
    buf.read(data, 2);

    // Seek forward 3 from current
    int64_t pos = buf.seek(3, VFS_SEEK_CUR);
    ASSERT_EQ(pos, 5);

    // Read from new position
    ASSERT_EQ(buf.readByte(), '5');
}

TEST(seek_end)
{
    MockVFS::setFileData("0123456789");

    ReadBufferFromVFS buf("/test.txt", 4096);

    // Seek to 2 bytes before end
    int64_t pos = buf.seek(-2, VFS_SEEK_END);
    ASSERT_EQ(pos, 8);

    // Read remaining
    ASSERT_EQ(buf.readByte(), '8');
    ASSERT_EQ(buf.readByte(), '9');
    ASSERT(buf.eof());
}

TEST(getPosition)
{
    MockVFS::setFileData("0123456789");

    ReadBufferFromVFS buf("/test.txt", 4096);

    ASSERT_EQ(buf.getPosition(), 0);

    char data[3];
    buf.read(data, 3);
    ASSERT_EQ(buf.getPosition(), 3);

    buf.read(data, 2);
    ASSERT_EQ(buf.getPosition(), 5);

    buf.seek(0, VFS_SEEK_SET);
    ASSERT_EQ(buf.getPosition(), 0);
}

TEST(pread)
{
    MockVFS::setFileData("ABCDEFGHIJ");

    ReadBufferFromVFS buf("/test.txt", 4096);

    // Read from beginning normally
    char data[5];
    buf.read(data, 2);
    ASSERT_EQ(std::string(data, 2), "AB");
    ASSERT_EQ(buf.getPosition(), 2);

    // pread from offset 5
    size_t bytes = buf.pread(data, 3, 5);
    ASSERT_EQ(bytes, 3);
    ASSERT_EQ(std::string(data, 3), "FGH");

    // Original position should be restored
    ASSERT_EQ(buf.getPosition(), 2);

    // Continue reading from original position
    buf.read(data, 2);
    ASSERT_EQ(std::string(data, 2), "CD");
}

TEST(small_buffer_multiple_reads)
{
    MockVFS::setFileData("ABCDEFGHIJKLMNOP");

    // Use small buffer to force multiple reads
    ReadBufferFromVFS buf("/test.txt", 4);

    char data[20];
    size_t total = buf.read(data, 16);
    ASSERT_EQ(total, 16);
    ASSERT_EQ(std::string(data, 16), "ABCDEFGHIJKLMNOP");
}

TEST(empty_file)
{
    MockVFS::setFileData("");
    allow_empty_file = true;  // Allow opening empty file

    ReadBufferFromVFS buf("/empty.txt", 4096);

    // File should be open but empty
    ASSERT(buf.isOpen());
    ASSERT_EQ(buf.getFileSize(), 0);
    ASSERT(buf.eof());

    char data[10];
    size_t bytes = buf.read(data, 10);
    ASSERT_EQ(bytes, 0);
}

TEST(binary_data)
{
    // Create binary data with null bytes
    std::vector<char> binary_data = {'\x00', '\x01', '\x02', '\x03', '\xFF', '\xFE', '\x00', '\x10'};
    MockVFS::setFileData(binary_data);

    ReadBufferFromVFS buf("/binary.bin", 4096);

    char data[10];
    size_t bytes = buf.read(data, 10);
    ASSERT_EQ(bytes, 8);

    for (size_t i = 0; i < bytes; ++i)
    {
        ASSERT_EQ(static_cast<unsigned char>(data[i]),
                  static_cast<unsigned char>(binary_data[i]));
    }
}

TEST(count)
{
    MockVFS::setFileData("0123456789");

    ReadBufferFromVFS buf("/test.txt", 4096);

    ASSERT_EQ(buf.count(), 0);

    char data[5];
    buf.read(data, 3);
    ASSERT_EQ(buf.count(), 3);

    buf.read(data, 2);
    ASSERT_EQ(buf.count(), 5);

    buf.ignore(2);
    ASSERT_EQ(buf.count(), 7);
}

TEST(default_buffer_size)
{
    MockVFS::setFileData("test");

    ReadBufferFromVFS buf("/test.txt");  // No buffer size specified

    ASSERT(buf.isOpen());
    // Default should be DEFAULT_VFS_BUFFER_SIZE (1MB)
}

TEST(move_constructor)
{
    MockVFS::setFileData("ABCDEFGH");

    ReadBufferFromVFS buf1("/test.txt", 4096);
    char data[3];
    buf1.read(data, 2);

    // Move construct
    ReadBufferFromVFS buf2(std::move(buf1));

    // buf2 should work and continue from position 2
    ASSERT(buf2.isOpen());
    size_t bytes = buf2.read(data, 3);
    ASSERT_EQ(bytes, 3);
    ASSERT_EQ(std::string(data, 3), "CDE");
}

TEST(move_assignment)
{
    MockVFS::setFileData("ABCDEFGH");

    ReadBufferFromVFS buf1("/test.txt", 4096);
    char data[3];
    buf1.read(data, 2);

    // Create another buffer (will be replaced)
    MockVFS::setFileData("XY");
    ReadBufferFromVFS buf2("/other.txt", 4096);

    // Move assign
    MockVFS::setFileData("ABCDEFGH");  // Restore original data
    buf2 = std::move(buf1);

    // buf2 should continue from where buf1 left off
    ASSERT(buf2.isOpen());
}

TEST(hasPendingData)
{
    MockVFS::setFileData("ABC");

    ReadBufferFromVFS buf("/test.txt", 4096);

    // Before first read, no pending data
    ASSERT(!buf.hasPendingData());

    // After checking eof (which fills buffer), there should be pending data
    buf.eof();
    ASSERT(buf.hasPendingData());

    // Read all data
    char data[10];
    buf.read(data, 10);
    ASSERT(!buf.hasPendingData());
}

TEST(available)
{
    MockVFS::setFileData("12345");

    ReadBufferFromVFS buf("/test.txt", 4096);

    // Initially 0
    ASSERT_EQ(buf.available(), 0);

    // After eof check (fills buffer)
    buf.eof();
    ASSERT_EQ(buf.available(), 5);

    // After reading some
    char data[2];
    buf.read(data, 2);
    ASSERT_EQ(buf.available(), 3);
}

// =============================================================================
// Main
// =============================================================================

int main()
{
    std::cout << "=== ReadBufferFromVFS Unit Tests ===" << std::endl;
    std::cout << std::endl;

    // Tests run automatically via static constructors

    std::cout << std::endl;
    std::cout << "=== Results: " << tests_passed << "/" << tests_run << " passed ===" << std::endl;

    return tests_passed == tests_run ? 0 : 1;
}
