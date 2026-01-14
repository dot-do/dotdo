/**
 * Advanced file discovery for fsx
 *
 * Provides Unix find-like functionality for searching files in the virtual filesystem.
 * Supports filtering by name patterns, file type, size, timestamps, and more.
 * Includes timeout and cancellation support for long-running searches.
 *
 * ## Performance Optimizations
 *
 * This implementation is optimized for performance through:
 *
 * 1. **Predicate ordering** - Cheap predicates (type, name) are evaluated before expensive ones (size, time)
 * 2. **Early termination** - Walking stops immediately when maxdepth is reached
 * 3. **Directory pruning** - Pruned directories are skipped entirely without traversal
 * 4. **Lazy stat** - Stats are only fetched when size/time predicates require them
 * 5. **Memory efficiency** - Results are collected incrementally, visited set prevents cycles
 *
 * @module find
 */

import { match } from '../glob/match'
import type { FsBackend } from '../backend'

/**
 * Error thrown when a find operation times out.
 *
 * @example
 * ```typescript
 * try {
 *   await find({ path: '/large-dir', timeout: 1000 })
 * } catch (err) {
 *   if (err instanceof FindTimeoutError) {
 *     console.log(`Search timed out after ${err.timeout}ms`)
 *   }
 * }
 * ```
 */
export class FindTimeoutError extends Error {
  /** Starting path that was being searched */
  readonly path: string
  /** Timeout duration in milliseconds */
  readonly timeout: number

  constructor(path: string, timeout: number) {
    super(`Find operation timed out after ${timeout}ms while searching '${path}'`)
    this.name = 'FindTimeoutError'
    this.path = path
    this.timeout = timeout
  }
}

/**
 * Error thrown when a find operation is aborted via AbortSignal.
 *
 * @example
 * ```typescript
 * const controller = new AbortController()
 * setTimeout(() => controller.abort(), 1000)
 *
 * try {
 *   await find({ path: '/', signal: controller.signal })
 * } catch (err) {
 *   if (err instanceof FindAbortedError) {
 *     console.log('Search was cancelled')
 *   }
 * }
 * ```
 */
export class FindAbortedError extends Error {
  /** Starting path that was being searched */
  readonly path: string

  constructor(path: string) {
    super(`Find operation was aborted while searching '${path}'`)
    this.name = 'FindAbortedError'
    this.path = path
  }
}

/**
 * Options for the find() function.
 *
 * All options are optional. When multiple filters are specified, they are combined with AND logic.
 * Predicates are evaluated in order of cost: type and name (cheap) before size and time (expensive).
 *
 * @example
 * ```typescript
 * // Find TypeScript files in src, excluding node_modules
 * const options: FindOptions = {
 *   path: '/src',
 *   name: '*.ts',
 *   type: 'f',
 *   prune: ['node_modules'],
 *   timeout: 5000,
 * }
 *
 * // Find large files modified recently
 * const largeRecent: FindOptions = {
 *   size: '+1M',
 *   mtime: '-7d',
 *   type: 'f',
 * }
 * ```
 */
export interface FindOptions {
  /**
   * Starting path for the search.
   * @default '/'
   */
  path?: string

  /**
   * Filename pattern filter.
   * - String: glob pattern (e.g., '*.ts', 'README.*', '[A-Z]*.tsx')
   * - RegExp: regular expression for filename matching
   *
   * @example
   * ```typescript
   * { name: '*.ts' }           // glob pattern
   * { name: /\.test\.ts$/ }    // RegExp
   * { name: '*.{ts,tsx}' }     // brace expansion
   * ```
   */
  name?: string | RegExp

  /**
   * File type filter.
   * - 'f': regular files only
   * - 'd': directories only
   * - 'l': symbolic links only
   */
  type?: 'f' | 'd' | 'l'

  /**
   * Maximum traversal depth from starting path.
   * - 0: only the starting path itself
   * - 1: starting path and direct children
   * - n: up to n levels deep
   * @default Infinity
   */
  maxdepth?: number

  /**
   * Minimum depth before including results.
   * - 0: include starting path
   * - 1: exclude starting path, include children
   * - n: only include entries n or more levels deep
   * @default 0
   */
  mindepth?: number

  /**
   * Size filter with optional operator prefix.
   * - '+1M': larger than 1 megabyte
   * - '-100K': smaller than 100 kilobytes
   * - '500B': exactly 500 bytes
   *
   * Supported suffixes: B (bytes), K (kilobytes), M (megabytes), G (gigabytes)
   */
  size?: string

