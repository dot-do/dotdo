/**
 * MergeTree VFS Abstraction Layer for WASM Compatibility
 *
 * This module provides a virtual file system abstraction that enables MergeTree
 * storage engine to compile and run in a WASM environment (Cloudflare Workers).
 *
 * ## Architecture Overview
 *
 * ClickHouse's MergeTree engine relies on several system-level features that are
 * either unavailable or problematic in WASM environments:
 *
 * 1. **Direct File I/O** - Replaced with VFS abstraction
 * 2. **Memory-Mapped Files (mmap)** - Stubbed/disabled
 * 3. **Background Threading** - Replaced with synchronous operations
 * 4. **Disk Space Checks** - Stubbed with infinite space
 * 5. **File System Operations** - Delegated to storage provider
 *
 * ## Key Abstractions
 *
 * ### IDataPartStorage Interface (ClickHouse)
 * ClickHouse already provides `IDataPartStorage` abstraction in:
 *   - `vendor/chdb/src/Storages/MergeTree/IDataPartStorage.h`
 *   - `vendor/chdb/src/Storages/MergeTree/DataPartStorageOnDiskBase.h`
 *
 * This existing abstraction is leveraged to redirect file operations through
 * our JavaScript VFS bridge instead of the native filesystem.
 *
 * ### IDisk Interface (ClickHouse)
 * The disk abstraction in `vendor/chdb/src/Disks/IDisk.h` provides:
 *   - Space reservation/checking
 *   - File read/write operations
 *   - Directory operations
 *
 * ### VFS Bridge (This Module)
 * Our TypeScript VFS bridge (`vfs-bridge.ts`) implements the VFS protocol
 * that WASM modules call via EM_ASYNC_JS bindings.
 *
 * ## What's Stubbed vs Real
 *
 * ### REAL (Fully Implemented):
 * - File read operations (via VFSStorageProvider)
 * - File write operations (via VFSStorageProvider)
 * - Directory listing/creation
 * - Part metadata parsing (columns.txt, checksums.txt)
 * - Column data reading (*.bin files)
 * - Mark file reading (*.mrk, *.mrk2, *.mrk3)
 * - Primary index reading (primary.idx)
 *
 * ### STUBBED (No-op or Fixed Response):
 * - mmap operations (disabled, use pread instead)
 * - Background merge threads (disabled)
 * - Background mutation threads (disabled)
 * - Disk space checks (return infinite space)
 * - fsync/sync operations (no-op in object storage)
 * - Hard links (fall back to copy)
 * - File locking (not needed in single-worker model)
 *
 * ### DISABLED (Throws Error):
 * - Replicated tables (require ZooKeeper)
 * - Data part fetches (require network between replicas)
 * - Backup operations (require local disk access)
 *
 * @packageDocumentation
 */

import type { VFSStorageProvider, FileStat, DirEntry } from './wasm/vfs-bridge';

// ---------------------------------------------------------------------------
// WASM MergeTree Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for MergeTree in WASM environment
 */
export interface WasmMergeTreeConfig {
  /**
   * Disable mmap operations. Must be true for WASM.
   * @default true
   */
  disableMmap: boolean;

  /**
   * Disable background merge operations.
   * Merges will be synchronous or skipped.
   * @default true
   */
  disableBackgroundMerge: boolean;

  /**
   * Disable background mutation operations.
   * Mutations will be synchronous or skipped.
   * @default true
   */
  disableBackgroundMutations: boolean;

  /**
   * Use pread for all file reads instead of mmap.
   * @default true
   */
  forcePread: boolean;

  /**
   * Return infinite disk space for all space checks.
   * @default true
   */
  infiniteDiskSpace: boolean;

  /**
   * Skip fsync calls (object storage has eventual consistency anyway).
   * @default true
   */
  skipFsync: boolean;

  /**
   * Maximum number of parts to read in parallel.
   * Since WASM is single-threaded, this controls batching.
   * @default 1
   */
  maxParallelParts: number;

  /**
   * Read buffer size for part files.
   * @default 65536
   */
  readBufferSize: number;

  /**
   * Maximum memory for part data caching.
   * @default 10485760 (10MB)
   */
  maxCacheSize: number;
}

/**
 * Default configuration for WASM MergeTree
 */
