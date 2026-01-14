/**
 * Stats Building Utilities
 *
 * This module provides shared utilities for building Stats objects from FileEntry
 * data. Used by stat, lstat, fstat, and other operations that return file metadata.
 *
 * @module core/fs/stats-builder
 */

import { Stats, type FileEntry, type FileType } from '../types'
import { constants } from '../constants'

// =============================================================================
// Constants
// =============================================================================

/**
 * Virtual filesystem device ID.
 *
 * Since fsx.do is a virtual filesystem, all files share a single device ID.
 * This matches the behavior of most in-memory and virtual filesystems.
 */
export const VIRTUAL_DEV_ID = 1

/**
 * Default block size in bytes.
 *
 * Standard filesystem block size used for blksize. This is a common
 * default that balances memory efficiency with I/O performance.
 */
export const DEFAULT_BLOCK_SIZE = 4096

/**
 * Block size for calculating block count (512-byte blocks).
 *
 * POSIX specifies that stat.blocks is measured in 512-byte units,
 * regardless of the actual filesystem block size.
 */
export const BLOCKS_UNIT_SIZE = 512

// =============================================================================
// File Type Mapping
// =============================================================================

/**
 * Maps FileEntry type strings to POSIX file type mode bits.
 *
 * These constants are defined in the S_IFMT family and represent the
 * file type portion of the mode field. They are combined with permission
 * bits to form the complete mode value.
 *
 * @see constants.S_IFMT - Mask to extract file type from mode
 * @see https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/sys_stat.h.html
 */
export const FILE_TYPE_FLAGS: Readonly<Record<FileType, number>> = {
  file: constants.S_IFREG,
  directory: constants.S_IFDIR,
  symlink: constants.S_IFLNK,
  block: constants.S_IFBLK,
  character: constants.S_IFCHR,
  fifo: constants.S_IFIFO,
  socket: constants.S_IFSOCK,
} as const

// =============================================================================
// Inode Calculation
// =============================================================================

/**
 * Convert a string ID to a numeric inode value.
 *
 * If the ID is already numeric, parses it directly. Otherwise, generates
 * a consistent hash from the string. Uses djb2-style hashing for good
 * distribution and performance.
 *
 * @param id - The file entry ID (may be numeric string or UUID-style)
 * @returns A positive 32-bit integer suitable for use as inode
 *
 * @example
 * ```typescript
 * computeInode('42')       // Returns 42
 * computeInode('abc-123')  // Returns hash value
 * ```
 */
export function computeInode(id: string): number {
  // Fast path: try parsing as integer
  const parsed = parseInt(id, 10)
  if (!Number.isNaN(parsed) && parsed >= 0) {
    return parsed
  }

  // Fallback: compute hash for non-numeric IDs
  return hashStringToInode(id)
}

/**
 * Hash a string to a positive 32-bit integer.
 *
 * Uses a djb2-style hash function which provides good distribution
 * for typical filesystem paths and UUIDs. The result is guaranteed
 * to be a positive integer suitable for use as an inode number.
 *
 * @param str - String to hash
 * @returns Positive 32-bit integer
 *
 * @internal
 */
function hashStringToInode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    // djb2: hash * 33 + char
    hash = ((hash << 5) - hash) + char
    // Ensure 32-bit integer
    hash = hash | 0
  }
  // Return absolute value to ensure positive inode
  return Math.abs(hash)
}

// =============================================================================
// Mode Building
// =============================================================================

/**
 * Build a complete mode value from a file entry.
 *
 * Combines file type bits with permission bits to create the full
 * POSIX-compatible mode. If the entry already has type bits set
 * in its mode, they are preserved. Otherwise, type bits are added
 * based on the entry's type field.
 *
 * @param entry - File entry containing type and mode
 * @returns Complete mode with type and permission bits
 *
 * @example
 * ```typescript
 * // Entry with permissions only (common case)
 * buildMode({ type: 'file', mode: 0o644 })  // 0o100644
 *
 * // Entry with type bits already set (preserved)
 * buildMode({ type: 'file', mode: 0o100644 })  // 0o100644
 * ```
 */
export function buildMode(entry: FileEntry): number {
  const { mode, type } = entry

  // Check if file type bits are already set
  const existingType = mode & constants.S_IFMT
  if (existingType !== 0) {
    // Type bits present - return mode as-is
    return mode
  }

  // Add type bits based on entry.type
  const typeFlag = FILE_TYPE_FLAGS[type]
  return typeFlag !== undefined ? mode | typeFlag : mode
}

// =============================================================================
// Block Calculation
// =============================================================================

