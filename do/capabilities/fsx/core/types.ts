/**
 * Core filesystem types
 *
 * This module defines the comprehensive TypeScript interfaces for the fsx.do
 * filesystem capability. These types provide a POSIX-like API for filesystem
 * operations on Cloudflare Durable Objects with tiered storage support.
 *
 * @module core/types
 */

import { constants } from './constants'

// =============================================================================
// Storage Tier Types
// =============================================================================

/**
 * Storage tier for tiered filesystem operations.
 *
 * fsx.do supports automatic placement of files across different storage tiers
 * based on file size, access patterns, and cost optimization requirements.
 *
 * - `hot`: Durable Object SQLite storage - low latency, ideal for small files (<1MB)
 * - `warm`: R2 object storage - balanced performance, suitable for large files
 * - `cold`: Archive storage - lowest cost, for infrequently accessed data
 *
 * @example
 * ```typescript
 * const tier: StorageTier = 'hot'
 *
 * // Tier selection based on file size
 * function selectTier(size: number): StorageTier {
 *   if (size < 1024 * 1024) return 'hot'
 *   if (size < 100 * 1024 * 1024) return 'warm'
 *   return 'cold'
 * }
 * ```
 */
export type StorageTier = 'hot' | 'warm' | 'cold'

// =============================================================================
// File Statistics Types
// =============================================================================

/**
 * Simplified file/directory statistics interface.
 *
 * This interface provides essential metadata about a file or directory,
 * suitable for most filesystem operations. For full POSIX-compatible
 * statistics, use the {@link Stats} class.
 *
 * @example
 * ```typescript
 * const stat: FileStat = {
 *   size: 1024,
 *   mtime: Date.now(),
 *   ctime: Date.now(),
 *   birthtime: Date.now(),
 *   mode: 0o644,
 *   type: 'file',
 *   tier: 'hot'
 * }
 * ```
 */
export interface FileStat {
  /** File size in bytes */
  size: number

  /** Last modification time in milliseconds since epoch */
  mtime: number

  /** Last status change time (metadata) in milliseconds since epoch */
  ctime: number

  /** Creation time in milliseconds since epoch */
  birthtime: number

  /** File mode (permissions) as octal number (e.g., 0o644) */
  mode: number

  /** Type of the filesystem entry */
  type: FileType

  /**
   * Storage tier where the file content is stored.
   * Only applicable to regular files.
   */
  tier?: StorageTier

  /** User ID of the file owner */
  uid?: number

  /** Group ID of the file owner */
  gid?: number

  /** Number of hard links to this file */
  nlink?: number
}

// =============================================================================
// Operation Options Types
// =============================================================================

/**
 * Options for file read operations.
 *
 * Controls how file content is read and returned, including encoding,
 * range reads, and abort signal for cancellation.
 *
 * @example
 * ```typescript
 * // Read as UTF-8 string
 * const opts: ReadOptions = { encoding: 'utf-8' }
 *
 * // Read bytes 1000-2000 of a file
 * const rangeOpts: ReadOptions = {
 *   start: 1000,
 *   end: 2000
 * }
 *
 * // Read with abort support
 * const controller = new AbortController()
 * const abortOpts: ReadOptions = { signal: controller.signal }
 * ```
 */
export interface ReadOptions {
  /**
   * Character encoding for string output.
   * If specified, returns a string. If null or undefined, returns Uint8Array.
   */
  encoding?: BufferEncoding | null

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
 * Options for file write operations.
 *
 * Controls how file content is written, including encoding, permissions,
 * and write mode (overwrite, append, exclusive).
 *
 * @example
 * ```typescript
 * // Write with specific permissions
 * const opts: WriteOptions = {
 *   mode: 0o600, // Owner read/write only
 *   encoding: 'utf-8'
 * }
 *
 * // Append to existing file
 * const appendOpts: WriteOptions = { flag: 'a' }
 *
 * // Exclusive write (fail if file exists)
 * const exclusiveOpts: WriteOptions = { flag: 'wx' }
 * ```
 */
export interface WriteOptions {
  /**
   * Character encoding for string data.
   * Defaults to 'utf-8'.
   */
  encoding?: BufferEncoding

  /**
   * File mode (permissions) for newly created files.
   * Defaults to 0o644 (rw-r--r--).
   */
  mode?: number

  /**
   * File system flag controlling write behavior:
   * - 'w': Write (default) - create or truncate
   * - 'a': Append - create or append
   * - 'wx': Exclusive write - fail if file exists
   * - 'ax': Exclusive append - fail if file exists
   */
  flag?: string

  /** Abort signal for cancellation support */
  signal?: AbortSignal

  /**
   * Target storage tier for the file.
   * If not specified, tier is automatically selected based on file size.
   */
  tier?: StorageTier

  /** Flush data to storage immediately (default: false) */
  flush?: boolean
}

/**
 * Options for directory listing operations.
 *
 * Controls how directory contents are returned, including recursive
 * traversal and metadata inclusion.
 *
 * @example
 * ```typescript
 * // Simple file name listing
 * const names = await fs.list('/src')
 *
 * // Get full entry details
 * const opts: ListOptions = { withFileTypes: true }
 * const entries = await fs.list('/src', opts)
 *
 * // Recursive listing with stats
 * const recursiveOpts: ListOptions = {
 *   recursive: true,
 *   withStats: true
 * }
 * ```
 */
export interface ListOptions {
  /**
   * Return Dirent objects instead of just file names.
   * When true, each entry includes name, type, and path.
   */
  withFileTypes?: boolean

  /**
   * Recursively list all files and directories.
   * When true, traverses into subdirectories.
   */
  recursive?: boolean

  /**
   * Include full file statistics with each entry.
   * Provides size, mtime, mode, etc. for each file.
   */
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
 * Options for copy operations.
 *
 * Controls file copy behavior including overwrite handling
 * and metadata preservation.
 */
export interface CopyOptions {
  /**
   * Overwrite destination if it exists.
   * When false, throws EEXIST if destination exists.
   */
  overwrite?: boolean

  /** Preserve file timestamps (atime, mtime) */
  preserveTimestamps?: boolean

  /** Recursive copy for directories */
  recursive?: boolean

  /** Error behavior when overwrite is false */
  errorOnExist?: boolean
}

/**
 * Options for move/rename operations.
 */
export interface MoveOptions {
  /** Overwrite destination if it exists */
  overwrite?: boolean
}

/**
 * Options for remove operations.
 */
export interface RemoveOptions {
  /** Remove directories and their contents recursively */
  recursive?: boolean

  /** Ignore errors if path does not exist */
  force?: boolean

  /** Maximum number of retries on failure */
  maxRetries?: number

