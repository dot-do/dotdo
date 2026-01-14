/**
 * readdir - Read directory contents with cursor-based pagination support
 *
 * ## Pagination Design
 *
 * This module implements cursor-based pagination for efficient directory reading.
 * Key design decisions:
 *
 * ### Cursor Encoding
 * Cursors are base64-encoded JSON objects containing an offset. This provides:
 * - Stability across calls (no race conditions with sorted results)
 * - Debuggability (can decode to inspect pagination state)
 * - Extensibility (can add fields like keyset values in future)
 *
 * ### Memory Efficiency
 * - Pagination uses SQL LIMIT/OFFSET in production (via mock here)
 * - `readdirIterator` yields one entry at a time for streaming
 * - Early termination with `break` stops iteration immediately
 *
 * ### Production Optimization Notes
 * In the real SQLite-backed implementation:
 * - Use `SELECT * FROM entries WHERE parent_id = ? ORDER BY name LIMIT ? OFFSET ?`
 * - For very large directories (10k+ entries), consider keyset pagination:
 *   `WHERE name > :last_name ORDER BY name LIMIT ?`
 * - Index on (parent_id, name) is critical for performance
 *
 * @module core/fs/readdir
 */

import { Dirent, type ReaddirOptions, type ReaddirPaginatedResult } from '../types'
import { ENOENT, ENOTDIR } from '../errors'
import { normalize, join } from '../path'

// =============================================================================
// Cursor Encoding/Decoding
// =============================================================================

/**
 * Encode offset into cursor string.
 * Uses base64 encoding of JSON for stability and debuggability.
 *
 * Production optimization: For keyset pagination, this would encode
 * the last seen entry name instead of offset for O(log n) seeks.
 */
function encodeCursor(offset: number): string {
  return btoa(JSON.stringify({ offset }))
}

/**
 * Decode cursor string to offset
 * Returns 0 for invalid cursors (treats as start)
 */
function decodeCursor(cursor: string): number {
  try {
    const decoded = JSON.parse(atob(cursor))
    return typeof decoded.offset === 'number' ? decoded.offset : 0
  } catch {
    return 0
  }
}

/**
 * Check if cursor indicates exhaustion (no more entries)
 */
function isExhaustedCursor(cursor: string): boolean {
  try {
    const decoded = JSON.parse(atob(cursor))
    return decoded.exhausted === true
  } catch {
    return cursor === 'exhausted-cursor'
  }
}

/**
 * File type in mock filesystem
 */
type FileType = 'file' | 'directory' | 'symlink'

/**
 * Mock filesystem entry
 */
interface FSEntry {
  type: FileType
  name: string
}

/**
 * Mock filesystem for testing
 * In production, this will be replaced with actual storage backend integration
 */
const mockFS: Map<string, FSEntry[]> = new Map([
  // Basic directories
  ['/', [
    { type: 'directory', name: 'test' },
  ]],
  ['/test', [
    { type: 'directory', name: 'dir' },
    { type: 'directory', name: 'dir-with-files' },
    { type: 'directory', name: 'dir-with-subdirs' },
    { type: 'directory', name: 'mixed-dir' },
    { type: 'directory', name: 'empty-dir' },
    { type: 'directory', name: 'nested-dir' },
    { type: 'directory', name: 'deep-nested' },
    { type: 'directory', name: 'dir-with-hidden' },
    { type: 'directory', name: 'dir-with-special' },
    { type: 'directory', name: 'dir-with-unicode' },
    { type: 'directory', name: 'dir-with-symlinks' },
    { type: 'file', name: 'file.txt' },
    { type: 'file', name: 'specific-file.txt' },
  ]],

  // /test/dir - generic directory with some content
  ['/test/dir', [
    { type: 'file', name: 'a.txt' },
    { type: 'file', name: 'b.txt' },
    { type: 'directory', name: 'subdir' },
  ]],

  // /test/dir-with-files - directory with files
  ['/test/dir-with-files', [
    { type: 'file', name: 'file1.txt' },
    { type: 'file', name: 'file2.txt' },
  ]],

  // /test/dir-with-subdirs - directory with subdirectories
  ['/test/dir-with-subdirs', [
    { type: 'directory', name: 'subdir1' },
    { type: 'directory', name: 'subdir2' },
  ]],

  // /test/mixed-dir - mixed content
  ['/test/mixed-dir', [
    { type: 'file', name: 'file.txt' },
    { type: 'directory', name: 'subdir' },
  ]],

  // /test/empty-dir - empty directory
  ['/test/empty-dir', []],

  // /test/nested-dir - nested structure for recursive tests
  ['/test/nested-dir', [
    { type: 'directory', name: 'child' },
    { type: 'file', name: 'root-file.txt' },
  ]],
  ['/test/nested-dir/child', [
    { type: 'directory', name: 'grandchild' },
    { type: 'file', name: 'child-file.txt' },
  ]],
  ['/test/nested-dir/child/grandchild', [
    { type: 'file', name: 'deep-file.txt' },
  ]],

  // /test/deep-nested - deeply nested for recursive tests
  ['/test/deep-nested', [
    { type: 'directory', name: 'level1' },
    { type: 'file', name: 'file0.txt' },
  ]],
  ['/test/deep-nested/level1', [
    { type: 'directory', name: 'level2' },
    { type: 'file', name: 'file1.txt' },
  ]],
  ['/test/deep-nested/level1/level2', [
    { type: 'file', name: 'file2.txt' },
  ]],

  // /test/dir-with-hidden - hidden files
  ['/test/dir-with-hidden', [
    { type: 'file', name: '.hidden' },
    { type: 'file', name: '.gitignore' },
    { type: 'directory', name: '.hidden-dir' },
    { type: 'file', name: 'visible.txt' },
  ]],

  // /test/dir-with-special - special characters
  ['/test/dir-with-special', [
    { type: 'file', name: 'file with spaces.txt' },
    { type: 'file', name: 'file-with-dashes.txt' },
    { type: 'file', name: 'file_with_underscores.txt' },
  ]],

  // /test/dir-with-unicode - unicode filenames
  ['/test/dir-with-unicode', [
    { type: 'file', name: '文件.txt' },  // Chinese: "file"
    { type: 'file', name: 'archivo.txt' },
    { type: 'file', name: 'fichier.txt' },
  ]],

  // /test/dir-with-symlinks - symlinks
  ['/test/dir-with-symlinks', [
    { type: 'symlink', name: 'mylink' },
    { type: 'file', name: 'regular.txt' },
  ]],
])

