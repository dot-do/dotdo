/**
 * @fileoverview FsModule for Durable Object Integration
 *
 * This module provides a FsModule class that integrates with dotdo's $ WorkflowContext,
 * providing $.fs.read(), $.fs.write(), and POSIX-like filesystem operations.
 *
 * The module uses SQLite for metadata storage and supports tiered blob storage
 * with R2 integration. Implements lazy initialization - schema is only created
 * on first use.
 *
 * @module do/FsModule
 *
 * @example
 * ```typescript
 * import { FsModule } from 'gitx.do/do'
 *
 * class MyDO extends DO {
 *   fs = new FsModule({
 *     sql: this.ctx.storage.sql
 *   })
 *
 *   async loadConfig() {
 *     await this.fs.initialize()
 *     const content = await this.fs.readFile('/config.json')
 *     return JSON.parse(content)
 *   }
 * }
 * ```
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * SQL storage interface for FsModule.
 * Matches Cloudflare Durable Object SQLite API.
 */
export interface SqlStorage {
  exec<T = unknown>(sql: string, ...params: unknown[]): SqlResult<T>
}

/**
 * Result from SQL execution.
 */
export interface SqlResult<T> {
  one(): T | null
  toArray(): T[]
}

/**
 * R2 Bucket interface for tiered storage.
 */
export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>
  put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<R2ObjectLike>
  delete(key: string | string[]): Promise<void>
}

/**
 * R2 Object interface.
 */
export interface R2ObjectLike {
  key: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

/**
 * Configuration options for FsModule.
 */
export interface FsModuleOptions {
  /**
   * SQLite storage instance from Durable Object context.
   */
  sql: SqlStorage

  /**
   * Optional R2 bucket for warm tier storage.
   */
  r2?: R2BucketLike

  /**
   * Optional R2 bucket for cold/archive tier storage.
   */
  archive?: R2BucketLike

  /**
   * Base path prefix for all operations.
   * @default '/'
   */
  basePath?: string

  /**
   * Hot tier max size in bytes.
   * Files larger than this are stored in R2 when available.
   * @default 1048576 (1MB)
   */
  hotMaxSize?: number

  /**
   * Default file mode.
   * @default 0o644
   */
  defaultMode?: number

  /**
   * Default directory mode.
   * @default 0o755
   */
  defaultDirMode?: number
}

/**
 * Options for read operations.
 */
export interface ReadOptions {
  /**
   * Encoding for text output.
   * If set to 'utf-8', returns string instead of Uint8Array.
   */
  encoding?: 'utf-8' | 'utf8'

  /**
   * Start byte offset for partial reads.
   */
  start?: number

  /**
   * End byte offset for partial reads (inclusive).
   */
  end?: number
}

/**
 * Options for write operations.
 */
export interface WriteOptions {
  /**
   * File mode (permissions).
   */
  mode?: number

  /**
   * Write flag.
   * - 'w': Write/create (default)
   * - 'wx' or 'ax': Exclusive create (fail if exists)
   * - 'a': Append mode
   */
  flag?: 'w' | 'wx' | 'ax' | 'a'

  /**
   * Force specific storage tier.
   */
  tier?: 'hot' | 'warm' | 'cold'
}

/**
 * Options for mkdir operations.
 */
export interface MkdirOptions {
  /**
   * Create parent directories if they don't exist.
   */
  recursive?: boolean

  /**
   * Directory mode (permissions).
   */
  mode?: number
}

/**
 * Options for rmdir operations.
 */
export interface RmdirOptions {
  /**
   * Remove directory and all contents recursively.
   */
  recursive?: boolean
}

/**
 * Options for rm operations.
 */
export interface RemoveOptions {
  /**
   * Remove directories and contents recursively.
   */
  recursive?: boolean

  /**
   * Don't throw error if path doesn't exist.
   */
  force?: boolean
}

/**
 * Options for readdir operations.
 */
export interface ReaddirOptions {
  /**
   * Return Dirent objects instead of strings.
   */
  withFileTypes?: boolean

