/**
 * fs_mkdir MCP Tool - Directory Creation
 *
 * Provides directory creation functionality for AI-assisted file operations
 * via the Model Context Protocol (MCP).
 *
 * ## Features
 *
 * - Create single directories
 * - Recursive directory creation (create parent directories as needed)
 * - Custom permission modes
 * - Symlink resolution for parent path traversal
 * - Path normalization and validation
 * - Path traversal attack protection
 *
 * @module core/mcp/fs-mkdir
 */

import { constants } from '../constants'
import type { McpToolResult, StorageBackend } from './fs-search'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the fs_mkdir tool.
 */
export interface FsMkdirOptions {
  /**
   * Directory path to create.
   */
  path: string

  /**
   * Whether to create parent directories if they don't exist.
   * @default false
   */
  recursive?: boolean

  /**
   * Permission mode for the created directory.
   * @default 0o755
   */
  mode?: number
}

/**
 * Extended storage backend interface with additional methods for mkdir.
 */
interface MkdirStorageBackend extends StorageBackend {
  /** Add a directory to storage */
  addDirectory(path: string, options?: { mode?: number }): void
  /** Add a file to storage */
  addFile?(path: string, content: Uint8Array | string, options?: { mode?: number }): void
  /** Get parent path */
  getParentPath?(path: string): string
  /** Normalize a path */
  normalizePath?(path: string): string
  /** Check if parent directory exists */
  parentExists?(path: string): boolean
}

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * Normalize a filesystem path.
 * Removes trailing slashes (except for root), collapses multiple slashes,
 * and resolves . and .. components.
 */
function normalizePath(path: string): string {
  if (path === '' || path === '/') return '/'

  // Handle relative paths - they're invalid for our purposes
  if (!path.startsWith('/')) {
    // Just prefix with / for now, validation will catch relative traversal
    path = '/' + path
  }

  // Collapse multiple slashes
  let p = path.replace(/\/+/g, '/')

  // Remove trailing slashes
  if (p.endsWith('/') && p !== '/') {
    p = p.slice(0, -1)
  }

  // Resolve . and ..
  const segments = p.split('/').filter((s) => s !== '')
  const result: string[] = []

  for (const segment of segments) {
    if (segment === '.') {
      continue
    } else if (segment === '..') {
      result.pop()
    } else {
      result.push(segment)
    }
  }

  return '/' + result.join('/')
}

/**
 * Get the parent path of a given path.
 */
function getParentPath(path: string): string {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return normalized.substring(0, lastSlash)
}

/**
 * Check if path contains traversal patterns that would escape root.
 */
function isPathTraversal(path: string): boolean {
  // Check for explicit traversal patterns
  if (path.startsWith('/..') || path.startsWith('../')) {
    return true
  }

  // Count depth to check for escape attempts
  const segments = path.split('/').filter((s) => s !== '')
  let depth = 0
  for (const seg of segments) {
    if (seg === '..') {
      depth--
      if (depth < 0) return true
    } else if (seg !== '.') {
      depth++
    }
  }
  return depth < 0
}

// =============================================================================
// Symlink Resolution
// =============================================================================

/**
 * Resolve symlinks in a path to get the real path.
 */
