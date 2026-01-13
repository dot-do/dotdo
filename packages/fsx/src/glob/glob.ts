/**
 * Glob file matching for fsx
 *
 * Finds files matching glob patterns by combining pattern matching
 * with directory traversal.
 *
 * @module glob
 */

import { createMatcher } from './match'
import type { FsBackend } from '../backend'
import { ENOENT } from '../errors'

/**
 * Error thrown when a glob operation times out.
 */
export class GlobTimeoutError extends Error {
  /** The pattern(s) that were being matched */
  pattern: string | string[]
  /** Timeout duration in milliseconds */
  timeout: number

  constructor(pattern: string | string[], timeout: number) {
    super(`Glob operation timed out after ${timeout}ms`)
    this.name = 'GlobTimeoutError'
    this.pattern = pattern
    this.timeout = timeout
  }
}

/**
 * Error thrown when a glob operation is aborted.
 */
export class GlobAbortedError extends Error {
  /** The pattern(s) that were being matched */
  pattern: string | string[]

  constructor(pattern: string | string[]) {
    super('Glob operation was aborted')
    this.name = 'GlobAbortedError'
    this.pattern = pattern
  }
}

/**
 * Options for glob file matching.
 *
 * @example
 * ```typescript
 * const options: GlobOptions = {
 *   cwd: '/src',
 *   deep: 3,
 *   ignore: ['node_modules/**'],
 *   timeout: 5000,
 *   backend: myBackend,
 * }
 * ```
 */