  /**
   * List subdirectories recursively.
   */
  recursive?: boolean
}

/**
 * Options for rename/move operations.
 */
export interface MoveOptions {
  /**
   * Overwrite destination if it exists.
   */
  overwrite?: boolean
}

/**
 * Options for copy operations.
 */
export interface CopyOptions {
  /**
   * Overwrite destination if it exists.
   */
  overwrite?: boolean
}

/**
 * Directory entry interface.
 */
export interface Dirent {
  name: string
  parentPath: string
  path: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
  isBlockDevice(): boolean
  isCharacterDevice(): boolean
  isFIFO(): boolean
  isSocket(): boolean
}

/**
 * File stats interface.
 */
export interface Stats {
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
 * Internal file entry stored in SQLite.
 */
interface FileEntry {
  id: number
  path: string
  name: string
  parent_id: number | null
  type: 'file' | 'directory' | 'symlink'
  mode: number
  uid: number
  gid: number
  size: number
  blob_id: string | null
  link_target: string | null
  tier: 'hot' | 'warm' | 'cold'
  atime: number
  mtime: number
  ctime: number
  birthtime: number
  nlink: number
}

/**
 * Blob entry stored in SQLite.
 * @internal Reserved for tiered storage implementation
 */
type _BlobEntry = {
  id: string
  data: ArrayBuffer | null
  size: number
  tier: 'hot' | 'warm' | 'cold'
  created_at: number
}
export type { _BlobEntry as BlobEntryInternal } // Preserve for future tiered storage

// ============================================================================
// Constants
// ============================================================================

/**
 * File type mode bits (POSIX).
 */
export const S_IFMT = 0o170000  // Mask for file type
export const S_IFREG = 0o100000 // Regular file
export const S_IFDIR = 0o040000 // Directory
export const S_IFLNK = 0o120000 // Symbolic link

/**
 * SQL schema for filesystem metadata.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    parent_id INTEGER,
    type TEXT NOT NULL CHECK(type IN ('file', 'directory', 'symlink')),
    mode INTEGER NOT NULL DEFAULT 420,
    uid INTEGER NOT NULL DEFAULT 0,
    gid INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    blob_id TEXT,
    link_target TEXT,
    tier TEXT NOT NULL DEFAULT 'hot' CHECK(tier IN ('hot', 'warm', 'cold')),
    atime INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    ctime INTEGER NOT NULL,
    birthtime INTEGER NOT NULL,
    nlink INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (parent_id) REFERENCES files(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
  CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent_id);
  CREATE INDEX IF NOT EXISTS idx_files_tier ON files(tier);

  CREATE TABLE IF NOT EXISTS blobs (
    id TEXT PRIMARY KEY,
    data BLOB,
    size INTEGER NOT NULL,
    checksum TEXT,
    tier TEXT NOT NULL DEFAULT 'hot' CHECK(tier IN ('hot', 'warm', 'cold')),
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_blobs_tier ON blobs(tier);
`

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base class for filesystem errors.
 */
class FsError extends Error {
  code: string
  path?: string

  constructor(code: string, message: string, path?: string) {
    super(message)
    this.name = 'FsError'
    this.code = code
    this.path = path
  }
}

/**
 * ENOENT: No such file or directory.
 */
export class ENOENT extends FsError {
  constructor(message?: string, path?: string) {
    super('ENOENT', message ?? 'no such file or directory', path)
  }
}

/**
 * EEXIST: File already exists.
 */
export class EEXIST extends FsError {
  constructor(message?: string, path?: string) {
    super('EEXIST', message ?? 'file already exists', path)
  }
}

/**
 * EISDIR: Illegal operation on a directory.
 */
export class EISDIR extends FsError {
  constructor(message?: string, path?: string) {
    super('EISDIR', message ?? 'illegal operation on a directory', path)
  }
}

/**
 * ENOTDIR: Not a directory.
 */
export class ENOTDIR extends FsError {
  constructor(message?: string, path?: string) {
    super('ENOTDIR', message ?? 'not a directory', path)
  }
}

/**
 * ENOTEMPTY: Directory not empty.
 */
export class ENOTEMPTY extends FsError {
  constructor(message?: string, path?: string) {
    super('ENOTEMPTY', message ?? 'directory not empty', path)
  }
}

// ============================================================================
// FsModule Class
// ============================================================================

/**
 * FsModule - Filesystem capability module for Durable Object integration.
 *
 * Implements POSIX-like file operations with lazy initialization.
 * Uses SQLite for metadata and supports tiered storage with R2.
 *
 * @example
 * ```typescript
 * const fs = new FsModule({ sql: ctx.storage.sql })
 *
 * // First operation triggers initialization
 * await fs.writeFile('/config.json', JSON.stringify(config))
 *
 * // Subsequent operations use existing schema
 * const data = await fs.readFile('/config.json', { encoding: 'utf-8' })
 * ```
 */
export class FsModule {
  /**
   * Capability module name for identification.
   */
  readonly name = 'fs' as const

  private readonly sql: SqlStorage
  private readonly r2?: R2BucketLike
  private readonly archive?: R2BucketLike
  private readonly basePath: string
  private readonly hotMaxSize: number
  private readonly defaultMode: number
  private readonly defaultDirMode: number
  private initialized = false

