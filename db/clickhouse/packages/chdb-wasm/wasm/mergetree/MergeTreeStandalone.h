/**
 * MergeTreeStandalone.h - Standalone stubs for ClickHouse MergeTree WASM compilation
 *
 * This header provides minimal stubs for compiling real ClickHouse MergeTree
 * reader components to WASM. It eliminates heavy dependencies like:
 *   - Threading (std::thread, ThreadPool)
 *   - Arena memory allocators
 *   - Logging infrastructure
 *   - System tables
 *   - Distributed features
 *
 * Key components stubbed:
 *   - Arena (memory pool) - replaced with simple allocator
 *   - ThreadPool - replaced with single-threaded execution
 *   - Logger - replaced with no-op
 *   - MarkCache - simple in-memory cache
 *   - ReadBufferFromFile - VFS-backed implementation
 *   - CompressedReadBuffer - decompression support
 *
 * Usage:
 *   #define MERGETREE_STANDALONE_BUILD
 *   #include "MergeTreeStandalone.h"
 *
 * The VFS layer provides file access via JavaScript bridge to R2/Durable Objects.
 */

#pragma once

#include <algorithm>
#include <atomic>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>
#include <set>

// VFS interface - forward declarations for compilation
// The actual VFS is implemented in vfs/vfs_impl.cpp and linked separately
// Use include guards to allow test files to provide mock implementations
#ifndef VFS_TYPES_DEFINED
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

    typedef struct vfs_dirent {
        char name[256];      // Entry name (null-terminated)
        uint32_t type;       // Entry type (VFS_S_IFREG or VFS_S_IFDIR)
        uint32_t _pad0;      // Padding for alignment
        uint64_t size;       // File size (0 for directories)
    } vfs_dirent_t;

    vfs_handle_t vfs_open(const char* path, int32_t flags);
    int32_t vfs_close(vfs_handle_t handle);
    int64_t vfs_read(vfs_handle_t handle, void* buffer, size_t size);
    int64_t vfs_seek(vfs_handle_t handle, int64_t offset, int32_t whence);
    int32_t vfs_stat(const char* path, vfs_stat_t* st);
    int32_t vfs_init(const char* database, const char* table);
    vfs_handle_t vfs_opendir(const char* path);
    int32_t vfs_readdir(vfs_handle_t handle, vfs_dirent_t* entry);
    int32_t vfs_closedir(vfs_handle_t handle);
}
#endif // VFS_TYPES_DEFINED

namespace DB
{

// =============================================================================
// Forward Declarations
// =============================================================================

class IColumn;
class IDataType;
class Block;
class ReadBuffer;
class WriteBuffer;
class CompressedReadBufferBase;

// =============================================================================
// Basic Types (from base/types.h)
// =============================================================================

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

using ColumnPtr = std::shared_ptr<const IColumn>;
using MutableColumnPtr = std::shared_ptr<IColumn>;
using DataTypePtr = std::shared_ptr<const IDataType>;
using Columns = std::vector<ColumnPtr>;
using MutableColumns = std::vector<MutableColumnPtr>;
using DataTypes = std::vector<DataTypePtr>;

// =============================================================================
// PODArray - Simple replacement for ClickHouse PODArray
// =============================================================================

template <typename T>
class PODArray : public std::vector<T>
{
public:
    using std::vector<T>::vector;

    void resize_fill(size_t n) { this->resize(n); }
    void resize_fill(size_t n, const T& value) { this->resize(n, value); }

    T* data() { return std::vector<T>::data(); }
    const T* data() const { return std::vector<T>::data(); }
};

// =============================================================================
// Arena - Simplified memory arena (no actual pooling for WASM)
// =============================================================================

class Arena
{
public:
    Arena(size_t initial_size = 4096, size_t growth_factor = 2)
        : initial_size_(initial_size), growth_factor_(growth_factor) {}

    ~Arena() = default;

    /// Allocate memory
    char* alloc(size_t size)
    {
        auto* buf = new char[size];
        allocations_.push_back(std::unique_ptr<char[]>(buf));
        allocated_bytes_ += size;
        return buf;
    }

    /// Allocate aligned memory
    char* alignedAlloc(size_t size, size_t alignment)
    {
        // Simple implementation: over-allocate and align
        size_t total = size + alignment - 1;
        char* raw = alloc(total);
        size_t addr = reinterpret_cast<size_t>(raw);
        size_t aligned_addr = (addr + alignment - 1) & ~(alignment - 1);
        return reinterpret_cast<char*>(aligned_addr);
    }

    /// Insert a string and return pointer
    const char* insert(const char* data, size_t size)
    {
        char* buf = alloc(size + 1);
        std::memcpy(buf, data, size);
        buf[size] = '\0';
        return buf;
    }

    size_t allocatedBytes() const { return allocated_bytes_; }
    size_t size() const { return allocated_bytes_; }

private:
    std::vector<std::unique_ptr<char[]>> allocations_;
    size_t allocated_bytes_ = 0;
    size_t initial_size_;
    size_t growth_factor_;
};

using ArenaPtr = std::shared_ptr<Arena>;
using Arenas = std::vector<ArenaPtr>;

// =============================================================================
// Logger - No-op logger for WASM
// =============================================================================

class Logger;
using LoggerPtr = Logger*;

class Logger
{
public:
    static Logger* get(const char* /*name*/) { return &instance_; }
    static Logger* get(const std::string& /*name*/) { return &instance_; }

