/**
 * fs_stat MCP Tool - File/Directory Statistics
 *
 * Provides file and directory statistics retrieval for AI-assisted file operations
 * via the Model Context Protocol (MCP).
 *
 * ## Features
 *
 * - POSIX-compatible stat structure (dev, ino, mode, nlink, uid, gid, etc.)
 * - Type detection booleans (isFile, isDirectory, isSymbolicLink, etc.)
 * - Symlink handling: stat follows symlinks, lstat returns symlink info
 * - Path traversal protection
 * - Consistent timestamp handling
 *
 * ## Design Notes
 *
 * This module extracts shared stat logic that can be reused by:
 * - fs_list withDetails option
 * - FileHandle.stat()
 * - Other MCP tools that need file metadata
 *
 * @module core/mcp/fs-stat
 */

import type { McpToolResult } from './fs-search'
import { constants } from '../constants'

// =============================================================================
// Types
// =============================================================================

/**
 * File entry metadata from storage backend.
 *
 * Extended interface that includes all fields needed for stat operations.
 * The base StorageBackend.get() returns a subset; this interface represents
 * the full metadata available in test storage implementations.
 */
export interface StatFileEntry {
  /** Entry type */
  type: 'file' | 'directory' | 'symlink'
  /** POSIX mode bits (type + permissions) */
  mode: number
  /** File content (for size calculation) */
  content: Uint8Array | { length: number }
  /** Symlink target path (for symlinks only) */
  linkTarget?: string
  /** User ID */
  uid: number
  /** Group ID */
  gid: number
  /** Access time (ms since epoch) */
  atime: number
  /** Modification time (ms since epoch) */
  mtime: number
  /** Change time (ms since epoch) */
  ctime: number
  /** Birth/creation time (ms since epoch) */
  birthtime: number
  /** Number of hard links */
  nlink: number
}

/**
 * Stats result returned by fs_stat/fs_lstat MCP tools.
 *
 * Modeled after Node.js fs.Stats but serialized as plain JSON object
 * with boolean properties instead of methods.
 *
 * @see https://nodejs.org/api/fs.html#class-fsstats
 */
export interface McpStatResult {
  /** Device ID */
  dev: number
  /** Inode number */
  ino: number
  /** File mode (type + permissions) */
  mode: number
  /** Number of hard links */
  nlink: number
  /** User ID */
  uid: number
  /** Group ID */
  gid: number
  /** Device ID for special files */
  rdev: number
  /** File size in bytes */
  size: number
  /** Block size for I/O */
  blksize: number
  /** Number of 512-byte blocks allocated */
  blocks: number
  /** Access time (ms since epoch) */
  atime: number
  /** Modification time (ms since epoch) */
  mtime: number
  /** Change time (ms since epoch) */
  ctime: number
  /** Birth/creation time (ms since epoch) */
  birthtime: number
  /** True if regular file */
  isFile: boolean
  /** True if directory */
  isDirectory: boolean
  /** True if symbolic link */
  isSymbolicLink: boolean
  /** True if block device */
  isBlockDevice: boolean
  /** True if character device */
  isCharacterDevice: boolean
  /** True if FIFO (named pipe) */
  isFIFO: boolean
  /** True if socket */
  isSocket: boolean
}

/**
 * Storage backend interface for stat operations.
 *
 * This is a standalone interface (not extending StorageBackend) because
 * stat operations require full metadata including timestamps and ownership,
 * which the base StorageBackend.get() doesn't provide.
 */
export interface StatStorageBackend {
  /** Check if a path exists */
  has(path: string): boolean
  /** Check if path is a directory */
  isDirectory(path: string): boolean
  /** Get children of a directory (names only) */
  getChildren(path: string): string[]
  /** Normalize a path (resolve . and .., collapse slashes) */
  normalizePath(path: string): string
  /** Get the parent directory path */
  getParentPath(path: string): string
  /** Get entry with full metadata */
  get(path: string): StatFileEntry | undefined
}

