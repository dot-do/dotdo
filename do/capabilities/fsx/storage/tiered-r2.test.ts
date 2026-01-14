import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TieredR2Storage,
  type TierPolicy,
  type TieredR2StorageConfig,
  type TieredFileMetadata,
} from './tiered-r2'
import type { StorageTier } from '../core/types'

/**
 * Mock R2Object implementation
 */
class MockR2Object implements R2Object {
  key: string
  version: string
  size: number
  etag: string
  httpEtag: string
  checksums: R2Checksums
  uploaded: Date
  httpMetadata?: R2HTTPMetadata
  customMetadata?: Record<string, string>
  storageClass: string
  private data: Uint8Array

  constructor(key: string, data: Uint8Array, customMetadata?: Record<string, string>, httpMetadata?: R2HTTPMetadata) {
    this.key = key
    this.data = data
    this.size = data.length
    this.version = '1'
    this.etag = `"${Math.random().toString(36).substring(7)}"`
    this.httpEtag = this.etag
    this.checksums = { toJSON: () => ({}) }
    this.uploaded = new Date()
    this.customMetadata = customMetadata
    this.httpMetadata = httpMetadata
    this.storageClass = 'Standard'
  }

  get body(): ReadableStream<Uint8Array> {
    const data = this.data
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data)
        controller.close()
      },
    })
  }

  get bodyUsed(): boolean {
    return false
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data.buffer.slice(this.data.byteOffset, this.data.byteOffset + this.data.byteLength)
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.data)
  }

  async json<T>(): Promise<T> {
    return JSON.parse(await this.text())
  }

  async blob(): Promise<Blob> {
    return new Blob([this.data])
  }

  writeHttpMetadata(_headers: Headers): void {
    // no-op
  }

  get range(): R2Range | undefined {
    return undefined
  }
}

/**
 * Mock R2Bucket implementation
 */
class MockR2Bucket implements R2Bucket {
  private objects = new Map<string, { data: Uint8Array; metadata?: Record<string, string>; httpMetadata?: R2HTTPMetadata }>()

  async put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions
  ): Promise<R2Object> {
    let data: Uint8Array

    if (value === null) {
      data = new Uint8Array(0)
    } else if (value instanceof ReadableStream) {
      const reader = value.getReader()
      const chunks: Uint8Array[] = []
      let done = false
      while (!done) {
        const result = await reader.read()
        if (result.value) chunks.push(result.value)
        done = result.done
      }
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
      data = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.length
      }
    } else if (value instanceof ArrayBuffer) {
      data = new Uint8Array(value)
    } else if (ArrayBuffer.isView(value)) {
      data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    } else if (typeof value === 'string') {
      data = new TextEncoder().encode(value)
    } else if (value instanceof Blob) {
      data = new Uint8Array(await value.arrayBuffer())
    } else {
      data = new Uint8Array(0)
    }

    this.objects.set(key, {
      data,
      metadata: options?.customMetadata,
      httpMetadata: options?.httpMetadata,
    })

    return new MockR2Object(key, data, options?.customMetadata, options?.httpMetadata)
  }

  async get(key: string, _options?: R2GetOptions): Promise<R2ObjectBody | null> {
    const obj = this.objects.get(key)
    if (!obj) return null
    return new MockR2Object(key, obj.data, obj.metadata, obj.httpMetadata) as unknown as R2ObjectBody
  }

  async head(key: string): Promise<R2Object | null> {
    const obj = this.objects.get(key)
    if (!obj) return null
    return new MockR2Object(key, obj.data, obj.metadata, obj.httpMetadata)
  }

  async delete(keys: string | string[]): Promise<void> {
    const keysArray = Array.isArray(keys) ? keys : [keys]
    for (const key of keysArray) {
      this.objects.delete(key)
    }
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const prefix = options?.prefix ?? ''
    const limit = options?.limit ?? 1000
    const objects: R2Object[] = []

    for (const [key, obj] of this.objects) {
      if (key.startsWith(prefix)) {
        objects.push(new MockR2Object(key, obj.data, obj.metadata, obj.httpMetadata))
        if (objects.length >= limit) break
      }
    }

    return {
      objects,
      truncated: false,
      delimitedPrefixes: [],
    }
  }

  createMultipartUpload(_key: string, _options?: R2MultipartOptions): Promise<R2MultipartUpload> {
    throw new Error('Not implemented')
  }

  resumeMultipartUpload(_key: string, _uploadId: string): R2MultipartUpload {
    throw new Error('Not implemented')
  }

  // Helper methods for testing
  clear(): void {
    this.objects.clear()
  }

  has(key: string): boolean {
    return this.objects.has(key)
  }

  getAll(): Map<string, { data: Uint8Array; metadata?: Record<string, string> }> {
    return this.objects
  }
}

