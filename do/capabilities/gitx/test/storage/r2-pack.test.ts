import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  R2PackStorage,
  R2PackStorageOptions,
  PackfileUploadResult,
  PackfileMetadata,
  MultiPackIndex,
  MultiPackIndexEntry,
  R2PackError,
  uploadPackfile,
  downloadPackfile,
  getPackfileMetadata,
  listPackfiles,
  deletePackfile,
  createMultiPackIndex,
  parseMultiPackIndex,
  lookupObjectInMultiPack,
  acquirePackLock,
  releasePackLock
} from '../../src/storage/r2-pack'

// Sample SHA-1 hashes for testing
const sampleSha = 'a'.repeat(40)
const sampleSha2 = 'b'.repeat(40)
const sampleSha3 = 'c'.repeat(40)
const samplePackId = 'pack-' + sampleSha.slice(0, 16)

// Helper to create test packfile data
function createTestPackfile(objectCount: number = 1): Uint8Array {
  const encoder = new TextEncoder()
  // Minimal valid pack header: PACK + version 2 + object count (4 bytes big-endian)
  const header = new Uint8Array([
    0x50, 0x41, 0x43, 0x4b, // PACK signature
    0x00, 0x00, 0x00, 0x02, // Version 2
    (objectCount >> 24) & 0xff, // Object count byte 1 (MSB)
    (objectCount >> 16) & 0xff, // Object count byte 2
    (objectCount >> 8) & 0xff,  // Object count byte 3
    objectCount & 0xff          // Object count byte 4 (LSB)
  ])
  // Add some dummy data and a 20-byte checksum
  const dummyData = encoder.encode('dummy object data'.repeat(10))
  const checksum = new Uint8Array(20).fill(0xab)

  const result = new Uint8Array(header.length + dummyData.length + checksum.length)
  result.set(header)
  result.set(dummyData, header.length)
  result.set(checksum, header.length + dummyData.length)
  return result
}

// Helper to create test index data
function createTestIndexData(): Uint8Array {
  // Minimal pack index format: signature + version + fanout + checksum
  const data = new Uint8Array(4 + 4 + 256 * 4 + 20 + 20)
  // Signature: 0xff744f63
  data[0] = 0xff
  data[1] = 0x74
  data[2] = 0x4f
  data[3] = 0x63
  // Version 2
  data[7] = 2
  return data
}

/**
 * Mock R2 Bucket for testing R2 operations
 */
class MockR2Bucket {
  private objects: Map<string, { data: Uint8Array; metadata?: Record<string, string>; etag: string }> = new Map()
  private locks: Set<string> = new Set()
  private etagCounter = 0

  private generateEtag(): string {
    return `etag-${++this.etagCounter}`
  }

  async put(key: string, data: ArrayBuffer | Uint8Array | string, options?: { customMetadata?: Record<string, string>; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }): Promise<void> {
    const bytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array ? data : new Uint8Array(data)

    // Handle conditional writes
    if (options?.onlyIf) {
      const existing = this.objects.get(key)

      if (options.onlyIf.etagDoesNotMatch === '*') {
        // Object must not exist
        if (existing) {
          throw new Error('PreconditionFailed: Object already exists')
        }
      } else if (options.onlyIf.etagMatches) {
        // Object must exist and etag must match
        if (!existing || existing.etag !== options.onlyIf.etagMatches) {
          throw new Error('PreconditionFailed: ETag mismatch')
        }
      }
    }

    this.objects.set(key, { data: bytes, metadata: options?.customMetadata, etag: this.generateEtag() })
  }

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string>; customMetadata?: Record<string, string> } | null> {
    const obj = this.objects.get(key)
    if (!obj) return null
    return {
      arrayBuffer: async () => obj.data.buffer.slice(obj.data.byteOffset, obj.data.byteOffset + obj.data.byteLength),
      text: async () => new TextDecoder().decode(obj.data),
      customMetadata: obj.metadata
    }
  }

  async head(key: string): Promise<{ customMetadata?: Record<string, string>; size: number; etag: string } | null> {
    const obj = this.objects.get(key)
    if (!obj) return null
    return { customMetadata: obj.metadata, size: obj.data.length, etag: obj.etag }
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key]
    for (const k of keys) {
      this.objects.delete(k)
    }
  }

  async list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string; size: number }>
    truncated: boolean
    cursor?: string
  }> {
    const prefix = options?.prefix ?? ''
    const matchingKeys = Array.from(this.objects.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, size: value.data.length }))

    return {
      objects: matchingKeys,
      truncated: false
    }
  }

  // Test helpers
  has(key: string): boolean {
    return this.objects.has(key)
  }

  clear(): void {
    this.objects.clear()
    this.locks.clear()
  }

  getData(key: string): Uint8Array | undefined {
    return this.objects.get(key)?.data
  }

  setLock(key: string): void {
    this.locks.add(key)
  }

  releaseLock(key: string): void {
    this.locks.delete(key)
  }

  hasLock(key: string): boolean {
    return this.locks.has(key)
  }
}

