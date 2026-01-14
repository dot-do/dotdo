/**
 * rename - Move/rename a file or directory
 *
 * Atomically renames/moves a file or directory from oldPath to newPath.
 * If newPath exists, it will be atomically replaced (with some exceptions).
 *
 * Optimizations:
 * - Atomic rename for in-memory filesystem (single-pass operation)
 * - Directory moves preserve all nested contents atomically
 * - Shared path validation utilities for consistency with copyFile
 *
 * @module core/fs/rename
 * @see https://man7.org/linux/man-pages/man2/rename.2.html
 */

import { ENOENT, EISDIR, ENOTDIR, ENOTEMPTY, EINVAL, EEXIST } from '../errors'
import { normalize, dirname } from '../path'

// ============================================
// Types & Interfaces
// ============================================

/**
 * File entry in the virtual filesystem.
 * Represents a file, directory, or symbolic link with optional metadata.
 */
export interface FileEntry {
  /** The type of filesystem entry */
  type: 'file' | 'directory' | 'symlink'
  /** File content (for files with inline content) */
  content?: Uint8Array
  /** Symlink target path (for symlinks only) */
  target?: string
  /** Reference to blob storage (for content-addressed files) */
  blobId?: string
  /** Unix file mode/permissions (e.g., 0o644) */
  mode?: number
  /** Last modification time (Unix timestamp in ms) */
  mtime?: number
  /** Creation/change time (Unix timestamp in ms) */
  ctime?: number
}

/**
 * Filesystem context for rename operation.
 * Provides access to the file and blob maps.
 */
export interface RenameContext {
  /** Map of normalized paths to file entries */
  files: Map<string, FileEntry>
  /** Optional map of blob IDs to content (for content-addressed storage) */
  blobs?: Map<string, Uint8Array>
}

/**
 * Options for rename operation.
 */
export interface RenameOptions {
  /**
   * Allow overwriting existing files/directories.
   * - true: Overwrite existing target (default, POSIX behavior)
   * - false: Throw EEXIST if target exists
   * @default true
   */
  overwrite?: boolean
}

// ============================================
// Shared Path Validation Utilities
// (Exported for reuse by copyFile and other fs operations)
// ============================================

/**
 * Normalize and validate a path for filesystem operations.
 * Returns normalized path or throws appropriate error.
 *
 * @param path - The path to validate
 * @param syscall - The syscall name for error reporting
 * @returns Normalized path
 * @throws {ENOENT} If path is empty or resolves to current directory
 */
export function validatePath(path: string, syscall: string): string {
  const normalizedPath = normalize(path)

  if (normalizedPath === '' || normalizedPath === '.') {
    throw new ENOENT(syscall, path)
  }

  return normalizedPath
}

/**
 * Check if a parent directory exists and is a directory.
 *
 * @param files - The filesystem map
 * @param path - The path whose parent to check
 * @param syscall - The syscall name for error reporting
 * @throws {ENOENT} If parent directory does not exist or is not a directory
 */
export function validateParentDirectory(
  files: Map<string, FileEntry>,
  path: string,
  syscall: string
): void {
  const parentPath = dirname(path)

  if (parentPath !== '/') {
    const parentEntry = files.get(parentPath)
    if (!parentEntry || parentEntry.type !== 'directory') {
      throw new ENOENT(syscall, path)
    }
  }
}

/**
 * Check if moving a directory into itself (EINVAL condition).
 *
 * @param oldPath - Source path (must be a directory)
 * @param newPath - Destination path
 * @param syscall - The syscall name for error reporting
 * @throws {EINVAL} If newPath is inside oldPath
 */
export function validateNotMoveIntoSelf(
  oldPath: string,
  newPath: string,
  syscall: string
): void {
  if (newPath.startsWith(oldPath + '/')) {
    throw new EINVAL(syscall, oldPath)
  }
}

/**
 * Check if an entry is a file-like type (file or symlink).
 * Symlinks are treated as files for overwrite conflict purposes.
 *
 * @param entry - The file entry to check
 * @returns true if the entry is a file or symlink
 */
export function isFileLike(entry: FileEntry): boolean {
  return entry.type === 'file' || entry.type === 'symlink'
}

// ============================================
// Context Management
// ============================================

/**
 * Global filesystem context (set during testing or initialization)
 * @internal
 */
let globalContext: RenameContext | null = null

/**
 * Set the global filesystem context.
 * Used for testing or when a single filesystem instance is shared.
 *
 * @param ctx - The filesystem context to use, or null to clear
 * @example
 * ```ts
 * setContext({ files: new Map(), blobs: new Map() })
 * await rename('/old.txt', '/new.txt')
 * setContext(null)
 * ```
 */
export function setContext(ctx: RenameContext | null): void {
  globalContext = ctx
}

/**
 * Get the current filesystem context.
 *
 * @returns The current context or null if not set
 */
export function getContext(): RenameContext | null {
  return globalContext
}

// ============================================
// Rename Implementation
// ============================================

