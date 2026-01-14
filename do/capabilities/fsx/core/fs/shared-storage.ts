/**
 * Shared Storage Interface for Filesystem Operations
 *
 * This module provides common storage interfaces and utilities shared between
 * filesystem operations like `exists`, `stat`, `lstat`, and `access`.
 *
 * By centralizing these interfaces, we ensure consistent behavior across all
 * operations that need to interact with the storage backend.
 *
 * @module core/fs/shared-storage
 */

import type { FileEntry } from '../types'

// =============================================================================
// Shared Storage Interface
// =============================================================================

/**
 * Base storage interface for filesystem operations.
 *
 * This interface abstracts the underlying storage mechanism, allowing
 * filesystem operations to work with different storage backends:
 * - In-memory (testing)
 * - SQLite (Durable Objects)
 * - Hybrid (SQLite + R2)
 *
 * All filesystem operations that need to look up entries should use this
 * interface to ensure consistent behavior.
 *
 * @example
 * ```typescript
 * const storage: BaseStorage = {
 *   get: (path) => db.get(path),
 *   has: (path) => db.has(path),
 *   resolveSymlink: (path) => resolveChain(path),
 * }
 * ```
 */
export interface BaseStorage {
  /**
   * Get entry by normalized path.
   *
   * This method does NOT follow symlinks - it returns the raw entry
   * at the specified path. Use `resolveSymlink` to follow symlink chains.
   *
   * @param path - Normalized absolute path (no trailing slashes except root)
   * @returns The FileEntry if it exists, undefined otherwise
   */
  get(path: string): FileEntry | undefined

  /**
   * Check if a path exists in storage.
   *
   * This is a fast existence check that doesn't load the full entry.
   * For operations that need entry data, use `get` instead.
   *
   * @param path - Normalized absolute path
   * @returns true if the path exists, false otherwise
   */
  has(path: string): boolean

  /**
   * Resolve a symlink chain to get the final target entry.
   *
   * This method follows symlink chains up to a maximum depth to prevent
   * infinite loops from circular symlinks.
   *
   * @param path - Path to the symlink to resolve
   * @param maxDepth - Maximum number of symlinks to follow (default: 40)
   * @returns The final target FileEntry, or undefined if:
   *          - The symlink is broken (target doesn't exist)
   *          - The chain is circular and maxDepth was exceeded
   *          - The path is not a symlink
   */
  resolveSymlink?(path: string, maxDepth?: number): FileEntry | undefined
}

// =============================================================================
// Path Validation Utilities
// =============================================================================

/**
 * Result of path validation and normalization.
 *
 * Contains the processed path information needed for filesystem operations.
 */
export interface PathValidationResult {
  /**
   * The normalized path with redundant slashes, `.`, and `..` resolved.
   */
  normalizedPath: string

  /**
   * Whether the original path had a trailing slash.
   *
   * POSIX semantics: A trailing slash indicates "must be a directory".
   * Operations should fail if the target is not a directory when this is true.
   */
  hasTrailingSlash: boolean
}

/**
 * Validate and normalize a filesystem path.
 *
 * This function performs common path validation and normalization that
 * is shared across filesystem operations:
 * - Rejects empty or falsy paths
 * - Normalizes redundant slashes (// -> /)
 * - Resolves . and .. segments
 * - Tracks trailing slash for POSIX directory semantics
 *
 * @param path - The raw path to validate and normalize
 * @param normalizeFn - The path normalization function to use
 * @returns PathValidationResult if valid, null if path is invalid
 *
 * @example
 * ```typescript
 * import { normalize } from '../path'
 *
 * const result = validatePath('/data//file.txt/', normalize)
 * // { normalizedPath: '/data/file.txt', hasTrailingSlash: true }
 *
 * const invalid = validatePath('', normalize)
 * // null
 * ```
 */
export function validatePath(
  path: string,
  normalizeFn: (p: string) => string
): PathValidationResult | null {
  // Handle edge cases: empty or falsy paths
  if (!path || path === '') {
    return null
  }

  // Track trailing slash before normalization (POSIX directory semantics)
  // A trailing slash means "this must be a directory"
  // Root '/' is special - it's always a directory
  const hasTrailingSlash = path.endsWith('/') && path !== '/'

  // Normalize the path to handle //, ./, ../ etc.
  const normalizedPath = normalizeFn(path)

  return { normalizedPath, hasTrailingSlash }
}