  /**
   * Create a new FsModule instance.
   *
   * @param options - Configuration options
   *
   * @example
   * ```typescript
   * const fs = new FsModule({
   *   sql: ctx.storage.sql,
   *   r2: env.R2_BUCKET,
   *   hotMaxSize: 512 * 1024 // 512KB
   * })
   * ```
   */
  constructor(options: FsModuleOptions) {
    this.sql = options.sql
    this.r2 = options.r2
    this.archive = options.archive
    this.basePath = options.basePath ?? '/'
    this.hotMaxSize = options.hotMaxSize ?? 1024 * 1024 // 1MB
    this.defaultMode = options.defaultMode ?? 0o644
    this.defaultDirMode = options.defaultDirMode ?? 0o755
  }

  /**
   * Initialize the module - creates schema and root directory.
   * This is called automatically on first operation (lazy initialization).
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create schema
    this.sql.exec(SCHEMA)

    // Create root directory if not exists
    const root = this.sql.exec<FileEntry>('SELECT * FROM files WHERE path = ?', '/').one()

    if (!root) {
      const now = Date.now()
      this.sql.exec(
        `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, tier, atime, mtime, ctime, birthtime, nlink)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        '/',
        '',
        null,
        'directory',
        this.defaultDirMode,
        0,
        0,
        0,
        'hot',
        now,
        now,
        now,
        now,
        2
      )
    }

    this.initialized = true
  }

  /**
   * Cleanup hook for capability disposal.
   */
  async dispose(): Promise<void> {
    // No cleanup needed for SQLite-backed storage
  }

  // ===========================================================================
  // Path Utilities
  // ===========================================================================

  private normalizePath(path: string): string {
    // Handle base path
    if (!path.startsWith('/')) {
      path = this.basePath + (this.basePath.endsWith('/') ? '' : '/') + path
    }

    // Remove trailing slashes (except root)
    if (path !== '/' && path.endsWith('/')) {
      path = path.slice(0, -1)
    }

    // Resolve . and ..
    const parts = path.split('/').filter(Boolean)
    const resolved: string[] = []
    for (const part of parts) {
      if (part === '.') continue
      if (part === '..') {
        resolved.pop()
      } else {
        resolved.push(part)
      }
    }
    return '/' + resolved.join('/')
  }

  private getParentPath(path: string): string {
    const normalized = this.normalizePath(path)
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) return '/'
    return normalized.substring(0, lastSlash)
  }

  private getFileName(path: string): string {
    const normalized = this.normalizePath(path)
    const lastSlash = normalized.lastIndexOf('/')
    return normalized.substring(lastSlash + 1)
  }

  // ===========================================================================
  // Internal File Operations
  // ===========================================================================

  private async getFile(path: string): Promise<FileEntry | null> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const result = this.sql.exec<FileEntry>('SELECT * FROM files WHERE path = ?', normalized).one()
    return result || null
  }

  private selectTier(size: number): 'hot' | 'warm' | 'cold' {
    if (size <= this.hotMaxSize) return 'hot'
    if (this.r2) return 'warm'
    return 'hot' // Fall back to hot if R2 not configured
  }

  private async storeBlob(id: string, data: Uint8Array, tier: 'hot' | 'warm' | 'cold'): Promise<void> {
    const now = Date.now()

    if (tier === 'hot') {
      this.sql.exec(
        'INSERT OR REPLACE INTO blobs (id, data, size, tier, created_at) VALUES (?, ?, ?, ?, ?)',
        id,
        data.buffer,
        data.length,
        tier,
        now
      )
    } else if (tier === 'warm' && this.r2) {
      await this.r2.put(id, data)
      this.sql.exec(
        'INSERT OR REPLACE INTO blobs (id, size, tier, created_at) VALUES (?, ?, ?, ?)',
        id,
        data.length,
        tier,
        now
      )
    } else if (tier === 'cold' && this.archive) {
      await this.archive.put(id, data)
      this.sql.exec(
        'INSERT OR REPLACE INTO blobs (id, size, tier, created_at) VALUES (?, ?, ?, ?)',
        id,
        data.length,
        tier,
        now
      )
    }
  }

  private async getBlob(id: string, tier: 'hot' | 'warm' | 'cold'): Promise<Uint8Array | null> {
    if (tier === 'hot') {
      const blob = this.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM blobs WHERE id = ?', id).one()
      if (!blob?.data) return null
      return new Uint8Array(blob.data)
    }

    if (tier === 'warm' && this.r2) {
      const obj = await this.r2.get(id)
      if (!obj) return null
      return new Uint8Array(await obj.arrayBuffer())
    }

    if (tier === 'cold' && this.archive) {
      const obj = await this.archive.get(id)
      if (!obj) return null
      return new Uint8Array(await obj.arrayBuffer())
    }

    return null
  }

