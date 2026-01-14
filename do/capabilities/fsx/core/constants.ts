/**
 * POSIX Filesystem Constants
 *
 * This module provides POSIX-compatible filesystem constants for use with fsx.do.
 * All values follow the POSIX.1-2017 standard (IEEE Std 1003.1-2017).
 *
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/sys_stat.h.html
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/fcntl.h.html
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/unistd.h.html
 *
 * @module
 */

// =============================================================================
// File Access Modes (access() and faccessat())
// =============================================================================
// Used with access() to test file accessibility.
// @see https://pubs.opengroup.org/onlinepubs/9699919799/functions/access.html

/**
 * Test for existence of file.
 * @example
 * ```typescript
 * import { constants } from 'fsx.do'
 * await fs.access('/path/to/file', constants.F_OK)
 * ```
 */
export const F_OK = 0

/**
 * Test for read permission.
 * Value: 4 (binary: 100)
 * @example
 * ```typescript
 * await fs.access('/path/to/file', constants.R_OK)
 * ```
 */
export const R_OK = 4

/**
 * Test for write permission.
 * Value: 2 (binary: 010)
 * @example
 * ```typescript
 * await fs.access('/path/to/file', constants.W_OK)
 * ```
 */
export const W_OK = 2

/**
 * Test for execute permission.
 * Value: 1 (binary: 001)
 * @example
 * ```typescript
 * await fs.access('/path/to/file', constants.X_OK)
 * ```
 */
export const X_OK = 1

// =============================================================================
// File Open Flags (open(), openat(), and creat())
// =============================================================================
// Used with open() to specify file access mode and behavior.
// These can be combined with bitwise OR (|).
// @see https://pubs.opengroup.org/onlinepubs/9699919799/functions/open.html

/**
 * Open for reading only.
 * Value: 0
 * @example
 * ```typescript
 * const fd = await fs.open('/file.txt', constants.O_RDONLY)
 * ```
 */
export const O_RDONLY = 0

/**
 * Open for writing only.
 * Value: 1
 * @example
 * ```typescript
 * const fd = await fs.open('/file.txt', constants.O_WRONLY | constants.O_CREAT)
 * ```
 */
export const O_WRONLY = 1

/**
 * Open for reading and writing.
 * Value: 2
 * @example
 * ```typescript
 * const fd = await fs.open('/file.txt', constants.O_RDWR)
 * ```
 */
export const O_RDWR = 2

/**
 * Create file if it does not exist.
 * Value: 64 (0x40)
 *
 * When used, the mode argument specifies the file mode bits.
 * @example
 * ```typescript
 * const fd = await fs.open('/new.txt', constants.O_WRONLY | constants.O_CREAT, 0o644)
 * ```
 */
export const O_CREAT = 64

/**
 * Exclusive use flag. Fail if file exists (when used with O_CREAT).
 * Value: 128 (0x80)
 *
 * Ensures atomic file creation - prevents race conditions.
 * @example
 * ```typescript
 * // Create file only if it doesn't exist
 * const fd = await fs.open('/lock.txt', constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL)
 * ```
 */
export const O_EXCL = 128

/**
 * Truncate file to zero length.
 * Value: 512 (0x200)
 *
 * If the file exists and is a regular file, truncate it to length 0.
 * @example
 * ```typescript
 * const fd = await fs.open('/file.txt', constants.O_WRONLY | constants.O_TRUNC)
 * ```
 */
export const O_TRUNC = 512

/**
 * Set append mode. Writes always occur at end of file.
 * Value: 1024 (0x400)
 *
 * The file offset is positioned at the end before each write.
 * @example
 * ```typescript
 * const fd = await fs.open('/log.txt', constants.O_WRONLY | constants.O_APPEND)
 * ```
 */
export const O_APPEND = 1024

/**
 * Synchronized I/O file integrity completion.
 * Value: 4096 (0x1000)
 *
 * Write operations complete as defined by synchronized I/O file integrity completion.
 * @example
 * ```typescript
 * const fd = await fs.open('/critical.dat', constants.O_WRONLY | constants.O_SYNC)
 * ```
 */