    void trace(const char* /*msg*/) {}
    void debug(const char* /*msg*/) {}
    void info(const char* /*msg*/) {}
    void warning(const char* /*msg*/) {}
    void error(const char* /*msg*/) {}

    template <typename... Args>
    void trace(const char* /*fmt*/, Args&&... /*args*/) {}
    template <typename... Args>
    void debug(const char* /*fmt*/, Args&&... /*args*/) {}
    template <typename... Args>
    void info(const char* /*fmt*/, Args&&... /*args*/) {}
    template <typename... Args>
    void warning(const char* /*fmt*/, Args&&... /*args*/) {}
    template <typename... Args>
    void error(const char* /*fmt*/, Args&&... /*args*/) {}

private:
    static Logger instance_;
};

// Macro stubs for logging
#define LOG_TRACE(logger, ...) do {} while(0)
#define LOG_DEBUG(logger, ...) do {} while(0)
#define LOG_INFO(logger, ...) do {} while(0)
#define LOG_WARNING(logger, ...) do {} while(0)
#define LOG_ERROR(logger, ...) do {} while(0)

// =============================================================================
// ThreadPool - Single-threaded stub for WASM
// =============================================================================

class ThreadPool
{
public:
    ThreadPool(size_t /*max_threads*/ = 1) {}

    template <typename F>
    void scheduleOrThrow(F&& task)
    {
        // Execute immediately in single-threaded WASM
        task();
    }

    template <typename F>
    bool trySchedule(F&& task)
    {
        task();
        return true;
    }

    void wait() {}
    size_t active() const { return 0; }
};

using ThreadPoolPtr = std::shared_ptr<ThreadPool>;

// Global thread pool (single-threaded for WASM)
inline ThreadPool& GlobalThreadPool()
{
    static ThreadPool pool;
    return pool;
}

// =============================================================================
// ReadBuffer - Base class for reading
// =============================================================================

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
        void resize(size_t size) { end_pos = begin_pos + size; }
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

class ReadBuffer : public BufferBase
{
public:
    ReadBuffer() = default;
    ReadBuffer(Position ptr, size_t size) : BufferBase(ptr, size) {}

    virtual ~ReadBuffer() = default;

    bool eof()
    {
        return !hasPendingData() && !next();
    }

    bool hasPendingData() const { return pos < working_buffer.end(); }

    virtual bool next() { return false; }

    char peek()
    {
        if (!hasPendingData() && !next())
            return 0;
        return *pos;
    }

    size_t read(char* to, size_t n)
    {
        size_t total = 0;
        while (n > 0)
        {
            if (!hasPendingData() && !next())
                break;

            size_t bytes = std::min(n, static_cast<size_t>(working_buffer.end() - pos));
            std::memcpy(to, pos, bytes);
            pos += bytes;
            to += bytes;
            n -= bytes;
            total += bytes;
            bytes_read += bytes;
        }
        return total;
    }

    void ignore(size_t n = 1)
    {
        while (n > 0)
        {
            if (!hasPendingData() && !next())
                break;
            size_t bytes = std::min(n, static_cast<size_t>(working_buffer.end() - pos));
            pos += bytes;
            n -= bytes;
            bytes_read += bytes;
        }
    }

    virtual off_t seek(off_t /*off*/, int /*whence*/) { return -1; }
    virtual off_t getPosition() { return bytes_read; }
};

// =============================================================================
// ReadBufferFromMemory - Read from memory buffer
// =============================================================================

class ReadBufferFromMemory : public ReadBuffer
{
public:
    ReadBufferFromMemory(const char* buf, size_t size)
        : ReadBuffer(const_cast<char*>(buf), size)
    {}
};

// =============================================================================
// ReadBufferFromFileBase - Abstract base for file reading
// =============================================================================

class ReadBufferFromFileBase : public ReadBuffer
{
public:
    using ProfileCallback = std::function<void(size_t bytes)>;

    ReadBufferFromFileBase() = default;
    explicit ReadBufferFromFileBase(size_t buf_size)
        : ReadBuffer(nullptr, 0), buffer_(buf_size)
    {
        // Initialize buffer after construction, then set it up
        // (base class can't use buffer_ as it's not yet constructed)
    }

    virtual ~ReadBufferFromFileBase() = default;

    virtual std::string getFileName() const { return ""; }
    virtual size_t getFileSize() { return 0; }

    void setProfileCallback(ProfileCallback callback) { profile_callback_ = std::move(callback); }

protected:
    std::vector<char> buffer_;
    ProfileCallback profile_callback_;
};

// =============================================================================
// ReadBufferFromVFS - Read from VFS (bridges to JavaScript)
// =============================================================================

class ReadBufferFromVFS : public ReadBufferFromFileBase
{
public:
    explicit ReadBufferFromVFS(const std::string& path, size_t buf_size = 65536)
        : ReadBufferFromFileBase(buf_size), path_(path), buf_size_(buf_size)
    {
        handle_ = vfs_open(path.c_str(), VFS_O_RDONLY);
        if (handle_ >= 0)
        {
            vfs_stat_t st;
            if (vfs_stat(path.c_str(), &st) == VFS_OK)
                file_size_ = st.size;
        }
    }