  /** Delay between retries in milliseconds */
  retryDelay?: number
}

// =============================================================================
// Directory Entry Types
// =============================================================================

/**
 * File mode representing POSIX permissions and file type bits.
 *
 * The mode is a bitmask containing:
 * - File type bits (S_IFMT mask): identifies the type of file
 * - Special bits (setuid, setgid, sticky): special permissions
 * - Permission bits: owner, group, and other read/write/execute
 *
 * Common values:
 * - `0o644` (rw-r--r--): Standard file permissions
 * - `0o755` (rwxr-xr-x): Executable file or directory
 * - `0o600` (rw-------): Private file
 *
 * @example
 * ```typescript
 * // Standard file permissions
 * const regularFile: FileMode = 0o100644  // Type + permissions
 *
 * // Just permissions (used with chmod)
 * const permissions: FileMode = 0o755
 *
 * // Check if writable by owner
 * const isOwnerWritable = (mode & 0o200) !== 0
 * ```
 *
 * @see {@link constants} for individual bit definitions
 */
export type FileMode = number

/**
 * Type of filesystem entry.
 *
 * Represents the different types of filesystem objects that can exist:
 * - `'file'` - Regular file containing data
 * - `'directory'` - Directory containing other entries
 * - `'symlink'` - Symbolic link pointing to another path
 * - `'block'` - Block device (e.g., disk)
 * - `'character'` - Character device (e.g., terminal)
 * - `'fifo'` - FIFO/named pipe for IPC
 * - `'socket'` - Unix domain socket
 *
 * @example
 * ```typescript
 * function handleEntry(type: FileType): void {
 *   switch (type) {
 *     case 'file':
 *       console.log('Processing file...')
 *       break
 *     case 'directory':
 *       console.log('Processing directory...')
 *       break
 *     // ... other cases
 *   }
 * }
 * ```
 */
export type FileType = 'file' | 'directory' | 'symlink' | 'block' | 'character' | 'fifo' | 'socket'

/**
 * Initialization properties for creating a Stats instance.
 *
 * Contains all the raw numeric values needed to construct a Stats object.
 * Timestamps are specified in milliseconds since Unix epoch to allow
 * sub-second precision.
 *
 * @example
 * ```typescript
 * const init: StatsInit = {
 *   dev: 2114,
 *   ino: 48064969,
 *   mode: 0o100644,  // Regular file with rw-r--r--
 *   nlink: 1,
 *   uid: 1000,
 *   gid: 1000,
 *   rdev: 0,
 *   size: 1024,
 *   blksize: 4096,
 *   blocks: 8,
 *   atimeMs: Date.now(),
 *   mtimeMs: Date.now(),
 *   ctimeMs: Date.now(),
 *   birthtimeMs: Date.now(),
 * }
 * const stats = new Stats(init)
 * ```
 */
export interface StatsInit {
  /** Device ID containing the file */
  dev: number
  /** Inode number (unique identifier within filesystem) */
  ino: number
  /** File mode (permissions and file type bits) */
  mode: number
  /** Number of hard links to the file */
  nlink: number
  /** User ID of the file owner */
  uid: number
  /** Group ID of the file owner */
  gid: number
  /** Device ID (for special files like block/character devices) */
  rdev: number
  /** File size in bytes */
  size: number
  /** Preferred block size for I/O operations */
  blksize: number
  /** Number of 512-byte blocks allocated */
  blocks: number
  /** Last access time in milliseconds since epoch */
  atimeMs: number
  /** Last modification time in milliseconds since epoch */
  mtimeMs: number
  /** Last status change time in milliseconds since epoch */
  ctimeMs: number
  /** Creation (birth) time in milliseconds since epoch */
  birthtimeMs: number
}

/**
 * POSIX-compatible file statistics class.
 *
 * Provides comprehensive metadata about a filesystem entry, including
 * size, timestamps, permissions, and type information. Compatible with
 * Node.js `fs.Stats` for easy migration.
 *
 * The type checking methods (`isFile()`, `isDirectory()`, etc.) use
 * bitwise operations on the mode field to determine the file type
 * according to POSIX standards.
 *
 * @example
 * ```typescript
 * const stats = await fs.stat('/path/to/file')
 *
 * // Check type
 * if (stats.isFile()) {
 *   console.log(`File size: ${stats.size} bytes`)
 * }
 *
 * // Access timestamps
 * console.log(`Last modified: ${stats.mtime}`)
 * console.log(`Created: ${stats.birthtime}`)
 *
 * // Check permissions via mode
 * const isReadable = (stats.mode & 0o444) !== 0
 * ```
 *
 * @see {@link StatsInit} for constructor properties
 * @see {@link constants} for mode bit definitions
 */
export class Stats {
  /** Device ID */
  readonly dev: number
  /** Inode number */
  readonly ino: number
  /** File mode (permissions + type) */
  readonly mode: number
  /** Number of hard links */
  readonly nlink: number
  /** User ID */
  readonly uid: number
  /** Group ID */
  readonly gid: number
  /** Device ID (if special file) */
  readonly rdev: number
  /** File size in bytes */
  readonly size: number
  /** Block size */
  readonly blksize: number
  /** Number of blocks */
  readonly blocks: number
  /** Access time in ms */
  readonly atimeMs: number
  /** Modification time in ms */
  readonly mtimeMs: number
  /** Change time (metadata) in ms */
  readonly ctimeMs: number
  /** Birth time (creation) in ms */
  readonly birthtimeMs: number

  constructor(init: StatsInit) {
    this.dev = init.dev
    this.ino = init.ino
    this.mode = init.mode
    this.nlink = init.nlink
    this.uid = init.uid
    this.gid = init.gid
    this.rdev = init.rdev
    this.size = init.size
    this.blksize = init.blksize
    this.blocks = init.blocks
    this.atimeMs = init.atimeMs
    this.mtimeMs = init.mtimeMs
    this.ctimeMs = init.ctimeMs
    this.birthtimeMs = init.birthtimeMs
  }

  /** Access time */
  get atime(): Date {
    return new Date(this.atimeMs)
  }

  /** Modification time */
  get mtime(): Date {
    return new Date(this.mtimeMs)
  }

  /** Change time (metadata) */
  get ctime(): Date {
    return new Date(this.ctimeMs)
  }

  /** Birth time (creation) */
  get birthtime(): Date {
    return new Date(this.birthtimeMs)
  }

  /** Is regular file */
  isFile(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFREG
  }

  /** Is directory */
  isDirectory(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFDIR
  }

  /** Is symbolic link */
  isSymbolicLink(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFLNK
  }

  /** Is block device */
  isBlockDevice(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFBLK
  }

  /** Is character device */
  isCharacterDevice(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFCHR
  }

  /** Is FIFO (named pipe) */
  isFIFO(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFIFO
  }

  /** Is socket */
  isSocket(): boolean {
    return (this.mode & constants.S_IFMT) === constants.S_IFSOCK
  }
}

/**
 * Dirent type (alias for FileType for backward compatibility).
 * @deprecated Use FileType instead.
 */
export type DirentType = FileType

/**
 * Directory entry class representing a filesystem entry in a directory listing.
 *
 * Similar to Node.js `fs.Dirent`, this class provides metadata about directory
 * entries including name, parent path, and type information. Type checking
 * methods allow runtime identification of entry types.
 *
 * @example
 * ```typescript
 * const entries = await fs.readdir('/home/user', { withFileTypes: true })
 * for (const entry of entries) {
 *   if (entry.isFile()) {
 *     console.log(`File: ${entry.path}`)
 *   } else if (entry.isDirectory()) {
 *     console.log(`Directory: ${entry.path}`)
 *   }
 * }
 * ```
 */
export class Dirent {
  /** Entry name (filename without path) */
  readonly name: string
  /** Parent directory path */
  readonly parentPath: string
  /** Entry type stored internally */
  private readonly _type: FileType

  /**
   * Create a new directory entry.
   *
   * @param name - The entry name (filename only, no path)
   * @param parentPath - The parent directory path
   * @param type - The type of filesystem entry
   */
  constructor(name: string, parentPath: string, type: FileType) {
    this.name = name
    this.parentPath = parentPath
    this._type = type
  }

  /** Full path */
  get path(): string {
    if (this.parentPath.endsWith('/')) {
      return this.parentPath + this.name
    }
    return this.parentPath + '/' + this.name
  }

  /** Is regular file */
  isFile(): boolean {
    return this._type === 'file'
  }

  /** Is directory */
  isDirectory(): boolean {
    return this._type === 'directory'
  }

  /** Is symbolic link */
  isSymbolicLink(): boolean {
    return this._type === 'symlink'
  }

  /** Is block device */
  isBlockDevice(): boolean {
    return this._type === 'block'
  }

  /** Is character device */
  isCharacterDevice(): boolean {
    return this._type === 'character'
  }

  /** Is FIFO */
  isFIFO(): boolean {
    return this._type === 'fifo'
  }