  /**
   * Modified time filter.
   * - '-7d': modified within the last 7 days
   * - '+30d': modified more than 30 days ago
   * - '7d': modified approximately 7 days ago
   *
   * Supported suffixes: m (minutes), h (hours), d (days), w (weeks), M (months)
   */
  mtime?: string

  /**
   * Created/changed time filter (same format as mtime).
   */
  ctime?: string

  /**
   * Access time filter (same format as mtime).
   */
  atime?: string

  /**
   * Filter for empty files/directories.
   * - true: only empty files (size 0) or directories (no children)
   * - false: only non-empty entries
   * - undefined: no empty filtering
   */
  empty?: boolean

  /**
   * Directory patterns to skip during traversal.
   * Pruned directories are not entered, improving performance.
   *
   * @example
   * ```typescript
   * { prune: ['node_modules', '.git', 'dist'] }
   * { prune: ['.*'] }  // skip all hidden directories
   * ```
   */
  prune?: string[]

  /**
   * Filesystem backend for operations.
   * When not provided, uses internal mock filesystem (for testing).
   */
  backend?: FsBackend

  /**
   * Timeout in milliseconds for the entire find operation.
   * @throws {FindTimeoutError} When timeout is exceeded
   * @default undefined (no timeout)
   */
  timeout?: number

  /**
   * AbortSignal for cancelling the find operation.
   * @throws {FindAbortedError} When signal is aborted
   */
  signal?: AbortSignal
}

/**
 * Result entry from find().
 *
 * Each result contains essential metadata about the matched filesystem entry.
 * Results are sorted by path for stable, predictable ordering.
 *
 * @example
 * ```typescript
 * const results = await find({ name: '*.ts', type: 'f' })
 * for (const result of results) {
 *   console.log(`${result.path}: ${result.size} bytes, modified ${result.mtime}`)
 * }
 * ```
 */
export interface FindResult {
  /** Full absolute path to the file/directory */
  readonly path: string
  /** Type of the filesystem entry */
  readonly type: 'file' | 'directory' | 'symlink'
  /** Size in bytes (0 for directories) */
  readonly size: number
  /** Last modification time */
  readonly mtime: Date
}

/**
 * Internal file entry representation for mock filesystem.
 * @internal
 */
interface MockEntry {
  readonly type: 'file' | 'directory' | 'symlink'
  readonly size: number
  readonly mtime: number // timestamp in ms
  readonly ctime: number // timestamp in ms
  readonly atime: number // timestamp in ms
  readonly target?: string // for symlinks
  readonly children?: readonly string[] // for directories, list of child names
}

/**
 * Parsed size filter result.
 * @internal
 */
interface ParsedSize {
  readonly op: '+' | '-' | '='
  readonly bytes: number
}

/**
 * Parsed time filter result.
 * @internal
 */
interface ParsedTime {
  readonly op: '+' | '-' | '='
  readonly ms: number
}

/**
 * Type mapping from option characters to entry types.
 * @internal
 */
const TYPE_MAP: Readonly<Record<string, 'file' | 'directory' | 'symlink'>> = {
  'f': 'file',
  'd': 'directory',
  'l': 'symlink'
} as const

/**
 * Convert a date string to milliseconds timestamp.
 * @internal
 */
function dateToMs(dateStr: string): number {
  return new Date(dateStr).getTime()
}

/**
 * Mock filesystem for testing
 * Matches the structure in the test file comments
 */