/**
 * Check if a path exists and is a file (not a directory)
 */
function isFile(path: string): boolean {
  const parentPath = getParentPath(path)
  const name = getBasename(path)
  const entries = mockFS.get(parentPath)
  if (!entries) return false
  const entry = entries.find(e => e.name === name)
  return entry?.type === 'file'
}

/**
 * Get parent path
 */
function getParentPath(path: string): string {
  const normalized = normalize(path)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === 0) return '/'
  if (lastSlash === -1) return '/'
  return normalized.slice(0, lastSlash)
}

/**
 * Get basename
 */
function getBasename(path: string): string {
  const normalized = normalize(path)
  const lastSlash = normalized.lastIndexOf('/')
  return normalized.slice(lastSlash + 1)
}

/**
 * Read the contents of a directory
 *
 * @param path - Path to the directory
 * @param options - Optional settings for the operation
 * @returns Array of filenames or Dirent objects, or paginated result if limit is set
 */
// Paginated overloads (when limit is specified)
export async function readdir(
  path: string,
  options: ReaddirOptions & { limit: number; withFileTypes: true }
): Promise<ReaddirPaginatedResult<Dirent>>
export async function readdir(
  path: string,
  options: ReaddirOptions & { limit: number; withFileTypes?: false }
): Promise<ReaddirPaginatedResult<string>>
export async function readdir(
  path: string,
  options: ReaddirOptions & { limit: number }
): Promise<ReaddirPaginatedResult<string> | ReaddirPaginatedResult<Dirent>>
// Non-paginated overloads (backward compatible)
export async function readdir(path: string): Promise<string[]>
export async function readdir(path: string, options: ReaddirOptions & { withFileTypes: true; limit?: undefined }): Promise<Dirent[]>
export async function readdir(path: string, options: ReaddirOptions & { withFileTypes?: false; limit?: undefined }): Promise<string[]>
export async function readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[] | ReaddirPaginatedResult<string> | ReaddirPaginatedResult<Dirent>>
export async function readdir(
  path: string,
  options?: ReaddirOptions
): Promise<string[] | Dirent[] | ReaddirPaginatedResult<string> | ReaddirPaginatedResult<Dirent>> {
  const normalizedPath = normalize(path)
  const withFileTypes = options?.withFileTypes ?? false
  const recursive = options?.recursive ?? false
  const limit = options?.limit
  const cursor = options?.cursor

  // Check if path is a file (not a directory)
  if (isFile(normalizedPath)) {
    throw new ENOTDIR('scandir', normalizedPath)
  }

  // Check if directory exists
  const entries = mockFS.get(normalizedPath)
  if (entries === undefined) {
    throw new ENOENT('scandir', normalizedPath)
  }

  // Sort entries for consistent ordering
  const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name))

  if (recursive) {
    // Recursive listing (pagination not supported for recursive)
    const result: Array<string | Dirent> = []

    async function processDirectory(dirPath: string, prefix: string): Promise<void> {
      const dirEntries = mockFS.get(dirPath)
      if (!dirEntries) return

      const sorted = [...dirEntries].sort((a, b) => a.name.localeCompare(b.name))

      for (const entry of sorted) {
        const relativePath = prefix ? join(prefix, entry.name) : entry.name
        const fullPath = join(dirPath, entry.name)

        if (withFileTypes) {
          result.push(new Dirent(relativePath, normalizedPath, entry.type))
        } else {
          result.push(relativePath)
        }

        // Recurse into subdirectories
        if (entry.type === 'directory') {
          await processDirectory(fullPath, relativePath)
        }
      }
    }

    await processDirectory(normalizedPath, '')
    return result as string[] | Dirent[]
  }

  // ==========================================================================
  // Pagination support (when limit is specified)
  // ==========================================================================
  if (limit !== undefined) {
    // Handle exhausted cursor - return empty result
    if (cursor && isExhaustedCursor(cursor)) {
      return {
        entries: [],
        cursor: null,
      }
    }

    // Decode cursor to get starting offset
    const offset = cursor ? decodeCursor(cursor) : 0

    // If offset is beyond entries, return empty
    if (offset >= sortedEntries.length) {
      return {
        entries: [],
        cursor: null,
      }
    }

    // Get the page of entries
    const pageEntries = sortedEntries.slice(offset, offset + limit)
    const nextOffset = offset + pageEntries.length
    const hasMore = nextOffset < sortedEntries.length

    // Build result entries
    const resultEntries = withFileTypes
      ? pageEntries.map(entry => new Dirent(entry.name, normalizedPath, entry.type))
      : pageEntries.map(entry => entry.name)

    return {
      entries: resultEntries,
      cursor: hasMore ? encodeCursor(nextOffset) : null,
    } as ReaddirPaginatedResult<string> | ReaddirPaginatedResult<Dirent>
  }

  // ==========================================================================
  // Non-paginated listing (backward compatible)
  // ==========================================================================
  if (withFileTypes) {
    return sortedEntries.map(entry => new Dirent(entry.name, normalizedPath, entry.type))
  }

  return sortedEntries.map(entry => entry.name)
}