  /** Is socket */
  isSocket(): boolean {
    return this._type === 'socket'
  }
}

/**
 * Interface describing an object with Stats-like behavior.
 *
 * This interface is used internally by FileHandle to track file metadata
 * without requiring a full Stats instance. It provides the same properties
 * and type-checking methods as Stats.
 *
 * Objects implementing this interface can be used wherever stat information
 * is needed, enabling duck-typing compatibility.
 *
 * @example
 * ```typescript
 * function processStats(stats: StatsLike): void {
 *   if (stats.isFile() && stats.size > 0) {
 *     console.log(`Processing ${stats.size} bytes`)
 *   }
 * }
 * ```
 */
export interface StatsLike {
  /** Device ID containing the file */
  dev: number
  /** Inode number */
  ino: number
  /** File mode (permissions and type) */
  mode: number
  /** Number of hard links */
  nlink: number
  /** User ID of owner */
  uid: number
  /** Group ID of owner */
  gid: number
  /** Device ID (for special files) */
  rdev: number
  /** File size in bytes */
  size: number
  /** Preferred block size for I/O */
  blksize: number
  /** Number of blocks allocated */
  blocks: number
  /** Last access time */
  atime: Date
  /** Last modification time */
  mtime: Date
  /** Last status change time */
  ctime: Date
  /** Creation time */
  birthtime: Date
  /** Returns true if this is a regular file */
  isFile(): boolean
  /** Returns true if this is a directory */
  isDirectory(): boolean
  /** Returns true if this is a symbolic link */
  isSymbolicLink(): boolean
  /** Returns true if this is a block device */
  isBlockDevice(): boolean
  /** Returns true if this is a character device */
  isCharacterDevice(): boolean
  /** Returns true if this is a FIFO (named pipe) */
  isFIFO(): boolean
  /** Returns true if this is a Unix socket */
  isSocket(): boolean
}

/**
 * File handle for open files.
 *
 * Provides a low-level interface for file operations with proper tracking of
 * dirty state and POSIX-compliant sync semantics. The handle supports both
 * sequential and positioned I/O operations.
 *
 * Key features:
 * - **Dirty tracking**: Efficiently tracks whether data needs syncing
 * - **Sync vs datasync**: Supports both full sync (data + metadata) and datasync (data only)
 * - **Position management**: Tracks current file position for sequential operations
 * - **Access mode enforcement**: Respects read/write/append flags from open()
 *
 * @example
 * ```typescript
 * const handle = await fs.open('/file.txt', 'r+')
 * await handle.write('data')
 * await handle.sync()  // Flush data and metadata
 * await handle.close()
 * ```
 */
export class FileHandle {
  /** File descriptor number (3+ for user files; 0-2 reserved for stdin/stdout/stderr) */
  readonly fd: number
  /** Internal data buffer containing file contents */
  private _data: Uint8Array
  /** Internal stats cache (includes size, timestamps, etc.) */
  private _stats: StatsLike
  /** Whether the handle has been closed */
  private _closed: boolean = false
  /** Current file position for sequential read/write operations */
  private _position: number = 0
  /** Whether this handle is in append mode (O_APPEND) */
  _appendMode: boolean = false
  /** Whether this handle permits write operations */
  _writable: boolean = true
  /** Whether this handle permits read operations */
  _readable: boolean = true
  /**
   * Dirty flag for efficient sync tracking.
   * Set to true when data has been modified since last sync.
   * Allows sync() to be a no-op when no changes have been made.
   */
  private _dirty: boolean = false

  constructor(fd: number, data: Uint8Array, stats: StatsLike) {
    this.fd = fd
    this._data = data
    this._stats = stats
  }

  /**
   * Ensure the file handle is still open.
   * @throws {Error} EBADF if handle has been closed
   */
  private _ensureOpen(): void {
    if (this._closed) {
      const error = new Error('EBADF: bad file descriptor - handle is closed') as Error & { code: string }
      error.code = 'EBADF'
      throw error
    }
  }

  /**
   * Create an Error with an errno code property.
   * Centralizes error creation for consistent error handling across read/write operations.
   *
   * @param code - POSIX errno code (e.g., 'EBADF', 'EINVAL')
   * @param message - Human-readable error message
   * @returns Error object with code property set
   */
  private _createErrnoError(code: string, message: string): Error & { code: string } {
    const error = new Error(`${code}: ${message}`) as Error & { code: string }
    error.code = code
    return error
  }

  /**
   * Validate that a numeric parameter is non-negative.
   * Throws EINVAL if the value is negative.
   *
   * @param value - The value to validate
   * @param paramName - Name of the parameter for error messages
   * @throws {Error} EINVAL if value is negative
   */
  private _validateNonNegative(value: number | undefined, paramName: string): void {
    if (value !== undefined && value < 0) {
      throw this._createErrnoError('EINVAL', `invalid argument, ${paramName} cannot be negative`)
    }
  }

  /**
   * Build a new StatsLike object with updated size and timestamps.
   * This helper promotes code reuse across stat(), truncate(), and write operations.
   *
   * @param options - Optional overrides for mtime and ctime
   * @returns A new StatsLike object reflecting current file state
   */
  private _buildStatsLike(options?: { mtime?: Date; ctime?: Date }): StatsLike {
    const oldStats = this._stats
    const currentSize = this._data.length
    const blockSize = oldStats.blksize
    const blocks = blockSize > 0 ? Math.ceil(currentSize / blockSize) : 0

    return {
      dev: oldStats.dev,
      ino: oldStats.ino,
      mode: oldStats.mode,
      nlink: oldStats.nlink,
      uid: oldStats.uid,
      gid: oldStats.gid,
      rdev: oldStats.rdev,
      size: currentSize,
      blksize: blockSize,
      blocks: blocks,
      atime: oldStats.atime,
      mtime: options?.mtime ?? oldStats.mtime,
      ctime: options?.ctime ?? oldStats.ctime,
      birthtime: oldStats.birthtime,
      isFile: () => oldStats.isFile(),
      isDirectory: () => oldStats.isDirectory(),
      isSymbolicLink: () => oldStats.isSymbolicLink(),
      isBlockDevice: () => oldStats.isBlockDevice(),
      isCharacterDevice: () => oldStats.isCharacterDevice(),
      isFIFO: () => oldStats.isFIFO(),
      isSocket: () => oldStats.isSocket(),
    }
  }

  /**
   * Read from file into buffer.
   *
   * Reads data from the file starting at `position` (or current file position if not specified)
   * into `buffer` starting at `offset`. The number of bytes read is the minimum of:
   * - `length` (or available buffer space if not specified)
   * - Available space in buffer after offset
   * - Remaining bytes in file from read position
   *
   * @param buffer - Buffer to read data into (must be Uint8Array)
   * @param offset - Offset in buffer to start writing at (default: 0)
   * @param length - Maximum number of bytes to read (default: buffer.length - offset)
   * @param position - File position to read from. If undefined, uses and advances internal position.
   *                   If specified, does not modify internal position (absolute read).
   * @returns Object with bytesRead count and the same buffer reference
   *
   * @throws {Error} EBADF if handle is closed or not readable
   * @throws {TypeError} If buffer is not a Uint8Array
   * @throws {Error} EINVAL if offset, length, or position is negative
   * @throws {RangeError} If offset exceeds buffer length
   */
  async read(
    buffer: Uint8Array,
    offset: number = 0,
    length?: number,
    position?: number
  ): Promise<{ bytesRead: number; buffer: Uint8Array }> {
    // --- Precondition checks ---
    this._ensureOpen()
    this._ensureReadable()
    this._validateBuffer(buffer)
    this._validateReadParams(buffer, offset, length, position)

    // --- Determine read position ---
    // Absolute read (position specified): read from position, don't update internal position
    // Sequential read (position undefined): read from internal position, advance it after
    const isSequentialRead = position === undefined
    const readPosition = isSequentialRead ? this._position : position

    // --- Calculate bytes to read ---
    const bytesToRead = this._calculateBytesToRead(buffer, offset, length, readPosition)

    // Early return for EOF or zero-length reads
    if (bytesToRead === 0) {
      return { bytesRead: 0, buffer }
    }

    // --- Perform the read using efficient subarray copy ---
    const sourceSlice = this._data.subarray(readPosition, readPosition + bytesToRead)
    buffer.set(sourceSlice, offset)

    // --- Update position for sequential reads ---
    if (isSequentialRead) {
      this._position += bytesToRead
    }

    return { bytesRead: bytesToRead, buffer }
  }

  /**
   * Ensure the handle is readable.
   * @throws {Error} EBADF if handle was opened write-only
   */
  private _ensureReadable(): void {
    if (!this._readable) {
      throw this._createErrnoError('EBADF', 'bad file descriptor, read - not readable')
    }
  }

