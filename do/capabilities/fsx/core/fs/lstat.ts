/**
 * lstat - Get file/directory metadata WITHOUT following symbolic links
 *
 * Unlike stat(), lstat() returns information about the symlink itself,
 * not the file or directory it points to. This is the key difference:
 *
 * - stat('/link') where link->file: returns file's stats, isFile()=true
 * - lstat('/link') where link->file: returns link's stats, isSymbolicLink()=true
 *
 * Key characteristics:
 * - **Does NOT follow symlinks**: Returns symlink's own stats
 * - **Works with broken symlinks**: Can stat a symlink even if target missing
 * - **Normalizes paths**: Handles //, ./, ../, and trailing slashes
 * - **POSIX compatible**: Matches Node.js fs.lstat() behavior
 *
 * This is useful for:
 * - Detecting symbolic links without following them
 * - Getting symlink metadata (size is target path length)
 * - Working with potentially broken symlinks
 * - Implementing file tree traversal that handles symlinks safely
 *
 * @example
 * ```typescript
 * import { lstat } from 'fsx.do/fs/lstat'
 *
 * // Check if path is a symlink
 * const stats = await lstat('/path/to/possible/link')
 * if (stats.isSymbolicLink()) {
 *   console.log('Path is a symbolic link')
 *   console.log('Target path length:', stats.size)
 * }
 *
 * // Works on broken symlinks (unlike stat())
 * const brokenStats = await lstat('/path/to/broken/link')
 * console.log('Broken symlink exists:', brokenStats.isSymbolicLink())
 * ```
 *
 * @see {@link stat} - Get stats following symbolic links
 * @see {@link Stats} - The Stats class with type checking methods
 *
 * @module core/fs/lstat
 */

import { Stats, type FileEntry } from '../types'
import { ENOENT } from '../errors'
import { normalize } from '../path'
import { buildStats } from './stats-builder'

// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Storage interface for lstat operation.
 *
 * This interface abstracts the underlying storage mechanism, allowing lstat
 * to work with different storage backends (in-memory, SQLite, Durable Objects).
 *
 * Unlike stat's storage interface, lstat does NOT require symlink resolution
 * since it explicitly does not follow symlinks.
 *
 * @example
 * ```typescript
 * const storage: LstatStorage = {
 *   get: (path) => database.getEntry(path),
 *   has: (path) => database.exists(path),
 * }
 * setStorage(storage)
 * ```
 */
export interface LstatStorage {
  /**
   * Get entry by normalized path.
   *
   * This should return the raw entry at the path WITHOUT following symlinks.
   * For symlinks, return the symlink entry itself, not its target.
   *
   * @param path - Normalized absolute path
   * @returns FileEntry if exists, undefined otherwise
   */
  get(path: string): FileEntry | undefined

  /**
   * Check if path exists in storage.
   *
   * @param path - Normalized absolute path
   * @returns true if path exists, false otherwise
   */
  has(path: string): boolean
}

// =============================================================================
// Storage Management
// =============================================================================

/**
 * Module-level storage instance.
 * Set via setStorage() for testing or when initializing the filesystem.
 */
let storage: LstatStorage | null = null

/**
 * Set the storage backend for lstat operations.
 *
 * This should be called during filesystem initialization or in test setup.
 * The storage implementation provides the actual file lookup mechanism.
 *
 * @param s - Storage implementation, or null to clear
 *
 * @example
 * ```typescript
 * // Set up storage for testing
 * setStorage({
 *   get: (path) => mockFileSystem.get(path),
 *   has: (path) => mockFileSystem.has(path),
 * })
 *
 * // Clear storage after tests
 * setStorage(null)
 * ```
 */
export function setStorage(s: LstatStorage | null): void {
  storage = s
}

/**
 * Get the current storage backend.
 *
 * @returns Current storage instance, or null if not configured
 */
export function getStorage(): LstatStorage | null {
  return storage
}

// =============================================================================
// Main lstat Function
// =============================================================================

/**
 * Get file status without following symbolic links.
 *
 * Returns a Stats object containing metadata about the file, directory, or
 * symlink at the specified path. Unlike stat(), this function does NOT follow
 * symbolic links - if the path points to a symlink, the returned stats
 * describe the symlink itself, not its target.
 *
 * This is particularly useful when you need to:
 * - Detect whether a path is a symbolic link
 * - Get metadata about the link itself (not the target)
 * - Work with potentially broken symlinks (lstat succeeds even if target missing)
 * - Implement safe directory traversal that doesn't follow symlinks
 *
 * The returned Stats object provides:
 * - **Type checking**: isFile(), isDirectory(), isSymbolicLink(), etc.
 * - **Size info**: For symlinks, this is the byte length of the target path
 * - **Timestamps**: atime, mtime, ctime, birthtime (link's own timestamps)
 * - **Ownership**: uid (user ID), gid (group ID)
 * - **Permissions**: mode (includes file type and permission bits)
 * - **Links**: nlink (hard link count), ino (inode number), dev (device ID)
 *
 * @param path - Path to file, directory, or symlink (does NOT follow symlinks)
 * @returns Promise resolving to Stats object with file metadata
 *
 * @throws {ENOENT} If path does not exist (errno: -2)
 *   - Note: Does NOT throw ENOENT for broken symlinks (can stat the link itself)
 *
 * @example
 * ```typescript
 * // Basic usage - get stats for any path
 * const stats = await lstat('/home/user/file.txt')
 * console.log('Size:', stats.size)
 * console.log('Is file:', stats.isFile())
 *
 * // Check if path is a symlink
 * const linkStats = await lstat('/home/user/link')
 * if (linkStats.isSymbolicLink()) {
 *   console.log('This is a symlink!')
 *   console.log('Target path length:', linkStats.size)
 * }
 *
 * // Works on broken symlinks (unlike stat())
 * try {
 *   const brokenLinkStats = await lstat('/path/to/broken/link')
 *   console.log('Broken link exists:', brokenLinkStats.isSymbolicLink())
 * } catch (e) {
 *   // Only throws if the symlink itself doesn't exist
 * }
 *
 * // Compare with stat() behavior:
 * // - stat('/link')  -> follows link, returns target's stats
 * // - lstat('/link') -> returns link's stats, isSymbolicLink()=true
 * ```
 *
 * @see {@link stat} - To get stats following symbolic links
 * @see {@link Stats} - The Stats class with type checking methods
 */
export async function lstat(path: string): Promise<Stats> {
  // Normalize path (handle //, ./, ../, trailing slashes)
  const normalizedPath = normalize(path)

  // Verify storage is configured
  if (!storage) {
    throw new ENOENT('lstat', normalizedPath)
  }

  // Look up entry WITHOUT following symlinks
  // This is the key difference from stat()
  const entry = storage.get(normalizedPath)

  // If path doesn't exist, throw ENOENT
  if (!entry) {
    throw new ENOENT('lstat', normalizedPath)
  }

  // Build and return Stats object using shared utility
  // Note: We do NOT resolve symlinks here - that's the whole point of lstat
  return buildStats(entry)
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

// Re-export stats building utilities for consumers who need them
export {
  buildStats,
  buildMode,
  computeInode,
  FILE_TYPE_FLAGS,
  VIRTUAL_DEV_ID,
  DEFAULT_BLOCK_SIZE,
  calculateBlocks,
  toBigIntTimestamps,
} from './stats-builder'
export type { BuildStatsOptions, BigIntTimestamps } from './stats-builder'
