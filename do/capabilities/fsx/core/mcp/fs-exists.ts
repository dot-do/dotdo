/**
 * fs_exists MCP Tool - File/Directory Existence Checking
 *
 * Provides a simple existence check for files, directories, and symlinks
 * via the Model Context Protocol (MCP).
 *
 * ## Features
 *
 * - Check if files, directories, or symlinks exist
 * - Optional type filtering (file, directory, symlink, any)
 * - Symlink handling: follows symlinks by default, can check symlink itself
 * - Path traversal protection
 * - Returns type information along with existence status
 *
 * ## Design Notes
 *
 * This module reuses shared path validation and symlink resolution logic
 * from fs-stat to ensure consistent behavior across MCP tools.
 *
 * @module core/mcp/fs-exists
 */

import type { McpToolResult } from './shared'
import { isPathTraversal, resolveSymlinkChain, type StatStorageBackend } from './fs-stat'

// =============================================================================
// Types
// =============================================================================

/**
 * Result returned by fs_exists.
 *
 * Contains a boolean indicating existence and optionally the type of entry.
 */
export interface ExistsResult {
  /** Whether the path exists */
  exists: boolean
  /** Type of entry if it exists: 'file', 'directory', 'symlink', or null if not exists */
  type: 'file' | 'directory' | 'symlink' | null
}

/**
 * Options for fs_exists tool.
 */
export interface FsExistsOptions {
  /** Path to check for existence */
  path: string
  /** Filter by type: 'file', 'directory', 'symlink', or 'any' (default) */
  type?: 'file' | 'directory' | 'symlink' | 'any'
  /** Whether to follow symlinks (default: true) */
  followSymlinks?: boolean
}

// =============================================================================
// Storage Backend Interface
// =============================================================================

/**
 * Storage backend interface for exists operations.
 *
 * Uses the same interface as fs-stat for consistency.
 */
export type ExistsStorageBackend = StatStorageBackend

// =============================================================================
// MCP Tool Implementation
// =============================================================================

/**
 * Invoke the fs_exists MCP tool.
 *
 * Checks if a file, directory, or symlink exists at the given path.
 *
 * @param params - MCP tool parameters (path required, type and followSymlinks optional)
 * @param storage - Storage backend to query
 * @returns MCP tool result with JSON existence info or error
 *
 * @example
 * ```typescript
 * const result = await invokeFsExists({ path: '/home/user/file.txt' }, storage)
 * if (!result.isError) {
 *   const parsed = JSON.parse(result.content[0].text)
 *   if (parsed.exists) {
 *     console.log(`File exists and is a ${parsed.type}`)
 *   }
 * }
 * ```
 */
export async function invokeFsExists(
  params: Record<string, unknown>,
  storage: ExistsStorageBackend
): Promise<McpToolResult> {
  // Validate path parameter
  const path = params.path

  // Check path is provided
  if (path === undefined || path === null) {
    return {
      content: [{ type: 'text', text: 'path is required' }],
      isError: true,
    }
  }

  // Check path is a string
  if (typeof path !== 'string') {
    return {
      content: [{ type: 'text', text: 'path must be a string type' }],
      isError: true,
    }
  }

  // Check path is not empty
  if (path === '') {
    return {
      content: [{ type: 'text', text: 'path cannot be empty' }],
      isError: true,
    }
  }

  // Check for path traversal attacks
  if (isPathTraversal(path)) {
    return {
      content: [{ type: 'text', text: `EACCES: permission denied, path traversal detected: ${path}` }],
      isError: true,
    }
  }

  // Parse optional parameters
  const typeFilter = params.type as 'file' | 'directory' | 'symlink' | 'any' | undefined
  const followSymlinks = params.followSymlinks !== false // Default to true

  // Normalize the path
  const normalizedPath = storage.normalizePath(path)

  // Get the entry without following symlinks first
  const rawEntry = storage.get(normalizedPath)

  // If path doesn't exist at all
  if (!rawEntry) {
    const result: ExistsResult = {
      exists: false,
      type: null,
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: false,
    }
  }

  // If the entry is a symlink and we should follow it
  if (rawEntry.type === 'symlink' && followSymlinks) {
    // Try to resolve the symlink chain
    const resolved = resolveSymlinkChain(normalizedPath, storage)

    // If symlink resolution failed (broken or circular), it doesn't exist
    if (resolved.error || !resolved.entry) {
      const result: ExistsResult = {
        exists: false,
        type: null,
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: false,
      }
    }

    // Entry exists - check if it matches the type filter
    // Note: We report the entry as 'symlink' type since that's what we queried
    const entryType: 'file' | 'directory' | 'symlink' = 'symlink'
    const exists = matchesTypeFilter(entryType, typeFilter)

    const result: ExistsResult = {
      exists,
      type: exists ? entryType : null,
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: false,
    }
  }

  // Entry exists (not a symlink, or not following symlinks)
  const entryType = rawEntry.type
  const exists = matchesTypeFilter(entryType, typeFilter)

  const result: ExistsResult = {
    exists,
    type: exists ? entryType : null,
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    isError: false,
  }
}

/**
 * Check if an entry type matches the type filter.
 *
 * @param entryType - Actual type of the entry
 * @param filter - Type filter ('file', 'directory', 'symlink', 'any', or undefined)
 * @returns True if the entry matches the filter
 */
function matchesTypeFilter(
  entryType: 'file' | 'directory' | 'symlink',
  filter: 'file' | 'directory' | 'symlink' | 'any' | undefined
): boolean {
  // No filter or 'any' matches everything
  if (filter === undefined || filter === 'any') {
    return true
  }
  // Otherwise, must match exactly
  return entryType === filter
}

// =============================================================================
// MCP Tool Schema
// =============================================================================

/**
 * MCP tool schema definition for fs_exists.
 */
export const fsExistsToolSchema = {
  name: 'fs_exists',
  description: 'Check if a file or directory exists',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Path to check for existence',
      },
      type: {
        type: 'string',
        description: 'Type filter: file, directory, symlink, or any',
        enum: ['file', 'directory', 'symlink', 'any'],
      },
      followSymlinks: {
        type: 'boolean',
        description: 'Whether to follow symlinks (default: true)',
      },
    },
    required: ['path'],
  },
} as const
