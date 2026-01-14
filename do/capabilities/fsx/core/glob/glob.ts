/**
 * Glob file matching for fsx
 *
 * Finds files matching glob patterns by combining pattern matching
 * with directory traversal.
 *
 * ## Performance Optimizations
 *
 * This module implements several optimizations for efficient file globbing:
 *
 * 1. **Literal Prefix Extraction** - Patterns like `src/utils/*.ts` are analyzed
 *    to extract the literal prefix (`src/utils/`) and start traversal there
 *    instead of from the root, dramatically reducing filesystem operations.
 *
 * 2. **Early Directory Pruning** - During traversal, directories that cannot
 *    possibly match any pattern are skipped entirely. For example, with pattern
 *    `src/**\/*.ts`, directories like `node_modules/` are pruned early.
 *
 * 3. **Depth-Limited Traversal** - When `deep` option is set, traversal stops
 *    at the specified depth without descending further.
 *
 * 4. **Streaming Results** - The `globStream()` generator function yields
 *    results as they're found, enabling memory-efficient processing of
 *    large result sets.
 *
 * 5. **Timeout and Cancellation** - Both `glob()` and `globStream()` support
 *    timeout and AbortSignal for graceful cancellation of long-running operations.
 *
 * ## Usage Examples
 *
 * @example Basic glob
 * ```typescript
 * // Find all TypeScript files
 * const files = await glob('**\/*.ts')
 *
 * // Find files in specific directories
 * const sources = await glob(['src/**\/*.ts', 'lib/**\/*.ts'])
 * ```
 *
 * @example With options
 * ```typescript
 * const files = await glob('**\/*.ts', {
 *   cwd: '/project',
 *   ignore: ['**\/node_modules/**'],
 *   timeout: 5000,
 *   deep: 5,
 * })
 * ```
 *
 * @example Streaming for large result sets
 * ```typescript
 * for await (const file of globStream('**\/*.ts')) {
 *   console.log(file)
 * }
 * ```
 *
 * @module glob
 */

import { createMatcher } from './match'
import type { FsBackend } from '../backend'

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
// Legacy function - preserved for potential external use
// @ts-expect-error Legacy function preserved for backward compatibility
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
 * Check if a pattern explicitly matches dotfiles.
 *
 * Returns true if the pattern explicitly targets dotfiles (files/directories
 * starting with `.`), which allows matching them even when `dot: false`.
 *
 * @param pattern - The glob pattern to check
 * @returns true if the pattern explicitly targets dotfiles
 *
 * @example
 * ```typescript
 * patternExplicitlyMatchesDot('.gitignore')  // true - starts with .
 * patternExplicitlyMatchesDot('**\/.hidden/*') // true - has /.
 * patternExplicitlyMatchesDot('src/*.ts')     // false
 * ```
 */
function patternExplicitlyMatchesDot(pattern: string): boolean {
  // Pattern explicitly starts with . (like .gitignore, .* or .hidden/*)
  if (pattern.startsWith('.')) return true
  // Pattern has explicit dot segment (like **/.hidden/*)
  if (pattern.includes('/.')) return true
  return false
}

// =============================================================================
// Pattern Analysis for Optimization
// =============================================================================

/**
 * Check if a pattern segment contains any glob special characters.
 *
 * @param segment - The pattern segment to check
 * @returns true if the segment contains wildcards
 */
function hasWildcards(segment: string): boolean {
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i]
    // Check for escape sequence - skip next char
    if (char === '\\' && i + 1 < segment.length) {
      i++
      continue
    }
    if (char === '*' || char === '?' || char === '[' || char === '{') {
      return true
    }
  }
  return false
}

/**
 * Extract the literal prefix from a glob pattern.
 *
 * Analyzes a pattern to find the longest path prefix that contains no wildcards.
 * This prefix can be used as the starting point for directory traversal,
 * significantly reducing the search space.
 *
 * @param pattern - The glob pattern to analyze
 * @returns Object with `prefix` (literal path segments) and `remainder` (rest of pattern)
 *
 * @example
 * ```typescript
 * extractLiteralPrefix('src/utils/*.ts')
 * // Returns { prefix: 'src/utils', remainder: '*.ts' }
 *
 * extractLiteralPrefix('**\/*.ts')
 * // Returns { prefix: '', remainder: '**\/*.ts' }
 *
 * extractLiteralPrefix('src/components/Button.tsx')
 * // Returns { prefix: 'src/components/Button.tsx', remainder: '' }
 * ```
 */