export const O_SYNC = 4096

/**
 * Fail if not a directory.
 * Value: 65536 (0x10000)
 *
 * If the path resolves to a non-directory file, fail with ENOTDIR.
 * @example
 * ```typescript
 * const fd = await fs.open('/must/be/dir', constants.O_RDONLY | constants.O_DIRECTORY)
 * ```
 */
export const O_DIRECTORY = 65536

/**
 * Do not follow symbolic links.
 * Value: 131072 (0x20000)
 *
 * If the path refers to a symbolic link, fail with ELOOP.
 * @example
 * ```typescript
 * const fd = await fs.open('/maybe/symlink', constants.O_RDONLY | constants.O_NOFOLLOW)
 * ```
 */
export const O_NOFOLLOW = 131072

// =============================================================================
// File Type Bits (stat.st_mode & S_IFMT)
// =============================================================================
// These bits encode the file type in the st_mode field of stat structures.
// Use S_IFMT as a mask to extract the file type: (mode & S_IFMT) === S_IFREG
// @see https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/sys_stat.h.html

/**
 * File type mask for extracting file type from mode.
 * Value: 0o170000 (61440 decimal, 0xF000)
 *
 * Use with bitwise AND to extract the file type bits.
 * @example
 * ```typescript
 * const fileType = mode & constants.S_IFMT
 * const isRegular = fileType === constants.S_IFREG
 * ```
 */
export const S_IFMT = 0o170000

/**
 * Regular file type.
 * Value: 0o100000 (32768 decimal, 0x8000)
 * @example
 * ```typescript
 * if ((mode & constants.S_IFMT) === constants.S_IFREG) {
 *   console.log('This is a regular file')
 * }
 * ```
 */
export const S_IFREG = 0o100000

/**
 * Directory type.
 * Value: 0o040000 (16384 decimal, 0x4000)
 * @example
 * ```typescript
 * if ((mode & constants.S_IFMT) === constants.S_IFDIR) {
 *   console.log('This is a directory')
 * }
 * ```
 */
export const S_IFDIR = 0o040000

/**
 * Symbolic link type.
 * Value: 0o120000 (40960 decimal, 0xA000)
 * @example
 * ```typescript
 * if ((mode & constants.S_IFMT) === constants.S_IFLNK) {
 *   console.log('This is a symbolic link')
 * }
 * ```
 */
export const S_IFLNK = 0o120000

/**
 * Block special (block device) type.
 * Value: 0o060000 (24576 decimal, 0x6000)
 *
 * Typically used for disk devices and similar hardware.
 */
export const S_IFBLK = 0o060000

/**
 * Character special (character device) type.
 * Value: 0o020000 (8192 decimal, 0x2000)
 *
 * Typically used for terminals, serial ports, and similar hardware.
 */
export const S_IFCHR = 0o020000

/**
 * FIFO (named pipe) type.
 * Value: 0o010000 (4096 decimal, 0x1000)
 *
 * Used for inter-process communication.
 */
export const S_IFIFO = 0o010000

/**
 * Socket type.
 * Value: 0o140000 (49152 decimal, 0xC000)
 *
 * Unix domain socket for local IPC.
 */
export const S_IFSOCK = 0o140000

// =============================================================================
// Owner (User) Permission Bits
// =============================================================================
// Permission bits for the file owner. These occupy bits 6-8 of the mode.

/**
 * Read, write, execute for owner (user).
 * Value: 0o700 (448 decimal)
 *
 * Combination of S_IRUSR | S_IWUSR | S_IXUSR.
 * Symbolic: rwx------
 */
export const S_IRWXU = 0o700

/**
 * Read permission for owner.
 * Value: 0o400 (256 decimal)
 *
 * Symbolic: r--------
 */
export const S_IRUSR = 0o400

/**
 * Write permission for owner.
 * Value: 0o200 (128 decimal)
 *
 * Symbolic: -w-------
 */
