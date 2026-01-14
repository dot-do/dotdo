/**
 * Shared utilities for MCP filesystem tools
 *
 * This module provides common types, path utilities, and traversal helpers
 * used by fs_search, fs_list, and fs_tree tools.
 *
 * @module core/mcp/shared
 */

// =============================================================================
// Types
// =============================================================================

/**
 * MCP tool result format.
 *
 * Standard response format for MCP tool invocations containing
 * either text or image content with optional error status.
 */
export interface McpToolResult {
  /** Array of content items (text or image) */
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >
  /** Whether the result represents an error */
  isError?: boolean
}

/**
 * Storage backend interface for filesystem operations.
 *
 * This abstraction allows tools to work with both
 * real filesystems and in-memory test fixtures.
 */
export interface StorageBackend {
  /** Check if a path exists */
  has(path: string): boolean
  /** Check if path is a directory */
  isDirectory(path: string): boolean
  /** Get children of a directory (names only) */
  getChildren(path: string): string[]
  /** Get entry metadata */
  get(path: string): StorageEntry | undefined
}

/**
 * Storage entry returned by storage.get()
 */
export interface StorageEntry {
  type: 'file' | 'directory' | 'symlink'
  content: Uint8Array
  /** Symlink target path */
  linkTarget?: string
  /** Modification time (ms since epoch) */
  mtime?: number
  /** Creation time (ms since epoch) */
  birthtime?: number
}

/**
 * Extended storage backend with additional methods.
 */
export interface ExtendedStorageBackend extends StorageBackend {
  /** Get symlink target */
  getSymlinkTarget?(path: string): string | undefined
}

/**
 * Common entry info collected during traversal.
 */
export interface TraversalEntry {
  /** Entry name (basename) */
  name: string
  /** Full absolute path */
  path: string
  /** Relative path from traversal root */
  relativePath: string
  /** Entry type */
  type: 'file' | 'directory' | 'symlink'
  /** File size in bytes */
  size: number
  /** Modification time (ms since epoch) */
  mtime: number
  /** Symlink target if applicable */
  linkTarget?: string
}

/**
 * Common traversal options.
 */
export interface TraversalOptions {
  /** Whether to include hidden files (starting with .) */
  showHidden?: boolean
  /** Whether to recurse into subdirectories */
  recursive?: boolean
}

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * Normalize a filesystem path.
 *
 * Removes trailing slashes (except for root) and collapses
 * multiple consecutive slashes.
 *
 * @param path - Path to normalize
 * @returns Normalized path
 *
 * @example
 * ```typescript
 * normalizePath('/foo//bar/')  // '/foo/bar'
 * normalizePath('/')           // '/'
 * normalizePath('')            // '/'
 * ```
 */
export function normalizePath(path: string): string {
  if (path === '' || path === '/') return '/'
  let p = path.replace(/\/+/g, '/')
  if (p.endsWith('/') && p !== '/') {
    p = p.slice(0, -1)
  }
  return p
}

/**
 * Join path segments.
 *
 * @param base - Base path
 * @param name - Name to append
 * @returns Joined path
 *
 * @example
 * ```typescript
 * joinPath('/', 'foo')      // '/foo'
 * joinPath('/foo', 'bar')   // '/foo/bar'
 * ```
 */
export function joinPath(base: string, name: string): string {
  if (base === '/') return `/${name}`
  return `${base}/${name}`
}

/**
 * Get relative path from base to path.
 *
 * Returns the portion of `path` that comes after `base`.
 *
 * @param fullPath - Target path
 * @param basePath - Base path to remove
 * @returns Relative path
 *
 * @example
 * ```typescript
 * getRelativePath('/home/user/foo', '/home/user')  // 'foo'
 * getRelativePath('/foo/bar', '/')                 // 'foo/bar'
 * ```
 */
export function getRelativePath(fullPath: string, basePath: string): string {
  const normalizedBase = normalizePath(basePath)
  const normalizedPath = normalizePath(fullPath)

  if (normalizedBase === '/') {
    return normalizedPath.slice(1) // Remove leading /
  }

  if (normalizedPath.startsWith(normalizedBase + '/')) {
    return normalizedPath.slice(normalizedBase.length + 1)
  }

  if (normalizedPath === normalizedBase) {
    return ''
  }

  return normalizedPath
}

