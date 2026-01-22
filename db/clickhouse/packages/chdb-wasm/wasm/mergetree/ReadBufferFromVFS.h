/**
 * ReadBufferFromVFS.h - VFS-backed ReadBuffer implementation
 *
 * This class implements the ReadBufferFromFileBase interface for reading files
 * via the VFS layer in WASM. It provides:
 *   - Buffered sequential reads (default 1MB buffer)
 *   - Positioned reads for random access (column data)
 *   - Proper EOF detection
 *   - File size caching
 *
 * The VFS layer bridges to JavaScript for actual file I/O, which in turn
 * accesses Cloudflare R2 storage.
 *
 * Usage:
 *   ReadBufferFromVFS buf("/path/to/file.bin");
 *   char data[1024];
 *   size_t bytes = buf.read(data, sizeof(data));
 *
 *   // Positioned read
 *   buf.seek(1000, VFS_SEEK_SET);
 *   bytes = buf.read(data, sizeof(data));
 */

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

// VFS interface declarations - only if not already defined
#ifndef VFS_TYPES_DEFINED
#define VFS_TYPES_DEFINED

extern "C"
{
    typedef int32_t vfs_handle_t;

    #ifndef VFS_INVALID_HANDLE
    #define VFS_INVALID_HANDLE (-1)
    #endif
    #ifndef VFS_O_RDONLY
    #define VFS_O_RDONLY 0x0001
    #endif
    #ifndef VFS_SEEK_SET
    #define VFS_SEEK_SET 0
    #endif
    #ifndef VFS_SEEK_CUR
    #define VFS_SEEK_CUR 1
    #endif
    #ifndef VFS_SEEK_END
    #define VFS_SEEK_END 2
    #endif
    #ifndef VFS_OK
    #define VFS_OK 0
    #endif

    typedef struct vfs_stat {
        uint32_t mode;
        uint32_t _pad0;
        uint64_t size;
        uint64_t mtime;
        uint64_t ctime;
    } vfs_stat_t;

    vfs_handle_t vfs_open(const char* path, int32_t flags);
    int32_t vfs_close(vfs_handle_t handle);
    int64_t vfs_read(vfs_handle_t handle, void* buffer, size_t size);
    int64_t vfs_seek(vfs_handle_t handle, int64_t offset, int32_t whence);
    int32_t vfs_stat(const char* path, vfs_stat_t* st);
    int32_t vfs_fstat(vfs_handle_t handle, vfs_stat_t* st);
}

#endif // VFS_TYPES_DEFINED

namespace DB
{

// Forward declaration
class ReadBuffer;

/**
 * Default buffer size for VFS reads (1MB)
 * This is optimized for R2 which works well with larger read sizes.
 */
constexpr size_t DEFAULT_VFS_BUFFER_SIZE = 1024 * 1024;

/**
 * ReadBufferFromVFS - Buffered file reader using VFS
 *
 * Features:
 * - Large default buffer (1MB) for efficient sequential reads
 * - Positioned reads via seek() for random access patterns
 * - Caches file size to avoid repeated stat calls
 * - Proper EOF handling that distinguishes EOF from errors
 *
 * Thread safety: NOT thread safe. Each thread should use its own instance.
 */
class ReadBufferFromVFS
{
public:
    using Position = char*;

    /**
     * Open a file for reading
     *
     * @param path      Path to file (relative to VFS root)
     * @param buf_size  Buffer size in bytes (default 1MB)
     */
    explicit ReadBufferFromVFS(const std::string& path, size_t buf_size = DEFAULT_VFS_BUFFER_SIZE);

    /**
     * Destructor - closes file handle
     */
    ~ReadBufferFromVFS();

    // Non-copyable
    ReadBufferFromVFS(const ReadBufferFromVFS&) = delete;
    ReadBufferFromVFS& operator=(const ReadBufferFromVFS&) = delete;

    // Moveable
    ReadBufferFromVFS(ReadBufferFromVFS&& other) noexcept;
    ReadBufferFromVFS& operator=(ReadBufferFromVFS&& other) noexcept;

    // -------------------------------------------------------------------------
    // Buffer state
    // -------------------------------------------------------------------------

    /**
     * Check if end of file reached
     * This will attempt to fill the buffer if empty.
     */
    bool eof();

    /**
     * Check if there is data available without reading
     */
    bool hasPendingData() const { return pos_ < end_; }

    /**
     * Get number of available bytes in buffer
     */
    size_t available() const { return static_cast<size_t>(end_ - pos_); }

    // -------------------------------------------------------------------------
    // Reading
    // -------------------------------------------------------------------------

    /**
     * Read data into buffer
     *
     * @param to   Destination buffer
     * @param n    Maximum bytes to read
     * @return     Actual bytes read (may be less if EOF)
     */
    size_t read(char* to, size_t n);

    /**
     * Read a single byte
     * @return Byte value or -1 on EOF
     */
    int readByte();

    /**
     * Peek at next byte without advancing position
     * @return Byte value or -1 on EOF
     */
    int peek();

    /**
     * Skip n bytes
     */
    void ignore(size_t n = 1);

    // -------------------------------------------------------------------------
    // Positioning
    // -------------------------------------------------------------------------

    /**
     * Seek to position in file
     *
     * @param offset  Offset from origin
     * @param whence  Origin: VFS_SEEK_SET, VFS_SEEK_CUR, or VFS_SEEK_END
     * @return        New position or -1 on error
     */
    int64_t seek(int64_t offset, int whence);

    /**
     * Get current position in file
     * This accounts for buffered data.
     */
    int64_t getPosition() const;

    /**
     * Read from a specific position without changing current position
     *
     * @param to       Destination buffer
     * @param n        Bytes to read
     * @param offset   File offset to read from
     * @return         Actual bytes read
     */
    size_t pread(char* to, size_t n, int64_t offset);

    // -------------------------------------------------------------------------
    // File information
    // -------------------------------------------------------------------------

    /**
     * Get file name/path
     */
    const std::string& getFileName() const { return path_; }

    /**
     * Get file size (cached)
     */
    size_t getFileSize() const { return file_size_; }

    /**
     * Check if file is open
     */
    bool isOpen() const { return handle_ >= 0; }

    /**
     * Get total bytes read (including buffered)
     */
    size_t count() const { return bytes_read_; }

    // -------------------------------------------------------------------------
    // Direct buffer access (for compatibility with ReadBuffer interface)
    // -------------------------------------------------------------------------

    Position begin() const { return buffer_.data(); }
    Position end() const { return end_; }
    Position position() const { return pos_; }

protected:
    /**
     * Fill buffer with next chunk of data
     * @return true if data was read, false on EOF or error
     */
    bool nextImpl();

    /**
     * Reset buffer pointers after seek
     */
    void resetBuffer();

private:
    std::string path_;
    vfs_handle_t handle_ = VFS_INVALID_HANDLE;
    size_t buf_size_;
    size_t file_size_ = 0;
    size_t bytes_read_ = 0;
    int64_t file_offset_ = 0;  // Current position in file (before buffer)
    bool eof_reached_ = false;

    // Buffer storage - mutable to allow modifications
    mutable std::vector<char> buffer_;
    Position pos_ = nullptr;   // Current read position in buffer
    Position end_ = nullptr;   // End of valid data in buffer
};

} // namespace DB
