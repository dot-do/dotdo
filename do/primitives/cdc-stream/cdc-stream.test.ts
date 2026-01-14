/**
 * CDCStream tests
 *
 * RED phase: These tests define the expected behavior of CDCStream.
 * All tests should FAIL until implementation is complete.
 *
 * CDCStream provides Change Data Capture functionality:
 * - Capture inserts, updates, deletes with before/after states
 * - Ordered change streams per entity
 * - Consumer groups with offset tracking
 * - Replay from any offset
 * - Filtering by entity, operation, fields
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CDCStream,
  createCDCStream,
  type ChangeEvent,
  type Consumer,
  type CDCConfig,
  type ConsumerConfig,
  type ChangeFilter,
  type Operation,
} from './index'

// ============================================================================
// TEST DATA AND HELPERS
// ============================================================================

interface User {
  id: string
  email: string
  name: string
  status: string
}

interface Product {
  id: string
  name: string
  price: number
  inventory: number
}

function createTestCDC(): CDCStream {
  return createCDCStream()
}

/**
 * Helper to collect changes from a consumer
 */
async function collectChanges<T = unknown>(
  consumer: Consumer<T>,
  limit: number = 100
): Promise<ChangeEvent<T>[]> {
  const changes: ChangeEvent<T>[] = []
  let count = 0

  for await (const change of consumer) {
    changes.push(change)
    count++
    if (count >= limit) break
  }

  return changes
}

/**
 * Helper to collect N changes then stop
 */
async function takeChanges<T = unknown>(
  consumer: Consumer<T>,
  n: number
): Promise<ChangeEvent<T>[]> {
  const changes: ChangeEvent<T>[] = []

  for (let i = 0; i < n; i++) {
    const result = await consumer.next()
    if (result.done) break
    changes.push(result.value)
  }

  return changes
}

// ============================================================================
// BASIC CDC SETUP
// ============================================================================

