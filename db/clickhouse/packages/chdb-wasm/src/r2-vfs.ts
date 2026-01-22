/**
 * R2 Virtual File System (VFS)
 *
 * Provides a file system abstraction over Cloudflare R2 storage.
 * Enables ClickHouse-style file operations on R2 objects:
 * - Opening files for reading, writing, or appending
 * - Reading bytes at specific offsets (range requests)
 * - Writing new files and appending to existing files
 * - Deleting files and listing directories
 * - File metadata operations (stat, size)
 * - Concurrent access support
 * - Metadata caching for reduced API calls
 * - File handle reference counting for resource management
 * - Read-ahead buffering for sequential access optimization
 * - Range request batching for reduced API calls
 *
 * @see https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
 */

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base error class for R2 VFS errors
 */
export class R2VFSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'R2VFSError';
  }
}

/**
 * Thrown when a file is not found
 */
export class FileNotFoundError extends R2VFSError {
  constructor(path: string) {
    super(`File not found: ${path}`);
    this.name = 'FileNotFoundError';
  }
}

/**
 * Thrown when permission is denied for an operation
 */
export class PermissionError extends R2VFSError {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

/**
 * Thrown when a handle is invalid (e.g., closed)
 */
export class InvalidHandleError extends R2VFSError {
  constructor(message: string = 'Handle is closed or invalid') {
    super(message);
    this.name = 'InvalidHandleError';
  }
}

/**
 * Thrown when an operation is attempted with the wrong mode
 */
export class ModeError extends R2VFSError {
  constructor(message: string) {
    super(message);
    this.name = 'ModeError';
  }
}

/**
 * Thrown when a network error occurs
 */
export class NetworkError extends R2VFSError {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Thrown when rate limiting is encountered
 */
export class RateLimitError extends R2VFSError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
  }
}

// ============================================================================
// Interfaces
// ============================================================================

/**
 * File handle returned by VFS open operations
 */
export interface FileHandle {
  /** Unique handle identifier */
  id: string;
  /** Path to the file */
  path: string;
  /** Open mode */
  mode: 'r' | 'w' | 'a';
  /** Current position in file (for sequential reads/writes) */
  position: number;
  /** Whether handle is still valid */
  valid: boolean;
}

/**
 * File statistics
 */
export interface FileStat {
  /** File size in bytes */
  size: number;
  /** Last modified timestamp */
  modified: Date;
  /** ETag for conditional requests */
  etag?: string;
}

/**
 * Directory listing result
 */
export interface ListDirResult {
  /** Files directly in the directory */
  files: string[];
  /** Subdirectory prefixes */
  directories: string[];
}

/**
 * R2 VFS options
 */
export interface R2VFSOptions {
  /** Enable metadata caching */
  cacheMetadata?: boolean;
  /** Cache TTL in milliseconds */
  cacheTTL?: number;
  /** Maximum concurrent reads */
  maxConcurrentReads?: number;
  /** Enable range request coalescing */
  coalesceRangeRequests?: boolean;
  /** Retry on rate limit errors */
  retryOnRateLimit?: boolean;
  /** Number of retries on transient errors */
  retryCount?: number;
  /** Delay between retries in milliseconds */
  retryDelayMs?: number;
  /** Enable read-ahead buffering for sequential access */
  enableReadAhead?: boolean;
  /** Read-ahead buffer size in bytes (default 64KB) */
  readAheadSize?: number;
  /** Minimum cache size in entries before eviction */
  maxCacheEntries?: number;
  /** Enable range request batching */
  enableRangeBatching?: boolean;
  /** Maximum batch delay in milliseconds */
  batchDelayMs?: number;
}

/**
 * Cached metadata entry
 */
interface CacheEntry {
  stat: FileStat;
  cachedAt: number;
  /** Access count for LRU eviction */
  accessCount: number;
  /** Last access timestamp */
  lastAccess: number;
}

/**
 * Read-ahead buffer entry
 */
interface ReadAheadBuffer {
  /** File path */
  path: string;
  /** Buffer start offset */
  startOffset: number;
  /** Buffered data */
  data: Uint8Array;
  /** Buffer end offset (exclusive) */
  endOffset: number;
  /** Last access timestamp for eviction */
  lastAccess: number;
}

/**
 * Internal handle state with reference counting
 */