/**
 * Check if path contains traversal patterns that would escape root.
 *
 * @param path - Path to check
 * @returns True if path contains traversal attack
 *
 * @example
 * ```typescript
 * isPathTraversal('/home/../../../etc')  // true
 * isPathTraversal('/home/user/file')     // false
 * ```
 */
export function isPathTraversal(path: string): boolean {
  // Check for explicit traversal patterns
  if (path.startsWith('/..') || path.startsWith('../')) {
    return true
  }
  // Count depth to check for escape attempts
  const segments = path.split('/').filter((s) => s !== '')
  let depth = 0
  for (const seg of segments) {
    if (seg === '..') {
      depth--
      if (depth < 0) return true
    } else if (seg !== '.') {
      depth++
    }
  }
  return depth < 0
}

// =============================================================================
// Symlink Resolution
// =============================================================================

/**
 * Resolve symlink to get actual target path.
 *
 * @param storage - Storage backend
 * @param path - Path to resolve
 * @param maxDepth - Maximum symlink chain depth (default: 10)
 * @returns Resolved path
 */
export function resolveSymlink(
  storage: StorageBackend,
  path: string,
  maxDepth: number = 10
): string {
  if (maxDepth <= 0) return path

  const entry = storage.get(path)
  if (!entry || entry.type !== 'symlink' || !entry.linkTarget) {
    return path
  }

  // Resolve the target path
  const target = entry.linkTarget
  const resolvedTarget = target.startsWith('/')
    ? target
    : joinPath(normalizePath(path).split('/').slice(0, -1).join('/') || '/', target)

  // Recursively resolve if target is also a symlink
  return resolveSymlink(storage, resolvedTarget, maxDepth - 1)
}

// =============================================================================
// Entry Collection
// =============================================================================

/**
 * Get file size from storage entry.
 *
 * @param entry - Storage entry
 * @returns Size in bytes
 */
export function getEntrySize(entry: StorageEntry): number {
  if (entry.content instanceof Uint8Array) {
    return entry.content.length
  }
  if (typeof entry.content === 'object' && 'length' in entry.content) {
    return (entry.content as { length: number }).length
  }
  return 0
}

/**
 * Get modification time from storage entry.
 *
 * @param entry - Storage entry
 * @returns Mtime in ms since epoch
 */
export function getEntryMtime(entry: StorageEntry): number {
  return entry.mtime ?? entry.birthtime ?? Date.now()
}

/**
 * Collect directory entries with common filtering.
 *
 * This is a lower-level helper that collects immediate children of a directory
 * with basic filtering (hidden files). Higher-level tools add their own
 * filtering (patterns, excludes) on top.
 *
 * @param storage - Storage backend
 * @param dirPath - Directory to list
 * @param basePath - Base path for relative path calculation
 * @param options - Traversal options
 * @returns Array of entry info
 */
export function collectDirectoryEntries(
  storage: ExtendedStorageBackend,
  dirPath: string,
  basePath: string,
  options: TraversalOptions
): TraversalEntry[] {
  const children = storage.getChildren(dirPath)
  const showHidden = options.showHidden ?? false
  const results: TraversalEntry[] = []

  for (const name of children) {
    // Skip hidden files unless showHidden is enabled
    if (!showHidden && name.startsWith('.')) {
      continue
    }

    const childPath = joinPath(dirPath, name)
    const entry = storage.get(childPath)
    if (!entry) continue

    const relativePath = getRelativePath(childPath, basePath)

    // Get symlink target
    let linkTarget: string | undefined
    if (entry.type === 'symlink') {
      linkTarget = storage.getSymlinkTarget?.(childPath) ?? entry.linkTarget
    }

    results.push({
      name,
      path: childPath,
      relativePath,
      type: entry.type,
      size: getEntrySize(entry),
      mtime: getEntryMtime(entry),
      linkTarget,
    })
  }

  return results
}

// =============================================================================
// Error Helpers
// =============================================================================

/**
 * Create an error result.
 *
 * @param message - Error message
 * @returns MCP tool result with error
 */
export function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

/**
 * Create a success result.
 *
 * @param text - Result text
 * @returns MCP tool result
 */
export function successResult(text: string): McpToolResult {
  return {
    content: [{ type: 'text', text }],
    isError: false,
  }
}
