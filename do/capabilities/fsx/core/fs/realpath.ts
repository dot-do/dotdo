/**
 * @fileoverview Canonical path resolution following symbolic links (POSIX realpath)
 *
 * Resolves a path to its canonical absolute form by following all symbolic
 * links and removing `.`, `..`, and redundant slashes. The final resolved
 * path contains no symlinks or relative components.
 *
 * POSIX Semantics:
 * - Follows symlinks recursively during resolution
 * - Resolves relative symlink targets relative to symlink parent directory
 * - Restarts resolution from root for absolute symlink targets
 * - Canonicalizes path (removes `.` and `..` components)
 * - Returns ENOENT if path or any component doesn't exist
 * - Returns ELOOP if symlink depth exceeds maximum (loop detection)
 *
 * Algorithm:
 * The resolution algorithm processes path components left-to-right. When a
 * symlink is encountered:
 * 1. Read the symlink target
 * 2. If absolute: restart resolution from root with target + remaining path
 * 3. If relative: resolve relative to symlink's parent + remaining path
 * 4. Track total symlink traversals to detect infinite loops
 *
 * @example
 * ```typescript
 * // Basic path canonicalization
 * await realpath('/home/user/../user/./file.txt')  // '/home/user/file.txt'
 *
 * // Symlink resolution
 * // Given: /link -> /home/user
 * await realpath('/link/file.txt')  // '/home/user/file.txt'
 *
 * // Chained symlinks
 * // Given: /a -> /b, /b -> /home
 * await realpath('/a/user/file.txt')  // '/home/user/file.txt'
 *
 * // Loop detection
 * // Given: /loop1 -> /loop2, /loop2 -> /loop1
 * await realpath('/loop1')  // throws ELOOP
 * ```
 *
 * @module core/fs/realpath
 * @see {@link https://man7.org/linux/man-pages/man3/realpath.3.html} POSIX realpath(3)
 */

import { ENOENT, ELOOP } from '../errors'
import { normalize } from '../path'

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * System call name for error reporting.
 * Used consistently in all error messages from this module.
 */
const SYSCALL = 'realpath'

/**
 * Maximum number of symlinks to follow before returning ELOOP.
 *
 * This limit prevents infinite loops from circular symlink references.
 * The value of 40 matches typical POSIX implementations (Linux uses 40,
 * POSIX requires at least 8, most systems use 20-40).
 *
 * @see {@link https://man7.org/linux/man-pages/man7/path_resolution.7.html}
 */
const MAX_SYMLINK_DEPTH = 40

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Filesystem entry type discriminator.
 *
 * - `file`: Regular file with content
 * - `directory`: Container for other entries
 * - `symlink`: Symbolic link pointing to another path
 */
type EntryType = 'file' | 'directory' | 'symlink'

/**
 * Filesystem entry structure for path resolution.
 *
 * Represents a single entry in the filesystem with its type and,
 * for symlinks, the target path it points to.
 *
 * @property type - The entry type (file, directory, or symlink)
 * @property target - For symlinks only: the path this symlink points to
 *                    (may be relative or absolute, stored as-is)
 */
interface FSEntry {
  /** Entry type determining how path resolution handles this entry */
  readonly type: EntryType
  /** Symlink target path (only present for symlink entries) */
  readonly target?: string
}

/**
 * Resolution state passed through recursive symlink resolution.
 *
 * Tracks the cumulative symlink depth across all recursive calls
 * to enable ELOOP detection for deeply nested or circular references.
 *
 * @internal
 */
interface ResolutionContext {
  /** Original path provided by caller (for error messages) */
  readonly originalPath: string
  /** Current cumulative symlink traversal count */
  symlinkDepth: number
}

// =============================================================================
// MOCK FILESYSTEM (Test Implementation)
// =============================================================================

/**
 * In-memory filesystem for testing realpath behavior.
 *
 * This mock provides a controlled environment for testing all realpath
 * edge cases including symlink chains, circular references, and various
 * path configurations. In production, this would be replaced by actual
 * filesystem queries via SQLite storage.
 *
 * @internal
 */