// =============================================================================
// Constants
// =============================================================================

/** Default filesystem block size (4KB) */
export const DEFAULT_BLOCK_SIZE = 4096

/** Block unit size for calculating st_blocks (512 bytes per POSIX) */
export const BLOCKS_UNIT_SIZE = 512

/** Maximum symlink chain depth before treating as broken */
export const MAX_SYMLINK_DEPTH = 40

// =============================================================================
// Path Validation
// =============================================================================

/**
 * Check if a path contains traversal patterns that could escape the root.
 *
 * Detects path traversal attacks like:
 * - Paths starting with `../`
 * - Paths with `..` that would go above root (e.g., `/foo/../../bar`)
 *
 * @param path - Path to validate
 * @returns True if path contains dangerous traversal patterns
 *
 * @example
 * ```typescript
 * isPathTraversal('../etc/passwd')           // true
 * isPathTraversal('/home/../../../etc')      // true
 * isPathTraversal('/home/user/../user2')     // false (stays within root)
 * ```
 */
export function isPathTraversal(path: string): boolean {
  // Relative paths starting with .. are suspicious
  if (path.startsWith('../')) {
    return true
  }

  // Check for patterns like /foo/../../.. that would go above root
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
 * Result of symlink chain resolution.
 */
export interface SymlinkResolution {
  /** The resolved entry (undefined if broken symlink) */
  entry?: StatFileEntry
  /** The resolved path */
  path: string
  /** True if resolution failed (broken or loop) */
  error?: boolean
}

/**
 * Resolve a symlink chain to get the final target.
 *
 * Follows symlinks iteratively up to MAX_SYMLINK_DEPTH to prevent
 * infinite loops from circular symlinks.
 *
 * @param startPath - Starting path (may be a symlink)
 * @param storage - Storage backend to query
 * @param maxDepth - Maximum symlink chain length (default: MAX_SYMLINK_DEPTH)
 * @returns Resolution result with entry and path, or error flag
 *
 * @example
 * ```typescript
 * // link.txt -> target.txt
 * const result = resolveSymlinkChain('/home/link.txt', storage)
 * // result.entry = target.txt entry
 * // result.path = '/home/target.txt'
 * ```
 */
export function resolveSymlinkChain(
  startPath: string,
  storage: StatStorageBackend,
  maxDepth: number = MAX_SYMLINK_DEPTH
): SymlinkResolution {
  let currentPath = startPath
  let depth = 0

  while (depth < maxDepth) {
    const entry = storage.get(currentPath)

    if (!entry) {
      return { path: currentPath, error: true }
    }

    if (entry.type !== 'symlink' || !entry.linkTarget) {
      return { entry, path: currentPath }
    }

    // Resolve symlink target
    const target = entry.linkTarget
    if (target.startsWith('/')) {
      currentPath = storage.normalizePath(target)
    } else {
      // Relative path - resolve from parent directory
      const parentPath = storage.getParentPath(currentPath)
      currentPath = storage.normalizePath(parentPath + '/' + target)
    }
    depth++
  }

  // Max depth exceeded - treat as broken
  return { path: currentPath, error: true }
}

// =============================================================================
// Type Detection
// =============================================================================

/**
 * Type detection flags for a file entry.
 *
 * These booleans replace the Stats methods (isFile(), isDirectory(), etc.)
 * in the MCP JSON response format.
 */
export interface TypeFlags {
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
  isBlockDevice: boolean
  isCharacterDevice: boolean
  isFIFO: boolean
  isSocket: boolean
}

/**
 * Detect file type from entry metadata.
 *
 * Determines type from both the `type` field and the mode bits,
 * ensuring consistent type detection regardless of how the entry
 * was created.
 *
 * @param entry - File entry to analyze
 * @returns Object with boolean flags for each file type
 *
 * @example
 * ```typescript
 * const flags = detectFileType(entry)
 * if (flags.isFile) {
 *   // Handle regular file
 * } else if (flags.isDirectory) {
 *   // Handle directory
 * }
 * ```
 */
export function detectFileType(entry: StatFileEntry): TypeFlags {
  const mode = entry.mode
  const typeFromMode = mode & constants.S_IFMT

  const isSymbolicLink = entry.type === 'symlink' || typeFromMode === constants.S_IFLNK
  const isFileType = entry.type === 'file' || typeFromMode === constants.S_IFREG
  const isDirectoryType = entry.type === 'directory' || typeFromMode === constants.S_IFDIR

  return {
    // For isFile/isDirectory, exclude symlinks (symlinks have their own flag)
    isFile: isFileType && !isSymbolicLink,
    isDirectory: isDirectoryType && !isSymbolicLink,
    isSymbolicLink,
    isBlockDevice: typeFromMode === constants.S_IFBLK,
    isCharacterDevice: typeFromMode === constants.S_IFCHR,
    isFIFO: typeFromMode === constants.S_IFIFO,
    isSocket: typeFromMode === constants.S_IFSOCK,
  }
}

// =============================================================================
// Stat Building
// =============================================================================

/**
 * Options for building stat results.
 */
export interface BuildStatOptions {
  /** Device ID (default: 0 for virtual filesystem) */
  dev?: number
  /** Inode number (default: 0) */
  ino?: number
  /** Block size (default: DEFAULT_BLOCK_SIZE) */
  blksize?: number
  /** Device ID for special files (default: 0) */
  rdev?: number
}

/**
 * Get the size of file content.
 *
 * Handles both Uint8Array and objects with length property.
 *
 * @param content - File content
 * @returns Size in bytes
 */
export function getContentSize(content: Uint8Array | { length: number }): number {
  return content instanceof Uint8Array ? content.length : content.length
}

/**
 * Calculate the number of 512-byte blocks for a file.
 *
 * POSIX specifies that st_blocks is measured in 512-byte units.
 *
 * @param size - File size in bytes
 * @returns Number of 512-byte blocks
 */
export function calculateBlocks(size: number): number {
  return Math.ceil(size / BLOCKS_UNIT_SIZE)
}

/**
 * Build a stat result object from a file entry.
 *
 * This is the core function for creating POSIX-compatible stat results.
 * It combines entry metadata with type detection to produce a complete
 * stat object suitable for JSON serialization.
 *
 * @param entry - File entry with metadata
 * @param options - Optional overrides for dev, ino, blksize, rdev
 * @returns Complete stat result object
 *
 * @example
 * ```typescript
 * const entry = storage.get('/home/user/file.txt')
 * const stats = buildStatResult(entry)
 * console.log(stats.size, stats.isFile)
 * ```
 */
export function buildStatResult(
  entry: StatFileEntry,
  options: BuildStatOptions = {}
): McpStatResult {
  const {
    dev = 0,
    ino = 0,
    blksize = DEFAULT_BLOCK_SIZE,
    rdev = 0,
  } = options

  const size = getContentSize(entry.content)
  const typeFlags = detectFileType(entry)

  return {
    dev,
    ino,
    mode: entry.mode,
    nlink: entry.nlink,
    uid: entry.uid,
    gid: entry.gid,
    rdev,
    size,
    blksize,
    blocks: calculateBlocks(size),
    atime: entry.atime,
    mtime: entry.mtime,
    ctime: entry.ctime,
    birthtime: entry.birthtime,
    ...typeFlags,
  }
}

// =============================================================================
// MCP Tool Implementation
// =============================================================================

/**
 * Invoke the fs_stat MCP tool (follows symlinks).
 *
 * Gets file/directory statistics, following symlinks to their targets.
 * This is equivalent to POSIX stat(2).
 *
 * @param params - MCP tool parameters (path required)
 * @param storage - Storage backend to query
 * @returns MCP tool result with JSON stat object or error
 *
 * @example
 * ```typescript
 * const result = await invokeFsStat({ path: '/home/user/file.txt' }, storage)
 * if (!result.isError) {
 *   const stats = JSON.parse(result.content[0].text)
 *   console.log(stats.size, stats.mtime)
 * }
 * ```
 */
export async function invokeFsStat(
  params: Record<string, unknown>,
  storage: StatStorageBackend
): Promise<McpToolResult> {
  return invokeStatInternal(params, storage, true)
}

/**
 * Invoke the fs_lstat MCP tool (does not follow symlinks).
 *
 * Gets file/directory statistics without following symlinks.
 * For symlinks, returns the symlink's own stats rather than the target's.
 * This is equivalent to POSIX lstat(2).
 *
 * @param params - MCP tool parameters (path required)
 * @param storage - Storage backend to query
 * @returns MCP tool result with JSON stat object or error
 *
 * @example
 * ```typescript
 * // link.txt is a symlink to target.txt
 * const result = await invokeFsLstat({ path: '/home/user/link.txt' }, storage)
 * const stats = JSON.parse(result.content[0].text)
 * console.log(stats.isSymbolicLink)  // true
 * ```
 */
export async function invokeFsLstat(
  params: Record<string, unknown>,
  storage: StatStorageBackend
): Promise<McpToolResult> {
  return invokeStatInternal(params, storage, false)
}

/**
 * Internal stat implementation shared by fs_stat and fs_lstat.
 *
 * @param params - MCP tool parameters (path required)
 * @param storage - Storage backend
 * @param followSymlinks - If true, follow symlinks to target (stat); if false, return symlink info (lstat)
 * @returns MCP tool result
 *
 * @internal
 */
async function invokeStatInternal(
  params: Record<string, unknown>,
  storage: StatStorageBackend,
  followSymlinks: boolean
): Promise<McpToolResult> {
  // Validate path parameter
  const path = params.path

  // Check path is provided
  if (path === undefined || path === null) {
    return {
      content: [{ type: 'text', text: 'path is required' }],
      isError: true,
    }
  }

  // Check path is a string
  if (typeof path !== 'string') {
    return {
      content: [{ type: 'text', text: 'path must be a string type' }],
      isError: true,
    }
  }

  // Check path is not empty
  if (path === '') {
    return {
      content: [{ type: 'text', text: 'path cannot be empty' }],
      isError: true,
    }
  }

  // Check for path traversal attacks
  if (isPathTraversal(path)) {
    return {
      content: [{ type: 'text', text: `EACCES: permission denied, path traversal detected: ${path}` }],
      isError: true,
    }
  }

  // Normalize the path
  const normalizedPath = storage.normalizePath(path)

  // Get entry and optionally resolve symlinks
  let entry = storage.get(normalizedPath)

  if (followSymlinks && entry?.type === 'symlink') {
    // Resolve symlink chain
    const resolved = resolveSymlinkChain(normalizedPath, storage)
    if (resolved.error) {
      return {
        content: [{ type: 'text', text: `ENOENT: no such file or directory: ${path}` }],
        isError: true,
      }
    }
    entry = resolved.entry
  }

  // Check if entry exists
  if (!entry) {
    return {
      content: [{ type: 'text', text: `ENOENT: no such file or directory: ${path}` }],
      isError: true,
    }
  }

  // Build and return stat result
  const statResult = buildStatResult(entry)

  return {
    content: [{ type: 'text', text: JSON.stringify(statResult) }],
    isError: false,
  }
}

// =============================================================================
// MCP Tool Schema
// =============================================================================

/**
 * MCP tool schema definition for fs_stat.
 */
export const fsStatToolSchema = {
  name: 'fs_stat',
  description: 'Get file or directory statistics (follows symlinks)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File or directory path to stat',
      },
    },
    required: ['path'],
  },
} as const

/**
 * MCP tool schema definition for fs_lstat.
 */
export const fsLstatToolSchema = {
  name: 'fs_lstat',
  description: 'Get file or directory statistics (does not follow symlinks)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File or directory path to stat',
      },
    },
    required: ['path'],
  },
} as const
