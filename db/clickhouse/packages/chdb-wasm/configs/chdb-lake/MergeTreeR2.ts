/**
 * MergeTree R2 Storage Backend
 *
 * Implements R2 storage for MergeTree VFS data with:
 * - Efficient range reads (aligned to 64KB for R2 performance)
 * - Multipart uploads for large files
 * - LRU caching for frequently accessed metadata files
 *
 * R2 key structure for MergeTree data:
 *   {database}/{table}/data/{partition}/{part_name}/{file}
 *
 * Example:
 *   default/events/data/202401/20240115_1_1_0/data.bin
 *   default/events/data/202401/20240115_1_1_0/checksums.txt
 *   default/events/data/202401/20240115_1_1_0/columns.txt
 *
 * @see wasm/docs/MERGETREE_VFS_DESIGN.md
 */

/**
 * Cached metadata entry with LRU tracking
 */
interface CacheEntry {
  data: Uint8Array;
  size: number;
  accessTime: number;
  key: string;
}

/**
 * Multipart upload state for streaming writes
 */
interface MultipartUploadState {
  upload: R2MultipartUpload;
  key: string;
  parts: R2UploadedPart[];
  partNumber: number;
}

/**
 * Files that should be cached (metadata files that are read frequently)
 */
const CACHEABLE_FILES = [
  'checksums.txt',
  'columns.txt',
  'count.txt',
  'primary.idx',
  'partition.dat',
  'minmax_',       // Prefix for minmax index files
  'skp_idx_',      // Prefix for skip index files
];

/**
 * Configuration for MergeTreeR2Storage
 */
export interface MergeTreeR2Config {
  /** Maximum cache size in bytes (default: 64MB) */
  maxCacheSize?: number;
  /** Read alignment in bytes for efficient R2 access (default: 64KB) */
  readAlignment?: number;
  /** Minimum size for multipart uploads (default: 5MB) */
  multipartThreshold?: number;
  /** Part size for multipart uploads (default: 5MB) */
  multipartPartSize?: number;
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTtlMs?: number;
}

/**
 * MergeTree R2 Storage Backend
 *
 * Provides efficient storage operations for MergeTree VFS data on Cloudflare R2.
 */
export class MergeTreeR2Storage {
  private readonly r2: R2Bucket;

  // Configuration
  private readonly maxCacheSize: number;
  private readonly readAlignment: number;
  private readonly multipartThreshold: number;
  private readonly multipartPartSize: number;
  private readonly cacheTtlMs: number;

  // Cache for metadata files
  private cache: Map<string, CacheEntry> = new Map();
  private cacheSize: number = 0;

  // Active multipart uploads
  private uploads: Map<string, MultipartUploadState> = new Map();

