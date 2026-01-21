/**
 * Type declarations for fsx.do module
 *
 * This provides type declarations for the fsx.do package which is
 * a managed filesystem service built on Cloudflare Durable Objects.
 *
 * @module fsx.do
 */

declare module 'fsx.do' {
  // ===========================================================================
  // Hash Functions
  // ===========================================================================

  /**
   * Compute SHA-1 hash of data
   * @param data - Input data as Uint8Array or string (UTF-8 encoded)
   * @returns 40-character lowercase hex string
   */
  export function sha1(data: Uint8Array | string): Promise<string>

  /**
   * Compute SHA-256 hash of data
   * @param data - Input data as Uint8Array or string (UTF-8 encoded)
   * @returns 64-character lowercase hex string
   */
  export function sha256(data: Uint8Array | string): Promise<string>

  /**
   * Convert a Uint8Array to a hexadecimal string.
   * @param bytes - Binary data to convert
   * @returns Lowercase hexadecimal string
   */
  export function bytesToHex(bytes: Uint8Array): string

  /**
   * Convert a hexadecimal string to a Uint8Array.
   * @param hex - Hexadecimal string (case-insensitive)
   * @returns Binary data as Uint8Array
   */
  export function hexToBytes(hex: string): Uint8Array

  // ===========================================================================
  // Storage Tier Types
  // ===========================================================================

  /**
   * Storage tier for tiered filesystem operations.
   */
  export type StorageTier = 'hot' | 'warm' | 'cold'

  /**
   * Type of the filesystem entry.
   */
  export type FileType = 'file' | 'directory' | 'symlink' | 'block' | 'character' | 'fifo' | 'socket'

  /**
   * Buffer encoding types supported by read/write operations.
   */
  export type BufferEncoding =
    | 'ascii'
    | 'utf8'
    | 'utf-8'
    | 'utf16le'
    | 'ucs2'
    | 'ucs-2'
    | 'base64'
    | 'base64url'
    | 'latin1'
    | 'binary'
    | 'hex'

  // ===========================================================================
  // Options Types
  // ===========================================================================

  /**
   * Options for file read operations.
   */
  export interface ReadOptions {
    /** Character encoding for string output. */
    encoding?: BufferEncoding | null | undefined
    /** File open flag (default: 'r' for read) */
    flag?: string
    /** Start byte position for range reads (inclusive) */
    start?: number
    /** End byte position for range reads (inclusive) */
    end?: number
    /** Abort signal for cancellation support */
    signal?: AbortSignal
    /** High water mark for streaming reads (buffer size in bytes) */
    highWaterMark?: number
  }

  /**
   * Options for directory listing operations.
   */
  export interface ListOptions {
    /** Return Dirent objects instead of just file names. */
    withFileTypes?: boolean
    /** Recursively list all files and directories. */
    recursive?: boolean
    /** Include full file statistics with each entry. */
    withStats?: boolean
    /** Character encoding for file names (default: 'utf-8') */
    encoding?: BufferEncoding
    /** Abort signal for cancellation support */
    signal?: AbortSignal
    /** Maximum depth for recursive listing (default: unlimited) */
    maxDepth?: number
    /** Filter pattern (glob) to match file names */
    filter?: string
  }

  /**
   * Options for file write operations.
   */
  export interface WriteOptions {
    /** Character encoding for string data. */
    encoding?: BufferEncoding | null
    /** File mode (permissions) */
    mode?: number
    /** File open flag (e.g., 'w', 'a', 'wx') */
    flag?: string
    /** Target storage tier */
    tier?: StorageTier
  }

  // ===========================================================================
  // Stats Class
  // ===========================================================================

  /**
   * File statistics class, compatible with Node.js fs.Stats.
   */
  export class Stats {
    readonly dev: number
    readonly ino: number
    readonly mode: number
    readonly nlink: number
    readonly uid: number
    readonly gid: number
    readonly rdev: number
    readonly size: number
    readonly blksize: number
    readonly blocks: number
    readonly atimeMs: number
    readonly mtimeMs: number
    readonly ctimeMs: number
    readonly birthtimeMs: number

    get atime(): Date
    get mtime(): Date
    get ctime(): Date
    get birthtime(): Date

    isFile(): boolean
    isDirectory(): boolean
    isSymbolicLink(): boolean
    isBlockDevice(): boolean
    isCharacterDevice(): boolean
    isFIFO(): boolean
    isSocket(): boolean
  }

  // ===========================================================================
  // Dirent Class
  // ===========================================================================

  /**
   * Directory entry class, compatible with Node.js fs.Dirent.
   */
  export class Dirent {
    readonly name: string
    readonly parentPath: string
    get path(): string

    isFile(): boolean
    isDirectory(): boolean
    isSymbolicLink(): boolean
    isBlockDevice(): boolean
    isCharacterDevice(): boolean
    isFIFO(): boolean
    isSocket(): boolean
  }

  // ===========================================================================
  // FsCapability Interface
  // ===========================================================================

  /**
   * Filesystem capability interface.
   * Provides POSIX-like filesystem operations.
   */
  export interface FsCapability {
    /**
     * Read the entire contents of a file.
     */
    read(path: string, options?: ReadOptions): Promise<string | Uint8Array>

    /**
     * Write data to a file, creating it if it doesn't exist.
     */
    write(path: string, data: string | Uint8Array, options?: WriteOptions): Promise<void>

    /**
     * Append data to a file, creating it if it doesn't exist.
     */
    append(path: string, data: string | Uint8Array): Promise<void>

    /**
     * List directory contents.
     */
    list(path: string, options?: ListOptions): Promise<string[] | Dirent[]>

    /**
     * Get file or directory statistics.
     */
    stat(path: string): Promise<Stats>

    /**
     * Get file or directory statistics (does not follow symlinks).
     */
    lstat(path: string): Promise<Stats>

    /**
     * Check if a file or directory exists.
     */
    exists(path: string): Promise<boolean>

    /**
     * Create a directory.
     */
    mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>

    /**
     * Remove a directory.
     */
    rmdir(path: string, options?: { recursive?: boolean }): Promise<void>

    /**
     * Remove a file.
     */
    unlink(path: string): Promise<void>

    /**
     * Remove a file or directory.
     */
    remove(path: string, options?: { recursive?: boolean }): Promise<void>

    /**
     * Rename/move a file or directory.
     */
    rename(oldPath: string, newPath: string): Promise<void>

    /**
     * Copy a file.
     */
    copy(src: string, dest: string, options?: { overwrite?: boolean }): Promise<void>
  }
}
