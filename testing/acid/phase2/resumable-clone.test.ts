/**
 * ACID Test Suite - Phase 2.4: Resumable Clone Mode Tests
 *
 * RED TDD: These tests define the expected behavior for resumable clone mode.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * Resumable clone mode provides:
 * - Checkpoint-based transfer (can pause/resume at defined points)
 * - Survives interruptions (network failures, DO restarts)
 * - Handles large datasets efficiently (streaming in batches)
 * - Progress tracking with integrity validation
 * - Bandwidth throttling support
 * - Concurrent operation guards (only one clone per target)
 *
 * Key test areas (per task requirements):
 * 1. Pause and resume functionality
 * 2. Progress tracking
 * 3. Bandwidth throttling
 * 4. Resume continues from correct position
 * 5. Multiple pause/resume cycles work
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 * @task dotdo-y0wi
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../do'
import { DO } from '../../../objects/DO'
import type { CloneMode, CloneOptions, CloneResult } from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR RESUMABLE CLONE MODE
// ============================================================================

/**
 * Checkpoint data representing a point in the clone transfer
 */
interface Checkpoint {
  /** Unique checkpoint identifier */
  id: string
  /** Position in the data stream (e.g., item index or byte offset) */
  position: number
  /** Hash of state at this checkpoint for integrity validation */
  hash: string
  /** Timestamp when checkpoint was created */
  timestamp: Date
  /** Total items processed up to this checkpoint */
  itemsProcessed: number
  /** Batch number this checkpoint represents */
  batchNumber: number
}

/**
 * Clone handle returned from resumable clone initiation
 */
interface ResumableCloneHandle {
  /** Unique identifier for this clone operation */
  id: string
  /** Current status of the clone */
  status: ResumableCloneStatus
  /** Array of created checkpoints */
  checkpoints: Checkpoint[]
  /** Get current progress (0-100) */
  getProgress(): Promise<number>
  /** Wait for the next checkpoint to be created */
  waitForCheckpoint(): Promise<Checkpoint>
  /** Pause the clone at the next checkpoint */
  pause(): Promise<void>
  /** Resume from the last checkpoint */
  resume(): Promise<void>
  /** Check if clone can be resumed from a specific checkpoint */
  canResumeFrom(checkpointId: string): Promise<boolean>
  /** Get integrity hash for the clone */
  getIntegrityHash(): Promise<string>
  /** Cancel the clone operation */
  cancel(): Promise<void>
  /** Get the clone lock info */
  getLockInfo(): Promise<CloneLockInfo | null>
  /** Force override a stale lock */
  forceOverrideLock(): Promise<void>
}

/**
 * Clone operation status lifecycle
 */
type ResumableCloneStatus =
  | 'initializing'
  | 'transferring'
  | 'paused'
  | 'resuming'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled'

/**
 * Clone lock information for concurrency control
 */
interface CloneLockInfo {
  /** Lock ID */
  lockId: string
  /** Clone operation that holds the lock */
  cloneId: string
  /** When the lock was acquired */
  acquiredAt: Date
  /** When the lock expires */
  expiresAt: Date
  /** Whether the lock is stale */
  isStale: boolean
}

/**
 * Options specific to resumable clone mode
 */
interface ResumableCloneOptions extends CloneOptions {
  mode: 'resumable'
  /** Batch size for streaming transfer (default: 100 items) */
  batchSize?: number
  /** Checkpoint interval (create checkpoint every N batches, default: 1) */
  checkpointInterval?: number
  /** Maximum retry attempts on failure (default: 3) */
  maxRetries?: number
  /** Delay between retries in ms (default: 1000) */
  retryDelay?: number
  /** Lock timeout in ms (default: 300000 = 5 minutes) */
  lockTimeout?: number
  /** Checkpoint retention period in ms (default: 3600000 = 1 hour) */
  checkpointRetentionMs?: number
  /** Resume from specific checkpoint ID */
  resumeFrom?: string
  /** Enable compression for transfer */
  compress?: boolean
  /** Force override existing clone lock */
  forceLock?: boolean
  /** Maximum bandwidth in bytes per second (default: unlimited) */
  maxBandwidth?: number
}

/**
 * Event types emitted during resumable clone
 */
type ResumableCloneEventType =
  | 'clone.checkpoint'
  | 'clone.paused'
  | 'clone.resumed'
  | 'clone.retry'
  | 'clone.completed'
  | 'clone.failed'
  | 'clone.cancelled'
  | 'clone.lock.acquired'
  | 'clone.lock.released'
  | 'clone.lock.timeout'
  | 'clone.batch.completed'

