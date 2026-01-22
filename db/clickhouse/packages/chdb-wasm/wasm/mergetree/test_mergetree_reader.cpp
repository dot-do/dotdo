/**
 * test_mergetree_reader.cpp - Unit tests for MergeTree reader components
 *
 * This file contains tests that can be compiled natively (not WASM) to verify
 * the MergeTree reader logic without requiring the full VFS bridge.
 *
 * Compile: g++ -std=c++17 -o test_mergetree test_mergetree_reader.cpp -I.
 * Run: ./test_mergetree
 */

#define MERGETREE_STANDALONE_BUILD
#define VFS_TYPES_DEFINED 1

#include <cstdint>
#include <cstddef>

// Mock VFS functions for native testing
extern "C"
{
    typedef int32_t vfs_handle_t;
    #define VFS_INVALID_HANDLE (-1)
    #define VFS_O_RDONLY 0x0001
    #define VFS_SEEK_SET 0
    #define VFS_SEEK_CUR 1
    #define VFS_SEEK_END 2
    #define VFS_OK 0
    #define VFS_S_IFREG 0x8000
    #define VFS_S_IFDIR 0x4000

    typedef struct vfs_stat {
        uint32_t mode;
        uint32_t _pad0;
        uint64_t size;
        uint64_t mtime;
        uint64_t ctime;
    } vfs_stat_t;

    // Mock implementations
    vfs_handle_t vfs_open(const char* path, int32_t flags)
    {
        (void)path;
        (void)flags;
        return -2; // ENOENT - file not found
    }

    int32_t vfs_close(vfs_handle_t handle)
    {
        (void)handle;
        return 0;
    }

    int64_t vfs_read(vfs_handle_t handle, void* buffer, size_t size)
    {
        (void)handle;
        (void)buffer;
        (void)size;
        return 0;
    }

    int64_t vfs_seek(vfs_handle_t handle, int64_t offset, int32_t whence)
    {
        (void)handle;
        (void)offset;
        (void)whence;
        return -1;
    }

    int32_t vfs_stat(const char* path, vfs_stat_t* st)
    {
        (void)path;
        (void)st;
        return -2; // ENOENT
    }

    int32_t vfs_init(const char* database, const char* table)
    {
        (void)database;
        (void)table;
        return 0;
    }

    int32_t vfs_shutdown(void)
    {
        return 0;
    }

    vfs_handle_t vfs_opendir(const char* path)
    {
        (void)path;
        return -2;
    }

    typedef struct vfs_dirent {
        char name[256];
        uint32_t type;
        uint32_t _pad0;
        uint64_t size;
    } vfs_dirent_t;

    int32_t vfs_readdir(vfs_handle_t handle, vfs_dirent_t* entry)
    {
        (void)handle;
        (void)entry;
        return -2;
    }

    int32_t vfs_closedir(vfs_handle_t handle)
    {
        (void)handle;
        return 0;
    }
}

#include "MergeTreeStandalone.h"

#include <cassert>
#include <iostream>

using namespace DB;

// Test helpers
static int tests_run = 0;
static int tests_passed = 0;

#define TEST(name) \
    void test_##name(); \
    static struct Test_##name { \
        Test_##name() { \
            std::cout << "Running " #name "..." << std::endl; \
            tests_run++; \
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

TEST(PODArray_basic)
{
    PODArray<int> arr;
    ASSERT(arr.empty());

    arr.push_back(1);
    arr.push_back(2);
    arr.push_back(3);

    ASSERT_EQ(arr.size(), 3);
    ASSERT_EQ(arr[0], 1);
    ASSERT_EQ(arr[1], 2);
    ASSERT_EQ(arr[2], 3);
}

TEST(Arena_alloc)
{
    Arena arena;

    char* p1 = arena.alloc(100);
    ASSERT(p1 != nullptr);

    char* p2 = arena.alloc(200);
    ASSERT(p2 != nullptr);
    ASSERT(p2 != p1);

    ASSERT_EQ(arena.allocatedBytes(), 300);
}

TEST(Arena_insert)
{
    Arena arena;

    const char* str = arena.insert("hello", 5);
    ASSERT(str != nullptr);
    ASSERT_EQ(std::string(str), "hello");
}

TEST(MarkInCompressedFile_basic)
{
    MarkInCompressedFile mark1;
    ASSERT_EQ(mark1.offset_in_compressed_file, 0);
    ASSERT_EQ(mark1.offset_in_decompressed_block, 0);

    MarkInCompressedFile mark2(100, 50);
    ASSERT_EQ(mark2.offset_in_compressed_file, 100);
    ASSERT_EQ(mark2.offset_in_decompressed_block, 50);

    ASSERT(mark1 != mark2);
    ASSERT(mark1 < mark2);
}

TEST(MarkRange_basic)
{
    MarkRange range(10, 20);
    ASSERT_EQ(range.begin, 10);
    ASSERT_EQ(range.end, 20);
    ASSERT_EQ(range.getNumberOfMarks(), 10);
}

