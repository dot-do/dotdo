/**
 * R2Backend - Cloudflare R2 implementation of FsBackend
 *
 * This is the production backend for fsx that stores files in Cloudflare R2
 * with metadata in SQLite (via Durable Objects).
 *
 * Architecture:
 * - Metadata (paths, permissions, timestamps) -> SQLite
 * - File content -> R2 (warm/cold tier) or SQLite blobs (hot tier)
 *
 * @module storage/r2-backend
 */

import type {
  WriteOptions,
  MkdirOptions,
  RmdirOptions,
  ReaddirOptions,
  Stats,
  Dirent,
  StorageTier,
  FileEntry,
} from '../core/index.js'
import type { FsBackend, BackendWriteResult, FileHandle } from '../core/backend.js'
import { ENOENT, EEXIST, EISDIR, ENOTDIR, ENOTEMPTY } from '../core/errors.js'
import { SQLiteMetadata } from './sqlite.js'
import { R2Storage } from './r2.js'

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration options for R2Backend.
 */
export interface R2BackendConfig {
  /** SQLite storage instance from Durable Object context */
  sql: SqlStorage

  /** R2 bucket for warm tier storage (required for production) */
  r2: R2Bucket

  /** Optional R2 bucket for cold/archive tier storage */
  archive?: R2Bucket

  /** Hot tier max size in bytes (default: 1MB) - files smaller than this go to SQLite */
  hotMaxSize?: number

  /** Default file mode (default: 0o644) */
  defaultMode?: number

  /** Default directory mode (default: 0o755) */
  defaultDirMode?: number

  /** Key prefix for R2 objects (default: '') */
  prefix?: string
}

// =============================================================================
// R2Backend Implementation
// =============================================================================

/**
 * R2Backend - Production filesystem backend using R2 + SQLite.
 *
 * Implements the FsBackend interface for use with FSx. Stores metadata in
 * SQLite and file content in R2, with automatic tiering based on file size.
 *
 * @example
 * ```typescript
 * import { FSx } from '@dotdo/fsx'
 * import { R2Backend } from 'fsx/storage'
 *
 * const backend = new R2Backend({
 *   sql: ctx.storage.sql,
 *   r2: env.MY_BUCKET,
 *   hotMaxSize: 512 * 1024, // 512KB
 * })
 *
 * const fs = new FSx(backend)
 * await fs.write('/config.json', JSON.stringify(config))
 * ```
 */
export class R2Backend implements FsBackend {
  private sql: SqlStorage
  private metadata: SQLiteMetadata
  private r2Storage: R2Storage
  private archive?: R2Storage
  private hotMaxSize: number
  private defaultMode: number
  private defaultDirMode: number
  private initialized = false