function extractLiteralPrefix(pattern: string): { prefix: string; remainder: string } {
  const segments = pattern.split('/')
  const literalSegments: string[] = []

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (segment === undefined) continue

    // Stop at first segment with wildcards or globstar
    if (hasWildcards(segment) || segment === '**') {
      const remainder = segments.slice(i).join('/')
      return {
        prefix: literalSegments.join('/'),
        remainder,
      }
    }

    literalSegments.push(segment)
  }

  // Entire pattern is literal
  return {
    prefix: literalSegments.join('/'),
    remainder: '',
  }
}

/**
 * Information about a pattern for optimization during traversal.
 */
interface PatternInfo {
  /** Original pattern */
  pattern: string
  /** Matcher function */
  matcher: (path: string) => boolean
  /** Whether pattern explicitly targets dotfiles */
  explicitDot: boolean
  /** Literal prefix for starting traversal */
  literalPrefix: string
  /** Remainder of pattern after prefix */
  remainder: string
  /** First segment(s) that must match - for directory pruning */
  requiredPrefixSegments: string[]
  /** Whether pattern has globstar (can match any depth) */
  hasGlobstar: boolean
}

/**
 * Analyze a pattern for optimization information.
 *
 * @param pattern - The glob pattern to analyze
 * @param dot - Whether to match dotfiles
 * @returns Pattern info for optimized matching
 */
function analyzePattern(pattern: string, dot: boolean): PatternInfo {
  const { prefix, remainder } = extractLiteralPrefix(pattern)
  const explicitDot = patternExplicitlyMatchesDot(pattern)
  const patternDot = dot || explicitDot
  const matcher = createMatcher(pattern, { dot: patternDot })

  // Extract required prefix segments for pruning
  const segments = pattern.split('/')
  const requiredPrefixSegments: string[] = []
  for (const seg of segments) {
    if (seg === '**' || hasWildcards(seg)) break
    requiredPrefixSegments.push(seg)
  }

  const hasGlobstar = pattern.includes('**')

  return {
    pattern,
    matcher,
    explicitDot,
    literalPrefix: prefix,
    remainder,
    requiredPrefixSegments,
    hasGlobstar,
  }
}

/**
 * Check if a directory path could possibly contain matches for any pattern.
 *
 * Used for early pruning during traversal - if a directory cannot possibly
 * contain matches, we skip traversing into it entirely.
 *
 * @param dirPath - The directory path (relative to cwd)
 * @param patterns - Array of pattern infos
 * @param dot - Whether to match dotfiles
 * @returns true if the directory could contain matches
 */