export const S_IWUSR = 0o200

/**
 * Execute permission for owner.
 * Value: 0o100 (64 decimal)
 *
 * Symbolic: --x------
 * For directories, this is the search (traverse) permission.
 */
export const S_IXUSR = 0o100

// =============================================================================
// Group Permission Bits
// =============================================================================
// Permission bits for the file's group. These occupy bits 3-5 of the mode.

/**
 * Read, write, execute for group.
 * Value: 0o070 (56 decimal)
 *
 * Combination of S_IRGRP | S_IWGRP | S_IXGRP.
 * Symbolic: ---rwx---
 */
export const S_IRWXG = 0o070

/**
 * Read permission for group.
 * Value: 0o040 (32 decimal)
 *
 * Symbolic: ---r-----
 */
export const S_IRGRP = 0o040

/**
 * Write permission for group.
 * Value: 0o020 (16 decimal)
 *
 * Symbolic: ----w----
 */
export const S_IWGRP = 0o020

/**
 * Execute permission for group.
 * Value: 0o010 (8 decimal)
 *
 * Symbolic: -----x---
 * For directories, this is the search (traverse) permission.
 */
export const S_IXGRP = 0o010

// =============================================================================
// Other (World) Permission Bits
// =============================================================================
// Permission bits for all other users. These occupy bits 0-2 of the mode.

/**
 * Read, write, execute for others.
 * Value: 0o007 (7 decimal)
 *
 * Combination of S_IROTH | S_IWOTH | S_IXOTH.
 * Symbolic: ------rwx
 */
export const S_IRWXO = 0o007

/**
 * Read permission for others.
 * Value: 0o004 (4 decimal)
 *
 * Symbolic: ------r--
 */
export const S_IROTH = 0o004

/**
 * Write permission for others.
 * Value: 0o002 (2 decimal)
 *
 * Symbolic: -------w-
 */
export const S_IWOTH = 0o002

/**
 * Execute permission for others.
 * Value: 0o001 (1 decimal)
 *
 * Symbolic: --------x
 * For directories, this is the search (traverse) permission.
 */
export const S_IXOTH = 0o001

// =============================================================================
// Special Permission Bits
// =============================================================================
// These bits have special meanings beyond standard rwx permissions.

/**
 * Set user ID on execution (setuid).
 * Value: 0o4000 (2048 decimal)
 *
 * When this bit is set on an executable file, the process runs with
 * the effective user ID of the file owner rather than the user who runs it.
 * Symbolic: s (in place of user execute bit)
 *
 * @example
 * ```typescript
 * const setuidExecutable = constants.S_IFREG | constants.S_ISUID | 0o755
 * ```
 */
export const S_ISUID = 0o4000

/**
 * Set group ID on execution (setgid).
 * Value: 0o2000 (1024 decimal)
 *
 * When set on executable: process runs with effective group ID of file.
 * When set on directory: new files inherit the directory's group.
 * Symbolic: s (in place of group execute bit)
 */
export const S_ISGID = 0o2000

/**
 * Sticky bit (restricted deletion flag).
 * Value: 0o1000 (512 decimal)
 *
 * On directories: only the file owner, directory owner, or root
 * can delete or rename files within the directory.
 * Classic example: /tmp directory.
 * Symbolic: t (in place of other execute bit)
 */
export const S_ISVTX = 0o1000

// =============================================================================
// Copy Flags (copyfile)
// =============================================================================
// Flags used with copyFile() to control copy behavior.

/**
 * Fail if destination exists.
 * Value: 1
 *
 * @example
 * ```typescript
 * await fs.copyFile('/src.txt', '/dest.txt', constants.COPYFILE_EXCL)
 * ```
 */
export const COPYFILE_EXCL = 1

/**
 * Use copy-on-write if supported by the filesystem.
 * Value: 2
 *
 * Attempts to create a reflink (copy-on-write clone) for efficiency.
 * Falls back to regular copy if not supported.
 */
export const COPYFILE_FICLONE = 2

