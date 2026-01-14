// =============================================================================
// LRU Cache for Pattern Compilation
// =============================================================================

/**
 * Statistics for pattern cache performance monitoring
 */
export interface PatternCacheStats {
  /** Number of cache hits */
  hits: number
  /** Number of cache misses */
  misses: number
  /** Current number of cached entries */
  size: number
  /** Maximum cache capacity */
  capacity: number
  /** Cache hit rate (0.0 - 1.0) */
  hitRate: number
}

/**
 * LRU (Least Recently Used) cache for compiled regex patterns
 *
 * Uses a Map for O(1) access and maintains insertion order for eviction.
 * When the cache reaches maxSize, the oldest entries are evicted.
 */
class PatternLRUCache {
  /** Internal storage using Map's insertion order */
  private cache: Map<string, RegExp>

  /** Maximum number of entries before eviction */
  private readonly maxSize: number

  /** Cache hit counter */
  private _hits: number = 0

  /** Cache miss counter */
  private _misses: number = 0

  /**
   * Create a new LRU cache for compiled patterns
   *
   * @param maxSize - Maximum number of entries (default: 1000)
   */
  constructor(maxSize: number = 1000) {
    this.cache = new Map()
    this.maxSize = maxSize
  }

  /**
   * Get a compiled regex from the cache
   *
   * Accessing a value moves it to the "most recently used" position.
   *
   * @param key - The pattern string key
   * @returns The cached RegExp or undefined if not found
   */
  get(key: string): RegExp | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      this._hits++
      // Move to end (most recently used) by re-inserting
      this.cache.delete(key)
      this.cache.set(key, value)
      return value
    }
    this._misses++
    return undefined
  }

  /**
   * Set a compiled regex in the cache
   *
   * If the cache is at capacity, the least recently used entry is evicted.
   *
   * @param key - The pattern string key
   * @param value - The compiled RegExp to cache
   */
  set(key: string, value: RegExp): void {
    // If key exists, delete it first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(key, value)
  }

  /**
   * Check if a pattern is in the cache
   *
   * @param key - The pattern string key
   * @returns true if the pattern is cached
   */
  has(key: string): boolean {
    return this.cache.has(key)
  }

  /**
   * Get the current number of cached patterns
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Get cache statistics
   */
  get stats(): PatternCacheStats {
    const total = this._hits + this._misses
    return {
      hits: this._hits,
      misses: this._misses,
      size: this.cache.size,
      capacity: this.maxSize,
      hitRate: total > 0 ? this._hits / total : 0,
    }
  }

  /**
   * Reset cache statistics (does not clear the cache itself)
   */
  resetStats(): void {
    this._hits = 0
    this._misses = 0
  }

  /**
   * Clear all entries from the cache and reset statistics
   */
  clear(): void {
    this.cache.clear()
    this._hits = 0
    this._misses = 0
  }
}

// Global pattern cache with default capacity of 1000 patterns
const globalPatternCache = new PatternLRUCache(1000)

/**
 * Get the global pattern cache statistics
 *
 * Use this to monitor cache performance and tune cache size.
 *
 * @returns Current cache statistics
 *
 * @example
 * ```typescript
 * const stats = getPatternCacheStats()
 * console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`)
 * console.log(`Cache size: ${stats.size}/${stats.capacity}`)
 * ```
 */
export function getPatternCacheStats(): PatternCacheStats {
  return globalPatternCache.stats
}

/**
 * Reset the global pattern cache statistics
 *
 * Useful for benchmarking or periodic monitoring.
 */
export function resetPatternCacheStats(): void {
  globalPatternCache.resetStats()
}

/**
 * Clear the global pattern cache
 *
 * Use when patterns change or to free memory.
 */
export function clearPatternCache(): void {
  globalPatternCache.clear()
}

/**
 * Configure the global pattern cache
 *
 * Note: This creates a new cache, losing any cached entries.
 *
 * @param capacity - New maximum cache capacity
 */
