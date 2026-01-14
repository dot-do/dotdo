/**
 * @fileoverview utimes - Update file access and modification times
 *
 * Changes the access time (atime) and modification time (mtime) of a file or
 * directory following POSIX semantics with support for symlink handling.
 *
 * @module fsx/fs/utimes
 *
 * @description
 * Provides `utimes` and `lutimes` functions for updating file timestamps.
 * Supports multiple timestamp input formats: Date objects, numeric timestamps
 * (milliseconds or seconds), and ISO date strings.
 *
 * POSIX behavior:
 * - `utimes(path, atime, mtime)` - Updates timestamps (follows symlinks)
 * - `lutimes(path, atime, mtime)` - Updates symlink timestamps directly (doesn't follow)
 * - Accepts Date objects, numeric timestamps (ms or seconds), or ISO strings
 * - Automatically updates ctime (status change time) on any timestamp change
 * - Preserves birthtime (creation time) - it is never modified
 * - Throws ENOENT if path doesn't exist
 * - Throws ENOENT for broken symlinks when using utimes (since it follows)
 *
 * @example
 * ```typescript
 * import { utimes, lutimes } from 'fsx/fs/utimes'
 *
 * // Using Date objects
 * await utimes('/path/to/file.txt', new Date(), new Date())
 *
 * // Using numeric timestamps (milliseconds)
 * const now = Date.now()
 * await utimes('/path/to/file.txt', now, now)
 *
 * // Using numeric timestamps (seconds - auto-converted)
 * const unixTimestamp = Math.floor(Date.now() / 1000)
 * await utimes('/path/to/file.txt', unixTimestamp, unixTimestamp)
 *
 * // Using ISO date strings
 * await utimes('/path/to/file.txt', '2025-01-15T12:00:00Z', '2025-01-15T14:30:00Z')
 *
 * // lutimes for symlinks (changes link, not target)
 * await lutimes('/path/to/symlink', new Date(), new Date())
 * ```
 */

import { type FileEntry } from '../types'
import { ENOENT } from '../errors'
import { normalize } from '../path'

// =============================================================================
// Types
// =============================================================================

/**
 * Time value type for utimes operations.
 *
 * Accepts multiple formats for flexibility and Node.js compatibility:
 * - `Date`: JavaScript Date object
 * - `number`: Numeric timestamp (milliseconds if >= 1e12, seconds otherwise)
 * - `string`: ISO 8601 date string (parsed via Date constructor)
 *
 * This matches Node.js fs.TimeLike type for API compatibility.
 *
 * @example
 * ```typescript
 * // All valid TimeLike values:
 * const date: TimeLike = new Date()
 * const ms: TimeLike = Date.now()
 * const seconds: TimeLike = 1735689600  // Unix timestamp in seconds
 * const iso: TimeLike = '2025-01-01T00:00:00Z'
 * ```
 */
export type TimeLike = Date | number | string

// =============================================================================
// Constants
// =============================================================================

/**
 * Threshold for distinguishing seconds from milliseconds.
 *
 * Values >= 1e12 (1 trillion) are treated as milliseconds.
 * Values < 1e12 are treated as seconds and converted to milliseconds.
 *
 * This threshold corresponds to September 9, 2001 in milliseconds,
 * so any modern timestamp in milliseconds will be above this threshold.
 *
 * @internal
 */
const MILLISECONDS_THRESHOLD = 1e12

// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Storage interface for utimes operations.
 *
 * This interface abstracts the underlying storage mechanism, allowing the
 * utimes operation to work with different storage backends (in-memory, SQLite,
 * Durable Objects, etc.).
 *
 * Required methods:
 * - `get`: Retrieve a file entry by path
 * - `has`: Check if a path exists
 * - `update`: Update a file entry with new timestamp values
 *
 * Optional methods:
 * - `resolveSymlink`: Follow symlink chains to get the target entry
 */
export interface UtimesStorage {
  /**
   * Get entry by path.
   * Does NOT follow symlinks - returns the raw entry at the path.
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

  /**
   * Update a file entry with new values.
   *
   * @param path - Normalized absolute path
   * @param changes - Partial FileEntry with fields to update
   */
  update(path: string, changes: Partial<FileEntry>): void

