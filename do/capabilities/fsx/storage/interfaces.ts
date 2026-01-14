/**
 * Storage Backend Interfaces
 *
 * Common interfaces for storage backends in fsx. These interfaces define
 * the contract that storage implementations must fulfill, enabling:
 *
 * - Consistent API across R2Storage, SQLiteMetadata, and TieredFS
 * - Type-safe storage operations with proper error handling
 * - Optional instrumentation hooks for metrics and logging
 * - Interchangeable storage backends for testing and flexibility
 *
 * @module storage/interfaces
 */

import type { StorageTier, FileType, FileEntry, BlobRef } from '../core/index.js'

// =============================================================================
// Error Types
// =============================================================================

/**
 * Storage error codes for consistent error handling across backends.
 *
 * These codes map to POSIX-like error semantics and enable proper
 * error discrimination in application code.
 */
export type StorageErrorCode =
  | 'ENOENT' // File/blob not found
  | 'EEXIST' // Already exists
  | 'EACCES' // Permission denied
  | 'ENOSPC' // Storage quota exceeded
  | 'EIO' // I/O error
  | 'EINVAL' // Invalid argument
  | 'ENOTEMPTY' // Directory not empty
  | 'ENOTDIR' // Not a directory
  | 'EISDIR' // Is a directory
  | 'EBUSY' // Resource busy
  | 'ETIMEDOUT' // Operation timed out
  | 'EUNKNOWN' // Unknown error

/**
 * Storage operation error with structured metadata.
 *
 * Provides consistent error information across all storage backends,
 * enabling proper error handling and logging.
 *
 * @example
 * ```typescript
 * try {
 *   await storage.get('/nonexistent')
 * } catch (e) {
 *   if (e instanceof StorageError && e.code === 'ENOENT') {
 *     // Handle missing file
 *   }
 * }
 * ```
 */
export class StorageError extends Error {
  /** Error code for programmatic handling */
  readonly code: StorageErrorCode

  /** Path/key that caused the error (if applicable) */
  readonly path?: string

  /** Original cause of the error (for debugging) */
  readonly cause?: Error

  /** Storage operation that failed */
  readonly operation?: string

  constructor(
    code: StorageErrorCode,
    message: string,
    options?: {
      path?: string
      cause?: Error
      operation?: string
    }
  ) {
    super(message)
    this.name = 'StorageError'
    this.code = code
    this.path = options?.path
    this.cause = options?.cause
    this.operation = options?.operation

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StorageError)
    }
  }

  /**
   * Create a "not found" error.
   */
  static notFound(path: string, operation?: string): StorageError {
    return new StorageError('ENOENT', `Not found: ${path}`, { path, operation })
  }

  /**
   * Create an "already exists" error.
   */
  static exists(path: string, operation?: string): StorageError {
    return new StorageError('EEXIST', `Already exists: ${path}`, { path, operation })
  }

  /**
   * Create an "invalid argument" error.
   */
  static invalidArg(message: string, path?: string, operation?: string): StorageError {
    return new StorageError('EINVAL', message, { path, operation })
  }

  /**
   * Create an I/O error from an underlying cause.
   */
  static io(cause: Error, path?: string, operation?: string): StorageError {
    return new StorageError('EIO', `I/O error: ${cause.message}`, { path, cause, operation })
  }

  /**
   * Convert to a plain object for logging/serialization.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      path: this.path,
      operation: this.operation,
    }
  }
}

// =============================================================================
// Instrumentation Hooks
// =============================================================================

/**
 * Storage operation context for instrumentation.
 *
 * Provides timing and metadata for each storage operation,
 * enabling metrics collection and performance monitoring.
 */
export interface StorageOperationContext {
  /** Operation name (e.g., 'put', 'get', 'delete') */
  operation: string

  /** Target path/key */
  path: string

  /** Storage tier involved (if applicable) */
  tier?: StorageTier

  /** Size in bytes (for put/get operations) */
  size?: number

  /** Operation start timestamp (Unix ms) */
  startTime: number
}

/**
 * Storage operation result for instrumentation.
 */
export interface StorageOperationResult {
  /** Whether the operation succeeded */
  success: boolean

  /** Duration in milliseconds */
  durationMs: number

  /** Error (if operation failed) */
  error?: StorageError

  /** Size in bytes (for get operations) */
  size?: number

  /** Storage tier used */
  tier?: StorageTier

  /** Whether a tier migration occurred */
  migrated?: boolean
}

