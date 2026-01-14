/**
 * unlink - Remove a file from the filesystem
 *
 * Removes a file or symlink from the filesystem.
 * Does NOT remove directories (use rmdir for that).
 *
 * POSIX semantics:
 * - Removes the directory entry for a file
 * - For symlinks, removes the symlink itself (not the target)
 * - Does not follow symbolic links
 * - Decrements the link count; storage is freed when count reaches 0
 * - Cannot remove directories (use rmdir or rm -r)
 *
 * @module core/fs/unlink
 */

import { ENOENT, EISDIR, ENOTDIR } from '../errors'
import { normalize } from '../path'

/**
 * File entry in the virtual filesystem.
 *
 * Represents a file, directory, or symlink in the virtual filesystem.
 * This is a simplified interface for testing; production uses FileEntry from types.ts.
 */
export interface FileEntry {
  /** Entry type: regular file, directory, or symbolic link */
  type: 'file' | 'directory' | 'symlink'

  /** File content (for inline storage) */
  content?: Uint8Array

  /** Symlink target path (for symlinks only) */
  target?: string

  /** Reference to blob storage (for large files) */
  blobId?: string

  /** Hard link count (default: 1 for files, 2+ for directories) */
  nlink?: number
}

/**
 * Filesystem context for unlink operation.
 *
 * Provides the filesystem state needed for unlink operations.
 * In production, this is backed by SQLite; in tests, by in-memory Maps.
 */
export interface UnlinkContext {
  /** Map of path -> file entry */
  files: Map<string, FileEntry>

  /** Optional blob storage for file content */
  blobs?: Map<string, Uint8Array>

  /** Optional blob reference counts for hard link support */
  blobRefCounts?: Map<string, number>
}

/**
 * Global filesystem context (set during testing or initialization)
 */
let globalContext: UnlinkContext | null = null

/**
 * Set the global filesystem context.
 *
 * Used for testing or when a single filesystem instance is shared.
 * In production, context is typically set per-request or per-DO instance.
 *
 * @param ctx - The filesystem context, or null to clear
 */
export function setContext(ctx: UnlinkContext | null): void {
  globalContext = ctx
}

/**
 * Get the current filesystem context.
 *
 * @returns The current context, or null if not initialized
 */
export function getContext(): UnlinkContext | null {
  return globalContext
}

/**
 * Remove a file or symlink from the filesystem.
 *
 * Implements POSIX unlink(2) semantics:
 * - Removes the directory entry for the specified path
 * - For regular files, decrements the link count
 * - For symlinks, removes the symlink itself (does not follow)
 * - Cannot remove directories (throws EISDIR)
 * - Blob storage is freed when no more links reference it
 *
 * @param path - The path to the file or symlink to remove
 * @returns Promise that resolves to undefined on success
 *
 * @throws {ENOENT} If the file does not exist or path is empty
 * @throws {EISDIR} If the path is a directory (use rmdir instead)
 * @throws {ENOTDIR} If a path component is not a directory (trailing slash on file)
 *
 * @example
 * ```typescript
 * // Remove a regular file
 * await unlink('/tmp/myfile.txt')
 *
 * // Remove a symlink (not its target)
 * await unlink('/tmp/mylink')
 *
 * // Error: cannot unlink directories
 * await unlink('/tmp/mydir') // throws EISDIR
 * ```
 */
export async function unlink(path: string): Promise<void> {
  // Validate path - empty or whitespace-only paths are invalid
  if (!path || path.trim() === '') {
    // EINVAL is more semantically correct for empty paths,
    // but ENOENT is what Node.js throws for empty string
    throw new ENOENT('unlink', path)
  }

  // Check for trailing slash before normalization
  // A trailing slash indicates directory intent; for files this is ENOTDIR
  const hasTrailingSlash = path !== '/' && path.endsWith('/')

  // Normalize the path (removes trailing slashes, resolves . and ..)
  const normalizedPath = normalize(path)

  // Check for root path - cannot unlink root directory
  if (normalizedPath === '/') {
    throw new EISDIR('unlink', normalizedPath)
  }

  // Get context - throw descriptive error if not initialized
  const ctx = globalContext
  if (!ctx) {
    throw new Error('Filesystem context not initialized. Call setContext() first.')
  }

  // Get the file entry
  const entry = ctx.files.get(normalizedPath)

  // Check if file exists
  if (!entry) {
    throw new ENOENT('unlink', normalizedPath)
  }

  // Check if it's a directory
  if (entry.type === 'directory') {
    throw new EISDIR('unlink', normalizedPath)
  }

  // Handle trailing slash on file/symlink - this is ENOTDIR (not a directory)
  // User expected a directory but found a file
  if (hasTrailingSlash) {
    throw new ENOTDIR('unlink', path)
  }

  // For symlinks, we remove the symlink itself (not the target)
  // This is the correct POSIX behavior - unlink never follows symlinks

  // Handle blob cleanup with reference counting
  if (entry.blobId && ctx.blobs) {
    const blobId = entry.blobId

    if (ctx.blobRefCounts) {
      // Reference counting mode: decrement and only delete when zero
      const currentCount = ctx.blobRefCounts.get(blobId) ?? 1
      const newCount = currentCount - 1

      if (newCount <= 0) {
        // No more references - safe to delete blob
        ctx.blobs.delete(blobId)
        ctx.blobRefCounts.delete(blobId)
      } else {
        // Still has references - just update count
        ctx.blobRefCounts.set(blobId, newCount)
      }
    } else {
      // Simple mode: just delete the blob
      // This is correct for single-link files (most common case)
      ctx.blobs.delete(blobId)
    }
  }

  // Remove the file entry from the filesystem
  ctx.files.delete(normalizedPath)

  // Return undefined on success (POSIX behavior)
  return undefined
}
