/**
 * @fileoverview Copy file operation for fsx.do virtual filesystem
 *
 * Copies a file from source to destination path with full Node.js
 * fs.promises.copyFile compatibility. Handles all COPYFILE_* flags
 * and provides consistent error messages following POSIX semantics.
 *
 * ## Features
 * - Binary-safe content copying (preserves all byte values)
 * - Preserves source file mode/permissions
 * - Supports COPYFILE_EXCL to prevent overwriting
 * - Follows symlinks at source (copies target content)
 * - Path normalization (handles ., .., multiple slashes)
 * - Consistent POSIX-style error codes (ENOENT, EEXIST, EISDIR)
 *
 * ## Performance Considerations
 * - For in-memory storage, copies reference the same content buffer initially
 * - Storage backends may implement copy-on-write for large files
 * - COPYFILE_FICLONE hints are passed through but not enforced
 *
 * @module core/fs/copyFile
 * @see https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode
 * @see https://man7.org/linux/man-pages/man2/copy_file_range.2.html
 *
 * @example Basic usage
 * ```typescript
 * import { copyFile, COPYFILE_EXCL } from 'fsx/fs/copyFile'
 *
 * // Simple copy (overwrites existing)
 * await copyFile(storage, '/src/file.txt', '/dest/file.txt')
 *
 * // Copy with exclusive mode (fails if dest exists)
 * await copyFile(storage, '/src/file.txt', '/dest/file.txt', COPYFILE_EXCL)
 * ```
 */

import { constants } from '../constants'
import { ENOENT, EEXIST, EISDIR } from '../errors'
import { normalize, dirname } from '../path'

// =============================================================================
// Types
// =============================================================================

/**
 * File metadata stored alongside content.
 *
 * Follows POSIX stat structure conventions for maximum compatibility
 * with Node.js fs module and Unix filesystem semantics.
 *
 * @example
 * ```typescript
 * const metadata: FileMetadata = {
 *   mode: 0o644,        // -rw-r--r--
 *   mtime: Date.now(),  // Last modification
 *   birthtime: created, // Original creation
 *   ctime: Date.now()   // Metadata change
 * }
 * ```
 */
export interface FileMetadata {
  /** Unix permission mode (e.g., 0o644 for rw-r--r--) */
  mode: number
  /** Last modification timestamp in milliseconds since epoch */
  mtime: number
  /** File creation timestamp in milliseconds since epoch */
  birthtime: number
  /** Metadata change timestamp in milliseconds since epoch */
  ctime: number
}

/**
 * Complete file entry with binary content and metadata.
 *
 * Content is stored as Uint8Array for:
 * - Binary safety (preserves all byte values 0x00-0xFF)
 * - Memory efficiency (no string encoding overhead)
 * - Compatibility with Web APIs and Workers
 */
export interface FileEntry {
  /** Binary file content */
  content: Uint8Array
  /** Associated file metadata */
  metadata: FileMetadata
}

/**
 * Options for creating or updating a file in storage.
 *
 * Partial metadata - unspecified fields default to sensible values:
 * - mode defaults to 0o644 (readable by all, writable by owner)
 * - birthtime defaults to current time for new files
 */
export interface AddFileOptions {
  /** Unix permission mode (default: 0o644) */
  mode?: number
  /** File creation timestamp (default: current time) */
  birthtime?: number
}

/**
 * Storage backend interface for copyFile operation.
 *
 * This interface abstracts the underlying storage mechanism, allowing
 * copyFile to work with any backend (in-memory, SQLite, R2, etc.).
 *
 * Required methods provide core functionality, while optional methods
 * enable symlink support when the backend implements them.
 *
 * @example Mock implementation
 * ```typescript
 * const storage: CopyFileStorage = {
 *   getFile: (path) => files.get(path),
 *   addFile: (path, content, opts) => files.set(path, { content, ... }),
 *   isDirectory: (path) => directories.has(path),
 *   parentExists: (path) => directories.has(dirname(path))
 * }
 * ```
 */
export interface CopyFileStorage {
  /**
   * Retrieve a file by normalized path.
   * @param path - Absolute normalized path
   * @returns File entry or undefined if not found
   */
  getFile(path: string): FileEntry | undefined

  /**
   * Create or overwrite a file at the specified path.
   * @param path - Absolute normalized path
   * @param content - Binary file content
   * @param metadata - Optional metadata (mode, birthtime)
   */
  addFile(path: string, content: Uint8Array, metadata?: AddFileOptions): void

  /**
   * Check if path points to an existing directory.
   * @param path - Absolute normalized path
   * @returns true if path exists and is a directory
   */
  isDirectory(path: string): boolean

