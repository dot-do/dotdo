/**
 * WriteBufferFromVFS.h - VFS-backed WriteBuffer implementation
 *
 * This class implements WriteBuffer for writing files via the VFS layer,
 * enabling MergeTree writers to persist data to Cloudflare R2 storage.
 *
 * Features:
 *   - Buffered writes (default 1MB buffer)
 *   - Automatic flush on buffer overflow
 *   - vfs_fsync on finalize for durability
 *   - Tracks total bytes written
 *
 * Usage:
 *   WriteBufferFromVFS buf("/path/to/file.bin", 1024 * 1024);
 *   buf.write(data, size);
 *   buf.finalize();  // Flushes remaining data and syncs
 */

#pragma once

// Allow test files to provide their own definitions by defining VFS_TYPES_DEFINED
#ifndef VFS_TYPES_DEFINED
#include "MergeTreeStandalone.h"
#endif

#include <stdexcept>
#include <string>
#include <vector>
#include <functional>

// VFS write functions (from vfs/vfs.h)
extern "C"
{
    // Additional VFS flags for writing
    #ifndef VFS_O_WRONLY
    #define VFS_O_WRONLY    0x0002
    #endif
    #ifndef VFS_O_CREAT
    #define VFS_O_CREAT     0x0100
    #endif
    #ifndef VFS_O_TRUNC
    #define VFS_O_TRUNC     0x0200
    #endif

    // VFS write function
    int64_t vfs_write(vfs_handle_t handle, const void* buffer, size_t size);

    // VFS sync function
    int32_t vfs_fsync(vfs_handle_t handle);
}

namespace DB
{

/**
 * WriteBufferFromVFS - Write to VFS-backed storage
 *
 * Inherits from WriteBuffer (defined in MergeTreeStandalone.h) and implements
 * buffered writes to the VFS layer. The VFS layer bridges to JavaScript which
 * ultimately writes to Cloudflare R2 storage.
 */
class WriteBufferFromVFS : public WriteBuffer
{
public:
    /// Default buffer size: 1MB
    static constexpr size_t DEFAULT_BUFFER_SIZE = 1024 * 1024;

    /**
     * Create a write buffer for a VFS file
     *
     * @param path      Path to file (relative to VFS root)
     * @param buf_size  Internal buffer size (default 1MB)
     * @param flags     Open flags (default: O_WRONLY | O_CREAT | O_TRUNC)
     *
     * @throws Exception if file cannot be opened
     */
    explicit WriteBufferFromVFS(
        const std::string& path,
        size_t buf_size = DEFAULT_BUFFER_SIZE,
        int32_t flags = VFS_O_WRONLY | VFS_O_CREAT | VFS_O_TRUNC);

    /**
     * Destructor - finalizes the buffer if not already done
     */
    ~WriteBufferFromVFS() override;

    // Non-copyable, non-movable
    WriteBufferFromVFS(const WriteBufferFromVFS&) = delete;
    WriteBufferFromVFS& operator=(const WriteBufferFromVFS&) = delete;
    WriteBufferFromVFS(WriteBufferFromVFS&&) = delete;
    WriteBufferFromVFS& operator=(WriteBufferFromVFS&&) = delete;

    /**
     * Finalize the write operation
     *
     * Flushes any remaining buffered data and calls vfs_fsync for durability.
     * After calling finalize(), the buffer should not be used for further writes.
     */
    void finalize() override;

    /**
     * Get the file path
     */
    std::string getFileName() const { return path_; }

    /**
     * Get total bytes written to VFS (excluding buffered data)
     */
    size_t getBytesWritten() const { return bytes_written_; }

    /**
     * Check if the file handle is valid
     */
    bool isOpen() const { return handle_ >= 0; }

protected:
    /**
     * Flush the internal buffer to VFS
     *
     * Called when:
     *   - Buffer becomes full during write()
     *   - Explicitly via next()
     *   - During finalize()
     */
    void nextImpl() override;

private:
    /// File path
    std::string path_;

    /// VFS file handle
    vfs_handle_t handle_ = VFS_INVALID_HANDLE;

    /// Internal buffer storage
    std::vector<char> buffer_storage_;

    /// Total bytes successfully written to VFS
    size_t bytes_written_ = 0;

    /// Flush internal buffer to VFS, throws on error
    void flushBuffer();
};

/**
 * WriteBufferFromFileBase - Abstract base for file writing
 *
 * This provides a base class for file-based write buffers, similar to
 * ReadBufferFromFileBase for reading.
 */
class WriteBufferFromFileBase : public WriteBuffer
{
public:
    using ProfileCallback = std::function<void(size_t bytes)>;

    WriteBufferFromFileBase() = default;
    explicit WriteBufferFromFileBase(size_t buf_size)
        : WriteBuffer(nullptr, 0), buffer_(buf_size)
    {
    }

    virtual ~WriteBufferFromFileBase() = default;

    virtual std::string getFileName() const { return ""; }

    void setProfileCallback(ProfileCallback callback) { profile_callback_ = std::move(callback); }

protected:
    std::vector<char> buffer_;
    ProfileCallback profile_callback_;
};

} // namespace DB