  constructor(config: R2BackendConfig) {
    this.sql = config.sql
    this.metadata = new SQLiteMetadata(config.sql)
    this.r2Storage = new R2Storage({ bucket: config.r2, prefix: config.prefix })
    if (config.archive) {
      this.archive = new R2Storage({ bucket: config.archive, prefix: config.prefix })
    }
    this.hotMaxSize = config.hotMaxSize ?? 1024 * 1024 // 1MB default
    this.defaultMode = config.defaultMode ?? 0o644
    this.defaultDirMode = config.defaultDirMode ?? 0o755
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  private async initialize(): Promise<void> {
    if (this.initialized) return
    await this.metadata.init()
    this.initialized = true
  }

  // ===========================================================================
  // Path Utilities
  // ===========================================================================

  private normalizePath(path: string): string {
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
  // Tier Selection
  // ===========================================================================

  private selectTier(size: number): StorageTier {
    if (size <= this.hotMaxSize) return 'hot'
    return 'warm'
  }

  // ===========================================================================
  // Blob Storage
  // ===========================================================================

  private async storeBlob(id: string, data: Uint8Array, tier: StorageTier): Promise<void> {
    if (tier === 'hot') {
      // Store in SQLite
      const now = Date.now()
      this.sql.exec(
        'INSERT OR REPLACE INTO blobs (id, data, size, tier, created_at) VALUES (?, ?, ?, ?, ?)',
        id,
        data.buffer,
        data.length,
        tier,
        now
      )
    } else if (tier === 'warm') {
      // Store in R2
      await this.r2Storage.put(id, data)
      // Register blob in metadata
      await this.metadata.registerBlob({ id, tier, size: data.length })
    } else if (tier === 'cold' && this.archive) {
      // Store in archive R2
      await this.archive.put(id, data)
      await this.metadata.registerBlob({ id, tier, size: data.length })
    }
  }

  private async getBlob(id: string, tier: StorageTier): Promise<Uint8Array | null> {
    if (tier === 'hot') {
      const blob = this.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM blobs WHERE id = ?', id).one()
      if (!blob?.data) return null
      return new Uint8Array(blob.data)
    }

    if (tier === 'warm') {
      const result = await this.r2Storage.get(id)
      return result?.data ?? null
    }

    if (tier === 'cold' && this.archive) {
      const result = await this.archive.get(id)
      return result?.data ?? null
    }

    return null
  }

  private async deleteBlob(id: string, tier: StorageTier): Promise<void> {
    if (tier === 'hot') {
      this.sql.exec('DELETE FROM blobs WHERE id = ?', id)
    } else if (tier === 'warm') {
      await this.r2Storage.delete(id)
      await this.metadata.deleteBlob(id)
    } else if (tier === 'cold' && this.archive) {
      await this.archive.delete(id)
      await this.metadata.deleteBlob(id)
    }
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Get the tier for a blob ID by looking it up
   */
  private async getBlobTier(blobId: string): Promise<StorageTier> {
    // First check hot tier (SQLite)
    const hotBlob = this.sql.exec<{ tier: string }>('SELECT tier FROM blobs WHERE id = ?', blobId).one()
    if (hotBlob) {
      return hotBlob.tier as StorageTier
    }
    // If not in SQLite, check metadata for R2-stored blobs
    const blobRef = await this.metadata.getBlob(blobId)
    return (blobRef?.tier as StorageTier) ?? 'hot'
  }

  async readFile(path: string): Promise<Uint8Array> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('readFile', normalized)
    }

    if (entry.type === 'directory') {
      throw new EISDIR('readFile', normalized)
    }

    // Follow symlinks
    if (entry.type === 'symlink' && entry.linkTarget) {
      return this.readFile(entry.linkTarget)
    }

    if (!entry.blobId) {
      return new Uint8Array(0)
    }

    const tier = await this.getBlobTier(entry.blobId)
    const data = await this.getBlob(entry.blobId, tier)
    return data ?? new Uint8Array(0)
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    options?: WriteOptions
  ): Promise<BackendWriteResult> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const parentPath = this.getParentPath(normalized)
    const name = this.getFileName(normalized)

    // Check parent exists
    const parent = await this.metadata.getByPath(parentPath)
    if (!parent) {
      throw new ENOENT('writeFile', parentPath)
    }

    // Determine tier
    const tier = options?.tier ?? this.selectTier(data.length)

    // Check if file exists
    const existing = await this.metadata.getByPath(normalized)

    // Handle exclusive flag
    if (options?.flag === 'wx' || options?.flag === 'ax') {
      if (existing) {
        throw new EEXIST('writeFile', normalized)
      }
    }

    const now = Date.now()
    const blobId = crypto.randomUUID()

    // Store blob
    await this.storeBlob(blobId, data, tier)

    if (existing) {
      // Delete old blob
      if (existing.blobId) {
        const oldTier = await this.getBlobTier(existing.blobId)
        await this.deleteBlob(existing.blobId, oldTier)
      }

      // Update file entry
      await this.metadata.updateEntry(existing.id, {
        blobId,
        size: data.length,
        mtime: now,
      })
    } else {
      // Create new file entry
      await this.metadata.createEntry({
        path: normalized,
        name,
        parentId: parent.id,
        type: 'file',
        mode: options?.mode ?? this.defaultMode,
        uid: 0,
        gid: 0,
        size: data.length,
        blobId,
        linkTarget: null,
        nlink: 1,
      })
      // Store tier with the blob
    }

    return { bytesWritten: data.length, tier }
  }

