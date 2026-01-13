/**
 * SnapshotManager tests
 *
 * TDD approach: These tests define the expected behavior of SnapshotManager.
 *
 * SnapshotManager handles:
 * - Initial snapshot capture for tables
 * - Chunk-based scanning for large tables
 * - Consistent cutover to live streaming
 * - Crash recovery with resumable snapshots
 * - Memory-bounded streaming
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SnapshotManager,
  createSnapshotManager,
  type SnapshotOptions,
  type SnapshotState,
  type SnapshotProgress,
  type TableScanner,
  type SnapshotEvent,
  SnapshotPhase,
} from '../snapshot-manager'
import { ChangeType, type ChangeEvent } from '../stream'

// ============================================================================
// TEST HELPERS
// ============================================================================

interface TestRecord {
  id: string
  name: string
  value: number
  updatedAt?: number
}

/** Create a mock table scanner for testing */
function createMockScanner(
  records: TestRecord[],
  options?: {
    failAfter?: number
    delayMs?: number
  }
): TableScanner<TestRecord> {
  let recordsRead = 0
  return {
    getTableName: () => 'test_table',
    getRowCount: async () => records.length,
    getPrimaryKey: (record) => record.id,
    scanChunk: async (cursor, chunkSize) => {
      if (options?.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      }
      if (options?.failAfter !== undefined && recordsRead >= options.failAfter) {
        throw new Error('Simulated scanner failure')
      }
      const startIndex = cursor ? records.findIndex((r) => r.id > cursor) : 0
      if (startIndex === -1) {
        return { records: [], nextCursor: null, hasMore: false }
      }
      const chunk = records.slice(startIndex, startIndex + chunkSize)
      recordsRead += chunk.length
      const lastRecord = chunk[chunk.length - 1]
      const hasMore = startIndex + chunkSize < records.length
      return {
        records: chunk,
        nextCursor: hasMore && lastRecord ? lastRecord.id : null,
        hasMore,
      }
    },
  }
}

/** Generate test records */
function generateRecords(count: number): TestRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1).padStart(6, '0'),
    name: `Record ${i + 1}`,
    value: i * 10,
    updatedAt: Date.now() - (count - i) * 1000,
  }))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// SNAPSHOT CHUNKING
// ============================================================================

