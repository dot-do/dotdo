/**
 * @fileoverview POSIX-compatible filesystem error classes for fsx.do
 *
 * Provides Node.js-compatible error classes for filesystem operations.
 * Each error class mirrors the POSIX errno codes and follows the Node.js
 * error message formatting convention.
 *
 * @example
 * ```typescript
 * import { ENOENT, isEnoent } from 'fsx/errors'
 *
 * // Create an error
 * throw new ENOENT('open', '/path/to/file.txt')
 * // Error: ENOENT: no such file or directory, open '/path/to/file.txt'
 *
 * // Type guard usage
 * try {
 *   await fs.readFile('/missing.txt')
 * } catch (err) {
 *   if (isEnoent(err)) {
 *     console.log('File not found:', err.path)
 *   }
 * }
 * ```
 *
 * @module fsx/errors
 */

// ============================================================================
// Error Code Definitions
// ============================================================================

/**
 * Error code configuration for filesystem errors.
 * Maps POSIX error codes to their numeric errno values and human-readable messages.
 */
const ERROR_CODES = {
  ENOENT: { errno: -2, message: 'no such file or directory' },
  EEXIST: { errno: -17, message: 'file already exists' },
  EISDIR: { errno: -21, message: 'illegal operation on a directory' },
  ENOTDIR: { errno: -20, message: 'not a directory' },
  EACCES: { errno: -13, message: 'permission denied' },
  EPERM: { errno: -1, message: 'operation not permitted' },
  ENOTEMPTY: { errno: -39, message: 'directory not empty' },
  EBADF: { errno: -9, message: 'bad file descriptor' },
  EINVAL: { errno: -22, message: 'invalid argument' },
  ELOOP: { errno: -40, message: 'too many levels of symbolic links' },
  ENAMETOOLONG: { errno: -36, message: 'file name too long' },
  ENOSPC: { errno: -28, message: 'no space left on device' },
  EROFS: { errno: -30, message: 'read-only file system' },
  EBUSY: { errno: -16, message: 'resource busy or locked' },
  EMFILE: { errno: -24, message: 'too many open files' },
  ENFILE: { errno: -23, message: 'file table overflow' },
  EXDEV: { errno: -18, message: 'cross-device link not permitted' },
} as const

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Union type of all supported POSIX error codes.
 * Useful for type-safe error handling and switch statements.
 *
 * @example
 * ```typescript
 * function handleError(code: ErrorCode) {
 *   switch (code) {
 *     case 'ENOENT': return 'File not found'
 *     case 'EACCES': return 'Permission denied'
 *     // ...
 *   }
 * }
 * ```
 */
export type ErrorCode = keyof typeof ERROR_CODES

/**
 * Numeric errno values corresponding to POSIX error codes.
 */
export type Errno = (typeof ERROR_CODES)[ErrorCode]['errno']

// ============================================================================
// Base Error Class
// ============================================================================

/**
 * Base class for all filesystem errors.
 *
 * Extends the native Error class with POSIX-compatible properties.
 * Error messages follow the Node.js fs module formatting convention:
 * `CODE: message, syscall 'path' -> 'dest'`
 *
 * @example
 * ```typescript
 * const error = new FSError('ENOENT', -2, 'no such file or directory', 'open', '/file.txt')
 * console.log(error.message)  // "ENOENT: no such file or directory, open '/file.txt'"
 * console.log(error.code)     // "ENOENT"
 * console.log(error.errno)    // -2
 * console.log(error.syscall)  // "open"
 * console.log(error.path)     // "/file.txt"
 * ```
 */
export class FSError extends Error {
  /** POSIX error code string (e.g., 'ENOENT', 'EACCES') */
  code: string

  /** Numeric errno value (negative, following Node.js convention) */
  errno: number

  /** System call that triggered the error (e.g., 'open', 'read', 'mkdir') */
  syscall?: string

  /** Source path involved in the operation */
  path?: string

  /** Destination path for operations like rename or copy */
  dest?: string