  async unlink(path: string): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('unlink', normalized)
    }

    if (entry.type === 'directory') {
      throw new EISDIR('unlink', normalized)
    }

    // Delete blob
    if (entry.blobId) {
      const tier = await this.getBlobTier(entry.blobId)
      await this.deleteBlob(entry.blobId, tier)
    }

    // Delete file entry
    await this.metadata.deleteEntry(entry.id)
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.initialize()
    const oldNormalized = this.normalizePath(oldPath)
    const newNormalized = this.normalizePath(newPath)

    const entry = await this.metadata.getByPath(oldNormalized)
    if (!entry) {
      throw new ENOENT('rename', oldNormalized)
    }

    // Check destination parent exists
    const newParentPath = this.getParentPath(newNormalized)
    const newParent = await this.metadata.getByPath(newParentPath)
    if (!newParent) {
      throw new ENOENT('rename', newParentPath)
    }

    const newName = this.getFileName(newNormalized)

    // Check if destination exists and remove it
    const existing = await this.metadata.getByPath(newNormalized)
    if (existing) {
      if (existing.blobId) {
        const tier = await this.getBlobTier(existing.blobId)
        await this.deleteBlob(existing.blobId, tier)
      }
      await this.metadata.deleteEntry(existing.id)
    }

    // Update entry
    await this.metadata.updateEntry(entry.id, {
      path: newNormalized,
      name: newName,
      parentId: newParent.id,
    })
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const data = await this.readFile(src)
    await this.writeFile(dest, data)
  }

  // ===========================================================================
  // Directory Operations
  // ===========================================================================

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)

    if (options?.recursive) {
      const parts = normalized.split('/').filter(Boolean)
      let currentPath = ''

      for (const part of parts) {
        currentPath += '/' + part
        const existing = await this.metadata.getByPath(currentPath)

        if (!existing) {
          const parentPath = this.getParentPath(currentPath)
          const parent = await this.metadata.getByPath(parentPath)

          await this.metadata.createEntry({
            path: currentPath,
            name: part,
            parentId: parent?.id ?? null,
            type: 'directory',
            mode: options?.mode ?? this.defaultDirMode,
            uid: 0,
            gid: 0,
            size: 0,
            blobId: null,
            linkTarget: null,
            nlink: 2,
          })
        }
      }
    } else {
      const parentPath = this.getParentPath(normalized)
      const name = this.getFileName(normalized)
      const parent = await this.metadata.getByPath(parentPath)

      if (!parent) {
        throw new ENOENT('mkdir', parentPath)
      }

      const existing = await this.metadata.getByPath(normalized)
      if (existing) {
        throw new EEXIST('mkdir', normalized)
      }

      await this.metadata.createEntry({
        path: normalized,
        name,
        parentId: parent.id,
        type: 'directory',
        mode: options?.mode ?? this.defaultDirMode,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 2,
      })
    }
  }

  async rmdir(path: string, options?: RmdirOptions): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('rmdir', normalized)
    }

    if (entry.type !== 'directory') {
      throw new ENOTDIR('rmdir', normalized)
    }

    const children = await this.metadata.getChildren(entry.id)

    if (children.length > 0 && !options?.recursive) {
      throw new ENOTEMPTY('rmdir', normalized)
    }

    if (options?.recursive) {
      await this.deleteRecursive(entry)
    } else {
      await this.metadata.deleteEntry(entry.id)
    }
  }

  private async deleteRecursive(entry: FileEntry): Promise<void> {
    const children = await this.metadata.getChildren(entry.id)

    for (const child of children) {
      if (child.type === 'directory') {
        await this.deleteRecursive(child)
      } else {
        if (child.blobId) {
          const tier = await this.getBlobTier(child.blobId)
          await this.deleteBlob(child.blobId, tier)
        }
        await this.metadata.deleteEntry(child.id)
      }
    }

    await this.metadata.deleteEntry(entry.id)
  }

  async readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('readdir', normalized)
    }

    if (entry.type !== 'directory') {
      throw new ENOTDIR('readdir', normalized)
    }

    const children = await this.metadata.getChildren(entry.id)

    if (options?.withFileTypes) {
      const { Dirent: DirentClass } = await import('../core/index.js')
      return children.map(child => new DirentClass(
        child.name,
        normalized,
        child.type as 'file' | 'directory' | 'symlink'
      ))
    }

    return children.map(c => c.name)
  }

  // ===========================================================================
  // Metadata Operations
  // ===========================================================================

  async stat(path: string): Promise<Stats> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    let entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('stat', normalized)
    }

    // Follow symlinks
    while (entry.type === 'symlink' && entry.linkTarget) {
      entry = await this.metadata.getByPath(entry.linkTarget)
      if (!entry) {
        throw new ENOENT('stat', normalized)
      }
    }

    return this.entryToStats(entry)
  }

  async lstat(path: string): Promise<Stats> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('lstat', normalized)
    }

    return this.entryToStats(entry)
  }

  private async entryToStats(entry: { id: string; type: string; mode: number; uid: number; gid: number; size: number; nlink: number; atime?: number; mtime?: number; ctime?: number; birthtime?: number }): Promise<Stats> {
    const { Stats: StatsClass, constants } = await import('../core/index.js')

    const typeMode =
      entry.type === 'directory' ? constants.S_IFDIR :
      entry.type === 'symlink' ? constants.S_IFLNK :
      constants.S_IFREG

    const mode = typeMode | entry.mode
    const now = Date.now()

    return new StatsClass({
      dev: 0,
      ino: parseInt(entry.id, 10) || 0,
      mode,
      nlink: entry.nlink,
      uid: entry.uid,
      gid: entry.gid,
      rdev: 0,
      size: entry.size,
      blksize: 4096,
      blocks: Math.ceil(entry.size / 512),
      atimeMs: entry.atime ?? now,
      mtimeMs: entry.mtime ?? now,
      ctimeMs: entry.ctime ?? now,
      birthtimeMs: entry.birthtime ?? now,
    })
  }

  async exists(path: string): Promise<boolean> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)
    return entry !== null
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('chmod', normalized)
    }

    await this.metadata.updateEntry(entry.id, { mode })
  }

  async chown(path: string, uid: number, gid: number): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('chown', normalized)
    }

    await this.metadata.updateEntry(entry.id, { uid, gid })
  }

  async utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('utimes', normalized)
    }

    const atimeMs = atime instanceof Date ? atime.getTime() : atime
    const mtimeMs = mtime instanceof Date ? mtime.getTime() : mtime

    await this.metadata.updateEntry(entry.id, { atime: atimeMs, mtime: mtimeMs })
  }

  // ===========================================================================
  // Symbolic Links
  // ===========================================================================

  async symlink(target: string, path: string): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const parentPath = this.getParentPath(normalized)
    const name = this.getFileName(normalized)

    const parent = await this.metadata.getByPath(parentPath)
    if (!parent) {
      throw new ENOENT('symlink', parentPath)
    }

    const existing = await this.metadata.getByPath(normalized)
    if (existing) {
      throw new EEXIST('symlink', normalized)
    }

    await this.metadata.createEntry({
      path: normalized,
      name,
      parentId: parent.id,
      type: 'symlink',
      mode: 0o777,
      uid: 0,
      gid: 0,
      size: target.length,
      blobId: null,
      linkTarget: target,
      nlink: 1,
    })
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    await this.initialize()
    const existingNormalized = this.normalizePath(existingPath)
    const newNormalized = this.normalizePath(newPath)

    const entry = await this.metadata.getByPath(existingNormalized)
    if (!entry) {
      throw new ENOENT('link', existingNormalized)
    }

    const existing = await this.metadata.getByPath(newNormalized)
    if (existing) {
      throw new EEXIST('link', newNormalized)
    }

    const parentPath = this.getParentPath(newNormalized)
    const name = this.getFileName(newNormalized)
    const parent = await this.metadata.getByPath(parentPath)

    if (!parent) {
      throw new ENOENT('link', parentPath)
    }

    // Increment blob ref count
    if (entry.blobId) {
      await this.metadata.incrementBlobRefCount(entry.blobId)
    }

    // Create new entry with same blob
    await this.metadata.createEntry({
      path: newNormalized,
      name,
      parentId: parent.id,
      type: entry.type as 'file' | 'directory' | 'symlink',
      mode: entry.mode,
      uid: entry.uid,
      gid: entry.gid,
      size: entry.size,
      blobId: entry.blobId,
      linkTarget: null,
      nlink: entry.nlink + 1,
    })
  }

  async readlink(path: string): Promise<string> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('readlink', normalized)
    }

    if (entry.type !== 'symlink' || !entry.linkTarget) {
      throw Object.assign(new Error('invalid argument'), { code: 'EINVAL', path: normalized })
    }

    return entry.linkTarget
  }

  // ===========================================================================
  // Additional Required Operations
  // ===========================================================================

  async appendFile(path: string, data: Uint8Array): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)

    try {
      const existing = await this.readFile(normalized)
      const combined = new Uint8Array(existing.length + data.length)
      combined.set(existing)
      combined.set(data, existing.length)
      await this.writeFile(normalized, combined)
    } catch (e) {
      // If file doesn't exist, create it
      if ((e as { code?: string }).code === 'ENOENT') {
        await this.writeFile(normalized, data)
      } else {
        throw e
      }
    }
  }

  async access(path: string, _mode?: number): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('access', normalized)
    }
    // Simplified: just check existence for now (mode checks not implemented)
  }

  async realpath(path: string): Promise<string> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    let entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('realpath', normalized)
    }

    // Follow symlinks
    let depth = 0
    while (entry.type === 'symlink' && entry.linkTarget) {
      if (depth++ > 40) {
        throw Object.assign(new Error('too many symbolic links'), { code: 'ELOOP', path: normalized })
      }

      let target = entry.linkTarget
      if (!target.startsWith('/')) {
        const parentPath = this.getParentPath(entry.path)
        target = this.normalizePath(parentPath + '/' + target)
      }

      entry = await this.metadata.getByPath(target)
      if (!entry) {
        throw new ENOENT('realpath', target)
      }
    }

    return entry.path
  }

  async mkdtemp(prefix: string): Promise<string> {
    await this.initialize()
    const random = crypto.randomUUID().slice(0, 6)
    const dirPath = `/tmp/${prefix}${random}`

    await this.mkdir(dirPath, { recursive: true })
    return dirPath
  }

  async open(path: string, flags?: string, mode?: number): Promise<FileHandle> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    let data: Uint8Array
    if (entry) {
      data = entry.blobId
        ? (await this.getBlob(entry.blobId, await this.getBlobTier(entry.blobId))) ?? new Uint8Array(0)
        : new Uint8Array(0)
    } else {
      // Create file if flags allow
      if (flags === 'w' || flags === 'w+' || flags === 'a' || flags === 'a+') {
        await this.writeFile(normalized, new Uint8Array(0), { mode: mode ?? this.defaultMode })
        data = new Uint8Array(0)
      } else {
        throw new ENOENT('open', normalized)
      }
    }

    const stats = await this.stat(normalized)
    const self = this

    // Create FileHandle
    const fd = Math.floor(Math.random() * 1000000)
    let fileData = data

    return {
      fd,
      read: async (buffer: Uint8Array, offset?: number, length?: number, position?: number) => {
        const readPos = position ?? 0
        const readLen = length ?? (buffer.length - (offset ?? 0))
        const bytesToRead = Math.min(readLen, fileData.length - readPos)

        for (let i = 0; i < bytesToRead; i++) {
          buffer[(offset ?? 0) + i] = fileData[readPos + i]!
        }

        return { bytesRead: bytesToRead, buffer }
      },
      write: async (writeData: Uint8Array | string, position?: number) => {
        const bytes = typeof writeData === 'string' ? new TextEncoder().encode(writeData) : writeData
        const pos = position ?? fileData.length

        if (pos + bytes.length > fileData.length) {
          const newData = new Uint8Array(pos + bytes.length)
          newData.set(fileData)
          fileData = newData
        }

        for (let i = 0; i < bytes.length; i++) {
          fileData[pos + i] = bytes[i]!
        }

        return { bytesWritten: bytes.length }
      },
      readFile: async () => fileData,
      writeFile: async (newData: Uint8Array | string) => {
        fileData = typeof newData === 'string' ? new TextEncoder().encode(newData) : newData
      },
      stat: async () => stats,
      chmod: async (newMode: number) => {
        await self.chmod(normalized, newMode)
      },
      chown: async (uid: number, gid: number) => {
        await self.chown(normalized, uid, gid)
      },
      truncate: async (length: number = 0) => {
        fileData = fileData.slice(0, length)
      },
      sync: async () => {
        await self.writeFile(normalized, fileData)
      },
      datasync: async () => {
        await self.writeFile(normalized, fileData)
      },
      close: async () => {
        await self.writeFile(normalized, fileData)
      },
    } as FileHandle
  }

  // ===========================================================================
  // Tiering Operations
  // ===========================================================================

  async getTier(path: string): Promise<StorageTier> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('getTier', normalized)
    }

    if (!entry.blobId) return 'hot'
    return this.getBlobTier(entry.blobId)
  }

  async promote(path: string, tier: 'hot' | 'warm'): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('promote', normalized)
    }

    if (!entry.blobId) return

    const currentTier = await this.getBlobTier(entry.blobId)
    if (currentTier === tier) return

    // Read data from current tier
    const data = await this.getBlob(entry.blobId, currentTier)
    if (!data) return

    // Store in new tier
    const newBlobId = crypto.randomUUID()
    await this.storeBlob(newBlobId, data, tier)

    // Delete from old tier
    await this.deleteBlob(entry.blobId, currentTier)

    // Update entry
    await this.metadata.updateEntry(entry.id, { blobId: newBlobId })
  }

  async demote(path: string, tier: 'warm' | 'cold'): Promise<void> {
    await this.initialize()
    const normalized = this.normalizePath(path)
    const entry = await this.metadata.getByPath(normalized)

    if (!entry) {
      throw new ENOENT('demote', normalized)
    }

    if (!entry.blobId) return

    const currentTier = await this.getBlobTier(entry.blobId)
    if (currentTier === tier) return

    // Read data from current tier
    const data = await this.getBlob(entry.blobId, currentTier)
    if (!data) return

    // Store in new tier
    const newBlobId = crypto.randomUUID()
    await this.storeBlob(newBlobId, data, tier)

    // Delete from old tier
    await this.deleteBlob(entry.blobId, currentTier)

    // Update entry
    await this.metadata.updateEntry(entry.id, { blobId: newBlobId })
  }
}