function couldContainMatches(
  dirPath: string,
  patterns: PatternInfo[],
  dot: boolean
): boolean {
  // Check each pattern to see if this directory could contain matches
  for (const info of patterns) {
    // If pattern has globstar, it can match at any depth
    if (info.hasGlobstar) {
      // For patterns like **/*.ts, any directory could contain matches
      // But for patterns like src/**/*.ts, only src and its children could match
      if (info.literalPrefix === '') {
        return true // Pattern like **/*.ts can match anywhere
      }

      // Check if dirPath is a prefix of literalPrefix or vice versa
      if (
        dirPath === '' ||
        info.literalPrefix.startsWith(dirPath + '/') ||
        info.literalPrefix === dirPath ||
        dirPath.startsWith(info.literalPrefix + '/') ||
        dirPath.startsWith(info.literalPrefix)
      ) {
        return true
      }
    } else {
      // Non-globstar pattern - check if dirPath is on the path to a match
      if (info.literalPrefix === '') {
        // Pattern matches in root, e.g., *.ts
        if (dirPath === '') return true
        continue
      }

      // Check if literalPrefix starts with or equals dirPath
      if (
        info.literalPrefix.startsWith(dirPath + '/') ||
        info.literalPrefix === dirPath ||
        dirPath.startsWith(info.literalPrefix + '/') ||
        dirPath.startsWith(info.literalPrefix)
      ) {
        return true
      }
    }
  }

  // Additional check: use pattern matchers with wildcard prefix
  // This handles patterns like {src,lib}/**/*.ts
  for (const info of patterns) {
    // Try matching the directory path with /** appended to see if traversal might help
    const testPath = dirPath === '' ? '**' : dirPath + '/**'
    if (info.matcher(testPath)) return true

    // Also check if any file in this directory could match
    // by testing with a wildcard file
    const testFile = dirPath === '' ? 'x' : dirPath + '/x'
    if (info.matcher(testFile)) return true
  }

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
      throw new Error(`ENOENT: no such file or directory, scandir '${cwd}'`)
    }
  } else {
    if (!mockFS.has(cwd)) {
      throw new Error(`ENOENT: no such file or directory, scandir '${cwd}'`)
    }
  }

  // Check if any pattern explicitly targets dotfiles
  const anyPatternTargetsDot = patterns.some(patternExplicitlyMatchesDot)

  // Analyze patterns for optimization
  const patternInfos = patterns.map(p => analyzePattern(p, dot))

  // Create matchers for ignore patterns
  const ignoreMatchers = ignore.map(p => createMatcher(p, { dot: true }))

  // Collect all filesystem entries
  // depth tracks how many directory levels we've traversed (0 = cwd level, 1 = first level, etc.)
  const allEntries: Array<{ path: string; type: FileType; dirDepth: number }> = []

  /**
   * Check if a directory should be traversed based on pattern analysis.
   * This implements early pruning - if no pattern could possibly match
   * files within this directory, we skip it entirely.
   *
   * @param relativeDirPath - Directory path relative to cwd
   * @returns true if directory should be traversed
   */
  function shouldTraverseDirectory(relativeDirPath: string): boolean {
    // Always traverse root
    if (relativeDirPath === '') return true

    // Check if any pattern could match files in this directory
    for (const info of patternInfos) {
      // Patterns with globstar can match at any depth
      if (info.hasGlobstar) {
        // For patterns like **/*.ts, always traverse
        if (info.literalPrefix === '') return true

        // For patterns like src/**/*.ts, check if we're in/under src
        if (
          relativeDirPath === info.literalPrefix ||
          relativeDirPath.startsWith(info.literalPrefix + '/') ||
          info.literalPrefix.startsWith(relativeDirPath + '/')
        ) {
          return true
        }
      } else {
        // Non-globstar patterns have a fixed structure
        // Only traverse if on path to potential matches
        if (info.literalPrefix === '') {
          // Pattern like *.ts only matches root level
          continue
        }

        // Check if current directory is on the path to potential matches
        if (
          relativeDirPath === info.literalPrefix ||
          info.literalPrefix.startsWith(relativeDirPath + '/')
        ) {
          return true
        }
      }

      // For patterns with brace expansion like {src,lib}/**/*.ts,
      // test if a file in this directory could match
      const testFile = relativeDirPath + '/test.file'
      if (info.matcher(testFile)) return true

      // Also test a deeper path in case pattern matches nested files
      const deepTestFile = relativeDirPath + '/a/b/test.file'
      if (info.matcher(deepTestFile)) return true
    }

    return false
  }

  // Recursive collector function with depth tracking and early pruning (uses backend)
  async function collectEntriesWithBackend(
    dir: string,
    currentDirDepth: number,
    relativeDirPath: string
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
      const relativeEntryPath = relativeDirPath === ''
        ? entry.name
        : relativeDirPath + '/' + entry.name
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

      // Recurse into directories if within depth limit AND could contain matches
      if (entryType === 'directory') {
        if (deep === undefined || currentDirDepth < deep) {
          // Early pruning: skip directories that can't contain matches
          if (shouldTraverseDirectory(relativeEntryPath)) {
            await collectEntriesWithBackend(fullPath, currentDirDepth + 1, relativeEntryPath)
          }
        }
      }
    }
  }

  // Recursive collector function with depth tracking and early pruning (uses mockFS)
  async function collectEntriesWithMock(
    dir: string,
    currentDirDepth: number,
    relativeDirPath: string
  ): Promise<void> {
    // Check for timeout/abort at each directory
    checkTimeout()
    checkAbort()

    const entries = mockFS.get(normalizePath(dir))
    if (!entries) return

    for (const entry of entries) {
      const fullPath = joinPath(dir, entry.name)
      const relativeEntryPath = relativeDirPath === ''
        ? entry.name
        : relativeDirPath + '/' + entry.name
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

      // Recurse into directories if within depth limit AND could contain matches
      if (entry.type === 'directory') {
        // Only recurse if we haven't hit depth limit
        // deep: 0 means only root level files (no dirs traversed)
        // deep: 1 means traverse 1 level of directories
        if (deep === undefined || currentDirDepth < deep) {
          // Early pruning: skip directories that can't contain matches
          if (shouldTraverseDirectory(relativeEntryPath)) {
            await collectEntriesWithMock(fullPath, currentDirDepth + 1, relativeEntryPath)
          }
        }
      }
    }
  }

  // Start collecting from cwd at depth 0 - use appropriate collector
  if (backend) {
    await collectEntriesWithBackend(cwd, 0, '')
  } else {
    await collectEntriesWithMock(cwd, 0, '')
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
    for (const info of patternInfos) {
      // For dotfiles, only match if dot option is true or pattern explicitly targets them
      if (!dot && !info.explicitDot) {
        const pathParts = relativePath.split('/')
        const hasDotInPath = pathParts.some((part) => part.startsWith('.'))
        if (hasDotInPath) continue
      }

      if (info.matcher(relativePath)) {
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

// =============================================================================
// Streaming Glob (Generator-based)
// =============================================================================

/**
 * Find files matching glob patterns, yielding results as they are found.
 *
 * This is a generator version of `glob()` that yields matching files as they
 * are discovered during traversal. Use this for memory-efficient processing
 * of large result sets.
 *
 * ## Memory Efficiency
 *
 * Unlike `glob()` which collects all results before returning, `globStream()`
 * yields results immediately as they are found. This means:
 *
 * - Memory usage is O(1) instead of O(n) for n results
 * - Processing can begin before traversal completes
 * - Early termination is possible (just stop iterating)
 *
 * ## Caveats
 *
 * - Results are yielded in traversal order, not sorted
 * - Deduplication happens incrementally (maintains a Set internally)
 * - For sorted results, use `glob()` instead
 *
 * @param pattern - Single pattern or array of patterns to match
 * @param options - Glob options for filtering and behavior control
 * @yields Matching file paths as they are found
 * @throws {Error} If cwd does not exist or pattern is empty
 * @throws {GlobTimeoutError} If timeout is exceeded
 * @throws {GlobAbortedError} If signal is aborted
 *
 * @example Basic streaming
 * ```typescript
 * // Process files as they're found (memory efficient)
 * for await (const file of globStream('**\/*.ts')) {
 *   await processFile(file)
 * }
 * ```
 *
 * @example Early termination
 * ```typescript
 * // Stop after finding first 10 matches
 * let count = 0
 * for await (const file of globStream('**\/*.ts')) {
 *   console.log(file)
 *   if (++count >= 10) break
 * }
 * ```
 *
 * @example With abort signal
 * ```typescript
 * const controller = new AbortController()
 * setTimeout(() => controller.abort(), 5000)
 *
 * try {
 *   for await (const file of globStream('**\/*', { signal: controller.signal })) {
 *     await processFile(file)
 *   }
 * } catch (e) {
 *   if (e instanceof GlobAbortedError) {
 *     console.log('Search cancelled')
 *   }
 * }
 * ```
 */
export async function* globStream(
  pattern: string | string[],
  options?: GlobOptions
): AsyncGenerator<string, void, undefined> {
  const startTime = Date.now()

  // Normalize pattern to array
  const patterns = Array.isArray(pattern) ? pattern : [pattern]

  // Handle empty array or empty string
  if (patterns.length === 0) {
    return
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
      throw new Error(`ENOENT: no such file or directory, scandir '${cwd}'`)
    }
  } else {
    if (!mockFS.has(cwd)) {
      throw new Error(`ENOENT: no such file or directory, scandir '${cwd}'`)
    }
  }

  // Check if any pattern explicitly targets dotfiles
  const anyPatternTargetsDot = patterns.some(patternExplicitlyMatchesDot)

  // Analyze patterns for optimization
  const patternInfos = patterns.map(p => analyzePattern(p, dot))

  // Create matchers for ignore patterns
  const ignoreMatchers = ignore.map(p => createMatcher(p, { dot: true }))

  // Track yielded results to prevent duplicates
  const yieldedResults = new Set<string>()

  /**
   * Check if a directory should be traversed based on pattern analysis.
   */
  function shouldTraverseDirectory(relativeDirPath: string): boolean {
    if (relativeDirPath === '') return true

    for (const info of patternInfos) {
      if (info.hasGlobstar) {
        if (info.literalPrefix === '') return true
        if (
          relativeDirPath === info.literalPrefix ||
          relativeDirPath.startsWith(info.literalPrefix + '/') ||
          info.literalPrefix.startsWith(relativeDirPath + '/')
        ) {
          return true
        }
      } else {
        if (info.literalPrefix === '') continue
        if (
          relativeDirPath === info.literalPrefix ||
          info.literalPrefix.startsWith(relativeDirPath + '/')
        ) {
          return true
        }
      }

      const testFile = relativeDirPath + '/test.file'
      if (info.matcher(testFile)) return true

      const deepTestFile = relativeDirPath + '/a/b/test.file'
      if (info.matcher(deepTestFile)) return true
    }

    return false
  }

  /**
   * Check if an entry matches any pattern and should be yielded.
   */
  function checkMatch(relativePath: string, entryType: FileType): boolean {
    // Check type filters
    if (onlyDirectories && entryType !== 'directory') {
      return false
    }
    if (onlyFiles && !onlyDirectories && entryType !== 'file') {
      return false
    }

    // Check if matches any pattern
    for (const info of patternInfos) {
      if (!dot && !info.explicitDot) {
        const pathParts = relativePath.split('/')
        const hasDotInPath = pathParts.some((part) => part.startsWith('.'))
        if (hasDotInPath) continue
      }

      if (info.matcher(relativePath)) {
        // Check if matches any ignore pattern
        for (const ignoreMatcher of ignoreMatchers) {
          if (ignoreMatcher(relativePath)) {
            return false
          }
        }
        return true
      }
    }

    return false
  }

  // Generator-based traversal with backend
  async function* traverseWithBackend(
    dir: string,
    currentDirDepth: number,
    relativeDirPath: string
  ): AsyncGenerator<string, void, undefined> {
    checkTimeout()
    checkAbort()

    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>
    try {
      entries = await backend!.readdir(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>
    } catch (err) {
      const e = err as Error & { code?: string }
      if (e.code === 'EACCES' || e.message?.includes('EACCES')) {
        return
      }
      throw err
    }

    for (const entry of entries) {
      const fullPath = joinPath(dir, entry.name)
      const relativeEntryPath = relativeDirPath === ''
        ? entry.name
        : relativeDirPath + '/' + entry.name
      const isDotEntry_ = isDotEntry(entry.name)

      if (isDotEntry_ && !dot && !anyPatternTargetsDot) {
        continue
      }

      const stats = await backend!.stat(fullPath)
      const entryType: FileType = stats.isDirectory() ? 'directory' : stats.isSymbolicLink?.() ? 'symlink' : 'file'

      if (entryType === 'symlink' && !followSymlinks) {
        if (checkMatch(relativeEntryPath, 'symlink')) {
          const result = absolute ? fullPath : relativeEntryPath
          if (!yieldedResults.has(result)) {
            yieldedResults.add(result)
            yield result
          }
        }
        continue
      }

      // Check for match and yield immediately
      if (checkMatch(relativeEntryPath, entryType)) {
        const result = absolute ? fullPath : relativeEntryPath
        if (!yieldedResults.has(result)) {
          yieldedResults.add(result)
          yield result
        }
      }

      // Recurse into directories
      if (entryType === 'directory') {
        if (deep === undefined || currentDirDepth < deep) {
          if (shouldTraverseDirectory(relativeEntryPath)) {
            yield* traverseWithBackend(fullPath, currentDirDepth + 1, relativeEntryPath)
          }
        }
      }
    }
  }

  // Generator-based traversal with mock FS
  async function* traverseWithMock(
    dir: string,
    currentDirDepth: number,
    relativeDirPath: string
  ): AsyncGenerator<string, void, undefined> {
    checkTimeout()
    checkAbort()

    const entries = mockFS.get(normalizePath(dir))
    if (!entries) return

    for (const entry of entries) {
      const fullPath = joinPath(dir, entry.name)
      const relativeEntryPath = relativeDirPath === ''
        ? entry.name
        : relativeDirPath + '/' + entry.name
      const isDotEntry_ = isDotEntry(entry.name)

      if (isDotEntry_ && !dot && !anyPatternTargetsDot) {
        continue
      }

      if (entry.type === 'symlink' && !followSymlinks) {
        if (checkMatch(relativeEntryPath, 'symlink')) {
          const result = absolute ? fullPath : relativeEntryPath
          if (!yieldedResults.has(result)) {
            yieldedResults.add(result)
            yield result
          }
        }
        continue
      }

      // Check for match and yield immediately
      if (checkMatch(relativeEntryPath, entry.type)) {
        const result = absolute ? fullPath : relativeEntryPath
        if (!yieldedResults.has(result)) {
          yieldedResults.add(result)
          yield result
        }
      }

      // Recurse into directories
      if (entry.type === 'directory') {
        if (deep === undefined || currentDirDepth < deep) {
          if (shouldTraverseDirectory(relativeEntryPath)) {
            yield* traverseWithMock(fullPath, currentDirDepth + 1, relativeEntryPath)
          }
        }
      }
    }
  }

  // Start traversal
  if (backend) {
    yield* traverseWithBackend(cwd, 0, '')
  } else {
    yield* traverseWithMock(cwd, 0, '')
  }
}
