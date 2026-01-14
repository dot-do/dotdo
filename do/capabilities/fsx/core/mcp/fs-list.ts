/**
 * fs_list MCP Tool - Directory Listing
 *
 * Provides directory listing functionality for AI-assisted file operations
 * via the Model Context Protocol (MCP).
 *
 * ## Features
 *
 * - Basic directory listing with alphabetical sorting
 * - Recursive directory traversal
 * - Pattern filtering (glob patterns)
 * - Hidden file handling (showHidden option)
 * - File details (withDetails option: type, size, mtime)
 * - Multiple sort options (name, size, date)
 * - Pagination (limit and offset)
 * - Symlink handling
 *
 * @module core/mcp/fs-list
 */

import { createMatcher } from '../glob/match'
import {
  type McpToolResult,
  type StorageBackend,
  type ExtendedStorageBackend,
  type TraversalEntry,
  normalizePath,
  joinPath,
  isPathTraversal,
  resolveSymlink,
  collectDirectoryEntries,
  errorResult,
  successResult,
} from './shared'

// Re-export types that external consumers may need
export type { McpToolResult, StorageBackend }

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the fs_list tool.
 */
export interface FsListOptions {
  /**
   * Directory path to list.
   */
  path: string

  /**
   * Whether to list recursively.
   * @default false
   */
  recursive?: boolean

  /**
   * Whether to include file details (type, size, mtime).
   * @default false
   */
  withDetails?: boolean

  /**
   * Glob pattern to filter results.
   */
  pattern?: string

  /**
   * Whether to include hidden files (starting with .).
   * @default false
   */
  showHidden?: boolean

  /**
   * Sort field: 'name', 'size', or 'date'.
   * @default 'name'
   */
  sort?: 'name' | 'size' | 'date'

  /**
   * Sort order: 'asc' or 'desc'.
   * @default 'asc'
   */
  order?: 'asc' | 'desc'

  /**
   * Maximum number of results to return.
   */
  limit?: number

  /**
   * Offset for pagination.
   * @default 0
   */
  offset?: number

  /**
   * Whether to group directories first.
   * @default false
   */
  groupDirectories?: boolean
}

// =============================================================================
// Directory Traversal
// =============================================================================

/**
 * Recursively collect directory entries.
 *
 * Uses shared collectDirectoryEntries for basic filtering, then applies
 * fs_list-specific logic for recursive traversal and symlink following.
 */
function collectEntries(
  storage: ExtendedStorageBackend,
  dirPath: string,
  basePath: string,
  options: FsListOptions,
  results: TraversalEntry[]
): void {
  const entries = collectDirectoryEntries(storage, dirPath, basePath, {
    showHidden: options.showHidden,
    recursive: options.recursive,
  })

  for (const entry of entries) {
    results.push(entry)

    // Recurse into directories if recursive mode
    if (options.recursive && entry.type === 'directory') {
      collectEntries(storage, entry.path, basePath, options, results)
    } else if (options.recursive && entry.type === 'symlink' && entry.linkTarget) {
      // Follow symlinks to directories
      const targetPath = entry.linkTarget.startsWith('/')
        ? entry.linkTarget
        : joinPath(dirPath, entry.linkTarget)
      const targetEntry = storage.get(targetPath)
      if (targetEntry?.type === 'directory') {
        collectEntries(storage, entry.path, basePath, options, results)
      }
    }
  }
}

// =============================================================================
// Pattern Matching
// =============================================================================

/**
 * Filter results by glob pattern.
 */
function filterByPattern(results: TraversalEntry[], pattern: string): TraversalEntry[] {
  // Handle negation pattern
  const isNegated = pattern.startsWith('!')
  const actualPattern = isNegated ? pattern.slice(1) : pattern

  const patternMatcher = createMatcher(actualPattern, { dot: true })

  return results.filter((item) => {
    const matches = patternMatcher(item.name)
    return isNegated ? !matches : matches
  })
}

// =============================================================================
// Sorting
// =============================================================================

/**
 * Sort results based on options.
 */
function sortResults(results: TraversalEntry[], options: FsListOptions): TraversalEntry[] {
  const sortField = options.sort ?? 'name'
  const sortOrder = options.order ?? 'asc'
  const groupDirectories = options.groupDirectories ?? false
  const multiplier = sortOrder === 'desc' ? -1 : 1

  return [...results].sort((a, b) => {
    // Group directories first if enabled
    if (groupDirectories) {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
    }

    // Sort by field
    switch (sortField) {
      case 'size':
        return (a.size - b.size) * multiplier
      case 'date':
        return (a.mtime - b.mtime) * multiplier
      case 'name':
      default:
        return a.name.localeCompare(b.name) * multiplier
    }
  })
}

// =============================================================================
// Result Formatting
// =============================================================================

/**
 * Format a single entry for output.
 */
function formatEntry(item: TraversalEntry, options: FsListOptions, isRecursive: boolean): string {
  const withDetails = options.withDetails ?? false
  const displayName = isRecursive ? item.relativePath : item.name

  if (!withDetails) {
    return displayName
  }

  // Format: type name size mtime [-> target]
  const typeChar = item.type === 'directory' ? 'd' : item.type === 'symlink' ? 'l' : '-'

  // Format size
  const sizeStr = item.size.toString().padStart(10)

  // Format mtime
  const date = new Date(item.mtime)
  const mtimeStr = date.toISOString().slice(0, 16).replace('T', ' ')

  let line = `${typeChar} ${displayName.padEnd(20)} ${sizeStr} ${mtimeStr}`

  // Add symlink target
  if (item.type === 'symlink' && item.linkTarget) {
    line += ` -> ${item.linkTarget}`
  }

  return line
}