  /**
   * Validate that buffer is a valid Uint8Array.
   * @throws {TypeError} If buffer is null, undefined, or not a Uint8Array
   */
  private _validateBuffer(buffer: unknown): asserts buffer is Uint8Array {
    if (buffer === null || buffer === undefined || !(buffer instanceof Uint8Array)) {
      throw new TypeError('The "buffer" argument must be of type Uint8Array')
    }
  }

  /**
   * Validate read() parameters.
   * @throws {Error} EINVAL for negative offset, length, or position
   * @throws {RangeError} If offset exceeds buffer bounds
   */
  private _validateReadParams(
    buffer: Uint8Array,
    offset: number,
    length: number | undefined,
    position: number | undefined
  ): void {
    // Validate offset
    this._validateNonNegative(offset, 'offset')
    if (offset > buffer.length) {
      throw new RangeError('The value of "offset" is out of range')
    }

    // Validate length and position
    this._validateNonNegative(length, 'length')
    this._validateNonNegative(position, 'position')
  }

  /**
   * Calculate the actual number of bytes to read.
   *
   * Takes the minimum of:
   * 1. Requested length (or available buffer space if not specified)
   * 2. Remaining buffer capacity after offset
   * 3. Remaining file bytes from read position
   *
   * @returns Number of bytes to read (0 if at/past EOF or no capacity)
   */
  private _calculateBytesToRead(
    buffer: Uint8Array,
    offset: number,
    length: number | undefined,
    readPosition: number
  ): number {
    // Check for EOF
    const fileSize = this._data.length
    if (readPosition >= fileSize) {
      return 0
    }

    const bufferCapacity = buffer.length - offset
    const remainingInFile = fileSize - readPosition
    const requestedLength = length ?? bufferCapacity

    // Return the minimum of all constraints, ensuring non-negative
    return Math.max(0, Math.min(requestedLength, bufferCapacity, remainingInFile))
  }

  /**
   * Write data to the file.
   *
   * Supports writing strings, Uint8Array buffers, or ArrayBuffers to the file.
   * For buffer writes, optional offset and length parameters allow writing
   * a portion of the source buffer.
   *
   * @param data - Data to write (string, Uint8Array, or ArrayBuffer)
   * @param position - File position to write at. If null, uses current position.
   *                   If undefined (for buffers), defaults to 0.
   * @param length - For buffer writes: number of bytes to write from buffer
   * @param offset - For buffer writes: offset in source buffer to start reading from
   * @returns Object with bytesWritten count and the source buffer
   *
   * @throws {Error} If handle is closed (EBADF)
   * @throws {Error} If handle is not writable (EBADF)
   * @throws {Error} If position is negative (EINVAL)
   * @throws {TypeError} If data is not a valid type
   * @throws {RangeError} If offset or length exceeds buffer bounds
   *
   * @example
   * ```typescript
   * // Write a string
   * await handle.write('Hello, World!')
   *
   * // Write at specific position
   * await handle.write('data', 100)
   *
   * // Write portion of buffer
   * const buffer = new Uint8Array([1, 2, 3, 4, 5])
   * await handle.write(buffer, 0, 3, 1)  // Write bytes [2,3,4] at position 0
   * ```
   */
  async write(
    data: Uint8Array | ArrayBuffer | string,
    position?: number | null,
    length?: number,
    offset?: number
  ): Promise<{ bytesWritten: number; buffer: Uint8Array }> {
    this._ensureOpen()
    this._ensureWritable()

    // Convert input to bytes and determine what portion to write
    const { bytes, toWrite } = this._prepareWriteData(data, length, offset)

    // Determine write position (handles append mode, null/undefined semantics)
    const pos = this._getWritePosition(position)

    // Perform the write and update state
    this._writeBytes(toWrite, pos)
    this._position = pos + toWrite.length
    this._updateMtime()

    return { bytesWritten: toWrite.length, buffer: bytes }
  }

  /**
   * Validate that the handle is writable, throwing EBADF if not.
   */
  private _ensureWritable(): void {
    if (!this._writable) {
      const error = new Error('EBADF: bad file descriptor, write')
      ;(error as Error & { code: string }).code = 'EBADF'
      throw error
    }
  }

  /**
   * Convert write data to bytes and extract the portion to write.
   * Handles strings, Uint8Arrays, and ArrayBuffers with optional offset/length.
   *
   * @param data - Input data (string, Uint8Array, or ArrayBuffer)
   * @param length - Optional length for buffer writes
   * @param offset - Optional offset for buffer writes
   * @returns Object containing the full buffer and the portion to write
   * @throws {TypeError} If data is an invalid type
   * @throws {RangeError} If offset/length exceed buffer bounds
   */
  private _prepareWriteData(
    data: Uint8Array | ArrayBuffer | string,
    length?: number,
    offset?: number
  ): { bytes: Uint8Array; toWrite: Uint8Array } {
    // Handle string input (always UTF-8 encoded)
    if (typeof data === 'string') {
      const bytes = new TextEncoder().encode(data)
      return { bytes, toWrite: bytes }
    }

    // Validate data type for non-string inputs
    this._validateWriteDataType(data)

    // Convert ArrayBuffer to Uint8Array if needed
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data

    // Apply offset and length to extract the portion to write
    const bufferOffset = offset ?? 0
    const writeLength = length ?? bytes.length - bufferOffset

    // Validate offset and length bounds
    if (bufferOffset > bytes.length) {
      throw new RangeError('The value of "offset" is out of range')
    }
    if (bufferOffset + writeLength > bytes.length) {
      throw new RangeError('The value of "length" is out of range')
    }

    const toWrite = bytes.subarray(bufferOffset, bufferOffset + writeLength)
    return { bytes, toWrite }
  }