describe('SnapshotManager', () => {
  describe('snapshot chunking with various table sizes', () => {
    it('should snapshot empty table', async () => {
      const events: SnapshotEvent<TestRecord>[] = []
      const scanner = createMockScanner([])
      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        onSnapshot: async (event) => {
          events.push(event)
        },
      })

      await manager.start()
      await manager.waitForCompletion()

      expect(events).toHaveLength(0)
      expect(manager.getProgress().phase).toBe(SnapshotPhase.COMPLETED)
      expect(manager.getProgress().totalRows).toBe(0)
    })

    it('should snapshot small table in single chunk', async () => {
      const events: SnapshotEvent<TestRecord>[] = []
      const records = generateRecords(50)
      const scanner = createMockScanner(records)
      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        onSnapshot: async (event) => {
          events.push(event)
        },
      })

      await manager.start()
      await manager.waitForCompletion()

      expect(events).toHaveLength(50)
      expect(events.every((e) => e.type === ChangeType.INSERT)).toBe(true)
      expect(events.every((e) => e.isSnapshot)).toBe(true)
    })

    it('should snapshot large table in multiple chunks', async () => {
      const events: SnapshotEvent<TestRecord>[] = []
      const records = generateRecords(250)
      const scanner = createMockScanner(records)
      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        onSnapshot: async (event) => {
          events.push(event)
        },
      })

      await manager.start()
      await manager.waitForCompletion()

      expect(events).toHaveLength(250)
      // Verify records are in order
      for (let i = 0; i < events.length - 1; i++) {
        expect(events[i]!.record.id < events[i + 1]!.record.id).toBe(true)
      }
    })

    it('should respect chunk size configuration', async () => {
      const chunks: number[] = []
      const records = generateRecords(250)
      const scanner = createMockScanner(records)
      let currentChunk = 0
      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 75,
        onChunkComplete: async (chunkInfo) => {
          chunks.push(chunkInfo.recordsInChunk)
          currentChunk++
        },
        onSnapshot: async () => {},
      })

      await manager.start()
      await manager.waitForCompletion()

      // 250 records / 75 per chunk = 4 chunks (75 + 75 + 75 + 25)
      expect(chunks).toHaveLength(4)
      expect(chunks[0]).toBe(75)
      expect(chunks[1]).toBe(75)
      expect(chunks[2]).toBe(75)
      expect(chunks[3]).toBe(25)
    })

    it('should handle very large tables with small chunks', async () => {
      const events: SnapshotEvent<TestRecord>[] = []
      const records = generateRecords(1000)
      const scanner = createMockScanner(records)
      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 50,
        onSnapshot: async (event) => {
          events.push(event)
        },
      })

      await manager.start()
      await manager.waitForCompletion()

      expect(events).toHaveLength(1000)
      expect(manager.getProgress().chunksCompleted).toBe(20) // 1000 / 50
    })
  })

  // ============================================================================
  // CONSISTENT CUTOVER
  // ============================================================================

  describe('consistent cutover (no gaps, no duplicates)', () => {
    it('should capture WAL position before starting snapshot', async () => {
      const records = generateRecords(100)
      const scanner = createMockScanner(records)
      const walPosition = 'wal-12345'

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 50,
        initialWalPosition: walPosition,
        onSnapshot: async () => {},
      })

      await manager.start()
      const state = manager.getState()

      expect(state.walPositionAtStart).toBe(walPosition)
    })

    it('should emit snapshot events as synthetic INSERTs', async () => {
      const events: SnapshotEvent<TestRecord>[] = []
      const records = generateRecords(10)
      const scanner = createMockScanner(records)
      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        onSnapshot: async (event) => {
          events.push(event)
        },
      })

      await manager.start()
      await manager.waitForCompletion()

      expect(events.every((e) => e.type === ChangeType.INSERT)).toBe(true)
      expect(events.every((e) => e.before === null)).toBe(true)
      expect(events.every((e) => e.after !== null)).toBe(true)
    })

    it('should mark snapshot completion with cutover position', async () => {
      const records = generateRecords(100)
      const scanner = createMockScanner(records)
      const walPosition = 'wal-start'

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 50,
        initialWalPosition: walPosition,
        onSnapshot: async () => {},
      })

      await manager.start()
      await manager.waitForCompletion()

      const cutover = manager.getCutoverInfo()
      expect(cutover).toBeDefined()
      expect(cutover!.snapshotCompleteAt).toBeDefined()
      expect(cutover!.walPositionAtStart).toBe(walPosition)
      expect(cutover!.totalRowsSnapshot).toBe(100)
    })

    it('should track all snapshot record IDs for deduplication', async () => {
      const records = generateRecords(50)
      const scanner = createMockScanner(records)
      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        trackRecordIds: true,
        onSnapshot: async () => {},
      })

      await manager.start()
      await manager.waitForCompletion()

      const snapshotIds = manager.getSnapshotRecordIds()
      expect(snapshotIds.size).toBe(50)
      records.forEach((r) => {
        expect(snapshotIds.has(r.id)).toBe(true)
      })
    })

    it('should support filtering live events by snapshot cutover', async () => {
      const snapshotRecords = generateRecords(10)
      const scanner = createMockScanner(snapshotRecords)
      const walPosition = 'wal-100'

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        initialWalPosition: walPosition,
        trackRecordIds: true,
        onSnapshot: async () => {},
      })

      await manager.start()
      await manager.waitForCompletion()

      // Simulate live events that came after snapshot started
      const liveEvent1 = { id: '000001', lsn: 'wal-101' } // Exists in snapshot, after start
      const liveEvent2 = { id: '999999', lsn: 'wal-101' } // Does not exist in snapshot

      // Event for existing record should be filtered if LSN < cutover
      expect(manager.shouldFilterLiveEvent(liveEvent1.id, liveEvent1.lsn)).toBe(true)
      // Event for new record should pass through
      expect(manager.shouldFilterLiveEvent(liveEvent2.id, liveEvent2.lsn)).toBe(false)
    })

    it('should provide deterministic ordering at cutover boundary', async () => {
      const events: SnapshotEvent<TestRecord>[] = []
      const records = generateRecords(20)
      const scanner = createMockScanner(records)
      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 10,
        onSnapshot: async (event) => {
          events.push(event)
        },
      })

      await manager.start()
      await manager.waitForCompletion()

      // Verify all events have monotonically increasing sequence numbers
      for (let i = 0; i < events.length - 1; i++) {
        expect(events[i]!.sequence < events[i + 1]!.sequence).toBe(true)
      }
    })
  })

  // ============================================================================
  // SNAPSHOT RESUME AFTER CRASH
  // ============================================================================

  describe('snapshot resume after simulated crash', () => {
    it('should persist snapshot state for recovery', async () => {
      const records = generateRecords(100)
      const scanner = createMockScanner(records)
      let savedState: SnapshotState | null = null

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 50,
        onStateChange: async (state) => {
          savedState = state
        },
        onSnapshot: async () => {},
      })

      await manager.start()
      await manager.waitForCompletion()

      expect(savedState).toBeDefined()
      expect(savedState!.phase).toBe(SnapshotPhase.COMPLETED)
    })

    it('should save checkpoint after each chunk', async () => {
      const records = generateRecords(150)
      const scanner = createMockScanner(records)
      const checkpoints: SnapshotState[] = []

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 50,
        onStateChange: async (state) => {
          checkpoints.push({ ...state })
        },
        onSnapshot: async () => {},
      })

      await manager.start()
      await manager.waitForCompletion()

      // Should have checkpoint after each chunk + final
      expect(checkpoints.length).toBeGreaterThanOrEqual(3)
      // Each checkpoint should have increasing progress
      for (let i = 1; i < checkpoints.length; i++) {
        expect(checkpoints[i]!.rowsProcessed >= checkpoints[i - 1]!.rowsProcessed).toBe(true)
      }
    })

    it('should resume snapshot from saved cursor', async () => {
      const records = generateRecords(100)
      const events1: SnapshotEvent<TestRecord>[] = []
      const events2: SnapshotEvent<TestRecord>[] = []

      // First manager - simulate crash after 50 records
      const scanner1 = createMockScanner(records, { failAfter: 50 })
      let crashState: SnapshotState | null = null

      const manager1 = createSnapshotManager<TestRecord>({
        scanner: scanner1,
        chunkSize: 25,
        onStateChange: async (state) => {
          crashState = { ...state }
        },
        onSnapshot: async (event) => {
          events1.push(event)
        },
      })

      await manager1.start()
      try {
        await manager1.waitForCompletion()
      } catch {
        // Expected to fail
      }

      expect(events1.length).toBeGreaterThan(0)
      expect(events1.length).toBeLessThan(100)

      // Second manager - resume from saved state
      const scanner2 = createMockScanner(records)
      const manager2 = createSnapshotManager<TestRecord>({
        scanner: scanner2,
        chunkSize: 25,
        resumeFrom: crashState!,
        onSnapshot: async (event) => {
          events2.push(event)
        },
      })

      await manager2.start()
      await manager2.waitForCompletion()

      // Combined events should cover all records without duplicates
      const allIds = new Set([
        ...events1.map((e) => e.record.id),
        ...events2.map((e) => e.record.id),
      ])
      expect(allIds.size).toBe(100)
    })

    it('should track processed record IDs for deduplication on resume', async () => {
      const records = generateRecords(80)
      let savedState: SnapshotState | null = null

      // First run - process 40 records
      const scanner1 = createMockScanner(records, { failAfter: 40 })
      const manager1 = createSnapshotManager<TestRecord>({
        scanner: scanner1,
        chunkSize: 20,
        trackRecordIds: true,
        onStateChange: async (state) => {
          savedState = { ...state }
        },
        onSnapshot: async () => {},
      })

      await manager1.start()
      try {
        await manager1.waitForCompletion()
      } catch {
        // Expected
      }

      expect(savedState).toBeDefined()
      expect(savedState!.processedRecordIds?.length).toBeGreaterThan(0)
    })

    it('should handle resume with no remaining records', async () => {
      const records = generateRecords(50)
      const scanner = createMockScanner(records)

      // Create state as if snapshot was interrupted just before completion
      const resumeState: SnapshotState = {
        phase: SnapshotPhase.SCANNING,
        tableName: 'test_table',
        cursor: '000050', // Past last record
        rowsProcessed: 50,
        totalRows: 50,
        chunksCompleted: 1,
        walPositionAtStart: 'wal-1',
        startedAt: Date.now() - 1000,
      }

      const events: SnapshotEvent<TestRecord>[] = []
      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        resumeFrom: resumeState,
        onSnapshot: async (event) => {
          events.push(event)
        },
      })

      await manager.start()
      await manager.waitForCompletion()

      expect(events).toHaveLength(0) // No new records to process
      expect(manager.getProgress().phase).toBe(SnapshotPhase.COMPLETED)
    })
  })

  // ============================================================================
  // CONCURRENT DML DURING SNAPSHOT
  // ============================================================================

  describe('concurrent DML during snapshot', () => {
    it('should handle updates to already-snapshotted records', async () => {
      const records = generateRecords(10)
      const snapshotIds = new Set<string>()
      const scanner = createMockScanner(records)

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        trackRecordIds: true,
        onSnapshot: async (event) => {
          snapshotIds.add(event.record.id)
        },
      })

      await manager.start()
      await manager.waitForCompletion()

      // Simulate an UPDATE event for a record that was in snapshot
      const updateEvent = {
        id: '000001',
        lsn: 'wal-after-snapshot',
      }

      // Since record was in snapshot, live event should be processed
      // (the cutover logic handles which version wins)
      expect(manager.wasRecordSnapshotted('000001')).toBe(true)
    })

    it('should handle deletes to already-snapshotted records', async () => {
      const records = generateRecords(10)
      const scanner = createMockScanner(records)

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        trackRecordIds: true,
        onSnapshot: async () => {},
      })

      await manager.start()
      await manager.waitForCompletion()

      // Record was in snapshot, delete should be applied
      expect(manager.wasRecordSnapshotted('000005')).toBe(true)
    })

    it('should handle inserts for new records during snapshot', async () => {
      const records = generateRecords(10)
      const scanner = createMockScanner(records)

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        trackRecordIds: true,
        onSnapshot: async () => {},
      })

      await manager.start()
      await manager.waitForCompletion()

      // New record not in snapshot should pass through
      expect(manager.wasRecordSnapshotted('999999')).toBe(false)
    })

    it('should track WAL position for ordering concurrent events', async () => {
      const records = generateRecords(50)
      const scanner = createMockScanner(records, { delayMs: 5 })
      const walPosition = 'wal-1000'

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 25,
        initialWalPosition: walPosition,
        onSnapshot: async () => {},
      })

      await manager.start()

      // During snapshot, WAL position should be tracked
      const state = manager.getState()
      expect(state.walPositionAtStart).toBe(walPosition)

      await manager.waitForCompletion()
    })

    it('should support pause/resume for maintenance window', async () => {
      const events: SnapshotEvent<TestRecord>[] = []
      const records = generateRecords(100)
      const scanner = createMockScanner(records, { delayMs: 5 })

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 20,
        onSnapshot: async (event) => {
          events.push(event)
        },
      })

      await manager.start()

      // Pause after some records
      await delay(30)
      await manager.pause()

      const pausedCount = events.length
      expect(pausedCount).toBeGreaterThan(0)
      expect(pausedCount).toBeLessThan(100)
      expect(manager.getProgress().phase).toBe(SnapshotPhase.PAUSED)

      // Resume and complete
      await manager.resume()
      await manager.waitForCompletion()

      expect(events.length).toBe(100)
    })
  })

  // ============================================================================
  // MEMORY-BOUNDED STREAMING
  // ============================================================================

  describe('memory-bounded streaming of large tables', () => {
    it('should process records without loading entire table in memory', async () => {
      // Track max concurrent records in memory
      let currentInFlight = 0
      let maxInFlight = 0

      const records = generateRecords(500)
      const scanner = createMockScanner(records)

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 50,
        maxInFlightRecords: 100,
        onSnapshot: async () => {
          currentInFlight++
          maxInFlight = Math.max(maxInFlight, currentInFlight)
          await delay(1) // Simulate processing time
          currentInFlight--
        },
      })

      await manager.start()
      await manager.waitForCompletion()

      // Max in-flight should be bounded
      expect(maxInFlight).toBeLessThanOrEqual(100)
    })

    it('should apply backpressure when consumer is slow', async () => {
      const records = generateRecords(200)
      const scanner = createMockScanner(records)
      const processedTimestamps: number[] = []

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 50,
        maxInFlightRecords: 10, // Very low limit
        onSnapshot: async () => {
          processedTimestamps.push(Date.now())
          await delay(10) // Slow consumer
        },
      })

      const startTime = Date.now()
      await manager.start()
      await manager.waitForCompletion()
      const totalTime = Date.now() - startTime

      // With backpressure, processing should take longer than without
      // 200 records * 10ms each / 10 concurrent = ~200ms minimum
      expect(totalTime).toBeGreaterThan(100)
    })

    it('should report memory usage statistics', async () => {
      const records = generateRecords(300)
      const scanner = createMockScanner(records)

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        maxInFlightRecords: 50,
        onSnapshot: async () => {},
      })

      await manager.start()
      await manager.waitForCompletion()

      const stats = manager.getStats()
      expect(stats).toBeDefined()
      expect(stats.peakInFlightRecords).toBeDefined()
      expect(stats.peakInFlightRecords).toBeLessThanOrEqual(100)
    })

    it('should support configurable buffer size', async () => {
      const records = generateRecords(100)
      const scanner = createMockScanner(records)

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 25,
        maxInFlightRecords: 30, // Custom buffer size
        onSnapshot: async () => {},
      })

      await manager.start()
      await manager.waitForCompletion()

      // Should complete without OOM
      expect(manager.getProgress().rowsProcessed).toBe(100)
    })

    it('should emit progress events for monitoring', async () => {
      const progressEvents: SnapshotProgress[] = []
      const records = generateRecords(200)
      const scanner = createMockScanner(records)

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 50,
        onProgress: async (progress) => {
          progressEvents.push({ ...progress })
        },
        onSnapshot: async () => {},
      })

      await manager.start()
      await manager.waitForCompletion()

      expect(progressEvents.length).toBeGreaterThan(0)
      // Should have progress at chunk boundaries
      const percentages = progressEvents.map((p) => p.percentComplete)
      expect(percentages[percentages.length - 1]).toBe(100)
    })
  })

  // ============================================================================
  // FACTORY AND CONFIGURATION
  // ============================================================================

  describe('factory function', () => {
    it('should create SnapshotManager instance', () => {
      const scanner = createMockScanner([])
      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        onSnapshot: async () => {},
      })
      expect(manager).toBeInstanceOf(SnapshotManager)
    })

    it('should accept all configuration options', () => {
      const scanner = createMockScanner([])
      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        maxInFlightRecords: 50,
        initialWalPosition: 'wal-123',
        trackRecordIds: true,
        onSnapshot: async () => {},
        onChunkComplete: async () => {},
        onStateChange: async () => {},
        onProgress: async () => {},
        onError: async () => {},
      })
      expect(manager).toBeDefined()
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('error handling', () => {
    it('should handle scanner errors gracefully', async () => {
      const records = generateRecords(100)
      const scanner = createMockScanner(records, { failAfter: 30 })
      let error: Error | null = null

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 50,
        onSnapshot: async () => {},
        onError: async (err) => {
          error = err
        },
      })

      await manager.start()

      await expect(manager.waitForCompletion()).rejects.toThrow()
      expect(error).toBeDefined()
      expect(manager.getProgress().phase).toBe(SnapshotPhase.FAILED)
    })

    it('should support retry on transient failures', async () => {
      let attempts = 0
      const records = generateRecords(50)

      const scanner: TableScanner<TestRecord> = {
        getTableName: () => 'test_table',
        getRowCount: async () => records.length,
        getPrimaryKey: (r) => r.id,
        scanChunk: async (cursor, chunkSize) => {
          attempts++
          if (attempts < 3) {
            throw new Error('Transient error')
          }
          const startIndex = cursor ? records.findIndex((r) => r.id > cursor) : 0
          if (startIndex === -1) {
            return { records: [], nextCursor: null, hasMore: false }
          }
          const chunk = records.slice(startIndex, startIndex + chunkSize)
          const lastRecord = chunk[chunk.length - 1]
          const hasMore = startIndex + chunkSize < records.length
          return {
            records: chunk,
            nextCursor: hasMore && lastRecord ? lastRecord.id : null,
            hasMore,
          }
        },
      }

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        retryAttempts: 3,
        retryDelayMs: 10,
        onSnapshot: async () => {},
      })

      await manager.start()
      await manager.waitForCompletion()

      expect(attempts).toBe(3)
    })
  })

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  describe('lifecycle', () => {
    it('should prevent starting already-started snapshot', async () => {
      const scanner = createMockScanner([])
      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 100,
        onSnapshot: async () => {},
      })

      await manager.start()
      await expect(manager.start()).rejects.toThrow()
    })

    it('should allow cancellation', async () => {
      const records = generateRecords(1000)
      const scanner = createMockScanner(records, { delayMs: 10 })
      const events: SnapshotEvent<TestRecord>[] = []

      const manager = createSnapshotManager<TestRecord>({
        scanner,
        chunkSize: 50,
        onSnapshot: async (event) => {
          events.push(event)
        },
      })

      await manager.start()
      await delay(50)
      await manager.cancel()

      expect(events.length).toBeLessThan(1000)
      expect(manager.getProgress().phase).toBe(SnapshotPhase.CANCELLED)
    })
  })
})
