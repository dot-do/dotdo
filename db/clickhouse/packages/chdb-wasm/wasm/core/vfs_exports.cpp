/**
 * vfs_exports.cpp - Virtual File System Implementation for Core MAIN_MODULE
 *
 * This module provides an in-memory Virtual File System (VFS) that allows
 * side modules and JavaScript to perform file operations without actual
 * filesystem access.
 *
 * Features:
 * - In-memory file storage with dynamic sizing
 * - Standard file operations: open, read, write, close, seek, size
 * - Support for basic file flags (O_RDONLY, O_WRONLY, O_RDWR, O_CREAT)
 * - Thread-safe design (single-threaded in WASM context)
 *
 * This VFS is designed for the Cloudflare Workers environment where
 * traditional filesystem access is not available.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include "exports.h"

// ============================================================================
// VFS Constants
// ============================================================================

#define MAX_OPEN_FILES 64
#define MAX_PATH_LENGTH 256
#define INITIAL_FILE_CAPACITY 1024
#define MAX_VIRTUAL_FILES 128

// File open flags (compatible with POSIX-like values)
#define VFS_O_RDONLY 0x00
#define VFS_O_WRONLY 0x01
#define VFS_O_RDWR   0x02
#define VFS_O_CREAT  0x40
#define VFS_O_TRUNC  0x200

// Seek whence values
#define VFS_SEEK_SET 0
#define VFS_SEEK_CUR 1
#define VFS_SEEK_END 2

// ============================================================================
// VFS Data Structures
// ============================================================================

/**
 * Virtual file stored in memory.
 */
struct VirtualFile {
    char path[MAX_PATH_LENGTH];
    unsigned char* data;
    int size;
    int capacity;
    bool exists;
};

/**
 * Open file descriptor state.
 */
struct FileDescriptor {
    int file_index;  // Index into g_vfs_files array
    int position;    // Current read/write position
    int flags;       // Open flags
    bool in_use;     // Whether this fd is currently open
};

// ============================================================================
// VFS Global State
// ============================================================================

static struct {
    VirtualFile files[MAX_VIRTUAL_FILES];
    FileDescriptor descriptors[MAX_OPEN_FILES];
    int file_count;
    bool initialized;
} g_vfs = {
    .files = {},
    .descriptors = {},
    .file_count = 0,
    .initialized = false
};

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * Initialize VFS if not already done.
 */
static void vfs_ensure_init(void) {
    if (g_vfs.initialized) {
        return;
    }

    for (int i = 0; i < MAX_VIRTUAL_FILES; i++) {
        g_vfs.files[i].path[0] = '\0';
        g_vfs.files[i].data = nullptr;
        g_vfs.files[i].size = 0;
        g_vfs.files[i].capacity = 0;
        g_vfs.files[i].exists = false;
    }

    for (int i = 0; i < MAX_OPEN_FILES; i++) {
        g_vfs.descriptors[i].file_index = -1;
        g_vfs.descriptors[i].position = 0;
        g_vfs.descriptors[i].flags = 0;
        g_vfs.descriptors[i].in_use = false;
    }

    g_vfs.file_count = 0;
    g_vfs.initialized = true;
}

/**
 * Find a file by path.
 * @return File index, or -1 if not found
 */
static int vfs_find_file(const char* path) {
    for (int i = 0; i < MAX_VIRTUAL_FILES; i++) {
        if (g_vfs.files[i].exists && strcmp(g_vfs.files[i].path, path) == 0) {
            return i;
        }
    }
    return -1;
}

/**
 * Create a new virtual file.
 * @return File index, or -1 on failure
 */
static int vfs_create_file(const char* path) {
    // Find a free slot
    int slot = -1;
    for (int i = 0; i < MAX_VIRTUAL_FILES; i++) {
        if (!g_vfs.files[i].exists) {
            slot = i;
            break;
        }
    }

    if (slot < 0) {
        return -1; // No free slots
    }

    // Initialize the file
    strncpy(g_vfs.files[slot].path, path, MAX_PATH_LENGTH - 1);
    g_vfs.files[slot].path[MAX_PATH_LENGTH - 1] = '\0';
    g_vfs.files[slot].data = (unsigned char*)malloc(INITIAL_FILE_CAPACITY);
    g_vfs.files[slot].size = 0;
    g_vfs.files[slot].capacity = INITIAL_FILE_CAPACITY;
    g_vfs.files[slot].exists = true;

    if (!g_vfs.files[slot].data) {
        g_vfs.files[slot].exists = false;
        return -1;
    }

    g_vfs.file_count++;
    return slot;
}

/**
 * Allocate a file descriptor.
 * @return fd (>= 0), or -1 on failure
 */