  /**
   * Creates a new filesystem error.
   *
   * @param code - POSIX error code string (e.g., 'ENOENT')
   * @param errno - Numeric errno value (negative)
   * @param message - Human-readable error description
   * @param syscall - Optional system call name
   * @param path - Optional source path
   * @param dest - Optional destination path (for rename/copy operations)
   */
  constructor(code: string, errno: number, message: string, syscall?: string, path?: string, dest?: string) {
    const fullMessage = `${code}: ${message}${syscall ? `, ${syscall}` : ''}${path ? ` '${path}'` : ''}${dest ? ` -> '${dest}'` : ''}`
    super(fullMessage)
    this.name = 'FSError'
    this.code = code
    this.errno = errno
    this.syscall = syscall
    this.path = path
    this.dest = dest
  }
}

// ============================================================================
// Error Class Factory
// ============================================================================

/**
 * Factory function to create error classes with consistent structure.
 * Used internally to DRY up error class definitions.
 *
 * @internal
 */
function createErrorClass<T extends ErrorCode>(code: T) {
  const { errno, message } = ERROR_CODES[code]

  return class extends FSError {
    constructor(syscall?: string, path?: string, dest?: string) {
      super(code, errno, message, syscall, path, dest)
      this.name = code
    }
  }
}

// ============================================================================
// Specific Error Classes
// ============================================================================

/**
 * ENOENT - No such file or directory.
 *
 * Thrown when a file or directory is expected to exist but does not.
 * Common scenarios:
 * - `readFile()` on a non-existent file
 * - `stat()` on a missing path
 * - `readdir()` on a non-existent directory
 *
 * @example
 * ```typescript
 * throw new ENOENT('open', '/missing/file.txt')
 * // ENOENT: no such file or directory, open '/missing/file.txt'
 * ```
 */
export class ENOENT extends createErrorClass('ENOENT') {}

/**
 * EEXIST - File exists.
 *
 * Thrown when creating a file/directory that already exists
 * and exclusive creation was requested.
 * Common scenarios:
 * - `mkdir()` on an existing directory (without recursive option)
 * - `writeFile()` with exclusive flag on existing file
 * - `symlink()` where target already exists
 *
 * @example
 * ```typescript
 * throw new EEXIST('mkdir', '/existing/directory')
 * // EEXIST: file already exists, mkdir '/existing/directory'
 * ```
 */
export class EEXIST extends createErrorClass('EEXIST') {}

/**
 * EISDIR - Is a directory.
 *
 * Thrown when an operation expected a file but encountered a directory.
 * Common scenarios:
 * - `readFile()` on a directory
 * - `unlink()` on a directory (use rmdir instead)
 * - `open()` for writing on a directory
 *
 * @example
 * ```typescript
 * throw new EISDIR('read', '/some/directory')
 * // EISDIR: illegal operation on a directory, read '/some/directory'
 * ```
 */
export class EISDIR extends createErrorClass('EISDIR') {}

/**
 * ENOTDIR - Not a directory.
 *
 * Thrown when an operation expected a directory but encountered a file.
 * Common scenarios:
 * - `readdir()` on a file
 * - Path contains a file component used as directory (e.g., `/file.txt/subdir`)
 * - `rmdir()` on a file
 *
 * @example
 * ```typescript
 * throw new ENOTDIR('scandir', '/path/to/file.txt')
 * // ENOTDIR: not a directory, scandir '/path/to/file.txt'
 * ```
 */
export class ENOTDIR extends createErrorClass('ENOTDIR') {}

/**
 * EACCES - Permission denied.
 *
 * Thrown when the operation lacks necessary permissions.
 * Common scenarios:
 * - Reading a file without read permission
 * - Writing to a file without write permission
 * - Accessing a file in a directory without execute permission
 *
 * @example
 * ```typescript
 * throw new EACCES('open', '/protected/file.txt')
 * // EACCES: permission denied, open '/protected/file.txt'
 * ```
 */
export class EACCES extends createErrorClass('EACCES') {}

/**
 * EPERM - Operation not permitted.
 *
 * Thrown when an operation is not allowed regardless of permissions.
 * Common scenarios:
 * - Changing ownership without appropriate privileges
 * - Modifying immutable files
 * - Operations requiring elevated privileges
 *
 * @example
 * ```typescript
 * throw new EPERM('chmod', '/system/file')
 * // EPERM: operation not permitted, chmod '/system/file'
 * ```
 */
export class EPERM extends createErrorClass('EPERM') {}