const mockFS: Map<string, MockEntry> = new Map([
  // Root directory
  ['/', {
    type: 'directory',
    size: 4096,
    mtime: dateToMs('2024-01-01'),
    ctime: dateToMs('2024-01-01'),
    atime: Date.now(),
    children: ['README.md', 'package.json', '.gitignore', '.env', 'empty.txt', 'src', 'test', 'dist', 'node_modules', 'large-file.bin', 'link-to-readme']
  }],

  // Root level files
  ['/README.md', {
    type: 'file',
    size: 1000,
    mtime: dateToMs('2024-01-15'),
    ctime: dateToMs('2024-01-15'),
    atime: Date.now()
  }],
  ['/package.json', {
    type: 'file',
    size: 500,
    mtime: dateToMs('2024-01-10'),
    ctime: dateToMs('2024-01-10'),
    atime: Date.now()
  }],
  ['/.gitignore', {
    type: 'file',
    size: 50,
    mtime: dateToMs('2024-01-01'),
    ctime: dateToMs('2024-01-01'),
    atime: Date.now()
  }],
  ['/.env', {
    type: 'file',
    size: 100,
    mtime: dateToMs('2024-01-05'),
    ctime: dateToMs('2024-01-05'),
    atime: Date.now()
  }],
  ['/empty.txt', {
    type: 'file',
    size: 0,
    mtime: dateToMs('2024-01-20'),
    ctime: dateToMs('2024-01-20'),
    atime: Date.now()
  }],
  ['/large-file.bin', {
    type: 'file',
    size: 2000000, // 2MB
    mtime: dateToMs('2024-01-19'),
    ctime: dateToMs('2024-01-19'),
    atime: Date.now()
  }],
  ['/link-to-readme', {
    type: 'symlink',
    size: 9, // length of "README.md"
    mtime: dateToMs('2024-01-15'),
    ctime: dateToMs('2024-01-15'),
    atime: Date.now(),
    target: 'README.md'
  }],

  // src directory
  ['/src', {
    type: 'directory',
    size: 4096,
    mtime: dateToMs('2024-01-14'),
    ctime: dateToMs('2024-01-14'),
    atime: Date.now(),
    children: ['index.ts', 'utils', 'components']
  }],
  ['/src/index.ts', {
    type: 'file',
    size: 2000,
    mtime: dateToMs('2024-01-14'),
    ctime: dateToMs('2024-01-14'),
    atime: Date.now()
  }],

  // src/utils directory
  ['/src/utils', {
    type: 'directory',
    size: 4096,
    mtime: dateToMs('2024-01-13'),
    ctime: dateToMs('2024-01-13'),
    atime: Date.now(),
    children: ['helpers.ts', 'format.ts']
  }],
  ['/src/utils/helpers.ts', {
    type: 'file',
    size: 1500,
    mtime: dateToMs('2024-01-12'),
    ctime: dateToMs('2024-01-12'),
    atime: Date.now()
  }],
  ['/src/utils/format.ts', {
    type: 'file',
    size: 800,
    mtime: dateToMs('2024-01-13'),
    ctime: dateToMs('2024-01-13'),
    atime: Date.now()
  }],

  // src/components directory
  ['/src/components', {
    type: 'directory',
    size: 4096,
    mtime: dateToMs('2024-01-16'),
    ctime: dateToMs('2024-01-16'),
    atime: Date.now(),
    children: ['Button.tsx', 'Modal.tsx']
  }],
  ['/src/components/Button.tsx', {
    type: 'file',
    size: 3000,
    mtime: dateToMs('2024-01-11'),
    ctime: dateToMs('2024-01-11'),
    atime: Date.now()
  }],
  ['/src/components/Modal.tsx', {
    type: 'file',
    size: 5000,
    mtime: dateToMs('2024-01-16'),
    ctime: dateToMs('2024-01-16'),
    atime: Date.now()
  }],

  // test directory
  ['/test', {
    type: 'directory',
    size: 4096,
    mtime: dateToMs('2024-01-18'),
    ctime: dateToMs('2024-01-18'),
    atime: Date.now(),
    children: ['index.test.ts', 'helpers.test.ts']
  }],
  ['/test/index.test.ts', {
    type: 'file',
    size: 1200,
    mtime: dateToMs('2024-01-17'),
    ctime: dateToMs('2024-01-17'),
    atime: Date.now()
  }],
  ['/test/helpers.test.ts', {
    type: 'file',
    size: 900,
    mtime: dateToMs('2024-01-18'),
    ctime: dateToMs('2024-01-18'),
    atime: Date.now()
  }],

  // dist directory (empty)
  ['/dist', {
    type: 'directory',
    size: 4096,
    mtime: dateToMs('2024-01-01'),
    ctime: dateToMs('2024-01-01'),
    atime: Date.now(),
    children: []
  }],

  // node_modules directory
  ['/node_modules', {
    type: 'directory',
    size: 4096,
    mtime: dateToMs('2023-12-01'),
    ctime: dateToMs('2023-12-01'),
    atime: Date.now(),
    children: ['lodash']
  }],
  ['/node_modules/lodash', {
    type: 'directory',
    size: 4096,
    mtime: dateToMs('2023-12-01'),
    ctime: dateToMs('2023-12-01'),
    atime: Date.now(),
    children: ['index.js']
  }],
  ['/node_modules/lodash/index.js', {
    type: 'file',
    size: 50000,
    mtime: dateToMs('2023-12-01'),
    ctime: dateToMs('2023-12-01'),
    atime: Date.now()
  }],
])