describe('CDCStream', () => {
  describe('enable CDC on entity', () => {
    it('should enable CDC on an entity with default options', async () => {
      const cdc = createTestCDC()

      await cdc.enable('users')

      const config = await cdc.getConfig('users')
      expect(config).toBeDefined()
      expect(config?.entity).toBe('users')
      expect(config?.captureInserts).toBe(true)
      expect(config?.captureUpdates).toBe(true)
      expect(config?.captureDeletes).toBe(true)
    })

    it('should enable CDC with custom options', async () => {
      const cdc = createTestCDC()

      await cdc.enable('users', {
        captureInserts: true,
        captureUpdates: true,
        captureDeletes: false,
        trackFields: ['email', 'name', 'status'],
      })

      const config = await cdc.getConfig('users')
      expect(config?.captureDeletes).toBe(false)
      expect(config?.trackFields).toEqual(['email', 'name', 'status'])
    })

    it('should allow enabling CDC on multiple entities', async () => {
      const cdc = createTestCDC()

      await cdc.enable('users')
      await cdc.enable('products')
      await cdc.enable('orders')

      const entities = await cdc.listEnabledEntities()
      expect(entities).toContain('users')
      expect(entities).toContain('products')
      expect(entities).toContain('orders')
    })

    it('should allow disabling CDC on an entity', async () => {
      const cdc = createTestCDC()

      await cdc.enable('users')
      await cdc.disable('users')

      const config = await cdc.getConfig('users')
      expect(config).toBeNull()
    })

    it('should not throw when disabling non-existent entity', async () => {
      const cdc = createTestCDC()

      await expect(cdc.disable('nonexistent')).resolves.not.toThrow()
    })
  })

  // ============================================================================
  // CAPTURING CHANGES
  // ============================================================================

  describe('capturing changes', () => {
    it('should capture INSERT operations', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', {
        operation: 'INSERT',
        key: '1',
        after: { id: '1', email: 'alice@test.com', name: 'Alice', status: 'active' },
      })

      const consumer = cdc.createConsumer('users', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1)

      expect(changes).toHaveLength(1)
      expect(changes[0].operation).toBe('INSERT')
      expect(changes[0].key).toBe('1')
      expect(changes[0].before).toBeNull()
      expect(changes[0].after).toEqual({ id: '1', email: 'alice@test.com', name: 'Alice', status: 'active' })
    })

    it('should capture UPDATE operations with before/after', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', {
        operation: 'UPDATE',
        key: '1',
        before: { id: '1', email: 'alice@test.com', name: 'Alice', status: 'active' },
        after: { id: '1', email: 'alice@test.com', name: 'Alice Smith', status: 'active' },
      })

      const consumer = cdc.createConsumer('users', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1)

      expect(changes[0].operation).toBe('UPDATE')
      expect(changes[0].before).toEqual({ id: '1', email: 'alice@test.com', name: 'Alice', status: 'active' })
      expect(changes[0].after).toEqual({ id: '1', email: 'alice@test.com', name: 'Alice Smith', status: 'active' })
    })

    it('should capture DELETE operations', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', {
        operation: 'DELETE',
        key: '1',
        before: { id: '1', email: 'alice@test.com', name: 'Alice', status: 'active' },
      })

      const consumer = cdc.createConsumer('users', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1)

      expect(changes[0].operation).toBe('DELETE')
      expect(changes[0].before).toEqual({ id: '1', email: 'alice@test.com', name: 'Alice', status: 'active' })
      expect(changes[0].after).toBeNull()
    })

    it('should assign sequential offsets', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })
      await cdc.capture('users', { operation: 'INSERT', key: '3', after: { id: '3' } })

      const consumer = cdc.createConsumer('users', { startOffset: 0 })
      const changes = await takeChanges(consumer, 3)

      expect(changes[0].offset).toBe(0)
      expect(changes[1].offset).toBe(1)
      expect(changes[2].offset).toBe(2)
    })

    it('should include timestamp on changes', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')
      const before = Date.now()

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })

      const after = Date.now()

      const consumer = cdc.createConsumer('users', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1)

      expect(changes[0].timestamp).toBeGreaterThanOrEqual(before)
      expect(changes[0].timestamp).toBeLessThanOrEqual(after)
    })

    it('should include entity name on changes', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })

      const consumer = cdc.createConsumer('users', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1)

      expect(changes[0].entity).toBe('users')
    })

    it('should include transaction ID when provided', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', {
        operation: 'INSERT',
        key: '1',
        after: { id: '1' },
        transactionId: 'tx_12345',
      })

      const consumer = cdc.createConsumer('users', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1)

      expect(changes[0].transactionId).toBe('tx_12345')
    })

    it('should throw when capturing on non-enabled entity', async () => {
      const cdc = createTestCDC()

      await expect(
        cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      ).rejects.toThrow(/not enabled/)
    })

    it('should respect captureInserts config', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users', { captureInserts: false })

      // Should not capture (returns without storing)
      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })

      const consumer = cdc.createConsumer('users', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1)

      expect(changes).toHaveLength(0)
    })

    it('should respect captureUpdates config', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users', { captureUpdates: false })

      await cdc.capture('users', {
        operation: 'UPDATE',
        key: '1',
        before: { id: '1' },
        after: { id: '1', name: 'Updated' },
      })

      const consumer = cdc.createConsumer('users', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1)

      expect(changes).toHaveLength(0)
    })

    it('should respect captureDeletes config', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users', { captureDeletes: false })

      await cdc.capture('users', { operation: 'DELETE', key: '1', before: { id: '1' } })

      const consumer = cdc.createConsumer('users', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1)

      expect(changes).toHaveLength(0)
    })

    it('should only capture changes to tracked fields', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users', {
        trackFields: ['name', 'status'],
      })

      // Change to tracked field - should capture
      await cdc.capture('users', {
        operation: 'UPDATE',
        key: '1',
        before: { id: '1', name: 'Alice', email: 'a@b.com', status: 'active' },
        after: { id: '1', name: 'Alice Smith', email: 'a@b.com', status: 'active' },
      })

      // Change to non-tracked field only - should NOT capture
      await cdc.capture('users', {
        operation: 'UPDATE',
        key: '2',
        before: { id: '2', name: 'Bob', email: 'old@b.com', status: 'active' },
        after: { id: '2', name: 'Bob', email: 'new@b.com', status: 'active' },
      })

      const consumer = cdc.createConsumer('users', { startOffset: 0 })
      const changes = await takeChanges(consumer, 2)

      expect(changes).toHaveLength(1)
      expect(changes[0].key).toBe('1')
    })
  })

  // ============================================================================
  // CONSUMERS
  // ============================================================================

  describe('consumers', () => {
    it('should create a consumer for an entity', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      const consumer = cdc.createConsumer('users')

      expect(consumer).toBeDefined()
      expect(consumer.entity).toBe('users')
    })

    it('should read changes from start offset', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })
      await cdc.capture('users', { operation: 'INSERT', key: '3', after: { id: '3' } })

      // Start from offset 1 (skip first change)
      const consumer = cdc.createConsumer('users', { startOffset: 1 })
      const changes = await takeChanges(consumer, 3)

      expect(changes).toHaveLength(2)
      expect(changes[0].offset).toBe(1)
      expect(changes[1].offset).toBe(2)
    })

    it('should support "earliest" start offset', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })

      const consumer = cdc.createConsumer('users', { startOffset: 'earliest' })
      const changes = await takeChanges(consumer, 2)

      expect(changes).toHaveLength(2)
      expect(changes[0].offset).toBe(0)
    })

    it('should support "latest" start offset', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })

      const consumer = cdc.createConsumer('users', { startOffset: 'latest' })

      // Add another change after consumer creation
      await cdc.capture('users', { operation: 'INSERT', key: '3', after: { id: '3' } })

      const changes = await takeChanges(consumer, 2)

      expect(changes).toHaveLength(1)
      expect(changes[0].key).toBe('3')
    })

    it('should track current offset', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })

      const consumer = cdc.createConsumer('users', { startOffset: 0 })

      expect(consumer.currentOffset).toBe(0)

      await consumer.next()
      expect(consumer.currentOffset).toBe(1)

      await consumer.next()
      expect(consumer.currentOffset).toBe(2)
    })

    it('should allow manual offset commit', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })

      const consumer = cdc.createConsumer('users', {
        groupId: 'test-group',
        startOffset: 0,
      })

      await consumer.next()
      await consumer.commit()

      // Verify committed offset was stored
      const committedOffset = await cdc.getCommittedOffset('users', 'test-group')
      expect(committedOffset).toBe(1)
    })

    it('should support auto-commit', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })

      const consumer = cdc.createConsumer('users', {
        groupId: 'auto-commit-group',
        startOffset: 0,
        autoCommit: true,
      })

      await consumer.next()
      await consumer.next()

      const committedOffset = await cdc.getCommittedOffset('users', 'auto-commit-group')
      expect(committedOffset).toBe(2)
    })

    it('should close consumer gracefully', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      const consumer = cdc.createConsumer('users')

      await consumer.close()

      // After close, next should return done
      const result = await consumer.next()
      expect(result.done).toBe(true)
    })
  })

  // ============================================================================
  // CONSUMER GROUPS
  // ============================================================================

  describe('consumer groups', () => {
    it('should maintain separate offsets per consumer group', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })

      const consumer1 = cdc.createConsumer('users', { groupId: 'group-1', startOffset: 0 })
      const consumer2 = cdc.createConsumer('users', { groupId: 'group-2', startOffset: 0 })

      // Consumer 1 reads both
      await consumer1.next()
      await consumer1.next()
      await consumer1.commit()

      // Consumer 2 reads only one
      await consumer2.next()
      await consumer2.commit()

      expect(await cdc.getCommittedOffset('users', 'group-1')).toBe(2)
      expect(await cdc.getCommittedOffset('users', 'group-2')).toBe(1)
    })

    it('should resume from committed offset', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })

      // First consumer commits after reading first change
      const consumer1 = cdc.createConsumer('users', { groupId: 'persistent-group', startOffset: 0 })
      await consumer1.next()
      await consumer1.commit()
      await consumer1.close()

      // Add more changes
      await cdc.capture('users', { operation: 'INSERT', key: '3', after: { id: '3' } })

      // New consumer with same group should resume from committed offset
      const consumer2 = cdc.createConsumer('users', { groupId: 'persistent-group' })
      const changes = await takeChanges(consumer2, 3)

      expect(changes).toHaveLength(2)
      expect(changes[0].key).toBe('2')
      expect(changes[1].key).toBe('3')
    })

    it('should list active consumer groups', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      cdc.createConsumer('users', { groupId: 'group-a' })
      cdc.createConsumer('users', { groupId: 'group-b' })
      cdc.createConsumer('users', { groupId: 'group-c' })

      const groups = await cdc.listConsumerGroups('users')

      expect(groups).toContain('group-a')
      expect(groups).toContain('group-b')
      expect(groups).toContain('group-c')
    })

    it('should track consumer lag per group', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })
      await cdc.capture('users', { operation: 'INSERT', key: '3', after: { id: '3' } })

      const consumer = cdc.createConsumer('users', { groupId: 'lag-group', startOffset: 0 })
      await consumer.next()
      await consumer.commit()

      const lag = await cdc.getConsumerLag('users', 'lag-group')
      expect(lag).toBe(2) // 3 total - 1 committed = 2 behind
    })
  })

  // ============================================================================
  // REPLAY
  // ============================================================================

  describe('replay', () => {
    it('should replay all changes from offset', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })
      await cdc.capture('users', { operation: 'INSERT', key: '3', after: { id: '3' } })

      const replayed: ChangeEvent[] = []
      await cdc.replay('users', { fromOffset: 0 }, async (change) => {
        replayed.push(change)
      })

      expect(replayed).toHaveLength(3)
      expect(replayed[0].key).toBe('1')
      expect(replayed[1].key).toBe('2')
      expect(replayed[2].key).toBe('3')
    })

    it('should replay changes in offset range', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })
      await cdc.capture('users', { operation: 'INSERT', key: '3', after: { id: '3' } })
      await cdc.capture('users', { operation: 'INSERT', key: '4', after: { id: '4' } })

      const replayed: ChangeEvent[] = []
      await cdc.replay('users', { fromOffset: 1, toOffset: 2 }, async (change) => {
        replayed.push(change)
      })

      expect(replayed).toHaveLength(2)
      expect(replayed[0].offset).toBe(1)
      expect(replayed[1].offset).toBe(2)
    })

    it('should replay changes within time range', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      const t1 = Date.now() - 3000
      const t2 = Date.now() - 2000
      const t3 = Date.now() - 1000

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' }, timestamp: t1 })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' }, timestamp: t2 })
      await cdc.capture('users', { operation: 'INSERT', key: '3', after: { id: '3' }, timestamp: t3 })

      const replayed: ChangeEvent[] = []
      await cdc.replay('users', { fromTimestamp: t2 - 100, toTimestamp: t2 + 100 }, async (change) => {
        replayed.push(change)
      })

      expect(replayed).toHaveLength(1)
      expect(replayed[0].key).toBe('2')
    })

    it('should support batch replay with callback', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      for (let i = 0; i < 10; i++) {
        await cdc.capture('users', { operation: 'INSERT', key: `${i}`, after: { id: `${i}` } })
      }

      const batches: ChangeEvent[][] = []
      await cdc.replayBatch('users', { fromOffset: 0, batchSize: 3 }, async (batch) => {
        batches.push([...batch])
      })

      expect(batches).toHaveLength(4) // 3 + 3 + 3 + 1
      expect(batches[0]).toHaveLength(3)
      expect(batches[3]).toHaveLength(1)
    })

    it('should stop replay early if callback returns false', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      for (let i = 0; i < 10; i++) {
        await cdc.capture('users', { operation: 'INSERT', key: `${i}`, after: { id: `${i}` } })
      }

      const replayed: ChangeEvent[] = []
      await cdc.replay('users', { fromOffset: 0 }, async (change) => {
        replayed.push(change)
        return replayed.length < 5 // Stop after 5
      })

      expect(replayed).toHaveLength(5)
    })
  })

  // ============================================================================
  // FILTERING
  // ============================================================================

  describe('filtering', () => {
    beforeEach(async () => {
      // Setup is done in each test
    })

    it('should filter by operation type', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'UPDATE', key: '1', before: { id: '1' }, after: { id: '1', name: 'Alice' } })
      await cdc.capture('users', { operation: 'DELETE', key: '1', before: { id: '1', name: 'Alice' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })

      const consumer = cdc.createConsumer('users', {
        startOffset: 0,
        filter: {
          operations: ['INSERT', 'UPDATE'],
        },
      })

      const changes = await takeChanges(consumer, 10)

      expect(changes).toHaveLength(3)
      expect(changes.map((c) => c.operation)).toEqual(['INSERT', 'UPDATE', 'INSERT'])
    })

    it('should filter by changed fields', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', {
        operation: 'UPDATE',
        key: '1',
        before: { id: '1', name: 'Alice', status: 'active' },
        after: { id: '1', name: 'Alice Smith', status: 'active' },
      })
      await cdc.capture('users', {
        operation: 'UPDATE',
        key: '2',
        before: { id: '2', name: 'Bob', status: 'active' },
        after: { id: '2', name: 'Bob', status: 'inactive' },
      })

      const consumer = cdc.createConsumer('users', {
        startOffset: 0,
        filter: {
          fields: ['status'], // Only when status changes
        },
      })

      const changes = await takeChanges(consumer, 10)

      expect(changes).toHaveLength(1)
      expect(changes[0].key).toBe('2')
    })

    it('should filter by key pattern', async () => {
      const cdc = createTestCDC()
      await cdc.enable('events')

      await cdc.capture('events', { operation: 'INSERT', key: 'user:1:click', after: { type: 'click' } })
      await cdc.capture('events', { operation: 'INSERT', key: 'user:2:view', after: { type: 'view' } })
      await cdc.capture('events', { operation: 'INSERT', key: 'system:ping', after: { type: 'ping' } })
      await cdc.capture('events', { operation: 'INSERT', key: 'user:1:view', after: { type: 'view' } })

      const consumer = cdc.createConsumer('events', {
        startOffset: 0,
        filter: {
          keyPattern: /^user:\d+:/,
        },
      })

      const changes = await takeChanges(consumer, 10)

      expect(changes).toHaveLength(3)
      expect(changes.map((c) => c.key)).toEqual(['user:1:click', 'user:2:view', 'user:1:view'])
    })

    it('should combine multiple filters (AND logic)', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: 'admin:1', after: { role: 'admin' } })
      await cdc.capture('users', { operation: 'UPDATE', key: 'admin:1', before: { role: 'admin' }, after: { role: 'admin', name: 'Alice' } })
      await cdc.capture('users', { operation: 'INSERT', key: 'user:1', after: { role: 'user' } })
      await cdc.capture('users', { operation: 'UPDATE', key: 'user:1', before: { role: 'user' }, after: { role: 'user', name: 'Bob' } })

      const consumer = cdc.createConsumer('users', {
        startOffset: 0,
        filter: {
          operations: ['UPDATE'],
          keyPattern: /^admin:/,
        },
      })

      const changes = await takeChanges(consumer, 10)

      expect(changes).toHaveLength(1)
      expect(changes[0].key).toBe('admin:1')
      expect(changes[0].operation).toBe('UPDATE')
    })

    it('should support custom predicate filter', async () => {
      const cdc = createTestCDC()
      await cdc.enable('orders')

      await cdc.capture('orders', { operation: 'INSERT', key: '1', after: { total: 50 } })
      await cdc.capture('orders', { operation: 'INSERT', key: '2', after: { total: 150 } })
      await cdc.capture('orders', { operation: 'INSERT', key: '3', after: { total: 75 } })

      const consumer = cdc.createConsumer('orders', {
        startOffset: 0,
        filter: {
          predicate: (change) => {
            const total = (change.after as { total: number })?.total ?? 0
            return total > 100
          },
        },
      })

      const changes = await takeChanges(consumer, 10)

      expect(changes).toHaveLength(1)
      expect(changes[0].key).toBe('2')
    })
  })

  // ============================================================================
  // STATISTICS AND MONITORING
  // ============================================================================

  describe('statistics and monitoring', () => {
    it('should track total change count per entity', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'UPDATE', key: '1', before: { id: '1' }, after: { id: '1', name: 'Alice' } })
      await cdc.capture('users', { operation: 'DELETE', key: '1', before: { id: '1', name: 'Alice' } })

      const stats = await cdc.getStats('users')

      expect(stats.totalChanges).toBe(3)
      expect(stats.inserts).toBe(1)
      expect(stats.updates).toBe(1)
      expect(stats.deletes).toBe(1)
    })

    it('should track latest offset per entity', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })

      const stats = await cdc.getStats('users')

      expect(stats.latestOffset).toBe(1) // 0-indexed, so 2 changes = offset 1
    })

    it('should track earliest timestamp', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      const t1 = Date.now()
      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' }, timestamp: t1 })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' }, timestamp: t1 + 1000 })

      const stats = await cdc.getStats('users')

      expect(stats.earliestTimestamp).toBe(t1)
    })

    it('should track latest timestamp', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      const t1 = Date.now()
      const t2 = t1 + 1000
      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' }, timestamp: t1 })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' }, timestamp: t2 })

      const stats = await cdc.getStats('users')

      expect(stats.latestTimestamp).toBe(t2)
    })
  })

  // ============================================================================
  // TRANSACTION BOUNDARIES
  // ============================================================================

  describe('transaction boundaries', () => {
    it('should group changes by transaction ID', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      // Transaction 1: Insert two users
      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' }, transactionId: 'tx1' })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' }, transactionId: 'tx1' })

      // Transaction 2: Update one user
      await cdc.capture('users', { operation: 'UPDATE', key: '1', before: { id: '1' }, after: { id: '1', name: 'Alice' }, transactionId: 'tx2' })

      const tx1Changes = await cdc.getChangesByTransaction('users', 'tx1')
      const tx2Changes = await cdc.getChangesByTransaction('users', 'tx2')

      expect(tx1Changes).toHaveLength(2)
      expect(tx2Changes).toHaveLength(1)
    })

    it('should provide transaction metadata', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      const txStart = Date.now()
      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' }, transactionId: 'tx1', timestamp: txStart })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' }, transactionId: 'tx1', timestamp: txStart + 10 })

      const txInfo = await cdc.getTransactionInfo('users', 'tx1')

      expect(txInfo).toBeDefined()
      expect(txInfo?.changeCount).toBe(2)
      expect(txInfo?.startTimestamp).toBe(txStart)
      expect(txInfo?.endTimestamp).toBe(txStart + 10)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty changes gracefully', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      const consumer = cdc.createConsumer('users', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1)

      expect(changes).toHaveLength(0)
    })

    it('should handle large values in changes', async () => {
      const cdc = createTestCDC()
      await cdc.enable('documents')

      const largeContent = 'x'.repeat(1_000_000) // 1MB string
      await cdc.capture('documents', {
        operation: 'INSERT',
        key: 'doc1',
        after: { id: 'doc1', content: largeContent },
      })

      const consumer = cdc.createConsumer('documents', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1)

      expect(changes).toHaveLength(1)
      expect((changes[0].after as { content: string }).content.length).toBe(1_000_000)
    })

    it('should handle special characters in keys', async () => {
      const cdc = createTestCDC()
      await cdc.enable('data')

      await cdc.capture('data', { operation: 'INSERT', key: 'key/with/slashes', after: {} })
      await cdc.capture('data', { operation: 'INSERT', key: 'key:with:colons', after: {} })
      await cdc.capture('data', { operation: 'INSERT', key: 'key with spaces', after: {} })
      await cdc.capture('data', { operation: 'INSERT', key: 'key@with#special$chars', after: {} })

      const consumer = cdc.createConsumer('data', { startOffset: 0 })
      const changes = await takeChanges(consumer, 4)

      expect(changes).toHaveLength(4)
      expect(changes.map((c) => c.key)).toEqual([
        'key/with/slashes',
        'key:with:colons',
        'key with spaces',
        'key@with#special$chars',
      ])
    })

    it('should handle null and undefined values in objects', async () => {
      const cdc = createTestCDC()
      await cdc.enable('data')

      await cdc.capture('data', {
        operation: 'INSERT',
        key: '1',
        after: { id: '1', nullable: null, optional: undefined },
      })

      const consumer = cdc.createConsumer('data', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1)

      expect(changes[0].after).toEqual({ id: '1', nullable: null, optional: undefined })
    })

    it('should handle rapid sequential captures', async () => {
      const cdc = createTestCDC()
      await cdc.enable('events')

      // Capture 1000 events rapidly
      const promises = Array.from({ length: 1000 }, (_, i) =>
        cdc.capture('events', { operation: 'INSERT', key: `${i}`, after: { index: i } })
      )
      await Promise.all(promises)

      const stats = await cdc.getStats('events')
      expect(stats.totalChanges).toBe(1000)

      // Verify sequential offsets
      const consumer = cdc.createConsumer('events', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1000)

      expect(changes).toHaveLength(1000)
      // Offsets should be unique but may not be in order due to concurrent capture
      const offsets = new Set(changes.map((c) => c.offset))
      expect(offsets.size).toBe(1000)
    })
  })

  // ============================================================================
  // ASYNC ITERATOR SUPPORT
  // ============================================================================

  describe('async iterator support', () => {
    it('should support for-await-of iteration', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })
      await cdc.capture('users', { operation: 'INSERT', key: '2', after: { id: '2' } })

      const consumer = cdc.createConsumer('users', { startOffset: 0 })
      const changes: ChangeEvent[] = []

      let count = 0
      for await (const change of consumer) {
        changes.push(change)
        count++
        if (count >= 2) break
      }

      expect(changes).toHaveLength(2)
    })

    it('should return iterator result correctly', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      await cdc.capture('users', { operation: 'INSERT', key: '1', after: { id: '1' } })

      const consumer = cdc.createConsumer('users', { startOffset: 0 })

      const result1 = await consumer.next()
      expect(result1.done).toBe(false)
      expect(result1.value.key).toBe('1')

      // No more changes, should wait (or return done if no more)
      const result2Promise = consumer.next()
      consumer.close()
      const result2 = await result2Promise
      expect(result2.done).toBe(true)
    })
  })

  // ============================================================================
  // TYPE SAFETY
  // ============================================================================

  describe('type safety', () => {
    it('should preserve generic types through capture and consume', async () => {
      const cdc = createTestCDC()
      await cdc.enable('users')

      const userData: User = { id: '1', email: 'test@test.com', name: 'Test', status: 'active' }
      await cdc.capture<User>('users', {
        operation: 'INSERT',
        key: '1',
        after: userData,
      })

      const consumer = cdc.createConsumer<User>('users', { startOffset: 0 })
      const changes = await takeChanges(consumer, 1)

      // TypeScript should know this is User
      if (changes[0].after) {
        const email: string = changes[0].after.email
        expect(email).toBe('test@test.com')
      }
    })
  })
})
