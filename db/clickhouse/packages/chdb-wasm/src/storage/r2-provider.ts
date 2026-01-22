/**
 * R2 Storage Provider
 *
 * Implements the VFSStorageProvider interface using Cloudflare R2 storage.
 * This bridges the VFS abstraction layer with R2 object storage for
 * ClickHouse MergeTree data storage.
 *
 * Features:
 * - Full VFSStorageProvider interface implementation
 * - Range request support for efficient partial reads
 * - Metadata caching for reduced API calls
 * - Directory emulation on top of object storage
 * - Proper error handling with VFS error codes
 *
 * Path Structure for MergeTree:
 *   data/{database}/{table}/{partition}/{part_name}/{file}
 *
 * @module storage/r2-provider
 */

import type {
  VFSStorageProvider,
  FileStat,
  DirEntry,
} from '../wasm/vfs-bridge';

// ============================================================================
// R2 Bucket Interface (Cloudflare Workers R2 API)
// ============================================================================

/**
 * R2 Range specification for partial reads
 */
interface R2Range {
  offset?: number;
  length?: number;
  suffix?: number;
}

/**
 * R2 Object metadata returned by head()
 */
interface R2ObjectHead {
  key: string;
  size: number;
  etag?: string;
  httpEtag?: string;
  uploaded?: Date;
  customMetadata?: Record<string, string>;
}

/**
 * R2 Object with body returned by get()
 */
interface R2Object extends R2ObjectHead {
  body?: ReadableStream<Uint8Array>;
  range?: { offset: number; length: number };
  arrayBuffer(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
}

/**
 * R2 Put result
 */
interface R2PutResult {
  key: string;
  etag?: string;
  httpEtag?: string;
}

/**
 * R2 List result
 */
interface R2ListResult {
  objects: R2ObjectHead[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes?: string[];
}

/**
 * R2 Bucket interface (subset of Cloudflare's R2Bucket)
 */
export interface R2Bucket {
  get(key: string, options?: { range?: R2Range }): Promise<R2Object | null>;
  head(key: string): Promise<R2ObjectHead | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream | string,
    options?: { customMetadata?: Record<string, string> }
  ): Promise<R2PutResult>;
  delete(key: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<R2ListResult>;
}

// ============================================================================
// R2 Storage Provider Options
// ============================================================================

/**
 * Configuration options for R2StorageProvider
 */
export interface R2StorageProviderOptions {
  /**
   * Base prefix for all storage keys.
   * Useful for namespacing data within a bucket.
   * @default ''
   */
  prefix?: string;

  /**
   * Enable metadata caching for reduced API calls
   * @default true
   */
  cacheMetadata?: boolean;

  /**
   * Cache TTL in milliseconds
   * @default 30000 (30 seconds)
   */
  cacheTTL?: number;

  /**
   * Maximum number of cache entries
   * @default 1000
   */
  maxCacheEntries?: number;

  /**
   * Enable directory markers for proper directory listing
   * When true, mkdir() creates a zero-byte marker object
   * @default true
   */
  useDirectoryMarkers?: boolean;

  /**
   * Custom directory marker suffix
   * @default '/.marker'
   */
  directoryMarkerSuffix?: string;
}

// ============================================================================
// Metadata Cache
// ============================================================================

interface CacheEntry {
  stat: FileStat;
  cachedAt: number;
}

// ============================================================================
// R2 Storage Provider Implementation
// ============================================================================

/**
 * R2 Storage Provider implementing VFSStorageProvider interface
 *
 * This provider allows the VFS bridge to use Cloudflare R2 as a backend
 * for ClickHouse MergeTree data storage.
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker
 * const provider = new R2StorageProvider(env.DATA_BUCKET, {
 *   prefix: 'clickhouse/data/',
 *   cacheMetadata: true,
 * });
 *
 * const vfs = new VFSBridge(provider);
 * ```
 */
export class R2StorageProvider implements VFSStorageProvider {
  private bucket: R2Bucket;
  private options: Required<R2StorageProviderOptions>;
  private metadataCache: Map<string, CacheEntry> = new Map();
  private directories: Set<string> = new Set();

  constructor(bucket: R2Bucket, options: R2StorageProviderOptions = {}) {
    this.bucket = bucket;
    this.options = {
      prefix: options.prefix ?? '',
      cacheMetadata: options.cacheMetadata ?? true,
      cacheTTL: options.cacheTTL ?? 30000,
      maxCacheEntries: options.maxCacheEntries ?? 1000,
      useDirectoryMarkers: options.useDirectoryMarkers ?? true,
      directoryMarkerSuffix: options.directoryMarkerSuffix ?? '/.marker',
    };

    // Initialize root directory
    this.directories.add('');
    this.directories.add('/');
  }