  /**
   * Create a new MergeTreeR2Storage instance
   *
   * @param r2 - R2 bucket binding
   * @param config - Optional configuration
   */
  constructor(r2: R2Bucket, config?: MergeTreeR2Config) {
    this.r2 = r2;

    // Apply configuration with defaults
    this.maxCacheSize = config?.maxCacheSize ?? 64 * 1024 * 1024;       // 64MB
    this.readAlignment = config?.readAlignment ?? 64 * 1024;            // 64KB
    this.multipartThreshold = config?.multipartThreshold ?? 5 * 1024 * 1024; // 5MB
    this.multipartPartSize = config?.multipartPartSize ?? 5 * 1024 * 1024;   // 5MB
    this.cacheTtlMs = config?.cacheTtlMs ?? 5 * 60 * 1000;             // 5 minutes
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  /**
   * Read a range of bytes from a file
   *
   * Aligns reads to 64KB boundaries for optimal R2 performance.
   * R2 performs best with aligned reads, especially for large files.
   *
   * @param path - File path relative to bucket root
   * @param offset - Starting byte offset
   * @param length - Number of bytes to read
   * @returns The requested byte range
   * @throws Error if file not found or read fails
   */
  async readRange(path: string, offset: number, length: number): Promise<Uint8Array> {
    // Check cache first for small metadata files
    if (this.isCacheableFile(path)) {
      const cached = this.getFromCache(path);
      if (cached) {
        // Return slice of cached data
        const end = Math.min(offset + length, cached.length);
        return cached.slice(offset, end);
      }
    }

    // Align read to 64KB boundary for R2 efficiency
    const alignedOffset = Math.floor(offset / this.readAlignment) * this.readAlignment;
    const alignedEnd = Math.ceil((offset + length) / this.readAlignment) * this.readAlignment;
    const alignedLength = alignedEnd - alignedOffset;

    const object = await this.r2.get(path, {
      range: {
        offset: alignedOffset,
        length: alignedLength,
      },
    });

    if (!object) {
      throw new Error(`File not found: ${path}`);
    }

    const buffer = await object.arrayBuffer();
    const data = new Uint8Array(buffer);

    // Extract the requested range from the aligned read
    const startInBuffer = offset - alignedOffset;
    const endInBuffer = startInBuffer + length;

    return data.slice(startInBuffer, Math.min(endInBuffer, data.length));
  }

  /**
   * Read an entire file
   *
   * For metadata files, results are cached for faster subsequent access.
   *
   * @param path - File path relative to bucket root
   * @returns The complete file contents
   * @throws Error if file not found
   */
  async readFile(path: string): Promise<Uint8Array> {
    // Check cache first
    if (this.isCacheableFile(path)) {
      const cached = this.getFromCache(path);
      if (cached) {
        return cached;
      }
    }

    const object = await this.r2.get(path);

    if (!object) {
      throw new Error(`File not found: ${path}`);
    }

    const buffer = await object.arrayBuffer();
    const data = new Uint8Array(buffer);

    // Cache metadata files
    if (this.isCacheableFile(path)) {
      this.addToCache(path, data);
    }

    return data;
  }

  /**
   * Get the size of a file
   *
   * @param path - File path relative to bucket root
   * @returns File size in bytes
   * @throws Error if file not found
   */
  async getFileSize(path: string): Promise<number> {
    const object = await this.r2.head(path);

    if (!object) {
      throw new Error(`File not found: ${path}`);
    }

    return object.size;
  }

  /**
   * Check if a file exists
   *
   * @param path - File path relative to bucket root
   * @returns true if file exists, false otherwise
   */
  async exists(path: string): Promise<boolean> {
    const object = await this.r2.head(path);
    return object !== null;
  }

  // ===========================================================================
  // Write Operations
  // ===========================================================================

  /**
   * Write data to a file
   *
   * For small files, writes directly to R2.
   * For large files (>5MB), automatically uses multipart upload.
   *
   * @param path - File path relative to bucket root
   * @param data - Data to write
   */
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    // Invalidate cache for this path
    this.removeFromCache(path);

    if (data.length <= this.multipartThreshold) {
      // Direct upload for small files
      await this.r2.put(path, data);
    } else {
      // Use multipart upload for large files
      const uploadId = await this.startMultipartUpload(path);

      try {
        const parts: { partNum: number; etag: string }[] = [];

        for (let i = 0; i < data.length; i += this.multipartPartSize) {
          const partNum = Math.floor(i / this.multipartPartSize) + 1;
          const partData = data.slice(i, Math.min(i + this.multipartPartSize, data.length));
          const etag = await this.uploadPart(uploadId, partNum, partData);
          parts.push({ partNum, etag });
        }

        await this.completeMultipartUpload(uploadId, parts);
      } catch (error) {
        // Abort upload on error
        await this.abortMultipartUpload(uploadId);
        throw error;
      }
    }
  }

  /**
   * Start a multipart upload
   *
   * Multipart uploads are required for files larger than 5MB and support
   * streaming writes with up to 10,000 parts.
   *
   * @param path - File path relative to bucket root
   * @returns Upload ID for subsequent operations
   */
  async startMultipartUpload(path: string): Promise<string> {
    const upload = await this.r2.createMultipartUpload(path);
    const uploadId = upload.uploadId;

    this.uploads.set(uploadId, {
      upload,
      key: path,
      parts: [],
      partNumber: 1,
    });

    return uploadId;
  }

  /**
   * Upload a part of a multipart upload
   *
   * Parts must be at least 5MB (except for the last part) and are numbered
   * starting from 1.
   *
   * @param uploadId - Upload ID from startMultipartUpload
   * @param partNum - Part number (1-indexed)
   * @param data - Part data
   * @returns ETag for the uploaded part
   * @throws Error if upload ID not found
   */
  async uploadPart(uploadId: string, partNum: number, data: Uint8Array): Promise<string> {
    const state = this.uploads.get(uploadId);

    if (!state) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    const part = await state.upload.uploadPart(partNum, data);
    state.parts.push(part);
    state.partNumber = partNum + 1;

    return part.etag;
  }

  /**
   * Complete a multipart upload
   *
   * Finalizes the upload and makes the object available in R2.
   *
   * @param uploadId - Upload ID from startMultipartUpload
   * @param parts - Array of part numbers and ETags
   * @throws Error if upload ID not found
   */
  async completeMultipartUpload(
    uploadId: string,
    parts: { partNum: number; etag: string }[]
  ): Promise<void> {
    const state = this.uploads.get(uploadId);

    if (!state) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    // Convert to R2UploadedPart format
    const uploadedParts: R2UploadedPart[] = parts.map((p) => ({
      partNumber: p.partNum,
      etag: p.etag,
    }));

    await state.upload.complete(uploadedParts);
    this.uploads.delete(uploadId);
  }

  /**
   * Abort a multipart upload
   *
   * Cancels the upload and removes any uploaded parts.
   *
   * @param uploadId - Upload ID from startMultipartUpload
   */
  async abortMultipartUpload(uploadId: string): Promise<void> {
    const state = this.uploads.get(uploadId);

    if (state) {
      await state.upload.abort();
      this.uploads.delete(uploadId);
    }
  }

