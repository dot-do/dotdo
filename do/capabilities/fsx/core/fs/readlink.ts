/**
 * readlink - Read the target of a symbolic link (POSIX readlink syscall)
 *
 * Reads the contents of a symbolic link, returning the target path exactly
 * as stored. Unlike `realpath`, this function does NOT resolve or follow
 * the target - it returns the raw string value.
 *
 * POSIX behavior:
 * - Returns the contents of the symbolic link (the target path)
 * - Does NOT resolve or follow the target
 * - Preserves the target exactly as stored (relative paths, dots, etc.)
 * - Returns ENOENT if path doesn't exist
 * - Returns EINVAL if path exists but is not a symbolic link
 *
 * @module fs/readlink
 *
 * @example
 * ```typescript
 * // Read a symlink with relative target
 * // Given: /home/user/link -> ../other/file.txt
 * const target = await readlink('/home/user/link')
 * console.log(target) // '../other/file.txt'
 *
 * // Read a symlink with absolute target
 * // Given: /link -> /var/data/config.json
 * const target = await readlink('/link')
 * console.log(target) // '/var/data/config.json'
 * ```
 *
 * @see symlink - To create a symbolic link
 * @see lstat - To get symlink metadata without following
 * @see realpath - To resolve a path following all symlinks
 */

import { ENOENT, EINVAL } from '../errors'
import { normalize } from '../path'

// =============================================================================
// Constants
// =============================================================================

/** Syscall name for error reporting */
const SYSCALL = 'readlink'

// =============================================================================
// Types
// =============================================================================

/**
 * Filesystem entry types supported by the mock backend.
 */
type EntryType = 'file' | 'directory' | 'symlink'

/**
 * Filesystem entry representation in the mock backend.
 */
interface FSEntry {
  /** Type of the filesystem entry */
  type: EntryType
  /** For symlinks, the target path (stored as-is, not resolved) */
  target?: string
}

// =============================================================================
// Mock Filesystem
// =============================================================================

/**
 * Internal mock filesystem state.
 * Maps normalized paths to their entries (files, directories, symlinks).
 *
 * Note: In production, this would be backed by a Durable Object with SQLite storage.
 * The mock implementation allows unit testing without infrastructure dependencies.
 */
const mockFS: Map<string, FSEntry> = new Map([
  // Symlinks for basic tests
  ['/home/user/link', { type: 'symlink', target: '../other/file.txt' }],
  ['/home/user/absolute-link', { type: 'symlink', target: '/var/data/config.json' }],
  ['/a/b/link', { type: 'symlink', target: '../../c/d' }],

  // Symlink chain test (only immediate target is returned)
  ['/a/link1', { type: 'symlink', target: '/b/link2' }],
  ['/b/link2', { type: 'symlink', target: '/c/file.txt' }],

  // Deeply nested symlink
  ['/very/deep/nested/path/link', { type: 'symlink', target: 'target.txt' }],

  // Symlink with dots in target (should preserve without normalization)
  ['/home/link', { type: 'symlink', target: './current/./path/../file.txt' }],

  // Symlink pointing to root
  ['/myroot', { type: 'symlink', target: '/' }],

  // Symlink with empty target (edge case)
  ['/empty-link', { type: 'symlink', target: '' }],

  // Symlink with trailing slashes in target
  ['/dir-link', { type: 'symlink', target: '/some/directory/' }],

  // Regular file and directory for EINVAL tests
  ['/home/user/regular-file.txt', { type: 'file' }],
  ['/home/user/directory', { type: 'directory' }],

  // Path edge cases
  ['/rootlink', { type: 'symlink', target: '/some/path' }],
  ['/path with spaces/my link', { type: 'symlink', target: 'target with spaces' }],
  ['/unicode/link', { type: 'symlink', target: '/unicode/target' }],

  // Trailing slash and path normalization tests
  ['/trailing-test/link', { type: 'symlink', target: '/target' }],
  ['/normalize/test/link', { type: 'symlink', target: 'target.txt' }],

  // Directories needed for path existence checks
  ['/home', { type: 'directory' }],
  ['/home/user', { type: 'directory' }],
  ['/trailing-test', { type: 'directory' }],
  ['/normalize', { type: 'directory' }],
  ['/normalize/test', { type: 'directory' }],
  ['/a', { type: 'directory' }],
  ['/a/b', { type: 'directory' }],
  ['/b', { type: 'directory' }],
  ['/very', { type: 'directory' }],
  ['/very/deep', { type: 'directory' }],
  ['/very/deep/nested', { type: 'directory' }],
  ['/very/deep/nested/path', { type: 'directory' }],
  ['/path with spaces', { type: 'directory' }],
  ['/unicode', { type: 'directory' }],
])

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Look up an entry in the filesystem and validate it exists.
 *
 * @param normalizedPath - The normalized path to look up
 * @returns The filesystem entry at the path
 * @throws {ENOENT} If the path does not exist in the filesystem
 */
function getEntry(normalizedPath: string): FSEntry {
  const entry = mockFS.get(normalizedPath)
  if (!entry) {
    throw new ENOENT(SYSCALL, normalizedPath)
  }
  return entry
}

/**
 * Validate that an entry is a symbolic link.
 *
 * @param entry - The filesystem entry to validate
 * @param normalizedPath - The path (for error reporting)
 * @throws {EINVAL} If the entry is not a symbolic link
 */
function ensureSymlink(entry: FSEntry, normalizedPath: string): void {
  if (entry.type !== 'symlink') {
    throw new EINVAL(SYSCALL, normalizedPath)
  }
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Read the target of a symbolic link.
 *
 * Returns the exact target string stored in the symlink without any
 * resolution or normalization. The target may be relative or absolute,
 * and may contain `.` or `..` segments.
 *
 * @param path - Path to the symbolic link to read
 * @returns Promise resolving to the symlink's target path (as stored)
 *
 * @throws {ENOENT} If `path` does not exist
 * @throws {EINVAL} If `path` exists but is not a symbolic link
 *
 * @example
 * ```typescript
 * // Read symlink with relative target
 * const target = await readlink('/home/user/link')
 * // Returns '../other/file.txt' (not resolved)
 *
 * // Read symlink with absolute target
 * const target = await readlink('/home/user/absolute-link')
 * // Returns '/var/data/config.json'
 *
 * // Error: path is a regular file
 * await readlink('/home/user/regular-file.txt')
 * // Throws EINVAL: invalid argument, readlink '/home/user/regular-file.txt'
 *
 * // Error: path doesn't exist
 * await readlink('/nonexistent')
 * // Throws ENOENT: no such file or directory, readlink '/nonexistent'
 * ```
 */
export async function readlink(path: string): Promise<string> {
  // Step 1: Normalize the input path (removes trailing slashes, resolves . and ..)
  const normalizedPath = normalize(path)

  // Step 2: Look up the entry (throws ENOENT if not found)
  const entry = getEntry(normalizedPath)

  // Step 3: Validate it's a symlink (throws EINVAL if not)
  ensureSymlink(entry, normalizedPath)

  // Step 4: Return the raw target string (preserve exactly as stored)
  return entry.target ?? ''
}