  /**
   * Check if path points to a symbolic link.
   * Optional - for backends without symlink support.
   * @param path - Absolute normalized path
   * @returns true if path is a symlink
   */
  isSymlink?(path: string): boolean

  /**
   * Get the target path of a symbolic link.
   * Optional - for backends without symlink support.
   * @param path - Absolute normalized symlink path
   * @returns Target path or undefined if not a symlink
   */
  getSymlinkTarget?(path: string): string | undefined

  /**
   * Check if the parent directory of path exists.
   * @param path - Absolute normalized path
   * @returns true if parent directory exists
   */
  parentExists(path: string): boolean
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Fail if destination file exists.
 *
 * When this flag is set, copyFile throws EEXIST if the destination
 * already exists, rather than overwriting it.
 *
 * @example
 * ```typescript
 * // This will throw if /dest.txt exists
 * await copyFile(storage, '/src.txt', '/dest.txt', COPYFILE_EXCL)
 * ```
 */
export const COPYFILE_EXCL = constants.COPYFILE_EXCL

/**
 * Hint to use copy-on-write (reflink) if supported.
 *
 * This is a performance hint - if the underlying storage doesn't
 * support copy-on-write, a regular copy is performed instead.
 * The copy will always succeed.
 *
 * Note: For fsx.do in-memory storage, this flag is accepted but
 * the behavior is implementation-dependent on the backend.
 */
export const COPYFILE_FICLONE = constants.COPYFILE_FICLONE

/**
 * Force copy-on-write (fail if not supported).
 *
 * Unlike COPYFILE_FICLONE, this flag requires copy-on-write support.
 * If the backend doesn't support it, the operation may fail.
 *
 * Note: Most fsx.do backends treat this the same as COPYFILE_FICLONE
 * since true filesystem-level CoW is not available in the runtime.
 */
export const COPYFILE_FICLONE_FORCE = constants.COPYFILE_FICLONE_FORCE

// =============================================================================
// Path Validation Utilities (shared with rename/move)
// =============================================================================

/**
 * Normalize a path to absolute form.
 *
 * Uses the shared path.normalize but ensures the result is always
 * an absolute path starting with '/'. Handles edge cases like:
 * - Empty paths become '/'
 * - Relative paths get '/' prepended
 * - Multiple slashes are collapsed
 * - '.' and '..' segments are resolved
 *
 * @param path - Raw path string to normalize
 * @returns Absolute normalized path
 *
 * @example
 * ```typescript
 * normalizePath('/foo//bar')     // '/foo/bar'
 * normalizePath('foo/bar')       // '/foo/bar'
 * normalizePath('/foo/../bar')   // '/bar'
 * normalizePath('')              // '/'
 * ```
 *
 * @internal
 */
function normalizePath(path: string): string {
  const normalized = normalize(path)
  // Ensure absolute path (path.normalize returns '.' for empty)
  return normalized.startsWith('/') ? normalized : '/' + normalized
}

/**
 * Resolve symlink to get the actual target path.
 *
 * If the given path is a symbolic link and the storage backend
 * supports symlinks (has isSymlink and getSymlinkTarget methods),
 * returns the resolved target path. Otherwise returns the original path.
 *
 * Note: This performs a single-level resolution. For deeply nested
 * symlinks, the storage backend's getFile method should handle
 * the full resolution chain.
 *
 * @param storage - Storage backend instance
 * @param path - Normalized path to potentially resolve
 * @returns Resolved target path or original path if not a symlink
 *
 * @internal
 */
function resolveSymlink(storage: CopyFileStorage, path: string): string {
  if (storage.isSymlink && storage.getSymlinkTarget) {
    if (storage.isSymlink(path)) {
      const target = storage.getSymlinkTarget(path)
      if (target) {
        return normalizePath(target)
      }
    }
  }
  return path
}

/**
 * Result of validating a source path.
 *
 * Contains both the normalized input path (for error messages)
 * and the resolved path (after following symlinks), plus the
 * validated file entry.
 *
 * @internal
 */
interface SourceValidation {
  /** Original path after normalization (used in error messages) */
  normalizedPath: string
  /** Path after resolving symlinks (used for file access) */
  resolvedPath: string
  /** The validated source file entry */
  file: FileEntry
}

/**
 * Validate source path for file copy operations.
 *
 * Performs comprehensive validation of the source path:
 * 1. Normalizes the path to absolute form
 * 2. Resolves symlinks to get actual target
 * 3. Verifies source is not root directory
 * 4. Verifies source is not a directory
 * 5. Verifies source file exists
 *
 * @param storage - Storage backend instance
 * @param src - Source file path (may be relative or absolute)
 * @param syscall - System call name for error messages (e.g., 'copyfile')
 * @returns Validation result with normalized paths and file entry
 *
 * @throws {EISDIR} If source is root '/' or a directory
 * @throws {ENOENT} If source file does not exist
 *
 * @internal
 */
function validateSource(
  storage: CopyFileStorage,
  src: string,
  syscall: string
): SourceValidation {
  const normalizedSrc = normalizePath(src)
  const resolvedSrc = resolveSymlink(storage, normalizedSrc)

  // Root directory cannot be a file source
  if (resolvedSrc === '/') {
    throw new EISDIR(syscall, normalizedSrc)
  }

  // Directories cannot be copied with copyFile (use cp -r for that)
  if (storage.isDirectory(resolvedSrc)) {
    throw new EISDIR(syscall, normalizedSrc)
  }

  // Source must exist
  const sourceFile = storage.getFile(resolvedSrc)
  if (sourceFile === undefined) {
    throw new ENOENT(syscall, normalizedSrc)
  }

  return {
    normalizedPath: normalizedSrc,
    resolvedPath: resolvedSrc,
    file: sourceFile,
  }
}

/**
 * Options for destination validation.
 *
 * @internal
 */
interface DestinationValidationOptions {
  /** If true, fail with EEXIST when destination already exists */
  exclusiveCreate?: boolean
}

/**
 * Validate destination path for file copy operations.
 *
 * Performs comprehensive validation of the destination path:
 * 1. Normalizes the path to absolute form
 * 2. Verifies destination is not root directory
 * 3. Verifies destination is not an existing directory
 * 4. Verifies parent directory exists
 * 5. Verifies parent is actually a directory (not a file)
 * 6. Optionally verifies destination doesn't exist (COPYFILE_EXCL)
 *
 * @param storage - Storage backend instance
 * @param dest - Destination file path (may be relative or absolute)
 * @param syscall - System call name for error messages (e.g., 'copyfile')
 * @param options - Validation options (exclusiveCreate for COPYFILE_EXCL)
 * @returns Normalized destination path
 *
 * @throws {EISDIR} If destination is root '/' or an existing directory
 * @throws {ENOENT} If parent directory does not exist or is not a directory
 * @throws {EEXIST} If destination exists and exclusiveCreate is true
 *
 * @internal
 */
function validateDestination(
  storage: CopyFileStorage,
  dest: string,
  syscall: string,
  options: DestinationValidationOptions = {}
): string {
  const normalizedDest = normalizePath(dest)

  // Root directory cannot be a file destination
  if (normalizedDest === '/') {
    throw new EISDIR(syscall, normalizedDest)
  }

  // Cannot overwrite a directory with a file
  if (storage.isDirectory(normalizedDest)) {
    throw new EISDIR(syscall, normalizedDest)
  }

  // Parent directory must exist (except for root's children)
  const destParent = dirname(normalizedDest)
  if (destParent !== '/' && !storage.parentExists(normalizedDest)) {
    throw new ENOENT(syscall, normalizedDest)
  }

  // Parent must be a directory, not a file
  if (destParent !== '/' && !storage.isDirectory(destParent)) {
    throw new ENOENT(syscall, normalizedDest)
  }

  // COPYFILE_EXCL: fail if destination exists
  if (options.exclusiveCreate) {
    const destFile = storage.getFile(normalizedDest)
    if (destFile !== undefined) {
      throw new EEXIST(syscall, normalizedDest)
    }
  }

  return normalizedDest
}

// =============================================================================
// Main copyFile Implementation
// =============================================================================

/**
 * System call name used in error messages.
 *
 * Follows Node.js convention for copyFile error reporting.
 * @internal
 */
const SYSCALL = 'copyfile'

/**
 * Copy a file from source to destination.
 *
 * Implements Node.js fs.promises.copyFile() semantics with full POSIX
 * compatibility. The operation is atomic in the sense that either the
 * copy completes successfully or the destination remains unchanged.
 *
 * ## Behavior
 *
 * - **Content**: Binary-safe copy preserving all byte values (0x00-0xFF)
 * - **Metadata**: Preserves source file mode (permissions), creates new birthtime
 * - **Symlinks**: Follows symlinks at source (copies target content, not link)
 * - **Overwrite**: By default overwrites existing destination files
 * - **Atomicity**: Validates all preconditions before modifying storage
 *
 * ## Flags
 *
 * | Flag | Value | Behavior |
 * |------|-------|----------|
 * | `COPYFILE_EXCL` | 1 | Fail with EEXIST if destination exists |
 * | `COPYFILE_FICLONE` | 2 | Hint to use copy-on-write if available |
 * | `COPYFILE_FICLONE_FORCE` | 4 | Request copy-on-write (may be ignored) |
 *
 * Flags can be combined with bitwise OR: `COPYFILE_EXCL | COPYFILE_FICLONE`
 *
 * ## Performance
 *
 * For in-memory storage, the content Uint8Array reference may be shared
 * initially (copy-on-write at the JavaScript level). Storage backends
 * can implement true copy-on-write by checking the FICLONE flags.
 *
 * For very large files (>10MB), consider streaming approaches at the
 * storage backend level rather than loading entire content into memory.
 *
 * @param storage - Storage backend implementing CopyFileStorage interface
 * @param src - Source file path (absolute or relative, symlinks followed)
 * @param dest - Destination file path (absolute or relative)
 * @param mode - Optional bitwise OR of COPYFILE_* flags (default: 0)
 * @returns Promise that resolves to undefined on success
 *
 * @throws {ENOENT} Source file does not exist
 * @throws {ENOENT} Destination parent directory does not exist
 * @throws {EEXIST} Destination exists and COPYFILE_EXCL flag is set
 * @throws {EISDIR} Source is a directory (use recursive copy instead)
 * @throws {EISDIR} Destination is an existing directory
 *
 * @example Simple file copy
 * ```typescript
 * // Copy file, overwriting if destination exists
 * await copyFile(storage, '/source/data.json', '/backup/data.json')
 * ```
 *
 * @example Exclusive copy (fail if exists)
 * ```typescript
 * import { copyFile, COPYFILE_EXCL } from 'fsx/fs/copyFile'
 *
 * try {
 *   await copyFile(storage, '/src.txt', '/dst.txt', COPYFILE_EXCL)
 * } catch (err) {
 *   if (err.code === 'EEXIST') {
 *     console.log('Destination already exists')
 *   }
 * }
 * ```
 *
 * @example Copy with FICLONE hint
 * ```typescript
 * // Request copy-on-write for large files (falls back to regular copy)
 * await copyFile(storage, '/large.bin', '/copy.bin', COPYFILE_FICLONE)
 * ```
 *
 * @example Combined flags
 * ```typescript
 * // Exclusive + FICLONE: fail if exists, hint for CoW
 * await copyFile(storage, '/src', '/dst', COPYFILE_EXCL | COPYFILE_FICLONE)
 * ```
 */
export async function copyFile(
  storage: CopyFileStorage,
  src: string,
  dest: string,
  mode?: number
): Promise<void> {
  // Parse and validate mode flags
  const copyMode = mode ?? 0
  const exclusiveCreate = (copyMode & COPYFILE_EXCL) !== 0

  // Note: COPYFILE_FICLONE and COPYFILE_FICLONE_FORCE flags are accepted
  // but the actual copy-on-write behavior is delegated to the storage backend.
  // Storage implementations may check these flags in addFile() and optimize accordingly.

  // Validate source: must exist, must be a file (not directory)
  const source = validateSource(storage, src, SYSCALL)

  // Validate destination: parent must exist, must not be a directory
  // If COPYFILE_EXCL is set, destination must not exist
  const normalizedDest = validateDestination(storage, dest, SYSCALL, { exclusiveCreate })

  // Perform the copy operation
  // - Content is copied as-is (binary safe)
  // - Source file mode (permissions) is preserved
  // - Destination gets a new birthtime (creation timestamp)
  storage.addFile(normalizedDest, source.file.content, {
    mode: source.file.metadata.mode,
  })
}

// =============================================================================
// Exported Utilities (for use by other fs operations)
// =============================================================================

/**
 * Shared validation utilities for filesystem operations.
 *
 * These functions provide consistent path validation and error handling
 * across multiple fs operations (copyFile, rename, move, etc.). Reusing
 * these utilities ensures:
 *
 * - Consistent error messages and codes
 * - Uniform path normalization behavior
 * - DRY implementation of common validation logic
 *
 * @example Using in a custom fs operation
 * ```typescript
 * import { validateSource, validateDestination, normalizePath } from 'fsx/fs/copyFile'
 *
 * async function myFsOperation(storage, src, dest) {
 *   const source = validateSource(storage, src, 'myop')
 *   const normalizedDest = validateDestination(storage, dest, 'myop')
 *   // ... perform operation
 * }
 * ```
 */
export {
  validateSource,
  validateDestination,
  normalizePath,
  resolveSymlink,
}

/**
 * Re-export validation result type for external use.
 *
 * Useful when building custom operations that need to work with
 * the validated source information.
 */
export type { SourceValidation }