    ~ReadBufferFromVFS() override
    {
        if (handle_ >= 0)
            vfs_close(handle_);
    }

    bool next() override
    {
        if (handle_ < 0)
            return false;

        if (buffer_.empty())
            buffer_.resize(buf_size_);

        int64_t bytes = vfs_read(handle_, buffer_.data(), buffer_.size());
        if (bytes <= 0)
            return false;

        set(buffer_.data(), bytes);
        bytes_read += bytes;

        if (profile_callback_)
            profile_callback_(bytes);

        return true;
    }

    off_t seek(off_t off, int whence) override
    {
        if (handle_ < 0)
            return -1;
        int64_t result = vfs_seek(handle_, off, whence);
        if (result >= 0)
        {
            // Reset buffer state
            working_buffer = Buffer(buffer_.data(), buffer_.data());
            pos = buffer_.data();
        }
        return result;
    }

    off_t getPosition() override
    {
        if (handle_ < 0)
            return -1;
        return vfs_seek(handle_, 0, VFS_SEEK_CUR);
    }

    std::string getFileName() const override { return path_; }
    size_t getFileSize() override { return file_size_; }

private:
    std::string path_;
    vfs_handle_t handle_ = VFS_INVALID_HANDLE;
    size_t buf_size_;
    size_t file_size_ = 0;
};

// =============================================================================
// WriteBuffer - Base class for writing
// =============================================================================

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

// =============================================================================
// MarkInCompressedFile - Mark position in compressed file
// =============================================================================

struct MarkInCompressedFile
{
    size_t offset_in_compressed_file = 0;
    size_t offset_in_decompressed_block = 0;

    MarkInCompressedFile() = default;
    MarkInCompressedFile(size_t offset_compressed, size_t offset_decompressed)
        : offset_in_compressed_file(offset_compressed)
        , offset_in_decompressed_block(offset_decompressed)
    {}

    bool operator==(const MarkInCompressedFile& other) const
    {
        return offset_in_compressed_file == other.offset_in_compressed_file
            && offset_in_decompressed_block == other.offset_in_decompressed_block;
    }

    bool operator!=(const MarkInCompressedFile& other) const
    {
        return !(*this == other);
    }

    bool operator<(const MarkInCompressedFile& other) const
    {
        return std::tie(offset_in_compressed_file, offset_in_decompressed_block)
            < std::tie(other.offset_in_compressed_file, other.offset_in_decompressed_block);
    }

    String toString() const
    {
        std::ostringstream ss;
        ss << "(" << offset_in_compressed_file << "," << offset_in_decompressed_block << ")";
        return ss.str();
    }
};

using MarksInCompressedFile = PODArray<MarkInCompressedFile>;

// =============================================================================
// MarkRange - Range of marks
// =============================================================================

struct MarkRange
{
    size_t begin = 0;
    size_t end = 0;

    MarkRange() = default;
    MarkRange(size_t begin_, size_t end_) : begin(begin_), end(end_) {}

    size_t getNumberOfMarks() const { return end - begin; }

    bool operator==(const MarkRange& rhs) const
    {
        return begin == rhs.begin && end == rhs.end;
    }

    bool operator<(const MarkRange& rhs) const
    {
        return std::tie(begin, end) < std::tie(rhs.begin, rhs.end);
    }
};

struct MarkRanges : public std::deque<MarkRange>
{
    using std::deque<MarkRange>::deque;

    size_t getNumberOfMarks() const
    {
        size_t total = 0;
        for (const auto& range : *this)
            total += range.getNumberOfMarks();
        return total;
    }

    bool isOneRangeForWholePart(size_t num_marks_in_part) const
    {
        return size() == 1 && front().begin == 0 && front().end == num_marks_in_part;
    }
};

// =============================================================================
// MarkCache - Simple in-memory mark cache for WASM
// =============================================================================

class MarkCache
{
public:
    using MappedPtr = std::shared_ptr<MarksInCompressedFile>;

    MarkCache(size_t /*max_size*/ = 1024 * 1024 * 64) {}

    MappedPtr get(const String& key)
    {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = cache_.find(key);
        if (it != cache_.end())
            return it->second;
        return nullptr;
    }

    void set(const String& key, MappedPtr value)
    {
        std::lock_guard<std::mutex> lock(mutex_);
        cache_[key] = std::move(value);
    }

    bool remove(const String& key)
    {
        std::lock_guard<std::mutex> lock(mutex_);
        return cache_.erase(key) > 0;
    }

    void clear()
    {
        std::lock_guard<std::mutex> lock(mutex_);
        cache_.clear();
    }

private:
    std::mutex mutex_;
    std::unordered_map<String, MappedPtr> cache_;
};

// Also define UncompressedCache similarly
using UncompressedCache = MarkCache;

// =============================================================================
// MergeTreeIndexGranularityInfo - Granularity information
// =============================================================================

struct MergeTreeIndexGranularityInfo
{
    size_t fixed_index_granularity = 8192;  // Default granularity
    bool is_adaptive = false;
    String marks_file_extension = ".mrk2";  // Default mark format
    size_t mark_size_in_bytes = 2 * sizeof(size_t);  // offset + rows