  /**
   * Build full R2 key from path
   */
  private buildKey(path: string): string {
    const normalized = this.normalizePath(path);
    if (!this.options.prefix) {
      return normalized;
    }
    const prefix = this.options.prefix.replace(/\/+$/, '');
    return normalized ? `${prefix}/${normalized}` : prefix;
  }

  /**
   * Normalize path by removing leading/trailing slashes and collapsing multiple slashes
   */
  private normalizePath(path: string): string {
    return path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  }

  /**
   * Get cached stat or null if not cached/expired
   */
  private getCached(path: string): FileStat | null {
    if (!this.options.cacheMetadata) {
      return null;
    }

    const entry = this.metadataCache.get(path);
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.cachedAt > this.options.cacheTTL) {
      this.metadataCache.delete(path);
      return null;
    }

    return entry.stat;
  }

  /**
   * Cache a stat entry
   */
  private setCached(path: string, stat: FileStat): void {
    if (!this.options.cacheMetadata) {
      return;
    }

    this.metadataCache.set(path, {
      stat,
      cachedAt: Date.now(),
    });

    // Evict old entries if cache is too large
    if (this.metadataCache.size > this.options.maxCacheEntries) {
      const entries = Array.from(this.metadataCache.entries())
        .sort((a, b) => a[1].cachedAt - b[1].cachedAt);

      const toRemove = entries.length - Math.floor(this.options.maxCacheEntries * 0.8);
      for (let i = 0; i < toRemove; i++) {
        this.metadataCache.delete(entries[i][0]);
      }
    }
  }

  /**
   * Invalidate cached entry
   */
  private invalidateCache(path: string): void {
    this.metadataCache.delete(path);
  }

  /**
   * Get file/directory statistics
   */
  async stat(path: string): Promise<FileStat | null> {
    const normalized = this.normalizePath(path);

    // Check if it's a known directory
    if (this.directories.has(normalized) || this.directories.has(path)) {
      return {
        size: 0,
        mtime: Date.now(),
        ctime: Date.now(),
        isDirectory: true,
      };
    }

    // Check cache
    const cached = this.getCached(normalized);
    if (cached) {
      return cached;
    }

    const key = this.buildKey(path);

    // Try to get the object head
    const head = await this.bucket.head(key);
    if (head) {
      const stat: FileStat = {
        size: head.size,
        mtime: head.uploaded?.getTime() ?? Date.now(),
        ctime: head.uploaded?.getTime() ?? Date.now(),
        isDirectory: false,
      };
      this.setCached(normalized, stat);
      return stat;
    }

    // Check if it's a directory by looking for directory marker
    if (this.options.useDirectoryMarkers) {
      const markerKey = key + this.options.directoryMarkerSuffix;
      const markerHead = await this.bucket.head(markerKey);
      if (markerHead) {
        const stat: FileStat = {
          size: 0,
          mtime: markerHead.uploaded?.getTime() ?? Date.now(),
          ctime: markerHead.uploaded?.getTime() ?? Date.now(),
          isDirectory: true,
        };
        this.directories.add(normalized);
        this.setCached(normalized, stat);
        return stat;
      }
    }

    // Check if any objects exist with this prefix (implicit directory)
    const listResult = await this.bucket.list({
      prefix: key + '/',
      limit: 1,
    });

    if (listResult.objects.length > 0 || (listResult.delimitedPrefixes && listResult.delimitedPrefixes.length > 0)) {
      const stat: FileStat = {
        size: 0,
        mtime: Date.now(),
        ctime: Date.now(),
        isDirectory: true,
      };
      this.directories.add(normalized);
      this.setCached(normalized, stat);
      return stat;
    }

    return null;
  }

  /**
   * Read partial file content at specific offset
   */
  async read(path: string, offset: number, length: number): Promise<ArrayBuffer> {
    const key = this.buildKey(path);

    const obj = await this.bucket.get(key, {
      range: { offset, length },
    });

    if (!obj) {
      throw new Error(`File not found: ${path}`);
    }

    return obj.arrayBuffer();
  }

  /**
   * Read entire file content
   */
  async readFile(path: string): Promise<ArrayBuffer> {
    const key = this.buildKey(path);

    const obj = await this.bucket.get(key);
    if (!obj) {
      throw new Error(`File not found: ${path}`);
    }

    return obj.arrayBuffer();
  }

  /**
   * Write file content (overwrites if exists)
   */
  async write(path: string, data: ArrayBuffer): Promise<void> {
    const key = this.buildKey(path);
    const normalized = this.normalizePath(path);

    // Ensure parent directories exist
    this.ensureParentDirs(normalized);

    await this.bucket.put(key, data);
    this.invalidateCache(normalized);
  }

