/**
 * @fileoverview chown - Change file owner and group
 *
 * Changes the owner (uid) and group (gid) of a file or directory following
 * POSIX semantics with support for symlink handling.
 *
 * @module fsx/fs/chown
 *
 * @description
 * Provides `chown` and `lchown` functions for changing file ownership.
 * The uid and gid can be changed independently using the -1 sentinel value
 * to preserve the current value.
 *
 * POSIX behavior:
 * - `chown(path, uid, gid)` - Changes ownership (follows symlinks)
 * - `lchown(path, uid, gid)` - Changes symlink ownership directly (doesn't follow)
 * - Use `-1` to leave uid or gid unchanged
 * - Updates ctime (status change time) on successful change
 * - Throws ENOENT if path doesn't exist
 * - Throws EPERM if operation not permitted (only root can chown)
 *
 * @example
 * ```typescript
 * import { chown, lchown } from 'fsx/fs/chown'
 *
 * // Change owner to uid 1000, keep existing group
 * await chown('/path/to/file.txt', 1000, -1)
 *
 * // Change group to gid 1000, keep existing owner
 * await chown('/path/to/file.txt', -1, 1000)
 *
 * // Change both owner and group
 * await chown('/path/to/file.txt', 1000, 1000)
 *
 * // Change symlink ownership (not target)
 * await lchown('/path/to/symlink', 1000, 1000)
 * ```
 */

import { type FileEntry } from '../types'
import { ENOENT, EPERM } from '../errors'
import { normalize } from '../path'

// =============================================================================
// Constants
// =============================================================================

/**
 * Special value indicating "no change" for uid or gid.
 *
 * When passed as uid or gid, the existing value is preserved.
 * This follows POSIX chown(2) semantics where -1 means "no change".
 *
 * @internal
 */
const NO_CHANGE = -1

// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Storage interface for chown operations.
 *
 * This interface abstracts the underlying storage mechanism, allowing the
 * chown operation to work with different storage backends (in-memory, SQLite,
 * Durable Objects, etc.).
 *
 * Required methods:
 * - `get`: Retrieve a file entry by path
 * - `has`: Check if a path exists
 * - `update`: Update a file entry with new values
 * - `getUid`/`getGid`: Get current user context for permission checks
 * - `isRoot`: Check if current user has root privileges
 *
 * Optional methods:
 * - `resolveSymlink`: Follow symlink chains to get the target entry
 */
export interface ChownStorage {
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

  /**
   * Get current user ID for permission checking.
   * Non-root users cannot change ownership.
   *
   * @returns User ID
   */
  getUid(): number

  /**
   * Get current primary group ID.
   * Used for potential future group membership checks.
   *
   * @returns Group ID
   */
  getGid(): number

  /**
   * Check if current user has root privileges.
   * Only root (uid 0) can change file ownership in POSIX systems.
   *
   * @returns true if current user is root, false otherwise
   */
  isRoot(): boolean
}

// =============================================================================
// Storage Management
// =============================================================================

/**
 * Module-level storage instance.
 * Set via setStorage() for testing or when initializing the filesystem.
 */
let storage: ChownStorage | null = null

/**
 * Set the storage backend for chown operations.
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
 *   getUid: () => 1000,
 *   getGid: () => 1000,
 *   isRoot: () => false,
 * })
 *
 * // Clear storage after tests
 * setStorage(null)
 * ```
 */
export function setStorage(s: ChownStorage | null): void {
  storage = s
}

/**
 * Get the current storage backend.
 *
 * @returns Current storage instance or null if not configured
 */
export function getStorage(): ChownStorage | null {
  return storage
}

// =============================================================================
// Symlink Resolution
// =============================================================================

/**
 * Resolve symlinks if needed and return the target entry.
 *
 * @param entry - The entry at the requested path
 * @param normalizedPath - Normalized path for symlink resolution
 * @param followSymlinks - Whether to follow symlinks
 * @param syscall - Syscall name for error messages
 * @param originalPath - Original path for error messages
 * @returns Tuple of [targetEntry, targetPath]
 * @throws {ENOENT} If symlink target doesn't exist
 *
 * @internal
 */