/**
 * Instrumentation hooks for storage operations.
 *
 * These optional callbacks enable external monitoring systems
 * to observe storage operations without modifying backend code.
 *
 * @example
 * ```typescript
 * const hooks: StorageHooks = {
 *   onOperationStart: (ctx) => {
 *     console.log(`Starting ${ctx.operation} on ${ctx.path}`)
 *   },
 *   onOperationEnd: (ctx, result) => {
 *     metrics.recordLatency(ctx.operation, result.durationMs)
 *     if (!result.success) {
 *       metrics.recordError(ctx.operation, result.error?.code)
 *     }
 *   }
 * }
 *
 * const storage = new R2Storage({ bucket, hooks })
 * ```
 */
export interface StorageHooks {
  /**
   * Called when an operation starts.
   */
  onOperationStart?(ctx: StorageOperationContext): void

  /**
   * Called when an operation completes (success or failure).
   */
  onOperationEnd?(ctx: StorageOperationContext, result: StorageOperationResult): void

  /**
   * Called when a tier migration occurs.
   */
  onTierMigration?(path: string, fromTier: StorageTier, toTier: StorageTier): void
}

// =============================================================================
// Blob Storage Interface
// =============================================================================

/**
 * Result of a blob write operation.
 */
export interface BlobWriteResult {
  /** ETag of the stored object */
  etag: string

  /** Size of the stored data in bytes */
  size: number
}

/**
 * Result of a blob read operation.
 */
export interface BlobReadResult<T = Uint8Array> {
  /** The blob data */
  data: T

  /** Object metadata */
  metadata: {
    /** Size in bytes */
    size: number
    /** ETag */
    etag: string
    /** Content type (if set) */
    contentType?: string
    /** Custom metadata */
    customMetadata?: Record<string, string>
    /** Last modified timestamp */
    lastModified?: Date
  }
}

/**
 * Result of a blob list operation.
 */
export interface BlobListResult<T = BlobObjectInfo> {
  /** Listed objects */
  objects: T[]

  /** Continuation cursor (if truncated) */
  cursor?: string

  /** Whether there are more results */
  truncated: boolean
}

/**
 * Blob object info from list operations.
 */
export interface BlobObjectInfo {
  /** Object key */
  key: string

  /** Size in bytes */
  size: number

  /** ETag */
  etag: string

  /** Last modified timestamp */
  uploaded: Date
}

/**
 * Options for blob write operations.
 */
export interface BlobWriteOptions {
  /** MIME content type */
  contentType?: string

  /** Custom metadata key-value pairs */
  customMetadata?: Record<string, string>
}

/**
 * Options for blob list operations.
 */
export interface BlobListOptions {
  /** Key prefix filter */
  prefix?: string

  /** Maximum results to return */
  limit?: number

  /** Continuation cursor from previous request */
  cursor?: string
}

/**
 * Blob storage interface for R2-like object storage.
 *
 * Defines the contract for simple key-value blob storage backends.
 * Implementations include R2Storage and any compatible object store.
 *
 * @typeParam T - Type of blob data (default: Uint8Array)
 *
 * @example
 * ```typescript
 * class MyBlobStorage implements BlobStorage {
 *   async put(path: string, data: Uint8Array): Promise<BlobWriteResult> {
 *     // Implementation
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface BlobStorage {
  /**
   * Store a blob.
   *
   * @param path - Storage key/path
   * @param data - Blob data (bytes or stream)
   * @param options - Write options
   * @returns Write result with etag and size
   */
  put(path: string, data: Uint8Array | ReadableStream, options?: BlobWriteOptions): Promise<BlobWriteResult>

  /**
   * Retrieve a blob.
   *
   * @param path - Storage key/path
   * @returns Blob data and metadata, or null if not found
   */
  get(path: string): Promise<BlobReadResult | null>

  /**
   * Retrieve a blob as a stream.
   *
   * @param path - Storage key/path
   * @returns Stream and metadata, or null if not found
   */
  getStream?(path: string): Promise<{ stream: ReadableStream; metadata: BlobReadResult['metadata'] } | null>

  /**
   * Retrieve a range of bytes from a blob.
   *
   * @param path - Storage key/path
   * @param start - Start byte offset (inclusive)
   * @param end - End byte offset (inclusive, optional)
   * @returns Partial blob data and metadata, or null if not found
   */
  getRange?(path: string, start: number, end?: number): Promise<BlobReadResult | null>

  /**
   * Delete a blob.
   *
   * @param path - Storage key/path
   */
  delete(path: string): Promise<void>

  /**
   * Delete multiple blobs.
   *
   * @param paths - Storage keys/paths to delete
   */
  deleteMany?(paths: string[]): Promise<void>

  /**
   * Check if a blob exists.
   *
   * @param path - Storage key/path
   * @returns true if blob exists
   */
  exists(path: string): Promise<boolean>

  /**
   * Get blob metadata without downloading content.
   *
   * @param path - Storage key/path
   * @returns Metadata or null if not found
   */
  head?(path: string): Promise<BlobReadResult['metadata'] | null>

  /**
   * List blobs with optional prefix filter.
   *
   * @param options - List options (prefix, limit, cursor)
   * @returns List of blob objects with pagination
   */
  list?(options?: BlobListOptions): Promise<BlobListResult>

  /**
   * Copy a blob.
   *
   * @param sourcePath - Source key/path
   * @param destPath - Destination key/path
   * @returns Write result for the copy
   */
  copy?(sourcePath: string, destPath: string): Promise<BlobWriteResult>
}

