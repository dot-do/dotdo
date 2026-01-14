/**
 * @fileoverview chmod - Change file mode bits
 *
 * Changes the permissions (mode) of a file or directory following POSIX semantics.
 *
 * @module fsx/fs/chmod
 *
 * @description
 * Provides `chmod` and `lchmod` functions for changing file permissions.
 * Supports both numeric modes (0o755) and symbolic modes (u+x, g-w, o=rx).
 *
 * POSIX behavior:
 * - `chmod(path, mode)` - Changes permissions of file at path (follows symlinks)
 * - `lchmod(path, mode)` - Changes permissions of symlink itself (if supported)
 * - Mode can be numeric (0o755, 0o644) or symbolic string ('u+x', 'g-w')
 * - Only permission bits are changed (lower 12 bits: 0o7777)
 * - File type bits (S_IFMT) are preserved
 * - Updates ctime (status change time) on successful change
 * - Throws ENOENT if path doesn't exist
 * - Throws EPERM if operation not permitted (not owner/root)
 *
 * @example
 * ```typescript
 * import { chmod, lchmod } from 'fsx/fs/chmod'
 *
 * // Numeric modes
 * await chmod('/path/to/script.sh', 0o755)
 * await chmod('/path/to/private.txt', 0o600)
 *
 * // Symbolic modes
 * await chmod('/path/to/script.sh', 'u+x')      // Add execute for owner
 * await chmod('/path/to/file.txt', 'go-w')      // Remove write from group/other
 * await chmod('/path/to/file.txt', 'a+r')       // Add read for all
 * await chmod('/path/to/file.txt', 'u=rwx,go=rx') // Set explicit permissions
 *
 * // lchmod for symlinks (may not be supported on all platforms)
 * await lchmod('/path/to/symlink', 0o777)
 * ```
 */

import { type FileEntry } from '../types'
import { ENOENT, EPERM, EINVAL } from '../errors'
import { normalize } from '../path'
import { constants } from '../constants'

// =============================================================================
// Constants
// =============================================================================

/**
 * Permission bits mask (includes setuid, setgid, sticky, and rwx for owner/group/other).
 * The lower 12 bits of the mode represent permissions.
 *
 * Layout: SUGT | rwx | rwx | rwx
 *         ^^^    ^^^   ^^^   ^^^
 *         |||    |||   |||   +-- Other (o)
 *         |||    |||   +-------- Group (g)
 *         |||    +-------------- User/Owner (u)
 *         ||+------------------- Sticky bit (t)
 *         |+-------------------- Setgid (g)
 *         +--------------------- Setuid (s)
 *
 * @internal
 */
const PERMISSION_MASK = 0o7777

/**
 * Permission bit mappings for symbolic mode parsing.
 * Maps permission characters to their octal bit values.
 *
 * @internal
 */
const PERMISSION_BITS = {
  /** Read permission bit */
  r: 0o4,
  /** Write permission bit */
  w: 0o2,
  /** Execute permission bit */
  x: 0o1,
} as const

/**
 * Bit shift amounts for different user classes.
 * Used when applying symbolic modes.
 *
 * @internal
 */
const CLASS_SHIFTS = {
  /** User/owner permission bits start at bit 6 */
  u: 6,
  /** Group permission bits start at bit 3 */
  g: 3,
  /** Other permission bits start at bit 0 */
  o: 0,
} as const

/**
 * Special mode bit mappings.
 *
 * @internal
 */
const SPECIAL_BITS = {
  /** Setuid bit - set user ID on execution */
  s: { u: constants.S_ISUID, g: constants.S_ISGID },
  /** Sticky bit - restricted deletion */
  t: constants.S_ISVTX,
} as const

// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Storage interface for chmod operations.
 *
 * This interface abstracts the underlying storage mechanism, allowing the
 * chmod operation to work with different storage backends (in-memory, SQLite,
 * Durable Objects, etc.).
 *
 * Required methods:
 * - `get`: Retrieve a file entry by path
 * - `has`: Check if a path exists
 * - `update`: Update a file entry with new values
 *
 * Optional methods:
 * - `resolveSymlink`: Follow symlink chains to get the target entry
 * - `getUid`/`getGid`: Get current user context for permission checks
 */
export interface ChmodStorage {
  /**
   * Get entry by path.
   * Does NOT follow symlinks - returns the raw entry at the path.
   *
   * @param path - Normalized absolute path
   * @returns FileEntry if exists, undefined otherwise
   */
  get(path: string): FileEntry | undefined