  /**
   * Resolve a symlink chain to get the final target entry.
   * Returns undefined if the symlink target doesn't exist (broken link).
   *
   * @param path - Path to the symlink
   * @param maxDepth - Maximum symlink resolution depth (default: 40)
   * @returns Final target FileEntry, or undefined if broken
   */
  resolveSymlink?(path: string, maxDepth?: number): FileEntry | undefined
}

// =============================================================================
// Storage Management
// =============================================================================

/**
 * Module-level storage instance.
 * Set via setStorage() for testing or when initializing the filesystem.
 */
let storage: UtimesStorage | null = null

/**
 * Set the storage backend for utimes operations.
 *
 * @param s - Storage implementation or null to clear
 *
 * @example
 * ```typescript
 * // Set up storage for testing
 * setStorage({
 *   get: (path) => mockFs.get(path),
 *   has: (path) => mockFs.has(path),
 *   update: (path, changes) => { ... },
 *   resolveSymlink: (path) => { ... },
 * })
 *
 * // Clear storage after tests
 * setStorage(null)
 * ```
 */
export function setStorage(s: UtimesStorage | null): void {
  storage = s
}

/**
 * Get the current storage backend.
 *
 * @returns Current storage instance or null if not configured
 */
export function getStorage(): UtimesStorage | null {
  return storage
}

// =============================================================================
// Timestamp Conversion
// =============================================================================

/**
 * Convert a timestamp input to milliseconds.
 *
 * Handles multiple input formats for Node.js compatibility:
 * - Date objects: Uses getTime() to extract milliseconds
 * - Strings: Parsed via Date constructor (supports ISO 8601)
 * - Numbers: Treated as milliseconds if >= 1e12, seconds otherwise
 *
 * The seconds vs milliseconds heuristic uses 1e12 as the threshold:
 * - 1e12 milliseconds = September 9, 2001
 * - Any modern timestamp in ms will be >= 1e12
 * - Unix timestamps in seconds are typically 10 digits (~1.7e9 for 2024)
 *
 * Special case: 0 is always treated as milliseconds (Unix epoch).
 *
 * @param time - The time value to convert
 * @returns The time in milliseconds since Unix epoch
 *
 * @example
 * ```typescript
 * toMilliseconds(new Date('2025-01-01'))  // 1735689600000
 * toMilliseconds(1735689600000)            // 1735689600000 (already ms)
 * toMilliseconds(1735689600)               // 1735689600000 (seconds -> ms)
 * toMilliseconds('2025-01-01T00:00:00Z')   // 1735689600000
 * toMilliseconds(0)                        // 0 (Unix epoch)
 * ```
 *
 * @internal
 */
function toMilliseconds(time: TimeLike): number {
  // Handle Date objects
  if (time instanceof Date) {
    return time.getTime()
  }

  // Handle string timestamps (ISO 8601 or other Date-parseable formats)
  if (typeof time === 'string') {
    return new Date(time).getTime()
  }

  // Handle numeric timestamps
  // Special case: 0 is Unix epoch (milliseconds)
  // Values >= 1e12 are treated as milliseconds
  // Values < 1e12 are treated as seconds and converted
  if (time >= MILLISECONDS_THRESHOLD || time === 0) {
    return time
  }

  return time * 1000
}

// =============================================================================
// Symlink Resolution
// =============================================================================

/**
 * Resolve symlinks if needed and return the target entry.
 *
 * When following symlinks (utimes behavior), this function traverses the
 * symlink chain to find the final target. If the target doesn't exist
 * (broken symlink), it throws ENOENT.
 *
 * When not following symlinks (lutimes behavior), returns the entry directly.
 *
 * @param entry - The entry at the requested path
 * @param normalizedPath - Normalized path for symlink resolution
 * @param followSymlinks - Whether to follow symlinks
 * @param syscall - Syscall name for error messages
 * @param originalPath - Original path for error messages
 * @returns Tuple of [targetEntry, targetPath]
 * @throws {ENOENT} If symlink target doesn't exist (when following)
 *
 * @internal
 */
