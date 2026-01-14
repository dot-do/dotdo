/**
 * symlink - Create a symbolic link (POSIX symlink syscall)
 *
 * Creates a symbolic link at `path` pointing to `target`. The target path
 * is stored exactly as provided and does NOT need to exist (dangling symlinks
 * are valid).
 *
 * POSIX behavior:
 * - Stores target path as-is (relative or absolute)
 * - Target does NOT need to exist (dangling symlinks allowed)
 * - Parent directory of symlink path must exist
 * - Symlink path must not already exist
 * - Symlinks have mode S_IFLNK | 0o777 (lrwxrwxrwx)
 *
 * @module fs/symlink
 */

import { ENOENT, EEXIST, EINVAL } from '../errors'
import { constants } from '../constants'
import { normalize, dirname } from '../path'

/** Syscall name for error reporting */
const SYSCALL = 'symlink'

/** Default symlink permissions (lrwxrwxrwx) */
const SYMLINK_MODE = constants.S_IFLNK | 0o777

/**
 * Entry type in the mock filesystem
 */
type EntryType = 'file' | 'directory' | 'symlink'

/**
 * Filesystem entry representation
 */
interface FSEntry {
  /** Type of the filesystem entry */
  type: EntryType
  /** File mode (type + permissions) */
  mode: number
  /** For symlinks, the target path (stored as-is, not resolved) */
  target?: string
}

/**
 * Internal mock filesystem state.
 * Maps normalized paths to their entries (files, directories, symlinks).
 *
 * Note: In production, this would be backed by a Durable Object with SQLite storage.
 * The mock implementation allows unit testing without infrastructure dependencies.
 */
const entries: Map<string, FSEntry> = new Map([
  // Root directory always exists
  ['/', { type: 'directory', mode: constants.S_IFDIR | 0o755 }],

  // Standard directories for test fixtures
  ['/dir', { type: 'directory', mode: constants.S_IFDIR | 0o755 }],
  ['/data', { type: 'directory', mode: constants.S_IFDIR | 0o755 }],
  ['/links', { type: 'directory', mode: constants.S_IFDIR | 0o755 }],
  ['/shortcuts', { type: 'directory', mode: constants.S_IFDIR | 0o755 }],
  ['/home', { type: 'directory', mode: constants.S_IFDIR | 0o755 }],
  ['/home/user', { type: 'directory', mode: constants.S_IFDIR | 0o755 }],
  ['/home/user/documents', { type: 'directory', mode: constants.S_IFDIR | 0o755 }],

  // Existing entries for EEXIST tests
  ['/existing', { type: 'directory', mode: constants.S_IFDIR | 0o755 }],
  ['/existing/file.txt', { type: 'file', mode: constants.S_IFREG | 0o644 }],
  ['/existing/dir', { type: 'directory', mode: constants.S_IFDIR | 0o755 }],
  ['/links/existing-link', { type: 'symlink', mode: SYMLINK_MODE, target: '/some/target' }],
])

/**
 * Validate that the target is not empty.
 *
 * @param target - The symlink target to validate
 * @param path - The symlink path (for error reporting)
 * @throws {EINVAL} If target is an empty string
 */
function validateTarget(target: string, path: string): void {
  if (target === '') {
    throw new EINVAL(SYSCALL, path)
  }
}

/**
 * Check if a path already exists in the filesystem.
 *
 * @param normalizedPath - The normalized path to check
 * @throws {EEXIST} If path already exists (file, directory, or symlink)
 */
function ensurePathDoesNotExist(normalizedPath: string): void {
  if (entries.has(normalizedPath)) {
    throw new EEXIST(SYSCALL, normalizedPath)
  }
}

/**
 * Validate that the parent directory exists and is a directory.
 *
 * @param normalizedPath - The normalized symlink path
 * @throws {ENOENT} If parent directory doesn't exist or isn't a directory
 */
function validateParentDirectory(normalizedPath: string): void {
  const parentPath = dirname(normalizedPath)
  const parent = entries.get(parentPath)

  if (!parent || parent.type !== 'directory') {
    throw new ENOENT(SYSCALL, normalizedPath)
  }
}

/**
 * Create a symbolic link pointing to a target path.
 *
 * Creates a new symbolic link at `path` that points to `target`. The target
 * path is stored exactly as provided (relative paths are NOT resolved).
 * The target does not need to exist - dangling symlinks are valid.
 *
 * @param target - The path that the symlink points to (stored as-is)
 * @param path - The path where the symlink will be created
 * @param type - Optional type hint for Windows compatibility ('file', 'dir', or 'junction').
 *               This parameter is ignored in the virtual filesystem as Unix does not
 *               distinguish between file and directory symlinks.
 * @returns Promise that resolves when the symlink is created
 *
 * @throws {EINVAL} If target is an empty string
 * @throws {EEXIST} If path already exists (file, directory, or another symlink)
 * @throws {ENOENT} If the parent directory of path does not exist
 *
 * @example
 * // Create a symlink with a relative target
 * await symlink('./target.txt', '/dir/link.txt')
 *
 * @example
 * // Create a symlink with an absolute target
 * await symlink('/data/file.txt', '/links/abs-link.txt')
 *
 * @example
 * // Create a dangling symlink (target doesn't need to exist)
 * await symlink('/nonexistent/path', '/links/dangling')
 *
 * @example
 * // Create a symlink to a directory (type hint for Windows)
 * await symlink('/home/user/documents', '/shortcuts/docs', 'dir')
 *
 * @see readlink - To read the target of a symbolic link
 * @see lstat - To get symlink metadata without following
 * @see realpath - To resolve a path following all symlinks
 */
export async function symlink(
  target: string,
  path: string,
  _type?: 'file' | 'dir' | 'junction'
): Promise<void> {
  // Step 1: Validate target is not empty
  validateTarget(target, path)

  // Step 2: Normalize the symlink path
  const normalizedPath = normalize(path)

  // Step 3: Ensure symlink path doesn't already exist
  ensurePathDoesNotExist(normalizedPath)

  // Step 4: Validate parent directory exists
  validateParentDirectory(normalizedPath)

  // Step 5: Create the symlink entry
  // Store target as-is (preserving relative paths, dots, etc.)
  entries.set(normalizedPath, {
    type: 'symlink',
    mode: SYMLINK_MODE,
    target,
  })
}