  /**
   * Check if path exists in storage.
   *
   * @param path - Normalized absolute path
   * @returns true if path exists, false otherwise
   */
  has(path: string): boolean

  /**
   * Update a file entry with new values.
   *
   * @param path - Normalized absolute path
   * @param changes - Partial FileEntry with fields to update
   */
  update(path: string, changes: Partial<FileEntry>): void

  /**
   * Resolve a symlink chain to get the final target entry.
   * Returns undefined if the symlink target doesn't exist (broken link).
   *
   * @param path - Path to the symlink
   * @param maxDepth - Maximum symlink resolution depth (default: 40)
   * @returns Final target FileEntry, or undefined if broken
   */
  resolveSymlink?(path: string, maxDepth?: number): FileEntry | undefined

  /**
   * Get current user ID for permission checking.
   * Root (uid 0) can chmod any file.
   *
   * @returns User ID (defaults to 1000 if not implemented)
   */
  getUid?(): number

  /**
   * Get current primary group ID.
   * Currently unused but available for future group-based permission checks.
   *
   * @returns Group ID (defaults to 1000 if not implemented)
   */
  getGid?(): number
}

// =============================================================================
// Storage Management
// =============================================================================

/**
 * Module-level storage instance.
 * Set via setStorage() for testing or when initializing the filesystem.
 */
let storage: ChmodStorage | null = null

/**
 * Set the storage backend for chmod operations.
 *
 * @param s - Storage implementation or null to clear
 *
 * @example
 * ```typescript
 * // Set up storage for testing
 * setStorage({
 *   get: (path) => mockFs.get(path),
 *   has: (path) => mockFs.has(path),
 *   update: (path, changes) => { ... },
 *   getUid: () => 1000,
 * })
 *
 * // Clear storage after tests
 * setStorage(null)
 * ```
 */
export function setStorage(s: ChmodStorage | null): void {
  storage = s
}

/**
 * Get the current storage backend.
 *
 * @returns Current storage instance or null if not configured
 */
export function getStorage(): ChmodStorage | null {
  return storage
}

// =============================================================================
// Mode Types
// =============================================================================

/**
 * Mode argument type for chmod operations.
 * Can be either a numeric mode (0o755) or symbolic string ('u+x').
 *
 * Numeric modes:
 * - 0o755 - rwxr-xr-x (owner full, group/other read+execute)
 * - 0o644 - rw-r--r-- (owner read+write, group/other read)
 * - 0o600 - rw------- (owner read+write only)
 * - 0o777 - rwxrwxrwx (full access)
 * - 0o4755 - rwxr-xr-x with setuid
 *
 * Symbolic modes follow chmod(1) syntax:
 * - 'u+x' - Add execute for owner
 * - 'g-w' - Remove write from group
 * - 'o=r' - Set other to read only
 * - 'a+r' - Add read for all (same as ugo+r)
 * - 'u=rwx,go=rx' - Multiple clauses separated by comma
 */
export type Mode = number | string

// =============================================================================
// Symbolic Mode Parsing
// =============================================================================

/**
 * Parse a single symbolic mode clause and apply it to the current mode.
 *
 * Clause format: [ugoa]*[+-=][rwxXstugo]+
 *
 * Classes (who):
 * - u: user/owner
 * - g: group
 * - o: other
 * - a: all (ugo)
 *
 * Operators:
 * - +: add permissions
 * - -: remove permissions
 * - =: set exact permissions (clears first)
 *
 * Permissions:
 * - r: read
 * - w: write
 * - x: execute
 * - X: execute only if directory or already has execute
 * - s: setuid/setgid
 * - t: sticky bit
 *
 * @param clause - Single mode clause (e.g., 'u+x', 'go-w', 'a=rx')
 * @param currentMode - Current file mode to modify
 * @param isDirectory - Whether the target is a directory (affects X handling)
 * @returns Modified mode value
 * @throws {EINVAL} If the clause is malformed
 *
 * @internal
 */