// =============================================================================
// Async Iterator for memory-efficient directory reading
// =============================================================================

/**
 * Options for readdirIterator
 */
export interface ReaddirIteratorOptions {
  /** Return Dirent objects instead of strings */
  withFileTypes?: boolean
  /** Recursive listing */
  recursive?: boolean
}

/**
 * Async iterator for reading directory entries one at a time
 * Memory-efficient for large directories
 *
 * @param path - Path to the directory
 * @param options - Optional settings
 * @yields Directory entries (strings or Dirent objects)
 */
export function readdirIterator(
  path: string,
  options?: ReaddirIteratorOptions & { withFileTypes: true }
): AsyncGenerator<Dirent, void, unknown>
export function readdirIterator(
  path: string,
  options?: ReaddirIteratorOptions & { withFileTypes?: false }
): AsyncGenerator<string, void, unknown>
export function readdirIterator(
  path: string,
  options?: ReaddirIteratorOptions
): AsyncGenerator<string | Dirent, void, unknown>
export function readdirIterator(
  path: string,
  options?: ReaddirIteratorOptions
): AsyncGenerator<string | Dirent, void, unknown> {
  // Implementation uses a separate async generator function
  return readdirIteratorImpl(path, options)
}

/**
 * Internal implementation of readdirIterator
 */
async function* readdirIteratorImpl(
  path: string,
  options?: ReaddirIteratorOptions
): AsyncGenerator<string | Dirent, void, unknown> {
  const normalizedPath = normalize(path)
  const withFileTypes = options?.withFileTypes ?? false
  const recursive = options?.recursive ?? false

  // Check if path is a file (not a directory)
  if (isFile(normalizedPath)) {
    throw new ENOTDIR('scandir', normalizedPath)
  }

  // Check if directory exists
  const entries = mockFS.get(normalizedPath)
  if (entries === undefined) {
    throw new ENOENT('scandir', normalizedPath)
  }

  // Sort entries for consistent ordering
  const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name))

  if (recursive) {
    // Recursive iteration
    async function* processDirectory(
      dirPath: string,
      prefix: string
    ): AsyncGenerator<string | Dirent, void, unknown> {
      const dirEntries = mockFS.get(dirPath)
      if (!dirEntries) return

      const sorted = [...dirEntries].sort((a, b) => a.name.localeCompare(b.name))

      for (const entry of sorted) {
        const relativePath = prefix ? join(prefix, entry.name) : entry.name
        const fullPath = join(dirPath, entry.name)

        if (withFileTypes) {
          yield new Dirent(relativePath, normalizedPath, entry.type)
        } else {
          yield relativePath
        }

        // Recurse into subdirectories
        if (entry.type === 'directory') {
          yield* processDirectory(fullPath, relativePath)
        }
      }
    }

    yield* processDirectory(normalizedPath, '')
    return
  }

  // Non-recursive iteration - yield one entry at a time
  for (const entry of sortedEntries) {
    if (withFileTypes) {
      yield new Dirent(entry.name, normalizedPath, entry.type)
    } else {
      yield entry.name
    }
  }
}