/**
 * Require copy-on-write. Fail if not supported.
 * Value: 4
 *
 * Unlike COPYFILE_FICLONE, this will not fall back to regular copy.
 */
export const COPYFILE_FICLONE_FORCE = 4

// =============================================================================
// Seek Whence Values (lseek)
// =============================================================================
// Used with lseek() to specify the reference point for offset.
// @see https://pubs.opengroup.org/onlinepubs/9699919799/functions/lseek.html

/**
 * Seek from beginning of file.
 * Value: 0
 *
 * The file offset is set to offset bytes from the beginning.
 */
export const SEEK_SET = 0

/**
 * Seek from current position.
 * Value: 1
 *
 * The file offset is set to its current location plus offset.
 */
export const SEEK_CUR = 1

/**
 * Seek from end of file.
 * Value: 2
 *
 * The file offset is set to the size of the file plus offset.
 */
export const SEEK_END = 2

// =============================================================================
// Constants Object (For Compatibility)
// =============================================================================
// Grouped export for consumers who prefer the Node.js fs.constants style.

/**
 * All filesystem constants in a single object.
 *
 * This export provides Node.js fs.constants compatibility.
 * Individual constants are also exported for tree-shaking.
 *
 * @example
 * ```typescript
 * import { constants } from 'fsx.do'
 *
 * // Use like Node.js fs.constants
 * await fs.access('/file', constants.R_OK | constants.W_OK)
 *
 * // Check file type
 * const isFile = (stats.mode & constants.S_IFMT) === constants.S_IFREG
 * ```
 */
export const constants = {
  // File access modes
  F_OK,
  R_OK,
  W_OK,
  X_OK,

  // File open flags
  O_RDONLY,
  O_WRONLY,
  O_RDWR,
  O_CREAT,
  O_EXCL,
  O_TRUNC,
  O_APPEND,
  O_SYNC,
  O_DIRECTORY,
  O_NOFOLLOW,

  // File types (mode bits)
  S_IFMT,
  S_IFREG,
  S_IFDIR,
  S_IFLNK,
  S_IFBLK,
  S_IFCHR,
  S_IFIFO,
  S_IFSOCK,

  // Owner permissions
  S_IRWXU,
  S_IRUSR,
  S_IWUSR,
  S_IXUSR,

  // Group permissions
  S_IRWXG,
  S_IRGRP,
  S_IWGRP,
  S_IXGRP,

  // Other permissions
  S_IRWXO,
  S_IROTH,
  S_IWOTH,
  S_IXOTH,

  // Special bits
  S_ISUID,
  S_ISGID,
  S_ISVTX,

  // Copy flags
  COPYFILE_EXCL,
  COPYFILE_FICLONE,
  COPYFILE_FICLONE_FORCE,

  // Seek modes
  SEEK_SET,
  SEEK_CUR,
  SEEK_END,
} as const

/**
 * Type representing all filesystem constants.
 */
export type Constants = typeof constants

// =============================================================================
// Grouped Exports (For Tree-Shaking)
// =============================================================================

/**
 * File access mode constants for use with access().
 */
export const AccessModes = { F_OK, R_OK, W_OK, X_OK } as const
export type AccessModes = typeof AccessModes

/**
 * File open flag constants for use with open().
 */
export const OpenFlags = {
  O_RDONLY,
  O_WRONLY,
  O_RDWR,
  O_CREAT,
  O_EXCL,
  O_TRUNC,
  O_APPEND,
  O_SYNC,
  O_DIRECTORY,
  O_NOFOLLOW,
} as const
export type OpenFlags = typeof OpenFlags

/**
 * File type constants for mode bit detection.
 */
export const FileTypes = {
  S_IFMT,
  S_IFREG,
  S_IFDIR,
  S_IFLNK,
  S_IFBLK,
  S_IFCHR,
  S_IFIFO,
  S_IFSOCK,
} as const
export type FileTypes = typeof FileTypes

/**
 * Permission bit constants for file mode.
 */
