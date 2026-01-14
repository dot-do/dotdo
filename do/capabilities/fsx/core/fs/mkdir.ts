/**
 * mkdir operation - Create directories in the virtual filesystem
 *
 * This module provides POSIX-compliant directory creation with support for:
 * - Recursive directory creation (mkdir -p behavior)
 * - Custom permission modes (numeric or octal string)
 * - Proper error handling with standard POSIX error codes
 *
 * ## Usage
 *
 * ```typescript
 * import { mkdir } from './mkdir'
 *
 * // Basic directory creation
 * await mkdir(ctx, '/home/user/projects')
 *
 * // Recursive creation (mkdir -p)
 * await mkdir(ctx, '/home/user/a/b/c', { recursive: true })
 *
 * // Custom permissions
 * await mkdir(ctx, '/home/user/private', { mode: 0o700 })
 * ```
 *
 * ## Error Codes
 *
 * | Code | Description |
 * |------|-------------|
 * | EEXIST | Path already exists (non-recursive mode) |
 * | ENOENT | Parent directory does not exist (non-recursive mode) |
 * | ENOTDIR | A path component is a file, not a directory |
 * | EINVAL | Path is empty or invalid |
 *
 * @module fs/mkdir
 */

import { ENOENT, EEXIST, ENOTDIR, EINVAL } from '../errors'
import { normalize, dirname } from '../path'

// =============================================================================
// Types & Interfaces
// =============================================================================

/**
 * Options for mkdir operation.
 *
 * Mirrors the Node.js fs.mkdir options for compatibility with existing code.
 *
 * @example
 * ```typescript
 * // Create directory with default options
 * await mkdir(ctx, '/home/user/newdir')
 *
 * // Create nested directories recursively
 * await mkdir(ctx, '/home/user/a/b/c', { recursive: true })
 *
 * // Create with specific permissions
 * await mkdir(ctx, '/home/user/restricted', { mode: 0o700 })
 * ```
 */
export interface MkdirOptions {
  /**
   * File mode (permission bits) for the new directory.
   *
   * Can be specified as:
   * - A number in octal notation (e.g., 0o755, 0o700)
   * - A string representing octal (e.g., '0755', '755')
   *
   * Common modes:
   * - 0o755: rwxr-xr-x (owner full, others read/execute)
   * - 0o700: rwx------ (owner only)
   * - 0o777: rwxrwxrwx (full permissions for all)
   *
   * @default 0o777
   */
  mode?: number | string

  /**
   * Create parent directories as needed (like `mkdir -p`).
   *
   * When `true`:
   * - Creates all missing parent directories
   * - Does not throw EEXIST if directory already exists
   * - Returns the path of the first created directory, or undefined if none created
   *
   * When `false` (default):
   * - Only creates the final directory
   * - Throws ENOENT if parent doesn't exist
   * - Throws EEXIST if directory already exists
   *
   * @default false
   */
  recursive?: boolean
}

/**
 * Filesystem context interface for mkdir operations.
 *
 * The context provides access to the filesystem's entry map,
 * which tracks all files and directories. This abstraction allows
 * mkdir to work with different storage backends.
 */
export interface MkdirContext {
  /**
   * Map of path -> entry metadata for all filesystem entries.
   *
   * Each entry contains:
   * - `type`: Either 'file' or 'directory'
   * - `mode`: Permission bits (e.g., 0o755)
   */
  entries: Map<string, { type: 'file' | 'directory'; mode: number }>
}

/**
 * Entry metadata stored in the filesystem context.
 * @internal
 */
interface EntryMetadata {
  /** Entry type - 'file' or 'directory' */
  type: 'file' | 'directory'
  /** Permission bits */
  mode: number
}

// =============================================================================
// Mode Parsing Utilities
// =============================================================================

/** Default directory mode if none specified */
const DEFAULT_DIR_MODE = 0o777

/**
 * Parse mode from number or string to numeric value.
 *
 * Handles various mode formats for maximum compatibility:
 * - Numeric octal: 0o755, 0o700, 0o777
 * - Numeric decimal: 493 (equals 0o755)
 * - String octal: '0755', '755', '0o755'
 *
 * @param mode - The mode value to parse
 * @param defaultMode - Default value if mode is undefined
 * @returns Numeric permission bits
 *
 * @example
 * ```typescript
 * parseMode(0o755)       // 493 (0o755)
 * parseMode('0755')      // 493 (0o755)
 * parseMode('755')       // 493 (0o755)
 * parseMode(undefined)   // 511 (0o777)
 * ```
 *
 * @internal
 */