  /**
   * Validate that write data is a valid type.
   * @throws {TypeError} If data is null, undefined, number, or invalid object
   */
  private _validateWriteDataType(data: unknown): void {
    if (data === null || data === undefined) {
      throw new TypeError('The "buffer" argument must be of type Uint8Array, ArrayBuffer, or string')
    }
    if (typeof data === 'number') {
      throw new TypeError('The "buffer" argument must be of type Uint8Array, ArrayBuffer, or string')
    }
    if (typeof data === 'object' && !(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) {
      throw new TypeError('The "buffer" argument must be of type Uint8Array, ArrayBuffer, or string')
    }
  }

  /** Get the write position, handling append mode and defaults */
  private _getWritePosition(position: number | null | undefined): number {
    // Validate negative position
    if (position !== null && position !== undefined && position < 0) {
      const error = new Error('EINVAL: invalid argument, write')
      ;(error as Error & { code: string }).code = 'EINVAL'
      throw error
    }

    // In append mode, always write at end regardless of specified position
    if (this._appendMode) {
      return this._data.length
    }

    // null means use current position
    if (position === null) {
      return this._position
    }

    // undefined means position 0 (default)
    if (position === undefined) {
      return 0
    }

    return position
  }

  /**
   * Write bytes at the specified position, extending the file if necessary.
   *
   * Uses Uint8Array.set() for efficient bulk copy operations instead of
   * byte-by-byte iteration. When extending past EOF, gaps are filled with zeros.
   *
   * @param bytes - The bytes to write
   * @param pos - Position in the file to write at
   */
  private _writeBytes(bytes: Uint8Array, pos: number): void {
    const requiredSize = pos + bytes.length

    // Extend file buffer if writing past current size
    if (requiredSize > this._data.length) {
      const newData = new Uint8Array(requiredSize)
      // Copy existing data (gaps beyond old size are already zero-initialized)
      newData.set(this._data)
      this._data = newData
    }

    // Use set() for efficient bulk copy (much faster than byte-by-byte loop)
    this._data.set(bytes, pos)
  }

  /**
   * Update mtime and ctime after a write operation.
   * Called internally by write() to maintain POSIX-compliant timestamp behavior.
   * Also sets the dirty flag to indicate data needs syncing.
   */
  private _updateMtime(): void {
    const now = new Date()
    this._stats = this._buildStatsLike({ mtime: now, ctime: now })
    this._dirty = true
  }

  /**
   * Get statistics about the open file.
   *
   * Returns a Stats object reflecting the current state of the file,
   * including any pending (unflushed) writes. This is equivalent to
   * the POSIX fstat(2) system call.
   *
   * The returned Stats includes:
   * - **size**: Current file size including pending writes (not yet synced)
   * - **blocks**: Computed from current size (size / blksize, rounded up)
   * - **mtime/ctime**: Updated if writes have occurred since opening
   * - **atime**: Updated to reflect read operations
   * - Other properties (dev, ino, mode, etc.) remain as originally opened
   *
   * @returns A Stats object with current file metadata
   * @throws {Error} If the file handle has been closed
   *
   * @example
   * ```typescript
   * const handle = await fsx.open('/data.txt', 'r+')
   * const stats = await handle.stat()
   * console.log(`File size: ${stats.size} bytes`)
   * console.log(`Is file: ${stats.isFile()}`)
   * console.log(`Last modified: ${stats.mtime}`)
   * await handle.close()
   * ```
   *
   * @example
   * ```typescript
   * // Stats reflect pending writes
   * const handle = await fsx.open('/new.txt', 'w')
   * await handle.write('Hello, World!')
   * const stats = await handle.stat()
   * console.log(stats.size) // 13 (includes unflushed write)
   * ```
   *
   * @see {@link Stats} for available properties and type-checking methods
   * @see {@link FileHandle.sync} to flush pending writes to storage
   */
  async stat(): Promise<Stats> {
    this._ensureOpen()

    // Compute current size from internal buffer (reflects pending writes)
    const currentSize = this._data.length

    // Compute blocks based on current size
    // Use ceiling division to match POSIX behavior (partial block counts as full)
    const blockSize = this._stats.blksize
    const blocks = blockSize > 0 ? Math.ceil(currentSize / blockSize) : 0

    // Build Stats from current internal state
    // Note: mtime/ctime are updated by _updateMtime() on writes
    return new Stats({
      dev: this._stats.dev,
      ino: this._stats.ino,
      mode: this._stats.mode,
      nlink: this._stats.nlink,
      uid: this._stats.uid,
      gid: this._stats.gid,
      rdev: this._stats.rdev,
      size: currentSize,
      blksize: blockSize,
      blocks: blocks,
      atimeMs: this._stats.atime.getTime(),
      mtimeMs: this._stats.mtime.getTime(),
      ctimeMs: this._stats.ctime.getTime(),
      birthtimeMs: this._stats.birthtime.getTime(),
    })
  }

  /**
   * Truncate the file to a specified length.
   *
   * If the file was larger than the specified length, the extra bytes
   * are discarded. If the file was smaller, it is extended with null bytes.
   * Both operations mark the file as dirty and update timestamps.
   *
   * @param length - The new file length in bytes (default: 0)
   * @throws {Error} EBADF if the file handle has been closed
   *
   * @example
   * ```typescript
   * const handle = await fsx.open('/data.txt', 'r+')
   * await handle.truncate(100)  // Truncate or extend to 100 bytes
   * await handle.truncate()     // Truncate to 0 bytes (empty file)
   * ```
   */
  async truncate(length: number = 0): Promise<void> {
    this._ensureOpen()

    const oldLength = this._data.length
    if (length < oldLength) {
      this._data = this._data.slice(0, length)
    } else if (length > oldLength) {
      const newData = new Uint8Array(length)
      newData.set(this._data)
      this._data = newData
    }

    // Only mark dirty if size actually changed
    if (length !== oldLength) {
      this._dirty = true
      const now = new Date()
      this._stats = this._buildStatsLike({ mtime: now, ctime: now })
    } else {
      // Update internal stats to reflect size (preserves timestamps)
      this._stats = this._buildStatsLike()
    }
  }

  /**
   * Synchronize the file's in-core state with the storage device.
   *
   * Equivalent to POSIX fsync(2). Ensures that all pending writes are
   * flushed to persistent storage, including both file data and metadata
   * (size, timestamps, permissions, etc.).
   *
   * **Dirty tracking**: This method uses internal dirty tracking to efficiently
   * skip the sync operation when no writes have occurred since the last sync.
   * This is an optimization - calling sync() multiple times is safe and idempotent.
   *
   * **sync vs datasync**: Use sync() when you need to ensure metadata updates
   * (like mtime) are also persisted. Use datasync() when you only need to
   * ensure the file data itself is persisted (which can be more efficient).
   *
   * In the in-memory implementation, this is effectively a no-op since all data
   * is already in memory. The dirty flag is cleared to indicate sync completed.
   *
   * @throws {Error} EBADF if the file handle has been closed
   *
   * @example
   * ```typescript
   * const handle = await fsx.open('/data.txt', 'w')
   * await handle.write('Important data')
   * await handle.sync()  // Ensure data AND metadata are persisted
   * await handle.close()
   * ```
   *
   * @see {@link FileHandle.datasync} for data-only synchronization
   */
  async sync(): Promise<void> {
    this._ensureOpen()
    // In a real implementation, this would flush to the storage backend.
    // In the in-memory implementation, data is always "synced" immediately.
    // Clear dirty flag to indicate sync completed successfully.
    this._dirty = false
  }

  /**
   * Synchronize the file's data (but not metadata) with the storage device.
   *
   * Equivalent to POSIX fdatasync(2). Similar to sync(), but only flushes
   * file data, not metadata like timestamps or permissions. This can be
   * more efficient when you only care about data integrity.
   *
   * **When to use datasync vs sync**:
   * - Use datasync() for performance-critical paths where you only need
   *   to ensure the file content is persisted (e.g., write-ahead logs)
   * - Use sync() when metadata updates (mtime, size) must also be durable
   *   (e.g., before reporting success to users)
   *
   * **Dirty tracking**: Like sync(), this method respects dirty tracking
   * and is idempotent - safe to call multiple times.
   *
   * In the in-memory implementation, this behaves identically to sync()
   * since there's no distinction between data and metadata persistence.
   *
   * @throws {Error} EBADF if the file handle has been closed
   *
   * @example
   * ```typescript
   * const handle = await fsx.open('/wal.log', 'a')
   * await handle.write(logEntry)
   * await handle.datasync()  // Ensure log entry is persisted (fast path)
   * await handle.close()
   * ```
   *
   * @see {@link FileHandle.sync} for full synchronization including metadata
   */
  async datasync(): Promise<void> {
    this._ensureOpen()
    // In a real implementation, this would flush data without metadata.
    // In the in-memory implementation, this is equivalent to sync().
    // Clear dirty flag to indicate data sync completed successfully.
    this._dirty = false
  }

  /**
   * Close the file handle and release any resources.
   *
   * This method is idempotent - calling close() multiple times is safe.
   * After closing, any further operations on this handle will throw an error.
   * It is important to always close file handles when done to free resources.
   *
   * Close behavior:
   * 1. Marks the handle as closed (prevents further operations)
   * 2. Releases internal data buffer (sets to empty array to aid GC)
   * 3. Clears the dirty flag
   *
   * Note: In the base FileHandle class, close() does not perform a flush.
   * Subclasses with actual storage backends should override this to call
   * sync() before closing if needed.
   *
   * @example
   * ```typescript
   * const handle = await fsx.open('/data.txt', 'r')
   * try {
   *   const buffer = new Uint8Array(100)
   *   await handle.read(buffer)
   * } finally {
   *   await handle.close()  // Always close, even on error
   * }
   * ```
   */
  async close(): Promise<void> {
    // Idempotent - safe to call multiple times
    if (this._closed) {
      return
    }

    // Mark as closed first to prevent any operations during cleanup
    this._closed = true

    // Release resources - use empty array instead of keeping reference
    // to the original data buffer, allowing GC to collect it
    this._data = new Uint8Array(0)
    this._dirty = false
  }

  /**
   * Async disposable support for 'await using' syntax.
   *
   * Enables automatic cleanup when used with 'await using':
   * ```typescript
   * await using handle = await fsx.open('/file.txt', 'r')
   * // handle is automatically closed when scope exits
   * ```
   *
   * This is the preferred pattern for resource management in modern TypeScript.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  /** Create readable stream */
  createReadStream(options?: ReadStreamOptions): ReadableStream<Uint8Array> {
    this._ensureOpen()

    const start = options?.start ?? 0
    const end = options?.end ?? this._data.length - 1
    const data = this._data.slice(start, end + 1)
    const highWaterMark = options?.highWaterMark ?? 16384

    let offset = 0

    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= data.length) {
          controller.close()
          return
        }

        const chunk = data.slice(offset, offset + highWaterMark)
        offset += chunk.length
        controller.enqueue(chunk)
      },
    })
  }

  /** Create writable stream */
  createWriteStream(options?: WriteStreamOptions): WritableStream<Uint8Array> {
    this._ensureOpen()

    let position = options?.start ?? 0
    const self = this

    return new WritableStream<Uint8Array>({
      async write(chunk) {
        await self.write(chunk, position)
        position += chunk.length
      },
    })
  }
}

