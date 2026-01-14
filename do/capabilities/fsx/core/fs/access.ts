/**
 * access operation - test file accessibility
 *
 * Tests whether the calling process can access the file at the given path.
 * The mode parameter specifies the accessibility checks to perform.
 *
 * Following Node.js fs.promises.access behavior:
 * - Returns undefined if accessible (resolves with no value)
 * - Throws ENOENT if path doesn't exist or symlink target doesn't exist
 * - Throws EACCES if permission denied
 *
 * POSIX behavior for access modes:
 * - F_OK (0): Check file exists
 * - R_OK (4): Check read permission
 * - W_OK (2): Check write permission
 * - X_OK (1): Check execute permission
 * - Modes can be OR'd together (e.g., R_OK | W_OK)
 *
 * Permission checking follows POSIX semantics:
 * 1. Check owner permissions if uid matches file owner
 * 2. Check group permissions if gid matches file group or user is in file's group
 * 3. Check other permissions for everyone else
 *
 * @example
 * ```typescript
 * import { access, F_OK, R_OK, W_OK } from 'fsx/fs/access'
 *
 * // Check if file exists
 * await access('/path/to/file')
 *
 * // Check read permission
 * await access('/path/to/file', R_OK)
 *
 * // Check read and write permissions
 * await access('/path/to/file', R_OK | W_OK)
 * ```
 *
 * @module
 */

import type { FileEntry } from '../types'
import { ENOENT, EACCES } from '../errors'
import { normalize } from '../path'
import { constants } from '../constants'

// =============================================================================
// Access Mode Constants
// =============================================================================

/**
 * Check file exists (default mode).
 * Only verifies the file exists, does not check permissions.
 * @example await access('/path/to/file', F_OK)
 */
export const F_OK = constants.F_OK

/**
 * Check read permission (4).
 * Verifies the calling process can read the file.
 * @example await access('/path/to/file', R_OK)
 */
export const R_OK = constants.R_OK

/**
 * Check write permission (2).
 * Verifies the calling process can write to the file.
 * @example await access('/path/to/file', W_OK)
 */
export const W_OK = constants.W_OK

/**
 * Check execute permission (1).
 * Verifies the calling process can execute the file.
 * For directories, execute permission allows traversal.
 * @example await access('/path/to/script.sh', X_OK)
 */
export const X_OK = constants.X_OK

// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Storage interface for access operation.
 *
 * This interface abstracts the underlying storage mechanism, allowing the
 * access operation to work with different storage backends (in-memory, SQLite,
 * Durable Objects, etc.).
 *
 * Required methods:
 * - get: Retrieve a file entry by path
 * - has: Check if a path exists
 *
 * Optional methods:
 * - resolveSymlink: Follow symlink chains to get the target entry
 * - getUid/getGid/getGroups: Get current user context for permission checks
 */
export interface AccessStorage {
  /**
   * Get entry by path.
   * Does NOT follow symlinks - returns the raw entry at the path.
   * @param path - Normalized absolute path
   * @returns FileEntry if exists, undefined otherwise
   */
  get(path: string): FileEntry | undefined

  /**
   * Check if path exists in storage.
   * @param path - Normalized absolute path
   * @returns true if path exists, false otherwise
   */
  has(path: string): boolean

  /**
   * Resolve a symlink chain to get the final target entry.
   * Returns undefined if the symlink target doesn't exist (broken link).
   * @param path - Path to the symlink
   * @param maxDepth - Maximum symlink resolution depth (default: 40)
   * @returns Final target FileEntry, or undefined if broken
   */
  resolveSymlink?(path: string, maxDepth?: number): FileEntry | undefined

  /**
   * Get current user ID for permission checking.
   * @returns User ID (defaults to 0 if not implemented)
   */
  getUid?(): number

  /**
   * Get current primary group ID for permission checking.
   * @returns Group ID (defaults to 0 if not implemented)
   */
  getGid?(): number

