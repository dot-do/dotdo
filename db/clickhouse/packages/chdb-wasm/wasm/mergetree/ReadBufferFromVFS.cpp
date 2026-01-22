/**
 * ReadBufferFromVFS.cpp - VFS-backed ReadBuffer implementation
 *
 * This file implements the ReadBufferFromVFS class for reading files through
 * the VFS layer in WASM/Cloudflare Workers environment.
 */

#include "ReadBufferFromVFS.h"
#include <algorithm>
#include <cstring>

namespace DB
{

// =============================================================================
// Constructor / Destructor
// =============================================================================

ReadBufferFromVFS::ReadBufferFromVFS(const std::string& path, size_t buf_size)
    : path_(path)
    , buf_size_(buf_size > 0 ? buf_size : DEFAULT_VFS_BUFFER_SIZE)
{
    // Open the file
    handle_ = vfs_open(path.c_str(), VFS_O_RDONLY);

    if (handle_ >= 0)
    {
        // Get file size
        vfs_stat_t st;
        if (vfs_stat(path.c_str(), &st) == VFS_OK)
        {
            file_size_ = static_cast<size_t>(st.size);
        }
    }

    // Allocate buffer
    buffer_.resize(buf_size_);
    pos_ = buffer_.data();
    end_ = buffer_.data();  // Empty buffer initially
}

ReadBufferFromVFS::~ReadBufferFromVFS()
{
    if (handle_ >= 0)
    {
        vfs_close(handle_);
        handle_ = VFS_INVALID_HANDLE;
    }
}

// =============================================================================
// Move operations
// =============================================================================

ReadBufferFromVFS::ReadBufferFromVFS(ReadBufferFromVFS&& other) noexcept
    : path_(std::move(other.path_))
    , handle_(other.handle_)
    , buf_size_(other.buf_size_)
    , file_size_(other.file_size_)
    , bytes_read_(other.bytes_read_)
    , file_offset_(other.file_offset_)
    , eof_reached_(other.eof_reached_)
{
    // Calculate offsets BEFORE moving buffer
    size_t pos_offset = 0;
    size_t end_offset = 0;
    if (other.pos_ && !other.buffer_.empty())
    {
        pos_offset = static_cast<size_t>(other.pos_ - other.buffer_.data());
        end_offset = static_cast<size_t>(other.end_ - other.buffer_.data());
    }

    // Move buffer
    buffer_ = std::move(other.buffer_);

    // Set positions in new buffer
    if (!buffer_.empty())
    {
        pos_ = buffer_.data() + pos_offset;
        end_ = buffer_.data() + end_offset;
    }
    else
    {
        pos_ = nullptr;
        end_ = nullptr;
    }

    // Invalidate other
    other.handle_ = VFS_INVALID_HANDLE;
    other.pos_ = nullptr;
    other.end_ = nullptr;
}

ReadBufferFromVFS& ReadBufferFromVFS::operator=(ReadBufferFromVFS&& other) noexcept
{
    if (this != &other)
    {
        // Close current handle
        if (handle_ >= 0)
            vfs_close(handle_);

        // Calculate offsets BEFORE moving buffer
        size_t pos_offset = 0;
        size_t end_offset = 0;
        if (other.pos_ && !other.buffer_.empty())
        {
            pos_offset = static_cast<size_t>(other.pos_ - other.buffer_.data());
            end_offset = static_cast<size_t>(other.end_ - other.buffer_.data());
        }

        path_ = std::move(other.path_);
        handle_ = other.handle_;
        buf_size_ = other.buf_size_;
        file_size_ = other.file_size_;
        bytes_read_ = other.bytes_read_;
        file_offset_ = other.file_offset_;
        eof_reached_ = other.eof_reached_;
        buffer_ = std::move(other.buffer_);

        // Set positions in new buffer
        if (!buffer_.empty())
        {
            pos_ = buffer_.data() + pos_offset;
            end_ = buffer_.data() + end_offset;
        }
        else
        {
            pos_ = nullptr;
            end_ = nullptr;
        }

        // Invalidate other
        other.handle_ = VFS_INVALID_HANDLE;
        other.pos_ = nullptr;
        other.end_ = nullptr;
    }
    return *this;
}

// =============================================================================
// Buffer management
// =============================================================================

bool ReadBufferFromVFS::nextImpl()
{
    if (handle_ < 0)
        return false;

    if (eof_reached_)
        return false;

    // Ensure buffer is allocated
    if (buffer_.empty())
        buffer_.resize(buf_size_);

    // Read next chunk
    int64_t bytes = vfs_read(handle_, buffer_.data(), buffer_.size());

    if (bytes <= 0)
    {
        // EOF or error
        eof_reached_ = true;
        pos_ = buffer_.data();
        end_ = buffer_.data();
        return false;
    }

    // Update buffer pointers
    pos_ = buffer_.data();
    end_ = buffer_.data() + bytes;

    // Track file position
    file_offset_ += bytes;

    return true;
}

void ReadBufferFromVFS::resetBuffer()
{
    // Clear buffer state (will be filled on next read)
    pos_ = buffer_.data();
    end_ = buffer_.data();
    eof_reached_ = false;
}

// =============================================================================
// Buffer state
// =============================================================================

bool ReadBufferFromVFS::eof()
{
    if (hasPendingData())
        return false;

    // Try to fill buffer
    return !nextImpl();
}

// =============================================================================
// Reading
// =============================================================================

size_t ReadBufferFromVFS::read(char* to, size_t n)
{
    size_t total = 0;

    while (n > 0)
    {
        // Check if we need to refill buffer
        if (!hasPendingData())
        {
            if (!nextImpl())
                break;  // EOF or error
        }

        // Copy from buffer
        size_t bytes = std::min(n, static_cast<size_t>(end_ - pos_));
        std::memcpy(to, pos_, bytes);

        pos_ += bytes;
        to += bytes;
        n -= bytes;
        total += bytes;
        bytes_read_ += bytes;
    }

    return total;
}

int ReadBufferFromVFS::readByte()
{
    if (!hasPendingData())
    {
        if (!nextImpl())
            return -1;  // EOF
    }

    bytes_read_++;
    return static_cast<unsigned char>(*pos_++);
}

int ReadBufferFromVFS::peek()
{
    if (!hasPendingData())
    {
        if (!nextImpl())
            return -1;  // EOF
    }

    return static_cast<unsigned char>(*pos_);
}

void ReadBufferFromVFS::ignore(size_t n)
{
    while (n > 0)
    {
        if (!hasPendingData())
        {
            if (!nextImpl())
                break;  // EOF or error
        }

        size_t bytes = std::min(n, static_cast<size_t>(end_ - pos_));
        pos_ += bytes;
        n -= bytes;
        bytes_read_ += bytes;
    }
}

// =============================================================================
// Positioning
// =============================================================================

int64_t ReadBufferFromVFS::seek(int64_t offset, int whence)
{
    if (handle_ < 0)
        return -1;

    // Calculate new absolute position
    int64_t new_pos = -1;

    switch (whence)
    {
        case VFS_SEEK_SET:
            new_pos = offset;
            break;
        case VFS_SEEK_CUR:
            // Current position is file_offset_ minus buffered bytes minus consumed bytes
            new_pos = getPosition() + offset;
            break;
        case VFS_SEEK_END:
            new_pos = static_cast<int64_t>(file_size_) + offset;
            break;
        default:
            return -1;
    }

    // Validate position
    if (new_pos < 0)
        return -1;

    // Check if new position is within current buffer
    int64_t current_file_pos = getPosition();
    int64_t buffer_start = file_offset_ - static_cast<int64_t>(end_ - buffer_.data());
    int64_t buffer_end = file_offset_;

    if (new_pos >= buffer_start && new_pos < buffer_end)
    {
        // Position is within buffer, just adjust pos_
        size_t offset_in_buffer = static_cast<size_t>(new_pos - buffer_start);
        pos_ = buffer_.data() + offset_in_buffer;
        return new_pos;
    }

    // Need to seek in file and reset buffer
    int64_t result = vfs_seek(handle_, new_pos, VFS_SEEK_SET);
    if (result < 0)
        return result;

    file_offset_ = result;
    resetBuffer();

    return result;
}

int64_t ReadBufferFromVFS::getPosition() const
{
    if (handle_ < 0)
        return -1;

    // Current position = file offset after last read - remaining bytes in buffer
    int64_t remaining = end_ - pos_;
    return file_offset_ - remaining;
}

size_t ReadBufferFromVFS::pread(char* to, size_t n, int64_t offset)
{
    if (handle_ < 0)
        return 0;

    // Save current position
    int64_t saved_pos = getPosition();

    // Seek to requested position
    if (seek(offset, VFS_SEEK_SET) < 0)
        return 0;

    // Read data
    size_t bytes_read = read(to, n);

    // Restore position
    seek(saved_pos, VFS_SEEK_SET);

    return bytes_read;
}

} // namespace DB
