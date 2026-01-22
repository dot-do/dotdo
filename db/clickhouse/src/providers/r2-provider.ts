/**
 * @dotdo/clickhouse - R2 Storage Provider
 *
 * VFS storage provider that stores MergeTree data in Cloudflare R2.
 * Provides efficient range reads for column-oriented data access.
 */

import type { VFSStorageProvider, FileStat, DirEntry } from '../types'

// =============================================================================
// Configuration
// =============================================================================

export interface R2ProviderConfig {
  /** R2 bucket for data storage */
  bucket: R2Bucket

  /** Prefix for all keys (namespace isolation) */
  prefix?: string

  /** Read cache configuration */
  cache?: {
    /** Enable caching (default: true) */
    enabled?: boolean
    /** Max cache size in bytes (default: 64MB) */
    maxSize?: number
    /** Max file size to cache (default: 1MB) */
    maxFileSize?: number
    /** TTL in milliseconds (default: 5 minutes) */
    ttl?: number
  }

  /** Write buffer configuration */
  writeBuffer?: {
    /** Threshold before flush (default: 256KB) */
    threshold?: number
    /** Max buffer count (default: 100) */
    maxCount?: number
  }
}

// =============================================================================
// R2 Storage Provider
// =============================================================================

/**
 * R2 storage provider for MergeTree data
 *
 * @example
 * ```typescript
 * const r2Provider = new R2Provider({
 *   bucket: env.ANALYTICS_BUCKET,
 *   prefix: 'analytics/default',
 *   cache: { maxSize: 64 * 1024 * 1024 }
 * })
 *
 * // Used by VFS bridge for MergeTree I/O
 * const data = await r2Provider.read('data/events/20240115_1_1_0/data.bin', 0, 4096)
 * ```
 */
// Internal resolved config type with all required properties
interface ResolvedR2Config {
  bucket: R2Bucket
  prefix: string
  cache: {
    enabled: boolean
    maxSize: number
    maxFileSize: number
    ttl: number
  }
  writeBuffer: {
    threshold: number
    maxCount: number
  }
}

export class R2Provider implements VFSStorageProvider {
  private bucket: R2Bucket
  private prefix: string
  private cache: FileCache
  private writeBuffers: Map<string, WriteBuffer> = new Map()
  private config: ResolvedR2Config

  constructor(config: R2ProviderConfig) {
    this.bucket = config.bucket
    this.prefix = config.prefix ?? ''

    this.config = {
      bucket: config.bucket,
      prefix: config.prefix ?? '',
      cache: {
        enabled: config.cache?.enabled ?? true,
        maxSize: config.cache?.maxSize ?? 64 * 1024 * 1024,
        maxFileSize: config.cache?.maxFileSize ?? 1024 * 1024,
        ttl: config.cache?.ttl ?? 5 * 60 * 1000
      },
      writeBuffer: {
        threshold: config.writeBuffer?.threshold ?? 256 * 1024,
        maxCount: config.writeBuffer?.maxCount ?? 100
      }
    }

    this.cache = new FileCache(this.config.cache)
  }

  // ===========================================================================
  // VFSStorageProvider Implementation
  // ===========================================================================

  async stat(path: string): Promise<FileStat | null> {
    const key = this.toKey(path)

    // Check if it's a "directory" (prefix with objects under it)
    const listResult = await this.bucket.list({
      prefix: key.endsWith('/') ? key : key + '/',
      limit: 1
    })

    if (listResult.objects.length > 0) {
      return {
        size: 0,
        mtime: Date.now(),
        isDirectory: true
      }
    }

    // Check if it's a file
    const head = await this.bucket.head(key)
    if (!head) return null

    return {
      size: head.size,
      mtime: head.uploaded.getTime(),
      isDirectory: false
    }
  }