/**
 * Format all results as text output.
 */
function formatResults(
  results: TraversalEntry[],
  options: FsListOptions,
  totalCount: number
): string {
  const isRecursive = options.recursive ?? false
  const limit = options.limit
  const offset = options.offset ?? 0

  // Handle empty directory
  if (results.length === 0 && totalCount === 0) {
    return '(empty directory)'
  }

  const lines = results.map((item) => formatEntry(item, options, isRecursive))

  // Add truncation indicator if applicable
  if (limit !== undefined && totalCount > offset + results.length) {
    const remaining = totalCount - (offset + results.length)
    lines.push(`... and ${remaining} more`)
  }

  return lines.join('\n')
}

// =============================================================================
// Input Validation
// =============================================================================

/**
 * Validate fs_list parameters.
 */
function validateParams(
  params: Record<string, unknown>,
  storage: StorageBackend
): { error: McpToolResult } | { path: string } {
  const path = params.path

  // Check path is provided
  if (path === undefined || path === null) {
    return { error: errorResult('Error: path is required') }
  }

  // Check path is a string
  if (typeof path !== 'string') {
    return { error: errorResult('Error: path must be a string') }
  }

  // Check path is not empty
  if (path === '') {
    return { error: errorResult('Error: path cannot be empty') }
  }

  // Check for path traversal
  if (isPathTraversal(path)) {
    return {
      error: errorResult(`Error: EACCES: permission denied - path traversal detected '${path}'`),
    }
  }

  const normalizedPath = normalizePath(path)

  // Check path exists
  if (!storage.has(normalizedPath)) {
    return {
      error: errorResult(`Error: ENOENT: no such file or directory '${path}'`),
    }
  }

  // Get entry to check if it's a symlink
  const entry = storage.get(normalizedPath)

  // If symlink, resolve it and check if target is a directory
  if (entry?.type === 'symlink') {
    const resolvedPath = resolveSymlink(storage, normalizedPath)

    // Check resolved path exists
    if (!storage.has(resolvedPath)) {
      return { error: errorResult(`Error: ENOENT: broken symlink '${path}'`) }
    }

    // Check resolved path is a directory
    if (!storage.isDirectory(resolvedPath)) {
      return { error: errorResult(`Error: ENOTDIR: not a directory '${path}'`) }
    }

    // Return the resolved path for listing
    return { path: resolvedPath }
  }

  // Check path is a directory
  if (!storage.isDirectory(normalizedPath)) {
    return { error: errorResult(`Error: ENOTDIR: not a directory '${path}'`) }
  }

  return { path: normalizedPath }
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Invoke the fs_list MCP tool.
 *
 * Lists directory contents with support for recursive listing, pattern filtering,
 * file details, sorting, and pagination.
 *
 * @param params - MCP tool parameters
 * @param storage - Storage backend to list from
 * @returns MCP tool result with directory listing or error
 */
export async function invokeFsList(
  params: Record<string, unknown>,
  storage: StorageBackend
): Promise<McpToolResult> {
  // Validate parameters and get resolved path (may follow symlinks)
  const validationResult = validateParams(params, storage)
  if ('error' in validationResult) {
    return validationResult.error
  }

  const resolvedPath = validationResult.path

  // Extract parameters with defaults
  const options: FsListOptions = {
    path: resolvedPath,
    recursive: (params.recursive as boolean) ?? false,
    withDetails: (params.withDetails as boolean) ?? false,
    pattern: params.pattern as string | undefined,
    showHidden: (params.showHidden as boolean) ?? false,
    sort: (params.sort as 'name' | 'size' | 'date') ?? 'name',
    order: (params.order as 'asc' | 'desc') ?? 'asc',
    limit: params.limit as number | undefined,
    offset: (params.offset as number) ?? 0,
    groupDirectories: (params.groupDirectories as boolean) ?? false,
  }

  // Collect all entries
  const allResults: TraversalEntry[] = []
  collectEntries(storage as ExtendedStorageBackend, resolvedPath, resolvedPath, options, allResults)

  // Apply pattern filter if specified
  let filteredResults = options.pattern
    ? filterByPattern(allResults, options.pattern)
    : allResults

  // Sort results
  filteredResults = sortResults(filteredResults, options)

  // Get total count before pagination
  const totalCount = filteredResults.length

  // Apply pagination
  const offset = options.offset ?? 0
  const paginatedResults =
    offset || options.limit !== undefined
      ? filteredResults.slice(offset, options.limit !== undefined ? offset + options.limit : undefined)
      : filteredResults

  // Format results
  const text = formatResults(paginatedResults, options, totalCount)

  return successResult(text)
}

// =============================================================================
// MCP Tool Schema
// =============================================================================

/**
 * MCP tool schema definition for fs_list.
 */
export const fsListToolSchema = {
  name: 'fs_list',
  description: 'List files and directories in a path',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list',
      },
      recursive: {
        type: 'boolean',
        description: 'List recursively (default: false)',
      },
      withDetails: {
        type: 'boolean',
        description: 'Include file details like size and mtime (default: false)',
      },
      pattern: {
        type: 'string',
        description: 'Glob pattern to filter results (e.g., "*.ts")',
      },
      showHidden: {
        type: 'boolean',
        description: 'Include hidden files starting with . (default: false)',
      },
      sort: {
        type: 'string',
        enum: ['name', 'size', 'date'],
        description: 'Sort field (default: name)',
      },
      order: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort order (default: asc)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return',
      },
      offset: {
        type: 'number',
        description: 'Offset for pagination (default: 0)',
      },
      groupDirectories: {
        type: 'boolean',
        description: 'Group directories before files (default: false)',
      },
    },
    required: ['path'],
  },
} as const
