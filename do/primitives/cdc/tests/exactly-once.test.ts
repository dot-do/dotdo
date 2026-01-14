/**
 * Exactly-Once Delivery Tests for CDC Streams
 *
 * RED phase: These tests define the expected behavior for exactly-once delivery.
 * All tests should FAIL until implementation is complete.
 *
 * Requirements:
 * - Idempotency key generation from change events
 * - Deduplication with bloom filters
 * - Transaction markers for atomic batches
 * - Recovery after crash with offset replay
 *
 * @module db/primitives/cdc/tests/exactly-once.test
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Import the module under test (to be implemented)
import {
  IdempotencyTracker,
  createIdempotencyTracker,
  DeduplicationFilter,
  createDeduplicationFilter,
  TransactionCoordinator,
  createTransactionCoordinator,
  generateIdempotencyKey,
  type IdempotencyEntry,
  type IdempotencyTrackerOptions,
  type DeduplicationFilterOptions,
  type TransactionCoordinatorOptions,
  type TransactionState,
  type TransactionMarker,
  type RecoveryResult,
} from '../exactly-once'

import { ChangeOperation } from '../change-event'

// ============================================================================
// TEST HELPERS
// ============================================================================

interface TestRecord {
  id: string
  name: string
  value: number
  updatedAt?: number
}

function createTestChangeEvent(overrides: Partial<{
  id: string
  table: string
  operation: ChangeOperation
  before: TestRecord | null
  after: TestRecord | null
  timestamp: number
  sequence: number
  lsn: string
  partition: string
}> = {}) {
  return {
    id: overrides.id ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    table: overrides.table ?? 'users',
    operation: overrides.operation ?? ChangeOperation.INSERT,
    before: overrides.before ?? null,
    after: overrides.after ?? { id: '1', name: 'Test', value: 100 },
    timestamp: overrides.timestamp ?? Date.now(),
    sequence: overrides.sequence ?? 1,
    metadata: {
      lsn: overrides.lsn ?? '0/16B3740',
      partition: overrides.partition ?? 'p0',
    },
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Mock DO storage for testing
function createMockStorage(): Map<string, unknown> & {
  get: (key: string) => Promise<unknown>
  put: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  transaction: <T>(fn: () => Promise<T>) => Promise<T>
} {
  const map = new Map<string, unknown>()
  return Object.assign(map, {
    get: async (key: string) => map.get(key),
    put: async (key: string, value: unknown) => { map.set(key, value) },
    delete: async (key: string) => { map.delete(key) },
    list: async (options?: { prefix?: string }) => {
      if (!options?.prefix) return new Map(map)
      const result = new Map<string, unknown>()
      for (const [k, v] of map) {
        if (k.startsWith(options.prefix)) result.set(k, v)
      }
      return result
    },
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  })
}

// ============================================================================
// IDEMPOTENCY KEY GENERATION
// ============================================================================

describe('Idempotency Key Generation', () => {
  describe('generateIdempotencyKey', () => {
    it('should generate deterministic key from change event', () => {
      const event = createTestChangeEvent({
        id: 'evt-123',
        table: 'users',
        operation: ChangeOperation.INSERT,
        sequence: 42,
      })

      const key1 = generateIdempotencyKey(event)
      const key2 = generateIdempotencyKey(event)

      expect(key1).toBe(key2)
      expect(key1).toBeTruthy()
    })

    it('should generate different keys for different events', () => {
      const event1 = createTestChangeEvent({ id: 'evt-1', sequence: 1 })
      const event2 = createTestChangeEvent({ id: 'evt-2', sequence: 2 })

      const key1 = generateIdempotencyKey(event1)
      const key2 = generateIdempotencyKey(event2)

      expect(key1).not.toBe(key2)
    })

    it('should incorporate table name into key', () => {
      const event1 = createTestChangeEvent({ table: 'users', sequence: 1 })
      const event2 = createTestChangeEvent({ table: 'orders', sequence: 1 })

      const key1 = generateIdempotencyKey(event1)
      const key2 = generateIdempotencyKey(event2)

      expect(key1).not.toBe(key2)
    })

    it('should incorporate operation type into key', () => {
      const base = { id: 'evt-1', table: 'users', sequence: 1 }
      const insertEvent = createTestChangeEvent({ ...base, operation: ChangeOperation.INSERT })
      const updateEvent = createTestChangeEvent({ ...base, operation: ChangeOperation.UPDATE })

      const key1 = generateIdempotencyKey(insertEvent)
      const key2 = generateIdempotencyKey(updateEvent)

      expect(key1).not.toBe(key2)
    })

    it('should incorporate LSN into key when available', () => {
      const event1 = createTestChangeEvent({ lsn: '0/16B3740' })
      const event2 = createTestChangeEvent({ lsn: '0/16B3750' })

      const key1 = generateIdempotencyKey(event1)
      const key2 = generateIdempotencyKey(event2)

      expect(key1).not.toBe(key2)
    })

    it('should incorporate partition into key when available', () => {
      const event1 = createTestChangeEvent({ partition: 'p0' })
      const event2 = createTestChangeEvent({ partition: 'p1' })

      const key1 = generateIdempotencyKey(event1)
      const key2 = generateIdempotencyKey(event2)

      expect(key1).not.toBe(key2)
    })

    it('should handle events without optional fields', () => {
      const minimalEvent = {
        id: 'evt-1',
        table: 'users',
        operation: ChangeOperation.INSERT,
        before: null,
        after: { id: '1' },
        timestamp: Date.now(),
      }

      const key = generateIdempotencyKey(minimalEvent)

      expect(key).toBeTruthy()
      expect(typeof key).toBe('string')
    })

    it('should produce keys suitable for storage (no special characters)', () => {
      const event = createTestChangeEvent()
      const key = generateIdempotencyKey(event)

      // Key should be alphanumeric or include safe characters
      expect(key).toMatch(/^[a-zA-Z0-9_-]+$/)
    })
  })
})

// ============================================================================
// IDEMPOTENCY TRACKER
// ============================================================================

describe('IdempotencyTracker', () => {
  let tracker: IdempotencyTracker
  let storage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    storage = createMockStorage()
    tracker = createIdempotencyTracker({ storage })
  })

  afterEach(async () => {
    await tracker.dispose?.()
  })

  describe('tracking', () => {
    it('should track processed events', async () => {
      const key = 'idem-key-1'

      await tracker.markProcessed(key)

      const isProcessed = await tracker.isProcessed(key)
      expect(isProcessed).toBe(true)
    })

    it('should return false for unprocessed events', async () => {
      const isProcessed = await tracker.isProcessed('unknown-key')

      expect(isProcessed).toBe(false)
    })

    it('should persist tracking state to storage', async () => {
      const key = 'idem-key-1'

      await tracker.markProcessed(key)

      // Create new tracker with same storage
      const tracker2 = createIdempotencyTracker({ storage })
      const isProcessed = await tracker2.isProcessed(key)

      expect(isProcessed).toBe(true)
    })

    it('should store metadata with processed entry', async () => {
      const key = 'idem-key-1'
      const metadata = { processedAt: Date.now(), source: 'test' }

      await tracker.markProcessed(key, metadata)

      const entry = await tracker.getEntry(key)
      expect(entry?.metadata).toEqual(metadata)
    })

    it('should track processing timestamp', async () => {
      const key = 'idem-key-1'
      const beforeTs = Date.now()

      await tracker.markProcessed(key)

      const entry = await tracker.getEntry(key)
      expect(entry?.processedAt).toBeGreaterThanOrEqual(beforeTs)
      expect(entry?.processedAt).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      const trackerWithTtl = createIdempotencyTracker({
        storage,
        ttlMs: 50, // 50ms TTL
      })

      const key = 'idem-key-1'
      await trackerWithTtl.markProcessed(key)

      expect(await trackerWithTtl.isProcessed(key)).toBe(true)

      await delay(100) // Wait past TTL

      expect(await trackerWithTtl.isProcessed(key)).toBe(false)
    })

    it('should clean up expired entries', async () => {
      const trackerWithTtl = createIdempotencyTracker({
        storage,
        ttlMs: 50,
      })

      await trackerWithTtl.markProcessed('key-1')
      await trackerWithTtl.markProcessed('key-2')

      await delay(100)

      await trackerWithTtl.cleanup()

      const stats = await trackerWithTtl.getStats()
      expect(stats.entryCount).toBe(0)
    })

    it('should not expire entries when TTL is not set', async () => {
      const key = 'idem-key-1'
      await tracker.markProcessed(key)

      await delay(100)

      expect(await tracker.isProcessed(key)).toBe(true)
    })
  })

  describe('batch operations', () => {
    it('should mark multiple keys as processed atomically', async () => {
      const keys = ['key-1', 'key-2', 'key-3']

      await tracker.markProcessedBatch(keys)

      for (const key of keys) {
        expect(await tracker.isProcessed(key)).toBe(true)
      }
    })

    it('should check multiple keys at once', async () => {
      await tracker.markProcessed('key-1')
      await tracker.markProcessed('key-3')

      const results = await tracker.isProcessedBatch(['key-1', 'key-2', 'key-3'])

      expect(results.get('key-1')).toBe(true)
      expect(results.get('key-2')).toBe(false)
      expect(results.get('key-3')).toBe(true)
    })

    it('should handle empty batch', async () => {
      await tracker.markProcessedBatch([])
      const results = await tracker.isProcessedBatch([])

      expect(results.size).toBe(0)
    })
  })

  describe('checkpoint and recovery', () => {
    it('should export checkpoint state', async () => {
      await tracker.markProcessed('key-1')
      await tracker.markProcessed('key-2')

      const checkpoint = await tracker.getCheckpoint()

      expect(checkpoint.processedKeys).toContain('key-1')
      expect(checkpoint.processedKeys).toContain('key-2')
      expect(checkpoint.checkpointedAt).toBeDefined()
    })

    it('should restore from checkpoint', async () => {
      const checkpoint = {
        processedKeys: ['key-1', 'key-2', 'key-3'],
        checkpointedAt: Date.now(),
        version: 1,
      }

      await tracker.restoreFromCheckpoint(checkpoint)

      expect(await tracker.isProcessed('key-1')).toBe(true)
      expect(await tracker.isProcessed('key-2')).toBe(true)
      expect(await tracker.isProcessed('key-3')).toBe(true)
      expect(await tracker.isProcessed('key-4')).toBe(false)
    })

    it('should clear existing state on restore', async () => {
      await tracker.markProcessed('old-key')

      await tracker.restoreFromCheckpoint({
        processedKeys: ['new-key'],
        checkpointedAt: Date.now(),
        version: 1,
      })

      expect(await tracker.isProcessed('old-key')).toBe(false)
      expect(await tracker.isProcessed('new-key')).toBe(true)
    })
  })

  describe('statistics', () => {
    it('should track entry count', async () => {
      await tracker.markProcessed('key-1')
      await tracker.markProcessed('key-2')

      const stats = await tracker.getStats()

      expect(stats.entryCount).toBe(2)
    })

    it('should track hit/miss ratio', async () => {
      await tracker.markProcessed('key-1')

      await tracker.isProcessed('key-1') // hit
      await tracker.isProcessed('key-1') // hit
      await tracker.isProcessed('key-2') // miss

      const stats = await tracker.getStats()

      expect(stats.hitCount).toBe(2)
      expect(stats.missCount).toBe(1)
    })
  })
})

// ============================================================================
// DEDUPLICATION FILTER (BLOOM FILTER)
// ============================================================================

describe('DeduplicationFilter', () => {
  let filter: DeduplicationFilter

  beforeEach(() => {
    filter = createDeduplicationFilter({
      expectedElements: 10000,
      falsePositiveRate: 0.01,
    })
  })

  afterEach(async () => {
    await filter.dispose?.()
  })

  describe('basic operations', () => {
    it('should add elements to filter', async () => {
      await filter.add('key-1')

      const mightContain = await filter.mightContain('key-1')
      expect(mightContain).toBe(true)
    })

    it('should return false for elements not added', async () => {
      const mightContain = await filter.mightContain('unknown-key')

      // Bloom filters can have false positives, but should be rare
      // For deterministic testing, we check that at least some unknowns return false
      expect(mightContain).toBe(false)
    })

    it('should handle multiple elements', async () => {
      const keys = ['key-1', 'key-2', 'key-3', 'key-4', 'key-5']

      for (const key of keys) {
        await filter.add(key)
      }

      for (const key of keys) {
        expect(await filter.mightContain(key)).toBe(true)
      }
    })

    it('should add multiple elements at once', async () => {
      const keys = ['key-1', 'key-2', 'key-3']

      await filter.addBatch(keys)

      for (const key of keys) {
        expect(await filter.mightContain(key)).toBe(true)
      }
    })
  })

  describe('time-windowed behavior', () => {
    it('should support time-windowed deduplication', async () => {
      const windowedFilter = createDeduplicationFilter({
        expectedElements: 1000,
        falsePositiveRate: 0.01,
        windowSizeMs: 100,
      })

      await windowedFilter.add('key-1')
      expect(await windowedFilter.mightContain('key-1')).toBe(true)

      await delay(150) // Wait past window

      // After window expires, element should be evicted
      expect(await windowedFilter.mightContain('key-1')).toBe(false)
    })

    it('should rotate to new filter after window', async () => {
      const windowedFilter = createDeduplicationFilter({
        expectedElements: 1000,
        falsePositiveRate: 0.01,
        windowSizeMs: 50,
        windowCount: 2, // Keep 2 windows
      })

      await windowedFilter.add('key-1')
      await delay(30)
      await windowedFilter.add('key-2')
      await delay(30)

      // key-1 might be in old window, key-2 in new window
      // Both should still be found within 2-window retention
      expect(await windowedFilter.mightContain('key-2')).toBe(true)
    })

    it('should track window statistics', async () => {
      const windowedFilter = createDeduplicationFilter({
        expectedElements: 1000,
        falsePositiveRate: 0.01,
        windowSizeMs: 1000,
      })

      await windowedFilter.add('key-1')
      await windowedFilter.add('key-2')

      const stats = await windowedFilter.getStats()

      expect(stats.currentWindowSize).toBe(2)
      expect(stats.totalWindows).toBeGreaterThanOrEqual(1)
    })
  })

  describe('configuration', () => {
    it('should respect expectedElements configuration', () => {
      const smallFilter = createDeduplicationFilter({
        expectedElements: 100,
        falsePositiveRate: 0.01,
      })

      const largeFilter = createDeduplicationFilter({
        expectedElements: 1000000,
        falsePositiveRate: 0.01,
      })

      // Larger filter should use more memory
      const smallStats = smallFilter.getStats()
      const largeStats = largeFilter.getStats()

      expect(largeStats.bitArraySize).toBeGreaterThan(smallStats.bitArraySize)
    })

    it('should respect falsePositiveRate configuration', () => {
      const loosyFilter = createDeduplicationFilter({
        expectedElements: 1000,
        falsePositiveRate: 0.1, // 10% FP rate
      })

      const strictFilter = createDeduplicationFilter({
        expectedElements: 1000,
        falsePositiveRate: 0.001, // 0.1% FP rate
      })

      // Stricter filter needs more bits
      expect(strictFilter.getStats().bitArraySize).toBeGreaterThan(
        loosyFilter.getStats().bitArraySize
      )
    })
  })

  describe('serialization', () => {
    it('should export filter state', async () => {
      await filter.add('key-1')
      await filter.add('key-2')

      const state = await filter.export()

      expect(state.bitArray).toBeDefined()
      expect(state.hashCount).toBeDefined()
      expect(state.elementCount).toBe(2)
    })

    it('should import filter state', async () => {
      await filter.add('key-1')
      await filter.add('key-2')

      const state = await filter.export()

      const newFilter = createDeduplicationFilter({
        expectedElements: 10000,
        falsePositiveRate: 0.01,
      })
      await newFilter.import(state)

      expect(await newFilter.mightContain('key-1')).toBe(true)
      expect(await newFilter.mightContain('key-2')).toBe(true)
    })
  })

  describe('false positive rate', () => {
    it('should maintain acceptable false positive rate', async () => {
      const testFilter = createDeduplicationFilter({
        expectedElements: 1000,
        falsePositiveRate: 0.05, // 5% FP rate
      })

      // Add known elements
      for (let i = 0; i < 500; i++) {
        await testFilter.add(`known-${i}`)
      }

      // Test unknown elements
      let falsePositives = 0
      const testCount = 1000

      for (let i = 0; i < testCount; i++) {
        if (await testFilter.mightContain(`unknown-${i}`)) {
          falsePositives++
        }
      }

      const actualFpRate = falsePositives / testCount

      // Allow some margin (FP rate should be roughly within 2x the target)
      expect(actualFpRate).toBeLessThan(0.15)
    })
  })

  describe('clear and reset', () => {
    it('should clear all elements', async () => {
      await filter.add('key-1')
      await filter.add('key-2')

      await filter.clear()

      expect(await filter.mightContain('key-1')).toBe(false)
      expect(await filter.mightContain('key-2')).toBe(false)
    })
  })
})

// ============================================================================
// TRANSACTION COORDINATOR
// ============================================================================

describe('TransactionCoordinator', () => {
  let coordinator: TransactionCoordinator
  let storage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    storage = createMockStorage()
    coordinator = createTransactionCoordinator({ storage })
  })

  afterEach(async () => {
    await coordinator.dispose?.()
  })

  describe('transaction markers', () => {
    it('should begin a transaction', async () => {
      const txId = await coordinator.begin()

      expect(txId).toBeTruthy()
      expect(typeof txId).toBe('string')
    })

    it('should generate unique transaction IDs', async () => {
      const txId1 = await coordinator.begin()
      const txId2 = await coordinator.begin()

      expect(txId1).not.toBe(txId2)
    })

    it('should track transaction state', async () => {
      const txId = await coordinator.begin()

      const state = await coordinator.getState(txId)

      expect(state).toBe('pending')
    })

    it('should add events to transaction', async () => {
      const txId = await coordinator.begin()
      const event = createTestChangeEvent({ id: 'evt-1' })

      await coordinator.addEvent(txId, event)

      const events = await coordinator.getEvents(txId)
      expect(events).toHaveLength(1)
      expect(events[0].id).toBe('evt-1')
    })

    it('should add multiple events to transaction', async () => {
      const txId = await coordinator.begin()

      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-2' }))
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-3' }))

      const events = await coordinator.getEvents(txId)
      expect(events).toHaveLength(3)
    })
  })

  describe('two-phase commit', () => {
    it('should prepare transaction (phase 1)', async () => {
      const txId = await coordinator.begin()
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))

      const prepared = await coordinator.prepare(txId)

      expect(prepared).toBe(true)
      expect(await coordinator.getState(txId)).toBe('prepared')
    })

    it('should commit prepared transaction (phase 2)', async () => {
      const txId = await coordinator.begin()
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))
      await coordinator.prepare(txId)

      await coordinator.commit(txId)

      expect(await coordinator.getState(txId)).toBe('committed')
    })

    it('should fail to commit unprepared transaction', async () => {
      const txId = await coordinator.begin()
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))

      await expect(coordinator.commit(txId)).rejects.toThrow()
    })

    it('should abort transaction', async () => {
      const txId = await coordinator.begin()
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))

      await coordinator.abort(txId)

      expect(await coordinator.getState(txId)).toBe('aborted')
    })

    it('should abort prepared transaction', async () => {
      const txId = await coordinator.begin()
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))
      await coordinator.prepare(txId)

      await coordinator.abort(txId)

      expect(await coordinator.getState(txId)).toBe('aborted')
    })

    it('should not allow changes after prepare', async () => {
      const txId = await coordinator.begin()
      await coordinator.prepare(txId)

      await expect(
        coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))
      ).rejects.toThrow()
    })
  })

  describe('atomic batches', () => {
    it('should mark batch boundary', async () => {
      const txId = await coordinator.begin()

      const marker = await coordinator.markBatchBoundary(txId, {
        offset: { value: 1000, format: 'numeric' },
        eventCount: 10,
      })

      expect(marker.transactionId).toBe(txId)
      expect(marker.offset.value).toBe(1000)
    })

    it('should validate batch before commit', async () => {
      const txId = await coordinator.begin()
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))

      await coordinator.markBatchBoundary(txId, {
        offset: { value: 1000, format: 'numeric' },
        eventCount: 1, // Expected 1 event
      })

      await coordinator.prepare(txId)
      await coordinator.commit(txId)

      expect(await coordinator.getState(txId)).toBe('committed')
    })

    it('should reject batch with mismatched event count', async () => {
      const txId = await coordinator.begin()
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))

      await coordinator.markBatchBoundary(txId, {
        offset: { value: 1000, format: 'numeric' },
        eventCount: 5, // Expected 5 but only 1 added
      })

      const prepared = await coordinator.prepare(txId)

      expect(prepared).toBe(false)
    })

    it('should support nested batch boundaries', async () => {
      const txId = await coordinator.begin()

      // First batch
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-2' }))
      await coordinator.markBatchBoundary(txId, {
        offset: { value: 100, format: 'numeric' },
        eventCount: 2,
      })

      // Second batch
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-3' }))
      await coordinator.markBatchBoundary(txId, {
        offset: { value: 101, format: 'numeric' },
        eventCount: 1,
      })

      const prepared = await coordinator.prepare(txId)
      expect(prepared).toBe(true)
    })
  })

  describe('crash recovery', () => {
    it('should persist transaction state', async () => {
      const txId = await coordinator.begin()
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))
      await coordinator.prepare(txId)

      // Create new coordinator with same storage (simulating restart)
      const coordinator2 = createTransactionCoordinator({ storage })

      const state = await coordinator2.getState(txId)
      expect(state).toBe('prepared')
    })

    it('should recover prepared transactions', async () => {
      const txId = await coordinator.begin()
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))
      await coordinator.prepare(txId)

      // Simulate crash and restart
      const coordinator2 = createTransactionCoordinator({ storage })

      const recovered = await coordinator2.recoverPrepared()

      expect(recovered).toHaveLength(1)
      expect(recovered[0].transactionId).toBe(txId)
    })

    it('should recover in-flight transactions', async () => {
      const txId = await coordinator.begin()
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))
      // Not prepared - simulates crash during processing

      const coordinator2 = createTransactionCoordinator({ storage })

      const recovered = await coordinator2.recoverInFlight()

      expect(recovered).toHaveLength(1)
      expect(recovered[0].transactionId).toBe(txId)
      expect(recovered[0].events).toHaveLength(1)
    })

    it('should provide recovery decision callback', async () => {
      const txId = await coordinator.begin()
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))
      await coordinator.prepare(txId)

      const coordinator2 = createTransactionCoordinator({ storage })

      const decisions: Array<{ txId: string; decision: 'commit' | 'abort' }> = []

      await coordinator2.recover({
        onPrepared: async (tx) => {
          decisions.push({ txId: tx.transactionId, decision: 'commit' })
          return 'commit'
        },
        onInFlight: async (tx) => {
          decisions.push({ txId: tx.transactionId, decision: 'abort' })
          return 'abort'
        },
      })

      expect(decisions).toHaveLength(1)
      expect(decisions[0].decision).toBe('commit')
    })

    it('should replay events from failed transaction', async () => {
      const txId = await coordinator.begin()
      const event = createTestChangeEvent({ id: 'evt-1' })
      await coordinator.addEvent(txId, event)

      // Don't prepare - crash
      const coordinator2 = createTransactionCoordinator({ storage })

      const recovered = await coordinator2.recoverInFlight()

      expect(recovered[0].events[0].id).toBe('evt-1')
    })
  })

  describe('offset replay', () => {
    it('should track committed offset', async () => {
      const txId = await coordinator.begin()
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))
      await coordinator.markBatchBoundary(txId, {
        offset: { value: 1000, format: 'numeric' },
        eventCount: 1,
      })
      await coordinator.prepare(txId)
      await coordinator.commit(txId)

      const committedOffset = await coordinator.getCommittedOffset()

      expect(committedOffset?.value).toBe(1000)
    })

    it('should identify replay start point after crash', async () => {
      // Commit first transaction
      const txId1 = await coordinator.begin()
      await coordinator.addEvent(txId1, createTestChangeEvent({ id: 'evt-1' }))
      await coordinator.markBatchBoundary(txId1, {
        offset: { value: 1000, format: 'numeric' },
        eventCount: 1,
      })
      await coordinator.prepare(txId1)
      await coordinator.commit(txId1)

      // Start second transaction but crash before commit
      const txId2 = await coordinator.begin()
      await coordinator.addEvent(txId2, createTestChangeEvent({ id: 'evt-2' }))
      await coordinator.markBatchBoundary(txId2, {
        offset: { value: 1001, format: 'numeric' },
        eventCount: 1,
      })

      // Simulate restart
      const coordinator2 = createTransactionCoordinator({ storage })

      const replayFrom = await coordinator2.getReplayOffset()

      // Should replay from last committed offset
      expect(replayFrom?.value).toBe(1000)
    })

    it('should skip already processed events during replay', async () => {
      const txId = await coordinator.begin()
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-1', sequence: 1 }))
      await coordinator.addEvent(txId, createTestChangeEvent({ id: 'evt-2', sequence: 2 }))
      await coordinator.markBatchBoundary(txId, {
        offset: { value: 1001, format: 'numeric' },
        eventCount: 2,
      })
      await coordinator.prepare(txId)
      await coordinator.commit(txId)

      // During replay, should filter out already-committed events
      const isCommitted = await coordinator.isEventCommitted('evt-1')

      expect(isCommitted).toBe(true)
    })
  })

  describe('timeout handling', () => {
    it('should timeout stale transactions', async () => {
      const coordinatorWithTimeout = createTransactionCoordinator({
        storage,
        transactionTimeoutMs: 50,
      })

      const txId = await coordinatorWithTimeout.begin()
      await coordinatorWithTimeout.addEvent(txId, createTestChangeEvent({ id: 'evt-1' }))

      await delay(100) // Wait past timeout

      const state = await coordinatorWithTimeout.getState(txId)

      expect(state).toBe('timed_out')
    })

    it('should clean up timed out transactions', async () => {
      const coordinatorWithTimeout = createTransactionCoordinator({
        storage,
        transactionTimeoutMs: 50,
      })

      await coordinatorWithTimeout.begin()
      await coordinatorWithTimeout.begin()

      await delay(100)

      const cleaned = await coordinatorWithTimeout.cleanupTimedOut()

      expect(cleaned).toBe(2)
    })
  })

  describe('statistics', () => {
    it('should track transaction counts', async () => {
      const txId1 = await coordinator.begin()
      await coordinator.prepare(txId1)
      await coordinator.commit(txId1)

      const txId2 = await coordinator.begin()
      await coordinator.abort(txId2)

      const stats = await coordinator.getStats()

      expect(stats.totalTransactions).toBe(2)
      expect(stats.committedCount).toBe(1)
      expect(stats.abortedCount).toBe(1)
    })

    it('should track average transaction duration', async () => {
      const txId = await coordinator.begin()
      await delay(10)
      await coordinator.prepare(txId)
      await coordinator.commit(txId)

      const stats = await coordinator.getStats()

      expect(stats.avgDurationMs).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Exactly-Once Integration', () => {
  let tracker: IdempotencyTracker
  let filter: DeduplicationFilter
  let coordinator: TransactionCoordinator
  let storage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    storage = createMockStorage()
    tracker = createIdempotencyTracker({ storage })
    filter = createDeduplicationFilter({
      expectedElements: 1000,
      falsePositiveRate: 0.01,
    })
    coordinator = createTransactionCoordinator({ storage })
  })

  afterEach(async () => {
    await tracker.dispose?.()
    await filter.dispose?.()
    await coordinator.dispose?.()
  })

  it('should process events exactly once with all components', async () => {
    const processedEvents: string[] = []

    const events = [
      createTestChangeEvent({ id: 'evt-1' }),
      createTestChangeEvent({ id: 'evt-2' }),
      createTestChangeEvent({ id: 'evt-3' }),
    ]

    // Start transaction
    const txId = await coordinator.begin()

    for (const event of events) {
      const key = generateIdempotencyKey(event)

      // Fast path: check bloom filter
      if (await filter.mightContain(key)) {
        // Slow path: check idempotency tracker
        if (await tracker.isProcessed(key)) {
          continue // Skip duplicate
        }
      }

      // Process event
      processedEvents.push(event.id)

      // Mark as processed
      await filter.add(key)
      await tracker.markProcessed(key)
      await coordinator.addEvent(txId, event)
    }

    // Commit transaction
    await coordinator.markBatchBoundary(txId, {
      offset: { value: 3, format: 'numeric' },
      eventCount: 3,
    })
    await coordinator.prepare(txId)
    await coordinator.commit(txId)

    expect(processedEvents).toEqual(['evt-1', 'evt-2', 'evt-3'])
  })

  it('should deduplicate replay events after crash', async () => {
    const processedEvents: string[] = []

    // First processing
    const event = createTestChangeEvent({ id: 'evt-1' })
    const key = generateIdempotencyKey(event)

    const txId1 = await coordinator.begin()
    await filter.add(key)
    await tracker.markProcessed(key)
    await coordinator.addEvent(txId1, event)
    await coordinator.markBatchBoundary(txId1, {
      offset: { value: 1, format: 'numeric' },
      eventCount: 1,
    })
    await coordinator.prepare(txId1)
    await coordinator.commit(txId1)

    processedEvents.push(event.id)

    // Simulate crash and replay
    const replayEvent = createTestChangeEvent({ id: 'evt-1' }) // Same event
    const replayKey = generateIdempotencyKey(replayEvent)

    if (await filter.mightContain(replayKey)) {
      if (await tracker.isProcessed(replayKey)) {
        // Should skip - duplicate
        expect(true).toBe(true)
        return
      }
    }

    // Should not reach here
    expect.fail('Duplicate event was not detected')
  })

  it('should handle partial failure with transaction rollback', async () => {
    const processedEvents: string[] = []

    const events = [
      createTestChangeEvent({ id: 'evt-1' }),
      createTestChangeEvent({ id: 'evt-2' }),
      createTestChangeEvent({ id: 'evt-3' }),
    ]

    const txId = await coordinator.begin()

    try {
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!
        const key = generateIdempotencyKey(event)

        // Simulate failure on second event
        if (i === 1) {
          throw new Error('Processing failed')
        }

        processedEvents.push(event.id)
        await filter.add(key)
        await coordinator.addEvent(txId, event)
      }

      await coordinator.prepare(txId)
      await coordinator.commit(txId)
    } catch (error) {
      await coordinator.abort(txId)
    }

    const state = await coordinator.getState(txId)
    expect(state).toBe('aborted')

    // Events should not be marked as committed
    expect(await coordinator.isEventCommitted('evt-1')).toBe(false)
  })
})
