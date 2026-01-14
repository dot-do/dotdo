/**
 * fs_tree MCP Tool - Directory Tree Visualization
 *
 * Provides directory tree visualization for AI-assisted file operations
 * via the Model Context Protocol (MCP).
 *
 * ## Features
 *
 * - ASCII tree output with classic box-drawing characters
 * - JSON tree output for programmatic processing
 * - Depth limiting for large directories
 * - Pattern exclusion (glob patterns)
 * - Pattern inclusion (file filtering)
 * - Hidden file handling
 * - File size display
 * - Symlink indicator with target path
 * - Directories-first sorting option
 *
 * ## Refactoring Notes
 *
 * This module was refactored from inline test code (GREEN phase) to:
 * 1. Use shared utilities from ./shared.ts
 * 2. Extract tree formatters into testable functions
 * 3. Separate traversal from formatting
 *
 * @module core/mcp/fs-tree
 */

import { createMatcher } from '../glob/match'
import {
  type McpToolResult,
  type StorageBackend,
  normalizePath,
  joinPath,
  isPathTraversal,
  errorResult,
  successResult,
} from './shared'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for fs_tree tool.
 */
export interface FsTreeOptions {
  /** Directory path to generate tree for (required) */
  path: string
  /** Maximum depth to traverse (default: Infinity) */
  maxDepth?: number
  /** Include hidden files starting with . (default: false) */
  showHidden?: boolean
  /** Show file sizes (default: false) */
  showSize?: boolean
  /** Patterns to exclude */
  exclude?: string[]
  /** Patterns to include (files only) */
  include?: string[]
  /** Output format: 'ascii' or 'json' (default: 'ascii') */
  format?: 'ascii' | 'json'
  /** Sort directories before files (default: false) */
  dirsFirst?: boolean
}

/**
 * Tree node for JSON output.
 */
export interface TreeNode {
  /** Entry name */
  name: string
  /** Entry type */
  type: 'file' | 'directory' | 'symlink'
  /** File size in bytes (if showSize is true) */
  size?: number
  /** Children nodes (for directories) */
  children?: TreeNode[]
  /** Symlink target path */
  target?: string
}

/**
 * Directory entry collected during traversal.
 */
interface TreeEntry {
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  target?: string
}

/**
 * Extended storage backend for fs_tree operations.
 */
interface TreeStorageBackend extends StorageBackend {
  /** Normalize a path */
  normalizePath(path: string): string
  /** Get file name from path */
  getFileName(path: string): string
}

// =============================================================================
// Size Formatting
// =============================================================================

/**
 * Format bytes to human-readable size.
 *
 * Uses single-letter suffixes: B, K, M, G
 *
 * @param bytes - Number of bytes
 * @returns Human-readable size string
 *
 * @example
 * ```typescript
 * formatSize(512)        // '512B'
 * formatSize(1024)       // '1K'
 * formatSize(1536)       // '2K' (rounded)
 * formatSize(1048576)    // '1M'
 * ```
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}M`
  return `${Math.round(bytes / (1024 * 1024 * 1024))}G`
}

// =============================================================================
// Pattern Matching
// =============================================================================

/**
 * Check if a name matches any exclusion pattern.
 *
 * @param name - Name to check
 * @param excludePatterns - Patterns to match against
 * @returns True if name should be excluded
 */
function shouldExclude(name: string, excludePatterns: string[]): boolean {
  for (const pattern of excludePatterns) {
    const matcher = createMatcher(pattern, { dot: true })
    if (matcher(name)) {
      return true
    }
    // Also match exact name against simple patterns
    if (name === pattern) {
      return true
    }
  }
  return false
}

/**
 * Check if a name matches any inclusion pattern.
 *
 * @param name - Name to check
 * @param includePatterns - Patterns to match (empty = include all)
 * @returns True if name should be included
 */
function shouldInclude(name: string, includePatterns: string[] | undefined): boolean {
  if (!includePatterns || includePatterns.length === 0) {
    return true
  }
  for (const pattern of includePatterns) {
    const matcher = createMatcher(pattern, { dot: true })
    if (matcher(name)) {
      return true
    }
  }
  return false
}