    MergeTreeIndexGranularityInfo() = default;

    MergeTreeIndexGranularityInfo(size_t granularity, bool adaptive, const String& ext = ".mrk2")
        : fixed_index_granularity(granularity)
        , is_adaptive(adaptive)
        , marks_file_extension(ext)
    {
        if (marks_file_extension == ".mrk3")
            mark_size_in_bytes = 3 * sizeof(size_t);  // mrk3 has additional field
    }

    size_t getMarkSizeInBytes() const { return mark_size_in_bytes; }
};

// =============================================================================
// MergeTreeIndexGranularity - Abstract granularity interface
// =============================================================================

class MergeTreeIndexGranularity
{
public:
    MergeTreeIndexGranularity() = default;
    virtual ~MergeTreeIndexGranularity() = default;

    virtual std::optional<size_t> getConstantGranularity() const = 0;
    virtual size_t getRowsCountInRange(size_t begin, size_t end) const = 0;
    virtual size_t countMarksForRows(size_t from_mark, size_t number_of_rows) const = 0;
    virtual size_t countRowsForRows(size_t from_mark, size_t number_of_rows, size_t offset_in_rows) const = 0;
    virtual size_t getMarksCount() const = 0;
    virtual size_t getTotalRows() const = 0;
    virtual size_t getMarkRows(size_t mark_index) const = 0;
    virtual MarkRange getMarkRangeForRowOffset(size_t row_offset) const = 0;
    virtual bool hasFinalMark() const = 0;
    virtual void appendMark(size_t rows_count) = 0;
    virtual void adjustLastMark(size_t rows_count) = 0;
    virtual uint64_t getBytesSize() const = 0;
    virtual uint64_t getBytesAllocated() const = 0;
    virtual std::shared_ptr<MergeTreeIndexGranularity> optimize() = 0;
    virtual std::string describe() const = 0;

    size_t getRowsCountInRange(const MarkRange& range) const
    {
        return getRowsCountInRange(range.begin, range.end);
    }

    size_t getMarkStartingRow(size_t mark_index) const
    {
        size_t row = 0;
        for (size_t i = 0; i < mark_index; ++i)
            row += getMarkRows(i);
        return row;
    }

    bool empty() const { return getMarksCount() == 0; }
};

using MergeTreeIndexGranularityPtr = std::shared_ptr<MergeTreeIndexGranularity>;

// =============================================================================
// MergeTreeIndexGranularityConstant - Constant granularity
// =============================================================================

class MergeTreeIndexGranularityConstant : public MergeTreeIndexGranularity
{
public:
    MergeTreeIndexGranularityConstant() = default;
    MergeTreeIndexGranularityConstant(size_t granularity, size_t marks, bool has_final)
        : granularity_(granularity), marks_count_(marks), has_final_mark_(has_final)
    {
        if (has_final_mark_ && marks_count_ > 0)
            total_rows_ = (marks_count_ - 1) * granularity_;
        else
            total_rows_ = marks_count_ * granularity_;
    }

    std::optional<size_t> getConstantGranularity() const override { return granularity_; }

    size_t getRowsCountInRange(size_t begin, size_t end) const override
    {
        return (end - begin) * granularity_;
    }

    size_t countMarksForRows(size_t from_mark, size_t number_of_rows) const override
    {
        return (number_of_rows + granularity_ - 1) / granularity_;
    }

    size_t countRowsForRows(size_t /*from_mark*/, size_t number_of_rows, size_t /*offset_in_rows*/) const override
    {
        return number_of_rows;
    }

    size_t getMarksCount() const override { return marks_count_; }
    size_t getTotalRows() const override { return total_rows_; }
    size_t getMarkRows(size_t /*mark_index*/) const override { return granularity_; }

    MarkRange getMarkRangeForRowOffset(size_t row_offset) const override
    {
        size_t mark = row_offset / granularity_;
        return MarkRange(mark, mark + 1);
    }

    bool hasFinalMark() const override { return has_final_mark_; }

    void appendMark(size_t rows_count) override
    {
        marks_count_++;
        total_rows_ += rows_count;
    }

    void adjustLastMark(size_t rows_count) override
    {
        // Constant granularity doesn't track individual mark sizes
        (void)rows_count;
    }

    uint64_t getBytesSize() const override { return sizeof(*this); }
    uint64_t getBytesAllocated() const override { return sizeof(*this); }

    std::shared_ptr<MergeTreeIndexGranularity> optimize() override { return nullptr; }

    std::string describe() const override
    {
        std::ostringstream ss;
        ss << "Constant granularity: " << granularity_ << ", marks: " << marks_count_;
        return ss.str();
    }

private:
    size_t granularity_ = 8192;
    size_t marks_count_ = 0;
    size_t total_rows_ = 0;
    bool has_final_mark_ = false;
};

// =============================================================================
// ReadSettings - Read configuration
// =============================================================================

struct ReadSettings
{
    size_t local_fs_buffer_size = 65536;
    size_t remote_fs_buffer_size = 1048576;
    bool local_fs_prefetch = false;
    bool remote_fs_prefetch = false;
    size_t direct_io_threshold = 0;
    size_t mmap_threshold = 0;
    size_t priority = 0;