  /**
   * Get current user's supplementary group memberships.
   * @returns Array of group IDs the user belongs to (defaults to [] if not implemented)
   */
  getGroups?(): number[]
}

// =============================================================================
// Storage Management
// =============================================================================

/**
 * Module-level storage instance.
 * Set via setStorage() for testing or when initializing the filesystem.
 */
let storage: AccessStorage | null = null

/**
 * Set the storage backend for access operations.
 *
 * @param s - Storage implementation or null to clear
 *
 * @example
 * ```typescript
 * // Set up storage for testing
 * setStorage({
 *   get: (path) => mockFs.get(path),
 *   has: (path) => mockFs.has(path),
 *   getUid: () => 1000,
 *   getGid: () => 1000,
 *   getGroups: () => [1000],
 * })
 *
 * // Clear storage after tests
 * setStorage(null)
 * ```
 */
export function setStorage(s: AccessStorage | null): void {
  storage = s
}

/**
 * Get the current storage backend.
 * @returns Current storage instance or null if not configured
 */
export function getStorage(): AccessStorage | null {
  return storage
}

// =============================================================================
// Permission Checking
// =============================================================================

/**
 * Permission bit mappings for POSIX-style permission checking.
 *
 * Permission bits in a POSIX mode are organized as:
 * - Bits 8-6: Owner permissions (rwx)
 * - Bits 5-3: Group permissions (rwx)
 * - Bits 2-0: Other permissions (rwx)
 *
 * The access mode constants (R_OK=4, W_OK=2, X_OK=1) map directly to the
 * "other" permission bits. We shift left by 3 for group and by 6 for owner.
 */
const PERMISSION_BITS = {
  /** Shift amount for owner permission bits */
  OWNER_SHIFT: 6,
  /** Shift amount for group permission bits */
  GROUP_SHIFT: 3,
  /** Shift amount for other permission bits (no shift needed) */
  OTHER_SHIFT: 0,
} as const

/**
 * Check if user has the requested permission based on file mode and ownership.
 *
 * Follows POSIX permission checking semantics:
 * 1. If caller's UID matches file owner UID, check owner permission bits
 * 2. If caller's GID matches file's GID (or caller is in file's group), check group permission bits
 * 3. Otherwise, check other permission bits
 *
 * @param entry - File entry to check permissions against
 * @param permissionBit - Permission bit to check (R_OK=4, W_OK=2, X_OK=1)
 * @param uid - Caller's user ID
 * @param gid - Caller's primary group ID
 * @param groups - Caller's supplementary group memberships
 * @returns true if permission is granted, false otherwise
 *
 * @internal
 */
function checkPermission(
  entry: FileEntry,
  permissionBit: number,
  uid: number,
  gid: number,
  groups: number[]
): boolean {
  const mode = entry.mode

  // Check owner permissions first (POSIX: owner takes precedence)
  if (entry.uid === uid) {
    const ownerBit = permissionBit << PERMISSION_BITS.OWNER_SHIFT
    return (mode & ownerBit) !== 0
  }

  // Check group permissions (primary GID or supplementary groups)
  if (entry.gid === gid || groups.includes(entry.gid)) {
    const groupBit = permissionBit << PERMISSION_BITS.GROUP_SHIFT
    return (mode & groupBit) !== 0
  }

  // Check other permissions (no shift needed)
  return (mode & permissionBit) !== 0
}

// =============================================================================
// Main Access Function
// =============================================================================

