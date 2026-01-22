/**
 * test_write_buffer.cpp - Unit tests for WriteBufferFromVFS
 *
 * This file contains tests for the WriteBufferFromVFS class that can be
 * compiled natively (not WASM) to verify the write buffer logic without
 * requiring the full VFS bridge.
 *
 * Compile: g++ -std=c++17 -o test_write_buffer test_write_buffer.cpp WriteBufferFromVFS.cpp -I.
 * Run: ./test_write_buffer
 */

#define MERGETREE_STANDALONE_BUILD

// Include headers first (before mock VFS definitions)
#include <cassert>
#include <cstring>
#include <iostream>
#include <map>
#include <sstream>
#include <vector>

// =============================================================================
// Mock VFS state (defined before extern "C" block)
// =============================================================================

struct MockFile
{
    std::vector<char> data;
    size_t position = 0;
    bool synced = false;
};

static std::map<std::string, MockFile> g_mock_files;
static int32_t g_next_handle = 1;
static std::map<int32_t, std::string> g_handle_to_path;

static void mock_vfs_reset()
{
    g_mock_files.clear();
    g_handle_to_path.clear();
    g_next_handle = 1;
}

// =============================================================================
// Mock VFS C functions
// =============================================================================

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

    typedef struct vfs_dirent {
        char name[256];
        uint32_t type;
        uint32_t _pad0;
        uint64_t size;
    } vfs_dirent_t;

    // Constants matching vfs.h
    #define VFS_O_RDONLY    0x0001
    #define VFS_O_WRONLY    0x0002
    #define VFS_O_RDWR      0x0003
    #define VFS_O_CREAT     0x0100
    #define VFS_O_TRUNC     0x0200

    #define VFS_S_IFREG     0x8000
    #define VFS_ENOENT      (-2)
    #define VFS_INVALID_HANDLE (-1)
    #define VFS_OK          0
    #define VFS_SEEK_SET    0
    #define VFS_SEEK_CUR    1
    #define VFS_SEEK_END    2
    #define VFS_S_IFDIR     0x4000

    vfs_handle_t vfs_open(const char* path, int32_t flags)
    {
        std::string path_str(path);

        if (flags & VFS_O_WRONLY || flags & VFS_O_RDWR)
        {
            if (flags & VFS_O_CREAT)
            {
                if (flags & VFS_O_TRUNC || g_mock_files.find(path_str) == g_mock_files.end())
                {
                    g_mock_files[path_str] = MockFile();
                }
            }
            else if (g_mock_files.find(path_str) == g_mock_files.end())
            {
                return VFS_ENOENT;
            }
        }
        else
        {
            if (g_mock_files.find(path_str) == g_mock_files.end())
            {
                return VFS_ENOENT;
            }
        }

        int32_t handle = g_next_handle++;
        g_handle_to_path[handle] = path_str;
        return handle;
    }

    int32_t vfs_close(vfs_handle_t handle)
    {
        auto it = g_handle_to_path.find(handle);
        if (it == g_handle_to_path.end())
            return -9;
        g_handle_to_path.erase(it);
        return VFS_OK;
    }

    int64_t vfs_read(vfs_handle_t handle, void* buffer, size_t size)
    {
        auto it = g_handle_to_path.find(handle);
        if (it == g_handle_to_path.end())
            return -9;

        MockFile& file = g_mock_files[it->second];
        size_t available = file.data.size() - file.position;
        size_t to_read = std::min(size, available);

        if (to_read > 0)
        {
            std::memcpy(buffer, file.data.data() + file.position, to_read);
            file.position += to_read;
        }
        return static_cast<int64_t>(to_read);
    }

    int64_t vfs_write(vfs_handle_t handle, const void* buffer, size_t size)
    {
        auto it = g_handle_to_path.find(handle);
        if (it == g_handle_to_path.end())
            return -9;

        MockFile& file = g_mock_files[it->second];
        const char* data = static_cast<const char*>(buffer);
        file.data.insert(file.data.end(), data, data + size);

        return static_cast<int64_t>(size);
    }

    int64_t vfs_seek(vfs_handle_t handle, int64_t offset, int32_t whence)
    {
        auto it = g_handle_to_path.find(handle);
        if (it == g_handle_to_path.end())
            return -9;

        MockFile& file = g_mock_files[it->second];

        switch (whence)
        {
            case VFS_SEEK_SET:
                file.position = static_cast<size_t>(offset);
                break;
            case VFS_SEEK_CUR:
                file.position += offset;
                break;
            case VFS_SEEK_END:
                file.position = file.data.size() + offset;
                break;
        }
        return static_cast<int64_t>(file.position);
    }

    int32_t vfs_stat(const char* path, vfs_stat_t* st)
    {
        auto it = g_mock_files.find(path);
        if (it == g_mock_files.end())
            return VFS_ENOENT;

        st->mode = VFS_S_IFREG;
        st->size = it->second.data.size();
        st->mtime = 0;
        st->ctime = 0;
        return VFS_OK;
    }

    int32_t vfs_fsync(vfs_handle_t handle)
    {
        auto it = g_handle_to_path.find(handle);
        if (it == g_handle_to_path.end())
            return -9;

        g_mock_files[it->second].synced = true;
        return VFS_OK;
    }

    int32_t vfs_init(const char* database, const char* table)
    {
        (void)database;
        (void)table;
        return VFS_OK;
    }

    int32_t vfs_shutdown(void)
    {
        return VFS_OK;
    }

    vfs_handle_t vfs_opendir(const char* path)
    {
        (void)path;
        return VFS_ENOENT;
    }

    int32_t vfs_readdir(vfs_handle_t handle, vfs_dirent_t* entry)
    {
        (void)handle;
        (void)entry;
        return VFS_ENOENT;
    }

    int32_t vfs_closedir(vfs_handle_t handle)
    {
        (void)handle;
        return VFS_OK;
    }
}