export const DEFAULT_WASM_MERGETREE_CONFIG: WasmMergeTreeConfig = {
  disableMmap: true,
  disableBackgroundMerge: true,
  disableBackgroundMutations: true,
  forcePread: true,
  infiniteDiskSpace: true,
  skipFsync: true,
  maxParallelParts: 1,
  readBufferSize: 65536,
  maxCacheSize: 10 * 1024 * 1024,
};

// ---------------------------------------------------------------------------
// Disk Space Stubs
// ---------------------------------------------------------------------------

/**
 * Stubbed disk space information for WASM environment.
 * Always reports large available space since we're using object storage.
 */
export interface StubDiskSpace {
  totalSpace: bigint;
  availableSpace: bigint;
  unreservedSpace: bigint;
}

/**
 * Get stubbed disk space (infinite for WASM)
 */
export function getStubDiskSpace(): StubDiskSpace {
  // 1 petabyte - effectively infinite
  const infinite = BigInt(1024) * BigInt(1024) * BigInt(1024) * BigInt(1024) * BigInt(1024);
  return {
    totalSpace: infinite,
    availableSpace: infinite,
    unreservedSpace: infinite,
  };
}

// ---------------------------------------------------------------------------
// Background Thread Stubs
// ---------------------------------------------------------------------------

/**
 * Stub for background merge scheduler.
 * In WASM, merges are either synchronous or skipped.
 */
export class StubMergeScheduler {
  private config: WasmMergeTreeConfig;

  constructor(config: WasmMergeTreeConfig = DEFAULT_WASM_MERGETREE_CONFIG) {
    this.config = config;
  }

  /**
   * Try to schedule a merge. In WASM, this is a no-op.
   * @returns false - merge not scheduled
   */
  tryScheduleMerge(_tableName: string, _parts: string[]): boolean {
    if (this.config.disableBackgroundMerge) {
      return false;
    }
    // Even if not disabled, we can't do async background work
    return false;
  }

  /**
   * Check if merge is pending. Always false in WASM.
   */
  isMergePending(_tableName: string): boolean {
    return false;
  }

  /**
   * Get number of queued merges. Always 0 in WASM.
   */
  getQueuedMergeCount(): number {
    return 0;
  }

  /**
   * Wait for all merges to complete. No-op in WASM.
   */
  async waitForMerges(): Promise<void> {
    // No-op - no background merges in WASM
  }
}

/**
 * Stub for background mutation scheduler.
 * In WASM, mutations are either synchronous or skipped.
 */
export class StubMutationScheduler {
  private config: WasmMergeTreeConfig;

  constructor(config: WasmMergeTreeConfig = DEFAULT_WASM_MERGETREE_CONFIG) {
    this.config = config;
  }

  /**
   * Try to schedule a mutation. In WASM, this is a no-op.
   * @returns false - mutation not scheduled
   */
  tryScheduleMutation(_tableName: string, _mutationId: string): boolean {
    if (this.config.disableBackgroundMutations) {
      return false;
    }
    return false;
  }

  /**
   * Check if mutation is pending. Always false in WASM.
   */
  isMutationPending(_tableName: string, _mutationId: string): boolean {
    return false;
  }
}

// ---------------------------------------------------------------------------
// MMap Stubs
// ---------------------------------------------------------------------------

/**
 * Stub for memory-mapped file operations.
 * All mmap operations are converted to pread.
 */
export class StubMmapManager {
  private storage: VFSStorageProvider;

  constructor(storage: VFSStorageProvider, _config: WasmMergeTreeConfig = DEFAULT_WASM_MERGETREE_CONFIG) {
    this.storage = storage;
  }

  /**
   * "Map" a file into memory. In WASM, this reads the entire file.
   * @param path File path
   * @returns File contents as ArrayBuffer
   */
  async mapFile(path: string): Promise<ArrayBuffer> {
    // Instead of mmap, just read the file
    return this.storage.readFile(path);
  }

  /**
   * "Map" a region of a file. In WASM, this does a pread.
   * @param path File path
   * @param offset Byte offset
   * @param length Byte length
   * @returns File region as ArrayBuffer
   */
  async mapRegion(path: string, offset: number, length: number): Promise<ArrayBuffer> {
    return this.storage.read(path, offset, length);
  }

  /**
   * Unmap a file. No-op in WASM since we don't actually mmap.
   */
  unmapFile(_path: string): void {
    // No-op - nothing to unmap
  }