export function configurePatternCache(capacity: number): void {
  // Create new cache with new capacity
  // Note: This is a module-level change - in production you might
  // want a more sophisticated approach
  Object.assign(globalPatternCache, new PatternLRUCache(capacity))
}

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Parsed pattern structure for glob matching
 *
 * Supports gitignore-style pattern syntax:
 * - `*` matches anything except `/`
 * - `**` matches anything including `/` (any depth)
 * - `?` matches any single character except `/`
 * - `[abc]` matches any character in the set
 * - `[a-z]` matches any character in the range
 * - `[!abc]` or `[^abc]` matches any character NOT in the set
 * - `{a,b,c}` matches any of the alternatives
 * - `!` at start negates the entire pattern
 * - `/` at start anchors to the root (relative patterns match anywhere)
 * - `/` at end matches directories only
 * - `#` at start is a comment (when using parsePatterns)
 *
 * @see https://git-scm.com/docs/gitignore#_pattern_format
 */
export interface ParsedPattern {
  /** Original pattern string */
  pattern: string
  /** Whether the pattern is negated (starts with !) */
  isNegated: boolean
  /** Pattern segments split by path separator */
  segments: string[]
  /** Whether the pattern matches only directories (ends with /) */
  isDirectory: boolean
  /** Whether the pattern is anchored to root (starts with /) */
  isRooted: boolean
}

/**
 * Parse a glob pattern string into a structured ParsedPattern object
 *
 * @param pattern - The glob pattern to parse
 * @returns ParsedPattern object with pattern metadata
 * @throws Error if pattern is invalid
 */
export function parsePattern(pattern: string): ParsedPattern {
  // Validate: empty string
  if (pattern === '') {
    throw new Error('Pattern cannot be empty')
  }

  // Validate: whitespace only
  if (pattern.trim() === '') {
    throw new Error('Pattern cannot be whitespace only')
  }

  // Validate: invalid triple-star
  if (pattern.includes('***')) {
    throw new Error('Invalid pattern: *** is not allowed')
  }

  // Check for negation (must be unescaped !)
  const isNegated = pattern.startsWith('!') && !pattern.startsWith('\\!')

  // Get the working pattern (without negation prefix)
  let workingPattern = isNegated ? pattern.slice(1) : pattern

  // Validate: negation only
  if (isNegated && workingPattern === '') {
    throw new Error('Pattern cannot be negation only')
  }

  // Check if pattern is rooted (anchored to root with leading /)
  // Gitignore: A leading slash matches the beginning of the pathname
  // e.g., "/foo" matches "foo" at root, but not "bar/foo"
  // Note: \ followed by special char is an escape sequence, not a path separator
  const isRooted = workingPattern.startsWith('/') ||
    (workingPattern.startsWith('\\') && !isGlobSpecialChar(workingPattern[1] ?? ''))

  // Check if it's a directory pattern (ends with /)
  const isDirectory = workingPattern.endsWith('/') || workingPattern.endsWith('\\')

  // Remove trailing slash for segment splitting
  if (isDirectory) {
    workingPattern = workingPattern.slice(0, -1)
  }

  // Split on both / and \ (normalize path separators)
  // But preserve escaped characters like \* within segments
  const segments = splitPattern(workingPattern)

  return {
    pattern,
    isNegated,
    segments,
    isDirectory,
    isRooted,
  }
}

/**
 * Split a pattern into segments, handling both / and \ as separators
 * while preserving escaped characters within segments
 */