function resolveTarget(
  entry: FileEntry,
  normalizedPath: string,
  followSymlinks: boolean,
  syscall: 'chown' | 'lchown',
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
    throw new ENOENT(syscall, originalPath)
  }

  return [targetEntry, targetEntry.path]
}

// =============================================================================
// Permission Checking
// =============================================================================

/**
 * Check if the current user has permission to change file ownership.
 *
 * In POSIX systems, only the superuser (root) can change file ownership.
 * Non-root users cannot change the owner (uid) of any file.
 *
 * For group changes (gid), POSIX allows file owners to change the group
 * to any group they belong to. For simplicity, this implementation requires
 * root for all gid changes.
 *
 * @param uid - Requested new owner uid (NO_CHANGE if not changing)
 * @param gid - Requested new group gid (NO_CHANGE if not changing)
 * @param syscall - Syscall name for error messages
 * @param path - Path for error messages
 * @throws {EPERM} If current user is not root and trying to change ownership
 *
 * @internal
 */
function checkChownPermission(
  uid: number,
  gid: number,
  syscall: 'chown' | 'lchown',
  path: string
): void {
  // Root can do anything
  if (storage?.isRoot()) {
    return
  }

  // Non-root user trying to change uid
  if (uid !== NO_CHANGE) {
    throw new EPERM(syscall, path)
  }

  // Non-root user trying to change gid
  // Note: In real POSIX, owner can change gid to a group they're a member of.
  // For simplicity, we deny all gid changes for non-root.
  if (gid !== NO_CHANGE) {
    throw new EPERM(syscall, path)
  }
}

// =============================================================================
// Ownership Calculation
// =============================================================================

/**
 * Calculate the new uid and gid values based on requested changes.
 *
 * Uses the NO_CHANGE sentinel (-1) to determine which values to preserve.
 *
 * @param entry - Target file entry with current ownership
 * @param uid - Requested new uid (NO_CHANGE to keep current)
 * @param gid - Requested new gid (NO_CHANGE to keep current)
 * @returns Tuple of [newUid, newGid]
 *
 * @internal
 */
function calculateNewOwnership(
  entry: FileEntry,
  uid: number,
  gid: number
): [number, number] {
  const newUid = uid === NO_CHANGE ? entry.uid : uid
  const newGid = gid === NO_CHANGE ? entry.gid : gid
  return [newUid, newGid]
}

// =============================================================================
// Internal Implementation
// =============================================================================

/**
 * Internal implementation for chown operations.
 *
 * This function handles both `chown` and `lchown` operations, differing only
 * in whether symlinks are followed.
 *
 * @param path - Path to the file or directory
 * @param uid - New owner user ID (NO_CHANGE to leave unchanged)
 * @param gid - New owner group ID (NO_CHANGE to leave unchanged)
 * @param followSymlinks - Whether to follow symbolic links
 * @param syscall - Name of the syscall for error messages
 * @returns Promise that resolves when complete
 * @throws {Error} If storage is not configured
 * @throws {ENOENT} If path does not exist
 * @throws {ENOENT} If symlink target does not exist (when following symlinks)
 * @throws {EPERM} If operation is not permitted (non-root user)
 *
 * @internal
 */