  // ===========================================================================
  // Directory Operations
  // ===========================================================================

  /**
   * List all files under a prefix
   *
   * Handles pagination automatically to return all matching files.
   *
   * @param prefix - Path prefix to list
   * @returns Array of file paths
   */
  async listFiles(prefix: string): Promise<string[]> {
    const files: string[] = [];
    let cursor: string | undefined;

    do {
      const listed = await this.r2.list({
        prefix,
        cursor,
        limit: 1000,
      });

      for (const object of listed.objects) {
        files.push(object.key);
      }

      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    return files;
  }

  /**
   * Delete a single file
   *
   * @param path - File path relative to bucket root
   */
  async deleteFile(path: string): Promise<void> {
    this.removeFromCache(path);
    await this.r2.delete(path);
  }

  /**
   * Delete all files under a prefix
   *
   * Efficiently deletes files in batches of 1000 (R2 limit).
   *
   * @param prefix - Path prefix to delete
   */
  async deletePrefix(prefix: string): Promise<void> {
    const files = await this.listFiles(prefix);

    // Invalidate cache for deleted files
    for (const file of files) {
      this.removeFromCache(file);
    }

    // Delete in batches of 1000 (R2 limit)
    for (let i = 0; i < files.length; i += 1000) {
      const batch = files.slice(i, i + 1000);
      await this.r2.delete(batch);
    }
  }

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  /**
   * Check if a file should be cached based on its path
   */
  private isCacheableFile(path: string): boolean {
    const filename = path.split('/').pop() || '';
    return CACHEABLE_FILES.some(
      (pattern) => filename === pattern || filename.startsWith(pattern)
    );
  }

  /**
   * Get a file from cache if it exists and is not expired
   */
  private getFromCache(path: string): Uint8Array | null {
    const entry = this.cache.get(path);

    if (!entry) {
      return null;
    }

    // Check TTL
    const now = Date.now();
    if (now - entry.accessTime > this.cacheTtlMs) {
      this.removeFromCache(path);
      return null;
    }

    // Update access time for LRU
    entry.accessTime = now;

    return entry.data;
  }

  /**
   * Add a file to cache, evicting old entries if needed
   */
  private addToCache(path: string, data: Uint8Array): void {
    // Don't cache files larger than 1MB
    if (data.length > 1024 * 1024) {
      return;
    }

    // Evict entries if cache is full
    while (this.cacheSize + data.length > this.maxCacheSize && this.cache.size > 0) {
      this.evictOldestEntry();
    }

    const entry: CacheEntry = {
      data,
      size: data.length,
      accessTime: Date.now(),
      key: path,
    };

    this.cache.set(path, entry);
    this.cacheSize += data.length;
  }

  /**
   * Remove a file from cache
   */
  private removeFromCache(path: string): void {
    const entry = this.cache.get(path);

    if (entry) {
      this.cacheSize -= entry.size;
      this.cache.delete(path);
    }
  }

  /**
   * Evict the least recently used cache entry
   */
  private evictOldestEntry(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.accessTime < oldestTime) {
        oldestTime = entry.accessTime;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.removeFromCache(oldestKey);
    }
  }

  /**
   * Clear the entire cache
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheSize = 0;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: number; maxSize: number } {
    return {
      size: this.cacheSize,
      entries: this.cache.size,
      maxSize: this.maxCacheSize,
    };
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Build a path for a MergeTree data file
   *
   * @param database - Database name
   * @param table - Table name
   * @param partition - Partition key
   * @param partName - Part name (e.g., "20240115_1_1_0")
   * @param file - File name within the part
   * @returns Full R2 key path
   */
  static buildPath(
    database: string,
    table: string,
    partition: string,
    partName: string,
    file: string
  ): string {
    return `${database}/${table}/data/${partition}/${partName}/${file}`;
  }

  /**
   * Build a prefix for listing files in a part
   *
   * @param database - Database name
   * @param table - Table name
   * @param partition - Partition key
   * @param partName - Part name
   * @returns R2 key prefix
   */
  static buildPartPrefix(
    database: string,
    table: string,
    partition: string,
    partName: string
  ): string {
    return `${database}/${table}/data/${partition}/${partName}/`;
  }

  /**
   * Build a prefix for listing all parts in a partition
   *
   * @param database - Database name
   * @param table - Table name
   * @param partition - Partition key
   * @returns R2 key prefix
   */
  static buildPartitionPrefix(
    database: string,
    table: string,
    partition: string
  ): string {
    return `${database}/${table}/data/${partition}/`;
  }

  /**
   * Build a prefix for listing all partitions in a table
   *
   * @param database - Database name
   * @param table - Table name
   * @returns R2 key prefix
   */
  static buildTablePrefix(database: string, table: string): string {
    return `${database}/${table}/data/`;
  }
}
