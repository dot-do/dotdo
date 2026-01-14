/**
 * @fileoverview Hard link creation (POSIX link syscall)
 *
 * Creates a hard link to an existing file. Both paths will refer to the same
 * inode, sharing the same content and metadata. Changes via one path are
 * immediately visible via the other.
 *
 * POSIX Semantics:
 * - Hard links share the same inode (same file data)
 * - Changes through any link affect all links
 * - File data persists until all links are removed (nlink reaches 0)
 * - Cannot hard link directories (prevents cycles in directory tree)
 * - Cannot hard link special paths (., .., /)
 *
 * Constraints:
 * - Source must exist (ENOENT)
 * - Source must not be a directory (EPERM)
 * - Destination must not exist (EEXIST)
 * - Destination parent directory must exist (ENOENT)
 *
 * @example
 * ```typescript
 * // Create a hard link
 * await link(fs, '/home/user/original.txt', '/home/user/backup.txt')
 *
 * // Both paths now refer to the same inode
 * // nlink count is incremented to 2
 * // Deleting original.txt leaves backup.txt intact
 * ```
 *
 * @module core/fs/link
 * @see {@link https://man7.org/linux/man-pages/man2/link.2.html} POSIX link(2)
 */

import { ENOENT, EEXIST, EPERM } from '../errors'

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * System call name for error reporting.
 * Used consistently in all error messages for this operation.
 */
const SYSCALL = 'link'

/**
 * Special path components that cannot be hard linked.
 * These represent directory navigation rather than actual files.
 */
const SPECIAL_BASENAMES = new Set(['.', '..'])

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Filesystem entry representing a file or directory.
 *
 * Contains the inode number, file content, link count, and type information.
 * Multiple directory entries (hard links) can point to the same entry object,
 * sharing the underlying data.
 *
 * @property ino - Unique inode number identifying this file's data
 * @property content - Raw file content as bytes
 * @property nlink - Number of directory entries pointing to this inode
 * @property isDirectory - Whether this entry represents a directory
 */
export interface FileEntry {
  /** Unique inode number for this file's data */
  readonly ino: number
  /** Raw file content as a byte array */
  content: Uint8Array
  /** Hard link count - number of paths referencing this inode */
  nlink: number
  /** True if this entry is a directory */
  readonly isDirectory: boolean
}

/**
 * Filesystem context interface for link operations.
 *
 * Provides the minimal interface required for creating hard links.
 * In production, this is backed by SQLite storage; in tests, by in-memory Maps.
 *
 * @example
 * ```typescript
 * const fs: LinkFS = {
 *   files: new Map(),
 *   inodes: new Map(),
 *   exists: (path) => files.has(path)
 * }
 * ```
 */
export interface LinkFS {
  /**
   * Map of normalized paths to their file entries.
   * Multiple paths can map to the same entry (hard links).
   */
  files: Map<string, FileEntry>

  /**
   * Map of inode numbers to their file entries.
   * Used for inode-level operations and reference counting.
   */
  inodes: Map<number, FileEntry>