/**
 * ENOTEMPTY - Directory not empty.
 *
 * Thrown when trying to remove a non-empty directory without recursive option.
 * Common scenarios:
 * - `rmdir()` on a directory containing files
 * - `rename()` over an existing non-empty directory
 *
 * @example
 * ```typescript
 * throw new ENOTEMPTY('rmdir', '/non/empty/dir')
 * // ENOTEMPTY: directory not empty, rmdir '/non/empty/dir'
 * ```
 */
export class ENOTEMPTY extends createErrorClass('ENOTEMPTY') {}

/**
 * EBADF - Bad file descriptor.
 *
 * Thrown when operating on an invalid or closed file descriptor.
 * Common scenarios:
 * - Reading from a closed file handle
 * - Writing to an invalid descriptor
 * - Operations on file descriptors that were never opened
 *
 * @example
 * ```typescript
 * throw new EBADF('read')
 * // EBADF: bad file descriptor, read
 * ```
 */
export class EBADF extends createErrorClass('EBADF') {}

/**
 * EINVAL - Invalid argument.
 *
 * Thrown when an argument value is outside the acceptable range or format.
 * Common scenarios:
 * - Invalid flags passed to open()
 * - Invalid mode values
 * - Negative offset/length values where not allowed
 *
 * @example
 * ```typescript
 * throw new EINVAL('read', '/file.txt')
 * // EINVAL: invalid argument, read '/file.txt'
 * ```
 */
export class EINVAL extends createErrorClass('EINVAL') {}

/**
 * ELOOP - Too many symbolic links.
 *
 * Thrown when symlink resolution exceeds the maximum depth (usually 40 levels).
 * Common scenarios:
 * - Circular symlink references
 * - Deeply nested symlink chains
 *
 * @example
 * ```typescript
 * throw new ELOOP('readlink', '/circular/link')
 * // ELOOP: too many levels of symbolic links, readlink '/circular/link'
 * ```
 */
export class ELOOP extends createErrorClass('ELOOP') {}

/**
 * ENAMETOOLONG - File name too long.
 *
 * Thrown when a path component or total path length exceeds system limits.
 * Common scenarios:
 * - Path component exceeds 255 bytes (typical limit)
 * - Total path exceeds PATH_MAX (typically 4096 bytes)
 *
 * @example
 * ```typescript
 * throw new ENAMETOOLONG('open', '/path/' + 'x'.repeat(300))
 * // ENAMETOOLONG: file name too long, open '/path/xxx...'
 * ```
 */
export class ENAMETOOLONG extends createErrorClass('ENAMETOOLONG') {}

/**
 * ENOSPC - No space left on device.
 *
 * Thrown when the filesystem is full and cannot allocate more space.
 * Common scenarios:
 * - Writing to a full disk
 * - Creating files when no inodes remain
 * - Extending a file beyond available space
 *
 * @example
 * ```typescript
 * throw new ENOSPC('write', '/large/file.bin')
 * // ENOSPC: no space left on device, write '/large/file.bin'
 * ```
 */
export class ENOSPC extends createErrorClass('ENOSPC') {}

/**
 * EROFS - Read-only file system.
 *
 * Thrown when attempting to modify a read-only filesystem.
 * Common scenarios:
 * - Writing to a mounted read-only volume
 * - Modifying files on read-only media
 *
 * @example
 * ```typescript
 * throw new EROFS('write', '/readonly/file.txt')
 * // EROFS: read-only file system, write '/readonly/file.txt'
 * ```
 */
export class EROFS extends createErrorClass('EROFS') {}

/**
 * EBUSY - Resource busy.
 *
 * Thrown when a resource is in use and cannot be accessed exclusively.
 * Common scenarios:
 * - Deleting a file that is currently open
 * - Unmounting a filesystem with open files
 * - Locking a file that is already locked
 *
 * @example
 * ```typescript
 * throw new EBUSY('unlink', '/locked/file.txt')
 * // EBUSY: resource busy or locked, unlink '/locked/file.txt'
 * ```
 */
export class EBUSY extends createErrorClass('EBUSY') {}

/**
 * EMFILE - Too many open files (process limit).
 *
 * Thrown when the process has exhausted its file descriptor limit.
 * Common scenarios:
 * - Opening many files without closing them
 * - Leaking file descriptors
 *
 * @example
 * ```typescript
 * throw new EMFILE('open')
 * // EMFILE: too many open files, open
 * ```
 */
