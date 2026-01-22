/**
 * VFS Bridge - TypeScript/JavaScript bridge for WASM VFS
 *
 * This module receives VFS calls from the WASM module (via EM_ASYNC_JS bindings)
 * and delegates to Cloudflare's Durable Objects (DO) for metadata and R2 for data.
 *
 * Path structure for MergeTree data:
 *   data/{partition}/{part_name}/{file}
 *
 * Routing rules:
 * - Data files (*.bin, *.mrk*, *.idx) -> R2 storage
 * - Metadata files (checksums.txt, columns.txt, count.txt) -> R2 storage
 * - Directory operations (list parts, partitions) -> DO + R2
 * - Part registry and schema -> DO only
 *
 * Usage:
 *   const bridge = new VFSBridge(storage);
 *   Module.vfsBridge = bridge;  // Set on Emscripten Module before WASM init
 */

import type { MergeTreeR2Storage } from '../../configs/chdb-lake/MergeTreeR2';
import type { MergeTreeDO, PartInfo } from '../../configs/chdb-lake/MergeTreeDO';

// ---------------------------------------------------------------------------
// VFS Constants (must match vfs.h)
// ---------------------------------------------------------------------------

export const VFS_O_RDONLY = 0x0001;
export const VFS_O_WRONLY = 0x0002;
export const VFS_O_RDWR = 0x0003;
export const VFS_O_CREAT = 0x0100;
export const VFS_O_TRUNC = 0x0200;
export const VFS_O_APPEND = 0x0400;
export const VFS_O_EXCL = 0x0800;

export const VFS_SEEK_SET = 0;
export const VFS_SEEK_CUR = 1;
export const VFS_SEEK_END = 2;

export const VFS_S_IFREG = 0x8000;
export const VFS_S_IFDIR = 0x4000;

export const VFS_OK = 0;
export const VFS_ENOENT = -2;
export const VFS_EIO = -5;
export const VFS_EBADF = -9;
export const VFS_EEXIST = -17;
export const VFS_ENOTDIR = -20;
export const VFS_EISDIR = -21;
export const VFS_EINVAL = -22;
export const VFS_ENOSPC = -28;
export const VFS_ENOTEMPTY = -39;

// ---------------------------------------------------------------------------
// Storage Provider Interface
// ---------------------------------------------------------------------------

/**
 * File metadata
 */
export interface FileStat {
  size: number;
  mtime: number;
  ctime: number;
  isDirectory: boolean;
}

/**
 * Directory entry
 */
export interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}

/**
 * Storage provider interface - implemented by DO/R2 adapter
 */
export interface VFSStorageProvider {
  /**
   * Check if a file/directory exists and get metadata
   */
  stat(path: string): Promise<FileStat | null>;

  /**
   * Read file contents
   */
  read(path: string, offset: number, length: number): Promise<ArrayBuffer>;

  /**
   * Read entire file
   */
  readFile(path: string): Promise<ArrayBuffer>;

  /**
   * Write data to file (creates or overwrites)
   */
  write(path: string, data: ArrayBuffer): Promise<void>;

  /**
   * Append data to file (for streaming writes)
   */
  append(path: string, data: ArrayBuffer): Promise<void>;

  /**
   * Delete a file
   */
  delete(path: string): Promise<void>;

  /**
   * List directory contents
   */
  list(path: string): Promise<DirEntry[]>;

  /**
   * Create a directory (may be no-op for object storage)
   */
  mkdir(path: string): Promise<void>;

  /**
   * Rename/move a file
   */
  rename(oldPath: string, newPath: string): Promise<void>;

  /**
   * Flush pending writes
   */
  flush(): Promise<void>;
}

// ---------------------------------------------------------------------------
// File Handle State
// ---------------------------------------------------------------------------

interface FileHandle {
  id: number;
  path: string;
  flags: number;
  position: number;
  size: number;
  buffer?: ArrayBuffer; // Cached content for read operations
  writeBuffer?: Uint8Array[]; // Buffered writes
  writeBufferSize?: number;
}

interface DirHandle {
  id: number;
  path: string;
  entries: DirEntry[];
  position: number;
}

// ---------------------------------------------------------------------------
// VFS Bridge Class
// ---------------------------------------------------------------------------

/**
 * VFS Bridge - receives calls from WASM and delegates to storage provider
 */
export class VFSBridge {
  private storage: VFSStorageProvider;
  private database: string = '';
  private table: string = '';

  private nextHandleId = 1;
  private fileHandles: Map<number, FileHandle> = new Map();
  private dirHandles: Map<number, DirHandle> = new Map();

  // WASM memory access
  private wasmMemory: WebAssembly.Memory | null = null;

  // Write buffer threshold (256KB)
  private readonly WRITE_BUFFER_THRESHOLD = 256 * 1024;

  constructor(storage: VFSStorageProvider) {
    this.storage = storage;
  }