async function chownInternal(
  path: string,
  uid: number,
  gid: number,
  followSymlinks: boolean,
  syscall: 'chown' | 'lchown'
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
    throw new ENOENT(syscall, path)
  }

  // Step 4: Resolve symlinks if needed
  const [targetEntry, targetPath] = resolveTarget(
    entry,
    normalizedPath,
    followSymlinks,
    syscall,
    path
  )

  // Step 5: Check permissions
  checkChownPermission(uid, gid, syscall, path)

  // Step 6: Calculate new ownership values
  const [newUid, newGid] = calculateNewOwnership(targetEntry, uid, gid)

  // Step 7: Update the entry with new ownership and ctime
  storage.update(targetPath, {
    uid: newUid,
    gid: newGid,
    ctime: Date.now(),
  })
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Change file owner and group.
 *
 * Changes the owner (uid) and group (gid) of the file specified by path.
 * If path refers to a symbolic link, this function follows the link
 * and changes the ownership of the target file.
 *
 * Use `-1` for uid or gid to leave that value unchanged.
 *
 * @param path - Path to the file or directory
 * @param uid - New owner user ID (-1 to leave unchanged)
 * @param gid - New owner group ID (-1 to leave unchanged)
 *
 * @returns Promise that resolves to undefined when complete
 *
 * @throws {ENOENT} If path does not exist (errno: -2)
 * @throws {ENOENT} If symlink target does not exist (broken symlink)
 * @throws {EPERM} If operation is not permitted (errno: -1)
 *
 * @example
 * ```typescript
 * import { chown } from 'fsx/fs/chown'
 *
 * // Change owner to uid 1000, keep existing group
 * await chown('/path/to/file.txt', 1000, -1)
 *
 * // Change group to gid 1000, keep existing owner
 * await chown('/path/to/file.txt', -1, 1000)
 *
 * // Change both owner and group
 * await chown('/path/to/file.txt', 1000, 1000)
 *
 * // Set to root ownership
 * await chown('/path/to/file.txt', 0, 0)
 *
 * // Chown through symlink affects target
 * await chown('/symlink', 1000, 1000)  // Changes target file's ownership
 *
 * // Error handling
 * try {
 *   await chown('/missing/file', 1000, 1000)
 * } catch (err) {
 *   if (err.code === 'ENOENT') {
 *     console.log('File not found')
 *   } else if (err.code === 'EPERM') {
 *     console.log('Permission denied (must be root)')
 *   }
 * }
 * ```
 *
 * @remarks
 * **Platform Differences:**
 * - On Unix/macOS: Full chown support, requires root privileges
 * - On Windows: chown is essentially a no-op (Windows uses ACLs, not uid/gid)
 *
 * **Permission Requirements:**
 * Only the superuser (root, uid 0) can change file ownership.
 * Attempting to change ownership as a non-root user throws EPERM.
 *
 * @see lchown - For changing symlink ownership without following
 * @see {@link https://pubs.opengroup.org/onlinepubs/9699919799/functions/chown.html|POSIX chown}
 */
export async function chown(path: string, uid: number, gid: number): Promise<void> {
  return chownInternal(path, uid, gid, true, 'chown')
}

/**
 * Change symbolic link owner and group (without following).
 *
 * Like chown, but does not follow symbolic links. Changes the ownership
 * of the symbolic link itself rather than its target.
 *
 * Use `-1` for uid or gid to leave that value unchanged.
 *
 * @param path - Path to the symbolic link (or file/directory)
 * @param uid - New owner user ID (-1 to leave unchanged)
 * @param gid - New owner group ID (-1 to leave unchanged)
 *
 * @returns Promise that resolves to undefined when complete
 *
 * @throws {ENOENT} If path does not exist (errno: -2)
 * @throws {EPERM} If operation is not permitted (errno: -1)
 *
 * @example
 * ```typescript
 * import { lchown } from 'fsx/fs/chown'
 *
 * // Change symlink ownership (without affecting target)
 * await lchown('/path/to/symlink', 1000, 1000)
 *
 * // Change only the uid of a symlink
 * await lchown('/path/to/symlink', 2000, -1)
 *
 * // Works on regular files too (same as chown for non-symlinks)
 * await lchown('/path/to/file.txt', 1000, 1000)
 *
 * // Useful for preserving symlink ownership during operations
 * // that might otherwise change target ownership through symlinks
 * ```
 *
 * @remarks
 * Unlike chown, lchown can change ownership of broken symlinks since
 * it operates on the symlink entry itself, not its target.
 *
 * **Platform Differences:**
 * - On Unix/macOS: Full lchown support
 * - On Windows: lchown is not supported (Windows doesn't use uid/gid)
 *
 * **Permission Requirements:**
 * Only the superuser (root, uid 0) can change ownership.
 *
 * @see chown - For changing file ownership (follows symlinks)
 * @see {@link https://pubs.opengroup.org/onlinepubs/9699919799/functions/lchown.html|POSIX lchown}
 */
export async function lchown(path: string, uid: number, gid: number): Promise<void> {
  return chownInternal(path, uid, gid, false, 'lchown')
}