    ReadSettings() = default;
};

// =============================================================================
// IDataPartStorage - Abstract part storage interface
// =============================================================================

enum class MergeTreeDataPartStorageType
{
    Full,
    InMemory,
    Virtual
};

class IDataPartStorage
{
public:
    virtual ~IDataPartStorage() = default;

    virtual MergeTreeDataPartStorageType getType() const = 0;

    /// Path methods
    virtual std::string getFullPath() const = 0;
    virtual std::string getRelativePath() const = 0;
    virtual std::string getPartDirectory() const = 0;
    virtual std::string getFullRootPath() const = 0;
    virtual std::string getParentDirectory() const = 0;

    /// File operations
    virtual bool exists() const = 0;
    virtual bool existsFile(const std::string& name) const = 0;
    virtual bool existsDirectory(const std::string& name) const = 0;
    virtual size_t getFileSize(const std::string& file_name) const = 0;

    /// Read file
    virtual std::unique_ptr<ReadBufferFromFileBase> readFile(
        const std::string& name,
        const ReadSettings& settings,
        std::optional<size_t> read_hint,
        std::optional<size_t> file_size) const = 0;

    /// Disk info
    virtual std::string getDiskName() const = 0;
    virtual std::string getDiskType() const = 0;
    virtual std::string getDiskPath() const = 0;
    virtual bool supportParallelWrite() const = 0;
    virtual bool isBroken() const = 0;
    virtual bool isReadonly() const = 0;
    virtual String getUniqueId() const = 0;
};

using DataPartStoragePtr = std::shared_ptr<const IDataPartStorage>;
using MutableDataPartStoragePtr = std::shared_ptr<IDataPartStorage>;

// =============================================================================
// MergeTreeReaderSettings - Reader configuration
// =============================================================================

struct MergeTreeReaderSettings
{
    ReadSettings read_settings;
    bool save_marks_in_cache = true;
    bool checksum_on_read = true;
    bool read_in_order = false;
    bool apply_deleted_mask = true;
    bool use_asynchronous_read_from_pool = false;
    size_t max_read_buffer_size = 1048576;

    MergeTreeReaderSettings() = default;
};

// =============================================================================
// Field - Variant type for values
// =============================================================================

using Field = std::variant<
    std::monostate,  // NULL
    Int8, Int16, Int32, Int64,
    UInt8, UInt16, UInt32, UInt64,
    Float32, Float64,
    String
>;

enum class TypeIndex
{
    Nothing = 0,
    Int8, Int16, Int32, Int64,
    UInt8, UInt16, UInt32, UInt64,
    Float32, Float64,
    String,
};

// =============================================================================
// IColumn - Abstract column interface
// =============================================================================

class IColumn : public std::enable_shared_from_this<IColumn>
{
public:
    virtual ~IColumn() = default;
    virtual size_t size() const = 0;
    virtual Field operator[](size_t n) const = 0;
    virtual void insert(const Field& value) = 0;
    virtual void insertDefault() = 0;
    virtual MutableColumnPtr cloneEmpty() const = 0;
    virtual MutableColumnPtr cloneResized(size_t new_size) const = 0;
    virtual const char* getFamilyName() const = 0;
    virtual size_t allocatedBytes() const = 0;
    virtual TypeIndex getDataType() const = 0;

    bool empty() const { return size() == 0; }
};

// =============================================================================
// ColumnVector - Numeric column
// =============================================================================

template <typename T>
class ColumnVector : public IColumn
{
public:
    using Container = std::vector<T>;

    ColumnVector() = default;
    explicit ColumnVector(size_t n) : data_(n) {}
    explicit ColumnVector(Container&& data) : data_(std::move(data)) {}

    size_t size() const override { return data_.size(); }

    Field operator[](size_t n) const override { return data_[n]; }

    void insert(const Field& value) override
    {
        if (auto* v = std::get_if<T>(&value))
            data_.push_back(*v);
        else
            data_.push_back(T{});
    }

    void insertDefault() override { data_.push_back(T{}); }

    MutableColumnPtr cloneEmpty() const override
    {
        return std::make_shared<ColumnVector<T>>();
    }

    MutableColumnPtr cloneResized(size_t new_size) const override
    {
        auto res = std::make_shared<ColumnVector<T>>();
        res->data_.resize(new_size);
        size_t copy_size = std::min(new_size, data_.size());
        std::copy(data_.begin(), data_.begin() + copy_size, res->data_.begin());
        return res;
    }

    const char* getFamilyName() const override;
    size_t allocatedBytes() const override { return data_.capacity() * sizeof(T); }
    TypeIndex getDataType() const override;

