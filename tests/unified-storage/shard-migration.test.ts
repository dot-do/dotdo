/**
 * ShardMigration Tests - TDD RED Phase
 *
 * These tests define the expected behavior of ShardMigration which handles:
 * - Adding new shards to the cluster
 * - Removing shards from the cluster
 * - Rebalancing data across shards
 * - Event replay for data migration
 * - Zero-downtime migration operations
 *
 * ShardMigration ensures data integrity during shard topology changes.
 * It works with the ShardRouter and Iceberg to move entities between shards
 * via event replay.
 *
 * These tests WILL FAIL because the ShardMigration implementation does not exist yet.
 *
 * @see objects/unified-storage/shard-migration.ts (to be created in GREEN phase)
 * @issue do-2tr.3.4
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// This import will FAIL - the module doesn't exist yet
import {
  ShardMigration,
  type ShardMigrationConfig,
  type MigrationPlan,
  type MigrationProgress,
  type MigrationResult,
  type ShardInfo,
} from '../../objects/unified-storage/shard-migration'

// ============================================================================
// TYPE DEFINITIONS (Expected Interface)
// ============================================================================

/**
 * Entity stored in a shard
 */
interface Entity {
  $id: string
  $type: string
  $version: number
  partitionKey: string
  [key: string]: unknown
}

/**
 * Domain event for replay
 */
interface DomainEvent {
  type: 'thing.created' | 'thing.updated' | 'thing.deleted'
  entityId: string
  entityType: string
  partitionKey: string
  payload: Record<string, unknown>
  ts: number
  version: number
  shardId: string
}

// ============================================================================
// MOCK FACTORIES
// ============================================================================

/**
 * Create a mock Iceberg reader for event replay
 */
function createMockIceberg(events: DomainEvent[] = []) {
  return {
    getRecords: vi.fn(async (options: {
      table: string
      partition?: { shardId?: string; partitionKey?: string }
      orderBy?: string
      after?: number
    }) => {
      let filtered = [...events]

      // Filter by partition key if specified
      if (options.partition?.partitionKey) {
        filtered = filtered.filter(e => e.partitionKey === options.partition!.partitionKey)
      }

      // Filter by shard if specified
      if (options.partition?.shardId) {
        filtered = filtered.filter(e => e.shardId === options.partition!.shardId)
      }

      // Filter by timestamp if specified
      if (options.after !== undefined) {
        filtered = filtered.filter(e => e.ts > options.after!)
      }

      // Sort by timestamp
      if (options.orderBy === 'ts ASC') {
        filtered.sort((a, b) => a.ts - b.ts)
      }

      return filtered
    }),
    getPartitionKeys: vi.fn(async (shardId: string) => {
      const keys = new Set<string>()
      for (const event of events) {
        if (event.shardId === shardId) {
          keys.add(event.partitionKey)
        }
      }
      return Array.from(keys)
    }),
  }
}

/**
 * Create a mock shard (Durable Object stub)
 */
function createMockShard(id: string, entities: Map<string, Entity> = new Map()) {
  return {
    id,
    entities: new Map(entities),
    applyEvent: vi.fn(async (event: DomainEvent) => {
      if (event.type === 'thing.created' || event.type === 'thing.updated') {
        entities.set(event.entityId, {
          ...entities.get(event.entityId),
          ...event.payload,
          $id: event.entityId,
          $type: event.entityType,
          $version: event.version,
          partitionKey: event.partitionKey,
        } as Entity)
      } else if (event.type === 'thing.deleted') {
        entities.delete(event.entityId)
      }
    }),
    getEntity: vi.fn(async (id: string) => entities.get(id)),
    getEntityCount: vi.fn(async () => entities.size),
    getMemoryUsage: vi.fn(async () => {
      let bytes = 0
      for (const entity of entities.values()) {
        bytes += JSON.stringify(entity).length
      }
      return bytes
    }),
    drainConnections: vi.fn(async () => {
      // Simulate connection draining
      await new Promise(resolve => setTimeout(resolve, 10))
    }),
    acceptWrites: vi.fn(),
    rejectWrites: vi.fn(),
    isAcceptingWrites: vi.fn(() => true),
  }
}

type MockShard = ReturnType<typeof createMockShard>

/**
 * Create a mock shard router
 */