// =============================================================================
// Now include the code that uses VFS (after mock is defined)
// =============================================================================

// Define a guard to prevent MergeTreeStandalone.h from redefining VFS types
#define VFS_TYPES_DEFINED 1

// Include MergeTreeStandalone.h but skip its VFS declarations
// We need to manually include just the DB namespace parts

#include <algorithm>
#include <atomic>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <unordered_map>
#include <utility>
#include <variant>

namespace DB
{

// Basic types
using String = std::string;
using UInt8 = uint8_t;
using UInt16 = uint16_t;
using UInt32 = uint32_t;
using UInt64 = uint64_t;
using Int8 = int8_t;
using Int16 = int16_t;
using Int32 = int32_t;
using Int64 = int64_t;
using Float32 = float;
using Float64 = double;

// PODArray
template <typename T>
class PODArray : public std::vector<T>
{
public:
    using std::vector<T>::vector;
    void resize_fill(size_t n) { this->resize(n); }
    void resize_fill(size_t n, const T& value) { this->resize(n, value); }
};

// Logger stub
class Logger
{
public:
    static Logger* get(const char*) { return &instance_; }
    static Logger* get(const std::string&) { return &instance_; }
    static Logger instance_;
};

Logger Logger::instance_;

// BufferBase and WriteBuffer from MergeTreeStandalone.h
class BufferBase
{
public:
    using Position = char*;

    struct Buffer
    {
        Position begin_pos = nullptr;
        Position end_pos = nullptr;

        Buffer() = default;
        Buffer(Position begin, Position end) : begin_pos(begin), end_pos(end) {}

        Position begin() const { return begin_pos; }
        Position end() const { return end_pos; }
        size_t size() const { return end_pos - begin_pos; }
    };

    BufferBase() = default;
    BufferBase(Position ptr, size_t size) : internal_buffer(ptr, ptr + size), working_buffer(ptr, ptr + size), pos(ptr) {}

    Position begin() const { return working_buffer.begin(); }
    Position end() const { return working_buffer.end(); }
    Position position() const { return pos; }

    size_t offset() const { return pos - working_buffer.begin(); }
    size_t available() const { return working_buffer.end() - pos; }
    size_t count() const { return bytes_read; }