export const Permissions = {
  // Owner
  S_IRWXU,
  S_IRUSR,
  S_IWUSR,
  S_IXUSR,
  // Group
  S_IRWXG,
  S_IRGRP,
  S_IWGRP,
  S_IXGRP,
  // Other
  S_IRWXO,
  S_IROTH,
  S_IWOTH,
  S_IXOTH,
  // Special
  S_ISUID,
  S_ISGID,
  S_ISVTX,
} as const
export type Permissions = typeof Permissions

/**
 * Copy operation flag constants.
 */
export const CopyFlags = {
  COPYFILE_EXCL,
  COPYFILE_FICLONE,
  COPYFILE_FICLONE_FORCE,
} as const
export type CopyFlags = typeof CopyFlags

/**
 * Seek whence constants for lseek().
 */
export const SeekWhence = { SEEK_SET, SEEK_CUR, SEEK_END } as const
export type SeekWhence = typeof SeekWhence

// =============================================================================
// Common File Modes (Convenience)
// =============================================================================

/**
 * Common file mode presets for convenience.
 *
 * These combine file type with typical permission patterns.
 *
 * @example
 * ```typescript
 * import { CommonModes } from 'fsx.do'
 *
 * // Create a file with standard permissions
 * await fs.chmod('/script.sh', CommonModes.EXECUTABLE_755)
 * ```
 */
export const CommonModes = {
  /** Standard file permissions: rw-r--r-- (0644) */
  FILE_644: 0o644,
  /** Private file: rw------- (0600) */
  FILE_600: 0o600,
  /** Group-writable file: rw-rw-r-- (0664) */
  FILE_664: 0o664,
  /** Standard directory: rwxr-xr-x (0755) */
  DIR_755: 0o755,
  /** Private directory: rwx------ (0700) */
  DIR_700: 0o700,
  /** Group-writable directory: rwxrwxr-x (0775) */
  DIR_775: 0o775,
  /** Executable file: rwxr-xr-x (0755) */
  EXECUTABLE_755: 0o755,
  /** User-only executable: rwx------ (0700) */
  EXECUTABLE_700: 0o700,
  /** Symbolic link (no real permissions, shown as 0777) */
  SYMLINK: 0o777,
} as const
export type CommonModes = typeof CommonModes

// =============================================================================
// Mode Detection Helper Functions
// =============================================================================
// These use bitwise AND with the file type mask to extract the file type,
// then compare against the specific file type constant.

/**
 * Entity type for permission checking.
 */
export type Who = 'user' | 'group' | 'other'

/**
 * Check if mode represents a regular file.
 *
 * @param mode - The file mode (e.g., from stats.mode)
 * @returns true if the mode indicates a regular file
 *
 * @example
 * ```typescript
 * import { isFile } from 'fsx.do'
 *
 * const stats = await fs.stat('/path/to/file')
 * if (isFile(stats.mode)) {
 *   console.log('This is a regular file')
 * }
 * ```
 */
export function isFile(mode: number): boolean {
  return (mode & S_IFMT) === S_IFREG
}

/**
 * Check if mode represents a directory.
 *
 * @param mode - The file mode (e.g., from stats.mode)
 * @returns true if the mode indicates a directory
 *
 * @example
 * ```typescript
 * import { isDirectory } from 'fsx.do'
 *
 * const stats = await fs.stat('/path/to/dir')
 * if (isDirectory(stats.mode)) {
 *   console.log('This is a directory')
 * }
 * ```
 */
export function isDirectory(mode: number): boolean {
  return (mode & S_IFMT) === S_IFDIR
}

/**
 * Check if mode represents a symbolic link.
 *
 * @param mode - The file mode (e.g., from lstat().mode)
 * @returns true if the mode indicates a symbolic link
 *
 * @example
 * ```typescript
 * import { isSymlink } from 'fsx.do'
 *
 * // Use lstat to not follow symlinks
 * const stats = await fs.lstat('/path/to/link')
 * if (isSymlink(stats.mode)) {
 *   console.log('This is a symbolic link')
 * }
 * ```
 */
