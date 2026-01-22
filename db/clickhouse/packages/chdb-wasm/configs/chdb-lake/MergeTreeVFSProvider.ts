/**
 * MergeTree VFS Storage Provider
 *
 * Implements VFSStorageProvider interface by routing VFS operations to:
 * - MergeTreeDO for metadata files (columns.txt, checksums.txt, count.txt)
 * - MergeTreeR2Storage for data files (.bin, .mrk3, .idx)
 *
 * Path format: {database}/{table}/data/{partition}/{part}/
 *
 * This provider enables the VFS bridge to work with MergeTree's split storage model
 * where small metadata is stored in Durable Objects for fast access and large data
 * files are stored in R2 for cost-effective bulk storage.
 *
 * @see wasm/vfs/vfs_bridge.ts - VFSStorageProvider interface
 * @see configs/chdb-lake/MergeTreeDO.ts - Metadata storage
 * @see configs/chdb-lake/MergeTreeR2.ts - Data storage
 */

import type {
  VFSStorageProvider,
  FileStat,
  DirEntry,
} from '../../wasm/vfs/vfs_bridge';
import type { MergeTreeDO, PartInfo } from './MergeTreeDO';
import { MergeTreeR2Storage } from './MergeTreeR2';

// =============================================================================
// Types
// =============================================================================

/**
 * Metadata files stored in Durable Objects for fast access
 * These are small files that are read frequently during query planning
 */
const METADATA_FILES = [
  'columns.txt',
  'checksums.txt',
  'count.txt',
  'primary.idx',
  'partition.dat',
  'minmax_',      // prefix for minmax index files
  'skp_idx_',     // prefix for skip index files
];

/**
 * Data files stored in R2 for cost-effective bulk storage
 * These are larger files containing actual column data
 */
const DATA_FILE_EXTENSIONS = [
  '.bin',        // Column data
  '.mrk3',       // Mark files (position index)
  '.mrk2',       // Legacy mark files
  '.mrk',        // Legacy mark files
  '.idx',        // Primary key index (larger versions)
  '.cmrk',       // Compressed mark files
  '.cidx',       // Compressed index files
];

/**
 * Parsed path components from a VFS path
 */
interface ParsedPath {
  database: string;
  table: string;
  partition?: string;
  part?: string;
  file?: string;
  /** Full path after data/ prefix */
  dataPath?: string;
}

/**
 * Environment bindings for MergeTreeVFSProvider
 */
export interface MergeTreeVFSEnv {
  /** R2 bucket for data storage */
  DATA_BUCKET: R2Bucket;
  /** Durable Object namespace for MergeTreeDO */
  MERGETREE_DO: DurableObjectNamespace<MergeTreeDO>;
}

// =============================================================================
// MergeTreeVFSProvider Implementation
// =============================================================================

/**
 * VFS Storage Provider for MergeTree tables
 *
 * Routes VFS operations to appropriate backends:
 * - MergeTreeDO: metadata files (columns.txt, checksums.txt, etc.)
 * - MergeTreeR2Storage: data files (.bin, .mrk3, etc.)
 */
export class MergeTreeVFSProvider implements VFSStorageProvider {
  private readonly r2Storage: MergeTreeR2Storage;
  private readonly env: MergeTreeVFSEnv;

  // In-memory metadata cache for writes (flushed to DO on close/sync)
  private metadataCache: Map<string, ArrayBuffer> = new Map();

  /**
   * Create a new MergeTreeVFSProvider
   *
   * @param env - Cloudflare Worker environment bindings
   */
  constructor(env: MergeTreeVFSEnv) {
    this.env = env;
    this.r2Storage = new MergeTreeR2Storage(env.DATA_BUCKET);
  }

  // ---------------------------------------------------------------------------
  // VFSStorageProvider Interface Implementation
  // ---------------------------------------------------------------------------

