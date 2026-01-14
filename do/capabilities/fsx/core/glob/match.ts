/**
 * Pattern matching for glob patterns
 *
 * This module provides functions for matching file paths against glob patterns.
 * Supports standard glob syntax: *, **, ?, [abc], [a-z], [!abc], {a,b,c}
 *
 * ## Performance Characteristics
 *
 * - **Pattern compilation**: O(n) where n is pattern length
 * - **Pattern cache**: LRU cache with configurable size (default: 1000 entries)
 * - **Simple pattern matching**: O(n) where n is path length (regex-based)
 * - **Globstar matching**: O(m*n) where m is pattern segments, n is path segments
 *   (with memoization to avoid exponential backtracking)
 *
 * ## Optimization Tips
 *
 * 1. Use `createMatcher()` when matching many paths against the same pattern
 * 2. Use `CompiledPatterns` class for batch operations with multiple patterns
 * 3. Prefer non-globstar patterns when possible (** requires segment matching)
 * 4. Pattern cache is automatically used for repeated `match()` calls
 */

/**
 * Options for pattern matching
 */
export interface MatchOptions {
  /** Match dotfiles (files starting with .) - default: false */
  dot?: boolean
  /** Case insensitive matching - default: false */
  nocase?: boolean
}

/**
 * Compiled pattern for efficient reuse
 */
interface CompiledPattern {
  /** Original pattern */
  pattern: string
  /** Whether pattern is negated */
  isNegated: boolean
  /** Regex for matching (null if uses globstar) */
  regex: RegExp | null
  /** Segments for globstar matching */
  segments: string[]
  /** Pre-compiled segment regexes for globstar matching */
  segmentRegexes: (RegExp | null)[]
  /** Whether pattern has globstar */
  hasGlobstar: boolean
  /** Whether this is a literal pattern (no wildcards) - enables fast-path matching */
  isLiteral: boolean
  /** Minimum required path segments (for early termination) */
  minSegments: number
  /** Maximum allowed path segments (for early termination, -1 if unbounded due to **) */
  maxSegments: number
  /** Options used for compilation */
  options: MatchOptions
}

// =============================================================================
// Pattern Cache (LRU-style)
// =============================================================================

/**
 * Cache entry with compiled pattern and access tracking
 */
interface CacheEntry {
  compiled: CompiledPattern
  lastAccess: number
}

/**
 * LRU-style pattern cache for compiled patterns.
 * Automatically evicts least recently used patterns when capacity is reached.
 */
class PatternCache {
  private cache = new Map<string, CacheEntry>()
  private accessCounter = 0
  readonly maxSize: number

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize
  }

  /**
   * Generate a unique cache key from pattern and options
   */
  private getKey(pattern: string, options: MatchOptions): string {
    return `${pattern}|${options.dot ? 1 : 0}|${options.nocase ? 1 : 0}`
  }

  /**
   * Get a compiled pattern from cache, or compile and cache it
   */
  get(pattern: string, options: MatchOptions): CompiledPattern {
    const key = this.getKey(pattern, options)
    const entry = this.cache.get(key)

    if (entry) {
      // Update access time for LRU tracking
      entry.lastAccess = ++this.accessCounter
      return entry.compiled
    }

    // Compile and cache
    const compiled = compilePatternInternal(pattern, options)
    this.set(key, compiled)
    return compiled
  }

  /**
   * Add a compiled pattern to the cache
   */
  private set(key: string, compiled: CompiledPattern): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictOldest()
    }

    this.cache.set(key, {
      compiled,
      lastAccess: ++this.accessCounter,
    })
  }

  /**
   * Evict the least recently used entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestAccess = Infinity

    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }

  /**
   * Clear all cached patterns
   */
  clear(): void {
    this.cache.clear()
    this.accessCounter = 0
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size
  }
}

/**
 * Global pattern cache instance
 */
const globalPatternCache = new PatternCache(1000)

/**
 * Check if a pattern segment contains any glob special characters.
 * Used to detect literal patterns for fast-path matching.
 *
 * Special characters: *, ?, [, ], {, }
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
 * Check if the entire pattern is a literal (no wildcards).
 * Literal patterns can use simple string comparison.
 */
function isLiteralPattern(segments: string[]): boolean {
  return segments.every((seg) => !hasWildcards(seg))
}