  /**
   * Check if mmap is supported. Always false for WASM.
   */
  isMmapSupported(): boolean {
    return false;
  }

  /**
   * Get preferred read method. Always 'pread' for WASM.
   */
  getPreferredReadMethod(): 'pread' | 'mmap' {
    return 'pread';
  }
}

// ---------------------------------------------------------------------------
// File System Sync Stubs
// ---------------------------------------------------------------------------

/**
 * Stub for filesystem sync operations.
 * Object storage has eventual consistency, so fsync is a no-op.
 */
export class StubSyncManager {
  private config: WasmMergeTreeConfig;

  constructor(config: WasmMergeTreeConfig = DEFAULT_WASM_MERGETREE_CONFIG) {
    this.config = config;
  }

  /**
   * Sync a file. No-op in WASM with object storage.
   */
  async fsync(_path: string): Promise<void> {
    if (this.config.skipFsync) {
      return;
    }
    // Even if not skipped, object storage doesn't support fsync
  }

  /**
   * Sync a directory. No-op in WASM.
   */
  async syncDirectory(_path: string): Promise<void> {
    // No-op
  }

  /**
   * Create a sync guard. Returns a no-op implementation.
   */
  getSyncGuard(_path: string): SyncGuard {
    return new NoopSyncGuard();
  }
}

/**
 * Interface for sync guards (matches ClickHouse ISyncGuard)
 */
export interface SyncGuard {
  sync(): Promise<void>;
}

/**
 * No-op sync guard implementation
 */
class NoopSyncGuard implements SyncGuard {
  async sync(): Promise<void> {
    // No-op
  }
}

// ---------------------------------------------------------------------------
// Hard Link Stubs
// ---------------------------------------------------------------------------

/**
 * Stub for hard link operations.
 * In WASM with object storage, hard links fall back to copy.
 */
export class StubHardLinkManager {
  private storage: VFSStorageProvider;

  constructor(storage: VFSStorageProvider) {
    this.storage = storage;
  }

  /**
   * Create a hard link. Falls back to copy in WASM.
   * @param source Source path
   * @param target Target path
   */
  async createHardLink(source: string, target: string): Promise<void> {
    // Fall back to copy since object storage doesn't support hard links
    const data = await this.storage.readFile(source);
    await this.storage.write(target, data);
  }

  /**
   * Check if hard links are supported. Always false for WASM.
   */
  supportsHardLinks(): boolean {
    return false;
  }
}

// ---------------------------------------------------------------------------
// WASM MergeTree VFS Adapter
// ---------------------------------------------------------------------------

/**
 * VFS adapter that provides WASM-compatible MergeTree operations.
 * This bridges the gap between ClickHouse's expectations and WASM limitations.
 */
export class WasmMergeTreeVFS {
  private storage: VFSStorageProvider;
  private config: WasmMergeTreeConfig;

  private mmapManager: StubMmapManager;
  private syncManager: StubSyncManager;
  private hardLinkManager: StubHardLinkManager;
  private mergeScheduler: StubMergeScheduler;
  private mutationScheduler: StubMutationScheduler;