    void set(Position ptr, size_t size)
    {
        internal_buffer = Buffer(ptr, ptr + size);
        working_buffer = internal_buffer;
        pos = ptr;
    }

protected:
    Buffer internal_buffer;
    Buffer working_buffer;
    Position pos = nullptr;
    size_t bytes_read = 0;
};

class WriteBuffer : public BufferBase
{
public:
    WriteBuffer() = default;
    WriteBuffer(Position ptr, size_t size) : BufferBase(ptr, size) {}

    virtual ~WriteBuffer() { finalize(); }

    void write(const char* from, size_t n)
    {
        while (n > 0)
        {
            if (pos >= working_buffer.end())
                nextImpl();

            size_t bytes = std::min(n, static_cast<size_t>(working_buffer.end() - pos));
            std::memcpy(pos, from, bytes);
            pos += bytes;
            from += bytes;
            n -= bytes;
        }
    }

    void next()
    {
        if (!finalized)
            nextImpl();
    }

    virtual void finalize()
    {
        if (!finalized)
        {
            if (pos > working_buffer.begin())
                nextImpl();
            finalized = true;
        }
    }

protected:
    virtual void nextImpl() = 0;
    bool finalized = false;
};

// Exception class
class Exception : public std::exception
{
public:
    Exception() = default;
    explicit Exception(const String& msg) : message_(msg) {}
    Exception(int code, const String& msg) : code_(code), message_(msg) {}

    const char* what() const noexcept override { return message_.c_str(); }
    int code() const { return code_; }

private:
    int code_ = 0;
    String message_;
};

namespace ErrorCodes
{
    constexpr int LOGICAL_ERROR = 49;
    constexpr int FILE_DOESNT_EXIST = 60;
    constexpr int IO_ERROR = 5;
}

} // namespace DB

// Now include WriteBufferFromVFS header
#include "WriteBufferFromVFS.h"

using namespace DB;

// =============================================================================
// Test helpers
// =============================================================================

static int tests_run = 0;
static int tests_passed = 0;

#define TEST(name) \
    void test_##name(); \
    static struct Test_##name { \
        Test_##name() { \
            std::cout << "Running " #name "..." << std::endl; \
            tests_run++; \
            mock_vfs_reset(); \
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

TEST(WriteBufferFromVFS_create_file)
{
    {
        WriteBufferFromVFS buf("/test/file.bin", 1024);
        ASSERT(buf.isOpen());
        ASSERT_EQ(buf.getFileName(), "/test/file.bin");
        buf.finalize();
    }

    ASSERT(g_mock_files.find("/test/file.bin") != g_mock_files.end());
}

TEST(WriteBufferFromVFS_write_small_data)
{
    const char* data = "Hello, World!";
    size_t len = strlen(data);

    {
        WriteBufferFromVFS buf("/test/hello.txt", 1024);
        buf.write(data, len);
        buf.finalize();
    }

    MockFile& file = g_mock_files["/test/hello.txt"];
    ASSERT_EQ(file.data.size(), len);
    ASSERT(std::memcmp(file.data.data(), data, len) == 0);
    ASSERT(file.synced);
}

TEST(WriteBufferFromVFS_write_multiple_chunks)
{
    std::string expected;

    {
        WriteBufferFromVFS buf("/test/chunks.bin", 1024);

        for (int i = 0; i < 10; ++i)
        {
            std::string chunk = "Chunk " + std::to_string(i) + "\n";
            buf.write(chunk.data(), chunk.size());
            expected += chunk;
        }

        buf.finalize();
    }

    MockFile& file = g_mock_files["/test/chunks.bin"];
    ASSERT_EQ(file.data.size(), expected.size());
    ASSERT(std::string(file.data.begin(), file.data.end()) == expected);
}

TEST(WriteBufferFromVFS_buffer_overflow)
{
    const size_t small_buf = 16;
    std::string data(100, 'X');

    {
        WriteBufferFromVFS buf("/test/overflow.bin", small_buf);
        buf.write(data.data(), data.size());
        buf.finalize();
    }

    MockFile& file = g_mock_files["/test/overflow.bin"];
    ASSERT_EQ(file.data.size(), data.size());
    ASSERT(std::string(file.data.begin(), file.data.end()) == data);
}

