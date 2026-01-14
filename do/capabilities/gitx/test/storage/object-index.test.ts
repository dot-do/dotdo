import { describe, it, expect, beforeEach } from 'vitest'
import {
  ObjectIndex,
  ObjectLocation,
  StorageTier,
  ObjectIndexStats,
  BatchLookupResult,
  RecordLocationOptions,
  recordLocation,
  lookupLocation,
  batchLookup,
  getStats
} from '../../src/storage/object-index'
import { DurableObjectStorage } from '../../src/durable-object/schema'

// Helper functions
function createTestSha(prefix: string): string {
  // Pad with zeros in the middle to avoid collisions like "abc1" vs "abc10"
  const hash = prefix.replace(/[^a-z0-9]/g, '')
  return hash.slice(0, 20).padEnd(20, '0') + prefix.length.toString(16).padStart(4, '0') + '0'.repeat(16)
}

/**
 * Mock DurableObjectStorage for testing ObjectIndex operations
 */
class MockObjectStorage implements DurableObjectStorage {
  private objectIndex: Map<string, ObjectLocation> = new Map()
  private executedQueries: string[] = []
  private lockState: Map<string, boolean> = new Map()

  sql = {
    exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
      this.executedQueries.push(query)

      // Handle INSERT INTO object_index
      if (query.includes('INSERT') && query.includes('object_index')) {
        const sha = params[0] as string
        const tier = params[1] as StorageTier
        const packId = params[2] as string | null
        const offset = params[3] as number | null
        const size = params[4] as number
        const type = params[5] as string | undefined
        const updatedAt = params[6] as number | undefined

        this.objectIndex.set(sha, {
          sha,
          tier,
          packId,
          offset,
          size,
          type,
          updatedAt
        })
        return { toArray: () => [] }
      }

      // Handle SELECT from object_index by sha
      if (query.includes('SELECT') && query.includes('FROM object_index') && query.includes('WHERE sha = ?')) {
        const sha = params[0] as string
        const location = this.objectIndex.get(sha)
        return { toArray: () => location ? [location] : [] }
      }

      // Handle SELECT from object_index by tier
      if (query.includes('SELECT') && query.includes('FROM object_index') && query.includes('WHERE tier = ?')) {
        const tier = params[0] as StorageTier
        const locations = Array.from(this.objectIndex.values()).filter(l => l.tier === tier)
        return { toArray: () => locations }
      }

      // Handle SELECT from object_index by pack_id
      if (query.includes('SELECT') && query.includes('FROM object_index') && query.includes('WHERE pack_id = ?')) {
        const packId = params[0] as string
        const locations = Array.from(this.objectIndex.values()).filter(l => l.packId === packId)
        return { toArray: () => locations }
      }

      // Handle UPDATE object_index
      if (query.includes('UPDATE') && query.includes('object_index')) {
        const tier = params[0] as StorageTier
        const packId = params[1] as string | null
        const offset = params[2] as number | null
        const sha = params[3] as string

        const existing = this.objectIndex.get(sha)
        if (existing) {
          existing.tier = tier
          existing.packId = packId
          existing.offset = offset
          existing.updatedAt = Date.now()
        }
        return { toArray: () => [] }
      }

      // Handle DELETE from object_index
      if (query.includes('DELETE') && query.includes('object_index') && query.includes('WHERE sha = ?')) {
        const sha = params[0] as string
        const existed = this.objectIndex.has(sha)
        this.objectIndex.delete(sha)
        return { toArray: () => [{ changes: existed ? 1 : 0 }] }
      }

      // Handle COUNT queries for stats
      if (query.includes('SELECT COUNT') && query.includes('FROM object_index')) {
        if (query.includes('WHERE tier = ?')) {
          const tier = params[0] as StorageTier
          const count = Array.from(this.objectIndex.values()).filter(l => l.tier === tier).length
          return { toArray: () => [{ count }] }
        }
        const count = this.objectIndex.size
        return { toArray: () => [{ count }] }
      }

      // Handle SUM queries for stats
      if (query.includes('SELECT SUM') && query.includes('FROM object_index')) {
        if (query.includes('WHERE tier = ?')) {
          const tier = params[0] as StorageTier
          const sum = Array.from(this.objectIndex.values())
            .filter(l => l.tier === tier)
            .reduce((acc, l) => acc + l.size, 0)
          return { toArray: () => [{ sum: sum || 0 }] }
        }
        return { toArray: () => [{ sum: 0 }] }
      }

      // Handle batch SELECT (IN clause)
      if (query.includes('SELECT') && query.includes('FROM object_index') && query.includes('IN')) {
        const shas = params as string[]
        const locations = shas
          .map(sha => this.objectIndex.get(sha))
          .filter((l): l is ObjectLocation => l !== undefined)
        return { toArray: () => locations }
      }

      return { toArray: () => [] }
    }
  }

  // Test helpers
  getObjectIndex(): Map<string, ObjectLocation> {
    return new Map(this.objectIndex)
  }

  getExecutedQueries(): string[] {
    return [...this.executedQueries]
  }

  clearAll(): void {
    this.objectIndex.clear()
    this.executedQueries = []
    this.lockState.clear()
  }

  injectLocation(location: ObjectLocation): void {
    this.objectIndex.set(location.sha, location)
  }

  setLock(sha: string, locked: boolean): void {
    this.lockState.set(sha, locked)
  }

  isLocked(sha: string): boolean {
    return this.lockState.get(sha) || false
  }
}

