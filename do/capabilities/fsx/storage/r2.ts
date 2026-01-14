/**
 * R2Storage - R2-backed blob storage for fsx
 *
 * Provides a simple key-value blob storage interface backed by Cloudflare R2.
 * Implements the {@link BlobStorage} interface for consistent API across backends.
 *
 * Features:
 * - Key prefix support for namespacing
 * - Streaming reads and writes
 * - Range reads for partial content
 * - Batch delete operations
 * - Multipart upload support for large files
 * - Optional instrumentation hooks for metrics/logging
 *
 * @example
 * ```typescript
 * const storage = new R2Storage({
 *   bucket: env.MY_BUCKET,
 *   prefix: 'files/',
 *   hooks: {
 *     onOperationEnd: (ctx, result) => {
 *       console.log(`${ctx.operation} took ${result.durationMs}ms`)
 *     }
 *   }
 * })
 *
 * await storage.put('/data.json', new TextEncoder().encode('{}'))
 * const result = await storage.get('/data.json')
 * ```
 *
 * @module storage/r2
 */

import {
  StorageError,
  type BlobStorage,
  type BlobWriteResult,
  type BlobReadResult,
  type BlobListResult,
  type BlobWriteOptions,
  type BlobListOptions,
  type StorageHooks,
  createOperationContext,
  createOperationResult,
  withInstrumentation,
} from './interfaces.js'

/** Maximum key length in bytes for R2 */
const MAX_KEY_LENGTH_BYTES = 1024

/** Maximum parts for multipart uploads (R2 limit) */
const _MAX_MULTIPART_PARTS = 10000

/** Default retry configuration */
const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  retryableErrors: ['ETIMEDOUT', 'EIO'],
}

/**
 * Configuration for retry logic with exponential backoff.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number
  /** Base delay in milliseconds for exponential backoff (default: 100) */
  baseDelayMs?: number
  /** Maximum delay in milliseconds (default: 5000) */
  maxDelayMs?: number
  /** Error codes that should trigger a retry (default: ['ETIMEDOUT', 'EIO']) */
  retryableErrors?: string[]
}

/**
 * Configuration options for R2Storage.
 */
export interface R2StorageConfig {
  /** R2 bucket binding from wrangler.toml */
  bucket: R2Bucket

  /** Key prefix for all objects (default: '') */
  prefix?: string

  /** Optional instrumentation hooks for metrics/logging */
  hooks?: StorageHooks

  /** Optional retry configuration for transient errors */
  retry?: RetryConfig
}

/**
 * Extended write options for R2-specific features.
 */
export interface R2WriteOptions extends BlobWriteOptions {
  /** MD5 checksum for integrity verification */
  md5?: string
}

/**
 * Metadata returned from R2 operations.
 *
 * Extends the base metadata interface with R2-specific fields.
 */
export interface R2ObjectMetadata {
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
  /** R2 HTTP metadata */
  httpMetadata?: R2HTTPMetadata
  /** MD5 checksum (if available) */
  md5?: string
}

/**
 * Convert R2Object to our metadata format.
 */
function toMetadata(obj: R2Object, md5?: string): R2ObjectMetadata {
  return {
    size: obj.size,
    etag: obj.etag,
    contentType: obj.httpMetadata?.contentType,
    customMetadata: obj.customMetadata,
    lastModified: obj.uploaded,
    httpMetadata: obj.httpMetadata,
    md5,
  }
}

/**
 * Validate key length (R2 has 1024 byte limit).
 */
function validateKeyLength(key: string): void {
  const byteLength = new TextEncoder().encode(key).length
  if (byteLength > MAX_KEY_LENGTH_BYTES) {
    throw new StorageError('EINVAL', `Key exceeds maximum length of ${MAX_KEY_LENGTH_BYTES} bytes: ${byteLength} bytes`, {
      path: key,
      operation: 'put',
    })
  }
}

/**
 * Convert R2-specific error codes to StorageError.
 */
function handleR2Error(error: unknown, path: string, operation: string): never {
  const err = error as Error & { code?: string; retryAfter?: number }

  if (err.code === 'ERR_R2_ACCESS_DENIED') {
    throw new StorageError('EACCES', `Access denied: ${path}`, { path, operation, cause: err })
  }

  if (err.code === 'ERR_R2_RATE_LIMITED') {
    const storageError = new StorageError('ETIMEDOUT', `Rate limit exceeded: ${path}`, { path, operation, cause: err }) as StorageError & { retryAfter?: number }
    storageError.retryAfter = 60 // Default retry-after in seconds
    throw storageError
  }

  if (err.code === 'ERR_R2_PRECONDITION_FAILED') {
    throw new StorageError('EEXIST', `Precondition failed: ${path}`, { path, operation, cause: err })
  }

  throw err
}