    Container& getData() { return data_; }
    const Container& getData() const { return data_; }

private:
    Container data_;
};

// Template specializations
template<> inline const char* ColumnVector<Int8>::getFamilyName() const { return "Int8"; }
template<> inline const char* ColumnVector<Int16>::getFamilyName() const { return "Int16"; }
template<> inline const char* ColumnVector<Int32>::getFamilyName() const { return "Int32"; }
template<> inline const char* ColumnVector<Int64>::getFamilyName() const { return "Int64"; }
template<> inline const char* ColumnVector<UInt8>::getFamilyName() const { return "UInt8"; }
template<> inline const char* ColumnVector<UInt16>::getFamilyName() const { return "UInt16"; }
template<> inline const char* ColumnVector<UInt32>::getFamilyName() const { return "UInt32"; }
template<> inline const char* ColumnVector<UInt64>::getFamilyName() const { return "UInt64"; }
template<> inline const char* ColumnVector<Float32>::getFamilyName() const { return "Float32"; }
template<> inline const char* ColumnVector<Float64>::getFamilyName() const { return "Float64"; }

template<> inline TypeIndex ColumnVector<Int8>::getDataType() const { return TypeIndex::Int8; }
template<> inline TypeIndex ColumnVector<Int16>::getDataType() const { return TypeIndex::Int16; }
template<> inline TypeIndex ColumnVector<Int32>::getDataType() const { return TypeIndex::Int32; }
template<> inline TypeIndex ColumnVector<Int64>::getDataType() const { return TypeIndex::Int64; }
template<> inline TypeIndex ColumnVector<UInt8>::getDataType() const { return TypeIndex::UInt8; }
template<> inline TypeIndex ColumnVector<UInt16>::getDataType() const { return TypeIndex::UInt16; }
template<> inline TypeIndex ColumnVector<UInt32>::getDataType() const { return TypeIndex::UInt32; }
template<> inline TypeIndex ColumnVector<UInt64>::getDataType() const { return TypeIndex::UInt64; }
template<> inline TypeIndex ColumnVector<Float32>::getDataType() const { return TypeIndex::Float32; }
template<> inline TypeIndex ColumnVector<Float64>::getDataType() const { return TypeIndex::Float64; }

using ColumnInt8 = ColumnVector<Int8>;
using ColumnInt16 = ColumnVector<Int16>;
using ColumnInt32 = ColumnVector<Int32>;
using ColumnInt64 = ColumnVector<Int64>;
using ColumnUInt8 = ColumnVector<UInt8>;
using ColumnUInt16 = ColumnVector<UInt16>;
using ColumnUInt32 = ColumnVector<UInt32>;
using ColumnUInt64 = ColumnVector<UInt64>;
using ColumnFloat32 = ColumnVector<Float32>;
using ColumnFloat64 = ColumnVector<Float64>;

// =============================================================================
// ColumnString - String column
// =============================================================================

class ColumnString : public IColumn
{
public:
    ColumnString() = default;

    size_t size() const override { return data_.size(); }
    Field operator[](size_t n) const override { return data_[n]; }

    void insert(const Field& value) override
    {
        if (auto* s = std::get_if<String>(&value))
            data_.push_back(*s);
        else
            data_.emplace_back();
    }

    void insertDefault() override { data_.emplace_back(); }

    MutableColumnPtr cloneEmpty() const override { return std::make_shared<ColumnString>(); }

    MutableColumnPtr cloneResized(size_t new_size) const override
    {
        auto res = std::make_shared<ColumnString>();
        res->data_.resize(new_size);
        size_t copy_size = std::min(new_size, data_.size());
        std::copy(data_.begin(), data_.begin() + copy_size, res->data_.begin());
        return res;
    }

    const char* getFamilyName() const override { return "String"; }
    size_t allocatedBytes() const override
    {
        size_t total = 0;
        for (const auto& s : data_)
            total += s.capacity();
        return total + data_.capacity() * sizeof(String);
    }
    TypeIndex getDataType() const override { return TypeIndex::String; }