TEST(WriteBufferFromVFS_bytes_written)
{
    std::string data(500, 'A');

    {
        WriteBufferFromVFS buf("/test/count.bin", 64);
        buf.write(data.data(), data.size());
        buf.finalize();

        ASSERT_EQ(buf.getBytesWritten(), data.size());
    }
}

TEST(WriteBufferFromVFS_default_buffer_size)
{
    ASSERT_EQ(WriteBufferFromVFS::DEFAULT_BUFFER_SIZE, 1024 * 1024);
}

TEST(WriteBufferFromVFS_destructor_finalizes)
{
    const char* data = "Auto finalize test";
    size_t len = strlen(data);

    {
        WriteBufferFromVFS buf("/test/auto_final.txt", 1024);
        buf.write(data, len);
    }

    MockFile& file = g_mock_files["/test/auto_final.txt"];
    ASSERT_EQ(file.data.size(), len);
    ASSERT(file.synced);
}

TEST(WriteBufferFromVFS_empty_file)
{
    {
        WriteBufferFromVFS buf("/test/empty.bin", 1024);
        buf.finalize();
    }

    MockFile& file = g_mock_files["/test/empty.bin"];
    ASSERT_EQ(file.data.size(), 0);
    ASSERT(file.synced);
}

TEST(WriteBufferFromVFS_large_write)
{
    std::string data(2 * 1024 * 1024, 'B');

    {
        WriteBufferFromVFS buf("/test/large.bin");
        buf.write(data.data(), data.size());
        buf.finalize();
    }

    MockFile& file = g_mock_files["/test/large.bin"];
    ASSERT_EQ(file.data.size(), data.size());
}

TEST(WriteBufferFromVFS_binary_data)
{
    std::vector<char> binary_data;
    for (int i = 0; i < 256; ++i)
    {
        binary_data.push_back(static_cast<char>(i));
    }

    {
        WriteBufferFromVFS buf("/test/binary.bin", 64);
        buf.write(binary_data.data(), binary_data.size());
        buf.finalize();
    }

    MockFile& file = g_mock_files["/test/binary.bin"];
    ASSERT_EQ(file.data.size(), 256);

    for (int i = 0; i < 256; ++i)
    {
        ASSERT_EQ(static_cast<unsigned char>(file.data[i]), i);
    }
}

TEST(WriteBufferFromVFS_truncate_existing)
{
    {
        WriteBufferFromVFS buf("/test/truncate.txt", 1024);
        buf.write("Initial content", 15);
        buf.finalize();
    }

    {
        WriteBufferFromVFS buf("/test/truncate.txt", 1024);
        buf.write("New", 3);
        buf.finalize();
    }

    MockFile& file = g_mock_files["/test/truncate.txt"];
    ASSERT_EQ(file.data.size(), 3);
    ASSERT(std::string(file.data.begin(), file.data.end()) == "New");
}

TEST(WriteBufferFromVFS_sequential_writes)
{
    {
        WriteBufferFromVFS buf("/test/sequential.bin", 32);

        for (int i = 0; i < 1000; ++i)
        {
            char c = static_cast<char>('0' + (i % 10));
            buf.write(&c, 1);
        }

        buf.finalize();
    }

    MockFile& file = g_mock_files["/test/sequential.bin"];
    ASSERT_EQ(file.data.size(), 1000);

    for (int i = 0; i < 1000; ++i)
    {
        char expected = static_cast<char>('0' + (i % 10));
        ASSERT_EQ(file.data[i], expected);
    }
}

// =============================================================================
// Main
// =============================================================================

int main()
{
    std::cout << "=== WriteBufferFromVFS Unit Tests ===" << std::endl;
    std::cout << std::endl;

    std::cout << std::endl;
    std::cout << "=== Results: " << tests_passed << "/" << tests_run << " passed ===" << std::endl;

    return tests_passed == tests_run ? 0 : 1;
}