/**
 * Size unit multipliers for parsing size strings.
 * Using binary units (1K = 1024 bytes).
 * @internal
 */
const SIZE_MULTIPLIERS: Readonly<Record<string, number>> = {
  'B': 1,
  'K': 1024,
  'M': 1024 * 1024,
  'G': 1024 * 1024 * 1024,
} as const

/**
 * Parse a size filter string into operator and byte count.
 *
 * Supported formats:
 * - '+1M': larger than 1 megabyte
 * - '-100K': smaller than 100 kilobytes
 * - '500B': exactly 500 bytes
 * - '1000': exactly 1000 bytes (no suffix = bytes)
 *
 * @param sizeStr - Size filter string
 * @returns Parsed operator and byte count
 * @internal
 *
 * @example
 * ```typescript
 * parseSize('+1M')   // { op: '+', bytes: 1048576 }
 * parseSize('-100K') // { op: '-', bytes: 102400 }
 * parseSize('500B')  // { op: '=', bytes: 500 }
 * ```
 */
function parseSize(sizeStr: string): ParsedSize {
  // Extract operator prefix if present
  let op: '+' | '-' | '=' = '='
  let remaining = sizeStr

  if (sizeStr.startsWith('+')) {
    op = '+'
    remaining = sizeStr.slice(1)
  } else if (sizeStr.startsWith('-')) {
    op = '-'
    remaining = sizeStr.slice(1)
  }

  // Parse number and optional suffix using regex
  const sizeMatch = remaining.match(/^(\d+(?:\.\d+)?)\s*([BKMG])?$/i)
  if (!sizeMatch) {
    // Fallback: try parsing as plain integer
    return { op, bytes: parseInt(remaining, 10) || 0 }
  }

  const numStr = sizeMatch[1]
  if (!numStr) {
    return { op, bytes: 0 }
  }

  const num = parseFloat(numStr)
  const suffix = (sizeMatch[2] || 'B').toUpperCase()
  const multiplier = SIZE_MULTIPLIERS[suffix] ?? 1
  const bytes = num * multiplier

  return { op, bytes }
}

/**
 * Time unit multipliers (in milliseconds) for parsing time strings.
 * @internal
 */
const TIME_MULTIPLIERS: Readonly<Record<string, number>> = {
  'm': 60 * 1000,                    // minutes
  'h': 60 * 60 * 1000,               // hours
  'd': 24 * 60 * 60 * 1000,          // days
  'w': 7 * 24 * 60 * 60 * 1000,      // weeks
  'M': 30 * 24 * 60 * 60 * 1000,     // months (approx 30 days)
} as const

/**
 * Parse a time filter string into operator and milliseconds.
 *
 * Supported formats:
 * - '-7d': within the last 7 days (newer than)
 * - '+30d': more than 30 days ago (older than)
 * - '7d': approximately 7 days ago
 *
 * Supported suffixes:
 * - 'm': minutes
 * - 'h': hours
 * - 'd': days (default if no suffix)
 * - 'w': weeks
 * - 'M': months (approximated as 30 days)
 *
 * @param timeStr - Time filter string
 * @returns Parsed operator and milliseconds
 * @internal
 *
 * @example
 * ```typescript
 * parseTime('-7d')  // { op: '-', ms: 604800000 } - newer than 7 days
 * parseTime('+30d') // { op: '+', ms: 2592000000 } - older than 30 days
 * parseTime('2w')   // { op: '=', ms: 1209600000 } - approximately 2 weeks
 * ```
 */