  /**
   * Check if a file/directory exists and get metadata
   */
  async stat(path: string): Promise<FileStat | null> {
    const normalized = this.normalizePath(path);
    const parsed = this.parsePath(normalized);

    // Check if it's a directory path
    if (this.isDirectoryPath(normalized)) {
      return this.statDirectory(normalized, parsed);
    }

    // Check metadata cache first
    if (this.metadataCache.has(normalized)) {
      const data = this.metadataCache.get(normalized)!;
      return {
        size: data.byteLength,
        mtime: Date.now(),
        ctime: Date.now(),
        isDirectory: false,
      };
    }

    // Route to appropriate backend
    if (this.isMetadataFile(normalized)) {
      return this.statMetadataFile(normalized, parsed);
    } else {
      return this.statDataFile(normalized);
    }
  }

  /**
   * Read file contents with offset and length
   */
  async read(path: string, offset: number, length: number): Promise<ArrayBuffer> {
    const normalized = this.normalizePath(path);

    // Check metadata cache first
    if (this.metadataCache.has(normalized)) {
      const data = this.metadataCache.get(normalized)!;
      return data.slice(offset, offset + length);
    }

    // Route to appropriate backend
    if (this.isMetadataFile(normalized)) {
      const fullData = await this.readMetadataFile(normalized);
      return fullData.slice(offset, offset + length);
    } else {
      const data = await this.r2Storage.readRange(normalized, offset, length);
      return data.buffer;
    }
  }

  /**
   * Read entire file contents
   */
  async readFile(path: string): Promise<ArrayBuffer> {
    const normalized = this.normalizePath(path);

    // Check metadata cache first
    if (this.metadataCache.has(normalized)) {
      return this.metadataCache.get(normalized)!;
    }

    // Route to appropriate backend
    if (this.isMetadataFile(normalized)) {
      return this.readMetadataFile(normalized);
    } else {
      const data = await this.r2Storage.readFile(normalized);
      return data.buffer;
    }
  }

  /**
   * Write data to file (creates or overwrites)
   */
  async write(path: string, data: ArrayBuffer): Promise<void> {
    const normalized = this.normalizePath(path);

    if (this.isMetadataFile(normalized)) {
      // Cache metadata writes - will be flushed to DO on sync
      this.metadataCache.set(normalized, data);
    } else {
      // Write data files directly to R2
      await this.r2Storage.writeFile(normalized, new Uint8Array(data));
    }
  }

  /**
   * Append data to file
   */
  async append(path: string, data: ArrayBuffer): Promise<void> {
    const normalized = this.normalizePath(path);

    // Read existing data and combine
    let existing: ArrayBuffer;
    try {
      existing = await this.readFile(normalized);
    } catch {
      existing = new ArrayBuffer(0);
    }

    const combined = new Uint8Array(existing.byteLength + data.byteLength);
    combined.set(new Uint8Array(existing), 0);
    combined.set(new Uint8Array(data), existing.byteLength);

    await this.write(normalized, combined.buffer);
  }

  /**
   * Delete a file
   */
  async delete(path: string): Promise<void> {
    const normalized = this.normalizePath(path);

    // Remove from metadata cache
    this.metadataCache.delete(normalized);

    if (this.isMetadataFile(normalized)) {
      // Metadata files are managed through the DO - deletion happens via part management
      // For now, just remove from cache
      console.log(`[MergeTreeVFS] Metadata file deletion: ${normalized}`);
    } else {
      // Delete data file from R2
      await this.r2Storage.deleteFile(normalized);
    }
  }

  /**
   * List directory contents
   */
  async list(path: string): Promise<DirEntry[]> {
    const normalized = this.normalizePath(path);
    const parsed = this.parsePath(normalized);

    // If listing at database/table level, combine DO parts with R2 listing
    if (parsed.database && parsed.table && !parsed.partition) {
      return this.listTableDirectory(parsed);
    }

    // If listing at partition level, list parts
    if (parsed.partition && !parsed.part) {
      return this.listPartitionDirectory(parsed);
    }

    // If listing at part level, list files (combine metadata + data)
    if (parsed.part) {
      return this.listPartDirectory(normalized, parsed);
    }

    // For root-level listing, return databases
    return this.listRootDirectory();
  }

  /**
   * Create a directory
   */
  async mkdir(path: string): Promise<void> {
    // Directories are implicit in object storage
    // No-op for R2/DO storage
    console.log(`[MergeTreeVFS] mkdir: ${path} (implicit)`);
  }

