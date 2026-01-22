/**
 * VFS Bridge - TypeScript/JavaScript bridge for WASM VFS
 *
 * This module receives VFS calls from the WASM module (via EM_ASYNC_JS bindings)
 * and delegates to Cloudflare's Durable Objects (DO) for metadata and R2 for data.
 *
 * This is a copy of wasm/vfs/vfs_bridge.ts adapted for use in src/.
 *
 * Path structure for MergeTree data:
 *   data/{partition}/{part_name}/{file}
 */

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
  stat(path: string): Promise<FileStat | null>;
  read(path: string, offset: number, length: number): Promise<ArrayBuffer>;
  readFile(path: string): Promise<ArrayBuffer>;
  write(path: string, data: ArrayBuffer): Promise<void>;
  append(path: string, data: ArrayBuffer): Promise<void>;
  delete(path: string): Promise<void>;
  list(path: string): Promise<DirEntry[]>;
  mkdir(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
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
  buffer?: ArrayBuffer;
  writeBuffer?: Uint8Array[];
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

  private wasmMemory: WebAssembly.Memory | null = null;
  private readonly WRITE_BUFFER_THRESHOLD = 256 * 1024;

  constructor(storage: VFSStorageProvider) {
    this.storage = storage;
  }

  setWasmMemory(memory: WebAssembly.Memory): void {
    this.wasmMemory = memory;
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  async vfs_init(databasePtr: number, tablePtr: number): Promise<number> {
    // Store database and table names for path construction
    // These are used internally by the VFS for building storage paths
    this.database = this.readString(databasePtr);
    this.table = this.readString(tablePtr);
    // Access to ensure they're used (prevents unused variable warning)
    void this.database;
    void this.table;
    return VFS_OK;
  }

  async vfs_shutdown(): Promise<number> {
    for (const handle of this.fileHandles.values()) {
      if (handle.writeBuffer && handle.writeBuffer.length > 0) {
        await this.flushWriteBuffer(handle);
      }
    }
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

      if (!stat) {
        if (!isCreate) {
          return VFS_ENOENT;
        }
      } else {
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

      if (isWrite) {
        handle.writeBuffer = [];
        handle.writeBufferSize = 0;
        if (isTrunc) {
          handle.size = 0;
        }
      } else if (stat && stat.size < 1024 * 1024) {
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

    const accessMode = handle.flags & 0x0003;
    if (accessMode === VFS_O_WRONLY) {
      return VFS_EINVAL;
    }

    try {
      if (handle.position >= handle.size) {
        return 0;
      }

      const bytesToRead = Math.min(size, handle.size - handle.position);
      let data: ArrayBuffer;

      if (handle.buffer) {
        data = handle.buffer.slice(handle.position, handle.position + bytesToRead);
      } else {
        data = await this.storage.read(handle.path, handle.position, bytesToRead);
      }

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

    const accessMode = handle.flags & 0x0003;
    if (accessMode === VFS_O_RDONLY) {
      return VFS_EINVAL;
    }

    if (!handle.writeBuffer) {
      handle.writeBuffer = [];
      handle.writeBufferSize = 0;
    }

    try {
      const data = this.readFromWasm(bufferPtr, size);
      handle.writeBuffer.push(data);
      handle.writeBufferSize = (handle.writeBufferSize || 0) + data.length;
      handle.position += size;
      handle.size = Math.max(handle.size, handle.position);

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
        size: handle.size,
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
      return VFS_ENOENT;
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

    const totalSize = handle.writeBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of handle.writeBuffer) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    await this.storage.write(handle.path, combined.buffer);
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
    return new Uint8Array(view.slice(ptr, ptr + size));
  }

  private writeStatToWasm(
    ptr: number,
    stat: { mode: number; size: number; mtime: number; ctime: number }
  ): void {
    if (!this.wasmMemory) return;

    const view = new DataView(this.wasmMemory.buffer);
    view.setUint32(ptr + 0, stat.mode, true);
    view.setUint32(ptr + 4, 0, true);
    view.setBigUint64(ptr + 8, BigInt(stat.size), true);
    view.setBigUint64(ptr + 16, BigInt(stat.mtime), true);
    view.setBigUint64(ptr + 24, BigInt(stat.ctime), true);
  }

  private writeDirentToWasm(ptr: number, entry: DirEntry): void {
    if (!this.wasmMemory) return;

    const view = new Uint8Array(this.wasmMemory.buffer);
    const dataView = new DataView(this.wasmMemory.buffer);

    const nameBytes = new TextEncoder().encode(entry.name);
    const nameLen = Math.min(nameBytes.length, 255);
    view.set(nameBytes.subarray(0, nameLen), ptr);
    view[ptr + nameLen] = 0;
    for (let i = nameLen + 1; i < 256; i++) {
      view[ptr + i] = 0;
    }

    dataView.setUint32(ptr + 256, entry.isDirectory ? VFS_S_IFDIR : VFS_S_IFREG, true);
    dataView.setUint32(ptr + 260, 0, true);
    dataView.setBigUint64(ptr + 264, BigInt(entry.size), true);
  }
}

// ---------------------------------------------------------------------------
// In-Memory Storage Provider (for testing)
// ---------------------------------------------------------------------------

export class InMemoryStorageProvider implements VFSStorageProvider {
  private files: Map<string, ArrayBuffer> = new Map();
  private directories: Set<string> = new Set();

  constructor() {
    this.directories.add('');
    this.directories.add('/');
  }

  async stat(path: string): Promise<FileStat | null> {
    const normalizedPath = this.normalizePath(path);

    if (this.directories.has(normalizedPath)) {
      return { size: 0, mtime: Date.now(), ctime: Date.now(), isDirectory: true };
    }

    const data = this.files.get(normalizedPath);
    if (data) {
      return { size: data.byteLength, mtime: Date.now(), ctime: Date.now(), isDirectory: false };
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

    for (const [filePath, data] of this.files) {
      if (filePath.startsWith(prefix)) {
        const relativePath = filePath.slice(prefix.length);
        const parts = relativePath.split('/');
        const name = parts[0];

        if (parts.length === 1) {
          entries.set(name, { name, isDirectory: false, size: data.byteLength });
        } else {
          if (!entries.has(name)) {
            entries.set(name, { name, isDirectory: true, size: 0 });
          }
        }
      }
    }

    for (const dirPath of this.directories) {
      if (dirPath.startsWith(prefix) && dirPath !== normalizedPath) {
        const relativePath = dirPath.slice(prefix.length);
        const parts = relativePath.split('/');
        const name = parts[0];
        if (name && !entries.has(name)) {
          entries.set(name, { name, isDirectory: true, size: 0 });
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
      const prefix = normalizedOldPath + '/';
      const newPrefix = normalizedNewPath + '/';

      for (const [filePath, fileData] of this.files) {
        if (filePath.startsWith(prefix)) {
          const newFilePath = newPrefix + filePath.slice(prefix.length);
          this.files.set(newFilePath, fileData);
          this.files.delete(filePath);
        }
      }

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

export interface ParsedMergeTreePath {
  type: 'data' | 'metadata' | 'root';
  partition: string | null;
  partName: string | null;
  fileName: string | null;
  fullPath: string;
}

export function parseMergeTreePath(path: string): ParsedMergeTreePath {
  const normalized = path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  const parts = normalized.split('/').filter(Boolean);

  if (parts.length === 0 || parts[0] !== 'data') {
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
// Part Metadata Type
// ---------------------------------------------------------------------------

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