// =============================================================================
// Directory Traversal
// =============================================================================

/**
 * Get filtered and sorted directory entries.
 *
 * This is the core traversal function that handles:
 * - Hidden file filtering
 * - Exclude pattern matching
 * - Include pattern matching (files only)
 * - Sorting (alphabetical, optionally dirs-first)
 *
 * @param storage - Storage backend
 * @param dirPath - Directory path to list
 * @param options - Tree options
 * @returns Array of filtered, sorted entries
 */
function getDirectoryEntries(
  storage: TreeStorageBackend,
  dirPath: string,
  options: FsTreeOptions
): TreeEntry[] {
  const children = storage.getChildren(dirPath)
  const entries: TreeEntry[] = []

  const showHidden = options.showHidden ?? false
  const excludePatterns = options.exclude ?? []

  for (const name of children) {
    // Skip hidden files unless showHidden is true
    if (!showHidden && name.startsWith('.')) {
      continue
    }

    // Check exclude patterns
    if (shouldExclude(name, excludePatterns)) {
      continue
    }

    const childPath = joinPath(dirPath, name)
    const entry = storage.get(childPath)

    if (!entry) continue

    // For files, check include patterns
    if (entry.type === 'file') {
      if (!shouldInclude(name, options.include)) {
        continue
      }
    }

    entries.push({
      name,
      type: entry.type,
      size: entry.content.length,
      target: entry.linkTarget,
    })
  }

  // Sort entries
  entries.sort((a, b) => {
    // Directories first if dirsFirst is true
    if (options.dirsFirst) {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
    }
    // Then alphabetically
    return a.name.localeCompare(b.name)
  })

  return entries
}

// =============================================================================
// JSON Tree Builder
// =============================================================================

/**
 * Build JSON tree structure recursively.
 *
 * @param storage - Storage backend
 * @param dirPath - Current directory path
 * @param dirName - Name to use for this node
 * @param options - Tree options
 * @param currentDepth - Current traversal depth
 * @param maxDepth - Maximum depth to traverse
 * @returns Tree node structure
 */
function buildJsonTree(
  storage: TreeStorageBackend,
  dirPath: string,
  dirName: string,
  options: FsTreeOptions,
  currentDepth: number,
  maxDepth: number
): TreeNode {
  const entry = storage.get(dirPath)
  const node: TreeNode = {
    name: dirName,
    type: entry?.type ?? 'directory',
  }

  if (options.showSize && entry) {
    node.size = entry.content.length
  }

  if (entry?.type === 'symlink' && entry.linkTarget) {
    node.target = entry.linkTarget
  }

  if (entry?.type === 'directory' && currentDepth < maxDepth) {
    const entries = getDirectoryEntries(storage, dirPath, options)
    node.children = []

    for (const childEntry of entries) {
      const childPath = joinPath(dirPath, childEntry.name)

      if (childEntry.type === 'directory') {
        node.children.push(
          buildJsonTree(storage, childPath, childEntry.name, options, currentDepth + 1, maxDepth)
        )
      } else {
        const childNode: TreeNode = {
          name: childEntry.name,
          type: childEntry.type,
        }
        if (options.showSize) {
          childNode.size = childEntry.size
        }
        if (childEntry.type === 'symlink' && childEntry.target) {
          childNode.target = childEntry.target
        }
        node.children.push(childNode)
      }
    }
  }

  return node
}

// =============================================================================
// ASCII Tree Builder
// =============================================================================

/** Box drawing characters for ASCII tree */
const TREE_BRANCH = '├── '
const TREE_LAST = '└── '
const TREE_VERTICAL = '│   '
const TREE_SPACE = '    '

/**
 * Build ASCII tree string recursively.
 *
 * Uses box-drawing characters for visual tree structure:
 * - ├── for intermediate entries
 * - └── for last entry in a directory
 * - │   for vertical continuation
 *
 * @param storage - Storage backend
 * @param dirPath - Current directory path
 * @param dirName - Name to display for root
 * @param options - Tree options
 * @param currentDepth - Current traversal depth
 * @param maxDepth - Maximum depth to traverse
 * @returns ASCII tree string
 */
