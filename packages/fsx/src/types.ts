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
 * File mode (permissions)
 */
export type FileMode = number

/**
 * File type
 */
export type FileType = 'file' | 'directory' | 'symlink' | 'block' | 'character' | 'fifo' | 'socket'

/**
 * Stats properties for constructor
 */
export interface StatsInit {
  dev: number
  ino: number
  mode: number
  nlink: number
  uid: number
  gid: number
  rdev: number
  size: number
  blksize: number
  blocks: number
  atimeMs: number
  mtimeMs: number
  ctimeMs: number
  birthtimeMs: number
}

/**
 * File statistics class
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
 * Dirent type
 */
export type DirentType = 'file' | 'directory' | 'symlink' | 'block' | 'character' | 'fifo' | 'socket'

/**
 * Directory entry class
 */
export class Dirent {
  /** Entry name */
  readonly name: string
  /** Parent path */
  readonly parentPath: string
  /** Entry type */
  private readonly _type: DirentType

  constructor(name: string, parentPath: string, type: DirentType) {
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
 * Stats-like interface for FileHandle
 */
export interface StatsLike {
  dev: number
  ino: number
  mode: number
  nlink: number
  uid: number
  gid: number
  rdev: number
  size: number
  blksize: number
  blocks: number
  atime: Date
  mtime: Date
  ctime: Date
  birthtime: Date
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
  isBlockDevice(): boolean
  isCharacterDevice(): boolean
  isFIFO(): boolean
  isSocket(): boolean
}

/**
 * Interface for FileHandle - defines the public API contract.
 * This interface can be satisfied by both the FileHandle class and plain object implementations.
 * Use this type when you need to accept any FileHandle-like object.
 */
export interface FileHandleLike {
  /** File descriptor number */
  readonly fd: number
  /** Read from file */
  read(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<{ bytesRead: number; buffer: Uint8Array }>
  /** Write to file */
  write(data: Uint8Array | string, position?: number): Promise<{ bytesWritten: number }>
  /** Get file stats */
  stat(): Promise<Stats>
  /** Truncate file to specified length */
  truncate(length?: number): Promise<void>
  /** Sync to disk */
  sync(): Promise<void>
  /** Close file */
  close(): Promise<void>
  /** Create readable stream */
  createReadStream(options?: ReadStreamOptions): ReadableStream<Uint8Array>
  /** Create writable stream */
  createWriteStream(options?: WriteStreamOptions): WritableStream<Uint8Array>
}

/**
 * File handle for open files
 */
export class FileHandle implements FileHandleLike {
  /** File descriptor */
  readonly fd: number
  /** Internal data buffer */
  private _data: Uint8Array
  /** Internal stats */
  private _stats: StatsLike
  /** Whether the handle is closed */
  private _closed: boolean = false

  constructor(fd: number, data: Uint8Array, stats: StatsLike) {
    this.fd = fd
    this._data = data
    this._stats = stats
  }

  private _ensureOpen(): void {
    if (this._closed) {
      throw new Error('File handle is closed')
    }
  }

  /** Read from file */
  async read(
    buffer: Uint8Array,
    offset: number = 0,
    length?: number,
    position: number = 0
  ): Promise<{ bytesRead: number; buffer: Uint8Array }> {
    this._ensureOpen()

    const readLength = length ?? this._data.length - position
    const actualLength = Math.min(readLength, this._data.length - position)
    const bytesToRead = Math.min(actualLength, buffer.length - offset)

    for (let i = 0; i < bytesToRead; i++) {
      buffer[offset + i] = this._data[position + i]!
    }

    return { bytesRead: bytesToRead, buffer }
  }

  /** Write to file */
  async write(
    data: Uint8Array | string,
    position?: number
  ): Promise<{ bytesWritten: number }> {
    this._ensureOpen()

    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const pos = position ?? this._data.length

    // Expand data array if needed
    if (pos + bytes.length > this._data.length) {
      const newData = new Uint8Array(pos + bytes.length)
      newData.set(this._data)
      this._data = newData
    }

    // Write the data
    for (let i = 0; i < bytes.length; i++) {
      this._data[pos + i] = bytes[i]!
    }

    // Note: stats size update will be reflected in stat() via this._data.length
    // No need to update _stats here since stat() reads directly from _data.length

    return { bytesWritten: bytes.length }
  }

  /** Get file stats */
  async stat(): Promise<Stats> {
    this._ensureOpen()

    // Return current stats with updated size
    return new Stats({
      dev: this._stats.dev,
      ino: this._stats.ino,
      mode: this._stats.mode,
      nlink: this._stats.nlink,
      uid: this._stats.uid,
      gid: this._stats.gid,
      rdev: this._stats.rdev,
      size: this._data.length,
      blksize: this._stats.blksize,
      blocks: Math.ceil(this._data.length / this._stats.blksize),
      atimeMs: this._stats.atime.getTime(),
      mtimeMs: this._stats.mtime.getTime(),
      ctimeMs: this._stats.ctime.getTime(),
      birthtimeMs: this._stats.birthtime.getTime(),
    })
  }

  /** Truncate file */
  async truncate(length: number = 0): Promise<void> {
    this._ensureOpen()

    if (length < this._data.length) {
      this._data = this._data.slice(0, length)
    } else if (length > this._data.length) {
      const newData = new Uint8Array(length)
      newData.set(this._data)
      this._data = newData
    }

    // Create a new stats object preserving the atime/mtime/ctime/birthtime getters
    const oldStats = this._stats
    this._stats = {
      dev: oldStats.dev,
      ino: oldStats.ino,
      mode: oldStats.mode,
      nlink: oldStats.nlink,
      uid: oldStats.uid,
      gid: oldStats.gid,
      rdev: oldStats.rdev,
      size: this._data.length,
      blksize: oldStats.blksize,
      blocks: Math.ceil(this._data.length / oldStats.blksize),
      atime: oldStats.atime,
      mtime: oldStats.mtime,
      ctime: oldStats.ctime,
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

  /** Sync to disk */
  async sync(): Promise<void> {
    this._ensureOpen()
    // No-op in memory implementation
  }

  /** Close file */
  async close(): Promise<void> {
    this._closed = true
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