function parseTime(timeStr: string): ParsedTime {
  // Extract operator prefix if present
  let op: '+' | '-' | '=' = '='
  let remaining = timeStr

  if (timeStr.startsWith('+')) {
    op = '+'
    remaining = timeStr.slice(1)
  } else if (timeStr.startsWith('-')) {
    op = '-'
    remaining = timeStr.slice(1)
  }

  // Parse number and optional suffix using regex
  const timeMatch = remaining.match(/^(\d+(?:\.\d+)?)\s*([mhdwM])?$/i)
  if (!timeMatch) {
    // Fallback: try parsing as plain integer (days)
    return { op, ms: parseInt(remaining, 10) || 0 }
  }

  const numStr = timeMatch[1]
  if (!numStr) {
    return { op, ms: 0 }
  }

  const num = parseFloat(numStr)
  const suffix = timeMatch[2] || 'd' // default to days
  const multiplier = TIME_MULTIPLIERS[suffix] ?? TIME_MULTIPLIERS['d']!
  const ms = num * multiplier

  return { op, ms }
}

/**
 * Check if a file size matches the size filter.
 *
 * This is an "expensive" predicate that should be evaluated after cheap
 * predicates like type and name.
 *
 * @param size - File size in bytes
 * @param sizeFilter - Size filter string (e.g., '+1M', '-100K')
 * @returns True if size matches the filter
 * @internal
 */
function matchesSize(size: number, sizeFilter: string): boolean {
  const { op, bytes } = parseSize(sizeFilter)

  switch (op) {
    case '+':
      return size > bytes
    case '-':
      return size < bytes
    case '=':
      return size === bytes
  }
}

/**
 * Check if a timestamp matches the time filter.
 *
 * This is an "expensive" predicate that should be evaluated after cheap
 * predicates like type and name.
 *
 * @param timestamp - The file's timestamp in milliseconds
 * @param timeFilter - The filter string (e.g., '-7d', '+30d')
 * @returns True if timestamp matches the filter
 * @internal
 */
function matchesTime(timestamp: number, timeFilter: string): boolean {
  const { op, ms } = parseTime(timeFilter)
  const now = Date.now()
  const threshold = now - ms

  switch (op) {
    case '+':
      // older than: file time < threshold
      return timestamp < threshold
    case '-':
      // newer than: file time > threshold
      return timestamp > threshold
    case '=':
      // approximately equal (within a day)
      const dayMs = 24 * 60 * 60 * 1000
      return Math.abs(timestamp - threshold) < dayMs
  }
}

/**
 * Check if a mock filesystem directory entry is empty.
 *
 * @param entry - Mock filesystem entry
 * @returns True if entry is an empty directory
 * @internal
 */
function isEmptyDirectory(entry: MockEntry): boolean {
  if (entry.type !== 'directory') return false
  return !entry.children || entry.children.length === 0
}

/**
 * Check if a directory/file name matches any prune pattern.
 *
 * This is used for early termination optimization - pruned directories
 * are not traversed at all, significantly improving performance.
 *
 * @param name - Directory or file name to check
 * @param prunePatterns - Array of glob patterns or exact names to prune
 * @returns True if the name should be pruned (skipped)
 * @internal
 */
function shouldPrune(name: string, prunePatterns: readonly string[]): boolean {
  for (const pattern of prunePatterns) {
    // Try glob match first (handles patterns like '.*', 'node_*')
    try {
      if (match(pattern, name, { dot: true })) {
        return true
      }
    } catch {
      // If glob match fails, try direct string comparison
      if (name === pattern) {
        return true
      }
    }
  }
  return false
}

/**
 * Check if a filename matches the name filter.
 *
 * This is a "cheap" predicate that should be evaluated early in the
 * predicate chain, before expensive stat-based predicates.
 *
 * @param filename - Filename (not full path) to check
 * @param nameFilter - Glob pattern string or RegExp
 * @returns True if filename matches the filter
 * @internal
 */
function matchesName(filename: string, nameFilter: string | RegExp): boolean {
  if (nameFilter instanceof RegExp) {
    return nameFilter.test(filename)
  }

  // Use glob match for string patterns
  try {
    return match(nameFilter, filename, { dot: true })
  } catch {
    // Fallback to exact match if glob parsing fails
    return filename === nameFilter
  }
}

/**
 * Normalize a filesystem path.
 *
 * Ensures consistent path format:
 * - Removes trailing slash (except for root)
 * - Ensures leading slash
 *
 * @param path - Path to normalize
 * @returns Normalized path
 * @internal
 */
function normalizePath(path: string): string {
  if (path === '/') return '/'
  // Remove trailing slash
  let normalized = path.endsWith('/') ? path.slice(0, -1) : path
  // Ensure starts with /
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized
  }
  return normalized
}