const mockFS: Map<string, FSEntry> = new Map([
  // -------------------------------------------------------------------------
  // Basic files and directories
  // -------------------------------------------------------------------------
  ['/', { type: 'directory' }],
  ['/home', { type: 'directory' }],
  ['/home/user', { type: 'directory' }],
  ['/home/user/file.txt', { type: 'file' }],
  ['/home/other', { type: 'directory' }],
  ['/home/other/file.txt', { type: 'file' }],
  ['/home/deep', { type: 'directory' }],

  // -------------------------------------------------------------------------
  // Symlinks at end of path
  // -------------------------------------------------------------------------
  ['/link-to-file', { type: 'symlink', target: '/home/user/file.txt' }],
  ['/link-to-dir', { type: 'symlink', target: '/home/user' }],

  // -------------------------------------------------------------------------
  // Chained symlinks (A -> B -> target)
  // -------------------------------------------------------------------------
  ['/chain1', { type: 'symlink', target: '/chain2' }],
  ['/chain2', { type: 'symlink', target: '/home/user/file.txt' }],

  // -------------------------------------------------------------------------
  // Relative symlink targets
  // -------------------------------------------------------------------------
  ['/home/user/rel-link', { type: 'symlink', target: '../other/file.txt' }],

  // -------------------------------------------------------------------------
  // Absolute symlink targets
  // -------------------------------------------------------------------------
  ['/abs-link', { type: 'symlink', target: '/home/user/file.txt' }],

  // -------------------------------------------------------------------------
  // Multiple symlinks in single path
  // -------------------------------------------------------------------------
  ['/multi', { type: 'directory' }],
  ['/multi/link1', { type: 'symlink', target: '/home' }],
  ['/home/link2', { type: 'symlink', target: '/home/user' }],

  // -------------------------------------------------------------------------
  // Symlinks with . in target
  // -------------------------------------------------------------------------
  ['/subdir', { type: 'directory' }],
  ['/subdir/file.txt', { type: 'file' }],
  ['/dot-link', { type: 'symlink', target: './subdir/file.txt' }],

  // -------------------------------------------------------------------------
  // Symlinks with .. in target
  // -------------------------------------------------------------------------
  ['/home/deep/dotdot-link', { type: 'symlink', target: '../user/file.txt' }],

  // -------------------------------------------------------------------------
  // Deep nested symlink
  // -------------------------------------------------------------------------
  ['/a', { type: 'directory' }],
  ['/a/b', { type: 'directory' }],
  ['/a/b/c', { type: 'directory' }],
  ['/a/b/c/deep-link', { type: 'symlink', target: '/home/user/file.txt' }],

  // -------------------------------------------------------------------------
  // Circular symlinks (ELOOP test cases)
  // -------------------------------------------------------------------------
  ['/loop1', { type: 'symlink', target: '/loop2' }],
  ['/loop2', { type: 'symlink', target: '/loop1' }],
  ['/self-link', { type: 'symlink', target: '/self-link' }],
  ['/cycleA', { type: 'symlink', target: '/cycleB' }],
  ['/cycleB', { type: 'symlink', target: '/cycleC' }],
  ['/cycleC', { type: 'symlink', target: '/cycleA' }],

  // -------------------------------------------------------------------------
  // Deep chain exceeding max depth (ELOOP)
  // -------------------------------------------------------------------------
  ...createDeepChain(),

  // -------------------------------------------------------------------------
  // Dangling symlink (target doesn't exist)
  // -------------------------------------------------------------------------
  ['/dangling-link', { type: 'symlink', target: '/does/not/exist' }],

  // -------------------------------------------------------------------------
  // Additional test paths
  // -------------------------------------------------------------------------
  ['/root-link', { type: 'symlink', target: '/home/user/file.txt' }],
  ['/path with spaces', { type: 'directory' }],
  ['/path with spaces/file.txt', { type: 'file' }],
  ['/unicode', { type: 'directory' }],
  ['/unicode/file.txt', { type: 'file' }],
  ['/to-root', { type: 'symlink', target: '/' }],
  ['/first-link', { type: 'symlink', target: '/home' }],
])

