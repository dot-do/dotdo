/**
 * File system traversal utilities for fsx
 *
 * Provides shared traversal logic used by glob, grep, and find utilities.
 * Includes support for:
 * - Timeout options for long-running operations
 * - AbortController cancellation
 * - Improved error handling with descriptive messages
 * - Progress callbacks for large traversals
 *
 * ## Performance Optimizations
 *
 * This module is optimized to minimize system calls:
 *
 * 1. **Dirent Type Inference**: Uses `withFileTypes: true` in readdir to get
 *    entry types without additional stat calls. Most modern filesystems provide
 *    this information directly from directory entries.
 *
 * 2. **Lazy Stat Collection**: Only calls stat() when explicitly requested via
 *    `collectStats: true`. Otherwise, type information comes from dirent.
 *
 * 3. **Symlink Stat Caching**: When following symlinks, caches the stat result
 *    to avoid duplicate calls when collectStats is also enabled.
 *
 * 4. **Early Directory Pruning**: Prune patterns are checked before traversing
 *    subdirectories, avoiding entire subtrees.
 *
 * 5. **Dotfile Filtering at Source**: Filters dotfiles before any stat calls,
 *    reducing syscalls on large directories with many hidden files.
 *
 * @module traversal
 */

import type { FsBackend } from './backend'

// =============================================================================
// Types
// =============================================================================

/**
 * File entry type for traversal results
 */
export type TraversalEntryType = 'file' | 'directory' | 'symlink'

/**
 * A traversed file system entry with metadata
 */
export interface TraversalEntry {
  /** Full absolute path to the entry */
  path: string
  /** Type of the entry */
  type: TraversalEntryType
  /** Name of the file/directory (basename) */
  name: string
  /** Depth relative to the starting path (0 = starting path itself) */
  depth: number
  /** File size in bytes (0 for directories) */
  size?: number
  /** Last modification time in milliseconds */
  mtimeMs?: number
  /** Creation time in milliseconds */
  ctimeMs?: number
  /** Last access time in milliseconds */
  atimeMs?: number
}

/**
 * Error thrown when a traversal operation times out
 */
export class TraversalTimeoutError extends Error {
  /** Path where the timeout occurred */
  path: string
  /** Timeout duration in milliseconds */
  timeout: number

  constructor(path: string, timeout: number) {
    super(`Traversal operation timed out after ${timeout}ms at path: ${path}`)
    this.name = 'TraversalTimeoutError'
    this.path = path
    this.timeout = timeout
  }
}

/**
 * Error thrown when a traversal operation is aborted
 */
export class TraversalAbortedError extends Error {
  /** Path where the abort was detected */
  path: string

  constructor(path: string) {
    super(`Traversal operation was aborted at path: ${path}`)
    this.name = 'TraversalAbortedError'
    this.path = path
  }
}

/**
 * Error thrown for invalid paths or filesystem errors during traversal
 */
export class TraversalError extends Error {
  /** The path that caused the error */
  path: string
  /** The underlying error code (e.g., 'ENOENT', 'EACCES') */
  code?: string
  /** The original error that caused this error */
  cause?: Error

  constructor(message: string, path: string, code?: string, cause?: Error) {
    super(message)
    this.name = 'TraversalError'
    this.path = path
    this.code = code
    this.cause = cause
  }
}

/**
 * Options for traversal operations
 *
 * ## Performance Considerations
 *
 * The traversal function is designed to minimize system calls. Key options
 * that affect performance:
 *
 * - **prunePatterns**: Use these aggressively to skip directories like
 *   `node_modules`, `.git`, `dist` - this avoids entire subtrees.
 *
 * - **maxDepth**: Limiting depth prevents deep recursion into large trees.
 *
 * - **collectStats**: Set to `false` (default) unless you need file sizes
 *   and modification times. When `false`, type information comes from
 *   dirent without any additional stat() calls.
 *
 * - **followSymlinks**: When `true` (default), symlinks require a stat()
 *   call to determine the target type. Set to `false` if you don't need
 *   to traverse symlinked directories.
 *
 * - **includeDotFiles**: Filtering dotfiles happens before type checking,
 *   so this doesn't add syscall overhead.
 *
 * @example
 * ```typescript
 * // Efficient traversal of a source directory
 * const result = await traverse({
 *   startPath: '/project',
 *   backend: myBackend,
 *   maxDepth: 10,
 *   prunePatterns: ['node_modules', '.git', 'dist', 'coverage'],
 *   collectStats: false, // Don't need sizes/times
 * })
 * ```
 */