/**
 * Check if an error is retryable based on configuration.
 */
function isRetryableError(error: unknown, retryableErrors: string[]): boolean {
  if (error instanceof StorageError) {
    return retryableErrors.includes(error.code)
  }
  const err = error as Error & { code?: string }
  // R2 rate limit errors are always retryable
  if (err.code === 'ERR_R2_RATE_LIMITED') {
    return true
  }
  return false
}

/**
 * Calculate delay with exponential backoff and jitter.
 */
function calculateBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  // Exponential backoff: base * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt)
  // Add jitter (0-25% of delay) to prevent thundering herd
  const jitter = exponentialDelay * Math.random() * 0.25
  const delay = exponentialDelay + jitter
  return Math.min(delay, maxDelayMs)
}

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Execute an operation with retry logic and exponential backoff.
 *
 * @internal Reserved for future use when retry is enabled by configuration.
 */
async function _withRetry<T>(
  fn: () => Promise<T>,
  config: Required<RetryConfig>,
  path: string,
  operation: string
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Convert R2 errors to StorageError for consistent handling
      let processedError = error
      try {
        handleR2Error(error, path, operation)
      } catch (e) {
        processedError = e
      }

      // Check if this error is retryable
      if (!isRetryableError(processedError, config.retryableErrors)) {
        throw processedError
      }

      // Don't retry on last attempt
      if (attempt === config.maxAttempts - 1) {
        throw processedError
      }

      // Calculate and apply backoff delay
      const delay = calculateBackoffDelay(attempt, config.baseDelayMs, config.maxDelayMs)
      await sleep(delay)
    }
  }

  throw lastError
}

/**
 * Custom instrumentation wrapper that includes size in result.
 */
async function withInstrumentationAndSize<T>(
  hooks: StorageHooks | undefined,
  operation: string,
  path: string,
  fn: () => Promise<T>,
  getSize?: (result: T) => number | undefined
): Promise<T> {
  const ctx = createOperationContext(operation, path)

  hooks?.onOperationStart?.(ctx)

  try {
    const result = await fn()
    const size = getSize?.(result)
    hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: true, size }))
    return result
  } catch (error) {
    const storageError = error instanceof StorageError ? error : StorageError.io(error as Error, path, operation)
    hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: false, error: storageError }))
    throw error
  }
}

/**
 * R2Storage - Blob storage backed by Cloudflare R2.
 *
 * Implements the {@link BlobStorage} interface for storing binary data
 * in Cloudflare R2 object storage. Provides a clean API for common
 * operations with optional instrumentation support.
 *
 * @implements {BlobStorage}
 *
 * @example
 * ```typescript
 * // Basic usage
 * const storage = new R2Storage({ bucket: env.MY_BUCKET })
 * await storage.put('/file.txt', data)
 * const result = await storage.get('/file.txt')
 *
 * // With prefix namespacing
 * const userStorage = new R2Storage({
 *   bucket: env.MY_BUCKET,
 *   prefix: `users/${userId}/`
 * })
 *
 * // With instrumentation
 * const storage = new R2Storage({
 *   bucket: env.MY_BUCKET,
 *   hooks: {
 *     onOperationStart: (ctx) => console.log(`Starting ${ctx.operation}`),
 *     onOperationEnd: (ctx, result) => {
 *       metrics.record(ctx.operation, result.durationMs)
 *     }
 *   }
 * })
 * ```
 */
export class R2Storage implements BlobStorage {
  private readonly bucket: R2Bucket
  private readonly prefix: string
  private readonly hooks?: StorageHooks
  /** @internal Reserved for future retry functionality */
  private readonly _retryConfig: Required<RetryConfig>

