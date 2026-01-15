/**
 * L3 Iceberg Tier Integration Tests (RED Phase)
 *
 * Tests for Pipeline-as-WAL L3 tier that should FAIL until implemented.
 *
 * Architecture from storage/index.ts:
 *   L0: InMemoryStateManager - Fast O(1) CRUD with dirty tracking
 *   L1: PipelineEmitter (WAL) - Fire-and-forget event emission
 *   L2: LazyCheckpointer (SQLite) - Batched lazy persistence
 *   L3: IcebergWriter (Cold Storage) - Long-term storage with time travel
 *
 * Write Path: Client -> L0 -> L1 (ACK) -> lazy L2 -> eventual L3
 * Read Path: L0 (hit?) -> L2 (hit?) -> L3 (restore)
 *
 * @see https://github.com/dot-do/dotdo/issues/do-28e
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DOStorage,
  type DOStorageConfig,
  InMemoryStateManager,
  LazyCheckpointer,
  IcebergWriter,
  ColdStartRecovery,
  type ThingData,
} from '../../storage'

// ============================================================================
// Mock Implementations for Testing
// ============================================================================

/**
 * Mock R2 bucket that tracks all writes
 */
function createMockR2Bucket() {
  const storage = new Map<string, unknown>()

  return {
    storage,
    put: vi.fn(async (key: string, data: ArrayBuffer | string) => {
      storage.set(key, data)
      return { key, size: typeof data === 'string' ? data.length : (data as ArrayBuffer).byteLength }
    }),
    get: vi.fn(async (key: string) => {
      const data = storage.get(key)
      if (!data) return null
      return {
        key,
        size: 0,
        body: null as unknown as ReadableStream,
        arrayBuffer: async () => data as ArrayBuffer,
        text: async () => {
          if (typeof data === 'string') return data
          const decoder = new TextDecoder()
          return decoder.decode(data as ArrayBuffer)
        },
        json: async () => {
          const text = typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer)
          return JSON.parse(text)
        },
      }
    }),
    list: vi.fn(async (options?: { prefix?: string }) => {
      const objects: Array<{ key: string }> = []
      for (const key of storage.keys()) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          objects.push({ key })
        }
      }
      return { objects }
    }),
  }
}

/**
 * Mock SQL storage that tracks queries
 */
function createMockSqlStorage() {
  const tables = new Map<string, Map<string, unknown>>()
  tables.set('things', new Map())

  return {
    tables,
    exec: vi.fn((query: string, ...params: unknown[]) => {
      const things = tables.get('things')!

      if (query.includes('INSERT OR REPLACE')) {
        const [id, type, data] = params as [string, string, string]
        things.set(id, { id, type, data })
        return { toArray: () => [] }
      }

      if (query.includes('DELETE') && query.includes('WHERE id = ?')) {
        const [id] = params as [string]
        things.delete(id)
        return { toArray: () => [] }
      }

      if (query.includes('SELECT') && query.includes('WHERE id = ?')) {
        const [id] = params as [string]
        const row = things.get(id)
        return { toArray: () => (row ? [row] : []) }
      }

      if (query.includes('ORDER BY') && query.includes('LIMIT')) {
        const [limit] = params as [number]
        const all = Array.from(things.values())
        // Sort by id (string sort) and take first `limit` entries
        all.sort((a: any, b: any) => a.id.localeCompare(b.id))
        return { toArray: () => all.slice(0, limit) }
      }

      if (query.includes('SELECT') && !query.includes('WHERE')) {
        return { toArray: () => Array.from(things.values()) }
      }

      if (query.includes('COUNT')) {
        return { toArray: () => [{ count: things.size }] }
      }

      return { toArray: () => [] }
    }),
  }
}

/**
 * Mock Pipeline
 */
function createMockPipeline() {
  const events: unknown[] = []
  return {
    events,
    send: vi.fn(async (batch: unknown[]) => {
      events.push(...batch)
    }),
  }
}

// ============================================================================
// Test Suite: L3 Tier Promotion
// ============================================================================