function resolveSymlinksInPath(storage: MkdirStorageBackend, path: string): { resolved: string; error?: McpToolResult } {
  const normalized = normalizePath(path)
  const segments = normalized.split('/').filter((s) => s !== '')
  let currentPath = ''

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const nextPath = currentPath + '/' + segment
    const entry = storage.get(nextPath)

    if (!entry) {
      // Path doesn't exist yet - return partially resolved path
      return { resolved: currentPath + '/' + segments.slice(i).join('/') }
    }

    if (entry.type === 'symlink') {
      // Get symlink target
      const rawEntry = entry as { linkTarget?: string }
      const target = rawEntry.linkTarget

      if (!target) {
        return { resolved: nextPath }
      }

      // Resolve the target
      let resolvedTarget: string
      if (target.startsWith('/')) {
        resolvedTarget = target
      } else {
        resolvedTarget = normalizePath(currentPath + '/' + target)
      }

      // Check if target exists
      const targetEntry = storage.get(resolvedTarget)
      if (!targetEntry) {
        return {
          resolved: nextPath,
          error: {
            content: [{ type: 'text', text: `ENOENT: no such file or directory '${path}'` }],
            isError: true,
          }
        }
      }

      // Continue from resolved target
      currentPath = resolvedTarget
    } else if (entry.type === 'file') {
      // Can't traverse through a file
      return {
        resolved: nextPath,
        error: {
          content: [{ type: 'text', text: `ENOTDIR: not a directory '${nextPath}'` }],
          isError: true,
        }
      }
    } else {
      currentPath = nextPath
    }
  }

  return { resolved: currentPath }
}

// =============================================================================
// Input Validation
// =============================================================================

/**
 * Validate fs_mkdir parameters.
 */
function validateParams(
  params: Record<string, unknown>
): { error: McpToolResult } | { valid: true; path: string; recursive: boolean; mode: number } {
  const path = params.path
  const recursive = params.recursive
  const mode = params.mode

  // Check path is provided
  if (path === undefined || path === null) {
    return {
      error: {
        content: [{ type: 'text', text: 'Error: path is required' }],
        isError: true,
      }
    }
  }

  // Check path is a string
  if (typeof path !== 'string') {
    return {
      error: {
        content: [{ type: 'text', text: 'Error: path must be a string - invalid type' }],
        isError: true,
      }
    }
  }

  // Check path is not empty
  if (path.trim() === '') {
    return {
      error: {
        content: [{ type: 'text', text: 'Error: path cannot be empty' }],
        isError: true,
      }
    }
  }

  // Check for path traversal
  if (isPathTraversal(path)) {
    return {
      error: {
        content: [{ type: 'text', text: `EACCES: permission denied - path traversal detected '${path}'` }],
        isError: true,
      }
    }
  }

  // Validate mode if provided - use default if invalid type
  let finalMode = 0o755
  if (mode !== undefined && mode !== null) {
    if (typeof mode === 'number' && !isNaN(mode)) {
      finalMode = mode & 0o777
    }
    // If mode is invalid type (like string), just use default
  }

  // Validate recursive - coerce to boolean
  const finalRecursive = recursive === false ? false : Boolean(recursive)

  return {
    valid: true,
    path: path as string,
    recursive: finalRecursive,
    mode: finalMode,
  }
}

// =============================================================================
// Directory Creation
// =============================================================================

/**
 * Create a single directory (non-recursive).
 */
function createSingleDirectory(
  storage: MkdirStorageBackend,
  path: string,
  mode: number
): McpToolResult | null {
  const normalized = normalizePath(path)

  // Check if path already exists
  if (storage.has(normalized)) {
    const entry = storage.get(normalized)
    if (entry?.type === 'file') {
      return {
        content: [{ type: 'text', text: `EEXIST: file already exists '${normalized}'` }],
        isError: true,
      }
    }
    return {
      content: [{ type: 'text', text: `EEXIST: directory already exists '${normalized}'` }],
      isError: true,
    }
  }

  // Check parent exists and resolve symlinks
  const parentPath = getParentPath(normalized)
  const dirName = normalized.split('/').pop()!

  // Resolve symlinks in parent path
  const { resolved: resolvedParent, error: symlinkError } = resolveSymlinksInPath(storage, parentPath)
  if (symlinkError) {
    return symlinkError
  }

  // Check if parent exists
  if (parentPath !== '/' && !storage.has(resolvedParent)) {
    return {
      content: [{ type: 'text', text: `ENOENT: no such file or directory '${parentPath}'` }],
      isError: true,
    }
  }

  // Check parent is a directory
  if (parentPath !== '/') {
    const parentEntry = storage.get(resolvedParent)
    if (parentEntry?.type === 'file') {
      return {
        content: [{ type: 'text', text: `ENOTDIR: not a directory '${parentPath}'` }],
        isError: true,
      }
    }
  }

  // Create the directory at the resolved location
  // If parent had symlinks, the resolved path includes the symlink target
  const resolvedPath = resolvedParent === '/' ? `/${dirName}` : `${resolvedParent}/${dirName}`
  storage.addDirectory(resolvedPath, { mode })

  return null // Success
}