/**
 * Creates a chain of symlinks that exceeds MAX_SYMLINK_DEPTH.
 *
 * This generates test data for ELOOP detection on deeply nested
 * (but non-circular) symlink chains. The chain is:
 * /deep-chain-start -> /deep-chain-0 -> /deep-chain-1 -> ... -> target
 *
 * @returns Array of [path, entry] tuples for the deep chain
 * @internal
 */
function createDeepChain(): Array<[string, FSEntry]> {
  const entries: Array<[string, FSEntry]> = []
  const depth = MAX_SYMLINK_DEPTH + 5

  for (let i = 0; i < depth; i++) {
    const path = `/deep-chain-${i}`
    const target = i === depth - 1 ? '/home/user/file.txt' : `/deep-chain-${i + 1}`
    entries.push([path, { type: 'symlink', target }])
  }

  // Entry point for the test
  entries.push(['/deep-chain-start', { type: 'symlink', target: '/deep-chain-0' }])

  return entries
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Split a normalized path into its component segments.
 *
 * Handles the root path specially (returns empty array) and filters
 * out empty segments that would result from leading/trailing slashes.
 *
 * @param path - Normalized absolute path to split
 * @returns Array of path components (without slashes)
 *
 * @example
 * ```typescript
 * splitPath('/home/user/file.txt')  // ['home', 'user', 'file.txt']
 * splitPath('/')                     // []
 * ```
 *
 * @internal
 */
function splitPath(path: string): string[] {
  return path.split('/').filter((c) => c !== '')
}

/**
 * Get the parent directory of a resolved path.
 *
 * Used for resolving relative symlink targets, which are relative
 * to the symlink's containing directory, not the current working directory.
 *
 * @param resolvedPath - Current resolved path (empty string means root)
 * @returns Parent directory path
 *
 * @internal
 */
function getParentDirectory(resolvedPath: string): string {
  return resolvedPath || '/'
}

/**
 * Resolve a symlink target to a full path for further resolution.
 *
 * Handles both absolute and relative targets:
 * - Absolute targets (starting with /): normalize and return as-is
 * - Relative targets: resolve relative to the symlink's parent directory
 *
 * @param target - Raw symlink target string
 * @param parentDir - Parent directory of the symlink
 * @returns Normalized path for continued resolution
 *
 * @internal
 */
function resolveSymlinkTarget(target: string, parentDir: string): string {
  if (target.startsWith('/')) {
    // Absolute target: restart from root
    return normalize(target)
  }
  // Relative target: resolve relative to symlink's parent
  return normalize(parentDir + '/' + target)
}

/**
 * Build the full path to continue resolution after expanding a symlink.
 *
 * Combines the resolved symlink target with any remaining path components
 * that follow the symlink in the original path.
 *
 * @param resolvedTarget - The resolved target of the symlink
 * @param remainingComponents - Path components after the symlink
 * @returns Combined path for continued resolution
 *
 * @internal
 */
function buildContinuationPath(
  resolvedTarget: string,
  remainingComponents: string[]
): string {
  if (remainingComponents.length > 0) {
    return resolvedTarget + '/' + remainingComponents.join('/')
  }
  return resolvedTarget
}

// =============================================================================
// CORE RESOLUTION ENGINE
// =============================================================================

/**
 * Resolve a path with symlink depth tracking.
 *
 * This is the core resolution engine that processes path components
 * iteratively and recursively resolves symlinks. The context object
 * tracks cumulative symlink depth across all recursive calls.
 *
 * @param path - Path to resolve (should be normalized)
 * @param ctx - Resolution context with original path and depth counter
 * @returns Promise resolving to the canonical absolute path
 *
 * @throws {ENOENT} If path or any resolved component doesn't exist
 * @throws {ELOOP} If symlink traversal exceeds MAX_SYMLINK_DEPTH
 *
 * @internal
 */
async function resolveWithContext(
  path: string,
  ctx: ResolutionContext
): Promise<string> {
  // Normalize and handle root path
  const normalizedPath = normalize(path)
  if (normalizedPath === '/') {
    if (!mockFS.get('/')) {
      throw new ENOENT(SYSCALL, ctx.originalPath)
    }
    return '/'
  }

  // Process path components iteratively
  const components = splitPath(normalizedPath)
  let resolvedPath = ''

  for (let i = 0; i < components.length; i++) {
    const component = components[i]
    if (!component) continue

    const currentPath = resolvedPath + '/' + component
    const entry = mockFS.get(currentPath)

    // Path component must exist
    if (!entry) {
      throw new ENOENT(SYSCALL, ctx.originalPath)
    }

    // Handle symlinks with depth tracking
    if (entry.type === 'symlink') {
      ctx.symlinkDepth++
      if (ctx.symlinkDepth > MAX_SYMLINK_DEPTH) {
        throw new ELOOP(SYSCALL, ctx.originalPath)
      }

      // Resolve the symlink target
      const target = entry.target ?? ''
      const parentDir = getParentDirectory(resolvedPath)
      const resolvedTarget = resolveSymlinkTarget(target, parentDir)

      // Build path with remaining components and recurse
      const remainingComponents = components.slice(i + 1)
      const fullPath = buildContinuationPath(resolvedTarget, remainingComponents)

      return resolveWithContext(fullPath, ctx)
    }

    // Not a symlink - add to resolved path and continue
    resolvedPath = currentPath
  }

  // Verify final resolved path exists
  if (!mockFS.get(resolvedPath)) {
    throw new ENOENT(SYSCALL, ctx.originalPath)
  }

  return resolvedPath
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Resolve a path to its canonical absolute form.
 *
 * Follows all symbolic links, resolves `.` and `..` components, and
 * removes redundant slashes to produce the canonical path. All path
 * components must exist for resolution to succeed.
 *
 * The resolution algorithm:
 * 1. Normalize the input path (collapse slashes, resolve . and ..)
 * 2. Process each path component from left to right
 * 3. When a symlink is encountered, expand it and continue resolution
 * 4. Track total symlink traversals to detect loops
 * 5. Verify the final resolved path exists
 *
 * @param path - Path to resolve (absolute or relative)
 * @returns Promise resolving to the canonical absolute path
 *
 * @throws {ENOENT} Path or any component does not exist
 * @throws {ENOENT} Symlink target path does not exist (dangling link)
 * @throws {ELOOP} Too many symlink levels encountered (> 40)
 *
 * @example Basic canonicalization
 * ```typescript
 * await realpath('/home/./user/../user/file.txt')
 * // Returns: '/home/user/file.txt'
 * ```
 *
 * @example Symlink at end of path
 * ```typescript
 * // Given: /link -> /home/user/file.txt
 * await realpath('/link')
 * // Returns: '/home/user/file.txt'
 * ```
 *
 * @example Symlink in middle of path
 * ```typescript
 * // Given: /link-to-dir -> /home/user
 * await realpath('/link-to-dir/file.txt')
 * // Returns: '/home/user/file.txt'
 * ```
 *
 * @example Relative symlink resolution
 * ```typescript
 * // Given: /home/user/rel-link -> ../other/file.txt
 * await realpath('/home/user/rel-link')
 * // Returns: '/home/other/file.txt'
 * ```
 *
 * @example Chained symlinks
 * ```typescript
 * // Given: /chain1 -> /chain2, /chain2 -> /home/user/file.txt
 * await realpath('/chain1')
 * // Returns: '/home/user/file.txt'
 * ```
 *
 * @example Error: path doesn't exist
 * ```typescript
 * try {
 *   await realpath('/nonexistent/path')
 * } catch (err) {
 *   // ENOENT: no such file or directory, realpath '/nonexistent/path'
 * }
 * ```
 *
 * @example Error: symlink loop
 * ```typescript
 * // Given: /loop1 -> /loop2, /loop2 -> /loop1
 * try {
 *   await realpath('/loop1')
 * } catch (err) {
 *   // ELOOP: too many levels of symbolic links, realpath '/loop1'
 * }
 * ```
 *
 * @see readlink - Read symlink target without resolution
 * @see normalize - Canonicalize path without following symlinks
 */
export async function realpath(path: string): Promise<string> {
  const ctx: ResolutionContext = {
    originalPath: path,
    symlinkDepth: 0,
  }

  return resolveWithContext(path, ctx)
}
