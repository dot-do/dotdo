/**
 * VFS Implementation - Emscripten bindings
 *
 * This file implements the VFS C interface by bridging to JavaScript
 * using Emscripten's EM_ASYNC_JS for async operations and EM_JS for
 * synchronous operations.
 *
 * The JavaScript side (vfs_bridge.ts) receives these calls and delegates
 * to Cloudflare's Durable Objects and R2 storage.
 */

#include "vfs.h"

#include <emscripten.h>
#include <emscripten/em_js.h>

// ===========================================================================
// JavaScript Bridge Functions (EM_ASYNC_JS for async operations)
// ===========================================================================

// Note: EM_ASYNC_JS requires JSPI (JavaScript Promise Integration)
// These functions call into Module.vfsBridge which is set up by vfs_bridge.ts

EM_ASYNC_JS(int32_t, js_vfs_open, (const char* path, int32_t flags), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        console.error('VFS bridge not initialized');
        return -22; // VFS_EINVAL
    }
    try {
        return await vfs.vfs_open(path, flags);
    } catch (e) {
        console.error('js_vfs_open error:', e);
        return -5; // VFS_EIO
    }
});

EM_ASYNC_JS(int32_t, js_vfs_close, (int32_t handle), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -9; // VFS_EBADF
    }
    try {
        return await vfs.vfs_close(handle);
    } catch (e) {
        console.error('js_vfs_close error:', e);
        return -5; // VFS_EIO
    }
});

EM_ASYNC_JS(int64_t, js_vfs_read, (int32_t handle, void* buffer, size_t size), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -9; // VFS_EBADF
    }
    try {
        return await vfs.vfs_read(handle, buffer, size);
    } catch (e) {
        console.error('js_vfs_read error:', e);
        return -5; // VFS_EIO
    }
});

EM_ASYNC_JS(int64_t, js_vfs_write, (int32_t handle, const void* buffer, size_t size), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -9; // VFS_EBADF
    }
    try {
        return await vfs.vfs_write(handle, buffer, size);
    } catch (e) {
        console.error('js_vfs_write error:', e);
        return -5; // VFS_EIO
    }
});

// vfs_seek is synchronous - it only updates in-memory position
EM_JS(int64_t, js_vfs_seek, (int32_t handle, int64_t offset, int32_t whence), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -9; // VFS_EBADF
    }
    try {
        return vfs.vfs_seek(handle, offset, whence);
    } catch (e) {
        console.error('js_vfs_seek error:', e);
        return -22; // VFS_EINVAL
    }
});

EM_ASYNC_JS(int32_t, js_vfs_stat, (const char* path, void* st), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -22; // VFS_EINVAL
    }
    try {
        return await vfs.vfs_stat(path, st);
    } catch (e) {
        console.error('js_vfs_stat error:', e);
        return -5; // VFS_EIO
    }
});

EM_ASYNC_JS(int32_t, js_vfs_fstat, (int32_t handle, void* st), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -22; // VFS_EINVAL
    }
    try {
        return await vfs.vfs_fstat(handle, st);
    } catch (e) {
        console.error('js_vfs_fstat error:', e);
        return -5; // VFS_EIO
    }
});

EM_ASYNC_JS(int32_t, js_vfs_mkdir, (const char* path, int32_t mode), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -22; // VFS_EINVAL
    }
    try {
        return await vfs.vfs_mkdir(path, mode);
    } catch (e) {
        console.error('js_vfs_mkdir error:', e);
        return -5; // VFS_EIO
    }
});

EM_ASYNC_JS(int32_t, js_vfs_opendir, (const char* path), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -22; // VFS_EINVAL
    }
    try {
        return await vfs.vfs_opendir(path);
    } catch (e) {
        console.error('js_vfs_opendir error:', e);
        return -5; // VFS_EIO
    }
});

// vfs_readdir is synchronous - entries are pre-loaded in opendir
EM_JS(int32_t, js_vfs_readdir, (int32_t handle, void* entry), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -9; // VFS_EBADF
    }
    try {
        return vfs.vfs_readdir(handle, entry);
    } catch (e) {
        console.error('js_vfs_readdir error:', e);
        return -5; // VFS_EIO
    }
});