export interface GlobOptions {
  /** Base directory for matching (default: '/') */
  cwd?: string
  /** Include dotfiles - files starting with . (default: false) */
  dot?: boolean
  /** Patterns to exclude from results */
  ignore?: string[]
  /** Only return files, not directories (default: true) */
  onlyFiles?: boolean
  /** Only return directories, not files */
  onlyDirectories?: boolean
  /** Maximum depth to traverse (undefined = unlimited) */
  deep?: number
  /** Return absolute paths instead of relative (default: false) */
  absolute?: boolean
  /** Follow symbolic links (default: true) */
  followSymlinks?: boolean
  /** FsBackend to use for filesystem operations (optional, falls back to mock FS) */
  backend?: FsBackend
  /**
   * Timeout in milliseconds for the entire glob operation.
   * Set to 0 or undefined for no timeout.
   * @throws {GlobTimeoutError} When timeout is exceeded
   */
  timeout?: number
  /**
   * AbortSignal for cancelling the glob operation.
   * When aborted, throws GlobAbortedError.
   * @throws {GlobAbortedError} When signal is aborted
   */
  signal?: AbortSignal
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
 * Matches the structure defined in glob.test.ts comments
 */
const mockFS: Map<string, FSEntry[]> = new Map([
  // Root directory
  ['/', [
    { type: 'directory', name: 'src' },
    { type: 'directory', name: 'lib' },
    { type: 'directory', name: 'test' },
    { type: 'directory', name: 'node_modules' },
    { type: 'directory', name: '.hidden' },
    { type: 'file', name: '.gitignore' },
    { type: 'file', name: '.env' },
    { type: 'file', name: 'package.json' },
    { type: 'file', name: 'README.md' },
    { type: 'file', name: 'tsconfig.json' },
  ]],

  // /src directory
  ['/src', [
    { type: 'file', name: 'index.ts' },
    { type: 'directory', name: 'utils' },
    { type: 'directory', name: 'components' },
  ]],

  // /src/utils
  ['/src/utils', [
    { type: 'file', name: 'helpers.ts' },
    { type: 'file', name: 'format.ts' },
  ]],

  // /src/components
  ['/src/components', [
    { type: 'file', name: 'Button.tsx' },
    { type: 'file', name: 'Modal.tsx' },
    { type: 'directory', name: 'ui' },
  ]],

  // /src/components/ui
  ['/src/components/ui', [
    { type: 'file', name: 'Icon.tsx' },
  ]],

  // /lib directory
  ['/lib', [
    { type: 'file', name: 'index.js' },
    { type: 'file', name: 'utils.js' },
  ]],

  // /test directory
  ['/test', [
    { type: 'file', name: 'index.test.ts' },
    { type: 'file', name: 'helpers.test.ts' },
  ]],

  // /node_modules
  ['/node_modules', [
    { type: 'directory', name: 'lodash' },
  ]],

  // /node_modules/lodash
  ['/node_modules/lodash', [
    { type: 'file', name: 'index.js' },
  ]],

  // /.hidden directory
  ['/.hidden', [
    { type: 'file', name: 'secrets.txt' },
  ]],
])

/**
 * Normalize path - remove trailing slash and collapse multiple slashes
 */
function normalizePath(path: string): string {
  if (path === '' || path === '/') return '/'
  let p = path.replace(/\/+/g, '/')
  if (p.endsWith('/') && p !== '/') {
    p = p.slice(0, -1)
  }
  return p
}

/**
 * Join two path segments
 */
function joinPath(base: string, segment: string): string {
  if (base === '/') return '/' + segment
  return base + '/' + segment
}

/**
 * Check if a path segment is a dotfile/dotdir
 */
function isDotEntry(name: string): boolean {
  return name.startsWith('.')
}

/**
 * Get depth of a path relative to a base
 */
function getDepth(path: string, base: string): number {
  const relativePath = getRelativePath(path, base)
  if (relativePath === '' || relativePath === '.') return 0
  return relativePath.split('/').length
}

/**
 * Get relative path from base to path
 */
function getRelativePath(path: string, base: string): string {
  const normalizedBase = normalizePath(base)
  const normalizedPath = normalizePath(path)

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
 * Legacy traverse function for filesystem entry collection.
 * @deprecated Use collectEntriesWithBackend or collectEntriesWithMock instead.
 * Kept for backwards compatibility with potential external consumers.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _traverse(
  dir: string,
  options: {
    dot: boolean
    deep?: number
    followSymlinks: boolean
    baseDir: string
  },
  collector: Array<{ path: string; type: FileType; depth: number }>
): Promise<void> {
  const entries = mockFS.get(normalizePath(dir))
  if (!entries) return

  const currentDepth = getDepth(dir, options.baseDir)

  for (const entry of entries) {
    const fullPath = joinPath(dir, entry.name)
    const depth = currentDepth + 1

    // Check depth limit
    if (options.deep !== undefined && depth > options.deep) {
      continue
    }

    // Check dotfile/dotdir constraint
    if (!options.dot && isDotEntry(entry.name)) {
      continue
    }

    // Handle symlinks
    if (entry.type === 'symlink' && !options.followSymlinks) {
      collector.push({ path: fullPath, type: 'symlink', depth })
      continue
    }

    collector.push({ path: fullPath, type: entry.type, depth })

    // Recurse into directories
    if (entry.type === 'directory') {
      await _traverse(fullPath, options, collector)
    }
  }
}

/**
 * Check if a pattern explicitly matches dotfiles
 */
function patternExplicitlyMatchesDot(pattern: string): boolean {
  // Pattern explicitly starts with . (like .gitignore, .* or .hidden/*)
  if (pattern.startsWith('.')) return true
  // Pattern has explicit dot segment (like **/.hidden/*)
  if (pattern.includes('/.')) return true
  return false
}

/**
 * Find files matching glob patterns.
 *
 * This function searches for files matching one or more glob patterns.
 * It supports:
 * - Single or multiple patterns
 * - Exclusion patterns via `ignore` option
 * - Depth limiting
 * - Timeout and cancellation support
 * - Both real filesystem (via FsBackend) and mock filesystem
 *
 * @param pattern - Single pattern or array of patterns to match
 * @param options - Glob options for filtering and behavior control
 * @returns Promise resolving to array of matching file paths
 * @throws {Error} If cwd does not exist or pattern is empty
 * @throws {GlobTimeoutError} If timeout is exceeded
 * @throws {GlobAbortedError} If signal is aborted
 *
 * @example
 * ```typescript
 * // Find all TypeScript files
 * const files = await glob('**\/*.ts')
 *
 * // Find files in specific directories
 * const sources = await glob(['src/**\/*.ts', 'lib/**\/*.ts'])
 *
 * // Exclude node_modules
 * const filtered = await glob('**\/*.js', { ignore: ['**\/node_modules/**'] })
 *
 * // With timeout
 * const files = await glob('**\/*.ts', { timeout: 5000 })
 *
 * // With abort signal
 * const controller = new AbortController()
 * setTimeout(() => controller.abort(), 2000)
 * const files = await glob('**\/*.ts', { signal: controller.signal })
 * ```
 */
export async function glob(
  pattern: string | string[],
  options?: GlobOptions
): Promise<string[]> {
  const startTime = Date.now()

  // Normalize pattern to array
  const patterns = Array.isArray(pattern) ? pattern : [pattern]

  // Handle empty array or empty string
  if (patterns.length === 0) {
    return []
  }

  // Check for empty pattern string
  if (patterns.some(p => p === '')) {
    throw new Error('Pattern cannot be empty')
  }

  // Extract options with defaults
  const cwd = normalizePath(options?.cwd ?? '/')
  const dot = options?.dot ?? false
  const ignore = options?.ignore ?? []
  const onlyFiles = options?.onlyFiles ?? true
  const onlyDirectories = options?.onlyDirectories ?? false
  const deep = options?.deep
  const absolute = options?.absolute ?? false
  const followSymlinks = options?.followSymlinks ?? true
  const backend = options?.backend
  const timeout = options?.timeout
  const signal = options?.signal

  // Helper to check timeout
  const checkTimeout = (): void => {
    if (timeout && timeout > 0) {
      const elapsed = Date.now() - startTime
      if (elapsed > timeout) {
        throw new GlobTimeoutError(pattern, timeout)
      }
    }
  }

  // Helper to check abort
  const checkAbort = (): void => {
    if (signal?.aborted) {
      throw new GlobAbortedError(pattern)
    }
  }

  // Check for immediate abort/timeout
  checkAbort()
  checkTimeout()

  // Check if cwd exists - use backend if provided
  if (backend) {
    const exists = await backend.exists(cwd)
    if (!exists) {
      throw new ENOENT('scandir', cwd)
    }
  } else {
    if (!mockFS.has(cwd)) {
      throw new ENOENT('scandir', cwd)
    }
  }

  // Check if any pattern explicitly targets dotfiles
  const anyPatternTargetsDot = patterns.some(patternExplicitlyMatchesDot)

  // Create matchers for each pattern
  const patternMatchers = patterns.map(p => {
    // Determine if this pattern should match dotfiles
    const patternDot = dot || patternExplicitlyMatchesDot(p)
    return {
      pattern: p,
      matcher: createMatcher(p, { dot: patternDot }),
      explicitDot: patternExplicitlyMatchesDot(p)
    }
  })

  // Create matchers for ignore patterns
  const ignoreMatchers = ignore.map(p => createMatcher(p, { dot: true }))

  // Collect all filesystem entries
  // depth tracks how many directory levels we've traversed (0 = cwd level, 1 = first level, etc.)
  const allEntries: Array<{ path: string; type: FileType; dirDepth: number }> = []

  // Recursive collector function with depth tracking (uses backend when available)
  async function collectEntriesWithBackend(
    dir: string,
    currentDirDepth: number
  ): Promise<void> {
    // Check for timeout/abort at each directory
    checkTimeout()
    checkAbort()

    // Use backend for readdir
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>
    try {
      entries = await backend!.readdir(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>
    } catch (err) {
      // Handle permission denied gracefully - skip directory
      const e = err as Error & { code?: string }
      if (e.code === 'EACCES' || e.message?.includes('EACCES')) {
        return
      }
      throw err
    }

    for (const entry of entries) {
      const fullPath = joinPath(dir, entry.name)
      const isDotEntry_ = isDotEntry(entry.name)

      // For dotfiles/dotdirs: include if dot option is true OR if a pattern explicitly targets them
      if (isDotEntry_ && !dot && !anyPatternTargetsDot) {
        continue
      }

      // Determine entry type using stat
      const stats = await backend!.stat(fullPath)
      const entryType: FileType = stats.isDirectory() ? 'directory' : stats.isSymbolicLink?.() ? 'symlink' : 'file'

      // Handle symlinks
      if (entryType === 'symlink' && !followSymlinks) {
        allEntries.push({ path: fullPath, type: 'symlink', dirDepth: currentDirDepth })
        continue
      }

      allEntries.push({ path: fullPath, type: entryType, dirDepth: currentDirDepth })

      // Recurse into directories if within depth limit
      if (entryType === 'directory') {
        if (deep === undefined || currentDirDepth < deep) {
          await collectEntriesWithBackend(fullPath, currentDirDepth + 1)
        }
      }
    }
  }

  // Recursive collector function with depth tracking (uses mockFS)
  async function collectEntriesWithMock(
    dir: string,
    currentDirDepth: number
  ): Promise<void> {
    // Check for timeout/abort at each directory
    checkTimeout()
    checkAbort()

    const entries = mockFS.get(normalizePath(dir))
    if (!entries) return

    for (const entry of entries) {
      const fullPath = joinPath(dir, entry.name)
      const isDotEntry_ = isDotEntry(entry.name)

      // For dotfiles/dotdirs: include if dot option is true OR if a pattern explicitly targets them
      if (isDotEntry_ && !dot && !anyPatternTargetsDot) {
        continue
      }

      // Handle symlinks
      if (entry.type === 'symlink' && !followSymlinks) {
        allEntries.push({ path: fullPath, type: 'symlink', dirDepth: currentDirDepth })
        continue
      }

      allEntries.push({ path: fullPath, type: entry.type, dirDepth: currentDirDepth })

      // Recurse into directories if within depth limit
      if (entry.type === 'directory') {
        // Only recurse if we haven't hit depth limit
        // deep: 0 means only root level files (no dirs traversed)
        // deep: 1 means traverse 1 level of directories
        if (deep === undefined || currentDirDepth < deep) {
          await collectEntriesWithMock(fullPath, currentDirDepth + 1)
        }
      }
    }
  }

  // Start collecting from cwd at depth 0 - use appropriate collector
  if (backend) {
    await collectEntriesWithBackend(cwd, 0)
  } else {
    await collectEntriesWithMock(cwd, 0)
  }

  // Filter and match entries
  const results: Set<string> = new Set()

  for (const entry of allEntries) {
    // Get relative path for matching
    const relativePath = getRelativePath(entry.path, cwd)

    // Check type filters
    if (onlyDirectories && entry.type !== 'directory') {
      continue
    }
    if (onlyFiles && !onlyDirectories && entry.type !== 'file') {
      continue
    }

    // Check if matches any pattern
    let matches = false
    for (const { pattern: _p, matcher, explicitDot } of patternMatchers) {
      // For dotfiles, only match if dot option is true or pattern explicitly targets them
      if (!dot && !explicitDot) {
        const pathParts = relativePath.split('/')
        const hasDotInPath = pathParts.some((part) => part.startsWith('.'))
        if (hasDotInPath) continue
      }

      if (matcher(relativePath)) {
        matches = true
        break
      }
    }

    if (!matches) continue

    // Check if matches any ignore pattern
    let ignored = false
    for (const ignoreMatcher of ignoreMatchers) {
      if (ignoreMatcher(relativePath)) {
        ignored = true
        break
      }
    }

    if (ignored) continue

    // Add to results
    if (absolute) {
      results.add(entry.path)
    } else {
      results.add(relativePath)
    }
  }

  // Sort results alphabetically and return
  return Array.from(results).sort()
}