  /**
   * Create a new R2Storage instance.
   *
   * @param config - Storage configuration
   */
  constructor(config: R2StorageConfig) {
    this.bucket = config.bucket
    this.prefix = config.prefix ?? ''
    this.hooks = config.hooks
    this._retryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      ...config.retry,
    }
  }

  /**
   * Get full key with prefix.
   *
   * @param path - Relative path
   * @returns Full key with prefix
   * @internal
   */
  private key(path: string): string {
    return this.prefix + path
  }

  /**
   * Store a blob in R2.
   *
   * @param path - Storage key/path
   * @param data - Blob data (bytes or stream)
   * @param options - Write options (contentType, customMetadata, md5)
   * @returns Write result with etag and size
   *
   * @example
   * ```typescript
   * // Store binary data
   * const result = await storage.put('/data.bin', bytes)
   * console.log(`Stored ${result.size} bytes, etag: ${result.etag}`)
   *
   * // Store with content type
   * await storage.put('/image.png', imageBytes, {
   *   contentType: 'image/png'
   * })
   *
   * // Store with custom metadata
   * await storage.put('/file.txt', data, {
   *   customMetadata: { author: 'user123' }
   * })
   * ```
   */
  async put(
    path: string,
    data: Uint8Array | ReadableStream,
    options?: R2WriteOptions
  ): Promise<BlobWriteResult> {
    const dataSize = data instanceof Uint8Array ? data.length : undefined
    return withInstrumentationAndSize(
      this.hooks,
      'put',
      path,
      async () => {
        const key = this.key(path)

        // Validate key length
        validateKeyLength(key)

        // If MD5 checksum provided, validate it (for now, just store it in metadata)
        const customMetadata = { ...options?.customMetadata }
        if ((options as R2WriteOptions)?.md5) {
          customMetadata['x-md5'] = (options as R2WriteOptions).md5!
        }

        try {
          const object = await this.bucket.put(key, data, {
            httpMetadata: options?.contentType ? { contentType: options.contentType } : undefined,
            customMetadata: Object.keys(customMetadata).length > 0 ? customMetadata : undefined,
          })

          return {
            etag: object.etag,
            size: object.size,
          }
        } catch (error) {
          handleR2Error(error, path, 'put')
        }
      },
      (result) => result?.size ?? dataSize
    )
  }

  /**
   * Retrieve a blob from R2.
   *
   * @param path - Storage key/path
   * @returns Blob data and metadata, or null if not found
   *
   * @example
   * ```typescript
   * const result = await storage.get('/data.json')
   * if (result) {
   *   const text = new TextDecoder().decode(result.data)
   *   console.log(`Size: ${result.metadata.size} bytes`)
   * }
   * ```
   */
  async get(path: string): Promise<BlobReadResult<Uint8Array> | null> {
    return withInstrumentationAndSize(
      this.hooks,
      'get',
      path,
      async () => {
        const key = this.key(path)

        try {
          const object = await this.bucket.get(key)

          if (!object) {
            return null
          }

          const data = new Uint8Array(await object.arrayBuffer())
          return { data, metadata: toMetadata(object) }
        } catch (error) {
          handleR2Error(error, path, 'get')
        }
      },
      (result) => result?.data.length
    )
  }

  /**
   * Retrieve a blob as a readable stream.
   *
   * Useful for large files where buffering the entire content
   * in memory is not desirable.
   *
   * @param path - Storage key/path
   * @returns Stream and metadata, or null if not found
   *
   * @example
   * ```typescript
   * const result = await storage.getStream('/large-file.bin')
   * if (result) {
   *   // Pipe to response
   *   return new Response(result.stream, {
   *     headers: { 'Content-Length': String(result.metadata.size) }
   *   })
   * }
   * ```
   */
  async getStream(path: string): Promise<{ stream: ReadableStream; metadata: R2ObjectMetadata } | null> {
    return withInstrumentation(this.hooks, 'getStream', path, async () => {
      const key = this.key(path)
      const object = await this.bucket.get(key)

      if (!object) {
        return null
      }

      return { stream: object.body, metadata: toMetadata(object) }
    })
  }

  /**
   * Retrieve a range of bytes from a blob.
   *
   * Useful for resumable downloads or seeking within large files.
   *
   * @param path - Storage key/path
   * @param start - Start byte offset (inclusive)
   * @param end - End byte offset (inclusive, optional)
   * @returns Partial blob data and metadata, or null if not found
   *
   * @example
   * ```typescript
   * // Get first 1KB
   * const head = await storage.getRange('/file.bin', 0, 1023)
   *
   * // Get bytes 1000 to end
   * const tail = await storage.getRange('/file.bin', 1000)
   * ```
   */
  async getRange(
    path: string,
    start: number,
    end?: number
  ): Promise<BlobReadResult<Uint8Array> | null> {
    return withInstrumentationAndSize(
      this.hooks,
      'getRange',
      path,
      async () => {
        // Validate range: start must not be greater than end
        if (end !== undefined && start > end) {
          throw new StorageError('EINVAL', `Invalid range: start (${start}) > end (${end})`, {
            path,
            operation: 'getRange',
          })
        }

        const key = this.key(path)
        const range = end !== undefined ? { offset: start, length: end - start + 1 } : { offset: start }
        const object = await this.bucket.get(key, { range })

        if (!object) {
          return null
        }

        const data = new Uint8Array(await object.arrayBuffer())
        return { data, metadata: toMetadata(object) }
      },
      (result) => result?.data.length
    )
  }

  /**
   * Retrieve the last N bytes from a blob (suffix range).
   *
   * @param path - Storage key/path
   * @param length - Number of bytes from the end
   * @returns Partial blob data and metadata, or null if not found
   *
   * @example
   * ```typescript
   * // Get last 100 bytes
   * const tail = await storage.getRangeSuffix('/file.bin', 100)
   * ```
   */
  async getRangeSuffix(path: string, length: number): Promise<BlobReadResult<Uint8Array> | null> {
    return withInstrumentationAndSize(
      this.hooks,
      'getRangeSuffix',
      path,
      async () => {
        const key = this.key(path)
        const object = await this.bucket.get(key, { range: { suffix: length } })

        if (!object) {
          return null
        }

        const data = new Uint8Array(await object.arrayBuffer())
        return { data, metadata: toMetadata(object) }
      },
      (result) => result?.data.length
    )
  }

  /**
   * Delete a blob from R2.
   *
   * This operation is idempotent - it succeeds even if the blob doesn't exist.
   *
   * @param path - Storage key/path
   *
   * @example
   * ```typescript
   * await storage.delete('/old-file.txt')
   * ```
   */
  async delete(path: string): Promise<void> {
    return withInstrumentationAndSize(this.hooks, 'delete', path, async () => {
      const key = this.key(path)
      try {
        await this.bucket.delete(key)
      } catch (error) {
        handleR2Error(error, path, 'delete')
      }
    })
  }

  /**
   * Delete multiple blobs in a single operation.
   *
   * More efficient than individual deletes for batch cleanup.
   *
   * @param paths - Storage keys/paths to delete
   *
   * @example
   * ```typescript
   * await storage.deleteMany(['/file1.txt', '/file2.txt', '/file3.txt'])
   * ```
   */
  async deleteMany(paths: string[]): Promise<void> {
    return withInstrumentation(this.hooks, 'deleteMany', paths[0] ?? '', async () => {
      const keys = paths.map((p) => this.key(p))
      await this.bucket.delete(keys)
    })
  }

  /**
   * Check if a blob exists in R2.
   *
   * Uses HEAD request for efficiency - doesn't download the blob content.
   *
   * @param path - Storage key/path
   * @returns true if blob exists
   *
   * @example
   * ```typescript
   * if (await storage.exists('/config.json')) {
   *   const config = await storage.get('/config.json')
   * }
   * ```
   */
  async exists(path: string): Promise<boolean> {
    return withInstrumentation(this.hooks, 'exists', path, async () => {
      const key = this.key(path)
      const object = await this.bucket.head(key)
      return object !== null
    })
  }

  /**
   * Get blob metadata without downloading content.
   *
   * Efficient way to check file size, content type, or custom metadata.
   *
   * @param path - Storage key/path
   * @returns Metadata or null if not found
   *
   * @example
   * ```typescript
   * const meta = await storage.head('/file.txt')
   * if (meta) {
   *   console.log(`Size: ${meta.size}, Type: ${meta.contentType}`)
   * }
   * ```
   */
  async head(path: string): Promise<R2ObjectMetadata | null> {
    return withInstrumentationAndSize(this.hooks, 'head', path, async () => {
      const key = this.key(path)
      try {
        const object = await this.bucket.head(key)
        if (!object) return null
        const md5 = object.customMetadata?.['x-md5']
        return toMetadata(object, md5)
      } catch (error) {
        handleR2Error(error, path, 'head')
      }
    })
  }

  /**
   * List blobs with optional prefix filter.
   *
   * Supports pagination for large result sets using cursor-based pagination.
   *
   * @param options - List options (prefix, limit, cursor)
   * @returns List of blob objects with pagination info
   *
   * @example
   * ```typescript
   * // List all blobs
   * const result = await storage.list()
   *
   * // List with prefix filter
   * const images = await storage.list({ prefix: 'images/' })
   *
   * // Paginate through results
   * let cursor: string | undefined
   * do {
   *   const page = await storage.list({ limit: 100, cursor })
   *   for (const obj of page.objects) {
   *     console.log(obj.key)
   *   }
   *   cursor = page.cursor
   * } while (cursor)
   * ```
   */
  async list(options?: BlobListOptions): Promise<BlobListResult> {
    return withInstrumentation(this.hooks, 'list', options?.prefix ?? '', async () => {
      const fullPrefix = options?.prefix ? this.key(options.prefix) : this.prefix

      const result = await this.bucket.list({
        prefix: fullPrefix,
        limit: options?.limit,
        cursor: options?.cursor,
      })

      return {
        objects: result.objects.map((obj) => ({
          key: obj.key,
          size: obj.size,
          etag: obj.etag,
          uploaded: obj.uploaded,
        })),
        cursor: result.truncated ? result.cursor : undefined,
        truncated: result.truncated,
      }
    })
  }

  /**
   * Copy a blob within R2.
   *
   * Note: R2 doesn't have native copy, so this reads and writes the data.
   * For large files, consider using multipart upload.
   *
   * @param sourcePath - Source key/path
   * @param destPath - Destination key/path
   * @returns Write result for the copy
   * @throws {StorageError} If source not found (ENOENT)
   *
   * @example
   * ```typescript
   * await storage.copy('/original.txt', '/backup.txt')
   * ```
   */
  async copy(sourcePath: string, destPath: string): Promise<BlobWriteResult> {
    return withInstrumentation(this.hooks, 'copy', sourcePath, async () => {
      const sourceKey = this.key(sourcePath)
      const destKey = this.key(destPath)

      // R2 doesn't have native copy, so we need to get and put
      const source = await this.bucket.get(sourceKey)
      if (!source) {
        throw new StorageError('ENOENT', `Source not found: ${sourcePath}`, { path: sourcePath, operation: 'copy' })
      }

      const object = await this.bucket.put(destKey, source.body, {
        httpMetadata: source.httpMetadata,
        customMetadata: source.customMetadata,
      })

      return {
        etag: object.etag,
        size: object.size,
      }
    })
  }

  /**
   * Create a multipart upload for large files.
   *
   * Use for files larger than 5MB for better reliability and performance.
   * Allows parallel uploads of file parts.
   *
   * @param path - Storage key/path
   * @param options - Upload options (contentType, customMetadata)
   * @returns R2MultipartUpload handle
   *
   * @example
   * ```typescript
   * const upload = await storage.createMultipartUpload('/large-file.bin', {
   *   contentType: 'application/octet-stream'
   * })
   *
   * const parts: R2UploadedPart[] = []
   * for (let i = 0; i < chunks.length; i++) {
   *   const part = await upload.uploadPart(i + 1, chunks[i])
   *   parts.push(part)
   * }
   *
   * await upload.complete(parts)
   * ```
   */
  async createMultipartUpload(
    path: string,
    options?: BlobWriteOptions
  ): Promise<R2MultipartUpload> {
    return withInstrumentation(this.hooks, 'createMultipartUpload', path, async () => {
      const key = this.key(path)
      return this.bucket.createMultipartUpload(key, {
        httpMetadata: options?.contentType ? { contentType: options.contentType } : undefined,
        customMetadata: options?.customMetadata,
      })
    })
  }

  /**
   * Resume an in-progress multipart upload.
   *
   * Use to continue an upload that was interrupted or to add more parts.
   *
   * @param path - Storage key/path
   * @param uploadId - Upload ID from createMultipartUpload
   * @returns R2MultipartUpload handle
   *
   * @example
   * ```typescript
   * // Resume a previous upload
   * const upload = storage.resumeMultipartUpload('/large-file.bin', savedUploadId)
   * const part = await upload.uploadPart(nextPartNumber, nextChunk)
   * ```
   */
  resumeMultipartUpload(path: string, uploadId: string): R2MultipartUpload {
    const key = this.key(path)
    return this.bucket.resumeMultipartUpload(key, uploadId)
  }
}