function applySymbolicClause(
  clause: string,
  currentMode: number,
  isDirectory: boolean
): number {
  // Regex to parse clause: [ugoa]*[+-=][rwxXstugo]+
  const match = clause.match(/^([ugoa]*)([+\-=])([rwxXst]+)$/)
  if (!match) {
    throw new EINVAL('chmod', clause)
  }

  const [, whoStr, operator, permsStr] = match

  // Default to 'a' (all) if no who specified
  const who = whoStr || 'a'

  // Determine which classes to modify
  const classes: Array<'u' | 'g' | 'o'> = []
  if (who.includes('a')) {
    classes.push('u', 'g', 'o')
  } else {
    if (who.includes('u')) classes.push('u')
    if (who.includes('g')) classes.push('g')
    if (who.includes('o')) classes.push('o')
  }

  // Calculate permission bits to apply
  let permBits = 0
  let specialBits = 0

  for (const perm of permsStr) {
    switch (perm) {
      case 'r':
        permBits |= PERMISSION_BITS.r
        break
      case 'w':
        permBits |= PERMISSION_BITS.w
        break
      case 'x':
        permBits |= PERMISSION_BITS.x
        break
      case 'X':
        // X: execute only if directory or file already has execute
        if (isDirectory || (currentMode & 0o111) !== 0) {
          permBits |= PERMISSION_BITS.x
        }
        break
      case 's':
        // Setuid/setgid - applied based on class
        for (const cls of classes) {
          if (cls === 'u') specialBits |= SPECIAL_BITS.s.u
          if (cls === 'g') specialBits |= SPECIAL_BITS.s.g
        }
        break
      case 't':
        specialBits |= SPECIAL_BITS.t
        break
    }
  }

  let newMode = currentMode

  // Apply to each class based on operator
  for (const cls of classes) {
    const shift = CLASS_SHIFTS[cls]
    const shiftedBits = permBits << shift

    switch (operator) {
      case '+':
        // Add permissions
        newMode |= shiftedBits
        break
      case '-':
        // Remove permissions
        newMode &= ~shiftedBits
        break
      case '=':
        // Set exact permissions (clear first, then set)
        const classMask = 0o7 << shift
        newMode = (newMode & ~classMask) | shiftedBits
        break
    }
  }

  // Apply special bits based on operator
  if (specialBits !== 0) {
    switch (operator) {
      case '+':
        newMode |= specialBits
        break
      case '-':
        newMode &= ~specialBits
        break
      case '=':
        // For '=', we only set the bits that were explicitly included
        newMode |= specialBits
        break
    }
  }

  return newMode
}

/**
 * Parse a symbolic mode string and compute the new mode.
 *
 * Symbolic modes can contain multiple comma-separated clauses,
 * each applied in sequence to the current mode.
 *
 * @param symbolicMode - Symbolic mode string (e.g., 'u+x,go-w')
 * @param currentMode - Current file mode (permission bits only, 0o7777)
 * @param isDirectory - Whether the target is a directory
 * @returns New mode value
 * @throws {EINVAL} If the mode string is invalid
 *
 * @example
 * ```typescript
 * parseSymbolicMode('u+x', 0o644, false)      // 0o744
 * parseSymbolicMode('go-w', 0o666, false)     // 0o644
 * parseSymbolicMode('a=rx', 0o777, false)     // 0o555
 * parseSymbolicMode('u=rwx,go=rx', 0o000, false) // 0o755
 * ```
 *
 * @internal
 */
function parseSymbolicMode(
  symbolicMode: string,
  currentMode: number,
  isDirectory: boolean
): number {
  // Split by comma for multiple clauses
  const clauses = symbolicMode.split(',')

  let mode = currentMode
  for (const clause of clauses) {
    const trimmed = clause.trim()
    if (trimmed) {
      mode = applySymbolicClause(trimmed, mode, isDirectory)
    }
  }

  return mode
}

/**
 * Resolve the mode argument to a numeric mode value.
 *
 * If the mode is already numeric, masks it to permission bits.
 * If the mode is a string, parses it as a symbolic mode.
 *
 * @param mode - Mode argument (number or string)
 * @param currentMode - Current file mode for symbolic mode resolution
 * @param isDirectory - Whether the target is a directory
 * @param syscall - Syscall name for error messages
 * @returns Numeric mode value (masked to 0o7777)
 * @throws {EINVAL} If the mode string is invalid
 *
 * @internal
 */
function resolveMode(
  mode: Mode,
  currentMode: number,
  isDirectory: boolean,
  syscall: 'chmod' | 'lchmod'
): number {
  if (typeof mode === 'number') {
    return mode & PERMISSION_MASK
  }

  // Parse symbolic mode
  try {
    return parseSymbolicMode(mode, currentMode & PERMISSION_MASK, isDirectory)
  } catch (error) {
    throw new EINVAL(syscall, mode)
  }
}

// =============================================================================
// File Type Resolution
// =============================================================================

/**
 * Get file type bits from a FileEntry.
 *
 * First checks if file type bits are already set in mode.
 * If not, derives them from the entry's type field.
 *
 * @param entry - File entry to get type bits from
 * @returns File type bits (S_IFREG, S_IFDIR, S_IFLNK, etc.)
 *
 * @internal
 */
