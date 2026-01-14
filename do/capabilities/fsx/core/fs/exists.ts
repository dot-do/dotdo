/**
 * exists - Check if a path exists in the filesystem
 *
 * This module provides the `exists()` function for checking whether a file,
 * directory, or symlink exists at a given path. Unlike most filesystem
 * operations, `exists()` never throws an error - it always returns a boolean.
 *
 * ## Key Characteristics
 *
 * - **Never throws**: Always returns `true` or `false`, never an error
 * - **Follows symlinks**: Returns `false` for broken or circular symlinks
 * - **POSIX-compliant trailing slash**: `/path/` requires the target to be a directory
 * - **Permission-agnostic**: Returns `true` even for files without read permission
 *
 * ## Node.js Compatibility Note
 *
 * In Node.js, `fs.exists()` (callback version) is deprecated due to:
 * 1. Callback signature inconsistency (doesn't follow Node conventions)
 * 2. Race conditions between check and subsequent operations
 *
 * This Promise-based `exists()` avoids these issues:
 * - Returns a clear boolean value
 * - Uses modern async/await patterns
 * - Clear semantics without callback confusion
 *
 * For permission checking, use `access()`. For detailed file info, use `stat()`.
 * Use `exists()` only when you need a simple boolean existence check.
 *
 * ## Usage Guidelines
 *
 * **When to use exists():**
 * - Conditional loading of optional configuration files
 * - Checking if a cache file exists before attempting to read
 * - Determining if a directory needs to be created
 *
 * **When NOT to use exists():**
 * - Before creating a file (use `writeFile` with `wx` flag for atomicity)
 * - Before reading a file (just try to read and handle ENOENT)
 * - When you need the file's metadata (use `stat()` instead)
 *
 * @example Basic Usage
 * ```typescript
 * import { exists } from 'fsx/fs/exists'
 *
 * // Simple existence check
 * if (await exists('/config.json')) {
 *   const config = await readFile('/config.json', 'utf-8')
 * }
 *
 * // Check directory exists
 * if (await exists('/data/')) {
 *   // Path exists AND is a directory
 * }
 *
 * // Safe concurrent checks
 * const [hasConfig, hasData] = await Promise.all([
 *   exists('/config.json'),
 *   exists('/data/'),
 * ])
 * ```
 *
 * @example Symlink Behavior
 * ```typescript
 * // Symlinks are followed
 * await exists('/link-to-file')     // true if target exists
 * await exists('/broken-link')      // false if target doesn't exist
 * await exists('/circular-link')    // false if circular reference
 * ```
 *
 * @module core/fs/exists
 */

import { normalize } from '../path'
import {
  type BaseStorage,
  type PathValidationResult,
  validatePath,
  satisfiesDirectoryRequirement,
  resolveSymlink,
  isSymlink,
} from './shared-storage'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Storage interface for exists operation.
 *
 * This interface extends the base storage interface to provide the
 * specific requirements for existence checking. The exists operation
 * is intentionally simple - it only needs to look up entries and
 * optionally resolve symlinks.
 *
 * @see BaseStorage for detailed method documentation
 *
 * @example Implementation
 * ```typescript
 * const storage: ExistsStorage = {
 *   get: (path) => database.getEntry(path),
 *   has: (path) => database.hasEntry(path),
 *   resolveSymlink: (path, maxDepth) => {
 *     let current = database.getEntry(path)
 *     let depth = 0
 *     while (current?.type === 'symlink' && depth < maxDepth) {
 *       current = database.getEntry(current.linkTarget)
 *       depth++
 *     }
 *     return current
 *   },
 * }
 * ```
 */
export interface ExistsStorage extends BaseStorage {
  // Inherits all methods from BaseStorage
  // No additional methods needed for exists
}

// =============================================================================
// Module State
// =============================================================================

/**
 * Module-level storage instance.
 *
 * This storage backend is set via `setStorage()` and used by `exists()`
 * to check path existence. When null, `exists()` will always return false.
 *
 * @internal
 */
let storage: ExistsStorage | null = null

// =============================================================================
// Storage Management API
// =============================================================================

/**
 * Set the storage backend for exists operations.
 *
 * This function configures the storage backend that `exists()` will use
 * to look up file entries. It must be called before using `exists()`.
 *
 * @param s - Storage implementation or null to clear
 *
 * @example Setting up storage
 * ```typescript
 * import { setStorage } from 'fsx/fs/exists'
 *
 * // Configure storage with a database backend
 * setStorage({
 *   get: (path) => db.entries.get(path),
 *   has: (path) => db.entries.has(path),
 *   resolveSymlink: (path) => db.resolveSymlinkChain(path),
 * })
 *
 * // Now exists() can be used
 * const fileExists = await exists('/path/to/file')
 * ```
 *
 * @example Testing setup
 * ```typescript
 * import { setStorage } from 'fsx/fs/exists'
 *
 * beforeEach(() => {
 *   const mockFs = new Map<string, FileEntry>()
 *   mockFs.set('/test.txt', createFileEntry('/test.txt'))
 *
 *   setStorage({
 *     get: (path) => mockFs.get(path),
 *     has: (path) => mockFs.has(path),
 *   })
 * })
 *
 * afterEach(() => {
 *   setStorage(null) // Clean up
 * })
 * ```
 */
export function setStorage(s: ExistsStorage | null): void {
  storage = s
}

