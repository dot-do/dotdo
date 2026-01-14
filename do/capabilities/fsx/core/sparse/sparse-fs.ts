/**
 * SparseFS - Filtered filesystem wrapper with sparse checkout semantics
 *
 * Wraps an FSx instance with include/exclude pattern filtering,
 * providing sparse-checkout like behavior for efficient partial tree operations.
 *
 * @module sparse/sparse-fs
 */

import type { FSx } from '../fsx.js'
import type { Stats, Dirent, ReaddirOptions, BufferEncoding } from '../types.js'
import { createIncludeChecker, type IncludeChecker } from './include.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating a SparseFS instance
 */
export interface SparseFSOptions {
  /** Glob patterns to include (files matching any pattern are included) */
  patterns: string[]
  /** Glob patterns to exclude (files matching any pattern are excluded) */
  excludePatterns?: string[]
  /** Enable cone mode (directory-based patterns only) - future feature */
  cone?: boolean
  /** Root path to strip from paths before pattern matching (default: '') */
  root?: string
  /**
   * Load .gitignore file(s) as additional exclude patterns.
   *
   * When true, loads .gitignore from the root directory.
   * When a string, loads from the specified path.
   * When false or undefined, no .gitignore is loaded.
   *
   * The patterns from .gitignore are appended to excludePatterns.
   */
  gitignore?: boolean | string
  /**
   * Custom path to .gitignore file (deprecated: use gitignore option instead)
   * @deprecated Use gitignore option with string path instead
   */
  gitignorePath?: string
}

/**
 * Result of loading a .gitignore file
 */
export interface GitignoreLoadResult {
  /** Patterns parsed from the .gitignore file */
  patterns: string[]
  /** Path to the loaded .gitignore file */
  path: string
  /** Whether the file existed */
  exists: boolean
}

/**
 * Options for fromPreset factory method
 */
export interface PresetOptions {
  /** Additional patterns to include */
  include?: string[]
  /** Patterns to exclude (converted to excludePatterns) */
  exclude?: string[]
  /** Root path for pattern matching */
  root?: string
}

/**
 * Built-in preset names
 */
export type PresetName = 'typescript' | 'javascript' | 'source' | 'web' | 'config'

/**
 * Entry returned by the walk method
 */
export interface WalkEntry {
  /** Full path to the entry */
  path: string
  /** Entry name (basename) */
  name: string
  /** Entry type: 'file', 'directory', or 'symlink' */
  type: 'file' | 'directory' | 'symlink'
  /** Depth relative to walk root */
  depth: number
}

/**
 * Options for walk method
 */
export interface WalkOptions {
  /** Maximum depth to traverse (undefined = unlimited) */
  maxDepth?: number
  /** Include dotfiles/dotdirs (default: false) */
  includeDotFiles?: boolean
}

/**
 * Entry type filter for readdir
 */
export type EntryTypeFilter = 'file' | 'directory' | 'symlink'

/**
 * Extended options for filtered readdir operations
 */
export interface FilteredReaddirOptions extends Omit<ReaddirOptions, 'recursive'> {
  /** Glob pattern to filter entry names (e.g., '*.ts', '*.{js,jsx}') */
  filter?: string
  /** Filter by entry type */
  type?: EntryTypeFilter
  /** Include hidden files (starting with .) - default: true */
  includeHidden?: boolean
}

// =============================================================================
// SparseFS Class
// =============================================================================

/**
 * SparseFS - Filtered filesystem wrapper
 *
 * Wraps an FSx instance and filters all operations based on include/exclude patterns.
 * Provides efficient partial tree operations by:
 * - Filtering readdir results
 * - Blocking access to excluded files
 * - Skipping excluded directories during traversal
 */
export class SparseFS {
  // ===========================================
  // Static: Built-in presets
  // ===========================================

  /**
   * Built-in pattern presets for common use cases
   */
  static presets: Record<string, string[]> = {
    /**
     * TypeScript project files
     */
    typescript: ['**/*.ts', '**/*.tsx', 'package.json', 'tsconfig.json'],

    /**
     * JavaScript project files
     */
    javascript: ['**/*.js', '**/*.jsx', 'package.json'],

    /**
     * Source directories
     */
    source: ['src/**', 'lib/**', 'package.json'],

    /**
     * Web assets
     */
    web: ['**/*.html', '**/*.css', '**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'],

    /**
     * Configuration files
     */
    config: ['package.json', 'tsconfig.json', '*.config.{js,ts,mjs,cjs}', '.env*'],
  }

