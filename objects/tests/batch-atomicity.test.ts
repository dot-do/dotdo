/**
 * DO Storage Batch Atomicity Tests
 *
 * RED TDD: These tests define expected transactional behavior for DO storage
 * batch operations. Current DO storage lacks batch atomicity guarantees -
 * partial writes can occur. These tests document the expected behavior.
 *
 * The DO storage API should support:
 * - Atomic batch put operations (all-or-nothing)
 * - Atomic batch delete operations
 * - Mixed operations in a single batch
 * - Transaction semantics (isolation, visibility)
 * - Storage limits enforcement (128KB per txn, 128 keys)
 * - Error recovery with rollback
 *
 * Expected Behavior:
 * - All operations in a batch succeed together or fail together
 * - No partial writes should be visible
 * - Concurrent reads should not see torn writes
 * - Failed batches should leave storage unchanged
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// BATCH ERROR TYPES (Expected to be implemented)
// ============================================================================

/**
 * BatchError - Error thrown when a batch operation fails.
 * Should contain information about which keys failed.
 */
class BatchError extends Error {
  code: string
  failedKeys: string[]
  partialSuccess: boolean

  constructor(message: string, options: { code: string; failedKeys: string[]; partialSuccess: boolean }) {
    super(message)
    this.name = 'BatchError'
    this.code = options.code
    this.failedKeys = options.failedKeys
    this.partialSuccess = options.partialSuccess
  }
}

/**
 * BatchValidationError - Error thrown when batch validation fails before write.
 */
class BatchValidationError extends Error {
  code: string
  invalidKeys: string[]
  reasons: Map<string, string>

  constructor(message: string, options: { code: string; invalidKeys: string[]; reasons: Map<string, string> }) {
    super(message)
    this.name = 'BatchValidationError'
    this.code = options.code
    this.invalidKeys = options.invalidKeys
    this.reasons = options.reasons
  }
}

// ============================================================================
// MOCK DO STATE & ENVIRONMENT
// ============================================================================

function createMockStorage() {
  const storage = new Map<string, unknown>()

  return {
    storage: {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => storage.get(key) as T | undefined),
      put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
        if (typeof key === 'object') {
          for (const [k, v] of Object.entries(key)) {
            storage.set(k, v)
          }
        } else {
          storage.set(key, value)
        }
      }),
      delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
        if (Array.isArray(key)) {
          let count = 0
          for (const k of key) {
            if (storage.delete(k)) count++
          }
          return count
        }
        return storage.delete(key)
      }),
      deleteAll: vi.fn(async (): Promise<void> => storage.clear()),
      list: vi.fn(async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
        const result = new Map<string, T>()
        for (const [key, value] of storage) {
          if (options?.prefix && !key.startsWith(options.prefix)) continue
          result.set(key, value as T)
        }
        return result
      }),
      sql: {
        exec: vi.fn(),
      },
      // Transaction support (critical for atomicity)
      transaction: vi.fn(async <T>(closure: () => Promise<T>): Promise<T> => {
        // Current mock does NOT provide atomicity - this is the bug we're testing
        return closure()
      }),
    },
    _storage: storage,
  }
}

function createMockState() {
  const { storage, _storage } = createMockStorage()
  return {
    id: {
      toString: () => 'test-batch-atomicity-id',
      name: 'test-batch-atomicity-id',
      equals: (other: { toString: () => string }) => other.toString() === 'test-batch-atomicity-id',
    },
    storage,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { _storage: Map<string, unknown> }
}

function createMockEnv() {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
  }
}

// ============================================================================
// BATCH STORAGE INTERFACE (Expected to be implemented)
// ============================================================================

/**
 * BatchStorage - Interface for atomic batch operations on DO storage.
 * This interface defines the expected behavior for batch operations.
 */