export interface TraversalOptions {
  /**
   * Starting path for traversal.
   * @default '/'
   */
  startPath?: string

  /**
   * Maximum depth to traverse relative to startPath.
   * - `undefined` = unlimited depth
   * - `0` = only the starting path itself (if it's a file)
   * - `1` = direct children only
   *
   * Lower values improve performance on deep directory trees.
   */
  maxDepth?: number

  /**
   * Minimum depth before collecting entries.
   * Entries at depths less than this value are traversed but not returned.
   * @default 0
   */
  minDepth?: number

  /**
   * Include hidden files/directories (names starting with `.`).
   *
   * This filter is applied before type checking, so it doesn't add
   * syscall overhead. Setting to `false` can significantly reduce
   * the number of entries in directories with many dotfiles.
   *
   * @default false
   */
  includeDotFiles?: boolean

  /**
   * Follow symbolic links to determine their target type.
   *
   * Performance note: When `true`, each symlink encountered requires
   * a stat() call to determine if the target is a file or directory.
   * When `false`, symlinks are reported as type 'symlink' and not
   * traversed, avoiding the stat() call.
   *
   * @default true
   */
  followSymlinks?: boolean

  /**
   * Directory name patterns to skip during traversal.
   *
   * This is the most effective performance optimization - matching
   * directories and all their contents are completely skipped.
   *
   * Supports simple wildcards:
   * - Exact match: `'node_modules'`
   * - Wildcard: `'*.cache'`, `'__*__'`
   *
   * @example
   * ```typescript
   * prunePatterns: ['node_modules', '.git', 'dist', '*.cache']
   * ```
   */
  prunePatterns?: string[]

  /**
   * Timeout in milliseconds for the entire traversal operation.
   *
   * When exceeded, throws `TraversalTimeoutError` with partial results
   * available in the error's associated `TraversalResult`.
   *
   * Set to `0` or `undefined` for no timeout.
   */
  timeout?: number

  /**
   * AbortSignal for cancelling the traversal.
   *
   * When the signal is aborted, the traversal stops and throws
   * `TraversalAbortedError`. Partial results collected before
   * cancellation are available.
   *
   * @example
   * ```typescript
   * const controller = new AbortController()
   * setTimeout(() => controller.abort(), 5000)
   *
   * const result = await traverse({
   *   backend: myBackend,
   *   signal: controller.signal,
   * })
   * ```
   */
  signal?: AbortSignal

  /**
   * Filter callback invoked for each entry before it's added to results.
   *
   * Return `true` to include the entry, `false` to skip it.
   * Async filters are supported but may impact performance.
   *
   * Note: This filter runs AFTER type determination, so entries
   * already have their type available. For filtering before any
   * syscalls, use `prunePatterns` instead.
   *
   * @example
   * ```typescript
   * filter: (entry) => entry.type === 'file' && entry.name.endsWith('.ts')
   * ```
   */
  filter?: (entry: TraversalEntry) => boolean | Promise<boolean>

  /**
   * Progress callback invoked periodically during traversal.
   *
   * Called every 100 entries by default. Useful for progress bars
   * or logging on large traversals.
   *
   * @param current - Number of entries visited so far
   * @param currentPath - Path currently being processed
   */
  onProgress?: (current: number, currentPath: string) => void

  /**
   * Whether to collect file stats (size, mtime, ctime, atime).
   *
   * Performance impact:
   * - `false` (default): No additional stat() calls for regular files
   *   and directories. Type information comes from dirent.
   * - `true`: Adds one stat() call per entry to collect metadata.
   *
   * Note: When `followSymlinks: true` and a symlink is encountered,
   * the stat() result is cached and reused if `collectStats` is also
   * true, avoiding a duplicate syscall.
   *
   * @default false
   */
  collectStats?: boolean

  /**
   * FsBackend to use for filesystem operations.
   *
   * The backend must implement:
   * - `readdir(path, { withFileTypes: true })`
   * - `stat(path)`
   * - `exists(path)`
   */
  backend: FsBackend
}

/**
 * Result of a traversal operation
 */