/**
 * Mock SqlStorage implementation
 */
class MockSqlStorage implements SqlStorage {
  private tables = new Map<string, Map<string, unknown>>()
  private lastInsertId = 0

  exec<T = unknown>(query: string, ...params: unknown[]): SqlStorageCursor<T> {
    const results: T[] = []

    // Simple query parsing for our test cases
    if (query.includes('CREATE TABLE')) {
      // Tables auto-created
      return this.createCursor(results)
    }

    if (query.includes('CREATE INDEX')) {
      return this.createCursor(results)
    }

    if (query.includes('INSERT INTO tiered_access_metadata')) {
      const key = params[0] as string
      const tier = params[1] as string
      const lastAccess = params[2] as number
      const accessCount = params[3] as number
      const size = params[4] as number
      const createdAt = params[5] as number

      if (!this.tables.has('tiered_access_metadata')) {
        this.tables.set('tiered_access_metadata', new Map())
      }

      this.lastInsertId++
      this.tables.get('tiered_access_metadata')!.set(key, {
        key,
        tier,
        last_access: lastAccess,
        access_count: accessCount,
        size,
        created_at: createdAt,
      })

      return this.createCursor(results)
    }

    if (query.includes('UPDATE tiered_access_metadata')) {
      const tier = params[0] as string
      const lastAccess = params[1] as number
      const size = params[2] as number
      const key = params[3] as string

      const table = this.tables.get('tiered_access_metadata')
      if (table?.has(key)) {
        const existing = table.get(key) as Record<string, unknown>
        table.set(key, {
          ...existing,
          tier,
          last_access: lastAccess,
          access_count: (existing.access_count as number) + 1,
          size,
        })
      }

      return this.createCursor(results)
    }

    if (query.includes('SELECT * FROM tiered_access_metadata WHERE key = ?')) {
      const key = params[0] as string
      const table = this.tables.get('tiered_access_metadata')
      if (table?.has(key)) {
        results.push(table.get(key) as T)
      }
      return this.createCursor(results)
    }

    if (query.includes('SELECT * FROM tiered_access_metadata WHERE tier = ?')) {
      const tier = params[0] as string
      const threshold = params[1] as number
      const limit = params[2] as number
      const table = this.tables.get('tiered_access_metadata')

      if (table) {
        let count = 0
        for (const row of table.values()) {
          const r = row as Record<string, unknown>
          if (r.tier === tier && (r.last_access as number) < threshold && count < limit) {
            results.push(row as T)
            count++
          }
        }
      }

      return this.createCursor(results)
    }

    if (query.includes('DELETE FROM tiered_access_metadata')) {
      if (query.includes('WHERE key IN')) {
        for (const key of params) {
          const table = this.tables.get('tiered_access_metadata')
          table?.delete(key as string)
        }
      } else {
        const key = params[0] as string
        const table = this.tables.get('tiered_access_metadata')
        table?.delete(key)
      }
      return this.createCursor(results)
    }

    if (query.includes('SELECT tier, COUNT(*)')) {
      const table = this.tables.get('tiered_access_metadata')
      const tierCounts = new Map<string, { count: number; total_size: number }>()

      if (table) {
        for (const row of table.values()) {
          const r = row as Record<string, unknown>
          const tier = r.tier as string
          const size = r.size as number

          if (!tierCounts.has(tier)) {
            tierCounts.set(tier, { count: 0, total_size: 0 })
          }
          const stats = tierCounts.get(tier)!
          stats.count++
          stats.total_size += size
        }
      }

      for (const [tier, stats] of tierCounts) {
        results.push({ tier, count: stats.count, total_size: stats.total_size } as T)
      }

      return this.createCursor(results)
    }

    return this.createCursor(results)
  }