/**
 * Calculate minimum and maximum segment counts for early termination.
 * Returns [min, max] where max is -1 if unbounded (contains **).
 */
function calculateSegmentBounds(segments: string[]): [number, number] {
  let min = 0
  let max = 0
  let hasGlobstar = false

  for (const seg of segments) {
    if (seg === '**') {
      hasGlobstar = true
      // ** can match 0+ segments, so min doesn't increase
    } else if (seg !== '') {
      min++
      max++
    }
  }

  return [min, hasGlobstar ? -1 : max]
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Convert a single pattern segment to regex
 * Handles: *, ?, [abc], [!abc], [a-z], {a,b,c}
 */
function segmentToRegex(segment: string, options: MatchOptions): string {
  let result = ''
  let i = 0
  const dot = options.dot ?? false

  while (i < segment.length) {
    const char = segment[i]!

    if (char === '*') {
      // * matches anything except path separator
      // If at start and not dot mode, don't match dotfiles
      if (i === 0 && !dot) {
        result += '(?!\\.)[^/]*'
      } else {
        result += '[^/]*'
      }
      i++
    } else if (char === '?') {
      // ? matches single char except path separator
      // If at start and not dot mode, don't match dotfiles
      if (i === 0 && !dot) {
        result += '(?!\\.)[^/]'
      } else {
        result += '[^/]'
      }
      i++
    } else if (char === '[') {
      // Character class - find the closing ]
      const classStart = i
      i++

      // Check for negation
      let negated = false
      if (segment[i] === '!' || segment[i] === '^') {
        negated = true
        i++
      }

      // Find closing bracket (handle ] as first char in class)
      let classContent = ''
      let firstChar = true
      while (i < segment.length && (segment[i] !== ']' || firstChar)) {
        classContent += segment[i]
        firstChar = false
        i++
      }

      if (segment[i] === ']') {
        i++ // consume ]
        // Build character class
        // Escape special regex chars inside class (but not - or ^)
        let escapedContent = ''
        for (let j = 0; j < classContent.length; j++) {
          const c = classContent[j]
          // Escape special chars except - (which has special meaning)
          if (c === '\\' || c === ']' || c === '^') {
            escapedContent += '\\' + c
          } else {
            escapedContent += c
          }
        }
        result += negated ? `[^${escapedContent}]` : `[${escapedContent}]`
      } else {
        // No closing bracket, treat as literal
        result += escapeRegex(segment.slice(classStart))
      }
    } else if (char === '{') {
      // Brace expansion - find closing }
      const braceStart = i
      i++
      let depth = 1
      let braceContent = ''

      while (i < segment.length && depth > 0) {
        if (segment[i] === '{') depth++
        else if (segment[i] === '}') depth--
        if (depth > 0) {
          braceContent += segment[i]
        }
        i++
      }

      if (depth === 0) {
        // Split by comma and convert each alternative
        const alternatives = splitBraceContent(braceContent)
        const altRegexes = alternatives.map(alt => segmentToRegex(alt, { ...options, dot: true }))
        result += `(?:${altRegexes.join('|')})`
      } else {
        // No closing brace, treat as literal
        result += escapeRegex(segment.slice(braceStart))
      }
    } else if (char === '\\' && i + 1 < segment.length) {
      // Escaped character - treat next char literally
      const nextChar = segment[i + 1]
      if (nextChar !== undefined) {
        result += escapeRegex(nextChar)
      }
      i += 2
    } else {
      // Literal character
      result += escapeRegex(char)
      i++
    }
  }

  return result
}

/**
 * Split brace content by comma, handling nested braces
 */
function splitBraceContent(content: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    if (char === '{') {
      depth++
      current += char
    } else if (char === '}') {
      depth--
      current += char
    } else if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)

  return parts
}

/**
 * Internal pattern compilation (not cached)
 * Used by PatternCache and createMatcher
 *
 * Optimization features:
 * - Detects literal patterns for O(1) string comparison
 * - Calculates segment bounds for early termination
 * - Pre-compiles segment regexes for globstar matching
 */