interface InternalHandleState {
  /** Reference count */
  refCount: number;
  /** The handle data */
  handle: FileHandle;
  /** Read-ahead buffer for this handle */
  readAheadBuffer: ReadAheadBuffer | null;
  /** Last read offset for sequential detection */
  lastReadOffset: number;
  /** Last read length for sequential detection */
  lastReadLength: number;
  /** Whether sequential access pattern detected */
  isSequential: boolean;
}

/**
 * Pending range request for batching
 */
interface PendingRangeRequest {
  path: string;
  offset: number;
  length: number;
  resolve: (data: Uint8Array) => void;
  reject: (error: Error) => void;
  requestedAt: number;
}

/**
 * R2Bucket interface (subset of Cloudflare's R2Bucket)
 */
interface R2Bucket {
  get(
    key: string,
    options?: { range?: { offset?: number; length?: number; suffix?: number } }
  ): Promise<R2Object | null>;
  head(key: string): Promise<R2ObjectHead | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream | string): Promise<R2PutResult>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<R2ListResult>;
}

interface R2Object {
  key: string;
  size: number;
  etag?: string;
  httpEtag?: string;
  uploaded?: Date;
  range?: { offset: number; length: number };
  body?: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
}

interface R2ObjectHead {
  key: string;
  size: number;
  etag?: string;
  httpEtag?: string;
  uploaded?: Date;
}

interface R2PutResult {
  key: string;
  etag?: string;
  httpEtag?: string;
}

interface R2ListResult {
  objects: Array<{
    key: string;
    size: number;
    etag?: string;
    httpEtag?: string;
    uploaded?: Date;
  }>;
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes?: string[];
}

// ============================================================================
// R2VFS Class
// ============================================================================

/**
 * R2 Virtual File System
 *
 * Provides file system operations on top of R2 object storage.
 *
 * Features:
 * - File handle reference counting for proper resource management
 * - Read-ahead buffering for sequential access optimization
 * - Metadata caching with TTL and LRU eviction
 * - Range request batching for reduced API calls
 * - Comprehensive error handling with typed errors
 */
export class R2VFS {
  private bucket: R2Bucket;
  private options: Required<R2VFSOptions>;
  private handles: Map<string, FileHandle> = new Map();
  private handleStates: Map<string, InternalHandleState> = new Map();
  private writeBuffers: Map<string, Uint8Array[]> = new Map();
  private nextHandleId = 1;
  private metadataCache: Map<string, CacheEntry> = new Map();
  private activeReads = 0;
  private readQueue: Array<() => void> = [];
  private pendingRangeRequests: Map<string, PendingRangeRequest[]> = new Map();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(bucket: R2Bucket, options: R2VFSOptions = {}) {
    this.bucket = bucket;
    this.options = {
      cacheMetadata: options.cacheMetadata ?? false,
      cacheTTL: options.cacheTTL ?? 60000, // 1 minute default
      maxConcurrentReads: options.maxConcurrentReads ?? Infinity,
      coalesceRangeRequests: options.coalesceRangeRequests ?? false,
      retryOnRateLimit: options.retryOnRateLimit ?? true,
      retryCount: options.retryCount ?? 3,
      retryDelayMs: options.retryDelayMs ?? 100,
      enableReadAhead: options.enableReadAhead ?? false,
      readAheadSize: options.readAheadSize ?? 65536, // 64KB default
      maxCacheEntries: options.maxCacheEntries ?? 1000,
      enableRangeBatching: options.enableRangeBatching ?? false,
      batchDelayMs: options.batchDelayMs ?? 5,
    };
  }

  /**
   * Generate unique handle ID
   */
  private generateHandleId(): string {
    return `handle-${this.nextHandleId++}-${Date.now()}`;
  }

  /**
   * Execute operation with retry logic
   */
  private async withRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.options.retryCount; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err as Error;

        // Check for rate limit error
        const errorCode = (err as Error & { code?: number }).code;
        if (errorCode === 429) {
          if (!this.options.retryOnRateLimit) {
            throw new RateLimitError(`Rate limited during ${context}`);
          }
          // Retry on rate limit if enabled
          if (attempt < this.options.retryCount - 1) {
            await this.sleep(this.options.retryDelayMs * (attempt + 1));
            continue;
          }
          throw new RateLimitError(`Rate limited during ${context}`);
        }

        // Permission errors - don't retry
        if (lastError.message.includes('Access Denied')) {
          throw new PermissionError(`Permission denied during ${context}`);
        }