export function parseMode(mode: number | string | undefined, defaultMode: number = DEFAULT_DIR_MODE): number {
  if (mode === undefined) {
    return defaultMode
  }
  if (typeof mode === 'number') {
    return mode
  }
  // Parse octal string like '0755', '755', or '0o755'
  const normalized = mode.replace(/^0o/, '')
  return parseInt(normalized, 8)
}

// =============================================================================
// Path Ancestry Utilities
// =============================================================================

/**
 * Get all ancestor paths from the given path up to (but not including) root.
 *
 * Returns paths in order from root towards the target path.
 * This is used to check for ENOTDIR errors when a file exists
 * in the path hierarchy.
 *
 * @param normalizedPath - A normalized absolute path
 * @returns Array of ancestor paths, ordered from root to parent
 *
 * @example
 * ```typescript
 * getAncestors('/home/user/docs')
 * // Returns: ['/', '/home', '/home/user']
 *
 * getAncestors('/file.txt')
 * // Returns: ['/']
 *
 * getAncestors('/')
 * // Returns: []
 * ```
 *
 * @internal
 */
export function getAncestors(normalizedPath: string): string[] {
  const ancestors: string[] = []
  let current = normalizedPath

  // Walk up the tree collecting ancestors
  while (true) {
    const parent = dirname(current)

    // Stop if we've reached root or can't go higher
    if (parent === current) {
      break
    }

    // Add parent to front (we want root-first order)
    ancestors.unshift(parent)
    current = parent
  }

  return ancestors
}

/**
 * Get all paths that need to be created for recursive mkdir.
 *
 * Efficiently computes the list of directories that don't exist yet
 * by iterating through path segments only once. This is more efficient
 * than checking each parent separately.
 *
 * @param normalizedPath - Target path (normalized)
 * @param entries - Current filesystem entries
 * @returns Array of paths to create, ordered from root to target
 *
 * @example
 * ```typescript
 * // Given entries has '/home' and '/home/user'
 * getPathsToCreate('/home/user/a/b/c', entries)
 * // Returns: ['/home/user/a', '/home/user/a/b', '/home/user/a/b/c']
 *
 * // All paths exist
 * getPathsToCreate('/home/user', entries)
 * // Returns: []
 * ```
 *
 * @internal
 */
export function getPathsToCreate(
  normalizedPath: string,
  entries: Map<string, EntryMetadata>
): string[] {
  const paths: string[] = []

  // Split path into segments, filtering empty strings from leading/trailing slashes
  const segments = normalizedPath.split('/').filter(s => s !== '')

  // Build paths incrementally from root
  let current = ''
  for (const segment of segments) {
    current = current + '/' + segment

    // Only add paths that don't already exist
    if (!entries.has(current)) {
      paths.push(current)
    }
  }

  return paths
}

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Validate that a path is non-empty and not just whitespace.
 *
 * @param path - The path to validate
 * @throws {EINVAL} If path is empty or whitespace-only
 * @internal
 */
function validatePath(path: string): void {
  if (!path || path.trim() === '') {
    throw new EINVAL('mkdir', path)
  }
}

/**
 * Check if any ancestor path is a file (not a directory).
 *
 * This would cause an ENOTDIR error since you cannot create
 * directories inside files.
 *
 * @param normalizedPath - The normalized target path
 * @param entries - The filesystem entries map
 * @throws {ENOTDIR} If any ancestor is a file
 * @internal
 */
function validateAncestorsAreDirectories(
  normalizedPath: string,
  entries: Map<string, EntryMetadata>
): void {
  const ancestors = getAncestors(normalizedPath)
  for (const ancestor of ancestors) {
    const entry = entries.get(ancestor)
    if (entry && entry.type === 'file') {
      throw new ENOTDIR('mkdir', ancestor)
    }
  }
}

// =============================================================================
// Directory Creation - Recursive Mode
// =============================================================================

/**
 * Create directories recursively (mkdir -p behavior).
 *
 * Creates all missing parent directories and the target directory.
 * Does not throw if the directory already exists.
 *
 * @param normalizedPath - Target path (already normalized)
 * @param entries - Filesystem entries map
 * @param mode - Permission mode for new directories
 * @returns First created directory path, or undefined if none created
 * @internal
 */
