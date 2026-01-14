/**
 * createWriteStream - Create a writable stream for file uploads
 *
 * This module implements Node.js-compatible streaming file writes using the
 * Web Streams API (WHATWG Streams Standard). It provides efficient streaming
 * writes with proper abort handling, suitable for large file uploads.
 *
 * Key features:
 * - Push-based streaming with configurable part sizes
 * - Support for write modes: w (overwrite), a (append), wx (exclusive), ax (exclusive append)
 * - Creates files that don't exist
 * - Abort signal support for cancellation
 * - Content type detection from file extension
 * - Memory-efficient: chunks are buffered and written on close
 *
 * @module fs/createWriteStream
 */

import { ENOENT, EISDIR, EEXIST, EINVAL } from '../errors'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for createWriteStream.
 *
 * These options control how the file is written, including write modes,
 * start position, file permissions, and abort handling.
 *
 * @example
 * ```typescript
 * // Overwrite file (default)
 * const stream = await createWriteStream('/file.txt')
 *
 * // Append to file
 * const append = await createWriteStream('/file.txt', { flags: 'a' })
 *
 * // Exclusive write (fail if exists)
 * const exclusive = await createWriteStream('/file.txt', { flags: 'wx' })
 *
 * // With abort support
 * const controller = new AbortController()
 * const stream = await createWriteStream('/file.txt', {
 *   signal: controller.signal
 * })
 * // Later: controller.abort()
 * ```
 */
export interface WriteStreamOptions {
  /** Start position for writing, default: 0 (overwrite) */
  start?: number
  /** File flags ('w' for write, 'a' for append, 'wx'/'ax' for exclusive) */
  flags?: 'w' | 'a' | 'wx' | 'ax'
  /** File mode (permissions), default: 0o644 */
  mode?: number
  /** Content type for R2 metadata */
  contentType?: string
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Chunk size for multipart upload, default: 5MB */
  partSize?: number
}

/**
 * Storage interface for createWriteStream.
 *
 * This abstraction allows createWriteStream to work with different
 * storage backends (in-memory for testing, SQLite for hot tier,
 * R2 for warm/cold tiers).
 */
export interface CreateWriteStreamStorage {
  /**
   * Check if parent directory exists.
   * @param path - Absolute file path
   * @returns true if parent directory exists
   */
  parentExists(path: string): boolean

  /**
   * Check if path is a directory.
   * @param path - Absolute file path
   * @returns true if path is a directory
   */
  isDirectory(path: string): boolean

  /**
   * Check if path exists.
   * @param path - Absolute file path
   * @returns true if path exists
   */
  exists(path: string): boolean

  /**
   * Get file content and metadata.
   * @param path - Absolute file path
   * @returns File content and metadata, or undefined if not found
   */
  getFile(path: string): { content: Uint8Array; metadata: { mode: number } } | undefined

  /**
   * Write file content.
   * @param path - Absolute file path
   * @param data - File content
   * @param options - Write options (mode, contentType)
   */
  writeFile(path: string, data: Uint8Array, options?: { mode?: number; contentType?: string }): Promise<void>
}

// =============================================================================
// Module State
// =============================================================================

/** Module-level storage backend (set via setStorage for testing) */
let storage: CreateWriteStreamStorage | null = null

/**
 * Set the storage backend for createWriteStream.
 *
 * This is primarily used for testing to inject mock storage.
 * In production, the storage is typically set by the filesystem
 * module during initialization.
 *
 * @param s - Storage backend implementation, or null to clear
 */
export function setStorage(s: CreateWriteStreamStorage | null): void {
  storage = s
}

/**
 * Get the current storage backend.
 *
 * @returns Current storage backend, or null if not set
 */