/**
 * Get the current storage backend.
 *
 * This function is primarily useful for debugging and testing to
 * verify that storage is properly configured.
 *
 * @returns Current storage instance or null if not configured
 *
 * @example
 * ```typescript
 * import { getStorage, setStorage } from 'fsx/fs/exists'
 *
 * // Check if storage is configured
 * if (!getStorage()) {
 *   console.warn('exists() storage not configured')
 *   setStorage(defaultStorage)
 * }
 * ```
 */
export function getStorage(): ExistsStorage | null {
  return storage
}

// =============================================================================
// Internal Implementation
// =============================================================================

/**
 * Check if the entry and resolved symlink target exist and satisfy requirements.
 *
 * This is the core logic for exists() that handles:
 * 1. Entry lookup in storage
 * 2. Trailing slash directory requirement validation
 * 3. Symlink resolution and target existence verification
 *
 * @param normalizedPath - The normalized path to check
 * @param hasTrailingSlash - Whether the original path had a trailing slash
 * @returns true if the path exists and satisfies all requirements
 *
 * @internal
 */
function checkPathExists(
  normalizedPath: string,
  hasTrailingSlash: boolean
): boolean {
  // Storage must be configured
  if (!storage) {
    return false
  }

  // Look up the entry in storage
  const entry = storage.get(normalizedPath)
  if (!entry) {
    return false
  }

  // Check trailing slash requirement for non-symlinks
  // (symlinks need resolution first)
  if (!satisfiesDirectoryRequirement(entry, hasTrailingSlash)) {
    return false
  }

  // Handle symlinks - exists() follows symlinks to verify target
  if (isSymlink(entry)) {
    const result = resolveSymlink(storage, normalizedPath, hasTrailingSlash)
    return result.success
  }

  // Entry exists and is not a symlink - we're done
  return true
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if a path exists in the filesystem.
 *
 * Tests whether a file, directory, or symlink exists at the given path.
 * This function never throws - it always returns a boolean value, making
 * it safe for use in conditional checks without try/catch blocks.
 *
 * ## Behavior
 *
 * | Scenario | Result |
 * |----------|--------|
 * | Path exists (file, dir, or valid symlink) | `true` |
 * | Path doesn't exist | `false` |
 * | Broken symlink (target missing) | `false` |
 * | Circular symlink | `false` |
 * | File/dir with no permissions | `true` |
 * | Path with trailing slash to non-directory | `false` |
 * | Empty or invalid path | `false` |
 * | Storage not configured | `false` |
 *
 * ## Path Normalization
 *
 * Paths are normalized before lookup:
 * - `/data//file.txt` -> `/data/file.txt`
 * - `/data/./file.txt` -> `/data/file.txt`
 * - `/data/dir/../file.txt` -> `/data/file.txt`
 *
 * ## Trailing Slash Semantics
 *
 * Following POSIX conventions, a trailing slash indicates that the
 * path must be a directory:
 * - `exists('/file.txt')` - true if file exists
 * - `exists('/file.txt/')` - false (file is not a directory)
 * - `exists('/dir')` - true if dir exists
 * - `exists('/dir/')` - true if dir exists
 *
 * @param path - Path to check (absolute or relative, will be normalized)
 * @returns Promise resolving to `true` if path exists, `false` otherwise
 *
 * @example Basic usage
 * ```typescript
 * // Check if a config file exists before loading
 * if (await exists('/app/config.json')) {
 *   const config = JSON.parse(await readFile('/app/config.json', 'utf-8'))
 * } else {
 *   const config = defaultConfig
 * }
 * ```
 *
 * @example Creating directories only if needed
 * ```typescript
 * // Create a cache directory if it doesn't exist
 * if (!await exists('/cache/')) {
 *   await mkdir('/cache/', { recursive: true })
 * }
 * ```
 *
 * @example Checking multiple paths concurrently
 * ```typescript
 * // Safe concurrent existence checks
 * const [hasConfig, hasCache, hasLogs] = await Promise.all([
 *   exists('/config.json'),
 *   exists('/cache/'),
 *   exists('/logs/'),
 * ])
 *
 * if (hasConfig && !hasCache) {
 *   await initializeCache()
 * }
 * ```
 *
 * @example Symlink handling
 * ```typescript
 * // Create a symlink structure
 * await symlink('/data/current', '/data/latest')
 *
 * // exists follows symlinks
 * await exists('/data/latest')  // true if /data/current exists
 *
 * // Broken symlinks return false
 * await symlink('/nonexistent', '/broken-link')
 * await exists('/broken-link')  // false
 * ```
 *
 * @example Never throws guarantee
 * ```typescript
 * // These all return false, never throw
 * await exists('')                    // false (empty path)
 * await exists('/nonexistent/path')   // false (doesn't exist)
 * await exists('/broken/symlink')     // false (broken link)
 *
 * // Permission errors don't cause throws
 * await exists('/root/secret.txt')    // true if exists, regardless of permissions
 * ```
 *
 * @see stat - When you need file metadata (size, mtime, etc.)
 * @see access - When you need to check specific permissions
 * @see lstat - When you need symlink information without following
 */
export async function exists(path: string): Promise<boolean> {
  // Step 1: Validate and normalize the input path
  const pathInfo: PathValidationResult | null = validatePath(path, normalize)
  if (!pathInfo) {
    return false
  }

  const { normalizedPath, hasTrailingSlash } = pathInfo

  // Step 2: Check if path exists with all requirements satisfied
  return checkPathExists(normalizedPath, hasTrailingSlash)
}