/**
 * Create directories recursively.
 */
function createRecursiveDirectories(
  storage: MkdirStorageBackend,
  path: string,
  mode: number
): McpToolResult | null {
  const normalized = normalizePath(path)

  // Check if target already exists
  if (storage.has(normalized)) {
    const entry = storage.get(normalized)
    if (entry?.type === 'file') {
      return {
        content: [{ type: 'text', text: `EEXIST: file already exists '${normalized}'` }],
        isError: true,
      }
    }
    // Directory already exists - success in recursive mode
    return null
  }

  // Build list of directories to create
  const segments = normalized.split('/').filter((s) => s !== '')
  let currentPath = ''
  const toCreate: string[] = []

  for (const segment of segments) {
    currentPath += '/' + segment

    if (!storage.has(currentPath)) {
      toCreate.push(currentPath)
    } else {
      const entry = storage.get(currentPath)
      if (entry?.type === 'file') {
        return {
          content: [{ type: 'text', text: `ENOTDIR: not a directory '${currentPath}'` }],
          isError: true,
        }
      }
      // If it's a symlink, resolve it
      if (entry?.type === 'symlink') {
        const rawEntry = entry as { linkTarget?: string }
        const target = rawEntry.linkTarget

        if (target) {
          const resolvedTarget = target.startsWith('/')
            ? target
            : normalizePath(getParentPath(currentPath) + '/' + target)

          const targetEntry = storage.get(resolvedTarget)
          if (!targetEntry) {
            return {
              content: [{ type: 'text', text: `ENOENT: no such file or directory '${currentPath}'` }],
              isError: true,
            }
          }
          if (targetEntry.type === 'file') {
            return {
              content: [{ type: 'text', text: `ENOTDIR: not a directory '${currentPath}'` }],
              isError: true,
            }
          }
        }
      }
    }
  }

  // Create all missing directories
  for (const dirPath of toCreate) {
    storage.addDirectory(dirPath, { mode })
  }

  return null // Success
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Invoke the fs_mkdir MCP tool.
 *
 * Creates a directory with support for recursive creation and custom permissions.
 *
 * @param params - MCP tool parameters
 * @param storage - Storage backend to create directory in
 * @returns MCP tool result with success message or error
 */
export async function invokeFsMkdir(
  params: Record<string, unknown>,
  storage: MkdirStorageBackend
): Promise<McpToolResult> {
  // Validate parameters
  const validationResult = validateParams(params)
  if ('error' in validationResult) {
    return validationResult.error
  }

  const { path, recursive, mode } = validationResult
  const normalized = normalizePath(path)

  // Create directory (recursive or single)
  let error: McpToolResult | null
  if (recursive) {
    error = createRecursiveDirectories(storage, normalized, mode)
  } else {
    error = createSingleDirectory(storage, normalized, mode)
  }

  if (error) {
    return error
  }

  // Return success response
  return {
    content: [{ type: 'text', text: `Successfully created directory '${normalized}'` }],
    isError: false,
  }
}

// =============================================================================
// MCP Tool Schema
// =============================================================================

/**
 * MCP tool schema definition for fs_mkdir.
 */
export const fsMkdirToolSchema = {
  name: 'fs_mkdir',
  description: 'Create a directory',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to create',
      },
      recursive: {
        type: 'boolean',
        description: 'Create parent directories if needed',
      },
      mode: {
        type: 'number',
        description: 'Permission mode (e.g., 0755)',
      },
    },
    required: ['path'],
  },
} as const