  /**
   * Set WASM memory for buffer operations
   */
  setWasmMemory(memory: WebAssembly.Memory): void {
    this.wasmMemory = memory;
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  async vfs_init(databasePtr: number, tablePtr: number): Promise<number> {
    this.database = this.readString(databasePtr);
    this.table = this.readString(tablePtr);
    return VFS_OK;
  }

  async vfs_shutdown(): Promise<number> {
    // Flush all pending writes
    for (const handle of this.fileHandles.values()) {
      if (handle.writeBuffer && handle.writeBuffer.length > 0) {
        await this.flushWriteBuffer(handle);
      }
    }

    // Close all handles
    this.fileHandles.clear();
    this.dirHandles.clear();

    await this.storage.flush();
    return VFS_OK;
  }

  // -------------------------------------------------------------------------
  // File Operations
  // -------------------------------------------------------------------------

  async vfs_open(pathPtr: number, flags: number): Promise<number> {
    const path = this.readString(pathPtr);
    if (!path) {
      return VFS_EINVAL;
    }

    try {
      const stat = await this.storage.stat(path);

      const isCreate = (flags & VFS_O_CREAT) !== 0;
      const isExcl = (flags & VFS_O_EXCL) !== 0;
      const isTrunc = (flags & VFS_O_TRUNC) !== 0;
      const isWrite = (flags & VFS_O_WRONLY) !== 0 || (flags & VFS_O_RDWR) !== 0;

      // File doesn't exist
      if (!stat) {
        if (!isCreate) {
          return VFS_ENOENT;
        }
        // Will create on first write
      } else {
        // File exists
        if (isCreate && isExcl) {
          return VFS_EEXIST;
        }
        if (stat.isDirectory) {
          return VFS_EISDIR;
        }
      }

      const handle: FileHandle = {
        id: this.nextHandleId++,
        path,
        flags,
        position: 0,
        size: stat?.size ?? 0,
      };

      // For write operations, initialize write buffer
      if (isWrite) {
        handle.writeBuffer = [];
        handle.writeBufferSize = 0;
        if (isTrunc) {
          handle.size = 0;
        }
      } else if (stat && stat.size < 1024 * 1024) {
        // For read operations on small files, cache content
        try {
          handle.buffer = await this.storage.readFile(path);
        } catch {
          // File might not exist yet
        }
      }

      this.fileHandles.set(handle.id, handle);
      return handle.id;
    } catch (error) {
      console.error('vfs_open error:', error);
      return VFS_EIO;
    }
  }

  async vfs_close(handleId: number): Promise<number> {
    const handle = this.fileHandles.get(handleId);
    if (!handle) {
      return VFS_EBADF;
    }

    try {
      // Flush any pending writes
      if (handle.writeBuffer && handle.writeBuffer.length > 0) {
        await this.flushWriteBuffer(handle);
      }

      this.fileHandles.delete(handleId);
      return VFS_OK;
    } catch (error) {
      console.error('vfs_close error:', error);
      return VFS_EIO;
    }
  }

  async vfs_read(handleId: number, bufferPtr: number, size: number): Promise<number> {
    const handle = this.fileHandles.get(handleId);
    if (!handle) {
      return VFS_EBADF;
    }

    // Check if opened for reading
    const accessMode = handle.flags & 0x0003;
    if (accessMode === VFS_O_WRONLY) {
      return VFS_EINVAL;
    }

    try {
      // Check for EOF
      if (handle.position >= handle.size) {
        return 0;
      }

      const bytesToRead = Math.min(size, handle.size - handle.position);
      let data: ArrayBuffer;

      if (handle.buffer) {
        // Read from cached buffer
        data = handle.buffer.slice(handle.position, handle.position + bytesToRead);
      } else {
        // Read from storage
        data = await this.storage.read(handle.path, handle.position, bytesToRead);
      }

      // Copy to WASM memory
      this.writeToWasm(bufferPtr, new Uint8Array(data));
      handle.position += data.byteLength;

      return data.byteLength;
    } catch (error) {
      console.error('vfs_read error:', error);
      return VFS_EIO;
    }
  }

  async vfs_write(handleId: number, bufferPtr: number, size: number): Promise<number> {
    const handle = this.fileHandles.get(handleId);
    if (!handle) {
      return VFS_EBADF;
    }

    // Check if opened for writing
    const accessMode = handle.flags & 0x0003;
    if (accessMode === VFS_O_RDONLY) {
      return VFS_EINVAL;
    }

    if (!handle.writeBuffer) {
      handle.writeBuffer = [];
      handle.writeBufferSize = 0;
    }

    try {
      // Read from WASM memory
      const data = this.readFromWasm(bufferPtr, size);

      // Buffer the write
      handle.writeBuffer.push(data);
      handle.writeBufferSize = (handle.writeBufferSize || 0) + data.length;
      handle.position += size;
      handle.size = Math.max(handle.size, handle.position);

      // Flush if buffer exceeds threshold
      if (handle.writeBufferSize >= this.WRITE_BUFFER_THRESHOLD) {
        await this.flushWriteBuffer(handle);
      }

      return size;
    } catch (error) {
      console.error('vfs_write error:', error);
      return VFS_EIO;
    }
  }

  vfs_seek(handleId: number, offset: number, whence: number): number {
    const handle = this.fileHandles.get(handleId);
    if (!handle) {
      return VFS_EBADF;
    }

    let newPosition: number;
    switch (whence) {
      case VFS_SEEK_SET:
        newPosition = offset;
        break;
      case VFS_SEEK_CUR:
        newPosition = handle.position + offset;
        break;
      case VFS_SEEK_END:
        newPosition = handle.size + offset;
        break;
      default:
        return VFS_EINVAL;
    }

    if (newPosition < 0) {
      return VFS_EINVAL;
    }

    handle.position = newPosition;
    return newPosition;
  }

  async vfs_stat(pathPtr: number, statPtr: number): Promise<number> {
    const path = this.readString(pathPtr);
    if (!path) {
      return VFS_EINVAL;
    }

    try {
      const stat = await this.storage.stat(path);

      if (!stat) {
        return VFS_ENOENT;
      }

      this.writeStatToWasm(statPtr, {
        mode: stat.isDirectory ? VFS_S_IFDIR : VFS_S_IFREG,
        size: stat.size,
        mtime: stat.mtime,
        ctime: stat.ctime,
      });

      return VFS_OK;
    } catch (error) {
      console.error('vfs_stat error:', error);
      return VFS_EIO;
    }
  }

  async vfs_fstat(handleId: number, statPtr: number): Promise<number> {
    const handle = this.fileHandles.get(handleId);
    if (!handle) {
      return VFS_EBADF;
    }

    try {
      const stat = await this.storage.stat(handle.path);

      this.writeStatToWasm(statPtr, {
        mode: VFS_S_IFREG,
        size: handle.size, // Use handle's size (may be updated by writes)
        mtime: stat?.mtime ?? Date.now(),
        ctime: stat?.ctime ?? Date.now(),
      });

      return VFS_OK;
    } catch (error) {
      console.error('vfs_fstat error:', error);
      return VFS_EIO;
    }
  }

  // -------------------------------------------------------------------------
  // Directory Operations
  // -------------------------------------------------------------------------

  async vfs_mkdir(pathPtr: number, _mode: number): Promise<number> {
    const path = this.readString(pathPtr);
    if (!path) {
      return VFS_EINVAL;
    }

    try {
      await this.storage.mkdir(path);
      return VFS_OK;
    } catch (error) {
      console.error('vfs_mkdir error:', error);
      return VFS_EIO;
    }
  }

  async vfs_opendir(pathPtr: number): Promise<number> {
    const path = this.readString(pathPtr);
    if (!path && path !== '') {
      return VFS_EINVAL;
    }

    try {
      const entries = await this.storage.list(path);

      const handle: DirHandle = {
        id: this.nextHandleId++,
        path,
        entries,
        position: 0,
      };

      this.dirHandles.set(handle.id, handle);
      return handle.id;
    } catch (error) {
      console.error('vfs_opendir error:', error);
      return VFS_EIO;
    }
  }

  vfs_readdir(handleId: number, entryPtr: number): number {
    const handle = this.dirHandles.get(handleId);
    if (!handle) {
      return VFS_EBADF;
    }

    if (handle.position >= handle.entries.length) {
      return VFS_ENOENT; // No more entries
    }

    const entry = handle.entries[handle.position];
    this.writeDirentToWasm(entryPtr, entry);
    handle.position++;

    return VFS_OK;
  }

  vfs_closedir(handleId: number): number {
    if (!this.dirHandles.has(handleId)) {
      return VFS_EBADF;
    }
    this.dirHandles.delete(handleId);
    return VFS_OK;
  }

  // -------------------------------------------------------------------------
  // File Management Operations
  // -------------------------------------------------------------------------

  async vfs_unlink(pathPtr: number): Promise<number> {
    const path = this.readString(pathPtr);
    if (!path) {
      return VFS_EINVAL;
    }

    try {
      const stat = await this.storage.stat(path);
      if (!stat) {
        return VFS_ENOENT;
      }
      if (stat.isDirectory) {
        return VFS_EISDIR;
      }

      await this.storage.delete(path);
      return VFS_OK;
    } catch (error) {
      console.error('vfs_unlink error:', error);
      return VFS_EIO;
    }
  }

  async vfs_rmdir(pathPtr: number): Promise<number> {
    const path = this.readString(pathPtr);
    if (!path) {
      return VFS_EINVAL;
    }

    try {
      const stat = await this.storage.stat(path);
      if (!stat) {
        return VFS_ENOENT;
      }
      if (!stat.isDirectory) {
        return VFS_ENOTDIR;
      }

      // Check if directory is empty
      const entries = await this.storage.list(path);
      if (entries.length > 0) {
        return VFS_ENOTEMPTY;
      }

      await this.storage.delete(path);
      return VFS_OK;
    } catch (error) {
      console.error('vfs_rmdir error:', error);
      return VFS_EIO;
    }
  }

  async vfs_rename(oldPathPtr: number, newPathPtr: number): Promise<number> {
    const oldPath = this.readString(oldPathPtr);
    const newPath = this.readString(newPathPtr);

    if (!oldPath || !newPath) {
      return VFS_EINVAL;
    }

    try {
      const stat = await this.storage.stat(oldPath);
      if (!stat) {
        return VFS_ENOENT;
      }

      await this.storage.rename(oldPath, newPath);
      return VFS_OK;
    } catch (error) {
      console.error('vfs_rename error:', error);
      return VFS_EIO;
    }
  }

  async vfs_fsync(handleId: number): Promise<number> {
    const handle = this.fileHandles.get(handleId);
    if (!handle) {
      return VFS_EBADF;
    }

    try {
      // Flush any pending writes
      if (handle.writeBuffer && handle.writeBuffer.length > 0) {
        await this.flushWriteBuffer(handle);
      }

      await this.storage.flush();
      return VFS_OK;
    } catch (error) {
      console.error('vfs_fsync error:', error);
      return VFS_EIO;
    }
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private async flushWriteBuffer(handle: FileHandle): Promise<void> {
    if (!handle.writeBuffer || handle.writeBuffer.length === 0) {
      return;
    }

    // Combine buffer chunks
    const totalSize = handle.writeBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of handle.writeBuffer) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Write to storage
    await this.storage.write(handle.path, combined.buffer);

    // Clear buffer
    handle.writeBuffer = [];
    handle.writeBufferSize = 0;
  }

  private readString(ptr: number): string {
    if (!this.wasmMemory || ptr === 0) return '';

    const view = new Uint8Array(this.wasmMemory.buffer);
    let end = ptr;
    while (view[end] !== 0 && end < view.length) end++;

    const bytes = view.slice(ptr, end);
    return new TextDecoder().decode(bytes);
  }

  private writeToWasm(ptr: number, data: Uint8Array): void {
    if (!this.wasmMemory) return;

    const view = new Uint8Array(this.wasmMemory.buffer);
    view.set(data, ptr);
  }

  private readFromWasm(ptr: number, size: number): Uint8Array {
    if (!this.wasmMemory) return new Uint8Array(0);

    const view = new Uint8Array(this.wasmMemory.buffer);
    // Return a copy, not a view, since the buffer might change
    return new Uint8Array(view.slice(ptr, ptr + size));
  }

  private writeStatToWasm(
    ptr: number,
    stat: { mode: number; size: number; mtime: number; ctime: number }
  ): void {
    if (!this.wasmMemory) return;

    const view = new DataView(this.wasmMemory.buffer);
    // vfs_stat_t layout:
    //   uint32_t mode     @ 0
    //   uint32_t _pad0    @ 4
    //   uint64_t size     @ 8
    //   uint64_t mtime    @ 16
    //   uint64_t ctime    @ 24
    view.setUint32(ptr + 0, stat.mode, true);
    view.setUint32(ptr + 4, 0, true); // padding
    view.setBigUint64(ptr + 8, BigInt(stat.size), true);
    view.setBigUint64(ptr + 16, BigInt(stat.mtime), true);
    view.setBigUint64(ptr + 24, BigInt(stat.ctime), true);
  }

  private writeDirentToWasm(ptr: number, entry: DirEntry): void {
    if (!this.wasmMemory) return;

    const view = new Uint8Array(this.wasmMemory.buffer);
    const dataView = new DataView(this.wasmMemory.buffer);

    // vfs_dirent_t layout:
    //   char name[256]    @ 0
    //   uint32_t type     @ 256
    //   uint32_t _pad0    @ 260
    //   uint64_t size     @ 264

    // Write name (256 bytes, null-terminated)
    const nameBytes = new TextEncoder().encode(entry.name);
    const nameLen = Math.min(nameBytes.length, 255);
    view.set(nameBytes.subarray(0, nameLen), ptr);
    view[ptr + nameLen] = 0; // Null terminator
    // Zero out rest of name buffer
    for (let i = nameLen + 1; i < 256; i++) {
      view[ptr + i] = 0;
    }

    // Write type
    dataView.setUint32(ptr + 256, entry.isDirectory ? VFS_S_IFDIR : VFS_S_IFREG, true);
    dataView.setUint32(ptr + 260, 0, true); // padding

    // Write size
    dataView.setBigUint64(ptr + 264, BigInt(entry.size), true);
  }
}

// ---------------------------------------------------------------------------
// In-Memory Storage Provider (for testing)
// ---------------------------------------------------------------------------

/**
 * Simple in-memory storage provider for testing
 */
export class InMemoryStorageProvider implements VFSStorageProvider {
  private files: Map<string, ArrayBuffer> = new Map();
  private directories: Set<string> = new Set();