export function isSymlink(mode: number): boolean {
  return (mode & S_IFMT) === S_IFLNK
}

/**
 * Check if mode represents a block device.
 *
 * @param mode - The file mode
 * @returns true if the mode indicates a block device
 *
 * @example
 * ```typescript
 * import { isBlockDevice } from 'fsx.do'
 *
 * const stats = await fs.stat('/dev/sda')
 * if (isBlockDevice(stats.mode)) {
 *   console.log('This is a block device')
 * }
 * ```
 */
export function isBlockDevice(mode: number): boolean {
  return (mode & S_IFMT) === S_IFBLK
}

/**
 * Check if mode represents a character device.
 *
 * @param mode - The file mode
 * @returns true if the mode indicates a character device
 *
 * @example
 * ```typescript
 * import { isCharacterDevice } from 'fsx.do'
 *
 * const stats = await fs.stat('/dev/tty')
 * if (isCharacterDevice(stats.mode)) {
 *   console.log('This is a character device')
 * }
 * ```
 */
export function isCharacterDevice(mode: number): boolean {
  return (mode & S_IFMT) === S_IFCHR
}

/**
 * Check if mode represents a FIFO (named pipe).
 *
 * @param mode - The file mode
 * @returns true if the mode indicates a FIFO
 *
 * @example
 * ```typescript
 * import { isFIFO } from 'fsx.do'
 *
 * const stats = await fs.stat('/tmp/mypipe')
 * if (isFIFO(stats.mode)) {
 *   console.log('This is a named pipe')
 * }
 * ```
 */
export function isFIFO(mode: number): boolean {
  return (mode & S_IFMT) === S_IFIFO
}

/**
 * Check if mode represents a socket.
 *
 * @param mode - The file mode
 * @returns true if the mode indicates a socket
 *
 * @example
 * ```typescript
 * import { isSocket } from 'fsx.do'
 *
 * const stats = await fs.stat('/var/run/docker.sock')
 * if (isSocket(stats.mode)) {
 *   console.log('This is a Unix socket')
 * }
 * ```
 */
export function isSocket(mode: number): boolean {
  return (mode & S_IFMT) === S_IFSOCK
}

// =============================================================================
// Permission Checking Helper Functions
// =============================================================================
// These check if a specific permission bit is set for user, group, or other.

/**
 * Check if mode has read permission for the specified entity.
 *
 * @param mode - The file mode
 * @param who - The entity to check: 'user', 'group', or 'other'
 * @returns true if read permission is set
 *
 * @example
 * ```typescript
 * import { hasReadPermission } from 'fsx.do'
 *
 * const stats = await fs.stat('/path/to/file')
 * if (hasReadPermission(stats.mode, 'group')) {
 *   console.log('Group can read this file')
 * }
 * ```
 */
export function hasReadPermission(mode: number, who: Who): boolean {
  switch (who) {
    case 'user':
      return (mode & S_IRUSR) !== 0
    case 'group':
      return (mode & S_IRGRP) !== 0
    case 'other':
      return (mode & S_IROTH) !== 0
  }
}

/**
 * Check if mode has write permission for the specified entity.
 *
 * @param mode - The file mode
 * @param who - The entity to check: 'user', 'group', or 'other'
 * @returns true if write permission is set
 *
 * @example
 * ```typescript
 * import { hasWritePermission } from 'fsx.do'
 *
 * const stats = await fs.stat('/path/to/file')
 * if (hasWritePermission(stats.mode, 'other')) {
 *   console.log('Warning: world-writable file!')
 * }
 * ```
 */
export function hasWritePermission(mode: number, who: Who): boolean {
  switch (who) {
    case 'user':
      return (mode & S_IWUSR) !== 0
    case 'group':
      return (mode & S_IWGRP) !== 0
    case 'other':
      return (mode & S_IWOTH) !== 0
  }
}