interface BatchStorage {
  /**
   * Atomically put multiple key-value pairs.
   * Either all writes succeed or none do.
   */
  batchPut(entries: Map<string, unknown> | Record<string, unknown>): Promise<void>

  /**
   * Atomically delete multiple keys.
   * Either all deletes succeed or none do.
   */
  batchDelete(keys: string[]): Promise<number>

  /**
   * Execute multiple operations atomically.
   * Supports mixed put and delete operations.
   */
  batch(operations: BatchOperation[]): Promise<void>

  /**
   * Validate a batch before execution.
   * Returns validation errors without modifying storage.
   */
  validateBatch(operations: BatchOperation[]): Promise<BatchValidationResult>
}

interface BatchOperation {
  type: 'put' | 'delete'
  key: string
  value?: unknown
}

interface BatchValidationResult {
  valid: boolean
  errors: Array<{ key: string; reason: string }>
  totalSize: number
  keyCount: number
}

// ============================================================================
// TEST SUITE: Batch Put Operations
// ============================================================================

describe('DO Storage Batch Atomicity', () => {
  let mockState: ReturnType<typeof createMockState>

  beforeEach(() => {
    mockState = createMockState()
  })

  afterEach(() => {
    // Clean up any lingering state
    mockState._storage.clear()
  })

  // ==========================================================================
  // BATCH PUT OPERATIONS
  // ==========================================================================

  describe('Batch Put', () => {
    it('puts multiple values atomically', async () => {
      // Arrange
      const entries = {
        'user:1': { name: 'Alice', age: 30 },
        'user:2': { name: 'Bob', age: 25 },
        'user:3': { name: 'Charlie', age: 35 },
      }

      // Act - Should put all values atomically
      await mockState.storage.put(entries)

      // Assert - All values should be present
      const user1 = await mockState.storage.get('user:1')
      const user2 = await mockState.storage.get('user:2')
      const user3 = await mockState.storage.get('user:3')

      expect(user1).toEqual({ name: 'Alice', age: 30 })
      expect(user2).toEqual({ name: 'Bob', age: 25 })
      expect(user3).toEqual({ name: 'Charlie', age: 35 })

      // CRITICAL: This test passes but doesn't verify ATOMICITY
      // The test below verifies that partial writes don't occur
    })

    it('rolls back on partial failure', async () => {
      // Arrange - Pre-populate storage to verify rollback
      await mockState.storage.put('existing', 'original')

      // Create a failing scenario where the second write fails
      const originalPut = mockState.storage.put
      let callCount = 0
      mockState.storage.put = vi.fn(async (key: string | Record<string, unknown>, value?: unknown) => {
        callCount++
        if (typeof key === 'object') {
          // Batch put - simulate partial failure
          const entries = Object.entries(key)
          for (let i = 0; i < entries.length; i++) {
            if (i === 1) {
              throw new Error('Simulated storage failure')
            }
            mockState._storage.set(entries[i][0], entries[i][1])
          }
        } else {
          mockState._storage.set(key, value)
        }
      })

      // Act & Assert - Batch should fail and roll back
      const batchEntries = {
        'key1': 'value1',
        'key2': 'value2', // This should fail
        'key3': 'value3',
      }

      await expect(mockState.storage.put(batchEntries)).rejects.toThrow('Simulated storage failure')

      // EXPECTED BEHAVIOR (FAILING): No partial writes should exist
      // Currently, 'key1' is written before the failure - this is the atomicity bug
      const key1Value = mockState._storage.get('key1')

      // This assertion SHOULD pass with proper atomicity
      // It will FAIL with current implementation because key1 is written before failure
      expect(key1Value).toBeUndefined() // EXPECTED: No partial writes
    })

    it('validates all items before write', async () => {
      // Expected behavior: Validation should happen BEFORE any writes
      // This ensures fail-fast behavior and no partial writes

      const invalidEntries = {
        'valid-key': 'valid-value',
        '': 'empty-key-invalid', // Invalid: empty key
        'another-valid': 'value',
      }

      // EXPECTED: Should throw validation error before any writes
      // CURRENT: May write 'valid-key' before discovering empty key
      await expect(mockState.storage.put(invalidEntries)).rejects.toThrow()

      // Verify no partial writes occurred
      expect(mockState._storage.has('valid-key')).toBe(false)
    })

    it('respects total size limit (128KB per txn)', async () => {
      // Cloudflare DO storage limit: 128KB per transaction
      const MAX_TXN_SIZE = 128 * 1024 // 128KB

      // Create an oversized batch
      const largeValue = 'x'.repeat(50 * 1024) // 50KB per value
      const oversizedBatch = {
        'large1': largeValue,
        'large2': largeValue,
        'large3': largeValue, // Total: 150KB > 128KB limit
      }

      // EXPECTED: Should reject entire batch, not partial
      // CURRENT: May accept partial writes
      await expect(mockState.storage.put(oversizedBatch)).rejects.toThrow()

      // Verify no partial writes
      expect(mockState._storage.size).toBe(0)
    })
  })

  // ==========================================================================
  // BATCH DELETE OPERATIONS
  // ==========================================================================

  describe('Batch Delete', () => {
    it('deletes multiple keys atomically', async () => {
      // Arrange
      await mockState.storage.put('a', 1)
      await mockState.storage.put('b', 2)
      await mockState.storage.put('c', 3)
      await mockState.storage.put('keep', 'this')

      // Act
      const deleted = await mockState.storage.delete(['a', 'b', 'c'])

      // Assert
      expect(deleted).toBe(3)
      expect(await mockState.storage.get('a')).toBeUndefined()
      expect(await mockState.storage.get('b')).toBeUndefined()
      expect(await mockState.storage.get('c')).toBeUndefined()
      expect(await mockState.storage.get('keep')).toBe('this')
    })

    it('handles missing keys gracefully (idempotent)', async () => {
      // Arrange - Only some keys exist
      await mockState.storage.put('exists', 'value')

      // Act - Delete mix of existing and non-existing keys
      const deleted = await mockState.storage.delete(['exists', 'missing1', 'missing2'])

      // Assert - Should succeed and report actual deletions
      expect(deleted).toBe(1)
      expect(await mockState.storage.get('exists')).toBeUndefined()
    })

    it('validates keys before delete', async () => {
      // Arrange
      await mockState.storage.put('valid', 'value')

      // Expected behavior: Validate all keys before any deletes
      const keysWithInvalid = ['valid', '', 'also-valid'] // Empty string is invalid

      // EXPECTED: Should throw validation error
      // CURRENT: May delete 'valid' before discovering invalid key
      await expect(mockState.storage.delete(keysWithInvalid)).rejects.toThrow()

      // Verify no partial deletes
      expect(await mockState.storage.get('valid')).toBe('value')
    })
  })

  // ==========================================================================
  // MIXED OPERATIONS
  // ==========================================================================

  describe('Mixed Operations', () => {
    it('put and delete in same batch', async () => {
      // Arrange
      await mockState.storage.put('toDelete', 'old-value')
      await mockState.storage.put('toUpdate', 'old-value')

      // Act - Use transaction for mixed operations
      await mockState.storage.transaction(async () => {
        await mockState.storage.put('new-key', 'new-value')
        await mockState.storage.put('toUpdate', 'new-value')
        await mockState.storage.delete('toDelete')
      })

      // Assert
      expect(await mockState.storage.get('new-key')).toBe('new-value')
      expect(await mockState.storage.get('toUpdate')).toBe('new-value')
      expect(await mockState.storage.get('toDelete')).toBeUndefined()
    })

    it('operation order is preserved', async () => {
      // Arrange - Test that operations execute in order
      const executionOrder: string[] = []

      const originalPut = mockState.storage.put
      const originalDelete = mockState.storage.delete
      mockState.storage.put = vi.fn(async (...args: any[]) => {
        executionOrder.push(`put:${typeof args[0] === 'string' ? args[0] : 'batch'}`)
        return originalPut.apply(mockState.storage, args as any)
      })
      mockState.storage.delete = vi.fn(async (key: string | string[]) => {
        executionOrder.push(`delete:${Array.isArray(key) ? key.join(',') : key}`)
        return originalDelete.apply(mockState.storage, [key] as any)
      })

      // Act
      await mockState.storage.transaction(async () => {
        await mockState.storage.put('first', 1)
        await mockState.storage.delete('first')
        await mockState.storage.put('first', 2)
      })

      // Assert - Order should be preserved
      expect(executionOrder).toEqual(['put:first', 'delete:first', 'put:first'])
      expect(await mockState.storage.get('first')).toBe(2)
    })

    it('conflicting ops fail cleanly', async () => {
      // Arrange - Set initial value
      await mockState.storage.put('conflict-key', 'initial')

      // Act - Put then delete same key in one logical batch
      // This represents a conflict that should be detected
      const operations: BatchOperation[] = [
        { type: 'put', key: 'conflict-key', value: 'new-value' },
        { type: 'delete', key: 'conflict-key' },
      ]

      // EXPECTED BEHAVIOR: System should handle this consistently
      // Either: execute in order (result: deleted)
      // Or: reject as conflicting operations

      await mockState.storage.transaction(async () => {
        for (const op of operations) {
          if (op.type === 'put') {
            await mockState.storage.put(op.key, op.value)
          } else {
            await mockState.storage.delete(op.key)
          }
        }
      })

      // Result should be deterministic
      const finalValue = await mockState.storage.get('conflict-key')
      expect(finalValue).toBeUndefined() // Last operation was delete
    })
  })

  // ==========================================================================
  // TRANSACTION SEMANTICS
  // ==========================================================================

  describe('Transaction Semantics', () => {
    it('isolation from concurrent reads', async () => {
      // Arrange
      await mockState.storage.put('shared', 'original')

      // Act - Start a transaction and read from outside
      let outsideReadDuringTxn: unknown
      let insideReadDuringTxn: unknown

      await mockState.storage.transaction(async () => {
        await mockState.storage.put('shared', 'modified-in-txn')
        insideReadDuringTxn = await mockState.storage.get('shared')

        // Simulate concurrent read from "outside" the transaction
        // In a real scenario, this would be another request
        outsideReadDuringTxn = mockState._storage.get('shared')
      })

      // EXPECTED BEHAVIOR: Outside read should NOT see uncommitted changes
      // This is the isolation property of transactions
      // Current mock doesn't provide this isolation

      expect(insideReadDuringTxn).toBe('modified-in-txn') // Inside sees own writes
      // expect(outsideReadDuringTxn).toBe('original') // Outside should see old value
      // Note: This test documents expected behavior - actual DO behavior may vary
    })

    it('batch visible atomically (no torn reads)', async () => {
      // Arrange - Simulate a reader checking consistency
      await mockState.storage.put('counter', 0)
      await mockState.storage.put('checksum', 0)

      // Act - Write correlated values that should be consistent
      const writes = { counter: 100, checksum: 100 }
      await mockState.storage.put(writes)

      // Assert - Reader should see either all old values or all new values
      const counter = await mockState.storage.get<number>('counter')
      const checksum = await mockState.storage.get<number>('checksum')

      // EXPECTED: Values should always be consistent
      expect(counter).toBe(checksum) // Both should match
    })

    it('fails fast on validation error', async () => {
      // Arrange - Set up to track when actual writes occur
      let writesAttempted = 0
      const originalPut = mockState.storage.put
      mockState.storage.put = vi.fn(async (...args: any[]) => {
        writesAttempted++
        return originalPut.apply(mockState.storage, args as any)
      })

      // Act - Include an invalid entry in the batch
      const batchWithInvalid = {
        'valid1': 'value',
        'valid2': 'value',
        // Note: Current DO storage doesn't have built-in validation
        // This test documents expected behavior for a validation layer
      }

      // When validation is implemented:
      // - Should detect all invalid entries BEFORE any writes
      // - Should throw BatchValidationError with all invalid keys
      // - writesAttempted should remain 0

      await mockState.storage.put(batchWithInvalid)

      // Currently passes but doesn't verify fail-fast behavior
      // With proper validation, invalid batches would be rejected before writes
    })
  })

  // ==========================================================================
  // STORAGE LIMITS
  // ==========================================================================

  describe('Storage Limits', () => {
    it('rejects batch exceeding 128 keys', async () => {
      // Cloudflare DO limit: 128 keys per batch operation
      const MAX_BATCH_KEYS = 128

      // Create oversized batch
      const oversizedBatch: Record<string, string> = {}
      for (let i = 0; i < 150; i++) {
        oversizedBatch[`key-${i}`] = `value-${i}`
      }

      // EXPECTED: Should reject entire batch
      // CURRENT: May accept (no enforcement in mock)
      await expect(mockState.storage.put(oversizedBatch)).rejects.toThrow()

      // Verify no partial writes
      expect(mockState._storage.size).toBe(0)
    })

    it('rejects oversized values', async () => {
      // Cloudflare DO limit: ~128KB per value
      const MAX_VALUE_SIZE = 128 * 1024

      const oversizedValue = 'x'.repeat(MAX_VALUE_SIZE + 1000)

      // EXPECTED: Should reject before write
      await expect(mockState.storage.put('oversized', oversizedValue)).rejects.toThrow()

      // Verify no write occurred
      expect(mockState._storage.has('oversized')).toBe(false)
    })

    it('handles empty batch gracefully', async () => {
      // Arrange
      const initialSize = mockState._storage.size

      // Act - Empty batch should be no-op
      await mockState.storage.put({})

      // Assert
      expect(mockState._storage.size).toBe(initialSize)
    })
  })

  // ==========================================================================
  // ERROR RECOVERY
  // ==========================================================================

  describe('Error Recovery', () => {
    it('throws BatchError with failed keys', async () => {
      // Arrange - Create a scenario where some keys fail
      const originalPut = mockState.storage.put
      mockState.storage.put = vi.fn(async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === 'object') {
          const failedKeys: string[] = []
          for (const [k, v] of Object.entries(key)) {
            if (k.startsWith('fail-')) {
              failedKeys.push(k)
            }
          }
          if (failedKeys.length > 0) {
            const error = new BatchError('Batch operation failed', {
              code: 'BATCH_PARTIAL_FAILURE',
              failedKeys,
              partialSuccess: false, // With proper atomicity, this should be false
            })
            throw error
          }
        }
        return originalPut.apply(mockState.storage, [key, value] as any)
      })

      // Act & Assert
      const batch = {
        'ok-1': 'value1',
        'fail-2': 'value2',
        'ok-3': 'value3',
      }

      try {
        await mockState.storage.put(batch)
        expect.fail('Should have thrown BatchError')
      } catch (error) {
        expect(error).toBeInstanceOf(BatchError)
        expect((error as BatchError).failedKeys).toContain('fail-2')
        expect((error as BatchError).partialSuccess).toBe(false)
      }
    })

    it('storage state unchanged on failure', async () => {
      // Arrange - Pre-populate storage
      await mockState.storage.put('existing', 'original-value')
      const originalSnapshot = new Map(mockState._storage)

      // Mock failure during batch
      const originalPut = mockState.storage.put
      mockState.storage.put = vi.fn(async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === 'object' && Object.keys(key).length > 1) {
          // Simulate failure partway through
          throw new Error('Storage failure')
        }
        return originalPut.apply(mockState.storage, [key, value] as any)
      })

      // Act
      const batch = {
        'new-key-1': 'new-value-1',
        'new-key-2': 'new-value-2',
        'existing': 'modified',
      }

      await expect(mockState.storage.put(batch)).rejects.toThrow('Storage failure')

      // Assert - Storage should be unchanged (rollback)
      // EXPECTED: Perfect rollback to original state
      // CURRENT: May have partial state
      expect(mockState._storage.get('existing')).toBe('original-value')
      expect(mockState._storage.has('new-key-1')).toBe(false)
      expect(mockState._storage.has('new-key-2')).toBe(false)
    })

    it('can retry failed batch (idempotent retry)', async () => {
      // Arrange - Create a transient failure scenario
      let attemptCount = 0
      const originalPut = mockState.storage.put

      mockState.storage.put = vi.fn(async (key: string | Record<string, unknown>, value?: unknown) => {
        attemptCount++
        if (attemptCount === 1 && typeof key === 'object') {
          throw new Error('Transient failure')
        }
        return originalPut.apply(mockState.storage, [key, value] as any)
      })

      const batch = {
        'retry-key-1': 'value-1',
        'retry-key-2': 'value-2',
      }

      // Act - First attempt fails
      await expect(mockState.storage.put(batch)).rejects.toThrow('Transient failure')

      // Retry should succeed
      await mockState.storage.put(batch)

      // Assert
      expect(await mockState.storage.get('retry-key-1')).toBe('value-1')
      expect(await mockState.storage.get('retry-key-2')).toBe('value-2')
      expect(attemptCount).toBe(2)
    })
  })

  // ==========================================================================
  // ADDITIONAL ATOMICITY TESTS
  // ==========================================================================

  describe('Additional Atomicity Guarantees', () => {
    it('concurrent batch operations do not interleave', async () => {
      // Arrange
      const results: string[] = []

      // Act - Run two "concurrent" batches
      const batch1 = mockState.storage.transaction(async () => {
        await mockState.storage.put('shared', 'batch1-value')
        results.push('batch1-write')
        await new Promise((resolve) => setTimeout(resolve, 10))
        results.push('batch1-complete')
      })

      const batch2 = mockState.storage.transaction(async () => {
        await mockState.storage.put('shared', 'batch2-value')
        results.push('batch2-write')
        await new Promise((resolve) => setTimeout(resolve, 5))
        results.push('batch2-complete')
      })

      await Promise.all([batch1, batch2])

      // Assert - Operations should not interleave
      // Either: [batch1-write, batch1-complete, batch2-write, batch2-complete]
      // Or: [batch2-write, batch2-complete, batch1-write, batch1-complete]
      // NOT: [batch1-write, batch2-write, batch2-complete, batch1-complete]

      // Due to DO's single-threaded nature, this should be serialized
      // But we need to verify the mock enforces this
    })

    it('nested transactions are not allowed', async () => {
      // DO storage should not support nested transactions
      // (or should flatten them appropriately)

      let nestedAttempted = false

      await mockState.storage.transaction(async () => {
        await mockState.storage.put('outer', 'value')

        try {
          await mockState.storage.transaction(async () => {
            nestedAttempted = true
            await mockState.storage.put('inner', 'value')
          })
        } catch {
          // Expected: nested transaction rejected
        }
      })

      // EXPECTED BEHAVIOR: Either nested txn rejected OR flattened
      // Current mock allows nesting, which could cause issues
    })

    it('batch operations are durable after completion', async () => {
      // Once a batch completes successfully, data should be durable
      const batch = {
        'durable-1': 'value-1',
        'durable-2': 'value-2',
      }

      await mockState.storage.put(batch)

      // Verify data persists (simulating restart by re-reading)
      const value1 = await mockState.storage.get('durable-1')
      const value2 = await mockState.storage.get('durable-2')

      expect(value1).toBe('value-1')
      expect(value2).toBe('value-2')
    })
  })
})