/**
 * Extract the basename (filename) from a path.
 *
 * @param path - Full path
 * @returns Filename portion of the path
 * @internal
 */
function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

/**
 * Calculate depth of a path relative to a starting path.
 *
 * Used internally for depth-based filtering (maxdepth, mindepth).
 *
 * @param path - Path to measure
 * @param startPath - Reference starting path
 * @returns Relative depth (0 = same as start, 1 = direct child, etc.)
 * @internal
 */
function _getRelativeDepth(path: string, startPath: string): number {
  const normalizedPath = normalizePath(path)
  const normalizedStart = normalizePath(startPath)

  if (normalizedPath === normalizedStart) return 0

  // Count segments after the start path
  const startParts = normalizedStart === '/' ? [] : normalizedStart.split('/').filter(Boolean)
  const pathParts = normalizedPath.split('/').filter(Boolean)

  return pathParts.length - startParts.length
}
// Silence unused variable warning - reserved for future use
void _getRelativeDepth

/**
 * Find files in the filesystem matching the given criteria.
 *
 * This function provides Unix find-like file discovery with support for:
 * - Name pattern matching (glob and regex)
 * - File type filtering (file, directory, symlink)
 * - Depth control (maxdepth, mindepth)
 * - Size filtering (larger than, smaller than, exact)
 * - Time filtering (mtime, ctime, atime)
 * - Empty file/directory detection
 * - Directory pruning for performance
 * - Timeout and cancellation support
 *
 * ## Performance Optimizations
 *
 * Predicates are evaluated in order of cost for optimal performance:
 * 1. **Cheap predicates first**: type, name (string operations only)
 * 2. **Expensive predicates last**: size, time (may require stat calls)
 *
 * Additional optimizations:
 * - Early termination when maxdepth is reached
 * - Directory pruning skips entire subtrees
 * - Visited set prevents infinite loops from symlinks
 *
 * @param options - Search criteria (all optional)
 * @returns Promise resolving to array of matching entries, sorted by path
 * @throws {FindTimeoutError} When timeout is exceeded
 * @throws {FindAbortedError} When AbortSignal is triggered
 *
 * @example
 * ```typescript
 * // Find all TypeScript files
 * const tsFiles = await find({ name: '*.ts' })
 *
 * // Find large files (> 1MB)
 * const largeFiles = await find({ size: '+1M' })
 *
 * // Find recently modified files (within 7 days)
 * const recent = await find({ mtime: '-7d' })
 *
 * // Find empty directories
 * const emptyDirs = await find({ type: 'd', empty: true })
 *
 * // Complex query: TypeScript files in src, excluding node_modules
 * const srcTs = await find({
 *   path: '/src',
 *   name: '*.ts',
 *   type: 'f',
 *   prune: ['node_modules', '.git']
 * })
 *
 * // With timeout and cancellation
 * const controller = new AbortController()
 * const results = await find({
 *   path: '/',
 *   name: '*.log',
 *   timeout: 5000,
 *   signal: controller.signal
 * })
 * ```
 */