export function getStorage(): CreateWriteStreamStorage | null {
  return storage
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Default file mode: 0o644 (rw-r--r--)
 */
const DEFAULT_MODE = 0o644

/**
 * Content type mapping by extension
 */
const CONTENT_TYPE_MAP: Record<string, string> = {
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.bin': 'application/octet-stream',
  '.sh': 'application/x-sh',
}

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

/**
 * Get content type from file extension.
 *
 * @param path - File path
 * @returns Content type string or undefined
 *
 * @internal
 */
function getContentTypeFromExtension(path: string): string | undefined {
  const lastDotIndex = path.lastIndexOf('.')
  if (lastDotIndex === -1) {
    return undefined
  }
  const ext = path.substring(lastDotIndex).toLowerCase()
  return CONTENT_TYPE_MAP[ext]
}

/**
 * Concatenate multiple Uint8Arrays into a single array.
 *
 * @param arrays - Arrays to concatenate
 * @returns Combined Uint8Array
 *
 * @internal
 */
function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// =============================================================================
// Main Implementation
// =============================================================================

/**
 * Create a writable stream for a file.
 *
 * This function implements Node.js-compatible streaming file writes using the
 * Web Streams API. It supports:
 * - Write modes: w (overwrite), a (append), wx (exclusive), ax (exclusive append)
 * - File creation if it doesn't exist
 * - Configurable file permissions (mode)
 * - Content type detection from extension
 * - AbortSignal for cancellation
 *
 * Memory notes:
 * - Chunks are buffered until the stream is closed
 * - For very large files, consider using multipart upload (future feature)
 *
 * @param path - Absolute path to the file (must start with '/')
 * @param options - Stream options for write mode, permissions, and cancellation
 * @returns A WritableStream of Uint8Array chunks
 *
 * @throws {ENOENT} If parent directory does not exist
 * @throws {EISDIR} If path is a directory
 * @throws {EEXIST} If file exists and flags is 'wx' or 'ax'
 * @throws {EINVAL} If path is relative
 *
 * @example
 * ```typescript
 * // Basic usage - write to file
 * const stream = await createWriteStream('/data/file.txt')
 * const writer = stream.getWriter()
 * await writer.write(new TextEncoder().encode('Hello, World!'))
 * await writer.close()
 *
 * // Append mode
 * const append = await createWriteStream('/data/log.txt', { flags: 'a' })
 * const writer = append.getWriter()
 * await writer.write(new TextEncoder().encode('New log entry\n'))
 * await writer.close()
 *
 * // Exclusive write (fail if exists)
 * const exclusive = await createWriteStream('/data/new.txt', { flags: 'wx' })
 *
 * // With abort support
 * const controller = new AbortController()
 * const stream = await createWriteStream('/file.txt', {
 *   signal: controller.signal
 * })
 * // Later: controller.abort()
 * ```
 */
export async function createWriteStream(
  path: string,
  options?: WriteStreamOptions
): Promise<WritableStream<Uint8Array>> {
  // Validate absolute path
  if (!path.startsWith('/')) {
    throw new EINVAL('open', path)
  }

  // Check for pre-aborted signal (fail fast)
  if (options?.signal?.aborted) {
    const error = new Error('The operation was aborted')
    error.name = 'AbortError'
    throw error
  }

  // Normalize path to handle //, ., and ..
  const normalizedPath = normalizePath(path)

  // Check storage is available
  if (!storage) {
    throw new ENOENT('open', normalizedPath)
  }

  // Check parent directory exists
  if (!storage.parentExists(normalizedPath)) {
    throw new ENOENT('open', normalizedPath)
  }

  // Check if path is a directory
  if (storage.isDirectory(normalizedPath)) {
    throw new EISDIR('open', normalizedPath)
  }

  // Parse flags
  const flags = options?.flags ?? 'w'
  const isAppend = flags === 'a' || flags === 'ax'
  const isExclusive = flags === 'wx' || flags === 'ax'

  // Check exclusive write - fail if file exists
  if (isExclusive && storage.exists(normalizedPath)) {
    throw new EEXIST('open', normalizedPath)
  }

  // Get options
  const mode = options?.mode ?? DEFAULT_MODE
  const contentType = options?.contentType ?? getContentTypeFromExtension(normalizedPath)
  const signal = options?.signal
  const startPosition = options?.start ?? 0

  // Get existing file content for append mode or start position
  let existingContent: Uint8Array | undefined
  if (isAppend || startPosition > 0) {
    const existingFile = storage.getFile(normalizedPath)
    if (existingFile) {
      existingContent = existingFile.content
    }
  }

  // Buffer for collecting chunks
  const chunks: Uint8Array[] = []
  let aborted = false

  // Set up abort listener
  const abortHandler = () => {
    aborted = true
  }
  signal?.addEventListener('abort', abortHandler)

  // Create WritableStream
  return new WritableStream<Uint8Array>({
    write(chunk): void | Promise<void> {
      // Check if aborted
      if (aborted || signal?.aborted) {
        return Promise.reject(new Error('Write aborted'))
      }

      // Add chunk to buffer
      chunks.push(chunk)
      return undefined
    },

    async close() {
      // Remove abort listener
      signal?.removeEventListener('abort', abortHandler)

      // Check if aborted
      if (aborted || signal?.aborted) {
        return
      }

      // Combine all chunks
      let finalContent: Uint8Array

      if (isAppend && existingContent) {
        // Append mode: prepend existing content
        const newContent = concatUint8Arrays(chunks)
        finalContent = concatUint8Arrays([existingContent, newContent])
      } else if (startPosition > 0 && existingContent) {
        // Start position mode: write at specific position
        const newContent = concatUint8Arrays(chunks)
        const totalLength = Math.max(startPosition + newContent.length, existingContent?.length ?? 0)
        finalContent = new Uint8Array(totalLength)

        // Copy existing content
        if (existingContent) {
          finalContent.set(existingContent)
        }

        // Write new content at start position
        finalContent.set(newContent, startPosition)
      } else if (startPosition > 0) {
        // Start position with no existing file - pad with zeros
        const newContent = concatUint8Arrays(chunks)
        finalContent = new Uint8Array(startPosition + newContent.length)
        finalContent.set(newContent, startPosition)
      } else {
        // Normal write mode
        finalContent = concatUint8Arrays(chunks)
      }

      // Write to storage
      await storage!.writeFile(normalizedPath, finalContent, {
        mode,
        contentType,
      })
    },

    abort() {
      // Clean up on abort
      signal?.removeEventListener('abort', abortHandler)
      aborted = true
      chunks.length = 0
    },
  })
}
