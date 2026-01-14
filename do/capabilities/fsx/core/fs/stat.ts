/**
 * stat - Get file/directory metadata (follows symbolic links)
 *
 * Retrieves a Stats object containing metadata about a file, directory, or
 * the target of a symbolic link. Unlike lstat(), this function follows
 * symbolic links - if the path points to a symlink, the returned stats
 * describe the symlink's target, not the symlink itself.
 *
 * Key characteristics:
 * - **Follows symlinks**: Returns target stats, not symlink stats
 * - **Throws for broken symlinks**: ENOENT if symlink target doesn't exist
 * - **Normalizes paths**: Handles //, ./, ../, and trailing slashes
 * - **POSIX compatible**: Matches Node.js fs.stat() behavior
 *
 * @example
 * ```typescript
 * import { stat } from 'fsx.do/fs/stat'
 *
 * // Get file metadata
 * const stats = await stat('/home/user/document.txt')
 * console.log('Size:', stats.size)
 * console.log('Is file:', stats.isFile())
 * console.log('Modified:', stats.mtime)
 *
 * // Symlink behavior (stat follows links)
 * // Given: /link -> /actual/file.txt
 * const linkStats = await stat('/link')
 * console.log(linkStats.isFile())          // true (target's type)
 * console.log(linkStats.isSymbolicLink())  // false (followed the link)
 *
 * // Compare with lstat (doesn't follow links)
 * const lstatResult = await lstat('/link')
 * console.log(lstatResult.isSymbolicLink())  // true
 * ```
 *
 * @see {@link lstat} - Get stats without following symlinks
 * @see {@link Stats} - The Stats class returned by this function
 *
 * @module core/fs/stat
 */

import { Stats, type FileEntry } from '../types'
import { ENOENT, ENOTDIR } from '../errors'
import { normalize } from '../path'
import { buildStats } from './stats-builder'

// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Storage interface for stat operations.
 *
 * This interface abstracts the underlying storage mechanism, allowing stat
 * to work with different storage backends (in-memory, SQLite, Durable Objects).
 *
 * Unlike lstat's storage interface, stat requires symlink resolution
 * capability since it follows symbolic links to return target stats.
 *
 * @example
 * ```typescript
 * const storage: StatStorage = {
 *   get: (path) => db.getEntry(path),
 *   has: (path) => db.hasEntry(path),
 *   resolveSymlink: (path, maxDepth) => db.resolveSymlinkChain(path, maxDepth),
 * }
 * setStorage(storage)
 * ```
 */
export interface StatStorage {
  /**
   * Get entry by normalized path.
   *
   * This method does NOT follow symlinks - it returns the raw entry at the
   * specified path. Symlink resolution is handled separately via resolveSymlink.
   *
   * @param path - Normalized absolute path
   * @returns The FileEntry if it exists, undefined otherwise
   */
  get(path: string): FileEntry | undefined

  /**
   * Check if a path exists in storage.
   *
   * @param path - Normalized absolute path
   * @returns true if the path exists, false otherwise
   */
  has(path: string): boolean

  /**
   * Resolve a symlink chain to get the final target entry.
   *
   * This method should follow symlink chains up to maxDepth to prevent
   * infinite loops from circular symlinks. If the target doesn't exist
   * (broken symlink), return undefined.
   *
   * @param path - Path to the symlink to start resolution from
   * @param maxDepth - Maximum number of symlinks to follow (default: 40)
   * @returns The final target FileEntry, or undefined if:
   *          - The symlink is broken (target doesn't exist)
   *          - The chain exceeds maxDepth (circular reference)
   */
  resolveSymlink?(path: string, maxDepth?: number): FileEntry | undefined
}

// =============================================================================
// Storage Management
// =============================================================================

/**
 * Module-level storage instance.
 * Set via setStorage() during initialization or testing.
 */
let storage: StatStorage | null = null

/**
 * Set the storage backend for stat operations.
 *
 * This should be called during filesystem initialization or in test setup.
 * The storage implementation provides the actual file lookup and symlink
 * resolution mechanisms.
 *
 * @param s - Storage implementation, or null to clear
 *
 * @example
 * ```typescript
 * // Production setup
 * setStorage(new SqliteStorage(db))
 *
 * // Test setup with mock filesystem
 * setStorage({
 *   get: (path) => mockFs.get(path),
 *   has: (path) => mockFs.has(path),
 *   resolveSymlink: (path) => resolveChain(mockFs, path),
 * })
 *
 * // Cleanup
 * setStorage(null)
 * ```
 */
export function setStorage(s: StatStorage | null): void {
  storage = s
}

/**
 * Get the current storage backend.
 *
 * @returns Current storage instance, or null if not configured
 */
export function getStorage(): StatStorage | null {
  return storage
}

// =============================================================================
// Symlink Resolution
// =============================================================================

/**
 * Maximum depth for symlink resolution.
 * Matches POSIX ELOOP limit used by most Unix systems.
 */
const MAX_SYMLINK_DEPTH = 40