function buildAsciiTree(
  storage: TreeStorageBackend,
  dirPath: string,
  dirName: string,
  options: FsTreeOptions,
  currentDepth: number,
  maxDepth: number
): string {
  const lines: string[] = []

  // Add root directory name at depth 0
  if (currentDepth === 0) {
    lines.push(dirName)
  }

  // Stop if we've reached max depth
  if (currentDepth >= maxDepth) {
    return lines.join('\n')
  }

  const entries = getDirectoryEntries(storage, dirPath, options)

  // Render each entry with appropriate prefix
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const isLast = i === entries.length - 1
    const connector = isLast ? TREE_LAST : TREE_BRANCH
    const childPrefix = isLast ? TREE_SPACE : TREE_VERTICAL

    // Build the line: prefix + connector + name + optional decorations
    let line = connector + entry.name

    // Add symlink indicator
    if (entry.type === 'symlink' && entry.target) {
      line += ` -> ${entry.target}`
    }

    // Add size if requested (files only)
    if (options.showSize && entry.type === 'file') {
      line += ` (${formatSize(entry.size)})`
    }

    lines.push(line)

    // Recurse into directories
    if (entry.type === 'directory' && currentDepth + 1 < maxDepth) {
      const childPath = joinPath(dirPath, entry.name)
      const childTree = buildAsciiTreeChildren(
        storage,
        childPath,
        options,
        currentDepth + 1,
        maxDepth,
        childPrefix
      )
      if (childTree) {
        lines.push(childTree)
      }
    }
  }

  return lines.join('\n')
}

/**
 * Build ASCII tree for children (no root line).
 *
 * Used for recursive rendering of nested directories.
 *
 * @param storage - Storage backend
 * @param dirPath - Directory path
 * @param options - Tree options
 * @param currentDepth - Current depth
 * @param maxDepth - Maximum depth
 * @param prefix - Prefix string for indentation
 * @returns ASCII tree string for children
 */
function buildAsciiTreeChildren(
  storage: TreeStorageBackend,
  dirPath: string,
  options: FsTreeOptions,
  currentDepth: number,
  maxDepth: number,
  prefix: string
): string {
  if (currentDepth >= maxDepth) {
    return ''
  }

  const entries = getDirectoryEntries(storage, dirPath, options)
  const lines: string[] = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const isLast = i === entries.length - 1
    const connector = isLast ? TREE_LAST : TREE_BRANCH
    const childPrefix = prefix + (isLast ? TREE_SPACE : TREE_VERTICAL)

    // Build the line
    let line = prefix + connector + entry.name

    // Add symlink indicator
    if (entry.type === 'symlink' && entry.target) {
      line += ` -> ${entry.target}`
    }

    // Add size if requested (files only)
    if (options.showSize && entry.type === 'file') {
      line += ` (${formatSize(entry.size)})`
    }

    lines.push(line)

    // Recurse into directories
    if (entry.type === 'directory' && currentDepth + 1 < maxDepth) {
      const childPath = joinPath(dirPath, entry.name)
      const childTree = buildAsciiTreeChildren(
        storage,
        childPath,
        options,
        currentDepth + 1,
        maxDepth,
        childPrefix
      )
      if (childTree) {
        lines.push(childTree)
      }
    }
  }

  return lines.join('\n')
}

// =============================================================================
// Input Validation
// =============================================================================

/**
 * Validate path parameter for fs_tree.
 *
 * @param params - Raw parameters
 * @param storage - Storage backend
 * @returns Error result or validated normalized path
 */