  async read(path: string, offset: number, length: number): Promise<ArrayBuffer> {
    const key = this.toKey(path)

    // Check cache first
    const cached = this.cache.get(key)
    if (cached) {
      return cached.slice(offset, offset + length)
    }

    // Check write buffer (for uncommitted writes)
    const writeBuffer = this.writeBuffers.get(key)
    if (writeBuffer) {
      return writeBuffer.read(offset, length)
    }

    // Range request from R2
    const result = await this.bucket.get(key, {
      range: { offset, length }
    })

    if (!result) {
      throw new Error(`File not found: ${path}`)
    }

    return result.arrayBuffer()
  }

  async readFile(path: string): Promise<ArrayBuffer> {
    const key = this.toKey(path)

    // Check cache first
    const cached = this.cache.get(key)
    if (cached) return cached

    // Check write buffer
    const writeBuffer = this.writeBuffers.get(key)
    if (writeBuffer) {
      return writeBuffer.toArrayBuffer()
    }

    // Full read from R2
    const result = await this.bucket.get(key)
    if (!result) {
      throw new Error(`File not found: ${path}`)
    }

    const data = await result.arrayBuffer()

    // Cache if small enough
    if (data.byteLength <= this.config.cache.maxFileSize) {
      this.cache.set(key, data)
    }

    return data
  }

  async write(path: string, data: ArrayBuffer): Promise<void> {
    const key = this.toKey(path)

    // For small writes, buffer them
    if (data.byteLength < this.config.writeBuffer.threshold) {
      let buffer = this.writeBuffers.get(key)
      if (!buffer) {
        buffer = new WriteBuffer()
        this.writeBuffers.set(key, buffer)
      }
      buffer.replace(data)

      // Flush if buffer count exceeds limit
      if (this.writeBuffers.size > this.config.writeBuffer.maxCount) {
        await this.flushOldestBuffer()
      }

      return
    }

    // Large writes go directly to R2
    await this.bucket.put(key, data)

    // Invalidate cache
    this.cache.delete(key)
  }

  async append(path: string, data: ArrayBuffer): Promise<void> {
    const key = this.toKey(path)

    // Get or create write buffer
    let buffer = this.writeBuffers.get(key)
    if (!buffer) {
      // Try to load existing file into buffer
      try {
        const existing = await this.bucket.get(key)
        buffer = new WriteBuffer(existing ? await existing.arrayBuffer() : undefined)
      } catch {
        buffer = new WriteBuffer()
      }
      this.writeBuffers.set(key, buffer)
    }

    buffer.append(data)

    // Flush if buffer exceeds threshold
    if (buffer.size > this.config.writeBuffer.threshold) {
      await this.flushBuffer(key)
    }
  }

  async delete(path: string): Promise<void> {
    const key = this.toKey(path)

    // Delete from R2
    await this.bucket.delete(key)

    // Clean up buffer and cache
    this.writeBuffers.delete(key)
    this.cache.delete(key)
  }

  async list(path: string): Promise<DirEntry[]> {
    const prefix = this.toKey(path)
    const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix + '/'

    const entries: DirEntry[] = []
    const seenDirs = new Set<string>()

    let cursor: string | undefined
    do {
      const listOptions: R2ListOptions = {
        prefix: normalizedPrefix,
        delimiter: '/'
      }
      if (cursor !== undefined) {
        listOptions.cursor = cursor
      }
      const result = await this.bucket.list(listOptions)

      // Add files
      for (const obj of result.objects) {
        const name = obj.key.slice(normalizedPrefix.length)
        if (name && !name.includes('/')) {
          entries.push({ name, isDirectory: false })
        }
      }

      // Add directories (common prefixes)
      for (const prefix of result.delimitedPrefixes) {
        const name = prefix.slice(normalizedPrefix.length).replace(/\/$/, '')
        if (name && !seenDirs.has(name)) {
          seenDirs.add(name)
          entries.push({ name, isDirectory: true })
        }
      }

      cursor = result.truncated ? result.cursor : undefined
    } while (cursor)

    return entries
  }