function compilePatternInternal(pattern: string, options: MatchOptions = {}): CompiledPattern {
  if (pattern === '') {
    throw new Error('Pattern cannot be empty')
  }

  // Handle negation
  let isNegated = false
  let workingPattern = pattern

  while (workingPattern.startsWith('!')) {
    isNegated = !isNegated
    workingPattern = workingPattern.slice(1)
  }

  // Handle special case of just "/"
  if (workingPattern === '/') {
    return {
      pattern,
      isNegated,
      regex: /^\/$/,
      segments: ['/'],
      segmentRegexes: [null],
      hasGlobstar: false,
      isLiteral: true,
      minSegments: 1,
      maxSegments: 1,
      options,
    }
  }

  // Split pattern into segments
  const segments = workingPattern.split('/').filter((s, i, arr) => {
    // Keep empty strings for trailing slashes
    if (i === arr.length - 1 && s === '') return true
    return s !== ''
  })

  // Check if pattern has globstar
  const hasGlobstar = segments.some((s) => s === '**')

  // Check if pattern is literal (no wildcards) - enables fast-path
  const isLiteral = isLiteralPattern(segments)

  // Calculate segment bounds for early termination
  const [minSegments, maxSegments] = calculateSegmentBounds(segments)

  // If no globstar, we can compile to a single regex
  if (!hasGlobstar) {
    const regexParts = segments.map((seg) => segmentToRegex(seg, options))
    const regexStr = '^' + regexParts.join('/') + '$'
    const flags = options.nocase ? 'i' : ''

    return {
      pattern,
      isNegated,
      regex: new RegExp(regexStr, flags),
      segments,
      segmentRegexes: [], // Not needed for non-globstar patterns
      hasGlobstar: false,
      isLiteral,
      minSegments,
      maxSegments,
      options,
    }
  }

  // Has globstar - pre-compile segment regexes for efficient matching
  const flags = options.nocase ? 'i' : ''
  const segmentRegexes = segments.map((seg) => {
    if (seg === '**' || seg === '') {
      return null // No regex needed for globstar or empty segments
    }
    const regexStr = '^' + segmentToRegex(seg, options) + '$'
    return new RegExp(regexStr, flags)
  })

  return {
    pattern,
    isNegated,
    regex: null,
    segments,
    segmentRegexes,
    hasGlobstar: true,
    isLiteral: false, // Globstar patterns are never literal
    minSegments,
    maxSegments,
    options,
  }
}

/**
 * Compile a pattern using the global cache
 */
function compilePattern(pattern: string, options: MatchOptions = {}): CompiledPattern {
  return globalPatternCache.get(pattern, options)
}

/**
 * Match a single segment pattern against a path segment using pre-compiled regex
 */
function matchSegmentWithRegex(precompiledRegex: RegExp | null, patternSeg: string, pathSeg: string): boolean {
  if (precompiledRegex) {
    return precompiledRegex.test(pathSeg)
  }
  // Fallback for dynamic matching (shouldn't happen with proper compilation)
  return patternSeg === pathSeg
}

/**
 * Match path against compiled pattern with globstar support
 *
 * Uses pre-compiled segment regexes from the CompiledPattern for efficient matching.
 * Employs memoization to avoid exponential backtracking in complex patterns.
 */