  /**
   * Rename/move a file
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const normalizedOld = this.normalizePath(oldPath);
    const normalizedNew = this.normalizePath(newPath);

    // Check metadata cache
    if (this.metadataCache.has(normalizedOld)) {
      const data = this.metadataCache.get(normalizedOld)!;
      this.metadataCache.set(normalizedNew, data);
      this.metadataCache.delete(normalizedOld);
      return;
    }

    // For data files, copy then delete
    if (!this.isMetadataFile(normalizedOld)) {
      const data = await this.r2Storage.readFile(normalizedOld);
      await this.r2Storage.writeFile(normalizedNew, data);
      await this.r2Storage.deleteFile(normalizedOld);
    }
  }

  /**
   * Flush pending writes
   */
  async flush(): Promise<void> {
    // Flush metadata cache to Durable Objects
    for (const [path, data] of this.metadataCache) {
      await this.flushMetadataFile(path, data);
    }
    // Keep cache for subsequent reads - will be cleared on file close
  }

  // ---------------------------------------------------------------------------
  // Private Helpers - Path Handling
  // ---------------------------------------------------------------------------

  /**
   * Normalize a path by removing leading/trailing slashes and double slashes
   */
  private normalizePath(path: string): string {
    return path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  }

  /**
   * Parse a VFS path into components
   *
   * Expected format: {database}/{table}/data/{partition}/{part}/{file}
   */
  private parsePath(path: string): ParsedPath {
    const parts = path.split('/');

    const result: ParsedPath = {
      database: parts[0] || '',
      table: parts[1] || '',
    };

    // Check for data/ prefix
    if (parts[2] === 'data') {
      result.partition = parts[3];
      result.part = parts[4];
      result.file = parts[5];
      result.dataPath = parts.slice(3).join('/');
    }

    return result;
  }

  /**
   * Check if a path refers to a directory (ends with / or has no file component)
   */
  private isDirectoryPath(path: string): boolean {
    const parsed = this.parsePath(path);

    // No file component means directory
    if (!parsed.file) {
      return true;
    }

    // Check if the "file" component looks like a directory
    // (no extension and doesn't match known file patterns)
    const file = parsed.file;
    return !file.includes('.') && !METADATA_FILES.some((m) => file.startsWith(m));
  }