// =============================================================================
// Metadata Storage Interface
// =============================================================================

/**
 * Options for creating a file entry.
 */
export interface CreateEntryOptions {
  /** Full file path */
  path: string

  /** File/directory name */
  name: string

  /** Parent entry ID (null for root) */
  parentId: string | null

  /** Entry type */
  type: FileType

  /** File permissions mode */
  mode: number

  /** Owner user ID */
  uid: number

  /** Owner group ID */
  gid: number

  /** File size in bytes */
  size: number

  /** Associated blob ID (for files) */
  blobId: string | null

  /** Symlink target (for symlinks) */
  linkTarget: string | null

  /** Hard link count */
  nlink: number

  /** Storage tier */
  tier?: StorageTier
}

/**
 * Options for updating a file entry.
 */
export interface UpdateEntryOptions {
  /** New path (for rename) */
  path?: string

  /** New name */
  name?: string

  /** New parent ID (for move) */
  parentId?: string | null

  /** New permissions mode */
  mode?: number

  /** New owner user ID */
  uid?: number

  /** New owner group ID */
  gid?: number

  /** New file size */
  size?: number

  /** New blob ID */
  blobId?: string | null

  /** New storage tier */
  tier?: StorageTier

  /** New access time (Unix ms) */
  atime?: number

  /** New modification time (Unix ms) */
  mtime?: number
}

/**
 * Storage statistics.
 */
export interface StorageStats {
  /** Total number of files */
  totalFiles: number

  /** Total number of directories */
  totalDirectories: number

  /** Total size in bytes */
  totalSize: number

  /** Blob statistics by tier */
  blobsByTier: Record<StorageTier, { count: number; size: number }>
}

/**
 * Metadata storage interface for filesystem metadata.
 *
 * Defines the contract for storing filesystem structure and metadata
 * (paths, permissions, timestamps) separate from blob content.
 * Implementations include SQLiteMetadata for Durable Objects.
 *
 * @example
 * ```typescript
 * class MyMetadataStore implements MetadataStorage {
 *   async getByPath(path: string): Promise<FileEntry | null> {
 *     // Implementation
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface MetadataStorage {
  /**
   * Initialize the metadata store (create tables, etc.).
   */
  init(): Promise<void>

  /**
   * Get a file entry by path.
   *
   * @param path - Absolute file path
   * @returns File entry or null if not found
   */
  getByPath(path: string): Promise<FileEntry | null>

  /**
   * Get a file entry by ID.
   *
   * @param id - Entry ID
   * @returns File entry or null if not found
   */
  getById(id: string): Promise<FileEntry | null>

  /**
   * Get children of a directory.
   *
   * @param parentId - Parent directory ID
   * @returns Array of child entries
   */
  getChildren(parentId: string): Promise<FileEntry[]>

  /**
   * Create a new file entry.
   *
   * @param entry - Entry creation options
   * @returns The generated entry ID
   */
  createEntry(entry: CreateEntryOptions): Promise<number>

  /**
   * Update an existing entry.
   *
   * @param id - Entry ID to update
   * @param updates - Fields to update
   */
  updateEntry(id: string, updates: UpdateEntryOptions): Promise<void>

  /**
   * Delete an entry.
   *
   * @param id - Entry ID to delete
   */
  deleteEntry(id: string): Promise<void>

  /**
   * Register a blob in the metadata store.
   *
   * @param blob - Blob metadata
   */
  registerBlob(blob: { id: string; tier: StorageTier; size: number; checksum?: string }): Promise<void>

  /**
   * Get blob metadata.
   *
   * @param id - Blob ID
   * @returns Blob metadata or null if not found
   */
  getBlob(id: string): Promise<BlobRef | null>

  /**
   * Update blob storage tier.
   *
   * @param id - Blob ID
   * @param tier - New storage tier
   */
  updateBlobTier(id: string, tier: StorageTier): Promise<void>

  /**
   * Delete a blob reference.
   *
   * @param id - Blob ID
   */
  deleteBlob(id: string): Promise<void>

  /**
   * Find entries matching a pattern.
   *
   * @param pattern - Glob-like pattern
   * @param parentPath - Optional parent path constraint
   * @returns Matching entries
   */
  findByPattern(pattern: string, parentPath?: string): Promise<FileEntry[]>

  /**
   * Get storage statistics.
   *
   * @returns Storage usage statistics
   */
  getStats(): Promise<StorageStats>
}

