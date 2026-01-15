/**
 * WriteLockManager Queue Bounds Tests - TDD RED Phase
 *
 * Issue: do-p9rp - Memory leak: Queue grows unbounded if lock held indefinitely
 *
 * These tests verify that the WriteLockManager queue has proper bounds
 * to prevent memory exhaustion under high contention.
 *
 * Test coverage:
 * 1. Queue rejects when at maxQueueDepth
 * 2. Error type is QueueFullError
 * 3. Existing queued requests still work
 * 4. Cleanup when requests timeout
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  WriteLockManager,
  QueueFullError,
  type WriteLockManagerOptions,
} from '../../../db/concurrency'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a delay promise
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('WriteLockManager Queue Bounds - RED Phase', () => {
  let lockManager: WriteLockManager

  afterEach(async () => {
    // Use try-catch to ignore unhandled rejections from clearAll()
    // when tests have already cleaned up their promises
    try {
      lockManager?.clearAll()
    } catch {
      // Ignore errors from clearing already-resolved locks
    }
    // Allow any pending rejections to settle
    await new Promise((resolve) => setTimeout(resolve, 10))
  })

  // ============================================================================
  // 1. QUEUE REJECTS WHEN AT MAX DEPTH
  // ============================================================================

  describe('Queue Depth Limits', () => {
    it('should accept constructor options with maxQueueDepth', () => {
      const options: WriteLockManagerOptions = {
        maxQueueDepth: 5,
      }
      lockManager = new WriteLockManager(options)

      // Manager should be created successfully
      expect(lockManager).toBeDefined()
    })

    it('should default maxQueueDepth to 1000', () => {
      lockManager = new WriteLockManager()

      // Default should allow up to 1000 queued requests per key
      // We verify by checking the config or metrics
      const metrics = lockManager.getMetrics()
      expect(metrics.maxQueueDepth).toBe(1000)
    })

    it('should reject new requests when queue reaches maxQueueDepth', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 3 })

      // Hold a lock on key 'test'
      const heldLock = await lockManager.acquireLock('test')

      // Queue 3 more requests (fills the queue to maxQueueDepth)
      const queued1 = lockManager.acquireLock('test', { timeout: 5000 })
      const queued2 = lockManager.acquireLock('test', { timeout: 5000 })
      const queued3 = lockManager.acquireLock('test', { timeout: 5000 })

      // Queue should be at capacity (3)
      expect(lockManager.getQueueLength('test')).toBe(3)

      // 4th request should be rejected immediately
      await expect(
        lockManager.acquireLock('test', { timeout: 5000 })
      ).rejects.toThrow(QueueFullError)

      // Clean up - release locks serially (each queued lock gets acquired after previous is released)
      heldLock.release()
      const lock1 = await queued1
      lock1.release()
      const lock2 = await queued2
      lock2.release()
      const lock3 = await queued3
      lock3.release()
    })

    it('should allow requests after queue drains below maxQueueDepth', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 2 })

      // Hold a lock
      const heldLock = await lockManager.acquireLock('test')

      // Fill queue to max
      const queued1 = lockManager.acquireLock('test', { timeout: 5000 })
      const queued2 = lockManager.acquireLock('test', { timeout: 5000 })

      expect(lockManager.getQueueLength('test')).toBe(2)

      // Should reject while full
      await expect(
        lockManager.acquireLock('test', { timeout: 100 })
      ).rejects.toThrow(QueueFullError)

      // Release held lock to process queue
      heldLock.release()

      // First queued request gets the lock
      const lock1 = await queued1
      expect(lockManager.getQueueLength('test')).toBe(1)

      // Now queue has space, new request should be accepted
      const queued3 = lockManager.acquireLock('test', { timeout: 5000 })

      // Clean up
      lock1.release()
      const lock2 = await queued2
      lock2.release()
      const lock3 = await queued3
      lock3.release()
    })

    it('should track queue depth per key independently', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 2 })

      // Hold locks on two different keys
      const heldLockA = await lockManager.acquireLock('keyA')
      const heldLockB = await lockManager.acquireLock('keyB')

      // Fill queue for keyA
      const queuedA1 = lockManager.acquireLock('keyA', { timeout: 5000 })
      const queuedA2 = lockManager.acquireLock('keyA', { timeout: 5000 })

      // keyA queue is full
      await expect(
        lockManager.acquireLock('keyA', { timeout: 100 })
      ).rejects.toThrow(QueueFullError)

      // But keyB still has room
      const queuedB1 = lockManager.acquireLock('keyB', { timeout: 5000 })
      const queuedB2 = lockManager.acquireLock('keyB', { timeout: 5000 })

      expect(lockManager.getQueueLength('keyA')).toBe(2)
      expect(lockManager.getQueueLength('keyB')).toBe(2)

      // Clean up - release each key's chain serially
      heldLockA.release()
      const lockA1 = await queuedA1
      lockA1.release()
      const lockA2 = await queuedA2
      lockA2.release()

      heldLockB.release()
      const lockB1 = await queuedB1
      lockB1.release()
      const lockB2 = await queuedB2
      lockB2.release()
    })
  })

  // ============================================================================
  // 2. ERROR TYPE IS QueueFullError
  // ============================================================================

  describe('QueueFullError Type', () => {
    it('should throw QueueFullError with correct properties', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 1 })

      const heldLock = await lockManager.acquireLock('test-key')
      lockManager.acquireLock('test-key', { timeout: 5000 }) // Fill queue

      try {
        await lockManager.acquireLock('test-key', { timeout: 100 })
        expect.fail('Should have thrown QueueFullError')
      } catch (error) {
        expect(error).toBeInstanceOf(QueueFullError)

        const queueError = error as QueueFullError
        expect(queueError.key).toBe('test-key')
        expect(queueError.queueDepth).toBe(1)
        expect(queueError.maxQueueDepth).toBe(1)
        expect(queueError.message).toContain('Queue full')
        expect(queueError.message).toContain('test-key')
      }

      heldLock.release()
    })

    it('should allow catching QueueFullError specifically', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 0 })

      const heldLock = await lockManager.acquireLock('test')

      let caughtQueueFull = false
      try {
        await lockManager.acquireLock('test')
      } catch (error) {
        if (error instanceof QueueFullError) {
          caughtQueueFull = true
        }
      }

      expect(caughtQueueFull).toBe(true)
      heldLock.release()
    })

    it('should extend Error properly', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 0 })

      const heldLock = await lockManager.acquireLock('test')

      try {
        await lockManager.acquireLock('test')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(error).toBeInstanceOf(QueueFullError)
        expect((error as Error).name).toBe('QueueFullError')
      }

      heldLock.release()
    })
  })

  // ============================================================================
  // 3. EXISTING QUEUED REQUESTS STILL WORK
  // ============================================================================

  describe('Existing Queued Requests', () => {
    it('should process existing queued requests when lock is released', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 3 })

      const executionOrder: number[] = []

      // Hold initial lock
      const heldLock = await lockManager.acquireLock('test')

      // Queue 3 requests
      const queued1 = lockManager.acquireLock('test').then((lock) => {
        executionOrder.push(1)
        return lock
      })
      const queued2 = lockManager.acquireLock('test').then((lock) => {
        executionOrder.push(2)
        return lock
      })
      const queued3 = lockManager.acquireLock('test').then((lock) => {
        executionOrder.push(3)
        return lock
      })

      // Try to queue 4th (should fail)
      await expect(lockManager.acquireLock('test')).rejects.toThrow(QueueFullError)

      // Execution order should be empty (nothing processed yet)
      expect(executionOrder).toEqual([])

      // Release lock - should process queue in order
      heldLock.release()
      const lock1 = await queued1
      lock1.release()
      const lock2 = await queued2
      lock2.release()
      const lock3 = await queued3
      lock3.release()

      // All queued requests should have been processed in FIFO order
      expect(executionOrder).toEqual([1, 2, 3])
    })

    it('should not affect queued requests when new request is rejected', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 2 })

      const heldLock = await lockManager.acquireLock('test')

      // Queue 2 requests
      const queued1Promise = lockManager.acquireLock('test', { timeout: 5000 })
      const queued2Promise = lockManager.acquireLock('test', { timeout: 5000 })

      // Reject a 3rd
      await expect(lockManager.acquireLock('test')).rejects.toThrow(QueueFullError)

      // The existing queued requests should still be pending
      expect(lockManager.getQueueLength('test')).toBe(2)

      // Release and verify queued requests complete
      heldLock.release()

      const lock1 = await queued1Promise
      expect(lock1.key).toBe('test')
      lock1.release()

      const lock2 = await queued2Promise
      expect(lock2.key).toBe('test')
      lock2.release()
    })

    it('should respect priority ordering even when queue is near capacity', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 3 })

      const executionOrder: number[] = []

      const heldLock = await lockManager.acquireLock('test')

      // Queue requests with different priorities
      const lowPriority = lockManager.acquireLock('test', { priority: 1 }).then((lock) => {
        executionOrder.push(1)
        return lock
      })
      const highPriority = lockManager.acquireLock('test', { priority: 10 }).then((lock) => {
        executionOrder.push(10)
        return lock
      })
      const medPriority = lockManager.acquireLock('test', { priority: 5 }).then((lock) => {
        executionOrder.push(5)
        return lock
      })

      // Release and process - locks will be granted in priority order
      heldLock.release()

      // High priority gets first lock
      const lock1 = await highPriority
      expect(executionOrder[0]).toBe(10)
      lock1.release()

      // Medium priority gets second lock
      const lock2 = await medPriority
      lock2.release()

      // Low priority gets third lock
      const lock3 = await lowPriority
      lock3.release()

      // Verify execution order
      expect(executionOrder).toEqual([10, 5, 1])
    })
  })

  // ============================================================================
  // 4. CLEANUP WHEN REQUESTS TIMEOUT
  // ============================================================================

  describe('Queue Cleanup on Timeout', () => {
    it('should remove request from queue when it times out', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 3 })

      const heldLock = await lockManager.acquireLock('test')

      // Queue a request with short timeout
      const shortTimeoutPromise = lockManager.acquireLock('test', { timeout: 50 })

      expect(lockManager.getQueueLength('test')).toBe(1)

      // Wait for timeout
      await expect(shortTimeoutPromise).rejects.toThrow(/timed out/)

      // Queue should be empty after timeout
      expect(lockManager.getQueueLength('test')).toBe(0)

      heldLock.release()
    })

    it('should free queue slot when request times out', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 2 })

      const heldLock = await lockManager.acquireLock('test')

      // Fill queue
      const shortTimeout = lockManager.acquireLock('test', { timeout: 50 })
      const longTimeout = lockManager.acquireLock('test', { timeout: 5000 })

      // Queue is full
      await expect(lockManager.acquireLock('test', { timeout: 10 })).rejects.toThrow(QueueFullError)

      // Wait for short timeout to expire
      await expect(shortTimeout).rejects.toThrow(/timed out/)

      // Now there should be room in the queue
      const newRequest = lockManager.acquireLock('test', { timeout: 5000 })
      expect(lockManager.getQueueLength('test')).toBe(2)

      // Clean up - release held lock, then process remaining queue serially
      heldLock.release()
      const lock1 = await longTimeout
      lock1.release()
      const lock2 = await newRequest
      lock2.release()
    })

    it('should clean up multiple timed-out requests', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 5 })

      const heldLock = await lockManager.acquireLock('test')

      // Queue multiple requests with short timeouts
      const promises = Array.from({ length: 5 }, () =>
        lockManager.acquireLock('test', { timeout: 30 })
      )

      expect(lockManager.getQueueLength('test')).toBe(5)

      // Wait for all to timeout
      const results = await Promise.allSettled(promises)
      results.forEach((result) => {
        expect(result.status).toBe('rejected')
      })

      // Queue should be empty
      expect(lockManager.getQueueLength('test')).toBe(0)

      heldLock.release()
    })

    it('should handle mixed timeout and success scenarios', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 3 })

      const heldLock = await lockManager.acquireLock('test')

      // Mix of short and long timeouts
      const willTimeout = lockManager.acquireLock('test', { timeout: 30 })
      const willSucceed1 = lockManager.acquireLock('test', { timeout: 5000 })
      const willSucceed2 = lockManager.acquireLock('test', { timeout: 5000 })

      // Wait for first to timeout
      await expect(willTimeout).rejects.toThrow(/timed out/)

      // Queue should have 2 remaining
      expect(lockManager.getQueueLength('test')).toBe(2)

      // Release and let remaining complete
      heldLock.release()
      const lock1 = await willSucceed1
      lock1.release()
      const lock2 = await willSucceed2
      lock2.release()
    })
  })

  // ============================================================================
  // 5. METRICS
  // ============================================================================

  describe('Queue Metrics', () => {
    it('should report queuedRequests in metrics', () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 10 })

      const metrics = lockManager.getMetrics()
      expect(metrics).toHaveProperty('queuedRequestsCount')
      expect(typeof metrics.queuedRequestsCount).toBe('number')
    })

    it('should report maxQueueDepth in metrics', () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 42 })

      const metrics = lockManager.getMetrics()
      expect(metrics.maxQueueDepth).toBe(42)
    })

    it('should track queueFullRejections count', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 1 })

      const heldLock = await lockManager.acquireLock('test')
      const queuedRequest = lockManager.acquireLock('test', { timeout: 5000 }) // Fill queue

      // Trigger rejections
      try { await lockManager.acquireLock('test') } catch {}
      try { await lockManager.acquireLock('test') } catch {}
      try { await lockManager.acquireLock('test') } catch {}

      const metrics = lockManager.getMetrics()
      expect(metrics.queueFullRejections).toBe(3)

      // Clean up
      heldLock.release()
      const lock = await queuedRequest
      lock.release()
    })

    it('should accurately track queuedRequestsCount across multiple keys', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 10 })

      const heldA = await lockManager.acquireLock('keyA')
      const heldB = await lockManager.acquireLock('keyB')

      // Queue requests
      const q1 = lockManager.acquireLock('keyA', { timeout: 5000 })
      const q2 = lockManager.acquireLock('keyA', { timeout: 5000 })
      const q3 = lockManager.acquireLock('keyB', { timeout: 5000 })

      const metrics = lockManager.getMetrics()
      expect(metrics.queuedRequestsCount).toBe(3)

      // Clean up - release serially for each key
      heldA.release()
      const l1 = await q1
      l1.release()
      const l2 = await q2
      l2.release()

      heldB.release()
      const l3 = await q3
      l3.release()
    })
  })

  // ============================================================================
  // 6. EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle maxQueueDepth of 0 (no queuing allowed)', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 0 })

      const heldLock = await lockManager.acquireLock('test')

      // Any queued request should be rejected immediately
      await expect(lockManager.acquireLock('test')).rejects.toThrow(QueueFullError)

      heldLock.release()
    })

    it('should handle very large maxQueueDepth', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 100000 })

      const metrics = lockManager.getMetrics()
      expect(metrics.maxQueueDepth).toBe(100000)
    })

    it('should not count active lock holders in queue depth', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 2 })

      // Get a lock (this is NOT in the queue, it's the active holder)
      const activeLock = await lockManager.acquireLock('test')

      // Queue depth should be 0
      expect(lockManager.getQueueLength('test')).toBe(0)

      // Can still queue up to maxQueueDepth
      const q1 = lockManager.acquireLock('test', { timeout: 5000 })
      const q2 = lockManager.acquireLock('test', { timeout: 5000 })

      expect(lockManager.getQueueLength('test')).toBe(2)

      // Clean up - release serially
      activeLock.release()
      const l1 = await q1
      l1.release()
      const l2 = await q2
      l2.release()
    })

    it('should reject immediately without adding to queue when full', async () => {
      lockManager = new WriteLockManager({ maxQueueDepth: 1 })

      const heldLock = await lockManager.acquireLock('test')
      lockManager.acquireLock('test', { timeout: 5000 }) // Fill queue

      const startTime = Date.now()

      try {
        await lockManager.acquireLock('test', { timeout: 10000 })
        expect.fail('Should have thrown')
      } catch (error) {
        // Should reject immediately, not after timeout
        const elapsed = Date.now() - startTime
        expect(elapsed).toBeLessThan(100) // Should be nearly instant
        expect(error).toBeInstanceOf(QueueFullError)
      }

      heldLock.release()
    })
  })
})