        // Check for network/transient errors
        const isNetworkError =
          lastError.message.includes('Network') ||
          lastError.message.includes('timeout') ||
          lastError.message.includes('Temporary');

        if (isNetworkError) {
          // Retry transient errors
          if (attempt < this.options.retryCount - 1) {
            await this.sleep(this.options.retryDelayMs * (attempt + 1));
            continue;
          }
          // Last attempt - convert to NetworkError
          throw new NetworkError(lastError.message);
        }

        // Other errors - rethrow immediately
        throw lastError;
      }
    }

    // Should not reach here, but handle just in case
    if (lastError) {
      const isNetworkError =
        lastError.message.includes('Network') ||
        lastError.message.includes('timeout');
      if (isNetworkError) {
        throw new NetworkError(lastError.message);
      }
      throw lastError;
    }

    throw new Error('Unexpected retry loop exit');
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for read slot availability
   */
  private async acquireReadSlot(): Promise<void> {
    if (this.activeReads < this.options.maxConcurrentReads) {
      this.activeReads++;
      return;
    }

    return new Promise(resolve => {
      this.readQueue.push(() => {
        this.activeReads++;
        resolve();
      });
    });
  }

  /**
   * Release read slot
   */
  private releaseReadSlot(): void {
    this.activeReads--;
    const next = this.readQueue.shift();
    if (next) {
      next();
    }
  }

  /**
   * Get cached metadata or null if not cached/expired
   */
  private getCachedStat(path: string): FileStat | null {
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

    // Update access tracking for LRU eviction
    entry.accessCount++;
    entry.lastAccess = Date.now();

    return entry.stat;
  }

  /**
   * Cache metadata
   */
  private cacheStat(path: string, stat: FileStat): void {
    if (this.options.cacheMetadata) {
      const now = Date.now();
      this.metadataCache.set(path, {
        stat,
        cachedAt: now,
        accessCount: 1,
        lastAccess: now,
      });
      this.evictCacheIfNeeded();
    }
  }

  /**
   * Invalidate cached metadata
   */
  private invalidateCache(path: string): void {
    this.metadataCache.delete(path);
  }

  /**
   * Clear all cached metadata
   */
  clearCache(): void {
    this.metadataCache.clear();
  }

  /**
   * Evict oldest cache entries if cache exceeds max size
   */
  private evictCacheIfNeeded(): void {
    if (this.metadataCache.size <= this.options.maxCacheEntries) {
      return;
    }

    // Find entries to evict (least recently accessed)
    const entries = Array.from(this.metadataCache.entries())
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    // Remove oldest entries until we're at 80% capacity
    const targetSize = Math.floor(this.options.maxCacheEntries * 0.8);
    const toRemove = entries.length - targetSize;

    for (let i = 0; i < toRemove; i++) {
      this.metadataCache.delete(entries[i][0]);
    }
  }

  /**
   * Increment reference count for a handle
   */
  addHandleRef(handle: FileHandle): void {
    const state = this.handleStates.get(handle.id);
    if (state && state.handle.valid) {
      state.refCount++;
    }
  }

  /**
   * Decrement reference count for a handle
   * Returns true if the handle should be closed (refCount reached 0)
   */
  releaseHandleRef(handle: FileHandle): boolean {
    const state = this.handleStates.get(handle.id);
    if (state) {
      state.refCount--;
      return state.refCount <= 0;
    }
    return true;
  }

  /**
   * Get current reference count for a handle
   */
  getHandleRefCount(handle: FileHandle): number {
    const state = this.handleStates.get(handle.id);
    return state ? state.refCount : 0;
  }

  /**
   * Check if read-ahead buffer contains the requested range
   */
  private checkReadAheadBuffer(
    handleId: string,
    offset: number,
    length: number
  ): Uint8Array | null {
    const state = this.handleStates.get(handleId);
    if (!state || !state.readAheadBuffer) {
      return null;
    }

    const buffer = state.readAheadBuffer;
    const requestEnd = offset + length;

    // Check if requested range is within buffer
    if (offset >= buffer.startOffset && requestEnd <= buffer.endOffset) {
      // Update last access time
      buffer.lastAccess = Date.now();

      // Extract the requested portion
      const bufferOffset = offset - buffer.startOffset;
      return buffer.data.slice(bufferOffset, bufferOffset + length);
    }

    return null;
  }

  /**
   * Detect if access pattern is sequential
   */
  private detectSequentialAccess(
    state: InternalHandleState,
    offset: number,
    _length: number
  ): boolean {
    // First read - no pattern yet
    if (state.lastReadOffset === -1) {
      return false;
    }

    // Check if this read continues from where last read ended
    const expectedOffset = state.lastReadOffset + state.lastReadLength;
    const isSequential = offset === expectedOffset;

    // Update sequential detection after a few reads
    if (isSequential) {
      state.isSequential = true;
    }

    return isSequential;
  }

  /**
   * Update read-ahead buffer based on sequential access
   */
  private async updateReadAheadBuffer(
    handleId: string,
    path: string,
    currentOffset: number,
    fileSize: number
  ): Promise<void> {
    if (!this.options.enableReadAhead) {
      return;
    }

    const state = this.handleStates.get(handleId);
    if (!state || !state.isSequential) {
      return;
    }

    // Calculate read-ahead range
    const readAheadStart = currentOffset;
    const readAheadLength = Math.min(
      this.options.readAheadSize,
      fileSize - readAheadStart
    );

    if (readAheadLength <= 0) {
      return;
    }

    // Check if current buffer already covers this range
    if (
      state.readAheadBuffer &&
      readAheadStart >= state.readAheadBuffer.startOffset &&
      readAheadStart + readAheadLength <= state.readAheadBuffer.endOffset
    ) {
      return;
    }

    try {
      // Fetch read-ahead data
      const obj = await this.withRetry(
        () =>
          this.bucket.get(path, {
            range: { offset: readAheadStart, length: readAheadLength },
          }),
        `readAhead ${path}`
      );

      if (obj) {
        const buffer = await obj.arrayBuffer();
        state.readAheadBuffer = {
          path,
          startOffset: readAheadStart,
          data: new Uint8Array(buffer),
          endOffset: readAheadStart + buffer.byteLength,
          lastAccess: Date.now(),
        };
      }
    } catch {
      // Read-ahead failure is non-fatal
    }
  }

  /**
   * Batch range requests for the same file
   */
  private async batchRangeRequest(
    path: string,
    offset: number,
    length: number
  ): Promise<Uint8Array> {
    if (!this.options.enableRangeBatching) {
      // Direct request without batching
      const obj = await this.withRetry(
        () => this.bucket.get(path, { range: { offset, length } }),
        `read ${path}`
      );
      if (!obj) {
        throw new FileNotFoundError(path);
      }
      const buffer = await obj.arrayBuffer();
      return new Uint8Array(buffer);
    }

    return new Promise((resolve, reject) => {
      const request: PendingRangeRequest = {
        path,
        offset,
        length,
        resolve,
        reject,
        requestedAt: Date.now(),
      };

      const existing = this.pendingRangeRequests.get(path) || [];
      existing.push(request);
      this.pendingRangeRequests.set(path, existing);

      // Schedule batch flush
      if (!this.batchTimer) {
        this.batchTimer = setTimeout(
          () => this.flushBatchedRequests(),
          this.options.batchDelayMs
        );
      }
    });
  }

  /**
   * Flush all pending batched requests
   */
  private async flushBatchedRequests(): Promise<void> {
    this.batchTimer = null;

    const allRequests = new Map(this.pendingRangeRequests);
    this.pendingRangeRequests.clear();

    for (const [path, requests] of allRequests) {
      if (requests.length === 0) continue;

      // Sort requests by offset
      requests.sort((a, b) => a.offset - b.offset);

      // Coalesce overlapping or adjacent requests
      const coalescedRanges = this.coalesceRanges(requests);

      // Fetch each coalesced range and distribute to original requests
      for (const range of coalescedRanges) {
        try {
          const obj = await this.withRetry(
            () =>
              this.bucket.get(path, {
                range: { offset: range.offset, length: range.length },
              }),
            `batchRead ${path}`
          );

          if (!obj) {
            for (const req of range.requests) {
              req.reject(new FileNotFoundError(path));
            }
            continue;
          }

          const buffer = await obj.arrayBuffer();
          const data = new Uint8Array(buffer);

          // Distribute data to original requests
          for (const req of range.requests) {
            const startInBuffer = req.offset - range.offset;
            const slice = data.slice(startInBuffer, startInBuffer + req.length);
            req.resolve(slice);
          }
        } catch (err) {
          for (const req of range.requests) {
            req.reject(err as Error);
          }
        }
      }
    }
  }

  /**
   * Coalesce adjacent or overlapping range requests
   */
  private coalesceRanges(
    requests: PendingRangeRequest[]
  ): Array<{ offset: number; length: number; requests: PendingRangeRequest[] }> {
    if (requests.length === 0) return [];

    const result: Array<{
      offset: number;
      length: number;
      requests: PendingRangeRequest[];
    }> = [];

    let current = {
      offset: requests[0].offset,
      length: requests[0].length,
      requests: [requests[0]],
    };

    for (let i = 1; i < requests.length; i++) {
      const req = requests[i];
      const currentEnd = current.offset + current.length;
      const reqEnd = req.offset + req.length;

      // Check if requests overlap or are adjacent (within 4KB gap)
      const gap = req.offset - currentEnd;
      const shouldCoalesce = gap <= 4096;

      if (shouldCoalesce) {
        // Extend current range to include this request
        current.length = Math.max(currentEnd, reqEnd) - current.offset;
        current.requests.push(req);
      } else {
        // Start new range
        result.push(current);
        current = {
          offset: req.offset,
          length: req.length,
          requests: [req],
        };
      }
    }

    result.push(current);
    return result;
  }

  /**
   * Open a file for reading, writing, or appending
   */
  async open(path: string, mode: 'r' | 'w' | 'a'): Promise<FileHandle> {
    const id = this.generateHandleId();
    let position = 0;

    if (mode === 'r') {
      // For read mode, verify file exists
      const head = await this.withRetry(
        () => this.bucket.head(path),
        `open ${path}`
      );

      if (!head) {
        throw new FileNotFoundError(path);
      }
    } else if (mode === 'a') {
      // For append mode, get file size if it exists
      try {
        const head = await this.withRetry(
          () => this.bucket.head(path),
          `open ${path}`
        );

        if (head) {
          position = head.size;
        }
      } catch (err) {
        // File doesn't exist - that's OK for append mode, position stays 0
        if (!(err instanceof FileNotFoundError)) {
          // Check if it's actually a not-found case from bucket.head returning null
          const headResult = await this.bucket.head(path);
          if (headResult !== null) {
            throw err;
          }
        }
      }
    }

    // For write mode, initialize empty write buffer
    if (mode === 'w' || mode === 'a') {
      this.writeBuffers.set(id, []);
    }

    const handle: FileHandle = {
      id,
      path,
      mode,
      position,
      valid: true,
    };

    // Initialize handle state with reference counting
    const handleState: InternalHandleState = {
      refCount: 1,
      handle,
      readAheadBuffer: null,
      lastReadOffset: -1,
      lastReadLength: 0,
      isSequential: false,
    };

    this.handles.set(id, handle);
    this.handleStates.set(id, handleState);
    return handle;
  }

  /**
   * Read bytes from file at offset
   */
  async read(handle: FileHandle, offset: number, length: number): Promise<Uint8Array> {
    if (!handle.valid) {
      throw new InvalidHandleError('Handle is closed or invalid');
    }

    const storedHandle = this.handles.get(handle.id);
    if (!storedHandle || !storedHandle.valid) {
      throw new InvalidHandleError('Handle is closed or invalid');
    }

    if (handle.mode !== 'r') {
      throw new ModeError(`Handle not open for reading (mode: ${handle.mode})`);
    }

    // Get handle state for read-ahead tracking
    const state = this.handleStates.get(handle.id);

    // Acquire read slot for concurrency limiting
    await this.acquireReadSlot();

    try {
      // First, get file size to handle bounds
      const head = await this.withRetry(
        () => this.bucket.head(handle.path),
        `read ${handle.path}`
      );

      if (!head) {
        throw new FileNotFoundError(handle.path);
      }

      const fileSize = head.size;

      // If offset is beyond file end, return empty array
      if (offset >= fileSize) {
        return new Uint8Array(0);
      }

      // Adjust length if it would read beyond file end
      const actualLength = Math.min(length, fileSize - offset);

      if (actualLength <= 0) {
        return new Uint8Array(0);
      }

      // Track sequential access pattern
      if (state) {
        this.detectSequentialAccess(state, offset, actualLength);
      }

      // Check read-ahead buffer first
      if (this.options.enableReadAhead && state) {
        const cached = this.checkReadAheadBuffer(handle.id, offset, actualLength);
        if (cached) {
          // Update tracking for next read
          state.lastReadOffset = offset;
          state.lastReadLength = actualLength;
          return cached;
        }
      }

      // Use batched request if enabled
      let result: Uint8Array;
      if (this.options.enableRangeBatching) {
        result = await this.batchRangeRequest(handle.path, offset, actualLength);
      } else {
        const obj = await this.withRetry(
          () =>
            this.bucket.get(handle.path, {
              range: { offset, length: actualLength },
            }),
          `read ${handle.path}`
        );

        if (!obj) {
          throw new FileNotFoundError(handle.path);
        }

        const buffer = await obj.arrayBuffer();
        result = new Uint8Array(buffer);
      }

      // Update tracking for next read
      if (state) {
        state.lastReadOffset = offset;
        state.lastReadLength = actualLength;

        // Trigger read-ahead for sequential access (non-blocking)
        if (state.isSequential) {
          this.updateReadAheadBuffer(
            handle.id,
            handle.path,
            offset + actualLength,
            fileSize
          ).catch(() => {
            // Ignore read-ahead errors
          });
        }
      }

      return result;
    } finally {
      this.releaseReadSlot();
    }
  }

  /**
   * Read bytes from end of file (suffix range)
   */
  async readFromEnd(path: string, length: number): Promise<Uint8Array> {
    await this.acquireReadSlot();

    try {
      const obj = await this.withRetry(
        () =>
          this.bucket.get(path, {
            range: { suffix: length },
          }),
        `readFromEnd ${path}`
      );

      if (!obj) {
        throw new FileNotFoundError(path);
      }

      const buffer = await obj.arrayBuffer();
      return new Uint8Array(buffer);
    } finally {
      this.releaseReadSlot();
    }
  }

  /**
   * Get a ReadableStream for reading data
   */
  readStream(handle: FileHandle, offset: number, length: number): ReadableStream<Uint8Array> {
    if (!handle.valid) {
      throw new InvalidHandleError('Handle is closed or invalid');
    }

    const storedHandle = this.handles.get(handle.id);
    if (!storedHandle || !storedHandle.valid) {
      throw new InvalidHandleError('Handle is closed or invalid');
    }

    if (handle.mode !== 'r') {
      throw new ModeError(`Handle not open for reading (mode: ${handle.mode})`);
    }

    const bucket = this.bucket;
    const path = handle.path;

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const obj = await bucket.get(path, {
            range: { offset, length },
          });

          if (!obj) {
            controller.error(new FileNotFoundError(path));
            return;
          }

          const buffer = await obj.arrayBuffer();
          controller.enqueue(new Uint8Array(buffer));
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
  }

  /**
   * Write data to file
   */
  async write(handle: FileHandle, data: Uint8Array): Promise<void> {
    if (!handle.valid) {
      throw new InvalidHandleError('Handle is closed or invalid');
    }

    const storedHandle = this.handles.get(handle.id);
    if (!storedHandle || !storedHandle.valid) {
      throw new InvalidHandleError('Handle is closed or invalid');
    }

    if (handle.mode === 'r') {
      throw new ModeError(`Handle not open for writing (mode: ${handle.mode})`);
    }

    // Buffer writes until close
    const buffer = this.writeBuffers.get(handle.id);
    if (buffer) {
      buffer.push(data);
    }

    // Update position
    handle.position += data.length;
    storedHandle.position = handle.position;
  }

  /**
   * Close file handle and release resources
   */
  async close(handle: FileHandle): Promise<void> {
    if (!handle.valid) {
      throw new InvalidHandleError('Handle is already closed');
    }

    const storedHandle = this.handles.get(handle.id);
    if (!storedHandle || !storedHandle.valid) {
      throw new InvalidHandleError('Handle is already closed');
    }

    // Flush write buffer if needed
    if (handle.mode === 'w' || handle.mode === 'a') {
      const buffer = this.writeBuffers.get(handle.id);
      if (buffer && buffer.length > 0) {
        let dataToWrite: Uint8Array;

        if (handle.mode === 'a') {
          // For append, read existing content first
          try {
            const existing = await this.bucket.get(handle.path);
            if (existing) {
              const existingData = new Uint8Array(await existing.arrayBuffer());
              const totalLength =
                existingData.length + buffer.reduce((sum, b) => sum + b.length, 0);
              dataToWrite = new Uint8Array(totalLength);
              dataToWrite.set(existingData, 0);
              let offset = existingData.length;
              for (const chunk of buffer) {
                dataToWrite.set(chunk, offset);
                offset += chunk.length;
              }
            } else {
              // No existing file
              const totalLength = buffer.reduce((sum, b) => sum + b.length, 0);
              dataToWrite = new Uint8Array(totalLength);
              let offset = 0;
              for (const chunk of buffer) {
                dataToWrite.set(chunk, offset);
                offset += chunk.length;
              }
            }
          } catch {
            // File doesn't exist, just write new data
            const totalLength = buffer.reduce((sum, b) => sum + b.length, 0);
            dataToWrite = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of buffer) {
              dataToWrite.set(chunk, offset);
              offset += chunk.length;
            }
          }
        } else {
          // For write mode, just concatenate all buffers
          const totalLength = buffer.reduce((sum, b) => sum + b.length, 0);
          dataToWrite = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of buffer) {
            dataToWrite.set(chunk, offset);
            offset += chunk.length;
          }
        }

        try {
          await this.withRetry(
            () => this.bucket.put(handle.path, dataToWrite),
            `write ${handle.path}`
          );
        } catch (err) {
          if ((err as Error).message.includes('Access Denied')) {
            throw new PermissionError(`Permission denied writing to ${handle.path}`);
          }
          throw err;
        }

        // Invalidate cache for this file
        this.invalidateCache(handle.path);
      }

      this.writeBuffers.delete(handle.id);
    }

    // Mark handle as invalid
    handle.valid = false;
    storedHandle.valid = false;
    this.handles.delete(handle.id);

    // Clean up handle state and read-ahead buffer
    const state = this.handleStates.get(handle.id);
    if (state) {
      state.readAheadBuffer = null;
      this.handleStates.delete(handle.id);
    }
  }

  /**
   * Get file statistics without downloading
   */
  async stat(path: string): Promise<FileStat> {
    // Check cache first
    const cached = this.getCachedStat(path);
    if (cached) {
      return cached;
    }

    const head = await this.withRetry(() => this.bucket.head(path), `stat ${path}`);

    if (!head) {
      throw new FileNotFoundError(path);
    }

    const stat: FileStat = {
      size: head.size,
      modified: head.uploaded || new Date(),
      etag: head.etag,
    };

    this.cacheStat(path, stat);
    return stat;
  }

  /**
   * Get file size without downloading full file
   */
  async size(path: string): Promise<number> {
    const s = await this.stat(path);
    return s.size;
  }

  /**
   * Check if file exists
   */
  async exists(path: string): Promise<boolean> {
    // Check cache first
    const cached = this.getCachedStat(path);
    if (cached) {
      return true;
    }

    try {
      const head = await this.withRetry(() => this.bucket.head(path), `exists ${path}`);
      if (head) {
        // Cache the stat
        this.cacheStat(path, {
          size: head.size,
          modified: head.uploaded || new Date(),
          etag: head.etag,
        });
        return true;
      }
      return false;
    } catch (err) {
      if (err instanceof FileNotFoundError) {
        return false;
      }
      throw err;
    }
  }

  /**
   * List files with given prefix
   */
  async list(prefix: string): Promise<string[]> {
    const result = await this.withRetry(
      () => this.bucket.list({ prefix }),
      `list ${prefix}`
    );

    return result.objects.map(obj => obj.key);
  }

  /**
   * List directory contents with delimiter support
   */
  async listDir(prefix: string): Promise<ListDirResult> {
    const result = await this.withRetry(
      () => this.bucket.list({ prefix, delimiter: '/' }),
      `listDir ${prefix}`
    );

    return {
      files: result.objects.map(obj => obj.key),
      directories: result.delimitedPrefixes || [],
    };
  }

  /**
   * Delete a file
   */
  async delete(path: string): Promise<void> {
    await this.withRetry(() => this.bucket.delete(path), `delete ${path}`);
    this.invalidateCache(path);
  }

  /**
   * Get VFS statistics for monitoring and debugging
   */
  getStats(): VFSStats {
    let totalReadAheadBufferSize = 0;
    for (const state of this.handleStates.values()) {
      if (state.readAheadBuffer) {
        totalReadAheadBufferSize += state.readAheadBuffer.data.byteLength;
      }
    }

    return {
      openHandles: this.handles.size,
      cachedMetadataEntries: this.metadataCache.size,
      activeReads: this.activeReads,
      pendingReads: this.readQueue.length,
      pendingBatchRequests: Array.from(this.pendingRangeRequests.values()).reduce(
        (sum, arr) => sum + arr.length,
        0
      ),
      totalReadAheadBufferSize,
      handleStates: this.handleStates.size,
    };
  }

  /**
   * Close all open handles and clean up resources
   * Useful for graceful shutdown
   */
  async closeAll(): Promise<void> {
    const handles = Array.from(this.handles.values());
    const errors: Error[] = [];

    for (const handle of handles) {
      try {
        await this.close(handle);
      } catch (err) {
        errors.push(err as Error);
      }
    }

    // Clear batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Reject pending batch requests
    for (const requests of this.pendingRangeRequests.values()) {
      for (const req of requests) {
        req.reject(new R2VFSError('VFS shutdown'));
      }
    }
    this.pendingRangeRequests.clear();

    // Clear cache
    this.metadataCache.clear();

    if (errors.length > 0) {
      throw new R2VFSError(`Failed to close ${errors.length} handles: ${errors[0].message}`);
    }
  }

  /**
   * Prefetch metadata for multiple files
   * Useful for warming the cache before batch operations
   */
  async prefetchMetadata(paths: string[]): Promise<void> {
    if (!this.options.cacheMetadata) {
      return;
    }

    await Promise.all(
      paths.map(async path => {
        try {
          await this.stat(path);
        } catch {
          // Ignore errors during prefetch
        }
      })
    );
  }

  /**
   * Check if a path matches a pattern (glob-like)
   * Supports * and ** wildcards
   */
  private matchPattern(path: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\*\*/g, '{{DOUBLESTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{DOUBLESTAR}}/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * List files matching a glob pattern
   */
  async glob(pattern: string): Promise<string[]> {
    // Extract prefix up to first wildcard for efficient listing
    const wildcardIndex = pattern.search(/[\*\?]/);
    const prefix = wildcardIndex >= 0 ? pattern.substring(0, wildcardIndex) : pattern;

    // Find the last slash before the wildcard to get the directory prefix
    const lastSlash = prefix.lastIndexOf('/');
    const dirPrefix = lastSlash >= 0 ? prefix.substring(0, lastSlash + 1) : '';

    const files = await this.list(dirPrefix);
    return files.filter(file => this.matchPattern(file, pattern));
  }
}

