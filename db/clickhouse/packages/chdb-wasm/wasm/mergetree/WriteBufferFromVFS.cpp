/**
 * WriteBufferFromVFS.cpp - VFS-backed WriteBuffer implementation
 *
 * This file implements the WriteBufferFromVFS class which provides buffered
 * writing to the VFS layer for MergeTree storage.
 */

#include "WriteBufferFromVFS.h"
#include <sstream>

namespace DB
{

// Error codes namespace extension (IO_ERROR - using different name to avoid system EIO macro conflict)
namespace ErrorCodes
{
    constexpr int IO_ERROR = 5;
}

// =============================================================================
// Constructor
// =============================================================================

WriteBufferFromVFS::WriteBufferFromVFS(
    const std::string& path,
    size_t buf_size,
    int32_t flags)
    : WriteBuffer(nullptr, 0)
    , path_(path)
    , buffer_storage_(buf_size)
{
    // Open the file via VFS
    handle_ = vfs_open(path.c_str(), flags);
    if (handle_ < 0)
    {
        std::ostringstream ss;
        ss << "Cannot open file for writing: " << path << " (error: " << handle_ << ")";
        throw Exception(ErrorCodes::FILE_DOESNT_EXIST, ss.str());
    }

    // Set up the working buffer to point to our storage
    set(buffer_storage_.data(), buffer_storage_.size());
}

// =============================================================================
// Destructor
// =============================================================================

WriteBufferFromVFS::~WriteBufferFromVFS()
{
    // Ensure finalize is called (WriteBuffer base destructor also calls it,
    // but we need to do it first to ensure proper cleanup)
    try
    {
        if (!finalized && handle_ >= 0)
        {
            finalize();
        }
    }
    catch (...)
    {
        // Suppress exceptions in destructor
    }

    // Close the file handle
    if (handle_ >= 0)
    {
        vfs_close(handle_);
        handle_ = VFS_INVALID_HANDLE;
    }
}

// =============================================================================
// nextImpl - Flush buffer to VFS
// =============================================================================

void WriteBufferFromVFS::nextImpl()
{
    if (handle_ < 0)
    {
        throw Exception(ErrorCodes::LOGICAL_ERROR, "Cannot write to closed file: " + path_);
    }

    flushBuffer();

    // Reset buffer position
    pos = working_buffer.begin();
}

// =============================================================================
// finalize - Complete the write operation
// =============================================================================

void WriteBufferFromVFS::finalize()
{
    if (finalized)
        return;

    // Flush any remaining buffered data
    if (pos > working_buffer.begin())
    {
        flushBuffer();
    }

    // Sync to ensure durability
    if (handle_ >= 0)
    {
        int32_t result = vfs_fsync(handle_);
        if (result < 0)
        {
            std::ostringstream ss;
            ss << "Failed to sync file: " << path_ << " (error: " << result << ")";
            throw Exception(ErrorCodes::IO_ERROR, ss.str());
        }
    }

    finalized = true;
}

// =============================================================================
// flushBuffer - Internal helper to write buffer to VFS
// =============================================================================

void WriteBufferFromVFS::flushBuffer()
{
    size_t bytes_to_write = pos - working_buffer.begin();
    if (bytes_to_write == 0)
        return;

    const char* data = working_buffer.begin();
    size_t bytes_remaining = bytes_to_write;

    // Write in a loop to handle partial writes
    while (bytes_remaining > 0)
    {
        int64_t written = vfs_write(handle_, data, bytes_remaining);

        if (written < 0)
        {
            std::ostringstream ss;
            ss << "Write error on file: " << path_ << " (error: " << written << ")";
            throw Exception(ErrorCodes::IO_ERROR, ss.str());
        }

        if (written == 0)
        {
            // Should not happen with VFS, but handle gracefully
            throw Exception(ErrorCodes::IO_ERROR, "Write returned 0 bytes: " + path_);
        }

        data += written;
        bytes_remaining -= written;
        bytes_written_ += written;
    }
}

} // namespace DB