function matchGlobstar(compiled: CompiledPattern, pathSegments: string[]): boolean {
  const { segments: patternSegments, segmentRegexes, options } = compiled
  const dot = options.dot ?? false

  // Recursive helper with memoization
  function matchFrom(pi: number, pathi: number, memo: Map<string, boolean>): boolean {
    const key = `${pi}:${pathi}`
    if (memo.has(key)) return memo.get(key)!

    // Base cases
    if (pi === patternSegments.length && pathi === pathSegments.length) {
      memo.set(key, true)
      return true
    }

    if (pi === patternSegments.length) {
      // Pattern exhausted but path remains
      memo.set(key, false)
      return false
    }

    const patternSeg = patternSegments[pi]
    const segmentRegex = segmentRegexes[pi] ?? null

    // Handle ** (globstar)
    if (patternSeg === '**') {
      // ** can match:
      // 1. Nothing (skip to next pattern segment)
      if (matchFrom(pi + 1, pathi, memo)) {
        memo.set(key, true)
        return true
      }

      // 2. One or more path segments
      for (let j = pathi; j < pathSegments.length; j++) {
        const pathSegAtJ = pathSegments[j]
        // Check dotfile constraint for each segment ** matches
        if (!dot && pathSegAtJ?.startsWith('.')) {
          // ** shouldn't match dotfiles unless dot option
          // But we continue trying to match later segments
        }
        if (matchFrom(pi + 1, j + 1, memo)) {
          memo.set(key, true)
          return true
        }
        // Also try consuming this segment and continuing with **
        if (matchFrom(pi, j + 1, memo)) {
          memo.set(key, true)
          return true
        }
      }

      memo.set(key, false)
      return false
    }

    // Path exhausted but pattern remains (and pattern is not **)
    if (pathi === pathSegments.length) {
      // Special case: trailing empty segment in pattern (for src/)
      if (patternSeg === '' && pi === patternSegments.length - 1) {
        memo.set(key, true)
        return true
      }
      memo.set(key, false)
      return false
    }

    const pathSeg = pathSegments[pathi]
    if (!pathSeg || !patternSeg) {
      memo.set(key, false)
      return false
    }

    // Check dotfile constraint
    if (!dot && pathSeg.startsWith('.') && patternSeg !== pathSeg) {
      // If the segment starts with . and pattern doesn't literally match,
      // check if pattern starts with * or ?
      if (patternSeg.startsWith('*') || patternSeg.startsWith('?')) {
        memo.set(key, false)
        return false
      }
    }

    // Match current segments using pre-compiled regex
    if (matchSegmentWithRegex(segmentRegex, patternSeg, pathSeg)) {
      const result = matchFrom(pi + 1, pathi + 1, memo)
      memo.set(key, result)
      return result
    }

    memo.set(key, false)
    return false
  }

  return matchFrom(0, 0, new Map())
}

/**
 * Match a path against a glob pattern
 *
 * Uses multiple optimization strategies:
 * 1. **Literal fast-path**: O(1) string comparison for patterns without wildcards
 * 2. **Early termination**: Rejects paths with wrong segment count before matching
 * 3. **Pattern caching**: Compiled patterns are cached in an LRU cache
 * 4. **Pre-compiled regexes**: Segment patterns are compiled once and reused
 *
 * @param pattern - The glob pattern to match against
 * @param path - The path to test
 * @param options - Matching options
 * @returns true if the path matches the pattern
 * @throws Error if pattern is empty
 *
 * @example Basic matching
 * ```typescript
 * match('*.ts', 'foo.ts')             // true
 * match('src/**\/*.ts', 'src/a/b.ts') // true
 * match('[abc].ts', 'a.ts')           // true
 * match('*.{ts,js}', 'foo.js')        // true
 * ```
 *
 * @example Literal patterns (fastest)
 * ```typescript
 * // Exact match - uses O(1) string comparison
 * match('src/index.ts', 'src/index.ts')  // true
 * match('package.json', 'tsconfig.json') // false
 * ```
 *
 * @example With options
 * ```typescript
 * match('*.TS', 'file.ts', { nocase: true })  // true (case-insensitive)
 * match('*', '.hidden', { dot: true })        // true (match dotfiles)
 * ```
 */
export function match(pattern: string, path: string, options: MatchOptions = {}): boolean {
  if (pattern === '') {
    throw new Error('Pattern cannot be empty')
  }

  // Empty path never matches (except empty pattern which throws)
  if (path === '') {
    return false
  }

  const compiled = compilePattern(pattern, options)

  // OPTIMIZATION 1: Fast-path for literal patterns (no wildcards)
  // Uses O(1) string comparison instead of regex
  if (compiled.isLiteral && !compiled.hasGlobstar) {
    const result = options.nocase
      ? path.toLowerCase() === compiled.segments.join('/').toLowerCase()
      : path === compiled.segments.join('/')
    return compiled.isNegated ? !result : result
  }

  // OPTIMIZATION 2: Early termination based on segment count
  // Count path segments for quick rejection
  const pathSegments = path.split('/').filter((s, i, arr) => {
    // Keep trailing empty segment
    if (i === arr.length - 1 && s === '' && path.endsWith('/')) return true
    return s !== ''
  })
  const pathSegmentCount = pathSegments.length

  // Reject if path has fewer segments than required minimum
  if (pathSegmentCount < compiled.minSegments) {
    return compiled.isNegated ? true : false
  }

  // Reject if path has more segments than allowed maximum (unless unbounded)
  if (compiled.maxSegments !== -1 && pathSegmentCount > compiled.maxSegments) {
    return compiled.isNegated ? true : false
  }

  // Handle simple regex match (no globstar)
  if (compiled.regex && !compiled.hasGlobstar) {
    const result = compiled.regex.test(path)
    return compiled.isNegated ? !result : result
  }

  // Handle globstar matching (with pre-compiled segment regexes)
  const result = matchGlobstar(compiled, pathSegments)
  return compiled.isNegated ? !result : result
}