function getFileTypeBits(entry: FileEntry): number {
  // Check if file type bits are already set in mode
  const existingType = entry.mode & constants.S_IFMT
  if (existingType !== 0) {
    return existingType
  }

  // Derive from type field
  switch (entry.type) {
    case 'file':
      return constants.S_IFREG
    case 'directory':
      return constants.S_IFDIR
    case 'symlink':
      return constants.S_IFLNK
    case 'block':
      return constants.S_IFBLK
    case 'character':
      return constants.S_IFCHR
    case 'fifo':
      return constants.S_IFIFO
    case 'socket':
      return constants.S_IFSOCK
    default:
      // Default to regular file if unknown
      return constants.S_IFREG
  }
}

// =============================================================================
// Symlink Resolution
// =============================================================================

/**
 * Resolve symlinks if needed and return the target entry.
 *
 * @param entry - The entry at the requested path
 * @param normalizedPath - Normalized path for symlink resolution
 * @param followSymlinks - Whether to follow symlinks
 * @param syscall - Syscall name for error messages
 * @param originalPath - Original path for error messages
 * @returns Tuple of [targetEntry, targetPath]
 * @throws {ENOENT} If symlink target doesn't exist
 *
 * @internal
 */
function resolveTarget(
  entry: FileEntry,
  normalizedPath: string,
  followSymlinks: boolean,
  syscall: 'chmod' | 'lchmod',
  originalPath: string
): [FileEntry, string] {
  if (!followSymlinks || entry.type !== 'symlink') {
    return [entry, normalizedPath]
  }

  // Follow symlinks to get the target
  if (!storage?.resolveSymlink) {
    throw new ENOENT(syscall, originalPath)
  }

  const targetEntry = storage.resolveSymlink(normalizedPath)
  if (!targetEntry) {
    throw new ENOENT(syscall, originalPath)
  }

  return [targetEntry, targetEntry.path]
}

/**
 * Check if the current user has permission to chmod the file.
 *
 * Only the file owner or root (uid 0) can change file permissions.
 *
 * @param entry - File entry to check
 * @param syscall - Syscall name for error messages
 * @param path - Path for error messages
 * @throws {EPERM} If current user is not owner and not root
 *
 * @internal
 */
function checkChmodPermission(
  entry: FileEntry,
  syscall: 'chmod' | 'lchmod',
  path: string
): void {
  const currentUid = storage?.getUid?.() ?? 1000

  // Root (uid 0) can chmod any file
  if (currentUid === 0) {
    return
  }

  // Owner can chmod their own files
  if (entry.uid === currentUid) {
    return
  }

  throw new EPERM(syscall, path)
}

// =============================================================================
// Internal Implementation
// =============================================================================

/**
 * Internal implementation for chmod operations.
 *
 * This function handles both `chmod` and `lchmod` operations, differing only
 * in whether symlinks are followed.
 *
 * @param path - Path to the file or directory
 * @param mode - New permissions (numeric or symbolic mode)
 * @param followSymlinks - Whether to follow symbolic links
 * @param syscall - Name of the syscall for error messages
 * @returns Promise that resolves when complete
 * @throws {Error} If storage is not configured
 * @throws {ENOENT} If path does not exist
 * @throws {ENOENT} If symlink target does not exist (when following symlinks)
 * @throws {EPERM} If operation is not permitted
 * @throws {EINVAL} If symbolic mode is invalid
 *
 * @internal
 */