  /**
   * Check if a path exists in the filesystem.
   *
   * @param path - Normalized path to check
   * @returns True if the path exists (file, directory, or symlink)
   */
  exists(path: string): boolean
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Check if a path is a special path that cannot be hard linked.
 *
 * Special paths include:
 * - Root directory (/)
 * - Current directory (.)
 * - Parent directory (..)
 *
 * @param path - The path to validate
 * @returns True if the path is a special path
 *
 * @internal
 */
function isSpecialPath(path: string): boolean {
  // Root directory cannot be hard linked
  if (path === '/') {
    return true
  }

  // Check basename for . or ..
  const lastSlashIndex = path.lastIndexOf('/')
  const basename = lastSlashIndex >= 0 ? path.slice(lastSlashIndex + 1) : path

  return SPECIAL_BASENAMES.has(basename)
}

/**
 * Extract the parent directory path from a given path.
 *
 * @param path - The path to extract the parent from
 * @returns The parent directory path, or '/' for root-level paths
 *
 * @example
 * ```typescript
 * getParentDirectory('/home/user/file.txt')  // '/home/user'
 * getParentDirectory('/file.txt')             // '/'
 * getParentDirectory('file.txt')              // '/'
 * ```
 *
 * @internal
 */
function getParentDirectory(path: string): string {
  const lastSlashIndex = path.lastIndexOf('/')
  if (lastSlashIndex <= 0) {
    return '/'
  }
  return path.slice(0, lastSlashIndex)
}

/**
 * Validate the source path for hard link creation.
 *
 * Performs all validation checks on the source path:
 * - Not a special path (., .., /)
 * - Path exists in the filesystem
 * - Path is not a directory
 *
 * @param fs - Filesystem context
 * @param existingPath - Source path to validate
 * @returns The validated source file entry
 * @throws {EPERM} If path is a special path or a directory
 * @throws {ENOENT} If path does not exist
 *
 * @internal
 */
function validateSource(fs: LinkFS, existingPath: string): FileEntry {
  // Special paths cannot be hard linked
  if (isSpecialPath(existingPath)) {
    throw new EPERM(SYSCALL, existingPath)
  }

  // Source must exist
  if (!fs.exists(existingPath)) {
    throw new ENOENT(SYSCALL, existingPath)
  }

  // Get the source entry (double-check existence via Map)
  const sourceEntry = fs.files.get(existingPath)
  if (!sourceEntry) {
    throw new ENOENT(SYSCALL, existingPath)
  }

  // Directories cannot have hard links (prevents cycles in directory tree)
  if (sourceEntry.isDirectory) {
    throw new EPERM(SYSCALL, existingPath)
  }

  return sourceEntry
}

/**
 * Validate the destination path for hard link creation.
 *
 * Performs all validation checks on the destination path:
 * - Path does not already exist
 * - Parent directory exists
 *
 * @param fs - Filesystem context
 * @param newPath - Destination path to validate
 * @throws {EEXIST} If destination already exists
 * @throws {ENOENT} If destination parent directory does not exist
 *
 * @internal
 */
function validateDestination(fs: LinkFS, newPath: string): void {
  // Destination must not exist
  if (fs.exists(newPath)) {
    throw new EEXIST(SYSCALL, newPath)
  }

  // Parent directory must exist
  const parentPath = getParentDirectory(newPath)
  if (parentPath !== '/' && !fs.exists(parentPath)) {
    throw new ENOENT(SYSCALL, newPath)
  }
}

// =============================================================================
// MAIN IMPLEMENTATION
// =============================================================================

/**
 * Create a hard link to an existing file.
 *
 * Creates a new directory entry at `newPath` that references the same inode
 * as `existingPath`. Both paths will share the same file data and metadata.
 * The link count (nlink) on the inode is incremented.
 *
 * Hard links provide:
 * - Multiple paths to the same file data
 * - Space-efficient file duplication (no data copy)
 * - File persistence until all links are removed
 *
 * Limitations:
 * - Cannot link across filesystem boundaries (handled at higher level)
 * - Cannot link directories (prevents cycles)
 * - Cannot link special paths (., .., /)
 *
 * @param fs - Filesystem context providing file storage
 * @param existingPath - Path to the source file (must exist)
 * @param newPath - Path for the new hard link (must not exist)
 * @returns Promise that resolves when the link is created
 *
 * @throws {ENOENT} Source file does not exist
 * @throws {ENOENT} Destination parent directory does not exist
 * @throws {EEXIST} Destination path already exists
 * @throws {EPERM} Source is a directory (hard linking directories not allowed)
 * @throws {EPERM} Source is a special path (., .., /)
 *
 * @example Create a hard link
 * ```typescript
 * // Original file with nlink=1
 * await link(fs, '/data/original.txt', '/data/backup.txt')
 * // Now both paths point to same inode with nlink=2
 * ```
 *
 * @example Hard links persist data
 * ```typescript
 * await link(fs, '/file.txt', '/link.txt')
 * fs.deleteFile('/file.txt')  // nlink decrements to 1
 * // /link.txt still exists with all data intact
 * ```
 *
 * @example Error handling
 * ```typescript
 * try {
 *   await link(fs, '/missing.txt', '/link.txt')
 * } catch (err) {
 *   if (err instanceof ENOENT) {
 *     console.log('Source not found:', err.path)
 *   }
 * }
 * ```
 *
 * @see unlink - Remove a hard link
 * @see symlink - Create a symbolic link (different semantics)
 */
export async function link(
  fs: LinkFS,
  existingPath: string,
  newPath: string
): Promise<void> {
  // Step 1: Validate source path and get entry
  const sourceEntry = validateSource(fs, existingPath)

  // Step 2: Validate destination path
  validateDestination(fs, newPath)

  // Step 3: Create the hard link
  // Add new directory entry pointing to the same file entry object
  // Since both map entries reference the same object, all metadata
  // (including nlink) is automatically shared
  fs.files.set(newPath, sourceEntry)

  // Step 4: Increment link count
  // This update is reflected in both paths since they share the same object
  sourceEntry.nlink++
}