/**
 * VFS statistics for monitoring
 */
export interface VFSStats {
  /** Number of currently open file handles */
  openHandles: number;
  /** Number of cached metadata entries */
  cachedMetadataEntries: number;
  /** Number of active read operations */
  activeReads: number;
  /** Number of queued read operations */
  pendingReads: number;
  /** Number of pending batched range requests */
  pendingBatchRequests: number;
  /** Total size of read-ahead buffers in bytes */
  totalReadAheadBufferSize: number;
  /** Number of handle states tracked */
  handleStates: number;
}

// ============================================================================
// Sync VFS Wrapper
// ============================================================================

/**
 * Callback type for sync VFS operations
 */
type Callback<T> = (err: Error | null, result?: T) => void;

/**
 * Synchronous-style VFS wrapper with callback API
 */
export interface SyncVFS {
  open(path: string, mode: 'r' | 'w' | 'a', callback: Callback<FileHandle>): void;
  read(handle: FileHandle, offset: number, length: number, callback: Callback<Uint8Array>): void;
  write(handle: FileHandle, data: Uint8Array, callback: Callback<void>): void;
  close(handle: FileHandle, callback: Callback<void>): void;
}

/**
 * Create a synchronous-style VFS wrapper with callback API
 */
export function createSyncVFS(vfs: R2VFS): SyncVFS {
  return {
    open(path: string, mode: 'r' | 'w' | 'a', callback: Callback<FileHandle>): void {
      vfs
        .open(path, mode)
        .then(handle => callback(null, handle))
        .catch(err => callback(err));
    },

    read(
      handle: FileHandle,
      offset: number,
      length: number,
      callback: Callback<Uint8Array>
    ): void {
      vfs
        .read(handle, offset, length)
        .then(data => callback(null, data))
        .catch(err => callback(err));
    },

    write(handle: FileHandle, data: Uint8Array, callback: Callback<void>): void {
      vfs
        .write(handle, data)
        .then(() => callback(null))
        .catch(err => callback(err));
    },

    close(handle: FileHandle, callback: Callback<void>): void {
      vfs
        .close(handle)
        .then(() => callback(null))
        .catch(err => callback(err));
    },
  };
}