/**
 * Create a reusable matcher function for a pattern
 *
 * More efficient when matching many paths against the same pattern,
 * as the pattern is only parsed once. The returned function includes
 * all optimizations (literal fast-path, early termination, pre-compiled regexes).
 *
 * @param pattern - The glob pattern to compile
 * @param options - Matching options
 * @returns A function that tests paths against the compiled pattern
 * @throws Error if pattern is empty
 *
 * @example Basic usage
 * ```typescript
 * const isTypeScript = createMatcher('**\/*.ts')
 * isTypeScript('src/index.ts')  // true
 * isTypeScript('README.md')     // false
 * ```
 *
 * @example Batch matching
 * ```typescript
 * const isSourceFile = createMatcher('src/**\/*.{ts,tsx}')
 * const sourceFiles = allFiles.filter(isSourceFile)
 * ```
 */
export function createMatcher(pattern: string, options: MatchOptions = {}): (path: string) => boolean {
  if (pattern === '') {
    throw new Error('Pattern cannot be empty')
  }

  // Directly compile without using cache (caller owns the matcher)
  const compiled = compilePatternInternal(pattern, options)

  // Pre-compute literal pattern string for fast-path
  const literalPath = compiled.isLiteral ? compiled.segments.join('/') : null
  const literalPathLower = literalPath && options.nocase ? literalPath.toLowerCase() : null

  return (path: string): boolean => {
    if (path === '') {
      return false
    }

    // OPTIMIZATION 1: Fast-path for literal patterns
    if (literalPath !== null) {
      const result = options.nocase
        ? path.toLowerCase() === literalPathLower
        : path === literalPath
      return compiled.isNegated ? !result : result
    }

    // Parse path segments for further checks
    const pathSegments = path.split('/').filter((s, i, arr) => {
      if (i === arr.length - 1 && s === '' && path.endsWith('/')) return true
      return s !== ''
    })
    const pathSegmentCount = pathSegments.length

    // OPTIMIZATION 2: Early termination based on segment count
    if (pathSegmentCount < compiled.minSegments) {
      return compiled.isNegated ? true : false
    }
    if (compiled.maxSegments !== -1 && pathSegmentCount > compiled.maxSegments) {
      return compiled.isNegated ? true : false
    }

    // Handle simple regex match (no globstar)
    if (compiled.regex && !compiled.hasGlobstar) {
      const result = compiled.regex.test(path)
      return compiled.isNegated ? !result : result
    }

    // Handle globstar matching
    const result = matchGlobstar(compiled, pathSegments)
    return compiled.isNegated ? !result : result
  }
}

// =============================================================================
// CompiledPatterns Class - Batch Pattern Matching
// =============================================================================

/**
 * Pre-compiled pattern set for efficient batch matching
 *
 * Use this class when you need to match many paths against multiple patterns,
 * or when patterns are reused frequently. All patterns are compiled once and
 * cached for optimal performance.
 *
 * ## Performance Characteristics
 *
 * - Construction: O(n*m) where n is number of patterns, m is average pattern length
 * - match(): O(p) where p is number of patterns (short-circuits on first match)
 * - matchAll(): O(n*p) where n is number of paths, p is number of patterns
 * - Memory: O(n) for n patterns plus their compiled representations
 *
 * @example
 * ```typescript
 * const patterns = new CompiledPatterns(['*.ts', '*.tsx', 'src/**\/*.js'])
 *
 * // Single path matching
 * patterns.match('index.ts')      // true
 * patterns.match('readme.md')     // false
 *
 * // Batch matching - returns matching paths
 * const files = ['index.ts', 'app.tsx', 'readme.md', 'src/utils.js']
 * patterns.matchAll(files)        // ['index.ts', 'app.tsx', 'src/utils.js']
 *
 * // Get patterns that match a specific path
 * patterns.matchingPatterns('index.ts')  // ['*.ts']
 * ```
 */