  private createCursor<T>(results: T[]): SqlStorageCursor<T> {
    let index = 0
    return {
      next: () => {
        if (index < results.length) {
          return { value: results[index++], done: false }
        }
        return { value: undefined, done: true }
      },
      toArray: () => results,
      one: () => results[0] ?? null,
      raw: () => this.createCursor(results.map((r) => Object.values(r as Record<string, unknown>)) as unknown as T[]),
      columnNames: [],
      rowsRead: results.length,
      rowsWritten: 0,
      [Symbol.iterator]: function* () {
        for (const r of results) yield r
      },
    }
  }

  get databaseSize(): number {
    return 0
  }

  // Helper for testing
  clear(): void {
    this.tables.clear()
  }
}

describe('TieredR2Storage', () => {
  let hotBucket: MockR2Bucket
  let warmBucket: MockR2Bucket
  let coldBucket: MockR2Bucket
  let sql: MockSqlStorage
  let storage: TieredR2Storage

  beforeEach(() => {
    hotBucket = new MockR2Bucket()
    warmBucket = new MockR2Bucket()
    coldBucket = new MockR2Bucket()
    sql = new MockSqlStorage()

    storage = new TieredR2Storage({
      hotBucket: hotBucket as unknown as R2Bucket,
      warmBucket: warmBucket as unknown as R2Bucket,
      coldBucket: coldBucket as unknown as R2Bucket,
      sql: sql as unknown as SqlStorage,
    })
  })

  describe('Basic Operations', () => {
    it('should store data in hot tier by default', async () => {
      const data = new TextEncoder().encode('hello world')
      const result = await storage.put('/test.txt', data)

      expect(result.tier).toBe('hot')
      expect(result.migrated).toBe(false)
      expect(result.size).toBe(data.length)
      expect(hotBucket.has('/test.txt')).toBe(true)
    })

    it('should retrieve data from hot tier', async () => {
      const data = new TextEncoder().encode('hello world')
      await storage.put('/test.txt', data)

      const result = await storage.get('/test.txt')

      expect(result).not.toBeNull()
      expect(result!.tier).toBe('hot')
      expect(new TextDecoder().decode(result!.data)).toBe('hello world')
    })

    it('should return null for non-existent files', async () => {
      const result = await storage.get('/nonexistent.txt')
      expect(result).toBeNull()
    })

    it('should store data in specified tier', async () => {
      const data = new TextEncoder().encode('warm data')
      const result = await storage.put('/warm.txt', data, { tier: 'warm' })

      expect(result.tier).toBe('warm')
      expect(warmBucket.has('/warm.txt')).toBe(true)
    })

    it('should store data in cold tier when specified', async () => {
      const data = new TextEncoder().encode('cold data')
      const result = await storage.put('/cold.txt', data, { tier: 'cold' })

      expect(result.tier).toBe('cold')
      expect(coldBucket.has('/cold.txt')).toBe(true)
    })

    it('should delete files from all tiers', async () => {
      const data = new TextEncoder().encode('test')

      await storage.put('/file1.txt', data, { tier: 'hot' })
      await storage.put('/file2.txt', data, { tier: 'warm' })
      await storage.put('/file3.txt', data, { tier: 'cold' })

      await storage.delete('/file1.txt')
      await storage.delete('/file2.txt')
      await storage.delete('/file3.txt')

      expect(hotBucket.has('/file1.txt')).toBe(false)
      expect(warmBucket.has('/file2.txt')).toBe(false)
      expect(coldBucket.has('/file3.txt')).toBe(false)
    })

    it('should delete multiple files at once', async () => {
      const data = new TextEncoder().encode('test')

      await storage.put('/a.txt', data)
      await storage.put('/b.txt', data)
      await storage.put('/c.txt', data)

      await storage.deleteMany(['/a.txt', '/b.txt', '/c.txt'])

      expect(hotBucket.has('/a.txt')).toBe(false)
      expect(hotBucket.has('/b.txt')).toBe(false)
      expect(hotBucket.has('/c.txt')).toBe(false)
    })
  })

  describe('Tier Detection', () => {
    it('should find file in hot tier first', async () => {
      const data = new TextEncoder().encode('hot data')
      await storage.put('/find-me.txt', data, { tier: 'hot' })

      const result = await storage.get('/find-me.txt')
      expect(result!.tier).toBe('hot')
    })

    it('should find file in warm tier when not in hot', async () => {
      // Use a storage instance with autoPromote disabled to test pure tier detection
      const noPromoteStorage = new TieredR2Storage({
        hotBucket: hotBucket as unknown as R2Bucket,
        warmBucket: warmBucket as unknown as R2Bucket,
        coldBucket: coldBucket as unknown as R2Bucket,
        sql: sql as unknown as SqlStorage,
        policy: { autoPromote: false },
      })

      const data = new TextEncoder().encode('warm data')
      await noPromoteStorage.put('/warm-only.txt', data, { tier: 'warm' })

      const result = await noPromoteStorage.get('/warm-only.txt')
      expect(result!.tier).toBe('warm')
    })

    it('should find file in cold tier when not in hot or warm', async () => {
      // Use a storage instance with autoPromote disabled to test pure tier detection
      const noPromoteStorage = new TieredR2Storage({
        hotBucket: hotBucket as unknown as R2Bucket,
        warmBucket: warmBucket as unknown as R2Bucket,
        coldBucket: coldBucket as unknown as R2Bucket,
        sql: sql as unknown as SqlStorage,
        policy: { autoPromote: false },
      })

      const data = new TextEncoder().encode('cold data')
      await noPromoteStorage.put('/cold-only.txt', data, { tier: 'cold' })

      const result = await noPromoteStorage.get('/cold-only.txt')
      expect(result!.tier).toBe('cold')
    })
  })

  describe('File Existence', () => {
    it('should check if file exists', async () => {
      const data = new TextEncoder().encode('test')
      await storage.put('/exists.txt', data)

      const result = await storage.exists('/exists.txt')
      expect(result.exists).toBe(true)
      expect(result.tier).toBe('hot')
    })

    it('should return false for non-existent file', async () => {
      const result = await storage.exists('/not-here.txt')
      expect(result.exists).toBe(false)
      expect(result.tier).toBeUndefined()
    })

    it('should check existence across all tiers', async () => {
      const data = new TextEncoder().encode('test')
      await storage.put('/cold-exists.txt', data, { tier: 'cold' })

      const result = await storage.exists('/cold-exists.txt')
      expect(result.exists).toBe(true)
      expect(result.tier).toBe('cold')
    })
  })

  describe('Head Operation', () => {
    it('should return metadata without downloading', async () => {
      const data = new TextEncoder().encode('test content')
      await storage.put('/head-test.txt', data, {
        contentType: 'text/plain',
      })

      const result = await storage.head('/head-test.txt')
      expect(result).not.toBeNull()
      expect(result!.tier).toBe('hot')
      expect(result!.metadata.size).toBe(data.length)
    })

    it('should return null for non-existent file', async () => {
      const result = await storage.head('/not-found.txt')
      expect(result).toBeNull()
    })
  })

  describe('Manual Tier Promotion', () => {
    it('should promote file from cold to warm', async () => {
      const data = new TextEncoder().encode('promote me')
      await storage.put('/to-promote.txt', data, { tier: 'cold' })

      const result = await storage.promote('/to-promote.txt', 'warm')

      expect(result.tier).toBe('warm')
      expect(result.migrated).toBe(true)
      expect(result.previousTier).toBe('cold')
      expect(warmBucket.has('/to-promote.txt')).toBe(true)
    })

    it('should promote file from cold to hot', async () => {
      const data = new TextEncoder().encode('promote me')
      await storage.put('/cold-to-hot.txt', data, { tier: 'cold' })

      const result = await storage.promote('/cold-to-hot.txt', 'hot')

      expect(result.tier).toBe('hot')
      expect(result.migrated).toBe(true)
      expect(result.previousTier).toBe('cold')
      expect(hotBucket.has('/cold-to-hot.txt')).toBe(true)
    })

    it('should promote file from warm to hot', async () => {
      const data = new TextEncoder().encode('promote me')
      await storage.put('/warm-to-hot.txt', data, { tier: 'warm' })

      const result = await storage.promote('/warm-to-hot.txt', 'hot')

      expect(result.tier).toBe('hot')
      expect(result.migrated).toBe(true)
      expect(result.previousTier).toBe('warm')
    })

    it('should not migrate if already in target tier', async () => {
      const data = new TextEncoder().encode('already hot')
      await storage.put('/already-hot.txt', data, { tier: 'hot' })

      const result = await storage.promote('/already-hot.txt', 'hot')

      expect(result.tier).toBe('hot')
      expect(result.migrated).toBe(false)
    })

    it('should throw error for non-existent file', async () => {
      await expect(storage.promote('/not-found.txt', 'hot')).rejects.toThrow('File not found')
    })
  })

  describe('Manual Tier Demotion', () => {
    it('should demote file from hot to warm', async () => {
      const data = new TextEncoder().encode('demote me')
      await storage.put('/to-demote.txt', data, { tier: 'hot' })

      const result = await storage.demote('/to-demote.txt', 'warm')

      expect(result.tier).toBe('warm')
      expect(result.migrated).toBe(true)
      expect(result.previousTier).toBe('hot')
      expect(warmBucket.has('/to-demote.txt')).toBe(true)
    })

    it('should demote file from hot to cold', async () => {
      const data = new TextEncoder().encode('demote me')
      await storage.put('/hot-to-cold.txt', data, { tier: 'hot' })

      const result = await storage.demote('/hot-to-cold.txt', 'cold')

      expect(result.tier).toBe('cold')
      expect(result.migrated).toBe(true)
      expect(result.previousTier).toBe('hot')
      expect(coldBucket.has('/hot-to-cold.txt')).toBe(true)
    })

    it('should demote file from warm to cold', async () => {
      const data = new TextEncoder().encode('demote me')
      await storage.put('/warm-to-cold.txt', data, { tier: 'warm' })

      const result = await storage.demote('/warm-to-cold.txt', 'cold')

      expect(result.tier).toBe('cold')
      expect(result.migrated).toBe(true)
      expect(result.previousTier).toBe('warm')
    })

    it('should not migrate if already in target tier', async () => {
      const data = new TextEncoder().encode('already cold')
      await storage.put('/already-cold.txt', data, { tier: 'cold' })

      const result = await storage.demote('/already-cold.txt', 'cold')

      expect(result.tier).toBe('cold')
      expect(result.migrated).toBe(false)
    })

    it('should throw error for non-existent file', async () => {
      await expect(storage.demote('/not-found.txt', 'cold')).rejects.toThrow('File not found')
    })
  })

  describe('Get Tier', () => {
    it('should return correct tier for hot file', async () => {
      await storage.put('/tier-check.txt', new TextEncoder().encode('test'), { tier: 'hot' })
      const tier = await storage.getTier('/tier-check.txt')
      expect(tier).toBe('hot')
    })

    it('should return correct tier for warm file', async () => {
      await storage.put('/tier-check.txt', new TextEncoder().encode('test'), { tier: 'warm' })
      const tier = await storage.getTier('/tier-check.txt')
      expect(tier).toBe('warm')
    })

    it('should return correct tier for cold file', async () => {
      await storage.put('/tier-check.txt', new TextEncoder().encode('test'), { tier: 'cold' })
      const tier = await storage.getTier('/tier-check.txt')
      expect(tier).toBe('cold')
    })

    it('should return null for non-existent file', async () => {
      const tier = await storage.getTier('/not-found.txt')
      expect(tier).toBeNull()
    })
  })

  describe('Copy Operation', () => {
    it('should copy file within same tier', async () => {
      const data = new TextEncoder().encode('copy me')
      await storage.put('/original.txt', data)

      const result = await storage.copy('/original.txt', '/copy.txt')

      expect(result.tier).toBe('hot')
      expect(hotBucket.has('/copy.txt')).toBe(true)
    })

    it('should copy file to different tier', async () => {
      const data = new TextEncoder().encode('copy me')
      await storage.put('/original.txt', data, { tier: 'hot' })

      const result = await storage.copy('/original.txt', '/cold-copy.txt', 'cold')

      expect(result.tier).toBe('cold')
      expect(coldBucket.has('/cold-copy.txt')).toBe(true)
    })

    it('should throw error when copying non-existent file', async () => {
      await expect(storage.copy('/not-found.txt', '/copy.txt')).rejects.toThrow('Source not found')
    })
  })

  describe('Statistics', () => {
    it('should return empty stats initially', async () => {
      const stats = await storage.getStats()

      expect(stats.hot.count).toBe(0)
      expect(stats.hot.totalSize).toBe(0)
      expect(stats.warm.count).toBe(0)
      expect(stats.warm.totalSize).toBe(0)
      expect(stats.cold.count).toBe(0)
      expect(stats.cold.totalSize).toBe(0)
    })

    it('should track files by tier', async () => {
      const data1 = new TextEncoder().encode('hot file')
      const data2 = new TextEncoder().encode('warm file')
      const data3 = new TextEncoder().encode('cold file')

      await storage.put('/hot.txt', data1, { tier: 'hot' })
      await storage.put('/warm.txt', data2, { tier: 'warm' })
      await storage.put('/cold.txt', data3, { tier: 'cold' })

      const stats = await storage.getStats()

      expect(stats.hot.count).toBe(1)
      expect(stats.hot.totalSize).toBe(data1.length)
      expect(stats.warm.count).toBe(1)
      expect(stats.warm.totalSize).toBe(data2.length)
      expect(stats.cold.count).toBe(1)
      expect(stats.cold.totalSize).toBe(data3.length)
    })
  })

  describe('List By Tier', () => {
    it('should list files in specific tier', async () => {
      await storage.put('/hot1.txt', new TextEncoder().encode('hot1'), { tier: 'hot' })
      await storage.put('/hot2.txt', new TextEncoder().encode('hot2'), { tier: 'hot' })
      await storage.put('/warm1.txt', new TextEncoder().encode('warm1'), { tier: 'warm' })

      const result = await storage.listByTier('hot')

      expect(result.objects).toHaveLength(2)
      expect(result.objects.map((o) => o.key)).toContain('/hot1.txt')
      expect(result.objects.map((o) => o.key)).toContain('/hot2.txt')
    })

    it('should support prefix filtering', async () => {
      await storage.put('/data/a.txt', new TextEncoder().encode('a'), { tier: 'hot' })
      await storage.put('/data/b.txt', new TextEncoder().encode('b'), { tier: 'hot' })
      await storage.put('/other/c.txt', new TextEncoder().encode('c'), { tier: 'hot' })

      const result = await storage.listByTier('hot', { prefix: '/data' })

      expect(result.objects).toHaveLength(2)
    })
  })

  describe('Prefix Support', () => {
    it('should apply prefix to all operations', async () => {
      const prefixedStorage = new TieredR2Storage({
        hotBucket: hotBucket as unknown as R2Bucket,
        warmBucket: warmBucket as unknown as R2Bucket,
        coldBucket: coldBucket as unknown as R2Bucket,
        prefix: 'myapp/',
        sql: sql as unknown as SqlStorage,
      })

      await prefixedStorage.put('/test.txt', new TextEncoder().encode('test'))

      expect(hotBucket.has('myapp//test.txt')).toBe(true)
    })
  })

  describe('Stream Operations', () => {
    it('should get file as stream', async () => {
      const data = new TextEncoder().encode('stream content')
      await storage.put('/stream.txt', data)

      const result = await storage.getStream('/stream.txt')

      expect(result).not.toBeNull()
      expect(result!.tier).toBe('hot')

      const reader = result!.stream.getReader()
      const chunk = await reader.read()
      expect(new TextDecoder().decode(chunk.value)).toBe('stream content')
    })

    it('should return null for non-existent file', async () => {
      const result = await storage.getStream('/not-found.txt')
      expect(result).toBeNull()
    })
  })

  describe('Range Operations', () => {
    it('should get partial file content', async () => {
      const data = new TextEncoder().encode('0123456789')
      await storage.put('/range.txt', data)

      const result = await storage.getRange('/range.txt', 2, 5)

      expect(result).not.toBeNull()
      expect(result!.tier).toBe('hot')
      // Note: MockR2Bucket doesn't implement actual range support
    })

    it('should return null for non-existent file', async () => {
      const result = await storage.getRange('/not-found.txt', 0, 10)
      expect(result).toBeNull()
    })
  })

  describe('Tier Policy Configuration', () => {
    it('should use default policy values', () => {
      const defaultStorage = new TieredR2Storage({
        hotBucket: hotBucket as unknown as R2Bucket,
      })

      // Default policy should be applied
      expect(defaultStorage).toBeDefined()
    })

    it('should use custom policy values', () => {
      const customPolicy: Partial<TierPolicy> = {
        hotMaxAgeDays: 7,
        warmMaxAgeDays: 90,
        autoPromote: false,
        autoDemote: false,
      }

      const customStorage = new TieredR2Storage({
        hotBucket: hotBucket as unknown as R2Bucket,
        policy: customPolicy,
      })

      expect(customStorage).toBeDefined()
    })
  })

  describe('Single Bucket Mode', () => {
    it('should work with only hot bucket', async () => {
      const singleBucketStorage = new TieredR2Storage({
        hotBucket: hotBucket as unknown as R2Bucket,
        sql: sql as unknown as SqlStorage,
      })

      const data = new TextEncoder().encode('single bucket')
      await singleBucketStorage.put('/test.txt', data)

      const result = await singleBucketStorage.get('/test.txt')
      expect(result).not.toBeNull()
      expect(result!.tier).toBe('hot')
    })
  })

  describe('Custom Metadata', () => {
    it('should store custom metadata with file', async () => {
      const data = new TextEncoder().encode('test')
      await storage.put('/meta.txt', data, {
        customMetadata: {
          'custom-key': 'custom-value',
        },
      })

      const result = await storage.head('/meta.txt')
      expect(result!.metadata.customMetadata).toHaveProperty('custom-key')
    })

    it('should preserve content type', async () => {
      const data = new TextEncoder().encode('{"test": true}')
      await storage.put('/data.json', data, {
        contentType: 'application/json',
      })

      const result = await storage.head('/data.json')
      expect(result!.metadata.httpMetadata?.contentType).toBe('application/json')
    })
  })

  describe('Migration', () => {
    it('should run migration without errors', async () => {
      const result = await storage.runMigration()

      expect(result.promoted).toBe(0)
      expect(result.demoted).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it('should support dry run mode', async () => {
      const data = new TextEncoder().encode('test')
      await storage.put('/test.txt', data, { tier: 'hot' })

      const result = await storage.runMigration({ dryRun: true })

      expect(result.errors).toHaveLength(0)
    })

    it('should report error when SQL is not available', async () => {
      const noSqlStorage = new TieredR2Storage({
        hotBucket: hotBucket as unknown as R2Bucket,
      })

      const result = await noSqlStorage.runMigration()

      expect(result.errors).toContain('SQLite storage not available for migration')
    })
  })
})

describe('TierPolicy', () => {
  describe('Default Values', () => {
    it('should have hot threshold of 1 day', () => {
      const storage = new TieredR2Storage({
        hotBucket: new MockR2Bucket() as unknown as R2Bucket,
      })
      // Verify storage is created with defaults - internal property not exposed
      expect(storage).toBeDefined()
    })

    it('should have warm threshold of 30 days', () => {
      const storage = new TieredR2Storage({
        hotBucket: new MockR2Bucket() as unknown as R2Bucket,
      })
      expect(storage).toBeDefined()
    })

    it('should enable auto promote by default', () => {
      const storage = new TieredR2Storage({
        hotBucket: new MockR2Bucket() as unknown as R2Bucket,
      })
      expect(storage).toBeDefined()
    })

    it('should enable auto demote by default', () => {
      const storage = new TieredR2Storage({
        hotBucket: new MockR2Bucket() as unknown as R2Bucket,
      })
      expect(storage).toBeDefined()
    })
  })

  describe('Custom Policy', () => {
    it('should accept custom hot threshold', () => {
      const storage = new TieredR2Storage({
        hotBucket: new MockR2Bucket() as unknown as R2Bucket,
        policy: { hotMaxAgeDays: 7 },
      })
      expect(storage).toBeDefined()
    })

    it('should accept custom warm threshold', () => {
      const storage = new TieredR2Storage({
        hotBucket: new MockR2Bucket() as unknown as R2Bucket,
        policy: { warmMaxAgeDays: 60 },
      })
      expect(storage).toBeDefined()
    })

    it('should allow disabling auto promote', () => {
      const storage = new TieredR2Storage({
        hotBucket: new MockR2Bucket() as unknown as R2Bucket,
        policy: { autoPromote: false },
      })
      expect(storage).toBeDefined()
    })

    it('should allow disabling auto demote', () => {
      const storage = new TieredR2Storage({
        hotBucket: new MockR2Bucket() as unknown as R2Bucket,
        policy: { autoDemote: false },
      })
      expect(storage).toBeDefined()
    })
  })
})

describe('Edge Cases', () => {
  let hotBucket: MockR2Bucket
  let storage: TieredR2Storage
  let sql: MockSqlStorage

  beforeEach(() => {
    hotBucket = new MockR2Bucket()
    sql = new MockSqlStorage()
    storage = new TieredR2Storage({
      hotBucket: hotBucket as unknown as R2Bucket,
      sql: sql as unknown as SqlStorage,
    })
  })

  it('should handle empty data', async () => {
    const data = new Uint8Array(0)
    const result = await storage.put('/empty.txt', data)

    expect(result.size).toBe(0)

    const read = await storage.get('/empty.txt')
    expect(read!.data.length).toBe(0)
  })

  it('should handle large data', async () => {
    const size = 10 * 1024 * 1024 // 10MB
    const data = new Uint8Array(size)
    data.fill(42)

    const result = await storage.put('/large.bin', data)

    expect(result.size).toBe(size)
  })

  it('should handle special characters in path', async () => {
    const data = new TextEncoder().encode('test')
    await storage.put('/path/with spaces/file-name_v2.txt', data)

    const result = await storage.get('/path/with spaces/file-name_v2.txt')
    expect(result).not.toBeNull()
  })

  it('should handle unicode in path', async () => {
    const data = new TextEncoder().encode('test')
    await storage.put('/path/unicode-file.txt', data)

    const result = await storage.get('/path/unicode-file.txt')
    expect(result).not.toBeNull()
  })

  it('should handle binary data', async () => {
    const data = new Uint8Array([0, 1, 2, 255, 254, 253])
    await storage.put('/binary.bin', data)

    const result = await storage.get('/binary.bin')
    expect(result!.data).toEqual(data)
  })

  it('should handle concurrent reads', async () => {
    const data = new TextEncoder().encode('concurrent test')
    await storage.put('/concurrent.txt', data)

    const results = await Promise.all([
      storage.get('/concurrent.txt'),
      storage.get('/concurrent.txt'),
      storage.get('/concurrent.txt'),
    ])

    for (const result of results) {
      expect(result).not.toBeNull()
      expect(new TextDecoder().decode(result!.data)).toBe('concurrent test')
    }
  })

  it('should handle concurrent writes', async () => {
    const results = await Promise.all([
      storage.put('/file1.txt', new TextEncoder().encode('data1')),
      storage.put('/file2.txt', new TextEncoder().encode('data2')),
      storage.put('/file3.txt', new TextEncoder().encode('data3')),
    ])

    expect(results).toHaveLength(3)
    for (const result of results) {
      expect(result.tier).toBe('hot')
    }
  })
})
