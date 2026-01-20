// File system types for fsx

/**
 * File entry in the virtual filesystem
 */
export interface FileEntry {
  /** Unique ID (inode) */
  id: number
  /** Parent directory ID (null for root) */
  parentId: number | null
  /** File/directory name */
  name: string
  /** Entry type */
  type: 'file' | 'directory' | 'symlink'
  /** File content (for small files) */
  content?: Uint8Array
  /** R2 key for large files */
  r2Key?: string
  /** File size in bytes */
  size: number
  /** Unix permissions mode */
  mode: number
  /** Owner user ID */
  uid: number
  /** Owner group ID */
  gid: number
  /** Created timestamp (ms) */
  createdAt: number
  /** Modified timestamp (ms) */
  modifiedAt: number
  /** Accessed timestamp (ms) */
  accessedAt: number
  /** Symlink target (if type === 'symlink') */
  target?: string
}

/**
 * File stats matching POSIX stat structure
 */
export interface Stats {
  /** Size in bytes */
  size: number
  /** Unix permissions mode */
  mode: number
  /** Owner user ID */
  uid: number
  /** Owner group ID */
  gid: number
  /** Access time */
  atime: Date
  /** Modification time */
  mtime: Date
  /** Creation time */
  ctime: Date
  /** Birth time */
  birthtime: Date

  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/**
 * Directory entry (for readdir with withFileTypes)
 */
export interface Dirent {
  name: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/**
 * Options for mkdir
 */
export interface MkdirOptions {
  /** Create parent directories if needed */
  recursive?: boolean
  /** Directory permissions mode */
  mode?: number
}

/**
 * Options for rmdir
 */
export interface RmdirOptions {
  /** Remove contents recursively */
  recursive?: boolean
}

/**
 * Options for readdir
 */
export interface ReaddirOptions {
  /** Return Dirent objects instead of strings */
  withFileTypes?: boolean
  /** Include subdirectories recursively */
  recursive?: boolean
}

/**
 * Options for reading files
 */
export interface ReadOptions {
  /** Encoding for text output */
  encoding?: BufferEncoding
  /** Start position */
  start?: number
  /** End position */
  end?: number
}

/**
 * Options for writing files
 */
export interface WriteOptions {
  /** File permissions mode */
  mode?: number
  /** File flags (w, a, wx, etc.) */
  flag?: string
  /** Encoding for string input */
  encoding?: BufferEncoding
}

/**
 * Encoding types
 */
export type BufferEncoding = 'utf-8' | 'utf8' | 'base64' | 'binary' | 'hex'

/**
 * File open flags
 */
export const O_RDONLY = 0
export const O_WRONLY = 1
export const O_RDWR = 2
export const O_CREAT = 64
export const O_EXCL = 128
export const O_TRUNC = 512
export const O_APPEND = 1024

/**
 * Permission constants
 */
export const S_IFREG = 0o100000  // Regular file
export const S_IFDIR = 0o040000  // Directory
export const S_IFLNK = 0o120000  // Symbolic link

/**
 * Access constants
 */
export const F_OK = 0  // File existence
export const R_OK = 4  // Read permission
export const W_OK = 2  // Write permission
export const X_OK = 1  // Execute permission

/**
 * Copy constants
 */
export const COPYFILE_EXCL = 1