function splitPattern(pattern: string): string[] {
  // Handle empty pattern (e.g., from "/" after removing trailing slash)
  if (pattern === '') {
    return []
  }

  const segments: string[] = []
  let current = ''
  let i = 0

  while (i < pattern.length) {
    const char = pattern[i]

    // Check for path separator
    if (char === '/') {
      if (current !== '') {
        segments.push(current)
        current = ''
      }
      // Skip consecutive slashes and leading slashes
      i++
      continue
    }

    // Check for backslash - could be escape or Windows path separator
    if (char === '\\') {
      const nextChar = pattern[i + 1]

      // If followed by a special glob character, it's an escape sequence
      if (nextChar && isGlobSpecialChar(nextChar)) {
        // Keep the escape sequence in the segment
        current += char + nextChar
        i += 2
        continue
      }

      // Otherwise it's a path separator (Windows style)
      if (current !== '') {
        segments.push(current)
        current = ''
      }
      i++
      continue
    }

    // Regular character
    current += char
    i++
  }

  // Add final segment if any
  if (current !== '') {
    segments.push(current)
  }

  return segments
}

/**
 * Check if a character is a special glob character that can be escaped
 */
function isGlobSpecialChar(char: string): boolean {
  return ['*', '?', '[', ']', '{', '}', '!', '#'].includes(char)
}

/**
 * Check if a line is a comment in gitignore format
 *
 * Lines starting with # are comments, unless escaped with \#
 */
function isComment(line: string): boolean {
  return line.startsWith('#') && !line.startsWith('\\#')
}

/**
 * Check if a line should be skipped (blank or comment)
 */
function shouldSkipLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || isComment(trimmed)
}

/**
 * Parse multiple patterns from gitignore-style text
 *
 * Supports gitignore format:
 * - Blank lines are ignored
 * - Lines starting with # are comments
 * - Lines starting with \# treat # as literal
 * - All other lines are parsed as patterns
 *
 * @param input - Multi-line string with one pattern per line
 * @returns Array of ParsedPattern objects (excludes comments and blank lines)
 *
 * @example
 * ```typescript
 * const patterns = parsePatterns(`
 *   # Build artifacts
 *   dist/
 *   build/
 *
 *   # Dependencies
 *   node_modules/
 *
 *   # But keep certain files
 *   !dist/important.js
 * `)
 * // Returns parsed patterns for dist/, build/, node_modules/, !dist/important.js
 * ```
 */
export function parsePatterns(input: string): ParsedPattern[] {
  const lines = input.split(/\r?\n/)
  const patterns: ParsedPattern[] = []

  for (const line of lines) {
    // Skip blank lines and comments
    if (shouldSkipLine(line)) {
      continue
    }

    // Handle escaped hash - convert \# to #
    let patternLine = line.trim()
    if (patternLine.startsWith('\\#')) {
      patternLine = patternLine.slice(1) // Remove the escape backslash
    }

    // Parse the pattern
    patterns.push(parsePattern(patternLine))
  }

  return patterns
}

/**
 * Parse patterns from an array of strings
 *
 * Filters out comments and blank lines, then parses remaining as patterns.
 *
 * @param lines - Array of pattern strings
 * @returns Array of ParsedPattern objects
 */
export function parsePatternsArray(lines: string[]): ParsedPattern[] {
  return parsePatterns(lines.join('\n'))
}

/**
 * Match a path against a glob pattern
 *
 * @param path - The path to match
 * @param pattern - The glob pattern
 * @returns true if the path matches the pattern
 * @throws Error if pattern is empty
 */
export function matchPattern(path: string, pattern: string): boolean {
  if (pattern === '') {
    throw new Error('Pattern cannot be empty')
  }

  // Empty path never matches
  if (path === '') {
    return false
  }

  // Parse the pattern to get metadata
  const parsed = parsePattern(pattern)

  // Get the working pattern (without negation for the core matching)
  let workingPattern = parsed.isNegated ? pattern.slice(1) : pattern

  // Handle double negation: !!pattern means match the pattern
  let negationCount = 0
  while (workingPattern.startsWith('!')) {
    negationCount++
    workingPattern = workingPattern.slice(1)
  }

  // Build regex from the working pattern
  const regex = patternToRegex(workingPattern)

  // Test the path
  const matches = regex.test(path)

  // Apply negation (odd number of ! means negate)
  const totalNegations = (parsed.isNegated ? 1 : 0) + negationCount
  return totalNegations % 2 === 0 ? matches : !matches
}

