/**
 * createReadStream - Create a readable stream for file content
 *
 * This module implements Node.js-compatible streaming file reads using the
 * Web Streams API (WHATWG Streams Standard). It provides efficient chunked
 * reading with proper backpressure handling, suitable for large files.
 *
 * Key features:
 * - Pull-based streaming with configurable chunk sizes
 * - Byte range support (start/end) for partial reads and HTTP Range requests
 * - Abort signal support for cancellation
 * - Memory-efficient: uses subarray() to avoid unnecessary copies
 *
 * @module fs/createReadStream
 */

import type { BufferEncoding } from '../types'
import { ENOENT, EISDIR, EINVAL } from '../errors'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for createReadStream.
 *
 * These options control how the file is read and streamed, including
 * byte range selection, chunk sizing, and abort handling.
 *
 * @example
 * ```typescript
 * // Read entire file with default 64KB chunks
 * const stream = await createReadStream('/file.bin')
 *
 * // Read specific byte range (for HTTP Range requests)
 * const partial = await createReadStream('/file.bin', {
 *   start: 1000,
 *   end: 2000
 * })
 *
 * // Use smaller chunks for memory-constrained environments
 * const small = await createReadStream('/file.bin', {
 *   highWaterMark: 16 * 1024  // 16KB chunks
 * })
 *
 * // Support cancellation
 * const controller = new AbortController()
 * const stream = await createReadStream('/file.bin', {
 *   signal: controller.signal
 * })
 * // Later: controller.abort()
 * ```
 */
export interface ReadStreamOptions {
  /**
   * Start byte position (inclusive).
   * Defaults to 0 (beginning of file).
   */
  start?: number

  /**
   * End byte position (inclusive).
   * Defaults to file size - 1 (end of file).
   * If specified beyond file size, clamped to file end.
   */
  end?: number

  /**
   * Chunk size in bytes for streaming.
   * Controls how much data is enqueued at a time.
   * Larger values mean fewer I/O operations but more memory usage.
   * Defaults to 64KB (optimal for most use cases).
   */
  highWaterMark?: number

  /**
   * Character encoding for text mode.
   * When specified, the stream would encode text (not yet implemented).
   * Pass null for binary mode (default).
   */
  encoding?: BufferEncoding | null

  /**
   * Abort signal for cancellation support.
   * When aborted, the stream closes gracefully.
   */
  signal?: AbortSignal
}

/**
 * Storage interface for createReadStream.
 *
 * This abstraction allows createReadStream to work with different
 * storage backends (in-memory for testing, SQLite for hot tier,
 * R2 for warm/cold tiers).
 */
export interface CreateReadStreamStorage {
  /**
   * Get file entry by path.
   * @param path - Absolute file path
   * @returns File content and metadata, or undefined if not found
   */
  get(path: string): { content: Uint8Array; isDirectory: boolean } | undefined

  /**
   * Check if path exists.
   * @param path - Absolute file path
   * @returns true if path exists
   */
  has(path: string): boolean
}

// =============================================================================
// Module State
// =============================================================================

/** Module-level storage backend (set via setStorage for testing) */
let storage: CreateReadStreamStorage | null = null

/**
 * Set the storage backend for createReadStream.
 *
 * This is primarily used for testing to inject mock storage.
 * In production, the storage is typically set by the filesystem
 * module during initialization.
 *
 * @param s - Storage backend implementation, or null to clear
 */
export function setStorage(s: CreateReadStreamStorage | null): void {
  storage = s
}

/**
 * Get the current storage backend.
 *
 * @returns Current storage backend, or null if not set
 */