    std::vector<String>& getData() { return data_; }
    const std::vector<String>& getData() const { return data_; }

private:
    std::vector<String> data_;
};

// =============================================================================
// IDataType - Abstract data type interface
// =============================================================================

class IDataType : public std::enable_shared_from_this<IDataType>
{
public:
    virtual ~IDataType() = default;
    virtual const char* getName() const = 0;
    virtual TypeIndex getTypeId() const = 0;
    virtual MutableColumnPtr createColumn() const = 0;
    virtual bool isNumeric() const { return false; }
    virtual bool isInteger() const { return false; }
    virtual bool isFloatingPoint() const { return false; }
    virtual bool isString() const { return false; }
};

template <typename T>
class DataTypeNumber : public IDataType
{
public:
    const char* getName() const override;
    TypeIndex getTypeId() const override;
    MutableColumnPtr createColumn() const override { return std::make_shared<ColumnVector<T>>(); }
    bool isNumeric() const override { return true; }
    bool isInteger() const override { return std::is_integral_v<T>; }
    bool isFloatingPoint() const override { return std::is_floating_point_v<T>; }
};

template<> inline const char* DataTypeNumber<Int8>::getName() const { return "Int8"; }
template<> inline const char* DataTypeNumber<Int16>::getName() const { return "Int16"; }
template<> inline const char* DataTypeNumber<Int32>::getName() const { return "Int32"; }
template<> inline const char* DataTypeNumber<Int64>::getName() const { return "Int64"; }
template<> inline const char* DataTypeNumber<UInt8>::getName() const { return "UInt8"; }
template<> inline const char* DataTypeNumber<UInt16>::getName() const { return "UInt16"; }
template<> inline const char* DataTypeNumber<UInt32>::getName() const { return "UInt32"; }
template<> inline const char* DataTypeNumber<UInt64>::getName() const { return "UInt64"; }
template<> inline const char* DataTypeNumber<Float32>::getName() const { return "Float32"; }
template<> inline const char* DataTypeNumber<Float64>::getName() const { return "Float64"; }

template<> inline TypeIndex DataTypeNumber<Int8>::getTypeId() const { return TypeIndex::Int8; }
template<> inline TypeIndex DataTypeNumber<Int16>::getTypeId() const { return TypeIndex::Int16; }
template<> inline TypeIndex DataTypeNumber<Int32>::getTypeId() const { return TypeIndex::Int32; }
template<> inline TypeIndex DataTypeNumber<Int64>::getTypeId() const { return TypeIndex::Int64; }
template<> inline TypeIndex DataTypeNumber<UInt8>::getTypeId() const { return TypeIndex::UInt8; }
template<> inline TypeIndex DataTypeNumber<UInt16>::getTypeId() const { return TypeIndex::UInt16; }
template<> inline TypeIndex DataTypeNumber<UInt32>::getTypeId() const { return TypeIndex::UInt32; }
template<> inline TypeIndex DataTypeNumber<UInt64>::getTypeId() const { return TypeIndex::UInt64; }
template<> inline TypeIndex DataTypeNumber<Float32>::getTypeId() const { return TypeIndex::Float32; }
template<> inline TypeIndex DataTypeNumber<Float64>::getTypeId() const { return TypeIndex::Float64; }

using DataTypeInt8 = DataTypeNumber<Int8>;
using DataTypeInt16 = DataTypeNumber<Int16>;
using DataTypeInt32 = DataTypeNumber<Int32>;
using DataTypeInt64 = DataTypeNumber<Int64>;
using DataTypeUInt8 = DataTypeNumber<UInt8>;
using DataTypeUInt16 = DataTypeNumber<UInt16>;
using DataTypeUInt32 = DataTypeNumber<UInt32>;
using DataTypeUInt64 = DataTypeNumber<UInt64>;
using DataTypeFloat32 = DataTypeNumber<Float32>;
using DataTypeFloat64 = DataTypeNumber<Float64>;

class DataTypeString : public IDataType
{
public:
    const char* getName() const override { return "String"; }
    TypeIndex getTypeId() const override { return TypeIndex::String; }
    MutableColumnPtr createColumn() const override { return std::make_shared<ColumnString>(); }
    bool isString() const override { return true; }
};

// =============================================================================
// ColumnWithTypeAndName - Column with metadata
// =============================================================================

struct ColumnWithTypeAndName
{
    ColumnPtr column;
    DataTypePtr type;
    String name;

    ColumnWithTypeAndName() = default;
    ColumnWithTypeAndName(ColumnPtr column_, DataTypePtr type_, String name_)
        : column(std::move(column_)), type(std::move(type_)), name(std::move(name_)) {}
    ColumnWithTypeAndName(DataTypePtr type_, String name_)
        : type(std::move(type_)), name(std::move(name_))
    {
        column = type->createColumn();
    }

    ColumnWithTypeAndName cloneEmpty() const
    {
        return ColumnWithTypeAndName(type->createColumn(), type, name);
    }
};

using ColumnsWithTypeAndName = std::vector<ColumnWithTypeAndName>;

// =============================================================================
// Block - Container for columnar data
// =============================================================================

class Block
{
public:
    using Container = ColumnsWithTypeAndName;
    using IndexByName = std::unordered_map<String, size_t>;

    Block() = default;
    Block(std::initializer_list<ColumnWithTypeAndName> il) : data_(il) { initializeIndexByName(); }
    Block(const ColumnsWithTypeAndName& data) : data_(data) { initializeIndexByName(); }
    Block(ColumnsWithTypeAndName&& data) : data_(std::move(data)) { initializeIndexByName(); }

    void insert(size_t position, ColumnWithTypeAndName elem)
    {
        data_.insert(data_.begin() + position, std::move(elem));
        initializeIndexByName();
    }

    void insert(ColumnWithTypeAndName elem)
    {
        index_by_name_[elem.name] = data_.size();
        data_.push_back(std::move(elem));
    }

    void erase(size_t position)
    {
        data_.erase(data_.begin() + position);
        initializeIndexByName();
    }

    ColumnWithTypeAndName& getByPosition(size_t position) { return data_[position]; }
    const ColumnWithTypeAndName& getByPosition(size_t position) const { return data_[position]; }

    ColumnWithTypeAndName& getByName(const String& name)
    {
        auto it = index_by_name_.find(name);
        if (it == index_by_name_.end())
        {
            static ColumnWithTypeAndName empty;
            return empty;
        }
        return data_[it->second];
    }

    const ColumnWithTypeAndName& getByName(const String& name) const
    {
        auto it = index_by_name_.find(name);
        if (it == index_by_name_.end())
        {
            static ColumnWithTypeAndName empty;
            return empty;
        }
        return data_[it->second];
    }

    bool has(const String& name) const { return index_by_name_.count(name) > 0; }

    size_t getPositionByName(const String& name) const
    {
        auto it = index_by_name_.find(name);
        return it != index_by_name_.end() ? it->second : SIZE_MAX;
    }