describe('L3 Iceberg Tier Integration', () => {
  describe('Tier Promotion (L2 -> L3)', () => {
    /**
     * Test that data is promoted to L3 after SQLite reaches threshold
     *
     * Expected behavior: When L2 (SQLite) contains more than the configured
     * threshold of entries, older entries should be promoted to L3 (Iceberg)
     * and potentially removed from L2 to keep SQLite compact.
     */
    it('should promote data to L3 when L2 exceeds threshold', async () => {
      const mockR2 = createMockR2Bucket()
      const mockSql = createMockSqlStorage()
      const mockPipeline = createMockPipeline()

      const storage = new DOStorage({
        namespace: 'test-tier-promotion',
        env: {
          PIPELINE: mockPipeline,
          R2: mockR2 as any,
          sql: mockSql,
        },
        // Configure L2 threshold for promotion
        // This config option doesn't exist yet - it needs to be implemented
        l2PromotionThreshold: 100, // Promote to L3 when L2 has >100 entries
        l2MaxEntries: 1000, // Keep max 1000 entries in L2
      } as DOStorageConfig & { l2PromotionThreshold: number; l2MaxEntries: number })

      // Create enough entries to exceed the threshold
      for (let i = 0; i < 150; i++) {
        await storage.create({
          $type: 'TestEntity',
          name: `Entity ${i}`,
          createdAt: Date.now() - (150 - i) * 1000, // Older entries first
        })
      }

      // Trigger checkpoint to persist to L2
      await storage.beforeHibernation()

      // Wait for potential async L3 promotion
      await new Promise((resolve) => setTimeout(resolve, 100))

      // L3 should have received promoted data
      // This assertion will FAIL because promotion is not implemented
      expect(mockR2.put).toHaveBeenCalled()

      // Verify Iceberg received the older entries
      const icebergWrites = mockR2.storage
      expect(icebergWrites.size).toBeGreaterThan(0)

      // The promoted data should be in Iceberg format (partitioned by date)
      const keys = Array.from(icebergWrites.keys())
      const dataFiles = keys.filter((k) => k.includes('.parquet'))
      expect(dataFiles.length).toBeGreaterThan(0)

      await storage.close()
    })

    /**
     * Test that L3 promotion respects age-based policies
     *
     * Expected behavior: Entries older than a configured age should be
     * promoted to L3 regardless of L2 count.
     */
    it('should promote old data to L3 based on age policy', async () => {
      const mockR2 = createMockR2Bucket()
      const mockSql = createMockSqlStorage()

      const storage = new DOStorage({
        namespace: 'test-age-promotion',
        env: {
          R2: mockR2 as any,
          sql: mockSql,
        },
        // Age-based promotion policy - not yet implemented
        l3AgeThresholdMs: 24 * 60 * 60 * 1000, // 24 hours
      } as DOStorageConfig & { l3AgeThresholdMs: number })

      // Create an entry with old timestamp
      const oldEntry = await storage.create({
        $type: 'OldEntity',
        name: 'Ancient Data',
        $createdAt: Date.now() - 48 * 60 * 60 * 1000, // 48 hours old
      })

      // Trigger promotion check
      await storage.beforeHibernation()

      // Old data should be in L3
      // This will FAIL because age-based promotion is not implemented
      expect(mockR2.put).toHaveBeenCalled()

      await storage.close()
    })

    /**
     * Test that L2 entries are cleaned up after L3 promotion
     *
     * Expected behavior: After successful promotion to L3, the promoted
     * entries should be removed from L2 (SQLite) to keep it compact.
     */
    it('should clean L2 after successful L3 promotion', async () => {
      const mockR2 = createMockR2Bucket()
      const mockSql = createMockSqlStorage()

      const storage = new DOStorage({
        namespace: 'test-l2-cleanup',
        env: {
          R2: mockR2 as any,
          sql: mockSql,
        },
        l2PromotionThreshold: 50,
        l2MaxEntries: 100,
      } as DOStorageConfig & { l2PromotionThreshold: number; l2MaxEntries: number })

      // Fill L2 beyond threshold
      for (let i = 0; i < 120; i++) {
        await storage.create({ $type: 'TestEntity', name: `Entity ${i}` })
      }

      await storage.beforeHibernation()
      await new Promise((resolve) => setTimeout(resolve, 100))

      // After promotion, L2 should be trimmed
      // This will FAIL because cleanup is not implemented
      const l2Count = mockSql.tables.get('things')!.size
      expect(l2Count).toBeLessThanOrEqual(100) // Should be within max

      await storage.close()
    })
  })

  // ============================================================================
  // Test Suite: L3 Data Retrieval
  // ============================================================================

  describe('L3 Data Retrieval (Cold Data)', () => {
    /**
     * Test that cold data can be retrieved from L3 when not in L0/L2
     *
     * Expected behavior: When data is not found in L0 (memory) or L2 (SQLite),
     * the system should fall back to L3 (Iceberg) to retrieve cold data.
     */
    it('should retrieve cold data from L3 on cache miss', async () => {
      const mockR2 = createMockR2Bucket()
      const mockSql = createMockSqlStorage()

      // Pre-populate L3 with cold data
      const coldEntity: ThingData = {
        $id: 'customer_cold123',
        $type: 'Customer',
        $version: 5,
        name: 'Cold Customer',
        email: 'cold@example.com',
      }

      // Store in Iceberg format
      const events = [
        {
          type: 'thing.created',
          entityId: coldEntity.$id,
          payload: coldEntity,
          ts: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
        },
      ]
      const parquetData = JSON.stringify(events)
      await mockR2.put(
        `events/ns=test-cold-retrieval/date=2025-01-08/data-abc123.parquet`,
        parquetData
      )

      const storage = new DOStorage({
        namespace: 'test-cold-retrieval',
        env: {
          R2: mockR2 as any,
          sql: mockSql,
        },
      })

      // Try to get cold data - not in L0 or L2
      const result = await storage.getWithFullFallback('customer_cold123')

      // This will FAIL because L3 retrieval is not properly implemented
      expect(result).not.toBeNull()
      expect(result?.$id).toBe('customer_cold123')
      expect(result?.name).toBe('Cold Customer')

      await storage.close()
    })

    /**
     * Test that L3 retrieval uses time travel queries
     *
     * Expected behavior: The system should support querying L3 data as of
     * a specific point in time (time travel / snapshot queries).
     */
    it('should support time travel queries to L3', async () => {
      const mockR2 = createMockR2Bucket()

      const iceberg = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'test-time-travel',
        tableName: 'events',
      })

      // Write multiple versions of an entity at different times
      const entityId = 'entity_tt1'

      await iceberg.write([
        { type: 'thing.created', entityId, payload: { name: 'V1' }, ts: Date.now() - 3 * 24 * 60 * 60 * 1000 },
      ])

      await iceberg.write([
        { type: 'thing.updated', entityId, payload: { name: 'V2' }, ts: Date.now() - 2 * 24 * 60 * 60 * 1000 },
      ])

      await iceberg.write([
        { type: 'thing.updated', entityId, payload: { name: 'V3' }, ts: Date.now() - 1 * 24 * 60 * 60 * 1000 },
      ])

      // Query as of 2 days ago - should return V1
      const asOf2DaysAgo = new Date(Date.now() - 2.5 * 24 * 60 * 60 * 1000)
      const result = await iceberg.query({ asOf: asOf2DaysAgo, entityId })

      // This will FAIL because time travel queries return empty array
      expect(result.length).toBeGreaterThan(0)

      // Reconstruct state as of that time
      const state = result.reduce(
        (acc, event) => {
          if (event.type === 'thing.created') return event.payload as ThingData
          if (event.type === 'thing.updated') return { ...acc, ...event.payload }
          return acc
        },
        {} as ThingData
      )

      expect(state.name).toBe('V1')

      await iceberg.close()
    })

    /**
     * Test that L3 data is hydrated back to L0 after retrieval
     *
     * Expected behavior: When cold data is retrieved from L3, it should
     * be loaded into L0 (memory cache) for faster subsequent access.
     */
    it('should hydrate L0 cache after L3 retrieval', async () => {
      const mockR2 = createMockR2Bucket()
      const mockSql = createMockSqlStorage()

      // Pre-populate L3
      const coldEntity = {
        $id: 'customer_hydrate',
        $type: 'Customer',
        name: 'Hydration Test',
      }

      // Mock the R2 get to return data in expected format
      mockR2.get.mockImplementation(async (key: string) => {
        if (key.includes('customer_hydrate')) {
          return {
            events: [{ type: 'thing.created', entityId: coldEntity.$id, payload: coldEntity, ts: Date.now() }],
          }
        }
        return null
      })

      const storage = new DOStorage({
        namespace: 'test-hydration',
        env: {
          R2: mockR2 as any,
          sql: mockSql,
        },
      })

      // First access - cold miss, should fetch from L3
      const firstAccess = await storage.getWithFullFallback('customer_hydrate')

      // Second access - should hit L0 cache (no R2 call)
      const callCountBefore = mockR2.get.mock.calls.length
      const secondAccess = storage.get('customer_hydrate')
      const callCountAfter = mockR2.get.mock.calls.length

      // This will FAIL because hydration doesn't work properly
      expect(firstAccess).not.toBeNull()
      expect(secondAccess).not.toBeNull()
      expect(callCountAfter).toBe(callCountBefore) // No additional R2 calls

      await storage.close()
    })
  })

  // ============================================================================
  // Test Suite: Iceberg Format Compliance
  // ============================================================================

  describe('Iceberg Format Compliance', () => {
    /**
     * Test that L3 storage uses proper Iceberg table structure
     *
     * Expected behavior: Data written to L3 should follow Iceberg table
     * format with proper metadata, manifests, and data files.
     */
    it('should write data in Iceberg table format', async () => {
      const mockR2 = createMockR2Bucket()

      const iceberg = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'test-format',
        tableName: 'events',
      })

      await iceberg.write([
        { type: 'thing.created', entityId: 'e1', payload: { name: 'Test' }, ts: Date.now() },
      ])

      // Check for Iceberg table structure
      const keys = Array.from(mockR2.storage.keys())

      // Should have data files
      const dataFiles = keys.filter((k) => k.endsWith('.parquet'))
      expect(dataFiles.length).toBeGreaterThan(0)

      // Should have proper partitioning (ns=, date=)
      // This will FAIL if partitioning is not properly implemented
      const partitionedFile = dataFiles.find(
        (k) => k.includes('ns=test-format') && k.includes('date=')
      )
      expect(partitionedFile).toBeDefined()

      // Should have metadata files (manifest, snapshot)
      // This will FAIL because metadata files are not written
      const metadataFiles = keys.filter((k) => k.includes('metadata/'))
      expect(metadataFiles.length).toBeGreaterThan(0)

      await iceberg.close()
    })

    /**
     * Test that snapshots are created after each write
     *
     * Expected behavior: Each write operation should create a new snapshot
     * to support time travel queries.
     */
    it('should create snapshots for time travel support', async () => {
      const mockR2 = createMockR2Bucket()

      const iceberg = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'test-snapshots',
        tableName: 'events',
      })

      // Write multiple batches
      await iceberg.write([{ type: 'thing.created', entityId: 'e1', payload: {}, ts: Date.now() }])
      await iceberg.write([{ type: 'thing.created', entityId: 'e2', payload: {}, ts: Date.now() }])
      await iceberg.write([{ type: 'thing.created', entityId: 'e3', payload: {}, ts: Date.now() }])

      const snapshots = await iceberg.listSnapshots()

      // Should have 3 snapshots
      expect(snapshots.length).toBe(3)

      // Each snapshot should have unique ID
      const snapshotIds = new Set(snapshots.map((s) => s.snapshotId))
      expect(snapshotIds.size).toBe(3)

      // Snapshots should be ordered by time
      for (let i = 1; i < snapshots.length; i++) {
        expect(snapshots[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          snapshots[i - 1].timestamp.getTime()
        )
      }

      await iceberg.close()
    })

    /**
     * Test schema evolution support
     *
     * Expected behavior: The Iceberg schema should evolve as new fields
     * are added, maintaining backward compatibility.
     */
    it('should support schema evolution', async () => {
      const mockR2 = createMockR2Bucket()

      const iceberg = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'test-schema-evolution',
        tableName: 'events',
      })

      // Write with initial schema
      await iceberg.write([
        { type: 'thing.created', entityId: 'e1', payload: { name: 'Test' }, ts: Date.now() },
      ])

      const schemaV1 = await iceberg.getSchema()
      const v1FieldCount = schemaV1.fields.length

      // Write with additional fields
      await iceberg.write([
        {
          type: 'thing.created',
          entityId: 'e2',
          payload: { name: 'Test2', email: 'test@example.com', age: 25 },
          ts: Date.now(),
        },
      ])

      const schemaV2 = await iceberg.getSchema()

      // Schema should have evolved to include new fields
      expect(schemaV2.version).toBeGreaterThan(schemaV1.version)
      expect(schemaV2.fields.length).toBeGreaterThan(v1FieldCount)

      // New fields should be present
      const fieldNames = schemaV2.fields.map((f) => f.name)
      expect(fieldNames).toContain('payload.email')
      expect(fieldNames).toContain('payload.age')

      await iceberg.close()
    })
  })

  // ============================================================================
  // Test Suite: Tier Interface Consistency
  // ============================================================================

  describe('Tier Interface Consistency', () => {
    /**
     * Test that all tiers implement a consistent storage interface
     *
     * Expected behavior: L0, L2, and L3 should share a common interface
     * that allows the coordinator to treat them uniformly.
     */
    it('should have consistent CRUD interface across tiers', async () => {
      // L0: InMemoryStateManager
      const l0 = new InMemoryStateManager()

      // L3: IcebergWriter
      const mockR2 = createMockR2Bucket()
      const l3 = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'test-interface',
        tableName: 'events',
      })

      // Both should support the same basic operations
      // This tests interface consistency

      // Create operation
      const entity = { $type: 'Test', $id: 'test_1', name: 'Interface Test' }

      // L0 create
      const l0Result = l0.create(entity)
      expect(l0Result.$id).toBe('test_1')

      // L3 should also support a create-like operation
      // This will FAIL because IcebergWriter doesn't have a create() method
      // that matches InMemoryStateManager's interface
      expect(typeof (l3 as any).create).toBe('function')

      // Get operation
      const l0Get = l0.get('test_1')
      expect(l0Get).not.toBeNull()

      // L3 should support get with consistent signature
      // This will FAIL because IcebergWriter uses query() not get()
      expect(typeof (l3 as any).get).toBe('function')

      await l3.close()
    })

    /**
     * Test that tier stats are available and consistent
     *
     * Expected behavior: Each tier should report stats in a consistent
     * format for monitoring and debugging.
     */
    it('should report consistent stats across tiers', async () => {
      const l0 = new InMemoryStateManager()
      const mockR2 = createMockR2Bucket()
      const l3 = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'test-stats',
        tableName: 'events',
      })

      // L0 stats
      l0.create({ $type: 'Test', name: 'Stats Test' })
      const l0Stats = l0.getStats()

      expect(l0Stats).toHaveProperty('entryCount')
      expect(l0Stats).toHaveProperty('estimatedBytes')

      // L3 should have compatible stats
      // This will FAIL because IcebergWriter doesn't have getStats()
      expect(typeof (l3 as any).getStats).toBe('function')

      const l3Stats = (l3 as any).getStats?.()
      if (l3Stats) {
        expect(l3Stats).toHaveProperty('entryCount')
        expect(l3Stats).toHaveProperty('estimatedBytes')
      }

      await l3.close()
    })

    /**
     * Test unified tier health check
     *
     * Expected behavior: DOStorage should provide a health check that
     * reports the status of all tiers.
     */
    it('should provide unified health check across all tiers', async () => {
      const mockR2 = createMockR2Bucket()
      const mockSql = createMockSqlStorage()
      const mockPipeline = createMockPipeline()

      const storage = new DOStorage({
        namespace: 'test-health',
        env: {
          PIPELINE: mockPipeline,
          R2: mockR2 as any,
          sql: mockSql,
        },
      })

      // Health check should report all tier statuses
      // This will FAIL because healthCheck() doesn't exist
      expect(typeof (storage as any).healthCheck).toBe('function')

      const health = await (storage as any).healthCheck?.()
      if (health) {
        expect(health).toHaveProperty('l0') // InMemory
        expect(health).toHaveProperty('l1') // Pipeline
        expect(health).toHaveProperty('l2') // SQLite
        expect(health).toHaveProperty('l3') // Iceberg

        expect(health.l0.status).toBe('healthy')
        expect(health.l3.status).toBe('healthy')
      }

      await storage.close()
    })
  })

  // ============================================================================
  // Test Suite: Cold Start Recovery with L3
  // ============================================================================

  describe('Cold Start Recovery with L3', () => {
    /**
     * Test that cold start recovery falls back to L3 when L2 is empty
     *
     * Expected behavior: When SQLite (L2) is empty, recovery should
     * reconstruct state from Iceberg (L3) events.
     */
    it('should recover from L3 when L2 is empty', async () => {
      const mockSql = createMockSqlStorage()
      // L2 is empty - no data in SQLite

      // L3 has historical data
      const mockIceberg = {
        query: vi.fn(async () => [
          {
            type: 'thing.created',
            entityId: 'customer_recovered',
            payload: { $id: 'customer_recovered', $type: 'Customer', name: 'Recovered' },
            ts: Date.now() - 7 * 24 * 60 * 60 * 1000,
          },
          {
            type: 'thing.updated',
            entityId: 'customer_recovered',
            payload: { name: 'Updated Recovered' },
            ts: Date.now() - 6 * 24 * 60 * 60 * 1000,
          },
        ]),
      }

      const recovery = new ColdStartRecovery({
        sql: mockSql,
        iceberg: mockIceberg,
        namespace: 'test-l3-recovery',
      })

      const result = await recovery.recover()

      // Should have recovered from L3
      expect(result.source).toBe('iceberg')
      expect(result.thingsLoaded).toBe(1)

      // State should be reconstructed correctly
      const recovered = result.state.get('customer_recovered')
      expect(recovered).not.toBeUndefined()
      expect(recovered?.name).toBe('Updated Recovered')
    })

    /**
     * Test that L3 recovery handles large event sets efficiently
     *
     * Expected behavior: Recovery from L3 should handle millions of events
     * by streaming and applying them incrementally.
     */
    it('should handle large L3 event sets during recovery', async () => {
      const mockSql = createMockSqlStorage()

      // Generate large event set
      const largeEventSet = Array.from({ length: 10000 }, (_, i) => ({
        type: i % 10 === 0 ? 'thing.created' : 'thing.updated',
        entityId: `entity_${Math.floor(i / 10)}`,
        payload: { $id: `entity_${Math.floor(i / 10)}`, $type: 'Test', counter: i },
        ts: Date.now() - (10000 - i) * 1000,
      }))

      const mockIceberg = {
        query: vi.fn(async () => largeEventSet),
      }

      const recovery = new ColdStartRecovery({
        sql: mockSql,
        iceberg: mockIceberg,
        namespace: 'test-large-recovery',
      })

      const startTime = Date.now()
      const result = await recovery.recover()
      const duration = Date.now() - startTime

      // Should complete in reasonable time (< 5 seconds for 10k events)
      expect(duration).toBeLessThan(5000)

      // Should have reconstructed correct number of entities
      expect(result.thingsLoaded).toBe(1000) // 10000 events / 10 per entity
      expect(result.eventsReplayed).toBe(10000)
    })

    /**
     * Test that recovery prioritizes more recent L3 snapshots
     *
     * Expected behavior: When multiple snapshots exist, recovery should
     * use the most recent snapshot as the base state.
     */
    it('should use most recent L3 snapshot for recovery', async () => {
      const mockSql = createMockSqlStorage()

      const mockIceberg = {
        query: vi.fn(async (options?: { snapshotId?: string }) => {
          // If specific snapshot requested, return events up to that point
          if (options?.snapshotId === 'snap-1') {
            return [
              { type: 'thing.created', entityId: 'e1', payload: { name: 'V1' }, ts: 1000 },
            ]
          }
          // Otherwise return all events (most recent state)
          return [
            { type: 'thing.created', entityId: 'e1', payload: { name: 'V1' }, ts: 1000 },
            { type: 'thing.updated', entityId: 'e1', payload: { name: 'V3' }, ts: 3000 },
          ]
        }),
        listSnapshots: vi.fn(async () => [
          { snapshotId: 'snap-1', timestamp: new Date(1000) },
          { snapshotId: 'snap-2', timestamp: new Date(2000) },
          { snapshotId: 'snap-3', timestamp: new Date(3000) },
        ]),
      }

      const recovery = new ColdStartRecovery({
        sql: mockSql,
        iceberg: mockIceberg,
        namespace: 'test-snapshot-recovery',
      })

      const result = await recovery.recover()

      // Should have the most recent state
      const entity = result.state.get('e1')
      expect(entity?.name).toBe('V3')
    })
  })
})