  constructor(
    storage: VFSStorageProvider,
    config: Partial<WasmMergeTreeConfig> = {}
  ) {
    this.storage = storage;
    this.config = { ...DEFAULT_WASM_MERGETREE_CONFIG, ...config };

    this.mmapManager = new StubMmapManager(storage, this.config);
    this.syncManager = new StubSyncManager(this.config);
    this.hardLinkManager = new StubHardLinkManager(storage);
    this.mergeScheduler = new StubMergeScheduler(this.config);
    this.mutationScheduler = new StubMutationScheduler(this.config);
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * Get current configuration
   */
  getConfig(): Readonly<WasmMergeTreeConfig> {
    return this.config;
  }

  /**
   * Check if WASM mode is enabled
   */
  isWasmMode(): boolean {
    return true;
  }

  // -------------------------------------------------------------------------
  // Disk Space Operations
  // -------------------------------------------------------------------------

  /**
   * Get total disk space (stubbed to infinite)
   */
  getTotalSpace(): bigint {
    return getStubDiskSpace().totalSpace;
  }

  /**
   * Get available disk space (stubbed to infinite)
   */
  getAvailableSpace(): bigint {
    return getStubDiskSpace().availableSpace;
  }

  /**
   * Get unreserved disk space (stubbed to infinite)
   */
  getUnreservedSpace(): bigint {
    return getStubDiskSpace().unreservedSpace;
  }

  /**
   * Reserve disk space. Always succeeds in WASM.
   */
  reserveSpace(_bytes: bigint): boolean {
    return true;
  }

  // -------------------------------------------------------------------------
  // File Operations
  // -------------------------------------------------------------------------

  /**
   * Check if file exists
   */
  async fileExists(path: string): Promise<boolean> {
    const stat = await this.storage.stat(path);
    return stat !== null && !stat.isDirectory;
  }

  /**
   * Check if directory exists
   */
  async directoryExists(path: string): Promise<boolean> {
    const stat = await this.storage.stat(path);
    return stat !== null && stat.isDirectory;
  }

  /**
   * Get file size
   */
  async getFileSize(path: string): Promise<number> {
    const stat = await this.storage.stat(path);
    if (!stat || stat.isDirectory) {
      throw new Error(`File not found: ${path}`);
    }
    return stat.size;
  }

  /**
   * Read entire file
   */
  async readFile(path: string): Promise<ArrayBuffer> {
    return this.storage.readFile(path);
  }

  /**
   * Read file region (pread)
   */
  async readFileRegion(path: string, offset: number, length: number): Promise<ArrayBuffer> {
    return this.storage.read(path, offset, length);
  }

  /**
   * Write file
   */
  async writeFile(path: string, data: ArrayBuffer): Promise<void> {
    return this.storage.write(path, data);
  }

  /**
   * Delete file
   */
  async deleteFile(path: string): Promise<void> {
    return this.storage.delete(path);
  }

  /**
   * Create directory
   */
  async createDirectory(path: string): Promise<void> {
    return this.storage.mkdir(path);
  }

  /**
   * List directory contents
   */
  async listDirectory(path: string): Promise<DirEntry[]> {
    return this.storage.list(path);
  }

  /**
   * Rename file or directory
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    return this.storage.rename(oldPath, newPath);
  }

  // -------------------------------------------------------------------------
  // Stubbed Operations
  // -------------------------------------------------------------------------

  /**
   * Get mmap manager (stubbed)
   */
  getMmapManager(): StubMmapManager {
    return this.mmapManager;
  }

  /**
   * Get sync manager (stubbed)
   */
  getSyncManager(): StubSyncManager {
    return this.syncManager;
  }

  /**
   * Get hard link manager (stubbed with copy fallback)
   */
  getHardLinkManager(): StubHardLinkManager {
    return this.hardLinkManager;
  }

  /**
   * Get merge scheduler (stubbed)
   */
  getMergeScheduler(): StubMergeScheduler {
    return this.mergeScheduler;
  }

  /**
   * Get mutation scheduler (stubbed)
   */
  getMutationScheduler(): StubMutationScheduler {
    return this.mutationScheduler;
  }

  // -------------------------------------------------------------------------
  // Read Settings for WASM
  // -------------------------------------------------------------------------

  /**
   * Get read settings appropriate for WASM environment.
   * This matches ClickHouse's ReadSettings structure.
   */
  getWasmReadSettings(): WasmReadSettings {
    return {
      local_fs_method: 'pread', // Never use mmap in WASM
      local_fs_buffer_size: this.config.readBufferSize,
      mmap_threshold: 0, // Disable mmap completely
      load_marks_asynchronously: false, // No async in WASM
      direct_io_threshold: 0, // No direct I/O in WASM
    };
  }
}

/**
 * Read settings for WASM environment
 * (mirrors ClickHouse ReadSettings structure)
 */
export interface WasmReadSettings {
  local_fs_method: 'pread' | 'read';
  local_fs_buffer_size: number;
  mmap_threshold: number;
  load_marks_asynchronously: boolean;
  direct_io_threshold: number;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  type VFSStorageProvider,
  type FileStat,
  type DirEntry,
};

/**
 * Create a WASM-compatible MergeTree VFS
 */
export function createWasmMergeTreeVFS(
  storage: VFSStorageProvider,
  config?: Partial<WasmMergeTreeConfig>
): WasmMergeTreeVFS {
  return new WasmMergeTreeVFS(storage, config);
}
