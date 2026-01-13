/**
 * Cutover Consistency Tests
 *
 * Validates snapshot-to-CDC transition patterns:
 * - Snapshot completion detection
 * - CDC start position (LSN/GTID)
 * - Deduplication during overlap
 * - Exactly-once guarantees
 *
 * @see /db/primitives/cdc/spikes/cutover-consistency.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SnapshotManager,
  createSnapshotManager,
  type TableScanner,
  type SnapshotEvent,
  type SnapshotState,
  SnapshotPhase,
} from '../snapshot-manager'
import {
  OffsetTracker,
  createOffsetTracker,
  type Offset,
} from '../offset-tracker'
import {
  ExactlyOnceDelivery,
  createExactlyOnceDelivery,
  type DeliveryEvent,
  type DeliveryResult,
} from '../exactly-once-delivery'
import { ChangeType } from '../stream'

// ============================================================================
// TEST TYPES
// ============================================================================

interface TestRecord {
  id: string
  name: string
  value: number
  version: number
}

interface CutoverCoordinator<T> {
  snapshotManager: SnapshotManager<T>
  offsetTracker: OffsetTracker
  exactlyOnce: ExactlyOnceDelivery<T>
  snapshotRecords: Map<string, T>
  cdcEvents: Array<{ type: string; record: T; lsn: string }>
  finalState: Map<string, T>
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockScanner(
  records: TestRecord[],
  options?: { delayMs?: number; failAt?: number }
): TableScanner<TestRecord> {
  let recordsRead = 0

  return {
    getTableName: () => 'test_table',
    getRowCount: async () => records.length,
    getPrimaryKey: (record) => record.id,
    scanChunk: async (cursor, chunkSize) => {
      if (options?.delayMs) {
        await delay(options.delayMs)
      }
      if (options?.failAt !== undefined && recordsRead >= options.failAt) {
        throw new Error('Simulated scanner failure')
      }

      const startIndex = cursor
        ? records.findIndex((r) => r.id > cursor)
        : 0

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

function generateRecords(count: number): TestRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1).padStart(6, '0'),
    name: `Record ${i + 1}`,
    value: i * 10,
    version: 1,
  }))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createLSN(segment: number, offset: number): string {
  return `${segment}/${offset.toString(16).toUpperCase()}`
}

function parseLSN(lsn: string): bigint {
  const [segment, offset] = lsn.split('/')
  if (!segment || !offset) return 0n
  const segmentNum = BigInt(parseInt(segment, 10))
  const offsetNum = BigInt(parseInt(offset, 16))
  return (segmentNum << 32n) | offsetNum
}

function compareLSN(a: string, b: string): number {
  const lsnA = parseLSN(a)
  const lsnB = parseLSN(b)
  return lsnA < lsnB ? -1 : lsnA > lsnB ? 1 : 0
}

/**
 * Creates a cutover coordinator that simulates the full snapshot-to-CDC flow
 */
async function createCutoverCoordinator(
  records: TestRecord[],
  options?: {
    chunkSize?: number
    walPosition?: string
    snapshotDelayMs?: number
  }
): Promise<CutoverCoordinator<TestRecord>> {
  const snapshotRecords = new Map<string, TestRecord>()
  const cdcEvents: Array<{ type: string; record: TestRecord; lsn: string }> = []
  const finalState = new Map<string, TestRecord>()

  const scanner = createMockScanner(records, { delayMs: options?.snapshotDelayMs })

  const snapshotManager = createSnapshotManager<TestRecord>({
    scanner,
    chunkSize: options?.chunkSize ?? 100,
    initialWalPosition: options?.walPosition ?? createLSN(0, 1000),
    trackRecordIds: true,
    onSnapshot: async (event) => {
      snapshotRecords.set(event.record.id, event.record)
      finalState.set(event.record.id, event.record)
    },
  })

  const offsetTracker = createOffsetTracker({
    format: 'lsn',
    enableDeduplication: true,
  })

  const exactlyOnce = createExactlyOnceDelivery<TestRecord>({
    deduplicationWindowMs: 60_000,
    maxRetryAttempts: 3,
    onProcess: async (event) => {
      cdcEvents.push({
        type: 'processed',
        record: event.payload,
        lsn: event.offset?.value as string ?? '',
      })

      // Apply to final state
      if (event.metadata?.deleted) {
        finalState.delete(event.payload.id)
      } else {
        finalState.set(event.payload.id, event.payload)
      }
    },
  })

  return {
    snapshotManager,
    offsetTracker,
    exactlyOnce,
    snapshotRecords,
    cdcEvents,
    finalState,
  }
}