/**
 * Calculate the number of 512-byte blocks used by a file.
 *
 * POSIX specifies that st_blocks is the number of 512-byte blocks
 * allocated for the file, not the number of filesystem blocks.
 * This function uses ceiling division to ensure that any partial
 * block is counted as a full block.
 *
 * @param size - File size in bytes
 * @returns Number of 512-byte blocks (st_blocks)
 *
 * @example
 * ```typescript
 * calculateBlocks(0)     // 0 blocks
 * calculateBlocks(1)     // 1 block (partial)
 * calculateBlocks(512)   // 1 block (exact)
 * calculateBlocks(1024)  // 2 blocks
 * ```
 */
export function calculateBlocks(size: number): number {
  if (size <= 0) {
    return 0
  }
  return Math.ceil(size / BLOCKS_UNIT_SIZE)
}

// =============================================================================
// Stats Building
// =============================================================================

/**
 * Options for building Stats objects.
 */
export interface BuildStatsOptions {
  /**
   * Device ID override.
   * @default VIRTUAL_DEV_ID (1)
   */
  dev?: number

  /**
   * Block size override.
   * @default DEFAULT_BLOCK_SIZE (4096)
   */
  blksize?: number

  /**
   * Device ID for special files (block/char devices).
   * @default 0
   */
  rdev?: number
}

/**
 * Build a Stats object from a FileEntry.
 *
 * Converts the internal FileEntry representation to a Node.js-compatible
 * Stats object. This is the primary function for creating Stats objects
 * and is used by stat, lstat, fstat, and FileHandle.stat().
 *
 * The resulting Stats object includes:
 * - Type checking methods (isFile, isDirectory, isSymbolicLink, etc.)
 * - Size and block information
 * - Timestamps (atime, mtime, ctime, birthtime) as Date objects
 * - Timestamp milliseconds (atimeMs, mtimeMs, ctimeMs, birthtimeMs)
 * - Ownership (uid, gid) and permissions (mode)
 * - Inode and device information
 *
 * @param entry - File entry containing metadata
 * @param options - Optional overrides for device ID, block size, etc.
 * @returns Stats object with all metadata
 *
 * @example
 * ```typescript
 * const stats = buildStats(entry)
 * console.log(stats.size)        // File size in bytes
 * console.log(stats.isFile())    // true for regular files
 * console.log(stats.mtime)       // Last modification time as Date
 * ```
 */
export function buildStats(entry: FileEntry, options: BuildStatsOptions = {}): Stats {
  const {
    dev = VIRTUAL_DEV_ID,
    blksize = DEFAULT_BLOCK_SIZE,
    rdev = 0,
  } = options

  return new Stats({
    dev,
    ino: computeInode(entry.id),
    mode: buildMode(entry),
    nlink: entry.nlink,
    uid: entry.uid,
    gid: entry.gid,
    rdev,
    size: entry.size,
    blksize,
    blocks: calculateBlocks(entry.size),
    atimeMs: entry.atime,
    mtimeMs: entry.mtime,
    ctimeMs: entry.ctime,
    birthtimeMs: entry.birthtime,
  })
}

// =============================================================================
// BigInt Support (Foundation for future bigint: true option)
// =============================================================================

/**
 * Timestamp values with BigInt precision.
 *
 * Used when `bigint: true` option is specified in stat operations.
 * Provides nanosecond precision for timestamps.
 */
export interface BigIntTimestamps {
  atimeNs: bigint
  mtimeNs: bigint
  ctimeNs: bigint
  birthtimeNs: bigint
}

/**
 * Convert millisecond timestamps to nanosecond BigInt values.
 *
 * Node.js stat with `bigint: true` returns timestamps in nanoseconds.
 * Since our storage uses milliseconds, we multiply by 1,000,000 to
 * convert to nanoseconds.
 *
 * @param entry - File entry with millisecond timestamps
 * @returns BigInt nanosecond timestamps
 *
 * @example
 * ```typescript
 * const nsTimestamps = toBigIntTimestamps(entry)
 * console.log(nsTimestamps.mtimeNs)  // e.g., 1704067200000000000n
 * ```
 */
export function toBigIntTimestamps(entry: FileEntry): BigIntTimestamps {
  const MS_TO_NS = 1000000n

  return {
    atimeNs: BigInt(entry.atime) * MS_TO_NS,
    mtimeNs: BigInt(entry.mtime) * MS_TO_NS,
    ctimeNs: BigInt(entry.ctime) * MS_TO_NS,
    birthtimeNs: BigInt(entry.birthtime) * MS_TO_NS,
  }
}