export interface TraversalResult {
  /** All collected entries */
  entries: TraversalEntry[]
  /** Total number of entries visited (including filtered) */
  visited: number
  /** Whether the traversal completed fully */
  complete: boolean
  /** Error that caused incomplete traversal, if any */
  error?: Error
  /** Duration of traversal in milliseconds */
  durationMs: number
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Normalize a path by removing trailing slashes and collapsing duplicates.
 *
 * @param path - Path to normalize
 * @returns Normalized path
 *
 * @example
 * ```typescript
 * normalizePath('/foo//bar/') // '/foo/bar'
 * normalizePath('/') // '/'
 * normalizePath('') // '/'
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
 * Join two path segments.
 *
 * @param base - Base path
 * @param segment - Segment to append
 * @returns Joined path
 *
 * @example
 * ```typescript
 * joinPath('/', 'foo') // '/foo'
 * joinPath('/bar', 'baz') // '/bar/baz'
 * ```
 */
export function joinPath(base: string, segment: string): string {
  if (base === '/') return '/' + segment
  return base + '/' + segment
}

/**
 * Get the basename (final component) of a path.
 *
 * @param path - Path to get basename of
 * @returns Basename
 *
 * @example
 * ```typescript
 * getBasename('/foo/bar/baz.txt') // 'baz.txt'
 * getBasename('/foo') // 'foo'
 * getBasename('/') // ''
 * ```
 */
export function getBasename(path: string): string {
  if (path === '/') return ''
  const lastSlash = path.lastIndexOf('/')
  return lastSlash >= 0 ? path.slice(lastSlash + 1) : path
}

/**
 * Get the parent directory of a path.
 *
 * @param path - Path to get parent of
 * @returns Parent path
 *
 * @example
 * ```typescript
 * getParentPath('/foo/bar') // '/foo'
 * getParentPath('/foo') // '/'
 * getParentPath('/') // '/'
 * ```
 */
export function getParentPath(path: string): string {
  if (path === '/') return '/'
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return path.slice(0, lastSlash)
}

/**
 * Get the relative path from a base to a target.
 *
 * @param basePath - Base path
 * @param targetPath - Target path
 * @returns Relative path from base to target
 *
 * @example
 * ```typescript
 * getRelativePath('/', '/foo/bar') // 'foo/bar'
 * getRelativePath('/foo', '/foo/bar/baz') // 'bar/baz'
 * ```
 */
export function getRelativePath(basePath: string, targetPath: string): string {
  const normalizedBase = normalizePath(basePath)
  const normalizedTarget = normalizePath(targetPath)

  if (normalizedBase === '/') {
    return normalizedTarget.slice(1)
  }

  if (normalizedTarget === normalizedBase) {
    return ''
  }

  if (normalizedTarget.startsWith(normalizedBase + '/')) {
    return normalizedTarget.slice(normalizedBase.length + 1)
  }

  return normalizedTarget
}

/**
 * Calculate the depth of a path relative to a base path.
 *
 * @param path - Path to calculate depth of
 * @param basePath - Base path
 * @returns Depth (0 = same as base, 1 = direct child, etc.)
 *
 * @example
 * ```typescript
 * getDepth('/foo/bar', '/') // 2
 * getDepth('/foo/bar', '/foo') // 1
 * getDepth('/foo', '/foo') // 0
 * ```
 */
export function getDepth(path: string, basePath: string): number {
  const relativePath = getRelativePath(basePath, path)
  if (relativePath === '') return 0
  return relativePath.split('/').length
}

/**
 * Check if a name is a dotfile/dotdir (starts with .)
 *
 * @param name - Name to check
 * @returns True if name starts with .
 */
export function isDotEntry(name: string): boolean {
  return name.startsWith('.')
}

// =============================================================================
// Main Traversal Function
// =============================================================================

/**
 * Traverse a filesystem tree and collect entries.
 *
 * This function provides a flexible, cancellable, and timeout-aware
 * way to traverse filesystem trees. It supports:
 * - Depth limiting
 * - Dotfile filtering
 * - Directory pruning
 * - Timeout handling
 * - Abort signal cancellation
 * - Progress callbacks
 * - Optional stat collection
 *
 * @param options - Traversal options
 * @returns Traversal result with collected entries
 * @throws {TraversalTimeoutError} If timeout is exceeded
 * @throws {TraversalAbortedError} If abort signal is triggered
 * @throws {TraversalError} For filesystem errors
 *
 * @example
 * ```typescript
 * const result = await traverse({
 *   startPath: '/src',
 *   backend: myBackend,
 *   maxDepth: 3,
 *   timeout: 5000,
 *   filter: (entry) => entry.type === 'file' && entry.name.endsWith('.ts'),
 * })
 *
 * for (const entry of result.entries) {
 *   console.log(entry.path)
 * }
 * ```
 */
export async function traverse(options: TraversalOptions): Promise<TraversalResult> {
  const startTime = Date.now()
  const {
    startPath = '/',
    maxDepth,
    minDepth = 0,
    includeDotFiles = false,
    followSymlinks = true,
    prunePatterns = [],
    timeout,
    signal,
    filter,
    onProgress,
    collectStats = false,
    backend,
  } = options

  const normalizedStart = normalizePath(startPath)
  const entries: TraversalEntry[] = []
  const visited = new Set<string>()
  let visitedCount = 0
  let complete = true
  let error: Error | undefined

  // Helper to check for timeout
  const checkTimeout = (currentPath: string): void => {
    if (timeout && timeout > 0) {
      const elapsed = Date.now() - startTime
      if (elapsed > timeout) {
        throw new TraversalTimeoutError(currentPath, timeout)
      }
    }
  }

  // Helper to check for abort
  const checkAbort = (currentPath: string): void => {
    if (signal?.aborted) {
      throw new TraversalAbortedError(currentPath)
    }
  }

  // Helper to check if a name matches any prune pattern
  const shouldPrune = (name: string): boolean => {
    for (const pattern of prunePatterns) {
      // Simple pattern matching - exact match or glob-style *
      if (pattern === name) return true
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
        if (regex.test(name)) return true
      }
    }
    return false
  }

  // Recursive traversal function
  async function traverseDir(currentPath: string, currentDepth: number): Promise<void> {
    // Check for timeout/abort
    checkTimeout(currentPath)
    checkAbort(currentPath)

    // Prevent infinite loops with symlinks
    if (visited.has(currentPath)) {
      return
    }
    visited.add(currentPath)

    // Check depth limits for continuing traversal
    if (maxDepth !== undefined && currentDepth > maxDepth) {
      return
    }

    // Get directory entries
    let dirEntries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink?(): boolean }>
    try {
      dirEntries = await backend.readdir(currentPath, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink?(): boolean }>
    } catch (err) {
      const e = err as Error & { code?: string }
      // Handle permission denied gracefully - skip the directory
      if (e.code === 'EACCES' || e.message?.includes('EACCES')) {
        return
      }
      // For other errors, wrap and propagate
      throw new TraversalError(
        `Failed to read directory: ${currentPath}`,
        currentPath,
        e.code,
        e
      )
    }

    for (const dirEntry of dirEntries) {
      const entryName = dirEntry.name
      const entryPath = joinPath(currentPath, entryName)

      // Check for timeout/abort periodically
      checkTimeout(entryPath)
      checkAbort(entryPath)

      visitedCount++

      // Report progress
      if (onProgress && visitedCount % 100 === 0) {
        onProgress(visitedCount, entryPath)
      }

      // Skip dotfiles if not included
      if (!includeDotFiles && isDotEntry(entryName)) {
        continue
      }

      // Check prune patterns
      if (shouldPrune(entryName)) {
        continue
      }

      // Determine entry type - optimized to avoid redundant stat calls
      // We use dirent type information when available, only falling back to
      // stat() for symlinks when followSymlinks is true.
      let entryType: TraversalEntryType
      let isDir = false
      let cachedStats: { size: number; mtimeMs: number; ctimeMs: number; atimeMs: number } | undefined

      try {
        if (dirEntry.isSymbolicLink?.()) {
          if (!followSymlinks) {
            // Don't follow symlink - report as symlink type
            entryType = 'symlink'
          } else {
            // Follow symlink to determine actual type - cache result for reuse
            const stats = await backend.stat(entryPath)
            isDir = stats.isDirectory()
            entryType = isDir ? 'directory' : 'file'
            // Cache stats to avoid second stat call when collectStats is true
            if (collectStats) {
              cachedStats = {
                size: stats.size,
                mtimeMs: stats.mtimeMs,
                ctimeMs: stats.ctimeMs,
                atimeMs: stats.atimeMs,
              }
            }
          }
        } else {
          // Use dirent type directly - no stat call needed
          isDir = dirEntry.isDirectory()
          entryType = isDir ? 'directory' : 'file'
        }
      } catch {
        // If stat fails (e.g., broken symlink), treat as file
        entryType = 'file'
        isDir = false
      }

      // Build entry
      const entry: TraversalEntry = {
        path: entryPath,
        type: entryType,
        name: entryName,
        depth: currentDepth,
      }

      // Collect stats if requested - use cached stats when available
      if (collectStats) {
        if (cachedStats) {
          // Reuse stats from symlink resolution - avoid duplicate stat call
          entry.size = cachedStats.size
          entry.mtimeMs = cachedStats.mtimeMs
          entry.ctimeMs = cachedStats.ctimeMs
          entry.atimeMs = cachedStats.atimeMs
        } else {
          try {
            const stats = await backend.stat(entryPath)
            entry.size = stats.size
            entry.mtimeMs = stats.mtimeMs
            entry.ctimeMs = stats.ctimeMs
            entry.atimeMs = stats.atimeMs
          } catch {
            // Stats collection is optional, continue without
          }
        }
      }

      // Check depth before adding
      if (currentDepth >= minDepth) {
        // Apply filter if provided
        let include = true
        if (filter) {
          try {
            include = await filter(entry)
          } catch {
            include = false
          }
        }

        if (include) {
          entries.push(entry)
        }
      }

      // Recurse into directories
      if (isDir) {
        await traverseDir(entryPath, currentDepth + 1)
      }
    }
  }

  try {
    // Verify starting path exists
    const exists = await backend.exists(normalizedStart)
    if (!exists) {
      throw new TraversalError(
        `Starting path does not exist: ${normalizedStart}`,
        normalizedStart,
        'ENOENT'
      )
    }

    // Check if starting path is a directory
    const startStats = await backend.stat(normalizedStart)
    if (!startStats.isDirectory()) {
      // If it's a file, just return it as the only entry
      const entry: TraversalEntry = {
        path: normalizedStart,
        type: startStats.isSymbolicLink?.() ? 'symlink' : 'file',
        name: getBasename(normalizedStart),
        depth: 0,
      }

      if (collectStats) {
        entry.size = startStats.size
        entry.mtimeMs = startStats.mtimeMs
        entry.ctimeMs = startStats.ctimeMs
        entry.atimeMs = startStats.atimeMs
      }

      let include = true
      if (filter) {
        include = await filter(entry)
      }

      if (include && minDepth === 0) {
        entries.push(entry)
      }

      return {
        entries,
        visited: 1,
        complete: true,
        durationMs: Date.now() - startTime,
      }
    }

    // Start recursive traversal from the starting directory
    await traverseDir(normalizedStart, 0)
  } catch (err) {
    if (err instanceof TraversalTimeoutError || err instanceof TraversalAbortedError) {
      complete = false
      error = err
    } else if (err instanceof TraversalError) {
      complete = false
      error = err
    } else {
      const e = err as Error
      complete = false
      error = new TraversalError(e.message, normalizedStart, undefined, e)
    }
  }

  return {
    entries,
    visited: visitedCount,
    complete,
    error,
    durationMs: Date.now() - startTime,
  }
}

/**
 * Create a cancellable traversal that can be aborted.
 *
 * Returns an object with the traversal promise and an abort function.
 * Calling abort() will cause the traversal to stop and return partial results.
 *
 * @param options - Traversal options (signal option will be overridden)
 * @returns Object with promise and abort function
 *
 * @example
 * ```typescript
 * const { promise, abort } = createCancellableTraversal({
 *   startPath: '/large-dir',
 *   backend: myBackend,
 * })
 *
 * // Abort after 2 seconds
 * setTimeout(abort, 2000)
 *
 * const result = await promise
 * if (!result.complete) {
 *   console.log('Traversal was aborted')
 * }
 * ```
 */
export function createCancellableTraversal(
  options: Omit<TraversalOptions, 'signal'>
): { promise: Promise<TraversalResult>; abort: () => void } {
  const controller = new AbortController()

  const promise = traverse({
    ...options,
    signal: controller.signal,
  })

  return {
    promise,
    abort: () => controller.abort(),
  }
}
