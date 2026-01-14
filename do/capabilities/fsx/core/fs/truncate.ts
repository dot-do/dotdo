/**
 * truncate - Change the size of a file
 *
 * Truncates a file to the specified length. This operation can either:
 * - **Shorten** the file if length < current size (data beyond length is lost)
 * - **Extend** the file if length > current size (extended region is zero-filled)
 * - **No-op** if length === current size (early return for efficiency)
 *
 * POSIX semantics:
 * - File must exist (throws ENOENT otherwise)
 * - Cannot truncate directories (throws EISDIR)
 * - Length must be non-negative (throws EINVAL)
 * - File metadata (mode, birthtime) is preserved
 * - Modification time (mtime) is updated
 *
 * @example
 * ```typescript
 * import { truncate } from 'fsx/fs/truncate'
 *
 * // Empty a file
 * await truncate(storage, '/path/to/file.txt')
 *
 * // Truncate to 100 bytes
 * await truncate(storage, '/path/to/file.txt', 100)
 *
 * // Extend a file (zero-fills the extension)
 * await truncate(storage, '/path/to/small.txt', 1000)
 * ```
 *
 * @module core/fs/truncate
 */

import { ENOENT, EISDIR, EINVAL } from '../errors'
import { normalize } from '../path'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * File metadata structure returned by storage.
 *
 * Contains the essential POSIX file attributes needed for truncate operations.
 */
export interface FileMetadata {
  /** File permission mode (e.g., 0o644) */
  mode: number

  /** Last modification time (milliseconds since epoch) */
  mtime: number

  /** File creation time (milliseconds since epoch) */
  birthtime: number

  /** Last change time (milliseconds since epoch) */
  ctime: number
}

/**
 * File entry returned by storage.getFile().
 *
 * Represents a file in the virtual filesystem with its content and metadata.
 */
export interface FileEntry {
  /** Raw file content as a byte array */
  content: Uint8Array

  /** File metadata (mode, timestamps) */
  metadata: FileMetadata
}

/**
 * Storage interface for truncate operations.
 *
 * This interface abstracts the underlying storage mechanism, allowing truncate
 * to work with different backends (in-memory, SQLite, Durable Objects, etc.).
 *
 * Required methods:
 * - getFile: Retrieve file content and metadata
 * - addFile: Create or update a file (used for atomic updates)
 * - isDirectory: Check if path is a directory
 *
 * Optional methods:
 * - updateFile: Update only file content (may be more efficient)
 */
export interface TruncateStorage {
  /**
   * Get a file by path.
   *
   * @param path - Normalized absolute path to the file
   * @returns File entry with content and metadata, or undefined if not found
   */
  getFile(path: string): FileEntry | undefined

  /**
   * Create or update a file.
   *
   * This method is used to atomically update the file with new content
   * while preserving specified metadata fields.
   *
   * @param path - Normalized absolute path to the file
   * @param content - New file content
   * @param metadata - Optional metadata to preserve (mode, birthtime)
   */
  addFile(
    path: string,
    content: Uint8Array,
    metadata?: { mode?: number; birthtime?: number }
  ): void

  /**
   * Check if a path is a directory.
   *
   * @param path - Normalized absolute path to check
   * @returns true if path is a directory, false otherwise
   */
  isDirectory(path: string): boolean

  /**
   * Update file content in-place (optional optimization).
   *
   * Some storage backends may implement this for more efficient
   * content-only updates without metadata recreation.
   *
   * @param path - Normalized absolute path to the file
   * @param content - New file content
   */
  updateFile?(path: string, content: Uint8Array): void
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Truncate a file to the specified length.
 *
 * Changes the size of the file at `path` to exactly `length` bytes.
 * If the file is larger than `length`, the extra data is lost.
 * If the file is smaller, it is extended with null bytes ('\0').
 *
 * This function optimizes for the common case where length equals
 * the current file size by returning early without any I/O.
 *
 * @param storage - Storage backend implementing TruncateStorage interface
 * @param path - Path to the file to truncate (will be normalized)
 * @param length - Desired file size in bytes (default: 0)
 *
 * @returns Promise that resolves to undefined on success
 *
 * @throws {EINVAL} If length is negative (errno: -22)
 * @throws {EISDIR} If path is a directory (errno: -21)
 * @throws {ENOENT} If file does not exist (errno: -2)
 *
 * @example
 * ```typescript
 * // Truncate file to empty (0 bytes)
 * await truncate(storage, '/logs/old.log')
 *
 * // Truncate to specific size
 * await truncate(storage, '/data/fixed.bin', 1024)
 *
 * // Error handling
 * try {
 *   await truncate(storage, '/missing.txt', 0)
 * } catch (err) {
 *   if (err.code === 'ENOENT') {
 *     console.log('File not found:', err.path)
 *   }
 * }
 * ```
 */
export async function truncate(
  storage: TruncateStorage,
  path: string,
  length: number = 0
): Promise<void> {
  // Step 1: Normalize the path to handle //, ./, ../ etc.
  const normalizedPath = normalize(path)

  // Step 2: Validate length parameter (must be non-negative)
  // Check this early before any I/O operations
  if (length < 0) {
    throw new EINVAL('truncate', normalizedPath)
  }

  // Step 3: Check for root directory (cannot truncate root)
  if (normalizedPath === '/') {
    throw new EISDIR('truncate', normalizedPath)
  }

  // Step 4: Check if path is a directory (directories cannot be truncated)
  if (storage.isDirectory(normalizedPath)) {
    throw new EISDIR('truncate', normalizedPath)
  }

  // Step 5: Get the existing file
  const existingFile = storage.getFile(normalizedPath)
  if (existingFile === undefined) {
    throw new ENOENT('truncate', normalizedPath)
  }

  // Step 6: Optimization - early return if length is unchanged
  const currentLength = existingFile.content.length
  if (length === currentLength) {
    return
  }

  // Step 7: Create new content with the target length
  const newContent = createTruncatedContent(existingFile.content, length)

  // Step 8: Update the file, preserving birthtime and mode
  storage.addFile(normalizedPath, newContent, {
    mode: existingFile.metadata.mode,
    birthtime: existingFile.metadata.birthtime,
  })
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Create new content with the specified target length.
 *
 * Handles both truncation (slicing) and extension (zero-filling).
 *
 * @param originalContent - Original file content
 * @param targetLength - Desired content length
 * @returns New Uint8Array with the target length
 *
 * @internal
 */
function createTruncatedContent(
  originalContent: Uint8Array,
  targetLength: number
): Uint8Array {
  const currentLength = originalContent.length

  if (targetLength < currentLength) {
    // Truncate: take only the first `targetLength` bytes
    // slice() creates a new array, not a view
    return originalContent.slice(0, targetLength)
  } else {
    // Extend: create new array and zero-fill the extension
    // Uint8Array is zero-initialized by default
    const newContent = new Uint8Array(targetLength)
    newContent.set(originalContent)
    return newContent
  }
}