static int vfs_alloc_fd(int file_index, int flags) {
    for (int i = 0; i < MAX_OPEN_FILES; i++) {
        if (!g_vfs.descriptors[i].in_use) {
            g_vfs.descriptors[i].file_index = file_index;
            g_vfs.descriptors[i].position = 0;
            g_vfs.descriptors[i].flags = flags;
            g_vfs.descriptors[i].in_use = true;
            return i;
        }
    }
    return -1;
}

/**
 * Validate a file descriptor.
 * @return true if valid, false otherwise
 */
static bool vfs_valid_fd(int fd) {
    return fd >= 0 && fd < MAX_OPEN_FILES && g_vfs.descriptors[fd].in_use;
}

/**
 * Ensure file has enough capacity.
 * @return true on success, false on allocation failure
 */
static bool vfs_ensure_capacity(int file_index, int required) {
    VirtualFile* file = &g_vfs.files[file_index];

    if (file->capacity >= required) {
        return true;
    }

    // Double capacity until sufficient
    int new_capacity = file->capacity;
    while (new_capacity < required) {
        new_capacity *= 2;
    }

    unsigned char* new_data = (unsigned char*)realloc(file->data, new_capacity);
    if (!new_data) {
        return false;
    }

    file->data = new_data;
    file->capacity = new_capacity;
    return true;
}

// ============================================================================
// VFS Public API
// ============================================================================

extern "C" {

EMSCRIPTEN_KEEPALIVE
int vfs_open(const char* path, int flags) {
    vfs_ensure_init();

    if (!path) {
        return -1;
    }

    int file_index = vfs_find_file(path);

    // If file doesn't exist and O_CREAT is set, create it
    if (file_index < 0) {
        if (flags & VFS_O_CREAT) {
            file_index = vfs_create_file(path);
            if (file_index < 0) {
                return -1; // Failed to create
            }
        } else {
            return -1; // File not found and O_CREAT not set
        }
    }

    // If O_TRUNC is set, truncate the file
    if (flags & VFS_O_TRUNC) {
        g_vfs.files[file_index].size = 0;
    }

    // Allocate a file descriptor
    int fd = vfs_alloc_fd(file_index, flags);
    return fd;
}

EMSCRIPTEN_KEEPALIVE
int vfs_read(int fd, void* buffer, int count) {
    if (!vfs_valid_fd(fd) || !buffer || count < 0) {
        return -1;
    }

    FileDescriptor* desc = &g_vfs.descriptors[fd];
    VirtualFile* file = &g_vfs.files[desc->file_index];

    // Calculate how much we can read
    int available = file->size - desc->position;
    if (available <= 0) {
        return 0; // EOF
    }

    int to_read = (count < available) ? count : available;
    memcpy(buffer, file->data + desc->position, to_read);
    desc->position += to_read;

    return to_read;
}

EMSCRIPTEN_KEEPALIVE
int vfs_write(int fd, const void* buffer, int count) {
    if (!vfs_valid_fd(fd) || !buffer || count < 0) {
        return -1;
    }

    FileDescriptor* desc = &g_vfs.descriptors[fd];
    VirtualFile* file = &g_vfs.files[desc->file_index];

    // Ensure we have enough capacity
    int required = desc->position + count;
    if (!vfs_ensure_capacity(desc->file_index, required)) {
        return -1; // Allocation failed
    }

    // Write the data
    memcpy(file->data + desc->position, buffer, count);
    desc->position += count;

    // Update file size if we wrote past the end
    if (desc->position > file->size) {
        file->size = desc->position;
    }

    return count;
}

EMSCRIPTEN_KEEPALIVE
int vfs_close(int fd) {
    if (!vfs_valid_fd(fd)) {
        return -1;
    }

    g_vfs.descriptors[fd].in_use = false;
    g_vfs.descriptors[fd].file_index = -1;
    g_vfs.descriptors[fd].position = 0;
    g_vfs.descriptors[fd].flags = 0;

    return 0;
}

EMSCRIPTEN_KEEPALIVE
int vfs_seek(int fd, int offset, int whence) {
    if (!vfs_valid_fd(fd)) {
        return -1;
    }

    FileDescriptor* desc = &g_vfs.descriptors[fd];
    VirtualFile* file = &g_vfs.files[desc->file_index];

    int new_position;

    switch (whence) {
        case VFS_SEEK_SET:
            new_position = offset;
            break;
        case VFS_SEEK_CUR:
            new_position = desc->position + offset;
            break;
        case VFS_SEEK_END:
            new_position = file->size + offset;
            break;
        default:
            return -1; // Invalid whence
    }

    if (new_position < 0) {
        return -1; // Cannot seek before start
    }

    desc->position = new_position;
    return new_position;
}

EMSCRIPTEN_KEEPALIVE
int vfs_size(int fd) {
    if (!vfs_valid_fd(fd)) {
        return -1;
    }

    FileDescriptor* desc = &g_vfs.descriptors[fd];
    return g_vfs.files[desc->file_index].size;
}

} // extern "C"