/**
 * Lazy pattern matcher that defers regex compilation until first use.
 *
 * Use this class when you have patterns that may never be matched against,
 * or when you want to spread out compilation cost over time.
 *
 * @example
 * ```typescript
 * const matcher = new LazyPatternMatcher('src/**\/*.ts')
 * // No compilation happens yet
 *
 * matcher.matches('src/index.ts') // Compiles and caches on first call
 * matcher.matches('src/utils.ts') // Uses cached regex
 * ```
 */
export class LazyPatternMatcher {
  private readonly pattern: string
  private readonly workingPattern: string
  private readonly shouldNegate: boolean
  private regex: RegExp | null = null

  /**
   * Create a lazy pattern matcher
   *
   * @param pattern - The glob pattern (compilation is deferred)
   * @throws Error if pattern is empty
   */
  constructor(pattern: string) {
    if (pattern === '') {
      throw new Error('Pattern cannot be empty')
    }

    this.pattern = pattern

    // Pre-process negation (lightweight, no regex compilation)
    let workingPattern = pattern
    let negationCount = 0

    while (workingPattern.startsWith('!')) {
      negationCount++
      workingPattern = workingPattern.slice(1)
    }

    this.workingPattern = workingPattern
    this.shouldNegate = negationCount % 2 === 1
  }

  /**
   * Check if a path matches the pattern
   *
   * On first call, compiles the regex and caches it.
   * Subsequent calls use the cached regex.
   *
   * @param path - The path to match
   * @returns true if the path matches the pattern
   */
  matches(path: string): boolean {
    if (path === '') {
      return false
    }

    // Lazy compilation on first use
    if (this.regex === null) {
      this.regex = patternToRegex(this.workingPattern)
    }

    const result = this.regex.test(path)
    return this.shouldNegate ? !result : result
  }

  /**
   * Check if the pattern has been compiled yet
   */
  get isCompiled(): boolean {
    return this.regex !== null
  }

  /**
   * Force immediate compilation of the pattern
   *
   * Useful when you want to pre-warm the cache or validate
   * the pattern before using it.
   */
  compile(): void {
    if (this.regex === null) {
      this.regex = patternToRegex(this.workingPattern)
    }
  }

  /**
   * Get the original pattern string
   */
  get originalPattern(): string {
    return this.pattern
  }
}

/**
 * Create a reusable matcher function from a pattern
 *
 * This is an eager version that compiles immediately.
 * For lazy compilation, use `LazyPatternMatcher` instead.
 *
 * @param pattern - The glob pattern
 * @returns A function that takes a path and returns true if it matches
 * @throws Error if pattern is empty
 */
export function createPatternMatcher(pattern: string): (path: string) => boolean {
  if (pattern === '') {
    throw new Error('Pattern cannot be empty')
  }

  // Pre-compile the regex for efficiency
  let workingPattern = pattern
  let negationCount = 0

  // Count negations
  while (workingPattern.startsWith('!')) {
    negationCount++
    workingPattern = workingPattern.slice(1)
  }

  const regex = patternToRegex(workingPattern)
  const shouldNegate = negationCount % 2 === 1

  return (path: string): boolean => {
    if (path === '') {
      return false
    }
    const matches = regex.test(path)
    return shouldNegate ? !matches : matches
  }
}

/**
 * Get a compiled regex for a glob pattern, using the cache when available.
 *
 * This is the main entry point for pattern compilation. It:
 * 1. Checks the LRU cache for an existing compiled pattern
 * 2. If not found, compiles the pattern and caches it
 * 3. Returns the compiled RegExp
 *
 * @param pattern - The glob pattern to compile
 * @returns Compiled RegExp for matching paths
 */
function patternToRegex(pattern: string): RegExp {
  // Check cache first
  const cached = globalPatternCache.get(pattern)
  if (cached !== undefined) {
    return cached
  }

  // Compile the pattern
  const regex = compilePatternToRegex(pattern)

  // Cache the compiled pattern
  globalPatternCache.set(pattern, regex)

  return regex
}