describe('ObjectIndex', () => {
  let storage: MockObjectStorage
  let objectIndex: ObjectIndex

  beforeEach(() => {
    storage = new MockObjectStorage()
    objectIndex = new ObjectIndex(storage)
  })

  describe('Object Location Tracking', () => {
    describe('recordLocation', () => {
      it('should record object location in hot tier', async () => {
        const options: RecordLocationOptions = {
          sha: createTestSha('abc123'),
          tier: 'hot',
          size: 1024,
          type: 'blob'
        }

        await objectIndex.recordLocation(options)

        const location = await objectIndex.lookupLocation(options.sha)
        expect(location).not.toBeNull()
        expect(location!.tier).toBe('hot')
        expect(location!.size).toBe(1024)
        expect(location!.type).toBe('blob')
      })

      it('should record object location in R2 tier with pack info', async () => {
        const options: RecordLocationOptions = {
          sha: createTestSha('def456'),
          tier: 'r2',
          packId: 'pack-001',
          offset: 12345,
          size: 2048,
          type: 'tree'
        }

        await objectIndex.recordLocation(options)

        const location = await objectIndex.lookupLocation(options.sha)
        expect(location).not.toBeNull()
        expect(location!.tier).toBe('r2')
        expect(location!.packId).toBe('pack-001')
        expect(location!.offset).toBe(12345)
        expect(location!.size).toBe(2048)
      })

      it('should record object location in parquet tier', async () => {
        const options: RecordLocationOptions = {
          sha: createTestSha('ghi789'),
          tier: 'parquet',
          packId: 'archive-2024-01',
          offset: 99999,
          size: 512,
          type: 'commit'
        }

        await objectIndex.recordLocation(options)

        const location = await objectIndex.lookupLocation(options.sha)
        expect(location).not.toBeNull()
        expect(location!.tier).toBe('parquet')
        expect(location!.packId).toBe('archive-2024-01')
      })

      it('should record timestamp when location is recorded', async () => {
        const before = Date.now()

        await objectIndex.recordLocation({
          sha: createTestSha('time123'),
          tier: 'hot',
          size: 100
        })

        const after = Date.now()
        const location = await objectIndex.lookupLocation(createTestSha('time123'))
        expect(location).not.toBeNull()
        expect(location!.updatedAt).toBeGreaterThanOrEqual(before)
        expect(location!.updatedAt).toBeLessThanOrEqual(after)
      })

      it('should overwrite existing location for same SHA', async () => {
        const sha = createTestSha('overwrite')

        await objectIndex.recordLocation({
          sha,
          tier: 'hot',
          size: 100
        })

        await objectIndex.recordLocation({
          sha,
          tier: 'r2',
          packId: 'pack-new',
          offset: 500,
          size: 200
        })

        const location = await objectIndex.lookupLocation(sha)
        expect(location!.tier).toBe('r2')
        expect(location!.packId).toBe('pack-new')
        expect(location!.size).toBe(200)
      })
    })

    describe('lookupLocation', () => {
      it('should return null for non-existent object', async () => {
        const location = await objectIndex.lookupLocation(createTestSha('nonexistent'))

        expect(location).toBeNull()
      })

      it('should return full location details', async () => {
        await objectIndex.recordLocation({
          sha: createTestSha('lookup'),
          tier: 'r2',
          packId: 'pack-abc',
          offset: 1000,
          size: 500,
          type: 'blob'
        })

        const location = await objectIndex.lookupLocation(createTestSha('lookup'))

        expect(location).not.toBeNull()
        expect(location).toMatchObject({
          sha: createTestSha('lookup'),
          tier: 'r2',
          packId: 'pack-abc',
          offset: 1000,
          size: 500,
          type: 'blob'
        })
      })

      it('should handle hot tier objects with null pack info', async () => {
        await objectIndex.recordLocation({
          sha: createTestSha('hotobj'),
          tier: 'hot',
          size: 256
        })

        const location = await objectIndex.lookupLocation(createTestSha('hotobj'))

        expect(location!.packId).toBeNull()
        expect(location!.offset).toBeNull()
      })
    })

    describe('exists', () => {
      it('should return true for existing object', async () => {
        await objectIndex.recordLocation({
          sha: createTestSha('exists'),
          tier: 'hot',
          size: 100
        })

        const exists = await objectIndex.exists(createTestSha('exists'))

        expect(exists).toBe(true)
      })

      it('should return false for non-existent object', async () => {
        const exists = await objectIndex.exists(createTestSha('missing'))

        expect(exists).toBe(false)
      })
    })

    describe('deleteLocation', () => {
      it('should delete existing location', async () => {
        const sha = createTestSha('todelete')
        await objectIndex.recordLocation({
          sha,
          tier: 'hot',
          size: 100
        })

        const deleted = await objectIndex.deleteLocation(sha)

        expect(deleted).toBe(true)
        const location = await objectIndex.lookupLocation(sha)
        expect(location).toBeNull()
      })

      it('should return false for non-existent location', async () => {
        const deleted = await objectIndex.deleteLocation(createTestSha('never-existed'))

        expect(deleted).toBe(false)
      })
    })
  })

  describe('Index Updates on Write', () => {
    it('should update location when object moves between tiers', async () => {
      const sha = createTestSha('moving')

      await objectIndex.recordLocation({
        sha,
        tier: 'hot',
        size: 1000
      })

      await objectIndex.updateLocation(sha, 'r2', 'pack-001', 5000)

      const location = await objectIndex.lookupLocation(sha)
      expect(location!.tier).toBe('r2')
      expect(location!.packId).toBe('pack-001')
      expect(location!.offset).toBe(5000)
    })

    it('should preserve size and type when updating location', async () => {
      const sha = createTestSha('preserve')

      await objectIndex.recordLocation({
        sha,
        tier: 'hot',
        size: 2048,
        type: 'commit'
      })

      await objectIndex.updateLocation(sha, 'r2', 'pack-002', 1000)

      const location = await objectIndex.lookupLocation(sha)
      expect(location!.size).toBe(2048)
      expect(location!.type).toBe('commit')
    })

    it('should update timestamp on location change', async () => {
      const sha = createTestSha('timestamp')

      await objectIndex.recordLocation({
        sha,
        tier: 'hot',
        size: 100
      })

      const originalLocation = await objectIndex.lookupLocation(sha)
      const originalTimestamp = originalLocation!.updatedAt

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10))

      await objectIndex.updateLocation(sha, 'r2', 'pack-003', 2000)

      const updatedLocation = await objectIndex.lookupLocation(sha)
      expect(updatedLocation!.updatedAt).toBeGreaterThan(originalTimestamp!)
    })

    it('should handle promotion from cold to hot tier', async () => {
      const sha = createTestSha('promote')

      await objectIndex.recordLocation({
        sha,
        tier: 'parquet',
        packId: 'archive-old',
        offset: 99999,
        size: 512,
        type: 'blob'
      })

      await objectIndex.updateLocation(sha, 'hot')

      const location = await objectIndex.lookupLocation(sha)
      expect(location!.tier).toBe('hot')
      expect(location!.packId).toBeNull()
      expect(location!.offset).toBeNull()
    })

    it('should handle batch location updates', async () => {
      const sha1 = createTestSha('batch1')
      const sha2 = createTestSha('batch2')
      const sha3 = createTestSha('batch3')

      // Record initial locations
      await objectIndex.recordLocation({ sha: sha1, tier: 'hot', size: 100 })
      await objectIndex.recordLocation({ sha: sha2, tier: 'hot', size: 200 })
      await objectIndex.recordLocation({ sha: sha3, tier: 'hot', size: 300 })

      // Move all to R2 (when implemented, this should be atomic)
      await objectIndex.updateLocation(sha1, 'r2', 'pack-batch', 0)
      await objectIndex.updateLocation(sha2, 'r2', 'pack-batch', 100)
      await objectIndex.updateLocation(sha3, 'r2', 'pack-batch', 300)

      const loc1 = await objectIndex.lookupLocation(sha1)
      const loc2 = await objectIndex.lookupLocation(sha2)
      const loc3 = await objectIndex.lookupLocation(sha3)

      expect(loc1!.tier).toBe('r2')
      expect(loc2!.tier).toBe('r2')
      expect(loc3!.tier).toBe('r2')
      expect(loc1!.packId).toBe('pack-batch')
    })
  })

  describe('Multi-pack Object Lookup', () => {
    describe('batchLookup', () => {
      it('should return all found objects and list missing ones', async () => {
        const sha1 = createTestSha('found1')
        const sha2 = createTestSha('found2')
        const sha3 = createTestSha('missing1')

        await objectIndex.recordLocation({ sha: sha1, tier: 'hot', size: 100 })
        await objectIndex.recordLocation({ sha: sha2, tier: 'r2', packId: 'pack-1', offset: 0, size: 200 })

        const result = await objectIndex.batchLookup([sha1, sha2, sha3])

        expect(result.found.size).toBe(2)
        expect(result.found.has(sha1)).toBe(true)
        expect(result.found.has(sha2)).toBe(true)
        expect(result.missing).toContain(sha3)
        expect(result.missing.length).toBe(1)
      })

      it('should handle empty lookup', async () => {
        const result = await objectIndex.batchLookup([])

        expect(result.found.size).toBe(0)
        expect(result.missing.length).toBe(0)
      })

      it('should handle all missing objects', async () => {
        const result = await objectIndex.batchLookup([
          createTestSha('miss1'),
          createTestSha('miss2'),
          createTestSha('miss3')
        ])

        expect(result.found.size).toBe(0)
        expect(result.missing.length).toBe(3)
      })

      it('should handle all found objects', async () => {
        const sha1 = createTestSha('all1')
        const sha2 = createTestSha('all2')

        await objectIndex.recordLocation({ sha: sha1, tier: 'hot', size: 100 })
        await objectIndex.recordLocation({ sha: sha2, tier: 'hot', size: 200 })

        const result = await objectIndex.batchLookup([sha1, sha2])

        expect(result.found.size).toBe(2)
        expect(result.missing.length).toBe(0)
      })

      it('should handle large batch efficiently', async () => {
        // Create 100 objects
        const shas: string[] = []
        for (let i = 0; i < 100; i++) {
          const sha = createTestSha(`large${i.toString().padStart(4, '0')}`)
          shas.push(sha)
          await objectIndex.recordLocation({
            sha,
            tier: i % 3 === 0 ? 'hot' : i % 3 === 1 ? 'r2' : 'parquet',
            packId: i % 3 !== 0 ? `pack-${Math.floor(i / 10)}` : undefined,
            offset: i % 3 !== 0 ? i * 100 : undefined,
            size: 100 + i
          })
        }

        const startTime = Date.now()
        const result = await objectIndex.batchLookup(shas)
        const endTime = Date.now()

        expect(result.found.size).toBe(100)
        expect(result.missing.length).toBe(0)
        // Should complete in reasonable time
        expect(endTime - startTime).toBeLessThan(1000)
      })
    })

    describe('getObjectsByPack', () => {
      it('should return all objects in a specific pack', async () => {
        const packId = 'pack-multi-001'

        await objectIndex.recordLocation({ sha: createTestSha('pack1'), tier: 'r2', packId, offset: 0, size: 100 })
        await objectIndex.recordLocation({ sha: createTestSha('pack2'), tier: 'r2', packId, offset: 100, size: 200 })
        await objectIndex.recordLocation({ sha: createTestSha('pack3'), tier: 'r2', packId, offset: 300, size: 150 })
        await objectIndex.recordLocation({ sha: createTestSha('other'), tier: 'r2', packId: 'other-pack', offset: 0, size: 50 })

        const objects = await objectIndex.getObjectsByPack(packId)

        expect(objects.length).toBe(3)
        expect(objects.every(o => o.packId === packId)).toBe(true)
      })

      it('should return empty array for non-existent pack', async () => {
        const objects = await objectIndex.getObjectsByPack('nonexistent-pack')

        expect(objects).toEqual([])
      })

      it('should order objects by offset within pack', async () => {
        const packId = 'pack-ordered'

        await objectIndex.recordLocation({ sha: createTestSha('third'), tier: 'r2', packId, offset: 500, size: 100 })
        await objectIndex.recordLocation({ sha: createTestSha('first'), tier: 'r2', packId, offset: 0, size: 100 })
        await objectIndex.recordLocation({ sha: createTestSha('second'), tier: 'r2', packId, offset: 100, size: 100 })

        const objects = await objectIndex.getObjectsByPack(packId)

        // Should be ordered by offset
        expect(objects[0].offset).toBe(0)
        expect(objects[1].offset).toBe(100)
        expect(objects[2].offset).toBe(500)
      })
    })

    describe('getObjectsByTier', () => {
      it('should return all objects in hot tier', async () => {
        await objectIndex.recordLocation({ sha: createTestSha('hot1'), tier: 'hot', size: 100 })
        await objectIndex.recordLocation({ sha: createTestSha('hot2'), tier: 'hot', size: 200 })
        await objectIndex.recordLocation({ sha: createTestSha('r2obj'), tier: 'r2', packId: 'pack', offset: 0, size: 50 })

        const hotObjects = await objectIndex.getObjectsByTier('hot')

        expect(hotObjects.length).toBe(2)
        expect(hotObjects.every(o => o.tier === 'hot')).toBe(true)
      })

      it('should return all objects in R2 tier', async () => {
        await objectIndex.recordLocation({ sha: createTestSha('r21'), tier: 'r2', packId: 'pack-1', offset: 0, size: 100 })
        await objectIndex.recordLocation({ sha: createTestSha('r22'), tier: 'r2', packId: 'pack-2', offset: 0, size: 200 })
        await objectIndex.recordLocation({ sha: createTestSha('hotobj'), tier: 'hot', size: 50 })

        const r2Objects = await objectIndex.getObjectsByTier('r2')

        expect(r2Objects.length).toBe(2)
        expect(r2Objects.every(o => o.tier === 'r2')).toBe(true)
      })

      it('should return empty array for empty tier', async () => {
        await objectIndex.recordLocation({ sha: createTestSha('onlyhot'), tier: 'hot', size: 100 })

        const parquetObjects = await objectIndex.getObjectsByTier('parquet')

        expect(parquetObjects).toEqual([])
      })
    })
  })

  describe('Index Persistence', () => {
    it('should persist location data across operations', async () => {
      const sha = createTestSha('persist')

      await objectIndex.recordLocation({
        sha,
        tier: 'r2',
        packId: 'persistent-pack',
        offset: 12345,
        size: 9999,
        type: 'tree'
      })

      // Create new ObjectIndex instance with same storage
      const newObjectIndex = new ObjectIndex(storage)
      const location = await newObjectIndex.lookupLocation(sha)

      expect(location).not.toBeNull()
      expect(location!.tier).toBe('r2')
      expect(location!.packId).toBe('persistent-pack')
      expect(location!.offset).toBe(12345)
      expect(location!.size).toBe(9999)
      expect(location!.type).toBe('tree')
    })

    it('should maintain index integrity after delete', async () => {
      const sha1 = createTestSha('keep1')
      const sha2 = createTestSha('delete')
      const sha3 = createTestSha('keep2')

      await objectIndex.recordLocation({ sha: sha1, tier: 'hot', size: 100 })
      await objectIndex.recordLocation({ sha: sha2, tier: 'hot', size: 200 })
      await objectIndex.recordLocation({ sha: sha3, tier: 'hot', size: 300 })

      await objectIndex.deleteLocation(sha2)

      const loc1 = await objectIndex.lookupLocation(sha1)
      const loc2 = await objectIndex.lookupLocation(sha2)
      const loc3 = await objectIndex.lookupLocation(sha3)

      expect(loc1).not.toBeNull()
      expect(loc2).toBeNull()
      expect(loc3).not.toBeNull()
    })

    it('should maintain accurate statistics after operations', async () => {
      // Add several objects
      await objectIndex.recordLocation({ sha: createTestSha('stat1'), tier: 'hot', size: 100 })
      await objectIndex.recordLocation({ sha: createTestSha('stat2'), tier: 'hot', size: 200 })
      await objectIndex.recordLocation({ sha: createTestSha('stat3'), tier: 'r2', packId: 'pack', offset: 0, size: 300 })

      let stats = await objectIndex.getStats()
      expect(stats.totalObjects).toBe(3)
      expect(stats.hotCount).toBe(2)
      expect(stats.r2Count).toBe(1)
      expect(stats.hotSize).toBe(300)
      expect(stats.r2Size).toBe(300)

      // Delete one
      await objectIndex.deleteLocation(createTestSha('stat1'))

      stats = await objectIndex.getStats()
      expect(stats.totalObjects).toBe(2)
      expect(stats.hotCount).toBe(1)
      expect(stats.hotSize).toBe(200)
    })

    describe('getStats', () => {
      it('should return correct statistics for empty index', async () => {
        const stats = await objectIndex.getStats()

        expect(stats.totalObjects).toBe(0)
        expect(stats.hotCount).toBe(0)
        expect(stats.r2Count).toBe(0)
        expect(stats.parquetCount).toBe(0)
        expect(stats.hotSize).toBe(0)
        expect(stats.r2Size).toBe(0)
        expect(stats.parquetSize).toBe(0)
      })

      it('should return correct statistics for populated index', async () => {
        await objectIndex.recordLocation({ sha: createTestSha('s1'), tier: 'hot', size: 1000 })
        await objectIndex.recordLocation({ sha: createTestSha('s2'), tier: 'hot', size: 2000 })
        await objectIndex.recordLocation({ sha: createTestSha('s3'), tier: 'r2', packId: 'p1', offset: 0, size: 3000 })
        await objectIndex.recordLocation({ sha: createTestSha('s4'), tier: 'parquet', packId: 'a1', offset: 0, size: 4000 })
        await objectIndex.recordLocation({ sha: createTestSha('s5'), tier: 'parquet', packId: 'a1', offset: 4000, size: 5000 })

        const stats = await objectIndex.getStats()

        expect(stats.totalObjects).toBe(5)
        expect(stats.hotCount).toBe(2)
        expect(stats.r2Count).toBe(1)
        expect(stats.parquetCount).toBe(2)
        expect(stats.hotSize).toBe(3000)
        expect(stats.r2Size).toBe(3000)
        expect(stats.parquetSize).toBe(9000)
      })
    })
  })

  describe('Concurrent Index Access', () => {
    it('should handle concurrent reads safely', async () => {
      const sha = createTestSha('concurrent-read')
      await objectIndex.recordLocation({ sha, tier: 'hot', size: 100 })

      // Perform many concurrent reads
      const reads = Array(50).fill(null).map(() => objectIndex.lookupLocation(sha))
      const results = await Promise.all(reads)

      // All reads should return the same value
      expect(results.every(r => r !== null)).toBe(true)
      expect(results.every(r => r!.sha === sha)).toBe(true)
    })

    it('should handle concurrent writes to different objects', async () => {
      const writes = Array(20).fill(null).map((_, i) =>
        objectIndex.recordLocation({
          sha: createTestSha(`concurrent-write-${i}`),
          tier: 'hot',
          size: 100 + i
        })
      )

      await Promise.all(writes)

      // Verify all objects were written
      for (let i = 0; i < 20; i++) {
        const location = await objectIndex.lookupLocation(createTestSha(`concurrent-write-${i}`))
        expect(location).not.toBeNull()
        expect(location!.size).toBe(100 + i)
      }
    })

    it('should handle concurrent read and write operations', async () => {
      const sha = createTestSha('read-write')
      await objectIndex.recordLocation({ sha, tier: 'hot', size: 100 })

      // Mix of reads and updates
      const operations = [
        objectIndex.lookupLocation(sha),
        objectIndex.updateLocation(sha, 'r2', 'pack-1', 0),
        objectIndex.lookupLocation(sha),
        objectIndex.exists(sha),
        objectIndex.lookupLocation(sha)
      ]

      const results = await Promise.all(operations)

      // All operations should complete
      expect(results.length).toBe(5)
      // Final state should be consistent
      const finalLocation = await objectIndex.lookupLocation(sha)
      expect(finalLocation!.tier).toBe('r2')
    })

    it('should handle concurrent batch lookups', async () => {
      // Create initial data
      const shas: string[] = []
      for (let i = 0; i < 50; i++) {
        const sha = createTestSha(`batch-concurrent-${i}`)
        shas.push(sha)
        await objectIndex.recordLocation({ sha, tier: 'hot', size: 100 })
      }

      // Perform concurrent batch lookups
      const batchLookups = [
        objectIndex.batchLookup(shas.slice(0, 25)),
        objectIndex.batchLookup(shas.slice(25, 50)),
        objectIndex.batchLookup(shas)
      ]

      const results = await Promise.all(batchLookups)

      expect(results[0].found.size).toBe(25)
      expect(results[1].found.size).toBe(25)
      expect(results[2].found.size).toBe(50)
    })

    it('should handle rapid sequential operations on same object', async () => {
      const sha = createTestSha('rapid')

      // Rapidly change location back and forth
      for (let i = 0; i < 10; i++) {
        await objectIndex.recordLocation({ sha, tier: 'hot', size: 100 + i })
        await objectIndex.updateLocation(sha, 'r2', `pack-${i}`, i * 100)
        await objectIndex.updateLocation(sha, 'hot')
      }

      // Final state should be hot tier
      const location = await objectIndex.lookupLocation(sha)
      expect(location!.tier).toBe('hot')
      expect(location!.packId).toBeNull()
    })

    it('should handle concurrent deletes and reads', async () => {
      const sha = createTestSha('delete-race')
      await objectIndex.recordLocation({ sha, tier: 'hot', size: 100 })

      // Start delete and reads concurrently
      const deleteOp = objectIndex.deleteLocation(sha)
      const readOp1 = objectIndex.lookupLocation(sha)
      const readOp2 = objectIndex.exists(sha)

      await Promise.all([deleteOp, readOp1, readOp2])

      // After all operations, object should be deleted
      const finalLocation = await objectIndex.lookupLocation(sha)
      expect(finalLocation).toBeNull()
    })
  })

  describe('Edge Cases', () => {
    it('should handle object with maximum size value', async () => {
      const sha = createTestSha('maxsize')
      const maxSize = Number.MAX_SAFE_INTEGER

      await objectIndex.recordLocation({ sha, tier: 'hot', size: maxSize })

      const location = await objectIndex.lookupLocation(sha)
      expect(location!.size).toBe(maxSize)
    })

    it('should handle object with zero size', async () => {
      const sha = createTestSha('zerosize')

      await objectIndex.recordLocation({ sha, tier: 'hot', size: 0 })

      const location = await objectIndex.lookupLocation(sha)
      expect(location!.size).toBe(0)
    })

    it('should handle very long pack IDs', async () => {
      const sha = createTestSha('longpack')
      const longPackId = 'pack-' + 'a'.repeat(200)

      await objectIndex.recordLocation({
        sha,
        tier: 'r2',
        packId: longPackId,
        offset: 0,
        size: 100
      })

      const location = await objectIndex.lookupLocation(sha)
      expect(location!.packId).toBe(longPackId)
    })

    it('should validate SHA format', async () => {
      const invalidShas = ['short', 'x'.repeat(40), '123', '']

      for (const sha of invalidShas) {
        await expect(
          objectIndex.recordLocation({ sha, tier: 'hot', size: 100 })
        ).rejects.toThrow(/sha|invalid/i)
      }
    })

    it('should handle special characters in pack ID', async () => {
      const sha = createTestSha('specialpack')
      const packId = 'pack/with:special-chars_and.dots'

      await objectIndex.recordLocation({
        sha,
        tier: 'r2',
        packId,
        offset: 0,
        size: 100
      })

      const location = await objectIndex.lookupLocation(sha)
      expect(location!.packId).toBe(packId)
    })
  })
})