function createMockRouter(shards: Map<string, MockShard>) {
  let shardCount = shards.size

  return {
    getShardCount: vi.fn(() => shardCount),
    getShard: vi.fn((shardId: string) => shards.get(shardId)),
    getAllShards: vi.fn(() => Array.from(shards.values())),
    getShardForKey: vi.fn((partitionKey: string) => {
      // Simple hash-based routing
      const hash = partitionKey.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
      const shardIds = Array.from(shards.keys())
      return shards.get(shardIds[hash % shardIds.length])
    }),
    addShard: vi.fn((shard: MockShard) => {
      shards.set(shard.id, shard)
      shardCount++
    }),
    removeShard: vi.fn((shardId: string) => {
      const removed = shards.get(shardId)
      shards.delete(shardId)
      shardCount--
      return removed
    }),
    updateRouting: vi.fn(),
    getShardStats: vi.fn(async () => {
      const stats: Array<{ shardId: string; entityCount: number; memoryBytes: number }> = []
      for (const [id, shard] of shards) {
        stats.push({
          shardId: id,
          entityCount: await shard.getEntityCount(),
          memoryBytes: await shard.getMemoryUsage(),
        })
      }
      return stats
    }),
  }
}

type MockRouter = ReturnType<typeof createMockRouter>

/**
 * Create test events for a partition key
 */
function createTestEvents(
  partitionKey: string,
  shardId: string,
  count: number,
  baseTs: number = Date.now()
): DomainEvent[] {
  const events: DomainEvent[] = []
  for (let i = 0; i < count; i++) {
    events.push({
      type: 'thing.created',
      entityId: `entity_${partitionKey}_${i}`,
      entityType: 'TestEntity',
      partitionKey,
      payload: {
        $id: `entity_${partitionKey}_${i}`,
        $type: 'TestEntity',
        name: `Entity ${i}`,
        data: { index: i },
      },
      ts: baseTs + i * 100,
      version: 1,
      shardId,
    })
  }
  return events
}

/**
 * Create test entities for a shard
 */
