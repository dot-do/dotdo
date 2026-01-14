/**
 * fs_search MCP Tool - Glob Pattern File Search
 *
 * Provides glob pattern file search functionality for AI-assisted file operations
 * via the Model Context Protocol (MCP).
 *
 * ## Features
 *
 * - Glob pattern matching with support for `*`, `**`, `?`, `[abc]`, `{a,b,c}`
 * - Recursive directory traversal
 * - Exclude patterns for filtering results
 * - Content search (grep-like) with match counting
 * - Depth limiting for controlled traversal
 * - Hidden file handling
 * - Result limiting for large directories
 *
 * ## Performance Optimizations
 *
 * 1. **Pattern pre-compilation**: Uses `createMatcher()` to compile patterns once
 * 2. **Early termination**: Stops traversal when limit is reached
 * 3. **Exclude pattern short-circuit**: Skips excluded paths without full traversal
 * 4. **Lazy content search**: Only reads file content when pattern matches
 *
 * @module core/mcp/fs-search
 */

import { match, createMatcher, type MatchOptions } from '../glob/match'

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
 * Options for the fs_search tool.
 *
 * All options except `pattern` are optional with sensible defaults.
 *
 * @example Basic search
 * ```typescript
 * const options: FsSearchOptions = {
 *   pattern: '**\/*.ts',
 *   path: '/src',
 * }
 * ```
 *
 * @example Advanced search with content filtering
 * ```typescript
 * const options: FsSearchOptions = {
 *   pattern: '**\/*.ts',
 *   path: '/src',
 *   exclude: ['node_modules', 'dist'],
 *   maxDepth: 3,
 *   showHidden: false,
 *   limit: 100,
 *   contentSearch: 'TODO',
 *   caseSensitive: false,
 * }
 * ```
 */
export interface FsSearchOptions {
  /**
   * Glob pattern to match files against.
   *
   * Supports standard glob syntax:
   * - `*` matches any characters except path separator
   * - `**` matches any characters including path separator (recursive)
   * - `?` matches a single character
   * - `[abc]` matches any character in the set
   * - `{a,b,c}` matches any of the alternatives
   *
   * @example
   * ```typescript
   * '*.ts'           // TypeScript files in current directory
   * '**\/*.ts'       // TypeScript files recursively
   * 'src/**\/*.{ts,tsx}'  // TS/TSX files in src
   * '[A-Z]*.ts'      // Files starting with uppercase
   * ```
   */
  pattern: string

  /**
   * Base directory to search in.
   * @default '/'
   */
  path?: string

  /**
   * Patterns to exclude from results.
   *
   * Matches are checked against both full relative paths and
   * individual path segments.
   *
   * @example
   * ```typescript
   * ['node_modules', '.git', 'dist']
   * ['**\/*.test.ts']  // Exclude test files
   * ```
   */
  exclude?: string[]

  /**
   * Maximum depth to traverse (0 = only files in path directory).
   * @default Infinity
   */
  maxDepth?: number

  /**
   * Whether to include hidden files (starting with `.`).
   * @default false
   */
  showHidden?: boolean

  /**
   * Maximum number of results to return.
   * @default Infinity
   */
  limit?: number

  /**
   * Search within file contents (grep-like functionality).
   *
   * When specified, only files containing this string will be
   * included in results, with match count displayed.
   */
  contentSearch?: string

  /**
   * Whether content search is case-sensitive.
   * @default true
   */
  caseSensitive?: boolean
}

/**
 * Individual search result item.
 *
 * Contains information about a matched file or directory.
 */
export interface SearchResultItem {
  /** Full absolute path to the entry */
  path: string
  /** Type of filesystem entry */
  type: 'file' | 'directory' | 'symlink'
  /** File size in bytes (0 for directories) */
  size?: number
  /** Number of content matches (only for content search) */
  matches?: number
}