  private async deleteBlob(id: string, tier: 'hot' | 'warm' | 'cold'): Promise<void> {
    this.sql.exec('DELETE FROM blobs WHERE id = ?', id)

    if (tier === 'warm' && this.r2) {
      await this.r2.delete(id)
    } else if (tier === 'cold' && this.archive) {
      await this.archive.delete(id)
    }
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Read a file's contents.
   *
   * @param path - File path to read
   * @param options - Read options
   * @returns File contents as string or Uint8Array
   *
   * @example
   * ```typescript
   * // Read as bytes
   * const bytes = await fs.readFile('/data.bin')
   *
   * // Read as string
   * const text = await fs.readFile('/config.json', { encoding: 'utf-8' })
   * ```
   */
  async readFile(path: string, options?: ReadOptions): Promise<string | Uint8Array> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (file.type === 'directory') {
      throw new EISDIR(undefined, normalized)
    }

    // Follow symlinks
    if (file.type === 'symlink' && file.link_target) {
      return this.readFile(file.link_target, options)
    }

    if (!file.blob_id) {
      return options?.encoding ? '' : new Uint8Array(0)
    }

    const data = await this.getBlob(file.blob_id, file.tier as 'hot' | 'warm' | 'cold')
    if (!data) {
      return options?.encoding ? '' : new Uint8Array(0)
    }

    // Handle range reads
    let result = data
    if (options?.start !== undefined || options?.end !== undefined) {
      const start = options.start ?? 0
      const end = options.end !== undefined ? options.end + 1 : data.length
      result = data.slice(start, end)
    }

    // Update atime
    this.sql.exec('UPDATE files SET atime = ? WHERE id = ?', Date.now(), file.id)

    if (options?.encoding) {
      return new TextDecoder().decode(result)
    }

    return result
  }

  /**
   * Write data to a file.
   *
   * @param path - File path to write
   * @param data - Data to write
   * @param options - Write options
   *
   * @example
   * ```typescript
   * // Write string
   * await fs.writeFile('/hello.txt', 'Hello, World!')
   *
   * // Write bytes
   * await fs.writeFile('/data.bin', new Uint8Array([1, 2, 3]))
   *
   * // Append mode
   * await fs.writeFile('/log.txt', 'New entry\n', { flag: 'a' })
   * ```
   */
  async writeFile(path: string, data: string | Uint8Array, options?: WriteOptions): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const now = Date.now()
    const parentPath = this.getParentPath(normalized)
    const name = this.getFileName(normalized)

    // Check parent exists
    const parent = await this.getFile(parentPath)
    if (!parent) {
      throw new ENOENT(undefined, parentPath)
    }

    // Convert data to bytes
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data

    // Determine tier
    const tier = options?.tier ?? this.selectTier(bytes.length)

    // Check if file exists
    const existing = await this.getFile(normalized)

    // Handle exclusive flag
    if (options?.flag === 'wx' || options?.flag === 'ax') {
      if (existing) {
        throw new EEXIST(undefined, normalized)
      }
    }

    // Handle append flag
    if (options?.flag === 'a' || options?.flag === 'ax') {
      if (existing && existing.blob_id) {
        const existingData = await this.getBlob(existing.blob_id, existing.tier as 'hot' | 'warm' | 'cold')
        if (existingData) {
          const combined = new Uint8Array(existingData.length + bytes.length)
          combined.set(existingData)
          combined.set(bytes, existingData.length)
          const blobId = crypto.randomUUID()
          await this.storeBlob(blobId, combined, tier)

          // Delete old blob
          await this.deleteBlob(existing.blob_id, existing.tier as 'hot' | 'warm' | 'cold')

          // Update file
          this.sql.exec(
            'UPDATE files SET blob_id = ?, size = ?, tier = ?, mtime = ?, ctime = ? WHERE id = ?',
            blobId,
            combined.length,
            tier,
            now,
            now,
            existing.id
          )
          return
        }
      }
    }

    // Store blob
    const blobId = crypto.randomUUID()
    await this.storeBlob(blobId, bytes, tier)

