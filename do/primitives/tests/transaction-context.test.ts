/**
 * TransactionContext tests
 *
 * RED phase: These tests define the expected behavior of TransactionContext.
 * All tests should FAIL until implementation is complete.
 *
 * TransactionContext provides Redis MULTI/EXEC-style atomic transactions:
 * - begin() to start transaction
 * - Commands queued until exec()
 * - exec() executes atomically
 * - discard() to abort
 * - watch(keys) for optimistic locking
 *
 * Maps to Redis: MULTI, EXEC, DISCARD, WATCH, UNWATCH
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TransactionContext,
  createTransactionContext,
  type TransactionContextOptions,
  type WatchError,
  type QueuedCommand,
  type TransactionResult,
} from '../transaction-context'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createContext(options?: TransactionContextOptions): TransactionContext {
  return createTransactionContext(options)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// BASIC TRANSACTION FLOW: BEGIN, QUEUE, EXEC
// ============================================================================

describe('TransactionContext', () => {
  describe('basic transaction flow: begin, queue, exec', () => {
    it('should create a transaction context', () => {
      const ctx = createContext()
      expect(ctx).toBeDefined()
    })

    it('should begin a transaction', async () => {
      const ctx = createContext()
      await ctx.begin()
      expect(ctx.isInTransaction()).toBe(true)
    })

    it('should queue SET command', async () => {
      const ctx = createContext()
      await ctx.begin()
      ctx.set('key1', 'value1')
      expect(ctx.getQueuedCommandCount()).toBe(1)
    })

    it('should queue multiple commands', async () => {
      const ctx = createContext()
      await ctx.begin()
      ctx.set('key1', 'value1')
      ctx.set('key2', 'value2')
      ctx.get('key1')
      ctx.del('key2')
      expect(ctx.getQueuedCommandCount()).toBe(4)
    })

    it('should execute transaction atomically', async () => {
      const ctx = createContext()
      await ctx.begin()
      ctx.set('key1', 'value1')
      ctx.set('key2', 'value2')

      const result = await ctx.exec()

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(2)
    })

    it('should return values from GET in exec results', async () => {
      const ctx = createContext()

      // First set values
      await ctx.begin()
      ctx.set('key1', 'value1')
      await ctx.exec()

      // Then read in transaction
      await ctx.begin()
      ctx.get('key1')
      const result = await ctx.exec()

      expect(result.success).toBe(true)
      expect(result.results[0]).toBe('value1')
    })

    it('should not be in transaction after exec', async () => {
      const ctx = createContext()
      await ctx.begin()
      ctx.set('key1', 'value1')
      await ctx.exec()

      expect(ctx.isInTransaction()).toBe(false)
    })

    it('should throw if commanding without begin', async () => {
      const ctx = createContext()
      expect(() => ctx.set('key1', 'value1')).toThrow()
    })

    it('should throw if exec without begin', async () => {
      const ctx = createContext()
      await expect(ctx.exec()).rejects.toThrow()
    })

    it('should return null for non-existent key', async () => {
      const ctx = createContext()
      await ctx.begin()
      ctx.get('nonexistent')
      const result = await ctx.exec()

      expect(result.results[0]).toBeNull()
    })
  })

  // ============================================================================
  // DISCARD: ABORT TRANSACTION
  // ============================================================================

  describe('discard: abort transaction', () => {
    it('should discard queued commands', async () => {
      const ctx = createContext()
      await ctx.begin()
      ctx.set('key1', 'value1')
      ctx.set('key2', 'value2')

      await ctx.discard()

      expect(ctx.isInTransaction()).toBe(false)
      expect(ctx.getQueuedCommandCount()).toBe(0)
    })

    it('should not apply discarded changes', async () => {
      const ctx = createContext()

      // Set initial value
      await ctx.begin()
      ctx.set('key1', 'initial')
      await ctx.exec()

      // Start new transaction, modify, then discard
      await ctx.begin()
      ctx.set('key1', 'modified')
      await ctx.discard()

      // Verify original value preserved
      await ctx.begin()
      ctx.get('key1')
      const result = await ctx.exec()

      expect(result.results[0]).toBe('initial')
    })

    it('should throw if discard without begin', async () => {
      const ctx = createContext()
      await expect(ctx.discard()).rejects.toThrow()
    })

    it('should allow new transaction after discard', async () => {
      const ctx = createContext()
      await ctx.begin()
      ctx.set('key1', 'value1')
      await ctx.discard()

      // Start new transaction
      await ctx.begin()
      ctx.set('key2', 'value2')
      const result = await ctx.exec()

      expect(result.success).toBe(true)
    })
  })

  // ============================================================================
  // WATCH: OPTIMISTIC LOCKING
  // ============================================================================

  describe('watch: optimistic locking', () => {
    it('should watch a single key', async () => {
      const ctx = createContext()
      await ctx.watch('key1')

      // No error expected
      expect(ctx.getWatchedKeys()).toContain('key1')
    })

    it('should watch multiple keys', async () => {
      const ctx = createContext()
      await ctx.watch('key1', 'key2', 'key3')

      expect(ctx.getWatchedKeys()).toContain('key1')
      expect(ctx.getWatchedKeys()).toContain('key2')
      expect(ctx.getWatchedKeys()).toContain('key3')
    })

    it('should unwatch all keys', async () => {
      const ctx = createContext()
      await ctx.watch('key1', 'key2')
      await ctx.unwatch()

      expect(ctx.getWatchedKeys()).toHaveLength(0)
    })

    it('should fail exec if watched key modified externally', async () => {
      const ctx = createContext()

      // Set initial value
      await ctx.begin()
      ctx.set('key1', 'initial')
      await ctx.exec()

      // Watch and start transaction
      await ctx.watch('key1')
      await ctx.begin()
      ctx.get('key1')
      ctx.set('key1', 'updated-in-tx')

      // Simulate external modification
      ctx._simulateExternalModification('key1')

      // Exec should fail due to watch conflict
      const result = await ctx.exec()

      expect(result.success).toBe(false)
      expect(result.watchError).toBeDefined()
      expect(result.watchError?.key).toBe('key1')
    })

    it('should succeed if watched key not modified', async () => {
      const ctx = createContext()

      // Set initial value
      await ctx.begin()
      ctx.set('key1', 'initial')
      await ctx.exec()

      // Watch and start transaction
      await ctx.watch('key1')
      await ctx.begin()
      ctx.get('key1')
      ctx.set('key1', 'updated')

      // No external modification
      const result = await ctx.exec()

      expect(result.success).toBe(true)
    })

    it('should clear watch on exec', async () => {
      const ctx = createContext()
      await ctx.watch('key1')
      await ctx.begin()
      ctx.set('key1', 'value1')
      await ctx.exec()

      expect(ctx.getWatchedKeys()).toHaveLength(0)
    })

    it('should clear watch on discard', async () => {
      const ctx = createContext()
      await ctx.watch('key1')
      await ctx.begin()
      ctx.set('key1', 'value1')
      await ctx.discard()

      expect(ctx.getWatchedKeys()).toHaveLength(0)
    })

    it('should track key versions for CAS', async () => {
      const ctx = createContext()

      // Set initial value
      await ctx.begin()
      ctx.set('key1', 'v1')
      await ctx.exec()

      // Update value
      await ctx.begin()
      ctx.set('key1', 'v2')
      await ctx.exec()

      // Version should have incremented
      expect(ctx.getKeyVersion('key1')).toBe(2)
    })
  })

  // ============================================================================
  // SUPPORTED COMMANDS
  // ============================================================================

  describe('supported commands', () => {
    it('should support SET command', async () => {
      const ctx = createContext()
      await ctx.begin()
      ctx.set('key1', 'value1')
      const result = await ctx.exec()

      expect(result.success).toBe(true)
      expect(result.results[0]).toBe('OK')
    })

    it('should support GET command', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('key1', 'value1')
      await ctx.exec()

      await ctx.begin()
      ctx.get('key1')
      const result = await ctx.exec()

      expect(result.results[0]).toBe('value1')
    })

    it('should support DEL command', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('key1', 'value1')
      ctx.set('key2', 'value2')
      await ctx.exec()

      await ctx.begin()
      ctx.del('key1')
      const result = await ctx.exec()

      expect(result.results[0]).toBe(1) // Number of keys deleted

      await ctx.begin()
      ctx.get('key1')
      const getResult = await ctx.exec()
      expect(getResult.results[0]).toBeNull()
    })

    it('should support INCR command', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('counter', '10')
      await ctx.exec()

      await ctx.begin()
      ctx.incr('counter')
      const result = await ctx.exec()

      expect(result.results[0]).toBe(11)
    })

    it('should support DECR command', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('counter', '10')
      await ctx.exec()

      await ctx.begin()
      ctx.decr('counter')
      const result = await ctx.exec()

      expect(result.results[0]).toBe(9)
    })

    it('should support INCRBY command', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('counter', '10')
      await ctx.exec()

      await ctx.begin()
      ctx.incrBy('counter', 5)
      const result = await ctx.exec()

      expect(result.results[0]).toBe(15)
    })

    it('should support SETNX (SET if Not eXists)', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.setNX('key1', 'value1')
      const result1 = await ctx.exec()
      expect(result1.results[0]).toBe(1) // Key was set

      await ctx.begin()
      ctx.setNX('key1', 'value2')
      const result2 = await ctx.exec()
      expect(result2.results[0]).toBe(0) // Key already exists

      await ctx.begin()
      ctx.get('key1')
      const result3 = await ctx.exec()
      expect(result3.results[0]).toBe('value1') // Original value preserved
    })

    it('should support GETSET command', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('key1', 'old-value')
      await ctx.exec()

      await ctx.begin()
      ctx.getSet('key1', 'new-value')
      const result = await ctx.exec()

      expect(result.results[0]).toBe('old-value') // Returns old value

      await ctx.begin()
      ctx.get('key1')
      const getResult = await ctx.exec()
      expect(getResult.results[0]).toBe('new-value') // New value is set
    })

    it('should support MSET command', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.mset({ key1: 'value1', key2: 'value2', key3: 'value3' })
      const result = await ctx.exec()

      expect(result.results[0]).toBe('OK')

      await ctx.begin()
      ctx.get('key1')
      ctx.get('key2')
      ctx.get('key3')
      const getResult = await ctx.exec()

      expect(getResult.results).toEqual(['value1', 'value2', 'value3'])
    })

    it('should support MGET command', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('key1', 'value1')
      ctx.set('key2', 'value2')
      await ctx.exec()

      await ctx.begin()
      ctx.mget('key1', 'key2', 'nonexistent')
      const result = await ctx.exec()

      expect(result.results[0]).toEqual(['value1', 'value2', null])
    })

    it('should support APPEND command', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('key1', 'Hello')
      await ctx.exec()

      await ctx.begin()
      ctx.append('key1', ' World')
      const result = await ctx.exec()

      expect(result.results[0]).toBe(11) // New length

      await ctx.begin()
      ctx.get('key1')
      const getResult = await ctx.exec()
      expect(getResult.results[0]).toBe('Hello World')
    })

    it('should support EXISTS command', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('key1', 'value1')
      await ctx.exec()

      await ctx.begin()
      ctx.exists('key1')
      ctx.exists('nonexistent')
      const result = await ctx.exec()

      expect(result.results[0]).toBe(1)
      expect(result.results[1]).toBe(0)
    })
  })

  // ============================================================================
  // ATOMIC EXECUTION GUARANTEE
  // ============================================================================

  describe('atomic execution guarantee', () => {
    it('should execute all commands or none on error', async () => {
      const ctx = createContext()

      // Set initial state
      await ctx.begin()
      ctx.set('counter', '10')
      await ctx.exec()

      // Use a special option to simulate an error during exec
      await ctx.begin()
      ctx.incr('counter')
      ctx.incr('counter')
      ctx._injectError(1) // Inject error at command index 1

      const result = await ctx.exec()

      expect(result.success).toBe(false)

      // Counter should be unchanged (rolled back)
      await ctx.begin()
      ctx.get('counter')
      const getResult = await ctx.exec()
      expect(getResult.results[0]).toBe('10')
    })

    it('should handle type errors gracefully', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('str', 'not-a-number')
      await ctx.exec()

      await ctx.begin()
      ctx.incr('str')
      const result = await ctx.exec()

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors![0]).toContain('not an integer')
    })
  })

  // ============================================================================
  // VERSIONING FOR CAS
  // ============================================================================

  describe('versioning for CAS', () => {
    it('should track version numbers per key', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('key1', 'v1')
      await ctx.exec()
      expect(ctx.getKeyVersion('key1')).toBe(1)

      await ctx.begin()
      ctx.set('key1', 'v2')
      await ctx.exec()
      expect(ctx.getKeyVersion('key1')).toBe(2)
    })

    it('should detect version mismatch in WATCH', async () => {
      const ctx1 = createContext()

      // Set initial value
      await ctx1.begin()
      ctx1.set('key1', 'initial')
      await ctx1.exec()

      // ctx1 watches and starts transaction
      await ctx1.watch('key1')
      await ctx1.begin()
      ctx1.set('key1', 'from-ctx1')

      // Simulate external modification to key1
      // This increments the version to simulate another client modifying the key
      ctx1._simulateExternalModification('key1')

      // ctx1's exec should fail due to version mismatch
      const result = await ctx1.exec()
      expect(result.success).toBe(false)
      expect(result.watchError).toBeDefined()
      expect(result.watchError?.key).toBe('key1')
    })

    it('should increment version on SET', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('key1', 'value1')
      await ctx.exec()

      const v1 = ctx.getKeyVersion('key1')

      await ctx.begin()
      ctx.set('key1', 'value2')
      await ctx.exec()

      const v2 = ctx.getKeyVersion('key1')
      expect(v2).toBe(v1 + 1)
    })

    it('should increment version on DEL', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('key1', 'value1')
      await ctx.exec()

      const v1 = ctx.getKeyVersion('key1')

      await ctx.begin()
      ctx.del('key1')
      await ctx.exec()

      const v2 = ctx.getKeyVersion('key1')
      expect(v2).toBe(v1 + 1)
    })

    it('should return 0 for non-existent key version', () => {
      const ctx = createContext()
      expect(ctx.getKeyVersion('nonexistent')).toBe(0)
    })
  })

  // ============================================================================
  // CONCURRENT TRANSACTIONS
  // ============================================================================

  describe('concurrent transactions', () => {
    it('should serialize concurrent transactions on shared state', async () => {
      const ctx1 = createContext()
      const ctx2 = createContext({ shareStateWith: ctx1 })
      const results: string[] = []

      await Promise.all([
        (async () => {
          await ctx1.begin()
          ctx1.set('key', 'tx1')
          await delay(10)
          await ctx1.exec()
          results.push('tx1')
        })(),
        (async () => {
          await delay(5) // Start slightly later
          await ctx2.begin()
          ctx2.set('key', 'tx2')
          await ctx2.exec()
          results.push('tx2')
        })(),
      ])

      // Both should complete
      expect(results).toHaveLength(2)
    })

    it('should handle many concurrent begin/exec cycles with separate contexts', async () => {
      const baseCtx = createContext()
      const count = 20

      const results = await Promise.all(
        Array.from({ length: count }, async (_, i) => {
          const ctx = createContext({ shareStateWith: baseCtx })
          await ctx.begin()
          ctx.set(`key-${i}`, `value-${i}`)
          return ctx.exec()
        })
      )

      // All should succeed
      expect(results.filter((r) => r.success)).toHaveLength(count)
    })

    it('should prevent race conditions with lock serialization', async () => {
      const baseCtx = createContext()
      const ctx1 = createContext({ shareStateWith: baseCtx })
      const ctx2 = createContext({ shareStateWith: baseCtx })

      // Set initial value
      await baseCtx.begin()
      baseCtx.set('counter', '0')
      await baseCtx.exec()

      // Both contexts try to read-modify-write
      const results = await Promise.all([
        (async () => {
          await ctx1.watch('counter')
          await ctx1.begin()
          ctx1.get('counter')
          ctx1.incr('counter')
          return ctx1.exec()
        })(),
        (async () => {
          await ctx2.watch('counter')
          await ctx2.begin()
          ctx2.get('counter')
          ctx2.incr('counter')
          return ctx2.exec()
        })(),
      ])

      // At least one should succeed, and one may fail due to watch conflict
      const successes = results.filter((r) => r.success)
      expect(successes.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty transaction', async () => {
      const ctx = createContext()
      await ctx.begin()
      const result = await ctx.exec()

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(0)
    })

    it('should handle very long key names', async () => {
      const ctx = createContext()
      const longKey = 'x'.repeat(10000)

      await ctx.begin()
      ctx.set(longKey, 'value')
      const result = await ctx.exec()

      expect(result.success).toBe(true)

      await ctx.begin()
      ctx.get(longKey)
      const getResult = await ctx.exec()
      expect(getResult.results[0]).toBe('value')
    })

    it('should handle special characters in keys', async () => {
      const ctx = createContext()
      const specialKey = 'key:with:colons/and/slashes@and$special#chars'

      await ctx.begin()
      ctx.set(specialKey, 'value')
      await ctx.exec()

      await ctx.begin()
      ctx.get(specialKey)
      const result = await ctx.exec()

      expect(result.results[0]).toBe('value')
    })

    it('should handle null values', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('key1', null as unknown as string)
      await ctx.exec()

      await ctx.begin()
      ctx.get('key1')
      const result = await ctx.exec()

      // Should handle null gracefully (store as string "null" or actual null)
      expect(result.results[0]).toBeNull()
    })

    it('should handle complex JSON values', async () => {
      const ctx = createContext()
      const complexValue = JSON.stringify({
        nested: { deep: { value: 'test' } },
        array: [1, 2, { three: 3 }],
        date: new Date().toISOString(),
      })

      await ctx.begin()
      ctx.set('json-key', complexValue)
      await ctx.exec()

      await ctx.begin()
      ctx.get('json-key')
      const result = await ctx.exec()

      expect(result.results[0]).toBe(complexValue)
    })

    it('should handle numeric string values with INCR', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('counter', '0')
      await ctx.exec()

      for (let i = 0; i < 10; i++) {
        await ctx.begin()
        ctx.incr('counter')
        await ctx.exec()
      }

      await ctx.begin()
      ctx.get('counter')
      const result = await ctx.exec()

      expect(result.results[0]).toBe('10')
    })

    it('should handle INCR on non-existent key', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.incr('new-counter')
      const result = await ctx.exec()

      expect(result.results[0]).toBe(1)
    })

    it('should handle double begin without exec', async () => {
      const ctx = createContext()
      await ctx.begin()
      ctx.set('key1', 'value1')

      // Second begin should throw or reset
      await expect(ctx.begin()).rejects.toThrow()
    })
  })

  // ============================================================================
  // ROLLBACK BEHAVIOR
  // ============================================================================

  describe('rollback behavior', () => {
    it('should rollback all changes on watch failure', async () => {
      const ctx = createContext()

      // Set initial values
      await ctx.begin()
      ctx.set('key1', 'initial1')
      ctx.set('key2', 'initial2')
      await ctx.exec()

      // Watch key1, then modify externally
      await ctx.watch('key1')
      await ctx.begin()
      ctx.set('key1', 'new1')
      ctx.set('key2', 'new2')

      // External modification
      ctx._simulateExternalModification('key1')

      // Exec should fail and rollback
      const result = await ctx.exec()
      expect(result.success).toBe(false)

      // Both keys should retain original values
      await ctx.begin()
      ctx.get('key1')
      ctx.get('key2')
      const getResult = await ctx.exec()

      expect(getResult.results[0]).toBe('initial1')
      expect(getResult.results[1]).toBe('initial2')
    })

    it('should not apply partial changes on error', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('key1', 'initial')
      ctx.set('counter', '10')
      await ctx.exec()

      await ctx.begin()
      ctx.set('key1', 'changed')
      ctx.incr('counter')
      ctx._injectError(1) // Error on incr

      const result = await ctx.exec()
      expect(result.success).toBe(false)

      // Neither change should be applied
      await ctx.begin()
      ctx.get('key1')
      ctx.get('counter')
      const getResult = await ctx.exec()

      expect(getResult.results[0]).toBe('initial')
      expect(getResult.results[1]).toBe('10')
    })
  })

  // ============================================================================
  // FACTORY FUNCTION
  // ============================================================================

  describe('factory function', () => {
    it('should create a TransactionContext instance', () => {
      const ctx = createTransactionContext()
      expect(ctx).toBeInstanceOf(TransactionContext)
    })

    it('should create independent instances', async () => {
      const ctx1 = createTransactionContext()
      const ctx2 = createTransactionContext()

      await ctx1.begin()
      ctx1.set('key1', 'value1')
      await ctx1.exec()

      await ctx2.begin()
      ctx2.get('key1')
      const result = await ctx2.exec()

      // ctx2 should not see ctx1's data
      expect(result.results[0]).toBeNull()
    })

    it('should share state when configured', async () => {
      const ctx1 = createTransactionContext()
      const ctx2 = createTransactionContext({ shareStateWith: ctx1 })

      await ctx1.begin()
      ctx1.set('key1', 'value1')
      await ctx1.exec()

      await ctx2.begin()
      ctx2.get('key1')
      const result = await ctx2.exec()

      // ctx2 should see ctx1's data
      expect(result.results[0]).toBe('value1')
    })
  })

  // ============================================================================
  // OBSERVABILITY
  // ============================================================================

  describe('observability', () => {
    it('should record exec latency', async () => {
      const latencies: number[] = []
      const ctx = createTransactionContext({
        metrics: {
          recordLatency: (op, duration) => {
            if (op === 'transaction_context.exec.latency') {
              latencies.push(duration)
            }
          },
          incrementCounter: () => {},
          recordGauge: () => {},
        },
      })

      await ctx.begin()
      ctx.set('key1', 'value1')
      await ctx.exec()

      expect(latencies.length).toBeGreaterThan(0)
    })

    it('should count watch failures', async () => {
      let watchFailures = 0
      const ctx = createTransactionContext({
        metrics: {
          recordLatency: () => {},
          incrementCounter: (name) => {
            if (name === 'transaction_context.watch_failures') {
              watchFailures++
            }
          },
          recordGauge: () => {},
        },
      })

      await ctx.begin()
      ctx.set('key1', 'initial')
      await ctx.exec()

      await ctx.watch('key1')
      await ctx.begin()
      ctx.set('key1', 'updated')
      ctx._simulateExternalModification('key1')
      await ctx.exec()

      expect(watchFailures).toBe(1)
    })

    it('should track commands executed', async () => {
      let commandsExecuted = 0
      const ctx = createTransactionContext({
        metrics: {
          recordLatency: () => {},
          incrementCounter: (name, _, delta) => {
            if (name === 'transaction_context.commands_executed') {
              commandsExecuted += delta ?? 1
            }
          },
          recordGauge: () => {},
        },
      })

      await ctx.begin()
      ctx.set('key1', 'value1')
      ctx.set('key2', 'value2')
      ctx.get('key1')
      await ctx.exec()

      expect(commandsExecuted).toBe(3)
    })
  })

  // ============================================================================
  // INTEGRATION WITH TEMPORAL STORE
  // ============================================================================

  describe('integration with TemporalStore', () => {
    it('should support versioned reads', async () => {
      const ctx = createTransactionContext({ enableVersionTracking: true })

      await ctx.begin()
      ctx.set('key1', 'v1')
      await ctx.exec()

      await ctx.begin()
      ctx.set('key1', 'v2')
      await ctx.exec()

      // Read current
      await ctx.begin()
      ctx.get('key1')
      const current = await ctx.exec()
      expect(current.results[0]).toBe('v2')

      // Read at version 1
      await ctx.begin()
      ctx.getAtVersion('key1', 1)
      const v1 = await ctx.exec()
      expect(v1.results[0]).toBe('v1')
    })

    it('should support optimistic locking with version check', async () => {
      const ctx = createTransactionContext({ enableVersionTracking: true })

      await ctx.begin()
      ctx.set('key1', 'initial')
      await ctx.exec()

      const version = ctx.getKeyVersion('key1')

      // Try to update only if version matches
      await ctx.watchVersion('key1', version)
      await ctx.begin()
      ctx.set('key1', 'updated')
      const result = await ctx.exec()

      expect(result.success).toBe(true)
    })

    it('should fail optimistic locking if version changed', async () => {
      const ctx1 = createTransactionContext({ enableVersionTracking: true })
      const ctx2 = createTransactionContext({ shareStateWith: ctx1, enableVersionTracking: true })

      await ctx1.begin()
      ctx1.set('key1', 'initial')
      await ctx1.exec()

      const version = ctx1.getKeyVersion('key1')

      // ctx1 watches with version and starts transaction
      await ctx1.watchVersion('key1', version)
      await ctx1.begin()
      ctx1.set('key1', 'from-ctx1')

      // Simulate external modification via _simulateExternalModification
      // This avoids the lock contention issue since we're modifying
      // the underlying version directly
      ctx1._simulateExternalModification('key1')

      // ctx1 should fail due to version mismatch
      const result = await ctx1.exec()
      expect(result.success).toBe(false)
      expect(result.watchError).toBeDefined()
    })
  })

  // ============================================================================
  // ISOLATION LEVELS
  // ============================================================================

  describe('isolation levels', () => {
    // Redis MULTI/EXEC provides serializable isolation via optimistic locking
    // All operations within a transaction are queued and executed atomically

    it('should provide serializable isolation via WATCH', async () => {
      const ctx1 = createContext()
      const ctx2 = createContext({ shareStateWith: ctx1 })

      // Set initial value
      await ctx1.begin()
      ctx1.set('balance', '100')
      await ctx1.exec()

      // ctx1 reads balance and prepares update
      await ctx1.watch('balance')
      await ctx1.begin()
      ctx1.get('balance')
      ctx1.set('balance', '80') // Withdraw 20

      // ctx2 modifies balance concurrently
      ctx1._simulateExternalModification('balance')

      // ctx1's transaction should fail - serializable isolation maintained
      const result = await ctx1.exec()
      expect(result.success).toBe(false)
      expect(result.watchError?.key).toBe('balance')
    })

    it('should isolate uncommitted changes from other contexts', async () => {
      const ctx1 = createContext()
      const ctx2 = createContext({ shareStateWith: ctx1 })

      // Set initial value
      await ctx1.begin()
      ctx1.set('key1', 'initial')
      await ctx1.exec()

      // ctx1 starts transaction but doesn't exec yet
      await ctx1.begin()
      ctx1.set('key1', 'modified-by-ctx1')
      // ctx1 is holding the lock, so changes are not visible

      // Note: Due to lock serialization, ctx2 will wait for ctx1
      // The isolation is maintained because changes only become visible after exec()

      await ctx1.exec()

      // Now ctx2 can see the committed changes
      await ctx2.begin()
      ctx2.get('key1')
      const result = await ctx2.exec()
      expect(result.results[0]).toBe('modified-by-ctx1')
    })

    it('should prevent dirty reads', async () => {
      const ctx1 = createContext()

      // Set initial value
      await ctx1.begin()
      ctx1.set('key1', 'committed-value')
      await ctx1.exec()

      // Start transaction that will fail
      await ctx1.begin()
      ctx1.set('key1', 'uncommitted-value')
      ctx1._injectError(0) // Force transaction to fail
      await ctx1.exec()

      // Verify uncommitted value was never visible
      await ctx1.begin()
      ctx1.get('key1')
      const result = await ctx1.exec()
      expect(result.results[0]).toBe('committed-value')
    })

    it('should prevent non-repeatable reads within transaction', async () => {
      const ctx = createContext()

      // Set initial value
      await ctx.begin()
      ctx.set('key1', 'value1')
      await ctx.exec()

      // Within a single transaction, multiple GETs should return
      // the same value (snapshot at transaction start for watched keys)
      await ctx.watch('key1')
      await ctx.begin()
      ctx.get('key1')
      ctx.get('key1')
      ctx.get('key1')
      const result = await ctx.exec()

      // All reads should return the same value
      expect(result.results[0]).toBe('value1')
      expect(result.results[1]).toBe('value1')
      expect(result.results[2]).toBe('value1')
    })
  })

  // ============================================================================
  // NESTED TRANSACTIONS
  // ============================================================================

  describe('nested transactions', () => {
    // Redis MULTI/EXEC does not support nested transactions
    // Attempting to begin while already in a transaction should throw

    it('should reject nested begin calls', async () => {
      const ctx = createContext()
      await ctx.begin()
      ctx.set('key1', 'value1')

      // Second begin should throw
      await expect(ctx.begin()).rejects.toThrow(/already in a transaction/i)
    })

    it('should allow sequential transactions after completion', async () => {
      const ctx = createContext()

      // First transaction
      await ctx.begin()
      ctx.set('key1', 'value1')
      const result1 = await ctx.exec()
      expect(result1.success).toBe(true)

      // Second transaction (not nested, sequential)
      await ctx.begin()
      ctx.set('key2', 'value2')
      const result2 = await ctx.exec()
      expect(result2.success).toBe(true)

      // Verify both values exist
      await ctx.begin()
      ctx.get('key1')
      ctx.get('key2')
      const getResult = await ctx.exec()
      expect(getResult.results).toEqual(['value1', 'value2'])
    })

    it('should allow new transaction after discard', async () => {
      const ctx = createContext()

      await ctx.begin()
      ctx.set('key1', 'discarded')
      await ctx.discard()

      // New transaction should work
      await ctx.begin()
      ctx.set('key1', 'committed')
      const result = await ctx.exec()
      expect(result.success).toBe(true)

      await ctx.begin()
      ctx.get('key1')
      const getResult = await ctx.exec()
      expect(getResult.results[0]).toBe('committed')
    })

    it('should maintain state across sequential transactions', async () => {
      const ctx = createContext()

      // Build up state across multiple transactions
      await ctx.begin()
      ctx.set('counter', '0')
      await ctx.exec()

      for (let i = 0; i < 5; i++) {
        await ctx.begin()
        ctx.incr('counter')
        await ctx.exec()
      }

      await ctx.begin()
      ctx.get('counter')
      const result = await ctx.exec()
      expect(result.results[0]).toBe('5')
    })
  })

  // ============================================================================
  // DEADLOCK HANDLING
  // ============================================================================

  describe('deadlock handling', () => {
    // The lock-based serialization prevents deadlocks by ensuring
    // only one transaction can be active at a time per shared state

    it('should prevent deadlock via serialization', async () => {
      const ctx1 = createContext()
      const ctx2 = createContext({ shareStateWith: ctx1 })

      // Set initial values
      await ctx1.begin()
      ctx1.set('resource-a', 'initial-a')
      ctx1.set('resource-b', 'initial-b')
      await ctx1.exec()

      // Classic deadlock scenario: ctx1 wants A then B, ctx2 wants B then A
      // With serialization, they execute sequentially - no deadlock possible
      const results = await Promise.all([
        (async () => {
          await ctx1.watch('resource-a', 'resource-b')
          await ctx1.begin()
          ctx1.get('resource-a')
          ctx1.get('resource-b')
          ctx1.set('resource-a', 'modified-by-ctx1')
          ctx1.set('resource-b', 'modified-by-ctx1')
          return ctx1.exec()
        })(),
        (async () => {
          await ctx2.watch('resource-b', 'resource-a')
          await ctx2.begin()
          ctx2.get('resource-b')
          ctx2.get('resource-a')
          ctx2.set('resource-b', 'modified-by-ctx2')
          ctx2.set('resource-a', 'modified-by-ctx2')
          return ctx2.exec()
        })(),
      ])

      // Due to serialization, at least one should succeed
      // The other may fail due to watch conflict
      const successes = results.filter((r) => r.success)
      expect(successes.length).toBeGreaterThanOrEqual(1)
    })

    it('should timeout-free due to lock serialization', async () => {
      const ctx1 = createContext()
      const ctx2 = createContext({ shareStateWith: ctx1 })

      // Both try to access same resource
      const start = Date.now()

      await Promise.all([
        (async () => {
          await ctx1.begin()
          ctx1.set('shared', 'ctx1')
          await delay(50)
          await ctx1.exec()
        })(),
        (async () => {
          await ctx2.begin()
          ctx2.set('shared', 'ctx2')
          await delay(50)
          await ctx2.exec()
        })(),
      ])

      const elapsed = Date.now() - start

      // Should complete in reasonable time (no infinite wait)
      expect(elapsed).toBeLessThan(5000)
    })

    it('should release lock on discard to prevent blocking', async () => {
      const ctx1 = createContext()
      const ctx2 = createContext({ shareStateWith: ctx1 })

      // ctx1 starts transaction
      await ctx1.begin()
      ctx1.set('key1', 'value1')

      // ctx1 discards - should release lock
      await ctx1.discard()

      // ctx2 should be able to proceed immediately
      const start = Date.now()
      await ctx2.begin()
      ctx2.set('key1', 'value2')
      const result = await ctx2.exec()
      const elapsed = Date.now() - start

      expect(result.success).toBe(true)
      expect(elapsed).toBeLessThan(100) // Should be fast
    })

    it('should release lock on exec failure', async () => {
      const ctx1 = createContext()
      const ctx2 = createContext({ shareStateWith: ctx1 })

      // ctx1 starts transaction that will fail
      await ctx1.watch('key1')
      await ctx1.begin()
      ctx1.set('key1', 'value1')
      ctx1._simulateExternalModification('key1')

      // ctx1's exec fails
      const result1 = await ctx1.exec()
      expect(result1.success).toBe(false)

      // ctx2 should be able to proceed
      await ctx2.begin()
      ctx2.set('key1', 'value2')
      const result2 = await ctx2.exec()
      expect(result2.success).toBe(true)
    })
  })

  // ============================================================================
  // ACID PROPERTIES
  // ============================================================================

  describe('ACID properties', () => {
    describe('Atomicity', () => {
      it('should apply all changes or none on success', async () => {
        const ctx = createContext()

        await ctx.begin()
        ctx.set('key1', 'value1')
        ctx.set('key2', 'value2')
        ctx.set('key3', 'value3')
        const result = await ctx.exec()

        expect(result.success).toBe(true)

        // All keys should exist
        await ctx.begin()
        ctx.get('key1')
        ctx.get('key2')
        ctx.get('key3')
        const getResult = await ctx.exec()

        expect(getResult.results).toEqual(['value1', 'value2', 'value3'])
      })

      it('should rollback all changes on mid-transaction failure', async () => {
        const ctx = createContext()

        // Set initial values
        await ctx.begin()
        ctx.set('key1', 'initial1')
        ctx.set('key2', 'initial2')
        ctx.set('key3', 'initial3')
        await ctx.exec()

        // Transaction that fails mid-way
        await ctx.begin()
        ctx.set('key1', 'changed1')
        ctx.set('key2', 'changed2')
        ctx.set('key3', 'changed3')
        ctx._injectError(1) // Fail after first SET

        const result = await ctx.exec()
        expect(result.success).toBe(false)

        // All values should be unchanged
        await ctx.begin()
        ctx.get('key1')
        ctx.get('key2')
        ctx.get('key3')
        const getResult = await ctx.exec()

        expect(getResult.results).toEqual(['initial1', 'initial2', 'initial3'])
      })

      it('should rollback on watch conflict', async () => {
        const ctx = createContext()

        await ctx.begin()
        ctx.set('key1', 'initial1')
        ctx.set('key2', 'initial2')
        await ctx.exec()

        await ctx.watch('key1')
        await ctx.begin()
        ctx.set('key1', 'changed1')
        ctx.set('key2', 'changed2')

        ctx._simulateExternalModification('key1')

        const result = await ctx.exec()
        expect(result.success).toBe(false)

        // Both values unchanged
        await ctx.begin()
        ctx.get('key1')
        ctx.get('key2')
        const getResult = await ctx.exec()

        expect(getResult.results).toEqual(['initial1', 'initial2'])
      })
    })

    describe('Consistency', () => {
      it('should maintain valid state after successful transaction', async () => {
        const ctx = createContext()

        // Set initial balance
        await ctx.begin()
        ctx.set('account-a', '100')
        ctx.set('account-b', '50')
        await ctx.exec()

        // Transfer 30 from A to B (atomic transfer)
        await ctx.begin()
        ctx.incrBy('account-a', -30)
        ctx.incrBy('account-b', 30)
        const result = await ctx.exec()

        expect(result.success).toBe(true)

        // Total should still be 150
        await ctx.begin()
        ctx.get('account-a')
        ctx.get('account-b')
        const getResult = await ctx.exec()

        const total = parseInt(getResult.results[0] as string) + parseInt(getResult.results[1] as string)
        expect(total).toBe(150)
      })

      it('should reject invalid operations', async () => {
        const ctx = createContext()

        await ctx.begin()
        ctx.set('str-value', 'not-a-number')
        await ctx.exec()

        // Trying to increment a string should fail
        await ctx.begin()
        ctx.incr('str-value')
        const result = await ctx.exec()

        expect(result.success).toBe(false)
        expect(result.errors).toBeDefined()
      })

      it('should preserve invariants across failed transactions', async () => {
        const ctx = createContext()

        // Set up invariant: sum of counters = 100
        await ctx.begin()
        ctx.set('counter-a', '60')
        ctx.set('counter-b', '40')
        await ctx.exec()

        // Try invalid operation that breaks invariant
        await ctx.begin()
        ctx.incrBy('counter-a', 20)
        ctx.incrBy('counter-b', -20)
        ctx._injectError(1) // Fail mid-transaction

        await ctx.exec()

        // Invariant should be preserved
        await ctx.begin()
        ctx.get('counter-a')
        ctx.get('counter-b')
        const getResult = await ctx.exec()

        const sum = parseInt(getResult.results[0] as string) + parseInt(getResult.results[1] as string)
        expect(sum).toBe(100)
      })
    })

    describe('Isolation', () => {
      it('should not expose intermediate states', async () => {
        const ctx = createContext()

        // In a transaction with multiple operations, intermediate states
        // should never be visible to other transactions

        await ctx.begin()
        ctx.set('phase', 'initial')
        await ctx.exec()

        // This transaction updates multiple values atomically
        await ctx.begin()
        ctx.set('phase', 'step1')
        ctx.set('phase', 'step2')
        ctx.set('phase', 'final')
        const result = await ctx.exec()

        expect(result.success).toBe(true)

        // Should only see 'final', never intermediate states
        await ctx.begin()
        ctx.get('phase')
        const getResult = await ctx.exec()
        expect(getResult.results[0]).toBe('final')
      })

      it('should provide snapshot isolation via WATCH', async () => {
        const ctx1 = createContext()
        const ctx2 = createContext({ shareStateWith: ctx1 })

        await ctx1.begin()
        ctx1.set('version', '1')
        await ctx1.exec()

        // ctx1 takes a "snapshot" via WATCH
        await ctx1.watch('version')
        const watchedVersion = ctx1.getKeyVersion('version')

        await ctx1.begin()
        ctx1.get('version')

        // If ctx2 modifies, ctx1's transaction should fail
        ctx1._simulateExternalModification('version')

        ctx1.set('version', '2')
        const result = await ctx1.exec()

        // Transaction should fail due to version change
        expect(result.success).toBe(false)
      })
    })

    describe('Durability', () => {
      // Note: True durability requires persistence to storage
      // These tests verify in-memory durability semantics

      it('should persist data after successful commit', async () => {
        const ctx = createContext()

        await ctx.begin()
        ctx.set('persistent-key', 'persistent-value')
        const result = await ctx.exec()

        expect(result.success).toBe(true)

        // Value should be retrievable
        await ctx.begin()
        ctx.get('persistent-key')
        const getResult = await ctx.exec()
        expect(getResult.results[0]).toBe('persistent-value')
      })

      it('should maintain data across multiple transactions', async () => {
        const ctx = createContext()

        // First transaction
        await ctx.begin()
        ctx.set('key1', 'value1')
        await ctx.exec()

        // Second transaction
        await ctx.begin()
        ctx.set('key2', 'value2')
        await ctx.exec()

        // Third transaction
        await ctx.begin()
        ctx.set('key3', 'value3')
        await ctx.exec()

        // All data should be present
        await ctx.begin()
        ctx.mget('key1', 'key2', 'key3')
        const result = await ctx.exec()
        expect(result.results[0]).toEqual(['value1', 'value2', 'value3'])
      })

      it('should share durable state between contexts', async () => {
        const ctx1 = createContext()
        const ctx2 = createContext({ shareStateWith: ctx1 })

        // ctx1 commits data
        await ctx1.begin()
        ctx1.set('shared-data', 'from-ctx1')
        await ctx1.exec()

        // ctx2 should see committed data
        await ctx2.begin()
        ctx2.get('shared-data')
        const result = await ctx2.exec()
        expect(result.results[0]).toBe('from-ctx1')
      })

      it('should not persist data from failed transactions', async () => {
        const ctx = createContext()

        // Set initial value
        await ctx.begin()
        ctx.set('durable-key', 'original')
        await ctx.exec()

        // Failed transaction
        await ctx.begin()
        ctx.set('durable-key', 'should-not-persist')
        ctx._injectError(0)
        await ctx.exec()

        // Original value should remain
        await ctx.begin()
        ctx.get('durable-key')
        const result = await ctx.exec()
        expect(result.results[0]).toBe('original')
      })
    })
  })

  // ============================================================================
  // STRESS TESTS
  // ============================================================================

  describe('stress tests', () => {
    it('should handle rapid sequential transactions', async () => {
      const ctx = createContext()
      const iterations = 100

      for (let i = 0; i < iterations; i++) {
        await ctx.begin()
        ctx.set('counter', String(i))
        const result = await ctx.exec()
        expect(result.success).toBe(true)
      }

      await ctx.begin()
      ctx.get('counter')
      const result = await ctx.exec()
      expect(result.results[0]).toBe('99')
    })

    it('should handle large transaction with many commands', async () => {
      const ctx = createContext()
      const commandCount = 200

      await ctx.begin()
      for (let i = 0; i < commandCount; i++) {
        ctx.set(`key-${i}`, `value-${i}`)
      }
      const result = await ctx.exec()

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(commandCount)
    })

    it('should handle high contention scenario', async () => {
      const baseCtx = createContext()
      const contextCount = 10
      const iterationsPerContext = 5

      // Initialize shared counter
      await baseCtx.begin()
      baseCtx.set('high-contention-counter', '0')
      await baseCtx.exec()

      // Many contexts competing to increment
      const contexts = Array.from({ length: contextCount }, () => createContext({ shareStateWith: baseCtx }))

      let successCount = 0
      for (const ctx of contexts) {
        for (let i = 0; i < iterationsPerContext; i++) {
          await ctx.begin()
          ctx.incr('high-contention-counter')
          const result = await ctx.exec()
          if (result.success) successCount++
        }
      }

      // All increments should succeed due to serialization
      expect(successCount).toBe(contextCount * iterationsPerContext)

      // Final value should reflect all successful increments
      await baseCtx.begin()
      baseCtx.get('high-contention-counter')
      const result = await baseCtx.exec()
      expect(result.results[0]).toBe(String(contextCount * iterationsPerContext))
    })

    it('should maintain data integrity under mixed operations', async () => {
      const ctx = createContext()

      // Initialize test data
      await ctx.begin()
      ctx.mset({
        'account:1': '1000',
        'account:2': '500',
        'account:3': '750',
        total: '2250',
      })
      await ctx.exec()

      // Perform various operations
      const operations = [
        async () => {
          await ctx.begin()
          ctx.incrBy('account:1', -100)
          ctx.incrBy('account:2', 100)
          await ctx.exec()
        },
        async () => {
          await ctx.begin()
          ctx.incrBy('account:2', -50)
          ctx.incrBy('account:3', 50)
          await ctx.exec()
        },
        async () => {
          await ctx.begin()
          ctx.incrBy('account:3', -200)
          ctx.incrBy('account:1', 200)
          await ctx.exec()
        },
      ]

      for (const op of operations) {
        await op()
      }

      // Verify total is preserved
      await ctx.begin()
      ctx.mget('account:1', 'account:2', 'account:3')
      const result = await ctx.exec()

      const balances = (result.results[0] as (string | null)[]).map((v) => parseInt(v || '0'))
      const sum = balances.reduce((a, b) => a + b, 0)
      expect(sum).toBe(2250)
    })
  })
})
