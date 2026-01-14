import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TierMigrator,
  MigrationJob,
  MigrationState,
  MigrationPolicy,
  MigrationError,
  AccessPattern,
  AccessTracker,
  MigrationResult,
  MigrationRollback,
  ConcurrentAccessHandler
} from '../../src/tiered/migration'
import { StorageTier, ObjectLocation } from '../../src/storage/object-index'

// Sample SHA-1 hashes for testing
const sampleSha = 'a'.repeat(40)
const sampleSha2 = 'b'.repeat(40)
const sampleSha3 = 'c'.repeat(40)
const sampleSha4 = 'd'.repeat(40)
const sampleSha5 = 'e'.repeat(40)

// Helper to create test objects
const createTestObject = (sha: string, size: number = 1024): ObjectLocation => ({
  sha,
  tier: 'hot' as StorageTier,
  packId: null,
  offset: null,
  size,
  type: 'blob',
  updatedAt: Date.now()
})

/**
 * Mock storage backend for testing tier migration
 */
function createMockTierStorage() {
  const hotObjects = new Map<string, { data: Uint8Array; accessedAt: number; createdAt: number }>()
  const warmObjects = new Map<string, { packId: string; offset: number; data: Uint8Array }>()
  const objectIndex = new Map<string, ObjectLocation>()
  const accessLog: Array<{ sha: string; timestamp: number; type: 'read' | 'write' }> = []
  const locks = new Set<string>()

  return {
    hotObjects,
    warmObjects,
    objectIndex,
    accessLog,
    locks,

    async getFromHot(sha: string): Promise<Uint8Array | null> {
      const obj = hotObjects.get(sha)
      if (obj) {
        obj.accessedAt = Date.now()
        accessLog.push({ sha, timestamp: Date.now(), type: 'read' })
        return obj.data
      }
      return null
    },

    async putToHot(sha: string, data: Uint8Array): Promise<void> {
      hotObjects.set(sha, {
        data,
        accessedAt: Date.now(),
        createdAt: Date.now()
      })
      objectIndex.set(sha, {
        sha,
        tier: 'hot',
        packId: null,
        offset: null,
        size: data.length,
        type: 'blob',
        updatedAt: Date.now()
      })
    },

    async getFromWarm(sha: string): Promise<Uint8Array | null> {
      const obj = warmObjects.get(sha)
      if (obj) {
        accessLog.push({ sha, timestamp: Date.now(), type: 'read' })
        return obj.data
      }
      return null
    },

    async putToWarm(sha: string, packId: string, offset: number, data: Uint8Array): Promise<void> {
      warmObjects.set(sha, { packId, offset, data })
      objectIndex.set(sha, {
        sha,
        tier: 'r2',
        packId,
        offset,
        size: data.length,
        type: 'blob',
        updatedAt: Date.now()
      })
    },

    async deleteFromHot(sha: string): Promise<boolean> {
      return hotObjects.delete(sha)
    },

    async deleteFromWarm(sha: string): Promise<boolean> {
      return warmObjects.delete(sha)
    },

    async acquireLock(sha: string): Promise<boolean> {
      if (locks.has(sha)) return false
      locks.add(sha)
      return true
    },

    async releaseLock(sha: string): Promise<void> {
      locks.delete(sha)
    },

    async getLocation(sha: string): Promise<ObjectLocation | null> {
      return objectIndex.get(sha) ?? null
    },

    async updateLocation(sha: string, location: Partial<ObjectLocation>): Promise<void> {
      const existing = objectIndex.get(sha)
      if (existing) {
        objectIndex.set(sha, { ...existing, ...location, updatedAt: Date.now() })
      }
    },

    getAccessLog() {
      return [...accessLog]
    },

    clearAccessLog() {
      accessLog.length = 0
    }
  }
}