export class CompiledPatterns {
  private readonly matchers: Array<{
    pattern: string
    compiled: CompiledPattern
    matchFn: (path: string) => boolean
  }>

  /** Options used for all patterns in this set */
  readonly options: MatchOptions

  /**
   * Create a new CompiledPatterns instance
   *
   * All patterns are compiled with full optimizations:
   * - Literal fast-path for patterns without wildcards
   * - Early termination based on segment count
   * - Pre-compiled segment regexes
   *
   * @param patterns - Array of glob patterns to compile
   * @param options - Matching options applied to all patterns
   * @throws Error if any pattern is empty
   */
  constructor(patterns: string[], options: MatchOptions = {}) {
    this.options = options
    this.matchers = patterns.map((pattern) => {
      if (pattern === '') {
        throw new Error('Pattern cannot be empty')
      }

      const compiled = compilePatternInternal(pattern, options)

      // Pre-compute literal pattern string for fast-path
      const literalPath = compiled.isLiteral ? compiled.segments.join('/') : null
      const literalPathLower = literalPath && options.nocase ? literalPath.toLowerCase() : null

      // Create optimized matcher function for this pattern
      const matchFn = (path: string): boolean => {
        if (path === '') {
          return false
        }

        // OPTIMIZATION 1: Fast-path for literal patterns
        if (literalPath !== null) {
          const result = options.nocase
            ? path.toLowerCase() === literalPathLower
            : path === literalPath
          return compiled.isNegated ? !result : result
        }

        // Parse path segments
        const pathSegments = path.split('/').filter((s, i, arr) => {
          if (i === arr.length - 1 && s === '' && path.endsWith('/')) return true
          return s !== ''
        })
        const pathSegmentCount = pathSegments.length

        // OPTIMIZATION 2: Early termination based on segment count
        if (pathSegmentCount < compiled.minSegments) {
          return compiled.isNegated ? true : false
        }
        if (compiled.maxSegments !== -1 && pathSegmentCount > compiled.maxSegments) {
          return compiled.isNegated ? true : false
        }

        // Handle simple regex match (no globstar)
        if (compiled.regex && !compiled.hasGlobstar) {
          const result = compiled.regex.test(path)
          return compiled.isNegated ? !result : result
        }

        // Handle globstar matching
        const result = matchGlobstar(compiled, pathSegments)
        return compiled.isNegated ? !result : result
      }

      return { pattern, compiled, matchFn }
    })
  }

  /**
   * Check if a path matches any of the compiled patterns
   *
   * @param path - The path to test
   * @returns true if the path matches any pattern
   */
  match(path: string): boolean {
    if (path === '') {
      return false
    }

    return this.matchers.some((m) => m.matchFn(path))
  }

  /**
   * Filter paths to return only those matching any pattern
   *
   * @param paths - Array of paths to test
   * @returns Array of paths that match at least one pattern
   */
  matchAll(paths: string[]): string[] {
    return paths.filter((path) => this.match(path))
  }

  /**
   * Get all patterns that match a given path
   *
   * @param path - The path to test
   * @returns Array of patterns that match the path
   */
  matchingPatterns(path: string): string[] {
    if (path === '') {
      return []
    }

    return this.matchers.filter((m) => m.matchFn(path)).map((m) => m.pattern)
  }

  /**
   * Get the number of compiled patterns
   */
  get size(): number {
    return this.matchers.length
  }

  /**
   * Get all patterns as strings
   */
  get patterns(): string[] {
    return this.matchers.map((m) => m.pattern)
  }
}

// =============================================================================
// Cache Management Utilities
// =============================================================================

/**
 * Clear the global pattern cache
 *
 * Useful for testing or when memory pressure is high.
 * Generally not needed in production as the cache is bounded.
 */
export function clearPatternCache(): void {
  globalPatternCache.clear()
}

/**
 * Get the current size of the global pattern cache
 *
 * @returns Number of cached patterns
 */
export function getPatternCacheSize(): number {
  return globalPatternCache.size
}