async function chmodInternal(
  path: string,
  mode: Mode,
  followSymlinks: boolean,
  syscall: 'chmod' | 'lchmod'
): Promise<void> {
  // Step 1: Verify storage is configured
  if (!storage) {
    throw new Error('Storage not configured. Call setStorage() first.')
  }

  // Step 2: Normalize the path
  const normalizedPath = normalize(path)

  // Step 3: Look up the entry
  const entry = storage.get(normalizedPath)
  if (!entry) {
    throw new ENOENT(syscall, path)
  }

  // Step 4: Resolve symlinks if needed
  const [targetEntry, targetPath] = resolveTarget(
    entry,
    normalizedPath,
    followSymlinks,
    syscall,
    path
  )

  // Step 5: Check permissions
  checkChmodPermission(targetEntry, syscall, path)

  // Step 6: Resolve mode (handle symbolic modes)
  const isDirectory = targetEntry.type === 'directory'
  const resolvedMode = resolveMode(mode, targetEntry.mode, isDirectory, syscall)

  // Step 7: Calculate new mode (preserve file type bits)
  const fileTypeBits = getFileTypeBits(targetEntry)
  const newMode = fileTypeBits | resolvedMode

  // Step 8: Update the entry
  storage.update(targetPath, {
    mode: newMode,
    ctime: Date.now(),
  })
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Change file mode bits.
 *
 * Changes the permissions of the file or directory specified by path.
 * If path refers to a symbolic link, this function follows the link
 * and changes the permissions of the target file.
 *
 * Supports both numeric modes (0o755) and symbolic modes ('u+x').
 *
 * @param path - Path to the file or directory
 * @param mode - New permissions (numeric or symbolic mode)
 *
 * @returns Promise that resolves to undefined when complete
 *
 * @throws {ENOENT} If path does not exist (errno: -2)
 * @throws {ENOENT} If symlink target does not exist (broken symlink)
 * @throws {EPERM} If operation is not permitted (errno: -1)
 * @throws {EINVAL} If symbolic mode string is invalid (errno: -22)
 *
 * @example
 * ```typescript
 * import { chmod } from 'fsx/fs/chmod'
 *
 * // Numeric modes
 * await chmod('/path/to/script.sh', 0o755)     // rwxr-xr-x
 * await chmod('/path/to/file.txt', 0o644)      // rw-r--r--
 * await chmod('/path/to/secret.txt', 0o600)    // rw-------
 * await chmod('/path/to/public', 0o777)        // rwxrwxrwx
 *
 * // Symbolic modes
 * await chmod('/path/to/script.sh', 'u+x')     // Add execute for owner
 * await chmod('/path/to/file.txt', 'go-w')     // Remove write from group/other
 * await chmod('/path/to/file.txt', 'a+r')      // Add read for all
 * await chmod('/path/to/file.txt', 'u=rwx,go=rx') // Set owner rwx, group/other rx
 *
 * // Special bits
 * await chmod('/path/to/script', 0o4755)       // setuid
 * await chmod('/path/to/script', 'u+s')        // setuid via symbolic
 * await chmod('/tmp', 0o1777)                  // sticky bit
 * await chmod('/tmp', 'a+t')                   // sticky via symbolic
 *
 * // Error handling
 * try {
 *   await chmod('/missing/file', 0o644)
 * } catch (err) {
 *   if (err.code === 'ENOENT') {
 *     console.log('File not found')
 *   } else if (err.code === 'EPERM') {
 *     console.log('Permission denied')
 *   }
 * }
 * ```
 *
 * @see lchmod - For changing symlink permissions without following
 * @see {@link https://pubs.opengroup.org/onlinepubs/9699919799/functions/chmod.html|POSIX chmod}
 */
export async function chmod(path: string, mode: Mode): Promise<void> {
  return chmodInternal(path, mode, true, 'chmod')
}

/**
 * Change symbolic link mode bits (without following).
 *
 * Like chmod, but does not follow symbolic links. Changes the permissions
 * of the symbolic link itself rather than its target.
 *
 * **Platform Support:**
 * - macOS/BSD: Fully supported
 * - Linux: NOT supported (silently succeeds but has no effect)
 * - Windows: NOT supported
 *
 * On platforms where lchmod is not supported, this function still operates
 * on the symlink entry in the virtual filesystem, which may differ from
 * native behavior.
 *
 * @param path - Path to the symbolic link (or file/directory)
 * @param mode - New permissions (numeric or symbolic mode)
 *
 * @returns Promise that resolves to undefined when complete
 *
 * @throws {ENOENT} If path does not exist (errno: -2)
 * @throws {EPERM} If operation is not permitted (errno: -1)
 * @throws {EINVAL} If symbolic mode string is invalid (errno: -22)
 *
 * @example
 * ```typescript
 * import { lchmod } from 'fsx/fs/chmod'
 *
 * // Change symlink permissions (without affecting target)
 * await lchmod('/path/to/symlink', 0o755)
 *
 * // Works on regular files too (same as chmod for non-symlinks)
 * await lchmod('/path/to/file.txt', 0o644)
 *
 * // Symbolic mode on symlink
 * await lchmod('/path/to/symlink', 'a+rwx')
 * ```
 *
 * @remarks
 * On Linux and Windows, symlink permissions are typically not meaningful
 * and are always 0o777 (lrwxrwxrwx). The actual access control is determined
 * by the target file's permissions.
 *
 * @see chmod - For changing file permissions (follows symlinks)
 * @see {@link https://www.freebsd.org/cgi/man.cgi?lchmod|BSD lchmod}
 */
export async function lchmod(path: string, mode: Mode): Promise<void> {
  return chmodInternal(path, mode, false, 'lchmod')
}