function validateParams(
  params: Record<string, unknown>,
  storage: TreeStorageBackend
): McpToolResult | { normalizedPath: string } {
  const path = params.path

  // Check path is provided
  if (path === undefined || path === null) {
    return errorResult('Error: path is required')
  }

  // Check path is a string
  if (typeof path !== 'string') {
    return errorResult('Error: path must be a string')
  }

  // Check path is not empty
  if (path === '') {
    return errorResult('Error: path is invalid (empty)')
  }

  // Check for path traversal
  if (isPathTraversal(path)) {
    return errorResult(`EACCES: permission denied - path traversal detected: ${path}`)
  }

  const normalizedPath = storage.normalizePath(path)

  // Check path exists
  if (!storage.has(normalizedPath)) {
    return errorResult(`ENOENT: no such file or directory: ${path}`)
  }

  // Check path is a directory
  if (!storage.isDirectory(normalizedPath)) {
    return errorResult(`ENOTDIR: not a directory: ${path}`)
  }

  return { normalizedPath }
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Invoke the fs_tree MCP tool.
 *
 * Generates a tree visualization of a directory structure.
 *
 * @param params - MCP tool parameters (see FsTreeOptions)
 * @param storage - Storage backend to traverse
 * @returns MCP tool result with tree visualization or error
 *
 * @example ASCII output (default)
 * ```
 * myproject
 * ├── src
 * │   ├── components
 * │   │   └── Button.tsx
 * │   └── index.ts
 * └── package.json
 * ```
 *
 * @example JSON output (format: 'json')
 * ```json
 * {
 *   "name": "myproject",
 *   "type": "directory",
 *   "children": [
 *     {"name": "src", "type": "directory", "children": [...]},
 *     {"name": "package.json", "type": "file"}
 *   ]
 * }
 * ```
 */
export async function invokeFsTree(
  params: Record<string, unknown>,
  storage: TreeStorageBackend
): Promise<McpToolResult> {
  // Validate parameters
  const validation = validateParams(params, storage)
  if ('content' in validation) {
    return validation
  }

  const normalizedPath = validation.normalizedPath

  // Build options
  const options: FsTreeOptions = {
    path: normalizedPath,
    maxDepth: typeof params.maxDepth === 'number' ? Math.max(0, params.maxDepth) : Infinity,
    showHidden: params.showHidden === true,
    showSize: params.showSize === true,
    exclude: Array.isArray(params.exclude) ? (params.exclude as string[]) : [],
    include: Array.isArray(params.include) ? (params.include as string[]) : undefined,
    format: params.format === 'json' ? 'json' : 'ascii',
    dirsFirst: params.dirsFirst === true,
  }

  // Get directory name for root
  const dirName = normalizedPath === '/' ? '/' : storage.getFileName(normalizedPath)

  // Build tree based on format
  if (options.format === 'json') {
    const tree = buildJsonTree(
      storage,
      normalizedPath,
      dirName,
      options,
      0,
      options.maxDepth ?? Infinity
    )
    return successResult(JSON.stringify(tree, null, 2))
  } else {
    const tree = buildAsciiTree(
      storage,
      normalizedPath,
      dirName,
      options,
      0,
      options.maxDepth ?? Infinity
    )
    return successResult(tree)
  }
}

// =============================================================================
// MCP Tool Schema
// =============================================================================

/**
 * MCP tool schema definition for fs_tree.
 */
export const fsTreeToolSchema = {
  name: 'fs_tree',
  description: 'Generate a tree view of a directory structure',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to generate tree for',
      },
      maxDepth: {
        type: 'number',
        description: 'Maximum depth to traverse (default: unlimited)',
      },
      showHidden: {
        type: 'boolean',
        description: 'Include hidden files starting with . (default: false)',
      },
      showSize: {
        type: 'boolean',
        description: 'Show file sizes (default: false)',
      },
      exclude: {
        type: 'array',
        description: 'Patterns to exclude (e.g., ["node_modules", "dist"])',
      },
      include: {
        type: 'array',
        description: 'Patterns to include for files (e.g., ["*.ts"])',
      },
      format: {
        type: 'string',
        enum: ['ascii', 'json'],
        description: 'Output format (default: ascii)',
      },
      dirsFirst: {
        type: 'boolean',
        description: 'Sort directories before files (default: false)',
      },
    },
    required: ['path'],
  },
} as const