function createDirectoryRecursive(
  normalizedPath: string,
  entries: Map<string, EntryMetadata>,
  mode: number
): string | undefined {
  const pathsToCreate = getPathsToCreate(normalizedPath, entries)

  if (pathsToCreate.length === 0) {
    // All directories already exist
    return undefined
  }

  // Create each directory with the specified mode
  for (const p of pathsToCreate) {
    entries.set(p, { type: 'directory', mode })
  }

  // Return the first created path (matches Node.js behavior)
  return pathsToCreate[0]
}

// =============================================================================
// Directory Creation - Non-Recursive Mode
// =============================================================================

/**
 * Create a single directory (non-recursive mode).
 *
 * Parent directory must exist and be a directory.
 *
 * @param normalizedPath - Target path (already normalized)
 * @param entries - Filesystem entries map
 * @param mode - Permission mode for the new directory
 * @throws {ENOENT} If parent directory does not exist
 * @throws {ENOTDIR} If parent exists but is not a directory
 * @internal
 */
function createDirectorySingle(
  normalizedPath: string,
  entries: Map<string, EntryMetadata>,
  mode: number
): void {
  const parent = dirname(normalizedPath)
  const parentEntry = entries.get(parent)

  if (!parentEntry) {
    throw new ENOENT('mkdir', normalizedPath)
  }

  if (parentEntry.type !== 'directory') {
    throw new ENOTDIR('mkdir', parent)
  }

  // Create the directory
  entries.set(normalizedPath, { type: 'directory', mode })
}

// =============================================================================
// Main mkdir Function
// =============================================================================

/**
 * Create a directory in the virtual filesystem.
 *
 * Implements POSIX-compliant mkdir with support for recursive creation
 * and custom permission modes. Behavior matches Node.js fs.mkdir.
 *
 * ## Basic Usage
 *
 * ```typescript
 * // Create a single directory (parent must exist)
 * await mkdir(ctx, '/home/user/newdir')
 *
 * // Create nested directories (mkdir -p)
 * await mkdir(ctx, '/home/user/a/b/c', { recursive: true })
 *
 * // Create with specific permissions
 * await mkdir(ctx, '/home/user/private', { mode: 0o700 })
 * ```
 *
 * ## Return Value
 *
 * - **Non-recursive mode**: Returns `undefined` on success
 * - **Recursive mode**: Returns the first created directory path,
 *   or `undefined` if no directories were created (path already exists)
 *
 * ## Error Handling
 *
 * | Error | Condition |
 * |-------|-----------|
 * | EEXIST | Path already exists (non-recursive only) |
 * | ENOENT | Parent doesn't exist (non-recursive only) |
 * | ENOTDIR | A path component is a file, not a directory |
 * | EINVAL | Path is empty or invalid |
 *
 * @param ctx - Filesystem context with entries map
 * @param path - Directory path to create (will be normalized)
 * @param options - Optional configuration (mode, recursive)
 * @returns First created path for recursive mode, undefined otherwise
 *
 * @throws {EEXIST} If path already exists and recursive is false
 * @throws {ENOENT} If parent doesn't exist and recursive is false
 * @throws {ENOTDIR} If a path component is a file, not a directory
 * @throws {EINVAL} If path is empty or invalid
 */
export async function mkdir(
  ctx: MkdirContext,
  path: string,
  options?: MkdirOptions
): Promise<string | undefined> {
  // -------------------------------------------------------------------------
  // Step 1: Validate input
  // -------------------------------------------------------------------------
  validatePath(path)

  // -------------------------------------------------------------------------
  // Step 2: Normalize path and extract options
  // -------------------------------------------------------------------------
  const normalizedPath = normalize(path)
  const recursive = options?.recursive ?? false
  const mode = parseMode(options?.mode)

  // -------------------------------------------------------------------------
  // Step 3: Check if target already exists
  // -------------------------------------------------------------------------
  const existing = ctx.entries.get(normalizedPath)
  if (existing) {
    if (recursive) {
      // Recursive mode: silently succeed if directory exists
      // This matches POSIX mkdir -p behavior
      return undefined
    }
    // Non-recursive mode: throw EEXIST
    throw new EEXIST('mkdir', normalizedPath)
  }

  // -------------------------------------------------------------------------
  // Step 4: Validate ancestors are not files
  // -------------------------------------------------------------------------
  validateAncestorsAreDirectories(normalizedPath, ctx.entries)

  // -------------------------------------------------------------------------
  // Step 5: Create directory (recursive or single)
  // -------------------------------------------------------------------------
  if (recursive) {
    return createDirectoryRecursive(normalizedPath, ctx.entries, mode)
  } else {
    createDirectorySingle(normalizedPath, ctx.entries, mode)
    return undefined
  }
}