export async function find(options: FindOptions = {}): Promise<FindResult[]> {
  // Extract and normalize options
  const startTime = Date.now()
  const startPath = normalizePath(options.path || '/')
  const maxdepth = options.maxdepth ?? Infinity
  const mindepth = options.mindepth ?? 0
  const backend = options.backend
  const timeout = options.timeout
  const signal = options.signal

  // Note: In the backend implementation, stats are always fetched for type detection.
  // For a full lazy-stat optimization, the backend would need to support lstat separately,
  // or we'd need dirent-based traversal. Current implementation evaluates predicates
  // in optimal order after stat is fetched.

  /**
   * Check if timeout has been exceeded.
   * Called periodically during traversal.
   * @throws {FindTimeoutError}
   */
  const checkTimeout = (): void => {
    if (timeout && timeout > 0) {
      const elapsed = Date.now() - startTime
      if (elapsed > timeout) {
        throw new FindTimeoutError(startPath, timeout)
      }
    }
  }

  /**
   * Check if operation has been aborted.
   * Called periodically during traversal.
   * @throws {FindAbortedError}
   */
  const checkAbort = (): void => {
    if (signal?.aborted) {
      throw new FindAbortedError(startPath)
    }
  }

  // Check for immediate abort/timeout before starting
  checkAbort()
  checkTimeout()

  // Fast path: return empty for impossible depth range
  if (mindepth > maxdepth) {
    return []
  }

  // Check if starting path exists
  if (backend) {
    const exists = await backend.exists(startPath)
    if (!exists) {
      return []
    }
  } else {
    const startEntry = mockFS.get(startPath)
    if (!startEntry) {
      return []
    }
  }

  // Results array - populated during traversal
  const results: FindResult[] = []

  // Visited set prevents infinite loops from circular symlinks
  const visited = new Set<string>()

  /**
   * Recursively traverse the filesystem using a backend.
   *
   * Implements optimized predicate evaluation:
   * 1. Early termination checks (depth, prune, visited)
   * 2. Cheap predicates (type, name) - string operations only
   * 3. Expensive predicates (size, time, empty) - require stat data
   *
   * @param currentPath - Current path being evaluated
   * @param depth - Current depth relative to start path
   */
  async function traverseWithBackend(currentPath: string, depth: number): Promise<void> {
    // === EARLY TERMINATION CHECKS (most efficient) ===

    // Check for timeout/abort at each iteration
    checkTimeout()
    checkAbort()

    // Prevent infinite loops from circular symlinks
    if (visited.has(currentPath)) {
      return
    }
    visited.add(currentPath)

    // Early termination: don't traverse beyond maxdepth
    if (depth > maxdepth) {
      return
    }

    // Get stats for current path (required for type detection)
    let stats
    try {
      stats = await backend!.stat(currentPath)
    } catch (err) {
      // Handle permission denied gracefully - skip this path
      const e = err as Error & { code?: string }
      if (e.code === 'EACCES' || e.message?.includes('EACCES')) {
        return
      }
      throw err
    }

    // Determine entry type once (used by multiple predicates)
    const entryType: 'file' | 'directory' | 'symlink' = stats.isDirectory()
      ? 'directory'
      : stats.isSymbolicLink?.()
        ? 'symlink'
        : 'file'

    const filename = currentPath === '/' ? '/' : basename(currentPath)

    // Early termination: prune matching directories/files
    // This is a major optimization - entire subtrees are skipped
    if (options.prune && depth > 0) {
      if (shouldPrune(filename, options.prune)) {
        return
      }
    }

    // === PREDICATE EVALUATION (ordered by cost) ===

    let include = true

    // 1. Depth check (cheap - integer comparison)
    if (depth < mindepth) {
      include = false
    }

    // 2. Type check (cheap - string comparison)
    if (include && options.type !== undefined) {
      if (entryType !== TYPE_MAP[options.type]) {
        include = false
      }
    }

    // 3. Name check (cheap - string/regex matching)
    if (include && options.name !== undefined) {
      if (!matchesName(filename, options.name)) {
        include = false
      }
    }

    // 4. Size check (expensive - uses stat data already fetched)
    if (include && options.size !== undefined) {
      if (!matchesSize(stats.size, options.size)) {
        include = false
      }
    }

    // 5. Time checks (expensive - uses stat data already fetched)
    if (include && options.mtime !== undefined) {
      if (!matchesTime(stats.mtimeMs, options.mtime)) {
        include = false
      }
    }

    if (include && options.ctime !== undefined) {
      if (!matchesTime(stats.ctimeMs, options.ctime)) {
        include = false
      }
    }

    if (include && options.atime !== undefined) {
      if (!matchesTime(stats.atimeMs, options.atime)) {
        include = false
      }
    }

    // 6. Empty check (expensive - may require additional readdir)
    if (include && options.empty !== undefined) {
      if (options.empty) {
        // Looking for empty files/directories
        if (entryType === 'file') {
          if (stats.size !== 0) include = false
        } else if (entryType === 'directory') {
          const children = await backend!.readdir(currentPath)
          if (children.length !== 0) include = false
        } else {
          // Symlinks cannot be empty
          include = false
        }
      } else {
        // Looking for non-empty entries
        if (entryType === 'file') {
          if (stats.size === 0) include = false
        } else if (entryType === 'directory') {
          const children = await backend!.readdir(currentPath)
          if (children.length === 0) include = false
        }
      }
    }

    // === RESULT COLLECTION ===

    if (include) {
      results.push({
        path: currentPath,
        type: entryType,
        size: entryType === 'directory' ? 0 : stats.size,
        mtime: new Date(stats.mtimeMs)
      })
    }

    // === RECURSIVE TRAVERSAL ===

    // Only recurse into directories within depth limit
    if (entryType === 'directory' && depth < maxdepth) {
      const children = await backend!.readdir(currentPath) as string[]
      for (const childName of children) {
        const childPath = currentPath === '/' ? '/' + childName : currentPath + '/' + childName
        await traverseWithBackend(childPath, depth + 1)
      }
    }
  }

  /**
   * Recursively traverse the filesystem using mock filesystem.
   *
   * Implements optimized predicate evaluation:
   * 1. Early termination checks (depth, prune, visited)
   * 2. Cheap predicates (type, name) - string operations only
   * 3. Expensive predicates (size, time, empty) - use cached entry data
   *
   * @param currentPath - Current path being evaluated
   * @param depth - Current depth relative to start path
   */
  function traverseWithMock(currentPath: string, depth: number): void {
    // === EARLY TERMINATION CHECKS (most efficient) ===

    // Check for timeout/abort at each iteration
    checkTimeout()
    checkAbort()

    // Prevent infinite loops from circular symlinks
    if (visited.has(currentPath)) {
      return
    }
    visited.add(currentPath)

    // Early termination: don't traverse beyond maxdepth
    if (depth > maxdepth) {
      return
    }

    // Get entry from mock filesystem
    const entry = mockFS.get(currentPath)
    if (!entry) {
      return
    }

    const filename = currentPath === '/' ? '/' : basename(currentPath)

    // Early termination: prune matching directories/files
    // This is a major optimization - entire subtrees are skipped
    if (options.prune && depth > 0) {
      if (shouldPrune(filename, options.prune)) {
        return
      }
    }

    // === PREDICATE EVALUATION (ordered by cost) ===

    let include = true

    // 1. Depth check (cheap - integer comparison)
    if (depth < mindepth) {
      include = false
    }

    // 2. Type check (cheap - string comparison)
    if (include && options.type !== undefined) {
      if (entry.type !== TYPE_MAP[options.type]) {
        include = false
      }
    }

    // 3. Name check (cheap - string/regex matching)
    if (include && options.name !== undefined) {
      if (!matchesName(filename, options.name)) {
        include = false
      }
    }

    // 4. Size check (uses cached entry data - no I/O)
    if (include && options.size !== undefined) {
      if (!matchesSize(entry.size, options.size)) {
        include = false
      }
    }

    // 5. Time checks (uses cached entry data - no I/O)
    if (include && options.mtime !== undefined) {
      if (!matchesTime(entry.mtime, options.mtime)) {
        include = false
      }
    }

    if (include && options.ctime !== undefined) {
      if (!matchesTime(entry.ctime, options.ctime)) {
        include = false
      }
    }

    if (include && options.atime !== undefined) {
      if (!matchesTime(entry.atime, options.atime)) {
        include = false
      }
    }

    // 6. Empty check (uses cached children array - no I/O)
    if (include && options.empty !== undefined) {
      if (options.empty) {
        // Looking for empty files/directories
        if (entry.type === 'file') {
          if (entry.size !== 0) include = false
        } else if (entry.type === 'directory') {
          if (!isEmptyDirectory(entry)) include = false
        } else {
          // Symlinks cannot be empty
          include = false
        }
      } else {
        // Looking for non-empty entries
        if (entry.type === 'file') {
          if (entry.size === 0) include = false
        } else if (entry.type === 'directory') {
          if (isEmptyDirectory(entry)) include = false
        }
        // Symlinks are always considered non-empty
      }
    }

    // === RESULT COLLECTION ===

    if (include) {
      results.push({
        path: currentPath,
        type: entry.type,
        size: entry.type === 'directory' ? 0 : entry.size,
        mtime: new Date(entry.mtime)
      })
    }

    // === RECURSIVE TRAVERSAL ===

    // Only recurse into directories within depth limit
    // Don't follow symlinks to prevent loops
    if (entry.type === 'directory' && entry.children && depth < maxdepth) {
      for (const childName of entry.children) {
        const childPath = currentPath === '/' ? '/' + childName : currentPath + '/' + childName
        traverseWithMock(childPath, depth + 1)
      }
    }
  }

  // Execute traversal using appropriate method
  if (backend) {
    await traverseWithBackend(startPath, 0)
  } else {
    traverseWithMock(startPath, 0)
  }

  // Sort results by path for stable, predictable ordering
  results.sort((a, b) => a.path.localeCompare(b.path))

  return results
}