describe('Tier Migration (Hot -> Warm)', () => {
  let storage: ReturnType<typeof createMockTierStorage>
  let migrator: TierMigrator

  beforeEach(() => {
    storage = createMockTierStorage()
    migrator = new TierMigrator(storage)
  })

  describe('Migration Triggers', () => {
    describe('Age-based triggers', () => {
      it('should trigger migration for objects older than threshold', async () => {
        // Object last accessed 7 days ago should trigger migration if threshold is 5 days
        const policy: MigrationPolicy = {
          maxAgeInHot: 5 * 24 * 60 * 60 * 1000, // 5 days in ms
          minAccessCount: 0,
          maxHotSize: Infinity
        }

        await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))
        // Simulate object being 7 days old
        const obj = storage.hotObjects.get(sampleSha)!
        obj.accessedAt = Date.now() - (7 * 24 * 60 * 60 * 1000)

        const candidates = await migrator.findMigrationCandidates(policy)

        expect(candidates).toContain(sampleSha)
      })

      it('should not trigger migration for recently accessed objects', async () => {
        const policy: MigrationPolicy = {
          maxAgeInHot: 5 * 24 * 60 * 60 * 1000,
          minAccessCount: 0,
          maxHotSize: Infinity
        }

        await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))
        // Object was just accessed (default behavior)

        const candidates = await migrator.findMigrationCandidates(policy)

        expect(candidates).not.toContain(sampleSha)
      })

      it('should respect custom age thresholds', async () => {
        const policy: MigrationPolicy = {
          maxAgeInHot: 1 * 60 * 60 * 1000, // 1 hour
          minAccessCount: 0,
          maxHotSize: Infinity
        }

        await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))
        const obj = storage.hotObjects.get(sampleSha)!
        obj.accessedAt = Date.now() - (2 * 60 * 60 * 1000) // 2 hours ago

        const candidates = await migrator.findMigrationCandidates(policy)

        expect(candidates).toContain(sampleSha)
      })
    })

    describe('Access frequency triggers', () => {
      it('should trigger migration for infrequently accessed objects', async () => {
        const policy: MigrationPolicy = {
          maxAgeInHot: Infinity,
          minAccessCount: 10, // Objects accessed less than 10 times
          maxHotSize: Infinity
        }

        await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))
        // Only 2 accesses
        await storage.getFromHot(sampleSha)
        await storage.getFromHot(sampleSha)

        const candidates = await migrator.findMigrationCandidates(policy)

        expect(candidates).toContain(sampleSha)
      })

      it('should not trigger migration for frequently accessed objects', async () => {
        const policy: MigrationPolicy = {
          maxAgeInHot: Infinity,
          minAccessCount: 5,
          maxHotSize: Infinity
        }

        await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))
        // Access many times
        for (let i = 0; i < 10; i++) {
          await storage.getFromHot(sampleSha)
        }

        const candidates = await migrator.findMigrationCandidates(policy)

        expect(candidates).not.toContain(sampleSha)
      })
    })

    describe('Size-based triggers', () => {
      it('should trigger migration when hot tier exceeds size limit', async () => {
        const policy: MigrationPolicy = {
          maxAgeInHot: Infinity,
          minAccessCount: 0,
          maxHotSize: 100 // 100 bytes max
        }

        // Add objects totaling more than 100 bytes
        await storage.putToHot(sampleSha, new Uint8Array(50))
        await storage.putToHot(sampleSha2, new Uint8Array(50))
        await storage.putToHot(sampleSha3, new Uint8Array(50)) // Now exceeds 100 bytes

        const candidates = await migrator.findMigrationCandidates(policy)

        expect(candidates.length).toBeGreaterThan(0)
      })

      it('should prioritize oldest objects when size limit exceeded', async () => {
        const policy: MigrationPolicy = {
          maxAgeInHot: Infinity,
          minAccessCount: 0,
          maxHotSize: 100
        }

        // Add objects with different ages
        await storage.putToHot(sampleSha, new Uint8Array(50))
        storage.hotObjects.get(sampleSha)!.accessedAt = Date.now() - 3000 // oldest

        await storage.putToHot(sampleSha2, new Uint8Array(50))
        storage.hotObjects.get(sampleSha2)!.accessedAt = Date.now() - 1000

        await storage.putToHot(sampleSha3, new Uint8Array(50))
        // sampleSha3 is newest

        const candidates = await migrator.findMigrationCandidates(policy)

        // Oldest should be first candidate
        expect(candidates[0]).toBe(sampleSha)
      })
    })

    describe('Combined triggers', () => {
      it('should apply all policy criteria together', async () => {
        const policy: MigrationPolicy = {
          maxAgeInHot: 24 * 60 * 60 * 1000, // 1 day
          minAccessCount: 5,
          maxHotSize: 1000
        }

        // Object that meets age but not access criteria
        await storage.putToHot(sampleSha, new Uint8Array(10))
        storage.hotObjects.get(sampleSha)!.accessedAt = Date.now() - (2 * 24 * 60 * 60 * 1000)
        for (let i = 0; i < 10; i++) {
          await storage.getFromHot(sampleSha)
        }

        // Object that meets access but not age criteria
        await storage.putToHot(sampleSha2, new Uint8Array(10))
        // Recently accessed

        // Object that meets both criteria - should migrate
        await storage.putToHot(sampleSha3, new Uint8Array(10))
        storage.hotObjects.get(sampleSha3)!.accessedAt = Date.now() - (2 * 24 * 60 * 60 * 1000)
        // Low access count

        const candidates = await migrator.findMigrationCandidates(policy)

        expect(candidates).toContain(sampleSha3)
      })
    })
  })

  describe('Data Integrity During Migration', () => {
    it('should preserve object data during migration', async () => {
      const originalData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      await storage.putToHot(sampleSha, originalData)

      const result = await migrator.migrate(sampleSha, 'hot', 'r2')

      expect(result.success).toBe(true)
      const migratedData = await storage.getFromWarm(sampleSha)
      expect(migratedData).toEqual(originalData)
    })

    it('should preserve object SHA during migration', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      await migrator.migrate(sampleSha, 'hot', 'r2')

      const location = await storage.getLocation(sampleSha)
      expect(location?.sha).toBe(sampleSha)
    })

    it('should update object location after successful migration', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      await migrator.migrate(sampleSha, 'hot', 'r2')

      const location = await storage.getLocation(sampleSha)
      expect(location?.tier).toBe('r2')
      expect(location?.packId).toBeDefined()
    })

    it('should verify data checksum before completing migration', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      const result = await migrator.migrate(sampleSha, 'hot', 'r2', { verifyChecksum: true })

      expect(result.success).toBe(true)
      expect(result.checksumVerified).toBe(true)
    })

    it('should fail migration if checksum verification fails', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      // Simulate corruption during migration
      vi.spyOn(migrator, 'computeChecksum').mockImplementation(async (data: Uint8Array) => {
        // Return different checksum on second call (after copy)
        return 'corrupted'
      })

      const result = await migrator.migrate(sampleSha, 'hot', 'r2', { verifyChecksum: true })

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(MigrationError)
      expect(result.error?.code).toBe('CHECKSUM_MISMATCH')
    })

    it('should not delete from hot tier until warm tier write is confirmed', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      // Start migration
      const job = await migrator.startMigrationJob(sampleSha, 'hot', 'r2')

      // Check that hot tier still has the object
      expect(storage.hotObjects.has(sampleSha)).toBe(true)

      // Complete the migration
      await migrator.completeMigrationJob(job)

      // Now hot tier should be cleaned up
      expect(storage.hotObjects.has(sampleSha)).toBe(false)
    })

    it('should handle large objects without corruption', async () => {
      const largeData = new Uint8Array(10 * 1024 * 1024) // 10MB
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }
      await storage.putToHot(sampleSha, largeData)

      const result = await migrator.migrate(sampleSha, 'hot', 'r2')

      expect(result.success).toBe(true)
      const migratedData = await storage.getFromWarm(sampleSha)
      expect(migratedData).toEqual(largeData)
    })

    it('should preserve object metadata during migration', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))
      const originalLocation = await storage.getLocation(sampleSha)

      await migrator.migrate(sampleSha, 'hot', 'r2')

      const newLocation = await storage.getLocation(sampleSha)
      expect(newLocation?.type).toBe(originalLocation?.type)
      expect(newLocation?.size).toBe(originalLocation?.size)
    })
  })

  describe('Concurrent Access During Migration', () => {
    it('should handle read requests during migration', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3, 4, 5]))

      // Start migration but don't complete
      const job = migrator.startMigrationJob(sampleSha, 'hot', 'r2')

      // Concurrent read should still work
      const data = await migrator.readDuringMigration(sampleSha)

      expect(data).toBeDefined()
      expect(data?.length).toBe(5)
    })

    it('should queue write requests during migration', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      // Start migration
      const job = await migrator.startMigrationJob(sampleSha, 'hot', 'r2')

      // Write request during migration should be queued
      const writePromise = migrator.writeDuringMigration(sampleSha, new Uint8Array([4, 5, 6]))

      // Complete migration
      await migrator.completeMigrationJob(job)

      // Write should complete after migration
      await writePromise

      const location = await storage.getLocation(sampleSha)
      expect(location?.tier).toBe('r2')
    })

    it('should prevent duplicate migrations of the same object', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      // Start two migrations concurrently
      const migration1 = migrator.migrate(sampleSha, 'hot', 'r2')
      const migration2 = migrator.migrate(sampleSha, 'hot', 'r2')

      const [result1, result2] = await Promise.all([migration1, migration2])

      // One should succeed, one should fail or be skipped
      expect(
        (result1.success && !result2.success) ||
        (!result1.success && result2.success) ||
        (result1.success && result2.skipped)
      ).toBe(true)
    })

    it('should acquire lock before migration', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      const job = await migrator.startMigrationJob(sampleSha, 'hot', 'r2')

      expect(job.lockAcquired).toBe(true)
      expect(storage.locks.has(sampleSha)).toBe(true)
    })

    it('should release lock after migration completes', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      await migrator.migrate(sampleSha, 'hot', 'r2')

      expect(storage.locks.has(sampleSha)).toBe(false)
    })

    it('should release lock after migration fails', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      // Force failure by removing object mid-migration
      vi.spyOn(storage, 'putToWarm').mockRejectedValue(new Error('Storage failure'))

      try {
        await migrator.migrate(sampleSha, 'hot', 'r2')
      } catch (e) {
        // Expected to fail
      }

      expect(storage.locks.has(sampleSha)).toBe(false)
    })

    it('should handle multiple objects migrating concurrently', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1]))
      await storage.putToHot(sampleSha2, new Uint8Array([2]))
      await storage.putToHot(sampleSha3, new Uint8Array([3]))

      const results = await Promise.all([
        migrator.migrate(sampleSha, 'hot', 'r2'),
        migrator.migrate(sampleSha2, 'hot', 'r2'),
        migrator.migrate(sampleSha3, 'hot', 'r2')
      ])

      expect(results.every(r => r.success)).toBe(true)
    })

    it('should timeout if lock cannot be acquired', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      // Manually acquire lock to simulate contention
      storage.locks.add(sampleSha)

      const result = await migrator.migrate(sampleSha, 'hot', 'r2', {
        lockTimeout: 100 // 100ms timeout
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('LOCK_TIMEOUT')
    })
  })

  describe('Migration Rollback on Failure', () => {
    it('should rollback if warm tier write fails', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      vi.spyOn(storage, 'putToWarm').mockRejectedValue(new Error('Write failed'))

      const result = await migrator.migrate(sampleSha, 'hot', 'r2')

      expect(result.success).toBe(false)
      expect(result.rolledBack).toBe(true)
      // Object should still be in hot tier
      expect(storage.hotObjects.has(sampleSha)).toBe(true)
      const location = await storage.getLocation(sampleSha)
      expect(location?.tier).toBe('hot')
    })

    it('should rollback if location update fails', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      vi.spyOn(storage, 'updateLocation').mockRejectedValue(new Error('Update failed'))

      const result = await migrator.migrate(sampleSha, 'hot', 'r2')

      expect(result.success).toBe(false)
      expect(result.rolledBack).toBe(true)
      // Object should still be in hot tier
      expect(storage.hotObjects.has(sampleSha)).toBe(true)
      // Warm tier data should be cleaned up
      expect(storage.warmObjects.has(sampleSha)).toBe(false)
    })

    it('should restore original location after rollback', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))
      const originalLocation = await storage.getLocation(sampleSha)

      vi.spyOn(storage, 'putToWarm').mockRejectedValue(new Error('Write failed'))

      await migrator.migrate(sampleSha, 'hot', 'r2')

      const currentLocation = await storage.getLocation(sampleSha)
      expect(currentLocation?.tier).toBe(originalLocation?.tier)
    })

    it('should log rollback reason', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      vi.spyOn(storage, 'putToWarm').mockRejectedValue(new Error('Disk full'))

      const result = await migrator.migrate(sampleSha, 'hot', 'r2')

      expect(result.error?.message).toContain('Disk full')
      expect(result.rollbackReason).toBeDefined()
    })

    it('should handle partial migration cleanup', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      // Fail after writing to warm but before updating location
      let writeCount = 0
      vi.spyOn(storage, 'putToWarm').mockImplementation(async (...args) => {
        writeCount++
        if (writeCount === 1) {
          storage.warmObjects.set(args[0], {
            packId: args[1],
            offset: args[2],
            data: args[3]
          })
        }
        // Simulate a failure that occurs after data is written
        throw new Error('Network error after write')
      })

      const result = await migrator.migrate(sampleSha, 'hot', 'r2')

      expect(result.success).toBe(false)
      // Warm tier orphan should be cleaned up
      expect(storage.warmObjects.has(sampleSha)).toBe(false)
    })

    it('should not delete hot data if rollback fails', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      vi.spyOn(storage, 'putToWarm').mockRejectedValue(new Error('Write failed'))
      vi.spyOn(storage, 'deleteFromWarm').mockRejectedValue(new Error('Cleanup failed'))

      const result = await migrator.migrate(sampleSha, 'hot', 'r2')

      expect(result.success).toBe(false)
      // Hot data should be preserved even if cleanup fails
      expect(storage.hotObjects.has(sampleSha)).toBe(true)
    })

    it('should support explicit rollback of in-progress migration', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      const job = await migrator.startMigrationJob(sampleSha, 'hot', 'r2')

      await migrator.rollbackMigrationJob(job)

      expect(job.state).toBe('rolled_back')
      expect(storage.hotObjects.has(sampleSha)).toBe(true)
    })

    it('should record rollback history', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      vi.spyOn(storage, 'putToWarm').mockRejectedValue(new Error('Write failed'))

      await migrator.migrate(sampleSha, 'hot', 'r2')

      const history = await migrator.getMigrationHistory(sampleSha)
      expect(history.some(h => h.state === 'rolled_back')).toBe(true)
    })
  })

  describe('Access Pattern Tracking', () => {
    let tracker: AccessTracker

    beforeEach(() => {
      tracker = new AccessTracker(storage)
    })

    it('should track object read accesses', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      await tracker.recordAccess(sampleSha, 'read')
      await tracker.recordAccess(sampleSha, 'read')
      await tracker.recordAccess(sampleSha, 'read')

      const pattern = await tracker.getAccessPattern(sampleSha)

      expect(pattern.readCount).toBe(3)
    })

    it('should track object write accesses', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      await tracker.recordAccess(sampleSha, 'write')
      await tracker.recordAccess(sampleSha, 'write')

      const pattern = await tracker.getAccessPattern(sampleSha)

      expect(pattern.writeCount).toBe(2)
    })

    it('should track last access timestamp', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      const before = Date.now()
      await tracker.recordAccess(sampleSha, 'read')
      const after = Date.now()

      const pattern = await tracker.getAccessPattern(sampleSha)

      expect(pattern.lastAccessedAt).toBeGreaterThanOrEqual(before)
      expect(pattern.lastAccessedAt).toBeLessThanOrEqual(after)
    })

    it('should calculate access frequency', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      // Record accesses over time
      for (let i = 0; i < 10; i++) {
        await tracker.recordAccess(sampleSha, 'read')
      }

      const pattern = await tracker.getAccessPattern(sampleSha)

      expect(pattern.accessFrequency).toBeDefined()
      expect(pattern.accessFrequency).toBeGreaterThan(0)
    })

    it('should identify hot objects based on access patterns', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1]))
      await storage.putToHot(sampleSha2, new Uint8Array([2]))
      await storage.putToHot(sampleSha3, new Uint8Array([3]))

      // Make sampleSha very hot
      for (let i = 0; i < 100; i++) {
        await tracker.recordAccess(sampleSha, 'read')
      }
      // Make sampleSha2 moderately accessed
      for (let i = 0; i < 10; i++) {
        await tracker.recordAccess(sampleSha2, 'read')
      }
      // sampleSha3 has minimal access

      const hotObjects = await tracker.identifyHotObjects({ minAccessCount: 50 })

      expect(hotObjects).toContain(sampleSha)
      expect(hotObjects).not.toContain(sampleSha2)
      expect(hotObjects).not.toContain(sampleSha3)
    })

    it('should identify cold objects based on access patterns', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1]))
      await storage.putToHot(sampleSha2, new Uint8Array([2]))

      // sampleSha is frequently accessed
      for (let i = 0; i < 50; i++) {
        await tracker.recordAccess(sampleSha, 'read')
      }
      // sampleSha2 is rarely accessed

      const coldObjects = await tracker.identifyColdObjects({
        maxAccessCount: 5,
        minAgeMs: 0
      })

      expect(coldObjects).not.toContain(sampleSha)
      expect(coldObjects).toContain(sampleSha2)
    })

    it('should decay access counts over time', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1]))

      // Record many accesses
      for (let i = 0; i < 100; i++) {
        await tracker.recordAccess(sampleSha, 'read')
      }

      const patternBefore = await tracker.getAccessPattern(sampleSha)

      // Simulate time passing and apply decay
      await tracker.applyDecay({ decayFactor: 0.5, minAgeForDecayMs: 0 })

      const patternAfter = await tracker.getAccessPattern(sampleSha)

      expect(patternAfter.readCount).toBeLessThan(patternBefore.readCount)
    })

    it('should track access patterns across tiers', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      // Access in hot tier
      await tracker.recordAccess(sampleSha, 'read')
      await tracker.recordAccess(sampleSha, 'read')

      // Migrate to warm
      await migrator.migrate(sampleSha, 'hot', 'r2')

      // Access in warm tier
      await tracker.recordAccess(sampleSha, 'read')

      const pattern = await tracker.getAccessPattern(sampleSha)

      // Should track total accesses regardless of tier
      expect(pattern.readCount).toBe(3)
    })

    it('should support custom access metrics', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      await tracker.recordAccess(sampleSha, 'read', {
        bytesRead: 1024,
        latencyMs: 5
      })

      const pattern = await tracker.getAccessPattern(sampleSha)

      expect(pattern.totalBytesRead).toBe(1024)
      expect(pattern.avgLatencyMs).toBeDefined()
    })

    it('should aggregate access patterns for reporting', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1]))
      await storage.putToHot(sampleSha2, new Uint8Array([2]))

      await tracker.recordAccess(sampleSha, 'read')
      await tracker.recordAccess(sampleSha, 'read')
      await tracker.recordAccess(sampleSha2, 'read')

      const stats = await tracker.getAccessStats()

      expect(stats.totalReads).toBe(3)
      expect(stats.uniqueObjectsAccessed).toBe(2)
    })

    it('should persist access patterns across restarts', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1]))

      await tracker.recordAccess(sampleSha, 'read')
      await tracker.recordAccess(sampleSha, 'read')

      // Simulate restart by creating new tracker
      const newTracker = new AccessTracker(storage)
      await newTracker.loadFromStorage()

      const pattern = await newTracker.getAccessPattern(sampleSha)

      expect(pattern.readCount).toBe(2)
    })
  })

  describe('Migration Job Management', () => {
    it('should create a migration job with unique ID', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      const job = await migrator.startMigrationJob(sampleSha, 'hot', 'r2')

      expect(job.id).toBeDefined()
      expect(typeof job.id).toBe('string')
    })

    it('should track migration job state', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      const job = await migrator.startMigrationJob(sampleSha, 'hot', 'r2')
      expect(job.state).toBe('in_progress')

      await migrator.completeMigrationJob(job)
      expect(job.state).toBe('completed')
    })

    it('should track migration job progress', async () => {
      const largeData = new Uint8Array(1024 * 1024) // 1MB
      await storage.putToHot(sampleSha, largeData)

      const job = await migrator.startMigrationJob(sampleSha, 'hot', 'r2')

      expect(job.progress).toBeDefined()
      expect(job.progress.bytesTransferred).toBeGreaterThanOrEqual(0)
      expect(job.progress.totalBytes).toBe(1024 * 1024)
    })

    it('should list active migration jobs', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1]))
      await storage.putToHot(sampleSha2, new Uint8Array([2]))

      await migrator.startMigrationJob(sampleSha, 'hot', 'r2')
      await migrator.startMigrationJob(sampleSha2, 'hot', 'r2')

      const activeJobs = await migrator.getActiveMigrationJobs()

      expect(activeJobs.length).toBe(2)
    })

    it('should cancel a migration job', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      const job = await migrator.startMigrationJob(sampleSha, 'hot', 'r2')

      await migrator.cancelMigrationJob(job.id)

      expect(job.state).toBe('cancelled')
      expect(storage.hotObjects.has(sampleSha)).toBe(true)
    })

    it('should record migration timestamps', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      const before = Date.now()
      const job = await migrator.startMigrationJob(sampleSha, 'hot', 'r2')
      await migrator.completeMigrationJob(job)
      const after = Date.now()

      expect(job.startedAt).toBeGreaterThanOrEqual(before)
      expect(job.completedAt).toBeLessThanOrEqual(after)
      expect(job.completedAt).toBeGreaterThanOrEqual(job.startedAt)
    })
  })

  describe('Batch Migration', () => {
    it('should migrate multiple objects in a batch', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1]))
      await storage.putToHot(sampleSha2, new Uint8Array([2]))
      await storage.putToHot(sampleSha3, new Uint8Array([3]))

      const results = await migrator.migrateBatch(
        [sampleSha, sampleSha2, sampleSha3],
        'hot',
        'r2'
      )

      expect(results.successful.length).toBe(3)
      expect(results.failed.length).toBe(0)
    })

    it('should continue batch migration even if some objects fail', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1]))
      await storage.putToHot(sampleSha2, new Uint8Array([2]))
      await storage.putToHot(sampleSha3, new Uint8Array([3]))

      // Make sampleSha2 fail
      let callCount = 0
      const originalPutToWarm = storage.putToWarm.bind(storage)
      vi.spyOn(storage, 'putToWarm').mockImplementation(async (...args) => {
        callCount++
        if (args[0] === sampleSha2) {
          throw new Error('Simulated failure')
        }
        return originalPutToWarm(...args)
      })

      const results = await migrator.migrateBatch(
        [sampleSha, sampleSha2, sampleSha3],
        'hot',
        'r2'
      )

      expect(results.successful).toContain(sampleSha)
      expect(results.successful).toContain(sampleSha3)
      expect(results.failed).toContain(sampleSha2)
    })

    it('should respect concurrency limits in batch migration', async () => {
      for (const sha of [sampleSha, sampleSha2, sampleSha3, sampleSha4, sampleSha5]) {
        await storage.putToHot(sha, new Uint8Array([1]))
      }

      const concurrentCalls: number[] = []
      let currentConcurrency = 0

      const originalPutToWarm = storage.putToWarm.bind(storage)
      vi.spyOn(storage, 'putToWarm').mockImplementation(async (...args) => {
        currentConcurrency++
        concurrentCalls.push(currentConcurrency)
        await new Promise(r => setTimeout(r, 10)) // Simulate delay
        currentConcurrency--
        return originalPutToWarm(...args)
      })

      await migrator.migrateBatch(
        [sampleSha, sampleSha2, sampleSha3, sampleSha4, sampleSha5],
        'hot',
        'r2',
        { concurrency: 2 }
      )

      // Concurrency should never exceed 2
      expect(Math.max(...concurrentCalls)).toBeLessThanOrEqual(2)
    })
  })

  describe('Error Handling', () => {
    it('should throw MigrationError for non-existent object', async () => {
      await expect(
        migrator.migrate(sampleSha, 'hot', 'r2')
      ).rejects.toThrow(MigrationError)
    })

    it('should throw MigrationError for object already in target tier', async () => {
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))
      await migrator.migrate(sampleSha, 'hot', 'r2')

      await expect(
        migrator.migrate(sampleSha, 'hot', 'r2')
      ).rejects.toThrow(MigrationError)
    })

    it('should include error details in MigrationError', async () => {
      vi.spyOn(storage, 'putToWarm').mockRejectedValue(new Error('Disk full'))
      await storage.putToHot(sampleSha, new Uint8Array([1, 2, 3]))

      const result = await migrator.migrate(sampleSha, 'hot', 'r2')

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(MigrationError)
      expect(result.error?.sha).toBe(sampleSha)
      expect(result.error?.sourceTier).toBe('hot')
      expect(result.error?.targetTier).toBe('r2')
      expect(result.error?.cause?.message).toBe('Disk full')
    })
  })
})