/**
 * Test file accessibility.
 *
 * Tests whether the calling process can access the file at the given path.
 * The mode parameter specifies which accessibility checks to perform.
 *
 * This function follows symbolic links. To check the permissions of a symlink
 * itself rather than its target, use lstat() to get the symlink's mode.
 *
 * @param path - Path to file or directory to check
 * @param mode - Accessibility checks to perform (default: F_OK)
 *   - F_OK (0): Check file exists
 *   - R_OK (4): Check read permission
 *   - W_OK (2): Check write permission
 *   - X_OK (1): Check execute permission
 *   - Combine with bitwise OR: R_OK | W_OK
 *
 * @returns Promise that resolves to undefined if accessible
 *
 * @throws {ENOENT} If path does not exist (errno: -2)
 * @throws {ENOENT} If symlink target does not exist (broken symlink)
 * @throws {EACCES} If permission denied for requested mode (errno: -13)
 *
 * @example
 * ```typescript
 * // Check if file exists
 * try {
 *   await access('/path/to/file')
 *   console.log('File exists')
 * } catch (err) {
 *   if (err.code === 'ENOENT') {
 *     console.log('File does not exist')
 *   }
 * }
 *
 * // Check read permission
 * await access('/path/to/file', R_OK)
 *
 * // Check read and write permissions
 * await access('/path/to/file', R_OK | W_OK)
 *
 * // Check all permissions
 * await access('/path/to/file', R_OK | W_OK | X_OK)
 * ```
 */
export async function access(path: string, mode: number = F_OK): Promise<void> {
  // Step 1: Normalize the path to handle //, ./, ../ etc.
  const normalizedPath = normalize(path)

  // Step 2: Verify storage is configured
  if (!storage) {
    throw new ENOENT('access', normalizedPath)
  }

  // Step 3: Look up the entry in storage
  const entry = storage.get(normalizedPath)
  if (!entry) {
    throw new ENOENT('access', normalizedPath)
  }

  // Step 4: Resolve symlinks (access follows symlinks)
  const targetEntry = resolveSymlinkIfNeeded(entry, normalizedPath)

  // Step 5: F_OK (0) only checks existence - we're done if just checking existence
  if (mode === F_OK) {
    return
  }

  // Step 6: Get current user context for permission checking
  const uid = storage.getUid?.() ?? 0
  const gid = storage.getGid?.() ?? 0
  const groups = storage.getGroups?.() ?? []

  // Step 7: Check each requested permission
  checkRequestedPermissions(targetEntry, mode, uid, gid, groups, normalizedPath)
}

/**
 * Resolve symlinks if the entry is a symlink.
 *
 * @param entry - The file entry (may be a symlink)
 * @param originalPath - Original path for error reporting
 * @returns The resolved target entry
 * @throws {ENOENT} If symlink target doesn't exist
 *
 * @internal
 */
function resolveSymlinkIfNeeded(entry: FileEntry, originalPath: string): FileEntry {
  if (entry.type !== 'symlink') {
    return entry
  }

  // Storage must provide resolveSymlink for symlink support
  if (!storage?.resolveSymlink) {
    throw new ENOENT('access', originalPath)
  }

  const resolved = storage.resolveSymlink(originalPath)
  if (!resolved) {
    // Broken symlink - target doesn't exist
    throw new ENOENT('access', originalPath)
  }

  return resolved
}

/**
 * Check all requested permissions against the target entry.
 *
 * @param entry - The file entry to check
 * @param mode - Requested permission mode (combination of R_OK, W_OK, X_OK)
 * @param uid - Caller's user ID
 * @param gid - Caller's primary group ID
 * @param groups - Caller's supplementary groups
 * @param path - Path for error reporting
 * @throws {EACCES} If any requested permission is denied
 *
 * @internal
 */
function checkRequestedPermissions(
  entry: FileEntry,
  mode: number,
  uid: number,
  gid: number,
  groups: number[],
  path: string
): void {
  // Check read permission (R_OK = 4)
  if ((mode & R_OK) !== 0) {
    if (!checkPermission(entry, R_OK, uid, gid, groups)) {
      throw new EACCES('access', path)
    }
  }

  // Check write permission (W_OK = 2)
  if ((mode & W_OK) !== 0) {
    if (!checkPermission(entry, W_OK, uid, gid, groups)) {
      throw new EACCES('access', path)
    }
  }

  // Check execute permission (X_OK = 1)
  if ((mode & X_OK) !== 0) {
    if (!checkPermission(entry, X_OK, uid, gid, groups)) {
      throw new EACCES('access', path)
    }
  }
}