function createTestEntities(partitionKey: string, count: number): Map<string, Entity> {
  const entities = new Map<string, Entity>()
  for (let i = 0; i < count; i++) {
    const id = `entity_${partitionKey}_${i}`
    entities.set(id, {
      $id: id,
      $type: 'TestEntity',
      $version: 1,
      partitionKey,
      name: `Entity ${i}`,
      data: { index: i },
    })
  }
  return entities
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('ShardMigration', () => {
  let migration: ShardMigration
  let mockRouter: MockRouter
  let mockIceberg: ReturnType<typeof createMockIceberg>
  let shards: Map<string, MockShard>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))

    // Setup initial 3-shard cluster
    shards = new Map([
      ['shard-0', createMockShard('shard-0', createTestEntities('pk-a', 10))],
      ['shard-1', createMockShard('shard-1', createTestEntities('pk-b', 10))],
      ['shard-2', createMockShard('shard-2', createTestEntities('pk-c', 10))],
    ])

    mockRouter = createMockRouter(shards)

    // Create events for all entities
    const allEvents = [
      ...createTestEvents('pk-a', 'shard-0', 10, Date.now() - 10000),
      ...createTestEvents('pk-b', 'shard-1', 10, Date.now() - 10000),
      ...createTestEvents('pk-c', 'shard-2', 10, Date.now() - 10000),
    ]
    mockIceberg = createMockIceberg(allEvents)
  })

  afterEach(async () => {
    if (migration) {
      await migration.close?.()
    }
    vi.useRealTimers()
  })

  // ==========================================================================
  // Adding Shards Tests
  // ==========================================================================

  describe('adding shards', () => {
    beforeEach(() => {
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })
    })

    it('should add new shard to cluster', async () => {
      // Given: A cluster with 3 shards
      expect(mockRouter.getShardCount()).toBe(3)

      // When: Adding a new shard
      const newShard = createMockShard('shard-3')
      const result = await migration.addShard(newShard as any)

      // Then: Cluster should have 4 shards
      expect(result.success).toBe(true)
      expect(mockRouter.addShard).toHaveBeenCalledWith(newShard)
      expect(mockRouter.getShardCount()).toBe(4)
    })

    it('should replay events to new shard', async () => {
      // Given: Entities that will be routed to the new shard
      const newShard = createMockShard('shard-3')

      // Mock router to route 'pk-a' to new shard after addition
      mockRouter.getShardForKey.mockImplementation((key: string) => {
        if (key === 'pk-a') return newShard
        return shards.get('shard-0')
      })

      // When: Adding the shard with rebalancing
      const result = await migration.addShard(newShard as any, {
        rebalance: true,
        partitionKeys: ['pk-a'], // Migrate these keys to new shard
      })

      // Then: Events should be replayed to new shard
      expect(result.success).toBe(true)
      expect(result.eventsReplayed).toBeGreaterThan(0)
      expect(newShard.applyEvent).toHaveBeenCalled()
    })

    it('should update routing after migration', async () => {
      // Given: A new shard to add
      const newShard = createMockShard('shard-3')

      // When: Adding the shard
      await migration.addShard(newShard as any, { rebalance: true })

      // Then: Router should be updated
      expect(mockRouter.updateRouting).toHaveBeenCalled()
    })

    it('should handle concurrent writes during migration', async () => {
      // Given: A migration in progress
      const newShard = createMockShard('shard-3')

      // Slow down event replay to simulate long migration
      mockIceberg.getRecords.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return createTestEvents('pk-a', 'shard-0', 10)
      })

      // When: Starting migration and simulating concurrent writes
      const migrationPromise = migration.addShard(newShard as any, {
        rebalance: true,
        partitionKeys: ['pk-a'],
      })

      // Simulate a write during migration
      const sourceShard = shards.get('shard-0')!
      const concurrentEvent: DomainEvent = {
        type: 'thing.created',
        entityId: 'concurrent_entity',
        entityType: 'TestEntity',
        partitionKey: 'pk-a',
        payload: { $id: 'concurrent_entity', name: 'Concurrent' },
        ts: Date.now() + 50,
        version: 1,
        shardId: 'shard-0',
      }

      // Buffer the concurrent write
      migration.bufferWrite(concurrentEvent)

      await vi.advanceTimersByTimeAsync(200)
      const result = await migrationPromise

      // Then: Concurrent writes should be preserved
      expect(result.success).toBe(true)
      expect(result.bufferedWrites).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // Removing Shards Tests
  // ==========================================================================

  describe('removing shards', () => {
    beforeEach(() => {
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })
    })

    it('should migrate data from removed shard', async () => {
      // Given: A shard to remove with data
      const shardToRemove = shards.get('shard-2')!
      const targetShard = shards.get('shard-0')!

      // Mock router to route migrated keys to shard-0
      mockRouter.getShardForKey.mockReturnValue(targetShard)

      // When: Removing the shard
      const result = await migration.removeShard('shard-2')

      // Then: Data should be migrated
      expect(result.success).toBe(true)
      expect(result.entitiesMigrated).toBeGreaterThan(0)
      expect(targetShard.applyEvent).toHaveBeenCalled()
    })

    it('should update routing to exclude removed shard', async () => {
      // Given: A shard to remove
      const targetShard = shards.get('shard-0')!
      mockRouter.getShardForKey.mockReturnValue(targetShard)

      // When: Removing the shard
      await migration.removeShard('shard-2')

      // Then: Router should be updated
      expect(mockRouter.removeShard).toHaveBeenCalledWith('shard-2')
      expect(mockRouter.updateRouting).toHaveBeenCalled()
    })

    it('should drain connections before removal', async () => {
      // Given: A shard with active connections
      const shardToRemove = shards.get('shard-2')!
      const targetShard = shards.get('shard-0')!
      mockRouter.getShardForKey.mockReturnValue(targetShard)

      // When: Removing the shard
      await migration.removeShard('shard-2')

      // Then: Connections should be drained first
      expect(shardToRemove.drainConnections).toHaveBeenCalled()
      // And writes should be rejected during drain
      expect(shardToRemove.rejectWrites).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Rebalancing Tests
  // ==========================================================================

  describe('rebalancing', () => {
    beforeEach(() => {
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })
    })

    it('should detect imbalanced shards', async () => {
      // Given: Shards with uneven entity distribution
      // shard-0: 100 entities, shard-1: 10 entities, shard-2: 10 entities
      const heavyShard = createMockShard('shard-0', createTestEntities('pk-heavy', 100))
      shards.set('shard-0', heavyShard)

      // When: Analyzing balance
      const analysis = await migration.analyzeBalance()

      // Then: Should detect imbalance
      expect(analysis.isBalanced).toBe(false)
      expect(analysis.imbalanceRatio).toBeGreaterThan(0.3) // > 30% difference
      expect(analysis.hotShards).toContain('shard-0')
    })

    it('should move entities between shards', async () => {
      // Given: An imbalanced cluster
      const heavyShard = createMockShard('shard-0', createTestEntities('pk-heavy', 50))
      const lightShard = createMockShard('shard-1', createTestEntities('pk-light', 5))
      shards.set('shard-0', heavyShard)
      shards.set('shard-1', lightShard)

      // Add events for the heavy shard
      const heavyEvents = createTestEvents('pk-heavy', 'shard-0', 50)
      mockIceberg = createMockIceberg(heavyEvents)
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })

      // When: Rebalancing with specific partition key movement
      const result = await migration.rebalance({
        partitionKeys: ['pk-heavy'],
        targetShards: ['shard-1'],
      })

      // Then: Entities should be moved
      expect(result.success).toBe(true)
      expect(result.entitiesMoved).toBeGreaterThan(0)
      expect(lightShard.applyEvent).toHaveBeenCalled()
    })

    it('should minimize data movement', async () => {
      // Given: A cluster needing rebalancing
      const heavyShard = createMockShard('shard-0', createTestEntities('pk-heavy', 100))
      shards.set('shard-0', heavyShard)

      const heavyEvents = createTestEvents('pk-heavy', 'shard-0', 100)
      mockIceberg = createMockIceberg(heavyEvents)
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })

      // When: Generating a rebalance plan
      const plan = await migration.generateRebalancePlan()

      // Then: Plan should minimize data movement
      expect(plan).toBeDefined()
      expect(plan.movements).toBeDefined()
      expect(plan.estimatedDataMoved).toBeLessThan(plan.totalData * 0.5) // < 50% of data moved
    })

    it('should track migration progress', async () => {
      // Given: A migration to track
      const progressUpdates: MigrationProgress[] = []

      const heavyEvents = createTestEvents('pk-a', 'shard-0', 50)
      mockIceberg = createMockIceberg(heavyEvents)

      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
        onProgress: (progress) => progressUpdates.push({ ...progress }),
      })

      // When: Running a rebalance
      await migration.rebalance({
        partitionKeys: ['pk-a'],
        targetShards: ['shard-1'],
      })

      // Then: Progress should be tracked
      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates[0].phase).toBeDefined()
      expect(progressUpdates[progressUpdates.length - 1].phase).toBe('complete')
    })
  })

  // ==========================================================================
  // Event Replay Tests
  // ==========================================================================

  describe('event replay', () => {
    beforeEach(() => {
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })
    })

    it('should replay from Iceberg to new shard', async () => {
      // Given: Events in Iceberg for a partition key
      const events = createTestEvents('pk-migrate', 'shard-0', 20)
      mockIceberg = createMockIceberg(events)
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })

      const targetShard = createMockShard('shard-target')

      // When: Replaying events
      const result = await migration.replayEvents({
        partitionKey: 'pk-migrate',
        targetShard: targetShard as any,
      })

      // Then: Events should be queried from Iceberg
      expect(mockIceberg.getRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'do_events',
          partition: expect.objectContaining({ partitionKey: 'pk-migrate' }),
          orderBy: 'ts ASC',
        })
      )

      // And: Applied to target shard
      expect(result.eventsReplayed).toBe(20)
      expect(targetShard.applyEvent).toHaveBeenCalledTimes(20)
    })

    it('should filter events by partition key', async () => {
      // Given: Events for multiple partition keys
      const events = [
        ...createTestEvents('pk-a', 'shard-0', 10),
        ...createTestEvents('pk-b', 'shard-0', 10),
        ...createTestEvents('pk-c', 'shard-0', 10),
      ]
      mockIceberg = createMockIceberg(events)
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })

      const targetShard = createMockShard('shard-target')

      // When: Replaying only pk-a events
      const result = await migration.replayEvents({
        partitionKey: 'pk-a',
        targetShard: targetShard as any,
      })

      // Then: Only pk-a events should be replayed
      expect(result.eventsReplayed).toBe(10)
      expect(targetShard.applyEvent).toHaveBeenCalledTimes(10)

      // Verify only pk-a events were applied
      const appliedEvents = (targetShard.applyEvent as ReturnType<typeof vi.fn>).mock.calls.map(
        call => call[0]
      )
      expect(appliedEvents.every((e: DomainEvent) => e.partitionKey === 'pk-a')).toBe(true)
    })

    it('should apply events in order', async () => {
      // Given: Events with different timestamps
      const now = Date.now()
      const events: DomainEvent[] = [
        { ...createTestEvents('pk-a', 'shard-0', 1, now + 300)[0], entityId: 'e1' },
        { ...createTestEvents('pk-a', 'shard-0', 1, now + 100)[0], entityId: 'e2' },
        { ...createTestEvents('pk-a', 'shard-0', 1, now + 200)[0], entityId: 'e3' },
      ]
      mockIceberg = createMockIceberg(events)
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })

      const targetShard = createMockShard('shard-target')
      const appliedOrder: string[] = []
      targetShard.applyEvent.mockImplementation(async (event: DomainEvent) => {
        appliedOrder.push(event.entityId)
      })

      // When: Replaying events
      await migration.replayEvents({
        partitionKey: 'pk-a',
        targetShard: targetShard as any,
      })

      // Then: Events should be applied in timestamp order
      expect(appliedOrder).toEqual(['e2', 'e3', 'e1']) // Sorted by ts: 100, 200, 300
    })

    it('should handle replay failures', async () => {
      // Given: Events to replay
      const events = createTestEvents('pk-a', 'shard-0', 10)
      mockIceberg = createMockIceberg(events)
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })

      // Target shard that fails on 5th event
      const targetShard = createMockShard('shard-target')
      let applyCount = 0
      targetShard.applyEvent.mockImplementation(async () => {
        applyCount++
        if (applyCount === 5) {
          throw new Error('Apply failed')
        }
      })

      // When: Replaying events
      const result = await migration.replayEvents({
        partitionKey: 'pk-a',
        targetShard: targetShard as any,
        onError: 'continue', // Continue on error
      })

      // Then: Should continue past failure
      expect(result.eventsReplayed).toBe(9) // 10 - 1 failed
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].eventIndex).toBe(4) // 0-indexed, 5th event
    })

    it('should support incremental replay with timestamp cursor', async () => {
      // Given: Events spanning a time range
      const now = Date.now()
      const events = createTestEvents('pk-a', 'shard-0', 10, now - 10000)
      mockIceberg = createMockIceberg(events)
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })

      const targetShard = createMockShard('shard-target')

      // When: Replaying from a specific timestamp
      const cursor = now - 5000 // Midpoint
      const result = await migration.replayEvents({
        partitionKey: 'pk-a',
        targetShard: targetShard as any,
        afterTimestamp: cursor,
      })

      // Then: Only events after cursor should be replayed
      expect(mockIceberg.getRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          after: cursor,
        })
      )
      expect(result.eventsReplayed).toBeLessThan(10)
    })
  })

  // ==========================================================================
  // Zero-Downtime Migration Tests
  // ==========================================================================

  describe('zero-downtime migration', () => {
    beforeEach(() => {
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })
    })

    it('should serve reads during migration', async () => {
      // Given: A migration in progress
      const newShard = createMockShard('shard-3')

      // Slow migration
      mockIceberg.getRecords.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 500))
        return createTestEvents('pk-a', 'shard-0', 10)
      })

      // Start migration (don't await)
      const migrationPromise = migration.addShard(newShard as any, {
        rebalance: true,
        partitionKeys: ['pk-a'],
      })

      // When: Reading from source shard during migration
      const sourceShard = shards.get('shard-0')!
      const readResult = await sourceShard.getEntity('entity_pk-a_0')

      // Then: Read should succeed
      expect(readResult).toBeDefined()
      expect(migration.isMigrating()).toBe(true)

      await vi.advanceTimersByTimeAsync(600)
      await migrationPromise
    })

    it('should buffer writes during cutover', async () => {
      // Given: A migration entering cutover phase
      const newShard = createMockShard('shard-3')
      const writeBuffer: DomainEvent[] = []

      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
        writeBuffer: {
          add: (event: DomainEvent) => writeBuffer.push(event),
          flush: async () => {
            const events = [...writeBuffer]
            writeBuffer.length = 0
            return events
          },
          size: () => writeBuffer.length,
        },
      })

      // When: Migration is in cutover phase
      const migrationPromise = migration.addShard(newShard as any, {
        rebalance: true,
        partitionKeys: ['pk-a'],
      })

      // Simulate writes during cutover
      const writeEvent: DomainEvent = {
        type: 'thing.created',
        entityId: 'buffered_1',
        entityType: 'TestEntity',
        partitionKey: 'pk-a',
        payload: { $id: 'buffered_1', name: 'Buffered' },
        ts: Date.now(),
        version: 1,
        shardId: 'shard-0',
      }

      await migration.bufferWrite(writeEvent)

      await vi.advanceTimersByTimeAsync(100)
      const result = await migrationPromise

      // Then: Writes should have been buffered
      expect(result.bufferedWrites).toBeGreaterThanOrEqual(1)
    })

    it('should complete within timeout', async () => {
      // Given: A migration with timeout
      const newShard = createMockShard('shard-3')

      // Very slow Iceberg that exceeds timeout
      mockIceberg.getRecords.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10000))
        return []
      })

      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
        timeout: 1000, // 1 second timeout
      })

      // When: Starting migration
      const resultPromise = migration.addShard(newShard as any, {
        rebalance: true,
        partitionKeys: ['pk-a'],
      })

      await vi.advanceTimersByTimeAsync(1500)

      // Then: Should timeout
      await expect(resultPromise).rejects.toThrow(/timeout/i)
    })

    it('should support rollback on failure', async () => {
      // Given: A migration that will fail
      const newShard = createMockShard('shard-3')
      newShard.applyEvent.mockRejectedValue(new Error('Apply failed'))

      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
        rollbackOnFailure: true,
      })

      // When: Migration fails
      const result = await migration.addShard(newShard as any, {
        rebalance: true,
        partitionKeys: ['pk-a'],
      })

      // Then: Should rollback
      expect(result.success).toBe(false)
      expect(result.rolledBack).toBe(true)
      expect(mockRouter.removeShard).toHaveBeenCalledWith('shard-3')
    })
  })

  // ==========================================================================
  // Migration Plan Tests
  // ==========================================================================

  describe('migration planning', () => {
    beforeEach(() => {
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })
    })

    it('should generate migration plan for adding shard', async () => {
      // Given: Current cluster state
      const newShardId = 'shard-3'

      // When: Generating plan
      const plan = await migration.planAddShard(newShardId)

      // Then: Plan should include necessary steps
      expect(plan).toBeDefined()
      expect(plan.type).toBe('add')
      expect(plan.targetShard).toBe(newShardId)
      expect(plan.partitionKeysToMove).toBeDefined()
      expect(plan.estimatedDuration).toBeGreaterThan(0)
    })

    it('should generate migration plan for removing shard', async () => {
      // Given: A shard to remove
      const shardToRemove = 'shard-2'

      // When: Generating plan
      const plan = await migration.planRemoveShard(shardToRemove)

      // Then: Plan should include data migration steps
      expect(plan).toBeDefined()
      expect(plan.type).toBe('remove')
      expect(plan.sourceShard).toBe(shardToRemove)
      expect(plan.dataDestinations).toBeDefined()
    })

    it('should validate migration plan before execution', async () => {
      // Given: A migration plan
      const plan = await migration.planAddShard('shard-3')

      // When: Validating the plan
      const validation = await migration.validatePlan(plan)

      // Then: Validation should pass for valid plan
      expect(validation.valid).toBe(true)
      expect(validation.warnings).toBeDefined()
    })

    it('should reject invalid migration plan', async () => {
      // Given: An invalid plan (removing non-existent shard)
      const invalidPlan: MigrationPlan = {
        type: 'remove',
        sourceShard: 'non-existent-shard',
        dataDestinations: {},
        estimatedDuration: 0,
        partitionKeysToMove: [],
      }

      // When: Validating the plan
      const validation = await migration.validatePlan(invalidPlan)

      // Then: Validation should fail
      expect(validation.valid).toBe(false)
      expect(validation.errors.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('configuration', () => {
    it('should accept custom configuration', () => {
      const config: ShardMigrationConfig = {
        router: mockRouter as any,
        iceberg: mockIceberg as any,
        timeout: 30000,
        batchSize: 500,
        rollbackOnFailure: true,
      }

      migration = new ShardMigration(config)

      expect(migration.config.timeout).toBe(30000)
      expect(migration.config.batchSize).toBe(500)
      expect(migration.config.rollbackOnFailure).toBe(true)
    })

    it('should have sensible defaults', () => {
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })

      expect(migration.config.timeout).toBeGreaterThan(0)
      expect(migration.config.batchSize).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // Metrics and Monitoring Tests
  // ==========================================================================

  describe('metrics and monitoring', () => {
    beforeEach(() => {
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })
    })

    it('should emit migration started event', async () => {
      const events: string[] = []
      migration.on('migration:started', () => events.push('started'))

      const newShard = createMockShard('shard-3')
      await migration.addShard(newShard as any)

      expect(events).toContain('started')
    })

    it('should emit migration completed event', async () => {
      const events: string[] = []
      migration.on('migration:completed', () => events.push('completed'))

      const newShard = createMockShard('shard-3')
      await migration.addShard(newShard as any)

      expect(events).toContain('completed')
    })

    it('should track migration metrics', async () => {
      const newShard = createMockShard('shard-3')
      await migration.addShard(newShard as any, {
        rebalance: true,
        partitionKeys: ['pk-a'],
      })

      const metrics = migration.getMetrics()

      expect(metrics.totalMigrations).toBeGreaterThan(0)
      expect(metrics.lastMigrationDuration).toBeDefined()
      expect(metrics.eventsReplayedTotal).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // Edge Cases Tests
  // ==========================================================================

  describe('edge cases', () => {
    beforeEach(() => {
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })
    })

    it('should handle empty shard migration', async () => {
      // Given: An empty shard to remove
      const emptyShard = createMockShard('shard-empty', new Map())
      shards.set('shard-empty', emptyShard)

      // When: Removing the empty shard
      const result = await migration.removeShard('shard-empty')

      // Then: Should succeed without errors
      expect(result.success).toBe(true)
      expect(result.entitiesMigrated).toBe(0)
    })

    it('should handle migration with no matching events in Iceberg', async () => {
      // Given: Iceberg with no events for the partition key
      mockIceberg = createMockIceberg([])
      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })

      const targetShard = createMockShard('shard-target')

      // When: Replaying events
      const result = await migration.replayEvents({
        partitionKey: 'non-existent-key',
        targetShard: targetShard as any,
      })

      // Then: Should succeed with 0 events
      expect(result.eventsReplayed).toBe(0)
      expect(targetShard.applyEvent).not.toHaveBeenCalled()
    })

    it('should prevent concurrent migrations on same partition key', async () => {
      // Given: A migration in progress
      const newShard = createMockShard('shard-3')

      // Slow down Iceberg to keep migration running
      mockIceberg.getRecords.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000))
        return createTestEvents('pk-a', 'shard-0', 10)
      })

      // Start first migration (don't await)
      const firstMigration = migration.addShard(newShard as any, {
        rebalance: true,
        partitionKeys: ['pk-a'],
      })

      // When: Trying to start second migration on same key
      const secondMigrationPromise = migration.rebalance({
        partitionKeys: ['pk-a'],
        targetShards: ['shard-1'],
      })

      // Then: Second migration should be rejected
      await expect(secondMigrationPromise).rejects.toThrow(/already migrating|in progress/i)

      await vi.advanceTimersByTimeAsync(1100)
      await firstMigration
    })

    it('should handle Iceberg connection failure gracefully', async () => {
      // Given: Iceberg that fails
      mockIceberg.getRecords.mockRejectedValue(new Error('Iceberg unavailable'))

      migration = new ShardMigration({
        router: mockRouter as any,
        iceberg: mockIceberg as any,
      })

      const targetShard = createMockShard('shard-target')

      // When: Replaying events
      const result = await migration.replayEvents({
        partitionKey: 'pk-a',
        targetShard: targetShard as any,
        onError: 'abort',
      })

      // Then: Should fail gracefully
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error.message).toContain('Iceberg')
    })
  })
})