/**
 * Options for creating read streams
 */
export interface ReadStreamOptions {
  /** Start position */
  start?: number
  /** End position (inclusive) */
  end?: number
  /** High water mark (buffer size) */
  highWaterMark?: number
  /** Encoding */
  encoding?: BufferEncoding
}

/**
 * Options for creating write streams
 */
export interface WriteStreamOptions {
  /** Start position */
  start?: number
  /** File flags */
  flags?: string
  /** File mode */
  mode?: number
  /** High water mark */
  highWaterMark?: number
  /** Encoding */
  encoding?: BufferEncoding
}

/**
 * Options for mkdir
 */
export interface MkdirOptions {
  /** Create parent directories */
  recursive?: boolean
  /** Directory mode */
  mode?: number
}

/**
 * Options for rmdir
 */
export interface RmdirOptions {
  /** Remove recursively */
  recursive?: boolean
  /** Max retries */
  maxRetries?: number
  /** Retry delay in ms */
  retryDelay?: number
}

/**
 * Options for readdir
 */
export interface ReaddirOptions {
  /** Return Dirent objects */
  withFileTypes?: boolean
  /** Recursive listing */
  recursive?: boolean
  /** Encoding */
  encoding?: BufferEncoding
  /** Maximum number of entries to return (enables pagination) */
  limit?: number
  /** Cursor for pagination continuation */
  cursor?: string
}

/**
 * Paginated result from readdir when limit option is used
 */
export interface ReaddirPaginatedResult<T> {
  /** Array of directory entries */
  entries: T[]
  /** Cursor for next page, or null if no more entries */
  cursor: string | null
}

/**
 * Options for watch
 */
export interface WatchOptions {
  /** Watch recursively */
  recursive?: boolean
  /** Persistent (keep process alive) */
  persistent?: boolean
  /** Encoding */
  encoding?: BufferEncoding
}

/**
 * File system watcher
 */
export interface FSWatcher {
  /** Close watcher */
  close(): void
  /** Reference watcher (keep alive) */
  ref(): this
  /** Unreference watcher */
  unref(): this
}

/**
 * Buffer encoding types
 */
export type BufferEncoding = 'utf-8' | 'utf8' | 'ascii' | 'base64' | 'hex' | 'binary' | 'latin1'

/**
 * Internal file entry (stored in SQLite)
 */
export interface FileEntry {
  id: string
  path: string
  name: string
  parentId: string | null
  type: FileType
  mode: number
  uid: number
  gid: number
  size: number
  blobId: string | null
  linkTarget: string | null
  atime: number
  mtime: number
  ctime: number
  birthtime: number
  nlink: number
}

/**
 * Blob reference (for R2 storage)
 */
export interface BlobRef {
  id: string
  tier: 'hot' | 'warm' | 'cold'
  size: number
  checksum: string
  createdAt: number
  /** Index signature for SqlStorage compatibility */
  [key: string]: SqlStorageValue
}

/**
 * Valid SqlStorage value types
 */
export type SqlStorageValue = string | number | null | ArrayBuffer

// =============================================================================
// FsCapability Interface
// =============================================================================

/**
 * Result of a write operation with tier information.
 */
export interface WriteResult {
  /** Number of bytes written */
  bytesWritten: number

  /** Storage tier where the file was placed */
  tier: StorageTier
}

/**
 * Result of a read operation with metadata.
 */
export interface ReadResult {
  /** File content as Uint8Array */
  data: Uint8Array

  /** Storage tier from which the file was read */
  tier: StorageTier

  /** File size in bytes */
  size: number
}

/**
 * Filesystem capability interface for dotdo integration.
 *
 * This is the main interface that provides the `$.fs` capability for dotdo
 * Durable Objects. It offers a comprehensive POSIX-like API for filesystem
 * operations, backed by Cloudflare Durable Objects with tiered storage.
 *
 * The FsCapability interface is designed to be:
 * - **Lazy-loaded**: Only initialized when first accessed
 * - **Tiered**: Automatically places files in appropriate storage tiers
 * - **POSIX-compatible**: Familiar API for Node.js developers
 * - **Edge-native**: Optimized for Cloudflare Workers environment
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo/fs'
 *
 * class MySite extends DO {
 *   async loadContent() {
 *     // $.fs provides the FsCapability interface
 *     const content = await this.$.fs.read('content/index.mdx')
 *     const files = await this.$.fs.list('content/')
 *     await this.$.fs.write('cache/index.html', rendered)
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Tiered storage example
 * const fs: FsCapability = getFs()
 *
 * // Small files go to hot tier (DO SQLite)
 * await fs.write('/config.json', JSON.stringify(config))
 *
 * // Large files go to warm tier (R2)
 * await fs.write('/data/large-dataset.json', hugeData)
 *
 * // Check which tier a file is in
 * const stat = await fs.stat('/data/large-dataset.json')
 * console.log(`File is in ${stat.tier} tier`)
 * ```
 */
export interface FsCapability {
  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Read the entire contents of a file.
   *
   * @param path - Absolute path to the file
   * @param options - Read options (encoding, range, etc.)
   * @returns File contents as string (with encoding) or Uint8Array (without)
   *
   * @throws {ENOENT} If file does not exist
   * @throws {EISDIR} If path is a directory
   * @throws {EACCES} If permission denied
   *
   * @example
   * ```typescript
   * // Read as UTF-8 string
   * const text = await fs.read('/config.json', { encoding: 'utf-8' })
   *
   * // Read as binary
   * const bytes = await fs.read('/image.png')
   *
   * // Read with range
   * const partial = await fs.read('/large.bin', { start: 0, end: 1023 })
   * ```
   */
  read(path: string, options?: ReadOptions): Promise<string | Uint8Array>

  /**
   * Write data to a file, creating it if it doesn't exist.
   *
   * The storage tier is automatically selected based on file size:
   * - < 1MB: hot tier (Durable Object SQLite)
   * - < 100MB: warm tier (R2)
   * - >= 100MB: cold tier (Archive)
   *
   * @param path - Absolute path to the file
   * @param data - Data to write (string or Uint8Array)
   * @param options - Write options (encoding, mode, tier, etc.)
   *
   * @throws {ENOENT} If parent directory does not exist
   * @throws {EISDIR} If path is a directory
   * @throws {EEXIST} If flag is 'wx' and file already exists
   * @throws {ENOSPC} If storage quota exceeded
   *
   * @example
   * ```typescript
   * // Write string (UTF-8)
   * await fs.write('/hello.txt', 'Hello, World!')
   *
   * // Write with specific permissions
   * await fs.write('/secret.txt', data, { mode: 0o600 })
   *
   * // Write to specific tier
   * await fs.write('/archive.bin', data, { tier: 'cold' })
   *
   * // Append to file
   * await fs.write('/log.txt', 'New line\n', { flag: 'a' })
   * ```
   */
  write(path: string, data: string | Uint8Array, options?: WriteOptions): Promise<void>

  /**
   * Append data to a file, creating it if it doesn't exist.
   *
   * This is equivalent to `write(path, data, { flag: 'a' })`.
   *
   * @param path - Absolute path to the file
   * @param data - Data to append
   *
   * @example
   * ```typescript
   * await fs.append('/log.txt', `[${new Date().toISOString()}] Event occurred\n`)
   * ```
   */
  append(path: string, data: string | Uint8Array): Promise<void>

