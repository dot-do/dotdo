# MergeTree VFS Architecture for Cloudflare Workers

## Overview

This document describes the Virtual File System (VFS) architecture for implementing ClickHouse MergeTree storage engine on Cloudflare Workers. The design bridges WASM file operations to Cloudflare's storage primitives: Durable Objects (DO) for metadata/coordination and R2 for data storage.

## Architecture Diagram

```
+------------------+     +-------------------+     +------------------+
|   WASM Module    |     |   JavaScript      |     | Cloudflare       |
|   (C++ Code)     |<--->|   VFS Bridge      |<--->| Infrastructure   |
|                  |     |                   |     |                  |
| - MergeTree      |     | - File Handle Mgr |     | - DO (metadata)  |
| - Parts Reader   |     | - R2 Client       |     | - R2 (data)      |
| - Column Store   |     | - DO Client       |     | - KV (cache)     |
+------------------+     +-------------------+     +------------------+
        |                        |                        |
        v                        v                        v
   EM_JS Imports           Fetch/Put APIs          Storage APIs
```

## Design Goals

1. **Compatibility**: Support MergeTree's file I/O patterns without modification
2. **Performance**: Minimize latency through caching, batching, and streaming
3. **Scalability**: Handle large datasets via R2's object storage
4. **Consistency**: Ensure atomic operations via DO coordination
5. **Simplicity**: Clean abstraction layer between WASM and JS

## VFS Interface

### C Functions (WASM Exports/Imports)

The VFS layer exposes POSIX-like file operations that WASM code can call:

```cpp
// ===========================================================================
// VFS Interface - C API for WASM
// ===========================================================================

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
 * @return      VFS_OK or negative error code
 */
int32_t vfs_mkdir(const char* path);

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
```

## Storage Layer Design

### Durable Objects Layer (Metadata/Coordination)

The DO layer handles:
- Table metadata (schema, settings)
- Part registry (which parts exist, their state)
- Mutation log for tracking changes
- Lock coordination for writes