// =============================================================================
// Tiered Storage Interface
// =============================================================================

/**
 * Result of a tiered write operation.
 */
export interface TieredWriteResult extends BlobWriteResult {
  /** Storage tier used */
  tier: StorageTier

  /** Whether a tier migration occurred */
  migrated: boolean

  /** Previous tier (if migrated) */
  previousTier?: StorageTier
}

/**
 * Result of a tiered read operation.
 */
export interface TieredReadResult extends BlobReadResult {
  /** Storage tier read from */
  tier: StorageTier

  /** Whether a tier migration occurred */
  migrated: boolean

  /** Previous tier (if migrated) */
  previousTier?: StorageTier
}

/**
 * Tiered storage interface for hot/warm/cold storage.
 *
 * Extends BlobStorage with tier-aware operations, automatic placement,
 * and tier migration capabilities.
 *
 * @example
 * ```typescript
 * class MyTieredStorage implements TieredStorage {
 *   async put(path: string, data: Uint8Array, options?: { tier?: StorageTier }): Promise<TieredWriteResult> {
 *     const tier = options?.tier ?? this.selectTier(data.length)
 *     // Write to appropriate tier
 *   }
 * }
 * ```
 */
export interface TieredStorage extends BlobStorage {
  /**
   * Store with tier selection.
   */
  put(
    path: string,
    data: Uint8Array | ReadableStream,
    options?: BlobWriteOptions & { tier?: StorageTier }
  ): Promise<TieredWriteResult>

  /**
   * Retrieve with tier tracking.
   */
  get(path: string): Promise<TieredReadResult | null>

  /**
   * Promote a file to a higher (faster) tier.
   *
   * @param path - File path
   * @param targetTier - Target tier ('hot' or 'warm')
   * @returns Migration result
   */
  promote(path: string, targetTier: 'hot' | 'warm'): Promise<{ tier: StorageTier; migrated: boolean; previousTier?: StorageTier }>

  /**
   * Demote a file to a lower (cheaper) tier.
   *
   * @param path - File path
   * @param targetTier - Target tier ('warm' or 'cold')
   * @returns Migration result
   */
  demote(path: string, targetTier: 'warm' | 'cold'): Promise<{ tier: StorageTier; migrated: boolean; previousTier?: StorageTier }>

  /**
   * Get the current tier for a file.
   *
   * @param path - File path
   * @returns Current tier or null if not found
   */
  getTier(path: string): Promise<StorageTier | null>
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a storage operation context for instrumentation.
 *
 * @param operation - Operation name
 * @param path - Target path
 * @param options - Additional context
 * @returns Operation context
 */
export function createOperationContext(
  operation: string,
  path: string,
  options?: { tier?: StorageTier; size?: number }
): StorageOperationContext {
  return {
    operation,
    path,
    tier: options?.tier,
    size: options?.size,
    startTime: Date.now(),
  }
}

/**
 * Create a storage operation result for instrumentation.
 *
 * @param ctx - Operation context
 * @param options - Result options
 * @returns Operation result
 */
export function createOperationResult(
  ctx: StorageOperationContext,
  options: {
    success: boolean
    error?: StorageError
    size?: number
    tier?: StorageTier
    migrated?: boolean
  }
): StorageOperationResult {
  return {
    success: options.success,
    durationMs: Date.now() - ctx.startTime,
    error: options.error,
    size: options.size,
    tier: options.tier,
    migrated: options.migrated,
  }
}

/**
 * Wrap a storage operation with instrumentation hooks.
 *
 * @param hooks - Optional instrumentation hooks
 * @param operation - Operation name
 * @param path - Target path
 * @param fn - Operation function to execute
 * @returns Operation result
 */
export async function withInstrumentation<T>(
  hooks: StorageHooks | undefined,
  operation: string,
  path: string,
  fn: () => Promise<T>
): Promise<T> {
  const ctx = createOperationContext(operation, path)

  hooks?.onOperationStart?.(ctx)

  try {
    const result = await fn()
    hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: true }))
    return result
  } catch (error) {
    const storageError = error instanceof StorageError ? error : StorageError.io(error as Error, path, operation)
    hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: false, error: storageError }))
    throw error
  }
}