export class EMFILE extends createErrorClass('EMFILE') {}

/**
 * ENFILE - File table overflow (system limit).
 *
 * Thrown when the system-wide file descriptor limit is reached.
 * Less common than EMFILE; indicates system-wide exhaustion.
 *
 * @example
 * ```typescript
 * throw new ENFILE('open')
 * // ENFILE: file table overflow, open
 * ```
 */
export class ENFILE extends createErrorClass('ENFILE') {}

/**
 * EXDEV - Cross-device link.
 *
 * Thrown when attempting hard links or certain renames across filesystems.
 * Common scenarios:
 * - Hard linking across mount points
 * - Atomic rename across different volumes
 *
 * @example
 * ```typescript
 * throw new EXDEV('rename', '/vol1/file.txt', '/vol2/file.txt')
 * // EXDEV: cross-device link not permitted, rename '/vol1/file.txt' -> '/vol2/file.txt'
 * ```
 */
export class EXDEV extends createErrorClass('EXDEV') {}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if an error is any FSError instance.
 *
 * @param error - The error to check
 * @returns True if the error is an FSError instance
 *
 * @example
 * ```typescript
 * try {
 *   await fs.readFile('/missing.txt')
 * } catch (err) {
 *   if (isFSError(err)) {
 *     console.log(`FS Error: ${err.code} (errno: ${err.errno})`)
 *   }
 * }
 * ```
 */
export function isFSError(error: unknown): error is FSError {
  return error instanceof FSError
}

/**
 * Type guard to check if an error is ENOENT (file not found).
 *
 * @param error - The error to check
 * @returns True if the error is an ENOENT instance
 *
 * @example
 * ```typescript
 * if (isEnoent(err)) {
 *   console.log('File not found:', err.path)
 * }
 * ```
 */
export function isEnoent(error: unknown): error is ENOENT {
  return error instanceof ENOENT
}

/**
 * Type guard to check if an error is EEXIST (file exists).
 *
 * @param error - The error to check
 * @returns True if the error is an EEXIST instance
 */
export function isEexist(error: unknown): error is EEXIST {
  return error instanceof EEXIST
}

/**
 * Type guard to check if an error is EISDIR (is a directory).
 *
 * @param error - The error to check
 * @returns True if the error is an EISDIR instance
 */
export function isEisdir(error: unknown): error is EISDIR {
  return error instanceof EISDIR
}

/**
 * Type guard to check if an error is ENOTDIR (not a directory).
 *
 * @param error - The error to check
 * @returns True if the error is an ENOTDIR instance
 */
export function isEnotdir(error: unknown): error is ENOTDIR {
  return error instanceof ENOTDIR
}

/**
 * Type guard to check if an error is EACCES (permission denied).
 *
 * @param error - The error to check
 * @returns True if the error is an EACCES instance
 */
export function isEacces(error: unknown): error is EACCES {
  return error instanceof EACCES
}

/**
 * Type guard to check if an error is EPERM (operation not permitted).
 *
 * @param error - The error to check
 * @returns True if the error is an EPERM instance
 */
export function isEperm(error: unknown): error is EPERM {
  return error instanceof EPERM
}

/**
 * Type guard to check if an error is ENOTEMPTY (directory not empty).
 *
 * @param error - The error to check
 * @returns True if the error is an ENOTEMPTY instance
 */
export function isEnotempty(error: unknown): error is ENOTEMPTY {
  return error instanceof ENOTEMPTY
}

/**
 * Type guard to check if an error is EBADF (bad file descriptor).
 *
 * @param error - The error to check
 * @returns True if the error is an EBADF instance
 */
export function isEbadf(error: unknown): error is EBADF {
  return error instanceof EBADF
}

/**
 * Type guard to check if an error is EINVAL (invalid argument).
 *
 * @param error - The error to check
 * @returns True if the error is an EINVAL instance
 */
export function isEinval(error: unknown): error is EINVAL {
  return error instanceof EINVAL
}

/**
 * Type guard to check if an error is ELOOP (too many symlinks).
 *
 * @param error - The error to check
 * @returns True if the error is an ELOOP instance
 */