/**
 * Storage backend interface for filesystem operations.
 *
 * This abstraction allows the search tool to work with both
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
  get(path: string): {
    type: 'file' | 'directory' | 'symlink'
    content: Uint8Array
  } | undefined
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
 * Get relative path from base to path.
 *
 * Returns the portion of `path` that comes after `base`.
 *
 * @param path - Target path
 * @param base - Base path to remove
 * @returns Relative path
 *
 * @example
 * ```typescript
 * getRelativePath('/home/user/foo', '/home/user')  // 'foo'
 * getRelativePath('/foo/bar', '/')                 // 'foo/bar'
 * ```
 */
export function getRelativePath(path: string, base: string): string {
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

// =============================================================================
// Exclude Pattern Matching
// =============================================================================

/**
 * Check if a path should be excluded based on exclude patterns.
 *
 * Checks both the full relative path and individual path segments
 * against each exclude pattern.
 *
 * @param relativePath - Relative path to check
 * @param excludePatterns - Array of glob patterns to exclude
 * @returns True if the path should be excluded
 *
 * @example
 * ```typescript
 * shouldExclude('node_modules/lodash/index.js', ['node_modules'])  // true
 * shouldExclude('src/index.ts', ['**\/*.test.ts'])                 // false
 * ```
 */
export function shouldExclude(
  relativePath: string,
  excludePatterns: string[]
): boolean {
  const matchOptions: MatchOptions = { dot: true }

  for (const pattern of excludePatterns) {
    // Check full path match
    if (match(pattern, relativePath, matchOptions)) {
      return true
    }

    // Check each path segment
    const segments = relativePath.split('/')
    for (const segment of segments) {
      if (segment === pattern || match(pattern, segment, matchOptions)) {
        return true
      }
    }
  }

  return false
}

// =============================================================================
// Content Search
// =============================================================================

/**
 * Count occurrences of a search term in content.
 *
 * Performs a non-overlapping count of substring matches.
 *
 * @param content - Text content to search
 * @param searchTerm - Term to search for
 * @param caseSensitive - Whether search is case-sensitive
 * @returns Number of matches found
 *
 * @example
 * ```typescript
 * countContentMatches('hello hello world', 'hello', true)   // 2
 * countContentMatches('HELLO hello', 'hello', false)        // 2
 * ```
 */
export function countContentMatches(
  content: string,
  searchTerm: string,
  caseSensitive: boolean
): number {
  let searchContent = content
  let searchTarget = searchTerm

  if (!caseSensitive) {
    searchContent = content.toLowerCase()
    searchTarget = searchTerm.toLowerCase()
  }

  let count = 0
  let pos = 0

  while ((pos = searchContent.indexOf(searchTarget, pos)) !== -1) {
    count++
    pos += searchTarget.length
  }

  return count
}

// =============================================================================
// Directory Traversal
// =============================================================================

/**
 * Recursively search a directory for matching files.
 *
 * This function performs depth-first traversal with early termination
 * when the result limit is reached. Pattern matching is optimized
 * using pre-compiled matchers.
 *
 * @param storage - Storage backend to search
 * @param dirPath - Current directory path
 * @param basePath - Base path for relative path calculation
 * @param options - Search options
 * @param results - Results array to populate (mutated)
 * @param currentDepth - Current traversal depth
 *
 * @internal
 */
export function searchDirectory(
  storage: StorageBackend,
  dirPath: string,
  basePath: string,
  options: FsSearchOptions,
  results: SearchResultItem[],
  currentDepth: number
): void {
  const maxDepth = options.maxDepth ?? Infinity
  const limit = options.limit ?? Infinity
  const showHidden = options.showHidden ?? false
  const excludePatterns = options.exclude ?? []
  const caseSensitive = options.caseSensitive ?? true

  // Early termination: limit reached
  if (results.length >= limit) {
    return
  }

  // Early termination: depth limit exceeded
  if (currentDepth > maxDepth) {
    return
  }

  const children = storage.getChildren(dirPath)

  // Pre-compile pattern matcher for efficiency
  const patternMatcher = createMatcher(options.pattern, { dot: showHidden })

  for (const name of children) {
    // Check limit before processing
    if (results.length >= limit) {
      return
    }

    // Skip hidden files unless showHidden is enabled
    if (!showHidden && name.startsWith('.')) {
      continue
    }

    const childPath = dirPath === '/' ? `/${name}` : `${dirPath}/${name}`
    const relativePath = getRelativePath(childPath, basePath)

    // Check exclude patterns (short-circuit)
    if (shouldExclude(relativePath, excludePatterns)) {
      continue
    }

    const entry = storage.get(childPath)
    if (!entry) continue

    // Check if relative path matches the search pattern
    const matches = patternMatcher(relativePath)

    if (entry.type === 'directory') {
      // Include directory if it matches pattern
      if (matches) {
        results.push({
          path: childPath,
          type: 'directory',
          size: 0,
        })
      }
      // Recurse into directory (always, to find nested matches)
      searchDirectory(
        storage,
        childPath,
        basePath,
        options,
        results,
        currentDepth + 1
      )
    } else if (entry.type === 'file') {
      if (matches) {
        // Content search filter
        if (options.contentSearch) {
          const content = new TextDecoder().decode(entry.content)
          const matchCount = countContentMatches(
            content,
            options.contentSearch,
            caseSensitive
          )
          if (matchCount > 0) {
            results.push({
              path: childPath,
              type: 'file',
              size: entry.content.length,
              matches: matchCount,
            })
          }
        } else {
          results.push({
            path: childPath,
            type: 'file',
            size: entry.content.length,
          })
        }
      }
    } else if (entry.type === 'symlink') {
      if (matches) {
        results.push({
          path: childPath,
          type: 'symlink',
        })
      }
    }
  }
}

// =============================================================================
// Result Formatting
// =============================================================================

/**
 * Format search results as human-readable text.
 *
 * @param results - Array of search results
 * @returns Formatted text with path listing and summary
 *
 * @internal
 */
function formatResults(results: SearchResultItem[]): string {
  if (results.length === 0) {
    return 'No matches found'
  }

  // Sort results by path for consistent output
  const sortedResults = [...results].sort((a, b) =>
    a.path.localeCompare(b.path)
  )

  const lines: string[] = []

  for (const result of sortedResults) {
    let line = result.path

    // Add trailing slash for directories
    if (result.type === 'directory') {
      line += '/'
    }

    // Add match count for content search
    if (result.matches !== undefined) {
      const matchWord = result.matches === 1 ? 'match' : 'matches'
      line += ` (${result.matches} ${matchWord})`
    }

    lines.push(line)
  }

  // Add summary
  const totalMatches = sortedResults.length
  const matchWord = totalMatches === 1 ? 'match' : 'matches'
  lines.push('')
  lines.push(`Found ${totalMatches} ${matchWord}`)

  return lines.join('\n')
}

// =============================================================================
// Input Validation
// =============================================================================

/**
 * Validate fs_search parameters and return error if invalid.
 *
 * @param params - Raw parameters from MCP invocation
 * @param storage - Storage backend for path validation
 * @returns McpToolResult with error, or null if valid
 *
 * @internal
 */
function validateParams(
  params: Record<string, unknown>,
  storage: StorageBackend
): McpToolResult | null {
  const pattern = params.pattern
  const path = (params.path as string) ?? '/'
  const exclude = params.exclude
  const limit = params.limit
  const maxDepth = params.maxDepth

  // Validate pattern is provided
  if (!pattern || typeof pattern !== 'string') {
    return {
      content: [
        { type: 'text', text: 'Error: pattern is required and must be a string' },
      ],
      isError: true,
    }
  }

  // Validate pattern is not empty
  if (pattern === '') {
    return {
      content: [{ type: 'text', text: 'Error: pattern cannot be empty' }],
      isError: true,
    }
  }

  // Validate path is a string
  if (typeof path !== 'string') {
    return {
      content: [{ type: 'text', text: 'Error: path must be a string' }],
      isError: true,
    }
  }

  // Validate path exists
  const normalizedPath = normalizePath(path)
  if (!storage.has(normalizedPath)) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ENOENT: no such file or directory '${path}'`,
        },
      ],
      isError: true,
    }
  }

  // Validate path is a directory
  if (!storage.isDirectory(normalizedPath)) {
    return {
      content: [
        { type: 'text', text: `Error: ENOTDIR: not a directory '${path}'` },
      ],
      isError: true,
    }
  }

  // Validate exclude is an array if provided
  if (exclude !== undefined && !Array.isArray(exclude)) {
    return {
      content: [
        { type: 'text', text: 'Error: exclude must be an array of patterns' },
      ],
      isError: true,
    }
  }

  // Validate limit is a non-negative number if provided
  if (limit !== undefined && (typeof limit !== 'number' || limit < 0)) {
    return {
      content: [
        { type: 'text', text: 'Error: limit must be a non-negative number' },
      ],
      isError: true,
    }
  }

  // Validate maxDepth is a non-negative number if provided
  if (maxDepth !== undefined && (typeof maxDepth !== 'number' || maxDepth < 0)) {
    return {
      content: [
        { type: 'text', text: 'Error: maxDepth must be a non-negative number' },
      ],
      isError: true,
    }
  }

  return null
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Invoke the fs_search MCP tool.
 *
 * Searches for files matching a glob pattern with optional content search.
 * This is the main entry point for MCP tool invocation.
 *
 * ## Performance Characteristics
 *
 * - **Pattern compilation**: O(n) one-time cost, then O(m) per path
 * - **Directory traversal**: O(total_entries) in search path
 * - **Content search**: O(file_size) per matching file
 * - **Memory**: O(results_count) for result storage
 *
 * @param params - MCP tool parameters (see FsSearchOptions)
 * @param storage - Storage backend to search
 * @returns MCP tool result with search results or error
 *
 * @example
 * ```typescript
 * // Search for TypeScript files
 * const result = await invokeFsSearch(
 *   { pattern: '**\/*.ts', path: '/src' },
 *   storage
 * )
 *
 * // Search with content filter
 * const result = await invokeFsSearch(
 *   {
 *     pattern: '**\/*.ts',
 *     path: '/src',
 *     contentSearch: 'TODO',
 *     caseSensitive: false,
 *   },
 *   storage
 * )
 * ```
 */
export async function invokeFsSearch(
  params: Record<string, unknown>,
  storage: StorageBackend
): Promise<McpToolResult> {
  // Validate parameters
  const validationError = validateParams(params, storage)
  if (validationError) {
    return validationError
  }

  // Extract validated parameters
  const pattern = params.pattern as string
  const path = (params.path as string) ?? '/'
  const exclude = params.exclude as string[] | undefined
  const maxDepth = params.maxDepth as number | undefined
  const showHidden = params.showHidden as boolean | undefined
  const limit = params.limit as number | undefined
  const contentSearch = params.contentSearch as string | undefined
  const caseSensitive = params.caseSensitive as boolean | undefined

  const normalizedPath = normalizePath(path)

  // Build search options
  const options: FsSearchOptions = {
    pattern,
    path: normalizedPath,
    exclude: exclude ?? [],
    maxDepth,
    showHidden: showHidden ?? false,
    limit,
    contentSearch,
    caseSensitive: caseSensitive ?? true,
  }

  // Execute search
  const results: SearchResultItem[] = []
  searchDirectory(storage, normalizedPath, normalizedPath, options, results, 0)

  // Format and return results
  const text = formatResults(results)

  return {
    content: [{ type: 'text', text }],
    isError: false,
  }
}

// =============================================================================
// MCP Tool Schema (for registration)
// =============================================================================

/**
 * MCP tool schema definition for fs_search.
 *
 * This schema describes the tool's interface for MCP registration.
 */
export const fsSearchToolSchema = {
  name: 'fs_search',
  description: 'Search for files matching a glob pattern with optional content search',
  inputSchema: {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match files (e.g., "**/*.ts", "*.json")',
      },
      path: {
        type: 'string',
        description: 'Base directory to search in (default: "/")',
      },
      exclude: {
        type: 'array',
        description: 'Patterns to exclude from results (e.g., ["node_modules", ".git"])',
      },
      maxDepth: {
        type: 'number',
        description: 'Maximum directory depth to search (0 = current dir only)',
      },
      showHidden: {
        type: 'boolean',
        description: 'Include hidden files and directories (default: false)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return',
      },
      contentSearch: {
        type: 'string',
        description: 'Search within file contents (grep-like)',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Case-sensitive content search (default: true)',
      },
    },
    required: ['pattern'],
  },
} as const