  /**
   * Delete a file.
   *
   * @param path - Absolute path to the file
   *
   * @throws {ENOENT} If file does not exist
   * @throws {EISDIR} If path is a directory (use rmdir instead)
   * @throws {EACCES} If permission denied
   *
   * @example
   * ```typescript
   * await fs.unlink('/temp/cache.json')
   * ```
   */
  unlink(path: string): Promise<void>

  /**
   * Rename or move a file or directory.
   *
   * @param oldPath - Current path
   * @param newPath - New path
   * @param options - Move options
   *
   * @throws {ENOENT} If source does not exist
   * @throws {EEXIST} If destination exists and overwrite is false
   * @throws {EXDEV} If moving across different filesystems (not supported)
   *
   * @example
   * ```typescript
   * await fs.rename('/old-name.txt', '/new-name.txt')
   * await fs.rename('/src/file.txt', '/dest/file.txt')
   * ```
   */
  rename(oldPath: string, newPath: string, options?: MoveOptions): Promise<void>

  /**
   * Copy a file.
   *
   * @param src - Source file path
   * @param dest - Destination file path
   * @param options - Copy options
   *
   * @throws {ENOENT} If source does not exist
   * @throws {EEXIST} If destination exists and overwrite is false
   * @throws {EISDIR} If source is a directory (use recursive option)
   *
   * @example
   * ```typescript
   * await fs.copyFile('/src/config.json', '/backup/config.json')
   * await fs.copyFile('/src', '/dest', { recursive: true })
   * ```
   */
  copyFile(src: string, dest: string, options?: CopyOptions): Promise<void>

  /**
   * Truncate a file to a specified length.
   *
   * @param path - Path to the file
   * @param length - New length in bytes (default: 0)
   *
   * @throws {ENOENT} If file does not exist
   * @throws {EISDIR} If path is a directory
   *
   * @example
   * ```typescript
   * await fs.truncate('/large-file.txt', 1024)  // Truncate to 1KB
   * await fs.truncate('/file.txt')              // Truncate to 0 bytes
   * ```
   */
  truncate(path: string, length?: number): Promise<void>

  // ===========================================================================
  // Directory Operations
  // ===========================================================================

  /**
   * Create a directory.
   *
   * @param path - Path to the directory
   * @param options - mkdir options (recursive, mode)
   *
   * @throws {ENOENT} If parent directory does not exist and recursive is false
   * @throws {EEXIST} If directory already exists
   * @throws {ENOTDIR} If a parent component is not a directory
   *
   * @example
   * ```typescript
   * await fs.mkdir('/new-dir')
   * await fs.mkdir('/path/to/nested/dir', { recursive: true })
   * await fs.mkdir('/private', { mode: 0o700 })
   * ```
   */
  mkdir(path: string, options?: MkdirOptions): Promise<void>

  /**
   * Remove a directory.
   *
   * @param path - Path to the directory
   * @param options - rmdir options (recursive)
   *
   * @throws {ENOENT} If directory does not exist
   * @throws {ENOTDIR} If path is not a directory
   * @throws {ENOTEMPTY} If directory is not empty and recursive is false
   *
   * @example
   * ```typescript
   * await fs.rmdir('/empty-dir')
   * await fs.rmdir('/dir-with-contents', { recursive: true })
   * ```
   */
  rmdir(path: string, options?: RmdirOptions): Promise<void>

  /**
   * Remove a file or directory.
   *
   * This is a more flexible version that handles both files and directories.
   *
   * @param path - Path to remove
   * @param options - Remove options
   *
   * @example
   * ```typescript
   * await fs.rm('/file.txt')
   * await fs.rm('/dir', { recursive: true })
   * await fs.rm('/maybe-exists', { force: true })
   * ```
   */
  rm(path: string, options?: RemoveOptions): Promise<void>

  /**
   * List directory contents.
   *
   * @param path - Path to the directory
   * @param options - List options
   * @returns Array of file names or Dirent objects
   *
   * @throws {ENOENT} If directory does not exist
   * @throws {ENOTDIR} If path is not a directory
   *
   * @example
   * ```typescript
   * // Simple listing
   * const names = await fs.list('/src')
   * // ['index.ts', 'utils.ts', 'components']
   *
   * // With file types
   * const entries = await fs.list('/src', { withFileTypes: true })
   * // [{ name: 'index.ts', isFile: true }, ...]
   *
   * // Recursive listing
   * const allFiles = await fs.list('/src', { recursive: true })
   * ```
   */
  list(path: string, options?: ListOptions): Promise<string[] | Dirent[]>