```typescript
// ===========================================================================
// MergeTree Durable Object - Metadata & Coordination
// ===========================================================================

/**
 * MergeTree part state
 */
export type PartState =
  | 'temporary'    // Being written
  | 'committed'    // Ready for queries
  | 'merging'      // Being merged
  | 'obsolete'     // Superseded by merge
  | 'deleting';    // Scheduled for deletion

/**
 * MergeTree part metadata
 */
export interface PartInfo {
  /** Part name (e.g., "20240115_1_1_0") */
  name: string;

  /** Part state */
  state: PartState;

  /** Partition key value */
  partition: string;

  /** Minimum block number */
  minBlock: number;

  /** Maximum block number */
  maxBlock: number;

  /** Merge level */
  level: number;

  /** Row count */
  rows: number;

  /** Compressed bytes */
  bytesCompressed: number;

  /** Uncompressed bytes */
  bytesUncompressed: number;

  /** Modification time */
  modificationTime: number;

  /** R2 object keys for this part */
  r2Keys: string[];

  /** Checksum of part data */
  checksum: string;
}

/**
 * Table schema stored in DO
 */
export interface MergeTreeSchema {
  /** Table name */
  name: string;

  /** Database name */
  database: string;

  /** Column definitions */
  columns: Array<{
    name: string;
    type: string;
    codec?: string;
    ttl?: string;
  }>;

  /** Primary key columns */
  primaryKey: string[];

  /** Order by columns */
  orderBy: string[];

  /** Partition by expression */
  partitionBy?: string;

  /** Engine settings */
  settings: Record<string, string | number | boolean>;

  /** Creation timestamp */
  createdAt: string;

  /** Last modification timestamp */
  modifiedAt: string;
}

/**
 * Mutation entry
 */
export interface MutationEntry {
  /** Mutation ID */
  id: string;

  /** Mutation type */
  type: 'DELETE' | 'UPDATE' | 'MATERIALIZE_INDEX';

  /** Mutation command/predicate */
  command: string;

  /** Parts affected */
  partsToMutate: string[];

  /** Status */
  status: 'pending' | 'executing' | 'done' | 'failed';

  /** Creation time */
  createdAt: number;

  /** Completion time */
  completedAt?: number;

  /** Error message if failed */
  error?: string;
}

/**
 * MergeTree metadata Durable Object
 */
export class MergeTreeDO {
  private state: DurableObjectState;
  private schema: MergeTreeSchema | null = null;
  private parts: Map<string, PartInfo> = new Map();
  private mutations: Map<string, MutationEntry> = new Map();
  private nextBlockNumber: number = 1;
  private writeLock: boolean = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
  }

  // -------------------------------------------------------------------------
  // Schema Operations
  // -------------------------------------------------------------------------

  /**
   * Create table with schema
   */
  async createTable(schema: MergeTreeSchema): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      if (this.schema) {
        throw new Error(`Table ${schema.database}.${schema.name} already exists`);
      }

      this.schema = schema;
      await this.state.storage.put('schema', schema);
    });
  }

  /**
   * Get table schema
   */
  async getSchema(): Promise<MergeTreeSchema | null> {
    if (!this.schema) {
      this.schema = await this.state.storage.get('schema');
    }
    return this.schema;
  }

  /**
   * Alter table schema (add/drop columns)
   */
  async alterSchema(changes: Partial<MergeTreeSchema>): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      if (!this.schema) {
        throw new Error('Table does not exist');
      }

      this.schema = { ...this.schema, ...changes, modifiedAt: new Date().toISOString() };
      await this.state.storage.put('schema', this.schema);
    });
  }

  // -------------------------------------------------------------------------
  // Part Operations
  // -------------------------------------------------------------------------

  /**
   * Register a new part (during insert)
   */
  async registerPart(part: Omit<PartInfo, 'minBlock' | 'maxBlock'>): Promise<PartInfo> {
    return await this.state.blockConcurrencyWhile(async () => {
      const minBlock = this.nextBlockNumber;
      const maxBlock = this.nextBlockNumber;
      this.nextBlockNumber++;

      const fullPart: PartInfo = {
        ...part,
        minBlock,
        maxBlock,
        state: 'temporary',
      };

      this.parts.set(fullPart.name, fullPart);
      await this.persistParts();

      return fullPart;
    });
  }

  /**
   * Commit a part (make visible for queries)
   */
  async commitPart(partName: string): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      const part = this.parts.get(partName);
      if (!part) {
        throw new Error(`Part ${partName} not found`);
      }
      if (part.state !== 'temporary') {
        throw new Error(`Part ${partName} is not in temporary state`);
      }

      part.state = 'committed';
      await this.persistParts();
    });
  }

  /**
   * Get all committed parts for a partition
   */
  async getActiveParts(partition?: string): Promise<PartInfo[]> {
    await this.loadParts();

    const active = Array.from(this.parts.values())
      .filter(p => p.state === 'committed')
      .filter(p => !partition || p.partition === partition);

    return active;
  }

  /**
   * Register a merge result
   */
  async registerMerge(
    resultPart: Omit<PartInfo, 'state'>,
    sourceParts: string[]
  ): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      // Mark source parts as obsolete
      for (const name of sourceParts) {
        const part = this.parts.get(name);
        if (part && part.state === 'committed') {
          part.state = 'obsolete';
        }
      }

      // Add merged part
      this.parts.set(resultPart.name, { ...resultPart, state: 'committed' });

      await this.persistParts();
    });
  }

  /**
   * Delete obsolete parts (cleanup)
   */
  async cleanupObsoleteParts(): Promise<string[]> {
    return await this.state.blockConcurrencyWhile(async () => {
      const toDelete: string[] = [];

      for (const [name, part] of this.parts) {
        if (part.state === 'obsolete') {
          toDelete.push(name);
        }
      }

      for (const name of toDelete) {
        this.parts.delete(name);
      }

      await this.persistParts();
      return toDelete;
    });
  }

  // -------------------------------------------------------------------------
  // Lock Coordination
  // -------------------------------------------------------------------------

  /**
   * Acquire write lock for insert/merge operations
   */
  async acquireWriteLock(timeout: number = 30000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (!this.writeLock) {
        this.writeLock = true;
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return false;
  }

  /**
   * Release write lock
   */
  async releaseWriteLock(): Promise<void> {
    this.writeLock = false;
  }

  // -------------------------------------------------------------------------
  // Mutation Log
  // -------------------------------------------------------------------------

  /**
   * Register a mutation
   */
  async registerMutation(mutation: Omit<MutationEntry, 'id' | 'status' | 'createdAt'>): Promise<string> {
    const id = `mutation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const entry: MutationEntry = {
      ...mutation,
      id,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.mutations.set(id, entry);
    await this.state.storage.put(`mutation:${id}`, entry);

    return id;
  }

  /**
   * Get pending mutations
   */
  async getPendingMutations(): Promise<MutationEntry[]> {
    const stored = await this.state.storage.list({ prefix: 'mutation:' });
    return Array.from(stored.values())
      .filter((m): m is MutationEntry => (m as MutationEntry).status === 'pending');
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private async loadParts(): Promise<void> {
    if (this.parts.size === 0) {
      const stored = await this.state.storage.get<Map<string, PartInfo>>('parts');
      if (stored) {
        this.parts = new Map(Object.entries(stored));
      }
    }
  }

  private async persistParts(): Promise<void> {
    await this.state.storage.put('parts', Object.fromEntries(this.parts));
  }
}
```

### R2 Layer (Data Storage)

The R2 layer handles actual data files:

```typescript
// ===========================================================================
// R2 Storage Layer for MergeTree Parts
// ===========================================================================

/**
 * R2 key structure for MergeTree data:
 *
 * {database}/{table}/data/{partition}/{part_name}/{file}
 *
 * Example:
 *   default/events/data/202401/20240115_1_1_0/data.bin
 *   default/events/data/202401/20240115_1_1_0/data.mrk3
 *   default/events/data/202401/20240115_1_1_0/primary.idx
 *   default/events/data/202401/20240115_1_1_0/checksums.txt
 */

export interface R2StorageConfig {
  bucket: R2Bucket;
  database: string;
  table: string;
}

/**
 * MergeTree data file types
 */