// vfs_closedir is synchronous
EM_JS(int32_t, js_vfs_closedir, (int32_t handle), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -9; // VFS_EBADF
    }
    try {
        return vfs.vfs_closedir(handle);
    } catch (e) {
        console.error('js_vfs_closedir error:', e);
        return -5; // VFS_EIO
    }
});

EM_ASYNC_JS(int32_t, js_vfs_unlink, (const char* path), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -22; // VFS_EINVAL
    }
    try {
        return await vfs.vfs_unlink(path);
    } catch (e) {
        console.error('js_vfs_unlink error:', e);
        return -5; // VFS_EIO
    }
});

EM_ASYNC_JS(int32_t, js_vfs_rmdir, (const char* path), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -22; // VFS_EINVAL
    }
    try {
        return await vfs.vfs_rmdir(path);
    } catch (e) {
        console.error('js_vfs_rmdir error:', e);
        return -5; // VFS_EIO
    }
});

EM_ASYNC_JS(int32_t, js_vfs_rename, (const char* oldpath, const char* newpath), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -22; // VFS_EINVAL
    }
    try {
        return await vfs.vfs_rename(oldpath, newpath);
    } catch (e) {
        console.error('js_vfs_rename error:', e);
        return -5; // VFS_EIO
    }
});

EM_ASYNC_JS(int32_t, js_vfs_fsync, (int32_t handle), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return -9; // VFS_EBADF
    }
    try {
        return await vfs.vfs_fsync(handle);
    } catch (e) {
        console.error('js_vfs_fsync error:', e);
        return -5; // VFS_EIO
    }
});

EM_ASYNC_JS(int32_t, js_vfs_init, (const char* database, const char* table), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        console.error('VFS bridge not set up before vfs_init');
        return -22; // VFS_EINVAL
    }
    try {
        return await vfs.vfs_init(database, table);
    } catch (e) {
        console.error('js_vfs_init error:', e);
        return -5; // VFS_EIO
    }
});

EM_ASYNC_JS(int32_t, js_vfs_shutdown, (), {
    const vfs = Module.vfsBridge;
    if (!vfs) {
        return 0; // Already shut down or never initialized
    }
    try {
        return await vfs.vfs_shutdown();
    } catch (e) {
        console.error('js_vfs_shutdown error:', e);
        return -5; // VFS_EIO
    }
});

// ===========================================================================
// C API Implementation (calls into JS)
// ===========================================================================

extern "C" {

vfs_handle_t vfs_open(const char* path, int32_t flags) {
    return js_vfs_open(path, flags);
}

int32_t vfs_close(vfs_handle_t handle) {
    return js_vfs_close(handle);
}

int64_t vfs_read(vfs_handle_t handle, void* buffer, size_t size) {
    return js_vfs_read(handle, buffer, size);
}

int64_t vfs_write(vfs_handle_t handle, const void* buffer, size_t size) {
    return js_vfs_write(handle, buffer, size);
}

int64_t vfs_seek(vfs_handle_t handle, int64_t offset, int32_t whence) {
    return js_vfs_seek(handle, offset, whence);
}

int32_t vfs_stat(const char* path, vfs_stat_t* st) {
    return js_vfs_stat(path, st);
}

int32_t vfs_fstat(vfs_handle_t handle, vfs_stat_t* st) {
    return js_vfs_fstat(handle, st);
}

int32_t vfs_mkdir(const char* path, int32_t mode) {
    return js_vfs_mkdir(path, mode);
}

vfs_handle_t vfs_opendir(const char* path) {
    return js_vfs_opendir(path);
}

int32_t vfs_readdir(vfs_handle_t handle, vfs_dirent_t* entry) {
    return js_vfs_readdir(handle, entry);
}

int32_t vfs_closedir(vfs_handle_t handle) {
    return js_vfs_closedir(handle);
}

int32_t vfs_unlink(const char* path) {
    return js_vfs_unlink(path);
}

int32_t vfs_rmdir(const char* path) {
    return js_vfs_rmdir(path);
}

int32_t vfs_rename(const char* oldpath, const char* newpath) {
    return js_vfs_rename(oldpath, newpath);
}

int32_t vfs_fsync(vfs_handle_t handle) {
    return js_vfs_fsync(handle);
}

int32_t vfs_init(const char* database, const char* table) {
    return js_vfs_init(database, table);
}

int32_t vfs_shutdown(void) {
    return js_vfs_shutdown();
}

} // extern "C"