  constructor() {
    // Root directory always exists
    this.directories.add('');
    this.directories.add('/');
  }

  async stat(path: string): Promise<FileStat | null> {
    const normalizedPath = this.normalizePath(path);

    if (this.directories.has(normalizedPath)) {
      return {
        size: 0,
        mtime: Date.now(),
        ctime: Date.now(),
        isDirectory: true,
      };
    }

    const data = this.files.get(normalizedPath);
    if (data) {
      return {
        size: data.byteLength,
        mtime: Date.now(),
        ctime: Date.now(),
        isDirectory: false,
      };
    }

    return null;
  }

  async read(path: string, offset: number, length: number): Promise<ArrayBuffer> {
    const normalizedPath = this.normalizePath(path);
    const data = this.files.get(normalizedPath);
    if (!data) {
      throw new Error(`File not found: ${path}`);
    }
    return data.slice(offset, offset + length);
  }

  async readFile(path: string): Promise<ArrayBuffer> {
    const normalizedPath = this.normalizePath(path);
    const data = this.files.get(normalizedPath);
    if (!data) {
      throw new Error(`File not found: ${path}`);
    }
    return data;
  }

  async write(path: string, data: ArrayBuffer): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    // Ensure parent directories exist
    this.ensureParentDirs(normalizedPath);
    this.files.set(normalizedPath, data);
  }