  /**
   * Check if a file should be stored as metadata (in DO)
   */
  private isMetadataFile(path: string): boolean {
    const filename = path.split('/').pop() || '';

    // Check exact matches and prefixes
    for (const pattern of METADATA_FILES) {
      if (filename === pattern || filename.startsWith(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a file should be stored as data (in R2)
   */
  private isDataFile(path: string): boolean {
    const filename = path.split('/').pop() || '';

    for (const ext of DATA_FILE_EXTENSIONS) {
      if (filename.endsWith(ext)) {
        return true;
      }
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers - Stat Operations
  // ---------------------------------------------------------------------------

  /**
   * Get stats for a directory path
   */
  private async statDirectory(
    _path: string,
    parsed: ParsedPath
  ): Promise<FileStat | null> {
    // Verify directory exists by checking if we can list it
    if (parsed.database && parsed.table) {
      const stub = this.getDOStub(parsed.database, parsed.table);
      const parts = await stub.listParts(parsed.table);

      if (parsed.partition) {
        // Check if partition exists
        const hasPartition = parts.some((p) => p.partition === parsed.partition);
        if (!hasPartition) {
          return null;
        }
      }

      if (parsed.part) {
        // Check if part exists
        const hasPart = parts.some((p) => p.name === parsed.part);
        if (!hasPart) {
          return null;
        }
      }
    }

    return {
      size: 0,
      mtime: Date.now(),
      ctime: Date.now(),
      isDirectory: true,
    };
  }

  /**
   * Get stats for a metadata file (from DO)
   */
  private async statMetadataFile(
    path: string,
    parsed: ParsedPath
  ): Promise<FileStat | null> {
    if (!parsed.database || !parsed.table || !parsed.part) {
      return null;
    }

    // For now, estimate metadata file sizes based on part info
    const stub = this.getDOStub(parsed.database, parsed.table);
    const parts = await stub.listParts(parsed.table);
    const part = parts.find((p) => p.name === parsed.part);

    if (!part) {
      return null;
    }

    // Metadata files exist if the part exists
    // Estimate size based on file type
    const filename = parsed.file || '';
    let estimatedSize = 0;

    if (filename === 'columns.txt') {
      estimatedSize = 256; // Column definitions
    } else if (filename === 'checksums.txt') {
      estimatedSize = 512; // Checksums
    } else if (filename === 'count.txt') {
      estimatedSize = 16; // Row count
    } else if (filename === 'primary.idx') {
      // Primary index scales with rows
      estimatedSize = Math.min(part.rows * 8, 1024 * 1024);
    } else if (filename.startsWith('minmax_') || filename.startsWith('skp_idx_')) {
      estimatedSize = 128; // Small index files
    }

    return {
      size: estimatedSize,
      mtime: part.modificationTime,
      ctime: part.modificationTime,
      isDirectory: false,
    };
  }

  /**
   * Get stats for a data file (from R2)
   */
  private async statDataFile(path: string): Promise<FileStat | null> {
    try {
      const exists = await this.r2Storage.exists(path);
      if (!exists) {
        return null;
      }

      const size = await this.r2Storage.getFileSize(path);
      return {
        size,
        mtime: Date.now(),
        ctime: Date.now(),
        isDirectory: false,
      };
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers - Read Operations
  // ---------------------------------------------------------------------------

  /**
   * Read a metadata file from DO or return synthetic content
   */
  private async readMetadataFile(path: string): Promise<ArrayBuffer> {
    const parsed = this.parsePath(path);

    if (!parsed.database || !parsed.table || !parsed.part) {
      throw new Error(`Invalid metadata path: ${path}`);
    }

    const stub = this.getDOStub(parsed.database, parsed.table);
    const parts = await stub.listParts(parsed.table);
    const part = parts.find((p) => p.name === parsed.part);

    if (!part) {
      throw new Error(`Part not found: ${parsed.part}`);
    }

    const filename = parsed.file || '';

    // Generate synthetic metadata content based on part info
    if (filename === 'count.txt') {
      const content = String(part.rows);
      return new TextEncoder().encode(content).buffer;
    }

    if (filename === 'columns.txt') {
      // Return placeholder column definition
      const content = `columns format version: 1\n1 columns:\n\`data\` String\n`;
      return new TextEncoder().encode(content).buffer;
    }

    if (filename === 'checksums.txt') {
      // Return placeholder checksums
      const content = `checksums format version: 4\n${part.checksum || 'checksum'}\n`;
      return new TextEncoder().encode(content).buffer;
    }

    // For other metadata files, try R2 as fallback
    const data = await this.r2Storage.readFile(path);
    return data.buffer;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers - Write Operations
  // ---------------------------------------------------------------------------

  /**
   * Flush a metadata file to Durable Object
   */
  private async flushMetadataFile(path: string, data: ArrayBuffer): Promise<void> {
    const parsed = this.parsePath(path);

    if (!parsed.database || !parsed.table || !parsed.part) {
      console.warn(`[MergeTreeVFS] Cannot flush metadata for invalid path: ${path}`);
      return;
    }

    // For now, metadata is managed through the part registry
    // Individual file writes are cached and the part is registered/updated as a whole
    console.log(
      `[MergeTreeVFS] Metadata flush for ${path}: ${data.byteLength} bytes`
    );
  }

  // ---------------------------------------------------------------------------
  // Private Helpers - List Operations
  // ---------------------------------------------------------------------------

  /**
   * List root directory (databases)
   */
  private async listRootDirectory(): Promise<DirEntry[]> {
    // List unique database prefixes from R2
    const files = await this.r2Storage.listFiles('');
    const databases = new Set<string>();

    for (const file of files) {
      const parts = file.split('/');
      if (parts[0]) {
        databases.add(parts[0]);
      }
    }

    return Array.from(databases).map((name) => ({
      name,
      isDirectory: true,
      size: 0,
    }));
  }

  /**
   * List table directory (data/ and partitions)
   */
  private async listTableDirectory(parsed: ParsedPath): Promise<DirEntry[]> {
    const entries: DirEntry[] = [];

    // Add data/ directory entry
    entries.push({
      name: 'data',
      isDirectory: true,
      size: 0,
    });

    // List partitions from DO
    const stub = this.getDOStub(parsed.database, parsed.table);
    const parts = await stub.listParts(parsed.table);

    const partitions = new Set<string>();
    for (const part of parts) {
      partitions.add(part.partition);
    }

    for (const partition of partitions) {
      entries.push({
        name: partition,
        isDirectory: true,
        size: 0,
      });
    }

    return entries;
  }

  /**
   * List partition directory (parts)
   */
  private async listPartitionDirectory(parsed: ParsedPath): Promise<DirEntry[]> {
    const stub = this.getDOStub(parsed.database, parsed.table);
    const parts = await stub.getActiveParts(parsed.table, parsed.partition);

    return parts.map((part) => ({
      name: part.name,
      isDirectory: true,
      size: 0,
    }));
  }

  /**
   * List part directory (files)
   */
  private async listPartDirectory(
    basePath: string,
    parsed: ParsedPath
  ): Promise<DirEntry[]> {
    const entries: DirEntry[] = [];
    const seenFiles = new Set<string>();

    // Add metadata files
    const metadataFiles = ['columns.txt', 'checksums.txt', 'count.txt', 'primary.idx'];
    for (const filename of metadataFiles) {
      entries.push({
        name: filename,
        isDirectory: false,
        size: 0, // Will be filled on stat
      });
      seenFiles.add(filename);
    }

    // List data files from R2
    const prefix = basePath.endsWith('/') ? basePath : basePath + '/';
    const files = await this.r2Storage.listFiles(prefix);

    for (const filePath of files) {
      const filename = filePath.split('/').pop() || '';
      if (!seenFiles.has(filename)) {
        entries.push({
          name: filename,
          isDirectory: false,
          size: 0, // Will be filled on stat
        });
        seenFiles.add(filename);
      }
    }

    return entries;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers - DO Access
  // ---------------------------------------------------------------------------

  /**
   * Get a Durable Object stub for the given database/table
   */
  private getDOStub(database: string, table: string): DurableObjectStub<MergeTreeDO> {
    const id = this.env.MERGETREE_DO.idFromName(`${database}.${table}`);
    return this.env.MERGETREE_DO.get(id);
  }

  // ---------------------------------------------------------------------------
  // Public Helpers - Part Management Integration
  // ---------------------------------------------------------------------------

  /**
   * Register a new part in the DO registry
   *
   * Call this after writing all part files to complete the insert operation.
   *
   * @param database - Database name
   * @param table - Table name
   * @param partInfo - Part information to register
   */
  async registerPart(
    database: string,
    table: string,
    partInfo: Omit<PartInfo, 'minBlock' | 'maxBlock' | 'state'>
  ): Promise<PartInfo> {
    const stub = this.getDOStub(database, table);
    return stub.registerPart(table, partInfo);
  }

  /**
   * Commit a part (make visible for queries)
   *
   * @param database - Database name
   * @param table - Table name
   * @param partName - Part name to commit
   */
  async commitPart(database: string, table: string, partName: string): Promise<void> {
    const stub = this.getDOStub(database, table);
    await stub.commitPart(table, partName);

    // Clear metadata cache for this part after commit
    const prefix = `${database}/${table}/data/`;
    for (const key of this.metadataCache.keys()) {
      if (key.startsWith(prefix) && key.includes(partName)) {
        this.metadataCache.delete(key);
      }
    }
  }

  /**
   * Get active parts for query execution
   *
   * @param database - Database name
   * @param table - Table name
   * @param partition - Optional partition filter
   */
  async getActiveParts(
    database: string,
    table: string,
    partition?: string
  ): Promise<PartInfo[]> {
    const stub = this.getDOStub(database, table);
    return stub.getActiveParts(table, partition);
  }

  /**
   * Clear the metadata cache
   */
  clearCache(): void {
    this.metadataCache.clear();
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a MergeTreeVFSProvider instance
 *
 * @param env - Cloudflare Worker environment bindings
 */
export function createMergeTreeVFSProvider(
  env: MergeTreeVFSEnv
): MergeTreeVFSProvider {
  return new MergeTreeVFSProvider(env);
}