export function getStorage(): CreateReadStreamStorage | null {
  return storage
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Default chunk size: 64KB.
 *
 * This value balances memory usage and I/O efficiency:
 * - Aligns well with typical network MTU optimizations
 * - Matches R2's optimal transfer unit size
 * - Small enough to maintain low latency to first byte
 * - Large enough to minimize per-chunk overhead
 */
const DEFAULT_HIGH_WATER_MARK = 64 * 1024

// =============================================================================
// Internal Utilities
// =============================================================================

/**
 * Normalize a file path by resolving . and .. components and removing double slashes.
 *
 * @param path - Path to normalize (must be absolute)
 * @returns Normalized absolute path
 *
 * @example
 * ```typescript
 * normalizePath('/foo//bar')       // '/foo/bar'
 * normalizePath('/foo/./bar')      // '/foo/bar'
 * normalizePath('/foo/baz/../bar') // '/foo/bar'
 * ```
 *
 * @internal
 */
function normalizePath(path: string): string {
  // Split path into segments, filtering empty strings (from double slashes)
  const segments = path.split('/').filter((s) => s !== '')
  const result: string[] = []

  for (const segment of segments) {
    if (segment === '.') {
      // Current directory, skip
      continue
    } else if (segment === '..') {
      // Parent directory, go up
      result.pop()
    } else {
      result.push(segment)
    }
  }

  return '/' + result.join('/')
}

// =============================================================================
// Main Implementation
// =============================================================================

/**
 * Create a readable stream for a file.
 *
 * This function implements Node.js-compatible streaming file reads using the
 * Web Streams API. It supports:
 * - Byte range reads for partial content (HTTP Range header support)
 * - Configurable chunk sizes via highWaterMark
 * - Proper backpressure handling via pull-based streaming
 * - AbortSignal for cancellation
 *
 * Memory efficiency notes:
 * - Uses subarray() for range extraction (no copy until chunk is emitted)
 * - Each chunk is a copy (slice) to ensure consumer can freely use the data
 * - The pull-based model means chunks are only created when the consumer
 *   is ready to receive them
 *
 * @param path - Absolute path to the file (must start with '/')
 * @param options - Stream options for range, chunk size, and cancellation
 * @returns A ReadableStream of Uint8Array chunks
 *
 * @throws {ENOENT} If file does not exist
 * @throws {EISDIR} If path is a directory
 * @throws {EINVAL} If start > end or path is relative
 *
 * @example
 * ```typescript
 * // Basic usage - read entire file
 * const stream = await createReadStream('/data/file.bin')
 * const reader = stream.getReader()
 * while (true) {
 *   const { done, value } = await reader.read()
 *   if (done) break
 *   processChunk(value)
 * }
 *
 * // HTTP Range request support
 * const partial = await createReadStream('/video.mp4', {
 *   start: 1000,
 *   end: 2000
 * })
 * return new Response(partial, {
 *   status: 206,
 *   headers: { 'Content-Range': 'bytes 1000-2000/10000' }
 * })
 *
 * // With abort support
 * const controller = new AbortController()
 * setTimeout(() => controller.abort(), 5000)
 * const stream = await createReadStream('/file.bin', {
 *   signal: controller.signal
 * })
 * ```
 */
export async function createReadStream(
  path: string,
  options?: ReadStreamOptions
): Promise<ReadableStream<Uint8Array>> {
  // Validate absolute path
  if (!path.startsWith('/')) {
    throw new EINVAL('createReadStream', path)
  }

  // Check for pre-aborted signal (fail fast)
  if (options?.signal?.aborted) {
    const error = new Error('The operation was aborted')
    error.name = 'AbortError'
    throw error
  }

  // Normalize path to handle //, ., and ..
  const normalizedPath = normalizePath(path)

  // Get entry from storage
  if (!storage) {
    throw new ENOENT('open', normalizedPath)
  }

  const entry = storage.get(normalizedPath)
  if (!entry) {
    throw new ENOENT('open', normalizedPath)
  }

  if (entry.isDirectory) {
    throw new EISDIR('read', normalizedPath)
  }

  // Parse and validate options
  const start = options?.start ?? 0
  const fileEnd = entry.content.length - 1
  // Clamp end to file boundary if specified beyond file size
  const end = options?.end !== undefined ? Math.min(options.end, fileEnd) : fileEnd
  const highWaterMark = options?.highWaterMark ?? DEFAULT_HIGH_WATER_MARK

  // Validate range (only for non-empty files)
  if (start > end && entry.content.length > 0) {
    throw new EINVAL('createReadStream', normalizedPath)
  }

  // Handle empty file case - return immediately closed stream
  if (entry.content.length === 0) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
  }

  // Create a view into the requested range using subarray (no copy yet)
  // This is a memory optimization - we only copy data when emitting chunks
  const data = entry.content.subarray(start, end + 1)
  let offset = 0
  const signal = options?.signal

  // Create ReadableStream with pull-based chunking for proper backpressure
  // The pull model ensures we only generate chunks when the consumer is ready
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      // Check abort signal - close gracefully if aborted
      if (signal?.aborted) {
        controller.close()
        return
      }

      // Check if we've read all data
      if (offset >= data.length) {
        controller.close()
        return
      }

      // Calculate chunk boundaries
      const chunkEnd = Math.min(offset + highWaterMark, data.length)

      // Create chunk as a copy using slice() - this is intentional
      // The consumer may hold onto the chunk, so we need to give them
      // an independent copy they can freely modify/retain
      const chunk = data.slice(offset, chunkEnd)
      offset = chunkEnd
      controller.enqueue(chunk)
    },

    cancel() {
      // Clean up on cancel
      // For in-memory data, nothing specific needed
      // Future: For R2 streams, we might need to abort the fetch
    },
  })
}