  async append(path: string, data: ArrayBuffer): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    const existing = this.files.get(normalizedPath);
    if (existing) {
      const combined = new Uint8Array(existing.byteLength + data.byteLength);
      combined.set(new Uint8Array(existing), 0);
      combined.set(new Uint8Array(data), existing.byteLength);
      this.files.set(normalizedPath, combined.buffer);
    } else {
      this.ensureParentDirs(normalizedPath);
      this.files.set(normalizedPath, data);
    }
  }

  async delete(path: string): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    this.files.delete(normalizedPath);
    this.directories.delete(normalizedPath);
  }

  async list(path: string): Promise<DirEntry[]> {
    const normalizedPath = this.normalizePath(path);
    const prefix = normalizedPath ? normalizedPath + '/' : '';
    const entries: Map<string, DirEntry> = new Map();

    // List files
    for (const [filePath, data] of this.files) {
      if (filePath.startsWith(prefix)) {
        const relativePath = filePath.slice(prefix.length);
        const parts = relativePath.split('/');
        const name = parts[0];

        if (parts.length === 1) {
          // Direct file
          entries.set(name, {
            name,
            isDirectory: false,
            size: data.byteLength,
          });
        } else {
          // Subdirectory
          if (!entries.has(name)) {
            entries.set(name, {
              name,
              isDirectory: true,
              size: 0,
            });
          }
        }
      }
    }

    // List explicit directories
    for (const dirPath of this.directories) {
      if (dirPath.startsWith(prefix) && dirPath !== normalizedPath) {
        const relativePath = dirPath.slice(prefix.length);
        const parts = relativePath.split('/');
        const name = parts[0];
        if (name && !entries.has(name)) {
          entries.set(name, {
            name,
            isDirectory: true,
            size: 0,
          });
        }
      }
    }

    return Array.from(entries.values());
  }

  async mkdir(path: string): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    this.ensureParentDirs(normalizedPath);
    this.directories.add(normalizedPath);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const normalizedOldPath = this.normalizePath(oldPath);
    const normalizedNewPath = this.normalizePath(newPath);

    const data = this.files.get(normalizedOldPath);
    if (data) {
      this.ensureParentDirs(normalizedNewPath);
      this.files.set(normalizedNewPath, data);
      this.files.delete(normalizedOldPath);
    } else if (this.directories.has(normalizedOldPath)) {
      // Rename directory and all contents
      const prefix = normalizedOldPath + '/';
      const newPrefix = normalizedNewPath + '/';

      // Move files
      for (const [filePath, fileData] of this.files) {
        if (filePath.startsWith(prefix)) {
          const newFilePath = newPrefix + filePath.slice(prefix.length);
          this.files.set(newFilePath, fileData);
          this.files.delete(filePath);
        }
      }

      // Move directories
      for (const dirPath of this.directories) {
        if (dirPath.startsWith(prefix)) {
          const newDirPath = newPrefix + dirPath.slice(prefix.length);
          this.directories.add(newDirPath);
          this.directories.delete(dirPath);
        }
      }

      this.directories.add(normalizedNewPath);
      this.directories.delete(normalizedOldPath);
    } else {
      throw new Error(`Path not found: ${oldPath}`);
    }
  }

  async flush(): Promise<void> {
    // No-op for in-memory storage
  }

  private normalizePath(path: string): string {
    // Remove leading/trailing slashes, normalize multiple slashes
    return path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  }

  private ensureParentDirs(path: string): void {
    const parts = path.split('/');
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i]) {
        current = current ? current + '/' + parts[i] : parts[i];
        this.directories.add(current);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Path Parsing for MergeTree Data
// ---------------------------------------------------------------------------

/**
 * Parsed MergeTree path components
 * Full path format: data/{partition}/{part_name}/{file}
 */
export interface ParsedMergeTreePath {
  /** 'data' for data files, 'metadata' for DO operations */
  type: 'data' | 'metadata' | 'root';
  /** Partition ID (e.g., '202401_1_1_0') */
  partition: string | null;
  /** Part name within partition */
  partName: string | null;
  /** File name within part */
  fileName: string | null;
  /** Original full path */
  fullPath: string;
}

/**
 * Parse a MergeTree VFS path into components
 *
 * Path structure:
 * - data/                              -> list partitions
 * - data/{partition}/                  -> list parts in partition
 * - data/{partition}/{part}/           -> list files in part
 * - data/{partition}/{part}/{file}     -> access file
 */
export function parseMergeTreePath(path: string): ParsedMergeTreePath {
  const normalized = path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  const parts = normalized.split('/').filter(Boolean);

  if (parts.length === 0 || parts[0] !== 'data') {
    // Root or metadata path
    return {
      type: parts[0] === 'metadata' ? 'metadata' : 'root',
      partition: null,
      partName: null,
      fileName: null,
      fullPath: normalized,
    };
  }

  return {
    type: 'data',
    partition: parts[1] || null,
    partName: parts[2] || null,
    fileName: parts[3] || null,
    fullPath: normalized,
  };
}

/**
 * Check if a file is a data file that should be stored in R2
 * Data files: *.bin, *.mrk, *.mrk2, *.mrk3, *.idx, *.cidx
 */
export function isDataFile(fileName: string): boolean {
  if (!fileName) return false;
  const ext = fileName.toLowerCase();
  return (
    ext.endsWith('.bin') ||
    ext.endsWith('.mrk') ||
    ext.endsWith('.mrk2') ||
    ext.endsWith('.mrk3') ||
    ext.endsWith('.idx') ||
    ext.endsWith('.cidx')
  );
}

/**
 * Check if a file is a metadata file stored alongside data in R2
 * Metadata files: checksums.txt, columns.txt, count.txt, minmax_*.idx
 */
export function isPartMetadataFile(fileName: string): boolean {
  if (!fileName) return false;
  const name = fileName.toLowerCase();
  return (
    name === 'checksums.txt' ||
    name === 'columns.txt' ||
    name === 'count.txt' ||
    name.startsWith('minmax_') ||
    name === 'partition.dat' ||
    name === 'primary.idx'
  );
}

// ---------------------------------------------------------------------------
// MergeTree Storage Provider (DO + R2 Bridge)
// ---------------------------------------------------------------------------

/**
 * Part metadata stored in DO
 */
export interface PartMetadata {
  partName: string;
  partition: string;
  rowCount: number;
  sizeBytes: number;
  createdAt: number;
  minBlock: number;
  maxBlock: number;
  level: number;
}

/**
 * MergeTree storage provider that routes to DO for metadata and R2 for data
 *
 * This provider implements the VFSStorageProvider interface and routes:
 * - Data files (*.bin, *.mrk*, *.idx) -> R2 storage via MergeTreeR2Storage
 * - Part registry and table schema -> Durable Object via MergeTreeDO
 * - Directory listings -> Combined from DO (parts list) + R2 (files list)
 */
export class MergeTreeStorageProvider implements VFSStorageProvider {
  private r2Storage: MergeTreeR2Storage;
  private durableObject: MergeTreeDO;
  private database: string;
  private table: string;

  // Cache for part metadata from DO
  private partCache: Map<string, PartMetadata> = new Map();
  private partCacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 30000; // 30 seconds

  constructor(
    r2Storage: MergeTreeR2Storage,
    durableObject: MergeTreeDO,
    database: string,
    table: string
  ) {
    this.r2Storage = r2Storage;
    this.durableObject = durableObject;
    this.database = database;
    this.table = table;
  }

  /**
   * Get the R2 key for a given path
   */
  private getR2Key(path: string): string {
    return `${this.database}/${this.table}/${path}`;
  }

  /**
   * Refresh part cache from DO if expired
   */
  private async refreshPartCache(): Promise<void> {
    if (Date.now() < this.partCacheExpiry) {
      return;
    }

    try {
      const parts = await this.durableObject.listParts();
      this.partCache.clear();
      for (const part of parts) {
        const key = `${part.partition}/${part.partName}`;
        this.partCache.set(key, {
          partName: part.partName,
          partition: part.partition,
          rowCount: part.rowCount,
          sizeBytes: part.sizeBytes,
          createdAt: part.createdAt,
          minBlock: part.minBlock,
          maxBlock: part.maxBlock,
          level: part.level,
        });
      }
      this.partCacheExpiry = Date.now() + this.CACHE_TTL_MS;
    } catch (error) {
      console.error('Failed to refresh part cache:', error);
      // Keep using stale cache if available
    }
  }

  /**
   * Check if path exists and get metadata
   */
  async stat(path: string): Promise<FileStat | null> {
    const parsed = parseMergeTreePath(path);

    // Root directory
    if (parsed.type === 'root') {
      return {
        size: 0,
        mtime: Date.now(),
        ctime: Date.now(),
        isDirectory: true,
      };
    }

    // Data directory root
    if (parsed.type === 'data' && !parsed.partition) {
      return {
        size: 0,
        mtime: Date.now(),
        ctime: Date.now(),
        isDirectory: true,
      };
    }

    // Partition directory
    if (parsed.partition && !parsed.partName) {
      await this.refreshPartCache();
      // Check if any part exists in this partition
      for (const part of this.partCache.values()) {
        if (part.partition === parsed.partition) {
          return {
            size: 0,
            mtime: Date.now(),
            ctime: Date.now(),
            isDirectory: true,
          };
        }
      }
      return null;
    }

    // Part directory
    if (parsed.partition && parsed.partName && !parsed.fileName) {
      await this.refreshPartCache();
      const key = `${parsed.partition}/${parsed.partName}`;
      const part = this.partCache.get(key);
      if (part) {
        return {
          size: part.sizeBytes,
          mtime: part.createdAt,
          ctime: part.createdAt,
          isDirectory: true,
        };
      }
      return null;
    }

    // File within part
    if (parsed.partition && parsed.partName && parsed.fileName) {
      try {
        const r2Key = this.getR2Key(parsed.fullPath);
        const stat = await this.r2Storage.stat(r2Key);
        if (stat) {
          return {
            size: stat.size,
            mtime: stat.modified.getTime(),
            ctime: stat.modified.getTime(),
            isDirectory: false,
          };
        }
      } catch {
        // File doesn't exist
      }
      return null;
    }

    return null;
  }

  /**
   * Read file contents at offset
   */
  async read(path: string, offset: number, length: number): Promise<ArrayBuffer> {
    const parsed = parseMergeTreePath(path);

    if (parsed.type !== 'data' || !parsed.fileName) {
      throw new Error(`Cannot read directory or metadata path: ${path}`);
    }

    const r2Key = this.getR2Key(parsed.fullPath);
    const data = await this.r2Storage.read(r2Key, offset, length);
    return data;
  }

  /**
   * Read entire file
   */
  async readFile(path: string): Promise<ArrayBuffer> {
    const parsed = parseMergeTreePath(path);

    if (parsed.type !== 'data' || !parsed.fileName) {
      throw new Error(`Cannot read directory or metadata path: ${path}`);
    }

    const r2Key = this.getR2Key(parsed.fullPath);
    const data = await this.r2Storage.readFile(r2Key);
    return data;
  }

  /**
   * Write data to file
   */
  async write(path: string, data: ArrayBuffer): Promise<void> {
    const parsed = parseMergeTreePath(path);

    if (parsed.type !== 'data' || !parsed.fileName) {
      throw new Error(`Cannot write to directory or metadata path: ${path}`);
    }

    const r2Key = this.getR2Key(parsed.fullPath);
    await this.r2Storage.write(r2Key, data);

    // If this is a new part, register it with DO
    if (parsed.partition && parsed.partName) {
      const key = `${parsed.partition}/${parsed.partName}`;
      if (!this.partCache.has(key)) {
        // New part being written - will be registered when complete
        // For now, just track in local cache
        this.partCache.set(key, {
          partName: parsed.partName,
          partition: parsed.partition,
          rowCount: 0, // Will be updated from count.txt
          sizeBytes: data.byteLength,
          createdAt: Date.now(),
          minBlock: 0,
          maxBlock: 0,
          level: 0,
        });
      }
    }
  }

  /**
   * Append data to file
   */
  async append(path: string, data: ArrayBuffer): Promise<void> {
    const parsed = parseMergeTreePath(path);

    if (parsed.type !== 'data' || !parsed.fileName) {
      throw new Error(`Cannot append to directory or metadata path: ${path}`);
    }

    const r2Key = this.getR2Key(parsed.fullPath);
    await this.r2Storage.append(r2Key, data);
  }

  /**
   * Delete a file
   */
  async delete(path: string): Promise<void> {
    const parsed = parseMergeTreePath(path);

    if (parsed.type !== 'data') {
      throw new Error(`Cannot delete non-data path: ${path}`);
    }

    if (parsed.fileName) {
      // Delete single file
      const r2Key = this.getR2Key(parsed.fullPath);
      await this.r2Storage.delete(r2Key);
    } else if (parsed.partName) {
      // Delete entire part
      const prefix = this.getR2Key(`data/${parsed.partition}/${parsed.partName}/`);
      const files = await this.r2Storage.list(prefix);
      await Promise.all(files.map((f) => this.r2Storage.delete(f)));

      // Unregister from DO
      await this.durableObject.unregisterPart(parsed.partName);

      // Remove from cache
      const key = `${parsed.partition}/${parsed.partName}`;
      this.partCache.delete(key);
    } else if (parsed.partition) {
      // Delete entire partition
      const prefix = this.getR2Key(`data/${parsed.partition}/`);
      const files = await this.r2Storage.list(prefix);
      await Promise.all(files.map((f) => this.r2Storage.delete(f)));

      // Remove all parts in partition from cache and DO
      for (const [key, part] of this.partCache) {
        if (part.partition === parsed.partition) {
          await this.durableObject.unregisterPart(part.partName);
          this.partCache.delete(key);
        }
      }
    }
  }

  /**
   * List directory contents
   */
  async list(path: string): Promise<DirEntry[]> {
    const parsed = parseMergeTreePath(path);

    // Root directory
    if (parsed.type === 'root') {
      return [
        { name: 'data', isDirectory: true, size: 0 },
      ];
    }

    // Data directory - list partitions from DO
    if (parsed.type === 'data' && !parsed.partition) {
      await this.refreshPartCache();
      const partitions = new Set<string>();
      for (const part of this.partCache.values()) {
        partitions.add(part.partition);
      }
      return Array.from(partitions).map((p) => ({
        name: p,
        isDirectory: true,
        size: 0,
      }));
    }

    // Partition directory - list parts from DO
    if (parsed.partition && !parsed.partName) {
      await this.refreshPartCache();
      const parts: DirEntry[] = [];
      for (const part of this.partCache.values()) {
        if (part.partition === parsed.partition) {
          parts.push({
            name: part.partName,
            isDirectory: true,
            size: part.sizeBytes,
          });
        }
      }
      return parts;
    }

    // Part directory - list files from R2
    if (parsed.partition && parsed.partName) {
      const prefix = this.getR2Key(`data/${parsed.partition}/${parsed.partName}/`);
      const files = await this.r2Storage.list(prefix);
      return files.map((f) => {
        const name = f.split('/').pop() || f;
        return {
          name,
          isDirectory: false,
          size: 0, // Would need additional stat calls
        };
      });
    }

    return [];
  }

  /**
   * Create a directory (registers partition/part in DO)
   */
  async mkdir(path: string): Promise<void> {
    const parsed = parseMergeTreePath(path);

    // Part directory - register with DO
    if (parsed.partition && parsed.partName) {
      await this.durableObject.registerPart({
        partName: parsed.partName,
        partition: parsed.partition,
        rowCount: 0,
        sizeBytes: 0,
        createdAt: Date.now(),
        minBlock: 0,
        maxBlock: 0,
        level: 0,
      });

      const key = `${parsed.partition}/${parsed.partName}`;
      this.partCache.set(key, {
        partName: parsed.partName,
        partition: parsed.partition,
        rowCount: 0,
        sizeBytes: 0,
        createdAt: Date.now(),
        minBlock: 0,
        maxBlock: 0,
        level: 0,
      });
    }

    // For other directories, R2 handles implicitly via object keys
  }

  /**
   * Rename/move a file or directory
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldParsed = parseMergeTreePath(oldPath);
    const newParsed = parseMergeTreePath(newPath);

    if (oldParsed.fileName && newParsed.fileName) {
      // Rename single file
      const oldKey = this.getR2Key(oldParsed.fullPath);
      const newKey = this.getR2Key(newParsed.fullPath);
      const data = await this.r2Storage.readFile(oldKey);
      await this.r2Storage.write(newKey, data);
      await this.r2Storage.delete(oldKey);
    } else if (oldParsed.partName && newParsed.partName && !oldParsed.fileName) {
      // Rename part - move all files and update DO
      const oldPrefix = this.getR2Key(`data/${oldParsed.partition}/${oldParsed.partName}/`);
      const newPrefix = this.getR2Key(`data/${newParsed.partition}/${newParsed.partName}/`);

      const files = await this.r2Storage.list(oldPrefix);
      for (const file of files) {
        const newFile = file.replace(oldPrefix, newPrefix);
        const data = await this.r2Storage.readFile(file);
        await this.r2Storage.write(newFile, data);
        await this.r2Storage.delete(file);
      }

      // Update DO
      await this.durableObject.renamePart(oldParsed.partName, newParsed.partName);

      // Update cache
      const oldKey = `${oldParsed.partition}/${oldParsed.partName}`;
      const newKey = `${newParsed.partition}/${newParsed.partName}`;
      const part = this.partCache.get(oldKey);
      if (part) {
        part.partName = newParsed.partName;
        part.partition = newParsed.partition || part.partition;
        this.partCache.delete(oldKey);
        this.partCache.set(newKey, part);
      }
    }
  }

  /**
   * Flush pending writes
   */
  async flush(): Promise<void> {
    // R2 writes are immediate, but ensure DO is synced
    await this.durableObject.flush();
  }

  /**
   * Invalidate the part cache (call after external changes)
   */
  invalidateCache(): void {
    this.partCacheExpiry = 0;
    this.partCache.clear();
  }

  /**
   * Get part metadata from cache or DO
   */
  async getPartMetadata(partition: string, partName: string): Promise<PartMetadata | null> {
    await this.refreshPartCache();
    const key = `${partition}/${partName}`;
    return this.partCache.get(key) || null;
  }

  /**
   * Update part metadata in DO
   */
  async updatePartMetadata(metadata: PartMetadata): Promise<void> {
    await this.durableObject.registerPart(metadata);
    const key = `${metadata.partition}/${metadata.partName}`;
    this.partCache.set(key, metadata);
  }
}