// ============================================================================
// Test Suite: StorageTier Interface
// ============================================================================

describe('StorageTier Interface', () => {
  /**
   * Test that a unified StorageTier interface exists
   *
   * Expected behavior: There should be a common interface that all tiers
   * implement, allowing polymorphic access to storage operations.
   */
  it('should define a common StorageTier interface', async () => {
    // This interface should exist in the exports
    // This will FAIL because StorageTier interface doesn't exist
    const storageModule = await import('../../storage')

    expect((storageModule as any).StorageTier).toBeDefined()

    // The interface should define these methods
    const tierInterface = (storageModule as any).StorageTier
    if (tierInterface) {
      // Type guard for the interface
      const implementsTier = (obj: unknown): obj is StorageTierLike => {
        return (
          typeof (obj as any).get === 'function' &&
          typeof (obj as any).put === 'function' &&
          typeof (obj as any).delete === 'function' &&
          typeof (obj as any).list === 'function'
        )
      }

      // All tier classes should implement this interface
      const l0 = new InMemoryStateManager()
      expect(implementsTier(l0)).toBe(true)
    }
  })
})

interface StorageTierLike {
  get(id: string): Promise<ThingData | null> | ThingData | null
  put(id: string, data: ThingData): Promise<void> | void
  delete(id: string): Promise<boolean> | boolean
  list(options?: { prefix?: string; limit?: number }): Promise<ThingData[]> | ThingData[]
}