/**
 * Renames/moves a file or directory from oldPath to newPath.
 *
 * The operation is atomic for single files - either the rename succeeds
 * completely or the original file remains untouched. For directories,
 * all validation is performed before any modifications to ensure
 * consistency.
 *
 * @param oldPath - The current path of the file or directory
 * @param newPath - The new path for the file or directory
 * @param options - Optional settings for the rename operation
 * @returns Promise that resolves to undefined on success
 *
 * @throws {ENOENT} If oldPath does not exist
 * @throws {ENOENT} If the parent directory of newPath does not exist
 * @throws {EISDIR} If oldPath is a file/symlink but newPath is an existing directory
 * @throws {ENOTDIR} If oldPath is a directory but newPath is an existing file/symlink
 * @throws {ENOTEMPTY} If newPath is a non-empty directory
 * @throws {EINVAL} If newPath is inside oldPath (cannot move directory into itself)
 * @throws {EEXIST} If options.overwrite is false and newPath exists
 * @throws {Error} If no filesystem context is set
 *
 * @example
 * ```ts
 * // Simple rename in same directory
 * await rename('/old.txt', '/new.txt')
 *
 * // Cross-directory move
 * await rename('/src/file.txt', '/dest/file.txt')
 *
 * // Rename directory (moves all contents)
 * await rename('/old-dir', '/new-dir')
 *
 * // Prevent overwriting existing files
 * await rename('/source.txt', '/target.txt', { overwrite: false })
 * ```
 */
export async function rename(
  oldPath: string,
  newPath: string,
  options: RenameOptions = {}
): Promise<void> {
  const { overwrite = true } = options

  const ctx = getContext()
  if (!ctx) {
    throw new Error('No filesystem context set. Call setContext() before using rename().')
  }

  // Use shared validation utilities
  const normalizedOldPath = validatePath(oldPath, 'rename')
  const normalizedNewPath = validatePath(newPath, 'rename')

  // Check if source exists
  const oldEntry = ctx.files.get(normalizedOldPath)
  if (!oldEntry) {
    throw new ENOENT('rename', normalizedOldPath)
  }

  // EINVAL check: cannot move directory into itself
  // Must be checked BEFORE parent directory validation since the invalid target
  // parent path wouldn't exist (e.g., /dir1/inside when moving /dir1 there)
  if (oldEntry.type === 'directory') {
    validateNotMoveIntoSelf(normalizedOldPath, normalizedNewPath, 'rename')
  }

  // Validate destination parent directory exists
  validateParentDirectory(ctx.files, normalizedNewPath, 'rename')

  // Same-path rename is a no-op (common optimization)
  if (normalizedOldPath === normalizedNewPath) {
    return
  }

  // Handle destination conflicts
  const newEntry = ctx.files.get(normalizedNewPath)
  let removeEmptyTargetDir = false

  if (newEntry) {
    // Check overwrite option first
    if (!overwrite) {
      throw new EEXIST('rename', normalizedNewPath)
    }

    const oldIsDir = oldEntry.type === 'directory'
    const newIsDir = newEntry.type === 'directory'
    const oldIsFileOrLink = isFileLike(oldEntry)
    const newIsFileOrLink = isFileLike(newEntry)

    if (oldIsFileOrLink && newIsDir) {
      // Cannot overwrite a directory with a file or symlink
      throw new EISDIR('rename', normalizedNewPath)
    }

    if (oldIsDir && newIsFileOrLink) {
      // Cannot overwrite a file or symlink with a directory
      throw new ENOTDIR('rename', normalizedNewPath)
    }

    if (oldIsDir && newIsDir) {
      // Directory-to-directory: only allowed if target is empty
      if (isDirectoryNonEmpty(ctx.files, normalizedNewPath)) {
        throw new ENOTEMPTY('rename', normalizedNewPath)
      }
      // Mark for removal (done atomically with the move below)
      removeEmptyTargetDir = true
    }

    // File/symlink overwriting file/symlink is allowed - handled below
  }

  // Perform the atomic rename operation
  if (oldEntry.type === 'directory') {
    moveDirectory(ctx.files, normalizedOldPath, normalizedNewPath, removeEmptyTargetDir)
  } else {
    // Single file or symlink move - truly atomic operation
    ctx.files.delete(normalizedOldPath)
    ctx.files.set(normalizedNewPath, oldEntry)
  }
}

/**
 * Move a directory and all its contents atomically.
 *
 * @param files - The filesystem map
 * @param oldPath - The normalized source directory path
 * @param newPath - The normalized destination directory path
 * @param removeEmptyTarget - Whether to remove an existing empty directory at newPath
 * @internal
 */
function moveDirectory(
  files: Map<string, FileEntry>,
  oldPath: string,
  newPath: string,
  removeEmptyTarget: boolean
): void {
  // Collect all entries to move before modifying the map
  // This ensures atomicity - if anything goes wrong during collection,
  // we haven't modified the filesystem yet
  const entriesToMove: Array<[string, string, FileEntry]> = []
  const oldPrefix = oldPath + '/'

  for (const [path, entry] of files) {
    if (path === oldPath || path.startsWith(oldPrefix)) {
      const relativePath = path.slice(oldPath.length)
      const newFullPath = newPath + relativePath
      entriesToMove.push([path, newFullPath, entry])
    }
  }

  // Remove empty target directory if needed (before adding new entries)
  if (removeEmptyTarget) {
    files.delete(newPath)
  }

  // Perform the move: delete old paths and add new paths
  // We do this in two passes to avoid iterator invalidation issues
  for (const [oldFullPath] of entriesToMove) {
    files.delete(oldFullPath)
  }
  for (const [, newFullPath, entry] of entriesToMove) {
    files.set(newFullPath, entry)
  }
}

/**
 * Check if a directory contains any entries (files, subdirectories, or symlinks).
 *
 * @param files - The files map to check
 * @param dirPath - The normalized directory path to check
 * @returns true if the directory has any children, false if empty
 * @internal
 */
function isDirectoryNonEmpty(files: Map<string, FileEntry>, dirPath: string): boolean {
  const prefix = dirPath + '/'
  for (const path of files.keys()) {
    if (path.startsWith(prefix)) {
      return true
    }
  }
  return false
}
