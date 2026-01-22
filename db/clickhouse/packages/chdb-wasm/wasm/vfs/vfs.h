/**
 * VFS Interface - C API for WASM
 *
 * This header defines the Virtual File System interface for MergeTree storage
 * in Cloudflare Workers. It bridges WASM file operations to Cloudflare's
 * storage primitives: Durable Objects (DO) for metadata and R2 for data.
 *
 * @see wasm/docs/MERGETREE_VFS_DESIGN.md for full design documentation
 */

#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// ---------------------------------------------------------------------------
// File Handle Type
// ---------------------------------------------------------------------------

typedef int32_t vfs_handle_t;
#define VFS_INVALID_HANDLE (-1)

// ---------------------------------------------------------------------------
// File Mode Flags
// ---------------------------------------------------------------------------

#define VFS_O_RDONLY    0x0001
#define VFS_O_WRONLY    0x0002
#define VFS_O_RDWR      0x0003
#define VFS_O_CREAT     0x0100
#define VFS_O_TRUNC     0x0200
#define VFS_O_APPEND    0x0400
#define VFS_O_EXCL      0x0800

// ---------------------------------------------------------------------------
// Seek Origins
// ---------------------------------------------------------------------------

#define VFS_SEEK_SET    0
#define VFS_SEEK_CUR    1
#define VFS_SEEK_END    2

// ---------------------------------------------------------------------------
// File Type Constants
// ---------------------------------------------------------------------------

#define VFS_S_IFREG     0x8000  // Regular file
#define VFS_S_IFDIR     0x4000  // Directory

// ---------------------------------------------------------------------------
// Stat Structure
// ---------------------------------------------------------------------------

typedef struct vfs_stat {
    uint32_t mode;       // File mode (VFS_S_IFREG, VFS_S_IFDIR)
    uint32_t _pad0;      // Padding for alignment
    uint64_t size;       // File size in bytes
    uint64_t mtime;      // Modification time (Unix timestamp ms)
    uint64_t ctime;      // Creation time (Unix timestamp ms)
} vfs_stat_t;

// ---------------------------------------------------------------------------
// Directory Entry Structure
// ---------------------------------------------------------------------------

typedef struct vfs_dirent {
    char name[256];      // Entry name (null-terminated)
    uint32_t type;       // Entry type (VFS_S_IFREG or VFS_S_IFDIR)
    uint32_t _pad0;      // Padding for alignment
    uint64_t size;       // File size (0 for directories)
} vfs_dirent_t;

// ---------------------------------------------------------------------------
// Error Codes
// ---------------------------------------------------------------------------

#define VFS_OK           0
#define VFS_ENOENT      (-2)   // No such file or directory
#define VFS_EIO         (-5)   // I/O error
#define VFS_EBADF       (-9)   // Bad file descriptor
#define VFS_EEXIST      (-17)  // File exists
#define VFS_ENOTDIR     (-20)  // Not a directory
#define VFS_EISDIR      (-21)  // Is a directory
#define VFS_EINVAL      (-22)  // Invalid argument
#define VFS_ENOSPC      (-28)  // No space left
#define VFS_ENOTEMPTY   (-39)  // Directory not empty

// ---------------------------------------------------------------------------
// Core File Operations
// ---------------------------------------------------------------------------

/**
 * Open a file
 * @param path   Path to file (relative to table root)
 * @param flags  Open mode flags (VFS_O_*)
 * @return       File handle or negative error code
 */
vfs_handle_t vfs_open(const char* path, int32_t flags);

/**
 * Close a file handle
 * @param handle File handle from vfs_open
 * @return       VFS_OK or negative error code
 */
int32_t vfs_close(vfs_handle_t handle);

/**
 * Read data from file
 * @param handle  File handle
 * @param buffer  Destination buffer (in WASM linear memory)
 * @param size    Maximum bytes to read
 * @return        Bytes read, 0 for EOF, or negative error code
 */
int64_t vfs_read(vfs_handle_t handle, void* buffer, size_t size);

/**
 * Write data to file
 * @param handle  File handle
 * @param buffer  Source buffer (in WASM linear memory)
 * @param size    Bytes to write
 * @return        Bytes written or negative error code
 */
int64_t vfs_write(vfs_handle_t handle, const void* buffer, size_t size);

/**
 * Seek to position in file
 * @param handle  File handle
 * @param offset  Offset from origin
 * @param whence  Origin (VFS_SEEK_SET, VFS_SEEK_CUR, VFS_SEEK_END)
 * @return        New position or negative error code
 */
int64_t vfs_seek(vfs_handle_t handle, int64_t offset, int32_t whence);

/**
 * Get file/directory status
 * @param path    Path to file or directory
 * @param st      Output stat structure
 * @return        VFS_OK or negative error code
 */
int32_t vfs_stat(const char* path, vfs_stat_t* st);

/**
 * Get file status by handle
 * @param handle  File handle
 * @param st      Output stat structure
 * @return        VFS_OK or negative error code
 */
int32_t vfs_fstat(vfs_handle_t handle, vfs_stat_t* st);

// ---------------------------------------------------------------------------
// Directory Operations
// ---------------------------------------------------------------------------

/**
 * Create a directory
 * @param path  Path to new directory
 * @param mode  Permission mode (ignored in R2/DO context)
 * @return      VFS_OK or negative error code
 */
int32_t vfs_mkdir(const char* path, int32_t mode);

/**
 * Open a directory for reading
 * @param path  Path to directory
 * @return      Directory handle or negative error code
 */
vfs_handle_t vfs_opendir(const char* path);

/**
 * Read next directory entry
 * @param handle  Directory handle
 * @param entry   Output directory entry
 * @return        VFS_OK if entry read, VFS_ENOENT if no more entries
 */
int32_t vfs_readdir(vfs_handle_t handle, vfs_dirent_t* entry);

/**
 * Close directory handle
 * @param handle  Directory handle
 * @return        VFS_OK or negative error code
 */
int32_t vfs_closedir(vfs_handle_t handle);

// ---------------------------------------------------------------------------
// File Management Operations
// ---------------------------------------------------------------------------

/**
 * Remove a file
 * @param path  Path to file
 * @return      VFS_OK or negative error code
 */
int32_t vfs_unlink(const char* path);

/**
 * Remove a directory
 * @param path  Path to directory (must be empty)
 * @return      VFS_OK or negative error code
 */
int32_t vfs_rmdir(const char* path);

/**
 * Rename/move a file or directory
 * @param oldpath  Current path
 * @param newpath  New path
 * @return         VFS_OK or negative error code
 */
int32_t vfs_rename(const char* oldpath, const char* newpath);

/**
 * Synchronize file data to storage
 * @param handle  File handle
 * @return        VFS_OK or negative error code
 */
int32_t vfs_fsync(vfs_handle_t handle);

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize VFS with table context
 * @param database  Database name
 * @param table     Table name
 * @return          VFS_OK or negative error code
 */
int32_t vfs_init(const char* database, const char* table);

/**
 * Shutdown VFS and flush pending writes
 * @return  VFS_OK or negative error code
 */
int32_t vfs_shutdown(void);

#ifdef __cplusplus
}
#endif