    Container::iterator begin() { return data_.begin(); }
    Container::iterator end() { return data_.end(); }
    Container::const_iterator begin() const { return data_.begin(); }
    Container::const_iterator end() const { return data_.end(); }

    const ColumnsWithTypeAndName& getColumnsWithTypeAndName() const { return data_; }

    size_t rows() const { return data_.empty() ? 0 : (data_.front().column ? data_.front().column->size() : 0); }
    size_t columns() const { return data_.size(); }
    bool empty() const { return data_.empty(); }

    Block cloneEmpty() const
    {
        Block res;
        for (const auto& col : data_)
            res.insert(col.cloneEmpty());
        return res;
    }

    size_t bytes() const
    {
        size_t total = 0;
        for (const auto& col : data_)
            if (col.column)
                total += col.column->size() * 8;
        return total;
    }

    size_t allocatedBytes() const
    {
        size_t total = 0;
        for (const auto& col : data_)
            if (col.column)
                total += col.column->allocatedBytes();
        return total;
    }

    void clear()
    {
        data_.clear();
        index_by_name_.clear();
    }

private:
    void initializeIndexByName()
    {
        index_by_name_.clear();
        for (size_t i = 0; i < data_.size(); ++i)
            index_by_name_[data_[i].name] = i;
    }

    Container data_;
    IndexByName index_by_name_;
};

using Blocks = std::vector<Block>;
using BlockPtr = std::shared_ptr<Block>;
using BlocksPtr = std::shared_ptr<Blocks>;

// =============================================================================
// NameAndTypePair - Column schema item
// =============================================================================

struct NameAndTypePair
{
    String name;
    DataTypePtr type;

    NameAndTypePair() = default;
    NameAndTypePair(String name_, DataTypePtr type_)
        : name(std::move(name_)), type(std::move(type_)) {}
};

using NamesAndTypes = std::vector<NameAndTypePair>;

class NamesAndTypesList : public std::vector<NameAndTypePair>
{
public:
    using std::vector<NameAndTypePair>::vector;

    std::vector<String> getNames() const
    {
        std::vector<String> names;
        for (const auto& p : *this)
            names.push_back(p.name);
        return names;
    }
};

// =============================================================================
// Exception handling (simplified for WASM)
// =============================================================================

class Exception : public std::exception
{
public:
    Exception() = default;
    explicit Exception(const String& msg) : message_(msg) {}
    Exception(int code, const String& msg) : code_(code), message_(msg) {}

    const char* what() const noexcept override { return message_.c_str(); }
    int code() const { return code_; }
    const String& message() const { return message_; }

private:
    int code_ = 0;
    String message_;
};

// Error codes
namespace ErrorCodes
{
    constexpr int LOGICAL_ERROR = 49;
    constexpr int NOT_IMPLEMENTED = 48;
    constexpr int CANNOT_READ_ALL_DATA = 32;
    constexpr int CANNOT_SEEK_THROUGH_FILE = 33;
    constexpr int FILE_DOESNT_EXIST = 60;
    constexpr int CHECKSUM_DOESNT_MATCH = 40;
    constexpr int CORRUPTED_DATA = 131;
    constexpr int CANNOT_DECOMPRESS = 362;
    constexpr int UNKNOWN_CODEC = 501;
}

// =============================================================================
// Compression codec types
// =============================================================================

enum class CompressionMethodByte : uint8_t
{
    NONE = 0x02,
    LZ4 = 0x82,
    LZ4HC = 0x82,  // Same as LZ4
    ZSTD = 0x90,
    Multiple = 0x91,
    Delta = 0x92,
    T64 = 0x93,
    DoubleDelta = 0x94,
    Gorilla = 0x95,
};

// Forward declarations for compression
class ICompressionCodec;
using CompressionCodecPtr = std::shared_ptr<ICompressionCodec>;

// =============================================================================
// MergeTreeDataPartType - Part format type
// =============================================================================

enum class MergeTreeDataPartType
{
    Unknown,
    Wide,      // Each column in separate file
    Compact,   // All columns in single file
    InMemory   // Not persisted
};

// =============================================================================
// Serialization (simplified)
// =============================================================================

class ISerialization
{
public:
    virtual ~ISerialization() = default;

    struct DeserializeBinaryBulkState {};
    using DeserializeBinaryBulkStatePtr = std::shared_ptr<DeserializeBinaryBulkState>;

    struct DeserializeBinaryBulkSettings
    {
        ReadBuffer* getter = nullptr;
        bool continue_reading = false;
        double avg_value_size_hint = 0;
    };
};

using SerializationPtr = std::shared_ptr<ISerialization>;
using Serializations = std::vector<SerializationPtr>;
using SerializationByName = std::map<String, SerializationPtr>;

// =============================================================================
// UUID (simplified)
// =============================================================================

struct UUID
{
    UInt64 high = 0;
    UInt64 low = 0;

    bool operator==(const UUID& other) const { return high == other.high && low == other.low; }
    bool operator!=(const UUID& other) const { return !(*this == other); }
};

// =============================================================================
// Names (string containers)
// =============================================================================

using Names = std::vector<String>;
using NameSet = std::set<String>;

} // namespace DB
