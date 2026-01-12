/**
 * CDCStream tests
 *
 * RED phase: These tests define the expected behavior of CDCStream.
 * All tests should FAIL until implementation is complete.
 *
 * CDCStream provides Debezium-style change data capture:
 * - Change types: INSERT, UPDATE, DELETE
 * - Before/after snapshots for updates
 * - Checkpointing with ExactlyOnceContext
 * - Backfill support for initial sync
 * - Schema change handling
 * - Filtering and transformation
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CDCStream,
  createCDCStream,
  ChangeType,
  type ChangeEvent,
  type CDCStreamOptions,
  type CDCPosition,
  type ChangeHandler,
} from '../stream'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createStream<T>(options?: CDCStreamOptions<T>): CDCStream<T> {
  return createCDCStream<T>(options)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface TestRecord {
  id: string
  name: string
  value: number
  updatedAt?: number
}

// ============================================================================
// CHANGE TYPES
// ============================================================================

describe('CDCStream', () => {
  describe('change types', () => {
    it('should emit INSERT change event', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        onChange: async (event) => {
          changes.push(event)
        },
      })

      await stream.insert({ id: '1', name: 'Test', value: 100 })
      await stream.flush()

      expect(changes).toHaveLength(1)
      expect(changes[0]!.type).toBe(ChangeType.INSERT)
      expect(changes[0]!.after).toEqual({ id: '1', name: 'Test', value: 100 })
      expect(changes[0]!.before).toBeNull()
    })

    it('should emit UPDATE change event with before/after', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        onChange: async (event) => {
          changes.push(event)
        },
      })

      const before = { id: '1', name: 'Test', value: 100 }
      const after = { id: '1', name: 'Test Updated', value: 200 }
      await stream.update(before, after)
      await stream.flush()

      expect(changes).toHaveLength(1)
      expect(changes[0]!.type).toBe(ChangeType.UPDATE)
      expect(changes[0]!.before).toEqual(before)
      expect(changes[0]!.after).toEqual(after)
    })

    it('should emit DELETE change event', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        onChange: async (event) => {
          changes.push(event)
        },
      })

      await stream.delete({ id: '1', name: 'Test', value: 100 })
      await stream.flush()

      expect(changes).toHaveLength(1)
      expect(changes[0]!.type).toBe(ChangeType.DELETE)
      expect(changes[0]!.before).toEqual({ id: '1', name: 'Test', value: 100 })
      expect(changes[0]!.after).toBeNull()
    })

    it('should include timestamp in change events', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        onChange: async (event) => {
          changes.push(event)
        },
      })

      const beforeTs = Date.now()
      await stream.insert({ id: '1', name: 'Test', value: 100 })
      await stream.flush()
      const afterTs = Date.now()

      expect(changes[0]!.timestamp).toBeGreaterThanOrEqual(beforeTs)
      expect(changes[0]!.timestamp).toBeLessThanOrEqual(afterTs)
    })

    it('should assign sequential positions', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        onChange: async (event) => {
          changes.push(event)
        },
      })

      await stream.insert({ id: '1', name: 'First', value: 1 })
      await stream.insert({ id: '2', name: 'Second', value: 2 })
      await stream.insert({ id: '3', name: 'Third', value: 3 })
      await stream.flush()

      expect(changes[0]!.position.sequence).toBeLessThan(changes[1]!.position.sequence)
      expect(changes[1]!.position.sequence).toBeLessThan(changes[2]!.position.sequence)
    })
  })

  // ============================================================================
  // CHECKPOINTING
  // ============================================================================

  describe('checkpointing', () => {
    it('should track current position', async () => {
      const stream = createStream<TestRecord>()

      const pos1 = stream.getCurrentPosition()
      await stream.insert({ id: '1', name: 'Test', value: 100 })
      const pos2 = stream.getCurrentPosition()

      expect(pos2.sequence).toBeGreaterThan(pos1.sequence)
    })

    it('should commit checkpoint', async () => {
      const stream = createStream<TestRecord>()

      await stream.insert({ id: '1', name: 'Test', value: 100 })
      const position = stream.getCurrentPosition()
      await stream.commit(position)

      expect(stream.getLastCommittedPosition()).toEqual(position)
    })

    it('should resume from checkpoint', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const checkpoint: CDCPosition = { sequence: 5, timestamp: Date.now() }

      const stream = createStream<TestRecord>({
        startPosition: checkpoint,
        onChange: async (event) => {
          changes.push(event)
        },
      })

      // Position should start from checkpoint
      expect(stream.getCurrentPosition().sequence).toBeGreaterThanOrEqual(checkpoint.sequence)
    })

    it('should not reprocess committed changes', async () => {
      let handlerCalls = 0
      const stream = createStream<TestRecord>({
        onChange: async () => {
          handlerCalls++
        },
      })

      await stream.insert({ id: '1', name: 'Test', value: 100 })
      await stream.flush()
      const position = stream.getCurrentPosition()
      await stream.commit(position)

      // Simulate restart
      handlerCalls = 0
      await stream.replayFrom(position)
      await stream.flush()

      expect(handlerCalls).toBe(0)
    })

    it('should replay uncommitted changes on recovery', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        onChange: async (event) => {
          changes.push(event)
        },
      })

      // Insert without committing
      await stream.insert({ id: '1', name: 'Test', value: 100 })
      await stream.insert({ id: '2', name: 'Test2', value: 200 })
      await stream.flush()

      // Get position after first insert to replay from
      const checkpointAfterFirst = changes[0]!.position

      // Clear and replay
      changes.length = 0
      await stream.replayFrom(checkpointAfterFirst)
      await stream.flush()

      // Should replay event after checkpoint
      expect(changes.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ============================================================================
  // EXACTLY-ONCE DELIVERY
  // ============================================================================

  describe('exactly-once delivery', () => {
    it('should deduplicate events with same eventId', async () => {
      let processCount = 0
      const stream = createStream<TestRecord>({
        onChange: async () => {
          processCount++
        },
      })

      // Same event processed twice (simulating retry)
      await stream.processChange({
        eventId: 'evt-1',
        type: ChangeType.INSERT,
        before: null,
        after: { id: '1', name: 'Test', value: 100 },
        timestamp: Date.now(),
        position: { sequence: 1, timestamp: Date.now() },
      })
      await stream.processChange({
        eventId: 'evt-1',
        type: ChangeType.INSERT,
        before: null,
        after: { id: '1', name: 'Test', value: 100 },
        timestamp: Date.now(),
        position: { sequence: 1, timestamp: Date.now() },
      })
      await stream.flush()

      expect(processCount).toBe(1)
    })

    it('should maintain idempotency across restarts', async () => {
      const stream1 = createStream<TestRecord>()
      await stream1.processChange({
        eventId: 'evt-1',
        type: ChangeType.INSERT,
        before: null,
        after: { id: '1', name: 'Test', value: 100 },
        timestamp: Date.now(),
        position: { sequence: 1, timestamp: Date.now() },
      })

      const checkpoint = await stream1.getCheckpointState()

      // New stream restored from checkpoint
      let processCount = 0
      const stream2 = createStream<TestRecord>({
        onChange: async () => {
          processCount++
        },
      })
      await stream2.restoreFromCheckpoint(checkpoint)

      // Same event should be deduplicated
      await stream2.processChange({
        eventId: 'evt-1',
        type: ChangeType.INSERT,
        before: null,
        after: { id: '1', name: 'Test', value: 100 },
        timestamp: Date.now(),
        position: { sequence: 1, timestamp: Date.now() },
      })
      await stream2.flush()

      expect(processCount).toBe(0)
    })
  })

  // ============================================================================
  // BATCHING WITH WINDOW MANAGER
  // ============================================================================

  describe('batching', () => {
    it('should batch changes with count trigger', async () => {
      const batches: ChangeEvent<TestRecord>[][] = []
      const stream = createStream<TestRecord>({
        batchSize: 3,
        onBatch: async (events) => {
          batches.push([...events])
        },
      })

      await stream.insert({ id: '1', name: 'Test1', value: 1 })
      await stream.insert({ id: '2', name: 'Test2', value: 2 })
      await stream.insert({ id: '3', name: 'Test3', value: 3 })

      expect(batches).toHaveLength(1)
      expect(batches[0]).toHaveLength(3)
    })

    it('should batch changes with time trigger', async () => {
      const batches: ChangeEvent<TestRecord>[][] = []
      const stream = createStream<TestRecord>({
        batchTimeoutMs: 50,
        onBatch: async (events) => {
          batches.push([...events])
        },
      })

      await stream.insert({ id: '1', name: 'Test1', value: 1 })
      await stream.insert({ id: '2', name: 'Test2', value: 2 })

      // Wait for timeout
      await delay(100)

      expect(batches.length).toBeGreaterThanOrEqual(1)
    })

    it('should flush partial batch on explicit flush', async () => {
      const batches: ChangeEvent<TestRecord>[][] = []
      const stream = createStream<TestRecord>({
        batchSize: 10,
        onBatch: async (events) => {
          batches.push([...events])
        },
      })

      await stream.insert({ id: '1', name: 'Test1', value: 1 })
      await stream.insert({ id: '2', name: 'Test2', value: 2 })
      await stream.flush()

      expect(batches).toHaveLength(1)
      expect(batches[0]).toHaveLength(2)
    })
  })

  // ============================================================================
  // BACKFILL / INITIAL SYNC
  // ============================================================================

  describe('backfill', () => {
    it('should support backfill mode for initial sync', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        onChange: async (event) => {
          changes.push(event)
        },
      })

      await stream.startBackfill()
      await stream.backfillInsert({ id: '1', name: 'Existing1', value: 1 })
      await stream.backfillInsert({ id: '2', name: 'Existing2', value: 2 })
      await stream.endBackfill()
      await stream.flush()

      expect(changes).toHaveLength(2)
      expect(changes.every((c) => c.isBackfill)).toBe(true)
    })

    it('should mark backfill completion position', async () => {
      const stream = createStream<TestRecord>()

      await stream.startBackfill()
      await stream.backfillInsert({ id: '1', name: 'Existing', value: 1 })
      const backfillEnd = await stream.endBackfill()

      expect(backfillEnd).toBeDefined()
      expect(backfillEnd.sequence).toBeGreaterThan(0)
    })

    it('should differentiate backfill from live changes', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        onChange: async (event) => {
          changes.push(event)
        },
      })

      await stream.startBackfill()
      await stream.backfillInsert({ id: '1', name: 'Backfill', value: 1 })
      await stream.endBackfill()

      await stream.insert({ id: '2', name: 'Live', value: 2 })
      await stream.flush()

      expect(changes[0]!.isBackfill).toBe(true)
      expect(changes[1]!.isBackfill).toBe(false)
    })

    it('should allow resuming backfill from position', async () => {
      const stream = createStream<TestRecord>()

      await stream.startBackfill()
      await stream.backfillInsert({ id: '1', name: 'First', value: 1 })
      const pausePosition = stream.getCurrentPosition()

      // Later: resume from position
      const stream2 = createStream<TestRecord>({
        startPosition: pausePosition,
      })
      await stream2.startBackfill()
      await stream2.backfillInsert({ id: '2', name: 'Second', value: 2 })
      await stream2.endBackfill()

      // Position should continue from pause point
      expect(stream2.getCurrentPosition().sequence).toBeGreaterThan(pausePosition.sequence)
    })
  })

  // ============================================================================
  // FILTERING
  // ============================================================================

  describe('filtering', () => {
    it('should filter changes by predicate', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        filter: (event) => event.after?.value && event.after.value > 50,
        onChange: async (event) => {
          changes.push(event)
        },
      })

      await stream.insert({ id: '1', name: 'Low', value: 10 })
      await stream.insert({ id: '2', name: 'High', value: 100 })
      await stream.insert({ id: '3', name: 'Medium', value: 50 })
      await stream.flush()

      expect(changes).toHaveLength(1)
      expect(changes[0]!.after!.name).toBe('High')
    })

    it('should filter by change type', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        changeTypes: [ChangeType.INSERT, ChangeType.DELETE],
        onChange: async (event) => {
          changes.push(event)
        },
      })

      await stream.insert({ id: '1', name: 'Test', value: 100 })
      await stream.update(
        { id: '1', name: 'Test', value: 100 },
        { id: '1', name: 'Updated', value: 200 }
      )
      await stream.delete({ id: '1', name: 'Updated', value: 200 })
      await stream.flush()

      expect(changes).toHaveLength(2)
      expect(changes.map((c) => c.type)).toEqual([ChangeType.INSERT, ChangeType.DELETE])
    })

    it('should filter by table/collection name', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        tables: ['users', 'orders'],
        onChange: async (event) => {
          changes.push(event)
        },
      })

      await stream.insert({ id: '1', name: 'Test', value: 100 }, { table: 'users' })
      await stream.insert({ id: '2', name: 'Test', value: 200 }, { table: 'products' })
      await stream.insert({ id: '3', name: 'Test', value: 300 }, { table: 'orders' })
      await stream.flush()

      expect(changes).toHaveLength(2)
      expect(changes.map((c) => c.table)).toEqual(['users', 'orders'])
    })
  })

  // ============================================================================
  // TRANSFORMATION
  // ============================================================================

  describe('transformation', () => {
    it('should transform changes before delivery', async () => {
      const changes: ChangeEvent<{ id: string; displayName: string }>[] = []
      const stream = createCDCStream<TestRecord, { id: string; displayName: string }>({
        transform: (event) => ({
          ...event,
          after: event.after ? { id: event.after.id, displayName: event.after.name.toUpperCase() } : null,
        }),
        onChange: async (event) => {
          changes.push(event)
        },
      })

      await stream.insert({ id: '1', name: 'Test', value: 100 })
      await stream.flush()

      expect(changes[0]!.after).toEqual({ id: '1', displayName: 'TEST' })
    })

    it('should enrich changes with metadata', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        enrichMetadata: (event) => ({
          ...event.metadata,
          processedAt: Date.now(),
          source: 'test-stream',
        }),
        onChange: async (event) => {
          changes.push(event)
        },
      })

      await stream.insert({ id: '1', name: 'Test', value: 100 })
      await stream.flush()

      expect(changes[0]!.metadata?.source).toBe('test-stream')
      expect(changes[0]!.metadata?.processedAt).toBeDefined()
    })
  })

  // ============================================================================
  // SCHEMA CHANGES
  // ============================================================================

  describe('schema changes', () => {
    it('should emit schema change event', async () => {
      const schemaChanges: any[] = []
      const stream = createStream<TestRecord>({
        onSchemaChange: async (change) => {
          schemaChanges.push(change)
        },
      })

      await stream.emitSchemaChange({
        type: 'ADD_COLUMN',
        table: 'users',
        column: 'email',
        columnType: 'string',
      })

      expect(schemaChanges).toHaveLength(1)
      expect(schemaChanges[0].type).toBe('ADD_COLUMN')
    })

    it('should handle schema change before and after regular changes', async () => {
      const events: any[] = []
      const stream = createStream<TestRecord>({
        onChange: async (event) => {
          events.push({ type: 'change', event })
        },
        onSchemaChange: async (change) => {
          events.push({ type: 'schema', change })
        },
      })

      await stream.insert({ id: '1', name: 'Before', value: 100 })
      await stream.emitSchemaChange({
        type: 'ADD_COLUMN',
        table: 'users',
        column: 'email',
        columnType: 'string',
      })
      await stream.insert({ id: '2', name: 'After', value: 200 })
      await stream.flush()

      expect(events[0].type).toBe('change')
      expect(events[1].type).toBe('schema')
      expect(events[2].type).toBe('change')
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('error handling', () => {
    it('should retry failed change delivery', async () => {
      let attempts = 0
      const stream = createStream<TestRecord>({
        retryAttempts: 3,
        onChange: async () => {
          attempts++
          if (attempts < 3) throw new Error('Delivery failed')
        },
      })

      await stream.insert({ id: '1', name: 'Test', value: 100 })
      await stream.flush()

      expect(attempts).toBe(3)
    })

    it('should send to dead letter queue after retries exhausted', async () => {
      const dlqEvents: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        retryAttempts: 2,
        onChange: async () => {
          throw new Error('Always fails')
        },
        onDeadLetter: async (event, error) => {
          dlqEvents.push(event)
        },
      })

      await stream.insert({ id: '1', name: 'Test', value: 100 })
      await expect(stream.flush()).resolves.not.toThrow()

      expect(dlqEvents).toHaveLength(1)
    })

    it('should preserve order on retry', async () => {
      const delivered: string[] = []
      let firstFailed = false
      const stream = createStream<TestRecord>({
        retryAttempts: 2,
        onChange: async (event) => {
          if (!firstFailed && event.after?.id === '1') {
            firstFailed = true
            throw new Error('First delivery fails')
          }
          delivered.push(event.after!.id)
        },
      })

      await stream.insert({ id: '1', name: 'First', value: 1 })
      await stream.insert({ id: '2', name: 'Second', value: 2 })
      await stream.flush()

      // Order should be preserved after retry
      expect(delivered).toEqual(['1', '2'])
    })
  })

  // ============================================================================
  // TEMPORAL STORE INTEGRATION
  // ============================================================================

  describe('temporal store integration', () => {
    it('should store change history', async () => {
      const stream = createStream<TestRecord>({
        keepHistory: true,
      })

      await stream.insert({ id: '1', name: 'Original', value: 100 })
      await stream.update(
        { id: '1', name: 'Original', value: 100 },
        { id: '1', name: 'Updated', value: 200 }
      )
      await stream.flush()

      const history = await stream.getChangeHistory('1')
      expect(history).toHaveLength(2)
      expect(history[0].type).toBe(ChangeType.INSERT)
      expect(history[1].type).toBe(ChangeType.UPDATE)
    })

    it('should query state at point in time', async () => {
      const stream = createStream<TestRecord>({
        keepHistory: true,
      })

      const t1 = Date.now()
      await stream.insert({ id: '1', name: 'Original', value: 100 })
      await delay(50)
      const t2 = Date.now()
      await stream.update(
        { id: '1', name: 'Original', value: 100 },
        { id: '1', name: 'Updated', value: 200 }
      )
      await stream.flush()

      const stateAtT1 = await stream.getStateAsOf('1', t1 + 25)
      expect(stateAtT1?.name).toBe('Original')

      const stateAtT2 = await stream.getStateAsOf('1', Date.now())
      expect(stateAtT2?.name).toBe('Updated')
    })
  })

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  describe('lifecycle', () => {
    it('should start and stop stream', async () => {
      const stream = createStream<TestRecord>()

      expect(stream.isRunning()).toBe(false)
      await stream.start()
      expect(stream.isRunning()).toBe(true)
      await stream.stop()
      expect(stream.isRunning()).toBe(false)
    })

    it('should flush on stop', async () => {
      const changes: ChangeEvent<TestRecord>[] = []
      const stream = createStream<TestRecord>({
        batchSize: 100,
        onChange: async (event) => {
          changes.push(event)
        },
      })

      await stream.start()
      await stream.insert({ id: '1', name: 'Test', value: 100 })
      await stream.stop()

      // Should have flushed on stop
      expect(changes).toHaveLength(1)
    })

    it('should cleanup resources on dispose', async () => {
      const stream = createStream<TestRecord>()
      await stream.start()
      await stream.dispose()

      expect(stream.isRunning()).toBe(false)
      // Should not throw on double dispose
      await expect(stream.dispose()).resolves.not.toThrow()
    })
  })

  // ============================================================================
  // STATISTICS
  // ============================================================================

  describe('statistics', () => {
    it('should track change counts by type', async () => {
      const stream = createStream<TestRecord>()

      await stream.insert({ id: '1', name: 'Test', value: 100 })
      await stream.update(
        { id: '1', name: 'Test', value: 100 },
        { id: '1', name: 'Updated', value: 200 }
      )
      await stream.delete({ id: '1', name: 'Updated', value: 200 })
      await stream.flush()

      const stats = stream.getStats()
      expect(stats.insertCount).toBe(1)
      expect(stats.updateCount).toBe(1)
      expect(stats.deleteCount).toBe(1)
      expect(stats.totalChanges).toBe(3)
    })

    it('should track processing latency', async () => {
      const stream = createStream<TestRecord>({
        onChange: async () => {
          await delay(10)
        },
      })

      await stream.insert({ id: '1', name: 'Test', value: 100 })
      await stream.flush()

      const stats = stream.getStats()
      expect(stats.avgProcessingLatencyMs).toBeGreaterThan(0)
    })

    it('should track error counts', async () => {
      const stream = createStream<TestRecord>({
        retryAttempts: 1,
        onChange: async () => {
          throw new Error('Failed')
        },
        onDeadLetter: async () => {},
      })

      await stream.insert({ id: '1', name: 'Test', value: 100 })
      await stream.flush()

      const stats = stream.getStats()
      expect(stats.errorCount).toBeGreaterThan(0)
      expect(stats.deadLetterCount).toBe(1)
    })
  })

  // ============================================================================
  // FACTORY FUNCTION
  // ============================================================================

  describe('factory function', () => {
    it('should create a CDCStream instance', () => {
      const stream = createCDCStream<TestRecord>()
      expect(stream).toBeInstanceOf(CDCStream)
    })

    it('should accept all options', () => {
      const stream = createCDCStream<TestRecord>({
        batchSize: 100,
        batchTimeoutMs: 1000,
        retryAttempts: 5,
        keepHistory: true,
        filter: () => true,
        tables: ['users'],
        changeTypes: [ChangeType.INSERT],
        onChange: async () => {},
        onBatch: async () => {},
        onSchemaChange: async () => {},
        onDeadLetter: async () => {},
      })
      expect(stream).toBeDefined()
    })
  })
})