export type MergeTreeFileType =
  | 'bin'           // Column data (compressed)
  | 'mrk3'          // Mark files (index into bin)
  | 'idx'           // Primary index
  | 'checksums'     // Checksums file
  | 'columns'       // Column list
  | 'count'         // Row count
  | 'minmax'        // MinMax index
  | 'partition';    // Partition info

/**
 * File write handle for streaming uploads
 */
export interface R2WriteHandle {
  upload: R2MultipartUpload;
  parts: R2UploadedPart[];
  partNumber: number;
  buffer: Uint8Array[];
  bufferSize: number;
}

export class MergeTreeR2Storage {
  private config: R2StorageConfig;
  private writeHandles: Map<string, R2WriteHandle> = new Map();
  private readCache: Map<string, ArrayBuffer> = new Map();
  private readonly PART_SIZE = 5 * 1024 * 1024; // 5MB multipart chunks
  private readonly CACHE_MAX_SIZE = 64 * 1024 * 1024; // 64MB cache
  private cacheSize = 0;

  constructor(config: R2StorageConfig) {
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // Key Building
  // -------------------------------------------------------------------------

  private buildKey(partition: string, partName: string, file: string): string {
    return `${this.config.database}/${this.config.table}/data/${partition}/${partName}/${file}`;
  }

  private buildPartPrefix(partition: string, partName: string): string {
    return `${this.config.database}/${this.config.table}/data/${partition}/${partName}/`;
  }

  // -------------------------------------------------------------------------
  // Read Operations
  // -------------------------------------------------------------------------

  /**
   * Read entire file (for small files like indexes)
   */
  async readFile(partition: string, partName: string, file: string): Promise<ArrayBuffer> {
    const key = this.buildKey(partition, partName, file);

    // Check cache
    if (this.readCache.has(key)) {
      return this.readCache.get(key)!;
    }

    // Fetch from R2
    const object = await this.config.bucket.get(key);
    if (!object) {
      throw new Error(`File not found: ${key}`);
    }

    const data = await object.arrayBuffer();

    // Cache if small enough
    if (data.byteLength < 1024 * 1024) { // Cache files < 1MB
      this.addToCache(key, data);
    }

    return data;
  }

  /**
   * Read file range (for column data)
   */
  async readRange(
    partition: string,
    partName: string,
    file: string,
    offset: number,
    length: number
  ): Promise<ArrayBuffer> {
    const key = this.buildKey(partition, partName, file);

    const object = await this.config.bucket.get(key, {
      range: { offset, length },
    });

    if (!object) {
      throw new Error(`File not found: ${key}`);
    }

    return object.arrayBuffer();
  }

  /**
   * Get file metadata
   */
  async stat(partition: string, partName: string, file: string): Promise<{
    size: number;
    etag: string;
    uploaded: Date;
  } | null> {
    const key = this.buildKey(partition, partName, file);
    const object = await this.config.bucket.head(key);

    if (!object) {
      return null;
    }

    return {
      size: object.size,
      etag: object.etag,
      uploaded: object.uploaded,
    };
  }

  /**
   * List files in a part
   */
  async listPartFiles(partition: string, partName: string): Promise<string[]> {
    const prefix = this.buildPartPrefix(partition, partName);
    const listed = await this.config.bucket.list({ prefix });

    return listed.objects.map(obj => obj.key.replace(prefix, ''));
  }

  // -------------------------------------------------------------------------
  // Write Operations
  // -------------------------------------------------------------------------

  /**
   * Start streaming write to file
   */
  async startWrite(partition: string, partName: string, file: string): Promise<string> {
    const key = this.buildKey(partition, partName, file);
    const handleId = `${key}:${Date.now()}`;

    const upload = await this.config.bucket.createMultipartUpload(key);

    this.writeHandles.set(handleId, {
      upload,
      parts: [],
      partNumber: 1,
      buffer: [],
      bufferSize: 0,
    });

    return handleId;
  }

  /**
   * Write chunk to file
   */
  async writeChunk(handleId: string, data: Uint8Array): Promise<void> {
    const handle = this.writeHandles.get(handleId);
    if (!handle) {
      throw new Error(`Write handle not found: ${handleId}`);
    }

    handle.buffer.push(data);
    handle.bufferSize += data.length;

    // Flush when buffer exceeds part size
    if (handle.bufferSize >= this.PART_SIZE) {
      await this.flushBuffer(handleId);
    }
  }

  /**
   * Complete streaming write
   */
  async finishWrite(handleId: string): Promise<void> {
    const handle = this.writeHandles.get(handleId);
    if (!handle) {
      throw new Error(`Write handle not found: ${handleId}`);
    }

    // Flush remaining buffer
    if (handle.bufferSize > 0) {
      await this.flushBuffer(handleId);
    }

    // Complete multipart upload
    await handle.upload.complete(handle.parts);
    this.writeHandles.delete(handleId);
  }

  /**
   * Abort streaming write
   */
  async abortWrite(handleId: string): Promise<void> {
    const handle = this.writeHandles.get(handleId);
    if (!handle) {
      return;
    }

    await handle.upload.abort();
    this.writeHandles.delete(handleId);
  }

  /**
   * Write small file directly (for metadata files)
   */
  async writeFile(
    partition: string,
    partName: string,
    file: string,
    data: ArrayBuffer | Uint8Array
  ): Promise<void> {
    const key = this.buildKey(partition, partName, file);
    await this.config.bucket.put(key, data);
  }

  // -------------------------------------------------------------------------
  // Delete Operations
  // -------------------------------------------------------------------------

  /**
   * Delete a file
   */
  async deleteFile(partition: string, partName: string, file: string): Promise<void> {
    const key = this.buildKey(partition, partName, file);
    await this.config.bucket.delete(key);
    this.readCache.delete(key);
  }

  /**
   * Delete all files in a part
   */
  async deletePart(partition: string, partName: string): Promise<void> {
    const files = await this.listPartFiles(partition, partName);

    // Delete in batches of 1000 (R2 limit)
    for (let i = 0; i < files.length; i += 1000) {
      const batch = files.slice(i, i + 1000);
      const keys = batch.map(f => this.buildKey(partition, partName, f));
      await this.config.bucket.delete(keys);
    }
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private async flushBuffer(handleId: string): Promise<void> {
    const handle = this.writeHandles.get(handleId)!;

    // Combine buffer chunks
    const combined = new Uint8Array(handle.bufferSize);
    let offset = 0;
    for (const chunk of handle.buffer) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Upload part
    const part = await handle.upload.uploadPart(handle.partNumber, combined);
    handle.parts.push(part);
    handle.partNumber++;

    // Clear buffer
    handle.buffer = [];
    handle.bufferSize = 0;
  }

  private addToCache(key: string, data: ArrayBuffer): void {
    // Evict old entries if cache is full
    while (this.cacheSize + data.byteLength > this.CACHE_MAX_SIZE && this.readCache.size > 0) {
      const firstKey = this.readCache.keys().next().value;
      const evicted = this.readCache.get(firstKey!);
      if (evicted) {
        this.cacheSize -= evicted.byteLength;
        this.readCache.delete(firstKey!);
      }
    }

    this.readCache.set(key, data);
    this.cacheSize += data.byteLength;
  }
}
```

## JavaScript VFS Bridge

The bridge layer connects WASM imports to the storage backends:

```typescript
// ===========================================================================
// JavaScript VFS Bridge - Connects WASM to DO/R2
// ===========================================================================

import type { MergeTreeDO } from './mergetree-do';
import type { MergeTreeR2Storage } from './mergetree-r2';

/**
 * File handle state
 */
interface FileHandle {
  id: number;
  path: string;
  flags: number;
  position: number;
  size: number;
  partition: string;
  partName: string;
  fileName: string;
  buffer?: ArrayBuffer;  // Cached content for small files
  r2WriteHandle?: string;  // For write operations
}

/**
 * Directory handle state
 */
interface DirHandle {
  id: number;
  path: string;
  entries: Array<{ name: string; type: number; size: number }>;
  position: number;
}

/**
 * VFS Bridge for WASM
 */
export class VFSBridge {
  private metadataDO: MergeTreeDO;
  private r2Storage: MergeTreeR2Storage;
  private database: string;
  private table: string;

  private nextHandleId = 1;
  private fileHandles: Map<number, FileHandle> = new Map();
  private dirHandles: Map<number, DirHandle> = new Map();

  // WASM memory access
  private wasmMemory: WebAssembly.Memory | null = null;

  constructor(
    metadataDO: MergeTreeDO,
    r2Storage: MergeTreeR2Storage,
    database: string,
    table: string
  ) {
    this.metadataDO = metadataDO;
    this.r2Storage = r2Storage;
    this.database = database;
    this.table = table;
  }

  /**
   * Set WASM memory for buffer operations
   */
  setWasmMemory(memory: WebAssembly.Memory): void {
    this.wasmMemory = memory;
  }

  // -------------------------------------------------------------------------
  // Path Parsing
  // -------------------------------------------------------------------------

  private parsePath(path: string): { partition: string; partName: string; fileName: string } | null {
    // Expected format: data/{partition}/{part_name}/{file}
    // or: {partition}/{part_name}/{file}
    const parts = path.replace(/^data\//, '').split('/');

    if (parts.length < 3) {
      return null;
    }

    return {
      partition: parts[0],
      partName: parts[1],
      fileName: parts.slice(2).join('/'),
    };
  }

  // -------------------------------------------------------------------------
  // File Operations (EM_JS Bindings)
  // -------------------------------------------------------------------------

  /**
   * EM_JS: vfs_open
   */
  async vfs_open(pathPtr: number, flags: number): Promise<number> {
    const path = this.readString(pathPtr);
    const parsed = this.parsePath(path);

    if (!parsed) {
      return -22; // VFS_EINVAL
    }

    try {
      // Check if file exists
      const stat = await this.r2Storage.stat(parsed.partition, parsed.partName, parsed.fileName);

      const isCreate = (flags & 0x0100) !== 0;  // VFS_O_CREAT
      const isExcl = (flags & 0x0800) !== 0;    // VFS_O_EXCL
      const isTrunc = (flags & 0x0200) !== 0;   // VFS_O_TRUNC
      const isWrite = (flags & 0x0002) !== 0;   // VFS_O_WRONLY

      if (!stat && !isCreate) {
        return -2; // VFS_ENOENT
      }

      if (stat && isCreate && isExcl) {
        return -17; // VFS_EEXIST
      }

      const handle: FileHandle = {
        id: this.nextHandleId++,
        path,
        flags,
        position: 0,
        size: stat?.size ?? 0,
        ...parsed,
      };

      // For write operations, start R2 multipart upload
      if (isWrite) {
        handle.r2WriteHandle = await this.r2Storage.startWrite(
          parsed.partition,
          parsed.partName,
          parsed.fileName
        );
        if (isTrunc) {
          handle.size = 0;
        }
      } else {
        // For read operations on small files, cache content
        if (stat && stat.size < 1024 * 1024) {
          handle.buffer = await this.r2Storage.readFile(
            parsed.partition,
            parsed.partName,
            parsed.fileName
          );
        }
      }

      this.fileHandles.set(handle.id, handle);
      return handle.id;

    } catch (error) {
      console.error('vfs_open error:', error);
      return -5; // VFS_EIO
    }
  }

  /**
   * EM_JS: vfs_close
   */
  async vfs_close(handleId: number): Promise<number> {
    const handle = this.fileHandles.get(handleId);
    if (!handle) {
      return -9; // VFS_EBADF
    }

    try {
      // Finish any pending writes
      if (handle.r2WriteHandle) {
        await this.r2Storage.finishWrite(handle.r2WriteHandle);
      }

      this.fileHandles.delete(handleId);
      return 0;

    } catch (error) {
      console.error('vfs_close error:', error);
      return -5; // VFS_EIO
    }
  }

  /**
   * EM_JS: vfs_read
   */
  async vfs_read(handleId: number, bufferPtr: number, size: number): Promise<number> {
    const handle = this.fileHandles.get(handleId);
    if (!handle) {
      return -9; // VFS_EBADF
    }

    if ((handle.flags & 0x0003) === 0x0002) {
      return -22; // VFS_EINVAL - write-only handle
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
        // Read from R2
        data = await this.r2Storage.readRange(
          handle.partition,
          handle.partName,
          handle.fileName,
          handle.position,
          bytesToRead
        );
      }

      // Copy to WASM memory
      this.writeToWasm(bufferPtr, new Uint8Array(data));
      handle.position += data.byteLength;

      return data.byteLength;

    } catch (error) {
      console.error('vfs_read error:', error);
      return -5; // VFS_EIO
    }
  }

  /**
   * EM_JS: vfs_write
   */
  async vfs_write(handleId: number, bufferPtr: number, size: number): Promise<number> {
    const handle = this.fileHandles.get(handleId);
    if (!handle) {
      return -9; // VFS_EBADF
    }

    if ((handle.flags & 0x0003) === 0x0001) {
      return -22; // VFS_EINVAL - read-only handle
    }

    if (!handle.r2WriteHandle) {
      return -22; // VFS_EINVAL - no write handle
    }

    try {
      // Read from WASM memory
      const data = this.readFromWasm(bufferPtr, size);

      // Write to R2
      await this.r2Storage.writeChunk(handle.r2WriteHandle, data);
      handle.position += size;
      handle.size = Math.max(handle.size, handle.position);

      return size;

    } catch (error) {
      console.error('vfs_write error:', error);
      return -5; // VFS_EIO
    }
  }

  /**
   * EM_JS: vfs_seek
   */
  vfs_seek(handleId: number, offset: number, whence: number): number {
    const handle = this.fileHandles.get(handleId);
    if (!handle) {
      return -9; // VFS_EBADF
    }

    let newPosition: number;
    switch (whence) {
      case 0: // VFS_SEEK_SET
        newPosition = offset;
        break;
      case 1: // VFS_SEEK_CUR
        newPosition = handle.position + offset;
        break;
      case 2: // VFS_SEEK_END
        newPosition = handle.size + offset;
        break;
      default:
        return -22; // VFS_EINVAL
    }

    if (newPosition < 0) {
      return -22; // VFS_EINVAL
    }

    handle.position = newPosition;
    return newPosition;
  }

  /**
   * EM_JS: vfs_stat
   */
  async vfs_stat(pathPtr: number, statPtr: number): Promise<number> {
    const path = this.readString(pathPtr);
    const parsed = this.parsePath(path);

    if (!parsed) {
      // Check if it's a directory path
      return this.statDirectory(path, statPtr);
    }

    try {
      const stat = await this.r2Storage.stat(
        parsed.partition,
        parsed.partName,
        parsed.fileName
      );

      if (!stat) {
        return -2; // VFS_ENOENT
      }

      // Write stat structure to WASM memory
      this.writeStatToWasm(statPtr, {
        mode: 0x8000, // VFS_S_IFREG
        size: stat.size,
        mtime: stat.uploaded.getTime(),
        ctime: stat.uploaded.getTime(),
      });

      return 0;

    } catch (error) {
      console.error('vfs_stat error:', error);
      return -5; // VFS_EIO
    }
  }

  /**
   * EM_JS: vfs_mkdir
   */
  async vfs_mkdir(pathPtr: number): Promise<number> {
    // Directories are implicit in R2 (object key prefixes)
    // Just validate the path
    const path = this.readString(pathPtr);
    if (!path || path.length === 0) {
      return -22; // VFS_EINVAL
    }
    return 0;
  }

  /**
   * EM_JS: vfs_unlink
   */
  async vfs_unlink(pathPtr: number): Promise<number> {
    const path = this.readString(pathPtr);
    const parsed = this.parsePath(path);

    if (!parsed) {
      return -22; // VFS_EINVAL
    }

    try {
      await this.r2Storage.deleteFile(
        parsed.partition,
        parsed.partName,
        parsed.fileName
      );
      return 0;

    } catch (error) {
      console.error('vfs_unlink error:', error);
      return -5; // VFS_EIO
    }
  }

  /**
   * EM_JS: vfs_rename
   */
  async vfs_rename(oldPathPtr: number, newPathPtr: number): Promise<number> {
    // R2 doesn't support rename, so we copy + delete
    const oldPath = this.readString(oldPathPtr);
    const newPath = this.readString(newPathPtr);

    const oldParsed = this.parsePath(oldPath);
    const newParsed = this.parsePath(newPath);

    if (!oldParsed || !newParsed) {
      return -22; // VFS_EINVAL
    }

    try {
      // Read old file
      const data = await this.r2Storage.readFile(
        oldParsed.partition,
        oldParsed.partName,
        oldParsed.fileName
      );

      // Write to new location
      await this.r2Storage.writeFile(
        newParsed.partition,
        newParsed.partName,
        newParsed.fileName,
        data
      );

      // Delete old file
      await this.r2Storage.deleteFile(
        oldParsed.partition,
        oldParsed.partName,
        oldParsed.fileName
      );

      return 0;

    } catch (error) {
      console.error('vfs_rename error:', error);
      return -5; // VFS_EIO
    }
  }

  // -------------------------------------------------------------------------
  // Directory Operations
  // -------------------------------------------------------------------------

  /**
   * EM_JS: vfs_opendir
   */
  async vfs_opendir(pathPtr: number): Promise<number> {
    const path = this.readString(pathPtr);

    try {
      // Get part list from DO
      const parts = await this.metadataDO.getActiveParts();

      // Filter and build directory entries based on path
      const entries = this.buildDirEntries(path, parts);

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
      return -5; // VFS_EIO
    }
  }

  /**
   * EM_JS: vfs_readdir
   */
  vfs_readdir(handleId: number, entryPtr: number): number {
    const handle = this.dirHandles.get(handleId);
    if (!handle) {
      return -9; // VFS_EBADF
    }

    if (handle.position >= handle.entries.length) {
      return -2; // VFS_ENOENT (no more entries)
    }

    const entry = handle.entries[handle.position];
    this.writeDirentToWasm(entryPtr, entry);
    handle.position++;

    return 0;
  }

  /**
   * EM_JS: vfs_closedir
   */
  vfs_closedir(handleId: number): number {
    if (!this.dirHandles.has(handleId)) {
      return -9; // VFS_EBADF
    }
    this.dirHandles.delete(handleId);
    return 0;
  }

  // -------------------------------------------------------------------------
  // WASM Memory Helpers
  // -------------------------------------------------------------------------

  private readString(ptr: number): string {
    if (!this.wasmMemory) return '';

    const view = new Uint8Array(this.wasmMemory.buffer);
    let end = ptr;
    while (view[end] !== 0) end++;

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
    return view.slice(ptr, ptr + size);
  }

  private writeStatToWasm(ptr: number, stat: { mode: number; size: number; mtime: number; ctime: number }): void {
    if (!this.wasmMemory) return;

    const view = new DataView(this.wasmMemory.buffer);
    view.setUint32(ptr, stat.mode, true);
    view.setBigUint64(ptr + 8, BigInt(stat.size), true);
    view.setBigUint64(ptr + 16, BigInt(stat.mtime), true);
    view.setBigUint64(ptr + 24, BigInt(stat.ctime), true);
  }

  private writeDirentToWasm(ptr: number, entry: { name: string; type: number; size: number }): void {
    if (!this.wasmMemory) return;

    const view = new Uint8Array(this.wasmMemory.buffer);
    const dataView = new DataView(this.wasmMemory.buffer);

    // Write name (256 bytes)
    const nameBytes = new TextEncoder().encode(entry.name);
    view.set(nameBytes.slice(0, 255), ptr);
    view[ptr + nameBytes.length] = 0; // Null terminator

    // Write type (uint32 at offset 256)
    dataView.setUint32(ptr + 256, entry.type, true);

    // Write size (uint64 at offset 264)
    dataView.setBigUint64(ptr + 264, BigInt(entry.size), true);
  }

  private statDirectory(path: string, statPtr: number): number {
    // For now, always return success for directory stat
    this.writeStatToWasm(statPtr, {
      mode: 0x4000, // VFS_S_IFDIR
      size: 0,
      mtime: Date.now(),
      ctime: Date.now(),
    });
    return 0;
  }

  private buildDirEntries(
    path: string,
    parts: Array<{ name: string; partition: string; bytesCompressed: number }>
  ): Array<{ name: string; type: number; size: number }> {
    const entries: Array<{ name: string; type: number; size: number }> = [];
    const seen = new Set<string>();

    const pathParts = path.replace(/^data\/?/, '').split('/').filter(Boolean);

    if (pathParts.length === 0) {
      // Listing partitions
      for (const part of parts) {
        if (!seen.has(part.partition)) {
          seen.add(part.partition);
          entries.push({ name: part.partition, type: 0x4000, size: 0 });
        }
      }
    } else if (pathParts.length === 1) {
      // Listing parts in a partition
      const partition = pathParts[0];
      for (const part of parts) {
        if (part.partition === partition && !seen.has(part.name)) {
          seen.add(part.name);
          entries.push({ name: part.name, type: 0x4000, size: part.bytesCompressed });
        }
      }
    }
    // For deeper paths, would need to list R2 objects

    return entries;
  }
}
```

## WASM Integration

### Emscripten EM_JS Bindings

```cpp
// ===========================================================================
// Emscripten EM_JS Bindings for VFS
// ===========================================================================

#include <emscripten.h>
#include <emscripten/em_js.h>

// Forward declare the VFS bridge functions that will be implemented in JS
// These are async-aware and use JSPI (JavaScript Promise Integration)

EM_ASYNC_JS(int32_t, js_vfs_open, (const char* path, int32_t flags), {
    const vfs = Module.vfsBridge;
    if (!vfs) return -22;
    return await vfs.vfs_open(path, flags);
});

EM_ASYNC_JS(int32_t, js_vfs_close, (int32_t handle), {
    const vfs = Module.vfsBridge;
    if (!vfs) return -9;
    return await vfs.vfs_close(handle);
});

EM_ASYNC_JS(int64_t, js_vfs_read, (int32_t handle, void* buffer, size_t size), {
    const vfs = Module.vfsBridge;
    if (!vfs) return -9;
    return await vfs.vfs_read(handle, buffer, size);
});

EM_ASYNC_JS(int64_t, js_vfs_write, (int32_t handle, const void* buffer, size_t size), {
    const vfs = Module.vfsBridge;
    if (!vfs) return -9;
    return await vfs.vfs_write(handle, buffer, size);
});

EM_JS(int64_t, js_vfs_seek, (int32_t handle, int64_t offset, int32_t whence), {
    const vfs = Module.vfsBridge;
    if (!vfs) return -9;
    return vfs.vfs_seek(handle, offset, whence);
});

EM_ASYNC_JS(int32_t, js_vfs_stat, (const char* path, void* st), {
    const vfs = Module.vfsBridge;
    if (!vfs) return -22;
    return await vfs.vfs_stat(path, st);
});

EM_ASYNC_JS(int32_t, js_vfs_mkdir, (const char* path), {
    const vfs = Module.vfsBridge;
    if (!vfs) return -22;
    return await vfs.vfs_mkdir(path);
});

EM_ASYNC_JS(int32_t, js_vfs_unlink, (const char* path), {
    const vfs = Module.vfsBridge;
    if (!vfs) return -22;
    return await vfs.vfs_unlink(path);
});

EM_ASYNC_JS(int32_t, js_vfs_rename, (const char* oldpath, const char* newpath), {
    const vfs = Module.vfsBridge;
    if (!vfs) return -22;
    return await vfs.vfs_rename(oldpath, newpath);
});

EM_ASYNC_JS(int32_t, js_vfs_opendir, (const char* path), {
    const vfs = Module.vfsBridge;
    if (!vfs) return -22;
    return await vfs.vfs_opendir(path);
});

EM_JS(int32_t, js_vfs_readdir, (int32_t handle, void* entry), {
    const vfs = Module.vfsBridge;
    if (!vfs) return -9;
    return vfs.vfs_readdir(handle, entry);
});

EM_JS(int32_t, js_vfs_closedir, (int32_t handle), {
    const vfs = Module.vfsBridge;
    if (!vfs) return -9;
    return vfs.vfs_closedir(handle);
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
    // For fstat, we need to track the path in the handle
    // This is a simplified implementation
    return -22; // VFS_EINVAL - not implemented yet
}

int32_t vfs_mkdir(const char* path) {
    return js_vfs_mkdir(path);
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
    // Directories are implicit in R2, just return success
    return 0;
}

int32_t vfs_rename(const char* oldpath, const char* newpath) {
    return js_vfs_rename(oldpath, newpath);
}

int32_t vfs_fsync(vfs_handle_t handle) {
    // R2 writes are durable once completed, so fsync is a no-op
    return 0;
}

// Initialization
static const char* g_database = nullptr;
static const char* g_table = nullptr;

int32_t vfs_init(const char* database, const char* table) {
    g_database = database;
    g_table = table;
    // JS side will initialize the VFS bridge with DO and R2 bindings
    return 0;
}

int32_t vfs_shutdown(void) {
    // Cleanup will be handled by JS
    return 0;
}

} // extern "C"
```

## Data Flow Examples

### INSERT Flow

```
1. Worker receives INSERT request
2. Worker acquires write lock from MergeTreeDO
3. Worker creates new part with unique name
4. For each column:
   a. WASM compresses column data
   b. WASM calls vfs_write()
   c. JS VFS writes to R2 via multipart upload
5. WASM writes checksums, mark files, primary index
6. Worker commits part in MergeTreeDO
7. Worker releases write lock
```

### SELECT Flow

```
1. Worker receives SELECT request
2. Worker gets active parts from MergeTreeDO
3. Worker passes part list to WASM
4. For each matching part:
   a. WASM reads primary index via vfs_read()
   b. WASM determines required granules
   c. WASM reads mark files for offsets
   d. WASM reads column data ranges via vfs_read()
   e. JS VFS fetches from R2 with range requests
5. WASM decompresses and filters data
6. WASM returns result to Worker
```

## Buffer Management

### Read Buffer Pool

```typescript
/**
 * Buffer pool for efficient memory reuse during reads
 */
export class BufferPool {
  private buffers: Map<number, ArrayBuffer[]> = new Map();
  private readonly sizes = [4096, 65536, 1048576, 16777216]; // 4KB, 64KB, 1MB, 16MB

  acquire(size: number): ArrayBuffer {
    // Find smallest buffer size that fits
    for (const bufSize of this.sizes) {
      if (bufSize >= size) {
        const pool = this.buffers.get(bufSize);
        if (pool && pool.length > 0) {
          return pool.pop()!;
        }
        return new ArrayBuffer(bufSize);
      }
    }
    // Large allocation
    return new ArrayBuffer(size);
  }

  release(buffer: ArrayBuffer): void {
    const size = buffer.byteLength;
    for (const bufSize of this.sizes) {
      if (bufSize === size) {
        const pool = this.buffers.get(bufSize) || [];
        if (pool.length < 10) { // Keep max 10 buffers per size
          pool.push(buffer);
          this.buffers.set(bufSize, pool);
        }
        return;
      }
    }
    // Don't pool large buffers
  }
}
```

### Write Buffer Coalescing

```typescript
/**
 * Coalesce small writes into larger batches for R2 efficiency
 */
export class WriteCoalescer {
  private pending: Map<string, { data: Uint8Array[]; size: number }> = new Map();
  private readonly threshold = 256 * 1024; // 256KB

  async write(key: string, data: Uint8Array, storage: MergeTreeR2Storage): Promise<void> {
    let entry = this.pending.get(key);
    if (!entry) {
      entry = { data: [], size: 0 };
      this.pending.set(key, entry);
    }

    entry.data.push(data);
    entry.size += data.length;

    if (entry.size >= this.threshold) {
      await this.flush(key, storage);
    }
  }

  async flush(key: string, storage: MergeTreeR2Storage): Promise<void> {
    const entry = this.pending.get(key);
    if (!entry || entry.data.length === 0) return;

    // Combine all pending data
    const combined = new Uint8Array(entry.size);
    let offset = 0;
    for (const chunk of entry.data) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Write combined data
    // ... write to R2 ...

    this.pending.delete(key);
  }

  async flushAll(storage: MergeTreeR2Storage): Promise<void> {
    for (const key of this.pending.keys()) {
      await this.flush(key, storage);
    }
  }
}
```

## Implementation Plan

### Phase 1: Core VFS (Week 1-2)
- [ ] Implement vfs.h C interface
- [ ] Implement VFSBridge JavaScript class
- [ ] Basic EM_JS bindings
- [ ] Unit tests for file operations

### Phase 2: R2 Storage (Week 3-4)
- [ ] Implement MergeTreeR2Storage class
- [ ] Multipart upload support
- [ ] Range read support
- [ ] Read caching

### Phase 3: DO Metadata (Week 5-6)
- [ ] Implement MergeTreeDO class
- [ ] Part registry
- [ ] Schema management
- [ ] Lock coordination

### Phase 4: Integration (Week 7-8)
- [ ] Connect VFS to MergeTree storage code
- [ ] INSERT path implementation
- [ ] SELECT path implementation
- [ ] Integration tests

### Phase 5: Optimization (Week 9-10)
- [ ] Buffer pool implementation
- [ ] Write coalescing
- [ ] Read-ahead prefetching
- [ ] Performance benchmarks

## Limitations & Future Work

### Current Limitations
1. **No MERGE operations** - Initial version doesn't support background merges
2. **Single-writer model** - Only one Worker can write at a time
3. **No ALTER support** - Schema changes require table recreation
4. **No TTL** - Time-to-live not implemented

### Future Enhancements
1. **Distributed MERGE** - Use Durable Objects to coordinate merges
2. **Lazy loading** - Load parts on demand for large tables
3. **Compression codec plugins** - Support LZ4, ZSTD, etc.
4. **Secondary indexes** - Support skipping indexes
5. **Replicated storage** - Multi-region replication via R2

## References

- [ClickHouse MergeTree Documentation](https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree)
- [ClickHouse StorageMemory Implementation](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/StorageMemory.cpp)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Emscripten EM_JS](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/Interacting-with-code.html)
