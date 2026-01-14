/**
 * Types for npm tarball handling
 *
 * Supports USTAR and PAX extended headers
 */

/**
 * Entry type in a tar archive
 */
export type TarEntryType =
  | 'file'
  | 'directory'
  | 'symlink'
  | 'hardlink'
  | 'pax-global'
  | 'pax-extended'
  | 'character-device'
  | 'block-device'
  | 'fifo'
  | 'contiguous'
  | 'gnu-longname'
  | 'gnu-longlink'
  | 'unknown'

/**
 * Sparse file region
 */
export interface SparseRegion {
  offset: number
  size: number
}

/**
 * Parsed tar header
 */
export interface TarHeader {
  /** File name (up to 100 chars, or combined with prefix) */
  name: string
  /** File mode (permissions) */
  mode: number
  /** Owner user ID */
  uid: number
  /** Owner group ID */
  gid: number
  /** File size in bytes */
  size: number
  /** Modification time */
  mtime: Date
  /** Entry type */
  type: TarEntryType
  /** Link target for symlinks/hardlinks */
  linkname: string
  /** Tar format: 'ustar', 'pax', 'gnu', 'v7', or 'unknown' */
  format: 'ustar' | 'pax' | 'gnu' | 'v7' | 'unknown'
  /** USTAR version (usually '00') */
  version: string
  /** Owner user name */
  uname: string
  /** Owner group name */
  gname: string
  /** Device major number (for device files) */
  devmajor: number
  /** Device minor number (for device files) */
  devminor: number
  /** USTAR prefix for long paths (up to 155 chars) */
  prefix: string
  /** Full path (prefix + name) */
  fullPath: string
  /** Whether the checksum is valid */
  checksumValid: boolean
  /** Whether this is a null block (end of archive) */
  isNullBlock: boolean
}

/**
 * Extracted tar entry with content
 */
export interface TarEntry {
  /** Normalized file name (after prefix stripping) */
  name: string
  /** Entry type */
  type: TarEntryType
  /** File mode (permissions) */
  mode: number
  /** Owner user ID */
  uid: number
  /** Owner group ID */
  gid: number
  /** File size in bytes */
  size: number
  /** Modification time */
  mtime: Date
  /** File content (empty for directories/symlinks) */
  content: Uint8Array
  /** Link target for symlinks/hardlinks */
  linkname?: string
  /** Sparse file regions */
  sparse?: SparseRegion[]
}

/**
 * Virtual filesystem interface for extraction
 */
export interface VirtualFS {
  writeFileSync(path: string, content: Uint8Array, options?: { mode?: number }): void
  mkdirSync?(path: string, options?: { recursive?: boolean }): void
  symlinkSync?(target: string, path: string): void
  existsSync(path: string): boolean
}

/**
 * Options for tarball extraction
 */
export interface ExtractOptions {
  /** Number of path components to strip from the beginning (default: 0) */
  stripPrefix?: number
  /** Virtual filesystem to extract to */
  output?: VirtualFS
  /** Enable security checks (path traversal, symlink escape) */
  secure?: boolean
  /** Progress callback */
  onProgress?: (entry: TarEntry, bytesProcessed: number) => void
  /** Start offset for resumable extraction */
  startOffset?: number
  /** Maximum number of entries to extract */
  limit?: number
}

/**
 * Options for tarball creation
 */
export interface CreateOptions {
  /** Prefix to add to all paths (e.g., 'package/') */
  prefix?: string
  /** File modes map (path -> mode) */
  modes?: Map<string, number>
  /** File sizes map for large files (path -> size) */
  sizes?: Map<string, number>
  /** Virtual filesystem source for directory-based creation */
  source?: VirtualFS & {
    readdirSync?(path: string): string[]
    statSync?(path: string): { isDirectory(): boolean; size: number; mode: number }
    readFileSync?(path: string): Uint8Array
  }
  /** Callback when tarball creation is complete */
  onComplete?: (hash: IntegrityHash) => void
}

/**
 * Integrity hash string (e.g., 'sha512-...')
 */
export type IntegrityHash = string

/**
 * Supported hash algorithms
 */
export type HashAlgorithm = 'sha512' | 'sha256' | 'sha1'

/**
 * PAX extended header key-value pair
 */
export interface PaxExtendedHeader {
  path?: string
  linkpath?: string
  size?: number
  uid?: number
  gid?: number
  uname?: string
  gname?: string
  mtime?: number
  atime?: number
  ctime?: number
  [key: string]: string | number | undefined
}

/**
 * Constants for tar format
 */
export const TAR_BLOCK_SIZE = 512
export const GZIP_MAGIC = new Uint8Array([0x1f, 0x8b])

/**
 * Type flag characters
 */
export const TYPE_FLAGS = {
  FILE: 0x30,           // '0' or NUL
  HARDLINK: 0x31,       // '1'
  SYMLINK: 0x32,        // '2'
  CHAR_DEVICE: 0x33,    // '3'
  BLOCK_DEVICE: 0x34,   // '4'
  DIRECTORY: 0x35,      // '5'
  FIFO: 0x36,           // '6'
  CONTIGUOUS: 0x37,     // '7'
  PAX_EXTENDED: 0x78,   // 'x'
  PAX_GLOBAL: 0x67,     // 'g'
  GNU_LONGNAME: 0x4c,   // 'L'
  GNU_LONGLINK: 0x4b,   // 'K'
} as const
