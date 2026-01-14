/**
 * Capture tests
 *
 * RED phase: These tests define the expected behavior of change capture.
 * All tests should FAIL until implementation is complete.
 *
 * Capture provides adapters for different data sources:
 * - Database table polling
 * - Transaction log parsing (simulated)
 * - Event stream consumption
 * - Custom source adapters
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createPollingCapture,
  createLogCapture,
  createEventCapture,
  type CaptureAdapter,
  type PollingCaptureOptions,
  type LogCaptureOptions,
  type EventCaptureOptions,
  type CapturedChange,
} from '../capture'
import { ChangeType } from '../stream'

// ============================================================================
// TEST HELPERS
// ============================================================================

interface TestRecord {
  id: string
  name: string
  value: number
  updatedAt: number
}

function createMockDataSource() {
  const data = new Map<string, TestRecord>()
  return {
    data,
    async get(id: string) {
      return data.get(id) ?? null
    },
    async list() {
      return [...data.values()]
    },
    async set(record: TestRecord) {
      data.set(record.id, record)
    },
    async delete(id: string) {
      data.delete(id)
    },
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// POLLING CAPTURE
// ============================================================================

describe('PollingCapture', () => {
  describe('basic polling', () => {
    it('should detect new records', async () => {
      const source = createMockDataSource()
      const changes: CapturedChange<TestRecord>[] = []

      const capture = createPollingCapture<TestRecord>({
        source: {
          list: async () => source.list(),
          getKey: (r) => r.id,
          getTimestamp: (r) => r.updatedAt,
        },
        pollIntervalMs: 50,
        onChange: async (change) => {
          changes.push(change)
        },
      })

      await capture.start()
      await source.set({ id: '1', name: 'Test', value: 100, updatedAt: Date.now() })
      await delay(100)
      await capture.stop()

      expect(changes).toHaveLength(1)
      expect(changes[0]!.type).toBe(ChangeType.INSERT)
    })

    it('should detect updated records', async () => {
      const source = createMockDataSource()
      const changes: CapturedChange<TestRecord>[] = []

      // Pre-populate
      await source.set({ id: '1', name: 'Original', value: 100, updatedAt: Date.now() - 1000 })

      const capture = createPollingCapture<TestRecord>({
        source: {
          list: async () => source.list(),
          getKey: (r) => r.id,
          getTimestamp: (r) => r.updatedAt,
        },
        pollIntervalMs: 50,
        onChange: async (change) => {
          changes.push(change)
        },
      })

      await capture.start()
      await delay(60) // First poll

      // Update
      await source.set({ id: '1', name: 'Updated', value: 200, updatedAt: Date.now() })
      await delay(100)
      await capture.stop()

      const updateChanges = changes.filter((c) => c.type === ChangeType.UPDATE)
      expect(updateChanges.length).toBeGreaterThanOrEqual(1)
    })

    it('should detect deleted records', async () => {
      const source = createMockDataSource()
      const changes: CapturedChange<TestRecord>[] = []

      // Pre-populate
      await source.set({ id: '1', name: 'ToDelete', value: 100, updatedAt: Date.now() - 1000 })

      const capture = createPollingCapture<TestRecord>({
        source: {
          list: async () => source.list(),
          getKey: (r) => r.id,
          getTimestamp: (r) => r.updatedAt,
        },
        pollIntervalMs: 50,
        onChange: async (change) => {
          changes.push(change)
        },
      })

      await capture.start()
      await delay(60) // First poll

      // Delete
      await source.delete('1')
      await delay(100)
      await capture.stop()

      const deleteChanges = changes.filter((c) => c.type === ChangeType.DELETE)
      expect(deleteChanges.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('incremental polling', () => {
    it('should only fetch records after watermark', async () => {
      const source = createMockDataSource()
      let listCalls = 0

      const capture = createPollingCapture<TestRecord>({
        source: {
          list: async (options) => {
            listCalls++
            const records = await source.list()
            if (options?.since) {
              return records.filter((r) => r.updatedAt > options.since!)
            }
            return records
          },
          getKey: (r) => r.id,
          getTimestamp: (r) => r.updatedAt,
        },
        pollIntervalMs: 50,
        incremental: true,
        onChange: async () => {},
      })

      await source.set({ id: '1', name: 'Old', value: 100, updatedAt: Date.now() - 10000 })

      await capture.start()
      await delay(150) // Multiple polls
      await capture.stop()

      // After first poll, subsequent polls should use watermark
      expect(listCalls).toBeGreaterThan(1)
    })

    it('should track watermark across restarts', async () => {
      const source = createMockDataSource()
      const watermark1 = Date.now() - 5000

      // Add a record newer than the watermark
      await source.set({ id: '1', name: 'Test', value: 100, updatedAt: Date.now() })

      const capture = createPollingCapture<TestRecord>({
        source: {
          list: async () => source.list(),
          getKey: (r) => r.id,
          getTimestamp: (r) => r.updatedAt,
        },
        pollIntervalMs: 50,
        startWatermark: watermark1,
        onChange: async () => {},
      })

      await capture.start()
      await delay(60)

      const checkpoint = await capture.getCheckpoint()
      await capture.stop()

      expect(checkpoint.watermark).toBeGreaterThan(watermark1)
    })
  })

  describe('snapshot isolation', () => {
    it('should provide consistent snapshot during poll', async () => {
      const source = createMockDataSource()
      const snapshots: TestRecord[][] = []

      const capture = createPollingCapture<TestRecord>({
        source: {
          list: async () => {
            const records = await source.list()
            snapshots.push([...records])
            return records
          },
          getKey: (r) => r.id,
          getTimestamp: (r) => r.updatedAt,
        },
        pollIntervalMs: 100,
        onChange: async () => {},
      })

      await source.set({ id: '1', name: 'Initial', value: 100, updatedAt: Date.now() })
      await capture.start()
      await delay(50) // During first poll

      // Modify while polling
      await source.set({ id: '2', name: 'During', value: 200, updatedAt: Date.now() })
      await delay(150)
      await capture.stop()

      // First snapshot should not include concurrent modification
      expect(snapshots[0]!.length).toBe(1)
    })
  })

  describe('error handling', () => {
    it('should retry on transient errors', async () => {
      let attempts = 0
      const capture = createPollingCapture<TestRecord>({
        source: {
          list: async () => {
            attempts++
            if (attempts < 3) {
              throw new Error('Transient error')
            }
            return []
          },
          getKey: (r) => r.id,
          getTimestamp: (r) => r.updatedAt,
        },
        pollIntervalMs: 50,
        retryAttempts: 3,
        onChange: async () => {},
      })

      await capture.start()
      await delay(200)
      await capture.stop()

      expect(attempts).toBeGreaterThanOrEqual(3)
    })

    it('should emit error events', async () => {
      const errors: Error[] = []
      let pollCount = 0
      const capture = createPollingCapture<TestRecord>({
        source: {
          list: async () => {
            pollCount++
            if (pollCount <= 2) {
              throw new Error('Poll error')
            }
            return [] // Return empty after errors to prevent further errors
          },
          getKey: (r) => r.id,
          getTimestamp: (r) => r.updatedAt,
        },
        pollIntervalMs: 50,
        retryAttempts: 1,
        onError: async (error) => {
          errors.push(error)
        },
        onChange: async () => {},
      })

      await capture.start()
      await delay(200)
      await capture.stop()

      expect(errors.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// LOG CAPTURE (Transaction Log Parsing)
// ============================================================================

describe('LogCapture', () => {
  describe('log parsing', () => {
    it('should parse insert log entries', async () => {
      const changes: CapturedChange<TestRecord>[] = []
      const mockLog = vi.fn()

      const capture = createLogCapture<TestRecord>({
        parser: {
          parse: (entry) => ({
            type: ChangeType.INSERT,
            key: entry.id,
            after: entry.data,
            timestamp: entry.ts,
          }),
        },
        onLogEntry: mockLog,
        onChange: async (change) => {
          changes.push(change)
        },
      })

      await capture.start()
      await capture.ingestLogEntry({
        id: '1',
        data: { id: '1', name: 'Test', value: 100, updatedAt: Date.now() },
        ts: Date.now(),
      })
      await capture.stop()

      expect(changes).toHaveLength(1)
      expect(changes[0]!.type).toBe(ChangeType.INSERT)
    })

    it('should parse update log entries with before/after', async () => {
      const changes: CapturedChange<TestRecord>[] = []

      const capture = createLogCapture<TestRecord>({
        parser: {
          parse: (entry) => ({
            type: ChangeType.UPDATE,
            key: entry.id,
            before: entry.before,
            after: entry.after,
            timestamp: entry.ts,
          }),
        },
        onChange: async (change) => {
          changes.push(change)
        },
      })

      await capture.start()
      await capture.ingestLogEntry({
        id: '1',
        before: { id: '1', name: 'Original', value: 100, updatedAt: 1000 },
        after: { id: '1', name: 'Updated', value: 200, updatedAt: 2000 },
        ts: Date.now(),
      })
      await capture.stop()

      expect(changes[0]!.before).toBeDefined()
      expect(changes[0]!.after).toBeDefined()
    })

    it('should track log sequence number (LSN)', async () => {
      const capture = createLogCapture<TestRecord>({
        parser: {
          parse: (entry) => ({
            type: ChangeType.INSERT,
            key: entry.id,
            after: entry.data,
            timestamp: entry.ts,
            lsn: entry.lsn,
          }),
        },
        onChange: async () => {},
      })

      await capture.start()
      await capture.ingestLogEntry({ id: '1', data: {}, ts: Date.now(), lsn: '000000001' })
      await capture.ingestLogEntry({ id: '2', data: {}, ts: Date.now(), lsn: '000000002' })

      const checkpoint = await capture.getCheckpoint()
      expect(checkpoint.lsn).toBe('000000002')
      await capture.stop()
    })
  })

  describe('resumption', () => {
    it('should resume from LSN', async () => {
      const changes: CapturedChange<TestRecord>[] = []
      const capture = createLogCapture<TestRecord>({
        startLsn: '000000005',
        parser: {
          parse: (entry) => ({
            type: ChangeType.INSERT,
            key: entry.id,
            after: entry.data,
            timestamp: entry.ts,
            lsn: entry.lsn,
          }),
        },
        onChange: async (change) => {
          changes.push(change)
        },
      })

      await capture.start()
      // These should be skipped (LSN before start)
      await capture.ingestLogEntry({ id: '1', data: {}, ts: Date.now(), lsn: '000000003' })
      await capture.ingestLogEntry({ id: '2', data: {}, ts: Date.now(), lsn: '000000004' })
      // This should be captured
      await capture.ingestLogEntry({ id: '3', data: {}, ts: Date.now(), lsn: '000000006' })
      await capture.stop()

      expect(changes).toHaveLength(1)
      expect(changes[0]!.lsn).toBe('000000006')
    })
  })

  describe('transaction boundaries', () => {
    it('should group changes by transaction', async () => {
      const transactions: CapturedChange<TestRecord>[][] = []
      const capture = createLogCapture<TestRecord>({
        parser: {
          parse: (entry) => ({
            type: ChangeType.INSERT,
            key: entry.id,
            after: entry.data,
            timestamp: entry.ts,
            transactionId: entry.txId,
          }),
        },
        groupByTransaction: true,
        onTransaction: async (changes) => {
          transactions.push([...changes])
        },
        onChange: async () => {},
      })

      await capture.start()
      await capture.ingestLogEntry({ id: '1', data: {}, ts: Date.now(), txId: 'tx-1' })
      await capture.ingestLogEntry({ id: '2', data: {}, ts: Date.now(), txId: 'tx-1' })
      await capture.commitTransaction('tx-1')
      await capture.stop()

      expect(transactions).toHaveLength(1)
      expect(transactions[0]).toHaveLength(2)
    })

    it('should rollback uncommitted transactions', async () => {
      const changes: CapturedChange<TestRecord>[] = []
      const capture = createLogCapture<TestRecord>({
        parser: {
          parse: (entry) => ({
            type: ChangeType.INSERT,
            key: entry.id,
            after: entry.data,
            timestamp: entry.ts,
            transactionId: entry.txId,
          }),
        },
        groupByTransaction: true,
        onChange: async (change) => {
          changes.push(change)
        },
      })

      await capture.start()
      await capture.ingestLogEntry({ id: '1', data: {}, ts: Date.now(), txId: 'tx-1' })
      await capture.rollbackTransaction('tx-1')
      await capture.stop()

      expect(changes).toHaveLength(0)
    })
  })
})

// ============================================================================
// EVENT CAPTURE (Event Stream Consumption)
// ============================================================================

describe('EventCapture', () => {
  describe('event consumption', () => {
    it('should capture events from stream', async () => {
      const changes: CapturedChange<TestRecord>[] = []
      const capture = createEventCapture<TestRecord>({
        eventMapper: (event) => ({
          type: event.eventType === 'created' ? ChangeType.INSERT : ChangeType.UPDATE,
          key: event.entityId,
          after: event.payload,
          timestamp: event.timestamp,
        }),
        onChange: async (change) => {
          changes.push(change)
        },
      })

      await capture.start()
      await capture.ingestEvent({
        eventType: 'created',
        entityId: '1',
        payload: { id: '1', name: 'Test', value: 100, updatedAt: Date.now() },
        timestamp: Date.now(),
      })
      await capture.stop()

      expect(changes).toHaveLength(1)
      expect(changes[0]!.type).toBe(ChangeType.INSERT)
    })

    it('should handle out-of-order events', async () => {
      const changes: CapturedChange<TestRecord>[] = []
      const capture = createEventCapture<TestRecord>({
        eventMapper: (event) => ({
          type: ChangeType.INSERT,
          key: event.entityId,
          after: event.payload,
          timestamp: event.timestamp,
        }),
        allowOutOfOrder: true,
        onChange: async (change) => {
          changes.push(change)
        },
      })

      await capture.start()
      const now = Date.now()
      await capture.ingestEvent({ entityId: '2', payload: {}, timestamp: now + 100 })
      await capture.ingestEvent({ entityId: '1', payload: {}, timestamp: now })
      await capture.stop()

      // Both should be captured even though order is reversed
      expect(changes).toHaveLength(2)
    })

    it('should deduplicate events by eventId', async () => {
      const changes: CapturedChange<TestRecord>[] = []
      const capture = createEventCapture<TestRecord>({
        eventMapper: (event) => ({
          type: ChangeType.INSERT,
          key: event.entityId,
          after: event.payload,
          timestamp: event.timestamp,
          eventId: event.eventId,
        }),
        deduplicate: true,
        onChange: async (change) => {
          changes.push(change)
        },
      })

      await capture.start()
      await capture.ingestEvent({ eventId: 'evt-1', entityId: '1', payload: {}, timestamp: Date.now() })
      await capture.ingestEvent({ eventId: 'evt-1', entityId: '1', payload: {}, timestamp: Date.now() }) // Duplicate
      await capture.stop()

      expect(changes).toHaveLength(1)
    })
  })

  describe('partitioned consumption', () => {
    it('should maintain order within partition', async () => {
      const changes: CapturedChange<TestRecord>[] = []
      const capture = createEventCapture<TestRecord>({
        eventMapper: (event) => ({
          type: ChangeType.INSERT,
          key: event.entityId,
          after: event.payload,
          timestamp: event.timestamp,
          partition: event.partition,
        }),
        orderedWithinPartition: true,
        onChange: async (change) => {
          changes.push(change)
        },
      })

      await capture.start()
      await capture.ingestEvent({ entityId: '1', payload: { order: 1 }, timestamp: 1, partition: 'p1' })
      await capture.ingestEvent({ entityId: '2', payload: { order: 2 }, timestamp: 2, partition: 'p1' })
      await capture.stop()

      const p1Changes = changes.filter((c) => c.partition === 'p1')
      expect(p1Changes[0]!.after!.order).toBe(1)
      expect(p1Changes[1]!.after!.order).toBe(2)
    })

    it('should track offset per partition', async () => {
      const capture = createEventCapture<TestRecord>({
        eventMapper: (event) => ({
          type: ChangeType.INSERT,
          key: event.entityId,
          after: event.payload,
          timestamp: event.timestamp,
          partition: event.partition,
          offset: event.offset,
        }),
        onChange: async () => {},
      })

      await capture.start()
      await capture.ingestEvent({ entityId: '1', payload: {}, timestamp: 1, partition: 'p1', offset: 10 })
      await capture.ingestEvent({ entityId: '2', payload: {}, timestamp: 2, partition: 'p2', offset: 20 })

      const checkpoint = await capture.getCheckpoint()
      expect(checkpoint.partitionOffsets['p1']).toBe(10)
      expect(checkpoint.partitionOffsets['p2']).toBe(20)
      await capture.stop()
    })
  })

  describe('backpressure', () => {
    it('should handle backpressure', async () => {
      let processedCount = 0
      const capture = createEventCapture<TestRecord>({
        eventMapper: (event) => ({
          type: ChangeType.INSERT,
          key: event.entityId,
          after: event.payload,
          timestamp: event.timestamp,
        }),
        maxBufferSize: 5,
        onChange: async () => {
          processedCount++
          await delay(10)
        },
      })

      await capture.start()

      // Rapidly ingest many events
      const ingestPromises = []
      for (let i = 0; i < 20; i++) {
        ingestPromises.push(
          capture.ingestEvent({ entityId: `${i}`, payload: {}, timestamp: Date.now() })
        )
      }

      await Promise.all(ingestPromises)
      await capture.stop()

      // All should eventually be processed
      expect(processedCount).toBe(20)
    })
  })
})

// ============================================================================
// CUSTOM CAPTURE ADAPTER
// ============================================================================

describe('Custom CaptureAdapter', () => {
  it('should support custom adapter implementation', async () => {
    const changes: CapturedChange<TestRecord>[] = []

    class CustomAdapter implements CaptureAdapter<TestRecord> {
      private running = false
      private onChange: (change: CapturedChange<TestRecord>) => Promise<void>

      constructor(options: { onChange: (change: CapturedChange<TestRecord>) => Promise<void> }) {
        this.onChange = options.onChange
      }

      async start(): Promise<void> {
        this.running = true
      }

      async stop(): Promise<void> {
        this.running = false
      }

      async getCheckpoint() {
        return { position: 0 }
      }

      isRunning(): boolean {
        return this.running
      }

      async emit(record: TestRecord, type: ChangeType): Promise<void> {
        await this.onChange({
          type,
          key: record.id,
          before: type === ChangeType.DELETE ? record : null,
          after: type === ChangeType.DELETE ? null : record,
          timestamp: Date.now(),
        })
      }
    }

    const adapter = new CustomAdapter({
      onChange: async (change) => {
        changes.push(change)
      },
    })

    await adapter.start()
    await adapter.emit({ id: '1', name: 'Test', value: 100, updatedAt: Date.now() }, ChangeType.INSERT)
    await adapter.stop()

    expect(changes).toHaveLength(1)
  })
})