  // ===========================================
  // Static: Factory methods
  // ===========================================

  /**
   * Create a SparseFS instance from a preset
   *
   * @param fs - The FSx instance to wrap
   * @param preset - Name of the preset to use
   * @param options - Additional options to customize the preset
   * @returns A new SparseFS instance configured with the preset patterns
   * @throws Error if preset name is unknown
   */
  static fromPreset(fs: FSx, preset: PresetName | string, options?: PresetOptions): SparseFS {
    const presetPatterns = SparseFS.presets[preset]
    if (!presetPatterns) {
      throw new Error(`Unknown preset: ${preset}. Available presets: ${Object.keys(SparseFS.presets).join(', ')}`)
    }

    // Combine preset patterns with additional include patterns
    const patterns = [...presetPatterns]
    if (options?.include) {
      patterns.push(...options.include)
    }

    // Build excludePatterns from exclude option
    const excludePatterns = options?.exclude?.map((p) =>
      // Auto-add ** suffix for directory names that don't have glob patterns
      p.includes('*') || p.includes('/') ? p : `**/${p}/**`
    )

    return new SparseFS(fs, {
      patterns,
      excludePatterns,
      root: options?.root,
    })
  }

  /**
   * Register a custom preset
   *
   * @param name - Name for the preset
   * @param patterns - Array of glob patterns
   * @throws Error if patterns array is empty or contains invalid patterns
   */
  static registerPreset(name: string, patterns: string[]): void {
    // Validate patterns
    if (!patterns || patterns.length === 0) {
      throw new Error('Preset patterns cannot be empty')
    }

    // Validate each pattern
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i]
      if (typeof pattern !== 'string') {
        throw new Error(`Invalid pattern at index ${i}: must be a string`)
      }
      if (pattern.length === 0) {
        throw new Error(`Invalid pattern at index ${i}: cannot be empty`)
      }
      // Check for obviously invalid glob syntax
      if (pattern.includes('***')) {
        throw new Error(`Invalid pattern at index ${i}: "${pattern}" contains invalid glob syntax (***)`);
      }
    }

    SparseFS.presets[name] = patterns
  }

  /**
   * Load patterns from a .gitignore file
   *
   * Parses a .gitignore file and returns the patterns found.
   * Handles gitignore format:
   * - Lines starting with # are comments
   * - Blank lines are ignored
   * - Patterns can include negation (!) prefix
   * - Patterns can include glob wildcards
   *
   * @param fs - The FSx instance to read from
   * @param path - Path to the .gitignore file
   * @returns GitignoreLoadResult with patterns and metadata
   *
   * @example
   * ```typescript
   * const result = await SparseFS.loadGitignore(fs, '/project/.gitignore')
   * if (result.exists) {
   *   console.log('Loaded patterns:', result.patterns)
   * }
   * ```
   */
  static async loadGitignore(fs: FSx, path: string): Promise<GitignoreLoadResult> {
    try {
      const content = await fs.readFile(path, 'utf-8')
      const patterns = SparseFS.parseGitignoreContent(content as string)
      return {
        patterns,
        path,
        exists: true,
      }
    } catch (error: unknown) {
      // File doesn't exist or can't be read
      if (error instanceof Error && error.message.includes('ENOENT')) {
        return {
          patterns: [],
          path,
          exists: false,
        }
      }
      throw error
    }
  }

  /**
   * Parse gitignore content string into an array of patterns
   *
   * @param content - Raw gitignore file content
   * @returns Array of pattern strings (comments and blank lines removed)
   */
  static parseGitignoreContent(content: string): string[] {
    const lines = content.split(/\r?\n/)
    const patterns: string[] = []

    for (const line of lines) {
      // Skip empty lines and comments
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue
      }

      // Handle escaped hash (starts with \#)
      let pattern = trimmed
      if (pattern.startsWith('\\#')) {
        pattern = pattern.slice(1) // Remove the backslash
      }

      patterns.push(pattern)
    }

    return patterns
  }

  /**
   * Create a SparseFS instance with gitignore patterns loaded
   *
   * This is an async factory method that loads .gitignore patterns
   * before creating the SparseFS instance.
   *
   * @param fs - The FSx instance to wrap
   * @param options - Sparse options including gitignore loading
   * @returns Promise resolving to a new SparseFS instance
   *
   * @example
   * ```typescript
   * // Load .gitignore from root
   * const sparse = await SparseFS.withGitignore(fs, {
   *   patterns: ['src/**'],
   *   gitignore: true
   * })
   *
   * // Load from custom path
   * const sparse = await SparseFS.withGitignore(fs, {
   *   patterns: ['src/**'],
   *   gitignore: '/project/.gitignore'
   * })
   * ```
   */
  static async withGitignore(fs: FSx, options: SparseFSOptions): Promise<SparseFS> {
    let excludePatterns = options.excludePatterns ? [...options.excludePatterns] : []

    // Determine gitignore path
    let gitignorePath: string | null = null
    if (options.gitignore === true) {
      // Load from root directory
      gitignorePath = options.root ? `${options.root}/.gitignore` : '/.gitignore'
    } else if (typeof options.gitignore === 'string') {
      gitignorePath = options.gitignore
    } else if (options.gitignorePath) {
      // Deprecated option
      gitignorePath = options.gitignorePath
    }

    // Load gitignore patterns if path is set
    if (gitignorePath) {
      const result = await SparseFS.loadGitignore(fs, gitignorePath)
      if (result.exists && result.patterns.length > 0) {
        excludePatterns = [...excludePatterns, ...result.patterns]
      }
    }

    // Create SparseFS with merged patterns
    return new SparseFS(fs, {
      ...options,
      excludePatterns: excludePatterns.length > 0 ? excludePatterns : undefined,
    })
  }

  // ===========================================
  // Instance properties
  // ===========================================

  /** The underlying FSx instance */
  readonly fs: FSx

  /** Pattern checker for include/exclude logic */
  private readonly checker: IncludeChecker

  /** Original options - kept for future use (cone mode, etc.) */
  // @ts-expect-error - Reserved for future cone mode implementation
  private readonly options: SparseFSOptions

  /** Root path to strip from paths before pattern matching */
  private readonly root: string

  // ===========================================
  // Constructor
  // ===========================================

  /**
   * Create a new SparseFS wrapper
   *
   * @param fs - The FSx instance to wrap
   * @param options - Sparse checkout options
   * @throws Error if configuration is invalid
   */
  constructor(fs: FSx, options: SparseFSOptions) {
    // Validate options
    this.validateOptions(options)

    this.fs = fs
    this.options = options
    this.root = this.normalizeRoot(options.root || '')
    this.checker = createIncludeChecker({
      patterns: options.patterns,
      excludePatterns: options.excludePatterns,
      cone: options.cone,
    })
  }

  // ===========================================
  // Private: Validation
  // ===========================================

  /**
   * Validate configuration options
   * @throws Error with helpful message if validation fails
   */
  private validateOptions(options: SparseFSOptions): void {
    // Validate patterns
    if (!Array.isArray(options.patterns)) {
      throw new Error('SparseFS: patterns must be an array of glob patterns')
    }

    // In cone mode, empty patterns is valid (includes only toplevel files)
    // In non-cone mode, at least one pattern is required
    if (options.patterns.length === 0 && !options.cone) {
      throw new Error('SparseFS requires at least one include pattern')
    }

    // Validate each pattern
    for (let i = 0; i < options.patterns.length; i++) {
      const pattern = options.patterns[i]
      if (typeof pattern !== 'string') {
        throw new Error(`SparseFS: pattern at index ${i} must be a string, got ${typeof pattern}`)
      }
      if (pattern.length === 0) {
        throw new Error(`SparseFS: pattern at index ${i} cannot be empty`)
      }
      if (pattern.trim().length === 0) {
        throw new Error(`SparseFS: pattern at index ${i} cannot be whitespace only`)
      }
      // Check for obviously invalid glob syntax
      if (pattern.includes('***')) {
        throw new Error(`Invalid pattern at index ${i}: "${pattern}" contains invalid glob syntax`);
      }
    }

    // Validate excludePatterns if provided
    if (options.excludePatterns !== undefined) {
      if (!Array.isArray(options.excludePatterns)) {
        throw new Error('SparseFS: excludePatterns must be an array of glob patterns')
      }

      for (let i = 0; i < options.excludePatterns.length; i++) {
        const pattern = options.excludePatterns[i]
        if (typeof pattern !== 'string') {
          throw new Error(`SparseFS: excludePattern at index ${i} must be a string, got ${typeof pattern}`)
        }
        if (pattern.length === 0) {
          throw new Error(`SparseFS: excludePattern at index ${i} cannot be empty`)
        }
        // Check for obviously invalid glob syntax
        if (pattern.includes('***')) {
          throw new Error(`Invalid excludePattern at index ${i}: "${pattern}" contains invalid glob syntax`);
        }
      }
    }

    // Validate root if provided
    if (options.root !== undefined && typeof options.root !== 'string') {
      throw new Error('SparseFS: root must be a string')
    }
  }

  /**
   * Normalize the root path
   */
  private normalizeRoot(root: string): string {
    // Ensure root starts with / and ends without /
    let normalized = root
    if (normalized && !normalized.startsWith('/')) {
      normalized = '/' + normalized
    }
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1)
    }
    return normalized
  }

  // ==================== Core Methods ====================

  /**
   * Check if a path should be included based on patterns
   *
   * @param path - Path to check (relative or absolute)
   * @returns true if the path matches include patterns and doesn't match exclude patterns
   */
  shouldInclude(path: string): boolean {
    const normalizedPath = this.normalizePath(path)
    return this.checker.shouldInclude(normalizedPath)
  }

  /**
   * Check if a directory should be traversed
   *
   * Used for optimization during walks - allows skipping directories
   * that cannot contain any matching files.
   *
   * @param dir - Directory path to check
   * @returns true if the directory could contain matching files
   */
  shouldTraverseDirectory(dir: string): boolean {
    const normalizedDir = this.normalizePath(dir)
    return this.checker.shouldTraverseDirectory(normalizedDir)
  }

  // ==================== Wrapped FS Methods ====================

  /**
   * Read directory contents, filtered by patterns
   *
   * Performance optimization: Always uses `withFileTypes: true` internally
   * to get dirent type information without additional stat() calls. This
   * is critical for efficient filtering since we need to distinguish between
   * files and directories for pattern matching.
   *
   * When the caller doesn't request `withFileTypes`, we extract just the
   * names from the filtered dirent results. This approach avoids the O(n)
   * stat() calls that would otherwise be needed to determine entry types.
   *
   * Supports additional filtering via FilteredReaddirOptions:
   * - `filter`: Glob pattern to match entry names (e.g., '*.ts', '*.{js,jsx}')
   * - `type`: Filter by entry type ('file', 'directory', 'symlink')
   * - `includeHidden`: Whether to include dotfiles (default: true)
   *
   * @param path - Path to the directory
   * @param options - Read options with optional filtering
   * @returns Filtered array of filenames or Dirent objects
   */
  async readdir(path: string, options?: FilteredReaddirOptions): Promise<string[] | Dirent[]> {
    // Always fetch with file types to avoid separate stat calls for type checking
    // This is a key optimization: one readdir syscall vs. N stat syscalls
    const entries = (await this.fs.readdir(path, { withFileTypes: true })) as Dirent[]

    // Extract filtering options
    const filterPattern = options?.filter
    const typeFilter = options?.type
    const includeHidden = options?.includeHidden ?? true

    // Create a glob matcher if filter pattern is provided
    const filterMatcher = filterPattern ? this.createGlobMatcher(filterPattern) : null

    // Filter entries using dirent type information (no stat calls needed)
    const filtered = entries.filter((entry) => {
      const name = entry.name

      // Apply hidden file filter first (early exit)
      if (!includeHidden && name.startsWith('.')) {
        return false
      }

      // Apply glob pattern filter to the entry name (not full path)
      if (filterMatcher && !filterMatcher(name)) {
        return false
      }

      // Apply type filter
      if (typeFilter) {
        if (typeFilter === 'file' && !entry.isFile()) {
          return false
        }
        if (typeFilter === 'directory' && !entry.isDirectory()) {
          return false
        }
        if (typeFilter === 'symlink' && !entry.isSymbolicLink?.()) {
          return false
        }
      }

      // Apply sparse pattern filtering
      const fullEntryPath = this.joinPath(path, name)
      const normalizedEntryPath = this.normalizePath(fullEntryPath)
      return this.shouldIncludeEntry(normalizedEntryPath, entry.isDirectory())
    })

    // Return in the format the caller requested
    if (options?.withFileTypes) {
      return filtered
    } else {
      // Caller only wants names - extract from filtered dirents
      return filtered.map((entry) => entry.name)
    }
  }

  /**
   * Create a glob matcher function for filtering entry names
   *
   * Supports:
   * - Simple wildcards: *.ts, Button*, *test*
   * - Brace expansion: *.{ts,tsx,js}
   * - Character classes: [a-z]*.ts
   * - Exact matches: index.ts
   *
   * @param pattern - Glob pattern to match
   * @returns A function that tests whether a name matches the pattern
   */
  private createGlobMatcher(pattern: string): (name: string) => boolean {
    // Fast path for universal wildcard
    if (pattern === '*') {
      return () => true
    }

    // Fast path for exact match (no wildcards)
    if (!this.hasGlobWildcards(pattern)) {
      return (name: string) => name === pattern
    }

    // Build regex from glob pattern
    const regex = this.globToRegex(pattern)
    return (name: string) => regex.test(name)
  }

  /**
   * Check if a pattern contains glob wildcards
   */
  private hasGlobWildcards(pattern: string): boolean {
    return /[*?\[\]{}]/.test(pattern)
  }

  /**
   * Convert a glob pattern to a regular expression
   *
   * This is a simplified version for matching entry names (not full paths),
   * so it doesn't need to handle ** globstar patterns.
   */
  private globToRegex(pattern: string): RegExp {
    let regexStr = ''
    let i = 0

    while (i < pattern.length) {
      const char = pattern[i]

      // Handle *
      if (char === '*') {
        // * matches anything (since we're matching names, not paths)
        regexStr += '.*'
        i++
        continue
      }

      // Handle ?
      if (char === '?') {
        regexStr += '.'
        i++
        continue
      }

      // Handle character classes [...]
      if (char === '[') {
        const closeIndex = pattern.indexOf(']', i + 1)
        if (closeIndex !== -1) {
          const classContent = pattern.slice(i, closeIndex + 1)
          regexStr += classContent
          i = closeIndex + 1
          continue
        }
      }

      // Handle brace expansion {a,b,c}
      if (char === '{') {
        const closeIndex = this.findMatchingBrace(pattern, i)
        if (closeIndex !== -1) {
          const braceContent = pattern.slice(i + 1, closeIndex)
          const alternatives = this.parseBraceExpansion(braceContent)
          regexStr += '(?:' + alternatives.map(this.escapeRegexChars).join('|') + ')'
          i = closeIndex + 1
          continue
        }
      }

      // Escape regex special characters
      if ('.^$+|()\\'.includes(char)) {
        regexStr += '\\' + char
        i++
        continue
      }

      // Regular character
      regexStr += char
      i++
    }

    return new RegExp('^' + regexStr + '$')
  }

  /**
   * Find the matching closing brace
   */
  private findMatchingBrace(pattern: string, start: number): number {
    let depth = 0
    for (let i = start; i < pattern.length; i++) {
      if (pattern[i] === '{') depth++
      if (pattern[i] === '}') {
        depth--
        if (depth === 0) return i
      }
    }
    return -1
  }

  /**
   * Parse brace expansion content like "ts,tsx,js"
   */
  private parseBraceExpansion(content: string): string[] {
    const alternatives: string[] = []
    let current = ''
    let depth = 0

    for (let i = 0; i < content.length; i++) {
      const char = content[i]
      if (char === '{') depth++
      if (char === '}') depth--
      if (char === ',' && depth === 0) {
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
   * Escape regex special characters
   */
  private escapeRegexChars(str: string): string {
    return str.replace(/[.^$+|()\\[\]{}*?]/g, '\\$&')
  }

  /**
   * Read a file's contents, if it matches patterns
   *
   * @param path - Path to the file
   * @param encoding - Output encoding
   * @returns File contents
   * @throws Error if the file doesn't match patterns
   */
  async readFile(path: string, encoding?: BufferEncoding): Promise<string | Uint8Array> {
    const normalizedPath = this.normalizePath(path)

    if (!this.shouldInclude(normalizedPath)) {
      throw new Error(`ENOENT: path excluded by sparse patterns: ${path}`)
    }

    return this.fs.readFile(path, encoding)
  }

  /**
   * Get file or directory stats, if it matches patterns
   *
   * @param path - Path to check
   * @returns Stats object
   * @throws Error if the path doesn't match patterns
   */
  async stat(path: string): Promise<Stats> {
    const normalizedPath = this.normalizePath(path)

    // For directories, check if they could contain matches
    // For files, check if they match include patterns
    const stats = await this.fs.stat(path)

    if (stats.isDirectory()) {
      if (!this.shouldTraverseDirectory(normalizedPath)) {
        throw new Error(`ENOENT: directory excluded by sparse patterns: ${path}`)
      }
    } else {
      if (!this.shouldInclude(normalizedPath)) {
        throw new Error(`ENOENT: path excluded by sparse patterns: ${path}`)
      }
    }

    return stats
  }

  /**
   * Check if a path exists and matches patterns
   *
   * @param path - Path to check
   * @returns true if path exists AND matches patterns
   */
  async exists(path: string): Promise<boolean> {
    const normalizedPath = this.normalizePath(path)

    // First check if path actually exists
    const fileExists = await this.fs.exists(path)
    if (!fileExists) {
      return false
    }

    // Root path always exists
    if (normalizedPath === '' || normalizedPath === '/') {
      return true
    }

    // Check if it matches our patterns
    try {
      const stats = await this.fs.stat(path)
      if (stats.isDirectory()) {
        return this.shouldTraverseDirectory(normalizedPath)
      } else {
        return this.shouldInclude(normalizedPath)
      }
    } catch {
      return false
    }
  }

  // ==================== Walk Method ====================

  /**
   * Walk the filesystem tree with pattern filtering
   *
   * Efficiently traverses directories, skipping excluded paths entirely.
   * Yields WalkEntry objects for each matching file and directory.
   *
   * @param root - Starting path for walk
   * @param options - Walk options
   * @yields WalkEntry for each matching path
   */
  async *walk(root: string, options?: WalkOptions): AsyncGenerator<WalkEntry, void, undefined> {
    const maxDepth = options?.maxDepth
    const includeDotFiles = options?.includeDotFiles ?? false

    const normalizedRoot = this.normalizePath(root)

    yield* this.walkDirectory(normalizedRoot, 0, maxDepth, includeDotFiles)
  }

  /**
   * Internal recursive walk implementation
   */
  private async *walkDirectory(
    dirPath: string,
    currentDepth: number,
    maxDepth: number | undefined,
    includeDotFiles: boolean
  ): AsyncGenerator<WalkEntry, void, undefined> {
    // Check depth limit
    if (maxDepth !== undefined && currentDepth > maxDepth) {
      return
    }

    // Check if directory should be traversed
    if (currentDepth > 0 && !this.shouldTraverseDirectory(dirPath)) {
      return
    }

    // Get directory entries with file types
    let entries: Dirent[]
    try {
      entries = (await this.fs.readdir(dirPath, { withFileTypes: true })) as Dirent[]
    } catch {
      // Directory doesn't exist or can't be read
      return
    }

    for (const entry of entries) {
      const name = entry.name

      // Skip dotfiles if not included
      if (!includeDotFiles && name.startsWith('.')) {
        continue
      }

      const entryPath = this.joinPath(dirPath, name)
      const isDir = entry.isDirectory()

      // Check if this entry should be included
      if (!this.shouldIncludeEntry(entryPath, isDir)) {
        continue
      }

      // Yield the entry
      const walkEntry: WalkEntry = {
        path: entryPath,
        name,
        type: isDir ? 'directory' : entry.isSymbolicLink?.() ? 'symlink' : 'file',
        depth: currentDepth,
      }

      yield walkEntry

      // Recurse into directories
      if (isDir) {
        yield* this.walkDirectory(entryPath, currentDepth + 1, maxDepth, includeDotFiles)
      }
    }
  }

  // ==================== Helper Methods ====================

  /**
   * Check if an entry (file or directory) should be included
   */
  private shouldIncludeEntry(path: string, isDirectory: boolean): boolean {
    if (isDirectory) {
      // For directories, check if they could contain matches
      return this.shouldTraverseDirectory(path)
    } else {
      // For files, check if they match patterns
      return this.shouldInclude(path)
    }
  }

  /**
   * Normalize a path by removing root prefix and leading slash for pattern matching
   */
  private normalizePath(path: string): string {
    let normalized = path

    // Remove root prefix if present
    if (this.root && normalized.startsWith(this.root)) {
      normalized = normalized.slice(this.root.length)
    }

    // Remove leading slash for pattern matching
    if (normalized.startsWith('/')) {
      normalized = normalized.slice(1)
    }

    return normalized
  }

  /**
   * Join path segments
   */
  private joinPath(base: string, segment: string): string {
    if (base === '/' || base === '') {
      return '/' + segment
    }
    return base + '/' + segment
  }
}