function resolveTarget(
  entry: FileEntry,
  normalizedPath: string,
  followSymlinks: boolean,
  syscall: 'utimes' | 'lutimes',
  originalPath: string
): [FileEntry, string] {
  // For non-symlinks or when not following, return the entry directly
  if (!followSymlinks || entry.type !== 'symlink') {
    return [entry, normalizedPath]
  }

  // Follow symlinks to get the target
  if (!storage?.resolveSymlink) {
    throw new ENOENT(syscall, originalPath)
  }

  const targetEntry = storage.resolveSymlink(normalizedPath)
  if (!targetEntry) {
    // Broken symlink - target doesn't exist
    throw new ENOENT(syscall, originalPath)
  }

  return [targetEntry, targetEntry.path]
}

// =============================================================================
// Internal Implementation
// =============================================================================

/**
 * Internal implementation for utimes operations.
 *
 * This function handles both `utimes` and `lutimes` operations, differing only
 * in whether symlinks are followed.
 *
 * Algorithm:
 * 1. Verify storage is configured
 * 2. Normalize the path
 * 3. Look up the entry at the path
 * 4. Resolve symlinks if needed (utimes follows, lutimes doesn't)
 * 5. Convert timestamp inputs to milliseconds
 * 6. Update the entry with new atime, mtime, and current ctime
 *
 * @param path - Path to the file or directory
 * @param atime - New access time
 * @param mtime - New modification time
 * @param followSymlinks - Whether to follow symbolic links
 * @param syscall - Name of the syscall for error messages
 * @returns Promise that resolves when complete
 * @throws {Error} If storage is not configured
 * @throws {ENOENT} If path does not exist
 * @throws {ENOENT} If symlink target does not exist (when following symlinks)
 *
 * @internal
 */