TEST(MarkRanges_operations)
{
    MarkRanges ranges;
    ranges.push_back(MarkRange(0, 10));
    ranges.push_back(MarkRange(20, 30));

    ASSERT_EQ(ranges.size(), 2);
    ASSERT_EQ(ranges.getNumberOfMarks(), 20);
    ASSERT(!ranges.isOneRangeForWholePart(100));

    MarkRanges whole;
    whole.push_back(MarkRange(0, 100));
    ASSERT(whole.isOneRangeForWholePart(100));
}

TEST(MergeTreeIndexGranularityConstant_basic)
{
    MergeTreeIndexGranularityConstant gran(8192, 10, false);

    ASSERT_EQ(gran.getConstantGranularity().value(), 8192);
    ASSERT_EQ(gran.getMarksCount(), 10);
    ASSERT_EQ(gran.getMarkRows(5), 8192);
    ASSERT(!gran.hasFinalMark());
}

TEST(MergeTreeIndexGranularityConstant_with_final_mark)
{
    MergeTreeIndexGranularityConstant gran(8192, 10, true);

    ASSERT_EQ(gran.getMarksCount(), 10);
    ASSERT(gran.hasFinalMark());
    ASSERT_EQ(gran.getTotalRows(), 9 * 8192);  // 9 full granules
}

TEST(ReadBufferFromMemory_basic)
{
    const char* data = "Hello, World!";
    ReadBufferFromMemory buf(data, 13);

    ASSERT(!buf.eof());
    ASSERT(buf.hasPendingData());

    char out[20];
    size_t read = buf.read(out, 5);
    ASSERT_EQ(read, 5);
    ASSERT_EQ(std::string(out, 5), "Hello");

    read = buf.read(out, 20);
    ASSERT_EQ(read, 8);  // ", World!" is 8 chars
}

TEST(ColumnVector_int64)
{
    ColumnInt64 col;
    col.insert(Field(int64_t(1)));
    col.insert(Field(int64_t(2)));
    col.insert(Field(int64_t(3)));

    ASSERT_EQ(col.size(), 3);
    ASSERT(std::get<Int64>(col[0]) == 1);
    ASSERT(std::get<Int64>(col[1]) == 2);
    ASSERT(std::get<Int64>(col[2]) == 3);
}

TEST(ColumnString_basic)
{
    ColumnString col;
    col.insert(Field(String("hello")));
    col.insert(Field(String("world")));

    ASSERT_EQ(col.size(), 2);
    ASSERT(std::get<String>(col[0]) == "hello");
    ASSERT(std::get<String>(col[1]) == "world");
}

TEST(Block_basic)
{
    Block block;

    auto col1 = std::make_shared<ColumnInt64>();
    col1->insert(Field(int64_t(1)));
    col1->insert(Field(int64_t(2)));

    auto col2 = std::make_shared<ColumnString>();
    col2->insert(Field(String("a")));
    col2->insert(Field(String("b")));

    block.insert(ColumnWithTypeAndName(
        col1,
        std::make_shared<DataTypeInt64>(),
        "id"
    ));

    block.insert(ColumnWithTypeAndName(
        col2,
        std::make_shared<DataTypeString>(),
        "name"
    ));

    ASSERT_EQ(block.columns(), 2);
    ASSERT_EQ(block.rows(), 2);
    ASSERT(block.has("id"));
    ASSERT(block.has("name"));
    ASSERT(!block.has("missing"));
}

TEST(NamesAndTypesList_basic)
{
    NamesAndTypesList cols;
    cols.emplace_back("id", std::make_shared<DataTypeInt64>());
    cols.emplace_back("name", std::make_shared<DataTypeString>());

    ASSERT_EQ(cols.size(), 2);

    auto names = cols.getNames();
    ASSERT_EQ(names.size(), 2);
    ASSERT_EQ(names[0], "id");
    ASSERT_EQ(names[1], "name");
}

TEST(MergeTreeIndexGranularityInfo_default)
{
    MergeTreeIndexGranularityInfo info;
    ASSERT_EQ(info.fixed_index_granularity, 8192);
    ASSERT(!info.is_adaptive);
    ASSERT_EQ(info.marks_file_extension, ".mrk2");
    ASSERT_EQ(info.getMarkSizeInBytes(), 16);  // 2 * sizeof(size_t)
}

TEST(MergeTreeIndexGranularityInfo_mrk3)
{
    MergeTreeIndexGranularityInfo info(8192, true, ".mrk3");
    ASSERT_EQ(info.marks_file_extension, ".mrk3");
    ASSERT_EQ(info.getMarkSizeInBytes(), 24);  // 3 * sizeof(size_t)
}

// =============================================================================
// Main
// =============================================================================

int main()
{
    std::cout << "=== MergeTree Reader Unit Tests ===" << std::endl;
    std::cout << std::endl;

    // Tests run automatically via static constructors

    std::cout << std::endl;
    std::cout << "=== Results: " << tests_passed << "/" << tests_run << " passed ===" << std::endl;

    return tests_passed == tests_run ? 0 : 1;
}