describe('Standalone Functions', () => {
  let storage: MockObjectStorage

  beforeEach(() => {
    storage = new MockObjectStorage()
  })

  describe('recordLocation', () => {
    it('should record location using standalone function', async () => {
      await recordLocation(storage, {
        sha: createTestSha('standalone1'),
        tier: 'hot',
        size: 100
      })

      const location = await lookupLocation(storage, createTestSha('standalone1'))
      expect(location).not.toBeNull()
      expect(location!.tier).toBe('hot')
    })
  })

  describe('lookupLocation', () => {
    it('should lookup location using standalone function', async () => {
      await recordLocation(storage, {
        sha: createTestSha('standalone2'),
        tier: 'r2',
        packId: 'pack-standalone',
        offset: 999,
        size: 200
      })

      const location = await lookupLocation(storage, createTestSha('standalone2'))

      expect(location).not.toBeNull()
      expect(location!.packId).toBe('pack-standalone')
      expect(location!.offset).toBe(999)
    })

    it('should return null for non-existent object', async () => {
      const location = await lookupLocation(storage, createTestSha('nonexistent'))

      expect(location).toBeNull()
    })
  })

  describe('batchLookup', () => {
    it('should perform batch lookup using standalone function', async () => {
      await recordLocation(storage, { sha: createTestSha('b1'), tier: 'hot', size: 100 })
      await recordLocation(storage, { sha: createTestSha('b2'), tier: 'hot', size: 200 })

      const result = await batchLookup(storage, [
        createTestSha('b1'),
        createTestSha('b2'),
        createTestSha('b3')
      ])

      expect(result.found.size).toBe(2)
      expect(result.missing).toContain(createTestSha('b3'))
    })
  })

  describe('getStats', () => {
    it('should get stats using standalone function', async () => {
      await recordLocation(storage, { sha: createTestSha('gs1'), tier: 'hot', size: 100 })
      await recordLocation(storage, { sha: createTestSha('gs2'), tier: 'r2', packId: 'p', offset: 0, size: 200 })

      const stats = await getStats(storage)

      expect(stats.totalObjects).toBe(2)
      expect(stats.hotCount).toBe(1)
      expect(stats.r2Count).toBe(1)
    })
  })
})
