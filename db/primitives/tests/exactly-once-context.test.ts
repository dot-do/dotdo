/**
 * ExactlyOnceContext tests
 *
 * RED phase: These tests define the expected behavior of ExactlyOnceContext.
 * All tests should FAIL until implementation is complete.
 *
 * ExactlyOnceContext provides transactional processing with:
 * - Idempotent event processing (deduplication)
 * - Atomic transactions with rollback
 * - Outbox pattern for event delivery
 * - Checkpoint/recovery for distributed systems
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ExactlyOnceContext,
  createExactlyOnceContext,
  type CheckpointBarrier,
  type CheckpointState,
  type Transaction,
  type ExactlyOnceContextOptions,
} from '../exactly-once-context'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createContext(options?: ExactlyOnceContextOptions): ExactlyOnceContext {
  return createExactlyOnceContext(options)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// PROCESS ONCE - EXACTLY ONCE EXECUTION
// ============================================================================

describe('ExactlyOnceContext', () => {
  describe('processOnce - exactly once execution', () => {
    it('should execute function and return result', async () => {
      const ctx = createContext()
      const result = await ctx.processOnce('event-1', async () => {
        return 'result-1'
      })
      expect(result).toBe('result-1')
    })

    it('should not execute function twice for same eventId', async () => {
      const ctx = createContext()
      const fn = vi.fn(async () => 'result')

      await ctx.processOnce('event-1', fn)
      await ctx.processOnce('event-1', fn)

      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should return cached result for duplicate eventId', async () => {
      const ctx = createContext()
      let counter = 0

      const result1 = await ctx.processOnce('event-1', async () => {
        counter++
        return `result-${counter}`
      })
      const result2 = await ctx.processOnce('event-1', async () => {
        counter++
        return `result-${counter}`
      })

      expect(result1).toBe('result-1')
      expect(result2).toBe('result-1') // Same as first
    })

    it('should execute different eventIds independently', async () => {
      const ctx = createContext()
      const fn1 = vi.fn(async () => 'result-1')
      const fn2 = vi.fn(async () => 'result-2')

      await ctx.processOnce('event-1', fn1)
      await ctx.processOnce('event-2', fn2)

      expect(fn1).toHaveBeenCalledTimes(1)
      expect(fn2).toHaveBeenCalledTimes(1)
    })

    it('should propagate errors from function', async () => {
      const ctx = createContext()
      await expect(
        ctx.processOnce('event-1', async () => {
          throw new Error('Processing failed')
        })
      ).rejects.toThrow('Processing failed')
    })

    it('should allow retry after error', async () => {
      const ctx = createContext()
      let attempt = 0

      // First attempt fails
      await expect(
        ctx.processOnce('event-1', async () => {
          attempt++
          if (attempt === 1) throw new Error('First attempt failed')
          return 'success'
        })
      ).rejects.toThrow('First attempt failed')

      // Second attempt should be allowed since first failed
      const result = await ctx.processOnce('event-1', async () => {
        attempt++
        return 'success'
      })
      expect(result).toBe('success')
    })
  })

  // ============================================================================
  // IS PROCESSED - EVENT TRACKING
  // ============================================================================

  describe('isProcessed - event tracking', () => {
    it('should return false for unprocessed eventId', async () => {
      const ctx = createContext()
      expect(await ctx.isProcessed('event-1')).toBe(false)
    })

    it('should return true for processed eventId', async () => {
      const ctx = createContext()
      await ctx.processOnce('event-1', async () => 'result')
      expect(await ctx.isProcessed('event-1')).toBe(true)
    })

    it('should return false for failed processing', async () => {
      const ctx = createContext()
      try {
        await ctx.processOnce('event-1', async () => {
          throw new Error('Failed')
        })
      } catch {
        // Expected
      }
      expect(await ctx.isProcessed('event-1')).toBe(false)
    })
  })

  // ============================================================================
  // TRANSACTION - ATOMIC OPERATIONS
  // ============================================================================

  describe('transaction - atomic operations', () => {
    it('should commit transaction on success', async () => {
      const ctx = createContext()
      await ctx.transaction(async (tx) => {
        await tx.put('key1', 'value1')
        await tx.put('key2', 'value2')
      })

      // Verify in another transaction
      let value1: unknown, value2: unknown
      await ctx.transaction(async (tx) => {
        value1 = await tx.get('key1')
        value2 = await tx.get('key2')
      })
      expect(value1).toBe('value1')
      expect(value2).toBe('value2')
    })

    it('should rollback transaction on error', async () => {
      const ctx = createContext()

      // First set a known value
      await ctx.transaction(async (tx) => {
        await tx.put('key1', 'initial')
      })

      // Try to update but fail
      await expect(
        ctx.transaction(async (tx) => {
          await tx.put('key1', 'updated')
          throw new Error('Transaction failed')
        })
      ).rejects.toThrow('Transaction failed')

      // Verify rollback
      let value: unknown
      await ctx.transaction(async (tx) => {
        value = await tx.get('key1')
      })
      expect(value).toBe('initial')
    })

    it('should return result from transaction', async () => {
      const ctx = createContext()
      const result = await ctx.transaction(async (tx) => {
        await tx.put('key1', 'value1')
        return 'transaction-result'
      })
      expect(result).toBe('transaction-result')
    })

    it('should support delete operation', async () => {
      const ctx = createContext()
      await ctx.transaction(async (tx) => {
        await tx.put('key1', 'value1')
      })

      await ctx.transaction(async (tx) => {
        await tx.delete('key1')
      })

      let value: unknown
      await ctx.transaction(async (tx) => {
        value = await tx.get('key1')
      })
      expect(value).toBeUndefined()
    })

    it('should isolate concurrent transactions', async () => {
      const ctx = createContext()
      const results: string[] = []

      // Two transactions trying to read-modify-write
      await Promise.all([
        ctx.transaction(async (tx) => {
          const val = (await tx.get('counter')) as number || 0
          await delay(10)
          await tx.put('counter', val + 1)
          results.push('tx1')
        }),
        ctx.transaction(async (tx) => {
          const val = (await tx.get('counter')) as number || 0
          await delay(5)
          await tx.put('counter', val + 1)
          results.push('tx2')
        }),
      ])

      let counter: unknown
      await ctx.transaction(async (tx) => {
        counter = await tx.get('counter')
      })
      // Both should have committed, counter should be 2 or transactions should be serialized
      expect(counter).toBeGreaterThanOrEqual(1)
    })
  })

  // ============================================================================
  // EMIT AND FLUSH - OUTBOX PATTERN
  // ============================================================================

  describe('emit and flush - outbox pattern', () => {
    it('should buffer emitted events', () => {
      const ctx = createContext()
      ctx.emit({ type: 'event1' })
      ctx.emit({ type: 'event2' })
      expect(ctx.getBufferedEventCount()).toBe(2)
    })

    it('should deliver events on flush', async () => {
      const delivered: unknown[] = []
      const ctx = createContext({
        onDeliver: async (events) => {
          delivered.push(...events)
        },
      })

      ctx.emit({ type: 'event1' })
      ctx.emit({ type: 'event2' })
      await ctx.flush()

      expect(delivered).toHaveLength(2)
      expect(delivered[0]).toEqual({ type: 'event1' })
      expect(delivered[1]).toEqual({ type: 'event2' })
    })

    it('should clear buffer after flush', async () => {
      const ctx = createContext({
        onDeliver: async () => {},
      })

      ctx.emit({ type: 'event1' })
      await ctx.flush()
      expect(ctx.getBufferedEventCount()).toBe(0)
    })

    it('should emit events within transaction on commit', async () => {
      const delivered: unknown[] = []
      const ctx = createContext({
        onDeliver: async (events) => {
          delivered.push(...events)
        },
      })

      await ctx.transaction(async (tx) => {
        tx.emit({ type: 'tx-event1' })
        tx.emit({ type: 'tx-event2' })
      })

      await ctx.flush()
      expect(delivered).toContainEqual({ type: 'tx-event1' })
      expect(delivered).toContainEqual({ type: 'tx-event2' })
    })

    it('should NOT emit events from rolled back transaction', async () => {
      const delivered: unknown[] = []
      const ctx = createContext({
        onDeliver: async (events) => {
          delivered.push(...events)
        },
      })

      await expect(
        ctx.transaction(async (tx) => {
          tx.emit({ type: 'should-not-deliver' })
          throw new Error('Rollback')
        })
      ).rejects.toThrow('Rollback')

      await ctx.flush()
      expect(delivered).not.toContainEqual({ type: 'should-not-deliver' })
    })

    it('should handle delivery failure', async () => {
      let attempts = 0
      const ctx = createContext({
        onDeliver: async () => {
          attempts++
          throw new Error('Delivery failed')
        },
      })

      ctx.emit({ type: 'event1' })
      await expect(ctx.flush()).rejects.toThrow('Delivery failed')
      expect(attempts).toBe(1)
    })
  })

  // ============================================================================
  // CHECKPOINT - BARRIER HANDLING
  // ============================================================================

  describe('checkpoint - barrier handling', () => {
    it('should handle checkpoint barrier', async () => {
      const ctx = createContext()
      const barrier: CheckpointBarrier = {
        checkpointId: 'cp-1',
        epoch: 1,
        timestamp: Date.now(),
      }
      await expect(ctx.onBarrier(barrier)).resolves.not.toThrow()
    })

    it('should flush on barrier', async () => {
      const delivered: unknown[] = []
      const ctx = createContext({
        onDeliver: async (events) => {
          delivered.push(...events)
        },
      })

      ctx.emit({ type: 'pre-barrier' })
      await ctx.onBarrier({
        checkpointId: 'cp-1',
        epoch: 1,
        timestamp: Date.now(),
      })

      // Barrier should trigger flush
      expect(delivered).toContainEqual({ type: 'pre-barrier' })
    })

    it('should increment epoch on barrier', async () => {
      const ctx = createContext()
      const initialEpoch = ctx.getEpoch()

      await ctx.onBarrier({
        checkpointId: 'cp-1',
        epoch: 1,
        timestamp: Date.now(),
      })

      expect(ctx.getEpoch()).toBeGreaterThan(initialEpoch)
    })
  })

  // ============================================================================
  // CHECKPOINT - RECOVERY
  // ============================================================================

  describe('checkpoint - recovery', () => {
    it('should capture checkpoint state', async () => {
      const ctx = createContext()
      await ctx.processOnce('event-1', async () => 'result1')
      await ctx.transaction(async (tx) => {
        await tx.put('key1', 'value1')
      })
      ctx.emit({ type: 'pending' })

      const state = await ctx.getCheckpointState()
      expect(state.processedIds.has('event-1')).toBe(true)
      expect(state.state.get('key1')).toBe('value1')
      expect(state.pendingEvents).toContainEqual({ type: 'pending' })
    })

    it('should restore from checkpoint', async () => {
      const ctx = createContext()
      const checkpointState: CheckpointState = {
        state: new Map([['key1', 'restored-value']]),
        processedIds: new Set(['event-old']),
        pendingEvents: [{ type: 'pending-restored' }],
        epoch: 5,
      }

      await ctx.restoreFromCheckpoint(checkpointState)

      // Verify state restored
      let value: unknown
      await ctx.transaction(async (tx) => {
        value = await tx.get('key1')
      })
      expect(value).toBe('restored-value')

      // Verify processed IDs restored
      expect(await ctx.isProcessed('event-old')).toBe(true)

      // Verify epoch restored
      expect(ctx.getEpoch()).toBe(5)
    })

    it('should continue processing after restore', async () => {
      const ctx = createContext()
      await ctx.restoreFromCheckpoint({
        state: new Map(),
        processedIds: new Set(['event-1']),
        pendingEvents: [],
        epoch: 1,
      })

      // Old event should be deduplicated
      const fn = vi.fn(async () => 'new-result')
      await ctx.processOnce('event-1', fn)
      expect(fn).not.toHaveBeenCalled()

      // New event should process
      const result = await ctx.processOnce('event-2', async () => 'result-2')
      expect(result).toBe('result-2')
    })
  })

  // ============================================================================
  // CONCURRENT PROCESS ONCE - RACE CONDITIONS
  // ============================================================================

  describe('concurrent processOnce - race conditions', () => {
    it('should handle concurrent calls with same eventId', async () => {
      const ctx = createContext()
      let executionCount = 0

      const results = await Promise.all([
        ctx.processOnce('event-1', async () => {
          executionCount++
          await delay(10)
          return `result-${executionCount}`
        }),
        ctx.processOnce('event-1', async () => {
          executionCount++
          await delay(5)
          return `result-${executionCount}`
        }),
      ])

      // Only one should have executed
      expect(executionCount).toBe(1)
      // Both should return same result
      expect(results[0]).toBe(results[1])
    })

    it('should handle interleaved processOnce and isProcessed', async () => {
      const ctx = createContext()

      // Start processing
      const processPromise = ctx.processOnce('event-1', async () => {
        await delay(20)
        return 'result'
      })

      // Check while processing
      await delay(5)
      const duringProcessing = await ctx.isProcessed('event-1')

      // Wait for completion
      await processPromise
      const afterProcessing = await ctx.isProcessed('event-1')

      // During processing should be false or true depending on implementation
      // After processing should definitely be true
      expect(afterProcessing).toBe(true)
    })
  })

  // ============================================================================
  // TTL CLEANUP - OLD EVENT IDS
  // ============================================================================

  describe('TTL cleanup - old eventIds', () => {
    it('should allow reprocessing after TTL expires', async () => {
      const ctx = createContext({ eventIdTtl: 50 }) // 50ms TTL
      let count = 0

      await ctx.processOnce('event-1', async () => {
        count++
        return 'first'
      })
      expect(count).toBe(1)

      // Wait for TTL
      await delay(100)

      // Should be able to reprocess
      await ctx.processOnce('event-1', async () => {
        count++
        return 'second'
      })
      expect(count).toBe(2)
    })

    it('should not allow reprocessing before TTL expires', async () => {
      const ctx = createContext({ eventIdTtl: 1000 }) // 1s TTL
      let count = 0

      await ctx.processOnce('event-1', async () => {
        count++
        return 'first'
      })

      // Immediate retry
      await ctx.processOnce('event-1', async () => {
        count++
        return 'second'
      })

      expect(count).toBe(1)
    })
  })

  // ============================================================================
  // LARGE TRANSACTION - STRESS TEST
  // ============================================================================

  describe('large transaction - stress test', () => {
    it('should handle 1000+ operations in single transaction', async () => {
      const ctx = createContext()

      await ctx.transaction(async (tx) => {
        for (let i = 0; i < 1000; i++) {
          await tx.put(`key-${i}`, `value-${i}`)
        }
      })

      // Verify all stored
      let count = 0
      await ctx.transaction(async (tx) => {
        for (let i = 0; i < 1000; i++) {
          const val = await tx.get(`key-${i}`)
          if (val === `value-${i}`) count++
        }
      })
      expect(count).toBe(1000)
    })

    it('should rollback large transaction atomically', async () => {
      const ctx = createContext()

      // First populate some data
      await ctx.transaction(async (tx) => {
        for (let i = 0; i < 100; i++) {
          await tx.put(`key-${i}`, 'initial')
        }
      })

      // Try large update that fails
      await expect(
        ctx.transaction(async (tx) => {
          for (let i = 0; i < 100; i++) {
            await tx.put(`key-${i}`, 'updated')
          }
          throw new Error('Rollback large txn')
        })
      ).rejects.toThrow('Rollback large txn')

      // All should be initial
      let initialCount = 0
      await ctx.transaction(async (tx) => {
        for (let i = 0; i < 100; i++) {
          const val = await tx.get(`key-${i}`)
          if (val === 'initial') initialCount++
        }
      })
      expect(initialCount).toBe(100)
    })

    it('should handle many emitted events', async () => {
      const delivered: unknown[] = []
      const ctx = createContext({
        onDeliver: async (events) => {
          delivered.push(...events)
        },
      })

      for (let i = 0; i < 500; i++) {
        ctx.emit({ index: i })
      }
      await ctx.flush()

      expect(delivered).toHaveLength(500)
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('error handling', () => {
    it('should propagate transaction errors', async () => {
      const ctx = createContext()
      await expect(
        ctx.transaction(async () => {
          throw new Error('Tx error')
        })
      ).rejects.toThrow('Tx error')
    })

    it('should handle delivery failure gracefully', async () => {
      const ctx = createContext({
        onDeliver: async () => {
          throw new Error('Delivery failed')
        },
      })

      ctx.emit({ type: 'event' })
      await expect(ctx.flush()).rejects.toThrow('Delivery failed')
    })

    it('should preserve events after delivery failure', async () => {
      let failNext = true
      const delivered: unknown[] = []
      const ctx = createContext({
        onDeliver: async (events) => {
          if (failNext) {
            failNext = false
            throw new Error('Delivery failed')
          }
          delivered.push(...events)
        },
      })

      ctx.emit({ type: 'event' })
      await expect(ctx.flush()).rejects.toThrow()

      // Retry should work
      await ctx.flush()
      expect(delivered).toContainEqual({ type: 'event' })
    })

    it('should handle restore with invalid state', async () => {
      const ctx = createContext()
      // Partially invalid state
      await expect(
        ctx.restoreFromCheckpoint({
          state: new Map(),
          processedIds: new Set(),
          pendingEvents: [],
          epoch: -1, // Invalid epoch
        })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty eventId', async () => {
      const ctx = createContext()
      const result = await ctx.processOnce('', async () => 'empty-id-result')
      expect(result).toBe('empty-id-result')
    })

    it('should handle very long eventId', async () => {
      const ctx = createContext()
      const longId = 'x'.repeat(10000)
      const result = await ctx.processOnce(longId, async () => 'long-id-result')
      expect(result).toBe('long-id-result')
    })

    it('should handle special characters in eventId', async () => {
      const ctx = createContext()
      const specialId = 'event/with:special@chars#and$symbols'
      const result = await ctx.processOnce(specialId, async () => 'special-result')
      expect(result).toBe('special-result')
    })

    it('should handle null and undefined values in transaction', async () => {
      const ctx = createContext()
      await ctx.transaction(async (tx) => {
        await tx.put('null-key', null)
        await tx.put('undefined-key', undefined)
      })

      let nullVal: unknown, undefinedVal: unknown
      await ctx.transaction(async (tx) => {
        nullVal = await tx.get('null-key')
        undefinedVal = await tx.get('undefined-key')
      })
      expect(nullVal).toBeNull()
      expect(undefinedVal).toBeUndefined()
    })

    it('should handle complex objects in emit', async () => {
      const delivered: unknown[] = []
      const ctx = createContext({
        onDeliver: async (events) => {
          delivered.push(...events)
        },
      })

      const complexEvent = {
        nested: { deep: { value: 'test' } },
        array: [1, 2, { three: 3 }],
        date: new Date().toISOString(),
      }
      ctx.emit(complexEvent)
      await ctx.flush()

      expect(delivered[0]).toEqual(complexEvent)
    })

    it('should handle clearing state', async () => {
      const ctx = createContext()
      await ctx.processOnce('event-1', async () => 'result')
      await ctx.transaction(async (tx) => {
        await tx.put('key1', 'value1')
      })
      ctx.emit({ type: 'event' })

      await ctx.clear()

      expect(await ctx.isProcessed('event-1')).toBe(false)
      expect(ctx.getBufferedEventCount()).toBe(0)
    })
  })

  // ============================================================================
  // FACTORY FUNCTION
  // ============================================================================

  describe('factory function', () => {
    it('should create an ExactlyOnceContext instance', () => {
      const ctx = createExactlyOnceContext()
      expect(ctx).toBeInstanceOf(ExactlyOnceContext)
    })

    it('should create independent instances', async () => {
      const ctx1 = createExactlyOnceContext()
      const ctx2 = createExactlyOnceContext()

      await ctx1.processOnce('event-1', async () => 'result-1')
      expect(await ctx1.isProcessed('event-1')).toBe(true)
      expect(await ctx2.isProcessed('event-1')).toBe(false)
    })

    it('should accept options', () => {
      const onDeliver = vi.fn()
      const ctx = createExactlyOnceContext({
        eventIdTtl: 5000,
        maxBufferedEvents: 100,
        onDeliver,
      })
      expect(ctx).toBeInstanceOf(ExactlyOnceContext)
    })
  })
})