// ============================================================================
// SNAPSHOT TO CDC TRANSITION TESTS
// ============================================================================

describe('Cutover Consistency', () => {
  describe('Basic Snapshot to CDC Transition', () => {
    it('should capture WAL position before snapshot starts', async () => {
      const records = generateRecords(100)
      const walPosition = createLSN(0, 1000)

      const coordinator = await createCutoverCoordinator(records, {
        walPosition,
        chunkSize: 50,
      })

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      const cutover = coordinator.snapshotManager.getCutoverInfo()
      expect(cutover).toBeDefined()
      expect(cutover!.walPositionAtStart).toBe(walPosition)
      expect(cutover!.totalRowsSnapshot).toBe(100)
    })

    it('should complete snapshot with all records captured', async () => {
      const records = generateRecords(50)
      const coordinator = await createCutoverCoordinator(records)

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      expect(coordinator.snapshotRecords.size).toBe(50)

      // Verify all records are in final state
      for (const record of records) {
        expect(coordinator.finalState.has(record.id)).toBe(true)
        expect(coordinator.finalState.get(record.id)).toEqual(record)
      }
    })

    it('should provide cutover position for CDC startup', async () => {
      const records = generateRecords(20)
      const walPosition = createLSN(0, 5000)
      const coordinator = await createCutoverCoordinator(records, { walPosition })

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      const cutover = coordinator.snapshotManager.getCutoverInfo()

      // CDC should start from walPositionAtStart
      expect(cutover!.walPositionAtStart).toBe(walPosition)

      // Any CDC events with LSN <= walPosition were captured in snapshot
      // and should be filtered
    })

    it('should track all snapshotted record IDs', async () => {
      const records = generateRecords(30)
      const coordinator = await createCutoverCoordinator(records)

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      const snapshotIds = coordinator.snapshotManager.getSnapshotRecordIds()
      expect(snapshotIds.size).toBe(30)

      for (const record of records) {
        expect(coordinator.snapshotManager.wasRecordSnapshotted(record.id)).toBe(true)
      }

      // Non-existent record should not be in snapshot
      expect(coordinator.snapshotManager.wasRecordSnapshotted('999999')).toBe(false)
    })
  })

  // ============================================================================
  // OVERLAP EVENT HANDLING
  // ============================================================================

  describe('Handle Overlap Events', () => {
    it('should filter CDC events for records in snapshot with LSN <= cutover', async () => {
      const records = generateRecords(10)
      const walPosition = createLSN(0, 1000)
      const coordinator = await createCutoverCoordinator(records, { walPosition })

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      // Simulate CDC event for existing record with LSN before snapshot
      const oldLsnEvent = {
        id: '000001',
        lsn: createLSN(0, 500), // Before snapshot started
      }

      // Should be filtered (duplicate)
      expect(
        coordinator.snapshotManager.shouldFilterLiveEvent(oldLsnEvent.id, oldLsnEvent.lsn)
      ).toBe(true)
    })

    it('should pass through CDC events for new records', async () => {
      const records = generateRecords(10)
      const walPosition = createLSN(0, 1000)
      const coordinator = await createCutoverCoordinator(records, { walPosition })

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      // Simulate CDC event for NEW record (not in snapshot)
      const newRecordEvent = {
        id: '999999',
        lsn: createLSN(0, 1500),
      }

      // Should NOT be filtered (new record)
      expect(
        coordinator.snapshotManager.shouldFilterLiveEvent(newRecordEvent.id, newRecordEvent.lsn)
      ).toBe(false)
    })

    it('should handle UPDATE events during overlap period', async () => {
      const records = generateRecords(5)
      const walPosition = createLSN(0, 1000)
      const coordinator = await createCutoverCoordinator(records, { walPosition })

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      // Record was in snapshot with version 1
      expect(coordinator.finalState.get('000001')!.version).toBe(1)

      // Simulate UPDATE event after snapshot (with higher LSN)
      const updateEvent: DeliveryEvent<TestRecord> = {
        idempotencyKey: 'update-000001-v2',
        payload: { ...records[0]!, version: 2 },
        offset: { value: createLSN(0, 2000), format: 'lsn' },
      }

      // This update should be applied (LSN > snapshot position)
      await coordinator.exactlyOnce.deliver(updateEvent)

      // Final state should have version 2
      expect(coordinator.finalState.get('000001')!.version).toBe(2)
    })

    it('should handle DELETE events for snapshotted records', async () => {
      const records = generateRecords(5)
      const coordinator = await createCutoverCoordinator(records)

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      // Record exists in final state
      expect(coordinator.finalState.has('000003')).toBe(true)

      // Simulate DELETE event
      const deleteEvent: DeliveryEvent<TestRecord> = {
        idempotencyKey: 'delete-000003',
        payload: records[2]!,
        offset: { value: createLSN(0, 2000), format: 'lsn' },
        metadata: { deleted: true },
      }

      await coordinator.exactlyOnce.deliver(deleteEvent)

      // Record should be deleted from final state
      expect(coordinator.finalState.has('000003')).toBe(false)
    })

    it('should deduplicate events with same idempotency key', async () => {
      const records = generateRecords(5)
      const coordinator = await createCutoverCoordinator(records)

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      const event: DeliveryEvent<TestRecord> = {
        idempotencyKey: 'insert-newrecord-1',
        payload: { id: 'new001', name: 'New Record', value: 100, version: 1 },
        offset: { value: createLSN(0, 2000), format: 'lsn' },
      }

      // First delivery
      const result1 = await coordinator.exactlyOnce.deliver(event)
      expect(result1.success).toBe(true)
      expect(result1.wasDuplicate).toBe(false)

      // Second delivery of same event
      const result2 = await coordinator.exactlyOnce.deliver(event)
      expect(result2.success).toBe(true)
      expect(result2.wasDuplicate).toBe(true)

      // Should only have processed once
      const newRecordEvents = coordinator.cdcEvents.filter(
        (e) => e.record.id === 'new001'
      )
      expect(newRecordEvents.length).toBe(1)
    })
  })

  // ============================================================================
  // NO DATA LOSS OR DUPLICATES
  // ============================================================================

  describe('Verify No Data Loss or Duplicates', () => {
    it('should capture all records during snapshot phase', async () => {
      const records = generateRecords(100)
      const coordinator = await createCutoverCoordinator(records, { chunkSize: 25 })

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      // All records should be in snapshot
      expect(coordinator.snapshotRecords.size).toBe(100)

      // Verify each record
      for (const record of records) {
        expect(coordinator.snapshotRecords.has(record.id)).toBe(true)
      }
    })

    it('should not produce duplicates for concurrent inserts', async () => {
      const records = generateRecords(10)
      const walPosition = createLSN(0, 1000)
      const coordinator = await createCutoverCoordinator(records, {
        walPosition,
        snapshotDelayMs: 5,
      })

      // Start snapshot
      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      // Simulate CDC events for records that might have been inserted during snapshot
      // These have LSNs after the snapshot position, so should be filtered based on
      // whether the record was already captured in snapshot

      for (const record of records) {
        const cdcEvent: DeliveryEvent<TestRecord> = {
          idempotencyKey: `insert-${record.id}-cdc`,
          payload: record,
          offset: { value: createLSN(0, 500), format: 'lsn' }, // Before snapshot
        }

        // Check if should filter
        const shouldFilter = coordinator.snapshotManager.shouldFilterLiveEvent(
          record.id,
          cdcEvent.offset!.value as string
        )

        // If in snapshot, should be filtered
        expect(shouldFilter).toBe(true)
      }

      // Final state should have exactly 10 records (no duplicates)
      expect(coordinator.finalState.size).toBe(10)
    })

    it('should handle high-frequency updates to same record', async () => {
      const records = generateRecords(1)
      const coordinator = await createCutoverCoordinator(records)

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      // Simulate multiple rapid updates
      for (let v = 2; v <= 10; v++) {
        const updateEvent: DeliveryEvent<TestRecord> = {
          idempotencyKey: `update-000001-v${v}`,
          payload: { ...records[0]!, version: v },
          offset: { value: createLSN(0, 1000 + v * 100), format: 'lsn' },
        }

        await coordinator.exactlyOnce.deliver(updateEvent)
      }

      // Final state should have the latest version
      expect(coordinator.finalState.get('000001')!.version).toBe(10)

      // Should have processed 9 CDC events (versions 2-10)
      const updateEvents = coordinator.cdcEvents.filter(
        (e) => e.record.id === '000001'
      )
      expect(updateEvents.length).toBe(9)
    })

    it('should maintain consistency across snapshot and CDC', async () => {
      const records = generateRecords(20)
      const walPosition = createLSN(0, 1000)
      const coordinator = await createCutoverCoordinator(records, {
        walPosition,
        chunkSize: 5,
      })

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      // Apply some CDC events for new records
      const newRecords: TestRecord[] = [
        { id: 'new001', name: 'New 1', value: 1000, version: 1 },
        { id: 'new002', name: 'New 2', value: 2000, version: 1 },
      ]

      for (const newRecord of newRecords) {
        await coordinator.exactlyOnce.deliver({
          idempotencyKey: `insert-${newRecord.id}`,
          payload: newRecord,
          offset: { value: createLSN(0, 2000), format: 'lsn' },
        })
      }

      // Delete one existing record
      await coordinator.exactlyOnce.deliver({
        idempotencyKey: 'delete-000010',
        payload: records[9]!,
        offset: { value: createLSN(0, 2100), format: 'lsn' },
        metadata: { deleted: true },
      })

      // Final state: 20 original - 1 deleted + 2 new = 21
      expect(coordinator.finalState.size).toBe(21)
      expect(coordinator.finalState.has('000010')).toBe(false)
      expect(coordinator.finalState.has('new001')).toBe(true)
      expect(coordinator.finalState.has('new002')).toBe(true)
    })
  })

  // ============================================================================
  // CRASH RECOVERY
  // ============================================================================

  describe('Crash Recovery During Cutover', () => {
    it('should resume snapshot from checkpoint', async () => {
      const records = generateRecords(100)
      const events1: SnapshotEvent<TestRecord>[] = []
      const events2: SnapshotEvent<TestRecord>[] = []

      // First manager - crash after ~50 records
      const scanner1 = createMockScanner(records, { failAt: 50 })
      let crashState: SnapshotState | null = null

      const manager1 = createSnapshotManager<TestRecord>({
        scanner: scanner1,
        chunkSize: 20,
        trackRecordIds: true,
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
        // Expected failure
      }

      expect(events1.length).toBeGreaterThan(0)
      expect(events1.length).toBeLessThan(100)
      expect(crashState).toBeDefined()

      // Second manager - resume from checkpoint
      const scanner2 = createMockScanner(records)
      const manager2 = createSnapshotManager<TestRecord>({
        scanner: scanner2,
        chunkSize: 20,
        trackRecordIds: true,
        resumeFrom: crashState!,
        onSnapshot: async (event) => {
          events2.push(event)
        },
      })

      await manager2.start()
      await manager2.waitForCompletion()

      // Combined should cover all records
      const allIds = new Set([
        ...events1.map((e) => e.record.id),
        ...events2.map((e) => e.record.id),
      ])
      expect(allIds.size).toBe(100)
    })

    it('should recover offset tracker state after crash', async () => {
      const tracker = createOffsetTracker({
        format: 'lsn',
        enableDeduplication: true,
      })

      // Set some state
      await tracker.setOffset({ value: createLSN(0, 5000), format: 'lsn' })
      await tracker.recordProcessedEvent('event-1')
      await tracker.recordProcessedEvent('event-2')
      await tracker.commit()

      // Get checkpoint state
      const checkpointState = await tracker.getCheckpointState()

      // Create new tracker and restore
      const tracker2 = createOffsetTracker({
        format: 'lsn',
        enableDeduplication: true,
      })

      await tracker2.restoreFromCheckpoint(checkpointState)

      // Verify state restored
      const restoredOffset = await tracker2.getCurrentOffset()
      expect(restoredOffset?.value).toBe(createLSN(0, 5000))

      // Processed events should be restored
      expect(await tracker2.isEventProcessed('event-1')).toBe(true)
      expect(await tracker2.isEventProcessed('event-2')).toBe(true)
      expect(await tracker2.isEventProcessed('event-3')).toBe(false)
    })

    it('should recover exactly-once state after crash', async () => {
      const delivery = createExactlyOnceDelivery<TestRecord>({
        deduplicationWindowMs: 60_000,
      })

      // Process some events
      await delivery.deliver({
        idempotencyKey: 'key-1',
        payload: { id: '1', name: 'Test', value: 100, version: 1 },
      })
      await delivery.deliver({
        idempotencyKey: 'key-2',
        payload: { id: '2', name: 'Test 2', value: 200, version: 1 },
      })

      // Get checkpoint state
      const state = delivery.getCheckpointState()

      // Create new delivery and restore
      const delivery2 = createExactlyOnceDelivery<TestRecord>({
        deduplicationWindowMs: 60_000,
      })
      delivery2.restoreFromCheckpoint(state)

      // Previously processed keys should be deduplicated
      expect(delivery2.isDuplicate('key-1')).toBe(true)
      expect(delivery2.isDuplicate('key-2')).toBe(true)
      expect(delivery2.isDuplicate('key-3')).toBe(false)
    })
  })

  // ============================================================================
  // LSN/GTID HANDLING
  // ============================================================================

  describe('LSN/GTID Position Handling', () => {
    it('should correctly parse and compare PostgreSQL LSNs', () => {
      const lsn1 = createLSN(0, 1000) // 0/3E8
      const lsn2 = createLSN(0, 2000) // 0/7D0
      const lsn3 = createLSN(1, 100)  // 1/64

      expect(compareLSN(lsn1, lsn2)).toBeLessThan(0)
      expect(compareLSN(lsn2, lsn1)).toBeGreaterThan(0)
      expect(compareLSN(lsn1, lsn1)).toBe(0)

      // Segment 1 > Segment 0
      expect(compareLSN(lsn3, lsn2)).toBeGreaterThan(0)
    })

    it('should track partition offsets independently', async () => {
      const tracker = createOffsetTracker({
        multiPartition: true,
        format: 'lsn',
      })

      await tracker.setPartitionOffset('partition-0', { value: createLSN(0, 1000), format: 'lsn' })
      await tracker.setPartitionOffset('partition-1', { value: createLSN(0, 2000), format: 'lsn' })
      await tracker.setPartitionOffset('partition-2', { value: createLSN(0, 500), format: 'lsn' })

      await tracker.commitPartition('partition-0')
      await tracker.commitPartition('partition-1')
      await tracker.commitPartition('partition-2')

      const allOffsets = await tracker.getAllPartitionOffsets()
      expect(allOffsets.length).toBe(3)

      // Get minimum offset (for safe commit point)
      const minOffset = await tracker.getMinPartitionOffset()
      expect(minOffset?.partition).toBe('partition-2')
      expect(minOffset?.offset.value).toBe(createLSN(0, 500))
    })

    it('should convert between offset formats', () => {
      const tracker = createOffsetTracker()

      const lsnOffset: Offset = { value: '0/10000', format: 'lsn' }
      const numericOffset = tracker.convertOffset(lsnOffset, 'numeric')

      expect(numericOffset.format).toBe('numeric')
      expect(typeof numericOffset.value).toBe('number')

      // Convert back
      const backToLsn = tracker.convertOffset(numericOffset, 'lsn')
      expect(backToLsn.format).toBe('lsn')
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty snapshot', async () => {
      const coordinator = await createCutoverCoordinator([])

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      expect(coordinator.snapshotRecords.size).toBe(0)
      expect(coordinator.snapshotManager.getProgress().phase).toBe(SnapshotPhase.COMPLETED)

      // Should still be able to process CDC events
      await coordinator.exactlyOnce.deliver({
        idempotencyKey: 'insert-new',
        payload: { id: 'new', name: 'New', value: 1, version: 1 },
      })

      expect(coordinator.finalState.size).toBe(1)
    })

    it('should handle snapshot of single record', async () => {
      const records = [{ id: '000001', name: 'Only', value: 1, version: 1 }]
      const coordinator = await createCutoverCoordinator(records)

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      expect(coordinator.snapshotRecords.size).toBe(1)
      expect(coordinator.finalState.has('000001')).toBe(true)
    })

    it('should handle rapid snapshot followed by many CDC events', async () => {
      const records = generateRecords(10)
      const coordinator = await createCutoverCoordinator(records)

      await coordinator.snapshotManager.start()
      await coordinator.snapshotManager.waitForCompletion()

      // Burst of 100 CDC events
      const promises: Promise<DeliveryResult>[] = []
      for (let i = 0; i < 100; i++) {
        promises.push(
          coordinator.exactlyOnce.deliver({
            idempotencyKey: `burst-event-${i}`,
            payload: {
              id: `burst-${i}`,
              name: `Burst ${i}`,
              value: i,
              version: 1,
            },
          })
        )
      }

      await Promise.all(promises)

      // Should have 10 snapshot + 100 CDC = 110 records
      expect(coordinator.finalState.size).toBe(110)
    })

    it('should handle deduplication window expiry', async () => {
      const delivery = createExactlyOnceDelivery<TestRecord>({
        deduplicationWindowMs: 50, // Very short window for testing
      })

      await delivery.deliver({
        idempotencyKey: 'short-lived',
        payload: { id: '1', name: 'Test', value: 1, version: 1 },
      })

      // Should be duplicate immediately
      expect(delivery.isDuplicate('short-lived')).toBe(true)

      // Wait for window to expire
      await delay(100)

      // Should no longer be considered duplicate
      expect(delivery.isDuplicate('short-lived')).toBe(false)
    })
  })
})