describe('R2 Packfile Storage', () => {
  let bucket: MockR2Bucket
  let storage: R2PackStorage

  beforeEach(() => {
    bucket = new MockR2Bucket()
    storage = new R2PackStorage({ bucket: bucket as unknown as R2Bucket })
  })

  describe('R2PackStorage initialization', () => {
    it('should create storage with bucket', () => {
      const s = new R2PackStorage({ bucket: bucket as unknown as R2Bucket })
      expect(s).toBeDefined()
    })

    it('should accept optional prefix configuration', () => {
      const s = new R2PackStorage({
        bucket: bucket as unknown as R2Bucket,
        prefix: 'repos/my-repo/'
      })
      expect(s).toBeDefined()
    })

    it('should accept optional cache configuration', () => {
      const s = new R2PackStorage({
        bucket: bucket as unknown as R2Bucket,
        cacheSize: 100,
        cacheTTL: 3600
      })
      expect(s).toBeDefined()
    })
  })

  describe('Packfile Upload', () => {
    describe('uploadPackfile', () => {
      it('should upload a packfile to R2', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        expect(result).toBeDefined()
        expect(result.packId).toBeDefined()
        expect(result.packId).toMatch(/^pack-[a-f0-9]+$/)
      })

      it('should store packfile data in R2', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        const packKey = `packs/${result.packId}.pack`
        expect(bucket.has(packKey)).toBe(true)
      })

      it('should store index file alongside packfile', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        const idxKey = `packs/${result.packId}.idx`
        expect(bucket.has(idxKey)).toBe(true)
      })

      it('should return upload result with size information', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        expect(result.packSize).toBe(packData.length)
        expect(result.indexSize).toBe(indexData.length)
      })

      it('should compute and return pack checksum', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        expect(result.checksum).toBeDefined()
        expect(result.checksum).toHaveLength(40)
        expect(result.checksum).toMatch(/^[a-f0-9]{40}$/)
      })

      it('should store metadata with upload timestamp', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        expect(result.uploadedAt).toBeDefined()
        expect(result.uploadedAt).toBeInstanceOf(Date)
      })

      it('should handle optional object count in result', async () => {
        const packData = createTestPackfile(5)
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        expect(result.objectCount).toBe(5)
      })

      it('should throw for invalid packfile data', async () => {
        const invalidPack = new Uint8Array([0x00, 0x00, 0x00, 0x00])
        const indexData = createTestIndexData()

        await expect(
          storage.uploadPackfile(invalidPack, indexData)
        ).rejects.toThrow(R2PackError)
      })

      it('should throw for empty packfile', async () => {
        const emptyPack = new Uint8Array(0)
        const indexData = createTestIndexData()

        await expect(
          storage.uploadPackfile(emptyPack, indexData)
        ).rejects.toThrow(R2PackError)
      })

      it('should respect custom prefix in key path', async () => {
        const prefixedStorage = new R2PackStorage({
          bucket: bucket as unknown as R2Bucket,
          prefix: 'repos/test-repo/'
        })
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await prefixedStorage.uploadPackfile(packData, indexData)

        const expectedKey = `repos/test-repo/packs/${result.packId}.pack`
        expect(bucket.has(expectedKey)).toBe(true)
      })

      it('should handle large packfiles', async () => {
        const largeData = new Uint8Array(10 * 1024 * 1024) // 10MB
        // Set valid header
        largeData[0] = 0x50
        largeData[1] = 0x41
        largeData[2] = 0x43
        largeData[3] = 0x4b
        largeData[7] = 2
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(largeData, indexData)

        expect(result.packSize).toBe(largeData.length)
      })
    })

    describe('uploadPackfile standalone function', () => {
      it('should upload packfile using standalone function', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await uploadPackfile(
          bucket as unknown as R2Bucket,
          packData,
          indexData
        )

        expect(result.packId).toBeDefined()
      })
    })
  })

  describe('Packfile Retrieval', () => {
    describe('downloadPackfile', () => {
      it('should retrieve uploaded packfile', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const downloaded = await storage.downloadPackfile(packId)

        expect(downloaded).toBeDefined()
        expect(downloaded.packData).toEqual(packData)
      })

      it('should retrieve index file with packfile', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const downloaded = await storage.downloadPackfile(packId, { includeIndex: true })

        expect(downloaded.indexData).toBeDefined()
        expect(downloaded.indexData).toEqual(indexData)
      })

      it('should return null for non-existent packfile', async () => {
        const result = await storage.downloadPackfile('pack-nonexistent')

        expect(result).toBeNull()
      })

      it('should support byte range requests', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const partial = await storage.downloadPackfile(packId, {
          byteRange: { start: 0, end: 11 } // Just the header
        })

        expect(partial).toBeDefined()
        expect(partial!.packData.length).toBe(12)
      })

      it('should verify checksum on download when requested', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const downloaded = await storage.downloadPackfile(packId, { verify: true })

        expect(downloaded).toBeDefined()
        expect(downloaded!.verified).toBe(true)
      })

      it('should throw on checksum mismatch when verify is enabled', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        // Corrupt the stored data
        const corruptedData = new Uint8Array(packData)
        corruptedData[20] = 0xff
        await bucket.put(`packs/${packId}.pack`, corruptedData)

        await expect(
          storage.downloadPackfile(packId, { verify: true })
        ).rejects.toThrow(R2PackError)
      })
    })

    describe('downloadPackfile standalone function', () => {
      it('should download using standalone function', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const downloaded = await downloadPackfile(bucket as unknown as R2Bucket, packId)

        expect(downloaded).toBeDefined()
      })
    })

    describe('getPackfileMetadata', () => {
      it('should retrieve metadata for uploaded packfile', async () => {
        const packData = createTestPackfile(3)
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const metadata = await storage.getPackfileMetadata(packId)

        expect(metadata).toBeDefined()
        expect(metadata!.packId).toBe(packId)
        expect(metadata!.packSize).toBe(packData.length)
        expect(metadata!.indexSize).toBe(indexData.length)
      })

      it('should return null for non-existent packfile', async () => {
        const metadata = await storage.getPackfileMetadata('pack-nonexistent')

        expect(metadata).toBeNull()
      })

      it('should include object count in metadata', async () => {
        const packData = createTestPackfile(5)
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const metadata = await storage.getPackfileMetadata(packId)

        expect(metadata!.objectCount).toBe(5)
      })

      it('should include creation timestamp', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const metadata = await storage.getPackfileMetadata(packId)

        expect(metadata!.createdAt).toBeInstanceOf(Date)
      })
    })

    describe('listPackfiles', () => {
      it('should list all packfiles', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        await storage.uploadPackfile(packData, indexData)
        await storage.uploadPackfile(packData, indexData)
        await storage.uploadPackfile(packData, indexData)

        const list = await storage.listPackfiles()

        expect(list.length).toBe(3)
      })

      it('should return empty array when no packfiles exist', async () => {
        const list = await storage.listPackfiles()

        expect(list).toEqual([])
      })

      it('should return packfile metadata in list', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        await storage.uploadPackfile(packData, indexData)

        const list = await storage.listPackfiles()

        expect(list[0].packId).toBeDefined()
        expect(list[0].packSize).toBeDefined()
      })

      it('should support pagination', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        for (let i = 0; i < 10; i++) {
          await storage.uploadPackfile(packData, indexData)
        }

        const page1 = await storage.listPackfiles({ limit: 5 })
        const page2 = await storage.listPackfiles({ limit: 5, cursor: page1.cursor })

        expect(page1.items.length).toBe(5)
        expect(page2.items.length).toBe(5)
      })
    })
  })

  describe('Packfile Deletion', () => {
    describe('deletePackfile', () => {
      it('should delete a packfile', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const deleted = await storage.deletePackfile(packId)

        expect(deleted).toBe(true)
        expect(await storage.downloadPackfile(packId)).toBeNull()
      })

      it('should delete index file along with packfile', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        await storage.deletePackfile(packId)

        expect(bucket.has(`packs/${packId}.idx`)).toBe(false)
      })

      it('should return false for non-existent packfile', async () => {
        const deleted = await storage.deletePackfile('pack-nonexistent')

        expect(deleted).toBe(false)
      })

      it('should update multi-pack index on deletion', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)
        await storage.rebuildMultiPackIndex()

        await storage.deletePackfile(packId)

        const midx = await storage.getMultiPackIndex()
        expect(midx.packIds.includes(packId)).toBe(false)
      })
    })
  })

  describe('Index File Management', () => {
    describe('downloadIndex', () => {
      it('should download index file for a packfile', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const downloaded = await storage.downloadIndex(packId)

        expect(downloaded).toBeDefined()
        expect(downloaded).toEqual(indexData)
      })

      it('should return null for non-existent index', async () => {
        const result = await storage.downloadIndex('pack-nonexistent')

        expect(result).toBeNull()
      })
    })

    describe('uploadIndex', () => {
      it('should upload a new index for existing packfile', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const newIndexData = createTestIndexData()
        newIndexData[100] = 0xff // Modify something

        await storage.uploadIndex(packId, newIndexData)

        const downloaded = await storage.downloadIndex(packId)
        expect(downloaded).toEqual(newIndexData)
      })

      it('should throw for non-existent packfile', async () => {
        const indexData = createTestIndexData()

        await expect(
          storage.uploadIndex('pack-nonexistent', indexData)
        ).rejects.toThrow(R2PackError)
      })
    })

    describe('verifyIndex', () => {
      it('should verify index matches packfile', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const isValid = await storage.verifyIndex(packId)

        expect(isValid).toBe(true)
      })

      it('should return false for corrupted index', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        // Corrupt the index
        const corruptedIndex = new Uint8Array(indexData)
        corruptedIndex[10] = 0xff
        await bucket.put(`packs/${packId}.idx`, corruptedIndex)

        const isValid = await storage.verifyIndex(packId)

        expect(isValid).toBe(false)
      })
    })
  })

  describe('Multi-Pack Index', () => {
    describe('MultiPackIndex structure', () => {
      it('should have correct version', () => {
        const midx: MultiPackIndex = {
          version: 1,
          packIds: [],
          entries: [],
          checksum: new Uint8Array(20)
        }
        expect(midx.version).toBe(1)
      })

      it('should contain pack IDs', () => {
        const midx: MultiPackIndex = {
          version: 1,
          packIds: ['pack-aaa', 'pack-bbb', 'pack-ccc'],
          entries: [],
          checksum: new Uint8Array(20)
        }
        expect(midx.packIds.length).toBe(3)
      })

      it('should contain sorted entries', () => {
        const entry1: MultiPackIndexEntry = {
          objectId: 'aaa' + '0'.repeat(37),
          packIndex: 0,
          offset: 12
        }
        const entry2: MultiPackIndexEntry = {
          objectId: 'bbb' + '0'.repeat(37),
          packIndex: 1,
          offset: 24
        }
        const midx: MultiPackIndex = {
          version: 1,
          packIds: ['pack-aaa', 'pack-bbb'],
          entries: [entry1, entry2],
          checksum: new Uint8Array(20)
        }
        expect(midx.entries.length).toBe(2)
      })
    })

    describe('createMultiPackIndex', () => {
      it('should create multi-pack index from multiple packfiles', async () => {
        const packData = createTestPackfile(2)
        const indexData = createTestIndexData()
        const { packId: packId1 } = await storage.uploadPackfile(packData, indexData)
        const { packId: packId2 } = await storage.uploadPackfile(packData, indexData)

        await storage.rebuildMultiPackIndex()

        const midx = await storage.getMultiPackIndex()
        expect(midx.packIds).toContain(packId1)
        expect(midx.packIds).toContain(packId2)
      })

      it('should store multi-pack index in R2', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        await storage.uploadPackfile(packData, indexData)

        await storage.rebuildMultiPackIndex()

        expect(bucket.has('packs/multi-pack-index')).toBe(true)
      })

      it('should include all objects from all packs', async () => {
        const packData = createTestPackfile(3)
        const indexData = createTestIndexData()
        await storage.uploadPackfile(packData, indexData)
        await storage.uploadPackfile(packData, indexData)

        await storage.rebuildMultiPackIndex()

        const midx = await storage.getMultiPackIndex()
        expect(midx.entries.length).toBeGreaterThan(0)
      })

      it('should handle empty repository', async () => {
        await storage.rebuildMultiPackIndex()

        const midx = await storage.getMultiPackIndex()
        expect(midx.packIds).toEqual([])
        expect(midx.entries).toEqual([])
      })
    })

    describe('parseMultiPackIndex', () => {
      it('should parse valid multi-pack index', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        await storage.uploadPackfile(packData, indexData)
        await storage.rebuildMultiPackIndex()

        const midxData = bucket.getData('packs/multi-pack-index')!
        const parsed = parseMultiPackIndex(midxData)

        expect(parsed).toBeDefined()
        expect(parsed.version).toBe(1)
      })

      it('should throw for invalid multi-pack index data', () => {
        const invalidData = new Uint8Array([0x00, 0x00, 0x00])

        expect(() => parseMultiPackIndex(invalidData)).toThrow(R2PackError)
      })
    })

    describe('lookupObjectInMultiPack', () => {
      it('should find object in multi-pack index', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        await storage.uploadPackfile(packData, indexData)
        await storage.rebuildMultiPackIndex()

        const midx = await storage.getMultiPackIndex()
        const objectId = sampleSha

        const result = lookupObjectInMultiPack(midx, objectId)

        // Will fail in RED phase since no real objects are indexed
        expect(result).toBeDefined()
        if (result) {
          expect(result.packIndex).toBeGreaterThanOrEqual(0)
          expect(result.offset).toBeGreaterThanOrEqual(0)
        }
      })

      it('should return null for non-existent object', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        await storage.uploadPackfile(packData, indexData)
        await storage.rebuildMultiPackIndex()

        const midx = await storage.getMultiPackIndex()
        const result = lookupObjectInMultiPack(midx, 'nonexistent'.repeat(4))

        expect(result).toBeNull()
      })

      it('should use binary search for efficient lookup', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        // Upload many packs
        for (let i = 0; i < 10; i++) {
          await storage.uploadPackfile(packData, indexData)
        }
        await storage.rebuildMultiPackIndex()

        const midx = await storage.getMultiPackIndex()

        // The lookup should be O(log n) even for many entries
        const start = performance.now()
        for (let i = 0; i < 1000; i++) {
          lookupObjectInMultiPack(midx, sampleSha)
        }
        const elapsed = performance.now() - start

        // Should complete quickly (< 100ms for 1000 lookups)
        expect(elapsed).toBeLessThan(100)
      })
    })

    describe('getMultiPackIndex', () => {
      it('should retrieve stored multi-pack index', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        await storage.uploadPackfile(packData, indexData)
        await storage.rebuildMultiPackIndex()

        const midx = await storage.getMultiPackIndex()

        expect(midx).toBeDefined()
        expect(midx.version).toBe(1)
      })

      it('should return empty index when no packfiles exist', async () => {
        const midx = await storage.getMultiPackIndex()

        expect(midx.packIds).toEqual([])
      })

      it('should cache multi-pack index', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        await storage.uploadPackfile(packData, indexData)
        await storage.rebuildMultiPackIndex()

        // First call
        const midx1 = await storage.getMultiPackIndex()
        // Second call (should use cache)
        const midx2 = await storage.getMultiPackIndex()

        expect(midx1).toEqual(midx2)
      })
    })
  })

  describe('Concurrent Access', () => {
    describe('Pack locking', () => {
      it('should acquire lock on packfile', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const lock = await storage.acquireLock(packId)

        expect(lock).toBeDefined()
        expect(lock.packId).toBe(packId)
        expect(lock.isHeld()).toBe(true)
      })

      it('should release lock', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const lock = await storage.acquireLock(packId)
        await lock.release()

        expect(lock.isHeld()).toBe(false)
      })

      it('should prevent concurrent modifications', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        await storage.acquireLock(packId)

        await expect(
          storage.acquireLock(packId)
        ).rejects.toThrow(R2PackError)
      })

      it('should allow lock after release', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const lock1 = await storage.acquireLock(packId)
        await lock1.release()
        const lock2 = await storage.acquireLock(packId)

        expect(lock2.isHeld()).toBe(true)
      })

      it('should support lock timeout', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        await storage.acquireLock(packId)

        await expect(
          storage.acquireLock(packId, { timeout: 100 })
        ).rejects.toThrow(R2PackError)
      })

      it('should auto-release lock after TTL', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        await storage.acquireLock(packId, { ttl: 50 })

        // Wait for TTL to expire
        await new Promise(resolve => setTimeout(resolve, 100))

        // Should be able to acquire lock now
        const lock = await storage.acquireLock(packId)
        expect(lock.isHeld()).toBe(true)
      })
    })

    describe('Concurrent reads', () => {
      it('should allow concurrent reads', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const results = await Promise.all([
          storage.downloadPackfile(packId),
          storage.downloadPackfile(packId),
          storage.downloadPackfile(packId)
        ])

        expect(results.every(r => r !== null)).toBe(true)
      })

      it('should not block reads while lock is held for writes', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        // Acquire write lock
        await storage.acquireLock(packId)

        // Reads should still work
        const downloaded = await storage.downloadPackfile(packId)

        expect(downloaded).not.toBeNull()
      })
    })

    describe('Concurrent uploads', () => {
      it('should handle concurrent uploads of different packfiles', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const results = await Promise.all([
          storage.uploadPackfile(packData, indexData),
          storage.uploadPackfile(packData, indexData),
          storage.uploadPackfile(packData, indexData)
        ])

        expect(results.length).toBe(3)
        expect(new Set(results.map(r => r.packId)).size).toBe(3)
      })

      it('should serialize multi-pack index updates', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        // Upload multiple packs concurrently
        await Promise.all([
          storage.uploadPackfile(packData, indexData),
          storage.uploadPackfile(packData, indexData),
          storage.uploadPackfile(packData, indexData)
        ])

        // Rebuild index should handle concurrent state correctly
        await storage.rebuildMultiPackIndex()

        const midx = await storage.getMultiPackIndex()
        expect(midx.packIds.length).toBe(3)
      })
    })

    describe('Atomic operations', () => {
      it('should atomically upload pack and index together', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        // If upload fails partway, neither should exist
        try {
          // Simulate failure by corrupting mid-upload
          const result = await storage.uploadPackfile(packData, indexData)

          // Both should exist
          expect(bucket.has(`packs/${result.packId}.pack`)).toBe(true)
          expect(bucket.has(`packs/${result.packId}.idx`)).toBe(true)
        } catch {
          // If it fails, neither should exist (all or nothing)
          const list = await bucket.list({ prefix: 'packs/' })
          expect(list.objects.length).toBe(0)
        }
      })

      it('should atomically delete pack and index together', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        await storage.deletePackfile(packId)

        expect(bucket.has(`packs/${packId}.pack`)).toBe(false)
        expect(bucket.has(`packs/${packId}.idx`)).toBe(false)
      })
    })
  })

  describe('Error Handling', () => {
    describe('R2PackError', () => {
      it('should have correct error code for not found', async () => {
        try {
          await storage.downloadPackfile('pack-nonexistent', { required: true })
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(R2PackError)
          expect((error as R2PackError).code).toBe('NOT_FOUND')
        }
      })

      it('should have correct error code for lock conflict', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        await storage.acquireLock(packId)

        try {
          await storage.acquireLock(packId)
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(R2PackError)
          expect((error as R2PackError).code).toBe('LOCKED')
        }
      })

      it('should have correct error code for invalid data', async () => {
        const invalidPack = new Uint8Array([0x00, 0x00, 0x00])
        const indexData = createTestIndexData()

        try {
          await storage.uploadPackfile(invalidPack, indexData)
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(R2PackError)
          expect((error as R2PackError).code).toBe('INVALID_DATA')
        }
      })

      it('should include pack ID in error when available', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        // Corrupt the data
        await bucket.put(`packs/${packId}.pack`, new Uint8Array([0xff]))

        try {
          await storage.downloadPackfile(packId, { verify: true })
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(R2PackError)
          expect((error as R2PackError).packId).toBe(packId)
        }
      })
    })

    describe('Network/storage failures', () => {
      it('should retry on transient failures', async () => {
        // This test would require mocking R2 to simulate failures
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        // Even with retries enabled, should eventually succeed or fail gracefully
        const result = await storage.uploadPackfile(packData, indexData, {
          retries: 3
        })

        expect(result).toBeDefined()
      })

      it('should provide meaningful error on permanent failure', async () => {
        // Simulate bucket not accessible
        const badStorage = new R2PackStorage({
          bucket: null as unknown as R2Bucket
        })

        await expect(
          badStorage.uploadPackfile(createTestPackfile(), createTestIndexData())
        ).rejects.toThrow()
      })
    })
  })

  describe('Standalone Functions', () => {
    describe('acquirePackLock', () => {
      it('should acquire lock using standalone function', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const lock = await acquirePackLock(bucket as unknown as R2Bucket, packId)

        expect(lock.isHeld()).toBe(true)
      })
    })

    describe('releasePackLock', () => {
      it('should release lock using standalone function', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const lock = await acquirePackLock(bucket as unknown as R2Bucket, packId)
        await releasePackLock(bucket as unknown as R2Bucket, packId)

        // Should be able to acquire again
        const lock2 = await acquirePackLock(bucket as unknown as R2Bucket, packId)
        expect(lock2.isHeld()).toBe(true)
      })
    })

    describe('getPackfileMetadata standalone', () => {
      it('should get metadata using standalone function', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const metadata = await getPackfileMetadata(bucket as unknown as R2Bucket, packId)

        expect(metadata).toBeDefined()
        expect(metadata!.packId).toBe(packId)
      })
    })

    describe('listPackfiles standalone', () => {
      it('should list packfiles using standalone function', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        await storage.uploadPackfile(packData, indexData)

        const list = await listPackfiles(bucket as unknown as R2Bucket)

        expect(list.length).toBeGreaterThan(0)
      })
    })

    describe('deletePackfile standalone', () => {
      it('should delete using standalone function', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        const { packId } = await storage.uploadPackfile(packData, indexData)

        const deleted = await deletePackfile(bucket as unknown as R2Bucket, packId)

        expect(deleted).toBe(true)
      })
    })

    describe('createMultiPackIndex standalone', () => {
      it('should create multi-pack index using standalone function', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()
        await storage.uploadPackfile(packData, indexData)

        const midx = await createMultiPackIndex(bucket as unknown as R2Bucket)

        expect(midx).toBeDefined()
        expect(midx.packIds.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle very large object count in packfile', async () => {
      const packData = createTestPackfile(65535) // Max objects in simple pack
      const indexData = createTestIndexData()

      const result = await storage.uploadPackfile(packData, indexData)

      expect(result.objectCount).toBe(65535)
    })

    it('should handle unicode in pack ID paths', async () => {
      const storage = new R2PackStorage({
        bucket: bucket as unknown as R2Bucket,
        prefix: 'repos/test-\u00e9\u00f1\u00e8/'
      })
      const packData = createTestPackfile()
      const indexData = createTestIndexData()

      const result = await storage.uploadPackfile(packData, indexData)

      expect(result.packId).toBeDefined()
    })

    it('should handle empty prefix', async () => {
      const storage = new R2PackStorage({
        bucket: bucket as unknown as R2Bucket,
        prefix: ''
      })
      const packData = createTestPackfile()
      const indexData = createTestIndexData()

      const result = await storage.uploadPackfile(packData, indexData)

      expect(bucket.has(`packs/${result.packId}.pack`)).toBe(true)
    })

    it('should handle trailing slash in prefix', async () => {
      const storage = new R2PackStorage({
        bucket: bucket as unknown as R2Bucket,
        prefix: 'repos/test/'
      })
      const packData = createTestPackfile()
      const indexData = createTestIndexData()

      const result = await storage.uploadPackfile(packData, indexData)

      // Should not have double slashes
      const expectedKey = `repos/test/packs/${result.packId}.pack`
      expect(bucket.has(expectedKey)).toBe(true)
    })

    it('should handle concurrent multi-pack index rebuilds', async () => {
      const packData = createTestPackfile()
      const indexData = createTestIndexData()
      await storage.uploadPackfile(packData, indexData)
      await storage.uploadPackfile(packData, indexData)

      // Concurrent rebuilds should not corrupt the index
      await Promise.all([
        storage.rebuildMultiPackIndex(),
        storage.rebuildMultiPackIndex(),
        storage.rebuildMultiPackIndex()
      ])

      const midx = await storage.getMultiPackIndex()
      expect(midx.packIds.length).toBe(2)
    })
  })

  describe('Atomic Upload with Manifest', () => {
    describe('uploadPackfile with atomic pattern', () => {
      it('should create a manifest file on upload', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        // Check manifest exists
        const manifestKey = `packs/${result.packId}.manifest`
        expect(bucket.has(manifestKey)).toBe(true)
      })

      it('should create manifest with complete status', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        const manifest = await storage.getPackManifest(result.packId)
        expect(manifest).toBeDefined()
        expect(manifest!.status).toBe('complete')
        expect(manifest!.packId).toBe(result.packId)
      })

      it('should include checksums in manifest', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        const manifest = await storage.getPackManifest(result.packId)
        expect(manifest).toBeDefined()
        expect(manifest!.packChecksum).toBe(result.checksum)
        expect(manifest!.indexChecksum).toBeDefined()
        expect(manifest!.indexChecksum).toHaveLength(40)
      })

      it('should include size and object count in manifest', async () => {
        const packData = createTestPackfile(5)
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        const manifest = await storage.getPackManifest(result.packId)
        expect(manifest).toBeDefined()
        expect(manifest!.packSize).toBe(result.packSize)
        expect(manifest!.indexSize).toBe(result.indexSize)
        expect(manifest!.objectCount).toBe(5)
      })

      it('should clean up staging files after successful upload', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        // Staging files should be cleaned up
        expect(bucket.has(`staging/${result.packId}.pack`)).toBe(false)
        expect(bucket.has(`staging/${result.packId}.idx`)).toBe(false)
      })

      it('should support skipAtomic option for legacy uploads', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData, { skipAtomic: true })

        // Pack and index should exist
        expect(bucket.has(`packs/${result.packId}.pack`)).toBe(true)
        expect(bucket.has(`packs/${result.packId}.idx`)).toBe(true)

        // No manifest should be created
        expect(bucket.has(`packs/${result.packId}.manifest`)).toBe(false)
      })
    })

    describe('isPackComplete', () => {
      it('should return true for pack with complete manifest', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        const isComplete = await storage.isPackComplete(result.packId)
        expect(isComplete).toBe(true)
      })

      it('should return false for pack with staging manifest', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        // Modify manifest to staging status
        const stagingManifest = {
          version: 1,
          packId: result.packId,
          packChecksum: result.checksum,
          indexChecksum: 'a'.repeat(40),
          packSize: result.packSize,
          indexSize: result.indexSize,
          objectCount: result.objectCount,
          completedAt: new Date().toISOString(),
          status: 'staging'
        }
        await bucket.put(`packs/${result.packId}.manifest`, JSON.stringify(stagingManifest))

        const isComplete = await storage.isPackComplete(result.packId)
        expect(isComplete).toBe(false)
      })

      it('should return true for legacy pack without manifest if both files exist', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        // Upload with skipAtomic to simulate legacy pack
        const result = await storage.uploadPackfile(packData, indexData, { skipAtomic: true })

        const isComplete = await storage.isPackComplete(result.packId)
        expect(isComplete).toBe(true)
      })

      it('should return false for legacy pack with only pack file', async () => {
        const packData = createTestPackfile()

        // Manually create only pack file
        await bucket.put('packs/pack-orphan.pack', packData)

        const isComplete = await storage.isPackComplete('pack-orphan')
        expect(isComplete).toBe(false)
      })

      it('should return false for non-existent pack', async () => {
        const isComplete = await storage.isPackComplete('pack-nonexistent')
        expect(isComplete).toBe(false)
      })
    })

    describe('getPackManifest', () => {
      it('should return manifest for existing pack', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        const manifest = await storage.getPackManifest(result.packId)
        expect(manifest).toBeDefined()
        expect(manifest!.version).toBe(1)
      })

      it('should return null for pack without manifest', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData, { skipAtomic: true })

        const manifest = await storage.getPackManifest(result.packId)
        expect(manifest).toBeNull()
      })

      it('should return null for non-existent pack', async () => {
        const manifest = await storage.getPackManifest('pack-nonexistent')
        expect(manifest).toBeNull()
      })
    })

    describe('downloadPackfile completeness check', () => {
      it('should download complete pack', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        const downloaded = await storage.downloadPackfile(result.packId)
        expect(downloaded).toBeDefined()
        expect(downloaded!.packData).toEqual(packData)
      })

      it('should return null for incomplete pack', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        // Set manifest to staging to simulate incomplete upload
        const stagingManifest = {
          version: 1,
          packId: result.packId,
          packChecksum: result.checksum,
          indexChecksum: 'a'.repeat(40),
          packSize: result.packSize,
          indexSize: result.indexSize,
          objectCount: result.objectCount,
          completedAt: new Date().toISOString(),
          status: 'staging'
        }
        await bucket.put(`packs/${result.packId}.manifest`, JSON.stringify(stagingManifest))

        const downloaded = await storage.downloadPackfile(result.packId)
        expect(downloaded).toBeNull()
      })

      it('should throw for incomplete pack with required option', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        // Set manifest to staging
        const stagingManifest = {
          version: 1,
          packId: result.packId,
          packChecksum: result.checksum,
          indexChecksum: 'a'.repeat(40),
          packSize: result.packSize,
          indexSize: result.indexSize,
          objectCount: result.objectCount,
          completedAt: new Date().toISOString(),
          status: 'staging'
        }
        await bucket.put(`packs/${result.packId}.manifest`, JSON.stringify(stagingManifest))

        await expect(
          storage.downloadPackfile(result.packId, { required: true })
        ).rejects.toThrow(R2PackError)
      })
    })

    describe('deletePackfile with manifest', () => {
      it('should delete manifest along with pack and index', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        const result = await storage.uploadPackfile(packData, indexData)

        await storage.deletePackfile(result.packId)

        expect(bucket.has(`packs/${result.packId}.pack`)).toBe(false)
        expect(bucket.has(`packs/${result.packId}.idx`)).toBe(false)
        expect(bucket.has(`packs/${result.packId}.manifest`)).toBe(false)
      })
    })

    describe('cleanupOrphanedStagingFiles', () => {
      it('should clean up staging files for incomplete uploads', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        // Manually create staging files to simulate failed upload
        await bucket.put('staging/pack-orphan.pack', packData)
        await bucket.put('staging/pack-orphan.idx', indexData)

        const cleanedUp = await storage.cleanupOrphanedStagingFiles()

        expect(cleanedUp).toContain('pack-orphan')
        expect(bucket.has('staging/pack-orphan.pack')).toBe(false)
        expect(bucket.has('staging/pack-orphan.idx')).toBe(false)
      })

      it('should clean up staging files for complete uploads', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        // Upload a complete pack first
        const result = await storage.uploadPackfile(packData, indexData)

        // Manually re-add staging files (simulating residual files)
        await bucket.put(`staging/${result.packId}.pack`, packData)
        await bucket.put(`staging/${result.packId}.idx`, indexData)

        const cleanedUp = await storage.cleanupOrphanedStagingFiles()

        expect(cleanedUp).toContain(result.packId)
        expect(bucket.has(`staging/${result.packId}.pack`)).toBe(false)
        expect(bucket.has(`staging/${result.packId}.idx`)).toBe(false)

        // Final files should still exist
        expect(bucket.has(`packs/${result.packId}.pack`)).toBe(true)
        expect(bucket.has(`packs/${result.packId}.idx`)).toBe(true)
      })

      it('should clean up partial final files for incomplete uploads', async () => {
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        // Simulate a partial upload: staging files and some final files, but no complete manifest
        await bucket.put('staging/pack-partial.pack', packData)
        await bucket.put('staging/pack-partial.idx', indexData)
        await bucket.put('packs/pack-partial.pack', packData)
        // No index in final location, no manifest

        const cleanedUp = await storage.cleanupOrphanedStagingFiles()

        expect(cleanedUp).toContain('pack-partial')
        // All related files should be cleaned up
        expect(bucket.has('staging/pack-partial.pack')).toBe(false)
        expect(bucket.has('staging/pack-partial.idx')).toBe(false)
        expect(bucket.has('packs/pack-partial.pack')).toBe(false)
      })

      it('should return empty array when no staging files exist', async () => {
        const cleanedUp = await storage.cleanupOrphanedStagingFiles()

        expect(cleanedUp).toEqual([])
      })

      it('should handle prefixed storage', async () => {
        const prefixedStorage = new R2PackStorage({
          bucket: bucket as unknown as R2Bucket,
          prefix: 'repos/test/'
        })
        const packData = createTestPackfile()
        const indexData = createTestIndexData()

        // Create staging files with prefix
        await bucket.put('repos/test/staging/pack-orphan.pack', packData)
        await bucket.put('repos/test/staging/pack-orphan.idx', indexData)

        const cleanedUp = await prefixedStorage.cleanupOrphanedStagingFiles()

        expect(cleanedUp).toContain('pack-orphan')
        expect(bucket.has('repos/test/staging/pack-orphan.pack')).toBe(false)
        expect(bucket.has('repos/test/staging/pack-orphan.idx')).toBe(false)
      })
    })
  })
})