async function utimesInternal(
  path: string,
  atime: TimeLike,
  mtime: TimeLike,
  followSymlinks: boolean,
  syscall: 'utimes' | 'lutimes'
): Promise<void> {
  // Step 1: Verify storage is configured
  if (!storage) {
    throw new Error('Storage not configured. Call setStorage() first.')
  }

  // Step 2: Normalize the path
  const normalizedPath = normalize(path)

  // Step 3: Look up the entry
  const entry = storage.get(normalizedPath)
  if (!entry) {
    throw new ENOENT(syscall, normalizedPath)
  }

  // Step 4: Resolve symlinks if needed
  const [targetEntry, targetPath] = resolveTarget(
    entry,
    normalizedPath,
    followSymlinks,
    syscall,
    normalizedPath
  )

  // Step 5: Convert timestamps to milliseconds
  const atimeMs = toMilliseconds(atime)
  const mtimeMs = toMilliseconds(mtime)

  // Step 6: Update the entry
  // ctime is always updated to current time when timestamps change
  storage.update(targetPath, {
    atime: atimeMs,
    mtime: mtimeMs,
    ctime: Date.now(),
  })
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Update file access and modification times.
 *
 * Changes the access time (atime) and modification time (mtime) of the
 * file or directory specified by path. If path refers to a symbolic link,
 * this function follows the link and changes the timestamps of the target.
 *
 * Supports multiple timestamp formats for flexibility:
 * - Date objects
 * - Numeric timestamps (milliseconds if >= 1e12, seconds otherwise)
 * - ISO 8601 date strings
 *
 * The ctime (status change time) is automatically updated to the current
 * time whenever atime or mtime is changed. The birthtime (creation time)
 * is never modified by this operation.
 *
 * @param path - Path to the file or directory
 * @param atime - New access time (Date, number, or string)
 * @param mtime - New modification time (Date, number, or string)
 *
 * @returns Promise that resolves to undefined when complete
 *
 * @throws {ENOENT} If path does not exist (errno: -2)
 * @throws {ENOENT} If symlink target does not exist (broken symlink)
 *
 * @example
 * ```typescript
 * import { utimes } from 'fsx/fs/utimes'
 *
 * // Using Date objects
 * await utimes('/path/to/file.txt', new Date(), new Date())
 *
 * // Using millisecond timestamps
 * const now = Date.now()
 * await utimes('/path/to/file.txt', now, now)
 *
 * // Using Unix timestamps (seconds)
 * const unixTime = Math.floor(Date.now() / 1000)
 * await utimes('/path/to/file.txt', unixTime, unixTime)
 *
 * // Using ISO date strings
 * await utimes('/path/to/file.txt', '2025-01-15T10:30:00Z', '2025-01-15T12:00:00Z')
 *
 * // Set different atime and mtime
 * await utimes('/path/to/file.txt', new Date('2025-01-01'), new Date('2025-06-15'))
 *
 * // Through symlink (changes target timestamps)
 * await utimes('/symlink', new Date(), new Date())
 *
 * // Error handling
 * try {
 *   await utimes('/missing/file', new Date(), new Date())
 * } catch (err) {
 *   if (err.code === 'ENOENT') {
 *     console.log('File not found')
 *   }
 * }
 * ```
 *
 * @remarks
 * **Timestamp Conversion:**
 * Numeric timestamps are automatically detected as seconds or milliseconds:
 * - Values >= 1e12 (1 trillion) are treated as milliseconds
 * - Values < 1e12 are treated as seconds and multiplied by 1000
 * - The value 0 is always treated as milliseconds (Unix epoch)
 *
 * **Platform Differences:**
 * - On Unix/macOS: Full utimes support
 * - On Windows: Timestamps are supported but may have reduced precision
 *
 * @see lutimes - For changing symlink timestamps without following
 * @see {@link https://pubs.opengroup.org/onlinepubs/9699919799/functions/utimes.html|POSIX utimes}
 * @see {@link https://nodejs.org/api/fs.html#fspromisesutimespath-atime-mtime|Node.js fs.utimes}
 */
export async function utimes(
  path: string,
  atime: TimeLike,
  mtime: TimeLike
): Promise<void> {
  return utimesInternal(path, atime, mtime, true, 'utimes')
}

/**
 * Update symbolic link access and modification times (without following).
 *
 * Like utimes, but does not follow symbolic links. Changes the timestamps
 * of the symbolic link itself rather than its target.
 *
 * This function can successfully operate on broken symlinks since it
 * doesn't need to access the target.
 *
 * @param path - Path to the symbolic link (or file/directory)
 * @param atime - New access time (Date, number, or string)
 * @param mtime - New modification time (Date, number, or string)
 *
 * @returns Promise that resolves to undefined when complete
 *
 * @throws {ENOENT} If path does not exist (errno: -2)
 *
 * @example
 * ```typescript
 * import { lutimes } from 'fsx/fs/lutimes'
 *
 * // Change symlink timestamps (without affecting target)
 * await lutimes('/path/to/symlink', new Date(), new Date())
 *
 * // Works on broken symlinks
 * await lutimes('/broken-symlink', new Date(), new Date())
 *
 * // Works on regular files too (same as utimes for non-symlinks)
 * await lutimes('/path/to/file.txt', new Date(), new Date())
 *
 * // Using numeric timestamps
 * const now = Date.now()
 * await lutimes('/path/to/symlink', now, now)
 * ```
 *
 * @remarks
 * **Platform Support:**
 * - macOS/BSD: Full lutimes support
 * - Linux: Full lutimes support (since kernel 2.6.22)
 * - Windows: Limited support (symlink timestamps may not be meaningful)
 *
 * **Use Cases:**
 * - Preserving symlink timestamps during backup/restore operations
 * - Updating symlink metadata without affecting the target
 * - Operating on broken symlinks that would fail with utimes
 *
 * @see utimes - For changing file timestamps (follows symlinks)
 * @see {@link https://pubs.opengroup.org/onlinepubs/9699919799/functions/futimens.html|POSIX futimens (lutimens)}
 * @see {@link https://nodejs.org/api/fs.html#fspromiseslutimespath-atime-mtime|Node.js fs.lutimes}
 */
export async function lutimes(
  path: string,
  atime: TimeLike,
  mtime: TimeLike
): Promise<void> {
  return utimesInternal(path, atime, mtime, false, 'lutimes')
}