/**
 * Follow a symlink chain and return the final target entry.
 *
 * This function resolves symlink chains by following each link until
 * a non-symlink entry is reached. It handles:
 * - Absolute symlinks (target starts with '/')
 * - Relative symlinks (resolved relative to symlink's parent directory)
 * - Circular symlinks (detected via depth limit)
 *
 * @param startEntry - The initial symlink entry to start from
 * @param originalPath - The original path for error messages
 * @param maxDepth - Maximum symlinks to follow (default: 40)
 * @returns The final target FileEntry
 * @throws {ENOENT} If symlink chain is broken or exceeds max depth
 *
 * @internal
 */
function resolveSymlinkChain(
  startEntry: FileEntry,
  originalPath: string,
  maxDepth: number = MAX_SYMLINK_DEPTH
): FileEntry {
  if (!storage) {
    throw new ENOENT('stat', originalPath)
  }

  let current = startEntry
  let depth = 0

  while (current.type === 'symlink' && current.linkTarget) {
    if (depth >= maxDepth) {
      // Too many levels of symbolic links (ELOOP-like behavior)
      // For stat, we throw ENOENT since we can't reach the target
      throw new ENOENT('stat', originalPath)
    }

    // Resolve relative vs absolute symlink target
    let targetPath = current.linkTarget
    if (!targetPath.startsWith('/')) {
      // Relative symlink - resolve relative to symlink's parent
      const parentDir = current.path.substring(0, current.path.lastIndexOf('/')) || '/'
      targetPath = normalize(parentDir + '/' + targetPath)
    } else {
      targetPath = normalize(targetPath)
    }

    // Try storage's built-in resolver first (more efficient)
    if (storage.resolveSymlink) {
      const resolved = storage.resolveSymlink(current.path, maxDepth - depth)
      if (!resolved) {
        throw new ENOENT('stat', originalPath)
      }
      return resolved
    }

    // Fallback: manual lookup
    const target = storage.get(targetPath)
    if (!target) {
      // Broken symlink
      throw new ENOENT('stat', originalPath)
    }

    current = target
    depth++
  }

  return current
}

// =============================================================================
// Main stat Function
// =============================================================================

/**
 * Get file status (follows symbolic links).
 *
 * Returns a Stats object containing metadata about the file, directory,
 * or symlink target at the specified path. This function follows symbolic
 * links - for symlink metadata itself, use lstat() instead.
 *
 * The returned Stats object provides:
 * - **Type checking**: isFile(), isDirectory(), isSymbolicLink(), etc.
 * - **Size info**: size (bytes), blksize (block size), blocks (512-byte blocks)
 * - **Timestamps**: atime, mtime, ctime, birthtime (as Date objects)
 * - **Timestamp ms**: atimeMs, mtimeMs, ctimeMs, birthtimeMs
 * - **Ownership**: uid (user ID), gid (group ID)
 * - **Permissions**: mode (includes file type and permission bits)
 * - **Links**: nlink (hard link count), ino (inode number), dev (device ID)
 *
 * @param path - Path to file, directory, or symlink (follows symlinks)
 * @returns Promise resolving to Stats object with file metadata
 *
 * @throws {ENOENT} If path does not exist (errno: -2)
 * @throws {ENOENT} If symlink target does not exist (broken symlink)
 * @throws {ENOTDIR} If path ends with '/' but target is not a directory
 *
 * @example
 * ```typescript
 * // Basic usage
 * const stats = await stat('/home/user/file.txt')
 * console.log(`Size: ${stats.size} bytes`)
 * console.log(`Modified: ${stats.mtime}`)
 *
 * // Type checking
 * if (stats.isFile()) {
 *   console.log('Regular file')
 * } else if (stats.isDirectory()) {
 *   console.log('Directory')
 * }
 *
 * // Permission checking
 * const isReadable = (stats.mode & 0o444) !== 0
 * console.log(`Readable: ${isReadable}`)
 *
 * // Symlink handling (stat follows links)
 * const symlinkStats = await stat('/path/to/symlink')
 * console.log(symlinkStats.isSymbolicLink())  // false (followed to target)
 * ```
 *
 * @see {@link lstat} - Get stats without following symlinks
 * @see {@link Stats} - The Stats class with type checking methods
 */
export async function stat(path: string): Promise<Stats> {
  // Track trailing slash before normalization (POSIX semantics)
  // A trailing slash means "this must be a directory"
  const hadTrailingSlash = path.length > 1 && path.endsWith('/')

  // Normalize path: resolve //, ./, ../, remove trailing slash
  const normalizedPath = normalize(path)

  // Verify storage is configured
  if (!storage) {
    throw new ENOENT('stat', normalizedPath)
  }

  // Look up the raw entry (doesn't follow symlinks)
  const entry = storage.get(normalizedPath)

  if (!entry) {
    throw new ENOENT('stat', normalizedPath)
  }

  // Follow symlinks to get target entry
  let targetEntry = entry
  if (entry.type === 'symlink') {
    targetEntry = resolveSymlinkChain(entry, normalizedPath)
  }

  // Trailing slash requires target to be a directory
  if (hadTrailingSlash && targetEntry.type !== 'directory') {
    throw new ENOTDIR('stat', normalizedPath)
  }

  // Build and return Stats object using shared utility
  return buildStats(targetEntry)
}

// =============================================================================
// Re-exports for backward compatibility
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