  /**
   * Append data to existing file
   */
  async append(path: string, data: ArrayBuffer): Promise<void> {
    const key = this.buildKey(path);
    const normalized = this.normalizePath(path);

    // Try to read existing content
    const existing = await this.bucket.get(key);
    let newData: Uint8Array;

    if (existing) {
      const existingBuffer = await existing.arrayBuffer();
      newData = new Uint8Array(existingBuffer.byteLength + data.byteLength);
      newData.set(new Uint8Array(existingBuffer), 0);
      newData.set(new Uint8Array(data), existingBuffer.byteLength);
    } else {
      newData = new Uint8Array(data);
      this.ensureParentDirs(normalized);
    }

    await this.bucket.put(key, newData);
    this.invalidateCache(normalized);
  }

  /**
   * Delete a file or directory
   */
  async delete(path: string): Promise<void> {
    const key = this.buildKey(path);
    const normalized = this.normalizePath(path);

    await this.bucket.delete(key);

    // Also delete directory marker if it exists
    if (this.options.useDirectoryMarkers) {
      try {
        await this.bucket.delete(key + this.options.directoryMarkerSuffix);
      } catch {
        // Ignore errors deleting marker
      }
    }

    this.directories.delete(normalized);
    this.invalidateCache(normalized);
  }

  /**
   * List directory contents
   */
  async list(path: string): Promise<DirEntry[]> {
    const normalized = this.normalizePath(path);
    const prefix = this.buildKey(path);
    const fullPrefix = normalized ? prefix + '/' : prefix;

    const result = await this.bucket.list({
      prefix: fullPrefix,
      delimiter: '/',
    });

    const entries: Map<string, DirEntry> = new Map();

    // Add files
    for (const obj of result.objects) {
      // Skip directory markers
      if (this.options.useDirectoryMarkers && obj.key.endsWith(this.options.directoryMarkerSuffix)) {
        continue;
      }

      const relativePath = obj.key.slice(fullPrefix.length);
      // Skip if it contains a slash (it's in a subdirectory)
      if (relativePath.includes('/')) {
        continue;
      }

      if (relativePath) {
        entries.set(relativePath, {
          name: relativePath,
          isDirectory: false,
          size: obj.size,
        });
      }
    }

    // Add directories from delimited prefixes
    if (result.delimitedPrefixes) {
      for (const dirPrefix of result.delimitedPrefixes) {
        const relativePath = dirPrefix.slice(fullPrefix.length).replace(/\/$/, '');
        if (relativePath && !entries.has(relativePath)) {
          entries.set(relativePath, {
            name: relativePath,
            isDirectory: true,
            size: 0,
          });
        }
      }
    }

    return Array.from(entries.values());
  }

  /**
   * Create a directory
   */
  async mkdir(path: string): Promise<void> {
    const normalized = this.normalizePath(path);
    this.ensureParentDirs(normalized);
    this.directories.add(normalized);

    // Create directory marker if enabled
    if (this.options.useDirectoryMarkers) {
      const key = this.buildKey(path) + this.options.directoryMarkerSuffix;
      await this.bucket.put(key, new ArrayBuffer(0));
    }
  }

  /**
   * Rename/move a file or directory
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldKey = this.buildKey(oldPath);
    const newKey = this.buildKey(newPath);
    const oldNormalized = this.normalizePath(oldPath);
    const newNormalized = this.normalizePath(newPath);

    // Get old object
    const obj = await this.bucket.get(oldKey);
    if (!obj) {
      throw new Error(`File not found: ${oldPath}`);
    }

    // Copy to new location
    const data = await obj.arrayBuffer();
    await this.bucket.put(newKey, data);

    // Delete old object
    await this.bucket.delete(oldKey);

    // Update directories set
    if (this.directories.has(oldNormalized)) {
      this.directories.delete(oldNormalized);
      this.directories.add(newNormalized);
    }

    // Invalidate cache
    this.invalidateCache(oldNormalized);
    this.invalidateCache(newNormalized);
  }

  /**
   * Flush pending writes (no-op for R2, writes are immediate)
   */
  async flush(): Promise<void> {
    // R2 writes are immediate, nothing to flush
  }

  /**
   * Ensure parent directories exist in the directories set
   */
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

  /**
   * Clear metadata cache
   */
  clearCache(): void {
    this.metadataCache.clear();
  }

  /**
   * Get provider statistics for monitoring
   */
  getStats(): {
    cachedEntries: number;
    trackedDirectories: number;
  } {
    return {
      cachedEntries: this.metadataCache.size,
      trackedDirectories: this.directories.size,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an R2 storage provider from environment bindings
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker handler
 * const provider = createR2Provider(env.CLICKBENCH_BUCKET, {
 *   prefix: 'hits/',
 * });
 * ```
 */
export function createR2Provider(
  bucket: R2Bucket,
  options?: R2StorageProviderOptions
): R2StorageProvider {
  return new R2StorageProvider(bucket, options);
}
