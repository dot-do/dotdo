/**
 * OffsetTracker tests
 *
 * TDD approach: These tests define the expected behavior of OffsetTracker.
 *
 * OffsetTracker provides persistent tracking of stream position:
 * - Store offsets using TemporalStore for durability
 * - Support database-specific offset formats (LSN, GTID, rowid)
 * - Implement periodic and event-driven checkpointing
 * - Handle offset recovery on restart
 * - Support multi-partition offset tracking
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  OffsetTracker,
  createOffsetTracker,
  type OffsetTrackerOptions,
  type Offset,
  type OffsetFormat,
  type CheckpointConfig,
  type PartitionOffset,
} from '../offset-tracker'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTracker(options?: OffsetTrackerOptions): OffsetTracker {
  return createOffsetTracker(options)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// OFFSET PERSISTENCE AND RECOVERY ROUNDTRIP
// ============================================================================

describe('OffsetTracker', () => {
  describe('offset persistence and recovery roundtrip', () => {
    it('should persist and recover a simple numeric offset', async () => {
      const tracker = createTracker()

      // Set and commit an offset
      await tracker.setOffset({ value: 12345, format: 'numeric' })
      await tracker.commit()

      // Get checkpoint state for recovery
      const checkpoint = await tracker.getCheckpointState()

      // Create new tracker and restore from checkpoint
      const tracker2 = createTracker()
      await tracker2.restoreFromCheckpoint(checkpoint)

      const recovered = await tracker2.getCurrentOffset()
      expect(recovered?.value).toBe(12345)
      expect(recovered?.format).toBe('numeric')
    })

    it('should persist PostgreSQL LSN format offset', async () => {
      const tracker = createTracker({ format: 'lsn' })

      await tracker.setOffset({ value: '0/16B3740', format: 'lsn' })
      await tracker.commit()

      const checkpoint = await tracker.getCheckpointState()
      const tracker2 = createTracker({ format: 'lsn' })
      await tracker2.restoreFromCheckpoint(checkpoint)

      const recovered = await tracker2.getCurrentOffset()
      expect(recovered?.value).toBe('0/16B3740')
      expect(recovered?.format).toBe('lsn')
    })

    it('should persist MySQL GTID format offset', async () => {
      const tracker = createTracker({ format: 'gtid' })

      await tracker.setOffset({
        value: '3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5',
        format: 'gtid',
      })
      await tracker.commit()

      const checkpoint = await tracker.getCheckpointState()
      const tracker2 = createTracker({ format: 'gtid' })
      await tracker2.restoreFromCheckpoint(checkpoint)

      const recovered = await tracker2.getCurrentOffset()
      expect(recovered?.value).toBe('3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5')
    })

    it('should persist SQLite rowid format offset', async () => {
      const tracker = createTracker({ format: 'rowid' })

      await tracker.setOffset({ value: 42, format: 'rowid' })
      await tracker.commit()

      const checkpoint = await tracker.getCheckpointState()
      const tracker2 = createTracker({ format: 'rowid' })
      await tracker2.restoreFromCheckpoint(checkpoint)

      const recovered = await tracker2.getCurrentOffset()
      expect(recovered?.value).toBe(42)
      expect(recovered?.format).toBe('rowid')
    })

    it('should persist timestamp-based offset', async () => {
      const tracker = createTracker({ format: 'timestamp' })
      const ts = Date.now()

      await tracker.setOffset({ value: ts, format: 'timestamp' })
      await tracker.commit()

      const checkpoint = await tracker.getCheckpointState()
      const tracker2 = createTracker({ format: 'timestamp' })
      await tracker2.restoreFromCheckpoint(checkpoint)

      const recovered = await tracker2.getCurrentOffset()
      expect(recovered?.value).toBe(ts)
    })

    it('should maintain offset history in TemporalStore', async () => {
      const tracker = createTracker({ keepHistory: true })

      const ts1 = Date.now()
      await tracker.setOffset({ value: 100, format: 'numeric' })
      await tracker.commit()

      await delay(50)
      const ts2 = Date.now()
      await tracker.setOffset({ value: 200, format: 'numeric' })
      await tracker.commit()

      // Query historical offset
      const historyAt1 = await tracker.getOffsetAsOf(ts1 + 25)
      expect(historyAt1?.value).toBe(100)

      const historyAt2 = await tracker.getOffsetAsOf(ts2 + 25)
      expect(historyAt2?.value).toBe(200)
    })

    it('should return null for uninitialized offset', async () => {
      const tracker = createTracker()
      const offset = await tracker.getCurrentOffset()
      expect(offset).toBeNull()
    })
  })

  // ============================================================================
  // CHECKPOINT FREQUENCY CONFIGURATIONS
  // ============================================================================

  describe('checkpoint frequency configurations', () => {
    it('should checkpoint on every N events (count-based)', async () => {
      let checkpointCount = 0
      const tracker = createTracker({
        checkpoint: {
          type: 'count',
          interval: 3, // Checkpoint every 3 events
        },
        onCheckpoint: () => {
          checkpointCount++
        },
      })

      // Process 5 events
      for (let i = 1; i <= 5; i++) {
        await tracker.setOffset({ value: i, format: 'numeric' })
        await tracker.recordEvent()
      }

      // Should checkpoint once at 3 events
      expect(checkpointCount).toBe(1)
    })

    it('should checkpoint after time interval (time-based)', async () => {
      let checkpointCount = 0
      const tracker = createTracker({
        checkpoint: {
          type: 'time',
          intervalMs: 50, // Checkpoint every 50ms
        },
        onCheckpoint: () => {
          checkpointCount++
        },
      })

      await tracker.start()
      await tracker.setOffset({ value: 1, format: 'numeric' })

      // Wait for checkpoint interval
      await delay(75)

      await tracker.stop()
      expect(checkpointCount).toBeGreaterThanOrEqual(1)
    })

    it('should checkpoint on explicit commit', async () => {
      let checkpointCount = 0
      const tracker = createTracker({
        checkpoint: { type: 'manual' },
        onCheckpoint: () => {
          checkpointCount++
        },
      })

      await tracker.setOffset({ value: 1, format: 'numeric' })
      expect(checkpointCount).toBe(0)

      await tracker.commit()
      expect(checkpointCount).toBe(1)
    })

    it('should support combined count and time checkpointing', async () => {
      let checkpointCount = 0
      const tracker = createTracker({
        checkpoint: {
          type: 'combined',
          interval: 10, // Count threshold
          intervalMs: 50, // Time threshold
        },
        onCheckpoint: () => {
          checkpointCount++
        },
      })

      await tracker.start()
      await tracker.setOffset({ value: 1, format: 'numeric' })

      // Wait for time-based checkpoint
      await delay(75)

      await tracker.stop()
      expect(checkpointCount).toBeGreaterThanOrEqual(1)
    })

    it('should support event-driven checkpointing on specific events', async () => {
      let checkpointCount = 0
      const tracker = createTracker({
        checkpoint: {
          type: 'event-driven',
          triggerEvents: ['transaction_commit', 'batch_complete'],
        },
        onCheckpoint: () => {
          checkpointCount++
        },
      })

      await tracker.setOffset({ value: 1, format: 'numeric' })
      expect(checkpointCount).toBe(0)

      await tracker.triggerCheckpointEvent('transaction_commit')
      expect(checkpointCount).toBe(1)

      await tracker.triggerCheckpointEvent('batch_complete')
      expect(checkpointCount).toBe(2)

      // Non-triggering event should not checkpoint
      await tracker.triggerCheckpointEvent('some_other_event')
      expect(checkpointCount).toBe(2)
    })

    it('should flush pending offset on stop', async () => {
      let committed = false
      const tracker = createTracker({
        checkpoint: { type: 'manual' },
        onCheckpoint: () => {
          committed = true
        },
      })

      await tracker.start()
      await tracker.setOffset({ value: 999, format: 'numeric' })
      expect(committed).toBe(false)

      await tracker.stop()
      expect(committed).toBe(true)
    })
  })

  // ============================================================================
  // RECOVERY FROM VARIOUS FAILURE POINTS
  // ============================================================================

  describe('recovery from various failure points', () => {
    it('should recover from crash before commit', async () => {
      const tracker = createTracker()

      // Simulate: set offset but crash before commit
      await tracker.setOffset({ value: 100, format: 'numeric' })
      // No commit - simulating crash

      // Get last committed state
      const checkpoint = await tracker.getCheckpointState()

      // Recover: should have no committed offset
      const tracker2 = createTracker()
      await tracker2.restoreFromCheckpoint(checkpoint)

      const recovered = await tracker2.getCurrentOffset()
      // Uncommitted offset should not be recovered
      expect(recovered).toBeNull()
    })

    it('should recover from crash after commit', async () => {
      const tracker = createTracker()

      await tracker.setOffset({ value: 100, format: 'numeric' })
      await tracker.commit()

      const checkpoint = await tracker.getCheckpointState()

      // Simulate crash and recovery
      const tracker2 = createTracker()
      await tracker2.restoreFromCheckpoint(checkpoint)

      const recovered = await tracker2.getCurrentOffset()
      expect(recovered?.value).toBe(100)
    })

    it('should recover to last successful checkpoint', async () => {
      const tracker = createTracker()

      // First successful checkpoint
      await tracker.setOffset({ value: 100, format: 'numeric' })
      await tracker.commit()

      // Second successful checkpoint
      await tracker.setOffset({ value: 200, format: 'numeric' })
      await tracker.commit()

      const checkpoint = await tracker.getCheckpointState()

      // Third offset - not committed (simulated crash)
      await tracker.setOffset({ value: 300, format: 'numeric' })

      // Recovery
      const tracker2 = createTracker()
      await tracker2.restoreFromCheckpoint(checkpoint)

      const recovered = await tracker2.getCurrentOffset()
      expect(recovered?.value).toBe(200)
    })

    it('should recover pending events since last checkpoint', async () => {
      const tracker = createTracker({ keepHistory: true })

      await tracker.setOffset({ value: 100, format: 'numeric' })
      await tracker.commit()

      // Record some events after checkpoint
      await tracker.recordEvent({ id: 'evt-1' })
      await tracker.recordEvent({ id: 'evt-2' })

      const checkpoint = await tracker.getCheckpointState()

      // Recovery
      const tracker2 = createTracker({ keepHistory: true })
      await tracker2.restoreFromCheckpoint(checkpoint)

      // Should be able to determine what needs replay
      const pendingEvents = await tracker2.getPendingEventsSinceCheckpoint()
      expect(pendingEvents).toHaveLength(2)
      expect(pendingEvents.map((e) => e.id)).toEqual(['evt-1', 'evt-2'])
    })

    it('should support rollback to specific checkpoint', async () => {
      const tracker = createTracker({ keepHistory: true })

      await tracker.setOffset({ value: 100, format: 'numeric' })
      const checkpoint1 = await tracker.commit()

      await tracker.setOffset({ value: 200, format: 'numeric' })
      await tracker.commit()

      await tracker.setOffset({ value: 300, format: 'numeric' })
      await tracker.commit()

      // Rollback to first checkpoint
      await tracker.rollbackToCheckpoint(checkpoint1)

      const current = await tracker.getCurrentOffset()
      expect(current?.value).toBe(100)
    })

    it('should handle corrupted checkpoint gracefully', async () => {
      const tracker = createTracker()

      // Restore from corrupted/invalid checkpoint
      const corruptedCheckpoint = {
        offset: null,
        committedAt: 'invalid-timestamp',
        metadata: { corrupt: true },
      }

      // Should throw or return error, not crash
      await expect(
        tracker.restoreFromCheckpoint(corruptedCheckpoint as any)
      ).rejects.toThrow(/invalid checkpoint/i)
    })

    it('should support checkpoint validation before recovery', async () => {
      const tracker = createTracker()

      await tracker.setOffset({ value: 100, format: 'numeric' })
      await tracker.commit()

      const checkpoint = await tracker.getCheckpointState()

      // Validate checkpoint before restoring
      const isValid = await tracker.validateCheckpoint(checkpoint)
      expect(isValid).toBe(true)

      // Invalid checkpoint
      const invalidCheckpoint = { ...checkpoint, offset: undefined }
      const isInvalid = await tracker.validateCheckpoint(invalidCheckpoint as any)
      expect(isInvalid).toBe(false)
    })
  })

  // ============================================================================
  // MULTI-PARTITION OFFSET COORDINATION
  // ============================================================================

  describe('multi-partition offset coordination', () => {
    it('should track offsets for multiple partitions', async () => {
      const tracker = createTracker({ multiPartition: true })

      await tracker.setPartitionOffset('partition-0', { value: 100, format: 'numeric' })
      await tracker.setPartitionOffset('partition-1', { value: 200, format: 'numeric' })
      await tracker.setPartitionOffset('partition-2', { value: 300, format: 'numeric' })
      await tracker.commit()

      const offsets = await tracker.getAllPartitionOffsets()
      expect(offsets).toHaveLength(3)
      expect(offsets.find((p) => p.partition === 'partition-0')?.offset.value).toBe(100)
      expect(offsets.find((p) => p.partition === 'partition-1')?.offset.value).toBe(200)
      expect(offsets.find((p) => p.partition === 'partition-2')?.offset.value).toBe(300)
    })

    it('should recover all partition offsets', async () => {
      const tracker = createTracker({ multiPartition: true })

      await tracker.setPartitionOffset('p0', { value: 10, format: 'numeric' })
      await tracker.setPartitionOffset('p1', { value: 20, format: 'numeric' })
      await tracker.commit()

      const checkpoint = await tracker.getCheckpointState()

      const tracker2 = createTracker({ multiPartition: true })
      await tracker2.restoreFromCheckpoint(checkpoint)

      const p0 = await tracker2.getPartitionOffset('p0')
      const p1 = await tracker2.getPartitionOffset('p1')

      expect(p0?.value).toBe(10)
      expect(p1?.value).toBe(20)
    })

    it('should commit only when all partitions are ready', async () => {
      const tracker = createTracker({
        multiPartition: true,
        commitStrategy: 'all-partitions',
      })

      await tracker.setPartitionOffset('p0', { value: 100, format: 'numeric' })
      // p1 not set yet

      // Commit should wait or fail
      await expect(tracker.commit({ requireAllPartitions: ['p0', 'p1'] })).rejects.toThrow(
        /missing partition/i
      )

      await tracker.setPartitionOffset('p1', { value: 200, format: 'numeric' })
      await expect(tracker.commit({ requireAllPartitions: ['p0', 'p1'] })).resolves.toBeDefined()
    })

    it('should support per-partition checkpoint', async () => {
      const tracker = createTracker({ multiPartition: true })

      await tracker.setPartitionOffset('p0', { value: 100, format: 'numeric' })
      await tracker.commitPartition('p0')

      await tracker.setPartitionOffset('p1', { value: 200, format: 'numeric' })
      // p1 not committed

      const checkpoint = await tracker.getCheckpointState()

      const tracker2 = createTracker({ multiPartition: true })
      await tracker2.restoreFromCheckpoint(checkpoint)

      const p0 = await tracker2.getPartitionOffset('p0')
      const p1 = await tracker2.getPartitionOffset('p1')

      expect(p0?.value).toBe(100)
      expect(p1).toBeNull() // Not committed
    })

    it('should calculate global min offset across partitions', async () => {
      const tracker = createTracker({ multiPartition: true })

      await tracker.setPartitionOffset('p0', { value: 100, format: 'numeric' })
      await tracker.setPartitionOffset('p1', { value: 50, format: 'numeric' })
      await tracker.setPartitionOffset('p2', { value: 200, format: 'numeric' })
      await tracker.commit()

      const minOffset = await tracker.getMinPartitionOffset()
      expect(minOffset?.partition).toBe('p1')
      expect(minOffset?.offset.value).toBe(50)
    })

    it('should handle partition rebalance', async () => {
      const tracker = createTracker({ multiPartition: true })

      // Initial partitions
      await tracker.setPartitionOffset('p0', { value: 100, format: 'numeric' })
      await tracker.setPartitionOffset('p1', { value: 200, format: 'numeric' })
      await tracker.commit()

      // Rebalance: lose p0, gain p2
      await tracker.removePartition('p0')
      await tracker.setPartitionOffset('p2', { value: 300, format: 'numeric' })
      await tracker.commit()

      const offsets = await tracker.getAllPartitionOffsets()
      expect(offsets.map((o) => o.partition).sort()).toEqual(['p1', 'p2'])
    })

    it('should track partition lag', async () => {
      const tracker = createTracker({ multiPartition: true })

      await tracker.setPartitionOffset('p0', { value: 100, format: 'numeric' })
      await tracker.setPartitionOffset('p1', { value: 50, format: 'numeric' })
      await tracker.commit()

      // Set high watermarks (latest available)
      await tracker.setHighWatermark('p0', 150)
      await tracker.setHighWatermark('p1', 150)

      const lag = await tracker.getPartitionLag()
      expect(lag.get('p0')).toBe(50) // 150 - 100
      expect(lag.get('p1')).toBe(100) // 150 - 50
    })
  })

  // ============================================================================
  // OFFSET FORMAT CONVERSION ACROSS DB TYPES
  // ============================================================================

  describe('offset format conversion across DB types', () => {
    it('should convert numeric to LSN format', async () => {
      const tracker = createTracker()

      const lsn = tracker.convertOffset(
        { value: 23456576, format: 'numeric' },
        'lsn'
      )
      expect(lsn.format).toBe('lsn')
      expect(typeof lsn.value).toBe('string')
      // LSN format: segment/offset
      expect(lsn.value).toMatch(/^\d+\/[A-F0-9]+$/i)
    })

    it('should convert LSN to numeric format', async () => {
      const tracker = createTracker()

      const numeric = tracker.convertOffset(
        { value: '0/16B3740', format: 'lsn' },
        'numeric'
      )
      expect(numeric.format).toBe('numeric')
      expect(typeof numeric.value).toBe('number')
    })

    it('should compare offsets of same format', async () => {
      const tracker = createTracker()

      const offset1: Offset = { value: 100, format: 'numeric' }
      const offset2: Offset = { value: 200, format: 'numeric' }

      expect(tracker.compareOffsets(offset1, offset2)).toBeLessThan(0)
      expect(tracker.compareOffsets(offset2, offset1)).toBeGreaterThan(0)
      expect(tracker.compareOffsets(offset1, offset1)).toBe(0)
    })

    it('should compare LSN offsets correctly', async () => {
      const tracker = createTracker()

      const lsn1: Offset = { value: '0/16B3740', format: 'lsn' }
      const lsn2: Offset = { value: '0/16B3800', format: 'lsn' }

      expect(tracker.compareOffsets(lsn1, lsn2)).toBeLessThan(0)
    })

    it('should compare GTID offsets correctly', async () => {
      const tracker = createTracker()

      const gtid1: Offset = { value: '3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5', format: 'gtid' }
      const gtid2: Offset = { value: '3E11FA47-71CA-11E1-9E33-C80AA9429562:1-10', format: 'gtid' }

      expect(tracker.compareOffsets(gtid1, gtid2)).toBeLessThan(0)
    })

    it('should normalize offsets to common format for comparison', async () => {
      const tracker = createTracker()

      const numeric: Offset = { value: 23456576, format: 'numeric' }
      const lsn: Offset = { value: '0/1660C40', format: 'lsn' } // Same value in LSN

      // Convert both to numeric for comparison
      const comparison = tracker.compareOffsetsNormalized(numeric, lsn)
      expect(comparison).toBe(0)
    })

    it('should validate offset format', async () => {
      const tracker = createTracker()

      expect(tracker.isValidOffset({ value: 100, format: 'numeric' })).toBe(true)
      expect(tracker.isValidOffset({ value: '0/16B3740', format: 'lsn' })).toBe(true)
      expect(tracker.isValidOffset({ value: 'invalid', format: 'lsn' })).toBe(false)
      expect(
        tracker.isValidOffset({
          value: '3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5',
          format: 'gtid',
        })
      ).toBe(true)
      expect(tracker.isValidOffset({ value: 'not-a-gtid', format: 'gtid' })).toBe(false)
    })

    it('should parse offset from string representation', async () => {
      const tracker = createTracker()

      const fromNumeric = tracker.parseOffset('100', 'numeric')
      expect(fromNumeric.value).toBe(100)

      const fromLsn = tracker.parseOffset('0/16B3740', 'lsn')
      expect(fromLsn.value).toBe('0/16B3740')
      expect(fromLsn.format).toBe('lsn')
    })

    it('should serialize offset to string', async () => {
      const tracker = createTracker()

      const numeric = tracker.serializeOffset({ value: 100, format: 'numeric' })
      expect(numeric).toBe('100')

      const lsn = tracker.serializeOffset({ value: '0/16B3740', format: 'lsn' })
      expect(lsn).toBe('0/16B3740')
    })

    it('should handle BigInt offsets for very large values', async () => {
      const tracker = createTracker()

      const bigOffset: Offset = {
        value: BigInt('9223372036854775807'), // Max int64
        format: 'numeric',
      }

      await tracker.setOffset(bigOffset)
      await tracker.commit()

      const checkpoint = await tracker.getCheckpointState()
      const tracker2 = createTracker()
      await tracker2.restoreFromCheckpoint(checkpoint)

      const recovered = await tracker2.getCurrentOffset()
      expect(recovered?.value).toBe(BigInt('9223372036854775807'))
    })
  })

  // ============================================================================
  // EXACTLY-ONCE SEMANTICS
  // ============================================================================

  describe('exactly-once semantics', () => {
    it('should track processed event IDs for deduplication', async () => {
      const tracker = createTracker({ enableDeduplication: true })

      await tracker.recordProcessedEvent('evt-1')
      await tracker.recordProcessedEvent('evt-2')

      expect(await tracker.isEventProcessed('evt-1')).toBe(true)
      expect(await tracker.isEventProcessed('evt-2')).toBe(true)
      expect(await tracker.isEventProcessed('evt-3')).toBe(false)
    })

    it('should persist processed events across recovery', async () => {
      const tracker = createTracker({ enableDeduplication: true })

      await tracker.recordProcessedEvent('evt-1')
      await tracker.commit()

      const checkpoint = await tracker.getCheckpointState()

      const tracker2 = createTracker({ enableDeduplication: true })
      await tracker2.restoreFromCheckpoint(checkpoint)

      expect(await tracker2.isEventProcessed('evt-1')).toBe(true)
    })

    it('should prune old processed event IDs based on retention', async () => {
      const tracker = createTracker({
        enableDeduplication: true,
        deduplicationRetention: { maxCount: 3 },
      })

      await tracker.recordProcessedEvent('evt-1')
      await tracker.recordProcessedEvent('evt-2')
      await tracker.recordProcessedEvent('evt-3')
      await tracker.recordProcessedEvent('evt-4') // Should evict evt-1

      expect(await tracker.isEventProcessed('evt-1')).toBe(false)
      expect(await tracker.isEventProcessed('evt-4')).toBe(true)
    })
  })

  // ============================================================================
  // STATISTICS AND OBSERVABILITY
  // ============================================================================

  describe('statistics and observability', () => {
    it('should track checkpoint count', async () => {
      const tracker = createTracker()

      await tracker.setOffset({ value: 100, format: 'numeric' })
      await tracker.commit()
      await tracker.setOffset({ value: 200, format: 'numeric' })
      await tracker.commit()

      const stats = tracker.getStats()
      expect(stats.checkpointCount).toBe(2)
    })

    it('should track events processed since last checkpoint', async () => {
      const tracker = createTracker()

      await tracker.setOffset({ value: 100, format: 'numeric' })
      await tracker.commit()

      await tracker.recordEvent()
      await tracker.recordEvent()
      await tracker.recordEvent()

      const stats = tracker.getStats()
      expect(stats.eventsSinceLastCheckpoint).toBe(3)
    })

    it('should track checkpoint latency', async () => {
      const tracker = createTracker()

      await tracker.setOffset({ value: 100, format: 'numeric' })
      await tracker.commit()

      const stats = tracker.getStats()
      expect(stats.lastCheckpointLatencyMs).toBeGreaterThanOrEqual(0)
    })

    it('should track time since last checkpoint', async () => {
      const tracker = createTracker()

      await tracker.setOffset({ value: 100, format: 'numeric' })
      await tracker.commit()

      await delay(50)

      const stats = tracker.getStats()
      expect(stats.timeSinceLastCheckpointMs).toBeGreaterThanOrEqual(50)
    })
  })

  // ============================================================================
  // FACTORY FUNCTION
  // ============================================================================

  describe('factory function', () => {
    it('should create an OffsetTracker instance', () => {
      const tracker = createOffsetTracker()
      expect(tracker).toBeInstanceOf(OffsetTracker)
    })

    it('should accept all options', () => {
      const tracker = createOffsetTracker({
        format: 'lsn',
        multiPartition: true,
        keepHistory: true,
        enableDeduplication: true,
        checkpoint: {
          type: 'combined',
          interval: 100,
          intervalMs: 5000,
        },
        onCheckpoint: () => {},
        deduplicationRetention: { maxCount: 10000 },
      })
      expect(tracker).toBeDefined()
    })
  })
})