  async mkdir(_path: string): Promise<void> {
    // R2 doesn't have real directories - they're implicit from key prefixes
    // No-op, but we could create a .keep file if needed
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldKey = this.toKey(oldPath)
    const newKey = this.toKey(newPath)

    // R2 doesn't have rename - copy then delete
    const obj = await this.bucket.get(oldKey)
    if (!obj) {
      throw new Error(`File not found: ${oldPath}`)
    }

    await this.bucket.put(newKey, await obj.arrayBuffer())
    await this.bucket.delete(oldKey)

    // Update buffer if exists
    const buffer = this.writeBuffers.get(oldKey)
    if (buffer) {
      this.writeBuffers.delete(oldKey)
      this.writeBuffers.set(newKey, buffer)
    }

    // Update cache
    const cached = this.cache.get(oldKey)
    if (cached) {
      this.cache.delete(oldKey)
      this.cache.set(newKey, cached)
    }
  }

  async flush(): Promise<void> {
    // Flush all write buffers
    const keys = Array.from(this.writeBuffers.keys())
    await Promise.all(keys.map(key => this.flushBuffer(key)))
  }

  // ===========================================================================
  // MergeTree-Specific Methods
  // ===========================================================================

  /**
   * Read multiple ranges in a single request (for column reads)
   */
  async readRanges(
    path: string,
    ranges: Array<{ offset: number; length: number }>
  ): Promise<ArrayBuffer[]> {
    // R2 doesn't support multi-range requests, so we batch individual requests
    // In the future, this could use a smarter batching strategy
    return Promise.all(
      ranges.map(range => this.read(path, range.offset, range.length))
    )
  }

  /**
   * Write a MergeTree part (multiple files atomically)
   */
  async writePart(
    partPath: string,
    files: Map<string, ArrayBuffer>
  ): Promise<void> {
    // Write all files in parallel
    const writes = Array.from(files.entries()).map(([name, data]) =>
      this.write(`${partPath}/${name}`, data)
    )

    await Promise.all(writes)
  }