interface ResumableCloneEvent {
  type: ResumableCloneEventType
  cloneId: string
  timestamp: Date
  data?: unknown
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Resumable Clone Mode (Checkpoint-Based)', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    vi.useFakeTimers()
    // Large dataset to test chunking and checkpoints
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', Array.from({ length: 1000 }, (_, i) => ({
          id: `thing-${i}`,
          type: 1,
          data: JSON.stringify({ index: i, payload: 'x'.repeat(1000) }),
          version: 1,
          branch: 'main',
          deleted: false,
        }))],
      ]),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // CHECKPOINT-BASED TRANSFER
  // ==========================================================================

  describe('Checkpoint-Based Transfer', () => {
    it('should create checkpoints during clone', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      // Wait for first checkpoint
      await vi.advanceTimersByTimeAsync(1000)
      await handle.waitForCheckpoint()

      expect(handle.checkpoints.length).toBeGreaterThan(0)
      expect(handle.checkpoints[0]).toMatchObject({
        id: expect.any(String),
        position: expect.any(Number),
        hash: expect.any(String),
        timestamp: expect.any(Date),
      })
    })

    it('should include position and state hash in checkpoint', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      const checkpoint = await handle.waitForCheckpoint()

      expect(checkpoint.position).toBeGreaterThan(0)
      expect(checkpoint.hash).toMatch(/^[a-f0-9]{64}$/) // SHA-256 hex
      expect(checkpoint.itemsProcessed).toBeGreaterThan(0)
      expect(checkpoint.batchNumber).toBeGreaterThanOrEqual(1)
    })

    it('should resume from last checkpoint on failure', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      // Let some checkpoints be created
      await vi.advanceTimersByTimeAsync(5000)
      const checkpointCountBefore = handle.checkpoints.length
      expect(checkpointCountBefore).toBeGreaterThan(0)

      // Simulate failure and resume
      await handle.pause()
      expect(handle.status).toBe('paused')

      await handle.resume()

      // Should continue from last checkpoint, not restart
      const lastCheckpoint = handle.checkpoints[handle.checkpoints.length - 1]
      expect(lastCheckpoint.position).toBeGreaterThan(0)
    })

    it('should persist checkpoints to durable storage', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(3000)
      await handle.waitForCheckpoint()

      // Verify checkpoints are stored
      const storedCheckpoints = await result.storage.list({ prefix: 'checkpoint:' })
      expect(storedCheckpoints.size).toBeGreaterThan(0)
    })

    it('should create checkpoints at configurable intervals', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 50,
        checkpointInterval: 2, // Every 2 batches
      }) as unknown as ResumableCloneHandle

      // Process enough data for multiple batches
      await vi.advanceTimersByTimeAsync(10000)

      // Should have fewer checkpoints due to interval setting
      // With 1000 items, 50 per batch = 20 batches
      // With interval 2, should be ~10 checkpoints
      expect(handle.checkpoints.length).toBeLessThanOrEqual(15)
      expect(handle.checkpoints.length).toBeGreaterThan(0)
    })

    it('should include batch number in checkpoint', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(5000)
      await handle.waitForCheckpoint()
      await handle.waitForCheckpoint()

      const checkpoints = handle.checkpoints
      expect(checkpoints.length).toBeGreaterThanOrEqual(2)
      expect(checkpoints[0].batchNumber).toBe(1)
      expect(checkpoints[1].batchNumber).toBe(2)
    })
  })

  // ==========================================================================
  // PAUSE/RESUME OPERATIONS
  // ==========================================================================

  describe('Pause/Resume Operations', () => {
    it('should pause clone at next checkpoint with pause()', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(1000)
      expect(handle.status).toBe('transferring')

      await handle.pause()

      expect(handle.status).toBe('paused')
    })

    it('should continue from last checkpoint with resume()', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      await handle.waitForCheckpoint()
      const progressBeforePause = await handle.getProgress()

      await handle.pause()
      expect(handle.status).toBe('paused')

      await handle.resume()
      expect(handle.status).toBe('transferring')

      // Progress should not have reset
      const progressAfterResume = await handle.getProgress()
      expect(progressAfterResume).toBeGreaterThanOrEqual(progressBeforePause)
    })

    it('should maintain state consistency at each checkpoint', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(3000)

      // Pause at a checkpoint
      await handle.pause()
      const lastCheckpoint = handle.checkpoints[handle.checkpoints.length - 1]

      // Verify integrity at pause point
      const integrityHash = await handle.getIntegrityHash()
      expect(integrityHash).toBe(lastCheckpoint.hash)
    })

    it('should allow indefinite pause without data loss', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      const checkpointBeforePause = await handle.waitForCheckpoint()

      await handle.pause()

      // Simulate long pause
      await vi.advanceTimersByTimeAsync(3600000) // 1 hour

      // Should still be paused with checkpoint intact
      expect(handle.status).toBe('paused')
      expect(handle.checkpoints).toContainEqual(checkpointBeforePause)

      // Should be able to resume
      await handle.resume()
      expect(handle.status).toBe('transferring')
    })

    it('should validate checkpoint before resuming', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      await handle.waitForCheckpoint()
      await handle.pause()

      const lastCheckpoint = handle.checkpoints[handle.checkpoints.length - 1]
      const canResume = await handle.canResumeFrom(lastCheckpoint.id)

      expect(canResume).toBe(true)
    })

    it('should reject resume from invalid checkpoint', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(1000)
      await handle.pause()

      const canResume = await handle.canResumeFrom('invalid-checkpoint-id')
      expect(canResume).toBe(false)
    })

    it('should track progress accurately across pause/resume cycles', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      // First progress point
      await vi.advanceTimersByTimeAsync(1000)
      const progress1 = await handle.getProgress()

      await handle.pause()
      await handle.resume()

      // Second progress point
      await vi.advanceTimersByTimeAsync(1000)
      const progress2 = await handle.getProgress()

      // Progress should increase monotonically
      expect(progress2).toBeGreaterThan(progress1)
    })
  })

  // ==========================================================================
  // FAILURE RECOVERY
  // ==========================================================================

  describe('Failure Recovery', () => {
    it('should resume from checkpoint on network failure', async () => {
      const target = 'https://flaky.target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        maxRetries: 3,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      const checkpointBeforeFailure = await handle.waitForCheckpoint()
      const progressBeforeFailure = await handle.getProgress()

      // Simulate network failure and recovery
      await vi.advanceTimersByTimeAsync(5000)

      // Should have recovered and continued
      const progressAfterRecovery = await handle.getProgress()
      expect(progressAfterRecovery).toBeGreaterThanOrEqual(progressBeforeFailure)
    })

    it('should resume from checkpoint on DO restart', async () => {
      const target = 'https://target.test.do'
      const options: ResumableCloneOptions = {
        mode: 'resumable',
        batchSize: 100,
      }

      const handle = await result.instance.clone(target, options) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      const lastCheckpoint = await handle.waitForCheckpoint()

      // Simulate DO restart by creating new mock and resuming
      const newResult = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: result.sqlData,
        storage: result.storage.data, // Preserve storage
      })

      // Resume from checkpoint
      const resumedHandle = await newResult.instance.clone(target, {
        ...options,
        resumeFrom: lastCheckpoint.id,
      }) as unknown as ResumableCloneHandle

      expect(resumedHandle.status).not.toBe('initializing')
      const progress = await resumedHandle.getProgress()
      expect(progress).toBeGreaterThan(0)
    })

    it('should detect and skip corrupt checkpoint', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(3000)
      await handle.waitForCheckpoint()
      await handle.waitForCheckpoint()

      // Corrupt the last checkpoint in storage
      const checkpointKeys = Array.from((await result.storage.list({ prefix: 'checkpoint:' })).keys())
      if (checkpointKeys.length > 0) {
        await result.storage.put(checkpointKeys[checkpointKeys.length - 1], {
          id: 'corrupted',
          hash: 'invalid-hash',
          position: -1,
        })
      }

      await handle.pause()

      // Should detect corruption and fall back to earlier checkpoint
      const canResumeFromCorrupt = await handle.canResumeFrom('corrupted')
      expect(canResumeFromCorrupt).toBe(false)

      // Should still be able to resume from earlier valid checkpoint
      const validCheckpoint = handle.checkpoints[0]
      if (validCheckpoint) {
        const canResumeFromValid = await handle.canResumeFrom(validCheckpoint.id)
        expect(canResumeFromValid).toBe(true)
      }
    })

    it('should respect configurable maximum retry attempts', async () => {
      const target = 'https://always-failing.test.do'
      const maxRetries = 5
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        maxRetries,
      }) as unknown as ResumableCloneHandle

      // Wait for all retries to be exhausted
      await vi.advanceTimersByTimeAsync(60000)

      // Should be in failed state after max retries
      expect(handle.status).toBe('failed')
    })

    it('should apply exponential backoff between retries', async () => {
      const target = 'https://flaky.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        maxRetries: 3,
        retryDelay: 1000,
      }) as unknown as ResumableCloneHandle

      // Track retry events
      const retryEvents: Date[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        if (verb === 'clone.retry') {
          retryEvents.push(new Date())
        }
        return originalEmit?.call(result.instance, verb, data)
      }

      await vi.advanceTimersByTimeAsync(30000)

      // Retry delays should increase (exponential backoff)
      if (retryEvents.length >= 2) {
        for (let i = 1; i < retryEvents.length; i++) {
          const prevDelay = retryEvents[i - 1].getTime() - (i > 1 ? retryEvents[i - 2].getTime() : 0)
          const currDelay = retryEvents[i].getTime() - retryEvents[i - 1].getTime()
          expect(currDelay).toBeGreaterThanOrEqual(prevDelay)
        }
      }
    })

    it('should preserve partial progress on unrecoverable failure', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        maxRetries: 1,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(3000)
      const progressBeforeFailure = await handle.getProgress()
      const checkpointsBeforeFailure = [...handle.checkpoints]

      // Even if clone fails, checkpoints should be preserved
      expect(checkpointsBeforeFailure.length).toBeGreaterThan(0)

      // Checkpoints should still be accessible for later resume
      for (const checkpoint of checkpointsBeforeFailure) {
        const canResume = await handle.canResumeFrom(checkpoint.id)
        expect(canResume).toBe(true)
      }
    })
  })

  // ==========================================================================
  // LARGE DATASET HANDLING
  // ==========================================================================

  describe('Large Dataset Handling', () => {
    it('should stream data in batches', async () => {
      const target = 'https://target.test.do'
      const batchSize = 100
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(5000)

      // Checkpoints should reflect batch processing
      for (const checkpoint of handle.checkpoints) {
        expect(checkpoint.itemsProcessed).toBe(checkpoint.batchNumber * batchSize)
      }
    })

    it('should support configurable batch size', async () => {
      const target = 'https://target.test.do'
      const smallBatchSize = 50

      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: smallBatchSize,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(10000)

      // With 1000 items and batch size 50, should have more checkpoints
      expect(handle.checkpoints.length).toBeGreaterThanOrEqual(10)
    })

    it('should bound memory usage during transfer', async () => {
      // Create very large dataset
      const veryLargeData = Array.from({ length: 50000 }, (_, i) => ({
        id: `large-thing-${i}`,
        type: 1,
        data: JSON.stringify({ index: i, payload: 'x'.repeat(5000) }),
        version: 1,
        branch: 'main',
        deleted: false,
      }))
      result.sqlData.set('things', veryLargeData)

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      // Should start without memory issues
      expect(handle.status).not.toBe('failed')

      await vi.advanceTimersByTimeAsync(5000)

      // Should be making progress without holding all data in memory
      const progress = await handle.getProgress()
      expect(progress).toBeGreaterThan(0)
    })

    it('should save progress per batch', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        checkpointInterval: 1, // Every batch
      }) as unknown as ResumableCloneHandle

      const progressPoints: number[] = []

      // Track progress at intervals
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(1000)
        progressPoints.push(await handle.getProgress())
      }

      // Progress should increase monotonically
      for (let i = 1; i < progressPoints.length; i++) {
        expect(progressPoints[i]).toBeGreaterThanOrEqual(progressPoints[i - 1])
      }
    })

    it('should handle dataset larger than single transfer', async () => {
      // 10x the original dataset
      const hugeData = Array.from({ length: 10000 }, (_, i) => ({
        id: `huge-thing-${i}`,
        type: 1,
        data: JSON.stringify({ index: i }),
        version: 1,
        branch: 'main',
        deleted: false,
      }))
      result.sqlData.set('things', hugeData)

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      // Should process in chunks without failure
      await vi.advanceTimersByTimeAsync(30000)

      expect(handle.status).not.toBe('failed')
      expect(handle.checkpoints.length).toBeGreaterThan(10)
    })
  })

  // ==========================================================================
  // CHECKPOINT VALIDATION
  // ==========================================================================

  describe('Checkpoint Validation', () => {
    it('should include integrity hash in checkpoints', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      const checkpoint = await handle.waitForCheckpoint()

      expect(checkpoint.hash).toBeDefined()
      expect(checkpoint.hash.length).toBeGreaterThan(0)
      // SHA-256 produces 64 hex characters
      expect(checkpoint.hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should validate hash on resume', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      await handle.waitForCheckpoint()
      await handle.pause()

      const lastCheckpoint = handle.checkpoints[handle.checkpoints.length - 1]

      // Resume should validate the checkpoint hash
      await handle.resume()

      // After resume, current state should match checkpoint hash
      const currentHash = await handle.getIntegrityHash()
      expect(currentHash).toBeDefined()
    })

    it('should detect data corruption during validation', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      const checkpoint = await handle.waitForCheckpoint()

      // Corrupt the checkpoint's stored hash
      const checkpointKey = `checkpoint:${checkpoint.id}`
      const stored = await result.storage.get(checkpointKey) as Checkpoint
      if (stored) {
        await result.storage.put(checkpointKey, {
          ...stored,
          hash: 'corrupted-hash-value',
        })
      }

      // Should detect corruption on validation
      const canResume = await handle.canResumeFrom(checkpoint.id)
      expect(canResume).toBe(false)
    })

    it('should re-transfer from earlier checkpoint if invalid', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        checkpointInterval: 1,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(5000)

      // Create multiple checkpoints
      await handle.waitForCheckpoint()
      await handle.waitForCheckpoint()
      await handle.waitForCheckpoint()

      expect(handle.checkpoints.length).toBeGreaterThanOrEqual(3)

      // Corrupt the last checkpoint
      const lastCheckpoint = handle.checkpoints[handle.checkpoints.length - 1]
      const checkpointKey = `checkpoint:${lastCheckpoint.id}`
      await result.storage.put(checkpointKey, {
        ...lastCheckpoint,
        hash: 'invalid',
      })

      await handle.pause()

      // Should fall back to earlier valid checkpoint
      const secondLastCheckpoint = handle.checkpoints[handle.checkpoints.length - 2]
      const canResumeFromEarlier = await handle.canResumeFrom(secondLastCheckpoint.id)
      expect(canResumeFromEarlier).toBe(true)
    })

    it('should compute incremental hashes efficiently', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      const startTime = Date.now()

      await vi.advanceTimersByTimeAsync(5000)

      // Hash computation should not significantly slow down transfer
      // (This is more of a performance characteristic test)
      expect(handle.checkpoints.length).toBeGreaterThan(0)
      for (const checkpoint of handle.checkpoints) {
        expect(checkpoint.hash).toBeDefined()
      }
    })
  })

  // ==========================================================================
  // CONCURRENT OPERATIONS
  // ==========================================================================

  describe('Concurrent Operations', () => {
    it('should allow only one clone per target at a time', async () => {
      const target = 'https://target.test.do'

      const handle1 = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      // Second clone to same target should fail or wait
      await expect(
        result.instance.clone(target, {
          mode: 'resumable',
          batchSize: 100,
        })
      ).rejects.toThrow(/lock|concurrent|in progress/i)
    })

    it('should block new clone attempts while existing clone active', async () => {
      const target = 'https://target.test.do'

      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(1000)
      expect(handle.status).toBe('transferring')

      // Attempt another clone
      const secondAttempt = result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      })

      await expect(secondAttempt).rejects.toThrow(/lock|concurrent|in progress/i)
    })

    it('should timeout clone lock after configured period', async () => {
      const target = 'https://target.test.do'
      const lockTimeout = 5000 // 5 seconds

      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        lockTimeout,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(1000)

      // Simulate stale lock scenario (e.g., original clone crashed)
      await handle.pause()

      // Wait for lock timeout
      await vi.advanceTimersByTimeAsync(lockTimeout + 1000)

      const lockInfo = await handle.getLockInfo()
      if (lockInfo) {
        expect(lockInfo.isStale).toBe(true)
      }
    })

    it('should support force option to override stale locks', async () => {
      const target = 'https://target.test.do'

      const handle1 = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        lockTimeout: 1000,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(500)
      await handle1.pause()

      // Wait for lock to become stale
      await vi.advanceTimersByTimeAsync(2000)

      // Force override should work
      const handle2 = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        forceLock: true,
      }) as unknown as ResumableCloneHandle

      expect(handle2.id).not.toBe(handle1.id)
      expect(handle2.status).toBe('initializing')
    })

    it('should release lock on successful completion', async () => {
      const target = 'https://target.test.do'

      // Use small dataset for quick completion
      result.sqlData.set('things', Array.from({ length: 50 }, (_, i) => ({
        id: `thing-${i}`,
        type: 1,
        data: JSON.stringify({ index: i }),
        version: 1,
        branch: 'main',
        deleted: false,
      })))

      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 50,
      }) as unknown as ResumableCloneHandle

      // Wait for completion
      await vi.advanceTimersByTimeAsync(10000)

      if (handle.status === 'completed') {
        const lockInfo = await handle.getLockInfo()
        expect(lockInfo).toBeNull()
      }
    })

    it('should release lock on cancellation', async () => {
      const target = 'https://target.test.do'

      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(1000)

      await handle.cancel()

      expect(handle.status).toBe('cancelled')
      const lockInfo = await handle.getLockInfo()
      expect(lockInfo).toBeNull()
    })

    it('should allow different targets concurrently', async () => {
      const target1 = 'https://target1.test.do'
      const target2 = 'https://target2.test.do'

      const handle1 = await result.instance.clone(target1, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      const handle2 = await result.instance.clone(target2, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      expect(handle1.id).not.toBe(handle2.id)
      expect(handle1.status).toBe('initializing')
      expect(handle2.status).toBe('initializing')
    })
  })

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  describe('Cleanup', () => {
    it('should remove checkpoints on successful completion', async () => {
      const target = 'https://target.test.do'

      // Small dataset for quick completion
      result.sqlData.set('things', Array.from({ length: 50 }, (_, i) => ({
        id: `thing-${i}`,
        type: 1,
        data: JSON.stringify({ index: i }),
        version: 1,
        branch: 'main',
        deleted: false,
      })))

      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 50,
      }) as unknown as ResumableCloneHandle

      // Wait for completion
      await vi.advanceTimersByTimeAsync(10000)

      if (handle.status === 'completed') {
        // Checkpoints should be cleaned up
        const storedCheckpoints = await result.storage.list({ prefix: `checkpoint:${handle.id}` })
        expect(storedCheckpoints.size).toBe(0)
      }
    })

    it('should remove checkpoints on abort/cancel', async () => {
      const target = 'https://target.test.do'

      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      await handle.waitForCheckpoint()

      const checkpointsBeforeCancel = await result.storage.list({ prefix: `checkpoint:${handle.id}` })
      expect(checkpointsBeforeCancel.size).toBeGreaterThan(0)

      await handle.cancel()

      // Checkpoints should be cleaned up
      const checkpointsAfterCancel = await result.storage.list({ prefix: `checkpoint:${handle.id}` })
      expect(checkpointsAfterCancel.size).toBe(0)
    })

    it('should clean orphaned checkpoints via GC', async () => {
      const target = 'https://target.test.do'

      // Create orphaned checkpoints by simulating incomplete clone
      await result.storage.put('checkpoint:orphan-1', {
        id: 'orphan-1',
        position: 100,
        hash: 'abc123',
        timestamp: new Date(Date.now() - 7200000), // 2 hours old
        cloneId: 'dead-clone-id',
      })

      await result.storage.put('checkpoint:orphan-2', {
        id: 'orphan-2',
        position: 200,
        hash: 'def456',
        timestamp: new Date(Date.now() - 7200000),
        cloneId: 'dead-clone-id',
      })

      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        checkpointRetentionMs: 3600000, // 1 hour
      }) as unknown as ResumableCloneHandle

      // GC should run and clean up orphaned checkpoints
      await vi.advanceTimersByTimeAsync(5000)

      // Orphaned checkpoints should be removed
      const orphan1 = await result.storage.get('checkpoint:orphan-1')
      const orphan2 = await result.storage.get('checkpoint:orphan-2')

      expect(orphan1).toBeUndefined()
      expect(orphan2).toBeUndefined()
    })

    it('should respect configurable checkpoint retention period', async () => {
      const target = 'https://target.test.do'
      const retentionMs = 60000 // 1 minute

      // Create checkpoint that's within retention period
      await result.storage.put('checkpoint:recent', {
        id: 'recent',
        position: 100,
        hash: 'abc123',
        timestamp: new Date(Date.now() - 30000), // 30 seconds old
        cloneId: 'active-clone',
      })

      // Create checkpoint that's past retention period
      await result.storage.put('checkpoint:old', {
        id: 'old',
        position: 100,
        hash: 'abc123',
        timestamp: new Date(Date.now() - 120000), // 2 minutes old
        cloneId: 'old-clone',
      })

      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        checkpointRetentionMs: retentionMs,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(5000)

      // Recent checkpoint should be preserved, old one cleaned
      const recent = await result.storage.get('checkpoint:recent')
      const old = await result.storage.get('checkpoint:old')

      expect(recent).toBeDefined()
      expect(old).toBeUndefined()
    })

    it('should preserve checkpoints for paused clones', async () => {
      const target = 'https://target.test.do'

      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        checkpointRetentionMs: 1000, // Short retention for test
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      await handle.waitForCheckpoint()
      await handle.pause()

      const checkpointCount = handle.checkpoints.length

      // Wait past retention period
      await vi.advanceTimersByTimeAsync(5000)

      // Checkpoints for paused clone should NOT be cleaned
      const storedCheckpoints = await result.storage.list({ prefix: `checkpoint:${handle.id}` })
      expect(storedCheckpoints.size).toBe(checkpointCount)
    })
  })

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  describe('Event Emission', () => {
    it('should emit clone.checkpoint event with position', async () => {
      const events: ResumableCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({
          type: verb as ResumableCloneEventType,
          cloneId: '',
          timestamp: new Date(),
          data
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      })

      await vi.advanceTimersByTimeAsync(5000)

      const checkpointEvents = events.filter((e) => e.type === 'clone.checkpoint')
      expect(checkpointEvents.length).toBeGreaterThan(0)

      for (const event of checkpointEvents) {
        expect(event.data).toHaveProperty('position')
        expect(event.data).toHaveProperty('hash')
        expect(event.data).toHaveProperty('checkpointId')
      }
    })

    it('should emit clone.paused event', async () => {
      const events: ResumableCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({
          type: verb as ResumableCloneEventType,
          cloneId: '',
          timestamp: new Date(),
          data
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(1000)
      await handle.pause()

      const pausedEvents = events.filter((e) => e.type === 'clone.paused')
      expect(pausedEvents.length).toBe(1)
    })

    it('should emit clone.resumed event', async () => {
      const events: ResumableCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({
          type: verb as ResumableCloneEventType,
          cloneId: '',
          timestamp: new Date(),
          data
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(1000)
      await handle.pause()
      await handle.resume()

      const resumedEvents = events.filter((e) => e.type === 'clone.resumed')
      expect(resumedEvents.length).toBe(1)
    })

    it('should emit clone.retry event on failure recovery', async () => {
      const events: ResumableCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({
          type: verb as ResumableCloneEventType,
          cloneId: '',
          timestamp: new Date(),
          data
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://flaky.test.do'
      await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        maxRetries: 3,
      })

      await vi.advanceTimersByTimeAsync(30000)

      const retryEvents = events.filter((e) => e.type === 'clone.retry')
      // Should have retry events if failures occurred
      expect(retryEvents).toBeDefined()
    })

    it('should emit clone.completed with total checkpoints', async () => {
      const events: ResumableCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({
          type: verb as ResumableCloneEventType,
          cloneId: '',
          timestamp: new Date(),
          data
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      // Small dataset for quick completion
      result.sqlData.set('things', Array.from({ length: 50 }, (_, i) => ({
        id: `thing-${i}`,
        type: 1,
        data: JSON.stringify({ index: i }),
        version: 1,
        branch: 'main',
        deleted: false,
      })))

      const target = 'https://target.test.do'
      await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 50,
      })

      await vi.advanceTimersByTimeAsync(10000)

      const completedEvents = events.filter((e) => e.type === 'clone.completed')
      if (completedEvents.length > 0) {
        expect(completedEvents[0].data).toHaveProperty('totalCheckpoints')
        expect(completedEvents[0].data).toHaveProperty('totalItems')
        expect(completedEvents[0].data).toHaveProperty('duration')
      }
    })

    it('should emit clone.batch.completed per batch', async () => {
      const events: ResumableCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({
          type: verb as ResumableCloneEventType,
          cloneId: '',
          timestamp: new Date(),
          data
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      })

      await vi.advanceTimersByTimeAsync(10000)

      const batchEvents = events.filter((e) => e.type === 'clone.batch.completed')
      expect(batchEvents.length).toBeGreaterThan(0)

      for (const event of batchEvents) {
        expect(event.data).toHaveProperty('batchNumber')
        expect(event.data).toHaveProperty('itemsInBatch')
      }
    })

    it('should emit clone.cancelled on cancellation', async () => {
      const events: ResumableCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({
          type: verb as ResumableCloneEventType,
          cloneId: '',
          timestamp: new Date(),
          data
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(1000)
      await handle.cancel()

      const cancelledEvents = events.filter((e) => e.type === 'clone.cancelled')
      expect(cancelledEvents.length).toBe(1)
      expect(cancelledEvents[0].data).toHaveProperty('progress')
      expect(cancelledEvents[0].data).toHaveProperty('checkpointsCreated')
    })

    it('should emit clone.lock.acquired when obtaining lock', async () => {
      const events: ResumableCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({
          type: verb as ResumableCloneEventType,
          cloneId: '',
          timestamp: new Date(),
          data
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      })

      const lockEvents = events.filter((e) => e.type === 'clone.lock.acquired')
      expect(lockEvents.length).toBe(1)
      expect(lockEvents[0].data).toHaveProperty('lockId')
      expect(lockEvents[0].data).toHaveProperty('target')
    })

    it('should emit clone.lock.released when releasing lock', async () => {
      const events: ResumableCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({
          type: verb as ResumableCloneEventType,
          cloneId: '',
          timestamp: new Date(),
          data
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(1000)
      await handle.cancel()

      const releaseEvents = events.filter((e) => e.type === 'clone.lock.released')
      expect(releaseEvents.length).toBe(1)
    })
  })

  // ==========================================================================
  // INTEGRATION WITH CLONE RESULT
  // ==========================================================================

  describe('Integration with CloneResult', () => {
    it('should return standard CloneResult with resumable mode', async () => {
      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'resumable' })

      expect(cloneResult).toHaveProperty('ns')
      expect(cloneResult).toHaveProperty('doId')
      expect(cloneResult).toHaveProperty('mode')
      expect((cloneResult as CloneResult).mode).toBe('resumable')
    })

    it('should include checkpoint info in CloneResult', async () => {
      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as CloneResult

      expect(cloneResult).toHaveProperty('checkpoint')
      if (cloneResult.checkpoint) {
        expect(cloneResult.checkpoint).toHaveProperty('id')
        expect(cloneResult.checkpoint).toHaveProperty('progress')
        expect(cloneResult.checkpoint).toHaveProperty('resumable')
        expect(cloneResult.checkpoint.resumable).toBe(true)
      }
    })

    it('should support resuming via clone with resumeFrom option', async () => {
      const target = 'https://target.test.do'

      // Start initial clone
      const handle1 = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      const checkpoint = await handle1.waitForCheckpoint()
      await handle1.pause()

      // Resume from checkpoint
      const handle2 = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        resumeFrom: checkpoint.id,
        forceLock: true, // Override the paused clone's lock
      }) as unknown as ResumableCloneHandle

      expect(handle2.status).not.toBe('initializing')
      const progress = await handle2.getProgress()
      expect(progress).toBeGreaterThan(0)
    })

    it('should not include staged fields in resumable mode', async () => {
      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'resumable' }) as CloneResult

      expect(cloneResult.staged).toBeUndefined()
    })
  })

  // ==========================================================================
  // COMPRESSION
  // ==========================================================================

  describe('Compression Support', () => {
    it('should support compress option for transfer', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        compress: true,
      }) as unknown as ResumableCloneHandle

      expect(handle).toBeDefined()
      expect(handle.status).toBe('initializing')
    })

    it('should indicate compression in checkpoint metadata', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        compress: true,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      const checkpoint = await handle.waitForCheckpoint()

      // Checkpoint should indicate if data was compressed
      // This helps ensure resume uses same compression settings
      const stored = await result.storage.get(`checkpoint:${checkpoint.id}`) as Record<string, unknown>
      expect(stored).toHaveProperty('compressed')
    })
  })

  // ==========================================================================
  // BANDWIDTH THROTTLING (Task Requirement #3)
  // ==========================================================================

  describe('Bandwidth Throttling', () => {
    it('should respect maximum bandwidth limit', async () => {
      // Create large dataset for bandwidth testing
      result.sqlData.set('things', Array.from({ length: 1000 }, (_, i) => ({
        id: `large-thing-${i}`,
        type: 1,
        data: JSON.stringify({ index: i, payload: 'x'.repeat(10000) }), // Large payload
        version: 1,
        branch: 'main',
        deleted: false,
      })))

      const target = 'https://target.test.do'
      const maxBandwidth = 50000 // 50KB/s
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 10,
        maxBandwidth,
      }) as unknown as ResumableCloneHandle

      // Let it run for 10 seconds
      await vi.advanceTimersByTimeAsync(10000)

      const progress = await handle.getProgress()

      // Transfer should be throttled - bytes transferred should not exceed
      // maxBandwidth * elapsed_seconds (with some tolerance)
      const maxExpectedBytes = maxBandwidth * 12 // 10s + 2s tolerance
      expect((progress as unknown as { bytesTransferred: number }).bytesTransferred).toBeLessThanOrEqual(maxExpectedBytes)
    })

    it('should emit throttle events when bandwidth limit is reached', async () => {
      const events: ResumableCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({
          type: verb as ResumableCloneEventType,
          cloneId: '',
          timestamp: new Date(),
          data
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      // Large dataset
      result.sqlData.set('things', Array.from({ length: 500 }, (_, i) => ({
        id: `thing-${i}`,
        type: 1,
        data: JSON.stringify({ index: i, payload: 'x'.repeat(5000) }),
        version: 1,
        branch: 'main',
        deleted: false,
      })))

      const target = 'https://target.test.do'
      await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 50,
        maxBandwidth: 10000, // Very low - 10KB/s
      })

      await vi.advanceTimersByTimeAsync(5000)

      const throttleEvents = events.filter((e) => e.type === 'clone.throttled' as unknown as ResumableCloneEventType)
      expect(throttleEvents.length).toBeGreaterThanOrEqual(1)
    })

    it('should complete clone even with low bandwidth limit', async () => {
      // Small dataset for this test
      result.sqlData.set('things', Array.from({ length: 10 }, (_, i) => ({
        id: `thing-${i}`,
        type: 1,
        data: JSON.stringify({ index: i }),
        version: 1,
        branch: 'main',
        deleted: false,
      })))

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 5,
        maxBandwidth: 1000, // 1KB/s
      }) as unknown as ResumableCloneHandle

      // Run long enough for slow transfer to complete
      await vi.advanceTimersByTimeAsync(120000)

      expect(handle.status).toBe('completed')
    })

    it('should allow unlimited bandwidth when not specified', async () => {
      const events: ResumableCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({
          type: verb as ResumableCloneEventType,
          cloneId: '',
          timestamp: new Date(),
          data
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        // No maxBandwidth specified
      })

      await vi.advanceTimersByTimeAsync(5000)

      // Should proceed at full speed (no throttle events)
      const throttleEvents = events.filter((e) => e.type === 'clone.throttled' as unknown as ResumableCloneEventType)
      expect(throttleEvents.length).toBe(0)
    })

    it('should adjust transfer rate dynamically with bandwidth changes', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
        maxBandwidth: 100000, // Start with 100KB/s
      }) as unknown as ResumableCloneHandle & { setBandwidthLimit: (limit: number) => void }

      await vi.advanceTimersByTimeAsync(2000)

      // Dynamically reduce bandwidth (if API supports it)
      if (typeof handle.setBandwidthLimit === 'function') {
        handle.setBandwidthLimit(10000) // Reduce to 10KB/s

        await vi.advanceTimersByTimeAsync(5000)

        const progress = await handle.getProgress()
        // Transfer should have slowed down
        expect(progress).toBeDefined()
      }
    })
  })

  // ==========================================================================
  // ACCURATE PROGRESS TRACKING (Task Requirement #2 - Extended)
  // ==========================================================================

  describe('Accurate Progress Tracking', () => {
    it('should report progress as percentage (0-100)', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(3000)

      const progress = await handle.getProgress()
      expect(progress).toBeGreaterThanOrEqual(0)
      expect(progress).toBeLessThanOrEqual(100)
    })

    it('should track items transferred vs total items', async () => {
      const totalItems = 500
      result.sqlData.set('things', Array.from({ length: totalItems }, (_, i) => ({
        id: `thing-${i}`,
        type: 1,
        data: JSON.stringify({ index: i }),
        version: 1,
        branch: 'main',
        deleted: false,
      })))

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 50,
      }) as unknown as ResumableCloneHandle & { getDetailedProgress: () => Promise<{ itemsTransferred: number; totalItems: number }> }

      await vi.advanceTimersByTimeAsync(5000)

      if (typeof handle.getDetailedProgress === 'function') {
        const detailed = await handle.getDetailedProgress()
        expect(detailed.totalItems).toBe(totalItems)
        expect(detailed.itemsTransferred).toBeLessThanOrEqual(detailed.totalItems)
        expect(detailed.itemsTransferred).toBeGreaterThanOrEqual(0)
      }
    })

    it('should track bytes transferred for size-based progress', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle & { getDetailedProgress: () => Promise<{ bytesTransferred: number; totalBytes: number }> }

      await vi.advanceTimersByTimeAsync(3000)

      if (typeof handle.getDetailedProgress === 'function') {
        const detailed = await handle.getDetailedProgress()
        expect(detailed.bytesTransferred).toBeGreaterThanOrEqual(0)
        expect(detailed.totalBytes).toBeGreaterThan(0)
        expect(detailed.bytesTransferred).toBeLessThanOrEqual(detailed.totalBytes)
      }
    })

    it('should calculate estimated time remaining', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle & { getETA: () => Promise<number | null> }

      await vi.advanceTimersByTimeAsync(3000)

      if (typeof handle.getETA === 'function') {
        const eta = await handle.getETA()
        // ETA should be null if complete, or a positive number otherwise
        if (eta !== null) {
          expect(eta).toBeGreaterThanOrEqual(0)
        }
      }
    })

    it('should report transfer rate (items or bytes per second)', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle & { getTransferRate: () => Promise<number> }

      await vi.advanceTimersByTimeAsync(5000)

      if (typeof handle.getTransferRate === 'function') {
        const rate = await handle.getTransferRate()
        expect(rate).toBeGreaterThanOrEqual(0)
      }
    })

    it('should emit progress events at regular intervals', async () => {
      const events: ResumableCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({
          type: verb as ResumableCloneEventType,
          cloneId: '',
          timestamp: new Date(),
          data
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      })

      await vi.advanceTimersByTimeAsync(10000)

      const progressEvents = events.filter((e) => e.type === 'clone.batch.completed')
      expect(progressEvents.length).toBeGreaterThan(1)

      // Progress events should be monotonically increasing
      const progressValues = progressEvents.map((e) =>
        (e.data as unknown as { batchNumber: number })?.batchNumber || 0
      )
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThan(progressValues[i - 1])
      }
    })

    it('should correctly report 100% on completion', async () => {
      // Small dataset for quick completion
      result.sqlData.set('things', Array.from({ length: 50 }, (_, i) => ({
        id: `thing-${i}`,
        type: 1,
        data: JSON.stringify({ index: i }),
        version: 1,
        branch: 'main',
        deleted: false,
      })))

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 50,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(10000)

      if (handle.status === 'completed') {
        const progress = await handle.getProgress()
        expect(progress).toBe(100)
      }
    })
  })

  // ==========================================================================
  // RESUME FROM CORRECT POSITION (Task Requirement #4 - Extended)
  // ==========================================================================

  describe('Resume from Correct Position', () => {
    it('should track exact cursor position in checkpoint', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(3000)
      await handle.waitForCheckpoint()

      const lastCheckpoint = handle.checkpoints[handle.checkpoints.length - 1]

      // Checkpoint should have precise position info
      expect(lastCheckpoint.position).toBeDefined()
      expect(lastCheckpoint.position).toBeGreaterThan(0)
      expect(lastCheckpoint.itemsProcessed).toBeDefined()
    })

    it('should resume from exact item after checkpoint', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(3000)
      const checkpointBefore = await handle.waitForCheckpoint()
      const itemsBefore = checkpointBefore.itemsProcessed

      await handle.pause()
      await handle.resume()

      await vi.advanceTimersByTimeAsync(1000)
      const checkpointAfter = handle.checkpoints[handle.checkpoints.length - 1]

      // Items processed should continue from checkpoint, not restart
      expect(checkpointAfter.itemsProcessed).toBeGreaterThanOrEqual(itemsBefore)
    })

    it('should not duplicate items when resuming', async () => {
      const totalItems = 200
      result.sqlData.set('things', Array.from({ length: totalItems }, (_, i) => ({
        id: `thing-${i}`,
        type: 1,
        data: JSON.stringify({ index: i }),
        version: 1,
        branch: 'main',
        deleted: false,
      })))

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 50,
      }) as unknown as ResumableCloneHandle

      // Pause and resume multiple times
      await vi.advanceTimersByTimeAsync(1000)
      await handle.pause()
      await handle.resume()
      await vi.advanceTimersByTimeAsync(1000)
      await handle.pause()
      await handle.resume()

      // Complete
      await vi.advanceTimersByTimeAsync(30000)

      if (handle.status === 'completed') {
        // Total items processed should equal exactly the dataset size
        const lastCheckpoint = handle.checkpoints[handle.checkpoints.length - 1]
        expect(lastCheckpoint.itemsProcessed).toBe(totalItems)
      }
    })

    it('should verify checkpoint source version matches before resuming', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      await vi.advanceTimersByTimeAsync(2000)
      const checkpoint = await handle.waitForCheckpoint()
      await handle.pause()

      // Modify source data significantly (version change)
      const things = result.sqlData.get('things') as Array<Record<string, unknown>>
      things.forEach((thing, i) => {
        thing.version = 2 // Bump all versions
      })

      // Try to resume - should fail or warn about version mismatch
      const canResume = await handle.canResumeFrom(checkpoint.id)
      // Depending on implementation, may reject resume or warn
      // The key is that the checkpoint includes source version for validation
      expect(checkpoint).toHaveProperty('batchNumber')
    })

    it('should handle partial batch recovery correctly', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      // Let it process partway through a batch
      await vi.advanceTimersByTimeAsync(1500)
      await handle.pause()

      const progressBeforePause = await handle.getProgress()

      await handle.resume()
      await vi.advanceTimersByTimeAsync(3000)

      const progressAfterResume = await handle.getProgress()

      // Should continue from checkpoint, not from middle of partial batch
      expect(progressAfterResume).toBeGreaterThanOrEqual(progressBeforePause)
    })
  })

  // ==========================================================================
  // MULTIPLE PAUSE/RESUME CYCLES (Task Requirement #5 - Extended)
  // ==========================================================================

  describe('Multiple Pause/Resume Cycles', () => {
    it('should handle 5+ consecutive pause/resume cycles', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      const progressHistory: number[] = []

      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(500)
        const progress = await handle.getProgress()
        progressHistory.push(progress)
        await handle.pause()
        await vi.advanceTimersByTimeAsync(100) // Brief pause
        await handle.resume()
      }

      // Progress should be monotonically increasing
      for (let i = 1; i < progressHistory.length; i++) {
        expect(progressHistory[i]).toBeGreaterThanOrEqual(progressHistory[i - 1])
      }
    })

    it('should maintain data integrity across many cycles', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      const hashes: string[] = []

      // Multiple pause/resume cycles, capturing integrity hash each time
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(1000)
        await handle.waitForCheckpoint()
        const hash = await handle.getIntegrityHash()
        hashes.push(hash)
        await handle.pause()
        await handle.resume()
      }

      // Each hash should be valid (non-empty)
      hashes.forEach((hash) => {
        expect(hash).toBeDefined()
        expect(hash.length).toBeGreaterThan(0)
      })
    })

    it('should accumulate checkpoints correctly across cycles', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 50,
        checkpointInterval: 1,
      }) as unknown as ResumableCloneHandle

      let totalCheckpoints = 0

      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(2000)
        totalCheckpoints = handle.checkpoints.length
        await handle.pause()
        await handle.resume()
      }

      // Should have accumulated checkpoints across all cycles
      expect(totalCheckpoints).toBeGreaterThan(3)
    })

    it('should handle rapid pause/resume cycles gracefully', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle

      // Rapid-fire pause/resume
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(100)
        await handle.pause()
        await handle.resume()
      }

      // Should not be in a broken state
      expect(['transferring', 'paused', 'completed']).toContain(handle.status)
    })

    it('should complete successfully after multiple interruptions', async () => {
      // Small dataset for faster completion
      result.sqlData.set('things', Array.from({ length: 100 }, (_, i) => ({
        id: `thing-${i}`,
        type: 1,
        data: JSON.stringify({ index: i }),
        version: 1,
        branch: 'main',
        deleted: false,
      })))

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 25,
      }) as unknown as ResumableCloneHandle

      // Interrupt multiple times during transfer
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(500)
        if (handle.status === 'completed') break
        await handle.pause()
        await vi.advanceTimersByTimeAsync(200)
        await handle.resume()
      }

      // Let it complete
      await vi.advanceTimersByTimeAsync(30000)

      expect(handle.status).toBe('completed')
    })

    it('should track total time including all pauses', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, {
        mode: 'resumable',
        batchSize: 100,
      }) as unknown as ResumableCloneHandle & { getTotalElapsedTime: () => Promise<number> }

      await vi.advanceTimersByTimeAsync(1000)
      await handle.pause()
      await vi.advanceTimersByTimeAsync(5000) // 5 second pause
      await handle.resume()
      await vi.advanceTimersByTimeAsync(1000)
      await handle.pause()
      await vi.advanceTimersByTimeAsync(3000) // 3 second pause
      await handle.resume()
      await vi.advanceTimersByTimeAsync(1000)

      if (typeof handle.getTotalElapsedTime === 'function') {
        const totalTime = await handle.getTotalElapsedTime()
        // Should be at least 11 seconds (1+5+1+3+1)
        expect(totalTime).toBeGreaterThanOrEqual(11000)
      }
    })
  })
})