export function isEloop(error: unknown): error is ELOOP {
  return error instanceof ELOOP
}

/**
 * Type guard to check if an error is ENAMETOOLONG (name too long).
 *
 * @param error - The error to check
 * @returns True if the error is an ENAMETOOLONG instance
 */
export function isEnametoolong(error: unknown): error is ENAMETOOLONG {
  return error instanceof ENAMETOOLONG
}

/**
 * Type guard to check if an error is ENOSPC (no space left).
 *
 * @param error - The error to check
 * @returns True if the error is an ENOSPC instance
 */
export function isEnospc(error: unknown): error is ENOSPC {
  return error instanceof ENOSPC
}

/**
 * Type guard to check if an error is EROFS (read-only filesystem).
 *
 * @param error - The error to check
 * @returns True if the error is an EROFS instance
 */
export function isErofs(error: unknown): error is EROFS {
  return error instanceof EROFS
}

/**
 * Type guard to check if an error is EBUSY (resource busy).
 *
 * @param error - The error to check
 * @returns True if the error is an EBUSY instance
 */
export function isEbusy(error: unknown): error is EBUSY {
  return error instanceof EBUSY
}

/**
 * Type guard to check if an error is EMFILE (too many open files).
 *
 * @param error - The error to check
 * @returns True if the error is an EMFILE instance
 */
export function isEmfile(error: unknown): error is EMFILE {
  return error instanceof EMFILE
}

/**
 * Type guard to check if an error is ENFILE (file table overflow).
 *
 * @param error - The error to check
 * @returns True if the error is an ENFILE instance
 */
export function isEnfile(error: unknown): error is ENFILE {
  return error instanceof ENFILE
}

/**
 * Type guard to check if an error is EXDEV (cross-device link).
 *
 * @param error - The error to check
 * @returns True if the error is an EXDEV instance
 */
export function isExdev(error: unknown): error is EXDEV {
  return error instanceof EXDEV
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Checks if an error has a specific error code.
 * Works with any error object that has a `code` property.
 *
 * @param error - The error to check
 * @param code - The error code to match
 * @returns True if the error has the specified code
 *
 * @example
 * ```typescript
 * try {
 *   await fs.readFile('/missing.txt')
 * } catch (err) {
 *   if (hasErrorCode(err, 'ENOENT')) {
 *     // Handle file not found
 *   }
 * }
 * ```
 */
export function hasErrorCode(error: unknown, code: ErrorCode): boolean {
  return isFSError(error) && error.code === code
}

/**
 * Gets the error code from an error if it's an FSError.
 *
 * @param error - The error to extract the code from
 * @returns The error code or undefined if not an FSError
 *
 * @example
 * ```typescript
 * const code = getErrorCode(err)
 * if (code === 'ENOENT') {
 *   // Handle missing file
 * }
 * ```
 */
export function getErrorCode(error: unknown): ErrorCode | undefined {
  if (isFSError(error) && error.code in ERROR_CODES) {
    return error.code as ErrorCode
  }
  return undefined
}

/**
 * Creates a new error from just a code, syscall, and path.
 * Useful for programmatic error creation.
 *
 * @param code - The error code
 * @param syscall - Optional system call name
 * @param path - Optional path
 * @param dest - Optional destination path
 * @returns A new FSError instance of the appropriate type
 *
 * @example
 * ```typescript
 * throw createError('ENOENT', 'open', '/missing.txt')
 * ```
 */
export function createError(code: ErrorCode, syscall?: string, path?: string, dest?: string): FSError {
  const ErrorClass = {
    ENOENT,
    EEXIST,
    EISDIR,
    ENOTDIR,
    EACCES,
    EPERM,
    ENOTEMPTY,
    EBADF,
    EINVAL,
    ELOOP,
    ENAMETOOLONG,
    ENOSPC,
    EROFS,
    EBUSY,
    EMFILE,
    ENFILE,
    EXDEV,
  }[code]

  return new ErrorClass(syscall, path, dest)
}

/**
 * All supported error codes as a constant array.
 * Useful for iteration or validation.
 */
export const ALL_ERROR_CODES: readonly ErrorCode[] = Object.keys(ERROR_CODES) as ErrorCode[]

// ============================================================================
// Default Export
// ============================================================================

export default FSError