/**
 * Internal function that performs the actual pattern-to-regex compilation.
 * This is the core compilation logic, called by patternToRegex after cache miss.
 *
 * @param pattern - The glob pattern to compile
 * @returns Compiled RegExp for matching paths
 */
function compilePatternToRegex(pattern: string): RegExp {
  // Normalize path separators and handle rooted patterns
  let normalized = pattern
  let isRooted = false

  if (normalized.startsWith('/')) {
    isRooted = true
    normalized = normalized.slice(1)
  }

  // Handle trailing slash for directory patterns
  const isDirectory = normalized.endsWith('/')
  if (isDirectory) {
    normalized = normalized.slice(0, -1)
  }

  // Check if pattern contains path separator (gitignore rule:
  // patterns with / match full path, patterns without / match basename only)
  // Exception: ** at start/end can match across directories
  const hasPathSeparator = normalized.includes('/') ||
    normalized.startsWith('**') ||
    normalized.includes('/**')

  // Build the regex pattern
  let regexStr = ''
  let i = 0

  while (i < normalized.length) {
    const char = normalized[i]

    // Handle escape sequences
    if (char === '\\') {
      const nextChar = normalized[i + 1]
      if (nextChar && isGlobSpecialChar(nextChar)) {
        // Escaped special char - match literally
        regexStr += escapeRegex(nextChar)
        i += 2
        continue
      }
      // Backslash as path separator (Windows) - normalize to /
      i++
      continue
    }

    // Handle globstar **
    if (char === '*' && normalized[i + 1] === '*') {
      // Check if it's a valid globstar (surrounded by / or at start/end)
      const prevChar = normalized[i - 1]
      const afterStars = normalized[i + 2]

      // ** matches any path segment(s) including none
      if ((i === 0 || prevChar === '/' || prevChar === '\\') &&
          (afterStars === undefined || afterStars === '/' || afterStars === '\\')) {
        // Consume the ** and optional trailing slash
        if (afterStars === '/' || afterStars === '\\') {
          // **/foo or foo/**/bar
          regexStr += '(?:.*\\/)?'
          i += 3
        } else {
          // foo/** at end - match everything
          regexStr += '.*'
          i += 2
        }
        continue
      }
    }

    // Handle single wildcard *
    if (char === '*') {
      // * matches anything except path separator, but not dotfiles at segment start
      // Check if we're at the start of a segment
      const prevChar = normalized[i - 1]
      const atSegmentStart = i === 0 || prevChar === '/' || prevChar === '\\'

      if (atSegmentStart) {
        // Don't match dotfiles (files starting with .)
        regexStr += '(?![.])[^/]*'
      } else {
        regexStr += '[^/]*'
      }
      i++
      continue
    }

    // Handle single character wildcard ?
    if (char === '?') {
      // ? matches exactly one character except path separator
      regexStr += '[^/]'
      i++
      continue
    }

    // Handle character classes [...]
    if (char === '[') {
      const closeIdx = findClosingBracket(normalized, i)
      if (closeIdx !== -1) {
        const classContent = normalized.slice(i + 1, closeIdx)
        regexStr += '[' + convertCharClass(classContent) + ']'
        i = closeIdx + 1
        continue
      }
      // No closing bracket - treat [ as literal
      regexStr += '\\['
      i++
      continue
    }

    // Handle brace expansion {...}
    if (char === '{') {
      const closeIdx = findClosingBrace(normalized, i)
      if (closeIdx !== -1) {
        const braceContent = normalized.slice(i + 1, closeIdx)
        const alternatives = splitBraceAlternatives(braceContent)
        if (alternatives.length > 0) {
          // Convert each alternative to regex and join with |
          const altRegexes = alternatives.map(alt => {
            // Recursively convert each alternative (may contain wildcards)
            return patternPartToRegex(alt)
          })
          regexStr += '(?:' + altRegexes.join('|') + ')'
          i = closeIdx + 1
          continue
        }
      }
      // No closing brace or empty - treat { as literal
      regexStr += '\\{'
      i++
      continue
    }

    // Handle path separator
    if (char === '/') {
      regexStr += '\\/'
      i++
      continue
    }

    // Regular character - escape if needed for regex
    regexStr += escapeRegex(char)
    i++
  }

  // Add anchors
  let finalRegex = '^'

  // Patterns with path separators or starting with ** can match anywhere in the path
  // Patterns without path separators match only the basename (no slashes allowed)
  if (hasPathSeparator) {
    if (!isRooted && !regexStr.startsWith('(?:.*\\/)?')) {
      // Non-rooted pattern with path separator can match anywhere in the path
      finalRegex += '(?:.*\\/)?'
    }
  }
  // For patterns without path separator, we DON'T add the prefix
  // This means *.ts will only match foo.ts, not src/foo.ts

  finalRegex += regexStr

  // Add trailing slash anchor for directories
  if (isDirectory) {
    finalRegex += '\\/'
  }
  finalRegex += '$'

  return new RegExp(finalRegex)
}