// =============================================================================
// Symlink Resolution Utilities
// =============================================================================

/**
 * Maximum depth for symlink resolution to prevent infinite loops.
 *
 * This matches the POSIX ELOOP limit used by most Unix systems.
 */
export const MAX_SYMLINK_DEPTH = 40

/**
 * Result of symlink resolution.
 */
export interface SymlinkResolutionResult {
  /**
   * Whether the resolution succeeded.
   */
  success: boolean

  /**
   * The resolved entry (only set if success is true).
   */
  entry?: FileEntry

  /**
   * The reason for failure (only set if success is false).
   */
  reason?: 'broken' | 'circular' | 'no_resolver'
}

/**
 * Check if an entry satisfies the trailing slash directory requirement.
 *
 * When a path ends with '/', POSIX semantics require the target to be
 * a directory. Symlinks are considered valid since they might point
 * to directories (and should be resolved to check).
 *
 * @param entry - The file entry to check
 * @param hasTrailingSlash - Whether the original path had a trailing slash
 * @returns true if the requirement is satisfied, false otherwise
 *
 * @example
 * ```typescript
 * // File with trailing slash -> false (files can't have trailing slash)
 * satisfiesDirectoryRequirement(fileEntry, true)  // false
 *
 * // Directory with trailing slash -> true
 * satisfiesDirectoryRequirement(dirEntry, true)   // true
 *
 * // Any entry without trailing slash -> true (no requirement)
 * satisfiesDirectoryRequirement(fileEntry, false) // true
 * ```
 */
export function satisfiesDirectoryRequirement(
  entry: FileEntry,
  hasTrailingSlash: boolean
): boolean {
  if (!hasTrailingSlash) {
    return true // No requirement when no trailing slash
  }
  // Trailing slash requires directory
  // Symlinks are allowed because they might point to directories
  return entry.type === 'directory' || entry.type === 'symlink'
}

/**
 * Resolve a symlink entry to its final target.
 *
 * This function handles the complexity of symlink resolution including:
 * - Broken symlinks (target doesn't exist)
 * - Circular symlinks (loop detection via maxDepth)
 * - Missing resolver (storage doesn't support symlinks)
 *
 * @param storage - The storage backend with resolveSymlink method
 * @param normalizedPath - The normalized path to the symlink
 * @param hasTrailingSlash - Whether to enforce directory requirement on target
 * @returns SymlinkResolutionResult indicating success or failure reason
 *
 * @example
 * ```typescript
 * const result = resolveSymlink(storage, '/link', false)
 * if (result.success) {
 *   console.log('Target:', result.entry)
 * } else {
 *   console.log('Failed:', result.reason)
 * }
 * ```
 */
export function resolveSymlink(
  storage: BaseStorage,
  normalizedPath: string,
  hasTrailingSlash: boolean
): SymlinkResolutionResult {
  // Storage must provide resolveSymlink for symlink support
  if (!storage.resolveSymlink) {
    return { success: false, reason: 'no_resolver' }
  }

  const resolved = storage.resolveSymlink(normalizedPath, MAX_SYMLINK_DEPTH)

  // Broken symlink - target doesn't exist
  if (!resolved) {
    return { success: false, reason: 'broken' }
  }

  // Circular reference that couldn't be fully resolved
  // (still a symlink after max depth means we hit the limit)
  if (resolved.type === 'symlink') {
    return { success: false, reason: 'circular' }
  }

  // Trailing slash requires the final target to be a directory
  if (hasTrailingSlash && resolved.type !== 'directory') {
    return { success: false, reason: 'broken' }
  }

  return { success: true, entry: resolved }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if an entry is a symlink.
 *
 * @param entry - The file entry to check
 * @returns true if the entry is a symlink
 */
export function isSymlink(entry: FileEntry): boolean {
  return entry.type === 'symlink'
}

/**
 * Check if an entry is a directory.
 *
 * @param entry - The file entry to check
 * @returns true if the entry is a directory
 */
export function isDirectory(entry: FileEntry): boolean {
  return entry.type === 'directory'
}

/**
 * Check if an entry is a regular file.
 *
 * @param entry - The file entry to check
 * @returns true if the entry is a regular file
 */
export function isFile(entry: FileEntry): boolean {
  return entry.type === 'file'
}