    if (existing) {
      // Delete old blob
      if (existing.blob_id) {
        await this.deleteBlob(existing.blob_id, existing.tier as 'hot' | 'warm' | 'cold')
      }

      // Update file
      this.sql.exec(
        'UPDATE files SET blob_id = ?, size = ?, tier = ?, mtime = ?, ctime = ? WHERE id = ?',
        blobId,
        bytes.length,
        tier,
        now,
        now,
        existing.id
      )
    } else {
      // Create new file
      this.sql.exec(
        `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, blob_id, tier, atime, mtime, ctime, birthtime, nlink)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        normalized,
        name,
        parent.id,
        'file',
        options?.mode ?? this.defaultMode,
        0,
        0,
        bytes.length,
        blobId,
        tier,
        now,
        now,
        now,
        now,
        1
      )
    }
  }

  /**
   * Append data to a file.
   *
   * @param path - File path to append to
   * @param data - Data to append
   */
  async appendFile(path: string, data: string | Uint8Array): Promise<void> {
    return this.writeFile(path, data, { flag: 'a' })
  }

  /**
   * Delete a file.
   *
   * @param path - File path to delete
   */
  async unlink(path: string): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (file.type === 'directory') {
      throw new EISDIR(undefined, normalized)
    }

    // Delete blob
    if (file.blob_id) {
      await this.deleteBlob(file.blob_id, file.tier as 'hot' | 'warm' | 'cold')
    }

    // Delete file entry
    this.sql.exec('DELETE FROM files WHERE id = ?', file.id)
  }

  /**
   * Rename/move a file or directory.
   *
   * @param oldPath - Current path
   * @param newPath - New path
   * @param options - Move options
   */
  async rename(oldPath: string, newPath: string, options?: MoveOptions): Promise<void> {
    await this.initialize()
    const oldNormalized = this.normalizePath(oldPath)
    const newNormalized = this.normalizePath(newPath)
    const now = Date.now()

    const file = await this.getFile(oldNormalized)
    if (!file) {
      throw new ENOENT(undefined, oldNormalized)
    }

    // Check if destination exists
    const existing = await this.getFile(newNormalized)
    if (existing && !options?.overwrite) {
      throw new EEXIST(undefined, newNormalized)
    }

    // Get new parent
    const newParentPath = this.getParentPath(newNormalized)
    const newParent = await this.getFile(newParentPath)
    if (!newParent) {
      throw new ENOENT(undefined, newParentPath)
    }

    const newName = this.getFileName(newNormalized)

    // Delete existing if overwriting
    if (existing) {
      if (existing.blob_id) {
        await this.deleteBlob(existing.blob_id, existing.tier as 'hot' | 'warm' | 'cold')
      }
      this.sql.exec('DELETE FROM files WHERE id = ?', existing.id)
    }

    // Update file
    this.sql.exec(
      'UPDATE files SET path = ?, name = ?, parent_id = ?, ctime = ? WHERE id = ?',
      newNormalized,
      newName,
      newParent.id,
      now,
      file.id
    )

    // If directory, update all children paths
    if (file.type === 'directory') {
      const children = this.sql.exec<FileEntry>('SELECT * FROM files WHERE path LIKE ?', oldNormalized + '/%').toArray()
      for (const child of children) {
        const newChildPath = newNormalized + child.path.substring(oldNormalized.length)
        this.sql.exec('UPDATE files SET path = ? WHERE id = ?', newChildPath, child.id)
      }
    }
  }

  /**
   * Copy a file.
   *
   * @param src - Source file path
   * @param dest - Destination file path
   * @param options - Copy options
   */
  async copyFile(src: string, dest: string, options?: CopyOptions): Promise<void> {
    await this.initialize()
    const srcNormalized = this.normalizePath(src)
    const destNormalized = this.normalizePath(dest)

    const srcFile = await this.getFile(srcNormalized)
    if (!srcFile) {
      throw new ENOENT(undefined, srcNormalized)
    }

    // Check destination
    const existing = await this.getFile(destNormalized)
    if (existing && !options?.overwrite) {
      throw new EEXIST(undefined, destNormalized)
    }

    // Read source content
    const content = await this.readFile(srcNormalized)

    // Write to destination
    await this.writeFile(destNormalized, content)
  }

  /**
   * Truncate a file to a specified length.
   *
   * @param path - File path
   * @param length - New length (default: 0)
   */
  async truncate(path: string, length: number = 0): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (file.type === 'directory') {
      throw new EISDIR(undefined, normalized)
    }

    const now = Date.now()

    if (file.blob_id) {
      const data = await this.getBlob(file.blob_id, file.tier as 'hot' | 'warm' | 'cold')
      if (data) {
        const truncated = data.slice(0, length)
        const newBlobId = crypto.randomUUID()
        const newTier = this.selectTier(truncated.length)

        await this.storeBlob(newBlobId, truncated, newTier)
        await this.deleteBlob(file.blob_id, file.tier as 'hot' | 'warm' | 'cold')

        this.sql.exec(
          'UPDATE files SET blob_id = ?, size = ?, tier = ?, mtime = ?, ctime = ? WHERE id = ?',
          newBlobId,
          truncated.length,
          newTier,
          now,
          now,
          file.id
        )
      }
    }
  }

  // ===========================================================================
  // Directory Operations
  // ===========================================================================

  /**
   * Create a directory.
   *
   * @param path - Directory path
   * @param options - Mkdir options
   */
  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const now = Date.now()

    if (options?.recursive) {
      const parts = normalized.split('/').filter(Boolean)
      let currentPath = ''

      for (const part of parts) {
        currentPath += '/' + part
        const existing = await this.getFile(currentPath)

        if (!existing) {
          const parentPath = this.getParentPath(currentPath)
          const parent = await this.getFile(parentPath)

          this.sql.exec(
            `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, tier, atime, mtime, ctime, birthtime, nlink)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            currentPath,
            part,
            parent?.id ?? null,
            'directory',
            options?.mode ?? this.defaultDirMode,
            0,
            0,
            0,
            'hot',
            now,
            now,
            now,
            now,
            2
          )
        }
      }
    } else {
      const parentPath = this.getParentPath(normalized)
      const name = this.getFileName(normalized)
      const parent = await this.getFile(parentPath)

      if (!parent) {
        throw new ENOENT(undefined, parentPath)
      }

      const existing = await this.getFile(normalized)
      if (existing) {
        throw new EEXIST(undefined, normalized)
      }

      this.sql.exec(
        `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, tier, atime, mtime, ctime, birthtime, nlink)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        normalized,
        name,
        parent.id,
        'directory',
        options?.mode ?? this.defaultDirMode,
        0,
        0,
        0,
        'hot',
        now,
        now,
        now,
        now,
        2
      )
    }
  }

  /**
   * Remove a directory.
   *
   * @param path - Directory path
   * @param options - Rmdir options
   */
  async rmdir(path: string, options?: RmdirOptions): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (file.type !== 'directory') {
      throw new ENOTDIR(undefined, normalized)
    }

    const children = this.sql.exec<FileEntry>('SELECT * FROM files WHERE parent_id = ?', file.id).toArray()

    if (children.length > 0 && !options?.recursive) {
      throw new ENOTEMPTY(undefined, normalized)
    }

    if (options?.recursive) {
      // Delete all descendants recursively
      await this.deleteRecursive(file)
    } else {
      this.sql.exec('DELETE FROM files WHERE id = ?', file.id)
    }
  }

  private async deleteRecursive(file: FileEntry): Promise<void> {
    const children = this.sql.exec<FileEntry>('SELECT * FROM files WHERE parent_id = ?', file.id).toArray()

    for (const child of children) {
      if (child.type === 'directory') {
        await this.deleteRecursive(child)
      } else {
        if (child.blob_id) {
          await this.deleteBlob(child.blob_id, child.tier as 'hot' | 'warm' | 'cold')
        }
        this.sql.exec('DELETE FROM files WHERE id = ?', child.id)
      }
    }

    this.sql.exec('DELETE FROM files WHERE id = ?', file.id)
  }

  /**
   * Remove a file or directory.
   *
   * @param path - Path to remove
   * @param options - Remove options
   */
  async rm(path: string, options?: RemoveOptions): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      if (options?.force) return
      throw new ENOENT(undefined, normalized)
    }

    if (file.type === 'directory') {
      await this.rmdir(normalized, { recursive: options?.recursive })
    } else {
      await this.unlink(normalized)
    }
  }

  /**
   * Read directory contents.
   *
   * @param path - Directory path
   * @param options - Readdir options
   * @returns Array of filenames or Dirent objects
   */
  async readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (file.type !== 'directory') {
      throw new ENOTDIR(undefined, normalized)
    }

    const children = this.sql.exec<FileEntry>('SELECT * FROM files WHERE parent_id = ?', file.id).toArray()

    if (options?.withFileTypes) {
      const result: Dirent[] = children.map((child) => ({
        name: child.name,
        parentPath: normalized,
        path: child.path,
        isFile: () => child.type === 'file',
        isDirectory: () => child.type === 'directory',
        isSymbolicLink: () => child.type === 'symlink',
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
      }))

      if (options.recursive) {
        for (const child of children) {
          if (child.type === 'directory') {
            const subEntries = (await this.readdir(child.path, options)) as Dirent[]
            result.push(...subEntries)
          }
        }
      }

      return result
    }

    const names = children.map((c) => c.name)

    if (options?.recursive) {
      for (const child of children) {
        if (child.type === 'directory') {
          const subNames = (await this.readdir(child.path, options)) as string[]
          names.push(...subNames.map((n) => child.name + '/' + n))
        }
      }
    }

    return names
  }

  // ===========================================================================
  // Metadata Operations
  // ===========================================================================

  /**
   * Get file stats (follows symlinks).
   *
   * @param path - File path
   * @returns Stats object
   */
  async stat(path: string): Promise<Stats> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    let file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    // Follow symlinks
    while (file.type === 'symlink' && file.link_target) {
      file = await this.getFile(file.link_target)
      if (!file) {
        throw new ENOENT(undefined, normalized)
      }
    }

    return this.fileToStats(file)
  }

  /**
   * Get file stats (does not follow symlinks).
   *
   * @param path - File path
   * @returns Stats object
   */
  async lstat(path: string): Promise<Stats> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    return this.fileToStats(file)
  }

  private fileToStats(file: FileEntry): Stats {
    const typeMode =
      file.type === 'directory' ? S_IFDIR : file.type === 'symlink' ? S_IFLNK : S_IFREG

    const mode = typeMode | file.mode

    return {
      dev: 0,
      ino: file.id,
      mode,
      nlink: file.nlink,
      uid: file.uid,
      gid: file.gid,
      rdev: 0,
      size: file.size,
      blksize: 4096,
      blocks: Math.ceil(file.size / 512),
      atimeMs: file.atime,
      mtimeMs: file.mtime,
      ctimeMs: file.ctime,
      birthtimeMs: file.birthtime,
      atime: new Date(file.atime),
      mtime: new Date(file.mtime),
      ctime: new Date(file.ctime),
      birthtime: new Date(file.birthtime),
      isFile: () => file.type === 'file',
      isDirectory: () => file.type === 'directory',
      isSymbolicLink: () => file.type === 'symlink',
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    }
  }

  /**
   * Check if a path exists.
   *
   * @param path - Path to check
   * @returns True if path exists
   */
  async exists(path: string): Promise<boolean> {
    await this.initialize()
    const file = await this.getFile(path)
    return file !== null
  }

  /**
   * Get the integer rowid (file_id) for a file path.
   * This is useful for foreign key references from other tables.
   *
   * @param path - File path to look up
   * @returns The file's integer rowid, or null if file doesn't exist
   *
   * @example
   * ```typescript
   * const fileId = await fs.getFileId('/config.json')
   * if (fileId !== null) {
   *   // Use fileId as foreign key reference
   * }
   * ```
   */
  async getFileId(path: string): Promise<number | null> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const result = this.sql.exec<{ id: number }>('SELECT id FROM files WHERE path = ?', normalized).one()
    return result?.id ?? null
  }

  /**
   * Check access to a file.
   *
   * @param path - Path to check
   * @param _mode - Access mode (not fully implemented)
   */
  async access(path: string, _mode?: number): Promise<void> {
    await this.initialize()
    const file = await this.getFile(path)
    if (!file) {
      throw new ENOENT(undefined, path)
    }
    // Simplified: just check existence for now
  }

  /**
   * Change file mode.
   *
   * @param path - File path
   * @param mode - New mode
   */
  async chmod(path: string, mode: number): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    this.sql.exec('UPDATE files SET mode = ?, ctime = ? WHERE id = ?', mode, Date.now(), file.id)
  }

  /**
   * Change file ownership.
   *
   * @param path - File path
   * @param uid - User ID
   * @param gid - Group ID
   */
  async chown(path: string, uid: number, gid: number): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    this.sql.exec('UPDATE files SET uid = ?, gid = ?, ctime = ? WHERE id = ?', uid, gid, Date.now(), file.id)
  }

  /**
   * Update access and modification times.
   *
   * @param path - File path
   * @param atime - Access time
   * @param mtime - Modification time
   */
  async utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    const atimeMs = atime instanceof Date ? atime.getTime() : atime
    const mtimeMs = mtime instanceof Date ? mtime.getTime() : mtime

    this.sql.exec('UPDATE files SET atime = ?, mtime = ?, ctime = ? WHERE id = ?', atimeMs, mtimeMs, Date.now(), file.id)
  }

  // ===========================================================================
  // Symbolic Links
  // ===========================================================================

  /**
   * Create a symbolic link.
   *
   * @param target - Target path the symlink points to
   * @param path - Path of the symlink
   */
  async symlink(target: string, path: string): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const now = Date.now()
    const parentPath = this.getParentPath(normalized)
    const name = this.getFileName(normalized)

    const parent = await this.getFile(parentPath)
    if (!parent) {
      throw new ENOENT(undefined, parentPath)
    }

    const existing = await this.getFile(normalized)
    if (existing) {
      throw new EEXIST(undefined, normalized)
    }

    this.sql.exec(
      `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, link_target, tier, atime, mtime, ctime, birthtime, nlink)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      normalized,
      name,
      parent.id,
      'symlink',
      0o777,
      0,
      0,
      target.length,
      target,
      'hot',
      now,
      now,
      now,
      now,
      1
    )
  }

  /**
   * Create a hard link.
   *
   * @param existingPath - Path to existing file
   * @param newPath - Path for new link
   */
  async link(existingPath: string, newPath: string): Promise<void> {
    await this.initialize()
    const existingNormalized = this.normalizePath(existingPath)
    const newNormalized = this.normalizePath(newPath)
    const now = Date.now()

    const file = await this.getFile(existingNormalized)
    if (!file) {
      throw new ENOENT(undefined, existingNormalized)
    }

    const existing = await this.getFile(newNormalized)
    if (existing) {
      throw new EEXIST(undefined, newNormalized)
    }

    const parentPath = this.getParentPath(newNormalized)
    const name = this.getFileName(newNormalized)
    const parent = await this.getFile(parentPath)

    if (!parent) {
      throw new ENOENT(undefined, parentPath)
    }

    // Increment nlink
    this.sql.exec('UPDATE files SET nlink = nlink + 1 WHERE id = ?', file.id)

    // Create new entry
    this.sql.exec(
      `INSERT INTO files (path, name, parent_id, type, mode, uid, gid, size, blob_id, tier, atime, mtime, ctime, birthtime, nlink)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newNormalized,
      name,
      parent.id,
      file.type,
      file.mode,
      file.uid,
      file.gid,
      file.size,
      file.blob_id,
      file.tier,
      now,
      now,
      now,
      now,
      file.nlink + 1
    )
  }

  /**
   * Read a symbolic link's target.
   *
   * @param path - Symlink path
   * @returns Target path
   */
  async readlink(path: string): Promise<string> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (file.type !== 'symlink' || !file.link_target) {
      throw Object.assign(new Error('invalid argument'), { code: 'EINVAL', path: normalized })
    }

    return file.link_target
  }

  /**
   * Get the real path (resolve symlinks).
   *
   * @param path - Path to resolve
   * @returns Resolved path
   */
  async realpath(path: string): Promise<string> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    let file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    // Follow symlinks
    let depth = 0
    while (file.type === 'symlink' && file.link_target) {
      if (depth++ > 40) {
        throw Object.assign(new Error('too many symbolic links'), { code: 'ELOOP', path: normalized })
      }

      let target = file.link_target
      if (!target.startsWith('/')) {
        const parentPath = this.getParentPath(file.path)
        target = this.normalizePath(parentPath + '/' + target)
      }

      file = await this.getFile(target)
      if (!file) {
        throw new ENOENT(undefined, target)
      }
    }

    return file.path
  }

  // ===========================================================================
  // Tiered Storage Operations
  // ===========================================================================

  /**
   * Get the current storage tier of a file.
   *
   * @param path - File path
   * @returns Current tier
   */
  async getTier(path: string): Promise<'hot' | 'warm' | 'cold'> {
    await this.initialize()
    const file = await this.getFile(path)

    if (!file) {
      throw new ENOENT(undefined, path)
    }

    return file.tier as 'hot' | 'warm' | 'cold'
  }

  /**
   * Promote a file to a hotter storage tier.
   *
   * @param path - File path
   * @param tier - Target tier ('hot' or 'warm')
   */
  async promote(path: string, tier: 'hot' | 'warm'): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (!file.blob_id) return

    const currentTier = file.tier as 'hot' | 'warm' | 'cold'
    if (currentTier === tier) return

    // Read from current tier
    const data = await this.getBlob(file.blob_id, currentTier)
    if (!data) return

    // Store in new tier
    const newBlobId = crypto.randomUUID()
    await this.storeBlob(newBlobId, data, tier)

    // Delete from old tier
    await this.deleteBlob(file.blob_id, currentTier)

    // Update file
    this.sql.exec('UPDATE files SET blob_id = ?, tier = ? WHERE id = ?', newBlobId, tier, file.id)
  }

  /**
   * Demote a file to a colder storage tier.
   *
   * @param path - File path
   * @param tier - Target tier ('warm' or 'cold')
   */
  async demote(path: string, tier: 'warm' | 'cold'): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const file = await this.getFile(normalized)

    if (!file) {
      throw new ENOENT(undefined, normalized)
    }

    if (!file.blob_id) return

    const currentTier = file.tier as 'hot' | 'warm' | 'cold'
    if (currentTier === tier) return

    // Read from current tier
    const data = await this.getBlob(file.blob_id, currentTier)
    if (!data) return

    // Store in new tier
    const newBlobId = crypto.randomUUID()
    await this.storeBlob(newBlobId, data, tier)

    // Delete from old tier
    await this.deleteBlob(file.blob_id, currentTier)

    // Update file
    this.sql.exec('UPDATE files SET blob_id = ?, tier = ? WHERE id = ?', newBlobId, tier, file.id)
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an FsModule instance with the given options.
 *
 * @param options - Configuration options for the module
 * @returns A new FsModule instance
 *
 * @example
 * ```typescript
 * import { createFsModule } from 'gitx.do/do'
 *
 * const fs = createFsModule({
 *   sql: ctx.storage.sql,
 *   r2: env.R2_BUCKET
 * })
 * ```
 */
export function createFsModule(options: FsModuleOptions): FsModule {
  return new FsModule(options)
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is an FsModule instance.
 *
 * @param value - Value to check
 * @returns True if value is an FsModule
 */
export function isFsModule(value: unknown): value is FsModule {
  return value instanceof FsModule
}