/**
 * Convert a pattern segment (may contain wildcards) to regex
 */
function patternPartToRegex(part: string): string {
  let result = ''
  let i = 0

  while (i < part.length) {
    const char = part[i]

    if (char === '\\') {
      const nextChar = part[i + 1]
      if (nextChar && isGlobSpecialChar(nextChar)) {
        result += escapeRegex(nextChar)
        i += 2
        continue
      }
    }

    if (char === '*') {
      if (part[i + 1] === '*') {
        result += '.*'
        i += 2
        continue
      }
      result += '[^/]*'
      i++
      continue
    }

    if (char === '?') {
      result += '[^/]'
      i++
      continue
    }

    if (char === '[') {
      const closeIdx = findClosingBracket(part, i)
      if (closeIdx !== -1) {
        const classContent = part.slice(i + 1, closeIdx)
        result += '[' + convertCharClass(classContent) + ']'
        i = closeIdx + 1
        continue
      }
    }

    result += escapeRegex(char)
    i++
  }

  return result
}

/**
 * Find the closing bracket for a character class
 */
function findClosingBracket(str: string, startIdx: number): number {
  let i = startIdx + 1
  // Handle negation at start
  if (str[i] === '!' || str[i] === '^') {
    i++
  }
  // Handle ] immediately after [ or [^ as literal
  if (str[i] === ']') {
    i++
  }
  while (i < str.length) {
    if (str[i] === ']') {
      return i
    }
    i++
  }
  return -1
}

/**
 * Find the closing brace for brace expansion
 */
function findClosingBrace(str: string, startIdx: number): number {
  let depth = 0
  for (let i = startIdx; i < str.length; i++) {
    if (str[i] === '{') {
      depth++
    } else if (str[i] === '}') {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }
  return -1
}

/**
 * Split brace content into alternatives
 */
function splitBraceAlternatives(content: string): string[] {
  const alternatives: string[] = []
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
      alternatives.push(current)
      current = ''
    } else {
      current += char
    }
  }

  alternatives.push(current)
  return alternatives
}

/**
 * Convert character class content for regex
 */
function convertCharClass(content: string): string {
  let result = ''
  let i = 0

  // Handle negation
  if (content[0] === '!' || content[0] === '^') {
    result += '^'
    i = 1
  }

  while (i < content.length) {
    const char = content[i]

    // Handle range (a-z)
    if (content[i + 1] === '-' && content[i + 2] && content[i + 2] !== ']') {
      result += char + '-' + content[i + 2]
      i += 3
      continue
    }

    // Escape regex special chars except - at boundaries
    if (char === '-' && i > 0 && i < content.length - 1) {
      // Hyphen in middle - it's a range indicator
      result += char
    } else if (char === '-') {
      // Hyphen at boundary - literal
      result += '\\-'
    } else if ('^$\\.+?{}()|'.includes(char)) {
      result += '\\' + char
    } else {
      result += char
    }
    i++
  }

  return result
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