/**
 * Check if mode has execute permission for the specified entity.
 *
 * @param mode - The file mode
 * @param who - The entity to check: 'user', 'group', or 'other'
 * @returns true if execute permission is set
 *
 * @example
 * ```typescript
 * import { hasExecutePermission } from 'fsx.do'
 *
 * const stats = await fs.stat('/usr/bin/node')
 * if (hasExecutePermission(stats.mode, 'user')) {
 *   console.log('User can execute this file')
 * }
 * ```
 */
export function hasExecutePermission(mode: number, who: Who): boolean {
  switch (who) {
    case 'user':
      return (mode & S_IXUSR) !== 0
    case 'group':
      return (mode & S_IXGRP) !== 0
    case 'other':
      return (mode & S_IXOTH) !== 0
  }
}

// =============================================================================
// Mode String Conversion Utilities
// =============================================================================

/**
 * Convert a mode number to a symbolic permission string (e.g., "rwxr-xr-x").
 *
 * @param mode - The file mode (permission bits only, file type ignored)
 * @returns A 9-character permission string
 *
 * @example
 * ```typescript
 * import { modeToString } from 'fsx.do'
 *
 * console.log(modeToString(0o755)) // "rwxr-xr-x"
 * console.log(modeToString(0o644)) // "rw-r--r--"
 * console.log(modeToString(0o700)) // "rwx------"
 * ```
 */
export function modeToString(mode: number): string {
  const chars: string[] = []

  // User permissions
  chars.push((mode & S_IRUSR) ? 'r' : '-')
  chars.push((mode & S_IWUSR) ? 'w' : '-')
  if (mode & S_ISUID) {
    chars.push((mode & S_IXUSR) ? 's' : 'S')
  } else {
    chars.push((mode & S_IXUSR) ? 'x' : '-')
  }

  // Group permissions
  chars.push((mode & S_IRGRP) ? 'r' : '-')
  chars.push((mode & S_IWGRP) ? 'w' : '-')
  if (mode & S_ISGID) {
    chars.push((mode & S_IXGRP) ? 's' : 'S')
  } else {
    chars.push((mode & S_IXGRP) ? 'x' : '-')
  }

  // Other permissions
  chars.push((mode & S_IROTH) ? 'r' : '-')
  chars.push((mode & S_IWOTH) ? 'w' : '-')
  if (mode & S_ISVTX) {
    chars.push((mode & S_IXOTH) ? 't' : 'T')
  } else {
    chars.push((mode & S_IXOTH) ? 'x' : '-')
  }

  return chars.join('')
}

/**
 * Get the file type character for ls-style output.
 *
 * @param mode - The file mode
 * @returns A single character representing the file type
 *
 * @example
 * ```typescript
 * import { getFileTypeChar } from 'fsx.do'
 *
 * console.log(getFileTypeChar(0o100644)) // "-" (regular file)
 * console.log(getFileTypeChar(0o040755)) // "d" (directory)
 * console.log(getFileTypeChar(0o120777)) // "l" (symlink)
 * ```
 */
export function getFileTypeChar(mode: number): string {
  const type = mode & S_IFMT
  switch (type) {
    case S_IFREG:
      return '-'
    case S_IFDIR:
      return 'd'
    case S_IFLNK:
      return 'l'
    case S_IFBLK:
      return 'b'
    case S_IFCHR:
      return 'c'
    case S_IFIFO:
      return 'p'
    case S_IFSOCK:
      return 's'
    default:
      return '?'
  }
}

/**
 * Get full ls-style mode string including file type.
 *
 * @param mode - The complete file mode (type + permissions)
 * @returns A 10-character mode string (e.g., "-rwxr-xr-x")
 *
 * @example
 * ```typescript
 * import { getFullModeString, S_IFREG, S_IFDIR } from 'fsx.do'
 *
 * console.log(getFullModeString(S_IFREG | 0o755)) // "-rwxr-xr-x"
 * console.log(getFullModeString(S_IFDIR | 0o755)) // "drwxr-xr-x"
 * ```
 */
export function getFullModeString(mode: number): string {
  return getFileTypeChar(mode) + modeToString(mode)
}