  /**
   * Delete a MergeTree part (all files in the part directory)
   */
  async deletePart(partPath: string): Promise<void> {
    const files = await this.list(partPath)
    await Promise.all(
      files.map(f => this.delete(`${partPath}/${f.name}`))
    )
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StorageStats> {
    let totalSize = 0
    let fileCount = 0

    const prefix = this.prefix ? this.prefix + '/' : ''
    let cursor: string | undefined

    do {
      const listOptions: R2ListOptions = { prefix }
      if (cursor !== undefined) {
        listOptions.cursor = cursor
      }
      const result = await this.bucket.list(listOptions)

      for (const obj of result.objects) {
        totalSize += obj.size
        fileCount++
      }

      cursor = result.truncated ? result.cursor : undefined
    } while (cursor)

    return {
      totalSize,
      fileCount,
      cacheSize: this.cache.size,
      cacheHitRate: this.cache.hitRate,
      writeBufferCount: this.writeBuffers.size,
      writeBufferSize: Array.from(this.writeBuffers.values())
        .reduce((sum, b) => sum + b.size, 0)
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private toKey(path: string): string {
    const cleanPath = path.replace(/^\/+/, '')
    return this.prefix ? `${this.prefix}/${cleanPath}` : cleanPath
  }

  private async flushBuffer(key: string): Promise<void> {
    const buffer = this.writeBuffers.get(key)
    if (!buffer) return

    await this.bucket.put(key, buffer.toArrayBuffer())
    this.writeBuffers.delete(key)
    this.cache.delete(key)
  }

  private async flushOldestBuffer(): Promise<void> {
    // Find the oldest (first added) buffer
    const [oldestKey] = this.writeBuffers.keys()
    if (oldestKey) {
      await this.flushBuffer(oldestKey)
    }
  }
}

// =============================================================================
// File Cache
// =============================================================================

interface CacheEntry {
  data: ArrayBuffer
  expires: number
  lastAccess: number
}

// Resolved cache config type
interface ResolvedCacheConfig {
  enabled: boolean
  maxSize: number
  maxFileSize: number
  ttl: number
}

class FileCache {
  private entries = new Map<string, CacheEntry>()
  private totalSize = 0
  private hits = 0
  private misses = 0
  private config: ResolvedCacheConfig

  constructor(config: ResolvedCacheConfig) {
    this.config = config
  }

  get(key: string): ArrayBuffer | null {
    if (!this.config.enabled) {
      this.misses++
      return null
    }

    const entry = this.entries.get(key)
    if (!entry) {
      this.misses++
      return null
    }

    if (Date.now() > entry.expires) {
      this.delete(key)
      this.misses++
      return null
    }

    entry.lastAccess = Date.now()
    this.hits++
    return entry.data
  }

  set(key: string, data: ArrayBuffer): void {
    if (!this.config.enabled) return

    // Don't cache if too large
    if (data.byteLength > this.config.maxFileSize) return

    // Evict if needed
    while (this.totalSize + data.byteLength > this.config.maxSize && this.entries.size > 0) {
      this.evictLRU()
    }

    // Remove existing entry if present
    this.delete(key)

    this.entries.set(key, {
      data,
      expires: Date.now() + this.config.ttl,
      lastAccess: Date.now()
    })
    this.totalSize += data.byteLength
  }

  delete(key: string): void {
    const entry = this.entries.get(key)
    if (entry) {
      this.totalSize -= entry.data.byteLength
      this.entries.delete(key)
    }
  }

  get size(): number {
    return this.totalSize
  }

  get hitRate(): number {
    const total = this.hits + this.misses
    return total > 0 ? this.hits / total : 0
  }

  private evictLRU(): void {
    let oldest: { key: string; lastAccess: number } | null = null

    for (const [key, entry] of this.entries) {
      if (!oldest || entry.lastAccess < oldest.lastAccess) {
        oldest = { key, lastAccess: entry.lastAccess }
      }
    }

    if (oldest) {
      this.delete(oldest.key)
    }
  }
}

// =============================================================================
// Write Buffer
// =============================================================================

class WriteBuffer {
  private chunks: Uint8Array[] = []
  private _size = 0

  constructor(initial?: ArrayBuffer) {
    if (initial) {
      this.chunks.push(new Uint8Array(initial))
      this._size = initial.byteLength
    }
  }

  get size(): number {
    return this._size
  }

  append(data: ArrayBuffer): void {
    this.chunks.push(new Uint8Array(data))
    this._size += data.byteLength
  }

  replace(data: ArrayBuffer): void {
    this.chunks = [new Uint8Array(data)]
    this._size = data.byteLength
  }

  read(offset: number, length: number): ArrayBuffer {
    const combined = this.toUint8Array()
    const sliced = combined.slice(offset, offset + length)
    // Always copy to a new ArrayBuffer to ensure correct type
    const result = new ArrayBuffer(sliced.byteLength)
    new Uint8Array(result).set(sliced)
    return result
  }

  toArrayBuffer(): ArrayBuffer {
    const arr = this.toUint8Array()
    // Always copy to a new ArrayBuffer to ensure correct type
    const result = new ArrayBuffer(arr.byteLength)
    new Uint8Array(result).set(arr)
    return result
  }

  private toUint8Array(): Uint8Array {
    if (this.chunks.length === 1) {
      const chunk = this.chunks[0]
      if (chunk === undefined) {
        return new Uint8Array(0)
      }
      return chunk
    }

    const combined = new Uint8Array(this._size)
    let offset = 0
    for (const chunk of this.chunks) {
      combined.set(chunk, offset)
      offset += chunk.byteLength
    }

    // Consolidate chunks
    this.chunks = [combined]

    return combined
  }
}

// =============================================================================
// Types
// =============================================================================

export interface StorageStats {
  totalSize: number
  fileCount: number
  cacheSize: number
  cacheHitRate: number
  writeBufferCount: number
  writeBufferSize: number
}