  /**
   * Alias for list() - Read directory contents.
   *
   * Provided for Node.js fs compatibility.
   */
  readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]>

  // ===========================================================================
  // Metadata Operations
  // ===========================================================================

  /**
   * Get file or directory statistics.
   *
   * This follows symbolic links. Use lstat() to get info about the link itself.
   *
   * @param path - Path to the file or directory
   * @returns Stats object with file metadata
   *
   * @throws {ENOENT} If path does not exist
   *
   * @example
   * ```typescript
   * const stats = await fs.stat('/file.txt')
   * console.log(`Size: ${stats.size} bytes`)
   * console.log(`Modified: ${stats.mtime}`)
   * console.log(`Is directory: ${stats.isDirectory()}`)
   * console.log(`Tier: ${stats.tier}`)
   * ```
   */
  stat(path: string): Promise<Stats>

  /**
   * Get file or directory statistics without following symbolic links.
   *
   * @param path - Path to the file, directory, or symlink
   * @returns Stats object with metadata
   *
   * @throws {ENOENT} If path does not exist
   */
  lstat(path: string): Promise<Stats>

  /**
   * Check if a file or directory exists.
   *
   * @param path - Path to check
   * @returns true if path exists, false otherwise
   *
   * @example
   * ```typescript
   * if (await fs.exists('/config.json')) {
   *   const config = await fs.read('/config.json', { encoding: 'utf-8' })
   * }
   * ```
   */
  exists(path: string): Promise<boolean>

  /**
   * Check file accessibility and permissions.
   *
   * @param path - Path to check
   * @param mode - Accessibility mode (constants.F_OK, R_OK, W_OK, X_OK)
   *
   * @throws {ENOENT} If path does not exist
   * @throws {EACCES} If access is denied
   *
   * @example
   * ```typescript
   * import { constants } from 'fsx.do'
   *
   * // Check if file exists
   * await fs.access('/file.txt', constants.F_OK)
   *
   * // Check if file is readable and writable
   * await fs.access('/file.txt', constants.R_OK | constants.W_OK)
   * ```
   */
  access(path: string, mode?: number): Promise<void>

  /**
   * Change file permissions.
   *
   * @param path - Path to the file
   * @param mode - New permissions (octal number)
   *
   * @throws {ENOENT} If path does not exist
   *
   * @example
   * ```typescript
   * await fs.chmod('/script.sh', 0o755)  // rwxr-xr-x
   * await fs.chmod('/secret.txt', 0o600) // rw-------
   * ```
   */
  chmod(path: string, mode: number): Promise<void>

  /**
   * Change file ownership.
   *
   * @param path - Path to the file
   * @param uid - User ID
   * @param gid - Group ID
   *
   * @throws {ENOENT} If path does not exist
   */
  chown(path: string, uid: number, gid: number): Promise<void>

  /**
   * Update file timestamps.
   *
   * @param path - Path to the file
   * @param atime - Access time
   * @param mtime - Modification time
   *
   * @throws {ENOENT} If path does not exist
   */
  utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>

  // ===========================================================================
  // Symbolic Links
  // ===========================================================================

  /**
   * Create a symbolic link.
   *
   * @param target - Target path the link points to
   * @param path - Path of the symbolic link to create
   *
   * @throws {EEXIST} If path already exists
   *
   * @example
   * ```typescript
   * await fs.symlink('/actual/file.txt', '/link-to-file.txt')
   * ```
   */
  symlink(target: string, path: string): Promise<void>

  /**
   * Create a hard link.
   *
   * @param existingPath - Path to existing file
   * @param newPath - Path for the new link
   *
   * @throws {ENOENT} If existingPath does not exist
   * @throws {EEXIST} If newPath already exists
   */
  link(existingPath: string, newPath: string): Promise<void>

  /**
   * Read the target of a symbolic link.
   *
   * @param path - Path to the symbolic link
   * @returns The target path
   *
   * @throws {ENOENT} If path does not exist
   * @throws {EINVAL} If path is not a symbolic link
   */
  readlink(path: string): Promise<string>

  /**
   * Resolve a path by following symbolic links.
   *
   * @param path - Path to resolve
   * @returns The resolved absolute path
   *
   * @throws {ENOENT} If path does not exist
   * @throws {ELOOP} If too many symbolic links encountered
   */
  realpath(path: string): Promise<string>

  // ===========================================================================
  // Streaming Operations
  // ===========================================================================

  /**
   * Create a readable stream for a file.
   *
   * @param path - Path to the file
   * @param options - Stream options (start, end, highWaterMark)
   * @returns A ReadableStream of Uint8Array chunks
   *
   * @throws {ENOENT} If file does not exist
   * @throws {EISDIR} If path is a directory
   *
   * @example
   * ```typescript
   * const stream = await fs.createReadStream('/large-file.bin')
   * for await (const chunk of stream) {
   *   await processChunk(chunk)
   * }
   *
   * // Partial read
   * const partial = await fs.createReadStream('/file.bin', {
   *   start: 1000,
   *   end: 2000
   * })
   * ```
   */
  createReadStream(path: string, options?: ReadStreamOptions): Promise<ReadableStream<Uint8Array>>

  /**
   * Create a writable stream for a file.
   *
   * @param path - Path to the file
   * @param options - Stream options (start, flags, mode)
   * @returns A WritableStream for Uint8Array chunks
   *
   * @example
   * ```typescript
   * const stream = await fs.createWriteStream('/output.bin')
   * const writer = stream.getWriter()
   * await writer.write(new Uint8Array([1, 2, 3]))
   * await writer.close()
   *
   * // Pipe from another stream
   * const readable = await fetch('/api/data').then(r => r.body!)
   * await readable.pipeTo(await fs.createWriteStream('/data.bin'))
   * ```
   */
  createWriteStream(path: string, options?: WriteStreamOptions): Promise<WritableStream<Uint8Array>>

  // ===========================================================================
  // File Handle Operations
  // ===========================================================================

  /**
   * Open a file and return a file handle for low-level operations.
   *
   * @param path - Path to the file
   * @param flags - Open flags ('r', 'w', 'a', 'r+', 'w+', 'a+', etc.)
   * @param mode - File mode for newly created files
   * @returns A FileHandle for the opened file
   *
   * @throws {ENOENT} If file does not exist and flag doesn't allow creation
   * @throws {EEXIST} If 'x' flag used and file exists
   *
   * @example
   * ```typescript
   * const handle = await fs.open('/file.txt', 'r+')
   * try {
   *   const buffer = new Uint8Array(1024)
   *   const { bytesRead } = await handle.read(buffer, 0, 1024, 0)
   *   await handle.write('Modified content', 0)
   * } finally {
   *   await handle.close()
   * }
   * ```
   */
  open(path: string, flags?: string | number, mode?: number): Promise<FileHandle>

  // ===========================================================================
  // Watch Operations
  // ===========================================================================

  /**
   * Watch a file or directory for changes.
   *
   * @param path - Path to watch
   * @param options - Watch options (recursive, persistent)
   * @param listener - Callback for change events
   * @returns An FSWatcher that can be closed
   *
   * @example
   * ```typescript
   * const watcher = fs.watch('/config', { recursive: true }, (event, filename) => {
   *   console.log(`${event}: ${filename}`)
   * })
   *
   * // Later: stop watching
   * watcher.close()
   * ```
   */
  watch(
    path: string,
    options?: WatchOptions,
    listener?: (eventType: 'rename' | 'change', filename: string) => void
  ): FSWatcher

  // ===========================================================================
  // Tiered Storage Operations
  // ===========================================================================

  /**
   * Manually promote a file to a higher (faster) storage tier.
   *
   * @param path - Path to the file
   * @param tier - Target tier ('hot' or 'warm')
   *
   * @throws {ENOENT} If file does not exist
   * @throws {EINVAL} If promotion to target tier is not valid
   *
   * @example
   * ```typescript
   * // Promote frequently accessed file to hot tier
   * await fs.promote('/data/important.json', 'hot')
   * ```
   */
  promote?(path: string, tier: 'hot' | 'warm'): Promise<void>

  /**
   * Manually demote a file to a lower (cheaper) storage tier.
   *
   * @param path - Path to the file
   * @param tier - Target tier ('warm' or 'cold')
   *
   * @throws {ENOENT} If file does not exist
   * @throws {EINVAL} If demotion to target tier is not valid
   *
   * @example
   * ```typescript
   * // Move old data to cold storage
   * await fs.demote('/data/archive-2023.json', 'cold')
   * ```
   */
  demote?(path: string, tier: 'warm' | 'cold'): Promise<void>

  /**
   * Get storage tier information for a file.
   *
   * @param path - Path to the file
   * @returns Current storage tier
   *
   * @example
   * ```typescript
   * const tier = await fs.getTier('/data/file.json')
   * console.log(`File is in ${tier} tier`)
   * ```
   */
  getTier?(path: string): Promise<StorageTier>
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a value is a Stats instance.
 *
 * @param value - Value to check
 * @returns true if value is a Stats instance
 *
 * @example
 * ```typescript
 * const result = await someOperation()
 * if (isStats(result)) {
 *   console.log(`File size: ${result.size}`)
 * }
 * ```
 */
export function isStats(value: unknown): value is Stats {
  return value instanceof Stats
}

/**
 * Type guard to check if a value is a Dirent instance.
 *
 * @param value - Value to check
 * @returns true if value is a Dirent instance
 *
 * @example
 * ```typescript
 * const entry = await getEntry()
 * if (isDirent(entry)) {
 *   console.log(`Entry name: ${entry.name}`)
 * }
 * ```
 */
export function isDirent(value: unknown): value is Dirent {
  return value instanceof Dirent
}

/**
 * Type guard to check if a value is a FileHandle instance.
 *
 * @param value - Value to check
 * @returns true if value is a FileHandle instance
 *
 * @example
 * ```typescript
 * const resource = await acquireResource()
 * if (isFileHandle(resource)) {
 *   await resource.close()
 * }
 * ```
 */
export function isFileHandle(value: unknown): value is FileHandle {
  return value instanceof FileHandle
}

/**
 * Type guard to check if a value is a valid FileType.
 *
 * @param value - Value to check
 * @returns true if value is a valid FileType string
 *
 * @example
 * ```typescript
 * const type = getTypeFromInput(userInput)
 * if (isFileType(type)) {
 *   handleFileType(type)
 * }
 * ```
 */
export function isFileType(value: unknown): value is FileType {
  return (
    value === 'file' ||
    value === 'directory' ||
    value === 'symlink' ||
    value === 'block' ||
    value === 'character' ||
    value === 'fifo' ||
    value === 'socket'
  )
}

/**
 * Type guard to check if a value is a valid StorageTier.
 *
 * @param value - Value to check
 * @returns true if value is a valid StorageTier string
 *
 * @example
 * ```typescript
 * const tier = parseTier(config.tier)
 * if (isStorageTier(tier)) {
 *   await fs.write('/file', data, { tier })
 * }
 * ```
 */
export function isStorageTier(value: unknown): value is StorageTier {
  return value === 'hot' || value === 'warm' || value === 'cold'
}

/**
 * Type guard to check if a value conforms to StatsLike interface.
 *
 * Performs runtime structural check to verify an object has all
 * required Stats properties and methods.
 *
 * @param value - Value to check
 * @returns true if value conforms to StatsLike interface
 *
 * @example
 * ```typescript
 * function processAnyStats(stats: unknown): void {
 *   if (isStatsLike(stats)) {
 *     console.log(`Size: ${stats.size}`)
 *   }
 * }
 * ```
 */
export function isStatsLike(value: unknown): value is StatsLike {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const obj = value as Record<string, unknown>
  return (
    typeof obj.dev === 'number' &&
    typeof obj.ino === 'number' &&
    typeof obj.mode === 'number' &&
    typeof obj.size === 'number' &&
    typeof obj.isFile === 'function' &&
    typeof obj.isDirectory === 'function'
  )
}
